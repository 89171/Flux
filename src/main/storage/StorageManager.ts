import type { StorageFile, StorageProviderId, StorageSettings } from '@shared/types'
import { GitHubProvider } from './providers/GitHubProvider'
import { LocalProvider } from './providers/LocalProvider'
import { WebDAVProvider } from './providers/WebDAVProvider'
import { FTPProvider } from './providers/FTPProvider'
import { S3Provider } from './providers/S3Provider'
import type { StorageProvider } from './StorageProvider'

export class StorageManager {
  private settings: StorageSettings
  private provider: StorageProvider
  private connected = false
  private configureListeners: Array<() => void> = []

  constructor(settings: StorageSettings) {
    this.settings = settings
    this.provider = this.createProvider(settings.provider)
  }

  configure(settings: StorageSettings): void {
    this.settings = settings
    this.provider = this.createProvider(settings.provider)
    this.connected = false
    for (const listener of this.configureListeners) {
      try {
        listener()
      } catch (err) {
        console.warn('[StorageManager] configure listener threw:', err)
      }
    }
  }

  getProviderName(): string {
    return this.provider.name
  }

  getSettings(): StorageSettings {
    return this.settings
  }

  getProvider(): StorageProvider {
    return this.provider
  }

  onConfigure(listener: () => void): () => void {
    this.configureListeners.push(listener)
    return () => {
      const idx = this.configureListeners.indexOf(listener)
      if (idx >= 0) this.configureListeners.splice(idx, 1)
    }
  }

  async connect(): Promise<void> {
    if (this.connected) return
    await this.provider.connect(this.settings[this.settings.provider])
    this.connected = true
  }

  async list(path: string): Promise<StorageFile[]> {
    await this.connect()
    return this.provider.list(path)
  }

  async read(path: string): Promise<Uint8Array> {
    await this.connect()
    return this.provider.read(path)
  }

  async write(path: string, data: Uint8Array): Promise<void> {
    await this.connect()
    return this.provider.write(path, data)
  }

  async delete(path: string): Promise<void> {
    await this.connect()
    return this.provider.delete(path)
  }

  async move(from: string, to: string): Promise<void> {
    await this.connect()
    if (this.provider.move) {
      await this.provider.move(from, to)
      return
    }
    const data = await this.provider.read(from)
    await this.provider.write(to, data)
    await this.provider.delete(from)
  }

  async exists(path: string): Promise<boolean> {
    await this.connect()
    if (this.provider.exists) return this.provider.exists(path)
    try {
      await this.provider.read(path)
      return true
    } catch {
      return false
    }
  }

  private createProvider(providerId: StorageProviderId): StorageProvider {
    switch (providerId) {
      case 'local':
        return new LocalProvider()
      case 'github':
        return new GitHubProvider()
      case 'webdav':
        return new WebDAVProvider()
      case 'ftp':
        return new FTPProvider()
      case 's3':
        return new S3Provider()
      default: {
        const exhaustive: never = providerId
        throw new Error(`Unsupported storage provider: ${exhaustive}`)
      }
    }
  }
}

export async function testStorageSettings(
  settings: StorageSettings
): Promise<{ success: boolean; provider: StorageProviderId; error?: string }> {
  const manager = new StorageManager(settings)
  try {
    await manager.connect()
    if (settings.provider === 'local') {
      await manager.list('')
    }
    return { success: true, provider: settings.provider }
  } catch (err) {
    return {
      success: false,
      provider: settings.provider,
      error: err instanceof Error ? err.message : String(err)
    }
  }
}
