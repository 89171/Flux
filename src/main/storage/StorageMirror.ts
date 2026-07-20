import {
  existsSync,
  lstatSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  writeFileSync
} from 'fs'
import { basename, dirname, extname, join, resolve as pathResolve } from 'path'
import { createHash } from 'crypto'
import type { FileMutation, FileSystemManager } from '../FileSystemManager'
import type { StorageFile } from '@shared/types'
import type { StorageManager } from './StorageManager'
import { STATIC_ASSETS_ROOT } from '@shared/constants'

interface MirrorFileState {
  hash: string
}

interface MirrorIndex {
  version: 1
  updatedAt: number
  files: Record<string, MirrorFileState>
}

interface FileSnapshot {
  path: string
  hash: string
  data?: Uint8Array
}

const SYNC_INDEX_PATH = '.flux/sync/index.json'
const REMOTE_POLL_INTERVAL_MS = 60_000
const TRANSIENT_SYNC_RETRY_MS = 15_000

export class StorageMirror {
  private queue: Promise<void> = Promise.resolve()
  private unsubscribeMutation: (() => void) | null = null
  private unsubscribeConfigure: (() => void) | null = null
  private pollTimer: NodeJS.Timeout | null = null
  private retryTimer: NodeJS.Timeout | null = null

  constructor(
    private readonly fsManager: FileSystemManager,
    private readonly storageManager: StorageManager
  ) {}

  start(): void {
    if (this.unsubscribeMutation) return

    this.unsubscribeMutation = this.fsManager.onMutation((mutation) => {
      this.enqueue(`local:${mutation.type}`, () => this.applyLocalMutation(mutation))
    })
    this.unsubscribeConfigure = this.storageManager.onConfigure(() => {
      this.syncNow('configure')
    })
    this.pollTimer = setInterval(() => this.syncNow('poll'), REMOTE_POLL_INTERVAL_MS)
    this.syncNow('startup')
  }

  stop(): void {
    this.unsubscribeMutation?.()
    this.unsubscribeMutation = null
    this.unsubscribeConfigure?.()
    this.unsubscribeConfigure = null
    if (this.pollTimer) clearInterval(this.pollTimer)
    this.pollTimer = null
    if (this.retryTimer) clearTimeout(this.retryTimer)
    this.retryTimer = null
  }

  syncNow(reason = 'manual'): void {
    this.enqueue(`sync:${reason}`, () => this.reconcileWithRemote())
  }

  private enqueue(label: string, task: () => Promise<void>): void {
    this.queue = this.queue.then(async () => {
      try {
        await task()
      } catch (err) {
        if (this.isTransientProviderError(err)) {
          this.scheduleTransientRetry(label, err)
          return
        }
        console.warn(`[StorageMirror] ${label} failed:`, err)
      }
    })
  }

  private scheduleTransientRetry(label: string, err: unknown): void {
    console.warn(
      `[StorageMirror] ${label} deferred: ${this.formatProviderError(err)}. Retrying sync in ${Math.round(TRANSIENT_SYNC_RETRY_MS / 1000)}s.`
    )
    if (this.retryTimer) return

    this.retryTimer = setTimeout(() => {
      this.retryTimer = null
      this.syncNow('retry')
    }, TRANSIENT_SYNC_RETRY_MS)
  }

  private async applyLocalMutation(mutation: FileMutation): Promise<void> {
    if (this.isLocalWorkspaceMirror()) return

    const index = this.loadIndex()
    switch (mutation.type) {
      case 'write':
        await this.uploadPath(mutation.path, index)
        break
      case 'delete':
        await this.deleteRemotePath(mutation.path)
        this.removeIndexPath(index, mutation.path)
        break
      case 'move':
        await this.deleteRemotePath(mutation.oldPath)
        this.removeIndexPath(index, mutation.oldPath)
        await this.uploadPath(mutation.newPath, index)
        break
      default: {
        const exhaustive: never = mutation
        throw new Error(`Unsupported file mutation: ${JSON.stringify(exhaustive)}`)
      }
    }
    this.saveIndex(index)
  }

