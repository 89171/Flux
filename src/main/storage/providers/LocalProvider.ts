import { dirname, basename, relative, resolve as pathResolve } from 'path'
import { promises as fs } from 'fs'
import type { LocalStorageConfig, StorageFile } from '@shared/types'
import type { StorageProvider } from '../StorageProvider'

export class LocalProvider implements StorageProvider {
  name = 'local'
  private rootPath = ''

  async connect(config: unknown): Promise<void> {
    const parsed = config as Partial<LocalStorageConfig>
    if (!parsed.rootPath) throw new Error('Local storage rootPath is required')
    this.rootPath = pathResolve(parsed.rootPath)
    await fs.mkdir(this.rootPath, { recursive: true })
  }

  async list(path: string): Promise<StorageFile[]> {
    const fullPath = this.resolveProviderPath(path)
    const entries = await fs.readdir(fullPath, { withFileTypes: true })
    const files: StorageFile[] = []

    for (const entry of entries) {
      const childProviderPath = this.joinProviderPath(path, entry.name)
      const childFullPath = this.resolveProviderPath(childProviderPath)
      const stats = await fs.stat(childFullPath)
      files.push({
        name: entry.name,
        path: childProviderPath,
        type: entry.isDirectory() ? 'directory' : 'file',
        size: entry.isDirectory() ? 0 : stats.size,
        updatedAt: stats.mtime.getTime()
      })
    }

    files.sort((a, b) => {
      if (a.type === 'directory' && b.type !== 'directory') return -1
      if (a.type !== 'directory' && b.type === 'directory') return 1
      return a.name.localeCompare(b.name)
    })
    return files
  }

  async read(path: string): Promise<Uint8Array> {
    return fs.readFile(this.resolveProviderPath(path))
  }

  async write(path: string, data: Uint8Array): Promise<void> {
    const fullPath = this.resolveProviderPath(path)
    await fs.mkdir(dirname(fullPath), { recursive: true })
    await fs.writeFile(fullPath, data)
  }

  async delete(path: string): Promise<void> {
    const fullPath = this.resolveProviderPath(path)
    await fs.rm(fullPath, { recursive: true, force: true })
  }

  async move(from: string, to: string): Promise<void> {
    const source = this.resolveProviderPath(from)
    const target = this.resolveProviderPath(to)
    await fs.mkdir(dirname(target), { recursive: true })
    await fs.rename(source, target)
  }

  async exists(path: string): Promise<boolean> {
    try {
      await fs.access(this.resolveProviderPath(path))
      return true
    } catch {
      return false
    }
  }

  private resolveProviderPath(providerPath: string): string {
    if (!this.rootPath) throw new Error('LocalProvider is not connected')

    const resolved = pathResolve(this.rootPath, providerPath || '.')
    const rel = relative(this.rootPath, resolved)
    if (rel.startsWith('..') || pathResolve(this.rootPath, rel) !== resolved) {
      throw new Error(`Path traversal detected: ${providerPath}`)
    }
    return resolved
  }

  private joinProviderPath(parent: string, name: string): string {
    const cleanedParent = parent.replace(/\\/g, '/').replace(/^\/+|\/+$/g, '')
    const safeName = basename(name)
    return cleanedParent ? `${cleanedParent}/${safeName}` : safeName
  }
}
