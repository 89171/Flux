/**
 * PlantUmlEditor — text-in-left, server-rendered SVG-out-right.
 *
 * PlantUML has no pure-JS renderer; the standard pattern is to encode
 * the source (a lossless deflate + custom base64) and GET
 * `https://www.plantuml.com/plantuml/svg/{encoded}`. That's what
 * plantuml-encoder does, and the SVG comes back over CSP-allowed
 * https: img-src.
 *
 * Requires network — we surface that plainly in the empty state so
 * users don't wonder why nothing renders offline.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import plantumlEncoder from 'plantuml-encoder'

export interface PlantUmlEditorProps {
  value: string
  onChange: (data: string) => void
  className?: string
}

const PLANTUML_SERVER = 'https://www.plantuml.com/plantuml/svg'

export function PlantUmlEditor({
  value,
  onChange,
  className
}: PlantUmlEditorProps): JSX.Element {
  const [source, setSource] = useState(value)
  const [debouncedSource, setDebouncedSource] = useState(value)
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const onChangeRef = useRef(onChange)
  onChangeRef.current = onChange

  // Fold external changes back into the local state without kicking a
  // save round-trip.
  useEffect(() => {
    setSource(value)
    setDebouncedSource(value)
  }, [value])

  // Debounce the encoded-URL update so fast typing doesn't spam the
  // PlantUML server.
  useEffect(() => {
    if (debounceRef.current) clearTimeout(debounceRef.current)
    debounceRef.current = setTimeout(() => setDebouncedSource(source), 400)
    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current)
    }
  }, [source])

  const previewUrl = useMemo(() => {
    const trimmed = debouncedSource.trim()
    if (!trimmed) return ''
    try {
      const encoded = plantumlEncoder.encode(trimmed)
      return `${PLANTUML_SERVER}/${encoded}`
    } catch (err) {
      console.warn('[PlantUML] encode failed:', err)
      return ''
    }
  }, [debouncedSource])

  const handleChange = useCallback((next: string) => {
    setSource(next)
    onChangeRef.current(next)
  }, [])

  return (
    <div
      className={`plantuml-editor-wrapper ${className || ''}`}
      style={{
        width: '100%',
        height: '100%',
        display: 'flex',
        background: 'var(--bg-primary)'
      }}
    >
      <textarea
        value={source}
        onChange={(e) => handleChange(e.target.value)}
        spellCheck={false}
        placeholder={'@startuml\nAlice -> Bob: Hello\n@enduml'}
        style={{
          flex: 1,
          minWidth: 200,
          height: '100%',
          border: 'none',
          outline: 'none',
          resize: 'none',
          padding: 16,
          fontFamily: 'var(--font-mono)',
          fontSize: 13,
          lineHeight: 1.6,
          color: 'var(--text-primary)',
          background: 'var(--bg-primary)',
          borderRight: '1px solid var(--border-light)',
          boxSizing: 'border-box',
          tabSize: 2
        }}
      />
      <div
        style={{
          flex: 1,
          minWidth: 200,
          height: '100%',
          overflow: 'auto',
          background: 'var(--bg-secondary)',
          display: 'flex',
          alignItems: previewUrl ? 'flex-start' : 'center',
          justifyContent: 'center',
          padding: 16,
          boxSizing: 'border-box'
        }}
      >
        {previewUrl ? (
          <img
            src={previewUrl}
            alt="PlantUML preview"
            style={{ maxWidth: '100%', display: 'block' }}
            // The PlantUML server occasionally 500s on malformed input —
            // we swallow the broken-image icon so the panel stays clean.
            onError={(e) => {
              ;(e.target as HTMLImageElement).style.visibility = 'hidden'
            }}
            onLoad={(e) => {
              ;(e.target as HTMLImageElement).style.visibility = 'visible'
            }}
          />
        ) : (
          <div style={{ color: 'var(--text-tertiary)', fontSize: 13, textAlign: 'center' }}>
            在左侧输入 PlantUML 语法开始预览
            <br />
            <span style={{ fontSize: 11, opacity: 0.7 }}>
              预览通过 plantuml.com 服务器渲染，需要网络连接
            </span>
          </div>
        )}
      </div>
    </div>
  )
}

export default PlantUmlEditor
