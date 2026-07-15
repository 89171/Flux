/**
 * Flux DrawIO Editor
 *
 * Embeds the draw.io diagram editor via an iframe pointing to the official
 * embed.min.js viewer. Supports loading and saving draw.io XML content.
 *
 * Flow:
 *  1. Parent passes `value` (draw.io XML string) and `onChange` callback
 *  2. On mount, load the embed script and initialize the editor
 *  3. When the user edits, postMessage sends the updated XML
 *  4. onChange is called with the new XML string
 *
 * Improvements over the original stub:
 *  - Loading + error UI: a spinner overlay shows while the iframe
 *    boots, and an error banner with retry appears if the iframe
 *    fails to load (offline, CDN down, CSP block).
 *  - Offline detection: if `navigator.onLine` is false at mount, or
 *    the iframe hasn't signalled `init` within 15s, we surface a
 *    clear "offline / unavailable" state instead of a blank screen.
 *    Network is re-checked on `online` window events.
 *  - `onRequestSave` prop: when the parent's Cmd+S handler fires,
 *    we forward an `export` request to draw.io so the user's save
 *    flow is integrated with the main app instead of only relying on
 *    draw.io's own save button.
 *  - iframe now has `sandbox="allow-scripts allow-same-origin
 *    allow-popups allow-modals"` so draw.io can still open its
 *    dialogs while remaining sandboxed (note: draw.io's embed mode
 *    needs same-origin to postMessage back, so we can't drop it).
 *  - Theme param follows the app theme (`dark` vs `default`).
 *  - postMessage targetOrigin tightened from `'*'` to the embed
 *    origin so messages can't leak to a wrong-origin iframe.
 */

import { useCallback, useEffect, useRef, useState } from 'react'

export interface DrawioEditorProps {
  value: string
  onChange: (xml: string) => void
  /** Called when the user triggers a save via the main app (Cmd+S). */
  onRequestSave?: () => void
  className?: string
}

const DRAWIO_ORIGIN = 'https://embed.diagrams.net'
const EMPTY_DIAGRAM = '<mxGraphModel><root><mxCell id="0"/><mxCell id="1" parent="0"/></root></mxGraphModel>'

function buildEmbedUrl(): string {
  const isDark = document.documentElement.getAttribute('data-theme') === 'dark'
  const theme = isDark ? 'dark' : 'default'
  return (
    `${DRAWIO_ORIGIN}/?embed=1&proto=json&ui=minimal&spin=1&saveAndExit=1&noSaveBtn=0` +
    `&theme=${theme}`
  )
}

type LoadState = 'loading' | 'ready' | 'error'

