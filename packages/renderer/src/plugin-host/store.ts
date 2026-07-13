import { create } from 'zustand'
import type { PaiNotePlugin, PluginContext, PluginDocument } from '@plugin-sdk'

export interface PluginEntry {
  plugin: PaiNotePlugin
  ctx: PluginContext
  builtin: boolean
  status: 'loaded' | 'active' | 'inactive' | 'error'
}

interface PluginHostState {
  /** format -> entry */
  entries: Record<string, PluginEntry>
  /** 可用格式列表（供 UI 渲染） */
  formats: Array<{ format: string; displayName: string; builtin: boolean; status: string }>

  register: (entry: PluginEntry) => void
  setStatus: (format: string, status: PluginEntry['status']) => void
  remove: (format: string) => void
  rebuildFormats: () => void
}

export const usePluginHost = create<PluginHostState>((set, get) => ({
  entries: {},
  formats: [],

  register: (entry) => {
    const format = entry.plugin.manifest.format
    set((s) => ({ entries: { ...s.entries, [format]: entry } }))
    get().rebuildFormats()
  },

  setStatus: (format, status) => {
    set((s) => {
      const e = s.entries[format]
      if (!e) return s
      return { entries: { ...s.entries, [format]: { ...e, status } } }
    })
    get().rebuildFormats()
  },

  remove: (format) => {
    set((s) => {
      const next = { ...s.entries }
      delete next[format]
      return { entries: next }
    })
    get().rebuildFormats()
  },

  rebuildFormats: () => {
    const { entries } = get()
    const formats = Object.values(entries).map((e) => ({
      format: e.plugin.manifest.format,
      displayName: e.plugin.manifest.displayName,
      builtin: e.builtin,
      status: e.status
    }))
    set({ formats })
  }
}))

/** 同步获取某格式的插件（非响应式） */
export function getPlugin(format: string): PaiNotePlugin | null {
  return usePluginHost.getState().entries[format]?.plugin ?? null
}

/** 获取插件上下文 */
export function getPluginContext(format: string): PluginContext | null {
  return usePluginHost.getState().entries[format]?.ctx ?? null
}

/** 用插件的 deserialize 把存储原文转为内存文档 */
export function deserializeNote(format: string, raw: string): PluginDocument | null {
  const plugin = getPlugin(format)
  if (!plugin) return null
  if (!raw) return plugin.createEmpty ? plugin.createEmpty() : plugin.deserialize('')
  return plugin.deserialize(raw)
}

/** 用插件的 serialize 把内存文档转为存储原文 */
export function serializeNote(format: string, doc: PluginDocument): string {
  const plugin = getPlugin(format)
  if (!plugin) return ''
  return plugin.serialize(doc)
}
