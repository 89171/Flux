/**
 * PaiNote AI Panel
 *
 * AI-powered note generation panel with:
 * - Empty state with suggestion buttons
 * - Scrollable message list (user + assistant)
 * - File attachment support
 * - "Apply to note" action on assistant messages
 * - Voice input (delegates to attachment flow)
 */

import { useState, useRef, useEffect, useCallback, type CSSProperties } from 'react'
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
  Trash2
} from 'lucide-react'
import { useAIStore } from '../stores/aiStore'
import { useFileStore } from '../stores/fileStore'

const suggestions = [
  'Summarize this note',
  'Generate meeting notes',
  'Create a task list',
  'Explain this concept'
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
  const attachments = useAIStore((s) => s.attachments)
  const generate = useAIStore((s) => s.generate)
  const addAttachment = useAIStore((s) => s.addAttachment)
  const clearAttachments = useAIStore((s) => s.clearAttachments)
  const clearMessages = useAIStore((s) => s.clearMessages)

  const currentFile = useFileStore((s) => s.currentFile)
  const currentContent = useFileStore((s) => s.currentContent)
  const setContent = useFileStore((s) => s.setContent)

  const [input, setInput] = useState('')
  const messagesEndRef = useRef<HTMLDivElement>(null)
  const textareaRef = useRef<HTMLTextAreaElement>(null)

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

  const handleSend = useCallback(async () => {
    const prompt = input.trim()
    if (!prompt || isGenerating) return

    const format = currentFile?.format || 'markdown'
    const context = currentContent || undefined

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
    (content: string) => {
      const existing = currentContent || ''
      const separator = existing ? '\n\n' : ''
      setContent(existing + separator + content)
    },
    [currentContent, setContent]
  )

  const handleAttach = useCallback(async () => {
    try {
      const filePath = await window.painote.dialog.openFile({
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

          {messages.map((msg, idx) => (
            <div key={idx} className={`ai-message ${msg.role}`}>
              <div className="role">{msg.role === 'user' ? 'You' : 'AI Assistant'}</div>
              <div style={{ whiteSpace: 'pre-wrap', wordBreak: 'break-word' }}>{msg.content}</div>
              {msg.role === 'assistant' && (
                <button
                  className="btn btn-primary"
                  style={{ marginTop: 8, fontSize: 'var(--font-size-xs)', padding: '3px 8px', gap: 4 }}
                  onClick={() => handleApplyToNote(msg.content)}
                >
                  <Check size={12} /> Apply to note
                </button>
              )}
            </div>
          ))}

          {/* Loading state */}
          {isGenerating && (
            <div className="ai-message assistant">
              <div className="role">AI Assistant</div>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8, color: 'var(--text-tertiary)' }}>
                <div className="spinner" />
                <span>Generating...</span>
              </div>
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
          </div>

          <button
            className="btn btn-primary"
            onClick={handleSend}
            disabled={!input.trim() || isGenerating}
            style={{ gap: 4, padding: '6px 14px' }}
          >
            {isGenerating ? (
              <>
                <div className="spinner" />
                <span>Generating...</span>
              </>
            ) : (
              <>
                <Send size={14} />
                <span>Generate</span>
              </>
            )}
          </button>
        </div>
      </div>
    </div>
  )
}
