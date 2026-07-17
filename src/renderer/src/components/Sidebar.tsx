/**
 * Flux Sidebar - VSCode-style File Explorer
 *
 * Features:
 *  - Collapsible folder tree (chevron + folder/file icons)
 *  - Selected file highlight
 *  - Right-click context menu (new file/folder, rename, open externally, delete)
 *  - Inline rename input
 *  - New file/folder creation input at the top of the tree (or inside a directory)
 *  - Drag & drop file moving between directories
 *  - Empty state with a "New Note" call-to-action
 *  - Listens for the 'tree:rename' custom event to trigger inline rename
 */

import {
  useState,
  useEffect,
  useRef,
  useCallback,
  useMemo,
  type CSSProperties,
  type MouseEvent as ReactMouseEvent,
  type DragEvent as ReactDragEvent
} from 'react'
import {
  FileText,
  Folder,
  FolderOpen,
  ChevronRight,
  ChevronDown,
  FilePlus,
  FolderPlus,
  Trash2,
  Pencil,
  Plus,
  ExternalLink,
  RefreshCw,
  FileCode,
  Network,
  Workflow,
  FileType,
  FolderOpen as FolderOpenIcon,
  BookOpen,
  Braces,
  Code2,
  Image as ImageIcon,
  Music,
  Notebook,
  Palette,
  Presentation,
  Table,
  Terminal,
  Video,
  ScrollText,
  Sheet,
  GitBranch,
  GitMerge,
  LayoutGrid,
  Waypoints,
  PanelLeftClose,
  History as HistoryIcon
} from 'lucide-react'
import type { NoteFile, NoteFormat } from '@shared/types'
import { useFileStore } from '../stores/fileStore'
import { usePluginStore } from '../stores/pluginStore'
import FileHistoryDialog from './FileHistoryDialog'

interface ContextMenuState {
  x: number
  y: number
  node: NoteFile
}

interface CreatingState {
  parentPath: string
  isDir: boolean
  initialName?: string
  icon?: string
  extension?: string
}

/** A selectable file type in the New File dropdown. */
interface FileTypeOption {
  format: NoteFormat
  label: string
  extension: string
  icon?: string // resolved file:// URL or lucide icon name
}

function getRevealInFolderLabel(): string {
  const platform = navigator.platform.toLowerCase()
  if (platform.includes('mac')) return 'Reveal in Finder'
  if (platform.includes('win')) return 'Show in File Explorer'
  return 'Show in File Manager'
}

/** Lucide icon component to render for a built-in format (no plugin icon). */
function BuiltinFormatIcon({ format, size = 16 }: { format: NoteFormat; size?: number }) {
  switch (format) {
    case 'markdown':
      return <FileText size={size} />
    case 'drawio':
      return <Workflow size={size} />
    case 'mindmap':
      return <Network size={size} />
    case 'whiteboard':
      return <Palette size={size} />
    case 'excalidraw':
      return <Presentation size={size} />
    case 'kanban':
      return <LayoutGrid size={size} />
    case 'mermaid':
      return <GitMerge size={size} />
    case 'plantuml':
      return <Waypoints size={size} />
    case 'bpmn':
      return <Workflow size={size} />
    case 'dmn':
      return <Table size={size} />
    case 'plaintext':
      return <FileText size={size} />
    default:
      return <FileCode size={size} />
  }
}

/**
 * Renders an icon value coming from a plugin manifest.
 *   - Values starting with `file://` (or `http`) are image URLs.
 *   - Otherwise we look the value up in a whitelist of lucide icon names.
 *
 * Whitelisted because the value is embedded verbatim into a React tree —
 * we don't do dynamic component lookup against the raw lucide barrel.
 * When adding entries, keep the alias for the icon component so third
 * parties can pick any of these without needing to ship an SVG.
 */
function PluginIconRenderer({ icon, size = 16 }: { icon?: string; size?: number }) {
  if (!icon) return <FileText size={size} />
  if (icon.startsWith('file://') || icon.startsWith('http')) {
    return <img src={icon} alt="" style={{ width: size, height: size, display: 'block' }} />
  }
  const iconMap: Record<string, React.ReactNode> = {
    FileText: <FileText size={size} />,
    FileCode: <FileCode size={size} />,
    FileType: <FileType size={size} />,
    ScrollText: <ScrollText size={size} />,
    Notebook: <Notebook size={size} />,
    BookOpen: <BookOpen size={size} />,
    Network: <Network size={size} />,
    Workflow: <Workflow size={size} />,
    GitBranch: <GitBranch size={size} />,
    Braces: <Braces size={size} />,
    Code2: <Code2 size={size} />,
    Terminal: <Terminal size={size} />,
    Image: <ImageIcon size={size} />,
    Music: <Music size={size} />,
    Video: <Video size={size} />,
    Palette: <Palette size={size} />,
    Presentation: <Presentation size={size} />,
    Sheet: <Sheet size={size} />,
    Table: <Table size={size} />,
    LayoutGrid: <LayoutGrid size={size} />,
    GitMerge: <GitMerge size={size} />,
    Waypoints: <Waypoints size={size} />
  }
  return <>{iconMap[icon] || <FileText size={size} />}</>
}

