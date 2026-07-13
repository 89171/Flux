import { ipcMain, BrowserWindow } from 'electron'
import { IPC } from '@shared'
import type { AIConfig } from '@shared'
import { getPluginManager } from '../plugin/manager'
import { getWindowManager } from '../window/manager'
import { getPinManager } from '../window/pin'
import { getAIProvider } from '../ai/provider'
import { getMarketplace } from '../marketplace/registry'
import { listNotes, createNote, getNote, saveNote, deleteNote } from '../store/notes'

/**
 * 注册所有 IPC 处理器。
 * 渲染进程通过 preload 暴露的 window.painote.* 调用，经 contextBridge 转发到这里。
 */
export function registerIpcHandlers(): void {
  const manager = getPluginManager()
  const pinManager = getPinManager()
  const windowManager = getWindowManager()
  const aiProvider = getAIProvider()
  const marketplace = getMarketplace()

  // ---------- 插件管理 ----------
  ipcMain.handle(IPC.PLUGIN_LIST, () => manager.list())

  ipcMain.handle(IPC.PLUGIN_INSTALL, (_e, sourceDir: string) => manager.install(sourceDir))

  ipcMain.handle(IPC.PLUGIN_UNINSTALL, (_e, id: string) => manager.uninstall(id))

  ipcMain.handle(IPC.PLUGIN_ACTIVATE, (_e, id: string) => manager.activate(id))

  ipcMain.handle(IPC.PLUGIN_DEACTIVATE, (_e, id: string) => manager.deactivate(id))

  // ---------- 笔记存储 ----------
  ipcMain.handle(IPC.NOTE_LIST, () => listNotes())

  ipcMain.handle(IPC.NOTE_CREATE, (_e, format: string, title?: string) =>
    createNote(format, title)
  )

  ipcMain.handle(IPC.NOTE_GET, (_e, id: string) => getNote(id))

  ipcMain.handle(IPC.NOTE_SAVE, (_e, id: string, raw: string, title?: string) =>
    saveNote(id, raw, title)
  )

  ipcMain.handle(IPC.NOTE_DELETE, (_e, id: string) => deleteNote(id))

  /** 在独立窗口中打开笔记（支持多窗口同时置顶） */
  ipcMain.handle(IPC.NOTE_OPEN_WINDOW, (_e, noteId: string) => {
    windowManager.openNoteWindow(noteId)
  })

  // ---------- AI 生成 ----------
  ipcMain.handle(IPC.AI_GENERATE, (_e, prompt: string, opts?: { images?: string[]; files?: string[] }) =>
    aiProvider.generate(prompt, opts)
  )

  ipcMain.handle(IPC.AI_CHAT, (_e, messages: Array<{ role: 'system' | 'user' | 'assistant'; content: string }>) =>
    aiProvider.chat(messages)
  )

  ipcMain.handle(IPC.AI_SET_CONFIG, (_e, cfg: AIConfig) => {
    aiProvider.setConfig(cfg)
  })

  ipcMain.handle(IPC.AI_GET_CONFIG, () => aiProvider.getConfig())

  // ---------- 窗口置顶 ----------
  // 通过 BrowserWindow.fromWebContents 获取调用方窗口，实现多窗口独立管理

  ipcMain.handle(IPC.WIN_PIN, (e) => {
    const win = BrowserWindow.fromWebContents(e.sender)
    if (!win) throw new Error('无法获取当前窗口')
    return pinManager.pin(win)
  })

  ipcMain.handle(IPC.WIN_UNPIN, (e) => {
    const win = BrowserWindow.fromWebContents(e.sender)
    if (!win) throw new Error('无法获取当前窗口')
    return pinManager.unpin(win)
  })

  ipcMain.handle(IPC.WIN_OPACITY, (e, opacity: number) => {
    const win = BrowserWindow.fromWebContents(e.sender)
    if (!win) throw new Error('无法获取当前窗口')
    return pinManager.setOpacity(win, opacity)
  })

  ipcMain.handle(IPC.WIN_AUTOSTART, (_e, enabled: boolean) => {
    return pinManager.setAutoStart(enabled)
  })

  ipcMain.handle(IPC.WIN_SET_AUTOHIDE, (e, enabled: boolean) => {
    const win = BrowserWindow.fromWebContents(e.sender)
    if (!win) throw new Error('无法获取当前窗口')
    return pinManager.setAutoHide(win, enabled)
  })

  ipcMain.handle(IPC.WIN_GET_STATE, (e) => {
    const win = BrowserWindow.fromWebContents(e.sender)
    if (!win) throw new Error('无法获取当前窗口')
    return pinManager.getState(win)
  })

  // ---------- 插件商城 ----------
  ipcMain.handle(IPC.MARKET_LIST, () => marketplace.list())

  ipcMain.handle(IPC.MARKET_INSTALL, (_e, id: string) => marketplace.install(id))

  ipcMain.handle(IPC.MARKET_INSTALL_LOCAL, () => marketplace.installLocal())
}
