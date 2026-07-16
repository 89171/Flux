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

import { useCallback, useEffect, useMemo, useRef, useState, type CSSProperties } from 'react'
import plantumlEncoder from 'plantuml-encoder'
import { Code, Eye, Columns } from 'lucide-react'

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
  const [viewMode, setViewMode] = useState<'both' | 'editor' | 'preview'>('both')
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
        flexDirection: 'column',
        background: 'var(--bg-primary)'
      }}
    >
      {/* Toolbar */}
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 4,
          padding: '6px 12px',
          borderBottom: '1px solid var(--border-light)',
          background: 'var(--bg-secondary)',
          flexShrink: 0
        }}
      >
        <span style={{ fontSize: 11, color: 'var(--text-tertiary)', marginRight: 'auto', fontFamily: 'var(--font-mono)' }}>
          PlantUML
        </span>
        <button
          onClick={() => setViewMode('editor')}
          title="仅编辑"
          style={{ ...toolbarBtnStyle, background: viewMode === 'editor' ? 'var(--bg-active)' : 'transparent', color: viewMode === 'editor' ? 'var(--text-primary)' : 'var(--text-secondary)' }}
        >
          <Code size={13} />
        </button>
        <button
          onClick={() => setViewMode('both')}
          title="分屏"
          style={{ ...toolbarBtnStyle, background: viewMode === 'both' ? 'var(--bg-active)' : 'transparent', color: viewMode === 'both' ? 'var(--text-primary)' : 'var(--text-secondary)' }}
        >
          <Columns size={13} />
        </button>
        <button
          onClick={() => setViewMode('preview')}
          title="仅预览"
          style={{ ...toolbarBtnStyle, background: viewMode === 'preview' ? 'var(--bg-active)' : 'transparent', color: viewMode === 'preview' ? 'var(--text-primary)' : 'var(--text-secondary)' }}
        >
          <Eye size={13} />
        </button>
      </div>

      <div style={{ flex: 1, display: 'flex', minHeight: 0 }}>
        {viewMode !== 'preview' && (
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
              borderRight: viewMode === 'both' ? '1px solid var(--border-light)' : 'none',
              boxSizing: 'border-box',
              tabSize: 2
            }}
          />
        )}
        {viewMode !== 'editor' && (
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
        )}
      </div>
    </div>
  )
}

const toolbarBtnStyle: CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  gap: 4,
  padding: '4px 8px',
  border: '1px solid var(--border-color)',
  borderRadius: 4,
  background: 'transparent',
  color: 'var(--text-secondary)',
  cursor: 'pointer',
  fontSize: 12,
  fontFamily: 'var(--font-sans)'
}

export default PlantUmlEditor