/** Returns the lowercase extension (without dot) from a filename. */
function getExtension(name: string): string {
  const dot = name.lastIndexOf('.')
  return dot >= 0 ? name.substring(dot + 1).toLowerCase() : ''
}

const inlineInputStyle: CSSProperties = {
  flex: 1,
  minWidth: 0,
  border: '1px solid var(--accent)',
  borderRadius: 'var(--radius-sm)',
  padding: '0 4px',
  fontSize: 'var(--font-size-base)',
  fontFamily: 'var(--font-sans)',
  background: 'var(--bg-primary)',
  color: 'var(--text-primary)',
  outline: 'none',
  height: 20
}

/** Prevents moving a path into itself or one of its descendants. */
function isDescendantOrSelf(sourcePath: string, targetPath: string): boolean {
  if (sourcePath === targetPath) return true
  return targetPath.startsWith(sourcePath + '/')
}

/**
 * Inline text input used for both creating new entries and renaming
 * existing ones. Submits on Enter / blur (when the value changes), cancels
 * on Escape, and is guarded against double-submission.
 */
function InlineEditInput({
  initialValue = '',
  placeholder,
  allowUnchanged = false,
  selectWithoutExtension = false,
  onSubmit,
  onCancel
}: {
  initialValue?: string
  placeholder?: string
  allowUnchanged?: boolean
  selectWithoutExtension?: boolean
  onSubmit: (value: string) => void
  onCancel: () => void
}) {
  const [value, setValue] = useState(initialValue)
  const inputRef = useRef<HTMLInputElement>(null)
  const doneRef = useRef(false)

  useEffect(() => {
    const input = inputRef.current
    if (!input) return
    input.focus()
    if (selectWithoutExtension) {
      // Select only the part before the first dot (e.g. "Untitled" in "Untitled.md")
      const dotIndex = initialValue.lastIndexOf('.')
      const selectEnd = dotIndex > 0 ? dotIndex : initialValue.length
      input.setSelectionRange(0, selectEnd)
    } else {
      input.select()
    }
  }, [initialValue, selectWithoutExtension])

  const finish = useCallback(() => {
    if (doneRef.current) return
    doneRef.current = true
    const trimmed = value.trim()
    if (trimmed && (allowUnchanged || trimmed !== initialValue)) {
      onSubmit(trimmed)
    } else {
      onCancel()
    }
  }, [value, initialValue, allowUnchanged, onSubmit, onCancel])

  return (
    <input
      ref={inputRef}
      value={value}
      onChange={(e) => setValue(e.target.value)}
      onKeyDown={(e) => {
        if (e.key === 'Enter') {
          e.preventDefault()
          finish()
        } else if (e.key === 'Escape') {
          e.preventDefault()
          doneRef.current = true
          onCancel()
        }
      }}
      onBlur={finish}
      placeholder={placeholder}
      style={inlineInputStyle}
    />
  )
}

interface TreeNodeProps {
  node: NoteFile
  level: number
  expandedDirs: Set<string>
  toggleExpand: (node: NoteFile) => void
  currentFile: NoteFile | null
  onOpenFile: (node: NoteFile) => void
  onContextMenu: (e: ReactMouseEvent, node: NoteFile) => void
  renamingPath: string | null
  onRenameSubmit: (node: NoteFile, newName: string) => void
  onRenameCancel: () => void
  onDragStart: (e: ReactDragEvent, node: NoteFile) => void
  onDragOver: (e: ReactDragEvent, node: NoteFile) => void
  onDragLeave: (e: ReactDragEvent, node: NoteFile) => void
  onDrop: (e: ReactDragEvent, node: NoteFile) => void
  dragOverPath: string | null
  creating: CreatingState | null
  onCreateSubmit: (name: string) => void
  onCreateCancel: () => void
  extensionIconMap: Map<string, string>
}

