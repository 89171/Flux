/**
 * Flux Shared Types
 */

// ============ Note & File Types ============

export interface NoteFile {
  id: string
  name: string
  path: string
  type: 'file' | 'directory'
  format?: NoteFormat
  content?: string
  children?: NoteFile[]
  createdAt: number
  updatedAt: number
}

export type NoteFormat = 'markdown' | 'drawio' | 'mindmap' | 'plaintext' | string

/**
 * File read result including modification time. Used by callers that need
 * to guard subsequent writes against external modification (e.g. another
 * window writing the same file).
 */
export interface FileReadMetaResult {
  content: string
  mtime: number
}

/**
 * File write outcome. `conflict: true` means the write was refused because
 * the file's on-disk mtime advanced past `expectedMtime` — usually because
 * another window (or an external editor) modified the file first.
 */
export type FileWriteResult =
  | { ok: true; mtime: number }
  | { ok: false; conflict: true; diskMtime: number }

/** Payload broadcast to every renderer after a successful guarded write. */
export interface FileChangedEvent {
  path: string
  mtime: number
  /** Content is included so subscribers can refresh without a round-trip. */
  content: string
}

// ============ Plugin System Types ============

export interface PluginManifest {
  id: string
  name: string
  version: string
  author: string
  description: string
  type: 'format' | 'tool' | 'theme'
  extensions?: string[]
  /**
   * The single extension to show in the sidebar's "New File" dropdown.
   * All entries in `extensions[]` are still bound (openable, tree icons,
   * routing) — this only trims the picker so a plugin with several
   * aliases (e.g. "md" / "markdown" / "mdx") shows as one entry.
   * Defaults to `extensions[0]` if omitted.
   */
  primaryExtension?: string
  /**
   * For `type: 'format'` plugins, picks which built-in editor UI handles
   * files owned by this plugin. Third parties can either reuse a built-in
   * (this field) OR ship their own iframe editor (see `editor` below).
   * If both are set, `editor` wins for each extension it claims.
   * Defaults to `'plaintext'` if neither is set.
   */
  formatBinding?: BuiltinRendererId
  /**
   * Optional custom editor UI shipped by the plugin. When present the host
   * mounts a sandboxed iframe at `entry` (resolved to a `file://` URL
   * inside the plugin dir at load time) and speaks the PluginEditor
   * postMessage protocol with it. The iframe cannot access the host DOM
   * or the workspace directly — all state flows through the protocol.
   */
  editor?: {
    /** Path to the iframe HTML entry, relative to the plugin dir. */
    entry: string
    /**
     * Extensions this editor handles. If omitted, uses top-level
     * `extensions`. Useful when a plugin ships different editors for
     * different extensions from the same bundle.
     */
    extensions?: string[]
  }
  main: string
  /**
   * Plugin's own branding icon — shown in the plugin market and the "new
   * file" picker. May be a lucide icon name (e.g. "FileText") or a path
   * relative to the plugin dir (converted to a file:// URL at load time).
   */
  icon?: string
  /**
   * Icon used for FILES owned by this plugin in the sidebar tree. Same
   * resolution rules as `icon`. Falls back to `icon` if omitted — set it
   * only when the file's icon should differ from the plugin's branding.
   */
  fileIcon?: string
  builtin?: boolean
  minAppVersion?: string
  /**
   * Plugin ABI version the plugin was built against. Compared against
   * SDK_ABI_VERSION at load time; incompatible plugins are rejected with a
   * clear error instead of exploding at first API call.
   */
  sdkVersion?: string
  /**
   * Whether the app should activate this plugin at boot when the user
   * has no explicit choice recorded. Defaults to `true` (backwards
   * compatible with existing builtins). Set to `false` for built-in
   * plugins that ship with the app but should be opt-in — they'll show
   * in the plugin market so users can enable them, without paying the
   * activation cost by default.
   */
  autoActivate?: boolean
  homepage?: string
  license?: string
  /**
   * Capability whitelist. Plugin API calls that require a capability throw
   * unless it is listed here. Omitted (or empty) = plugin can only log and
   * register no-op commands. Builtin plugins get all permissions implicitly.
   */
  permissions?: PluginPermission[]
}

/**
 * The set of editor UIs the app ships. Format plugins bind their file
 * extensions to one of these — they don't ship their own editor code
 * (that's the iframe-editor path via `manifest.editor`).
 */
