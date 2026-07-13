import { app, BrowserWindow } from 'electron'
import { join } from 'path'
import { electronApp, optimizer, is } from '@electron-toolkit/utils'
import { FileSystemManager } from './FileSystemManager'
import { PluginManager } from './PluginManager'
import { PluginInstaller } from './PluginInstaller'
import { WindowManager } from './WindowManager'
import { AIService } from './AIService'
import { registerIPC } from './ipc'
import { getSettings } from './SettingsStore'

let windowManager: WindowManager
let pluginManager: PluginManager
let pluginInstaller: PluginInstaller
let fsManager: FileSystemManager
let aiService: AIService

let pendingOpenFile: string | null = null

async function bootstrap(): Promise<void> {
  const settings = getSettings()

  // Create FileSystemManager
  fsManager = new FileSystemManager(settings.workspacePath)

  // Create PluginManager
  pluginManager = new PluginManager()
  pluginManager.setWorkspacePath(settings.workspacePath)

  // Create PluginInstaller
  pluginInstaller = new PluginInstaller(pluginManager)

  // Create WindowManager
  windowManager = new WindowManager(is.dev)

  // Create AIService
  aiService = new AIService(pluginManager)

  // Configure AI with saved settings
  aiService.configure(settings.ai)

  // Register all IPC handlers
  registerIPC(windowManager, pluginManager, pluginInstaller, fsManager, aiService)

  // Discover plugins from builtin and user directories
  console.log('[Bootstrap] Discovering plugins...')
  pluginManager.discoverPlugins()

  // Activate all builtin plugins
  console.log('[Bootstrap] Activating builtin plugins...')
  await pluginManager.activateBuiltinPlugins()
  console.log('[Bootstrap] Builtin plugins activated')

  // Create the main window
  const mainWindow = windowManager.createMainWindow()
  pluginManager.setMainWindow(mainWindow)

  // Handle any pending open-file event (from drag-drop to app icon before ready)
  if (pendingOpenFile) {
    const filePath = pendingOpenFile
    pendingOpenFile = null
    mainWindow.webContents.once('did-finish-load', () => {
      mainWindow.webContents.send('file:opened', filePath)
    })
  }
}

// Request single instance lock
const gotTheLock = app.requestSingleInstanceLock()

if (!gotTheLock) {
  app.quit()
} else {
  // Handle second instance: focus the main window
  app.on('second-instance', () => {
    if (windowManager?.mainWindow) {
      if (windowManager.mainWindow.isMinimized()) {
        windowManager.mainWindow.restore()
      }
      windowManager.mainWindow.focus()
    }
  })

  // Handle open-file events (drag-drop to app icon on macOS)
  app.on('open-file', (event, path) => {
    event.preventDefault()
    if (windowManager?.mainWindow) {
      windowManager.mainWindow.webContents.send('file:opened', path)
    } else {
      pendingOpenFile = path
    }
  })

  app.whenReady().then(() => {
    // Set app user model id for Windows
    electronApp.setAppUserModelId('com.painote.app')

    // Default open or close DevTools by F12 in development
    // and ignore CommandOrControl + R in production
    app.on('browser-window-created', (_event, window) => {
      optimizer.watchWindowShortcuts(window)
    })

    bootstrap().catch((err) => {
      console.error('Failed to bootstrap application:', err)
    })
  })
}

app.on('window-all-closed', () => {
  windowManager?.closeAllNoteWindows()
  app.quit()
})

app.on('activate', () => {
  // On macOS, re-create a window when the dock icon is clicked
  if (BrowserWindow.getAllWindows().length === 0) {
    bootstrap().catch((err) => {
      console.error('Failed to bootstrap application on activate:', err)
    })
  }
})