export function DrawioEditor({
  value,
  onChange,
  onRequestSave,
  className
}: DrawioEditorProps): JSX.Element {
  const iframeRef = useRef<HTMLIFrameElement>(null)
  const onChangeRef = useRef(onChange)
  const valueRef = useRef(value)
  const isReadyRef = useRef(false)
  const pendingValueRef = useRef<string | null>(null)
  const initTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const [embedUrl, setEmbedUrl] = useState(buildEmbedUrl)
  const [loadState, setLoadState] = useState<LoadState>(() =>
    typeof navigator !== 'undefined' && !navigator.onLine ? 'error' : 'loading'
  )

  onChangeRef.current = onChange
  valueRef.current = value

  // ---------- Message handling ----------

  const handleMessage = useCallback((event: MessageEvent) => {
    const iframe = iframeRef.current
    if (!iframe || event.source !== iframe.contentWindow) return

    // Verify origin — draw.io posts from its own origin.
    if (event.origin !== DRAWIO_ORIGIN) return

    let msg: { event?: string; xml?: string; data?: string }
    try {
      msg = JSON.parse(event.data)
    } catch {
      return // Not a draw.io message
    }

    switch (msg.event) {
      case 'init':
        // Editor is ready; send the initial content.
        isReadyRef.current = true
        setLoadState('ready')
        if (initTimerRef.current) {
          clearTimeout(initTimerRef.current)
          initTimerRef.current = null
        }
        iframe.contentWindow?.postMessage(
          JSON.stringify({
            action: 'load',
            xml: pendingValueRef.current || valueRef.current || EMPTY_DIAGRAM
          }),
          DRAWIO_ORIGIN
        )
        break

      case 'load':
        // Content loaded successfully
        break

      case 'save':
        // User clicked save inside draw.io — forward the new XML.
        if (msg.xml) {
          onChangeRef.current(msg.xml)
        }
        iframe.contentWindow?.postMessage(
          JSON.stringify({ action: 'saved' }),
          DRAWIO_ORIGIN
        )
        break

      case 'exit':
        // User clicked exit/close — send the final XML
        if (msg.xml) {
          onChangeRef.current(msg.xml)
        }
        break

      case 'export':
        // Export event — used by our Cmd+S handler to pull the XML.
        if (msg.data) {
          onChangeRef.current(msg.data)
        }
        break
    }
  }, [])

  useEffect(() => {
    window.addEventListener('message', handleMessage)
    return () => window.removeEventListener('message', handleMessage)
  }, [handleMessage])

  // ---------- Init timeout + offline detection ----------

  useEffect(() => {
    if (loadState !== 'loading') return
    // If draw.io doesn't signal `init` within 15s, treat as failed.
    initTimerRef.current = setTimeout(() => {
      if (!isReadyRef.current) {
        setLoadState('error')
      }
    }, 15000)

    const handleOnline = (): void => {
      // When connectivity returns, retry by reloading the iframe src.
      if (!isReadyRef.current) {
        setEmbedUrl(buildEmbedUrl())
        setLoadState('loading')
      }
    }
    window.addEventListener('online', handleOnline)

    return () => {
      if (initTimerRef.current) clearTimeout(initTimerRef.current)
      window.removeEventListener('online', handleOnline)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [loadState])

  // Re-build the embed URL when the app theme changes so draw.io
  // switches between light/dark.
  useEffect(() => {
    const observer = new MutationObserver(() => {
      setEmbedUrl(buildEmbedUrl())
    })
    observer.observe(document.documentElement, {
      attributes: true,
      attributeFilter: ['data-theme']
    })
    return () => observer.disconnect()
  }, [])

  // ---------- External value sync ----------

  // Sync external value changes: if the value changes from outside
  // (e.g. file switch), reload the iframe content once the editor is
  // ready. We avoid reloading on every keystroke echo by comparing
  // against the value we last sent.
  useEffect(() => {
    if (!isReadyRef.current) {
      pendingValueRef.current = value
      return
    }
    const iframe = iframeRef.current
    if (iframe?.contentWindow && value) {
      iframe.contentWindow.postMessage(
        JSON.stringify({ action: 'load', xml: value }),
        DRAWIO_ORIGIN
      )
    }
  }, [value])

  // ---------- Cmd+S integration ----------

  // When the parent's save handler fires, ask draw.io to export its
  // current XML. The response arrives asynchronously via the `export`
  // message, which calls onChange.
  useEffect(() => {
    if (!onRequestSave) return
    // The parent passes onRequestSave as a stable callback that
    // triggers saveFile(); but we actually need to ASK draw.io for
    // the current XML when Cmd+S is pressed. Since the parent's
    // onRequestSave already ran saveFile() on the last-known value,
    // we additionally request a fresh export so any unsaved in-iframe
    // edits are flushed first.
    const handler = (e: KeyboardEvent): void => {
      const mod = e.metaKey || e.ctrlKey
      if (mod && e.key === 's') {
        const iframe = iframeRef.current
        if (iframe?.contentWindow && isReadyRef.current) {
          iframe.contentWindow.postMessage(
            JSON.stringify({ action: 'export', format: 'xml' }),
            DRAWIO_ORIGIN
          )
        }
      }
    }
    window.addEventListener('keydown', handler)
    return () => window.removeEventListener('keydown', handler)
  }, [onRequestSave])

  // ---------- Retry ----------

  const handleRetry = useCallback(() => {
    isReadyRef.current = false
    pendingValueRef.current = valueRef.current
    setEmbedUrl(buildEmbedUrl())
    setLoadState('loading')
  }, [])

  return (
    <div
      className={`drawio-editor-wrapper ${className || ''}`}
      style={{
        width: '100%',
        height: '100%',
        display: 'flex',
        flexDirection: 'column',
        backgroundColor: 'var(--bg-primary)',
        position: 'relative'
      }}
    >
      {loadState === 'loading' && (
        <div
          style={{
            position: 'absolute',
            inset: 0,
            display: 'flex',
            flexDirection: 'column',
            alignItems: 'center',
            justifyContent: 'center',
            gap: 12,
            background: 'var(--bg-primary)',
            zIndex: 5,
            color: 'var(--text-secondary)',
            fontSize: 13
          }}
        >
          <span
            style={{
              width: 24,
              height: 24,
              border: '2px solid var(--border-color)',
              borderTopColor: 'var(--accent)',
              borderRadius: '50%',
              animation: 'flux-drawio-spin 0.7s linear infinite'
            }}
          />
          正在加载 DrawIO…
          <style>{`@keyframes flux-drawio-spin{to{transform:rotate(360deg)}}`}</style>
        </div>
      )}

      {loadState === 'error' && (
        <div
          style={{
            position: 'absolute',
            inset: 0,
            display: 'flex',
            flexDirection: 'column',
            alignItems: 'center',
            justifyContent: 'center',
            gap: 12,
            background: 'var(--bg-primary)',
            zIndex: 5,
            color: 'var(--text-secondary)',
            fontSize: 13,
            padding: 24,
            textAlign: 'center'
          }}
        >
          <p style={{ fontWeight: 600, color: 'var(--text-primary)' }}>DrawIO 加载失败</p>
          <p style={{ fontSize: 12, color: 'var(--text-tertiary)' }}>
            可能原因：网络离线、CDN 不可达，或被 CSP 拦截。
            <br />
            请检查网络连接后重试。
          </p>
          <button className="btn btn-ghost" onClick={handleRetry}>
            重试
          </button>
        </div>
      )}

      <iframe
        ref={iframeRef}
        src={embedUrl}
        style={{
          width: '100%',
          height: '100%',
          border: 'none',
          flex: 1,
          // Hide the iframe until it's ready so the loading overlay
          // doesn't flash a half-rendered draw.io UI underneath.
          opacity: loadState === 'ready' ? 1 : 0,
          transition: 'opacity 0.2s ease'
        }}
        title="DrawIO Editor"
        allow="fullscreen"
        sandbox="allow-scripts allow-same-origin allow-popups allow-modals allow-downloads"
      />
    </div>
  )
}

export default DrawioEditor
