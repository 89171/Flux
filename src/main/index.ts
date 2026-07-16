import { app, BrowserWindow, Menu, shell } from 'electron'
import { electronApp, optimizer, is } from '@electron-toolkit/utils'
import { FileSystemManager } from './FileSystemManager'
import { PluginManager } from './PluginManager'
import { PluginInstaller } from './PluginInstaller'
import { WindowManager } from './WindowManager'
import { AIService } from './AIService'
import { registerIPC } from './ipc'
import { getSettings, isPluginEnabled } from './SettingsStore'
import { IPC } from '@shared/ipc-channels'

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

  // Create AIService (pass fsManager so tool calls can create files)
  aiService = new AIService(pluginManager, fsManager)

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

/**
 * Forward a menu action to the focused window's renderer so it can be
 * handled by the React layer (open a palette, toggle theme, etc.).
 */
function sendMenuAction(action: string): void {
  BrowserWindow.getFocusedWindow()?.webContents.send(IPC.MENU_ACTION_EVENT, action)
}

/**
 * Build and install the application menu bar. Menu items that map to
 * renderer-side actions forward via `IPC.MENU_ACTION_EVENT`; standard
 * Electron roles (quit, undo, cut, …) are handled natively.
 */
function buildMenu(): void {
  const isDev = is.dev

  const viewSubmenu: Electron.MenuItemConstructorOptions[] = [
    {
      label: 'Zoom In',
      accelerator: 'CmdOrControl+=',
      click: () => sendMenuAction('zoom-in')
    },
    {
      label: 'Zoom Out',
      accelerator: 'CmdOrControl+-',
      click: () => sendMenuAction('zoom-out')
    },
    {
      label: 'Reset Zoom',
      accelerator: 'CmdOrControl+0',
      click: () => sendMenuAction('zoom-reset')
    },
    { type: 'separator' },
    {
      label: 'Toggle Theme',
      accelerator: 'CmdOrControl+Shift+T',
      click: () => sendMenuAction('toggle-theme')
    },
    { type: 'separator' }
  ]
  if (isDev) {
    viewSubmenu.push({ role: 'reload', accelerator: 'CmdOrControl+R' })
    viewSubmenu.push({ role: 'toggleDevTools', accelerator: 'F12' })
  }

  const template: Electron.MenuItemConstructorOptions[] = [
    {
      label: 'Flux',
      submenu: [
        {
          label: 'About Flux',
          click: () => sendMenuAction('about')
        },
        { type: 'separator' },
        {
          label: 'Preferences...',
          // No accelerator here — CmdOrControl+, is handled in the renderer
          // so macOS doesn't intercept the comma key at the OS level.
          // Registering it as a menu accelerator causes false triggers when
          // Chinese IME converts ',' → '，' (full-width comma).
          click: () => sendMenuAction('settings')
        },
        { type: 'separator' },
        { role: 'quit', label: 'Quit Flux', accelerator: 'CmdOrControl+Q' }
      ]
    },
    {
      label: 'File',
      submenu: [
        {
          label: 'New File',
          accelerator: 'CmdOrControl+N',
          click: () => sendMenuAction('new-file')
        },
        {
          label: 'Open Folder',
          accelerator: 'CmdOrControl+O',
          click: () => sendMenuAction('open-folder')
        },
        {
          label: 'Save',
          accelerator: 'CmdOrControl+S',
          click: () => sendMenuAction('save')
        },
        { type: 'separator' },
        { role: 'close', label: 'Close Window', accelerator: 'CmdOrControl+W' }
      ]
    },
    {
      label: 'Edit',
      submenu: [
        { role: 'undo', accelerator: 'CmdOrControl+Z' },
        { role: 'redo', accelerator: 'CmdOrControl+Shift+Z' },
        { type: 'separator' },
        { role: 'cut' },
        { role: 'copy' },
        { role: 'paste' },
        { role: 'selectAll', label: 'Select All' },
        { type: 'separator' },
        {
          label: 'Find',
          accelerator: 'CmdOrControl+F',
          click: () => sendMenuAction('find')
        },
        {
          label: 'Replace',
          accelerator: 'CmdOrControl+H',
          click: () => sendMenuAction('replace')
        }
      ]
    },
    {
      label: 'View',
      submenu: viewSubmenu
    },
    {
      label: 'Go',
      submenu: [
        {
          label: 'Quick Open',
          accelerator: 'CmdOrControl+P',
          click: () => sendMenuAction('quick-open')
        },
        {
          label: 'Global Search',
          accelerator: 'CmdOrControl+Shift+F',
          click: () => sendMenuAction('global-search')
        },
        {
          label: 'Command Palette',
          accelerator: 'CmdOrControl+Shift+P',
          click: () => sendMenuAction('command-palette')
        }
      ]
    },
    {
      label: 'Window',
      submenu: [
        { role: 'minimize', accelerator: 'CmdOrControl+M' },
        { role: 'zoom' },
        { type: 'separator' },
        { role: 'front', label: 'Bring All to Front' }
      ]
    },
    {
      label: 'Help',
      submenu: [
        {
          label: 'About Flux',
          click: () => sendMenuAction('about')
        },
        {
          label: 'Check for Updates...',
          click: () => sendMenuAction('check-for-updates')
        },
        { type: 'separator' },
        {
          label: 'Toggle Developer Tools',
          accelerator: 'CmdOrControl+Shift+I',
          click: () => {
            BrowserWindow.getFocusedWindow()?.webContents.toggleDevTools()
          }
        },
        { type: 'separator' },
        {
          label: 'GitHub Repository',
          click: () => {
            shell.openExternal('https://github.com/jianmin-zhu/Flux')
          }
        }
      ]
    }
  ]

  const menu = Menu.buildFromTemplate(template)
  Menu.setApplicationMenu(menu)
}

// In dev, the running binary is node_modules/electron/dist/Electron.app,
// so macOS shows "Electron" in the menu bar / About / force-quit dialog
// unless we override the app name explicitly. Must be set before
// whenReady so the value is in place when the native menu is built.
app.setName('Flux')

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
    electronApp.setAppUserModelId('com.flux.app')

    // Default open or close DevTools by F12 in development
    // and ignore CommandOrControl + R in production
    app.on('browser-window-created', (_event, window) => {
      optimizer.watchWindowShortcuts(window)
    })

    bootstrap()
      .then(() => {
        buildMenu()
        // Set macOS Dock icon — electron-builder only wires the .icns into the
        // .app bundle for production builds; in dev we set it programmatically.
        if (process.platform === 'darwin' && app.dock) {
          const iconPath = windowManager?.resolveIconPath()
          if (iconPath) app.dock.setIcon(iconPath)
        }
      })
      .catch((err) => {
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
