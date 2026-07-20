/**
 * Flux Note Window Entry
 *
 * A standalone note window for pinned/floating notes.
 * Uses Milkdown WYSIWYG editor for Markdown files,
 * plain textarea for other formats.
 *
 * Features:
 *  - WYSIWYG Markdown editing (Milkdown)
 *  - Frameless title bar with pin / minimize / fullscreen / close
 *  - Debounced auto-save
 *  - Consistent styling with main app
 */

import React from 'react'
import ReactDOM from 'react-dom/client'
import {
  lazy,
  Suspense,
  useEffect,
  useState,
  useCallback,
  useRef,
  type CSSProperties
} from 'react'
import { Pin, X, Minus, Maximize2 } from 'lucide-react'
import MilkdownEditor from './components/MilkdownEditor'
import CodeMirrorEditor from './components/CodeMirrorEditor'
import type { NoteFormat } from '@shared/types'
import './styles/global.css'
import './styles/components.css'

const DrawioEditor = lazy(() => import('./components/DrawioEditor'))
const MindmapEditor = lazy(() => import('./components/MindmapEditor'))
const WhiteboardEditor = lazy(() => import('./components/WhiteboardEditor'))
const ExcalidrawEditor = lazy(() => import('./components/ExcalidrawEditor'))
const KanbanEditor = lazy(() => import('./components/KanbanEditor'))
const PlantUmlEditor = lazy(() => import('./components/PlantUmlEditor'))
const MermaidEditor = lazy(() => import('./components/MermaidEditor'))
const BpmnEditor = lazy(() => import('./components/BpmnEditor'))
const DmnEditor = lazy(() => import('./components/DmnEditor'))

type CSSPropertiesWithAppRegion = CSSProperties & {
  WebkitAppRegion?: 'drag' | 'no-drag' | string
}

interface NoteData {
  noteId: string
  notePath: string
  noteName: string
  format: NoteFormat
  isPinned: boolean
  opacity: number
}

type SaveStatus = 'saved' | 'saving' | 'unsaved'

const DEFAULT_FONT_SIZE = 14
const MIN_FONT_SIZE = 10
const MAX_FONT_SIZE = 28
const FONT_SIZE_STEP = 2

const titlebarStyle: CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'space-between',
  padding: '4px 8px 4px 12px',
  WebkitAppRegion: 'drag',
  height: 32,
  minHeight: 32,
  borderBottom: '1px solid var(--border-light)',
  background: 'var(--bg-secondary)',
  userSelect: 'none',
  flexShrink: 0,
} as CSSPropertiesWithAppRegion

const titlebarActionsStyle: CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  gap: 2,
  WebkitAppRegion: 'no-drag',
} as CSSPropertiesWithAppRegion

const titlebarBtnStyle: CSSProperties = {
  width: 28,
  height: 24,
  border: 'none',
  outline: 'none',
  background: 'transparent',
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
  cursor: 'pointer',
  color: 'var(--text-tertiary)',
  borderRadius: 'var(--radius-sm)',
  transition: 'all var(--transition-fast)',
  padding: 0,
  WebkitAppRegion: 'no-drag',
} as CSSPropertiesWithAppRegion

function NoteEditorFallback(): JSX.Element {
  return (
    <div
      style={{
        height: '100%',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        color: 'var(--text-tertiary)',
        fontSize: 13
      }}
    >
      Loading editor...
    </div>
  )
}

