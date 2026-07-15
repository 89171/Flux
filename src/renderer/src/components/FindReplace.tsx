/**
 * Flux Find & Replace Bar
 *
 * Compact horizontal bar overlaid on the editor content area.
 * Supports a "find" only mode and a "find + replace" mode. Operates
 * on a plain string `value` and notifies the parent of edits via
 * `onChange` (the same contract as the textarea editor).
 *
 * Position: absolute, top-right of the nearest `position: relative`
 * ancestor (the editor content area). Pure inline styles — no CSS
 * file changes required.
 */

import { useState, useEffect, useMemo, useRef, useCallback } from 'react'
import {
  X,
  ChevronUp,
  ChevronDown,
  Replace,
  Check,
  CaseSensitive,
  WholeWord
} from 'lucide-react'

interface FindReplaceProps {
  /** Current editor content. */
  value: string
  /** Called when content changes via Replace / Replace All. */
  onChange: (value: string) => void
  /** Close the bar. */
  onClose: () => void
  /** Initial mode. Defaults to 'find'. */
  initialMode?: 'find' | 'replace'
}

interface Match {
  start: number
  end: number
}

/** Escapes regex special characters in a literal search string. */
function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

export default function FindReplace({
  value,
  onChange,
  onClose,
  initialMode = 'find'
}: FindReplaceProps): JSX.Element {
  const [mode, setMode] = useState<'find' | 'replace'>(initialMode)
  const [findText, setFindText] = useState('')
  const [replaceText, setReplaceText] = useState('')
  const [caseSensitive, setCaseSensitive] = useState(false)
  const [wholeWord, setWholeWord] = useState(false)
  const [currentIndex, setCurrentIndex] = useState(0)
  const [replacedCount, setReplacedCount] = useState<number | null>(null)

  const findInputRef = useRef<HTMLInputElement>(null)

  // Focus & select the find input on mount so the user can type immediately.
  useEffect(() => {
    findInputRef.current?.focus()
    findInputRef.current?.select()
  }, [])

  // Recompute all match positions whenever the find text, source value,
  // or match options change. We rebuild a fresh RegExp each time to avoid
  // stale `lastIndex` state across renders.
  const matches = useMemo<Match[]>(() => {
    if (!findText) return []
    const flags = caseSensitive ? 'g' : 'gi'
    const escaped = escapeRegExp(findText)
    const source = wholeWord ? `\\b${escaped}\\b` : escaped
    let pattern: RegExp
    try {
      pattern = new RegExp(source, flags)
    } catch {
      return []
    }
    const result: Match[] = []
    let m: RegExpExecArray | null
    pattern.lastIndex = 0
    while ((m = pattern.exec(value)) !== null) {
      // Guard against zero-length matches (defensive — shouldn't happen
      // because findText is non-empty and we always wrap literal text).
      if (m[0].length === 0) {
        pattern.lastIndex++
        continue
      }
      result.push({ start: m.index, end: m.index + m[0].length })
    }
    return result
  }, [findText, value, caseSensitive, wholeWord])

  // Clamp currentIndex when the match list shrinks (e.g. after a replace
  // or after the user edits the find text).
  useEffect(() => {
    if (matches.length === 0) {
      if (currentIndex !== 0) setCurrentIndex(0)
    } else if (currentIndex >= matches.length) {
      setCurrentIndex(0)
    }
  }, [matches.length, currentIndex])

  const totalMatches = matches.length
  const displayIndex = totalMatches === 0 ? 0 : currentIndex + 1

  const goToMatch = useCallback(
    (index: number) => {
      if (totalMatches === 0) return
      const next = ((index % totalMatches) + totalMatches) % totalMatches
      setCurrentIndex(next)
    },
    [totalMatches]
  )

  const nextMatch = useCallback(() => {
    goToMatch(currentIndex + 1)
  }, [goToMatch, currentIndex])

  const prevMatch = useCallback(() => {
    goToMatch(currentIndex - 1)
  }, [goToMatch, currentIndex])

  // Replace the currently-highlighted match. Keep currentIndex stable:
  // the previously-next match collapses into the same index, so the
  // user can press Replace repeatedly to walk down the document. The
  // clamp effect handles the edge case where the index falls off the end.
  const replaceCurrent = useCallback(() => {
    if (matches.length === 0 || !findText) return
    const match = matches[currentIndex]
    if (!match) return
    const newValue =
      value.slice(0, match.start) + replaceText + value.slice(match.end)
    onChange(newValue)
    setReplacedCount(1)
  }, [matches, currentIndex, value, findText, replaceText, onChange])

  // Replace every match in one pass. `String.replace` with a global
  // regex processes left-to-right and never re-scans replacement text,
  // so this is safe even if `replaceText` contains `findText`.
  const replaceAll = useCallback(() => {
    if (matches.length === 0 || !findText) return
    const flags = caseSensitive ? 'g' : 'gi'
    const escaped = escapeRegExp(findText)
    const source = wholeWord ? `\\b${escaped}\\b` : escaped
    let pattern: RegExp
    try {
      pattern = new RegExp(source, flags)
    } catch {
      return
    }
    const newValue = value.replace(pattern, replaceText)
    onChange(newValue)
    setReplacedCount(matches.length)
  }, [
    matches.length,
    value,
    findText,
    replaceText,
    caseSensitive,
    wholeWord,
    onChange
  ])

  // Auto-dismiss the "Replaced N" toast.
  useEffect(() => {
    if (replacedCount === null) return
    const t = window.setTimeout(() => setReplacedCount(null), 2000)
    return () => window.clearTimeout(t)
  }, [replacedCount])

  // Keyboard shortcuts on the find input:
  //   Enter = next, Shift+Enter = previous, Escape = close
  const handleFindKeyDown = useCallback(
    (e: React.KeyboardEvent<HTMLInputElement>) => {
      if (e.key === 'Enter') {
        e.preventDefault()
        if (e.shiftKey) prevMatch()
        else nextMatch()
      } else if (e.key === 'Escape') {
        e.preventDefault()
        onClose()
      }
    },
    [nextMatch, prevMatch, onClose]
  )

  // Keyboard shortcuts on the replace input:
  //   Enter = replace current, Escape = close
  const handleReplaceKeyDown = useCallback(
    (e: React.KeyboardEvent<HTMLInputElement>) => {
      if (e.key === 'Enter') {
        e.preventDefault()
        replaceCurrent()
      } else if (e.key === 'Escape') {
        e.preventDefault()
        onClose()
      }
    },
    [replaceCurrent, onClose]
  )

  // ─── Shared styles ───

  const inputStyle: React.CSSProperties = {
    flex: 1,
    minWidth: 0,
    padding: '4px 8px',
    border: '1px solid var(--border-color)',
    borderRadius: 'var(--radius-sm)',
    backgroundColor: 'var(--bg-primary)',
    color: 'var(--text-primary)',
    fontSize: 'var(--font-size-sm)',
    fontFamily: 'var(--font-mono)',
    outline: 'none'
  }

  const iconBtnStyle: React.CSSProperties = {
    display: 'inline-flex',
    alignItems: 'center',
    justifyContent: 'center',
    width: 24,
    height: 24,
    border: 'none',
    background: 'transparent',
    color: 'var(--text-secondary)',
    cursor: 'pointer',
    borderRadius: 'var(--radius-sm)',
    transition: 'all var(--transition-fast)',
    flexShrink: 0,
    padding: 0
  }

  const toggleBtnStyle = (active: boolean): React.CSSProperties => ({
    ...iconBtnStyle,
    width: 26,
    height: 26,
    background: active ? 'var(--bg-active)' : 'transparent',
    color: active ? 'var(--text-primary)' : 'var(--text-tertiary)'
  })

  const disabledBtnStyle = (disabled: boolean): React.CSSProperties => ({
    opacity: disabled ? 0.4 : 1,
    cursor: disabled ? 'default' : 'pointer'
  })

  // ─── Render ───

  return (
    <div
      style={{
        position: 'absolute',
        top: 8,
        right: 16,
        zIndex: 100,
        display: 'flex',
        flexDirection: 'column',
        gap: 6,
        padding: 8,
        minWidth: 360,
        maxWidth: 480,
        backgroundColor: 'var(--bg-primary)',
        border: '1px solid var(--border-color)',
        borderRadius: 'var(--radius-md)',
        boxShadow: 'var(--shadow-lg)',
        fontFamily: 'var(--font-sans)'
      }}
    >
      {/* Find row */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
        <input
          ref={findInputRef}
          type="text"
          value={findText}
          onChange={(e) => {
            setFindText(e.target.value)
            setCurrentIndex(0)
            setReplacedCount(null)
          }}
          onKeyDown={handleFindKeyDown}
          placeholder="Find"
          style={inputStyle}
        />

        {/* Match count: e.g. "3/12" */}
        <span
          style={{
            fontSize: 'var(--font-size-xs)',
            color:
              totalMatches === 0
                ? 'var(--text-disabled)'
                : 'var(--text-tertiary)',
            minWidth: 44,
            textAlign: 'right',
            fontFamily: 'var(--font-mono)',
            flexShrink: 0,
            userSelect: 'none'
          }}
        >
          {findText ? `${displayIndex}/${totalMatches}` : ''}
        </span>

        {/* Case-sensitive toggle */}
        <button
          type="button"
          onClick={() => {
            setCaseSensitive((v) => !v)
            setCurrentIndex(0)
          }}
          title="Match Case"
          style={toggleBtnStyle(caseSensitive)}
        >
          <CaseSensitive size={14} />
        </button>

        {/* Whole-word toggle */}
        <button
          type="button"
          onClick={() => {
            setWholeWord((v) => !v)
            setCurrentIndex(0)
          }}
          title="Match Whole Word"
          style={toggleBtnStyle(wholeWord)}
        >
          <WholeWord size={14} />
        </button>

        {/* Previous match */}
        <button
          type="button"
          onClick={prevMatch}
          disabled={totalMatches === 0}
          title="Previous (Shift+Enter)"
          style={{ ...iconBtnStyle, ...disabledBtnStyle(totalMatches === 0) }}
        >
          <ChevronUp size={16} />
        </button>

        {/* Next match */}
        <button
          type="button"
          onClick={nextMatch}
          disabled={totalMatches === 0}
          title="Next (Enter)"
          style={{ ...iconBtnStyle, ...disabledBtnStyle(totalMatches === 0) }}
        >
          <ChevronDown size={16} />
        </button>

        {/* Mode toggle: find <-> replace */}
        <button
          type="button"
          onClick={() => setMode((m) => (m === 'find' ? 'replace' : 'find'))}
          title={mode === 'find' ? 'Show Replace' : 'Hide Replace'}
          style={{
            ...iconBtnStyle,
            color: mode === 'replace' ? 'var(--text-primary)' : 'var(--text-tertiary)',
            background: mode === 'replace' ? 'var(--bg-active)' : 'transparent'
          }}
        >
          <Replace size={14} />
        </button>

        {/* Close */}
        <button
          type="button"
          onClick={onClose}
          title="Close (Esc)"
          style={iconBtnStyle}
        >
          <X size={16} />
        </button>
      </div>

      {/* Replace row (only in replace mode) */}
      {mode === 'replace' && (
        <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
          <input
            type="text"
            value={replaceText}
            onChange={(e) => setReplaceText(e.target.value)}
            onKeyDown={handleReplaceKeyDown}
            placeholder="Replace"
            style={inputStyle}
          />

          {/* Replace (single) */}
          <button
            type="button"
            onClick={replaceCurrent}
            disabled={totalMatches === 0}
            title="Replace (Enter)"
            style={{
              ...iconBtnStyle,
              width: 'auto',
              padding: '0 8px',
              gap: 4,
              fontSize: 'var(--font-size-xs)',
              ...disabledBtnStyle(totalMatches === 0)
            }}
          >
            <Check size={13} />
            <span>Replace</span>
          </button>

          {/* Replace All */}
          <button
            type="button"
            onClick={replaceAll}
            disabled={totalMatches === 0}
            title="Replace All"
            style={{
              ...iconBtnStyle,
              width: 'auto',
              padding: '0 8px',
              gap: 4,
              fontSize: 'var(--font-size-xs)',
              ...disabledBtnStyle(totalMatches === 0)
            }}
          >
            <Replace size={13} />
            <span>All</span>
          </button>
        </div>
      )}

      {/* Transient "Replaced N" toast */}
      {replacedCount !== null && (
        <div
          style={{
            fontSize: 'var(--font-size-xs)',
            color: 'var(--text-tertiary)',
            padding: '2px 4px',
            userSelect: 'none'
          }}
        >
          Replaced {replacedCount} occurrence{replacedCount === 1 ? '' : 's'}.
        </div>
      )}
    </div>
  )
}
