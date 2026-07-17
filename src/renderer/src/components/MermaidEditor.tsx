/**
 * MermaidEditor — text-in-left, live-SVG-out-right.
 *
 * File is plain mermaid source (`.mmd`). Debounced render (250ms) so
 * fast typing doesn't stall the main thread on every keystroke. Each
 * render call gets a unique id (mermaid namespaces its <g> ids and
 * complains if collisions happen when you swap the source in place).
 *
 * Improvements over the original stub:
 *  - Theme follows the app's `data-theme` attribute (live re-init).
 *  - Source editor uses CodeMirror 6 with light/dark theme sync, so
 *    users get line numbers, bracket matching, and consistent syntax
 *    highlighting instead of a bare textarea.
 *  - Toolbar to export the rendered diagram as SVG or PNG.
 *  - Module-level mutable counters are scoped per-instance via a
 *    `useId`-style prefix so multiple windows don't collide.
 */

import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties
} from 'react'
import { FileImage, FileCode, Code, Eye, Columns, ZoomIn, ZoomOut, RotateCcw } from 'lucide-react'
import mermaid from 'mermaid'
import CodeMirrorEditor from './CodeMirrorEditor'
import {
  getExportBaseName,
  saveBlobExport,
  saveTextExport,
  svgToPngBlob
} from '../utils/exportUtils'

export interface MermaidEditorProps {
  value: string
  onChange: (data: string) => void
  className?: string
  fileName?: string
}

type MermaidTheme = 'default' | 'dark'

function isDarkTheme(): boolean {
  return document.documentElement.getAttribute('data-theme') === 'dark'
}

/**
 * One-time init + lazy re-init when the app theme flips. Mermaid does
 * not pick up theme changes after `initialize`, so we re-initialise
 * with the new theme and force a re-render of the current source.
 */
let currentTheme: MermaidTheme | null = null
function ensureInit(theme: MermaidTheme): void {
  if (currentTheme === theme) return
  mermaid.initialize({
    startOnLoad: false,
    theme,
    securityLevel: 'strict',
    suppressErrorRendering: true
  })
  currentTheme = theme
}

const PREVIEW_ZOOM_MIN = 0.25
const PREVIEW_ZOOM_MAX = 3
const PREVIEW_ZOOM_STEP = 0.25

function clampPreviewZoom(value: number): number {
  return Math.min(PREVIEW_ZOOM_MAX, Math.max(PREVIEW_ZOOM_MIN, value))
}

