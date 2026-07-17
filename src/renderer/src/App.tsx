/**
 * Flux Main Application
 *
 * Layout: TitleBar | ActivityBar | [Sidebar + Editor + AIPanel] OR [PluginMarket Full Page]
 *
 * Views:
 * - 'editor': normal note editing (sidebar + editor + optional AI panel)
 * - 'plugins': full-page plugin market
 */

import { useEffect, useRef, useState, useCallback, useMemo } from 'react'
import { TitleBar } from './components/TitleBar'
import { Sidebar } from './components/Sidebar'
import Editor from './components/Editor'
import { AIPanel } from './components/AIPanel'
import PluginMarket from './components/PluginMarket'
import QuickOpen from './components/QuickOpen'
import CommandPalette, { type Command } from './components/CommandPalette'
import SettingsPanel from './components/SettingsPanel'
import GlobalSearch from './components/GlobalSearch'
import UpdateDialog from './components/UpdateDialog'
import AboutDialog from './components/AboutDialog'
import { useFileStore } from './stores/fileStore'
import { usePluginStore } from './stores/pluginStore'
import type { NoteFile } from '@shared/types'
import { Sparkles, Puzzle, X, FileText, Settings, Search } from 'lucide-react'

type AppView = 'editor' | 'plugins'

const SIDEBAR_DEFAULT_WIDTH = 240
const SIDEBAR_MIN_WIDTH = 180
const SIDEBAR_MAX_WIDTH = 500

