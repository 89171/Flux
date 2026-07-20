import { app, BrowserWindow, Menu, protocol, shell } from 'electron'
import { electronApp, optimizer, is } from '@electron-toolkit/utils'
import { existsSync, readFileSync } from 'fs'
import { extname } from 'path'
import { FileSystemManager } from './FileSystemManager'
import { PluginManager } from './PluginManager'
import { PluginInstaller } from './PluginInstaller'
import { WindowManager } from './WindowManager'
import { AIService } from './AIService'
import { registerIPC } from './ipc'
import { getSettings, isPluginEnabled } from './SettingsStore'
import { IPC } from '@shared/ipc-channels'
import { StorageManager, StorageMirror } from './storage'

let windowManager: WindowManager
let pluginManager: PluginManager
let pluginInstaller: PluginInstaller
let fsManager: FileSystemManager
let aiService: AIService
let storageManager: StorageManager
let storageMirror: StorageMirror

let pendingOpenFile: string | null = null
let staticAssetProtocolRegistered = false

protocol.registerSchemesAsPrivileged([
  {
    scheme: 'flux-asset',
    privileges: {
      standard: true,
      secure: true,
      supportFetchAPI: true,
      corsEnabled: true
    }
  }
])

function getAssetContentType(path: string): string {
  switch (extname(path).toLowerCase()) {
    case '.png':
      return 'image/png'
    case '.jpg':
    case '.jpeg':
      return 'image/jpeg'
    case '.gif':
      return 'image/gif'
    case '.webp':
      return 'image/webp'
    case '.svg':
      return 'image/svg+xml; charset=utf-8'
    default:
      return 'application/octet-stream'
  }
}

function getStaticAssetProtocolPath(url: string): string {
  const parsed = new URL(url)
  const relativePath = decodeURIComponent(`${parsed.hostname}${parsed.pathname}`)
    .replace(/^\/+/, '')

  if (!fsManager.isStaticAssetPath(relativePath)) {
    throw new Error(`Refused non-static asset path: ${relativePath}`)
  }

  return fsManager.resolvePath(relativePath)
}

function registerStaticAssetProtocol(): void {
  if (staticAssetProtocolRegistered) return

  try {
    protocol.handle('flux-asset', (request) => {
      const assetPath = getStaticAssetProtocolPath(request.url)
      if (!existsSync(assetPath)) {
        console.warn('[StaticAssets] Asset not found:', assetPath)
        return new Response('Not found', { status: 404 })
      }
      return new Response(readFileSync(assetPath), {
        headers: {
          'Content-Type': getAssetContentType(assetPath),
          'Cache-Control': 'no-store'
        }
      })
    })
    staticAssetProtocolRegistered = true
  } catch (err) {
    console.warn('[StaticAssets] Failed to register flux-asset protocol:', err)
    registerStaticAssetProtocolLegacy()
  }
}

function registerStaticAssetProtocolLegacy(): void {
  if (staticAssetProtocolRegistered) return

  const registered = protocol.registerFileProtocol('flux-asset', (request, callback) => {
    try {
      callback({ path: getStaticAssetProtocolPath(request.url) })
    } catch (err) {
      console.warn('[StaticAssets] Failed to resolve asset URL:', err)
      callback({ error: -6 })
    }
  })

  staticAssetProtocolRegistered = registered
  if (!registered) {
    console.warn('[StaticAssets] Failed to register flux-asset protocol')
  }
}

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
  registerStaticAssetProtocol()
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

  // StorageManager owns the provider boundary used by future sync flows.
  storageManager = new StorageManager(settings.storage)
  storageMirror = new StorageMirror(fsManager, storageManager)
  storageMirror.start()

  // Register all IPC handlers
  registerIPC(windowManager, pluginManager, pluginInstaller, fsManager, aiService, storageManager)

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
        // No accelerators on these click-based items. A bare CmdOrControl
        // +<letter> menu accelerator false-triggers on the plain letter
        // while a non-Latin IME (e.g. Chinese Pinyin) is composing — the
        // same class of bug that forced us to drop the CmdOrControl+,
        // accelerator on Preferences below. The shortcuts are owned by the
        // renderer keydown handlers (App.tsx / Editor.tsx) instead, which
        // skip IME composition via `e.isComposing`.
        {
          label: 'New File',
          click: () => sendMenuAction('new-file')
        },
        {
          label: 'Open Folder',
          click: () => sendMenuAction('open-folder')
        },
        {
          label: 'Save',
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
        // Accelerators omitted — see the File-menu note. Find/Replace are
        // handled in the renderer (Editor.tsx) with an IME guard so a bare
        // 'f' / 'h' during Pinyin composition can't open these dialogs.
        {
          label: 'Find',
          click: () => sendMenuAction('find')
        },
        {
          label: 'Replace',
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
        // Quick Open uses a bare CmdOrControl+P → accelerator dropped (see
        // File-menu note); it's handled in App.tsx with an IME guard.
        // The Shift-combo shortcuts below keep their accelerators — they
        // require Shift, so a plain letter typed during IME composition
        // can't match them.
        {
          label: 'Quick Open',
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

type NativeEditCommand = 'cut' | 'copy' | 'paste' | 'selectAll'

function executeNativeEditCommand(window: BrowserWindow, command: NativeEditCommand): void {
  const { webContents } = window
  switch (command) {
    case 'cut':
      webContents.cut()
      break
    case 'copy':
      webContents.copy()
      break
    case 'paste':
      webContents.paste()
      break
    case 'selectAll':
      webContents.selectAll()
      break
  }
}

function installNativeEditContextMenu(window: BrowserWindow): void {
  const { webContents } = window

  webContents.on('context-menu', (_event, params) => {
    const { editFlags } = params
    Menu.buildFromTemplate([
      {
        label: 'Cut',
        enabled: editFlags.canCut,
        click: () => executeNativeEditCommand(window, 'cut')
      },
      {
        label: 'Copy',
        enabled: editFlags.canCopy,
        click: () => executeNativeEditCommand(window, 'copy')
      },
      {
        label: 'Paste',
        enabled: editFlags.canPaste,
        click: () => executeNativeEditCommand(window, 'paste')
      },
      { type: 'separator' },
      {
        label: 'Select All',
        enabled: editFlags.canSelectAll,
        click: () => executeNativeEditCommand(window, 'selectAll')
      }
    ]).popup({ window })
  })
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
      installNativeEditContextMenu(window)
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
