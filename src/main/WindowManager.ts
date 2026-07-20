import { BrowserWindow, screen, type BrowserWindowConstructorOptions } from 'electron'
import { join, resolve } from 'path'
import { existsSync } from 'fs'
import AutoLaunch from 'auto-launch'
import {
  NOTE_WINDOW_DEFAULT_WIDTH,
  NOTE_WINDOW_DEFAULT_HEIGHT,
  MAIN_WINDOW_MIN_WIDTH,
  MAIN_WINDOW_MIN_HEIGHT
} from '@shared/constants'
import type { NoteFormat, NoteWindowState } from '@shared/types'

export interface ManagedWindow {
  window: BrowserWindow
  noteId: string
  notePath: string
  noteName: string
  format: NoteFormat
  isPinned: boolean
  opacity: number
  autoCollapse: boolean
  collapseTimer: NodeJS.Timeout | null
  isCollapsed: boolean
  originalBounds: { x: number; y: number; width: number; height: number }
  /** Handler currently bound to the window's move+resize events, if any. */
  edgeCollapseListener: (() => void) | null
}

export interface OpenNoteOptions {
  noteId: string
  notePath: string
  noteName: string
  format: NoteFormat
  isPinned?: boolean
  opacity?: number
  autoCollapse?: boolean
}

export class WindowManager {
  mainWindow: BrowserWindow | null = null
  noteWindows: Map<string, ManagedWindow> = new Map()
  autoLauncher: AutoLaunch

  private isDev: boolean
  private expandCheckTimers: Map<string, NodeJS.Timeout> = new Map()

  constructor(isDev: boolean) {
    this.isDev = isDev
    this.autoLauncher = new AutoLaunch({
      name: 'Flux',
      isHidden: false
    })
  }

  /** Resolves the app icon PNG for window decoration (Windows/Linux) and
   *  macOS dev-mode Dock. Returns undefined if the file doesn't exist yet. */
  resolveIconPath(): string | undefined {
    // Dev: __dirname is out/main/ — step up two levels to project root
    const devPath  = resolve(__dirname, '../../build/icon.png')
    // Prod: electron-builder copies extraResources; icon.png lands in Resources/
    const prodPath = resolve(process.resourcesPath ?? '', 'icon.png')
    if (existsSync(devPath))  return devPath
    if (existsSync(prodPath)) return prodPath
    return undefined
  }

  createMainWindow(): BrowserWindow {
    const mainWindow = new BrowserWindow({
      width: 1200,
      height: 800,
      minWidth: MAIN_WINDOW_MIN_WIDTH,
      minHeight: MAIN_WINDOW_MIN_HEIGHT,
      titleBarStyle: 'hidden',
      trafficLightPosition: { x: 12, y: 12 },
      show: false,
      autoHideMenuBar: true,
      ...(this.resolveIconPath() ? { icon: this.resolveIconPath() } : {}),
      webPreferences: {
        preload: join(__dirname, '../preload/index.js'),
        // Security posture: sandbox the renderer, isolate contexts, and
        // disable node integration. The preload only touches contextBridge
        // and ipcRenderer, both of which survive the sandbox.
        sandbox: true,
        contextIsolation: true,
        nodeIntegration: false,
        webSecurity: true
      }
    })

    mainWindow.on('ready-to-show', () => {
      mainWindow.show()
    })

    if (this.isDev && process.env['ELECTRON_RENDERER_URL']) {
      mainWindow.loadURL(process.env['ELECTRON_RENDERER_URL'])
      mainWindow.webContents.openDevTools({ mode: 'right' })
    } else {
      mainWindow.loadFile(join(__dirname, '../renderer/index.html'))
    }

    this.mainWindow = mainWindow
    return mainWindow
  }

