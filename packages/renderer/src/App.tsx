import { useEffect, useState } from 'react'
import { Sidebar } from './components/Sidebar'
import { EditorHost } from './components/EditorHost'
import { WindowControls } from './components/WindowControls'
import { FloatingPinControl } from './components/FloatingPinControl'
import { AIPanel } from './components/AIPanel'
import { Marketplace } from './components/Marketplace'
import { useNotes } from './store/notes'
import { useWindowStore } from './store/window'
import { useAIStore } from './store/ai'
import { useMarketStore } from './store/market'
import { initPluginHost } from './plugin-host'

/** 从 URL 参数中获取 noteId（独立笔记窗口模式） */
function getNoteIdFromUrl(): string | null {
  const params = new URLSearchParams(window.location.search)
  return params.get('note')
}

export default function App(): JSX.Element {
  const [ready, setReady] = useState(false)
  const { currentId, doc, setTitle, saving, loadNotes, selectNote } = useNotes()
  const { loadState } = useWindowStore()
  const { showPanel, setPanelOpen } = useAIStore()
  const { showMarket } = useMarketStore()

  // 独立笔记窗口模式：URL 中带 ?note=<id>
  const noteWindowId = getNoteIdFromUrl()
  const isNoteWindow = noteWindowId !== null

  useEffect(() => {
    void (async () => {
      await initPluginHost()
      await loadNotes()
      // 独立笔记窗口自动选中对应笔记
      if (noteWindowId) {
        await selectNote(noteWindowId)
      }
      // 加载窗口置顶状态
      await loadState()
      setReady(true)
    })()
  }, [loadNotes, loadState, noteWindowId, selectNote])

  if (!ready) {
    return (
      <div className="empty-state">
        <h2>PaiNote</h2>
        <p>正在加载插件系统…</p>
      </div>
    )
  }

  const currentTitle =
    (doc?.meta?.title as string | undefined) ??
    useNotes.getState().notes.find((n) => n.id === currentId)?.title ??
    ''

  return (
    <div className={`app ${isNoteWindow ? 'note-window-mode' : ''}`}>
      {/* 独立笔记窗口隐藏侧边栏 */}
      {!isNoteWindow && <Sidebar />}
      <main className="main">
        {showMarket ? (
          <Marketplace />
        ) : (
          <>
            <div className="main-toolbar">
              <input
                className="title-input"
                value={currentTitle}
                placeholder="笔记标题"
                onChange={(e) => setTitle(e.target.value)}
                disabled={!currentId}
              />
              <span className="toolbar-status">
                {doc ? `${doc.format} · ` : ''}
                {saving ? '保存中…' : '已保存'}
              </span>
              <button
                className={`ai-toggle-btn ${showPanel ? 'active' : ''}`}
                onClick={() => setPanelOpen(!showPanel)}
                title="AI 笔记生成"
                disabled={!currentId}
              >
                AI
              </button>
              <WindowControls />
            </div>
            <div className={`content-row ${showPanel ? 'with-ai' : ''}`}>
              <div className="editor-area">
                <EditorHost />
              </div>
              {showPanel && <AIPanel />}
            </div>
            <FloatingPinControl />
          </>
        )}
      </main>
    </div>
  )
}
