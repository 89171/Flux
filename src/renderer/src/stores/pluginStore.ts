import { create } from 'zustand'
import type { FormatBinding, PluginInfo } from '@shared/types'

interface PluginState {
  plugins: PluginInfo[]
  /**
   * Extension (no leading dot, lowercase) → binding. Discriminated union:
   * `kind: 'builtin'` picks a built-in editor, `kind: 'plugin-editor'`
   * mounts an iframe at `entryUrl`.
   */
  formatMap: Record<string, FormatBinding>
  isLoading: boolean
  isInstalling: boolean
  installMessage: string | null
  loadPlugins: () => Promise<void>
  loadFormatMap: () => Promise<void>
  setFormatMap: (map: Record<string, FormatBinding>) => void
  activatePlugin: (id: string) => Promise<void>
  deactivatePlugin: (id: string) => Promise<void>
  setPluginEnabled: (id: string, enabled: boolean) => Promise<{ success: boolean; error?: string }>
  installPlugin: () => Promise<{ success: boolean; error?: string }>
  loadLocalPlugin: (path: string) => Promise<{ success: boolean; error?: string }>
  uninstallPlugin: (id: string) => Promise<{ success: boolean; error?: string }>
  openDevGuide: () => Promise<void>
}

export const usePluginStore = create<PluginState>((set) => ({
  plugins: [],
  formatMap: {},
  isLoading: false,
  isInstalling: false,
  installMessage: null,
  loadPlugins: async () => {
    set({ isLoading: true })
    try {
      const plugins = await window.painote.plugin.list()
      set({ plugins, isLoading: false })
    } catch (err) {
      console.error('Failed to load plugins:', err)
      set({ isLoading: false })
    }
  },
  loadFormatMap: async () => {
    try {
      const map = await window.painote.plugin.getFormatMap()
      set({ formatMap: map })
    } catch (err) {
      console.error('Failed to load format map:', err)
    }
  },
  setFormatMap: (map) => set({ formatMap: map }),
  activatePlugin: async (id) => {
    try {
      await window.painote.plugin.activate(id)
      const [plugins, formatMap] = await Promise.all([
        window.painote.plugin.list(),
        window.painote.plugin.getFormatMap()
      ])
      set({ plugins, formatMap })
    } catch (err) {
      console.error('Failed to activate plugin:', err)
    }
  },
  deactivatePlugin: async (id) => {
    try {
      await window.painote.plugin.deactivate(id)
      const [plugins, formatMap] = await Promise.all([
        window.painote.plugin.list(),
        window.painote.plugin.getFormatMap()
      ])
      set({ plugins, formatMap })
    } catch (err) {
      console.error('Failed to deactivate plugin:', err)
    }
  },
  setPluginEnabled: async (id, enabled) => {
    try {
      const result = await window.painote.plugin.setEnabled(id, enabled)
      // Refresh both lists — activation/deactivation changes plugin status
      // and format-map bindings; the market UI and file tree both consume
      // these, so we sync them together.
      const [plugins, formatMap] = await Promise.all([
        window.painote.plugin.list(),
        window.painote.plugin.getFormatMap()
      ])
      set({ plugins, formatMap })
      return result.success
        ? { success: true }
        : { success: false, error: result.error }
    } catch (err) {
      return { success: false, error: String(err) }
    }
  },
  installPlugin: async () => {
    set({ isInstalling: true, installMessage: null })
    try {
      const result = await window.painote.plugin.install()
      if (result.success) {
        const plugins = await window.painote.plugin.list()
        set({ plugins, isInstalling: false, installMessage: `Installed: ${result.plugin?.name}` })
        return { success: true }
      } else if (!result.canceled) {
        set({ isInstalling: false, installMessage: result.error })
        return { success: false, error: result.error }
      }
      set({ isInstalling: false })
      return { success: false, error: result.error }
    } catch (err) {
      set({ isInstalling: false, installMessage: String(err) })
      return { success: false, error: String(err) }
    }
  },
  loadLocalPlugin: async (path) => {
    set({ isInstalling: true, installMessage: null })
    try {
      const result = await window.painote.plugin.loadLocal(path)
      if (result.success) {
        const plugins = await window.painote.plugin.list()
        set({ plugins, isInstalling: false, installMessage: `Installed: ${result.plugin?.name}` })
        return { success: true }
      }
      set({ isInstalling: false, installMessage: result.error })
      return { success: false, error: result.error }
    } catch (err) {
      set({ isInstalling: false, installMessage: String(err) })
      return { success: false, error: String(err) }
    }
  },
  uninstallPlugin: async (id) => {
    try {
      const result = await window.painote.plugin.uninstall(id)
      if (result.success) {
        const plugins = await window.painote.plugin.list()
        set({ plugins })
        return { success: true }
      }
      return { success: false, error: result.error }
    } catch (err) {
      return { success: false, error: String(err) }
    }
  },
  openDevGuide: async () => {
    try {
      await window.painote.plugin.openDevGuide()
    } catch (err) {
      console.error('Failed to open dev guide:', err)
    }
  }
}))