function NoteApp() {
  const [noteData, setNoteData] = useState<NoteData | null>(null)
  const [content, setContent] = useState('')
  const [isPinned, setIsPinned] = useState(false)
  const [saveStatus, setSaveStatus] = useState<SaveStatus>('saved')
  const [isLoading, setIsLoading] = useState(true)
  const [fontSize, setFontSize] = useState(DEFAULT_FONT_SIZE)
  const saveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const latestContentRef = useRef('')
  const hasFlushedRef = useRef(false)
  /** mtime observed at load time. Sent back on writes for conflict detection. */
  const mtimeRef = useRef<number | null>(null)
  const isDirtyRef = useRef(false)

  // Listen for note:loaded IPC event
  useEffect(() => {
    const cleanup = window.flux.on.noteLoaded(async (data: unknown) => {
      const noteInfo = data as NoteData
      setNoteData(noteInfo)
      setIsPinned(noteInfo.isPinned)
      try {
        const { content: fileContent, mtime } = await window.flux.file.readMeta(
          noteInfo.notePath
        )
        setContent(fileContent)
        latestContentRef.current = fileContent
        mtimeRef.current = mtime
      } catch (err) {
        console.error('Failed to read note:', err)
      } finally {
        setIsLoading(false)
      }
    })
    return () => { cleanup() }
  }, [])

  // Fold in writes from other windows. If we have unsaved edits we ignore
  // the broadcast — the user's in-flight typing wins locally and a conflict
  // will surface on the next save.
  useEffect(() => {
    const unsubscribe = window.flux.file.onChanged((payload) => {
      if (!noteData || payload.path !== noteData.notePath) return
      if (isDirtyRef.current || saveStatus !== 'saved') return
      setContent(payload.content)
      latestContentRef.current = payload.content
      mtimeRef.current = payload.mtime
    })
    return unsubscribe
  }, [noteData, saveStatus])

  // Debounced auto-save
  const handleContentChange = useCallback(
    (newContent: string) => {
      setContent(newContent)
      latestContentRef.current = newContent
      isDirtyRef.current = true
      setSaveStatus('unsaved')

      if (saveTimerRef.current) {
        clearTimeout(saveTimerRef.current)
      }

      saveTimerRef.current = setTimeout(async () => {
        if (!noteData) return
        setSaveStatus('saving')
        try {
          const result = await window.flux.file.writeGuarded(
            noteData.notePath,
            latestContentRef.current,
            mtimeRef.current
          )
          if (result.ok) {
            mtimeRef.current = result.mtime
            isDirtyRef.current = false
            setSaveStatus('saved')
          } else {
            console.warn('Autosave hit a write conflict; keeping local edits.')
            setSaveStatus('unsaved')
          }
        } catch (err) {
          console.error('Failed to save note:', err)
          setSaveStatus('unsaved')
        }
      }, 800)
    },
    [noteData]
  )

  const saveNow = useCallback(async () => {
    if (saveTimerRef.current) {
      clearTimeout(saveTimerRef.current)
      saveTimerRef.current = null
    }
    if (!noteData) return

    setSaveStatus('saving')
    try {
      const result = await window.flux.file.writeGuarded(
        noteData.notePath,
        latestContentRef.current,
        mtimeRef.current
      )
      if (result.ok) {
        mtimeRef.current = result.mtime
        isDirtyRef.current = false
        setSaveStatus('saved')
      } else {
        console.warn('Manual save hit a write conflict; keeping local edits.')
        setSaveStatus('unsaved')
      }
    } catch (err) {
      console.error('Failed to save note:', err)
      setSaveStatus('unsaved')
    }
  }, [noteData])

  // Cleanup save timer on unmount
  useEffect(() => {
    return () => {
      if (saveTimerRef.current) {
        clearTimeout(saveTimerRef.current)
      }
    }
  }, [])

  // Save before closing. Electron cancels the close when we set returnValue,
  // so we hijack that: cancel once, flush any pending debounced save, then
  // re-trigger close via IPC after the write resolves. hasFlushedRef guards
  // against reentry when window.close() bounces back through beforeunload.
  useEffect(() => {
    const handleBeforeUnload = (event: BeforeUnloadEvent) => {
      if (hasFlushedRef.current) return
      if (!noteData) return
      if (saveStatus === 'saved' && !saveTimerRef.current) return

      event.preventDefault()
      event.returnValue = ''

      if (saveTimerRef.current) {
        clearTimeout(saveTimerRef.current)
        saveTimerRef.current = null
      }

      window.flux.file
        .writeGuarded(noteData.notePath, latestContentRef.current, mtimeRef.current)
        .catch((err) => console.error('Failed to autosave on close:', err))
        .finally(() => {
          hasFlushedRef.current = true
          window.flux.window.close(noteData.noteId)
        })
    }
    window.addEventListener('beforeunload', handleBeforeUnload)
    return () => window.removeEventListener('beforeunload', handleBeforeUnload)
  }, [noteData, saveStatus])

  // Pin toggle
  const handlePinToggle = useCallback(async () => {
    if (!noteData) return
    try {
      await window.flux.window.togglePin(noteData.noteId)
      setIsPinned((prev) => !prev)
    } catch (err) {
      console.error('Failed to toggle pin:', err)
    }
  }, [noteData])

  // Close
  const handleClose = useCallback(() => {
    if (noteData) {
      window.flux.window.close(noteData.noteId)
    }
  }, [noteData])

  // Minimize
  const handleMinimize = useCallback(() => {
    if (noteData) {
      void window.flux.window.minimize(noteData.noteId)
    }
  }, [noteData])

  const handleToggleFullscreen = useCallback(() => {
    void window.flux.window.toggleFullscreen()
  }, [])

  const isMarkdown = noteData?.format === 'markdown'

  // Keyboard shortcut: Cmd/Ctrl+S to save immediately, Cmd/Ctrl+/-/0 to zoom
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.isComposing || e.keyCode === 229) return
      if ((e.metaKey || e.ctrlKey) && e.key === 's') {
        e.preventDefault()
        void saveNow()
      }
      if ((e.metaKey || e.ctrlKey) && (e.key === '=' || e.key === '+')) {
        e.preventDefault()
        setFontSize((prev) => Math.min(prev + FONT_SIZE_STEP, MAX_FONT_SIZE))
      }
      if ((e.metaKey || e.ctrlKey) && e.key === '-') {
        e.preventDefault()
        setFontSize((prev) => Math.max(prev - FONT_SIZE_STEP, MIN_FONT_SIZE))
      }
      if ((e.metaKey || e.ctrlKey) && e.key === '0') {
        e.preventDefault()
        setFontSize(DEFAULT_FONT_SIZE)
      }
    }
    window.addEventListener('keydown', handler, true)
    return () => window.removeEventListener('keydown', handler, true)
  }, [noteData, saveNow])

  if (isLoading) {
    return (
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          height: '100vh',
          color: 'var(--text-tertiary)',
          fontSize: '14px',
        }}
      >
        Loading...
      </div>
    )
  }

  if (!noteData) {
    return (
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          height: '100vh',
          color: 'var(--text-tertiary)',
          fontSize: '14px',
        }}
      >
        No note loaded
      </div>
    )
  }

  const saveLabel =
    saveStatus === 'saved'
      ? 'Saved'
      : saveStatus === 'saving'
        ? 'Saving...'
        : 'Unsaved'

  const renderEditor = (): JSX.Element => {
    switch (noteData.format) {
      case 'markdown':
        return (
          <MilkdownEditor
            key={noteData.notePath}
            value={content}
            onChange={handleContentChange}
            filePath={noteData.notePath}
            className="milkdown-editor-wrapper"
          />
        )
      case 'drawio':
        return (
          <DrawioEditor
            key={noteData.notePath}
            value={content}
            onChange={handleContentChange}
            onRequestSave={() => { void saveNow() }}
            className="drawio-editor-wrapper"
          />
        )
      case 'mindmap':
        return (
          <MindmapEditor
            key={noteData.notePath}
            value={content}
            onChange={handleContentChange}
            className="mindmap-editor-wrapper"
          />
        )
      case 'whiteboard':
        return (
          <WhiteboardEditor
            key={noteData.notePath}
            value={content}
            onChange={handleContentChange}
            className="whiteboard-editor-wrapper"
          />
        )
      case 'excalidraw':
        return (
          <ExcalidrawEditor
            key={noteData.notePath}
            value={content}
            onChange={handleContentChange}
            className="excalidraw-editor-wrapper"
          />
        )
      case 'kanban':
        return (
          <KanbanEditor
            key={noteData.notePath}
            value={content}
            onChange={handleContentChange}
            className="kanban-editor-wrapper"
          />
        )
      case 'plantuml':
        return (
          <PlantUmlEditor
            key={noteData.notePath}
            value={content}
            onChange={handleContentChange}
            className="plantuml-editor-wrapper"
          />
        )
      case 'mermaid':
        return (
          <MermaidEditor
            key={noteData.notePath}
            value={content}
            onChange={handleContentChange}
            className="mermaid-editor-wrapper"
            fileName={noteData.noteName}
          />
        )
      case 'bpmn':
        return (
          <BpmnEditor
            key={noteData.notePath}
            value={content}
            onChange={handleContentChange}
            className="bpmn-editor-wrapper"
          />
        )
      case 'dmn':
        return (
          <DmnEditor
            key={noteData.notePath}
            value={content}
            onChange={handleContentChange}
            className="dmn-editor-wrapper"
          />
        )
      default:
        return (
          <CodeMirrorEditor
            key={noteData.notePath}
            value={content}
            onChange={handleContentChange}
            fileName={noteData.noteName}
            fontSize={fontSize}
          />
        )
    }
  }

  return (
    <div className={`note-window ${isPinned ? 'pinned' : ''}`}>
      {/* Title Bar */}
      <div style={titlebarStyle}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, minWidth: 0 }}>
          <span
            style={{
              fontSize: '12px',
              fontWeight: 600,
              color: 'var(--text-primary)',
              overflow: 'hidden',
              textOverflow: 'ellipsis',
              whiteSpace: 'nowrap',
            }}
          >
            {noteData.noteName}
          </span>
          <span
            style={{
              fontSize: '10px',
              color: saveStatus === 'unsaved' ? 'var(--text-tertiary)' : 'var(--text-disabled)',
              flexShrink: 0,
            }}
          >
            {saveLabel}
          </span>
        </div>
        <div style={titlebarActionsStyle}>
          <button
            style={titlebarBtnStyle}
            onClick={handlePinToggle}
            onMouseDown={(e) => e.stopPropagation()}
            title={isPinned ? 'Unpin' : 'Pin to Top'}
            type="button"
            onMouseEnter={(e) => {
              e.currentTarget.style.background = 'var(--bg-hover)'
              e.currentTarget.style.color = 'var(--text-primary)'
            }}
            onMouseLeave={(e) => {
              e.currentTarget.style.background = 'transparent'
              e.currentTarget.style.color = isPinned ? 'var(--accent)' : 'var(--text-tertiary)'
            }}
          >
            <Pin
              size={13}
              style={{
                transform: isPinned ? 'rotate(45deg)' : 'none',
                color: isPinned ? 'var(--accent)' : 'var(--text-tertiary)',
                transition: 'transform 0.2s ease',
              }}
            />
          </button>
          <button
            style={titlebarBtnStyle}
            onClick={handleMinimize}
            onMouseDown={(e) => e.stopPropagation()}
            title="Minimize"
            type="button"
            onMouseEnter={(e) => {
              e.currentTarget.style.background = 'var(--bg-hover)'
              e.currentTarget.style.color = 'var(--text-primary)'
            }}
            onMouseLeave={(e) => {
              e.currentTarget.style.background = 'transparent'
              e.currentTarget.style.color = 'var(--text-tertiary)'
            }}
          >
            <Minus size={14} />
          </button>
          <button
            style={titlebarBtnStyle}
            onClick={handleToggleFullscreen}
            onMouseDown={(e) => e.stopPropagation()}
            title="Toggle Full Screen"
            type="button"
            onMouseEnter={(e) => {
              e.currentTarget.style.background = 'var(--bg-hover)'
              e.currentTarget.style.color = 'var(--text-primary)'
            }}
            onMouseLeave={(e) => {
              e.currentTarget.style.background = 'transparent'
              e.currentTarget.style.color = 'var(--text-tertiary)'
            }}
          >
            <Maximize2 size={13} />
          </button>
          <button
            style={titlebarBtnStyle}
            onClick={handleClose}
            onMouseDown={(e) => e.stopPropagation()}
            title="Close"
            type="button"
            onMouseEnter={(e) => {
              e.currentTarget.style.background = '#e81123'
              e.currentTarget.style.color = '#ffffff'
            }}
            onMouseLeave={(e) => {
              e.currentTarget.style.background = 'transparent'
              e.currentTarget.style.color = 'var(--text-tertiary)'
            }}
          >
            <X size={14} />
          </button>
        </div>
      </div>

      {/* Content */}
      <div
        className="note-content"
        style={{
          fontSize: `${fontSize}px`,
          padding: isMarkdown ? '16px 20px' : 0,
          overflow: isMarkdown ? 'auto' : 'hidden'
        }}
      >
        <Suspense fallback={<NoteEditorFallback />}>
          {renderEditor()}
        </Suspense>
      </div>
    </div>
  )
}

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <NoteApp />
  </React.StrictMode>
)
