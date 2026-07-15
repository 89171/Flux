import { ipcMain, dialog, shell, app, BrowserWindow } from 'electron'
import { writeFileSync } from 'fs'
import { join } from 'path'
import { IPC } from '@shared/ipc-channels'
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
  NoteFormat,
  SearchResult,
  UpdateCheckResult
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

  ipcMain.handle(
    IPC.FILE_SEARCH,
    async (_event, query: string, maxResults?: number): Promise<SearchResult[]> => {
      return fsManager.searchFiles(query, maxResults)
    }
  )

  ipcMain.handle(IPC.FILE_EXPORT_HTML, async (_event, content: string, fileName: string) => {
    const result = await dialog.showSaveDialog({
      title: 'Export as HTML',
      defaultPath: fileName.replace(/\.[^.]+$/, '') + '.html',
      filters: [{ name: 'HTML', extensions: ['html'] }]
    })
    if (result.canceled || !result.filePath) return null

    // Use marked to convert markdown to HTML, wrap in a full HTML document
    const { marked } = await import('marked')
    const htmlBody = marked.parse(content, { async: false }) as string
    const fullHtml = `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>${fileName}</title>
<style>
  body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif; max-width: 800px; margin: 40px auto; padding: 0 20px; color: #333; line-height: 1.7; }
  pre { background: #f5f5f5; padding: 16px; border-radius: 8px; overflow-x: auto; }
  code { background: #f5f5f5; padding: 2px 6px; border-radius: 4px; font-family: 'SF Mono', monospace; }
  pre code { background: none; padding: 0; }
  table { border-collapse: collapse; width: 100%; }
  th, td { border: 1px solid #ddd; padding: 8px 12px; }
  img { max-width: 100%; }
  blockquote { border-left: 4px solid #ddd; margin: 0; padding-left: 16px; color: #666; }
</style>
</head>
<body>
${htmlBody}
</body>
</html>`
    writeFileSync(result.filePath, fullHtml, 'utf-8')
    return result.filePath
  })

  ipcMain.handle(IPC.FILE_EXPORT_PDF, async (_event, content: string, fileName: string) => {
    const result = await dialog.showSaveDialog({
      title: 'Export as PDF',
      defaultPath: fileName.replace(/\.[^.]+$/, '') + '.pdf',
      filters: [{ name: 'PDF', extensions: ['pdf'] }]
    })
    if (result.canceled || !result.filePath) return null

    // Create a hidden BrowserWindow, load the HTML, print to PDF
    const win = new BrowserWindow({
      width: 800,
      height: 600,
      show: false,
      webPreferences: { sandbox: true }
    })

    const { marked } = await import('marked')
    const htmlBody = marked.parse(content, { async: false }) as string
    const fullHtml = `<!DOCTYPE html>
<html><head><meta charset="UTF-8"><style>
  body { font-family: -apple-system, BlinkMacSystemFont, sans-serif; max-width: 800px; margin: 0; padding: 20px; color: #333; line-height: 1.7; }
  pre { background: #f5f5f5; padding: 12px; border-radius: 6px; overflow-x: auto; font-size: 12px; }
  code { background: #f5f5f5; padding: 2px 4px; border-radius: 3px; font-family: monospace; }
  pre code { background: none; padding: 0; }
  table { border-collapse: collapse; width: 100%; }
  th, td { border: 1px solid #ddd; padding: 6px 10px; }
  img { max-width: 100%; }
  blockquote { border-left: 3px solid #ddd; margin: 0; padding-left: 12px; color: #666; }
</style></head><body>${htmlBody}</body></html>`

    await win.loadURL('data:text/html;charset=utf-8,' + encodeURIComponent(fullHtml))
    const pdfBuffer = await win.webContents.printToPDF({
      pageSize: 'A4',
      printBackground: true,
      margins: { top: 0.4, bottom: 0.4, left: 0.4, right: 0.4 }
    })
    writeFileSync(result.filePath, pdfBuffer)
    win.close()
    return result.filePath
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
    try {
      const data = await aiService.generate(request)
      return { success: true, data }
    } catch (err) {
      return { success: false, error: err instanceof Error ? err.message : String(err) }
    }
  })

  ipcMain.handle(IPC.AI_CHAT, async (_event, request: AIRequest) => {
    try {
      const data = await aiService.chat(request)
      return { success: true, data }
    } catch (err) {
      return { success: false, error: err instanceof Error ? err.message : String(err) }
    }
  })

  ipcMain.handle(IPC.AI_TRANSCRIBE, async (_event, audioPath: string) => {
    try {
      const data = await aiService.transcribe(audioPath)
      return { success: true, data }
    } catch (err) {
      return { success: false, error: err instanceof Error ? err.message : String(err) }
    }
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

  // Probe an unsaved AI config with a minimal round-trip. The Settings
  // panel calls this before persisting, so a wrong API key / base URL /
  // model name is surfaced as an inline error instead of silently
  // saving a broken configuration. AIService.testConfig swaps the
  // candidate config in temporarily and restores the live one on
  // return, so a failed probe never disrupts in-flight AI calls.
  ipcMain.handle(
    IPC.AI_TEST_CONFIG,
    async (_event, config: Partial<AppSettings['ai']>) => {
      return aiService.testConfig(config)
    }
  )

  // ─── Streaming generation ───
  // Unlike the one-shot AI_GENERATE (handle → return), streaming uses
  // ipcMain.on + webContents.send: the main process iterates the
  // AsyncGenerator from aiService.generateStream() and pushes each
  // chunk to the renderer via AI_STREAM_CHUNK. When done (or on error)
  // it emits AI_STREAM_DONE / AI_STREAM_ERROR so the renderer can
  // finalize the message and clean up listeners.
  //
  // The conversationId is generated upfront and injected into the
  // request so generateStream reuses it (it does
  // `request.conversationId || this.generateConversationId()`). This
  // way we can send the same id back in AI_STREAM_DONE.
  ipcMain.on(IPC.AI_GENERATE_STREAM, async (event, request: AIRequest) => {
    const sender = event.sender
    const conversationId = request.conversationId || aiService.generateConversationId()
    const requestWithId: AIRequest = { ...request, conversationId }
    try {
      for await (const chunk of aiService.generateStream(requestWithId)) {
        sender.send(IPC.AI_STREAM_CHUNK, chunk)
      }
      sender.send(IPC.AI_STREAM_DONE, { conversationId })
    } catch (err) {
      sender.send(
        IPC.AI_STREAM_ERROR,
        err instanceof Error ? err.message : String(err)
      )
    }
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
    return app.getVersion()
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

  // Open an external URL in the user's default browser. Restricted to
  // http(s) to prevent file:// / shell-injection abuse from the renderer.
  ipcMain.handle(IPC.APP_OPEN_URL, async (_event, url: string) => {
    try {
      const parsed = new URL(url)
      if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
        return false
      }
      await shell.openExternal(url)
      return true
    } catch (err) {
      console.error('openExternal failed:', err)
      return false
    }
  })

  // Check for updates by comparing the current app version with the
  // latest GitHub Release tag. Uses the unauthenticated GitHub API
  // (60 requests/hour — sufficient for manual update checks).
  ipcMain.handle(IPC.APP_CHECK_FOR_UPDATES, async (): Promise<UpdateCheckResult> => {
    const currentVersion = app.getVersion()
    try {
      const response = await fetch(
        'https://api.github.com/repos/jianmin-zhu/Flux/releases/latest',
        { headers: { 'User-Agent': 'Flux-App-Updater' } }
      )
      if (!response.ok) {
        throw new Error(`GitHub API returned ${response.status}`)
      }
      const data = (await response.json()) as {
        tag_name: string
        html_url: string
        body: string
      }
      // Strip leading 'v' from tag name (e.g. "v1.0.1" → "1.0.1")
      const latestVersion = (data.tag_name || '').replace(/^v/, '')

      // Simple semver comparison: split by '.', compare each segment numerically
      const hasUpdate = (() => {
        const a = currentVersion.split('.').map(Number)
        const b = latestVersion.split('.').map(Number)
        for (let i = 0; i < Math.max(a.length, b.length); i++) {
          const va = a[i] || 0
          const vb = b[i] || 0
          if (vb > va) return true
          if (vb < va) return false
        }
        return false
      })()

      return {
        hasUpdate,
        currentVersion,
        latestVersion,
        releaseUrl: data.html_url || '',
        releaseNotes: data.body || ''
      }
    } catch (err) {
      console.error('Update check failed:', err)
      return {
        hasUpdate: false,
        currentVersion,
        latestVersion: '',
        releaseUrl: '',
        releaseNotes: ''
      }
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
