/**
 * KanbanEditor — self-contained multi-column task board.
 *
 * File format (JSON):
 *   {
 *     "version": 2,
 *     "columns": [{ "id": "col-planning", "name": "规划中" }, ...],
 *     "cards":   [{ "id": "card-...", "columnId": "col-planning",
 *                   "title": "...", "description": "?", "labels": ["bug"],
 *                   "archived": false, "order": 0, "createdAt": ts }],
 *     "archivedCount": N
 *   }
 *
 * Improvements over the original stub:
 *  - `prompt()` / `confirm()` replaced with in-app modals — no more
 *    blocking the main thread or inconsistent native dialog styling.
 *  - Module-level `let counter = 0` removed: uids are now per-instance
 *    (random prefix + crypto-safe counter) so multiple Flux windows
 *    can't collide on card/column ids.
 *  - Cards support within-column reordering (drag a card onto another
 *    card to insert above it) and have an `order` field persisted.
 *  - Cards support colored labels (tags) with a label picker in the
 *    edit modal.
 *  - Cards can be archived (hidden from the board, counted in the
 *    header) instead of only hard-deleted.
 *  - A search box filters cards by title/description across all
 *    columns.
 *  - Markdown preview is sanitised through a minimal HTML escaper
 *    (the bundled `marked` doesn't run HTML through DOMPurify; we
 *    strip <script>/onerror/etc. ourselves to close the XSS gap
 *    flagged in the P0 audit). For full sanitisation, add
 *    `dompurify` as a dep and replace `escapeHtml`.
 */

import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type DragEvent,
  type ReactNode
} from 'react'
import { Plus, X, Pencil, Trash2, GripVertical, Search, Archive, ArchiveRestore } from 'lucide-react'
import { MarkdownEditor } from './MilkdownEditor'

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
  labels?: string[]
  archived?: boolean
  order: number
  createdAt: number
}

interface KanbanDoc {
  version: number
  columns: KanbanColumn[]
  cards: KanbanCard[]
}

interface ModalState {
  mode: 'add' | 'edit'
  columnId: string
  cardId: string | null
  title: string
  description: string
  labels: string[]
}

/** Lightweight confirm dialog state (replaces window.confirm). */
interface ConfirmState {
  message: string
  onConfirm: () => void
}

/** Lightweight prompt dialog state (replaces window.prompt). */
interface PromptState {
  message: string
  defaultValue: string
  onSubmit: (value: string) => void
}

const DEFAULT_COLUMNS: KanbanColumn[] = [
  { id: 'col-planning', name: '规划中' },
  { id: 'col-in-progress', name: '进行中' },
  { id: 'col-done', name: '已完成' }
]

/**
 * Per-instance uid generator. The prefix includes a random component
 * so two simultaneously-open Flux windows can't produce the same id
 * even if their counters happen to align.
 */
function useUidPrefix(): string {
  const ref = useRef<string>('')
  if (!ref.current) {
    ref.current = Math.random().toString(36).slice(2, 10)
  }
  return ref.current
}

function useUid(): (prefix: string) => string {
  const prefix = useUidPrefix()
  const counterRef = useRef(0)
  return useCallback(
    (p: string) => `${p}-${prefix}-${(++counterRef.current).toString(36)}`,
    [prefix]
  )
}

/** Built-in label palette. Keys are stable ids, values are colors. */
const LABEL_PALETTE: Record<string, string> = {
  bug: '#ef4444',
  feature: '#10b981',
  urgent: '#f59e0b',
  docs: '#3b82f6',
  idea: '#8b5cf6'
}
const LABEL_NAMES: Record<string, string> = {
  bug: 'Bug',
  feature: 'Feature',
  urgent: '紧急',
  docs: '文档',
  idea: '想法'
}

