/**
 * PaiNote Main Application
 *
 * Layout: TitleBar | ActivityBar | [Sidebar + Editor + AIPanel] OR [PluginMarket Full Page]
 *
 * Views:
 * - 'editor': normal note editing (sidebar + editor + optional AI panel)
 * - 'plugins': full-page plugin market
 */

import { useEffect, useState } from 'react'
import { TitleBar } from './components/TitleBar'
import { Sidebar } from './components/Sidebar'
import Editor from './components/Editor'
import { AIPanel } from './components/AIPanel'
import PluginMarket from './components/PluginMarket'
import { useFileStore } from './stores/fileStore'
import { usePluginStore } from './stores/pluginStore'
import { useAIStore } from './stores/aiStore'
import { Sparkles, Puzzle, X, FileText } from 'lucide-react'

type AppView = 'editor' | 'plugins'

export default function App() {
  const [view, setView] = useState<AppView>('editor')
  const [aiPanelOpen, setAiPanelOpen] = useState(false)

  const loadTree = useFileStore((s) => s.loadTree)
  const loadPlugins = usePluginStore((s) => s.loadPlugins)

  useEffect(() => {
    loadTree()
    loadPlugins()
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
              className={`activity-bar-btn ${!aiPanelOpen ? 'active' : ''}`}
              onClick={() => { setView('editor'); setAiPanelOpen(false) }}
              data-tooltip="Editor"
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
          <Sidebar />
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
