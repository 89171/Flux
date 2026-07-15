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
import { FileImage, FileCode } from 'lucide-react'
import mermaid from 'mermaid'
import CodeMirrorEditor from './CodeMirrorEditor'

export interface MermaidEditorProps {
  value: string
  onChange: (data: string) => void
  className?: string
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

export function MermaidEditor({
  value,
  onChange,
  className
}: MermaidEditorProps): JSX.Element {
  const [svg, setSvg] = useState<string>('')
  const [error, setError] = useState<string | null>(null)
  const [isExporting, setIsExporting] = useState(false)
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const onChangeRef = useRef(onChange)
  onChangeRef.current = onChange

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
      const blob = new Blob([svg], { type: 'image/svg+xml' })
      const url = URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = url
      a.download = `diagram-${Date.now()}.svg`
      document.body.appendChild(a)
      a.click()
      document.body.removeChild(a)
      URL.revokeObjectURL(url)
    } catch (err) {
      console.error('[Mermaid] SVG export failed:', err)
    }
  }, [svg])

  const handleExportPng = useCallback(async () => {
    if (!svg) return
    setIsExporting(true)
    try {
      const blob = await svgToPngBlob(svg, 2)
      const url = URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = url
      a.download = `diagram-${Date.now()}.png`
      document.body.appendChild(a)
      a.click()
      document.body.removeChild(a)
      URL.revokeObjectURL(url)
    } catch (err) {
      console.error('[Mermaid] PNG export failed:', err)
    } finally {
      setIsExporting(false)
    }
  }, [svg])

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
        style={{ padding: 16, display: 'flex', justifyContent: 'center' }}
      />
    )
  }, [svg, error])

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
        <div
          style={{
            flex: 1,
            minWidth: 200,
            height: '100%',
            borderRight: '1px solid var(--border-light)',
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
        <div
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

/**
 * Rasterise an SVG string into a PNG blob. Draws the SVG onto a canvas
 * at 2× scale for crisp output. Falls back to a dimensioned canvas if
 * the SVG has no intrinsic width/height.
 */
async function svgToPngBlob(svg: string, scale: number): Promise<Blob> {
  return new Promise<Blob>((resolve, reject) => {
    const svgBlob = new Blob([svg], { type: 'image/svg+xml;charset=utf-8' })
    const url = URL.createObjectURL(svgBlob)
    const img = new Image()
    img.onload = () => {
      try {
        const w = img.naturalWidth || img.width || 800
        const h = img.naturalHeight || img.height || 600
        const canvas = document.createElement('canvas')
        canvas.width = w * scale
        canvas.height = h * scale
        const ctx = canvas.getContext('2d')
        if (!ctx) throw new Error('Canvas 2D context unavailable')
        ctx.fillStyle = isDarkTheme() ? '#1a1a1a' : '#ffffff'
        ctx.fillRect(0, 0, canvas.width, canvas.height)
        ctx.drawImage(img, 0, 0, canvas.width, canvas.height)
        canvas.toBlob((blob) => {
          if (blob) resolve(blob)
          else reject(new Error('toBlob returned null'))
        }, 'image/png')
      } finally {
        URL.revokeObjectURL(url)
      }
    }
    img.onerror = () => {
      URL.revokeObjectURL(url)
      reject(new Error('Failed to load SVG into Image'))
    }
    img.src = url
  })
}

export default MermaidEditor