export function MermaidEditor({
  value,
  onChange,
  className,
  fileName = 'diagram.mmd'
}: MermaidEditorProps): JSX.Element {
  const [svg, setSvg] = useState<string>('')
  const [error, setError] = useState<string | null>(null)
  const [isExporting, setIsExporting] = useState(false)
  const [viewMode, setViewMode] = useState<'both' | 'editor' | 'preview'>('both')
  const [previewZoom, setPreviewZoom] = useState(1)
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const onChangeRef = useRef(onChange)
  onChangeRef.current = onChange
  const exportBaseName = getExportBaseName(fileName)

  // Per-instance render counter — avoids cross-window id collisions
  // when two Flux windows render mermaid concurrently.
  const instanceIdRef = useRef<string>(
    `mmd-${Math.random().toString(36).slice(2, 8)}`
  )
  const renderCounterRef = useRef(0)

  const theme: MermaidTheme = isDarkTheme() ? 'dark' : 'default'

  // Keep mermaid's theme in sync with the app theme. Re-render the
  // current source after a theme switch so colors update live.
  useEffect(() => {
    ensureInit(theme)
    void render(value)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [theme])

  // Debounced render. We render into a detached container-id string
  // that mermaid uses internally — the returned SVG is what we inject.
  const render = useCallback(async (text: string) => {
    ensureInit(isDarkTheme() ? 'dark' : 'default')
    const trimmed = text.trim()
    if (!trimmed) {
      setSvg('')
      setError(null)
      return
    }
    try {
      const id = `${instanceIdRef.current}-${++renderCounterRef.current}`
      const result = await mermaid.render(id, trimmed)
      setSvg(result.svg)
      setError(null)
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    }
  }, [])

  // Re-render when the source changes (debounced via the CodeMirror
  // onChange, which fires per-keystroke). We add a small debounce here
  // too so chained edits don't queue up renders.
  useEffect(() => {
    if (debounceRef.current) clearTimeout(debounceRef.current)
    debounceRef.current = setTimeout(() => {
      void render(value)
    }, 250)
    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current)
    }
  }, [value, render])

  // ---------- Export ----------

  const handleExportSvg = useCallback(async () => {
    if (!svg) return
    try {
      await saveTextExport({
        title: '导出 SVG',
        defaultPath: `${exportBaseName}.svg`,
        filters: [{ name: 'SVG', extensions: ['svg'] }],
        data: svg
      })
    } catch (err) {
      console.error('[Mermaid] SVG export failed:', err)
    }
  }, [svg, exportBaseName])

  const handleExportPng = useCallback(async () => {
    if (!svg) return
    setIsExporting(true)
    try {
      const blob = await svgToPngBlob(svg, 2, isDarkTheme() ? '#1a1a1a' : '#ffffff')
      await saveBlobExport({
        title: '导出 PNG',
        defaultPath: `${exportBaseName}.png`,
        filters: [{ name: 'PNG', extensions: ['png'] }],
        blob
      })
    } catch (err) {
      console.error('[Mermaid] PNG export failed:', err)
    } finally {
      setIsExporting(false)
    }
  }, [svg, exportBaseName])

  const previewNode = useMemo(() => {
    if (error) {
      return (
        <div
          style={{
            padding: 16,
            color: 'var(--color-error, #ef4444)',
            fontFamily: 'var(--font-mono)',
            fontSize: 12,
            whiteSpace: 'pre-wrap'
          }}
        >
          {error}
        </div>
      )
    }
    if (!svg) {
      return (
        <div style={{ padding: 16, color: 'var(--text-tertiary)', fontSize: 13 }}>
          在左侧输入 Mermaid 语法开始预览
        </div>
      )
    }
    // svg is generated by mermaid.render from user text; mermaid v11
    // with securityLevel:'strict' escapes user text before inlining, so
    // the resulting SVG contains no active content.
    return (
      <div
        // eslint-disable-next-line react/no-danger
        dangerouslySetInnerHTML={{ __html: svg }}
        style={{
          padding: 16,
          display: 'flex',
          justifyContent: 'center',
          minWidth: 'max-content',
          zoom: previewZoom
        } as CSSProperties}
      />
    )
  }, [svg, error, previewZoom])

  return (
    <div
      className={`mermaid-editor-wrapper ${className || ''}`}
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
        <span
          style={{
            fontSize: 11,
            color: 'var(--text-tertiary)',
            marginRight: 'auto',
            fontFamily: 'var(--font-mono)'
          }}
        >
          Mermaid
        </span>
        {/* View mode toggles */}
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
        <div style={{ width: 1, height: 16, background: 'var(--border-light)', margin: '0 4px' }} />
        {viewMode !== 'editor' && (
          <>
            <button
              onClick={() => setPreviewZoom((zoom) => clampPreviewZoom(zoom - PREVIEW_ZOOM_STEP))}
              disabled={previewZoom <= PREVIEW_ZOOM_MIN}
              title="缩小预览"
              style={toolbarBtnStyle}
            >
              <ZoomOut size={13} />
            </button>
            <button
              onClick={() => setPreviewZoom(1)}
              title="重置缩放"
              style={toolbarBtnStyle}
            >
              <RotateCcw size={13} />
              <span>{Math.round(previewZoom * 100)}%</span>
            </button>
            <button
              onClick={() => setPreviewZoom((zoom) => clampPreviewZoom(zoom + PREVIEW_ZOOM_STEP))}
              disabled={previewZoom >= PREVIEW_ZOOM_MAX}
              title="放大预览"
              style={toolbarBtnStyle}
            >
              <ZoomIn size={13} />
            </button>
            <div style={{ width: 1, height: 16, background: 'var(--border-light)', margin: '0 4px' }} />
          </>
        )}
        <button
          onClick={handleExportSvg}
          disabled={!svg}
          title="导出 SVG"
          style={toolbarBtnStyle}
        >
          <FileCode size={13} />
          <span>SVG</span>
        </button>
        <button
          onClick={handleExportPng}
          disabled={!svg || isExporting}
          title="导出 PNG"
          style={toolbarBtnStyle}
        >
          <FileImage size={13} />
          <span>{isExporting ? '导出中…' : 'PNG'}</span>
        </button>
      </div>

      <div style={{ flex: 1, display: 'flex', minHeight: 0 }}>
        {viewMode !== 'preview' && (
          <div
            style={{
              flex: 1,
              minWidth: 200,
              height: '100%',
              borderRight: viewMode === 'both' ? '1px solid var(--border-light)' : 'none',
              boxSizing: 'border-box',
              overflow: 'hidden'
            }}
          >
            <CodeMirrorEditor
              value={value}
              onChange={onChangeRef.current}
              fileName="diagram.mmd"
              fontSize={13}
            />
          </div>
        )}
        {viewMode !== 'editor' && (
          <div
            onWheel={(e) => {
              if (!e.metaKey && !e.ctrlKey) return
              e.preventDefault()
              setPreviewZoom((zoom) =>
                clampPreviewZoom(zoom + (e.deltaY > 0 ? -PREVIEW_ZOOM_STEP : PREVIEW_ZOOM_STEP))
              )
            }}
            style={{
              flex: 1,
              minWidth: 200,
              height: '100%',
              overflow: 'auto',
              background: 'var(--bg-secondary)'
            }}
          >
            {previewNode}
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

export default MermaidEditor
