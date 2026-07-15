/**
 * Flux Outline — Table of Contents panel for Markdown documents
 *
 * Parses the supplied markdown content for headings (both ATX `#`-style
 * and setext `===` / `---` underlined style) and renders them as an
 * indented, clickable tree. Clicking a heading calls `onNavigate(line)`
 * so the parent can scroll the editor to that line.
 *
 * - Headings are re-parsed with `useMemo`, only when `content` changes.
 * - Lines inside fenced code blocks (``` / ~~~) are never treated as
 *   headings, so `#`-comments and `===` dividers in code samples don't
 *   pollute the outline.
 * - Pure inline styles + CSS variables — no stylesheet changes required.
 */

import { useMemo, useState, type CSSProperties } from 'react'
import { List, Hash, X } from 'lucide-react'

interface OutlineProps {
  /** Markdown content to parse for headings. */
  content: string
  /** Called with a 1-based line number when a heading is clicked. */
  onNavigate: (lineNumber: number) => void
  /** Optional close handler; renders an X button in the header when set. */
  onClose?: () => void
}

interface Heading {
  level: number // 1–6
  text: string // heading text, leading/trailing `#` stripped
  line: number // 1-based line number of the heading text
}

/**
 * Extract headings from markdown source.
 *
 * Handles:
 *   - ATX headings: 1–6 leading `#` followed by a space (an optional
 *     closing `#` sequence is stripped). `###foo` (no space) is not a
 *     heading.
 *   - Setext headings: a paragraph line immediately followed by a line
 *     of `=` (→ H1) or `-` (→ H2). The reported line number is that of
 *     the *text* line, not the underline.
 *   - Fenced code blocks (``` or ~~~): content inside is ignored so
 *     `#`-prefixed comments and `===` dividers in code don't create
 *     false headings.
 */
