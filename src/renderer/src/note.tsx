/**
 * PaiNote Note Window Entry
 *
 * A standalone note window for pinned/floating notes.
 * Uses Milkdown WYSIWYG editor for Markdown files,
 * plain textarea for other formats.
 *
 * Features:
 *  - WYSIWYG Markdown editing (Milkdown)
 *  - Frameless title bar with pin / minimize / close
 *  - Debounced auto-save
 *  - Consistent styling with main app
 */

import React from 'react'
import ReactDOM from 'react-dom/client'
import { useEffect, useState, useCallback, useRef, type CSSProperties } from 'react'
import { Pin, X, Minus } from 'lucide-react'
import MilkdownEditor from './components/MilkdownEditor'
import type { NoteFormat } from '@shared/types'
import './styles/global.css'
import './styles/components.css'

interface NoteData {
  noteId: string
  notePath: string
  noteName: string
  format: NoteFormat
  isPinned: boolean
  opacity: number
}

type SaveStatus = 'saved' | 'saving' | 'unsaved'

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
} as CSSProperties

const titlebarActionsStyle: CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  gap: 2,
  WebkitAppRegion: 'no-drag',
} as CSSProperties

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
}

function NoteApp() {
  const [noteData, setNoteData] = useState<NoteData | null>(null)
  const [content, setContent] = useState('')
  const [isPinned, setIsPinned] = useState(false)
  const [saveStatus, setSaveStatus] = useState<SaveStatus>('saved')
  const [isLoading, setIsLoading] = useState(true)
  const saveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const latestContentRef = useRef('')
  const hasFlushedRef = useRef(false)
  /** mtime observed at load time. Sent back on writes for conflict detection. */
  const mtimeRef = useRef<number | null>(null)
  const isDirtyRef = useRef(false)

  // Listen for note:loaded IPC event
  useEffect(() => {
    const cleanup = window.painote.on.noteLoaded(async (data: unknown) => {
      const noteInfo = data as NoteData
      setNoteData(noteInfo)
      setIsPinned(noteInfo.isPinned)
      try {
        const { content: fileContent, mtime } = await window.painote.file.readMeta(
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
    const unsubscribe = window.painote.file.onChanged((payload) => {
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
          const result = await window.painote.file.writeGuarded(
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

      window.painote.file
        .writeGuarded(noteData.notePath, latestContentRef.current, mtimeRef.current)
        .catch((err) => console.error('Failed to autosave on close:', err))
        .finally(() => {
          hasFlushedRef.current = true
          window.painote.window.close(noteData.noteId)
        })
    }
    window.addEventListener('beforeunload', handleBeforeUnload)
    return () => window.removeEventListener('beforeunload', handleBeforeUnload)
  }, [noteData, saveStatus])

  // Pin toggle
  const handlePinToggle = useCallback(async () => {
    if (!noteData) return
    try {
      await window.painote.window.togglePin(noteData.noteId)
      setIsPinned((prev) => !prev)
    } catch (err) {
      console.error('Failed to toggle pin:', err)
    }
  }, [noteData])

  // Close
  const handleClose = useCallback(() => {
    if (noteData) {
      window.painote.window.close(noteData.noteId)
    }
  }, [noteData])

  // Minimize
  const handleMinimize = useCallback(() => {
    window.painote.window.minimizeFrame()
  }, [])

  const isMarkdown = noteData?.format === 'markdown'

  // Keyboard shortcut: Cmd/Ctrl+S to save immediately
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key === 's') {
        e.preventDefault()
        if (saveTimerRef.current) {
          clearTimeout(saveTimerRef.current)
        }
        if (noteData) {
          setSaveStatus('saving')
          window.painote.file
            .writeGuarded(noteData.notePath, latestContentRef.current, mtimeRef.current)
            .then((result) => {
              if (result.ok) {
                mtimeRef.current = result.mtime
                isDirtyRef.current = false
                setSaveStatus('saved')
              } else {
                console.warn('Manual save hit a write conflict; keeping local edits.')
                setSaveStatus('unsaved')
              }
            })
            .catch(() => setSaveStatus('unsaved'))
        }
      }
    }
    window.addEventListener('keydown', handler)
    return () => window.removeEventListener('keydown', handler)
  }, [noteData])

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
            onClick={handleClose}
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
      <div className="note-content">
        {isMarkdown ? (
          <MilkdownEditor
            value={content}
            onChange={handleContentChange}
            className="milkdown-editor-wrapper"
          />
        ) : (
          <textarea
            value={content}
            onChange={(e) => handleContentChange(e.target.value)}
            spellCheck={false}
            style={{
              width: '100%',
              height: '100%',
              border: 'none',
              outline: 'none',
              resize: 'none',
              padding: '16px 20px',
              fontFamily: 'var(--font-mono)',
              fontSize: '14px',
              lineHeight: 1.7,
              color: 'var(--text-primary)',
              backgroundColor: 'transparent',
              boxSizing: 'border-box',
            }}
            placeholder="Start typing..."
          />
        )}
      </div>
    </div>
  )
}

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <NoteApp />
  </React.StrictMode>
)