  openNoteWindow(opts: OpenNoteOptions, opener?: BrowserWindow): BrowserWindow {
    const {
      noteId,
      notePath,
      noteName,
      format,
      isPinned = false,
      opacity = 1.0,
      autoCollapse = false
    } = opts

    const existing = this.noteWindows.get(noteId)
    if (existing && !existing.window.isDestroyed()) {
      if (isPinned) {
        this.pinNote(noteId, opacity)
      }
      if (autoCollapse) {
        this.setAutoCollapse(noteId, true)
      }
      if (opener && this.isWindowFullScreen(opener)) {
        this.restoreCompactWindow(existing.window)
        this.attachToFullScreenOpener(existing.window, opener, existing.isPinned)
      }
      existing.window.show()
      existing.window.focus()
      return existing.window
    }

    const windowOptions: BrowserWindowConstructorOptions = {
      width: NOTE_WINDOW_DEFAULT_WIDTH,
      height: NOTE_WINDOW_DEFAULT_HEIGHT,
      center: true,
      frame: false,
      show: false,
      fullscreen: false,
      fullscreenable: true,
      minimizable: true,
      maximizable: true,
      resizable: true,
      transparent: isPinned,
      alwaysOnTop: isPinned,
      opacity: opacity,
      webPreferences: {
        preload: join(__dirname, '../preload/index.js'),
        // Security posture: sandbox the renderer, isolate contexts, and
        // disable node integration. The preload only touches contextBridge
        // and ipcRenderer, both of which survive the sandbox.
        sandbox: true,
        contextIsolation: true,
        nodeIntegration: false,
        webSecurity: true
      }
    }

    const win = new BrowserWindow(windowOptions)

    if (isPinned) {
      this.setPinnedWindowVisibility(win, true)
    } else if (opener && this.isWindowFullScreen(opener)) {
      this.attachToFullScreenOpener(win, opener, false)
    }

    const managed: ManagedWindow = {
      window: win,
      noteId,
      notePath,
      noteName,
      format,
      isPinned,
      opacity,
      autoCollapse,
      collapseTimer: null,
      isCollapsed: false,
      originalBounds: win.getBounds(),
      edgeCollapseListener: null
    }

    win.on('ready-to-show', () => {
      win.show()
      win.webContents.send('note:loaded', {
        noteId,
        notePath,
        noteName,
        format,
        isPinned,
        opacity
      })
    })

    win.on('blur', () => {
      if (managed.isPinned) {
        // Keep pinned windows on top even when not focused
        win.setAlwaysOnTop(true, 'screen-saver')
      }
    })

    win.on('focus', () => {
      if (managed.isPinned) {
        win.setAlwaysOnTop(true, 'floating')
      }
    })

    win.on('closed', () => {
      this.cleanupNoteWindow(managed)
      if (this.noteWindows.get(noteId)?.window === win) {
        this.noteWindows.delete(noteId)
      }
    })

    // Load note.html
    if (this.isDev && process.env['ELECTRON_RENDERER_URL']) {
      win.loadURL(process.env['ELECTRON_RENDERER_URL'] + '/note.html')
    } else {
      win.loadFile(join(__dirname, '../renderer/note.html'))
    }

    this.noteWindows.set(noteId, managed)

    // Set up auto-collapse if requested
    if (autoCollapse) {
      this.setupAutoCollapse(managed)
    }

    return win
  }

  private isWindowFullScreen(win: BrowserWindow): boolean {
    return win.isFullScreen() || (process.platform === 'darwin' && win.isSimpleFullScreen())
  }

  /** Restore a previously maximized/fullscreen note before presenting it from
   *  a fullscreen main window. Already-compact windows retain their bounds. */
  private restoreCompactWindow(win: BrowserWindow): void {
    const applyDefaultBounds = (): void => {
      if (win.isDestroyed()) return
      if (win.isMaximized()) win.unmaximize()
      win.setSize(NOTE_WINDOW_DEFAULT_WIDTH, NOTE_WINDOW_DEFAULT_HEIGHT)
      win.center()
    }

    if (win.isFullScreen()) {
      win.once('leave-full-screen', applyDefaultBounds)
      win.setFullScreen(false)
      return
    }
    if (process.platform === 'darwin' && win.isSimpleFullScreen()) {
      win.setSimpleFullScreen(false)
      applyDefaultBounds()
      return
    }
    if (win.isMaximized()) applyDefaultBounds()
  }

