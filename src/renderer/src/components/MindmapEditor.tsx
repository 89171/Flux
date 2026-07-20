/**
 * MindmapEditor — Mind-Elixir-backed built-in renderer.
 *
 * File format: JSON matching MindElixir's MindElixirData shape, or a
 * Markdown outline. JSON preserves per-node layout metadata; Markdown is
 * easier to edit as source and can be toggled into the visual mind map.
 *
 * If the file's first parse fails we fall back to a fresh "Central
 * Topic" tree so users never see a broken canvas.
 */

import { useCallback, useEffect, useMemo, useRef, useState, type CSSProperties } from 'react'
import { Code, GitBranch } from 'lucide-react'
import MindElixir, {
  type MindElixirData,
  type MindElixirInstance,
  type NodeObj,
  type Options
} from 'mind-elixir'
import CodeMirrorEditor from './CodeMirrorEditor'

export interface MindmapEditorProps {
  value: string
  onChange: (data: string) => void
  className?: string
  onReady?: (handle: MindmapEditorHandle | null) => void
}

export interface MindmapEditorHandle {
  fit: () => void
  exportPng: () => Promise<Blob | null>
}

let uidCounter = 0
const newUid = (): string => `me-${Date.now().toString(36)}-${(++uidCounter).toString(36)}`
type SourceFormat = 'json' | 'markdown'
type ViewMode = 'mindmap' | 'markdown'

interface ParsedMindmapFile {
  data: MindElixirData
  format: SourceFormat
  markdown: string
}

function indentDepth(line: string): number {
  let n = 0
  for (const ch of line) {
    if (ch === '\t') n += 2
    else if (ch === ' ') n++
    else break
  }
  return n
}

function cleanTopic(raw: string): string {
  return raw
    .trim()
    .replace(/^\[[ xX]]\s+/, '')
    .replace(/!\[([^\]]*)]\([^)]+\)/g, '$1')
    .replace(/\[([^\]]+)]\([^)]+\)/g, '$1')
    .replace(/`([^`]+)`/g, '$1')
    .replace(/\*\*([^*]+)\*\*/g, '$1')
    .replace(/__([^_]+)__/g, '$1')
    .replace(/\*([^*]+)\*/g, '$1')
    .replace(/_([^_]+)_/g, '$1')
    .trim() || 'Untitled'
}

function markdownToNode(raw: string): NodeObj {
  const entries: Array<{ depth: number; topic: string }> = []
  let hasHeading = false
  let currentHeadingDepth = 0
  let inFence = false

  for (const line of raw.split('\n')) {
    const trimmed = line.trim()
    if (!trimmed) continue
    if (/^(```|~~~)/.test(trimmed)) {
      inFence = !inFence
      continue
    }
    if (inFence) continue

    const heading = trimmed.match(/^(#{1,6})\s+(.+?)\s*#*$/)
    if (heading) {
      const depth = heading[1].length - 1
      entries.push({ depth, topic: cleanTopic(heading[2]) })
      hasHeading = true
      currentHeadingDepth = depth
      continue
    }

    const list = line.match(/^(\s*)([-*+]|\d+[.)])\s+(.+)$/)
    if (list) {
      const indentLevel = Math.floor(indentDepth(list[1]) / 2)
      const depth = hasHeading ? currentHeadingDepth + 1 + indentLevel : indentLevel
      entries.push({ depth, topic: cleanTopic(list[3]) })
      continue
    }

    const depth = hasHeading ? currentHeadingDepth + 1 : indentDepth(line)
    entries.push({ depth, topic: cleanTopic(trimmed) })
  }

  if (entries.length === 0) {
    return { id: newUid(), topic: 'Central Topic' }
  }

  const rootDepth = entries[0].depth
  const root: NodeObj = { id: newUid(), topic: entries[0].topic, children: [] }
  const stack: Array<{ node: NodeObj; depth: number }> = [{ node: root, depth: rootDepth }]
  for (let i = 1; i < entries.length; i++) {
    const entry = entries[i]
    const depth = entry.depth <= rootDepth ? rootDepth + 1 : entry.depth
    const node: NodeObj = { id: newUid(), topic: entry.topic, children: [] }
    while (stack.length > 1 && stack[stack.length - 1].depth >= depth) {
      stack.pop()
    }
    const parent = stack[stack.length - 1].node
    parent.children = parent.children || []
    parent.children.push(node)
    stack.push({ node, depth })
  }
  return root
}

