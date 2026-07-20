/**
 * Flux Editor Component
 *
 * Main note editor area with toolbar and content editing.
 * Supports markdown (WYSIWYG via Milkdown) and non-markdown formats (textarea).
 * Features: drag & drop files, keyboard save shortcut, AI generate, pin to desktop.
 */

import { Component, useCallback, useState, useEffect, lazy, Suspense, useRef, type ReactNode } from 'react'
import {
  Save,
  Pin,
  ExternalLink,
  Sparkles,
  FileText,
  List as ListIcon,
  Download,
  ChevronDown,
  GitBranch,
  History as HistoryIcon
} from 'lucide-react'
import MarkdownEditor from './MilkdownEditor'
import PluginIframeEditor from './PluginIframeEditor'
import CodeMirrorEditor from './CodeMirrorEditor'
import Outline from './Outline'
import FileHistoryDialog from './FileHistoryDialog'
import type { DrawioEditorHandle } from './DrawioEditor'
import type { MindmapEditorHandle } from './MindmapEditor'
import type { WhiteboardEditorHandle } from './WhiteboardEditor'
import type { ExcalidrawEditorHandle } from './ExcalidrawEditor'
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
import { usePluginStore } from '../stores/pluginStore'
import FindReplace from './FindReplace'
import type { FormatBinding, NoteFile, NoteFormat } from '@shared/types'
import {
  blobToBase64,
  buildStandaloneHtml,
  escapeHtml,
  getExportBaseName,
  getFileExtension,
  saveBlobExport,
  saveTextExport,
  svgToPngBlob
} from '../utils/exportUtils'

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

interface ExportOption {
  label: string
  action: () => Promise<void>
  disabled?: boolean
}

function isImageFile(file: File): boolean {
  if (file.type.startsWith('image/')) return true
  return /\.(png|jpe?g|gif|webp|svg)$/i.test(file.name)
}

function splitNotePath(path: string): { dir: string; name: string } {
  const normalized = path.replace(/\\/g, '/')
  const slashIndex = normalized.lastIndexOf('/')
  if (slashIndex < 0) return { dir: '', name: normalized }
  return {
    dir: normalized.slice(0, slashIndex),
    name: normalized.slice(slashIndex + 1)
  }
}

function stripFileExtension(name: string): string {
  return name.replace(/\.[^/.]+$/, '')
}

function joinNotePath(dir: string, name: string): string {
  return dir ? `${dir}/${name}` : name
}

function collectTreePaths(nodes: NoteFile[], paths = new Set<string>()): Set<string> {
  for (const node of nodes) {
    paths.add(node.path)
    if (node.children) collectTreePaths(node.children, paths)
  }
  return paths
}

function getUniqueMindmapPath(sourcePath: string, existingPaths: Set<string>): string {
  const { dir, name } = splitNotePath(sourcePath)
  const stem = stripFileExtension(name) || 'mindmap'
  let candidate = joinNotePath(dir, `${stem}.mindmap`)
  let suffix = 2
  while (existingPaths.has(candidate)) {
    candidate = joinNotePath(dir, `${stem} ${suffix}.mindmap`)
    suffix += 1
  }
  return candidate
}

