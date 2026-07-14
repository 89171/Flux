import { contextBridge, ipcRenderer } from 'electron'
import { IPC } from '../shared/ipc-channels'
import type {
  NoteFile,
  PluginInfo,
  AIRequest,
  AIResponse,
  AppSettings,
  FormatBinding,
  FileReadMetaResult,
  FileWriteResult,
  FileChangedEvent
} from '../shared/types'

const api = {
  file: {
    getTree: (): Promise<NoteFile> => ipcRenderer.invoke(IPC.FILE_TREE),
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
    openExternal: (path: string): Promise<boolean> => ipcRenderer.invoke(IPC.FILE_OPEN_EXTERNAL, path)
  },
  window: {
    openNote: (opts: { noteId: string; notePath: string; noteName: string; format: string; content?: string; isPinned?: boolean; opacity?: number; autoCollapse?: boolean }): Promise<unknown> => ipcRenderer.invoke(IPC.WINDOW_OPEN_NOTE, opts),
    pin: (noteId: string, opacity?: number): Promise<boolean> => ipcRenderer.invoke(IPC.WINDOW_PIN, noteId, opacity),
    unpin: (noteId: string): Promise<boolean> => ipcRenderer.invoke(IPC.WINDOW_UNPIN, noteId),
    togglePin: (noteId: string): Promise<boolean> => ipcRenderer.invoke(IPC.WINDOW_TOGGLE_PIN, noteId),
    setOpacity: (noteId: string, opacity: number): Promise<boolean> => ipcRenderer.invoke(IPC.WINDOW_SET_OPACITY, noteId, opacity),
    setAutoCollapse: (noteId: string, enabled: boolean): Promise<boolean> => ipcRenderer.invoke(IPC.WINDOW_SET_AUTO_COLLAPSE, noteId, enabled),
    close: (noteId?: string): Promise<boolean> => ipcRenderer.invoke(IPC.WINDOW_CLOSE, noteId),
    minimize: (): Promise<boolean> => ipcRenderer.invoke(IPC.WINDOW_MINIMIZE),
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
    settings: (opts?: { provider: string; apiKey: string; model: string; baseUrl: string }): Promise<boolean | { provider: string; apiKey: string; model: string; baseUrl: string }> => ipcRenderer.invoke(IPC.AI_SETTINGS, opts)
  },
  settings: {
    get: (): Promise<AppSettings> => ipcRenderer.invoke(IPC.SETTINGS_GET),
    set: (partial: Partial<AppSettings>): Promise<AppSettings> => ipcRenderer.invoke(IPC.SETTINGS_SET, partial)
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
    }> => ipcRenderer.invoke(IPC.APP_GET_PATHS)
  },
  on: {
    noteLoaded: (callback: (data: unknown) => void) => {
      const handler = (_: unknown, data: unknown) => callback(data)
      ipcRenderer.on('note:loaded', handler)
      return () => ipcRenderer.removeListener('note:loaded', handler)
    }
  }
}

export type PaiNoteAPI = typeof api

if (process.contextIsolated) {
  try {
    contextBridge.exposeInMainWorld('painote', api)
  } catch (error) {
    console.error(error)
  }
} else {
  // @ts-ignore
  window.painote = api
}