  private async reconcileWithRemote(): Promise<void> {
    if (this.isLocalWorkspaceMirror()) return

    const index = this.loadIndex()
    const [localFiles, remoteFiles] = await Promise.all([
      this.collectLocalFiles(),
      this.collectRemoteFiles('')
    ])
    const allPaths = new Set<string>([
      ...Object.keys(index.files),
      ...localFiles.keys(),
      ...remoteFiles.keys()
    ])

    for (const path of [...allPaths].sort()) {
      const local = localFiles.get(path)
      const remote = remoteFiles.get(path)
      const previousHash = index.files[path]?.hash
      await this.reconcileFile(path, local, remote, previousHash, index)
    }

    this.saveIndex(index)
  }

  private async reconcileFile(
    path: string,
    local: FileSnapshot | undefined,
    remote: FileSnapshot | undefined,
    previousHash: string | undefined,
    index: MirrorIndex
  ): Promise<void> {
    if (!local && !remote) {
      delete index.files[path]
      return
    }

    if (local && remote && local.hash === remote.hash) {
      index.files[path] = { hash: local.hash }
      return
    }

    if (!local && remote) {
      if (previousHash && remote.hash === previousHash) {
        await this.deleteRemotePath(path)
        delete index.files[path]
      } else {
        await this.writeLocalFile(path, this.requireRemoteData(remote))
        index.files[path] = { hash: remote.hash }
      }
      return
    }

    if (local && !remote) {
      if (previousHash && local.hash === previousHash) {
        await this.deleteLocalPath(path)
        delete index.files[path]
      } else {
        await this.uploadFile(path, index)
      }
      return
    }

    if (!local || !remote) return

    if (previousHash && local.hash === previousHash) {
      await this.writeLocalFile(path, this.requireRemoteData(remote))
      index.files[path] = { hash: remote.hash }
      return
    }

    if (previousHash && remote.hash === previousHash) {
      await this.uploadFile(path, index)
      return
    }

    await this.writeConflictFile(path, this.requireRemoteData(remote), remote.hash, index)
    await this.uploadFile(path, index)
  }

  private async uploadPath(path: string, index: MirrorIndex): Promise<void> {
    const providerPath = this.normalizeProviderPath(path)
    if (!this.shouldMirrorPath(providerPath)) return

    const fullPath = this.fsManager.resolvePath(providerPath)
    if (!existsSync(fullPath)) return

    const stats = lstatSync(fullPath)
    if (stats.isDirectory()) {
      for (const entry of readdirSync(fullPath, { withFileTypes: true })) {
        await this.uploadPath(join(providerPath, entry.name), index)
      }
      return
    }

    await this.uploadFile(providerPath, index)
  }

  private async uploadFile(path: string, index: MirrorIndex): Promise<void> {
    const fullPath = this.fsManager.resolvePath(path)
    const data = readFileSync(fullPath)
    await this.storageManager.write(path, data)
    index.files[path] = { hash: this.hash(data) }
  }

  private async deleteRemotePath(path: string): Promise<void> {
    const providerPath = this.normalizeProviderPath(path)
    if (!this.shouldMirrorPath(providerPath)) return

    try {
      const entries = await this.storageManager.list(providerPath)
      if (this.isSingleFileListing(providerPath, entries)) {
        await this.deleteRemoteFile(providerPath)
        return
      }

      for (const entry of entries) {
        const entryPath = this.normalizeProviderPath(entry.path)
        if (entry.type === 'directory') {
          await this.deleteRemotePath(entryPath)
        } else {
          await this.deleteRemoteFile(entryPath)
        }
      }
    } catch (err) {
      if (this.isNotFoundError(err)) return
      await this.deleteRemoteFile(providerPath)
      return
    }

    await this.deleteRemoteFile(providerPath)
  }

  private async deleteRemoteFile(path: string): Promise<void> {
    try {
      await this.storageManager.delete(path)
    } catch (err) {
      if (!this.isNotFoundError(err)) throw err
    }
  }

  private async deleteLocalPath(path: string): Promise<void> {
    const providerPath = this.normalizeProviderPath(path)
    if (!this.shouldMirrorPath(providerPath)) return
    const fullPath = this.fsManager.resolvePath(providerPath)
    if (!existsSync(fullPath)) return
    this.fsManager.suppressMutations(() => this.fsManager.delete(providerPath))
  }