export default function Editor(): JSX.Element {
  const currentFile = useFileStore((s) => s.currentFile)
  const currentContent = useFileStore((s) => s.currentContent)
  const currentMtime = useFileStore((s) => s.currentMtime)
  const setContent = useFileStore((s) => s.setContent)
  const saveFile = useFileStore((s) => s.saveFile)
  const openFile = useFileStore((s) => s.openFile)
  const applyTreeUpdate = useFileStore((s) => s.applyTreeUpdate)
  const isDirty = useFileStore((s) => s.isDirty)
  const hasConflict = useFileStore((s) => s.hasConflict)
  const reloadCurrent = useFileStore((s) => s.reloadCurrent)
  const fileError = useFileStore((s) => s.fileError)
  const clearError = useFileStore((s) => s.clearError)
  const formatMap = usePluginStore((s) => s.formatMap)

  const [isDragOver, setIsDragOver] = useState(false)
  const [isPinned, setIsPinned] = useState(false)
  const [fontSize, setFontSize] = useState(DEFAULT_FONT_SIZE)
  const [showFindReplace, setShowFindReplace] = useState(false)
  const [findReplaceMode, setFindReplaceMode] = useState<'find' | 'replace'>('find')
  const [showOutline, setShowOutline] = useState(false)
  const [showExportMenu, setShowExportMenu] = useState(false)
  const [showHistory, setShowHistory] = useState(false)
  // Bumped when the active editor needs to re-read file contents.
  const [rendererKey, setRendererKey] = useState(0)
  const drawioHandleRef = useRef<DrawioEditorHandle | null>(null)
  const mindmapHandleRef = useRef<MindmapEditorHandle | null>(null)
  const whiteboardHandleRef = useRef<WhiteboardEditorHandle | null>(null)
  const excalidrawHandleRef = useRef<ExcalidrawEditorHandle | null>(null)

  // Look up the binding for the currently open file. The binding drives
  // which editor gets mounted; the string `format` field on NoteFile is
  // only for UI labels (badge, "new file" menu icons).
  const currentExt = currentFile?.name.split('.').pop()?.toLowerCase() ?? ''
  const currentBinding: FormatBinding | undefined = currentFile
    ? formatMap[currentExt]
    : undefined
  const isMarkdown =
    currentBinding?.kind === 'builtin' && currentBinding.renderer === 'markdown'
  const currentRenderer = currentBinding?.kind === 'builtin' ? currentBinding.renderer : undefined
  const format = currentFile?.format

  useEffect(() => {
    drawioHandleRef.current = null
    mindmapHandleRef.current = null
    whiteboardHandleRef.current = null
    excalidrawHandleRef.current = null
  }, [currentFile?.path])

  const handleDrawioReady = useCallback((handle: DrawioEditorHandle | null) => {
    drawioHandleRef.current = handle
  }, [])

  const handleMindmapReady = useCallback((handle: MindmapEditorHandle | null) => {
    mindmapHandleRef.current = handle
  }, [])

  const handleWhiteboardReady = useCallback((handle: WhiteboardEditorHandle | null) => {
    whiteboardHandleRef.current = handle
  }, [])

  const handleExcalidrawReady = useCallback((handle: ExcalidrawEditorHandle | null) => {
    excalidrawHandleRef.current = handle
  }, [])

  const setContentForFile = useCallback(
    (filePath: string, content: string) => {
      const activeFile = useFileStore.getState().currentFile
      if (activeFile?.path !== filePath) return
      setContent(content)
    },
    [setContent]
  )

  const forceEditorRemount = useCallback(() => {
    setRendererKey((key) => key + 1)
  }, [])

  useEffect(() => {
    const handler = () => forceEditorRemount()
    window.addEventListener('flux:force-editor-remount', handler)
    return () => window.removeEventListener('flux:force-editor-remount', handler)
  }, [forceEditorRemount])

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
    window.addEventListener('keydown', handler, true)
    return () => window.removeEventListener('keydown', handler, true)
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

  useEffect(() => {
    if (!showExportMenu) return
    const close = () => setShowExportMenu(false)
    document.addEventListener('mousedown', close)
    return () => document.removeEventListener('mousedown', close)
  }, [showExportMenu])

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
        if (isMarkdown && Array.from(files).some(isImageFile)) {
          return
        }

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
    [formatMap, isMarkdown]
  )

  // AI Generate handler — dispatches up to App.tsx which owns aiPanelOpen
  const handleAIGenerate = useCallback(() => {
    window.dispatchEvent(new CustomEvent('flux:toggle-ai'))
  }, [])

  const handleOpenHistory = useCallback(() => {
    if (!currentFile) return
    setShowHistory(true)
  }, [currentFile])

  const handleCreateMindmapFromMarkdown = useCallback(async () => {
    if (!currentFile || !isMarkdown) return
    window.dispatchEvent(new CustomEvent('flux:flush-active-editor'))
    const activeState = useFileStore.getState()
    const sourceContent =
      activeState.currentFile?.path === currentFile.path
        ? activeState.currentContent
        : currentContent
    const fallbackContent = `# ${getExportBaseName(currentFile.name)}\n`

    try {
      const freshTree = await window.flux.file.getTree()
      applyTreeUpdate(freshTree)
      const targetPath = getUniqueMindmapPath(currentFile.path, collectTreePaths(freshTree))
      const created = await window.flux.file.create(
        targetPath,
        sourceContent.trim() ? sourceContent : fallbackContent,
        false
      )
      applyTreeUpdate(await window.flux.file.getTree())
      await openFile(created)
    } catch (err) {
      console.error('Failed to create mindmap from markdown:', err)
    }
  }, [applyTreeUpdate, currentContent, currentFile, isMarkdown, openFile])

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

  const handleExportSource = useCallback(async () => {
    if (!currentFile) return
    window.dispatchEvent(new CustomEvent('flux:flush-active-editor'))
    const activeState = useFileStore.getState()
    const exportContent =
      activeState.currentFile?.path === currentFile.path
        ? activeState.currentContent
        : currentContent
    const ext = getFileExtension(currentFile.name)
    try {
      await saveTextExport({
        title: '导出源文件',
        defaultPath: currentFile.name,
        filters: [
          { name: `${ext.toUpperCase()} Source`, extensions: [ext] },
          { name: 'All Files', extensions: ['*'] }
        ],
        data: exportContent
      })
    } catch (err) {
      console.error('Export source failed:', err)
    }
  }, [currentFile, currentContent])

  const handleExportTextHTML = useCallback(async () => {
    if (!currentFile) return
    try {
      await saveTextExport({
        title: '导出 HTML',
        defaultPath: `${getExportBaseName(currentFile.name)}.html`,
        filters: [{ name: 'HTML', extensions: ['html'] }],
        data: buildStandaloneHtml(
          currentFile.name,
          `<pre>${escapeHtml(currentContent)}</pre>`
        )
      })
    } catch (err) {
      console.error('Export text HTML failed:', err)
    }
  }, [currentFile, currentContent])

  const renderMermaidSvg = useCallback(async (): Promise<string> => {
    const trimmed = currentContent.trim()
    if (!trimmed) throw new Error('Mermaid content is empty')
    const mermaid = (await import('mermaid')).default
    mermaid.initialize({
      startOnLoad: false,
      theme: document.documentElement.getAttribute('data-theme') === 'dark' ? 'dark' : 'default',
      securityLevel: 'strict',
      suppressErrorRendering: true
    })
    const id = `mmd-export-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
    const result = await mermaid.render(id, trimmed)
    return result.svg
  }, [currentContent])

  const handleExportMermaidSVG = useCallback(async () => {
    if (!currentFile) return
    try {
      await saveTextExport({
        title: '导出 SVG',
        defaultPath: `${getExportBaseName(currentFile.name)}.svg`,
        filters: [{ name: 'SVG', extensions: ['svg'] }],
        data: await renderMermaidSvg()
      })
    } catch (err) {
      console.error('Export Mermaid SVG failed:', err)
    }
  }, [currentFile, renderMermaidSvg])

  const handleExportMermaidPNG = useCallback(async () => {
    if (!currentFile) return
    try {
      const svg = await renderMermaidSvg()
      const blob = await svgToPngBlob(
        svg,
        2,
        document.documentElement.getAttribute('data-theme') === 'dark' ? '#1a1a1a' : '#ffffff'
      )
      await saveBlobExport({
        title: '导出 PNG',
        defaultPath: `${getExportBaseName(currentFile.name)}.png`,
        filters: [{ name: 'PNG', extensions: ['png'] }],
        blob
      })
    } catch (err) {
      console.error('Export Mermaid PNG failed:', err)
    }
  }, [currentFile, renderMermaidSvg])

  const handleExportMermaidHTML = useCallback(async () => {
    if (!currentFile) return
    try {
      const svg = await renderMermaidSvg()
      await saveTextExport({
        title: '导出 HTML',
        defaultPath: `${getExportBaseName(currentFile.name)}.html`,
        filters: [{ name: 'HTML', extensions: ['html'] }],
        data: buildStandaloneHtml(currentFile.name, svg)
      })
    } catch (err) {
      console.error('Export Mermaid HTML failed:', err)
    }
  }, [currentFile, renderMermaidSvg])

  const getDrawioPngBlob = useCallback(async (): Promise<Blob> => {
    const handle = drawioHandleRef.current
    if (!handle) throw new Error('DrawIO editor is not ready')
    const blob = await handle.exportPng()
    if (!blob) throw new Error('DrawIO export is unavailable')
    return blob
  }, [])

  const handleExportDrawioPNG = useCallback(async () => {
    if (!currentFile) return
    try {
      await saveBlobExport({
        title: '导出 PNG',
        defaultPath: `${getExportBaseName(currentFile.name)}.png`,
        filters: [{ name: 'PNG', extensions: ['png'] }],
        blob: await getDrawioPngBlob()
      })
    } catch (err) {
      console.error('Export DrawIO PNG failed:', err)
    }
  }, [currentFile, getDrawioPngBlob])

  const getMindmapPngBlob = useCallback(async (): Promise<Blob> => {
    const handle = mindmapHandleRef.current
    if (!handle) throw new Error('Mindmap editor is not ready')
    const blob = await handle.exportPng()
    if (!blob) throw new Error('Mindmap is empty')
    return blob
  }, [])

  const handleExportMindmapPNG = useCallback(async () => {
    if (!currentFile) return
    try {
      await saveBlobExport({
        title: '导出 PNG',
        defaultPath: `${getExportBaseName(currentFile.name)}.png`,
        filters: [{ name: 'PNG', extensions: ['png'] }],
        blob: await getMindmapPngBlob()
      })
    } catch (err) {
      console.error('Export mindmap PNG failed:', err)
    }
  }, [currentFile, getMindmapPngBlob])

  const getExcalidrawPngBlob = useCallback(async (): Promise<Blob> => {
    const handle = excalidrawHandleRef.current
    if (!handle) throw new Error('Excalidraw editor is not ready')
    const blob = await handle.exportPng()
    if (!blob) throw new Error('Excalidraw scene is empty')
    return blob
  }, [])

  const handleExportExcalidrawPNG = useCallback(async () => {
    if (!currentFile) return
    try {
      await saveBlobExport({
        title: '导出 PNG',
        defaultPath: `${getExportBaseName(currentFile.name)}.png`,
        filters: [{ name: 'PNG', extensions: ['png'] }],
        blob: await getExcalidrawPngBlob()
      })
    } catch (err) {
      console.error('Export Excalidraw PNG failed:', err)
    }
  }, [currentFile, getExcalidrawPngBlob])

  const getWhiteboardPngBlob = useCallback(async (): Promise<Blob> => {
    const handle = whiteboardHandleRef.current
    if (!handle) throw new Error('Whiteboard editor is not ready')
    const blob = await handle.exportPng()
    if (!blob) throw new Error('Whiteboard is empty')
    return blob
  }, [])

  const handleExportWhiteboardPNG = useCallback(async () => {
    if (!currentFile) return
    try {
      await saveBlobExport({
        title: '导出 PNG',
        defaultPath: `${getExportBaseName(currentFile.name)}.png`,
        filters: [{ name: 'PNG', extensions: ['png'] }],
        blob: await getWhiteboardPngBlob()
      })
    } catch (err) {
      console.error('Export whiteboard PNG failed:', err)
    }
  }, [currentFile, getWhiteboardPngBlob])

  const handleExportWhiteboardHTML = useCallback(async () => {
    if (!currentFile) return
    try {
      const pngBlob = await getWhiteboardPngBlob()
      const base64 = await blobToBase64(pngBlob)
      await saveTextExport({
        title: '导出 HTML',
        defaultPath: `${getExportBaseName(currentFile.name)}.html`,
        filters: [{ name: 'HTML', extensions: ['html'] }],
        data: buildStandaloneHtml(
          currentFile.name,
          `<img src="data:image/png;base64,${base64}" alt="${escapeHtml(currentFile.name)}">`
        )
      })
    } catch (err) {
      console.error('Export whiteboard HTML failed:', err)
    }
  }, [currentFile, getWhiteboardPngBlob])

  const exportOptions: ExportOption[] = []
  if (currentFile) {
    if (isMarkdown) {
      exportOptions.push(
        { label: 'HTML', action: handleExportHTML },
        { label: 'PDF', action: handleExportPDF },
        { label: 'Markdown 源文件', action: handleExportSource }
      )
    } else if (currentRenderer === 'mermaid') {
      exportOptions.push(
        { label: 'SVG', action: handleExportMermaidSVG, disabled: !currentContent.trim() },
        { label: 'PNG', action: handleExportMermaidPNG, disabled: !currentContent.trim() },
        { label: 'HTML', action: handleExportMermaidHTML, disabled: !currentContent.trim() },
        { label: 'Mermaid 源文件', action: handleExportSource }
      )
    } else if (currentRenderer === 'whiteboard') {
      exportOptions.push(
        { label: 'PNG', action: handleExportWhiteboardPNG },
        { label: 'HTML', action: handleExportWhiteboardHTML },
        { label: 'tldraw 源文件', action: handleExportSource }
      )
    } else if (currentRenderer === 'drawio') {
      exportOptions.push(
        { label: 'PNG', action: handleExportDrawioPNG },
        { label: '源文件', action: handleExportSource },
        { label: 'HTML', action: handleExportTextHTML }
      )
    } else if (currentRenderer === 'mindmap') {
      exportOptions.push(
        { label: 'PNG', action: handleExportMindmapPNG },
        { label: '源文件', action: handleExportSource },
        { label: 'HTML', action: handleExportTextHTML }
      )
    } else if (currentRenderer === 'excalidraw') {
      exportOptions.push(
        { label: 'PNG', action: handleExportExcalidrawPNG },
        { label: '源文件', action: handleExportSource },
        { label: 'HTML', action: handleExportTextHTML }
      )
    } else {
      exportOptions.push(
        { label: '源文件', action: handleExportSource },
        { label: 'HTML', action: handleExportTextHTML }
      )
    }
  }

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
          onChange={(data) => setContentForFile(file.path, data)}
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
          onChange={(md) => setContentForFile(file.path, md)}
          filePath={file.path}
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
              onChange={(xml) => setContentForFile(file.path, xml)}
              onRequestSave={saveFile}
              onReady={handleDrawioReady}
              className="drawio-editor-wrapper"
            />
          )
        case 'mindmap':
          return (
            <MindmapEditor
              key={file.path}
              value={currentContent}
              onChange={(data) => setContentForFile(file.path, data)}
              onReady={handleMindmapReady}
              className="mindmap-editor-wrapper"
            />
          )
        case 'whiteboard':
          return (
            <WhiteboardEditor
              key={file.path}
              value={currentContent}
              onChange={(data) => setContentForFile(file.path, data)}
              onReady={handleWhiteboardReady}
              className="whiteboard-editor-wrapper"
            />
          )
        case 'excalidraw':
          return (
            <ExcalidrawEditor
              key={file.path}
              value={currentContent}
              onChange={(data) => setContentForFile(file.path, data)}
              onReady={handleExcalidrawReady}
              className="excalidraw-editor-wrapper"
            />
          )
        case 'kanban':
          return (
            <KanbanEditor
              key={file.path}
              value={currentContent}
              onChange={(data) => setContentForFile(file.path, data)}
              className="kanban-editor-wrapper"
            />
          )
        case 'plantuml':
          return (
            <PlantUmlEditor
              key={file.path}
              value={currentContent}
              onChange={(data) => setContentForFile(file.path, data)}
              className="plantuml-editor-wrapper"
            />
          )
        case 'mermaid':
          return (
            <MermaidEditor
              key={file.path}
              value={currentContent}
              onChange={(data) => setContentForFile(file.path, data)}
              className="mermaid-editor-wrapper"
              fileName={file.name}
            />
          )
        case 'bpmn':
          return (
            <BpmnEditor
              key={file.path}
              value={currentContent}
              onChange={(data) => setContentForFile(file.path, data)}
              className="bpmn-editor-wrapper"
            />
          )
        case 'dmn':
          return (
            <DmnEditor
              key={file.path}
              value={currentContent}
              onChange={(data) => setContentForFile(file.path, data)}
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
        onChange={(data) => setContentForFile(file.path, data)}
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
            type="button"
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: '4px',
              padding: '6px 10px',
              border: 'none',
              borderRadius: '6px',
              background: 'none',
              color: 'var(--text-secondary)',
              cursor: 'pointer',
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
            onClick={handleOpenHistory}
            title="History"
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
            <HistoryIcon size={15} />
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
              background: 'none',
              color: 'var(--text-secondary)',
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
              onClick={handleCreateMindmapFromMarkdown}
              title="Create Mindmap"
              type="button"
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
              <GitBranch size={15} />
            </button>
          )}

          {exportOptions.length > 0 && (
            <div
              onMouseDown={(e) => e.stopPropagation()}
              onClick={(e) => e.stopPropagation()}
              style={{ position: 'relative', display: 'inline-flex' }}
            >
              <button
                className="editor-toolbar-btn"
                onClick={() => setShowExportMenu((value) => !value)}
                title="Export"
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: 4,
                  padding: '6px 8px',
                  border: 'none',
                  borderRadius: '6px',
                  background: showExportMenu ? 'var(--bg-active)' : 'none',
                  color: showExportMenu ? 'var(--text-primary)' : 'var(--text-secondary)',
                  cursor: 'pointer',
                  fontSize: 13
                }}
              >
                <Download size={15} />
                <ChevronDown size={12} />
              </button>
              {showExportMenu && (
                <div
                  style={{
                    position: 'absolute',
                    top: 'calc(100% + 6px)',
                    right: 0,
                    minWidth: 160,
                    padding: 4,
                    background: 'var(--bg-tertiary)',
                    border: '1px solid var(--border-color)',
                    borderRadius: 8,
                    boxShadow: 'var(--shadow-lg)',
                    zIndex: 50
                  }}
                >
                  {exportOptions.map((option) => (
                    <button
                      key={option.label}
                      disabled={option.disabled}
                      onClick={() => {
                        setShowExportMenu(false)
                        void option.action()
                      }}
                      style={{
                        width: '100%',
                        display: 'flex',
                        alignItems: 'center',
                        padding: '7px 10px',
                        border: 'none',
                        borderRadius: 5,
                        background: 'transparent',
                        color: option.disabled ? 'var(--text-disabled)' : 'var(--text-primary)',
                        cursor: option.disabled ? 'default' : 'pointer',
                        fontSize: 13,
                        textAlign: 'left'
                      }}
                    >
                      {option.label}
                    </button>
                  ))}
                </div>
              )}
            </div>
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
              color: isDirty ? 'var(--bg-primary)' : 'var(--text-tertiary)',
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

      {showHistory && currentFile && (
        <FileHistoryDialog
          file={currentFile}
          onClose={() => setShowHistory(false)}
          onBeforeRestore={async () => {
            if (!useFileStore.getState().isDirty) return
            await saveFile()
            const state = useFileStore.getState()
            if (state.isDirty || state.hasConflict) {
              throw new Error('当前文件尚未成功保存，已取消回滚。')
            }
          }}
          onRestored={async () => {
            await reloadCurrent()
            forceEditorRemount()
          }}
        />
      )}
    </div>
  )
}
