import { ipcMain, dialog, shell, app, BrowserWindow } from 'electron'
import { join } from 'path'
import { IPC } from '@shared/ipc-channels'
import { APP_VERSION } from '@shared/constants'
import type { WindowManager } from '../WindowManager'
import type { PluginManager } from '../PluginManager'
import type { PluginInstaller } from '../PluginInstaller'
import type { FileSystemManager } from '../FileSystemManager'
import type { AIService } from '../AIService'
import { getSettings, setSettings, updateAISettings } from '../SettingsStore'
import type { AIRequest, AppSettings, NoteFormat } from '@shared/types'

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

  ipcMain.handle(
    IPC.FILE_WRITE,
    async (_event, relativePath: string, content: string) => {
      fsManager.writeFile(relativePath, content)
      return true
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
    return pluginInstaller.installFromPicker()
  })

  ipcMain.handle(IPC.PLUGIN_LOAD_LOCAL, async (_event, sourcePath: string) => {
    return pluginInstaller.installFromDirectory(sourcePath)
  })

  ipcMain.handle(IPC.PLUGIN_UNINSTALL, async (_event, pluginId: string) => {
    await pluginInstaller.uninstall(pluginId)
    return true
  })

  ipcMain.handle(IPC.PLUGIN_ACTIVATE, async (_event, pluginId: string) => {
    await pluginManager.activate(pluginId)
    return pluginManager.getPlugin(pluginId)?.info
  })

  ipcMain.handle(IPC.PLUGIN_DEACTIVATE, async (_event, pluginId: string) => {
    await pluginManager.deactivate(pluginId)
    return pluginManager.getPlugin(pluginId)?.info
  })

  ipcMain.handle(IPC.PLUGIN_GET_MANIFEST, async (_event, pluginId: string) => {
    const loaded = pluginManager.getPlugin(pluginId)
    return loaded?.info || null
  })

  ipcMain.handle(IPC.PLUGIN_OPEN_DEV_GUIDE, async () => {
    const devGuideWin = new BrowserWindow({
      width: 1000,
      height: 700,
      title: 'Plugin Development Guide',
      webPreferences: {
        sandbox: false
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

  ipcMain.handle(IPC.DIALOG_OPEN_FILE, async () => {
    const result = await dialog.showOpenDialog({
      properties: ['openFile']
    })
    return result.canceled ? null : result.filePaths
  })

  ipcMain.handle(IPC.DIALOG_OPEN_DIRECTORY, async () => {
    const result = await dialog.showOpenDialog({
      properties: ['openDirectory']
    })
    return result.canceled ? null : result.filePaths
  })

  ipcMain.handle(IPC.DIALOG_SAVE_FILE, async (_event, defaultName?: string) => {
    const result = await dialog.showSaveDialog({
      defaultPath: defaultName
    })
    return result.canceled ? null : result.filePath
  })

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
