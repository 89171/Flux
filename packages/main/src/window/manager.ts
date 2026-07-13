import { BrowserWindow, shell } from 'electron'
import { join } from 'path'
import { getPinManager } from './pin'

/**
 * WindowManager — 管理窗口的创建与生命周期。
 *
 * 两种窗口模式：
 *  1. 主窗口（full app）：侧边栏 + 编辑器，完整应用体验
 *  2. 独立笔记窗口（note window）：通过 URL 参数 ?note=<id> 加载，
 *     渲染进程检测到该参数后进入单笔记模式，隐藏侧边栏，仅显示编辑器。
 *     支持独立置顶，实现多窗口同时 Pin 到桌面。
 */

class WindowManager {
  private mainWindow: BrowserWindow | null = null
  /** noteId -> BrowserWindow，避免重复打开同一笔记的独立窗口 */
  private noteWindows = new Map<string, BrowserWindow>()

  getMainWindow(): BrowserWindow | null {
    return this.mainWindow
  }

  /** 创建主窗口 */
  createMainWindow(): BrowserWindow {
    if (this.mainWindow && !this.mainWindow.isDestroyed()) {
      this.mainWindow.focus()
      return this.mainWindow
    }

    const win = new BrowserWindow({
      width: 1280,
      height: 832,
      minWidth: 900,
      minHeight: 600,
      show: false,
      autoHideMenuBar: true,
      title: 'PaiNote',
      backgroundColor: '#1e1e2e',
      webPreferences: {
        preload: join(__dirname, '../preload/index.js'),
        sandbox: false,
        contextIsolation: true,
        nodeIntegration: false
      }
    })

    win.on('ready-to-show', () => win.show())

    this.setupSmokeForwarding(win)
    this.setupExternalLinks(win)
    this.loadRenderer(win)
    this.handleClosed(win, () => {
      this.mainWindow = null
    })

    this.mainWindow = win
    return win
  }

  /**
   * 在独立窗口中打开指定笔记。
   * 如果该笔记已有独立窗口则聚焦它，否则创建新窗口。
   */
  openNoteWindow(noteId: string): void {
    const existing = this.noteWindows.get(noteId)
    if (existing && !existing.isDestroyed()) {
      existing.focus()
      return
    }

    const win = new BrowserWindow({
      width: 600,
      height: 500,
      minWidth: 360,
      minHeight: 300,
      show: false,
      autoHideMenuBar: true,
      title: 'PaiNote — Pinned Note',
      backgroundColor: '#1e1e2e',
      // 独立笔记窗口默认可以更轻量
      transparent: false,
      webPreferences: {
        preload: join(__dirname, '../preload/index.js'),
        sandbox: false,
        contextIsolation: true,
        nodeIntegration: false
      }
    })

    win.on('ready-to-show', () => win.show())

    this.setupSmokeForwarding(win)
    this.setupExternalLinks(win)
    this.loadRenderer(win, noteId)
    this.handleClosed(win, () => {
      this.noteWindows.delete(noteId)
    })

    this.noteWindows.set(noteId, win)
  }

  // ---------- 内部方法 ----------

  /** 加载渲染进程页面，可附带 noteId 参数 */
  private loadRenderer(win: BrowserWindow, noteId?: string): void {
    const rendererUrl = process.env['ELECTRON_RENDERER_URL']
    if (rendererUrl) {
      const url = noteId ? `${rendererUrl}?note=${noteId}` : rendererUrl
      void win.loadURL(url)
    } else {
      // 生产模式加载打包后的 HTML 文件
      void win.loadFile(join(__dirname, '../renderer/index.html'), {
        query: noteId ? { note: noteId } : undefined
      })
    }
  }

  /** 冒烟测试模式：转发渲染进程 console 到主进程 stdout */
  private setupSmokeForwarding(win: BrowserWindow): void {
    if (!process.env.PAINOTE_SMOKE) return
    win.webContents.on('console-message', (_e, level, message, line, sourceId) => {
      console.log(`[renderer:${level}] ${message} (${sourceId}:${line})`)
    })
    win.webContents.on('did-fail-load', (_e, code, desc) => {
      console.log(`[did-fail-load] ${code} ${desc}`)
    })
    win.webContents.on('render-process-gone', (_e, details) => {
      console.log(`[render-process-gone] ${details.reason}`)
    })
  }

  /** 外部链接用系统浏览器打开 */
  private setupExternalLinks(win: BrowserWindow): void {
    win.webContents.setWindowOpenHandler(({ url }) => {
      void shell.openExternal(url)
      return { action: 'deny' }
    })
  }

  /** 窗口关闭时的清理：PinManager 状态 + 回调 */
  private handleClosed(win: BrowserWindow, onClosed: () => void): void {
    win.on('closed', () => {
      getPinManager().cleanup(win)
      onClosed()
    })
  }
}

// 单例
let _instance: WindowManager | null = null

export function getWindowManager(): WindowManager {
  if (!_instance) _instance = new WindowManager()
  return _instance
}