  /** A non-pinned child window stays visible above a macOS fullscreen Space.
   *  Once the opener leaves fullscreen it becomes an independent window again. */
  private attachToFullScreenOpener(
    noteWindow: BrowserWindow,
    opener: BrowserWindow,
    isPinned: boolean
  ): void {
    if (process.platform !== 'darwin' || isPinned || opener.isDestroyed()) return
    if (noteWindow.getParentWindow() === opener) return

    noteWindow.setParentWindow(opener)
    const detach = (): void => {
      if (!noteWindow.isDestroyed() && noteWindow.getParentWindow() === opener) {
        noteWindow.setParentWindow(null)
      }
    }
    opener.once('leave-full-screen', detach)
    noteWindow.once('closed', () => opener.removeListener('leave-full-screen', detach))
  }

  /** Keep pinned notes above every macOS virtual desktop, including native
   *  fullscreen Spaces. Other platforms retain their existing behavior. */
  private setPinnedWindowVisibility(win: BrowserWindow, isPinned: boolean): void {
    win.setAlwaysOnTop(isPinned, isPinned ? 'screen-saver' : 'normal')
    if (process.platform === 'darwin') {
      win.setVisibleOnAllWorkspaces(
        isPinned,
        isPinned ? { visibleOnFullScreen: true } : undefined
      )
    }
  }

  pinNote(noteId: string, opacity: number = 1.0): void {
    const managed = this.noteWindows.get(noteId)
    if (!managed) return

    managed.isPinned = true
    managed.opacity = opacity
    this.setPinnedWindowVisibility(managed.window, true)
    managed.window.setOpacity(opacity)
  }

  unpinNote(noteId: string): void {
    const managed = this.noteWindows.get(noteId)
    if (!managed) return

    managed.isPinned = false
    this.setPinnedWindowVisibility(managed.window, false)
    managed.window.setOpacity(1.0)
  }

  togglePin(noteId: string): boolean {
    const managed = this.noteWindows.get(noteId)
    if (!managed) return false

    if (managed.isPinned) {
      this.unpinNote(noteId)
      return false
    } else {
      this.pinNote(noteId)
      return true
    }
  }

  setOpacity(noteId: string, opacity: number): void {
    const managed = this.noteWindows.get(noteId)
    if (!managed) return

    managed.opacity = opacity
    managed.window.setOpacity(opacity)
  }

  setAutoCollapse(noteId: string, enabled: boolean): void {
    const managed = this.noteWindows.get(noteId)
    if (!managed) return

    managed.autoCollapse = enabled

    if (enabled) {
      this.setupAutoCollapse(managed)
    } else {
      // Clear collapse timer
      if (managed.collapseTimer) {
        clearTimeout(managed.collapseTimer)
        managed.collapseTimer = null
      }
      // Clear expand check timer
      this.stopExpandCheck(noteId)
      // Detach move/resize listeners so re-enabling won't double-register
      this.teardownAutoCollapse(managed)
      // Expand if currently collapsed
      if (managed.isCollapsed) {
        this.expandWindow(managed)
      }
    }
  }

  private setupAutoCollapse(managed: ManagedWindow): void {
    // Idempotent: bail if a listener is already bound so toggling auto-
    // collapse repeatedly can't stack up 'move'/'resize' handlers.
    if (managed.edgeCollapseListener) return
    const listener = (): void => this.checkEdgeCollapse(managed)
    managed.edgeCollapseListener = listener
    managed.window.on('move', listener)
    managed.window.on('resize', listener)
  }

  private teardownAutoCollapse(managed: ManagedWindow): void {
    const listener = managed.edgeCollapseListener
    if (!listener) return
    managed.window.removeListener('move', listener)
    managed.window.removeListener('resize', listener)
    managed.edgeCollapseListener = null
  }

  private checkEdgeCollapse(managed: ManagedWindow): void {
    if (!managed.autoCollapse) return

    const bounds = managed.window.getBounds()
    const display = screen.getDisplayNearestPoint({ x: bounds.x, y: bounds.y })
    const workArea = display.workArea

    const atLeftEdge = bounds.x <= workArea.x
    const atRightEdge = bounds.x + bounds.width >= workArea.x + workArea.width
    const atTopEdge = bounds.y <= workArea.y
    const atEdge = atLeftEdge || atRightEdge || atTopEdge

    if (atEdge && !managed.isCollapsed) {
      if (!managed.collapseTimer) {
        managed.collapseTimer = setTimeout(() => {
          this.collapseWindow(managed)
        }, 1500)
      }
    } else {
      if (managed.collapseTimer) {
        clearTimeout(managed.collapseTimer)
        managed.collapseTimer = null
      }
    }
  }

