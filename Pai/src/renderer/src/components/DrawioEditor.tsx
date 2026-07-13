/**
 * PaiNote DrawIO Editor
 *
 * Embeds the draw.io diagram editor via an iframe pointing to the official
 * embed.min.js viewer. Supports loading and saving draw.io XML content.
 *
 * Flow:
 *  1. Parent passes `value` (draw.io XML string) and `onChange` callback
 *  2. On mount, load the embed script and initialize the editor
 *  3. When the user edits, postMessage sends the updated XML
 *  4. onChange is called with the new XML string
 */

import { useEffect, useRef, useCallback } from 'react'

export interface DrawioEditorProps {
  value: string
  onChange: (xml: string) => void
  className?: string
}

// The draw.io embed URL (official CDN, no API key needed)
const DRAWIO_EMBED_URL = 'https://embed.diagrams.net/?embed=1&proto=json&ui=minimal&spin=1&saveAndExit=1&noSaveBtn=0'

export function DrawioEditor({ value, onChange, className }: DrawioEditorProps): JSX.Element {
  const iframeRef = useRef<HTMLIFrameElement>(null)
  const onChangeRef = useRef(onChange)
  const valueRef = useRef(value)
  const isReadyRef = useRef(false)
  const pendingValueRef = useRef<string | null>(null)

  onChangeRef.current = onChange
  valueRef.current = value

  // Handle messages from the draw.io iframe
  const handleMessage = useCallback((event: MessageEvent) => {
    const iframe = iframeRef.current
    if (!iframe || event.source !== iframe.contentWindow) return

    let msg
    try {
      msg = JSON.parse(event.data)
    } catch {
      return // Not a draw.io message
    }

    switch (msg.event) {
      case 'init':
        // Editor is ready, send the initial content
        isReadyRef.current = true
        iframe.contentWindow?.postMessage(
          JSON.stringify({
            action: 'load',
            xml: pendingValueRef.current || valueRef.current || '<mxGraphModel><root><mxCell id="0"/><mxCell id="1" parent="0"/></root></mxGraphModel>'
          }),
          '*'
        )
        break

      case 'load':
        // Content loaded successfully
        break

      case 'save':
        // User clicked save — update the parent with the new XML
        if (msg.xml) {
          onChangeRef.current(msg.xml)
        }
        // Acknowledge the save
        iframe.contentWindow?.postMessage(
          JSON.stringify({ action: 'saved' }),
          '*'
        )
        break

      case 'exit':
        // User clicked exit/close — send the final XML
        if (msg.xml) {
          onChangeRef.current(msg.xml)
        }
        break

      case 'export':
        // Export event (e.g., when using export action)
        if (msg.data) {
          onChangeRef.current(msg.data)
        }
        break
    }
  }, [])

  // Set up message listener
  useEffect(() => {
    window.addEventListener('message', handleMessage)
    return () => window.removeEventListener('message', handleMessage)
  }, [handleMessage])

  // Sync external value changes: if the value changes from outside (e.g., file switch),
  // reload the iframe content
  useEffect(() => {
    if (!isReadyRef.current) {
      pendingValueRef.current = value
      return
    }

    // Only reload if the value is different from what we last sent
    const iframe = iframeRef.current
    if (iframe?.contentWindow && value) {
      iframe.contentWindow.postMessage(
        JSON.stringify({ action: 'load', xml: value }),
        '*'
      )
    }
  }, [value])

  return (
    <div
      className={`drawio-editor-wrapper ${className || ''}`}
      style={{
        width: '100%',
        height: '100%',
        display: 'flex',
        flexDirection: 'column',
        backgroundColor: 'var(--bg-primary)'
      }}
    >
      <iframe
        ref={iframeRef}
        src={DRAWIO_EMBED_URL}
        style={{
          width: '100%',
          height: '100%',
          border: 'none',
          flex: 1
        }}
        title="DrawIO Editor"
        allow="fullscreen"
      />
    </div>
  )
}

export default DrawioEditor
