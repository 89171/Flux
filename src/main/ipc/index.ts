import { ipcMain, dialog, shell, app, BrowserWindow } from 'electron'
import { join } from 'path'
import { IPC } from '@shared/ipc-channels'
import { APP_VERSION } from '@shared/constants'
import type { WindowManager } from '../WindowManager'
import type { PluginManager } from '../PluginManager'
import type { PluginInstaller } from '../PluginInstaller'
import type { FileSystemManager } from '../FileSystemManager'
import type { AIService } from '../AIService'
import { getSettings, setSettings, setPluginEnabled, updateAISettings } from '../SettingsStore'
import type {
  AIRequest,
  AppSettings,
  FileChangedEvent,
  NoteFormat
} from '@shared/types'

function broadcastFileChanged(
  senderWebContentsId: number,
  payload: FileChangedEvent
): void {
  for (const win of BrowserWindow.getAllWindows()) {
    if (win.webContents.id === senderWebContentsId) continue
    if (win.isDestroyed()) continue
    win.webContents.send(IPC.FILE_CHANGED_EVENT, payload)
  }
}

export function registerIPC(
  windowManager: WindowManager,
  pluginManager: PluginManager,
  pluginInstaller: PluginInstaller,
  fsManager: FileSystemManager,
  aiService: AIService
): void {
  // ============ File IPC ============

  ipcMain.handle(IPC.FILE_TREE, async () => {
    return fsManager.buildFileTree()
  })

  ipcMain.handle(IPC.FILE_READ, async (_event, relativePath: string) => {
    return fsManager.readFile(relativePath)
  })

  ipcMain.handle(IPC.FILE_READ_META, async (_event, relativePath: string) => {
    return fsManager.readFileWithMeta(relativePath)
  })

  ipcMain.handle(
    IPC.FILE_WRITE,
    async (event, relativePath: string, content: string) => {
      fsManager.writeFile(relativePath, content)
      // Best-effort mtime read for the broadcast; failures here shouldn't
      // fail the write itself since the file was persisted.
      try {
        const { mtime } = fsManager.readFileWithMeta(relativePath)
        broadcastFileChanged(event.sender.id, {
          path: relativePath,
          mtime,
          content
        })
      } catch (err) {
        console.warn('Failed to broadcast file change:', err)
      }
      return true
    }
  )

  ipcMain.handle(
    IPC.FILE_WRITE_GUARDED,
    async (
      event,
      relativePath: string,
      content: string,
      expectedMtime: number | null
    ) => {
      const result = fsManager.writeFileGuarded(relativePath, content, expectedMtime)
      if (result.ok) {
        broadcastFileChanged(event.sender.id, {
          path: relativePath,
          mtime: result.mtime,
          content
        })
      }
      return result
    }
  )

  ipcMain.handle(
    IPC.FILE_CREATE,
    async (_event, relativePath: string, content: string, isDir: boolean) => {
      if (isDir) {
        return fsManager.createDirectory(relativePath)
      }
      return fsManager.createFile(relativePath, content)
    }
  )

  ipcMain.handle(IPC.FILE_DELETE, async (_event, relativePath: string) => {
    fsManager.delete(relativePath)
    return true
  })

  ipcMain.handle(
    IPC.FILE_RENAME,
    async (_event, oldPath: string, newPath: string) => {
      fsManager.rename(oldPath, newPath)
      return true
    }
  )

  ipcMain.handle(
    IPC.FILE_MOVE,
    async (_event, sourcePath: string, targetDir: string) => {
      fsManager.move(sourcePath, targetDir)
      return true
    }
  )

  ipcMain.handle(IPC.FILE_OPEN_EXTERNAL, async (_event, relativePath: string) => {
    const fullPath = fsManager.resolvePath(relativePath)
    await shell.openPath(fullPath)
    return true
  })

  // ============ Window IPC ============

  ipcMain.handle(IPC.WINDOW_OPEN_NOTE, async (_event, opts: {
    noteId: string
    notePath: string
    noteName: string
    format: NoteFormat
    isPinned?: boolean
    opacity?: number
    autoCollapse?: boolean
  }) => {
    windowManager.openNoteWindow(opts)
    return true
  })

  ipcMain.handle(
    IPC.WINDOW_PIN,
    async (_event, noteId: string, opacity?: number) => {
      windowManager.pinNote(noteId, opacity)
      return true
    }
  )

  ipcMain.handle(IPC.WINDOW_UNPIN, async (_event, noteId: string) => {
    windowManager.unpinNote(noteId)
    return true
  })

  ipcMain.handle(IPC.WINDOW_TOGGLE_PIN, async (_event, noteId: string) => {
    return windowManager.togglePin(noteId)
  })

  ipcMain.handle(
    IPC.WINDOW_SET_OPACITY,
    async (_event, noteId: string, opacity: number) => {
      windowManager.setOpacity(noteId, opacity)
      return true
    }
  )

  ipcMain.handle(
    IPC.WINDOW_SET_AUTO_COLLAPSE,
    async (_event, noteId: string, enabled: boolean) => {
      windowManager.setAutoCollapse(noteId, enabled)
      return true
    }
  )

  ipcMain.handle(IPC.WINDOW_CLOSE, async (_event, noteId: string) => {
    windowManager.closeNoteWindow(noteId)
    return true
  })

  ipcMain.handle(IPC.WINDOW_MINIMIZE, async (_event, noteId?: string) => {
    if (noteId) {
      const managed = windowManager.noteWindows.get(noteId)
      managed?.window.minimize()
    } else {
      windowManager.mainWindow?.minimize()
    }
    return true
  })

  ipcMain.handle(IPC.WINDOW_AUTO_LAUNCH, async (_event, enabled?: boolean) => {
    if (enabled !== undefined) {
      await windowManager.setAutoLaunch(enabled)
    }
    return windowManager.isAutoLaunchEnabled()
  })

  // ============ Plugin IPC ============

  ipcMain.handle(IPC.PLUGIN_LIST, async () => {
    return pluginManager.listPlugins()
  })

  ipcMain.handle(IPC.PLUGIN_INSTALL, async () => {
    try {
      const plugin = await pluginInstaller.installFromPicker()
      if (!plugin) {
        // User dismissed the directory picker — distinguish this from a real
        // error so the renderer doesn't show a scary failure toast.
        return { success: false, canceled: true }
      }
      return { success: true, plugin }
    } catch (err) {
      return { success: false, error: err instanceof Error ? err.message : String(err) }
    }
  })

  ipcMain.handle(IPC.PLUGIN_LOAD_LOCAL, async (_event, sourcePath: string) => {
    try {
      const plugin = await pluginInstaller.installFromDirectory(sourcePath)
      return { success: true, plugin }
    } catch (err) {
      return { success: false, error: err instanceof Error ? err.message : String(err) }
    }
  })

  ipcMain.handle(IPC.PLUGIN_UNINSTALL, async (_event, pluginId: string) => {
    try {
      await pluginInstaller.uninstall(pluginId)
      return { success: true }
    } catch (err) {
      return { success: false, error: err instanceof Error ? err.message : String(err) }
    }
  })

  ipcMain.handle(IPC.PLUGIN_ACTIVATE, async (_event, pluginId: string) => {
    await pluginManager.activate(pluginId)
    return pluginManager.getPlugin(pluginId)?.info
  })

  ipcMain.handle(IPC.PLUGIN_DEACTIVATE, async (_event, pluginId: string) => {
    await pluginManager.deactivate(pluginId)
    return pluginManager.getPlugin(pluginId)?.info
  })

  ipcMain.handle(
    IPC.PLUGIN_SET_ENABLED,
    async (_event, pluginId: string, enabled: boolean) => {
      try {
        setPluginEnabled(pluginId, enabled)
        const loaded = pluginManager.getPlugin(pluginId)
        if (!loaded) return { success: false, error: `Plugin not found: ${pluginId}` }
        // Reconcile runtime state with the new preference. If the plugin
        // isn't installed yet (opt-in builtin never activated) `activate`
        // reads its manifest fresh; if it's active and being disabled,
        // deactivate cleans up listeners + format bindings.
        if (enabled && loaded.state !== 'active') {
          await pluginManager.activate(pluginId)
        } else if (!enabled && loaded.state === 'active') {
          await pluginManager.deactivate(pluginId)
        }
        return { success: true, plugin: pluginManager.getPlugin(pluginId)?.info }
      } catch (err) {
        return { success: false, error: err instanceof Error ? err.message : String(err) }
      }
    }
  )

  ipcMain.handle(IPC.PLUGIN_GET_MANIFEST, async (_event, pluginId: string) => {
    const loaded = pluginManager.getPlugin(pluginId)
    return loaded?.info || null
  })

  ipcMain.handle(IPC.PLUGIN_GET_FORMAT_MAP, async () => {
    return pluginManager.getFormatMap()
  })

  // Broadcast format-map changes so renderers can update their extension →
  // renderer lookup as plugins are activated / deactivated / installed.
  pluginManager.onFormatMapChanged(() => {
    const payload = pluginManager.getFormatMap()
    for (const win of BrowserWindow.getAllWindows()) {
      if (win.isDestroyed()) continue
      win.webContents.send(IPC.PLUGIN_FORMAT_MAP_CHANGED_EVENT, payload)
    }
  })

  // Broadcast file-tree changes (mutation or external filesystem event) so
  // renderers stop having to poll FILE_TREE after every create/delete.
  fsManager.onTreeChanged((tree) => {
    for (const win of BrowserWindow.getAllWindows()) {
      if (win.isDestroyed()) continue
      win.webContents.send(IPC.FILE_TREE_CHANGED_EVENT, tree)
    }
  })

  ipcMain.handle(IPC.PLUGIN_OPEN_DEV_GUIDE, async () => {
    const devGuideWin = new BrowserWindow({
      width: 1000,
      height: 700,
      title: 'Plugin Development Guide',
      webPreferences: {
        sandbox: true,
        contextIsolation: true,
        nodeIntegration: false,
        webSecurity: true
      }
    })

    if (process.env['ELECTRON_RENDERER_URL']) {
      devGuideWin.loadURL(
        process.env['ELECTRON_RENDERER_URL'] + '/plugin-dev-guide.html'
      )
    } else {
      devGuideWin.loadFile(
        join(__dirname, '../renderer/plugin-dev-guide.html')
      )
    }

    return true
  })

  // ============ AI IPC ============

  ipcMain.handle(IPC.AI_GENERATE, async (_event, request: AIRequest) => {
    return aiService.generate(request)
  })

  ipcMain.handle(IPC.AI_CHAT, async (_event, request: AIRequest) => {
    return aiService.chat(request)
  })

  ipcMain.handle(IPC.AI_TRANSCRIBE, async (_event, audioPath: string) => {
    return aiService.transcribe(audioPath)
  })

  ipcMain.handle(IPC.AI_CANCEL, async (_event, conversationId: string) => {
    aiService.cancel(conversationId)
    return true
  })

  ipcMain.handle(IPC.AI_SETTINGS, async (_event, settings?: Partial<AppSettings['ai']>) => {
    if (settings) {
      const updated = updateAISettings(settings)
      aiService.configure(updated.ai)
      return updated.ai
    }
    return getSettings().ai
  })

  // ============ Settings IPC ============

  ipcMain.handle(IPC.SETTINGS_GET, async () => {
    return getSettings()
  })

  ipcMain.handle(IPC.SETTINGS_SET, async (_event, partial: Partial<AppSettings>) => {
    const updated = setSettings(partial)
    // If workspacePath changed, update the FileSystemManager
    if (partial.workspacePath) {
      fsManager.setWorkspacePath(partial.workspacePath)
    }
    return updated
  })

  // ============ Dialog IPC ============
  // Handlers preserve the opts declared on the preload surface (title,
  // filters, defaultPath). Previously these were silently dropped.

  ipcMain.handle(
    IPC.DIALOG_OPEN_FILE,
    async (
      _event,
      opts?: { title?: string; filters?: Array<{ name: string; extensions: string[] }> }
    ) => {
      const result = await dialog.showOpenDialog({
        properties: ['openFile'],
        ...(opts?.title ? { title: opts.title } : {}),
        ...(opts?.filters ? { filters: opts.filters } : {})
      })
      return result.canceled ? null : result.filePaths[0] ?? null
    }
  )

  ipcMain.handle(
    IPC.DIALOG_OPEN_DIRECTORY,
    async (_event, opts?: { title?: string }) => {
      const result = await dialog.showOpenDialog({
        properties: ['openDirectory'],
        ...(opts?.title ? { title: opts.title } : {})
      })
      return result.canceled ? null : result.filePaths[0] ?? null
    }
  )

  ipcMain.handle(
    IPC.DIALOG_SAVE_FILE,
    async (
      _event,
      opts?: {
        title?: string
        defaultPath?: string
        filters?: Array<{ name: string; extensions: string[] }>
      }
    ) => {
      const result = await dialog.showSaveDialog({
        ...(opts?.title ? { title: opts.title } : {}),
        ...(opts?.defaultPath ? { defaultPath: opts.defaultPath } : {}),
        ...(opts?.filters ? { filters: opts.filters } : {})
      })
      return result.canceled ? null : result.filePath ?? null
    }
  )

  // ============ App IPC ============

  ipcMain.handle(IPC.APP_GET_VERSION, async () => {
    return APP_VERSION
  })

  ipcMain.handle(IPC.APP_GET_PATHS, async () => {
    return {
      userData: app.getPath('userData'),
      documents: app.getPath('documents'),
      downloads: app.getPath('downloads'),
      desktop: app.getPath('desktop'),
      workspace: fsManager.getWorkspacePath(),
      builtinPlugins: pluginManager.getBuiltinPluginsPath(),
      userPlugins: pluginManager.getUserPluginsPath()
    }
  })

  // ============ Window Controls (ipcMain.on) ============

  ipcMain.on('window:minimize', () => {
    const win = BrowserWindow.getFocusedWindow()
    win?.minimize()
  })

  ipcMain.on('window:close', () => {
    const win = BrowserWindow.getFocusedWindow()
    win?.close()
  })

  ipcMain.on('window:maximize', () => {
    const win = BrowserWindow.getFocusedWindow()
    if (win) {
      if (win.isMaximized()) {
        win.unmaximize()
      } else {
        win.maximize()
      }
    }
  })
}
