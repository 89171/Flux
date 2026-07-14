/**
 * KanbanEditor — self-contained multi-column task board.
 *
 * File format (JSON):
 *   {
 *     "version": 1,
 *     "columns": [{ "id": "col-planning", "name": "规划中" }, ...],
 *     "cards":   [{ "id": "card-...", "columnId": "col-planning",
 *                   "title": "...", "description": "?", "createdAt": ts }]
 *   }
 *
 * Empty / malformed input seeds the three canonical Chinese buckets
 * ("规划中" / "进行中" / "已完成") so a fresh .todo file is immediately
 * usable. Users can rename or reorder columns; the ids stay stable so
 * card references survive renames.
 *
 * Drag-and-drop uses the platform-native HTML5 DnD — no library, no
 * bundle overhead. Both cards (across columns) and columns (across
 * board) are draggable via the same mechanism, disambiguated by the
 * `text/x-painote-kanban` dataTransfer type.
 */

import { useCallback, useEffect, useMemo, useRef, useState, type CSSProperties, type DragEvent } from 'react'
import { Plus, X, Pencil, Trash2, GripVertical } from 'lucide-react'

export interface KanbanEditorProps {
  value: string
  onChange: (data: string) => void
  className?: string
}

interface KanbanColumn {
  id: string
  name: string
}

interface KanbanCard {
  id: string
  columnId: string
  title: string
  description?: string
  createdAt: number
}

interface KanbanDoc {
  version: number
  columns: KanbanColumn[]
  cards: KanbanCard[]
}

const DEFAULT_COLUMNS: KanbanColumn[] = [
  { id: 'col-planning', name: '规划中' },
  { id: 'col-in-progress', name: '进行中' },
  { id: 'col-done', name: '已完成' }
]

let counter = 0
const uid = (prefix: string): string =>
  `${prefix}-${Date.now().toString(36)}-${(++counter).toString(36)}`

function parseDoc(raw: string): KanbanDoc {
  const trimmed = raw?.trim()
  if (!trimmed) {
    return { version: 1, columns: DEFAULT_COLUMNS.map((c) => ({ ...c })), cards: [] }
  }
  try {
    const parsed = JSON.parse(trimmed)
    if (!parsed || typeof parsed !== 'object') throw new Error('not an object')
    const cols = Array.isArray(parsed.columns) ? parsed.columns : []
    const cards = Array.isArray(parsed.cards) ? parsed.cards : []
    // Coerce back into typed shape; drop entries that don't validate so
    // one bad row doesn't wreck the whole board.
    const columns: KanbanColumn[] = cols
      .filter((c: unknown): c is KanbanColumn =>
        !!c && typeof c === 'object' && typeof (c as KanbanColumn).id === 'string' && typeof (c as KanbanColumn).name === 'string')
      .map((c: KanbanColumn) => ({ id: c.id, name: c.name }))
    const cleanCards: KanbanCard[] = cards
      .filter((k: unknown): k is KanbanCard =>
        !!k && typeof k === 'object' && typeof (k as KanbanCard).id === 'string' && typeof (k as KanbanCard).columnId === 'string' && typeof (k as KanbanCard).title === 'string')
      .map((k: KanbanCard) => ({
        id: k.id,
        columnId: k.columnId,
        title: k.title,
        description: typeof k.description === 'string' ? k.description : undefined,
        createdAt: typeof k.createdAt === 'number' ? k.createdAt : Date.now()
      }))
    if (columns.length === 0) {
      return { version: 1, columns: DEFAULT_COLUMNS.map((c) => ({ ...c })), cards: cleanCards }
    }
    return { version: 1, columns, cards: cleanCards }
  } catch (err) {
    console.warn('[Kanban] failed to parse doc; seeding defaults:', err)
    return { version: 1, columns: DEFAULT_COLUMNS.map((c) => ({ ...c })), cards: [] }
  }
}

// Shared drag-payload MIME type. Using a custom type stops the drag from
// interfering with (or being interfered by) plain text drops.
const DRAG_MIME = 'application/x-painote-kanban'