  private async writeLocalFile(path: string, data: Uint8Array): Promise<void> {
    this.fsManager.suppressMutations(() => {
      if (this.fsManager.isStaticAssetPath(path)) {
        this.fsManager.writeBinaryFile(path, data)
      } else {
        const text = Buffer.from(data).toString('utf-8')
        if (existsSync(this.fsManager.resolvePath(path))) {
          this.fsManager.writeFile(path, text)
        } else {
          this.fsManager.createFile(path, text)
        }
      }
    })
  }

  private async writeConflictFile(
    originalPath: string,
    remoteData: Uint8Array,
    remoteHash: string,
    index: MirrorIndex
  ): Promise<void> {
    const conflictPath = this.nextConflictPath(originalPath)
    await this.writeLocalFile(conflictPath, remoteData)
    await this.storageManager.write(conflictPath, remoteData)
    index.files[conflictPath] = { hash: remoteHash }
  }

  private nextConflictPath(originalPath: string): string {
    const cleanPath = this.normalizeProviderPath(originalPath)
    const dir = dirname(cleanPath)
    const name = basename(cleanPath)
    const ext = extname(name)
    const stem = ext ? name.slice(0, -ext.length) : name
    const stamp = new Date().toISOString().replace(/[:.]/g, '-')
    const fileName = `${stem}.remote-conflict-${stamp}${ext}`
    return dir && dir !== '.' ? `${dir}/${fileName}` : fileName
  }

  private collectLocalFiles(): Map<string, FileSnapshot> {
    const files = new Map<string, FileSnapshot>()
    this.walkLocalDir('', files)
    return files
  }

  private walkLocalDir(relativeDir: string, files: Map<string, FileSnapshot>): void {
    const fullDir = relativeDir ? this.fsManager.resolvePath(relativeDir) : this.fsManager.getWorkspacePath()
    if (!existsSync(fullDir)) return

    for (const entry of readdirSync(fullDir, { withFileTypes: true })) {
      const childPath = relativeDir ? `${relativeDir}/${entry.name}` : entry.name
      const providerPath = this.normalizeProviderPath(childPath)
      if (!this.shouldMirrorPath(providerPath)) continue
      if (this.shouldSkipEntry(entry.name, providerPath)) continue

      const fullPath = this.fsManager.resolvePath(providerPath)
      if (entry.isDirectory()) {
        this.walkLocalDir(providerPath, files)
      } else if (entry.isFile()) {
        const data = readFileSync(fullPath)
        files.set(providerPath, { path: providerPath, hash: this.hash(data) })
      }
    }
  }

  private async collectRemoteFiles(path: string): Promise<Map<string, FileSnapshot>> {
    const files = new Map<string, FileSnapshot>()
    await this.walkRemoteDir(path, files)
    return files
  }

  private async walkRemoteDir(path: string, files: Map<string, FileSnapshot>): Promise<void> {
    let entries: StorageFile[]
    try {
      entries = await this.storageManager.list(path)
    } catch (err) {
      if (this.isNotFoundError(err)) return
      throw err
    }

    for (const entry of entries) {
      const providerPath = this.normalizeProviderPath(entry.path)
      if (!this.shouldMirrorPath(providerPath)) continue
      if (this.shouldSkipEntry(entry.name, providerPath)) continue

      if (entry.type === 'directory') {
        await this.walkRemoteDir(providerPath, files)
      } else {
        const data = await this.storageManager.read(providerPath)
        files.set(providerPath, {
          path: providerPath,
          hash: this.hash(data),
          data
        })
      }
    }
  }

  private loadIndex(): MirrorIndex {
    const fullPath = this.fsManager.resolvePath(SYNC_INDEX_PATH)
    if (!existsSync(fullPath)) {
      return { version: 1, updatedAt: Date.now(), files: {} }
    }

    try {
      const parsed = JSON.parse(readFileSync(fullPath, 'utf-8')) as Partial<MirrorIndex>
      return {
        version: 1,
        updatedAt: typeof parsed.updatedAt === 'number' ? parsed.updatedAt : Date.now(),
        files: parsed.files && typeof parsed.files === 'object' ? parsed.files : {}
      }
    } catch {
      return { version: 1, updatedAt: Date.now(), files: {} }
    }
  }

