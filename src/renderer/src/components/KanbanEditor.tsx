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
 * Interactions:
 *   - Click "添加任务" → modal with title + markdown description
 *   - Task cards show only the title; click to open edit/delete modal
 *   - Drag cards between columns (HTML5 DnD — no library)
 *   - Double-click column name to rename
 */

import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type DragEvent
} from 'react'
import { Plus, X, Pencil, Trash2, GripVertical } from 'lucide-react'
import { marked } from 'marked'

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

interface ModalState {
  mode: 'add' | 'edit'
  columnId: string
  cardId: string | null
  title: string
  description: string
  tab: 'write' | 'preview'
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
  cursor: 'pointer',
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
  const [modal, setModal] = useState<ModalState | null>(null)
  const onChangeRef = useRef(onChange)
  onChangeRef.current = onChange
  const lastSerialisedRef = useRef<string>('')

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
    (columnId: string, title: string, description?: string) => {
      const trimmed = title.trim()
      if (!trimmed) return
      commit({
        ...doc,
        cards: [
          ...doc.cards,
          {
            id: uid('card'),
            columnId,
            title: trimmed,
            description: description?.trim() || undefined,
            createdAt: Date.now()
          }
        ]
      })
    },
    [doc, commit]
  )

  const updateCard = useCallback(
    (id: string, title: string, description: string) => {
      commit({
        ...doc,
        cards: doc.cards.map((c) =>
          c.id === id
            ? { ...c, title: title.trim(), description: description.trim() || undefined }
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

  // ---------- Modal ----------

  const openAddModal = useCallback((columnId: string) => {
    setModal({ mode: 'add', columnId, cardId: null, title: '', description: '', tab: 'write' })
  }, [])

  const openEditModal = useCallback((card: KanbanCard) => {
    setModal({
      mode: 'edit',
      columnId: card.columnId,
      cardId: card.id,
      title: card.title,
      description: card.description ?? '',
      tab: 'write'
    })
  }, [])

  const closeModal = useCallback(() => setModal(null), [])

  const saveModal = useCallback(() => {
    if (!modal || !modal.title.trim()) return
    if (modal.mode === 'add') {
      addCard(modal.columnId, modal.title, modal.description)
    } else {
      updateCard(modal.cardId!, modal.title, modal.description)
    }
    setModal(null)
  }, [modal, addCard, updateCard])

  const deleteFromModal = useCallback(() => {
    if (!modal?.cardId) return
    deleteCard(modal.cardId)
    setModal(null)
  }, [modal, deleteCard])

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
      else map.get(doc.columns[0]?.id)?.push({ ...card, columnId: doc.columns[0].id })
    }
    return map
  }, [doc])

  const renderedMarkdown = useMemo(() => {
    if (!modal?.description) return ''
    try {
      return marked.parse(modal.description) as string
    } catch {
      return ''
    }
  }, [modal?.description, modal?.tab])

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

              {/* Cards — title only, click to open modal */}
              <div style={{ display: 'flex', flexDirection: 'column', gap: 6, minHeight: 40 }}>
                {cards.map((card) => (
                  <div
                    key={card.id}
                    draggable
                    onDragStart={(e) => handleDragStart(e, card.id)}
                    onClick={() => openEditModal(card)}
                    style={cardStyle}
                  >
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

              {/* Add card */}
              <button
                onClick={() => openAddModal(column.id)}
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: 4,
                  padding: '6px 8px',
                  background: 'transparent',
                  border: '1px dashed var(--border-color)',
                  borderRadius: 4,
                  color: 'var(--text-tertiary)',
                  cursor: 'pointer',
                  fontSize: 12
                }}
              >
                <Plus size={13} /> 添加任务
              </button>
            </div>
          )
        })}

        {/* Add column */}
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
      </div>

      {/* Card modal */}
      {modal && (
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
          onClick={closeModal}
          onKeyDown={(e) => e.key === 'Escape' && closeModal()}
        >
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
            <div
              style={{
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'space-between'
              }}
            >
              <span
                style={{ fontSize: 15, fontWeight: 700, color: 'var(--text-primary)' }}
              >
                {modal.mode === 'add' ? '添加任务' : '编辑任务'}
              </span>
              <button onClick={closeModal} style={iconBtnStyle}>
                <X size={17} />
              </button>
            </div>

            {/* Title */}
            <div>
              <div
                style={{
                  fontSize: 12,
                  fontWeight: 600,
                  color: 'var(--text-tertiary)',
                  marginBottom: 6,
                  textTransform: 'uppercase',
                  letterSpacing: '0.05em'
                }}
              >
                标题
              </div>
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

            {/* Description */}
            <div style={{ flex: 1 }}>
              <div
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'space-between',
                  marginBottom: 6
                }}
              >
                <div
                  style={{
                    fontSize: 12,
                    fontWeight: 600,
                    color: 'var(--text-tertiary)',
                    textTransform: 'uppercase',
                    letterSpacing: '0.05em'
                  }}
                >
                  内容
                </div>
                <div style={{ display: 'flex', border: '1px solid var(--border-color)', borderRadius: 5, overflow: 'hidden' }}>
                  {(['write', 'preview'] as const).map((tab) => (
                    <button
                      key={tab}
                      onClick={() =>
                        setModal((prev) => (prev ? { ...prev, tab } : null))
                      }
                      style={{
                        padding: '3px 10px',
                        fontSize: 12,
                        background: modal.tab === tab ? 'var(--bg-active)' : 'transparent',
                        border: 'none',
                        cursor: 'pointer',
                        color: modal.tab === tab ? 'var(--text-primary)' : 'var(--text-tertiary)',
                        fontWeight: modal.tab === tab ? 600 : 400,
                        transition: 'background 0.1s'
                      }}
                    >
                      {tab === 'write' ? '编辑' : '预览'}
                    </button>
                  ))}
                </div>
              </div>

              {modal.tab === 'write' ? (
                <textarea
                  value={modal.description}
                  onChange={(e) =>
                    setModal((prev) => (prev ? { ...prev, description: e.target.value } : null))
                  }
                  onKeyDown={(e) => {
                    if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') saveModal()
                    if (e.key === 'Escape') closeModal()
                  }}
                  placeholder="支持 Markdown 格式…"
                  rows={8}
                  style={{
                    ...inputStyle,
                    resize: 'vertical',
                    fontFamily: 'var(--font-mono)',
                    fontSize: 13,
                    lineHeight: 1.6
                  }}
                />
              ) : (
                <div
                  style={{
                    minHeight: 120,
                    padding: '8px 10px',
                    border: '1px solid var(--border-color)',
                    borderRadius: 6,
                    background: 'var(--bg-secondary)',
                    fontSize: 13,
                    color: 'var(--text-primary)',
                    lineHeight: 1.7,
                    overflowY: 'auto'
                  }}
                  className="kanban-md-preview"
                  dangerouslySetInnerHTML={{
                    __html: renderedMarkdown ||
                      '<span style="color:var(--text-tertiary);font-style:italic">无内容</span>'
                  }}
                />
              )}
              {modal.tab === 'write' && (
                <div
                  style={{
                    marginTop: 4,
                    fontSize: 11,
                    color: 'var(--text-tertiary)'
                  }}
                >
                  支持 Markdown · Ctrl+Enter 保存
                </div>
              )}
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
        </div>
      )}
    </div>
  )
}

export default KanbanEditor
