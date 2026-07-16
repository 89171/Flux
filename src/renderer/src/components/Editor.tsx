/**
 * Flux Editor Component
 *
 * Main note editor area with toolbar and content editing.
 * Supports markdown (WYSIWYG via Milkdown) and non-markdown formats (textarea).
 * Features: drag & drop files, keyboard save shortcut, AI generate, pin to desktop.
 */

import { Component, useCallback, useState, useEffect, lazy, Suspense, type ReactNode } from 'react'
import {
  Save,
  Pin,
  ExternalLink,
  Sparkles,
  FileText,
  List as ListIcon,
  Download
} from 'lucide-react'
import MarkdownEditor from './MilkdownEditor'
import PluginIframeEditor from './PluginIframeEditor'
import CodeMirrorEditor from './CodeMirrorEditor'
import Outline from './Outline'
import EditorContextMenu, { type ContextMenuItem } from './EditorContextMenu'
// Heavy editors are code-split so users who never open these file types
// don't pay the download cost. Vite emits a separate chunk per import().
//  - DrawioEditor     : minimal (iframe), but kept lazy for consistency
//  - MindmapEditor    : mind-elixir (~200KB)
//  - WhiteboardEditor : tldraw (~3MB)
//  - ExcalidrawEditor : @excalidraw/excalidraw (~1MB)
//  - KanbanEditor     : marked (~50KB) + React
//  - PlantUmlEditor   : plantuml-encoder (~10KB)
//  - MermaidEditor    : mermaid (~1MB)
//  - BpmnEditor       : bpmn-js (~600KB)
//  - DmnEditor        : dmn-js (~900KB)
const DrawioEditor = lazy(() => import('./DrawioEditor'))
const MindmapEditor = lazy(() => import('./MindmapEditor'))
const WhiteboardEditor = lazy(() => import('./WhiteboardEditor'))
const ExcalidrawEditor = lazy(() => import('./ExcalidrawEditor'))
const KanbanEditor = lazy(() => import('./KanbanEditor'))
const PlantUmlEditor = lazy(() => import('./PlantUmlEditor'))
const MermaidEditor = lazy(() => import('./MermaidEditor'))
const BpmnEditor = lazy(() => import('./BpmnEditor'))
const DmnEditor = lazy(() => import('./DmnEditor'))
import { useFileStore } from '../stores/fileStore'
import { useAIStore } from '../stores/aiStore'
import { usePluginStore } from '../stores/pluginStore'
import FindReplace from './FindReplace'
import type { FormatBinding, NoteFormat } from '@shared/types'

/**
 * Error boundary that catches chunk-load failures (network) and runtime
 * crashes from any single editor. Without this, one failing lazy chunk
 * takes down the whole editor area.
 */
interface ErrorBoundaryState {
  error: Error | null
}
class EditorErrorBoundary extends Component<
  { children: ReactNode; onReset: () => void },
  ErrorBoundaryState
> {
  state: ErrorBoundaryState = { error: null }
  static getDerivedStateFromError(error: Error): ErrorBoundaryState {
    return { error }
  }
  componentDidCatch(error: Error): void {
    console.error('[Editor] renderer crashed:', error)
  }
  render(): ReactNode {
    if (this.state.error) {
      return (
        <div
          style={{
            display: 'flex',
            flexDirection: 'column',
            alignItems: 'center',
            justifyContent: 'center',
            height: '100%',
            gap: 12,
            padding: 24,
            color: 'var(--text-secondary)',
            fontSize: 13
          }}
        >
          <p style={{ fontWeight: 600, color: 'var(--text-primary)' }}>编辑器加载失败</p>
          <p style={{ fontSize: 12, color: 'var(--text-tertiary)', textAlign: 'center' }}>
            {this.state.error.message}
          </p>
          <button
            className="btn btn-ghost"
            onClick={() => {
              this.setState({ error: null })
              this.props.onReset()
            }}
          >
            重试
          </button>
        </div>
      )
    }
    return this.props.children
  }
}

/** Placeholder shown while a lazy-loaded editor chunk downloads. */
function LazyEditorFallback(): JSX.Element {
  return (
    <div
      style={{
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        height: '100%',
        color: 'var(--text-tertiary)',
        fontSize: 13,
        gap: 8
      }}
    >
      <span
        style={{
          width: 14,
          height: 14,
          border: '2px solid var(--border-color)',
          borderTopColor: 'var(--accent)',
          borderRadius: '50%',
          animation: 'flux-spin 0.7s linear infinite'
        }}
      />
      Loading editor…
      <style>{`@keyframes flux-spin{to{transform:rotate(360deg)}}`}</style>
    </div>
  )
}