  private saveIndex(index: MirrorIndex): void {
    index.updatedAt = Date.now()
    const fullPath = this.fsManager.resolvePath(SYNC_INDEX_PATH)
    mkdirSync(dirname(fullPath), { recursive: true })
    writeFileSync(fullPath, JSON.stringify(index, null, 2), 'utf-8')
  }

  private removeIndexPath(index: MirrorIndex, path: string): void {
    const providerPath = this.normalizeProviderPath(path)
    for (const key of Object.keys(index.files)) {
      if (key === providerPath || key.startsWith(`${providerPath}/`)) {
        delete index.files[key]
      }
    }
  }

  private isSingleFileListing(path: string, entries: StorageFile[]): boolean {
    return (
      entries.length === 1 &&
      entries[0].type === 'file' &&
      this.normalizeProviderPath(entries[0].path) === path
    )
  }

  private requireRemoteData(snapshot: FileSnapshot): Uint8Array {
    if (!snapshot.data) {
      throw new Error(`Remote data was not loaded for ${snapshot.path}`)
    }
    return snapshot.data
  }

  private normalizeProviderPath(path: string): string {
    return path.replace(/\\/g, '/').replace(/^\/+|\/+$/g, '')
  }

  private shouldMirrorPath(path: string): boolean {
    return !!path && path !== '.' && path !== '.flux' && !path.startsWith('.flux/')
  }

  private shouldSkipEntry(name: string, path: string): boolean {
    if (path === STATIC_ASSETS_ROOT || path.startsWith(`${STATIC_ASSETS_ROOT}/`)) {
      return false
    }
    return name.startsWith('.') || name === 'node_modules'
  }

  private isNotFoundError(err: unknown): boolean {
    if (!(err instanceof Error)) return false
    return /\b(404|not found|no such key|enoent)\b/i.test(err.message)
  }

  private isTransientProviderError(err: unknown): boolean {
    return this.errorMatches(err, /\b(fetch failed|network|timeout|timedout|abort|aborted|ETIMEDOUT|ECONNRESET|EAI_AGAIN|ENOTFOUND|ECONNREFUSED|socket)\b/i)
  }

  private formatProviderError(err: unknown): string {
    const message = err instanceof Error ? err.message : String(err)
    const code = this.findErrorCode(err)
    if (code && !message.includes(code)) return `${message} (${code})`
    return message
  }

  private findErrorCode(err: unknown): string | null {
    if (!err) return null
    if (err instanceof AggregateError) {
      for (const item of err.errors) {
        const code = this.findErrorCode(item)
        if (code) return code
      }
      return null
    }
    if (typeof err === 'object') {
      const code = (err as { code?: unknown }).code
      if (typeof code === 'string' && code) return code
      return this.findErrorCode((err as { cause?: unknown }).cause)
    }
    return null
  }

  private errorMatches(err: unknown, pattern: RegExp): boolean {
    if (!err) return false
    if (typeof err === 'string') return pattern.test(err)

    if (err instanceof AggregateError) {
      return err.errors.some((item) => this.errorMatches(item, pattern))
    }

    if (err instanceof Error) {
      if (pattern.test(`${err.name} ${err.message}`)) return true
      return this.errorMatches((err as Error & { cause?: unknown }).cause, pattern)
    }

    if (typeof err === 'object') {
      const code = (err as { code?: unknown }).code
      if (code && pattern.test(String(code))) return true
      return this.errorMatches((err as { cause?: unknown }).cause, pattern)
    }

    return pattern.test(String(err))
  }

  private isLocalWorkspaceMirror(): boolean {
    const settings = this.storageManager.getSettings()
    return (
      settings.provider === 'local' &&
      pathResolve(settings.local.rootPath) === pathResolve(this.fsManager.getWorkspacePath())
    )
  }

  private hash(data: Uint8Array): string {
    return createHash('sha256').update(Buffer.from(data)).digest('hex')
  }
}
