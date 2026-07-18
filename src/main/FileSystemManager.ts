import { join, dirname, basename, extname, relative, resolve as pathResolve } from 'path'
import {
  existsSync,
  readdirSync,
  readFileSync,
  writeFileSync,
  mkdirSync,
  statSync,
  lstatSync,
  unlinkSync,
  rmdirSync,
  renameSync,
  realpathSync
} from 'fs'
import chokidar, { type FSWatcher } from 'chokidar'
import type {
  FileHistoryAction,
  FileHistoryEntry,
  FileHistoryReadResult,
  NoteFile,
  NoteFormat,
  SearchResult,
  TrashEntry,
  TrashRestoreResult
} from '@shared/types'

const HISTORY_RETENTION_MS = 30 * 24 * 60 * 60 * 1000
const HISTORY_ROOT = '.flux/history'
const TRASH_ROOT = '.flux/trash'
const TRASH_ITEMS_ROOT = '.flux/trash/items'
const TRASH_METADATA_ROOT = '.flux/trash/metadata'

interface StoredHistoryEntry extends FileHistoryEntry {
  content: string
}

interface StoredTrashEntry extends TrashEntry {
  storageName: string
}

/**
 * Callback that maps a file path to a renderer id. Injected from the
 * outside so FileSystemManager stays decoupled from PluginManager; the
 * app wires the two in main/index.ts.
 */
export type FormatResolver = (filePath: string) => NoteFormat

/**
 * File tree change kinds. `snapshot` fires on initial build + after big
 * rewrites; `mutation` fires when we know a specific caller mutated the
 * tree (so we can skip needless work on the renderer side).
 */
export type TreeChangeReason = 'snapshot' | 'mutation'

export class FileSystemManager {
  private workspacePath: string
  private formatResolver: FormatResolver

  /** Cached file tree. Serves FILE_TREE IPCs without re-walking the disk. */
  private treeCache: NoteFile[] | null = null
  private watcher: FSWatcher | null = null
  private rebuildTimer: NodeJS.Timeout | null = null
  private treeListeners: Array<(tree: NoteFile[], reason: TreeChangeReason) => void> = []

  constructor(workspacePath: string, formatResolver?: FormatResolver) {
    this.workspacePath = workspacePath
    // Default resolver — if PluginManager hasn't been wired yet (e.g. tests,
    // early boot) treat every file as plaintext. Injected via setter or
    // constructor once PluginManager exists.
    this.formatResolver = formatResolver ?? (() => 'plaintext')
    this.ensureWorkspace()
    this.startWatching()
  }

  setFormatResolver(resolver: FormatResolver): void {
    this.formatResolver = resolver
  }

  private ensureWorkspace(): void {
    if (!existsSync(this.workspacePath)) {
      mkdirSync(this.workspacePath, { recursive: true })
    }
  }

  setWorkspacePath(path: string): void {
    this.workspacePath = path
    this.ensureWorkspace()
    // Watcher is tied to the workspace root — restart it when the user
    // switches folders so we track the new one instead of the old.
    this.startWatching()
  }

  private getHistoryRootPath(): string {
    return this.resolvePath(HISTORY_ROOT)
  }

  private getTrashRootPath(): string {
    return this.resolvePath(TRASH_ROOT)
  }

  private getTrashItemsRootPath(): string {
    return this.resolvePath(TRASH_ITEMS_ROOT)
  }

  private getTrashMetadataRootPath(): string {
    return this.resolvePath(TRASH_METADATA_ROOT)
  }

