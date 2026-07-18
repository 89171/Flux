import { contextBridge, ipcRenderer } from 'electron'
import { IPC } from '../shared/ipc-channels'
import type {
  NoteFile,
  PluginInfo,
  AIRequest,
  AIResponse,
  AIToolEvent,
  AppSettings,
  FormatBinding,
  FileReadMetaResult,
  FileWriteResult,
  FileChangedEvent,
  FileHistoryEntry,
  FileHistoryReadResult,
  SearchResult,
  StorageSettings,
  TrashEntry,
  TrashRestoreResult,
  UpdateCheckResult
} from '../shared/types'

const api = {
  file: {
    getTree: (): Promise<NoteFile[]> => ipcRenderer.invoke(IPC.FILE_TREE),
    read: (path: string): Promise<string> => ipcRenderer.invoke(IPC.FILE_READ, path),
    readMeta: (path: string): Promise<FileReadMetaResult> =>
      ipcRenderer.invoke(IPC.FILE_READ_META, path),
    write: (path: string, content: string): Promise<boolean> => ipcRenderer.invoke(IPC.FILE_WRITE, path, content),
    writeGuarded: (
      path: string,
      content: string,
      expectedMtime: number | null
    ): Promise<FileWriteResult> =>
      ipcRenderer.invoke(IPC.FILE_WRITE_GUARDED, path, content, expectedMtime),
    onChanged: (callback: (payload: FileChangedEvent) => void): (() => void) => {
      const handler = (_: unknown, payload: FileChangedEvent) => callback(payload)
      ipcRenderer.on(IPC.FILE_CHANGED_EVENT, handler)
      return () => ipcRenderer.removeListener(IPC.FILE_CHANGED_EVENT, handler)
    },
    onTreeChanged: (callback: (tree: NoteFile[]) => void): (() => void) => {
      const handler = (_: unknown, tree: NoteFile[]) => callback(tree)
      ipcRenderer.on(IPC.FILE_TREE_CHANGED_EVENT, handler)
      return () => ipcRenderer.removeListener(IPC.FILE_TREE_CHANGED_EVENT, handler)
    },
    create: (path: string, content?: string, isDir?: boolean): Promise<NoteFile> => ipcRenderer.invoke(IPC.FILE_CREATE, path, content, isDir),
    delete: (path: string): Promise<boolean> => ipcRenderer.invoke(IPC.FILE_DELETE, path),
    rename: (oldPath: string, newPath: string): Promise<NoteFile> => ipcRenderer.invoke(IPC.FILE_RENAME, oldPath, newPath),
    move: (sourcePath: string, targetDir: string): Promise<NoteFile> => ipcRenderer.invoke(IPC.FILE_MOVE, sourcePath, targetDir),
    openExternal: (path: string): Promise<boolean> => ipcRenderer.invoke(IPC.FILE_OPEN_EXTERNAL, path),
    revealInFolder: (path: string): Promise<boolean> =>
      ipcRenderer.invoke(IPC.FILE_REVEAL_IN_FOLDER, path),
    history: {
      list: (path: string): Promise<FileHistoryEntry[]> =>
        ipcRenderer.invoke(IPC.FILE_HISTORY_LIST, path),
      read: (path: string, id: string): Promise<FileHistoryReadResult> =>
        ipcRenderer.invoke(IPC.FILE_HISTORY_READ, path, id),
      restore: (path: string, id: string): Promise<FileReadMetaResult> =>
        ipcRenderer.invoke(IPC.FILE_HISTORY_RESTORE, path, id)
    },
    trash: {
      list: (): Promise<TrashEntry[]> => ipcRenderer.invoke(IPC.FILE_TRASH_LIST),
      restore: (id: string): Promise<TrashRestoreResult> =>
        ipcRenderer.invoke(IPC.FILE_TRASH_RESTORE, id),
      delete: (id: string): Promise<boolean> => ipcRenderer.invoke(IPC.FILE_TRASH_DELETE, id),
      empty: (): Promise<boolean> => ipcRenderer.invoke(IPC.FILE_TRASH_EMPTY),
      open: (): Promise<boolean> => ipcRenderer.invoke(IPC.FILE_TRASH_OPEN)
    },
    search: (query: string, maxResults?: number): Promise<SearchResult[]> =>
      ipcRenderer.invoke(IPC.FILE_SEARCH, query, maxResults),
    exportPDF: (content: string, fileName: string): Promise<string | null> =>
      ipcRenderer.invoke(IPC.FILE_EXPORT_PDF, content, fileName),
    exportHTML: (content: string, fileName: string): Promise<string | null> =>
      ipcRenderer.invoke(IPC.FILE_EXPORT_HTML, content, fileName),
    exportData: (opts: {
      title?: string
      defaultPath: string
      filters?: Array<{ name: string; extensions: string[] }>
      data: string
      encoding?: 'utf8' | 'base64'
    }): Promise<string | null> =>
      ipcRenderer.invoke(IPC.FILE_EXPORT_DATA, opts)
  },
  window: {
    openNote: (opts: { noteId: string; notePath: string; noteName: string; format: string; content?: string; isPinned?: boolean; opacity?: number; autoCollapse?: boolean }): Promise<unknown> => ipcRenderer.invoke(IPC.WINDOW_OPEN_NOTE, opts),
    pin: (noteId: string, opacity?: number): Promise<boolean> => ipcRenderer.invoke(IPC.WINDOW_PIN, noteId, opacity),
    unpin: (noteId: string): Promise<boolean> => ipcRenderer.invoke(IPC.WINDOW_UNPIN, noteId),
    togglePin: (noteId: string): Promise<boolean> => ipcRenderer.invoke(IPC.WINDOW_TOGGLE_PIN, noteId),
    setOpacity: (noteId: string, opacity: number): Promise<boolean> => ipcRenderer.invoke(IPC.WINDOW_SET_OPACITY, noteId, opacity),
    setAutoCollapse: (noteId: string, enabled: boolean): Promise<boolean> => ipcRenderer.invoke(IPC.WINDOW_SET_AUTO_COLLAPSE, noteId, enabled),
    close: (noteId?: string): Promise<boolean> => ipcRenderer.invoke(IPC.WINDOW_CLOSE, noteId),
    minimize: (noteId?: string): Promise<boolean> => ipcRenderer.invoke(IPC.WINDOW_MINIMIZE, noteId),
    setAutoLaunch: (enabled: boolean): Promise<boolean> => ipcRenderer.invoke(IPC.WINDOW_AUTO_LAUNCH, enabled),
    minimizeFrame: () => ipcRenderer.send('window:minimize'),
    closeFrame: () => ipcRenderer.send('window:close'),
    toggleMaximize: () => ipcRenderer.send('window:maximize')
  },
  plugin: {
    list: (): Promise<PluginInfo[]> => ipcRenderer.invoke(IPC.PLUGIN_LIST),
    install: (): Promise<{ success: boolean; plugin?: PluginInfo; error?: string; canceled?: boolean }> => ipcRenderer.invoke(IPC.PLUGIN_INSTALL),
    loadLocal: (path: string): Promise<{ success: boolean; plugin?: PluginInfo; error?: string }> => ipcRenderer.invoke(IPC.PLUGIN_LOAD_LOCAL, path),
    uninstall: (pluginId: string): Promise<{ success: boolean; error?: string }> => ipcRenderer.invoke(IPC.PLUGIN_UNINSTALL, pluginId),
    activate: (pluginId: string): Promise<boolean> => ipcRenderer.invoke(IPC.PLUGIN_ACTIVATE, pluginId),
    deactivate: (pluginId: string): Promise<boolean> => ipcRenderer.invoke(IPC.PLUGIN_DEACTIVATE, pluginId),
    setEnabled: (
      pluginId: string,
      enabled: boolean
    ): Promise<{ success: boolean; plugin?: PluginInfo; error?: string }> =>
      ipcRenderer.invoke(IPC.PLUGIN_SET_ENABLED, pluginId, enabled),
    getManifest: (pluginId: string): Promise<PluginInfo | null> => ipcRenderer.invoke(IPC.PLUGIN_GET_MANIFEST, pluginId),
    openDevGuide: (): Promise<boolean> => ipcRenderer.invoke(IPC.PLUGIN_OPEN_DEV_GUIDE),
    getFormatMap: (): Promise<Record<string, FormatBinding>> =>
      ipcRenderer.invoke(IPC.PLUGIN_GET_FORMAT_MAP),
    onFormatMapChanged: (
      callback: (map: Record<string, FormatBinding>) => void
    ): (() => void) => {
      const handler = (_: unknown, map: Record<string, FormatBinding>) => callback(map)
      ipcRenderer.on(IPC.PLUGIN_FORMAT_MAP_CHANGED_EVENT, handler)
      return () => ipcRenderer.removeListener(IPC.PLUGIN_FORMAT_MAP_CHANGED_EVENT, handler)
    },
    onEvent: (callback: (data: { pluginId: string; event: string; data: unknown }) => void) => {
      const handler = (_: unknown, data: { pluginId: string; event: string; data: unknown }) => callback(data)
      ipcRenderer.on('plugin:event', handler)
      return () => ipcRenderer.removeListener('plugin:event', handler)
    }
  },
  ai: {
    generate: (request: AIRequest): Promise<{ success: boolean; data?: AIResponse; error?: string }> => ipcRenderer.invoke(IPC.AI_GENERATE, request),
    chat: (request: AIRequest): Promise<{ success: boolean; data?: AIResponse; error?: string }> => ipcRenderer.invoke(IPC.AI_CHAT, request),
    transcribe: (audioPath: string): Promise<{ success: boolean; data?: string; error?: string }> => ipcRenderer.invoke(IPC.AI_TRANSCRIBE, audioPath),
    cancel: (conversationId: string): Promise<boolean> => ipcRenderer.invoke(IPC.AI_CANCEL, conversationId),
    settings: (opts?: { provider: string; apiKey: string; model: string; baseUrl: string }): Promise<boolean | { provider: string; apiKey: string; model: string; baseUrl: string }> => ipcRenderer.invoke(IPC.AI_SETTINGS, opts),
    testConfig: (config: Partial<{ provider: string; apiKey: string; model: string; baseUrl: string }>): Promise<{ success: boolean; error?: string }> => ipcRenderer.invoke(IPC.AI_TEST_CONFIG, config),
    /**
     * Start a streaming generation. Calls onChunk for each text chunk,
     * onDone when complete, onError on failure, and optionally
     * onToolExecuted when the AI executes a file-creation tool call.
     * Returns a cancel function that removes all IPC listeners.
     */
    generateStream: (
      request: AIRequest,
      onChunk: (chunk: string) => void,
      onDone: (conversationId: string) => void,
      onError: (error: string) => void,
      onToolExecuted?: (event: AIToolEvent) => void
    ): (() => void) => {
      const chunkHandler = (_: unknown, chunk: string): void => onChunk(chunk)
      const doneHandler = (_: unknown, data: { conversationId: string }): void => {
        cleanup()
        onDone(data.conversationId)
      }
      const errorHandler = (_: unknown, error: string): void => {
        cleanup()
        onError(error)
      }
      const toolHandler = (_: unknown, event: AIToolEvent): void => onToolExecuted?.(event)
      const cleanup = (): void => {
        ipcRenderer.removeListener(IPC.AI_STREAM_CHUNK, chunkHandler)
        ipcRenderer.removeListener(IPC.AI_STREAM_DONE, doneHandler)
        ipcRenderer.removeListener(IPC.AI_STREAM_ERROR, errorHandler)
        ipcRenderer.removeListener(IPC.AI_TOOL_EXECUTED, toolHandler)
      }
      ipcRenderer.on(IPC.AI_STREAM_CHUNK, chunkHandler)
      ipcRenderer.on(IPC.AI_STREAM_DONE, doneHandler)
      ipcRenderer.on(IPC.AI_STREAM_ERROR, errorHandler)
      ipcRenderer.on(IPC.AI_TOOL_EXECUTED, toolHandler)
      ipcRenderer.send(IPC.AI_GENERATE_STREAM, request)
      return cleanup
    }
  },
  settings: {
    get: (): Promise<AppSettings> => ipcRenderer.invoke(IPC.SETTINGS_GET),
    set: (partial: Partial<AppSettings>): Promise<AppSettings> => ipcRenderer.invoke(IPC.SETTINGS_SET, partial)
  },
  storage: {
    testConfig: (
      storage: StorageSettings
    ): Promise<{ success: boolean; provider: string; error?: string }> =>
      ipcRenderer.invoke(IPC.STORAGE_TEST_CONFIG, storage)
  },
  dialog: {
    openFile: (opts?: { title?: string; filters?: Array<{ name: string; extensions: string[] }> }): Promise<string | null> => ipcRenderer.invoke(IPC.DIALOG_OPEN_FILE, opts),
    openDirectory: (opts?: { title?: string }): Promise<string | null> => ipcRenderer.invoke(IPC.DIALOG_OPEN_DIRECTORY, opts),
    saveFile: (opts?: { title?: string; defaultPath?: string; filters?: Array<{ name: string; extensions: string[] }> }): Promise<string | null> => ipcRenderer.invoke(IPC.DIALOG_SAVE_FILE, opts)
  },
  app: {
    getVersion: (): Promise<string> => ipcRenderer.invoke(IPC.APP_GET_VERSION),
    getPaths: (): Promise<{
      userData: string
      documents: string
      downloads: string
      desktop: string
      workspace: string
      builtinPlugins: string
      userPlugins: string
    }> => ipcRenderer.invoke(IPC.APP_GET_PATHS),
    openUrl: (url: string): Promise<boolean> => ipcRenderer.invoke(IPC.APP_OPEN_URL, url),
    checkForUpdates: (): Promise<UpdateCheckResult> =>
      ipcRenderer.invoke(IPC.APP_CHECK_FOR_UPDATES)
  },
  on: {
    noteLoaded: (callback: (data: unknown) => void) => {
      const handler = (_: unknown, data: unknown) => callback(data)
      ipcRenderer.on('note:loaded', handler)
      return () => ipcRenderer.removeListener('note:loaded', handler)
    },
    menuAction: (callback: (action: string) => void) => {
      const handler = (_: unknown, action: string) => callback(action)
      ipcRenderer.on(IPC.MENU_ACTION_EVENT, handler)
      return () => ipcRenderer.removeListener(IPC.MENU_ACTION_EVENT, handler)
    }
  }
}

export type FluxAPI = typeof api

if (process.contextIsolated) {
  try {
    contextBridge.exposeInMainWorld('flux', api)
  } catch (error) {
    console.error(error)
  }
} else {
  // @ts-ignore
  window.flux = api
}
