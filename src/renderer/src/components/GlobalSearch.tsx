/**
 * Flux Global Search
 *
 * A left-side panel that searches across all workspace files via
 * window.flux.file.search(query). Results are grouped by file, each match
 * shows the line number with the matched text highlighted. Clicking a
 * result calls onOpenFile(path) and closes the panel.
 *
 * Search fires after a 300ms debounce or immediately on Enter.
 */

import { useState, useEffect, useRef, useCallback, type CSSProperties } from 'react'
import { Search, X, FileText } from 'lucide-react'
import type { SearchResult } from '@shared/types'

interface GlobalSearchProps {
  onClose: () => void
  onOpenFile: (path: string) => void
}

interface FileGroup {
  path: string
  name: string
  matches: SearchResult[]
}

function groupByFile(results: SearchResult[]): FileGroup[] {
  const map = new Map<string, FileGroup>()
  for (const r of results) {
    let g = map.get(r.path)
    if (!g) {
      g = { path: r.path, name: r.name, matches: [] }
      map.set(r.path, g)
    }
    g.matches.push(r)
  }
  return Array.from(map.values())
}

function HighlightedLine({
  line,
  start,
  end
}: {
  line: string
  start: number
  end: number
}) {
  // Guard against bad indices returned from the search backend.
  const safeStart = Math.max(0, Math.min(start, line.length))
  const safeEnd = Math.max(safeStart, Math.min(end, line.length))
  return (
    <>
      {line.slice(0, safeStart)}
      <mark style={markStyle}>{line.slice(safeStart, safeEnd)}</mark>
      {line.slice(safeEnd)}
    </>
  )
}

const markStyle: CSSProperties = {
  background: 'var(--bg-active)',
  color: 'var(--text-primary)',
  padding: '0 2px',
  borderRadius: 2,
  fontWeight: 600
}

