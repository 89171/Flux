import { useEffect, useMemo, useState, type CSSProperties } from 'react'
import { Clock3, Code2, Eye, RotateCcw, X } from 'lucide-react'
import type { FileHistoryEntry, FileHistoryReadResult, NoteFile } from '@shared/types'
import FileHistoryPreview, { type HistoryPreviewMode } from './FileHistoryPreview'

interface FileHistoryDialogProps {
  file: NoteFile
  onClose: () => void
  onBeforeRestore?: () => void | Promise<void>
  onRestored?: () => void | Promise<void>
}

const overlayStyle: CSSProperties = {
  position: 'fixed',
  inset: 0,
  zIndex: 2000,
  background: 'rgba(0, 0, 0, 0.32)',
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
  padding: 24
}

const modalStyle: CSSProperties = {
  width: 'min(1120px, 94vw)',
  height: 'min(760px, 88vh)',
  background: 'var(--bg-primary)',
  border: '1px solid var(--border-color)',
  borderRadius: 8,
  boxShadow: 'var(--shadow-lg)',
  display: 'flex',
  flexDirection: 'column',
  overflow: 'hidden',
  color: 'var(--text-primary)'
}

function formatTime(timestamp: number): string {
  return new Intl.DateTimeFormat(undefined, {
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit'
  }).format(new Date(timestamp))
}

function formatFullTime(timestamp: number): string {
  return new Intl.DateTimeFormat(undefined, {
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit'
  }).format(new Date(timestamp))
}

function formatSize(size: number): string {
  if (size < 1024) return `${size} B`
  if (size < 1024 * 1024) return `${(size / 1024).toFixed(1)} KB`
  return `${(size / 1024 / 1024).toFixed(1)} MB`
}

function actionLabel(action: FileHistoryEntry['action']): string {
  switch (action) {
    case 'delete':
      return '删除前'
    case 'rename':
      return '重命名前'
    case 'move':
      return '移动前'
    case 'restore':
      return '回滚前'
    case 'save':
    default:
      return '保存前'
  }
}

