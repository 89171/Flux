/**
 * Flux AI Panel
 *
 * AI-powered note generation panel with:
 * - Empty state with suggestion buttons
 * - Scrollable message list (user + assistant)
 * - File attachment support
 * - "Apply to note" action on assistant messages
 * - Voice input (delegates to attachment flow)
 */

import { useState, useRef, useEffect, useCallback } from 'react'
import {
  Send,
  Paperclip,
  Mic,
  X,
  Sparkles,
  FileText,
  Image,
  Music,
  Check,
  Copy,
  Trash2,
  Zap,
  Square,
  FilePlus
} from 'lucide-react'
import { useAIStore } from '../stores/aiStore'
import { useFileStore } from '../stores/fileStore'
import type { NoteFile } from '@shared/types'

const suggestions = [
  'Summarize this document',
  'Improve the writing',
  'Create a flowchart from this content',
  'Generate an outline'
]

function getAttachmentIcon(type: string) {
  switch (type) {
    case 'image':
      return <Image size={12} />
    case 'audio':
      return <Music size={12} />
    default:
      return <FileText size={12} />
  }
}

export function AIPanel() {
  const messages = useAIStore((s) => s.messages)
  const isGenerating = useAIStore((s) => s.isGenerating)
  const error = useAIStore((s) => s.error)
  const streamingContent = useAIStore((s) => s.streamingContent)
  const attachments = useAIStore((s) => s.attachments)
  const generate = useAIStore((s) => s.generate)
  const cancelGenerate = useAIStore((s) => s.cancelGenerate)
  const addAttachment = useAIStore((s) => s.addAttachment)
  const clearAttachments = useAIStore((s) => s.clearAttachments)
  const clearMessages = useAIStore((s) => s.clearMessages)

  const currentFile = useFileStore((s) => s.currentFile)
  const currentContent = useFileStore((s) => s.currentContent)
  const setContent = useFileStore((s) => s.setContent)
  const openFile = useFileStore((s) => s.openFile)
  const tree = useFileStore((s) => s.tree)

  const [input, setInput] = useState('')
  const [copiedIdx, setCopiedIdx] = useState<number | null>(null)

  const handleCopy = useCallback((content: string, idx: number) => {
    navigator.clipboard.writeText(content).then(() => {
      setCopiedIdx(idx)
      setTimeout(() => setCopiedIdx((prev) => (prev === idx ? null : prev)), 1500)
    })
  }, [])

  // When true, AI chunks stream directly into the note editor — the
  // user sees text appear in the file in real time. When false, chunks
  // only appear in the AI panel; Replace/Append applies them after.
  const [streamToNote, setStreamToNote] = useState(false)
  // Remembers the note's content at the start of streaming so append
  // mode can prepend the original text.
  const preStreamContentRef = useRef('')
  const messagesEndRef = useRef<HTMLDivElement>(null)
  const textareaRef = useRef<HTMLTextAreaElement>(null)

  const handleOpenCreatedFile = useCallback(
    async (filePath: string) => {
      const findInTree = (nodes: NoteFile[]): NoteFile | null => {
        for (const n of nodes) {
          if (n.path === filePath) return n
          if (n.children) {
            const found = findInTree(n.children)
            if (found) return found
          }
        }
        return null
      }
      const found = findInTree(tree)
      if (found) {
        openFile(found)
        return
      }
      // Tree may not have refreshed yet — fetch it then retry
      const freshTree = await window.flux.file.getTree()
      const foundFresh = findInTree(freshTree)
      if (foundFresh) openFile(foundFresh)
    },
    [tree, openFile]
  )

  // Auto-scroll to bottom when new messages arrive
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [messages, isGenerating])

  // Auto-resize textarea
  useEffect(() => {
    const ta = textareaRef.current
    if (ta) {
      ta.style.height = 'auto'
      ta.style.height = `${Math.min(Math.max(ta.scrollHeight, 60), 120)}px`
    }
  }, [input])

  // ─── Stream to Note ───
  // When streamToNote is on and the AI is producing chunks, push each
  // chunk into the file's content so the editor updates live. The
  // MilkdownEditor's external-sync effect picks up the new value and
  // calls replaceAll() — the user sees text appear word-by-word.
  //
  // Replace mode: setContent(streamingContent) — file becomes the
  //   streaming AI output.
  // Append mode: setContent(original + separator + streamingContent)
  //   — AI text is appended below the original note content.
  const streamModeRef = useRef<'replace' | 'append'>('replace')
  useEffect(() => {
    if (!streamToNote || !isGenerating || !streamingContent) return
    if (streamModeRef.current === 'replace') {
      setContent(streamingContent)
    } else {
      const existing = preStreamContentRef.current
      const separator = existing ? '\n\n' : ''
      setContent(existing + separator + streamingContent)
    }
  }, [streamToNote, isGenerating, streamingContent, setContent])

  const handleSend = useCallback(async () => {
    const prompt = input.trim()
    if (!prompt || isGenerating) return

    const format = currentFile?.format || 'markdown'
    const context = currentContent || undefined

    // Snapshot the note content before streaming starts so append mode
    // can prepend it later.
    preStreamContentRef.current = currentContent || ''

    setInput('')
    await generate(prompt, format, context)
  }, [input, isGenerating, currentFile?.format, currentContent, generate])

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
      if (e.key === 'Enter' && !e.shiftKey) {
        e.preventDefault()
        handleSend()
      }
    },
    [handleSend]
  )

  const handleApplyToNote = useCallback(
    (content: string, mode: 'append' | 'replace') => {
      if (mode === 'replace') {
        setContent(content)
      } else {
        const existing = currentContent || ''
        const separator = existing ? '\n\n' : ''
        setContent(existing + separator + content)
      }
    },
    [currentContent, setContent]
  )

  const handleAttach = useCallback(async () => {
    try {
      const filePath = await window.flux.dialog.openFile({
        title: 'Attach File',
        filters: [
          { name: 'All Files', extensions: ['*'] },
          { name: 'Images', extensions: ['png', 'jpg', 'jpeg', 'gif', 'webp'] },
          { name: 'Audio', extensions: ['mp3', 'wav', 'ogg', 'm4a'] },
          { name: 'Documents', extensions: ['md', 'txt', 'pdf'] }
        ]
      })
      if (filePath) {
        const name = filePath.split(/[\\/]/).pop() || filePath
        let type: 'file' | 'image' | 'audio' = 'file'
        const lowerName = name.toLowerCase()
        if (/\.(png|jpg|jpeg|gif|webp)$/i.test(lowerName)) {
          type = 'image'
        } else if (/\.(mp3|wav|ogg|m4a)$/i.test(lowerName)) {
          type = 'audio'
        }
        addAttachment({ type, path: filePath, name })
      }
    } catch (err) {
      console.error('Failed to attach file:', err)
    }
  }, [addAttachment])

  const handleRemoveAttachment = useCallback(
    (index: number) => {
      const updated = attachments.filter((_, i) => i !== index)
      clearAttachments()
      updated.forEach((a) => addAttachment(a))
    },
    [attachments, clearAttachments, addAttachment]
  )

  // ─── Render ───

  return (
    <div className="ai-panel">
      {/* Messages area */}
      {messages.length === 0 ? (
        /* Empty state */
        <div className="ai-empty">
          <Sparkles size={32} style={{ color: 'var(--text-disabled)', marginBottom: 4 }} />
          <div style={{ fontSize: 'var(--font-size-lg)', fontWeight: 600, color: 'var(--text-primary)' }}>
            AI Note Assistant
          </div>
          <div style={{ fontSize: 'var(--font-size-sm)', color: 'var(--text-tertiary)', maxWidth: 240, lineHeight: 1.5 }}>
            Generate, summarize, and transform your notes with AI. Try a suggestion below or type your own prompt.
          </div>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, justifyContent: 'center', marginTop: 8 }}>
            {suggestions.map((s) => (
              <button
                key={s}
                className="btn btn-ghost"
                style={{ fontSize: 'var(--font-size-xs)', padding: '4px 10px' }}
                onClick={() => setInput(s)}
              >
                {s}
              </button>
            ))}
          </div>
        </div>
      ) : (
        /* Message list */
        <div className="ai-messages">
          {/* Clear conversation */}
          <div style={{ display: 'flex', justifyContent: 'flex-end', marginBottom: 4 }}>
            <button
              className="btn-icon"
              style={{ fontSize: 'var(--font-size-xs)', gap: 4, display: 'flex', alignItems: 'center' }}
              onClick={clearMessages}
              title="Clear conversation"
            >
              <Trash2 size={12} />
              <span>Clear conversation</span>
            </button>
          </div>

          {messages.map((msg, idx) => {
            /* ── Tool result card (file creation) ── */
            if (msg.role === 'tool' && msg.toolEvent) {
              const { result } = msg.toolEvent
              return (
                <div
                  key={idx}
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: 8,
                    padding: '6px 10px',
                    margin: '4px 0',
                    borderRadius: 'var(--radius-md)',
                    background: result.success ? 'var(--bg-secondary)' : '#fff0f0',
                    border: `1px solid ${result.success ? 'var(--border-color)' : '#ffcdd2'}`,
                    fontSize: 'var(--font-size-xs)',
                    color: result.success ? 'var(--text-secondary)' : '#c62828'
                  }}
                >
                  {result.success ? (
                    <FilePlus size={13} style={{ color: 'var(--accent)', flexShrink: 0 }} />
                  ) : (
                    <X size={13} style={{ flexShrink: 0 }} />
                  )}
                  <span style={{ flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                    {result.success ? result.filePath : result.error}
                  </span>
                  {result.success && result.filePath && (
                    <button
                      className="btn btn-ghost"
                      style={{ fontSize: 'var(--font-size-xs)', padding: '2px 8px', flexShrink: 0 }}
                      onClick={() => handleOpenCreatedFile(result.filePath!)}
                    >
                      Open
                    </button>
                  )}
                </div>
              )
            }

            /* ── User / Assistant messages ── */
            return (
              <div key={idx} className={`ai-message ${msg.role}`}>
                {/* Header row: role label + copy button */}
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 4 }}>
                  <div className="role" style={{ marginBottom: 0 }}>
                    {msg.role === 'user' ? 'You' : 'AI Assistant'}
                  </div>
                  <button
                    className="btn-icon"
                    style={{ width: 20, height: 20, padding: 0, opacity: 0.6, flexShrink: 0 }}
                    onClick={() => handleCopy(msg.content, idx)}
                    title="Copy"
                  >
                    {copiedIdx === idx
                      ? <Check size={12} style={{ color: 'var(--accent)' }} />
                      : <Copy size={12} />}
                  </button>
                </div>
                <div style={{ whiteSpace: 'pre-wrap', wordBreak: 'break-word' }}>{msg.content}</div>
                {msg.role === 'assistant' && (
                  <div style={{ display: 'flex', gap: 6, marginTop: 8 }}>
                    <button
                      className="btn btn-primary"
                      style={{ fontSize: 'var(--font-size-xs)', padding: '3px 8px', gap: 4 }}
                      onClick={() => handleApplyToNote(msg.content, 'replace')}
                      title="Replace current note content"
                    >
                      <Check size={12} /> Replace
                    </button>
                    <button
                      className="btn btn-ghost"
                      style={{ fontSize: 'var(--font-size-xs)', padding: '3px 8px', gap: 4, border: '1px solid var(--border-color)' }}
                      onClick={() => handleApplyToNote(msg.content, 'append')}
                      title="Append to current note"
                    >
                      <Check size={12} /> Append
                    </button>
                  </div>
                )}
              </div>
            )
          })}

          {/* Loading / streaming state */}
          {isGenerating && (
            <div className="ai-message assistant">
              <div className="role">AI Assistant</div>
              {streamingContent ? (
                <div style={{ whiteSpace: 'pre-wrap', wordBreak: 'break-word' }}>
                  {streamingContent}
                  <span
                    style={{
                      display: 'inline-block',
                      width: 6,
                      height: 14,
                      marginLeft: 2,
                      background: 'var(--accent)',
                      verticalAlign: 'text-bottom',
                      animation: 'flux-blink 1s step-end infinite'
                    }}
                  />
                  <style>{`@keyframes flux-blink{50%{opacity:0}}`}</style>
                </div>
              ) : (
                <div style={{ display: 'flex', alignItems: 'center', gap: 8, color: 'var(--text-tertiary)' }}>
                  <div className="spinner" />
                  <span>Generating...</span>
                </div>
              )}
            </div>
          )}

          {/* Error state */}
          {error && (
            <div
              style={{
                padding: '8px 12px',
                background: '#f8d7da',
                color: '#721c24',
                borderRadius: 'var(--radius-md)',
                fontSize: 'var(--font-size-sm)',
                display: 'flex',
                alignItems: 'center',
                gap: 8
              }}
            >
              <X size={14} style={{ flexShrink: 0 }} />
              <span>{error}</span>
            </div>
          )}

          <div ref={messagesEndRef} />
        </div>
      )}

      {/* Input area */}
      <div className="ai-input-area">
        {/* Attachment chips */}
        {attachments.length > 0 && (
          <div className="ai-attachments">
            {attachments.map((att, idx) => (
              <div key={idx} className="ai-attachment-chip">
                {getAttachmentIcon(att.type)}
                <span style={{ maxWidth: 100, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                  {att.name}
                </span>
                <button
                  className="btn-icon"
                  style={{ width: 16, height: 16, padding: 0 }}
                  onClick={() => handleRemoveAttachment(idx)}
                >
                  <X size={10} />
                </button>
              </div>
            ))}
            <button
              className="btn-icon"
              style={{ width: 16, height: 16, padding: 0 }}
              onClick={clearAttachments}
              title="Remove all"
            >
              <Trash2 size={10} />
            </button>
          </div>
        )}

        {/* Textarea */}
        <textarea
          ref={textareaRef}
          className="ai-input"
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={handleKeyDown}
          placeholder="Ask AI to generate or transform notes..."
          rows={1}
        />

        {/* Bottom row */}
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
            <button className="btn-icon" onClick={handleAttach} title="Attach file">
              <Paperclip size={16} />
            </button>
            <button className="btn-icon" onClick={handleAttach} title="Voice input">
              <Mic size={16} />
            </button>
            {/* Stream-to-Note toggle: when active, AI text streams
                directly into the editor. */}
            <button
              className="btn-icon"
              onClick={() => setStreamToNote((v) => !v)}
              title={
                streamToNote
                  ? 'Stream to Note is ON — AI text writes to the file live'
                  : 'Stream to Note is OFF — click to write AI text to the file live'
              }
              style={{
                color: streamToNote ? 'var(--accent)' : 'var(--text-tertiary)',
                position: 'relative'
              }}
            >
              <Zap size={16} />
              {streamToNote && (
                <span
                  style={{
                    position: 'absolute',
                    top: -2,
                    right: -2,
                    width: 6,
                    height: 6,
                    borderRadius: '50%',
                    background: 'var(--accent)'
                  }}
                />
              )}
            </button>
            {streamToNote && (
              <select
                value={streamModeRef.current}
                onChange={(e) => {
                  streamModeRef.current = e.target.value as 'replace' | 'append'
                }}
                style={{
                  fontSize: 'var(--font-size-xs)',
                  padding: '2px 4px',
                  border: '1px solid var(--border-color)',
                  borderRadius: 'var(--radius-sm)',
                  background: 'var(--bg-primary)',
                  color: 'var(--text-secondary)'
                }}
                title="Stream mode"
              >
                <option value="replace">Replace</option>
                <option value="append">Append</option>
              </select>
            )}
          </div>

          {isGenerating ? (
            <button
              className="btn btn-ghost"
              onClick={cancelGenerate}
              style={{ gap: 4, padding: '6px 14px' }}
            >
              <Square size={14} />
              <span>Stop</span>
            </button>
          ) : (
            <button
              className="btn btn-primary"
              onClick={handleSend}
              disabled={!input.trim() || isGenerating}
              style={{ gap: 4, padding: '6px 14px' }}
            >
              <Send size={14} />
              <span>Generate</span>
            </button>
          )}
        </div>
      </div>
    </div>
  )
}