function GlobalSearch({ onClose, onOpenFile }: GlobalSearchProps) {
  const [query, setQuery] = useState('')
  const [results, setResults] = useState<FileGroup[]>([])
  const [isSearching, setIsSearching] = useState(false)
  const [hasSearched, setHasSearched] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const inputRef = useRef<HTMLInputElement>(null)

  // Focus input on mount
  useEffect(() => {
    inputRef.current?.focus()
  }, [])

  // Escape key closes the panel
  useEffect(() => {
    const handleKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', handleKey)
    return () => window.removeEventListener('keydown', handleKey)
  }, [onClose])

  // Cleanup pending debounce on unmount
  useEffect(() => {
    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current)
    }
  }, [])

  const runSearch = useCallback(async (q: string) => {
    const trimmed = q.trim()
    if (!trimmed) {
      setResults([])
      setHasSearched(false)
      setIsSearching(false)
      return
    }
    setIsSearching(true)
    setError(null)
    try {
      const raw = await window.flux.file.search(trimmed)
      setResults(groupByFile(raw ?? []))
      setHasSearched(true)
    } catch (err) {
      console.error('Search failed:', err)
      setError('Search failed')
      setResults([])
      setHasSearched(true)
    } finally {
      setIsSearching(false)
    }
  }, [])

  const handleQueryChange = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      const value = e.target.value
      setQuery(value)
      if (debounceRef.current) clearTimeout(debounceRef.current)
      debounceRef.current = setTimeout(() => {
        runSearch(value)
      }, 300)
    },
    [runSearch]
  )

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent<HTMLInputElement>) => {
      if (e.key === 'Enter') {
        if (debounceRef.current) clearTimeout(debounceRef.current)
        runSearch(query)
      }
    },
    [query, runSearch]
  )

  const handleClear = useCallback(() => {
    if (debounceRef.current) clearTimeout(debounceRef.current)
    setQuery('')
    setResults([])
    setHasSearched(false)
    setError(null)
    inputRef.current?.focus()
  }, [])

  const handleOpen = useCallback(
    (path: string) => {
      onOpenFile(path)
      onClose()
    },
    [onOpenFile, onClose]
  )

  // ─── Styles ───
  const panelStyle: CSSProperties = {
    width: 400,
    height: '100%',
    display: 'flex',
    flexDirection: 'column',
    background: 'var(--bg-primary)',
    borderRight: '1px solid var(--border-light)',
    overflow: 'hidden'
  }

  const headerStyle: CSSProperties = {
    display: 'flex',
    alignItems: 'center',
    gap: 8,
    padding: '10px 12px',
    borderBottom: '1px solid var(--border-light)',
    flexShrink: 0
  }

  const inputWrapperStyle: CSSProperties = {
    flex: 1,
    display: 'flex',
    alignItems: 'center',
    gap: 6,
    padding: '4px 10px',
    background: 'var(--bg-tertiary)',
    border: '1px solid var(--border-color)',
    borderRadius: 'var(--radius-sm)'
  }

  const inputStyle: CSSProperties = {
    flex: 1,
    border: 'none',
    outline: 'none',
    background: 'transparent',
    color: 'var(--text-primary)',
    fontSize: 'var(--font-size-base)',
    fontFamily: 'inherit'
  }

  const listStyle: CSSProperties = {
    flex: 1,
    overflowY: 'auto',
    padding: '8px 0'
  }

  const groupStyle: CSSProperties = {
    marginBottom: 8
  }

  const groupHeaderStyle: CSSProperties = {
    display: 'flex',
    alignItems: 'center',
    gap: 6,
    padding: '6px 12px',
    position: 'sticky',
    top: 0,
    background: 'var(--bg-secondary)',
    borderBottom: '1px solid var(--border-light)'
  }

  const matchRowStyle: CSSProperties = {
    display: 'flex',
    gap: 8,
    padding: '4px 12px 4px 32px',
    cursor: 'pointer',
    whiteSpace: 'nowrap',
    overflow: 'hidden',
    alignItems: 'baseline'
  }

  const lineTextStyle: CSSProperties = {
    flex: 1,
    fontFamily: 'var(--font-mono)',
    fontSize: 'var(--font-size-sm)',
    color: 'var(--text-secondary)',
    whiteSpace: 'nowrap',
    overflow: 'hidden',
    textOverflow: 'ellipsis'
  }

  const lineNumStyle: CSSProperties = {
    fontSize: 'var(--font-size-xs)',
    color: 'var(--text-tertiary)',
    flexShrink: 0,
    minWidth: 28,
    textAlign: 'right'
  }

  const footerStyle: CSSProperties = {
    padding: '6px 12px',
    borderTop: '1px solid var(--border-light)',
    fontSize: 'var(--font-size-xs)',
    color: 'var(--text-tertiary)',
    flexShrink: 0
  }

  const emptyStateStyle: CSSProperties = {
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'center',
    justifyContent: 'center',
    padding: '32px 20px',
    color: 'var(--text-tertiary)',
    gap: 8,
    textAlign: 'center'
  }

  const totalMatches = results.reduce((sum, g) => sum + g.matches.length, 0)

  return (
    <div style={panelStyle}>
      {/* Header / search input */}
      <div style={headerStyle}>
        <div style={inputWrapperStyle}>
          <Search size={14} style={{ color: 'var(--text-tertiary)', flexShrink: 0 }} />
          <input
            ref={inputRef}
            style={inputStyle}
            value={query}
            onChange={handleQueryChange}
            onKeyDown={handleKeyDown}
            placeholder="Search in files..."
            spellCheck={false}
          />
          {query && (
            <button
              className="btn-icon"
              onClick={handleClear}
              title="Clear"
              aria-label="Clear search"
              style={{ width: 18, height: 18, flexShrink: 0 }}
            >
              <X size={12} />
            </button>
          )}
        </div>
        <button
          className="btn-icon"
          onClick={onClose}
          title="Close (Esc)"
          aria-label="Close"
          style={{ width: 28, height: 28, flexShrink: 0 }}
        >
          <X size={16} />
        </button>
      </div>

      {/* Results */}
      <div style={listStyle}>
        {error ? (
          <div style={emptyStateStyle}>
            <span style={{ color: 'var(--text-secondary)' }}>{error}</span>
          </div>
        ) : isSearching ? (
          <div style={emptyStateStyle}>
            <div className="spinner" />
            <span>Searching...</span>
          </div>
        ) : results.length === 0 ? (
          <div style={emptyStateStyle}>
            {hasSearched ? (
              <>
                <Search size={20} style={{ color: 'var(--text-disabled)' }} />
                <span>No results</span>
              </>
            ) : (
              <>
                <Search size={20} style={{ color: 'var(--text-disabled)' }} />
                <span>Type to search across all files</span>
              </>
            )}
          </div>
        ) : (
          results.map((group) => (
            <div key={group.path} style={groupStyle}>
              <div style={groupHeaderStyle} title={group.path}>
                <FileText size={14} style={{ color: 'var(--text-tertiary)', flexShrink: 0 }} />
                <span
                  style={{
                    fontWeight: 600,
                    color: 'var(--text-primary)',
                    fontSize: 'var(--font-size-sm)'
                  }}
                >
                  {group.name}
                </span>
                <span
                  style={{
                    fontSize: 'var(--font-size-xs)',
                    color: 'var(--text-tertiary)',
                    marginLeft: 'auto',
                    flexShrink: 0
                  }}
                >
                  {group.matches.length}
                </span>
              </div>
              <div
                style={{
                  fontSize: 'var(--font-size-xs)',
                  color: 'var(--text-tertiary)',
                  padding: '0 12px 2px 32px',
                  whiteSpace: 'nowrap',
                  overflow: 'hidden',
                  textOverflow: 'ellipsis'
                }}
              >
                {group.path}
              </div>
              {group.matches.map((m, idx) => (
                <div
                  key={`${m.path}:${m.line}:${idx}`}
                  style={matchRowStyle}
                  onClick={() => handleOpen(m.path)}
                  title={`${m.path}:${m.line}`}
                  onMouseEnter={(e) => {
                    ;(e.currentTarget as HTMLDivElement).style.background = 'var(--bg-hover)'
                  }}
                  onMouseLeave={(e) => {
                    ;(e.currentTarget as HTMLDivElement).style.background = 'transparent'
                  }}
                >
                  <span style={lineNumStyle}>{m.line}</span>
                  <span style={lineTextStyle}>
                    <HighlightedLine line={m.lineText} start={m.matchStart} end={m.matchEnd} />
                  </span>
                </div>
              ))}
            </div>
          ))
        )}
      </div>

      {/* Footer */}
      {hasSearched && !isSearching && !error && (
        <div style={footerStyle}>
          {totalMatches} match{totalMatches === 1 ? '' : 'es'} in {results.length} file
          {results.length === 1 ? '' : 's'}
        </div>
      )}
    </div>
  )
}

export default GlobalSearch