export default function FileHistoryDialog({
  file,
  onClose,
  onBeforeRestore,
  onRestored
}: FileHistoryDialogProps): JSX.Element {
  const [entries, setEntries] = useState<FileHistoryEntry[]>([])
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [selectedEntry, setSelectedEntry] = useState<FileHistoryReadResult | null>(null)
  const [isLoading, setIsLoading] = useState(true)
  const [isPreviewLoading, setIsPreviewLoading] = useState(false)
  const [isRestoring, setIsRestoring] = useState(false)
  const [confirmRestore, setConfirmRestore] = useState(false)
  const [previewMode, setPreviewMode] = useState<HistoryPreviewMode>('preview')
  const [error, setError] = useState<string | null>(null)

  const selectedMeta = useMemo(
    () => entries.find((entry) => entry.id === selectedId) ?? null,
    [entries, selectedId]
  )

  const loadEntries = async (): Promise<void> => {
    setIsLoading(true)
    setError(null)
    try {
      const history = await window.flux.file.history.list(file.path)
      setEntries(history)
      setSelectedId((current) => current ?? history[0]?.id ?? null)
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
      setEntries([])
      setSelectedId(null)
    } finally {
      setIsLoading(false)
    }
  }

  useEffect(() => {
    void loadEntries()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [file.path])

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [onClose])

  useEffect(() => {
    setConfirmRestore(false)
    setPreviewMode('preview')
    if (!selectedId) {
      setSelectedEntry(null)
      return
    }

    let cancelled = false
    setIsPreviewLoading(true)
    setError(null)
    window.flux.file.history
      .read(file.path, selectedId)
      .then((entry) => {
        if (!cancelled) setSelectedEntry(entry)
      })
      .catch((err) => {
        if (!cancelled) {
          setSelectedEntry(null)
          setError(err instanceof Error ? err.message : String(err))
        }
      })
      .finally(() => {
        if (!cancelled) setIsPreviewLoading(false)
      })

    return () => {
      cancelled = true
    }
  }, [file.path, selectedId])

  const handleRestore = async (): Promise<void> => {
    if (!selectedId || isRestoring) return
    if (!confirmRestore) {
      setConfirmRestore(true)
      return
    }

    setIsRestoring(true)
    setError(null)
    try {
      await onBeforeRestore?.()
      await window.flux.file.history.restore(file.path, selectedId)
      await onRestored?.()
      setConfirmRestore(false)
      setSelectedId(null)
      await loadEntries()
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setIsRestoring(false)
    }
  }

  return (
    <div
      style={overlayStyle}
      onClick={(event) => {
        if (event.target === event.currentTarget) onClose()
      }}
    >
      <div style={modalStyle} role="dialog" aria-modal="true" aria-label="File history">
        <div
          style={{
            height: 52,
            display: 'flex',
            alignItems: 'center',
            gap: 10,
            padding: '0 16px',
            borderBottom: '1px solid var(--border-color)',
            flexShrink: 0
          }}
        >
          <Clock3 size={18} />
          <div style={{ minWidth: 0, flex: 1 }}>
            <div style={{ fontSize: 14, fontWeight: 700 }}>历史记录</div>
            <div
              style={{
                fontSize: 12,
                color: 'var(--text-tertiary)',
                overflow: 'hidden',
                textOverflow: 'ellipsis',
                whiteSpace: 'nowrap'
              }}
            >
              {file.name} · 保留最近 30 天
            </div>
          </div>
          <button className="editor-toolbar-btn" onClick={onClose} title="Close">
            <X size={16} />
          </button>
        </div>

        <div style={{ display: 'flex', minHeight: 0, flex: 1 }}>
          <aside
            style={{
              width: 280,
              borderRight: '1px solid var(--border-color)',
              overflow: 'auto',
              background: 'var(--bg-secondary)'
            }}
          >
            {isLoading ? (
              <div style={{ padding: 16, color: 'var(--text-tertiary)', fontSize: 13 }}>
                正在加载…
              </div>
            ) : entries.length === 0 ? (
              <div style={{ padding: 16, color: 'var(--text-tertiary)', fontSize: 13 }}>
                暂无历史记录
              </div>
            ) : (
              entries.map((entry) => {
                const active = entry.id === selectedId
                return (
                  <button
                    key={entry.id}
                    onClick={() => setSelectedId(entry.id)}
                    style={{
                      width: '100%',
                      display: 'block',
                      border: 'none',
                      borderBottom: '1px solid var(--border-light)',
                      background: active ? 'var(--bg-active)' : 'transparent',
                      color: 'var(--text-primary)',
                      textAlign: 'left',
                      padding: '10px 12px',
                      cursor: 'pointer'
                    }}
                  >
                    <div style={{ fontSize: 13, fontWeight: 650 }}>
                      {formatTime(entry.timestamp)}
                    </div>
                    <div
                      style={{
                        marginTop: 3,
                        display: 'flex',
                        justifyContent: 'space-between',
                        gap: 8,
                        fontSize: 12,
                        color: 'var(--text-tertiary)'
                      }}
                    >
                      <span>{actionLabel(entry.action)}</span>
                      <span>{formatSize(entry.size)}</span>
                    </div>
                  </button>
                )
              })
            )}
          </aside>

          <main style={{ minWidth: 0, flex: 1, display: 'flex', flexDirection: 'column' }}>
            <div
              style={{
                minHeight: 48,
                padding: '10px 14px',
                borderBottom: '1px solid var(--border-color)',
                display: 'flex',
                alignItems: 'center',
                gap: 12
              }}
            >
              <div style={{ minWidth: 0, flex: 1, fontSize: 12, color: 'var(--text-tertiary)' }}>
                {selectedMeta
                  ? `${actionLabel(selectedMeta.action)} · ${formatFullTime(selectedMeta.timestamp)}`
                  : '选择一个历史版本查看内容'}
              </div>
              <button
                onClick={() => setPreviewMode((mode) => mode === 'preview' ? 'source' : 'preview')}
                disabled={!selectedId}
                title={previewMode === 'preview' ? '查看源码' : '查看预览'}
                style={{
                  display: 'inline-flex',
                  alignItems: 'center',
                  gap: 6,
                  border: 'none',
                  borderRadius: 6,
                  padding: '7px 10px',
                  background: 'var(--bg-tertiary)',
                  color: 'var(--text-primary)',
                  cursor: selectedId ? 'pointer' : 'default',
                  opacity: selectedId ? 1 : 0.5,
                  fontSize: 13
                }}
              >
                {previewMode === 'preview' ? <Code2 size={14} /> : <Eye size={14} />}
                {previewMode === 'preview' ? '源码' : '预览'}
              </button>
              <button
                onClick={() => void handleRestore()}
                disabled={!selectedId || isRestoring}
                style={{
                  display: 'inline-flex',
                  alignItems: 'center',
                  gap: 6,
                  border: 'none',
                  borderRadius: 6,
                  padding: '7px 10px',
                  background: confirmRestore ? 'var(--accent-primary)' : 'var(--bg-tertiary)',
                  color: confirmRestore ? 'var(--bg-primary)' : 'var(--text-primary)',
                  cursor: selectedId && !isRestoring ? 'pointer' : 'default',
                  opacity: selectedId && !isRestoring ? 1 : 0.5,
                  fontSize: 13
                }}
              >
                <RotateCcw size={14} />
                {isRestoring ? '恢复中…' : confirmRestore ? '再次点击确认' : '恢复此版本'}
              </button>
            </div>

            {error && (
              <div
                style={{
                  margin: 12,
                  padding: '8px 10px',
                  borderRadius: 6,
                  border: '1px solid #cc0000',
                  color: '#cc0000',
                  fontSize: 12
                }}
              >
                {error}
              </div>
            )}

            <FileHistoryPreview
              file={file}
              entry={selectedEntry}
              isLoading={isPreviewLoading}
              mode={previewMode}
            />
          </main>
        </div>
      </div>
    </div>
  )
}
