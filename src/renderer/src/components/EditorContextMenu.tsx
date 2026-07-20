/**
 * Flux EditorContextMenu - custom right-click context menu for the editor area.
 *
 * Renders a fixed-position menu at the cursor. On mount it measures its own
 * size and flips above/left of the cursor when the default position would
 * overflow the viewport. Closes on outside click, Escape, or item selection.
 */

import {
  useState,
  useEffect,
  useLayoutEffect,
  useRef,
  type CSSProperties,
  type ReactNode
} from 'react'

export interface ContextMenuItem {
  label: string
  action: () => void
  icon?: ReactNode
  disabled?: boolean
  separator?: boolean // if true, render a separator instead of a menu item
}

interface EditorContextMenuProps {
  x: number // mouse x position
  y: number // mouse y position
  onClose: () => void
  actions: ContextMenuItem[]
}

const menuStyle: CSSProperties = {
  position: 'fixed',
  background: 'var(--bg-tertiary)',
  border: '1px solid var(--border-color)',
  borderRadius: 8,
  boxShadow: 'var(--shadow-lg)',
  padding: 4,
  minWidth: 180,
  fontSize: 13,
  zIndex: 10000,
  // Only animate transform/opacity; top/left must snap when flipped.
  transition: 'transform 120ms ease-out, opacity 120ms ease-out'
}

const itemStyle: CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  gap: 8,
  padding: '6px 12px',
  borderRadius: 4,
  cursor: 'pointer',
  color: 'var(--text-primary)',
  userSelect: 'none',
  whiteSpace: 'nowrap'
}

const separatorStyle: CSSProperties = {
  height: 1,
  margin: '4px 0',
  background: 'var(--border-color)'
}

const iconWrapperStyle: CSSProperties = {
  display: 'inline-flex',
  alignItems: 'center',
  flexShrink: 0,
  opacity: 0.8
}

export default function EditorContextMenu({
  x,
  y,
  onClose,
  actions
}: EditorContextMenuProps) {
  const menuRef = useRef<HTMLDivElement>(null)
  const [position, setPosition] = useState<{ top: number; left: number }>({
    top: y,
    left: x
  })
  const [shown, setShown] = useState(false)

  // Measure after render and flip above/left when overflowing the viewport.
  // useLayoutEffect runs before paint so the menu never flashes in the wrong spot.
  useLayoutEffect(() => {
    const el = menuRef.current
    if (!el) return
    const w = el.offsetWidth
    const h = el.offsetHeight
    const vw = window.innerWidth
    const vh = window.innerHeight
    let left = x
    let top = y
    if (x + w > vw) left = Math.max(0, x - w)
    if (y + h > vh) top = Math.max(0, y - h)
    setPosition({ top, left })
  }, [x, y])

  // Trigger the scale-in entrance animation after the initial paint.
  useEffect(() => {
    const id = requestAnimationFrame(() => setShown(true))
    return () => cancelAnimationFrame(id)
  }, [])

  // Close on outside click or Escape.
  useEffect(() => {
    const handlePointerDown = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        onClose()
      }
    }
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        onClose()
      }
    }
    document.addEventListener('mousedown', handlePointerDown)
    document.addEventListener('keydown', handleKeyDown)
    return () => {
      document.removeEventListener('mousedown', handlePointerDown)
      document.removeEventListener('keydown', handleKeyDown)
    }
  }, [onClose])

  const handleItemClick = (item: ContextMenuItem) => {
    if (item.disabled) return
    item.action()
    onClose()
  }

  return (
    <div
      ref={menuRef}
      style={{
        ...menuStyle,
        top: position.top,
        left: position.left,
        transform: shown ? 'scale(1)' : 'scale(0.95)',
        opacity: shown ? 1 : 0
      }}
    >
      {actions.map((item, idx) => {
        if (item.separator) {
          return <div key={idx} style={separatorStyle} />
        }
        const disabled = item.disabled === true
        const resolvedItemStyle: CSSProperties = disabled
          ? { ...itemStyle, cursor: 'default', color: 'var(--text-disabled)' }
          : itemStyle
        return (
          <div
            key={idx}
            onMouseDown={(e) => e.preventDefault()}
            onClick={() => handleItemClick(item)}
            onMouseEnter={(e) => {
              if (!disabled) e.currentTarget.style.background = 'var(--bg-hover)'
            }}
            onMouseLeave={(e) => {
              e.currentTarget.style.background = 'transparent'
            }}
            style={resolvedItemStyle}
          >
            {item.icon != null && (
              <span style={iconWrapperStyle}>{item.icon}</span>
            )}
            <span>{item.label}</span>
          </div>
        )
      })}
    </div>
  )
}