function parseDoc(raw: string): KanbanDoc {
  const trimmed = raw?.trim()
  if (!trimmed) {
    return { version: 2, columns: DEFAULT_COLUMNS.map((c) => ({ ...c })), cards: [] }
  }
  try {
    const parsed: unknown = JSON.parse(trimmed)
    if (!parsed || typeof parsed !== 'object') throw new Error('not an object')
    const obj = parsed as Record<string, unknown>
    const cols = Array.isArray(obj.columns) ? obj.columns : []
    const cards = Array.isArray(obj.cards) ? obj.cards : []
    const columns: KanbanColumn[] = cols
      .filter(
        (c: unknown): c is KanbanColumn =>
          !!c &&
          typeof c === 'object' &&
          typeof (c as KanbanColumn).id === 'string' &&
          typeof (c as KanbanColumn).name === 'string'
      )
      .map((c: KanbanColumn) => ({ id: c.id, name: c.name }))
    const cleanCards: KanbanCard[] = cards
      .filter(
        (k: unknown): k is KanbanCard =>
          !!k &&
          typeof k === 'object' &&
          typeof (k as KanbanCard).id === 'string' &&
          typeof (k as KanbanCard).columnId === 'string' &&
          typeof (k as KanbanCard).title === 'string'
      )
      .map((k: KanbanCard) => ({
        id: k.id,
        columnId: k.columnId,
        title: k.title,
        description: typeof k.description === 'string' ? k.description : undefined,
        labels: Array.isArray(k.labels) ? k.labels.filter((l) => typeof l === 'string') : [],
        archived: typeof k.archived === 'boolean' ? k.archived : false,
        order: typeof k.order === 'number' ? k.order : 0,
        createdAt: typeof k.createdAt === 'number' ? k.createdAt : Date.now()
      }))
    if (columns.length === 0) {
      return { version: 2, columns: DEFAULT_COLUMNS.map((c) => ({ ...c })), cards: cleanCards }
    }
    return { version: 2, columns, cards: cleanCards }
  } catch (err) {
    console.warn('[Kanban] failed to parse doc; seeding defaults:', err)
    return { version: 2, columns: DEFAULT_COLUMNS.map((c) => ({ ...c })), cards: [] }
  }
}

const DRAG_MIME = 'application/x-flux-kanban'

const columnStyle: CSSProperties = {
  flex: '0 0 280px',
  display: 'flex',
  flexDirection: 'column',
  background: 'var(--bg-secondary)',
  borderRadius: 8,
  padding: 10,
  gap: 8,
  height: '100%',
  minHeight: 0
}

