import { app, BrowserWindow } from 'electron'
import { electronApp, optimizer, is } from '@electron-toolkit/utils'
import { FileSystemManager } from './FileSystemManager'
import { PluginManager } from './PluginManager'
import { PluginInstaller } from './PluginInstaller'
import { WindowManager } from './WindowManager'
import { AIService } from './AIService'
import { registerIPC } from './ipc'
import { getSettings, isPluginEnabled } from './SettingsStore'

let windowManager: WindowManager
let pluginManager: PluginManager
let pluginInstaller: PluginInstaller
let fsManager: FileSystemManager
let aiService: AIService

let pendingOpenFile: string | null = null

async function bootstrap(): Promise<void> {
  const settings = getSettings()

  // Create PluginManager first so FileSystemManager can query it for
  // extension → renderer bindings instead of a hardcoded constant table.
  pluginManager = new PluginManager()
  pluginManager.setWorkspacePath(settings.workspacePath)

  // Create FileSystemManager with a resolver that consults active plugins.
  fsManager = new FileSystemManager(settings.workspacePath, (path) =>
    pluginManager.detectFormat(path)
  )
  // Give PluginManager the FSM handle so plugin.readFile/writeFile route
  // through the same workspace + realpath guards as core code.
  pluginManager.setFileSystemManager(fsManager)

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

  // Activate builtin plugins the user has enabled. Opt-in ones
  // (manifest.autoActivate === false) stay dormant until enabled via
  // the plugin market.
  console.log('[Bootstrap] Activating enabled builtin plugins...')
  await pluginManager.activateBuiltinPlugins(isPluginEnabled)
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
  // Release the chokidar watcher before quitting so the process doesn't
  // linger after the main window closes (chokidar keeps handles open).
  fsManager?.stopWatching().catch(() => { /* best-effort */ })
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