export default function App() {
  const [view, setView] = useState<AppView>('editor')
  const [aiPanelOpen, setAiPanelOpen] = useState(false)
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false)
  const [sidebarWidth, setSidebarWidth] = useState(SIDEBAR_DEFAULT_WIDTH)
  const isResizingRef = useRef(false)

  // P0 feature modals
  const [showQuickOpen, setShowQuickOpen] = useState(false)
  const [showCommandPalette, setShowCommandPalette] = useState(false)
  const [showSettings, setShowSettings] = useState(false)
  const [showGlobalSearch, setShowGlobalSearch] = useState(false)
  const [showUpdateDialog, setShowUpdateDialog] = useState(false)
  const [showAboutDialog, setShowAboutDialog] = useState(false)
  const [theme, setTheme] = useState<'light' | 'dark'>('light')

  const loadTree = useFileStore((s) => s.loadTree)
  const loadPlugins = usePluginStore((s) => s.loadPlugins)
  const loadFormatMap = usePluginStore((s) => s.loadFormatMap)
  const setFormatMap = usePluginStore((s) => s.setFormatMap)
  const fileTree = useFileStore((s) => s.tree)

  useEffect(() => {
    loadTree()
    loadPlugins()
    loadFormatMap()
    // Load theme from settings
    window.flux.settings.get().then((s) => setTheme(s.theme))
  }, [])

  // Apply theme attribute to <html>
  useEffect(() => {
    document.documentElement.setAttribute('data-theme', theme)
  }, [theme])

  // Persist theme change
  const toggleTheme = useCallback(() => {
    setTheme((prev) => {
      const next = prev === 'light' ? 'dark' : 'light'
      window.flux.settings.set({ theme: next })
      return next
    })
  }, [])

  // Flatten file tree for QuickOpen
  const flatFiles = useMemo(() => {
    const files: NoteFile[] = []
    const walk = (nodes: NoteFile[]) => {
      for (const node of nodes) {
        if (node.type === 'file') files.push(node)
        if (node.children) walk(node.children)
      }
    }
    walk(fileTree)
    return files
  }, [fileTree])

  // Command list for Command Palette
  const commands = useMemo<Command[]>(() => [
    { id: 'new-file', label: 'File: New File', shortcut: 'Cmd+N' },
    { id: 'save', label: 'File: Save', shortcut: 'Cmd+S' },
    { id: 'open-folder', label: 'File: Open Folder', shortcut: 'Cmd+O' },
    { id: 'find', label: 'Edit: Find', shortcut: 'Cmd+F' },
    { id: 'replace', label: 'Edit: Replace', shortcut: 'Cmd+H' },
    { id: 'zoom-in', label: 'View: Zoom In', shortcut: 'Cmd+=' },
    { id: 'zoom-out', label: 'View: Zoom Out', shortcut: 'Cmd+-' },
    { id: 'zoom-reset', label: 'View: Reset Zoom', shortcut: 'Cmd+0' },
    { id: 'toggle-theme', label: 'View: Toggle Theme', shortcut: 'Cmd+Shift+T' },
    { id: 'quick-open', label: 'Go: Quick Open', shortcut: 'Cmd+P' },
    { id: 'global-search', label: 'Go: Global Search', shortcut: 'Cmd+Shift+F' },
    { id: 'settings', label: 'Preferences: Open Settings', shortcut: 'Cmd+,' },
    { id: 'check-for-updates', label: 'Help: Check for Updates', shortcut: '' }
  ], [])

  const handleCommand = useCallback((cmdId: string) => {
    setShowCommandPalette(false)
    switch (cmdId) {
      case 'save':
        useFileStore.getState().saveFile()
        break
      case 'open-folder':
        useFileStore.getState().openFolder()
        break
      case 'find':
        window.dispatchEvent(new CustomEvent('flux:find', { detail: 'find' }))
        break
      case 'replace':
        window.dispatchEvent(new CustomEvent('flux:find', { detail: 'replace' }))
        break
      case 'zoom-in':
        window.dispatchEvent(new CustomEvent('flux:zoom', { detail: 'in' }))
        break
      case 'zoom-out':
        window.dispatchEvent(new CustomEvent('flux:zoom', { detail: 'out' }))
        break
      case 'zoom-reset':
        window.dispatchEvent(new CustomEvent('flux:zoom', { detail: 'reset' }))
        break
      case 'toggle-theme':
        toggleTheme()
        break
      case 'quick-open':
        setShowQuickOpen(true)
        break
      case 'global-search':
        setShowGlobalSearch(true)
        break
      case 'settings':
        setShowSettings(true)
        break
      case 'check-for-updates':
        setShowUpdateDialog(true)
        break
      case 'about':
        setShowAboutDialog(true)
        break
    }
  }, [toggleTheme])

  const handleQuickOpen = useCallback((path: string) => {
    const file = flatFiles.find((f) => f.path === path)
    if (file) useFileStore.getState().openFile(file)
    setShowQuickOpen(false)
  }, [flatFiles])

  // Global keyboard shortcuts for P0 features
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      // Skip during IME composition (e.g. Chinese pinyin mid-word).
      // Also skip if the browser reports a stale isComposing state —
      // e229 is the Chromium sentinel keyCode emitted for some IME events.
      if (e.isComposing || e.keyCode === 229) return
      const mod = e.metaKey || e.ctrlKey
      if (!mod) return
      // Ctrl+O - Open Folder. The native menu accelerator was dropped to
      // avoid the Chinese-IME bare-letter false-trigger; handled here where
      // the `isComposing` guard above protects it.
      if (mod && !e.shiftKey && e.key === 'o') {
        e.preventDefault()
        useFileStore.getState().openFolder()
        return
      }
      // Ctrl+P - Quick Open (not Shift+P which is Command Palette)
      if (mod && !e.shiftKey && e.key === 'p') {
        e.preventDefault()
        setShowQuickOpen(true)
        return
      }
      // Ctrl+Shift+P - Command Palette
      if (mod && e.shiftKey && (e.key === 'P' || e.key === 'p')) {
        e.preventDefault()
        setShowCommandPalette(true)
        return
      }
      // Ctrl+Shift+F - Global Search
      if (mod && e.shiftKey && (e.key === 'F' || e.key === 'f')) {
        e.preventDefault()
        setShowGlobalSearch(true)
        return
      }
      // Ctrl+Shift+T - Toggle Theme
      if (mod && e.shiftKey && (e.key === 'T' || e.key === 't')) {
        e.preventDefault()
        toggleTheme()
        return
      }
      // Ctrl+, - Settings
      if (mod && e.key === ',') {
        e.preventDefault()
        setShowSettings(true)
        return
      }
    }
    window.addEventListener('keydown', handler)
    return () => window.removeEventListener('keydown', handler)
  }, [toggleTheme])

  // Listen for menu actions from main process
  useEffect(() => {
    const unsubscribe = window.flux.on.menuAction((action: string) => {
      handleCommand(action)
    })
    return () => { unsubscribe() }
  }, [handleCommand])

  // Keep the extension → renderer map in sync as plugins are activated /
  // deactivated / installed anywhere else in the process.
  useEffect(() => {
    const unsubscribe = window.flux.plugin.onFormatMapChanged(setFormatMap)
    return unsubscribe
  }, [setFormatMap])

  // Subscribe to cross-window file change broadcasts. When another window
  // (typically a pinned note window) writes the same file we have open,
  // fold their new content into our buffer — unless we're dirty, in which
  // case fileStore surfaces a conflict flag.
  useEffect(() => {
    const unsubscribe = window.flux.file.onChanged((payload) => {
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
    const unsubscribe = window.flux.file.onTreeChanged((tree) => {
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
      const { isDirty, currentFile, currentContent, currentMtime } = useFileStore.getState()
      if (!isDirty || !currentFile) return
      event.preventDefault()
      event.returnValue = ''
      window.flux.file
        .writeGuarded(currentFile.path, currentContent, currentMtime)
        .catch((err) => console.error('Failed to autosave on close:', err))
        .finally(() => {
          hasFlushed.current = true
          window.close()
        })
    }
    window.addEventListener('beforeunload', handleBeforeUnload)
    return () => window.removeEventListener('beforeunload', handleBeforeUnload)
  }, [])

  useEffect(() => {
    const handler = () => {
      setView('editor')
      setAiPanelOpen((v) => !v)
    }
    window.addEventListener('flux:toggle-ai', handler)
    return () => window.removeEventListener('flux:toggle-ai', handler)
  }, [])

  const toggleAIPanel = () => setAiPanelOpen((v) => !v)

  const handleResizeStart = useCallback((e: React.MouseEvent) => {
    e.preventDefault()
    isResizingRef.current = true
    document.body.style.cursor = 'col-resize'
    document.body.style.userSelect = 'none'

    const startX = e.clientX
    const startWidth = sidebarWidth

    const handleMouseMove = (moveEvent: MouseEvent) => {
      if (!isResizingRef.current) return
      const deltaX = moveEvent.clientX - startX
      const newWidth = Math.min(
        Math.max(startWidth + deltaX, SIDEBAR_MIN_WIDTH),
        SIDEBAR_MAX_WIDTH
      )
      setSidebarWidth(newWidth)
    }

    const handleMouseUp = () => {
      isResizingRef.current = false
      document.body.style.cursor = ''
      document.body.style.userSelect = ''
      window.removeEventListener('mousemove', handleMouseMove)
      window.removeEventListener('mouseup', handleMouseUp)
    }

    window.addEventListener('mousemove', handleMouseMove)
    window.addEventListener('mouseup', handleMouseUp)
  }, [sidebarWidth])

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
            <button
              className="activity-bar-btn"
              onClick={() => setShowGlobalSearch(true)}
              data-tooltip="Global Search (Cmd+Shift+F)"
            >
              <Search size={20} />
            </button>
            <button
              className="activity-bar-btn"
              onClick={() => setShowSettings(true)}
              data-tooltip="Settings (Cmd+,)"
              style={{ marginTop: 'auto' }}
            >
              <Settings size={20} />
            </button>
          </div>

          {/* Main Content Area */}
          {!sidebarCollapsed && (
            <div style={{ display: 'flex', height: '100%' }}>
              <div style={{ width: sidebarWidth, height: '100%', flexShrink: 0 }}>
                <Sidebar onCollapse={() => setSidebarCollapsed(true)} />
              </div>
              <div
                onMouseDown={handleResizeStart}
                style={{
                  width: '4px',
                  cursor: 'col-resize',
                  background: 'transparent',
                  flexShrink: 0,
                  transition: 'background 0.2s ease',
                }}
                onMouseEnter={(e) => {
                  e.currentTarget.style.background = 'var(--accent-primary)'
                }}
                onMouseLeave={(e) => {
                  e.currentTarget.style.background = 'transparent'
                }}
              />
            </div>
          )}
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

      {/* P0 Feature Modals & Panels */}
      {showQuickOpen && (
        <QuickOpen
          files={flatFiles}
          onOpen={handleQuickOpen}
          onClose={() => setShowQuickOpen(false)}
        />
      )}
      {showCommandPalette && (
        <CommandPalette
          commands={commands}
          onExecute={handleCommand}
          onClose={() => setShowCommandPalette(false)}
        />
      )}
      {showSettings && (
        <SettingsPanel
          onClose={() => setShowSettings(false)}
          onThemeChange={setTheme}
        />
      )}
      {showGlobalSearch && (
        <GlobalSearch
          onClose={() => setShowGlobalSearch(false)}
          onOpenFile={handleQuickOpen}
        />
      )}
      {showUpdateDialog && (
        <UpdateDialog onClose={() => setShowUpdateDialog(false)} />
      )}
      {showAboutDialog && (
        <AboutDialog onClose={() => setShowAboutDialog(false)} />
      )}
    </div>
  )
}