  collapseWindow(managed: ManagedWindow): void {
    if (managed.isCollapsed) return

    managed.originalBounds = managed.window.getBounds()
    const bounds = managed.window.getBounds()
    const display = screen.getDisplayNearestPoint({ x: bounds.x, y: bounds.y })
    const workArea = display.workArea

    // Collapse to 6px bar at nearest edge
    let newBounds: Electron.Rectangle
    if (bounds.x <= workArea.x) {
      // Left edge
      newBounds = { x: workArea.x, y: bounds.y, width: 6, height: bounds.height }
    } else if (bounds.x + bounds.width >= workArea.x + workArea.width) {
      // Right edge
      newBounds = {
        x: workArea.x + workArea.width - 6,
        y: bounds.y,
        width: 6,
        height: bounds.height
      }
    } else if (bounds.y <= workArea.y) {
      // Top edge
      newBounds = { x: bounds.x, y: workArea.y, width: bounds.width, height: 6 }
    } else {
      return
    }

    managed.window.setBounds(newBounds)
    managed.isCollapsed = true
    managed.collapseTimer = null

    // Start checking for mouse-enter to expand
    this.startExpandCheck(managed)
  }

  expandWindow(managed: ManagedWindow): void {
    if (!managed.isCollapsed) return

    managed.window.setBounds(managed.originalBounds)
    managed.isCollapsed = false

    // Stop expand check
    this.stopExpandCheck(managed.noteId)
  }

  private startExpandCheck(managed: ManagedWindow): void {
    const check = (): void => {
      if (!managed.isCollapsed) return

      const cursor = screen.getCursorScreenPoint()
      const bounds = managed.window.getBounds()

      // Check if cursor is near the collapsed bar (within 10px)
      const near =
        cursor.x >= bounds.x - 10 &&
        cursor.x <= bounds.x + bounds.width + 10 &&
        cursor.y >= bounds.y - 10 &&
        cursor.y <= bounds.y + bounds.height + 10

      if (near) {
        this.expandWindow(managed)
      } else {
        this.expandCheckTimers.set(
          managed.noteId,
          setTimeout(check, 200)
        )
      }
    }

    check()
  }

  private stopExpandCheck(noteId: string): void {
    const timer = this.expandCheckTimers.get(noteId)
    if (timer) {
      clearTimeout(timer)
      this.expandCheckTimers.delete(noteId)
    }
  }

  getNoteWindows(): NoteWindowState[] {
    const states: NoteWindowState[] = []
    for (const [noteId, managed] of this.noteWindows) {
      const bounds = managed.window.getBounds()
      states.push({
        noteId,
        notePath: managed.notePath,
        noteName: managed.noteName,
        format: managed.format,
        isPinned: managed.isPinned,
        opacity: managed.opacity,
        bounds
      })
    }
    return states
  }

  closeNoteWindow(noteId: string): void {
    const managed = this.noteWindows.get(noteId)
    if (!managed) return

    if (managed.window.isDestroyed()) {
      this.cleanupNoteWindow(managed)
      this.noteWindows.delete(noteId)
      return
    }
    managed.window.close()
  }

  closeAllNoteWindows(): void {
    for (const managed of this.noteWindows.values()) {
      if (!managed.window.isDestroyed()) {
        managed.window.close()
      }
    }
  }

  private cleanupNoteWindow(managed: ManagedWindow): void {
    if (managed.collapseTimer) {
      clearTimeout(managed.collapseTimer)
      managed.collapseTimer = null
    }
    this.stopExpandCheck(managed.noteId)
    this.teardownAutoCollapse(managed)
  }

  async setAutoLaunch(enabled: boolean): Promise<void> {
    if (enabled) {
      await this.autoLauncher.enable()
    } else {
      await this.autoLauncher.disable()
    }
  }

  async isAutoLaunchEnabled(): Promise<boolean> {
    return await this.autoLauncher.isEnabled()
  }
}