function TreeNode({
  node,
  level,
  expandedDirs,
  toggleExpand,
  currentFile,
  onOpenFile,
  onContextMenu,
  renamingPath,
  onRenameSubmit,
  onRenameCancel,
  onDragStart,
  onDragOver,
  onDragLeave,
  onDrop,
  dragOverPath,
  creating,
  onCreateSubmit,
  onCreateCancel,
  extensionIconMap
}: TreeNodeProps) {
  const isDir = node.type === 'directory'
  const isExpanded = expandedDirs.has(node.path)
  const isSelected = currentFile?.path === node.path
  const isRenaming = renamingPath === node.path
  const isDragOver = dragOverPath === node.path
  const showCreating =
    !!creating && creating.parentPath === node.path && isDir && isExpanded

  const handleClick = () => {
    if (isRenaming) return
    if (isDir) {
      toggleExpand(node)
    } else {
      onOpenFile(node)
    }
  }

  return (
    <>
      <div
        className={`tree-node${isSelected ? ' selected' : ''}`}
        style={{
          paddingLeft: level * 12 + 8,
          background: isDragOver ? 'var(--bg-active)' : undefined
        }}
        onClick={handleClick}
        onContextMenu={(e) => onContextMenu(e, node)}
        draggable={!isRenaming}
        onDragStart={(e) => onDragStart(e, node)}
        onDragOver={(e) => onDragOver(e, node)}
        onDragLeave={(e) => onDragLeave(e, node)}
        onDrop={(e) => onDrop(e, node)}
      >
        <span className="tree-chevron">
          {isDir ? (
            isExpanded ? (
              <ChevronDown size={14} />
            ) : (
              <ChevronRight size={14} />
            )
          ) : null}
        </span>
        <span className="tree-icon">
          {isDir ? (
            isExpanded ? (
              <FolderOpen size={16} />
            ) : (
              <Folder size={16} />
            )
          ) : extensionIconMap.has(getExtension(node.name)) ? (
            <PluginIconRenderer icon={extensionIconMap.get(getExtension(node.name))} size={16} />
          ) : (
            <BuiltinFormatIcon format={node.format || 'plaintext'} size={16} />
          )}
        </span>
        {isRenaming ? (
          <InlineEditInput
            initialValue={node.name}
            onSubmit={(newName) => onRenameSubmit(node, newName)}
            onCancel={onRenameCancel}
          />
        ) : (
          <span className="tree-label">{node.name}</span>
        )}
      </div>

      {isDir && isExpanded && (
        <div className="tree-children">
          {showCreating && (
            <div
              className="tree-node"
              style={{ paddingLeft: (level + 1) * 12 + 8, background: 'var(--bg-hover)' }}
            >
              <span className="tree-chevron" />
              <span className="tree-icon">
                {creating!.isDir ? (
                  <Folder size={16} />
                ) : creating!.icon ? (
                  <PluginIconRenderer icon={creating!.icon} size={16} />
                ) : (
                  <FileText size={16} />
                )}
              </span>
              <InlineEditInput
                initialValue={creating!.initialName || ''}
                allowUnchanged={!!creating!.initialName}
                selectWithoutExtension={!creating!.isDir}
                placeholder={creating!.isDir ? 'folder name' : 'note name'}
                onSubmit={onCreateSubmit}
                onCancel={onCreateCancel}
              />
            </div>
          )}
          {node.children?.map((child) => (
            <TreeNode
              key={child.id}
              node={child}
              level={level + 1}
              expandedDirs={expandedDirs}
              toggleExpand={toggleExpand}
              currentFile={currentFile}
              onOpenFile={onOpenFile}
              onContextMenu={onContextMenu}
              renamingPath={renamingPath}
              onRenameSubmit={onRenameSubmit}
              onRenameCancel={onRenameCancel}
              onDragStart={onDragStart}
              onDragOver={onDragOver}
              onDragLeave={onDragLeave}
              onDrop={onDrop}
              dragOverPath={dragOverPath}
              creating={creating}
              onCreateSubmit={onCreateSubmit}
              onCreateCancel={onCreateCancel}
              extensionIconMap={extensionIconMap}
            />
          ))}
        </div>
      )}
    </>
  )
}

