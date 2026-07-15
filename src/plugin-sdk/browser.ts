/**
 * Flux plugin-editor browser SDK.
 *
 * Drop this file into your plugin's iframe entry HTML and call
 * `createPluginEditor()` to speak the host protocol without hand-rolling
 * `postMessage` machinery.
 *
 * Basic usage:
 *
 *   <script type="module">
 *     import { createPluginEditor } from './flux-editor.js'
 *     const editor = createPluginEditor({
 *       onInit: ({ content, filePath }) => renderMyUI(content),
 *       onExternalUpdate: ({ content }) => renderMyUI(content),
 *       onThemeChanged: ({ theme }) => setTheme(theme),
 *       onSaveRequested: () => { \/* nothing special — host will read from us *\/ }
 *     })
 *     myTextarea.addEventListener('input', (e) => {
 *       editor.updateContent(e.target.value)
 *     })
 *   </script>
 *
 * The SDK is intentionally standalone — no bundler, no npm install
 * required. Copy this file alongside your plugin's HTML and import it
 * as a plain module.
 */

// The types below mirror `shared/types.ts`. Duplicated here so the SDK
// stays self-contained and doesn't force plugin authors to depend on
// the app's monorepo layout.
export interface InitPayload {
  content: string
  mtime: number | null
  filePath: string
  theme: 'light' | 'dark'
  readonly: boolean
}

export interface ExternalUpdatePayload {
  content: string
  mtime: number
}

export interface ThemeChangedPayload {
  theme: 'light' | 'dark'
}

export interface PluginEditorHandlers {
  /** Fired once, right after the host sends the initial file content. */
  onInit?: (payload: InitPayload) => void
  /**
   * Fired when another window (or an external editor) modified the file
   * that this iframe is showing. Only fires when the user's local
   * changes were already saved — otherwise the host holds the update to
   * avoid clobbering unsaved edits.
   */
  onExternalUpdate?: (payload: ExternalUpdatePayload) => void
  /** Fired when the host's theme toggle flips light/dark. */
  onThemeChanged?: (payload: ThemeChangedPayload) => void
  /**
   * Fired when the user hits Cmd+S. The host reads content from
   * `updateContent()` calls; the plugin usually doesn't need to do
   * anything, but this hook exists in case the plugin wants to flush a
   * pending debounced state before the save lands.
   */
  onSaveRequested?: () => void
}

export interface PluginEditorHandle {
  /**
   * Tell the host the content changed. Debounce this yourself if your
   * editor fires per-keystroke — the host currently stores every value
   * you push into it.
   */
  updateContent(content: string): void
  /** Ask the host to save now. Same effect as the user pressing Cmd+S. */
  requestSave(): void
  /** Bubble a log line to the host devtools console. */
  log(level: 'info' | 'warn' | 'error', ...args: unknown[]): void
  /** Report an unrecoverable error; the host may show a banner. */
  reportError(error: unknown): void
  /** Remove the postMessage listener and stop responding to host events. */
  dispose(): void
}

const PROTOCOL_VERSION = 1

interface HostMessageEnvelope {
  v: number
  type: string
  payload: unknown
}

/**
 * Wire up the postMessage protocol. Must be called from inside the
 * iframe (or a page with a parent window). Sends `ready` immediately;
 * the host replies with `init` on the next tick.
 */
export function createPluginEditor(handlers: PluginEditorHandlers): PluginEditorHandle {
  if (typeof window === 'undefined' || window.parent === window) {
    throw new Error(
      'createPluginEditor must run inside a Flux plugin iframe (window.parent is required).'
    )
  }
  const parent = window.parent

  const listener = (event: MessageEvent): void => {
    if (event.source !== parent) return
    const raw = event.data as HostMessageEnvelope | null
    if (!raw || typeof raw !== 'object' || raw.v !== PROTOCOL_VERSION) return
    switch (raw.type) {
      case 'init':
        handlers.onInit?.(raw.payload as InitPayload)
        break
      case 'externalUpdate':
        handlers.onExternalUpdate?.(raw.payload as ExternalUpdatePayload)
        break
      case 'themeChanged':
        handlers.onThemeChanged?.(raw.payload as ThemeChangedPayload)
        break
      case 'saveRequested':
        handlers.onSaveRequested?.()
        break
      // Unknown message types (from a newer host) are ignored on purpose
      // so forward-compat doesn't require re-releasing plugins.
    }
  }
  window.addEventListener('message', listener)

  const send = (type: string, payload: unknown): void => {
    // targetOrigin '*' is fine — a sandboxed iframe has a null origin so
    // strict matching is impractical, and the payload isn't sensitive
    // (the host is the intended recipient by construction of the frame).
    parent.postMessage({ v: PROTOCOL_VERSION, type, payload }, '*')
  }

  // Signal readiness. The host replies with `init` carrying the content.
  send('ready', {})

  return {
    updateContent(content: string): void {
      send('contentUpdated', { content })
    },
    requestSave(): void {
      send('requestSave', {})
    },
    log(level, ...args): void {
      send('log', { level, args })
    },
    reportError(error: unknown): void {
      const message = error instanceof Error ? error.message : String(error)
      const stack = error instanceof Error ? error.stack : undefined
      send('error', { message, stack })
    },
    dispose(): void {
      window.removeEventListener('message', listener)
    }
  }
}
