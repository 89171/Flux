/**
 * PaiNote Editor Component
 *
 * Main note editor area with toolbar and content editing.
 * Supports markdown (WYSIWYG via Milkdown) and non-markdown formats (textarea).
 * Features: drag & drop files, keyboard save shortcut, AI generate, pin to desktop.
 */

import { useCallback, useState, useEffect, useRef } from 'react'
import {
  Eye,
  Pencil,
  Save,
  Pin,
  ExternalLink,
  Sparkles,
  FileText
} from 'lucide-react'
import MarkdownEditor from './MilkdownEditor'
import DrawioEditor from './DrawioEditor'
import MindmapEditor from './MindmapEditor'
import { marked } from 'marked'
import { useFileStore } from '../stores/fileStore'
import { useAIStore } from '../stores/aiStore'
import type { NoteFormat } from '@shared/types'

/**
 * Determines the note format from a file extension.
 */
function getFormatFromExtension(filename: string): NoteFormat {
  const ext = filename.split('.').pop()?.toLowerCase() || ''
  switch (ext) {
    case 'md':
    case 'markdown':
      return 'markdown'
    case 'drawio':
      return 'drawio'
    case 'mm':
      return 'mindmap'
    default:
      return 'plaintext'
  }
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
    case 'plaintext':
      return 'TXT'
    default:
      return format.toUpperCase()
  }
}

export default function Editor(): JSX.Element {
  const { currentFile, currentContent, setContent, saveFile, isDirty } =
    useFileStore()
  const { openPanel, generate, isGenerating } = useAIStore()

  const [isDragOver, setIsDragOver] = useState(false)
  const [isPinned, setIsPinned] = useState(false)
  const textareaRef = useRef<HTMLTextAreaElement>(null)

  const isMarkdown = currentFile?.format === 'markdown'
  const format = currentFile?.format

  // Keyboard shortcut: Cmd/Ctrl+S to save
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key === 's') {
        e.preventDefault()
        saveFile()
      }
    }
    window.addEventListener('keydown', handler)
    return () => window.removeEventListener('keydown', handler)
  }, [saveFile])

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
          const detectedFormat = getFormatFromExtension(file.name)
          window.painote.window.openNote({
            noteId: file.path,
            notePath: file.path,
            noteName: file.name,
            format: detectedFormat,
            isPinned: false
          })
        }
      }
    },
    []
  )

  // AI Generate handler
  const handleAIGenerate = useCallback(async () => {
    openPanel()
    // The AI panel itself handles prompting; opening it is sufficient.
  }, [openPanel])

  // Pin to Desktop handler - opens a pinned note window
  const handlePin = useCallback(async () => {
    if (!currentFile) return
    try {
      const newState = !isPinned
      if (newState) {
        // Open a pinned note window
        await window.painote.window.openNote({
          noteId: currentFile.id,
          notePath: currentFile.path,
          noteName: currentFile.name,
          format: currentFile.format || 'plaintext',
          isPinned: true
        })
      } else {
        // Close the pinned note window
        await window.painote.window.close(currentFile.id)
      }
      setIsPinned(newState)
    } catch (err) {
      console.error('Failed to toggle pin:', err)
    }
  }, [currentFile, isPinned])

  // Open in New Window handler
  const handleOpenNewWindow = useCallback(() => {
    if (!currentFile) return
    window.painote.window.openNote({
      noteId: currentFile.id,
      notePath: currentFile.path,
      noteName: currentFile.name,
      format: currentFile.format || 'plaintext',
      isPinned: false
    })
  }, [currentFile])

  // Handle non-markdown textarea change
  const handleTextareaChange = useCallback(
    (e: React.ChangeEvent<HTMLTextAreaElement>) => {
      setContent(e.target.value)
    },
    [setContent]
  )

  // Render non-markdown preview using marked (fallback)
  const nonMdPreviewHtml = currentFile && !isMarkdown && currentContent
    ? marked.parse(currentContent) as string
    : ''

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

      {/* Editor content area */}
      <div
        className="editor-content"
        style={{
          flex: 1,
          overflow: 'auto',
          position: 'relative'
        }}
      >
        {isMarkdown ? (
          <MarkdownEditor
            key={currentFile.path}
            value={currentContent}
            onChange={(md) => setContent(md)}
            className="markdown-editor-wrapper"
          />
        ) : format === 'drawio' ? (
          <DrawioEditor
            key={currentFile.path}
            value={currentContent}
            onChange={(xml) => setContent(xml)}
            className="drawio-editor-wrapper"
          />
        ) : format === 'mindmap' ? (
          <MindmapEditor
            key={currentFile.path}
            value={currentContent}
            onChange={(data) => setContent(data)}
            className="mindmap-editor-wrapper"
          />
        ) : (
          <textarea
            ref={textareaRef}
            value={currentContent}
            onChange={handleTextareaChange}
            spellCheck={false}
            style={{
              width: '100%',
              height: '100%',
              padding: '24px 32px',
              border: 'none',
              outline: 'none',
              resize: 'none',
              fontFamily: 'var(--font-mono, "SF Mono", "Fira Code", "Cascadia Code", monospace)',
              fontSize: '14px',
              lineHeight: 1.7,
              color: 'var(--text-primary)',
              backgroundColor: 'transparent',
              tabSize: 2,
              boxSizing: 'border-box'
            }}
            placeholder="Start typing..."
          />
        )}
      </div>
    </div>
  )
}
