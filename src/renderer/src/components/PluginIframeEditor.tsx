/**
 * PluginIframeEditor
 *
 * Mounts a third-party editor inside a sandboxed iframe and speaks the
 * PaiNote plugin-editor postMessage protocol with it.
 *
 * Security posture:
 *   - The iframe uses `sandbox="allow-scripts"` — no allow-same-origin,
 *     no allow-forms, no allow-popups. The plugin's script can run but
 *     the frame has a null origin and cannot access the host DOM,
 *     localStorage, or issue same-origin requests.
 *   - All state flows through `postMessage`. Every inbound message is
 *     matched against the PluginToHostMessage discriminated union;
 *     anything shaped wrong (or from the wrong window) is dropped.
 *
 * Protocol (host ↔ plugin), see shared/types.ts:
 *   Host → Plugin:  init | externalUpdate | themeChanged | saveRequested
 *   Plugin → Host:  ready | contentUpdated | requestSave | log | error
 *
 * The plugin sends `ready` when its script is bootstrapped; we reply
 * with `init` carrying the current content. Every subsequent user edit
 * inside the plugin fires `contentUpdated`, which we bubble via onChange.
 */

import { useEffect, useRef, useState } from 'react'
import type {
  HostToPluginMessage,
  PluginToHostMessage
} from '@shared/types'

export interface PluginIframeEditorProps {
  entryUrl: string
  value: string
  onChange: (content: string) => void
  /** Called when the plugin requests an immediate save. */
  onRequestSave?: () => void
  filePath: string
  mtime: number | null
  theme?: 'light' | 'dark'
  readonly?: boolean
  className?: string
}

/** Runtime shape check for messages coming from the plugin. */
function isPluginMessage(msg: unknown): msg is PluginToHostMessage {
  if (!msg || typeof msg !== 'object') return false
  const m = msg as Record<string, unknown>
  if (m.v !== 1) return false
  if (typeof m.type !== 'string') return false
  return (
    m.type === 'ready' ||
    m.type === 'contentUpdated' ||
    m.type === 'requestSave' ||
    m.type === 'log' ||
    m.type === 'error'
  )
}

export default function PluginIframeEditor({
  entryUrl,
  value,
  onChange,
  onRequestSave,
  filePath,
  mtime,
  theme = 'light',
  readonly = false,
  className
}: PluginIframeEditorProps): JSX.Element {
  const iframeRef = useRef<HTMLIFrameElement>(null)
  const isReadyRef = useRef(false)
  const lastSentValueRef = useRef<string | null>(null)
  const onChangeRef = useRef(onChange)
  const onRequestSaveRef = useRef(onRequestSave)
  onChangeRef.current = onChange
  onRequestSaveRef.current = onRequestSave

  const [pluginError, setPluginError] = useState<string | null>(null)

  // Post a message to the iframe. Wraps the sanity check so misuse from
  // this component (e.g. sending before load) is a no-op instead of a
  // crash.
  const postToPlugin = (message: HostToPluginMessage): void => {
    const iframe = iframeRef.current
    if (!iframe || !iframe.contentWindow) return
    // targetOrigin '*' is acceptable here: the message contents are not
    // sensitive (they're the file the plugin is meant to edit) and the
    // sandboxed iframe's null origin makes a strict match impractical.
    iframe.contentWindow.postMessage(message, '*')
  }

  // Wire the inbound message listener once per iframe lifetime.
  useEffect(() => {
    const handler = (event: MessageEvent): void => {
      const iframe = iframeRef.current
      if (!iframe || event.source !== iframe.contentWindow) return
      if (!isPluginMessage(event.data)) return

      const msg = event.data
      switch (msg.type) {
        case 'ready': {
          isReadyRef.current = true
          lastSentValueRef.current = value
          postToPlugin({
            v: 1,
            type: 'init',
            payload: {
              content: value,
              mtime,
              filePath,
              theme,
              readonly
            }
          })
          break
        }
        case 'contentUpdated': {
          const next = msg.payload.content
          // Ignore echoes of what we just pushed down (init or external
          // update) — otherwise every load creates a false dirty flag.
          if (next === lastSentValueRef.current) return
          lastSentValueRef.current = next
          onChangeRef.current(next)
          break
        }
        case 'requestSave': {
          onRequestSaveRef.current?.()
          break
        }
        case 'log': {
          const { level, args } = msg.payload
          const fn =
            level === 'error'
              ? console.error
              : level === 'warn'
                ? console.warn
                : console.log
          fn(`[plugin-editor]`, ...args)
          break
        }
        case 'error': {
          setPluginError(msg.payload.message)
          console.error(
            '[plugin-editor] plugin reported error:',
            msg.payload.message,
            msg.payload.stack
          )
          break
        }
      }
    }
    window.addEventListener('message', handler)
    return () => window.removeEventListener('message', handler)
    // We rely on refs for the callbacks, so this listener never rebinds
    // after mount. filePath/mtime/theme changes are handled below.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // Push external content changes into the plugin. Skips when the plugin
  // hasn't finished loading (still needs the `init` message) or when the
  // value already matches what we last sent.
  useEffect(() => {
    if (!isReadyRef.current) return
    if (value === lastSentValueRef.current) return
    lastSentValueRef.current = value
    postToPlugin({
      v: 1,
      type: 'externalUpdate',
      payload: { content: value, mtime: mtime ?? 0 }
    })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [value, mtime])

  // Propagate theme changes without reloading the iframe.
  useEffect(() => {
    if (!isReadyRef.current) return
    postToPlugin({ v: 1, type: 'themeChanged', payload: { theme } })
  }, [theme])

  return (
    <div
      className={`plugin-iframe-editor-wrapper ${className || ''}`}
      style={{ width: '100%', height: '100%', position: 'relative' }}
    >
      <iframe
        ref={iframeRef}
        src={entryUrl}
        // No allow-same-origin — plugin gets a null origin and cannot
        // read host cookies / localStorage / same-origin resources.
        sandbox="allow-scripts"
        style={{
          width: '100%',
          height: '100%',
          border: 'none',
          background: 'transparent'
        }}
        // The plugin's title is set by its own <title>; this fallback is
        // only for screen readers when the frame is still loading.
        title="Plugin editor"
      />
      {pluginError && (
        <div
          style={{
            position: 'absolute',
            top: 12,
            right: 12,
            padding: '8px 12px',
            background: 'var(--danger, #e11d48)',
            color: '#fff',
            borderRadius: 6,
            fontSize: 12,
            maxWidth: 360,
            pointerEvents: 'auto'
          }}
        >
          Plugin error: {pluginError}
        </div>
      )}
    </div>
  )
}
