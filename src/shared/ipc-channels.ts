export const IPC = {
  FILE_READ: 'file:read',
  FILE_READ_META: 'file:readMeta',
  FILE_WRITE: 'file:write',
  FILE_WRITE_GUARDED: 'file:writeGuarded',
  FILE_CREATE: 'file:create',
  FILE_DELETE: 'file:delete',
  FILE_RENAME: 'file:rename',
  FILE_TREE: 'file:tree',
  FILE_MOVE: 'file:move',
  FILE_OPEN_EXTERNAL: 'file:openExternal',
  FILE_REVEAL_IN_FOLDER: 'file:revealInFolder',
  FILE_HISTORY_LIST: 'file:history:list',
  FILE_HISTORY_READ: 'file:history:read',
  FILE_HISTORY_RESTORE: 'file:history:restore',
  /** Broadcast event name (not invoked). Payload: FileChangedEvent. */
  FILE_CHANGED_EVENT: 'file:changed',
  /** Broadcast event when the file tree structure changes. Payload: NoteFile[]. */
  FILE_TREE_CHANGED_EVENT: 'file:treeChanged',
  WINDOW_PIN: 'window:pin',
  WINDOW_UNPIN: 'window:unpin',
  WINDOW_SET_OPACITY: 'window:setOpacity',
  WINDOW_TOGGLE_PIN: 'window:togglePin',
  WINDOW_OPEN_NOTE: 'window:openNote',
  WINDOW_CLOSE: 'window:close',
  WINDOW_MINIMIZE: 'window:minimize',
  WINDOW_SET_AUTO_COLLAPSE: 'window:setAutoCollapse',
  WINDOW_AUTO_LAUNCH: 'window:autoLaunch',
  PLUGIN_LIST: 'plugin:list',
  PLUGIN_INSTALL: 'plugin:install',
  PLUGIN_UNINSTALL: 'plugin:uninstall',
  PLUGIN_ACTIVATE: 'plugin:activate',
  PLUGIN_DEACTIVATE: 'plugin:deactivate',
  /** Persist the user's on/off choice for a builtin plugin. */
  PLUGIN_SET_ENABLED: 'plugin:setEnabled',
  PLUGIN_LOAD_LOCAL: 'plugin:loadLocal',
  PLUGIN_GET_MANIFEST: 'plugin:getManifest',
  PLUGIN_OPEN_DEV_GUIDE: 'plugin:openDevGuide',
  PLUGIN_GET_FORMAT_MAP: 'plugin:getFormatMap',
  /** Broadcast event when the extension → renderer map changes. */
  PLUGIN_FORMAT_MAP_CHANGED_EVENT: 'plugin:formatMapChanged',
  AI_GENERATE: 'ai:generate',
  AI_CHAT: 'ai:chat',
  AI_TRANSCRIBE: 'ai:transcribe',
  AI_CANCEL: 'ai:cancel',
  AI_SETTINGS: 'ai:settings',
  /** Test an unsaved AI config with a minimal round-trip. Payload: Partial<AppSettings['ai']>. Returns { success: boolean; error?: string }. */
  AI_TEST_CONFIG: 'ai:testConfig',
  // Streaming: renderer sends AI_GENERATE_STREAM with an AIRequest;
  // main process emits AI_STREAM_CHUNK (string) for each text chunk,
  // then AI_STREAM_DONE ({ conversationId }) or AI_STREAM_ERROR (string).
  AI_GENERATE_STREAM: 'ai:generateStream',
  AI_STREAM_CHUNK: 'ai:streamChunk',
  AI_STREAM_DONE: 'ai:streamDone',
  AI_STREAM_ERROR: 'ai:streamError',
  /** Broadcast: a tool call executed during a stream. Payload: AIToolEvent. */
  AI_TOOL_EXECUTED: 'ai:toolExecuted',
  SETTINGS_GET: 'settings:get',
  SETTINGS_SET: 'settings:set',
  DIALOG_OPEN_FILE: 'dialog:openFile',
  DIALOG_OPEN_DIRECTORY: 'dialog:openDirectory',
  DIALOG_SAVE_FILE: 'dialog:saveFile',
  APP_GET_VERSION: 'app:getVersion',
  APP_GET_PATHS: 'app:getPaths',
  /** Open an external https URL in the user's default browser. Payload: url string. */
  APP_OPEN_URL: 'app:openUrl',
  /** Check for app updates via GitHub Releases API. Returns UpdateCheckResult. */
  APP_CHECK_FOR_UPDATES: 'app:checkForUpdates',
  /** Search file contents across the workspace. Returns SearchResult[]. */
  FILE_SEARCH: 'file:search',
  /** Broadcast event: a menu item was triggered. Payload: { action: string }. */
  MENU_ACTION_EVENT: 'menu:action',
  /** Export content to PDF. Payload: { content: string, fileName: string }. Returns save path or null. */
  FILE_EXPORT_PDF: 'file:exportPdf',
  /** Export content to HTML. Payload: { content: string, fileName: string }. Returns save path or null. */
  FILE_EXPORT_HTML: 'file:exportHtml',
  /** Save an already-rendered export payload. Returns save path or null. */
  FILE_EXPORT_DATA: 'file:exportData'
} as const

export type IPCChannel = (typeof IPC)[keyof typeof IPC]
