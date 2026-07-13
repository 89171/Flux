import type { PaiNoteHostAPI } from '@shared'

declare global {
  interface Window {
    painote: PaiNoteHostAPI
  }
}

export {}