  private getHistoryKey(relativePath: string): string {
    return Buffer.from(relativePath, 'utf-8')
      .toString('base64')
      .replace(/\+/g, '-')
      .replace(/\//g, '_')
      .replace(/=+$/g, '')
  }

  private getHistoryDir(relativePath: string): string {
    return join(this.getHistoryRootPath(), this.getHistoryKey(relativePath))
  }

  private isHistoryId(id: string): boolean {
    return /^\d{13}-[a-z0-9]+$/.test(id)
  }

  private ensureTrashDirectories(): void {
    mkdirSync(this.getTrashItemsRootPath(), { recursive: true })
    mkdirSync(this.getTrashMetadataRootPath(), { recursive: true })
  }

  private getTrashMetadataPath(id: string): string {
    if (!this.isHistoryId(id)) throw new Error(`Invalid trash id: ${id}`)
    return join(this.getTrashMetadataRootPath(), `${id}.json`)
  }

  private isSafeTrashStorageName(storageName: string): boolean {
    return (
      !!storageName &&
      storageName !== '.' &&
      storageName !== '..' &&
      !storageName.includes('/') &&
      !storageName.includes('\\')
    )
  }

  private getTrashItemPath(entry: StoredTrashEntry): string {
    if (!this.isSafeTrashStorageName(entry.storageName)) {
      throw new Error(`Invalid trash storage name: ${entry.storageName}`)
    }
    return join(this.getTrashItemsRootPath(), entry.storageName)
  }

  private assertUserManagedPath(relativePath: string): void {
    const normalized = relativePath.replace(/\\/g, '/').replace(/^\/+/, '')
    if (!normalized || normalized === '.') {
      throw new Error('Cannot delete the workspace root')
    }
    if (normalized === '.flux' || normalized.startsWith('.flux/')) {
      throw new Error('Cannot modify Flux internal data')
    }
  }

  private pruneHistory(): void {
    const root = this.getHistoryRootPath()
    if (!existsSync(root)) return

    const cutoff = Date.now() - HISTORY_RETENTION_MS
    for (const dirent of readdirSync(root, { withFileTypes: true })) {
      if (!dirent.isDirectory()) continue
      const dirPath = join(root, dirent.name)
      for (const file of readdirSync(dirPath, { withFileTypes: true })) {
        if (!file.isFile() || !file.name.endsWith('.json')) continue
        const fullPath = join(dirPath, file.name)
        try {
          const raw = readFileSync(fullPath, 'utf-8')
          const parsed = JSON.parse(raw) as Partial<StoredHistoryEntry>
          if (typeof parsed.timestamp !== 'number' || parsed.timestamp < cutoff) {
            unlinkSync(fullPath)
          }
        } catch {
          unlinkSync(fullPath)
        }
      }
      try {
        if (readdirSync(dirPath).length === 0) rmdirSync(dirPath)
      } catch {
        // best-effort cleanup
      }
    }
  }

  private createHistorySnapshot(relativePath: string, action: FileHistoryAction): void {
    let fullPath: string
    try {
      fullPath = this.resolvePath(relativePath)
    } catch {
      return
    }
    if (!existsSync(fullPath)) return
    const stats = statSync(fullPath)
    if (stats.isDirectory()) return

    let content: string
    try {
      content = readFileSync(fullPath, 'utf-8')
    } catch {
      return
    }

    this.pruneHistory()
    const latest = this.listFileHistory(relativePath)[0]
    if (latest) {
      try {
        const latestContent = this.readFileHistoryEntry(relativePath, latest.id).content
        if (latestContent === content && latest.action === action) return
      } catch {
        // If the latest entry is unreadable, keep going and write a fresh one.
      }
    }

    const historyDir = this.getHistoryDir(relativePath)
    mkdirSync(historyDir, { recursive: true })
    const timestamp = Date.now()
    const id = `${timestamp}-${Math.random().toString(36).slice(2, 8)}`
    const entry: StoredHistoryEntry = {
      id,
      path: relativePath,
      name: basename(fullPath),
      timestamp,
      size: Buffer.byteLength(content, 'utf-8'),
      action,
      content
    }
    writeFileSync(join(historyDir, `${id}.json`), JSON.stringify(entry), 'utf-8')
  }

  private moveHistory(oldPath: string, newPath: string): void {
    const oldDir = this.getHistoryDir(oldPath)
    if (!existsSync(oldDir)) return

    const newDir = this.getHistoryDir(newPath)
    mkdirSync(newDir, { recursive: true })

    for (const file of readdirSync(oldDir, { withFileTypes: true })) {
      if (!file.isFile()) continue
      const source = join(oldDir, file.name)
      const target = join(newDir, file.name)
      try {
        if (existsSync(target)) {
          continue
        } else {
          renameSync(source, target)
        }
      } catch {
        // best-effort migration; the original history remains if a move fails.
      }
    }

    try {
      if (readdirSync(oldDir).length === 0) rmdirSync(oldDir)
    } catch {
      // best-effort cleanup
    }
  }

  listFileHistory(relativePath: string): FileHistoryEntry[] {
    this.pruneHistory()
    const historyDir = this.getHistoryDir(relativePath)
    if (!existsSync(historyDir)) return []

    const entries: FileHistoryEntry[] = []
    for (const file of readdirSync(historyDir, { withFileTypes: true })) {
      if (!file.isFile() || !file.name.endsWith('.json')) continue
      try {
        const parsed = JSON.parse(
          readFileSync(join(historyDir, file.name), 'utf-8')
        ) as StoredHistoryEntry
        entries.push({
          id: parsed.id,
          path: parsed.path,
          name: parsed.name,
          timestamp: parsed.timestamp,
          size: parsed.size,
          action: parsed.action
        })
      } catch {
        // Unreadable history files are pruned on the next cleanup pass.
      }
    }
    entries.sort((a, b) => b.timestamp - a.timestamp)
    return entries
  }

  readFileHistoryEntry(relativePath: string, id: string): FileHistoryReadResult {
    if (!this.isHistoryId(id)) throw new Error(`Invalid history id: ${id}`)
    const historyPath = join(this.getHistoryDir(relativePath), `${id}.json`)
    const parsed = JSON.parse(readFileSync(historyPath, 'utf-8')) as StoredHistoryEntry
    return parsed
  }

  restoreFileHistory(
    relativePath: string,
    id: string
  ): { content: string; mtime: number } {
    const entry = this.readFileHistoryEntry(relativePath, id)
    const fullPath = this.resolvePath(relativePath)
    const existedBefore = existsSync(fullPath)
    this.createHistorySnapshot(relativePath, 'restore')

    const dir = dirname(fullPath)
    if (!existsSync(dir)) mkdirSync(dir, { recursive: true })
    writeFileSync(fullPath, entry.content, 'utf-8')
    if (!existedBefore) this.invalidateTree('mutation')
    return { content: entry.content, mtime: statSync(fullPath).mtime.getTime() }
  }

  private getPathSize(fullPath: string): number {
    const stats = lstatSync(fullPath)
    if (!stats.isDirectory()) return stats.size

    let size = 0
    for (const entry of readdirSync(fullPath, { withFileTypes: true })) {
      size += this.getPathSize(join(fullPath, entry.name))
    }
    return size
  }

  private createTrashId(): string {
    return `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
  }

  private readStoredTrashEntry(id: string): StoredTrashEntry {
    const parsed = JSON.parse(readFileSync(this.getTrashMetadataPath(id), 'utf-8')) as StoredTrashEntry
    if (!this.isHistoryId(parsed.id) || parsed.id !== id) {
      throw new Error(`Invalid trash metadata id: ${id}`)
    }
    if (parsed.type !== 'file' && parsed.type !== 'directory') {
      throw new Error(`Invalid trash metadata type: ${id}`)
    }
    if (!this.isSafeTrashStorageName(parsed.storageName)) {
      throw new Error(`Invalid trash metadata storage name: ${id}`)
    }
    return parsed
  }

  private toTrashEntry(entry: StoredTrashEntry): TrashEntry {
    return {
      id: entry.id,
      name: entry.name,
      originalPath: entry.originalPath,
      type: entry.type,
      deletedAt: entry.deletedAt,
      size: entry.size,
      format: entry.format
    }
  }

  private getAvailableRestoreTarget(
    originalPath: string,
    type: 'file' | 'directory'
  ): { relativePath: string; fullPath: string } {
    let targetPath = this.resolvePath(originalPath)
    if (!existsSync(targetPath)) return { relativePath: originalPath, fullPath: targetPath }

    const parentPath = dirname(originalPath)
    const hasParent = parentPath !== '.'
    const name = basename(originalPath)
    const ext = type === 'file' ? extname(name) : ''
    const stem = ext ? name.slice(0, -ext.length) : name

    for (let i = 1; i < 1000; i++) {
      const suffix = i === 1 ? ' restored' : ` restored ${i}`
      const candidateName = `${stem}${suffix}${ext}`
      const candidateRelativePath = hasParent ? join(parentPath, candidateName) : candidateName
      targetPath = this.resolvePath(candidateRelativePath)
      if (!existsSync(targetPath)) {
        return { relativePath: candidateRelativePath, fullPath: targetPath }
      }
    }

    throw new Error(`Unable to find a restore path for: ${originalPath}`)
  }

  listTrash(): TrashEntry[] {
    const metadataRoot = this.getTrashMetadataRootPath()
    if (!existsSync(metadataRoot)) return []

    const entries: TrashEntry[] = []
    for (const file of readdirSync(metadataRoot, { withFileTypes: true })) {
      if (!file.isFile() || !file.name.endsWith('.json')) continue
      const metadataPath = join(metadataRoot, file.name)
      try {
        const parsed = JSON.parse(readFileSync(metadataPath, 'utf-8')) as StoredTrashEntry
        if (!this.isHistoryId(parsed.id) || !this.isSafeTrashStorageName(parsed.storageName)) {
          throw new Error('Invalid trash metadata')
        }
        if (!existsSync(this.getTrashItemPath(parsed))) {
          unlinkSync(metadataPath)
          continue
        }
        entries.push(this.toTrashEntry(parsed))
      } catch {
        unlinkSync(metadataPath)
      }
    }

    entries.sort((a, b) => b.deletedAt - a.deletedAt)
    return entries
  }

  restoreTrashEntry(id: string): TrashRestoreResult {
    const entry = this.readStoredTrashEntry(id)
    this.assertUserManagedPath(entry.originalPath)

    const itemPath = this.getTrashItemPath(entry)
    if (!existsSync(itemPath)) throw new Error(`Trash item does not exist: ${id}`)

    const target = this.getAvailableRestoreTarget(entry.originalPath, entry.type)
    const targetDir = dirname(target.fullPath)
    if (!existsSync(targetDir)) mkdirSync(targetDir, { recursive: true })

    renameSync(itemPath, target.fullPath)
    unlinkSync(this.getTrashMetadataPath(id))

    const stats = lstatSync(target.fullPath)
    const noteFile: NoteFile = {
      id: this.pathToId(target.relativePath),
      name: basename(target.fullPath),
      path: target.relativePath,
      type: entry.type,
      format: entry.type === 'file' ? this.detectFormat(target.relativePath) : undefined,
      createdAt: stats.birthtime.getTime(),
      updatedAt: stats.mtime.getTime()
    }

    this.invalidateTree('mutation')
    return { restoredPath: target.relativePath, entry: noteFile }
  }

  permanentlyDeleteTrashEntry(id: string): void {
    const entry = this.readStoredTrashEntry(id)
    const itemPath = this.getTrashItemPath(entry)
    if (existsSync(itemPath)) {
      const stats = lstatSync(itemPath)
      if (stats.isDirectory()) {
        this.removeDirRecursive(itemPath)
      } else {
        unlinkSync(itemPath)
      }
    }
    unlinkSync(this.getTrashMetadataPath(id))
  }

  emptyTrash(): void {
    const trashRoot = this.getTrashRootPath()
    if (existsSync(trashRoot)) {
      this.removeDirRecursive(trashRoot)
    }
  }

  getTrashPath(): string {
    this.ensureTrashDirectories()
    return this.getTrashRootPath()
  }

  /**
   * Start (or restart) the chokidar watcher. Any external filesystem
   * change (Finder rename, git checkout, another editor) invalidates the
   * cached tree and triggers a debounced rebuild + broadcast. Internal
   * mutations use `invalidateTree('mutation')` directly so the callsite
   * can attribute the change.
   */
  private startWatching(): void {
    if (this.watcher) {
      this.watcher.close().catch(() => { /* best-effort */ })
      this.watcher = null
    }
    this.treeCache = null

    this.watcher = chokidar.watch(this.workspacePath, {
      ignoreInitial: true,
      // Match the filters buildFileTree already applies so events don't
      // trigger rebuilds for hidden files or bundled deps.
      ignored: (targetPath: string): boolean => {
        const name = basename(targetPath)
        return name.startsWith('.') || name === 'node_modules'
      },
      // Coarse-grained polling would kill CPU on big workspaces — stick to
      // native events. `awaitWriteFinish` waits for a file to stop growing
      // before firing 'add', avoiding half-copied downloads.
      awaitWriteFinish: {
        stabilityThreshold: 100,
        pollInterval: 50
      }
    })

    const onEvent = (): void => this.invalidateTree('snapshot')
    this.watcher.on('add', onEvent)
    this.watcher.on('addDir', onEvent)
    this.watcher.on('unlink', onEvent)
    this.watcher.on('unlinkDir', onEvent)
    // Deliberately not listening to 'change' — file content edits don't
    // affect the tree structure or file badges, so a rebuild would be
    // wasted work. `updatedAt` in the tree is stale until the next
    // structural change; UI that cares about mtime uses FILE_READ_META.
  }

  /**
   * Invalidate the cache, debounce a rebuild, and notify listeners once.
   * Debouncing coalesces bursts of chokidar events (e.g. `git checkout`
   * touching hundreds of files at once) into a single tree rebuild.
   */
  private invalidateTree(reason: TreeChangeReason): void {
    this.treeCache = null
    if (this.rebuildTimer) clearTimeout(this.rebuildTimer)
    this.rebuildTimer = setTimeout(() => {
      this.rebuildTimer = null
      const tree = this.buildFileTree()
      for (const listener of this.treeListeners) {
        try {
          listener(tree, reason)
        } catch (err) {
          console.warn('[FileSystemManager] tree listener threw:', err)
        }
      }
    }, 120)
  }

  /** Subscribe to tree changes. Returns a disposer. */
  onTreeChanged(listener: (tree: NoteFile[], reason: TreeChangeReason) => void): () => void {
    this.treeListeners.push(listener)
    return () => {
      const idx = this.treeListeners.indexOf(listener)
      if (idx >= 0) this.treeListeners.splice(idx, 1)
    }
  }

  /** Close the watcher — call before process exit or when leaving a workspace. */
  async stopWatching(): Promise<void> {
    if (this.rebuildTimer) {
      clearTimeout(this.rebuildTimer)
      this.rebuildTimer = null
    }
    if (this.watcher) {
      const watcher = this.watcher
      this.watcher = null
      await watcher.close()
    }
  }

  getWorkspacePath(): string {
    return this.workspacePath
  }

  detectFormat(filePath: string): NoteFormat {
    return this.formatResolver(filePath)
  }

  resolvePath(relativePath: string): string {
    const workspaceAbs = pathResolve(this.workspacePath)
    const resolved = pathResolve(workspaceAbs, relativePath)

    // Reject lexical traversal ('../' etc.) before touching disk.
    const rel = relative(workspaceAbs, resolved)
    if (rel.startsWith('..') || pathResolve(workspaceAbs, rel) !== resolved) {
      throw new Error(`Path traversal detected: ${relativePath}`)
    }

    // Symlink guard: if the target exists, walk it through realpath and
    // require the final path to still live inside the workspace. This
    // stops a malicious plugin (or manually-planted symlink) from linking
    // a workspace file to /etc/passwd and then reading it via readFile.
    //
    // The workspace itself may itself be a symlink (e.g. the user set
    // ~/Notes as a symlink to iCloud) — so we compare *real* to *real*.
    if (existsSync(resolved)) {
      let workspaceReal: string
      try {
        workspaceReal = realpathSync(workspaceAbs)
      } catch {
        workspaceReal = workspaceAbs
      }
      const targetReal = realpathSync(resolved)
      const realRel = relative(workspaceReal, targetReal)
      if (realRel.startsWith('..') || pathResolve(workspaceReal, realRel) !== targetReal) {
        throw new Error(`Symlink escape detected: ${relativePath}`)
      }
    }

    return resolved
  }

  pathToId(relativePath: string): string {
    return Buffer.from(relativePath).toString('base64')
  }

  readFile(relativePath: string): string {
    const fullPath = this.resolvePath(relativePath)
    return readFileSync(fullPath, 'utf-8')
  }

  /**
   * Read a file along with its modification time. Callers can pass the mtime
   * back on a later write to detect that another writer (window, external
   * editor) has modified the file since we last read it.
   */
  readFileWithMeta(relativePath: string): { content: string; mtime: number } {
    const fullPath = this.resolvePath(relativePath)
    const content = readFileSync(fullPath, 'utf-8')
    const stats = lstatSync(fullPath)
    return { content, mtime: stats.mtime.getTime() }
  }

  writeFile(relativePath: string, content: string): void {
    const fullPath = this.resolvePath(relativePath)
    const dir = dirname(fullPath)
    if (!existsSync(dir)) {
      mkdirSync(dir, { recursive: true })
    }
    if (existsSync(fullPath) && readFileSync(fullPath, 'utf-8') !== content) {
      this.createHistorySnapshot(relativePath, 'save')
    }
    writeFileSync(fullPath, content, 'utf-8')
  }

  /**
   * Guarded write. If the file exists and `expectedMtime` is provided,
   * compare it to the current on-disk mtime. When they differ, refuse the
   * write and return the disk mtime so the caller can decide how to
   * reconcile — usually by prompting the user or reloading.
   *
   * Returns the new mtime on success. Ignores the check when the file
   * doesn't yet exist (first-time save) or `expectedMtime` is null.
   */
  writeFileGuarded(
    relativePath: string,
    content: string,
    expectedMtime: number | null
  ): { ok: true; mtime: number } | { ok: false; conflict: true; diskMtime: number } {
    const fullPath = this.resolvePath(relativePath)
    if (expectedMtime != null && existsSync(fullPath)) {
      const diskMtime = statSync(fullPath).mtime.getTime()
      // Allow a 1ms slack for filesystems with coarse mtime granularity.
      if (Math.abs(diskMtime - expectedMtime) > 1) {
        return { ok: false, conflict: true, diskMtime }
      }
    }
    const dir = dirname(fullPath)
    if (!existsSync(dir)) {
      mkdirSync(dir, { recursive: true })
    }
    if (existsSync(fullPath) && readFileSync(fullPath, 'utf-8') !== content) {
      this.createHistorySnapshot(relativePath, 'save')
    }
    writeFileSync(fullPath, content, 'utf-8')
    return { ok: true, mtime: statSync(fullPath).mtime.getTime() }
  }

  createFile(relativePath: string, content: string = ''): NoteFile {
    const fullPath = this.resolvePath(relativePath)
    const dir = dirname(fullPath)
    if (!existsSync(dir)) {
      mkdirSync(dir, { recursive: true })
    }
    if (!existsSync(fullPath)) {
      writeFileSync(fullPath, content, 'utf-8')
    }

    const stats = statSync(fullPath)
    this.invalidateTree('mutation')
    return {
      id: this.pathToId(relativePath),
      name: basename(fullPath),
      path: relativePath,
      type: 'file',
      format: this.detectFormat(fullPath),
      content,
      createdAt: stats.birthtime.getTime(),
      updatedAt: stats.mtime.getTime()
    }
  }

  createDirectory(relativePath: string): NoteFile {
    const fullPath = this.resolvePath(relativePath)
    mkdirSync(fullPath, { recursive: true })

    const stats = statSync(fullPath)
    this.invalidateTree('mutation')
    return {
      id: this.pathToId(relativePath),
      name: basename(fullPath),
      path: relativePath,
      type: 'directory',
      createdAt: stats.birthtime.getTime(),
      updatedAt: stats.mtime.getTime()
    }
  }

  delete(relativePath: string): void {
    this.assertUserManagedPath(relativePath)
    const fullPath = this.resolvePath(relativePath)
    const stats = statSync(fullPath)

    if (stats.isDirectory()) {
      this.snapshotDirectoryRecursive(relativePath, 'delete')
    } else {
      this.createHistorySnapshot(relativePath, 'delete')
    }

    this.ensureTrashDirectories()
    let id = this.createTrashId()
    let storageName = `${id}-${basename(fullPath)}`
    let trashPath = join(this.getTrashItemsRootPath(), storageName)
    while (existsSync(trashPath)) {
      id = this.createTrashId()
      storageName = `${id}-${basename(fullPath)}`
      trashPath = join(this.getTrashItemsRootPath(), storageName)
    }

    const entry: StoredTrashEntry = {
      id,
      storageName,
      name: basename(fullPath),
      originalPath: relativePath,
      type: stats.isDirectory() ? 'directory' : 'file',
      deletedAt: Date.now(),
      size: this.getPathSize(fullPath),
      format: stats.isDirectory() ? undefined : this.detectFormat(relativePath)
    }

    const metadataPath = this.getTrashMetadataPath(id)
    writeFileSync(metadataPath, JSON.stringify(entry), 'utf-8')
    try {
      renameSync(fullPath, trashPath)
    } catch (err) {
      try {
        unlinkSync(metadataPath)
      } catch {
        // best-effort rollback
      }
      throw err
    }
    this.invalidateTree('mutation')
  }

  private snapshotDirectoryRecursive(relativeDir: string, action: FileHistoryAction): void {
    const fullPath = this.resolvePath(relativeDir)
    const entries = readdirSync(fullPath, { withFileTypes: true })
    for (const entry of entries) {
      const childRelPath = join(relativeDir, entry.name)
      if (entry.isDirectory()) {
        this.snapshotDirectoryRecursive(childRelPath, action)
      } else {
        this.createHistorySnapshot(childRelPath, action)
      }
    }
  }

  private collectFilePathsRecursive(relativeDir: string): string[] {
    const fullPath = this.resolvePath(relativeDir)
    const paths: string[] = []
    for (const entry of readdirSync(fullPath, { withFileTypes: true })) {
      const childRelPath = join(relativeDir, entry.name)
      if (entry.isDirectory()) {
        paths.push(...this.collectFilePathsRecursive(childRelPath))
      } else {
        paths.push(childRelPath)
      }
    }
    return paths
  }

  private moveDirectoryHistory(oldDir: string, newDir: string, oldFilePaths: string[]): void {
    for (const oldFilePath of oldFilePaths) {
      const suffix = relative(oldDir, oldFilePath)
      this.moveHistory(oldFilePath, join(newDir, suffix))
    }
  }

  private removeDirRecursive(dirPath: string): void {
    const entries = readdirSync(dirPath, { withFileTypes: true })
    for (const entry of entries) {
      const fullPath = join(dirPath, entry.name)
      if (entry.isDirectory()) {
        this.removeDirRecursive(fullPath)
      } else {
        unlinkSync(fullPath)
      }
    }
    rmdirSync(dirPath)
  }

  rename(oldPath: string, newPath: string): void {
    const fullOld = this.resolvePath(oldPath)
    const fullNew = this.resolvePath(newPath)
    const stats = statSync(fullOld)
    const movedFiles = stats.isDirectory() ? this.collectFilePathsRecursive(oldPath) : []

    const dir = dirname(fullNew)
    if (!existsSync(dir)) {
      mkdirSync(dir, { recursive: true })
    }

    if (stats.isDirectory()) {
      this.snapshotDirectoryRecursive(oldPath, 'rename')
    } else {
      this.createHistorySnapshot(oldPath, 'rename')
    }
    renameSync(fullOld, fullNew)
    if (stats.isDirectory()) {
      this.moveDirectoryHistory(oldPath, newPath, movedFiles)
    } else {
      this.moveHistory(oldPath, newPath)
    }
    this.invalidateTree('mutation')
  }

  move(sourcePath: string, targetDir: string): void {
    const fullSource = this.resolvePath(sourcePath)
    const fileName = basename(fullSource)
    const fullTarget = this.resolvePath(join(targetDir, fileName))
    const stats = statSync(fullSource)
    const movedFiles = stats.isDirectory() ? this.collectFilePathsRecursive(sourcePath) : []
    const targetPath = join(targetDir, fileName)

    const dir = dirname(fullTarget)
    if (!existsSync(dir)) {
      mkdirSync(dir, { recursive: true })
    }

    if (stats.isDirectory()) {
      this.snapshotDirectoryRecursive(sourcePath, 'move')
    } else {
      this.createHistorySnapshot(sourcePath, 'move')
    }
    renameSync(fullSource, fullTarget)
    if (stats.isDirectory()) {
      this.moveDirectoryHistory(sourcePath, targetPath, movedFiles)
    } else {
      this.moveHistory(sourcePath, targetPath)
    }
    this.invalidateTree('mutation')
  }

  buildFileTree(): NoteFile[] {
    if (this.treeCache) return this.treeCache
    const tree = this.buildTree('')
    this.treeCache = tree
    return tree
  }

  private buildTree(relativeDir: string): NoteFile[] {
    const fullPath = relativeDir ? this.resolvePath(relativeDir) : this.workspacePath
    if (!existsSync(fullPath)) return []

    const entries = readdirSync(fullPath, { withFileTypes: true })
    const files: NoteFile[] = []

    for (const entry of entries) {
      // Filter dotfiles and node_modules
      if (entry.name.startsWith('.')) continue
      if (entry.name === 'node_modules') continue

      const entryRelPath = relativeDir ? join(relativeDir, entry.name) : entry.name
      const entryFullPath = join(fullPath, entry.name)
      const stats = statSync(entryFullPath)

      if (entry.isDirectory()) {
        const children = this.buildTree(entryRelPath)
        files.push({
          id: this.pathToId(entryRelPath),
          name: entry.name,
          path: entryRelPath,
          type: 'directory',
          children,
          createdAt: stats.birthtime.getTime(),
          updatedAt: stats.mtime.getTime()
        })
      } else {
        files.push({
          id: this.pathToId(entryRelPath),
          name: entry.name,
          path: entryRelPath,
          type: 'file',
          format: this.detectFormat(entry.name),
          createdAt: stats.birthtime.getTime(),
          updatedAt: stats.mtime.getTime()
        })
      }
    }

    // Sort: directories first, then alphabetical
    files.sort((a, b) => {
      if (a.type === 'directory' && b.type !== 'directory') return -1
      if (a.type !== 'directory' && b.type === 'directory') return 1
      return a.name.localeCompare(b.name)
    })

    return files
  }

  /**
   * Walk the workspace recursively and search file contents for `query`
   * (case-insensitive). Returns one entry per match, capped at
   * `maxResults`. Dotfiles, node_modules and binary files are skipped.
   */
  searchFiles(query: string, maxResults: number = 200): SearchResult[] {
    if (!query) return []
    const results: SearchResult[] = []
    const lowerQuery = query.toLowerCase()
    this.walkAndSearch('', lowerQuery, maxResults, results)
    return results
  }

  private walkAndSearch(
    relativeDir: string,
    lowerQuery: string,
    maxResults: number,
    results: SearchResult[]
  ): void {
    if (results.length >= maxResults) return
    const fullPath = relativeDir ? this.resolvePath(relativeDir) : this.workspacePath
    if (!existsSync(fullPath)) return

    const entries = readdirSync(fullPath, { withFileTypes: true })
    for (const entry of entries) {
      if (results.length >= maxResults) return
      // Reuse buildTree's filtering: skip dotfiles and node_modules
      if (entry.name.startsWith('.')) continue
      if (entry.name === 'node_modules') continue

      const entryRelPath = relativeDir ? join(relativeDir, entry.name) : entry.name
      const entryFullPath = join(fullPath, entry.name)

      if (entry.isDirectory()) {
        this.walkAndSearch(entryRelPath, lowerQuery, maxResults, results)
      } else {
        let content: string
        try {
          content = readFileSync(entryFullPath, 'utf-8')
        } catch {
          // Skip files that fail to read as text
          continue
        }
        // Skip binary files (null byte heuristic)
        if (content.includes('\0')) continue

        const lines = content.split('\n')
        for (let i = 0; i < lines.length; i++) {
          if (results.length >= maxResults) return
          const lineText = lines[i]
          const lowerLine = lineText.toLowerCase()
          let idx = lowerLine.indexOf(lowerQuery)
          while (idx !== -1) {
            if (results.length >= maxResults) return
            results.push({
              path: entryRelPath,
              name: entry.name,
              line: i + 1,
              lineText,
              matchStart: idx,
              matchEnd: idx + lowerQuery.length
            })
            idx = lowerLine.indexOf(lowerQuery, idx + 1)
          }
        }
      }
    }
  }

  exists(relativePath: string): boolean {
    try {
      return existsSync(this.resolvePath(relativePath))
    } catch {
      return false
    }
  }

  getStats(relativePath: string): { createdAt: number; updatedAt: number; size: number } {
    const fullPath = this.resolvePath(relativePath)
    const stats = statSync(fullPath)
    return {
      createdAt: stats.birthtime.getTime(),
      updatedAt: stats.mtime.getTime(),
      size: stats.size
    }
  }
}
