/**
 * Flux CommandPalette - VS Code-style command palette (Ctrl+Shift+P modal).
 *
 * The input is pre-filled with '>' on mount to enter command mode
 * immediately. Commands are filtered by label (case-insensitive
 * substring match). Each command shows a category-appropriate lucide
 * icon plus an optional shortcut on the right.
 */

import {
  useState,
  useEffect,
  useMemo,
  useRef,
  type CSSProperties,
  type KeyboardEvent as ReactKeyboardEvent,
  type MouseEvent as ReactMouseEvent,
  type ReactNode
} from 'react'
import {
  FileText,
  FilePlus,
  Save,
  FolderOpen,
  Search,
  Replace,
  ZoomIn,
  ZoomOut,
  RotateCcw,
  Palette,
  Settings,
  ChevronRight
} from 'lucide-react'

export interface Command {
  id: string
  label: string
  shortcut?: string
}

interface CommandPaletteProps {
  commands: Command[]
  onExecute: (commandId: string) => void
  onClose: () => void
}

/** Pick a lucide icon for a command based on its id and label. */
function getCommandIcon(command: Command): ReactNode {
  const id = command.id.toLowerCase()
  const label = command.label.toLowerCase()
  const match = (s: string) => id.includes(s) || label.includes(s)
  const iconStyle: CSSProperties = { flexShrink: 0, opacity: 0.7 }

  // Order matters: more specific patterns first so they win over
  // overlapping generic ones (e.g. "Reset Zoom" before "Zoom In").
  if (match('replace')) return <Replace size={16} style={iconStyle} />
  if (match('reset zoom')) return <RotateCcw size={16} style={iconStyle} />
  if (match('zoom in') || match('zoomin')) return <ZoomIn size={16} style={iconStyle} />
  if (match('zoom out') || match('zoomout')) return <ZoomOut size={16} style={iconStyle} />
  if (match('theme')) return <Palette size={16} style={iconStyle} />
  if (match('setting') || match('preference')) return <Settings size={16} style={iconStyle} />
  if (match('save')) return <Save size={16} style={iconStyle} />
  if (match('folder')) return <FolderOpen size={16} style={iconStyle} />
  if (match('new') || match('create')) return <FilePlus size={16} style={iconStyle} />
  if (match('find') || match('search')) return <Search size={16} style={iconStyle} />
  if (match('quick open') || match('file')) return <FileText size={16} style={iconStyle} />
  return <ChevronRight size={16} style={iconStyle} />
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

export default function CommandPalette({
  commands,
  onExecute,
  onClose
}: CommandPaletteProps) {
  const [input, setInput] = useState('>')
  const [selectedIndex, setSelectedIndex] = useState(0)
  const inputRef = useRef<HTMLInputElement>(null)
  const listRef = useRef<HTMLDivElement>(null)

  const results = useMemo<Command[]>(() => {
    if (!input.startsWith('>')) return []
    const q = input.slice(1).toLowerCase()
    if (!q) return commands
    return commands.filter((cmd) => cmd.label.toLowerCase().includes(q))
  }, [input, commands])

  // Reset selection whenever the result set changes
  useEffect(() => {
    setSelectedIndex(0)
  }, [input])

  // Autofocus + place caret after the leading '>'
  useEffect(() => {
    const el = inputRef.current
    if (!el) return
    el.focus()
    el.setSelectionRange(1, 1)
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
      if (selected) onExecute(selected.id)
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
    if (selected) onExecute(selected.id)
  }

  const isCommandMode = input.startsWith('>')

  return (
    <div style={overlayStyle} onClick={handleOverlayClick}>
      <div style={modalStyle}>
        <input
          ref={inputRef}
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={handleKeyDown}
          placeholder="Type a command..."
          style={inputStyle}
          spellCheck={false}
          autoComplete="off"
        />
        <div ref={listRef} style={{ maxHeight: 400, overflowY: 'auto' }}>
          {!isCommandMode ? (
            <div
              style={{
                padding: '16px 12px',
                color: 'var(--text-tertiary)',
                fontSize: 'var(--font-size-sm)',
                textAlign: 'center'
              }}
            >
              Type &lsquo;&gt;&rsquo; to search commands
            </div>
          ) : results.length === 0 ? (
            <div
              style={{
                padding: '16px 12px',
                color: 'var(--text-tertiary)',
                fontSize: 'var(--font-size-sm)',
                textAlign: 'center'
              }}
            >
              No matching commands
            </div>
          ) : (
            results.map((command, index) => {
              const isSelected = index === selectedIndex
              return (
                <div
                  key={command.id}
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
                  {getCommandIcon(command)}
                  <span style={{ fontWeight: 500 }}>{command.label}</span>
                  {command.shortcut && (
                    <span
                      style={{
                        marginLeft: 'auto',
                        color: 'var(--text-tertiary)',
                        fontSize: 'var(--font-size-xs)',
                        fontFamily: 'var(--font-mono, monospace)',
                        background: 'var(--bg-secondary)',
                        padding: '2px 6px',
                        borderRadius: 'var(--radius-sm, 4px)',
                        border: '1px solid var(--border-light)'
                      }}
                    >
                      {command.shortcut}
                    </span>
                  )}
                </div>
              )
            })
          )}
        </div>
      </div>
    </div>
  )
}
