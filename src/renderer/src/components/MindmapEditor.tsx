/**
 * MindmapEditor — Mind-Elixir-backed built-in renderer.
 *
 * Interface (props: value/onChange/className) is unchanged from the old
 * hand-rolled SVG version, so callers don't care about the swap. The
 * on-disk file format is preserved as an indented plaintext outline
 * (one level per two spaces / tab) — it stays diff-friendly and
 * openable in any text editor. Mind-Elixir's richer JSON structure is
 * only used in memory; the bridge below flattens it back to text.
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
}

let uidCounter = 0
const newUid = (): string => `me-${Date.now().toString(36)}-${(++uidCounter).toString(36)}`

/** Number of leading whitespace characters — tabs and spaces both count. */
function indentDepth(line: string): number {
  let n = 0
  for (const ch of line) {
    if (ch === '\t' || ch === ' ') n++
    else break
  }
  return n
}

/**
 * Parse an indented outline into a Mind-Elixir node tree. Empty / blank
 * input yields a single "Central Topic" root so the canvas is never
 * empty. Ill-shaped input (child before root) is tolerated — anything
 * deeper than the current stack top attaches to the last real parent.
 */
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
 * Serialise a Mind-Elixir node tree back to the indented outline
 * format. Uses two spaces per level to stay portable across editors.
 */
function nodeToOutline(node: NodeObj, depth = 0): string {
  const indent = '  '.repeat(depth)
  let out = `${indent}${node.topic}`
  if (node.children?.length) {
    for (const child of node.children) {
      out += '\n' + nodeToOutline(child, depth + 1)
    }
  }
  return out
}

export function MindmapEditor({
  value,
  onChange,
  className
}: MindmapEditorProps): JSX.Element {
  const containerRef = useRef<HTMLDivElement>(null)
  const instanceRef = useRef<MindElixirInstance | null>(null)
  const onChangeRef = useRef(onChange)
  onChangeRef.current = onChange
  const lastSerialisedRef = useRef<string>('')

  // Compute the initial data structure once per mount — parent uses
  // key={filePath} on this component, so a file switch remounts us
  // with fresh `value` and no state carries over.
  const initialData = useMemo<MindElixirData>(() => {
    return { nodeData: outlineToNode(value) }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  useEffect(() => {
    const el = containerRef.current
    if (!el) return

    const options: Options = {
      el,
      direction: MindElixir.SIDE,
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

    // Persist every structural / textual change back to disk. Mind-Elixir
    // fires `operation` for user-driven edits (add, remove, edit topic,
    // move, etc.) but *not* for pure UI events like selection — so the
    // dirty flag reflects actual document changes, not cursor movement.
    const handleOperation = (): void => {
      try {
        const data = me.getData()
        const outline = nodeToOutline(data.nodeData)
        if (outline === lastSerialisedRef.current) return
        lastSerialisedRef.current = outline
        onChangeRef.current(outline)
      } catch (err) {
        console.warn('[Mindmap] serialisation error:', err)
      }
    }
    me.bus.addListener('operation', handleOperation)

    return () => {
      try {
        me.bus.removeListener('operation', handleOperation)
        me.destroy()
      } catch {
        // best-effort cleanup on unmount
      }
      instanceRef.current = null
    }
  }, [initialData])

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