function parseHeadings(content: string): Heading[] {
  const headings: Heading[] = []
  const lines = content.split('\n')

  let inCodeFence = false
  let fenceMarker = '' // '`' or '~'
  let fenceLen = 0

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]

    // ── Fenced code block tracking ──
    const fenceMatch = line.match(/^[ \t]{0,3}(`{3,}|~{3,})/)
    if (fenceMatch) {
      const marker = fenceMatch[1][0]
      const len = fenceMatch[1].length
      if (!inCodeFence) {
        inCodeFence = true
        fenceMarker = marker
        fenceLen = len
        continue
      } else if (marker === fenceMarker) {
        // A closing fence is only the marker chars (+ optional trailing
        // whitespace) and at least as long as the opening fence.
        if (/^[ \t]{0,3}(`{3,}|~{3,})[ \t]*$/.test(line) && len >= fenceLen) {
          inCodeFence = false
          fenceMarker = ''
          fenceLen = 0
          continue
        }
      }
    }

    // Anything inside a code block is not heading material.
    if (inCodeFence) continue

    // ── ATX headings ──
    // 1–6 `#`, optionally followed by space + content. Requires either a
    // space after the hashes or end-of-line, so `###foo` is excluded.
    const atxMatch = line.match(/^[ \t]{0,3}(#{1,6})(?:[ \t]+(.*?))?[ \t]*$/)
    if (atxMatch) {
      const level = atxMatch[1].length
      let text = (atxMatch[2] ?? '').trim()
      // Strip an optional closing sequence of `#` (must be preceded by
      // whitespace, per CommonMark). A lone `#` with no space before it
      // is kept as content.
      text = text.replace(/[ \t]+#+[ \t]*$/, '').trim()
      // Skip empty headings and headings whose text was only a closing
      // sequence (e.g. `### ##`).
      if (text.length > 0 && !/^#+$/.test(text)) {
        headings.push({ level, text, line: i + 1 })
      }
      continue
    }

    // ── Setext headings ──
    // A line of `=` or `-` turns the *previous* line into an H1 / H2 —
    // but only if that previous line is non-blank, isn't already a
    // heading, isn't a fence marker, and isn't itself an underline.
    const setextMatch = line.match(/^[ \t]{0,3}(=+|-+)[ \t]*$/)
    if (setextMatch && i > 0) {
      const prevLine = lines[i - 1]
      const prevIsBlank = prevLine.trim().length === 0
      const prevIsFence = /^[ \t]{0,3}(`{3,}|~{3,})/.test(prevLine)
      const prevIsUnderline = /^[ \t]{0,3}(=+|-+)[ \t]*$/.test(prevLine)
      // Was the previous line already consumed as a heading?
      const last = headings[headings.length - 1]
      const prevConsumed = !!last && last.line === i // (i - 1) + 1 === i

      if (!prevIsBlank && !prevIsFence && !prevIsUnderline && !prevConsumed) {
        const level = setextMatch[1][0] === '=' ? 1 : 2
        headings.push({ level, text: prevLine.trim(), line: i }) // text line, 1-based
      }
    }
  }

  return headings
}

/** Indentation (px) per heading level. H1 is flush-left. */
const INDENT_BY_LEVEL: Record<number, number> = {
  1: 0,
  2: 12,
  3: 24,
  4: 36,
  5: 48,
  6: 60
}

export default function Outline({ content, onNavigate, onClose }: OutlineProps) {
  // Re-parse only when the markdown content actually changes.
  const headings = useMemo(() => parseHeadings(content), [content])

  const [hoveredIndex, setHoveredIndex] = useState<number | null>(null)
  const [activeLine, setActiveLine] = useState<number | null>(null)

  const handleClick = (line: number) => {
    setActiveLine(line)
    onNavigate(line)
  }

  // ── Styles ──

  const containerStyle: CSSProperties = {
    width: 240,
    height: '100%',
    flexShrink: 0,
    display: 'flex',
    flexDirection: 'column',
    borderLeft: '1px solid var(--border-light)',
    background: 'var(--bg-secondary)',
    fontFamily: 'var(--font-sans)',
    fontSize: 13,
    color: 'var(--text-primary)',
    userSelect: 'none'
  }

  const headerStyle: CSSProperties = {
    display: 'flex',
    alignItems: 'center',
    gap: 6,
    padding: '10px 12px',
    borderBottom: '1px solid var(--border-light)',
    flexShrink: 0
  }

  const titleStyle: CSSProperties = {
    flex: 1,
    fontSize: 'var(--font-size-xs)',
    fontWeight: 600,
    textTransform: 'uppercase',
    letterSpacing: 0.5,
    color: 'var(--text-secondary)'
  }

  const closeBtnStyle: CSSProperties = {
    display: 'inline-flex',
    alignItems: 'center',
    justifyContent: 'center',
    width: 22,
    height: 22,
    border: 'none',
    background: 'transparent',
    color: 'var(--text-tertiary)',
    cursor: 'pointer',
    borderRadius: 'var(--radius-sm)',
    padding: 0,
    transition: 'all var(--transition-fast)'
  }

  const listStyle: CSSProperties = {
    flex: 1,
    overflowY: 'auto',
    overflowX: 'hidden',
    padding: '6px 0'
  }

  const emptyStyle: CSSProperties = {
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    height: '100%',
    padding: 24,
    color: 'var(--text-disabled)',
    fontSize: 'var(--font-size-sm)',
    textAlign: 'center'
  }

  return (
    <div style={containerStyle}>
      {/* Header */}
      <div style={headerStyle}>
        <List size={14} style={{ color: 'var(--text-tertiary)', flexShrink: 0 }} />
        <span style={titleStyle}>Outline</span>
        {onClose && (
          <button
            type="button"
            onClick={onClose}
            title="Close Outline"
            style={closeBtnStyle}
            onMouseEnter={(e) => {
              e.currentTarget.style.background = 'var(--bg-hover)'
              e.currentTarget.style.color = 'var(--text-primary)'
            }}
            onMouseLeave={(e) => {
              e.currentTarget.style.background = 'transparent'
              e.currentTarget.style.color = 'var(--text-tertiary)'
            }}
          >
            <X size={15} />
          </button>
        )}
      </div>

      {/* Heading list */}
      <div style={listStyle}>
        {headings.length === 0 ? (
          <div style={emptyStyle}>
            <List size={28} style={{ color: 'var(--text-disabled)', opacity: 0.6 }} />
            <div>No headings found</div>
          </div>
        ) : (
          headings.map((h, index) => {
            const indent = INDENT_BY_LEVEL[h.level] ?? 0
            const isHovered = hoveredIndex === index
            const isActive = activeLine === h.line
            const isH1 = h.level === 1

            const itemStyle: CSSProperties = {
              display: 'flex',
              alignItems: 'center',
              gap: 5,
              paddingLeft: 8 + indent,
              paddingRight: 8,
              paddingTop: isH1 ? 5 : 3,
              paddingBottom: isH1 ? 5 : 3,
              cursor: 'pointer',
              color: isActive || isH1 ? 'var(--text-primary)' : 'var(--text-secondary)',
              fontWeight: isH1 ? 600 : 400,
              fontSize: isH1 ? 'var(--font-size-md)' : 13,
              background: isActive
                ? 'var(--bg-active)'
                : isHovered
                  ? 'var(--bg-hover)'
                  : 'transparent',
              borderLeft: isActive
                ? '2px solid var(--accent)'
                : '2px solid transparent',
              whiteSpace: 'nowrap',
              overflow: 'hidden',
              textOverflow: 'ellipsis',
              transition: 'background var(--transition-fast), color var(--transition-fast)'
            }

            return (
              <div
                key={`${h.line}-${index}`}
                style={itemStyle}
                title={h.text}
                onClick={() => handleClick(h.line)}
                onMouseEnter={() => setHoveredIndex(index)}
                onMouseLeave={() => setHoveredIndex(null)}
              >
                <Hash
                  size={12}
                  style={{
                    color: 'var(--text-tertiary)',
                    flexShrink: 0,
                    opacity: isH1 ? 0.8 : 0.6
                  }}
                />
                <span style={{ overflow: 'hidden', textOverflow: 'ellipsis' }}>{h.text}</span>
              </div>
            )
          })
        )}
      </div>
    </div>
  )
}
