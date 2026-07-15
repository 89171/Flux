/**
 * Flux QuickOpen - VS Code-style quick file opener (Ctrl+P modal).
 *
 * Fuzzy-filters a flat file list by name. Matching characters must
 * appear in order but not necessarily contiguously; contiguous runs,
 * matches at the start, and matches at word boundaries score higher.
 */

import {
  useState,
  useEffect,
  useMemo,
  useRef,
  type CSSProperties,
  type KeyboardEvent as ReactKeyboardEvent,
  type MouseEvent as ReactMouseEvent
} from 'react'
import { FileText } from 'lucide-react'
import type { NoteFile } from '@shared/types'

interface QuickOpenProps {
  files: NoteFile[]
  onOpen: (path: string) => void
  onClose: () => void
}

interface ScoredFile {
  file: NoteFile
  score: number
}

/**
 * Fuzzy match score: every query char must appear in the text in order
 * (not necessarily contiguous). Returns -1 if no match. Contiguous
 * runs, matches at position 0, and matches at word boundaries
 * (after / - _ . or whitespace) score higher.
 */
function fuzzyScore(query: string, text: string): number {
  if (!query) return 0
  const q = query.toLowerCase()
  const t = text.toLowerCase()
  let score = 0
  let qi = 0
  let lastMatchPos = -2
  for (let ti = 0; ti < t.length && qi < q.length; ti++) {
    if (t[ti] === q[qi]) {
      score += 1
      if (ti === lastMatchPos + 1) score += 5 // contiguous bonus
      if (ti === 0) score += 10 // start bonus
      if (ti > 0 && /[/\-_.\s]/.test(t[ti - 1])) score += 3 // word boundary
      lastMatchPos = ti
      qi++
    }
  }
  if (qi < q.length) return -1
  // Slight preference for shorter filenames (tighter match)
  score += Math.max(0, 30 - t.length) * 0.1
  return score
}

const overlayStyle: CSSProperties = {
  position: 'fixed',
  inset: 0,
  background: 'rgba(0, 0, 0, 0.4)',
  zIndex: 1000,
  display: 'flex',
  flexDirection: 'column',
  alignItems: 'center',
  paddingTop: 100
}

const modalStyle: CSSProperties = {
  width: 500,
  maxWidth: '92vw',
  background: 'var(--bg-primary)',
  border: '1px solid var(--border-color)',
  borderRadius: 'var(--radius-md, 8px)',
  boxShadow: '0 8px 24px rgba(0, 0, 0, 0.3)',
  overflow: 'hidden'
}

const inputStyle: CSSProperties = {
  width: '100%',
  boxSizing: 'border-box',
  padding: '10px 12px',
  border: 'none',
  borderBottom: '1px solid var(--border-light)',
  background: 'transparent',
  color: 'var(--text-primary)',
  fontSize: 'var(--font-size-base)',
  fontFamily: 'var(--font-sans)',
  outline: 'none'
}

export default function QuickOpen({ files, onOpen, onClose }: QuickOpenProps) {
  const [query, setQuery] = useState('')
  const [selectedIndex, setSelectedIndex] = useState(0)
  const inputRef = useRef<HTMLInputElement>(null)
  const listRef = useRef<HTMLDivElement>(null)

  const results = useMemo<ScoredFile[]>(() => {
    const trimmed = query.trim()
    if (!trimmed) {
      return files
        .filter((f) => f.type !== 'directory')
        .slice(0, 20)
        .map((file) => ({ file, score: 0 }))
    }
    const scored: ScoredFile[] = []
    for (const file of files) {
      if (file.type === 'directory') continue
      const score = fuzzyScore(trimmed, file.name)
      if (score >= 0) scored.push({ file, score })
    }
    scored.sort((a, b) => b.score - a.score)
    return scored.slice(0, 20)
  }, [query, files])

  // Reset selection whenever the result set changes
  useEffect(() => {
    setSelectedIndex(0)
  }, [query])

  // Autofocus the input on mount
  useEffect(() => {
    inputRef.current?.focus()
  }, [])

  // Keep the selected item scrolled into view
  useEffect(() => {
    const list = listRef.current
    if (!list) return
    const item = list.children[selectedIndex] as HTMLElement | undefined
    if (item) item.scrollIntoView({ block: 'nearest' })
  }, [selectedIndex])

  const handleKeyDown = (e: ReactKeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'ArrowDown') {
      e.preventDefault()
      if (results.length === 0) return
      setSelectedIndex((i) => (i + 1) % results.length)
    } else if (e.key === 'ArrowUp') {
      e.preventDefault()
      if (results.length === 0) return
      setSelectedIndex((i) => (i - 1 + results.length) % results.length)
    } else if (e.key === 'Enter') {
      e.preventDefault()
      const selected = results[selectedIndex]
      if (selected) onOpen(selected.file.path)
    } else if (e.key === 'Escape') {
      e.preventDefault()
      onClose()
    }
  }

  const handleOverlayClick = (e: ReactMouseEvent<HTMLDivElement>) => {
    if (e.target === e.currentTarget) onClose()
  }

  const handleResultClick = (index: number) => {
    const selected = results[index]
    if (selected) onOpen(selected.file.path)
  }

  return (
    <div style={overlayStyle} onClick={handleOverlayClick}>
      <div style={modalStyle}>
        <input
          ref={inputRef}
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          onKeyDown={handleKeyDown}
          placeholder="Search files by name..."
          style={inputStyle}
          spellCheck={false}
          autoComplete="off"
        />
        <div ref={listRef} style={{ maxHeight: 400, overflowY: 'auto' }}>
          {results.length === 0 ? (
            <div
              style={{
                padding: '16px 12px',
                color: 'var(--text-tertiary)',
                fontSize: 'var(--font-size-sm)',
                textAlign: 'center'
              }}
            >
              No matching files
            </div>
          ) : (
            results.map(({ file }, index) => {
              const isSelected = index === selectedIndex
              return (
                <div
                  key={file.path}
                  onClick={() => handleResultClick(index)}
                  onMouseEnter={() => setSelectedIndex(index)}
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: 8,
                    padding: '8px 12px',
                    cursor: 'pointer',
                    background: isSelected ? 'var(--bg-active)' : 'transparent',
                    color: 'var(--text-primary)'
                  }}
                >
                  <FileText size={16} style={{ flexShrink: 0, opacity: 0.7 }} />
                  <span style={{ fontWeight: 500, whiteSpace: 'nowrap' }}>
                    {file.name}
                  </span>
                  <span
                    style={{
                      color: 'var(--text-tertiary)',
                      fontSize: 'var(--font-size-sm)',
                      marginLeft: 'auto',
                      overflow: 'hidden',
                      textOverflow: 'ellipsis',
                      whiteSpace: 'nowrap'
                    }}
                    title={file.path}
                  >
                    {file.path}
                  </span>
                </div>
              )
            })
          )}
        </div>
      </div>
    </div>
  )
}
