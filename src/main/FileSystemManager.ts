import { join, dirname, basename, extname, relative } from 'path'
import {
  existsSync,
  readdirSync,
  readFileSync,
  writeFileSync,
  mkdirSync,
  statSync,
  unlinkSync,
  rmdirSync,
  renameSync
} from 'fs'
import type { NoteFile, NoteFormat } from '@shared/types'
import { EXTENSION_FORMAT_MAP } from '@shared/constants'

export class FileSystemManager {
  private workspacePath: string

  constructor(workspacePath: string) {
    this.workspacePath = workspacePath
    this.ensureWorkspace()
  }

  private ensureWorkspace(): void {
    if (!existsSync(this.workspacePath)) {
      mkdirSync(this.workspacePath, { recursive: true })
    }
  }

  setWorkspacePath(path: string): void {
    this.workspacePath = path
    this.ensureWorkspace()
  }

  getWorkspacePath(): string {
    return this.workspacePath
  }

  detectFormat(filePath: string): NoteFormat {
    const ext = extname(filePath).toLowerCase()
    return (EXTENSION_FORMAT_MAP[ext] as NoteFormat) || 'plaintext'
  }

  resolvePath(relativePath: string): string {
    const resolved = join(this.workspacePath, relativePath)

    // Prevent path traversal: the resolved path must be within the workspace
    const rel = relative(this.workspacePath, resolved)
    if (rel.startsWith('..')) {
      throw new Error(`Path traversal detected: ${relativePath}`)
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

  writeFile(relativePath: string, content: string): void {
    const fullPath = this.resolvePath(relativePath)
    const dir = dirname(fullPath)
    if (!existsSync(dir)) {
      mkdirSync(dir, { recursive: true })
    }
    writeFileSync(fullPath, content, 'utf-8')
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
  }

  buildFileTree(): NoteFile[] {
    return this.buildTree('')
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
