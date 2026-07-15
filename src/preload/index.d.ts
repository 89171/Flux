import type { FluxAPI } from './index'

declare global {
  interface Window {
    flux: FluxAPI
  }
}

export {}