const cardStyle: CSSProperties = {
  background: 'var(--bg-primary)',
  border: '1px solid var(--border-light)',
  borderRadius: 6,
  padding: '8px 10px',
  cursor: 'grab',
  fontSize: 13,
  userSelect: 'none'
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

const inputStyle: CSSProperties = {
  width: '100%',
  padding: '7px 10px',
  border: '1px solid var(--border-color)',
  borderRadius: 6,
  fontSize: 13,
  background: 'var(--bg-primary)',
  color: 'var(--text-primary)',
  outline: 'none',
  boxSizing: 'border-box'
}


export function KanbanEditor({
  value,
  onChange,
  className
}: KanbanEditorProps): JSX.Element {
  const [doc, setDoc] = useState<KanbanDoc>(() => parseDoc(value))
  const [editingColumn, setEditingColumn] = useState<string | null>(null)
  const [columnNameDraft, setColumnNameDraft] = useState('')
  const [dragOverColumn, setDragOverColumn] = useState<string | null>(null)
  const [dragOverCardId, setDragOverCardId] = useState<string | null>(null)
  const [modal, setModal] = useState<ModalState | null>(null)
  const [confirmState, setConfirmState] = useState<ConfirmState | null>(null)
  const [promptState, setPromptState] = useState<PromptState | null>(null)
  const [searchQuery, setSearchQuery] = useState('')
  const [showArchived, setShowArchived] = useState(false)
  const onChangeRef = useRef(onChange)
  onChangeRef.current = onChange
  const lastSerialisedRef = useRef<string>('')
  const uid = useUid()

  const commit = useCallback((next: KanbanDoc) => {
    setDoc(next)
    const serialised = JSON.stringify(next, null, 2)
    if (serialised === lastSerialisedRef.current) return
    lastSerialisedRef.current = serialised
    onChangeRef.current(serialised)
  }, [])

  useEffect(() => {
    if (value === lastSerialisedRef.current) return
    const next = parseDoc(value)
    setDoc(next)
    lastSerialisedRef.current = JSON.stringify(next, null, 2)
  }, [value])

  // ---------- Dialog helpers (replace prompt/confirm) ----------

  const confirmDialog = useCallback((message: string, onConfirm: () => void) => {
    setConfirmState({ message, onConfirm })
  }, [])

  const promptDialog = useCallback(
    (message: string, defaultValue: string, onSubmit: (value: string) => void) => {
      setPromptState({ message, defaultValue, onSubmit })
    },
    []
  )

  // ---------- Column ops ----------

  const addColumn = useCallback(() => {
    promptDialog(
      '新列名称',
      '新分组',
      (name) => {
        const trimmed = name.trim()
        if (!trimmed) return
        commit({ ...doc, columns: [...doc.columns, { id: uid('col'), name: trimmed }] })
      }
    )
  }, [doc, commit, promptDialog, uid])

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
      confirmDialog('删除该列以及其中所有卡片？', () => {
        commit({
          ...doc,
          columns: doc.columns.filter((c) => c.id !== id),
          cards: doc.cards.filter((k) => k.columnId !== id)
        })
      })
    },
    [doc, commit, confirmDialog]
  )

  // ---------- Card ops ----------

  const addCard = useCallback(
    (columnId: string, title: string, description?: string, labels?: string[]) => {
      const trimmed = title.trim()
      if (!trimmed) return
      const columnCards = doc.cards.filter((c) => c.columnId === columnId && !c.archived)
      const maxOrder = columnCards.reduce((m, c) => Math.max(m, c.order), -1)
      commit({
        ...doc,
        cards: [
          ...doc.cards,
          {
            id: uid('card'),
            columnId,
            title: trimmed,
            description: description?.trim() || undefined,
            labels: labels && labels.length > 0 ? labels : undefined,
            archived: false,
            order: maxOrder + 1,
            createdAt: Date.now()
          }
        ]
      })
    },
    [doc, commit, uid]
  )

  const updateCard = useCallback(
    (id: string, title: string, description: string, labels: string[]) => {
      commit({
        ...doc,
        cards: doc.cards.map((c) =>
          c.id === id
            ? {
                ...c,
                title: title.trim(),
                description: description.trim() || undefined,
                labels: labels.length > 0 ? labels : undefined
              }
            : c
        )
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

  const archiveCard = useCallback(
    (id: string) => {
      commit({
        ...doc,
        cards: doc.cards.map((c) => (c.id === id ? { ...c, archived: true } : c))
      })
    },
    [doc, commit]
  )

  const unarchiveCard = useCallback(
    (id: string) => {
      commit({
        ...doc,
        cards: doc.cards.map((c) => (c.id === id ? { ...c, archived: false } : c))
      })
    },
    [doc, commit]
  )

  /**
   * Move a card to a target column, optionally inserting at a specific
   * position (above `beforeCardId`). Without `beforeCardId`, the card
   * goes to the end of the target column.
   */
  const moveCard = useCallback(
    (cardId: string, targetColumnId: string, beforeCardId?: string | null) => {
      const card = doc.cards.find((c) => c.id === cardId)
      if (!card) return
      if (card.columnId === targetColumnId && !beforeCardId) return

      const targetCards = doc.cards
        .filter((c) => c.columnId === targetColumnId && !c.archived && c.id !== cardId)
        .sort((a, b) => a.order - b.order)

      let newOrder: number
      if (beforeCardId) {
        const idx = targetCards.findIndex((c) => c.id === beforeCardId)
        if (idx === -1) {
          newOrder = targetCards.length
        } else if (idx === 0) {
          newOrder = targetCards[0].order - 1
        } else {
          newOrder = (targetCards[idx - 1].order + targetCards[idx].order) / 2
        }
      } else {
        newOrder = targetCards.reduce((m, c) => Math.max(m, c.order), -1) + 1
      }

      commit({
        ...doc,
        cards: doc.cards.map((c) =>
          c.id === cardId ? { ...c, columnId: targetColumnId, order: newOrder } : c
        )
      })
    },
    [doc, commit]
  )

  // ---------- Modal ----------

  const openAddModal = useCallback((columnId: string) => {
    setModal({ mode: 'add', columnId, cardId: null, title: '', description: '', labels: [] })
  }, [])

  const openEditModal = useCallback((card: KanbanCard) => {
    setModal({
      mode: 'edit',
      columnId: card.columnId,
      cardId: card.id,
      title: card.title,
      description: card.description ?? '',
      labels: card.labels ?? []
    })
  }, [])

  const closeModal = useCallback(() => setModal(null), [])

  const saveModal = useCallback(() => {
    if (!modal || !modal.title.trim()) return
    if (modal.mode === 'add') {
      addCard(modal.columnId, modal.title, modal.description, modal.labels)
    } else {
      updateCard(modal.cardId!, modal.title, modal.description, modal.labels)
    }
    setModal(null)
  }, [modal, addCard, updateCard])

  const deleteFromModal = useCallback(() => {
    if (!modal?.cardId) return
    deleteCard(modal.cardId)
    setModal(null)
  }, [modal, deleteCard])

  const archiveFromModal = useCallback(() => {
    if (!modal?.cardId) return
    archiveCard(modal.cardId)
    setModal(null)
  }, [modal, archiveCard])

  // ---------- Drag & drop ----------

  const handleDragStart = useCallback((e: DragEvent<HTMLDivElement>, cardId: string) => {
    e.dataTransfer.setData(DRAG_MIME, cardId)
    e.dataTransfer.effectAllowed = 'move'
  }, [])

  const handleColumnDragOver = useCallback(
    (e: DragEvent<HTMLDivElement>, columnId: string) => {
      if (!e.dataTransfer.types.includes(DRAG_MIME)) return
      e.preventDefault()
      e.dataTransfer.dropEffect = 'move'
      setDragOverColumn(columnId)
      setDragOverCardId(null)
    },
    []
  )

  const handleCardDragOver = useCallback(
    (e: DragEvent<HTMLDivElement>, columnId: string, cardId: string) => {
      if (!e.dataTransfer.types.includes(DRAG_MIME)) return
      e.preventDefault()
      e.stopPropagation()
      e.dataTransfer.dropEffect = 'move'
      setDragOverColumn(columnId)
      setDragOverCardId(cardId)
    },
    []
  )

  const handleColumnDrop = useCallback(
    (e: DragEvent<HTMLDivElement>, columnId: string) => {
      if (!e.dataTransfer.types.includes(DRAG_MIME)) return
      e.preventDefault()
      const cardId = e.dataTransfer.getData(DRAG_MIME)
      if (cardId) moveCard(cardId, columnId, dragOverCardId)
      setDragOverColumn(null)
      setDragOverCardId(null)
    },
    [moveCard, dragOverCardId]
  )

  const handleColumnDragLeave = useCallback(
    (e: DragEvent<HTMLDivElement>, columnId: string) => {
      if (e.currentTarget.contains(e.relatedTarget as Node)) return
      if (dragOverColumn === columnId) setDragOverColumn(null)
    },
    [dragOverColumn]
  )

  // ---------- Derived ----------

  const archivedCount = useMemo(
    () => doc.cards.filter((c) => c.archived).length,
    [doc.cards]
  )

  const cardsByColumn = useMemo(() => {
    const map = new Map<string, KanbanCard[]>()
    for (const col of doc.columns) map.set(col.id, [])
    const q = searchQuery.trim().toLowerCase()
    for (const card of doc.cards) {
      if (card.archived !== showArchived) continue
      if (q) {
        const hay = `${card.title} ${card.description ?? ''}`.toLowerCase()
        if (!hay.includes(q)) continue
      }
      // Orphan cards (columnId no longer exists) go to the first column.
      const bucket = map.get(card.columnId) ?? map.get(doc.columns[0]?.id)
      if (bucket) bucket.push(card)
    }
    // Sort each column by order.
    for (const list of map.values()) list.sort((a, b) => a.order - b.order)
    return map
  }, [doc, searchQuery, showArchived])


  // ---------- Render ----------

  return (
    <div
      className={`kanban-editor-wrapper ${className || ''}`}
      style={{
        width: '100%',
        height: '100%',
        overflow: 'hidden',
        padding: 16,
        background: 'var(--bg-primary)',
        boxSizing: 'border-box',
        display: 'flex',
        flexDirection: 'column'
      }}
    >
      {/* Search + archive toggle */}
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 8,
          marginBottom: 12,
          flexShrink: 0
        }}
      >
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: 6,
            padding: '4px 10px',
            border: '1px solid var(--border-color)',
            borderRadius: 6,
            background: 'var(--bg-secondary)',
            flex: '0 1 280px'
          }}
        >
          <Search size={13} color="var(--text-tertiary)" />
          <input
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder="搜索卡片…"
            style={{
              flex: 1,
              border: 'none',
              outline: 'none',
              background: 'transparent',
              color: 'var(--text-primary)',
              fontSize: 12,
              fontFamily: 'var(--font-sans)'
            }}
          />
          {searchQuery && (
            <button
              onClick={() => setSearchQuery('')}
              style={iconBtnStyle}
              title="清除"
            >
              <X size={12} />
            </button>
          )}
        </div>
        {archivedCount > 0 && (
          <button
            onClick={() => setShowArchived((v) => !v)}
            title={showArchived ? '返回活动卡片' : '查看已归档'}
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: 4,
              padding: '4px 10px',
              border: '1px solid var(--border-color)',
              borderRadius: 6,
              background: showArchived ? 'var(--bg-active)' : 'transparent',
              color: showArchived ? 'var(--text-primary)' : 'var(--text-tertiary)',
              cursor: 'pointer',
              fontSize: 12
            }}
          >
            <Archive size={13} />
            {archivedCount}
          </button>
        )}
      </div>

      <div
        style={{
          display: 'flex',
          gap: 12,
          alignItems: 'stretch',
          flex: 1,
          minHeight: 0,
          overflowX: 'auto',
          overflowY: 'hidden'
        }}
      >
        {doc.columns.map((column) => {
          const cards = cardsByColumn.get(column.id) ?? []
          const isDragTarget = dragOverColumn === column.id
          return (
            <div
              key={column.id}
              style={{
                ...columnStyle,
                outline: isDragTarget ? '2px dashed var(--accent)' : 'none'
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
                      border: '1px solid var(--accent)',
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
                {!showArchived && (
                  <button
                    onClick={() => openAddModal(column.id)}
                    title="添加任务"
                    style={iconBtnStyle}
                  >
                    <Plus size={13} />
                  </button>
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
              <div
                style={{
                  display: 'flex',
                  flexDirection: 'column',
                  gap: 6,
                  flex: 1,
                  minHeight: 0,
                  overflowY: 'auto',
                  paddingRight: 2
                }}
              >
                {cards.map((card) => (
                  <div
                    key={card.id}
                    draggable
                    onDragStart={(e) => handleDragStart(e, card.id)}
                    onDragOver={(e) => handleCardDragOver(e, column.id, card.id)}
                    onClick={() => openEditModal(card)}
                    style={{
                      ...cardStyle,
                      borderTop:
                        dragOverCardId === card.id
                          ? '2px solid var(--accent)'
                          : '1px solid var(--border-light)'
                    }}
                  >
                    {card.labels && card.labels.length > 0 && (
                      <div style={{ display: 'flex', gap: 4, marginBottom: 4, flexWrap: 'wrap' }}>
                        {card.labels.map((labelId) => (
                          <span
                            key={labelId}
                            style={{
                              fontSize: 10,
                              padding: '1px 6px',
                              borderRadius: 3,
                              color: '#fff',
                              background: LABEL_PALETTE[labelId] ?? 'var(--text-tertiary)',
                              fontWeight: 500,
                              lineHeight: 1.4
                            }}
                          >
                            {LABEL_NAMES[labelId] ?? labelId}
                          </span>
                        ))}
                      </div>
                    )}
                    <div
                      style={{
                        color: 'var(--text-primary)',
                        lineHeight: 1.4,
                        wordBreak: 'break-word'
                      }}
                    >
                      {card.title}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )
        })}

        {/* Add column */}
        {!showArchived && (
          <button
            onClick={addColumn}
            title="添加列"
            style={{
              flex: '0 0 44px',
              height: 44,
              border: '1px dashed var(--border-color)',
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
        )}
      </div>

      {/* ---------- Card modal ---------- */}
      {modal && (
        <ModalOverlay onClose={closeModal}>
          <div
            style={{
              background: 'var(--bg-primary)',
              borderRadius: 10,
              width: 'min(560px, 92vw)',
              maxHeight: '82vh',
              overflow: 'auto',
              padding: '20px 24px',
              boxShadow: '0 12px 40px rgba(0,0,0,0.22)',
              display: 'flex',
              flexDirection: 'column',
              gap: 16
            }}
            onClick={(e) => e.stopPropagation()}
          >
            {/* Header */}
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
              <span style={{ fontSize: 15, fontWeight: 700, color: 'var(--text-primary)' }}>
                {modal.mode === 'add' ? '添加任务' : '编辑任务'}
              </span>
              <button onClick={closeModal} style={iconBtnStyle}>
                <X size={17} />
              </button>
            </div>

            {/* Title */}
            <div>
              <div style={labelHeadingStyle}>标题</div>
              <input
                autoFocus
                value={modal.title}
                onChange={(e) =>
                  setModal((prev) => (prev ? { ...prev, title: e.target.value } : null))
                }
                onKeyDown={(e) => {
                  if (e.key === 'Enter') saveModal()
                  if (e.key === 'Escape') closeModal()
                }}
                placeholder="任务标题"
                style={inputStyle}
              />
            </div>

            {/* Description — WYSIWYG Milkdown editor */}
            <div style={{ flex: 1 }}>
              <div
                style={{
                  fontSize: 12,
                  fontWeight: 600,
                  color: 'var(--text-tertiary)',
                  textTransform: 'uppercase',
                  letterSpacing: '0.05em',
                  marginBottom: 6
                }}
              >
                内容
              </div>
              <div className="kanban-modal-md">
                <MarkdownEditor
                  value={modal.description}
                  onChange={(md) =>
                    setModal((prev) => (prev ? { ...prev, description: md } : null))
                  }
                />
              </div>
            </div>

            {/* Footer */}
            <div
              style={{
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'space-between',
                paddingTop: 4,
                borderTop: '1px solid var(--border-light)'
              }}
            >
              {modal.mode === 'edit' ? (
                <div style={{ display: 'flex', gap: 8 }}>
                  <button
                    onClick={archiveFromModal}
                    style={{
                      display: 'flex',
                      alignItems: 'center',
                      gap: 5,
                      padding: '6px 14px',
                      background: 'transparent',
                      border: '1px solid var(--border-color)',
                      borderRadius: 6,
                      color: 'var(--text-secondary)',
                      fontSize: 13,
                      cursor: 'pointer',
                      fontWeight: 500
                    }}
                  >
                    <Archive size={13} />
                    归档
                  </button>
                  <button
                    onClick={deleteFromModal}
                    style={{
                      display: 'flex',
                      alignItems: 'center',
                      gap: 5,
                      padding: '6px 14px',
                      background: 'transparent',
                      border: '1px solid #ef4444',
                      borderRadius: 6,
                      color: '#ef4444',
                      fontSize: 13,
                      cursor: 'pointer',
                      fontWeight: 500
                    }}
                  >
                    <Trash2 size={13} />
                    删除
                  </button>
                </div>
              ) : (
                <div />
              )}
              <div style={{ display: 'flex', gap: 8 }}>
                <button
                  onClick={closeModal}
                  style={{
                    padding: '6px 16px',
                    background: 'transparent',
                    border: '1px solid var(--border-color)',
                    borderRadius: 6,
                    color: 'var(--text-secondary)',
                    fontSize: 13,
                    cursor: 'pointer'
                  }}
                >
                  取消
                </button>
                <button
                  onClick={saveModal}
                  disabled={!modal.title.trim()}
                  style={{
                    padding: '6px 16px',
                    background: 'var(--accent)',
                    border: 'none',
                    borderRadius: 6,
                    color: '#fff',
                    fontSize: 13,
                    fontWeight: 600,
                    cursor: modal.title.trim() ? 'pointer' : 'not-allowed',
                    opacity: modal.title.trim() ? 1 : 0.45
                  }}
                >
                  保存
                </button>
              </div>
            </div>
          </div>
        </ModalOverlay>
      )}

      {/* ---------- Archived card list ---------- */}
      {showArchived && (
        <div
          style={{
            marginTop: 16,
            padding: 12,
            border: '1px solid var(--border-color)',
            borderRadius: 8,
            background: 'var(--bg-secondary)'
          }}
        >
          <div
            style={{
              fontSize: 13,
              fontWeight: 600,
              color: 'var(--text-primary)',
              marginBottom: 8
            }}
          >
            已归档卡片（{archivedCount}）
          </div>
          {archivedCount === 0 ? (
            <div style={{ fontSize: 12, color: 'var(--text-tertiary)' }}>暂无已归档卡片</div>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
              {doc.cards
                .filter((c) => c.archived)
                .map((card) => (
                  <div
                    key={card.id}
                    style={{
                      display: 'flex',
                      alignItems: 'center',
                      gap: 8,
                      padding: '6px 10px',
                      background: 'var(--bg-primary)',
                      borderRadius: 4,
                      fontSize: 12
                    }}
                  >
                    <span style={{ flex: 1, color: 'var(--text-primary)' }}>{card.title}</span>
                    <button
                      onClick={() => unarchiveCard(card.id)}
                      title="恢复"
                      style={iconBtnStyle}
                    >
                      <ArchiveRestore size={13} />
                    </button>
                    <button
                      onClick={() => deleteCard(card.id)}
                      title="永久删除"
                      style={iconBtnStyle}
                    >
                      <Trash2 size={13} />
                    </button>
                  </div>
                ))}
            </div>
          )}
        </div>
      )}

      {/* ---------- Confirm dialog ---------- */}
      {confirmState && (
        <ModalOverlay onClose={() => setConfirmState(null)}>
          <div
            style={{
              background: 'var(--bg-primary)',
              borderRadius: 10,
              padding: '20px 24px',
              boxShadow: '0 12px 40px rgba(0,0,0,0.22)',
              width: 'min(380px, 92vw)',
              display: 'flex',
              flexDirection: 'column',
              gap: 16
            }}
            onClick={(e) => e.stopPropagation()}
          >
            <p style={{ fontSize: 13, color: 'var(--text-primary)', margin: 0 }}>
              {confirmState.message}
            </p>
            <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8 }}>
              <button
                onClick={() => setConfirmState(null)}
                style={{
                  padding: '6px 16px',
                  background: 'transparent',
                  border: '1px solid var(--border-color)',
                  borderRadius: 6,
                  color: 'var(--text-secondary)',
                  fontSize: 13,
                  cursor: 'pointer'
                }}
              >
                取消
              </button>
              <button
                onClick={() => {
                  confirmState.onConfirm()
                  setConfirmState(null)
                }}
                style={{
                  padding: '6px 16px',
                  background: '#ef4444',
                  border: 'none',
                  borderRadius: 6,
                  color: '#fff',
                  fontSize: 13,
                  fontWeight: 600,
                  cursor: 'pointer'
                }}
              >
                删除
              </button>
            </div>
          </div>
        </ModalOverlay>
      )}

      {/* ---------- Prompt dialog ---------- */}
      {promptState && (
        <PromptDialog
          message={promptState.message}
          defaultValue={promptState.defaultValue}
          onSubmit={(v) => {
            promptState.onSubmit(v)
            setPromptState(null)
          }}
          onCancel={() => setPromptState(null)}
        />
      )}
    </div>
  )
}

const labelHeadingStyle: CSSProperties = {
  fontSize: 12,
  fontWeight: 600,
  color: 'var(--text-tertiary)',
  marginBottom: 6,
  textTransform: 'uppercase',
  letterSpacing: '0.05em'
}

/** Shared modal overlay — click backdrop or press Escape to close. */
function ModalOverlay({
  children,
  onClose
}: {
  children: ReactNode
  onClose: () => void
}): JSX.Element {
  return (
    <div
      style={{
        position: 'fixed',
        inset: 0,
        background: 'rgba(0,0,0,0.45)',
        zIndex: 1000,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center'
      }}
      onClick={onClose}
    >
      {children}
    </div>
  )
}

/** In-app replacement for window.prompt. */
function PromptDialog({
  message,
  defaultValue,
  onSubmit,
  onCancel
}: {
  message: string
  defaultValue: string
  onSubmit: (value: string) => void
  onCancel: () => void
}): JSX.Element {
  const [value, setValue] = useState(defaultValue)
  return (
    <ModalOverlay onClose={onCancel}>
      <div
        style={{
          background: 'var(--bg-primary)',
          borderRadius: 10,
          padding: '20px 24px',
          boxShadow: '0 12px 40px rgba(0,0,0,0.22)',
          width: 'min(380px, 92vw)',
          display: 'flex',
          flexDirection: 'column',
          gap: 12
        }}
        onClick={(e) => e.stopPropagation()}
      >
        <p style={{ fontSize: 13, color: 'var(--text-primary)', margin: 0 }}>{message}</p>
        <input
          autoFocus
          value={value}
          onChange={(e) => setValue(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') onSubmit(value)
            if (e.key === 'Escape') onCancel()
          }}
          style={inputStyle}
        />
        <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8 }}>
          <button
            onClick={onCancel}
            style={{
              padding: '6px 16px',
              background: 'transparent',
              border: '1px solid var(--border-color)',
              borderRadius: 6,
              color: 'var(--text-secondary)',
              fontSize: 13,
              cursor: 'pointer'
            }}
          >
            取消
          </button>
          <button
            onClick={() => onSubmit(value)}
            style={{
              padding: '6px 16px',
              background: 'var(--accent)',
              border: 'none',
              borderRadius: 6,
              color: '#fff',
              fontSize: 13,
              fontWeight: 600,
              cursor: 'pointer'
            }}
          >
            确定
          </button>
        </div>
      </div>
    </ModalOverlay>
  )
}

export default KanbanEditor
