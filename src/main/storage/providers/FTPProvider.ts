import { basename, dirname, posix } from 'path'
import { Readable, Writable } from 'stream'
import { Client, FileType, type FileInfo } from 'basic-ftp'
import type { FTPStorageConfig, StorageFile } from '@shared/types'
import type { StorageProvider } from '../StorageProvider'

type FTPEntry = Pick<FileInfo, 'name' | 'type' | 'size' | 'modifiedAt'>

export class FTPProvider implements StorageProvider {
  name = 'ftp'
  private config: FTPStorageConfig | null = null

  async connect(config: unknown): Promise<void> {
    const parsed = config as Partial<FTPStorageConfig>
    if (!parsed.host) throw new Error('FTP host is required')
    this.config = {
      host: parsed.host,
      port: parsed.port || 21,
      username: parsed.username || 'anonymous',
      password: parsed.password || '',
      secure: !!parsed.secure,
      basePath: parsed.basePath || ''
    }
    await this.withClient(async (client) => {
      await client.pwd()
    })
  }

  async list(path: string): Promise<StorageFile[]> {
    return this.withClient(async (client) => {
      const remotePath = this.remotePath(path)
      const entries = await client.list(remotePath)
      return entries.map((entry) => this.toStorageFile(path, entry)).sort((a, b) => {
        if (a.type === 'directory' && b.type !== 'directory') return -1
        if (a.type !== 'directory' && b.type === 'directory') return 1
        return a.name.localeCompare(b.name)
      })
    })
  }

  async read(path: string): Promise<Uint8Array> {
    return this.withClient(async (client) => {
      const chunks: Buffer[] = []
      const sink = new Writable({
        write(chunk, _encoding, callback) {
          chunks.push(Buffer.from(chunk))
          callback()
        }
      })
      await client.downloadTo(sink, this.remotePath(path))
      return Buffer.concat(chunks)
    })
  }

  async write(path: string, data: Uint8Array): Promise<void> {
    await this.withClient(async (client) => {
      const remotePath = this.remotePath(path)
      await this.ensureParentDirectory(client, remotePath)
      await client.uploadFrom(Readable.from(Buffer.from(data)), remotePath)
    })
  }

  async delete(path: string): Promise<void> {
    if (!this.normalizeProviderPath(path)) throw new Error('Refusing to delete FTP root')
    await this.withClient(async (client) => {
      const remotePath = this.remotePath(path)
      const entry = await this.findEntry(client, remotePath)
      if (!entry) return
      if (entry.type === FileType.Directory) {
        await client.removeDir(remotePath)
      } else {
        await client.remove(remotePath, true)
      }
    })
  }

  async move(from: string, to: string): Promise<void> {
    await this.withClient(async (client) => {
      const source = this.remotePath(from)
      const target = this.remotePath(to)
      await this.ensureParentDirectory(client, target)
      await client.rename(source, target)
    })
  }

  async exists(path: string): Promise<boolean> {
    return this.withClient(async (client) => {
      return (await this.findEntry(client, this.remotePath(path))) != null
    })
  }

  private async withClient<T>(operation: (client: Client) => Promise<T>): Promise<T> {
    const cfg = this.requireConfig()
    const client = new Client()
    try {
      await client.access({
        host: cfg.host,
        port: cfg.port,
        user: cfg.username,
        password: cfg.password,
        secure: cfg.secure
      })
      return await operation(client)
    } finally {
      client.close()
    }
  }

  private async ensureParentDirectory(client: Client, remotePath: string): Promise<void> {
    const parent = dirname(remotePath)
    if (parent && parent !== '/') {
      await client.ensureDir(parent)
      await client.cd('/')
    }
  }

  private async findEntry(client: Client, remotePath: string): Promise<FTPEntry | null> {
    if (remotePath === '/') {
      return {
        name: '/',
        type: FileType.Directory,
        size: 0
      }
    }
    const parent = dirname(remotePath)
    const name = basename(remotePath)
    try {
      const entries = await client.list(parent === '.' ? '/' : parent)
      return entries.find((entry) => entry.name === name) ?? null
    } catch {
      return null
    }
  }

  private toStorageFile(parentPath: string, entry: FTPEntry): StorageFile {
    const parent = this.normalizeProviderPath(parentPath)
    const entryPath = parent ? `${parent}/${entry.name}` : entry.name
    return {
      name: entry.name,
      path: entryPath,
      type: entry.type === FileType.Directory ? 'directory' : 'file',
      size: entry.type === FileType.Directory ? 0 : entry.size,
      updatedAt: entry.modifiedAt?.getTime() ?? 0
    }
  }

  private remotePath(path: string): string {
    const cfg = this.requireConfig()
    const base = this.normalizeProviderPath(cfg.basePath)
    const providerPath = this.normalizeProviderPath(path)
    const joined = [base, providerPath].filter(Boolean).join('/')
    return joined ? `/${joined}` : '/'
  }

  private normalizeProviderPath(path: string): string {
    const clean = path.replace(/\\/g, '/').replace(/^\/+|\/+$/g, '')
    if (!clean) return ''
    const parts = clean.split('/').filter(Boolean)
    for (const part of parts) {
      if (part === '.' || part === '..') {
        throw new Error(`Invalid FTP path: ${path}`)
      }
    }
    return posix.join(...parts)
  }

  private requireConfig(): FTPStorageConfig {
    if (!this.config) throw new Error('FTPProvider is not connected')
    return this.config
  }
}
