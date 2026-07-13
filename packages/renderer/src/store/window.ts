import { create } from 'zustand'
import type { WindowState } from '@shared'

interface WindowStoreState extends WindowState {
  loaded: boolean
  /** 设置面板展开 */
  panelOpen: boolean

  loadState: () => Promise<void>
  togglePin: () => Promise<void>
  setOpacity: (opacity: number) => Promise<void>
  toggleAutoStart: () => Promise<void>
  toggleAutoHide: () => Promise<void>
  setPanelOpen: (open: boolean) => void
}

export const useWindowStore = create<WindowStoreState>((set, get) => ({
  pinned: false,
  opacity: 1,
  autoStart: false,
  autoHide: false,
  collapsed: false,
  loaded: false,
  panelOpen: false,

  loadState: async () => {
    const state = await window.painote.window.getState()
    set({ ...state, loaded: true })
  },

  togglePin: async () => {
    const { pinned } = get()
    const state = pinned
      ? await window.painote.window.unpin()
      : await window.painote.window.pin()
    set(state)
  },

  setOpacity: async (opacity) => {
    const state = await window.painote.window.setOpacity(opacity)
    set(state)
  },

  toggleAutoStart: async () => {
    const { autoStart } = get()
    const state = await window.painote.window.setAutoStart(!autoStart)
    set(state)
  },

  toggleAutoHide: async () => {
    const { autoHide, pinned } = get()
    if (!pinned) return // 贴边收起仅在置顶时生效
    const state = await window.painote.window.setAutoHide(!autoHide)
    set(state)
  },

  setPanelOpen: (open) => set({ panelOpen: open })
}))
