import type { PaiNoteAPI } from './index'

declare global {
  interface Window {
    painote: PaiNoteAPI
  }
}

export {}
