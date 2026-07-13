import { contextBridge, ipcRenderer } from 'electron'
import { IPC } from '@shared'
import type { PaiNoteHostAPI } from '@shared'

/**
 * preload 桥接层：把主进程能力以 window.painote 暴露给渲染进程。
 * 通过 contextBridge 隔离，渲染进程无法直接访问 Node / Electron API。
 */

const api: PaiNoteHostAPI = {
  plugin: {
    list: () => ipcRenderer.invoke(IPC.PLUGIN_LIST),
    install: (sourceDir) => ipcRenderer.invoke(IPC.PLUGIN_INSTALL, sourceDir),
    uninstall: (id) => ipcRenderer.invoke(IPC.PLUGIN_UNINSTALL, id),
    activate: (id) => ipcRenderer.invoke(IPC.PLUGIN_ACTIVATE, id),
    deactivate: (id) => ipcRenderer.invoke(IPC.PLUGIN_DEACTIVATE, id)
  },
  note: {
    list: () => ipcRenderer.invoke(IPC.NOTE_LIST),
    create: (format, title) => ipcRenderer.invoke(IPC.NOTE_CREATE, format, title),
    get: (id) => ipcRenderer.invoke(IPC.NOTE_GET, id),
    save: (id, raw, title) => ipcRenderer.invoke(IPC.NOTE_SAVE, id, raw, title),
    delete: (id) => ipcRenderer.invoke(IPC.NOTE_DELETE, id),
    openInWindow: (id) => ipcRenderer.invoke(IPC.NOTE_OPEN_WINDOW, id)
  },
  ai: {
    generate: (prompt, opts) => ipcRenderer.invoke(IPC.AI_GENERATE, prompt, opts),
    chat: (messages) => ipcRenderer.invoke(IPC.AI_CHAT, messages),
    setConfig: (cfg) => ipcRenderer.invoke(IPC.AI_SET_CONFIG, cfg),
    getConfig: () => ipcRenderer.invoke(IPC.AI_GET_CONFIG)
  },
  window: {
    pin: () => ipcRenderer.invoke(IPC.WIN_PIN),
    unpin: () => ipcRenderer.invoke(IPC.WIN_UNPIN),
    setOpacity: (opacity) => ipcRenderer.invoke(IPC.WIN_OPACITY, opacity),
    setAutoStart: (enabled) => ipcRenderer.invoke(IPC.WIN_AUTOSTART, enabled),
    setAutoHide: (enabled) => ipcRenderer.invoke(IPC.WIN_SET_AUTOHIDE, enabled),
    getState: () => ipcRenderer.invoke(IPC.WIN_GET_STATE)
  },
  market: {
    list: () => ipcRenderer.invoke(IPC.MARKET_LIST),
    install: (id) => ipcRenderer.invoke(IPC.MARKET_INSTALL, id),
    installLocal: () => ipcRenderer.invoke(IPC.MARKET_INSTALL_LOCAL)
  },
  notify: (title, body) => {
    try {
      const N = (
        globalThis as unknown as {
          Notification?: new (t: string, o?: { body?: string }) => { show(): void }
        }
      ).Notification
      if (N) new N(title, { body }).show()
    } catch {
      // 通知不可用时静默
    }
  }
}

contextBridge.exposeInMainWorld('painote', api)