const columnStyle: CSSProperties = {
  flex: '0 0 280px',
  display: 'flex',
  flexDirection: 'column',
  background: 'var(--bg-secondary)',
  borderRadius: 8,
  padding: 10,
  gap: 8,
  maxHeight: '100%'
}

const cardStyle: CSSProperties = {
  background: 'var(--bg-primary)',
  border: '1px solid var(--border-light)',
  borderRadius: 6,
  padding: '8px 10px',
  cursor: 'grab',
  fontSize: 13
}

const iconBtnStyle: CSSProperties = {
  background: 'transparent',
  border: 'none',
  cursor: 'pointer',
  color: 'var(--text-tertiary)',
  padding: 2,
  borderRadius: 3,
  display: 'inline-flex',
  alignItems: 'center'
}

export function KanbanEditor({
  value,
  onChange,
  className
}: KanbanEditorProps): JSX.Element {
  const [doc, setDoc] = useState<KanbanDoc>(() => parseDoc(value))
  const [editingColumn, setEditingColumn] = useState<string | null>(null)
  const [columnNameDraft, setColumnNameDraft] = useState('')
  const [composingIn, setComposingIn] = useState<string | null>(null)
  const [newCardTitle, setNewCardTitle] = useState('')
  const [dragOverColumn, setDragOverColumn] = useState<string | null>(null)
  const onChangeRef = useRef(onChange)
  onChangeRef.current = onChange
  const lastSerialisedRef = useRef<string>('')

  // Sync any change back to disk (via parent). Serialise once here so
  // the same object never gets stringified twice, and skip echoes so
  // an external broadcast update doesn't flag the file dirty.
  const commit = useCallback((next: KanbanDoc) => {
    setDoc(next)
    const serialised = JSON.stringify(next, null, 2)
    if (serialised === lastSerialisedRef.current) return
    lastSerialisedRef.current = serialised
    onChangeRef.current(serialised)
  }, [])

  // If the parent hands us a new `value` (external write), fold it in.
  useEffect(() => {
    if (value === lastSerialisedRef.current) return
    const next = parseDoc(value)
    setDoc(next)
    lastSerialisedRef.current = JSON.stringify(next, null, 2)
  }, [value])

  // ---------- Column ops ----------

  const addColumn = useCallback(() => {
    const name = prompt('新列名称', '新分组')?.trim()
    if (!name) return
    commit({ ...doc, columns: [...doc.columns, { id: uid('col'), name }] })
  }, [doc, commit])

  const renameColumn = useCallback(
    (id: string, name: string) => {
      const trimmed = name.trim()
      if (!trimmed) return
      commit({
        ...doc,
        columns: doc.columns.map((c) => (c.id === id ? { ...c, name: trimmed } : c))
      })
    },
    [doc, commit]
  )

  const deleteColumn = useCallback(
    (id: string) => {
      if (doc.columns.length <= 1) return
      if (!confirm('删除该列以及其中所有卡片？')) return
      commit({
        ...doc,
        columns: doc.columns.filter((c) => c.id !== id),
        cards: doc.cards.filter((k) => k.columnId !== id)
      })
    },
    [doc, commit]
  )

  // ---------- Card ops ----------

  const addCard = useCallback(
    (columnId: string, title: string) => {
      const trimmed = title.trim()
      if (!trimmed) return
      const card: KanbanCard = {
        id: uid('card'),
        columnId,
        title: trimmed,
        createdAt: Date.now()
      }
      commit({ ...doc, cards: [...doc.cards, card] })
    },
    [doc, commit]
  )

  const editCard = useCallback(
    (id: string) => {
      const card = doc.cards.find((c) => c.id === id)
      if (!card) return
      const next = prompt('编辑标题', card.title)?.trim()
      if (!next || next === card.title) return
      commit({
        ...doc,
        cards: doc.cards.map((c) => (c.id === id ? { ...c, title: next } : c))
      })
    },
    [doc, commit]
  )

  const deleteCard = useCallback(
    (id: string) => {
      commit({ ...doc, cards: doc.cards.filter((c) => c.id !== id) })
    },
    [doc, commit]
  )

  const moveCard = useCallback(
    (cardId: string, targetColumnId: string) => {
      const card = doc.cards.find((c) => c.id === cardId)
      if (!card || card.columnId === targetColumnId) return
      commit({
        ...doc,
        cards: doc.cards.map((c) => (c.id === cardId ? { ...c, columnId: targetColumnId } : c))
      })
    },
    [doc, commit]
  )

  // ---------- Drag & drop ----------

  const handleDragStart = useCallback((e: DragEvent<HTMLDivElement>, cardId: string) => {
    e.dataTransfer.setData(DRAG_MIME, cardId)
    e.dataTransfer.effectAllowed = 'move'
  }, [])

  const handleColumnDragOver = useCallback(
    (e: DragEvent<HTMLDivElement>, columnId: string) => {
      // Only intercept drops that carry our own payload — otherwise the
      // OS-level drop (e.g. external file drop) should propagate to the
      // Editor's file-open handler.
      if (!e.dataTransfer.types.includes(DRAG_MIME)) return
      e.preventDefault()
      e.dataTransfer.dropEffect = 'move'
      setDragOverColumn(columnId)
    },
    []
  )

  const handleColumnDrop = useCallback(
    (e: DragEvent<HTMLDivElement>, columnId: string) => {
      if (!e.dataTransfer.types.includes(DRAG_MIME)) return
      e.preventDefault()
      const cardId = e.dataTransfer.getData(DRAG_MIME)
      if (cardId) moveCard(cardId, columnId)
      setDragOverColumn(null)
    },
    [moveCard]
  )

  const handleColumnDragLeave = useCallback(
    (e: DragEvent<HTMLDivElement>, columnId: string) => {
      // Only clear when leaving the column entirely — dragenter on
      // nested children fires dragleave on the parent otherwise.
      if (e.currentTarget.contains(e.relatedTarget as Node)) return
      if (dragOverColumn === columnId) setDragOverColumn(null)
    },
    [dragOverColumn]
  )

  // ---------- Render ----------

  const cardsByColumn = useMemo(() => {
    const map = new Map<string, KanbanCard[]>()
    for (const col of doc.columns) map.set(col.id, [])
    for (const card of doc.cards) {
      const bucket = map.get(card.columnId)
      if (bucket) bucket.push(card)
      // Cards whose column was deleted end up in the first column so
      // they don't vanish into an inconsistent state.
      else map.get(doc.columns[0]?.id)?.push({ ...card, columnId: doc.columns[0].id })
    }
    return map
  }, [doc])

  return (
    <div
      className={`kanban-editor-wrapper ${className || ''}`}
      style={{
        width: '100%',
        height: '100%',
        overflow: 'auto',
        padding: 16,
        background: 'var(--bg-primary)',
        boxSizing: 'border-box'
      }}
    >
      <div style={{ display: 'flex', gap: 12, alignItems: 'flex-start', minHeight: '100%' }}>
        {doc.columns.map((column) => {
          const cards = cardsByColumn.get(column.id) ?? []
          const isDragTarget = dragOverColumn === column.id
          return (
            <div
              key={column.id}
              style={{
                ...columnStyle,
                outline: isDragTarget ? '2px dashed var(--accent-primary)' : 'none'
              }}
              onDragOver={(e) => handleColumnDragOver(e, column.id)}
              onDrop={(e) => handleColumnDrop(e, column.id)}
              onDragLeave={(e) => handleColumnDragLeave(e, column.id)}
            >
              {/* Column header */}
              <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                <GripVertical size={14} color="var(--text-tertiary)" />
                {editingColumn === column.id ? (
                  <input
                    autoFocus
                    value={columnNameDraft}
                    onChange={(e) => setColumnNameDraft(e.target.value)}
                    onBlur={() => {
                      renameColumn(column.id, columnNameDraft)
                      setEditingColumn(null)
                    }}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') {
                        renameColumn(column.id, columnNameDraft)
                        setEditingColumn(null)
                      } else if (e.key === 'Escape') {
                        setEditingColumn(null)
                      }
                    }}
                    style={{
                      flex: 1,
                      background: 'var(--bg-primary)',
                      border: '1px solid var(--accent-primary)',
                      borderRadius: 4,
                      padding: '2px 6px',
                      fontSize: 13,
                      color: 'var(--text-primary)',
                      outline: 'none'
                    }}
                  />
                ) : (
                  <span
                    onDoubleClick={() => {
                      setEditingColumn(column.id)
                      setColumnNameDraft(column.name)
                    }}
                    style={{
                      flex: 1,
                      fontSize: 13,
                      fontWeight: 600,
                      color: 'var(--text-primary)',
                      cursor: 'text'
                    }}
                    title="双击重命名"
                  >
                    {column.name}
                    <span
                      style={{
                        marginLeft: 6,
                        fontSize: 11,
                        color: 'var(--text-tertiary)',
                        fontWeight: 400
                      }}
                    >
                      {cards.length}
                    </span>
                  </span>
                )}
                <button
                  onClick={() => {
                    setEditingColumn(column.id)
                    setColumnNameDraft(column.name)
                  }}
                  title="重命名"
                  style={iconBtnStyle}
                >
                  <Pencil size={13} />
                </button>
                {doc.columns.length > 1 && (
                  <button
                    onClick={() => deleteColumn(column.id)}
                    title="删除列"
                    style={iconBtnStyle}
                  >
                    <Trash2 size={13} />
                  </button>
                )}
              </div>

              {/* Cards */}
              <div style={{ display: 'flex', flexDirection: 'column', gap: 6, minHeight: 40 }}>
                {cards.map((card) => (
                  <div
                    key={card.id}
                    draggable
                    onDragStart={(e) => handleDragStart(e, card.id)}
                    style={cardStyle}
                  >
                    <div style={{ display: 'flex', alignItems: 'flex-start', gap: 6 }}>
                      <div style={{ flex: 1, color: 'var(--text-primary)' }}>{card.title}</div>
                      <button
                        onClick={() => editCard(card.id)}
                        style={iconBtnStyle}
                        title="编辑"
                      >
                        <Pencil size={12} />
                      </button>
                      <button
                        onClick={() => deleteCard(card.id)}
                        style={iconBtnStyle}
                        title="删除"
                      >
                        <X size={13} />
                      </button>
                    </div>
                  </div>
                ))}
              </div>

              {/* Add card */}
              {composingIn === column.id ? (
                <div style={{ display: 'flex', gap: 4 }}>
                  <input
                    autoFocus
                    value={newCardTitle}
                    onChange={(e) => setNewCardTitle(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') {
                        addCard(column.id, newCardTitle)
                        setNewCardTitle('')
                        setComposingIn(null)
                      } else if (e.key === 'Escape') {
                        setComposingIn(null)
                        setNewCardTitle('')
                      }
                    }}
                    onBlur={() => {
                      if (newCardTitle.trim()) {
                        addCard(column.id, newCardTitle)
                      }
                      setNewCardTitle('')
                      setComposingIn(null)
                    }}
                    placeholder="任务标题"
                    style={{
                      flex: 1,
                      background: 'var(--bg-primary)',
                      border: '1px solid var(--accent-primary)',
                      borderRadius: 4,
                      padding: '4px 6px',
                      fontSize: 13,
                      color: 'var(--text-primary)',
                      outline: 'none'
                    }}
                  />
                </div>
              ) : (
                <button
                  onClick={() => setComposingIn(column.id)}
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: 4,
                    padding: '6px 8px',
                    background: 'transparent',
                    border: '1px dashed var(--border-secondary)',
                    borderRadius: 4,
                    color: 'var(--text-tertiary)',
                    cursor: 'pointer',
                    fontSize: 12
                  }}
                >
                  <Plus size={13} /> 添加任务
                </button>
              )}
            </div>
          )
        })}

        {/* Add column button */}
        <button
          onClick={addColumn}
          title="添加列"
          style={{
            flex: '0 0 44px',
            height: 44,
            border: '1px dashed var(--border-secondary)',
            borderRadius: 8,
            background: 'transparent',
            color: 'var(--text-tertiary)',
            cursor: 'pointer',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center'
          }}
        >
          <Plus size={16} />
        </button>
      </div>
    </div>
  )
}

export default KanbanEditor