export type BuiltinRendererId =
  | 'markdown'
  | 'drawio'
  | 'mindmap'
  | 'plaintext'
  | 'whiteboard'
  | 'excalidraw'
  | 'kanban'
  | 'mermaid'
  | 'plantuml'
  | 'bpmn'
  | 'dmn'

export type PluginPermission =
  | 'fs:read'
  | 'fs:write'
  | 'notifications'
  | 'commands'
  | 'events'

export type PluginStatus =
  | 'installed'
  | 'active'
  | 'inactive'
  | 'error'
  | 'installing'
  | 'activating'
  | 'deactivating'

export interface PluginInfo extends PluginManifest {
  status: PluginStatus
  installPath: string
  isBuiltin: boolean
  errorMessage?: string
  /**
   * When `manifest.editor` is set and passes validation, this is the
   * absolute `file://` URL the host will load into the iframe. Resolved
   * at install / discovery time and guarded against traversal.
   */
  editorEntryUrl?: string
}

/**
 * Wire shape sent from main → renderer for the extension → editor
 * lookup. Discriminated union so the renderer knows whether to mount a
 * built-in editor component or an iframe pointing at plugin code.
 */
export type FormatBinding =
  | {
      kind: 'builtin'
      renderer: BuiltinRendererId
      pluginId: string
      fileIcon?: string
    }
  | {
      kind: 'plugin-editor'
      pluginId: string
      /** Absolute file:// URL of the iframe entry HTML. */
      entryUrl: string
      fileIcon?: string
    }

/**
 * Protocol messages exchanged between the host renderer and a plugin
 * iframe editor. Kept explicit so the postMessage handler can validate
 * every incoming payload — anything not matching this shape is dropped.
 */
export type HostToPluginMessage =
  | {
      v: 1
      type: 'init'
      payload: {
        content: string
        mtime: number | null
        filePath: string
        theme: 'light' | 'dark'
        readonly: boolean
      }
    }
  | { v: 1; type: 'externalUpdate'; payload: { content: string; mtime: number } }
  | { v: 1; type: 'themeChanged'; payload: { theme: 'light' | 'dark' } }
  | { v: 1; type: 'saveRequested'; payload: Record<string, never> }

export type PluginToHostMessage =
  | { v: 1; type: 'ready'; payload: Record<string, never> }
  | { v: 1; type: 'contentUpdated'; payload: { content: string } }
  | { v: 1; type: 'requestSave'; payload: Record<string, never> }
  | { v: 1; type: 'log'; payload: { level: 'info' | 'warn' | 'error'; args: unknown[] } }
  | { v: 1; type: 'error'; payload: { message: string; stack?: string } }

// ============ Window Types ============

export interface NoteWindowState {
  noteId: string
  notePath: string
  noteName: string
  format: NoteFormat
  isPinned: boolean
  opacity: number
  bounds: { x: number; y: number; width: number; height: number }
}

export interface PinConfig {
  alwaysOnTop: boolean
  opacity: number
  autoCollapse: boolean
  autoLaunch: boolean
}

// ============ AI Types ============

export interface AIRequest {
  prompt: string
  format: NoteFormat
  context?: string
  attachments?: AIAttachment[]
  conversationId?: string
}

export interface AIAttachment {
  type: 'file' | 'image' | 'audio'
  path: string
  name: string
}

export interface AIResponse {
  content: string
  format: NoteFormat
  conversationId: string
  usage?: {
    promptTokens: number
    completionTokens: number
  }
}

export interface AIMessage {
  role: 'user' | 'assistant'
  content: string
  timestamp: number
}

export interface AIConversation {
  id: string
  noteId: string
  messages: AIMessage[]
  createdAt: number
}

// ============ Settings ============

export interface AppSettings {
  workspacePath: string
  ai: {
    provider: 'openai' | 'anthropic' | 'deepseek' | 'kimi' | 'minimax' | 'glm' | 'local' | 'none'
    apiKey: string
    model: string
    baseUrl: string
  }
  pin: PinConfig
  theme: 'light' | 'dark'
  /**
   * User's explicit enable/disable choice per plugin. Missing entries
   * fall back to the plugin's manifest.autoActivate default. Written
   * every time the user toggles from the market UI.
   */
  pluginState?: Record<string, { enabled: boolean }>
}

// ============ Update Check Types ============

export interface UpdateCheckResult {
  hasUpdate: boolean
  currentVersion: string
  latestVersion: string
  releaseUrl: string
  releaseNotes: string
}

// ============ Search Types ============

export interface SearchResult {
  path: string
  name: string
  line: number
  lineText: string
  matchStart: number
  matchEnd: number
}
