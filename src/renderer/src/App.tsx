/**
 * PaiNote Main Application
 *
 * Layout: TitleBar | ActivityBar | [Sidebar + Editor + AIPanel] OR [PluginMarket Full Page]
 *
 * Views:
 * - 'editor': normal note editing (sidebar + editor + optional AI panel)
 * - 'plugins': full-page plugin market
 */

import { useEffect, useRef, useState } from 'react'
import { TitleBar } from './components/TitleBar'
import { Sidebar } from './components/Sidebar'
import Editor from './components/Editor'
import { AIPanel } from './components/AIPanel'
import PluginMarket from './components/PluginMarket'
import { useFileStore } from './stores/fileStore'
import { usePluginStore } from './stores/pluginStore'
import { Sparkles, Puzzle, X, FileText } from 'lucide-react'

type AppView = 'editor' | 'plugins'

export default function App() {
  const [view, setView] = useState<AppView>('editor')
  const [aiPanelOpen, setAiPanelOpen] = useState(false)
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false)

  const loadTree = useFileStore((s) => s.loadTree)
  const loadPlugins = usePluginStore((s) => s.loadPlugins)
  const loadFormatMap = usePluginStore((s) => s.loadFormatMap)
  const setFormatMap = usePluginStore((s) => s.setFormatMap)

  useEffect(() => {
    loadTree()
    loadPlugins()
    loadFormatMap()
  }, [])

  // Keep the extension → renderer map in sync as plugins are activated /
  // deactivated / installed anywhere else in the process.
  useEffect(() => {
    const unsubscribe = window.painote.plugin.onFormatMapChanged(setFormatMap)
    return unsubscribe
  }, [setFormatMap])

  // Subscribe to cross-window file change broadcasts. When another window
  // (typically a pinned note window) writes the same file we have open,
  // fold their new content into our buffer — unless we're dirty, in which
  // case fileStore surfaces a conflict flag.
  useEffect(() => {
    const unsubscribe = window.painote.file.onChanged((payload) => {
      useFileStore.getState().applyExternalChange(
        payload.path,
        payload.content,
        payload.mtime
      )
    })
    return unsubscribe
  }, [])

  // Push-based tree updates. Main broadcasts the new tree after any
  // create/delete/rename/move (mutation) or any external filesystem event
  // caught by chokidar. Renderers no longer need to loadTree() manually.
  useEffect(() => {
    const unsubscribe = window.painote.file.onTreeChanged((tree) => {
      useFileStore.getState().applyTreeUpdate(tree)
    })
    return unsubscribe
  }, [])

  // Prevent data loss on app close. In Electron, setting event.returnValue
  // inside beforeunload actually cancels the close (unlike browsers where
  // it only shows a confirm dialog). So we cancel once, run the save, then
  // re-trigger close via IPC. hasFlushed guards against reentry.
  const hasFlushed = useRef(false)
  useEffect(() => {
    const handleBeforeUnload = (event: BeforeUnloadEvent) => {
      if (hasFlushed.current) return
      const { isDirty, currentFile, currentContent } = useFileStore.getState()
      if (!isDirty || !currentFile) return
      event.preventDefault()
      event.returnValue = ''
      window.painote.file
        .write(currentFile.path, currentContent)
        .catch((err) => console.error('Failed to autosave on close:', err))
        .finally(() => {
          hasFlushed.current = true
          window.close()
        })
    }
    window.addEventListener('beforeunload', handleBeforeUnload)
    return () => window.removeEventListener('beforeunload', handleBeforeUnload)
  }, [])

  const toggleAIPanel = () => setAiPanelOpen((v) => !v)

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100vh', width: '100vw' }}>
      <TitleBar />
      {view === 'plugins' ? (
        /* Plugin Market - Independent Full Page (no activity bar) */
        <PluginMarket onBack={() => setView('editor')} />
      ) : (
        /* Editor View: ActivityBar + Sidebar + Editor + optional AI Panel */
        <div style={{ display: 'flex', flex: 1, overflow: 'hidden' }}>
          {/* Activity Bar - Icon-only vertical bar (VSCode style) */}
          <div className="activity-bar">
            <button
              className={`activity-bar-btn ${view === 'editor' && !aiPanelOpen && !sidebarCollapsed ? 'active' : ''}`}
              onClick={() => {
                if (view !== 'editor') {
                  setView('editor')
                  setAiPanelOpen(false)
                  setSidebarCollapsed(false)
                } else {
                  setSidebarCollapsed((v) => !v)
                }
              }}
              data-tooltip={sidebarCollapsed ? 'Show Explorer' : 'Hide Explorer'}
            >
              <FileText size={20} />
            </button>
            <button
              className={`activity-bar-btn ${aiPanelOpen ? 'active' : ''}`}
              onClick={() => { setView('editor'); toggleAIPanel() }}
              data-tooltip="AI Assistant"
            >
              <Sparkles size={20} />
            </button>
            <button
              className="activity-bar-btn"
              onClick={() => setView('plugins')}
              data-tooltip="Plugin Market"
            >
              <Puzzle size={20} />
            </button>
          </div>

          {/* Main Content Area */}
          {!sidebarCollapsed && <Sidebar onCollapse={() => setSidebarCollapsed(true)} />}
          <Editor />
          {aiPanelOpen && (
            <div className="right-panel">
              <div className="right-panel-header">
                <span className="right-panel-title">AI Assistant</span>
                <button className="btn-icon" onClick={() => setAiPanelOpen(false)}>
                  <X size={16} />
                </button>
              </div>
              <div className="right-panel-content">
                <AIPanel />
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  )
}
