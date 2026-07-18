import type {
  StorageFile,
  StorageProviderId,
  StorageSettings
} from '@shared/types'

export type StorageProviderConfig = StorageSettings[StorageProviderId]

export interface StorageProvider {
  name: string

  connect(config: unknown): Promise<void>

  list(path: string): Promise<StorageFile[]>

  read(path: string): Promise<Uint8Array>

  write(path: string, data: Uint8Array): Promise<void>

  delete(path: string): Promise<void>

  move?(from: string, to: string): Promise<void>

  exists?(path: string): Promise<boolean>
}

export class StorageProviderError extends Error {
  constructor(message: string, public readonly provider: string) {
    super(message)
    this.name = 'StorageProviderError'
  }
}
