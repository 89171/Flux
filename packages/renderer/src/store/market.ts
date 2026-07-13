import { create } from 'zustand'
import type { MarketplaceEntry } from '@shared'

interface MarketStoreState {
  entries: MarketplaceEntry[]
  loading: boolean
  error: string | null
  /** 正在安装的插件 id 集合 */
  installing: Set<string>
  showMarket: boolean

  loadEntries: () => Promise<void>
  install: (id: string) => Promise<boolean>
  installLocal: () => Promise<boolean>
  uninstall: (id: string) => Promise<boolean>
  setShowMarket: (show: boolean) => void
  /** 判断插件是否已安装 */
  isInstalled: (id: string, installed: Array<{ id: string; builtin: boolean }>) => boolean
}

export const useMarketStore = create<MarketStoreState>((set, get) => ({
  entries: [],
  loading: false,
  error: null,
  installing: new Set(),
  showMarket: false,

  loadEntries: async () => {
    set({ loading: true, error: null })
    try {
      const entries = await window.painote.market.list()
      set({ entries, loading: false })
    } catch (e) {
      set({ error: (e as Error).message, loading: false })
    }
  },

  install: async (id) => {
    set((s) => ({ installing: new Set([...s.installing, id]), error: null }))
    try {
      await window.painote.market.install(id)
      set((s) => {
        const next = new Set(s.installing)
        next.delete(id)
        return { installing: next }
      })
      return true
    } catch (e) {
      set((s) => {
        const next = new Set(s.installing)
        next.delete(id)
        return { installing: next, error: (e as Error).message }
      })
      return false
    }
  },

  installLocal: async () => {
    set({ error: null })
    try {
      const result = await window.painote.market.installLocal()
      if (result) {
        return true
      }
      return false
    } catch (e) {
      set({ error: (e as Error).message })
      return false
    }
  },

  uninstall: async (id) => {
    set({ error: null })
    try {
      await window.painote.plugin.uninstall(id)
      return true
    } catch (e) {
      set({ error: (e as Error).message })
      return false
    }
  },

  setShowMarket: (show) => set({ showMarket: show }),

  isInstalled: (id, installed) => {
    return installed.some((p) => p.id === id)
  }
}))