/**
 * Determines the note format from a file extension.
 */
/**
 * Extension → renderer resolution against the active plugin format map.
 * Falls back to plaintext when no plugin claims the extension. The map
 * is authoritative — do NOT re-introduce a hardcoded switch, callers
 * should consult usePluginStore's `formatMap`.
 */
function getFormatFromExtension(
  filename: string,
  formatMap: Record<string, FormatBinding>
): NoteFormat {
  const ext = filename.split('.').pop()?.toLowerCase() || ''
  const binding = formatMap[ext]
  if (!binding) return 'plaintext'
  if (binding.kind === 'builtin') return binding.renderer
  // Plugin-editor extensions label themselves with the raw extension
  // (e.g. "json") — routing to the iframe editor uses the binding
  // object directly, not this string.
  return ext
}

/**
 * Returns a display-friendly label for the format badge.
 */
function formatLabel(format?: NoteFormat): string {
  if (!format) return 'TXT'
  switch (format) {
    case 'markdown':
      return 'MD'
    case 'drawio':
      return 'DrawIO'
    case 'mindmap':
      return 'Mindmap'
    case 'whiteboard':
      return 'Whiteboard'
    case 'excalidraw':
      return 'Excalidraw'
    case 'kanban':
      return 'Kanban'
    case 'mermaid':
      return 'Mermaid'
    case 'plantuml':
      return 'PlantUML'
    case 'bpmn':
      return 'BPMN'
    case 'dmn':
      return 'DMN'
    case 'plaintext':
      return 'TXT'
    default:
      return format.toUpperCase()
  }
}

const DEFAULT_FONT_SIZE = 16
const MIN_FONT_SIZE = 10
const MAX_FONT_SIZE = 28
const FONT_SIZE_STEP = 2