function looksLikeMarkdownOutline(raw: string): boolean {
  return raw
    .split('\n')
    .some((line) => /^(#{1,6})\s+/.test(line.trim()) || /^\s*([-*+]|\d+[.)])\s+/.test(line))
}

/**
 * Parse on-disk string. Accepts:
 *  - JSON starting with `{` (new format — direction + full nodeData)
 *  - Markdown headings/lists
 *  - Plain indented outline
 */
function parseFileData(raw: string): ParsedMindmapFile {
  const trimmed = (raw ?? '').trim()
  if (trimmed.startsWith('{')) {
    try {
      const parsed = JSON.parse(trimmed) as Partial<MindElixirData>
      if (parsed.nodeData && typeof parsed.nodeData === 'object' && !Array.isArray(parsed.nodeData)) {
        const data = {
          nodeData: parsed.nodeData as NodeObj,
          direction: typeof parsed.direction === 'number' ? parsed.direction : MindElixir.RIGHT,
          arrows: parsed.arrows,
          summaries: parsed.summaries,
          theme: parsed.theme
        }
        return {
          data,
          format: 'json',
          markdown: dataToMarkdown(data)
        }
      }
    } catch {
      // fall through to Markdown parsing
    }
  }
  const data = { nodeData: markdownToNode(raw), direction: MindElixir.RIGHT }
  return {
    data,
    format: 'markdown',
    markdown: trimmed && looksLikeMarkdownOutline(trimmed) ? trimmed : dataToMarkdown(data)
  }
}

/**
 * Serialize MindElixirData to JSON, stripping the in-memory circular
 * `parent` back-references Mind-Elixir adds to each NodeObj.
 */
function serializeData(data: MindElixirData): string {
  return JSON.stringify(
    data,
    (key, value) => (key === 'parent' ? undefined : value),
    2
  )
}

function topicToMarkdownText(topic: unknown): string {
  return String(topic || 'Untitled').replace(/\s+/g, ' ').trim() || 'Untitled'
}

function nodeToMarkdownLines(node: NodeObj, depth = 0, lines: string[] = []): string[] {
  const headingLevel = depth + 1
  const topic = topicToMarkdownText(node.topic)
  if (headingLevel <= 6) {
    lines.push(`${'#'.repeat(headingLevel)} ${topic}`)
  } else {
    lines.push(`${'  '.repeat(headingLevel - 7)}- ${topic}`)
  }

  for (const child of node.children ?? []) {
    nodeToMarkdownLines(child, depth + 1, lines)
  }
  return lines
}

function dataToMarkdown(data: MindElixirData): string {
  return `${nodeToMarkdownLines(data.nodeData).join('\n')}\n`
}

function serializeForFormat(data: MindElixirData, format: SourceFormat): string {
  return format === 'markdown' ? dataToMarkdown(data) : serializeData(data)
}

export function MindmapEditor({
  value,
  onChange,
  className,
  onReady
}: MindmapEditorProps): JSX.Element {
  const containerRef = useRef<HTMLDivElement>(null)
  const instanceRef = useRef<MindElixirInstance | null>(null)
  const onChangeRef = useRef(onChange)
  onChangeRef.current = onChange
  const lastSerialisedRef = useRef<string>('')
  const lastDirectionRef = useRef<number>(MindElixir.RIGHT)
  const sourceFormatRef = useRef<SourceFormat>('json')
  const [viewMode, setViewMode] = useState<ViewMode>('mindmap')

  // Compute the initial data structure once per mount — parent uses
  // key={filePath} on this component, so a file switch remounts us
  // with fresh `value` and no state carries over.
  const initialFile = useMemo<ParsedMindmapFile>(() => {
    return parseFileData(value)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])
  const [mindmapData, setMindmapData] = useState<MindElixirData>(initialFile.data)
  const [markdownSource, setMarkdownSource] = useState(initialFile.markdown)
  const latestDataRef = useRef<MindElixirData>(initialFile.data)

  useEffect(() => {
    sourceFormatRef.current = initialFile.format
    lastSerialisedRef.current = serializeForFormat(initialFile.data, initialFile.format)
    latestDataRef.current = initialFile.data
  }, [initialFile])

  const handleMarkdownChange = useCallback((next: string) => {
    sourceFormatRef.current = 'markdown'
    setMarkdownSource(next)
    const parsed = parseFileData(next)
    latestDataRef.current = parsed.data
    setMindmapData(parsed.data)
    lastSerialisedRef.current = next
    onChangeRef.current(next)
  }, [])

  useEffect(() => {
    if (viewMode !== 'mindmap') {
      onReady?.(null)
      return
    }

    const el = containerRef.current
    if (!el) return

    const currentData = latestDataRef.current
    const direction = currentData.direction ?? MindElixir.RIGHT
    lastDirectionRef.current = direction

    const getSelectedTopics = () => {
      const inst = instanceRef.current
      if (!inst) return []
      if (inst.currentNode) return [inst.currentNode]
      return inst.currentNodes ? [...inst.currentNodes] : []
    }

    const copySelectedTopics = (): void => {
      const inst = instanceRef.current
      const selected = getSelectedTopics()
      if (!inst || selected.length === 0) return
      inst.waitCopy = selected
    }

    const cutSelectedTopics = (): void => {
      const inst = instanceRef.current
      const selected = getSelectedTopics().filter((topic) => !!topic.nodeObj.parent)
      if (!inst || selected.length === 0) return
      inst.waitCopy = selected
      if (selected.length === 1) {
        void inst.removeNode(selected[0])
      } else {
        void inst.removeNodes(selected)
      }
    }

    const pasteSelectedTopics = (): void => {
      const inst = instanceRef.current
      if (!inst?.currentNode || !inst.waitCopy?.length) return
      if (inst.waitCopy.length === 1) {
        void inst.copyNode(inst.waitCopy[0], inst.currentNode)
      } else {
        void inst.copyNodes(inst.waitCopy, inst.currentNode)
      }
    }

    const options: Options = {
      el,
      direction,
      draggable: true,
      contextMenu: {
        focus: true,
        link: true,
        extend: [
          { name: 'Copy Node', key: 'Ctrl/Cmd+C', onclick: copySelectedTopics },
          { name: 'Cut Node', key: 'Ctrl/Cmd+X', onclick: cutSelectedTopics },
          { name: 'Paste Node', key: 'Ctrl/Cmd+V', onclick: pasteSelectedTopics }
        ]
      },
      toolBar: true,
      keypress: true,
      editable: true,
      allowUndo: true,
      newTopicName: 'New Node'
    }

    const me = new MindElixir(options)
    me.init(currentData)
    instanceRef.current = me

    const handleCanvasDoubleClick = (event: MouseEvent): void => {
      // Mind-Elixir already uses double-click on topics and labels for editing.
      // Only zoom when the blank canvas itself is the event target.
      if (event.button !== 0 || event.target !== me.map) return
      event.preventDefault()
      me.scale(me.scaleVal + me.scaleSensitivity)
    }
    me.map.addEventListener('dblclick', handleCanvasDoubleClick)

    let isDisposed = false
    let fitFrame = 0
    let secondFitFrame = 0

    const fit = (): void => {
      if (isDisposed) return
      try {
        // `layout()` rebuilds node DOM; `refresh()` also redraws link SVGs.
        me.refresh()
        me.scaleFit()
        me.toCenter()
      } catch (err) {
        console.warn('[Mindmap] fit failed:', err)
      }
    }

    const scheduleFit = (): void => {
      fitFrame = requestAnimationFrame(() => {
        secondFitFrame = requestAnimationFrame(fit)
      })
    }

    scheduleFit()
    const fitTimer = window.setTimeout(fit, 250)

    onReady?.({
      fit,
      exportPng: () => me.exportPng()
    })

    // Persist every structural / textual change back to disk. Mind-Elixir
    // fires `operation` for user-driven edits (add, remove, edit topic,
    // move, etc.) but *not* for pure UI events like selection.
    const handleOperation = (): void => {
      try {
        const data = me.getData()
        latestDataRef.current = data
        const serialised = serializeForFormat(data, sourceFormatRef.current)
        if (serialised === lastSerialisedRef.current) return
        lastSerialisedRef.current = serialised
        setMarkdownSource(dataToMarkdown(data))
        onChangeRef.current(serialised)
      } catch (err) {
        console.warn('[Mindmap] serialisation error:', err)
      }
    }
    me.bus.addListener('operation', handleOperation)

    // Detect direction changes from the Mind-Elixir toolbar. Toolbar
    // buttons use 'click' listeners that run AFTER 'mouseup', so we
    // defer the check with setTimeout(0) to read the already-updated
    // me.direction value.
    const checkDirection = (): void => {
      setTimeout(() => {
        const inst = instanceRef.current
        if (!inst) return
        const currentDir = inst.direction
        if (currentDir !== lastDirectionRef.current) {
          lastDirectionRef.current = currentDir
          handleOperation()
        }
      }, 0)
    }
    el.addEventListener('mouseup', checkDirection)

    return () => {
      try {
        isDisposed = true
        if (fitFrame) cancelAnimationFrame(fitFrame)
        if (secondFitFrame) cancelAnimationFrame(secondFitFrame)
        window.clearTimeout(fitTimer)
        onReady?.(null)
        me.bus.removeListener('operation', handleOperation)
        el.removeEventListener('mouseup', checkDirection)
        me.map.removeEventListener('dblclick', handleCanvasDoubleClick)
        me.destroy()
      } catch {
        // best-effort cleanup on unmount
      }
      instanceRef.current = null
    }
  }, [mindmapData, onReady, viewMode])

  return (
    <div
      className={`mindmap-editor-wrapper ${className || ''}`}
      style={{
        width: '100%',
        height: '100%',
        display: 'flex',
        flexDirection: 'column',
        position: 'relative',
        backgroundColor: 'var(--bg-primary)'
      }}
    >
      <div style={toolbarStyle}>
        <span style={toolbarTitleStyle}>Mindmap</span>
        <button
          type="button"
          onClick={() => setViewMode('mindmap')}
          title="思维导图"
          style={{
            ...toolbarBtnStyle,
            background: viewMode === 'mindmap' ? 'var(--bg-active)' : 'transparent',
            color: viewMode === 'mindmap' ? 'var(--text-primary)' : 'var(--text-secondary)'
          }}
        >
          <GitBranch size={13} />
          <span>Mindmap</span>
        </button>
        <button
          type="button"
          onClick={() => setViewMode('markdown')}
          title="Markdown"
          style={{
            ...toolbarBtnStyle,
            background: viewMode === 'markdown' ? 'var(--bg-active)' : 'transparent',
            color: viewMode === 'markdown' ? 'var(--text-primary)' : 'var(--text-secondary)'
          }}
        >
          <Code size={13} />
          <span>Markdown</span>
        </button>
      </div>

      <div style={{ flex: 1, minHeight: 0 }}>
        {viewMode === 'mindmap' ? (
          <div
            ref={containerRef}
            style={{ width: '100%', height: '100%', minHeight: 400 }}
          />
        ) : (
          <CodeMirrorEditor
            value={markdownSource}
            onChange={handleMarkdownChange}
            fileName="mindmap.md"
            fontSize={14}
          />
        )}
      </div>
    </div>
  )
}

const toolbarStyle: CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  gap: 4,
  padding: '6px 12px',
  borderBottom: '1px solid var(--border-light)',
  background: 'var(--bg-secondary)',
  flexShrink: 0
}

const toolbarTitleStyle: CSSProperties = {
  fontSize: 11,
  color: 'var(--text-tertiary)',
  marginRight: 'auto',
  fontFamily: 'var(--font-mono)'
}

const toolbarBtnStyle: CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  gap: 4,
  padding: '4px 8px',
  border: '1px solid var(--border-color)',
  borderRadius: 4,
  background: 'transparent',
  color: 'var(--text-secondary)',
  cursor: 'pointer',
  fontSize: 12,
  fontFamily: 'var(--font-sans)'
}

export default MindmapEditor
