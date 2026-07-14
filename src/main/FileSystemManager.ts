import { join, dirname, basename, relative, resolve as pathResolve } from 'path'
import {
  existsSync,
  readdirSync,
  readFileSync,
  writeFileSync,
  mkdirSync,
  statSync,
  unlinkSync,
  rmdirSync,
  renameSync,
  realpathSync
} from 'fs'
import chokidar, { type FSWatcher } from 'chokidar'
import type { NoteFile, NoteFormat } from '@shared/types'

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
    const stats = statSync(fullPath)
    return { content, mtime: stats.mtime.getTime() }
  }

  writeFile(relativePath: string, content: string): void {
    const fullPath = this.resolvePath(relativePath)
    const dir = dirname(fullPath)
    if (!existsSync(dir)) {
      mkdirSync(dir, { recursive: true })
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
    const fullPath = this.resolvePath(relativePath)
    const stats = statSync(fullPath)

    if (stats.isDirectory()) {
      this.removeDirRecursive(fullPath)
    } else {
      unlinkSync(fullPath)
    }
    this.invalidateTree('mutation')
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

    const dir = dirname(fullNew)
    if (!existsSync(dir)) {
      mkdirSync(dir, { recursive: true })
    }

    renameSync(fullOld, fullNew)
    this.invalidateTree('mutation')
  }

  move(sourcePath: string, targetDir: string): void {
    const fullSource = this.resolvePath(sourcePath)
    const fileName = basename(fullSource)
    const fullTarget = this.resolvePath(join(targetDir, fileName))

    const dir = dirname(fullTarget)
    if (!existsSync(dir)) {
      mkdirSync(dir, { recursive: true })
    }

    renameSync(fullSource, fullTarget)
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
