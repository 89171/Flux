import type { Note, AIConfig, MarketplaceEntry, InstalledPluginRecord, WindowState } from './types'

/**
 * 渲染进程可用的宿主 API 类型定义。
 * preload 与 renderer 共用此类型，避免跨目录引用。
 */
export interface PaiNoteHostAPI {
  plugin: {
    list: () => Promise<
      Array<InstalledPluginRecord & { displayName: string; entryUrl: string | null }>
    >
    install: (sourceDir: string) => Promise<InstalledPluginRecord>
    uninstall: (id: string) => Promise<void>
    activate: (id: string) => Promise<void>
    deactivate: (id: string) => Promise<void>
  }
  note: {
    list: () => Promise<Note[]>
    create: (format: string, title?: string) => Promise<{ note: Note; raw: string }>
    get: (id: string) => Promise<{ note: Note; raw: string } | null>
    save: (id: string, raw: string, title?: string) => Promise<Note | null>
    delete: (id: string) => Promise<void>
    openInWindow: (id: string) => Promise<void>
  }
  ai: {
    generate: (prompt: string, opts?: { images?: string[]; files?: string[] }) => Promise<string>
    chat: (
      messages: Array<{ role: 'system' | 'user' | 'assistant'; content: string }>
    ) => Promise<string>
    setConfig: (cfg: AIConfig) => Promise<void>
    getConfig: () => Promise<AIConfig | null>
  }
  window: {
    pin: () => Promise<WindowState>
    unpin: () => Promise<WindowState>
    setOpacity: (opacity: number) => Promise<WindowState>
    setAutoStart: (enabled: boolean) => Promise<WindowState>
    setAutoHide: (enabled: boolean) => Promise<WindowState>
    getState: () => Promise<WindowState>
  }
  market: {
    list: () => Promise<MarketplaceEntry[]>
    install: (id: string) => Promise<InstalledPluginRecord>
    installLocal: () => Promise<InstalledPluginRecord | null>
  }
  notify: (title: string, body?: string) => void
}
