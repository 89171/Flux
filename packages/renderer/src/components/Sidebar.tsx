import { useNotes } from '../store/notes'
import { usePluginHost } from '../plugin-host/store'
import { useMarketStore } from '../store/market'

function formatTime(ts: number): string {
  const d = new Date(ts)
  const now = new Date()
  if (d.toDateString() === now.toDateString()) {
    return d.toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' })
  }
  return d.toLocaleDateString('zh-CN', { month: '2-digit', day: '2-digit' })
}

export function Sidebar(): JSX.Element {
  const { notes, currentId, selectNote, createNote, deleteNote } = useNotes()
  const { formats } = usePluginHost()
  const { setShowMarket } = useMarketStore()

  return (
    <aside className="sidebar">
      <div className="sidebar-header">
        <div className="logo">
          <span className="logo-dot" />
          <h1>PaiNote</h1>
        </div>
        <button
          className="ghost"
          style={{ padding: '4px 10px', fontSize: 11 }}
          onClick={() => setShowMarket(true)}
          title="插件商城"
        >
          商城
        </button>
      </div>

      <div style={{ padding: '12px 16px', borderBottom: '1px solid var(--border)' }}>
        <div style={{ fontSize: 11, color: 'var(--text-dim)', marginBottom: 8 }}>新建笔记</div>
        <div className="new-note-menu">
          {formats.length === 0 && (
            <span style={{ fontSize: 12, color: 'var(--text-dim)' }}>插件加载中…</span>
          )}
          {formats.map((f) => (
            <button
              key={f.format}
              className="primary"
              onClick={() => createNote(f.format, `新${f.displayName}笔记`)}
              title={`用 ${f.displayName} 格式新建`}
            >
              + {f.displayName}
            </button>
          ))}
        </div>
      </div>

      <div className="note-list">
        {notes.length === 0 && (
          <div style={{ padding: 16, fontSize: 12, color: 'var(--text-dim)' }}>暂无笔记</div>
        )}
        {notes.map((n) => (
          <div
            key={n.id}
            className={`note-item ${n.id === currentId ? 'active' : ''}`}
            onClick={() => selectNote(n.id)}
          >
            <div className="title">{n.title}</div>
            <div className="meta">
              <span className="format-badge">{n.format}</span>
              <span>{formatTime(n.updatedAt)}</span>
              <button
                className="ghost"
                style={{ marginLeft: 'auto', padding: '1px 6px', fontSize: 10 }}
                onClick={(e) => {
                  e.stopPropagation()
                  void window.painote.note.openInWindow(n.id)
                }}
                title="在独立窗口打开（可置顶到桌面）"
              >
                弹出
              </button>
              <button
                className="ghost"
                style={{ padding: '1px 6px', fontSize: 10 }}
                onClick={(e) => {
                  e.stopPropagation()
                  if (confirm('删除该笔记？')) deleteNote(n.id)
                }}
              >
                删除
              </button>
            </div>
          </div>
        ))}
      </div>

      <div className="sidebar-footer">
        已注册格式插件
        <div className="format-chips">
          {formats.map((f) => (
            <span key={f.format} className="format-chip" title={`状态: ${f.status}`}>
              {f.displayName}
              {f.builtin ? ' · 内置' : ''}
            </span>
          ))}
        </div>
      </div>
    </aside>
  )
}
