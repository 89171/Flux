/**
 * MindmapEditor — Mind-Elixir-backed built-in renderer.
 *
 * File format: JSON matching MindElixir's MindElixirData shape
 * (`{ nodeData, direction, arrows?, summaries?, theme? }`). This
 * preserves per-node left/right positions and the global direction so
 * the layout survives file close/reopen. Backward-compatible with the
 * old indented outline format — old files are migrated to JSON on the
 * first save. Default direction is RIGHT (向右扩散).
 *
 * If the file's first parse fails we fall back to a fresh "Central
 * Topic" tree so users never see a broken canvas.
 */

import { useEffect, useMemo, useRef } from 'react'
import MindElixir, {
  type MindElixirData,
  type MindElixirInstance,
  type NodeObj,
  type Options
} from 'mind-elixir'

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

function indentDepth(line: string): number {
  let n = 0
  for (const ch of line) {
    if (ch === '\t' || ch === ' ') n++
    else break
  }
  return n
}

function outlineToNode(raw: string): NodeObj {
  const lines = raw.split('\n').filter((l) => l.trim().length > 0)
  if (lines.length === 0) {
    return { id: newUid(), topic: 'Central Topic' }
  }
  const root: NodeObj = { id: newUid(), topic: lines[0].trim(), children: [] }
  const stack: Array<{ node: NodeObj; depth: number }> = [{ node: root, depth: 0 }]
  for (let i = 1; i < lines.length; i++) {
    const depth = indentDepth(lines[i])
    const topic = lines[i].trim()
    const node: NodeObj = { id: newUid(), topic, children: [] }
    while (stack.length > 1 && stack[stack.length - 1].depth >= depth) stack.pop()
    const parent = stack[stack.length - 1].node
    parent.children = parent.children || []
    parent.children.push(node)
    stack.push({ node, depth })
  }
  return root
}

/**
 * Parse on-disk string to MindElixirData. Accepts:
 *  - JSON starting with `{` (new format — direction + full nodeData)
 *  - Plain indented outline (old format — migrated to JSON on first save)
 */
function parseFileData(raw: string): MindElixirData {
  const trimmed = (raw ?? '').trim()
  if (trimmed.startsWith('{')) {
    try {
      const parsed = JSON.parse(trimmed) as Partial<MindElixirData>
      if (parsed.nodeData && typeof parsed.nodeData === 'object' && !Array.isArray(parsed.nodeData)) {
        return {
          nodeData: parsed.nodeData as NodeObj,
          direction: typeof parsed.direction === 'number' ? parsed.direction : MindElixir.RIGHT,
          arrows: parsed.arrows,
          summaries: parsed.summaries,
          theme: parsed.theme
        }
      }
    } catch {
      // fall through to outline parsing
    }
  }
  return { nodeData: outlineToNode(raw), direction: MindElixir.RIGHT }
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

  // Compute the initial data structure once per mount — parent uses
  // key={filePath} on this component, so a file switch remounts us
  // with fresh `value` and no state carries over.
  const initialData = useMemo<MindElixirData>(() => {
    return parseFileData(value)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  useEffect(() => {
    const el = containerRef.current
    if (!el) return

    const direction = initialData.direction ?? MindElixir.RIGHT
    lastDirectionRef.current = direction

    const options: Options = {
      el,
      direction,
      draggable: true,
      contextMenu: true,
      toolBar: true,
      keypress: true,
      editable: true,
      allowUndo: true,
      newTopicName: 'New Node'
    }

    const me = new MindElixir(options)
    me.init(initialData)
    instanceRef.current = me

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
        const serialised = serializeData(data)
        if (serialised === lastSerialisedRef.current) return
        lastSerialisedRef.current = serialised
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
        me.destroy()
      } catch {
        // best-effort cleanup on unmount
      }
      instanceRef.current = null
    }
  }, [initialData, onReady])

  return (
    <div
      className={`mindmap-editor-wrapper ${className || ''}`}
      style={{
        width: '100%',
        height: '100%',
        position: 'relative',
        backgroundColor: 'var(--bg-primary)'
      }}
    >
      <div
        ref={containerRef}
        style={{ width: '100%', height: '100%', minHeight: 400 }}
      />
    </div>
  )
}

export default MindmapEditor
