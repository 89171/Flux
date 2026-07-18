import type { StorageProvider } from './StorageProvider'

export interface SyncNote {
  id: string
  markdown: string
  updatedAt?: number
  version?: string
}

export interface SyncIndex {
  version: number
  updatedAt: number
  notes: Array<{
    id: string
    path: string
    updatedAt: number
    version?: string
  }>
}

export class SyncManager {
  private encoder = new TextEncoder()
  private decoder = new TextDecoder()

  constructor(private provider: StorageProvider) {}

  async uploadNote(note: SyncNote): Promise<void> {
    const path = `notes/${note.id}.md`
    await this.provider.write(path, this.encodeMarkdown(note))
  }

  async downloadNote(noteId: string): Promise<string> {
    const data = await this.provider.read(`notes/${noteId}.md`)
    return this.decoder.decode(data)
  }

  async downloadIndex(): Promise<SyncIndex> {
    const data = await this.provider.read('index.json')
    return JSON.parse(this.decoder.decode(data)) as SyncIndex
  }

  async uploadIndex(index: SyncIndex): Promise<void> {
    await this.provider.write(
      'index.json',
      this.encoder.encode(JSON.stringify(index, null, 2))
    )
  }

  async noteExists(noteId: string): Promise<boolean> {
    const path = `notes/${noteId}.md`
    if (this.provider.exists) return this.provider.exists(path)
    try {
      await this.provider.read(path)
      return true
    } catch {
      return false
    }
  }

  private encodeMarkdown(note: SyncNote): Uint8Array {
    return this.encoder.encode(note.markdown)
  }
}