export function Sidebar({ onCollapse }: { onCollapse?: () => void }) {
  const tree = useFileStore((s) => s.tree)
  const currentFile = useFileStore((s) => s.currentFile)
  const openFile = useFileStore((s) => s.openFile)
  const createFile = useFileStore((s) => s.createFile)
  const deleteFile = useFileStore((s) => s.deleteFile)
  const renameFile = useFileStore((s) => s.renameFile)
  const moveFile = useFileStore((s) => s.moveFile)
  const loadTree = useFileStore((s) => s.loadTree)
  const openFolder = useFileStore((s) => s.openFolder)
  const reloadCurrent = useFileStore((s) => s.reloadCurrent)

  const plugins = usePluginStore((s) => s.plugins)

  const [expandedDirs, setExpandedDirs] = useState<Set<string>>(new Set())
  const [contextMenu, setContextMenu] = useState<ContextMenuState | null>(null)
  const [renamingPath, setRenamingPath] = useState<string | null>(null)
  const [creating, setCreating] = useState<CreatingState | null>(null)
  const [dragOverPath, setDragOverPath] = useState<string | null>(null)
  const draggingPathRef = useRef<string | null>(null)
  const [showNewFileMenu, setShowNewFileMenu] = useState(false)
  const [historyFile, setHistoryFile] = useState<NoteFile | null>(null)
  const [dropdownPos, setDropdownPos] = useState<{ top: number; left: number }>({ top: 0, left: 0 })
  const [contextNewFileSubmenuOpen, setContextNewFileSubmenuOpen] = useState(false)
  // Both the toolbar and the empty-state show a "New File" button.
  // Whichever the user clicks becomes the anchor for positioning +
  // outside-click detection; the ref updates on each open. Attribute
  // `data-new-file-anchor` marks any element that should NOT count as
  // an outside click.
  const newFileAnchorRef = useRef<HTMLElement | null>(null)

  /**
   * "New File" dropdown entries. Data-driven from active format plugins —
   * one entry per plugin (its primaryExtension, defaulting to
   * extensions[0]). All other aliases the plugin declares stay bound in
   * the tree / file open path; they just don't clutter the picker.
   */
  const fileTypes = useMemo<FileTypeOption[]>(() => {
    const result: FileTypeOption[] = []
    const seenExtensions = new Set<string>()

    for (const plugin of plugins) {
      if (plugin.type !== 'format' || plugin.status !== 'active') continue
      const extList = plugin.extensions ?? []
      if (extList.length === 0) continue
      const primary = (plugin.primaryExtension ?? extList[0])
        .toLowerCase()
        .replace(/^\./, '')
      if (!primary || seenExtensions.has(primary)) continue
      seenExtensions.add(primary)
      result.push({
        format: primary,
        label: plugin.name,
        extension: primary,
        icon: plugin.fileIcon ?? plugin.icon
      })
    }
    return result
  }, [plugins])

  /** Maps file extension → icon (file:// URL or lucide name) for tree node icons. */
  const extensionIconMap = useMemo<Map<string, string>>(() => {
    const map = new Map<string, string>()
    for (const plugin of plugins) {
      if (plugin.type !== 'format' || !plugin.extensions) continue
      const iconValue = plugin.fileIcon ?? plugin.icon
      if (!iconValue) continue
      for (const ext of plugin.extensions) {
        map.set(ext.toLowerCase().replace(/^\./, ''), iconValue)
      }
    }
    return map
  }, [plugins])

  // Close the New File dropdown on outside click. Clicks inside any
  // anchor-tagged button (there are two — toolbar + empty state) or
  // inside the dropdown itself are treated as "inside".
  useEffect(() => {
    if (!showNewFileMenu) return
    const close = (e: globalThis.MouseEvent) => {
      const target = e.target as HTMLElement | null
      if (!target) return
      if (target.closest('[data-new-file-anchor]')) return
      if (target.closest('.new-file-dropdown')) return
      setShowNewFileMenu(false)
    }
    window.addEventListener('click', close)
    return () => window.removeEventListener('click', close)
  }, [showNewFileMenu])

  // ---------- expand / collapse ----------
  const toggleExpand = useCallback((node: NoteFile) => {
    if (node.type !== 'directory') return
    setExpandedDirs((prev) => {
      const next = new Set(prev)
      if (next.has(node.path)) {
        next.delete(node.path)
      } else {
        next.add(node.path)
      }
      return next
    })
  }, [])

  // ---------- creation ----------
  const handleNewFile = useCallback((e: React.MouseEvent<HTMLElement>) => {
    // Anchor the dropdown to whichever button was clicked (toolbar or
    // empty-state). Using event.currentTarget keeps the two entry
    // points in sync without threading refs.
    const anchor = e.currentTarget
    newFileAnchorRef.current = anchor

    // Fallback path: if the user removed every format plugin, we don't
    // want a blank dropdown — just create a plain `.txt` file directly.
    // Plaintext survives without any active plugin (Editor.tsx routes
    // unknown extensions to a raw textarea).
    if (fileTypes.length === 0) {
      setShowNewFileMenu(false)
      setCreating({
        parentPath: '',
        isDir: false,
        initialName: 'Untitled.txt',
        extension: 'txt'
      })
      return
    }

    const rect = anchor.getBoundingClientRect()
    setDropdownPos({ top: rect.bottom + 4, left: rect.left })
    setShowNewFileMenu((prev) => !prev)
  }, [fileTypes.length])

  const handleNewFileWithType = useCallback(
    (fileType: FileTypeOption) => {
      setShowNewFileMenu(false)
      setCreating({
        parentPath: '',
        isDir: false,
        initialName: `Untitled.${fileType.extension}`,
        icon: fileType.icon,
        extension: fileType.extension
      })
    },
    []
  )

  const handleNewDirectory = useCallback(() => {
    setCreating({ parentPath: '', isDir: true })
  }, [])

  const startCreatingInDir = useCallback((dirPath: string, isDir: boolean) => {
    setExpandedDirs((prev) => {
      const next = new Set(prev)
      next.add(dirPath)
      return next
    })
    setCreating({ parentPath: dirPath, isDir })
  }, [])

  const handleCreateSubmit = useCallback(
    async (name: string) => {
      if (!creating) return
      const { parentPath, isDir, extension } = creating
      setCreating(null)

      // Auto-append extension if the user didn't type one
      let finalName = name.trim()
      if (!isDir && extension) {
        const hasExtension = finalName.toLowerCase().endsWith(`.${extension.toLowerCase()}`)
        if (!hasExtension) {
          finalName = `${finalName}.${extension}`
        }
      }

      const filePath = parentPath ? `${parentPath}/${finalName}` : finalName

      try {
        await createFile(parentPath, finalName, isDir)
        // If it's a file, open it in the editor
        if (!isDir) {
          // Build a NoteFile object for the newly created file
          const format = extension || 'plaintext'
          const newFile = {
            id: filePath,
            name: finalName,
            path: filePath,
            type: 'file' as const,
            format: format as NoteFormat,
            createdAt: Date.now(),
            updatedAt: Date.now()
          }
          await openFile(newFile)
        }
      } catch (err) {
        console.error('Failed to create:', err)
      }
    },
    [creating, createFile, openFile]
  )

  const handleCreateCancel = useCallback(() => {
    setCreating(null)
  }, [])

  // ---------- rename ----------
  const handleRenameSubmit = useCallback(
    async (node: NoteFile, newName: string) => {
      setRenamingPath(null)
      try {
        await renameFile(node.path, newName)
      } catch (err) {
        console.error('Failed to rename:', err)
      }
    },
    [renameFile]
  )

  const handleRenameCancel = useCallback(() => {
    setRenamingPath(null)
  }, [])

  // ---------- context menu ----------
  const handleContextMenu = useCallback((e: ReactMouseEvent, node: NoteFile) => {
    e.preventDefault()
    e.stopPropagation()
    setContextMenu({ x: e.clientX, y: e.clientY, node })
  }, [])

  const handleContextNewFileWithType = useCallback(
    (node: NoteFile, fileType: FileTypeOption) => {
      setContextMenu(null)
      setContextNewFileSubmenuOpen(false)
      const parentPath =
        node.type === 'file'
          ? node.path.substring(0, node.path.lastIndexOf('/'))
          : node.path
      if (parentPath) {
        setExpandedDirs((prev) => {
          const next = new Set(prev)
          next.add(parentPath)
          return next
        })
      }
      setCreating({
        parentPath,
        isDir: false,
        initialName: `Untitled.${fileType.extension}`,
        icon: fileType.icon,
        extension: fileType.extension
      })
    },
    []
  )

  const handleContextNewFolder = useCallback(
    (node: NoteFile) => {
      setContextMenu(null)
      const parentPath = node.type === 'file'
        ? node.path.substring(0, node.path.lastIndexOf('/'))
        : node.path
      startCreatingInDir(parentPath, true)
    },
    [startCreatingInDir]
  )

  const handleContextRename = useCallback((node: NoteFile) => {
    setContextMenu(null)
    setRenamingPath(node.path)
  }, [])

  const handleOpenExternal = useCallback(async (node: NoteFile) => {
    setContextMenu(null)
    try {
      await window.flux.file.openExternal(node.path)
    } catch (err) {
      console.error('Failed to open externally:', err)
    }
  }, [])

  const handleRevealInFolder = useCallback(async (node: NoteFile) => {
    setContextMenu(null)
    try {
      await window.flux.file.revealInFolder(node.path)
    } catch (err) {
      console.error('Failed to reveal in folder:', err)
    }
  }, [])

  const handleShowHistory = useCallback((node: NoteFile) => {
    setContextMenu(null)
    setHistoryFile(node)
  }, [])

  const handleContextDelete = useCallback(
    async (node: NoteFile) => {
      setContextMenu(null)
      try {
        await deleteFile(node.path)
      } catch (err) {
        console.error('Failed to delete:', err)
      }
    },
    [deleteFile]
  )

  // Close the context menu (and its submenu) on any window click.
  useEffect(() => {
    if (!contextMenu) {
      setContextNewFileSubmenuOpen(false)
      return
    }
    const close = () => {
      setContextMenu(null)
      setContextNewFileSubmenuOpen(false)
    }
    window.addEventListener('click', close)
    return () => window.removeEventListener('click', close)
  }, [contextMenu])

  // ---------- drag & drop ----------
  const handleDragStart = useCallback((e: ReactDragEvent, node: NoteFile) => {
    e.dataTransfer.setData('text/plain', node.path)
    e.dataTransfer.effectAllowed = 'move'
    draggingPathRef.current = node.path
  }, [])

  const handleDragOver = useCallback((e: ReactDragEvent, node: NoteFile) => {
    if (node.type !== 'directory') return
    const sourcePath = draggingPathRef.current
    if (!sourcePath || isDescendantOrSelf(sourcePath, node.path)) return
    e.preventDefault()
    e.dataTransfer.dropEffect = 'move'
    setDragOverPath(node.path)
  }, [])

  const handleDragLeave = useCallback((e: ReactDragEvent, node: NoteFile) => {
    const related = e.relatedTarget as Node | null
    if (related && e.currentTarget.contains(related)) return
    setDragOverPath((prev) => (prev === node.path ? null : prev))
  }, [])

  const handleDrop = useCallback(
    async (e: ReactDragEvent, node: NoteFile) => {
      if (node.type !== 'directory') return
      e.preventDefault()
      e.stopPropagation()
      setDragOverPath(null)
      const sourcePath =
        draggingPathRef.current || e.dataTransfer.getData('text/plain')
      if (!sourcePath) return
      if (isDescendantOrSelf(sourcePath, node.path)) {
        draggingPathRef.current = null
        return
      }
      // Skip if the file is already a direct child of the target directory.
      const lastSlash = sourcePath.lastIndexOf('/')
      const sourceParent = lastSlash >= 0 ? sourcePath.substring(0, lastSlash) : ''
      if (sourceParent === node.path) {
        draggingPathRef.current = null
        return
      }
      try {
        await moveFile(sourcePath, node.path)
      } catch (err) {
        console.error('Failed to move file:', err)
      }
      draggingPathRef.current = null
    },
    [moveFile]
  )

  // ---------- 'tree:rename' custom event ----------
  useEffect(() => {
    const handleRenameEvent = (e: Event) => {
      const detail = (e as CustomEvent).detail as
        | { path?: string; node?: NoteFile }
        | undefined
      let path: string | undefined
      if (detail) {
        path = detail.path ?? detail.node?.path
      }
      if (path) {
        // Expand the parent directory so the target node is visible.
        const lastSlash = path.lastIndexOf('/')
        const parentPath = lastSlash >= 0 ? path.substring(0, lastSlash) : ''
        if (parentPath) {
          setExpandedDirs((prev) => {
            const next = new Set(prev)
            next.add(parentPath)
            return next
          })
        }
        setRenamingPath(path)
      }
    }
    window.addEventListener('tree:rename', handleRenameEvent as EventListener)
    return () =>
      window.removeEventListener('tree:rename', handleRenameEvent as EventListener)
  }, [])

  const isEmpty = !tree || tree.length === 0

  return (
    <div className="sidebar">
      {/* Header */}
      <div className="sidebar-header">
        <span className="sidebar-header-title">Explorer</span>
        <div className="sidebar-actions">
          <div style={{ position: 'relative' }}>
            <button
              className="sidebar-action-btn tooltip"
              data-tooltip="New File"
              data-new-file-anchor="toolbar"
              onClick={handleNewFile}
              type="button"
            >
              <FilePlus size={16} strokeWidth={1.8} />
            </button>
            {showNewFileMenu && (
              <div
                className="new-file-dropdown"
                style={{ top: dropdownPos.top, left: dropdownPos.left }}
              >
                <div className="new-file-dropdown-header">
                  <FileType size={13} />
                  <span>New File Type</span>
                </div>
                {fileTypes.map((ft) => (
                  <button
                    key={`${ft.format}-${ft.extension}`}
                    className="new-file-dropdown-item"
                    onClick={() => handleNewFileWithType(ft)}
                    type="button"
                  >
                    <span className="new-file-dropdown-icon">
                      {ft.icon ? (
                        <PluginIconRenderer icon={ft.icon} size={16} />
                      ) : (
                        <BuiltinFormatIcon format={ft.format} size={16} />
                      )}
                    </span>
                    <span className="new-file-dropdown-label">{ft.label}</span>
                    <span className="new-file-dropdown-ext">.{ft.extension}</span>
                  </button>
                ))}
              </div>
            )}
          </div>
          <button
            className="sidebar-action-btn tooltip"
            data-tooltip="New Folder"
            onClick={handleNewDirectory}
            type="button"
          >
            <FolderPlus size={16} strokeWidth={1.8} />
          </button>
          <button
            className="sidebar-action-btn tooltip"
            data-tooltip="Open Folder"
            onClick={() => openFolder()}
            type="button"
          >
            <FolderOpenIcon size={16} strokeWidth={1.8} />
          </button>
          <button
            className="sidebar-action-btn tooltip"
            data-tooltip="Refresh"
            onClick={loadTree}
            type="button"
          >
            <RefreshCw size={15} strokeWidth={1.8} />
          </button>
          <button
            className="sidebar-action-btn tooltip"
            data-tooltip="Collapse Explorer"
            onClick={onCollapse}
            type="button"
          >
            <PanelLeftClose size={16} strokeWidth={1.8} />
          </button>
        </div>
      </div>

      {/* Tree */}
      <div
        className="sidebar-tree"
        onContextMenu={(e) => {
          // Right-click on empty area → create at root level
          if (e.target === e.currentTarget) {
            e.preventDefault()
            setContextMenu({ x: e.clientX, y: e.clientY, node: { type: 'directory', path: '', name: '', id: '__root__', createdAt: 0, updatedAt: 0 } })
          }
        }}
      >
        {/* Creating input — shown in both empty and non-empty states */}
        {creating && creating.parentPath === '' && (
          <div
            className="tree-node"
            style={{ paddingLeft: 8, background: 'var(--bg-hover)' }}
          >
            <span className="tree-chevron" />
            <span className="tree-icon">
                {creating.isDir ? (
                  <Folder size={16} />
                ) : creating.icon ? (
                  <PluginIconRenderer icon={creating.icon} size={16} />
                ) : (
                  <FileText size={16} />
                )}
              </span>
              <InlineEditInput
                initialValue={creating.initialName || ''}
                allowUnchanged={!!creating.initialName}
                selectWithoutExtension={!creating.isDir}
                placeholder={creating.isDir ? 'folder name' : 'note name'}
                onSubmit={handleCreateSubmit}
                onCancel={handleCreateCancel}
              />
          </div>
        )}

        {isEmpty ? (
          <div className="empty-state">
            <FileText size={32} style={{ color: 'var(--text-disabled)' }} />
            <div>No files yet</div>
            <div style={{ position: 'relative' }}>
              <button
                className="btn btn-primary"
                onClick={handleNewFile}
                data-new-file-anchor="empty-state"
                type="button"
                style={{ gap: 6 }}
              >
                <Plus size={14} /> New File
              </button>
              {showNewFileMenu && (
                <div
                  className="new-file-dropdown"
                  style={{ top: dropdownPos.top, left: dropdownPos.left }}
                >
                  <div className="new-file-dropdown-header">
                    <FileType size={13} />
                    <span>New File Type</span>
                  </div>
                  {fileTypes.map((ft) => (
                    <button
                      key={`${ft.format}-${ft.extension}`}
                      className="new-file-dropdown-item"
                      onClick={(e) => {
                        e.stopPropagation()
                        handleNewFileWithType(ft)
                      }}
                      type="button"
                    >
                      <span className="new-file-dropdown-icon">
                        {ft.icon ? (
                          <PluginIconRenderer icon={ft.icon} size={16} />
                        ) : (
                          <BuiltinFormatIcon format={ft.format} size={16} />
                        )}
                      </span>
                      <span className="new-file-dropdown-label">{ft.label}</span>
                      <span className="new-file-dropdown-ext">.{ft.extension}</span>
                    </button>
                  ))}
                </div>
              )}
            </div>
          </div>
        ) : (
          <>
            {tree.map((child) => (
              <TreeNode
                key={child.id}
                node={child}
                level={0}
                expandedDirs={expandedDirs}
                toggleExpand={toggleExpand}
                currentFile={currentFile}
                onOpenFile={openFile}
                onContextMenu={handleContextMenu}
                renamingPath={renamingPath}
                onRenameSubmit={handleRenameSubmit}
                onRenameCancel={handleRenameCancel}
                onDragStart={handleDragStart}
                onDragOver={handleDragOver}
                onDragLeave={handleDragLeave}
                onDrop={handleDrop}
                dragOverPath={dragOverPath}
                creating={creating}
                onCreateSubmit={handleCreateSubmit}
                onCreateCancel={handleCreateCancel}
                extensionIconMap={extensionIconMap}
              />
            ))}
          </>
        )}
      </div>

      {/* Context menu */}
      {contextMenu && (
        <div
          className="context-menu"
          style={{ left: contextMenu.x, top: contextMenu.y }}
        >
          {/* New File — with file-type submenu when plugins are active */}
          <div
            className={`context-menu-item${fileTypes.length > 0 ? ' has-submenu' : ''}`}
            onMouseEnter={() => fileTypes.length > 0 && setContextNewFileSubmenuOpen(true)}
            onMouseLeave={() => setContextNewFileSubmenuOpen(false)}
            onClick={() => {
              if (fileTypes.length === 0) {
                // No plugins — create a plain .txt directly.
                const n = contextMenu.node
                const parentPath =
                  n.type === 'file'
                    ? n.path.substring(0, n.path.lastIndexOf('/'))
                    : n.path
                if (parentPath) {
                  setExpandedDirs((prev) => {
                    const next = new Set(prev)
                    next.add(parentPath)
                    return next
                  })
                }
                setContextMenu(null)
                setCreating({ parentPath, isDir: false, initialName: 'Untitled.txt', extension: 'txt' })
              }
              // else: submenu handles the type selection
            }}
          >
            <FilePlus size={14} />
            <span>New File</span>
            {fileTypes.length > 0 && (
              <ChevronRight size={12} style={{ marginLeft: 'auto', opacity: 0.45 }} />
            )}
            {contextNewFileSubmenuOpen && fileTypes.length > 0 && (
              <div
                className="context-submenu"
                onClick={(e) => e.stopPropagation()}
              >
                {fileTypes.map((ft) => (
                  <div
                    key={ft.extension}
                    className="context-menu-item"
                    onClick={(e) => {
                      e.stopPropagation()
                      handleContextNewFileWithType(contextMenu.node, ft)
                    }}
                  >
                    <span className="context-submenu-icon">
                      {ft.icon ? (
                        <PluginIconRenderer icon={ft.icon} size={14} />
                      ) : (
                        <BuiltinFormatIcon format={ft.format} size={14} />
                      )}
                    </span>
                    <span style={{ flex: 1 }}>{ft.label}</span>
                    <span className="context-submenu-ext">.{ft.extension}</span>
                  </div>
                ))}
              </div>
            )}
          </div>

          <div
            className="context-menu-item"
            onClick={() => handleContextNewFolder(contextMenu.node)}
          >
            <FolderPlus size={14} /> New Folder
          </div>
          <div className="context-menu-divider" />

          {contextMenu.node.type !== 'directory' && (
            <div
              className="context-menu-item"
              onClick={() => handleContextRename(contextMenu.node)}
            >
              <Pencil size={14} /> Rename
            </div>
          )}
          {contextMenu.node.type === 'directory' && contextMenu.node.id !== '__root__' && (
            <div
              className="context-menu-item"
              onClick={() => handleContextRename(contextMenu.node)}
            >
              <Pencil size={14} /> Rename
            </div>
          )}
          <div
            className="context-menu-item"
            onClick={() => handleOpenExternal(contextMenu.node)}
          >
            <ExternalLink size={14} /> Open Externally
          </div>
          {contextMenu.node.type === 'file' && (
            <div
              className="context-menu-item"
              onClick={() => handleShowHistory(contextMenu.node)}
            >
              <HistoryIcon size={14} /> History
            </div>
          )}
          {contextMenu.node.id !== '__root__' && (
            <div
              className="context-menu-item"
              onClick={() => handleRevealInFolder(contextMenu.node)}
            >
              <FolderOpenIcon size={14} /> {getRevealInFolderLabel()}
            </div>
          )}
          {contextMenu.node.id !== '__root__' && (
            <>
              <div className="context-menu-divider" />
              <div
                className="context-menu-item danger"
                onClick={() => handleContextDelete(contextMenu.node)}
              >
                <Trash2 size={14} /> Delete
              </div>
            </>
          )}
        </div>
      )}

      {historyFile && (
        <FileHistoryDialog
          file={historyFile}
          onClose={() => setHistoryFile(null)}
          onRestored={async () => {
            if (currentFile?.path === historyFile.path) {
              await reloadCurrent()
              window.dispatchEvent(new CustomEvent('flux:force-editor-remount'))
            }
          }}
        />
      )}
    </div>
  )
}
