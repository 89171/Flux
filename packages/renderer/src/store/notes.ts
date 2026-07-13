import { create } from 'zustand'
import type { Note } from '@shared'
import type { PluginDocument } from '@plugin-sdk'
import { deserializeNote, serializeNote, getPlugin } from '../plugin-host/store'

interface NotesState {
  notes: Note[]
  currentId: string | null
  doc: PluginDocument | null
  saving: boolean
  /** 防抖保存计时器 */
  _saveTimer: ReturnType<typeof setTimeout> | null

  loadNotes: () => Promise<void>
  createNote: (format: string, title?: string) => Promise<void>
  selectNote: (id: string) => Promise<void>
  updateDoc: (doc: PluginDocument) => void
  saveCurrent: () => Promise<void>
  deleteNote: (id: string) => Promise<void>
  setTitle: (title: string) => void
}

const SAVE_DEBOUNCE_MS = 500

export const useNotes = create<NotesState>((set, get) => ({
  notes: [],
  currentId: null,
  doc: null,
  saving: false,
  _saveTimer: null,

  loadNotes: async () => {
    const notes = await window.painote.note.list()
    set({ notes })
  },

  createNote: async (format, title) => {
    const { note, raw } = await window.painote.note.create(format, title)
    const doc = deserializeNote(format, raw)
    set((s) => ({
      notes: [note, ...s.notes],
      currentId: note.id,
      doc
    }))
  },

  selectNote: async (id) => {
    // 切换前先把当前笔记落盘
    if (get()._saveTimer) {
      clearTimeout(get()._saveTimer!)
      set({ _saveTimer: null })
      await get().saveCurrent()
    }
    const res = await window.painote.note.get(id)
    if (!res) return
    const doc = deserializeNote(res.note.format, res.raw)
    set({ currentId: id, doc })
  },

  updateDoc: (doc) => {
    set({ doc })
    // 防抖保存
    const { _saveTimer } = get()
    if (_saveTimer) clearTimeout(_saveTimer)
    const timer = setTimeout(() => {
      set({ _saveTimer: null })
      void get().saveCurrent()
    }, SAVE_DEBOUNCE_MS)
    set({ _saveTimer: timer })
  },

  saveCurrent: async () => {
    const { currentId, doc } = get()
    if (!currentId || !doc) return
    const plugin = getPlugin(doc.format)
    if (!plugin) return
    set({ saving: true })
    const raw = serializeNote(doc.format, doc)
    const title = doc.meta?.title as string | undefined
    const updated = await window.painote.note.save(currentId, raw, title)
    set((s) => ({
      saving: false,
      notes: s.notes.map((n) => (n.id === currentId ? updated ?? n : n))
    }))
  },

  deleteNote: async (id) => {
    await window.painote.note.delete(id)
    set((s) => ({
      notes: s.notes.filter((n) => n.id !== id),
      currentId: s.currentId === id ? null : s.currentId,
      doc: s.currentId === id ? null : s.doc
    }))
  },

  setTitle: (title) => {
    const { doc } = get()
    if (!doc) return
    set({ doc: { ...doc, meta: { ...doc.meta, title } } })
    // 标题变化也走防抖保存
    const { _saveTimer } = get()
    if (_saveTimer) clearTimeout(_saveTimer)
    const timer = setTimeout(() => {
      set({ _saveTimer: null })
      void get().saveCurrent()
    }, SAVE_DEBOUNCE_MS)
    set({ _saveTimer: timer })
  }
}))