export default function Editor(): JSX.Element {
  const currentFile = useFileStore((s) => s.currentFile)
  const currentContent = useFileStore((s) => s.currentContent)
  const currentMtime = useFileStore((s) => s.currentMtime)
  const setContent = useFileStore((s) => s.setContent)
  const saveFile = useFileStore((s) => s.saveFile)
  const isDirty = useFileStore((s) => s.isDirty)
  const hasConflict = useFileStore((s) => s.hasConflict)
  const reloadCurrent = useFileStore((s) => s.reloadCurrent)
  const fileError = useFileStore((s) => s.fileError)
  const clearError = useFileStore((s) => s.clearError)
  const isGenerating = useAIStore((s) => s.isGenerating)
  const formatMap = usePluginStore((s) => s.formatMap)

  const [isDragOver, setIsDragOver] = useState(false)
  const [isPinned, setIsPinned] = useState(false)
  const [fontSize, setFontSize] = useState(DEFAULT_FONT_SIZE)
  const [showFindReplace, setShowFindReplace] = useState(false)
  const [findReplaceMode, setFindReplaceMode] = useState<'find' | 'replace'>('find')
  const [showOutline, setShowOutline] = useState(false)
  const [contextMenu, setContextMenu] = useState<{ x: number; y: number; items: ContextMenuItem[] } | null>(null)
  // Bumped whenever the user clicks "retry" in the error boundary —
  // forces a remount of the lazy editor subtree.
  const [rendererKey, setRendererKey] = useState(0)

  // Look up the binding for the currently open file. The binding drives
  // which editor gets mounted; the string `format` field on NoteFile is
  // only for UI labels (badge, "new file" menu icons).
  const currentExt = currentFile?.name.split('.').pop()?.toLowerCase() ?? ''
  const currentBinding: FormatBinding | undefined = currentFile
    ? formatMap[currentExt]
    : undefined
  const isMarkdown =
    currentBinding?.kind === 'builtin' && currentBinding.renderer === 'markdown'
  const format = currentFile?.format

  // Keyboard shortcuts: Cmd/Ctrl+S to save, Cmd/Ctrl+/-/0 to zoom, Cmd/Ctrl+F/H find/replace
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.isComposing || e.keyCode === 229) return
      const mod = e.metaKey || e.ctrlKey
      if (mod && e.key === 's') {
        e.preventDefault()
        saveFile()
      }
      if (mod && (e.key === '=' || e.key === '+')) {
        e.preventDefault()
        setFontSize((prev) => Math.min(prev + FONT_SIZE_STEP, MAX_FONT_SIZE))
      }
      if (mod && e.key === '-') {
        e.preventDefault()
        setFontSize((prev) => Math.max(prev - FONT_SIZE_STEP, MIN_FONT_SIZE))
      }
      if (mod && e.key === '0') {
        e.preventDefault()
        setFontSize(DEFAULT_FONT_SIZE)
      }
      if (mod && !e.shiftKey && e.key === 'f') {
        e.preventDefault()
        setFindReplaceMode('find')
        setShowFindReplace(true)
      }
      if (mod && (e.key === 'h' || (e.shiftKey && e.key === 'H'))) {
        e.preventDefault()
        setFindReplaceMode('replace')
        setShowFindReplace(true)
      }
    }
    window.addEventListener('keydown', handler)
    return () => window.removeEventListener('keydown', handler)
  }, [saveFile])

  // Listen for find/replace and zoom events from menu/command palette
  useEffect(() => {
    const findHandler = (e: Event) => {
      const detail = (e as CustomEvent).detail as string
      setFindReplaceMode(detail === 'replace' ? 'replace' : 'find')
      setShowFindReplace(true)
    }
    const zoomHandler = (e: Event) => {
      const detail = (e as CustomEvent).detail as string
      if (detail === 'in') setFontSize((p) => Math.min(p + FONT_SIZE_STEP, MAX_FONT_SIZE))
      if (detail === 'out') setFontSize((p) => Math.max(p - FONT_SIZE_STEP, MIN_FONT_SIZE))
      if (detail === 'reset') setFontSize(DEFAULT_FONT_SIZE)
    }
    window.addEventListener('flux:find', findHandler)
    window.addEventListener('flux:zoom', zoomHandler)
    return () => {
      window.removeEventListener('flux:find', findHandler)
      window.removeEventListener('flux:zoom', zoomHandler)
    }
  }, [])

  // Drag & drop external files
  const handleDragOver = useCallback((e: React.DragEvent) => {
    e.preventDefault()
    e.stopPropagation()
    setIsDragOver(true)
  }, [])

  const handleDragLeave = useCallback((e: React.DragEvent) => {
    e.preventDefault()
    e.stopPropagation()
    setIsDragOver(false)
  }, [])

  const handleDrop = useCallback(
    (e: React.DragEvent) => {
      e.preventDefault()
      e.stopPropagation()
      setIsDragOver(false)

      // Check for external file drops (files with .path from Electron)
      const files = e.dataTransfer.files
      if (files && files.length > 0) {
        const file = files[0] as File & { path?: string }
        if (file.path) {
          const detectedFormat = getFormatFromExtension(file.name, formatMap)
          window.flux.window.openNote({
            noteId: file.path,
            notePath: file.path,
            noteName: file.name,
            format: detectedFormat,
            isPinned: false
          })
        }
      }
    },
    [formatMap]
  )

  // AI Generate handler — dispatches up to App.tsx which owns aiPanelOpen
  const handleAIGenerate = useCallback(() => {
    window.dispatchEvent(new CustomEvent('flux:toggle-ai'))
  }, [])

  // Pin to Desktop handler - opens a pinned note window
  const handlePin = useCallback(async () => {
    if (!currentFile) return
    try {
      const newState = !isPinned
      if (newState) {
        // Open a pinned note window
        await window.flux.window.openNote({
          noteId: currentFile.id,
          notePath: currentFile.path,
          noteName: currentFile.name,
          format: currentFile.format || 'plaintext',
          isPinned: true
        })
      } else {
        // Close the pinned note window
        await window.flux.window.close(currentFile.id)
      }
      setIsPinned(newState)
    } catch (err) {
      console.error('Failed to toggle pin:', err)
    }
  }, [currentFile, isPinned])

  // Open in New Window handler
  const handleOpenNewWindow = useCallback(() => {
    if (!currentFile) return
    window.flux.window.openNote({
      noteId: currentFile.id,
      notePath: currentFile.path,
      noteName: currentFile.name,
      format: currentFile.format || 'plaintext',
      isPinned: false
    })
  }, [currentFile])

  // Export handlers
  const handleExportHTML = useCallback(async () => {
    if (!currentFile) return
    try {
      await window.flux.file.exportHTML(currentContent, currentFile.name)
    } catch (err) {
      console.error('Export HTML failed:', err)
    }
  }, [currentFile, currentContent])

  const handleExportPDF = useCallback(async () => {
    if (!currentFile) return
    try {
      await window.flux.file.exportPDF(currentContent, currentFile.name)
    } catch (err) {
      console.error('Export PDF failed:', err)
    }
  }, [currentFile, currentContent])

  // Context menu
  const handleContextMenu = useCallback((e: React.MouseEvent) => {
    e.preventDefault()
    const items: ContextMenuItem[] = [
      {
        label: 'Find',
        action: () => { setFindReplaceMode('find'); setShowFindReplace(true) }
      },
      {
        label: 'Replace',
        action: () => { setFindReplaceMode('replace'); setShowFindReplace(true) }
      },
      { label: '', action: () => {}, separator: true },
      {
        label: 'Save',
        action: () => saveFile(),
        disabled: !isDirty
      },
      { label: '', action: () => {}, separator: true }
    ]
    if (isMarkdown) {
      items.push({
        label: showOutline ? 'Hide Outline' : 'Show Outline',
        action: () => setShowOutline((v) => !v)
      })
      items.push({ label: '', action: () => {}, separator: true })
      items.push({
        label: 'Export as HTML',
        action: handleExportHTML
      })
      items.push({
        label: 'Export as PDF',
        action: handleExportPDF
      })
    }
    setContextMenu({ x: e.clientX, y: e.clientY, items })
  }, [saveFile, isDirty, isMarkdown, showOutline, handleExportHTML, handleExportPDF])

  /**
   * Render the inner editor for the active binding. The outer
   * ErrorBoundary + Suspense wrap this so chunk-load failures and
   * runtime crashes are isolated from the rest of the app.
   *
   * Routing is a flat switch on `currentBinding.renderer` — kept here
   * rather than as a lookup table because each branch needs slightly
   * different props (e.g. DrawioEditor's onChange is typed as xml),
   * and a table would just push the conditional one level deeper.
   *
   * `currentFile` is guaranteed non-null here because this function
   * is only called from the JSX below the `if (!currentFile) return`
   * early-return — but TS can't see across the closure, so we assert.
   */
  const renderEditor = (): JSX.Element => {
    const file = currentFile!
    if (currentBinding?.kind === 'plugin-editor') {
      return (
        <PluginIframeEditor
          key={file.path}
          entryUrl={currentBinding.entryUrl}
          value={currentContent}
          onChange={setContent}
          onRequestSave={saveFile}
          filePath={file.path}
          mtime={currentMtime}
        />
      )
    }
    if (isMarkdown) {
      return (
        <MarkdownEditor
          key={file.path}
          value={currentContent}
          onChange={(md) => setContent(md)}
          className="markdown-editor-wrapper"
        />
      )
    }
    if (currentBinding?.kind === 'builtin') {
      switch (currentBinding.renderer) {
        case 'drawio':
          return (
            <DrawioEditor
              key={file.path}
              value={currentContent}
              onChange={(xml) => setContent(xml)}
              onRequestSave={saveFile}
              className="drawio-editor-wrapper"
            />
          )
        case 'mindmap':
          return (
            <MindmapEditor
              key={file.path}
              value={currentContent}
              onChange={(data) => setContent(data)}
              className="mindmap-editor-wrapper"
            />
          )
        case 'whiteboard':
          return (
            <WhiteboardEditor
              key={file.path}
              value={currentContent}
              onChange={(data) => setContent(data)}
              className="whiteboard-editor-wrapper"
            />
          )
        case 'excalidraw':
          return (
            <ExcalidrawEditor
              key={file.path}
              value={currentContent}
              onChange={(data) => setContent(data)}
              className="excalidraw-editor-wrapper"
            />
          )
        case 'kanban':
          return (
            <KanbanEditor
              key={file.path}
              value={currentContent}
              onChange={(data) => setContent(data)}
              className="kanban-editor-wrapper"
            />
          )
        case 'plantuml':
          return (
            <PlantUmlEditor
              key={file.path}
              value={currentContent}
              onChange={(data) => setContent(data)}
              className="plantuml-editor-wrapper"
            />
          )
        case 'mermaid':
          return (
            <MermaidEditor
              key={file.path}
              value={currentContent}
              onChange={(data) => setContent(data)}
              className="mermaid-editor-wrapper"
            />
          )
        case 'bpmn':
          return (
            <BpmnEditor
              key={file.path}
              value={currentContent}
              onChange={(data) => setContent(data)}
              className="bpmn-editor-wrapper"
            />
          )
        case 'dmn':
          return (
            <DmnEditor
              key={file.path}
              value={currentContent}
              onChange={(data) => setContent(data)}
              className="dmn-editor-wrapper"
            />
          )
        default:
          // fallthrough to plaintext
          break
      }
    }
    return (
      <CodeMirrorEditor
        key={file.path}
        value={currentContent}
        onChange={setContent}
        fileName={file.name}
        fontSize={fontSize}
      />
    )
  }

  // Empty state - no file open
  if (!currentFile) {
    return (
      <div
        className="editor-container"
        onDragOver={handleDragOver}
        onDragLeave={handleDragLeave}
        onDrop={handleDrop}
        style={{
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          justifyContent: 'center',
          height: '100%',
          border: isDragOver ? '2px dashed var(--accent-primary)' : 'none',
          borderRadius: '8px',
          transition: 'border-color 0.2s ease',
          color: 'var(--text-tertiary)',
          gap: '12px'
        }}
      >
        <FileText size={48} strokeWidth={1} />
        <p style={{ fontSize: '16px', fontWeight: 500 }}>No file open</p>
        <p style={{ fontSize: '14px', opacity: 0.6 }}>Drag & drop files here</p>
      </div>
    )
  }

  return (
    <div
      className="editor-container"
      style={{
        display: 'flex',
        flexDirection: 'column',
        height: '100%',
        border: isDragOver ? '2px dashed var(--accent-primary)' : 'none',
        borderRadius: '8px',
        transition: 'border-color 0.2s ease'
      }}
      onDragOver={handleDragOver}
      onDragLeave={handleDragLeave}
      onDrop={handleDrop}
    >
      {/* Toolbar */}
      <div
        className="editor-toolbar"
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: '8px',
          padding: '8px 16px',
          borderBottom: '1px solid var(--border-secondary)',
          flexShrink: 0,
          minHeight: '44px'
        }}
      >
        {/* File name + format badge */}
        <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginRight: 'auto' }}>
          <span
            style={{
              fontSize: '14px',
              fontWeight: 600,
              color: 'var(--text-primary)',
              overflow: 'hidden',
              textOverflow: 'ellipsis',
              whiteSpace: 'nowrap',
              maxWidth: '300px'
            }}
            title={currentFile.name}
          >
            {currentFile.name}
            {isDirty ? ' *' : ''}
          </span>
          {format && (
            <span
              style={{
                fontSize: '11px',
                fontWeight: 600,
                padding: '2px 6px',
                borderRadius: '4px',
                backgroundColor: 'var(--bg-tertiary)',
                color: 'var(--text-tertiary)',
                textTransform: 'uppercase',
                letterSpacing: '0.5px',
                lineHeight: 1
              }}
            >
              {formatLabel(format)}
            </span>
          )}
        </div>

        {/* Action buttons */}
        <div style={{ display: 'flex', alignItems: 'center', gap: '4px' }}>
          <button
            className="editor-toolbar-btn"
            onClick={handleAIGenerate}
            title="AI Generate"
            disabled={isGenerating}
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: '4px',
              padding: '6px 10px',
              border: 'none',
              borderRadius: '6px',
              background: 'none',
              color: 'var(--text-secondary)',
              cursor: isGenerating ? 'wait' : 'pointer',
              fontSize: '13px'
            }}
          >
            <Sparkles size={15} />
            <span>AI</span>
          </button>

          <button
            className="editor-toolbar-btn"
            onClick={handleOpenNewWindow}
            title="Open in New Window"
            style={{
              display: 'flex',
              alignItems: 'center',
              padding: '6px',
              border: 'none',
              borderRadius: '6px',
              background: 'none',
              color: 'var(--text-secondary)',
              cursor: 'pointer'
            }}
          >
            <ExternalLink size={15} />
          </button>

          <button
            className="editor-toolbar-btn"
            onClick={handlePin}
            title={isPinned ? 'Unpin from Desktop' : 'Pin to Desktop'}
            style={{
              display: 'flex',
              alignItems: 'center',
              padding: '6px',
              border: 'none',
              borderRadius: '6px',
              background: isPinned ? 'var(--accent-primary)' : 'none',
              color: isPinned ? '#fff' : 'var(--text-secondary)',
              cursor: 'pointer'
            }}
          >
            <Pin size={15} />
          </button>

          {isMarkdown && (
            <button
              className="editor-toolbar-btn"
              onClick={() => setShowOutline((v) => !v)}
              title="Toggle Outline"
              style={{
                display: 'flex',
                alignItems: 'center',
                padding: '6px',
                border: 'none',
                borderRadius: '6px',
                background: showOutline ? 'var(--bg-active)' : 'none',
                color: showOutline ? 'var(--text-primary)' : 'var(--text-secondary)',
                cursor: 'pointer'
              }}
            >
              <ListIcon size={15} />
            </button>
          )}

          {isMarkdown && (
            <button
              className="editor-toolbar-btn"
              onClick={handleExportHTML}
              title="Export as HTML"
              style={{
                display: 'flex',
                alignItems: 'center',
                padding: '6px',
                border: 'none',
                borderRadius: '6px',
                background: 'none',
                color: 'var(--text-secondary)',
                cursor: 'pointer'
              }}
            >
              <Download size={15} />
            </button>
          )}

          <button
            className="editor-toolbar-btn"
            onClick={saveFile}
            title="Save (Cmd+S)"
            disabled={!isDirty}
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: '4px',
              padding: '6px 10px',
              border: 'none',
              borderRadius: '6px',
              background: isDirty ? 'var(--accent-primary)' : 'none',
              color: isDirty ? '#fff' : 'var(--text-tertiary)',
              cursor: isDirty ? 'pointer' : 'default',
              fontSize: '13px'
            }}
          >
            <Save size={15} />
            <span>Save</span>
          </button>
        </div>
      </div>

      {/* Conflict banner */}
      {hasConflict && (
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: 10,
            padding: '8px 16px',
            background: 'var(--bg-warning, #fff8e1)',
            borderBottom: '1px solid var(--border-warning, #f9a825)',
            fontSize: 13,
            color: 'var(--text-primary)',
            flexShrink: 0
          }}
        >
          <span style={{ flex: 1 }}>
            File was modified externally. Your local edits are preserved.
          </span>
          <button
            onClick={reloadCurrent}
            style={{
              padding: '3px 10px',
              borderRadius: 4,
              border: '1px solid var(--border-color)',
              background: 'var(--bg-secondary)',
              cursor: 'pointer',
              fontSize: 12
            }}
          >
            Reload from disk
          </button>
          <button
            onClick={saveFile}
            style={{
              padding: '3px 10px',
              borderRadius: 4,
              border: 'none',
              background: 'var(--accent)',
              color: '#fff',
              cursor: 'pointer',
              fontSize: 12
            }}
          >
            Overwrite with mine
          </button>
        </div>
      )}

      {/* Error banner */}
      {fileError && (
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: 10,
            padding: '8px 16px',
            background: 'var(--bg-error, #ffebee)',
            borderBottom: '1px solid var(--border-error, #ef9a9a)',
            fontSize: 13,
            color: 'var(--text-primary)',
            flexShrink: 0
          }}
        >
          <span style={{ flex: 1 }}>{fileError}</span>
          <button
            onClick={clearError}
            style={{
              padding: '3px 10px',
              borderRadius: 4,
              border: '1px solid var(--border-color)',
              background: 'var(--bg-secondary)',
              cursor: 'pointer',
              fontSize: 12
            }}
          >
            Dismiss
          </button>
        </div>
      )}

      {/* Editor content area */}
      <div
        style={{
          flex: 1,
          display: 'flex',
          overflow: 'hidden'
        }}
      >
        <div
          className="editor-content"
          onContextMenu={handleContextMenu}
          style={{
            flex: 1,
            overflow: 'auto',
            position: 'relative',
            fontSize: `${fontSize}px`
          }}
        >
        {showFindReplace && (
          <FindReplace
            value={currentContent}
            onChange={setContent}
            onClose={() => setShowFindReplace(false)}
            initialMode={findReplaceMode}
          />
        )}
        <EditorErrorBoundary onReset={() => setRendererKey((k) => k + 1)}>
          <Suspense fallback={<LazyEditorFallback />} key={rendererKey}>
            {renderEditor()}
          </Suspense>
        </EditorErrorBoundary>
        </div>
        {showOutline && isMarkdown && (
          <Outline
            content={currentContent}
            onNavigate={() => {/* TODO: scroll to heading */}}
            onClose={() => setShowOutline(false)}
          />
        )}
      </div>

      {/* Context menu */}
      {contextMenu && (
        <EditorContextMenu
          x={contextMenu.x}
          y={contextMenu.y}
          actions={contextMenu.items}
          onClose={() => setContextMenu(null)}
        />
      )}
    </div>
  )
}
