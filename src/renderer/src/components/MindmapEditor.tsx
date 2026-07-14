/**
 * PaiNote Mindmap Editor
 *
 * A lightweight mindmap editor using SVG. Stores data as a simple
 * indented text format (each level = one tab), which is both human-readable
 * and easy to convert to/from other formats.
 *
 * Features:
 *  - Interactive node editing (double-click to edit text)
 *  - Add child / sibling nodes
 *  - Collapse / expand branches
 *  - Pan and zoom
 *  - Auto-layout using a simple tree algorithm
 */

import { useState, useRef, useCallback, useEffect, type KeyboardEvent } from 'react'

export interface MindmapEditorProps {
  value: string
  onChange: (data: string) => void
  className?: string
}

interface MindNode {
  id: string
  text: string
  children: MindNode[]
  collapsed: boolean
}

let nodeIdCounter = 0
function genId(): string {
  return `node-${++nodeIdCounter}`
}

/** Parse indented text into a tree structure. */
function parseToTree(text: string): MindNode {
  const lines = text.split('\n').filter((l) => l.trim())
  if (lines.length === 0) {
    return { id: genId(), text: 'Central Topic', children: [], collapsed: false }
  }

  // Count leading spaces/tabs to determine depth
  const getDepth = (line: string): number => {
    let depth = 0
    for (const ch of line) {
      if (ch === '\t' || ch === ' ') depth++
      else break
    }
    return depth
  }

  const root: MindNode = { id: genId(), text: lines[0].trim(), children: [], collapsed: false }
  const stack: { node: MindNode; depth: number }[] = [{ node: root, depth: 0 }]

  for (let i = 1; i < lines.length; i++) {
    const depth = getDepth(lines[i])
    const text = lines[i].trim()
    const node: MindNode = { id: genId(), text, children: [], collapsed: false }

    // Pop stack until we find the parent (depth - 1)
    while (stack.length > 1 && stack[stack.length - 1].depth >= depth) {
      stack.pop()
    }

    stack[stack.length - 1].node.children.push(node)
    stack.push({ node, depth })
  }

  return root
}

/** Serialize tree back to indented text. */
function treeToText(node: MindNode, depth: number = 0): string {
  const indent = '  '.repeat(depth)
  let result = `${indent}${node.text}`
  if (!node.collapsed) {
    for (const child of node.children) {
      result += '\n' + treeToText(child, depth + 1)
    }
  }
  return result
}

/** Layout: assign x/y positions to each node. */
interface PositionedNode extends MindNode {
  x: number
  y: number
  width: number
  height: number
  depth: number
}

const NODE_HEIGHT = 32
const NODE_MIN_WIDTH = 80
const H_GAP = 60
const V_GAP = 12

function layoutTree(node: MindNode, depth: number, startY: number): { node: PositionedNode; height: number } {
  const width = Math.max(NODE_MIN_WIDTH, node.text.length * 8 + 20)

  if (node.children.length === 0 || node.collapsed) {
    const pn: PositionedNode = {
      ...node,
      x: depth * (NODE_MIN_WIDTH + H_GAP),
      y: startY,
      width,
      height: NODE_HEIGHT,
      depth
    }
    return { node: pn, height: NODE_HEIGHT + V_GAP }
  }

  let currentY = startY
  const positionedChildren: PositionedNode[] = []

  for (const child of node.children) {
    const result = layoutTree(child, depth + 1, currentY)
    positionedChildren.push(result.node)
    currentY += result.height
  }

  const totalHeight = currentY - startY
  const centerY = startY + totalHeight / 2 - NODE_HEIGHT / 2

  const pn: PositionedNode = {
    ...node,
    x: depth * (NODE_MIN_WIDTH + H_GAP),
    y: centerY,
    width,
    height: NODE_HEIGHT,
    depth,
    children: positionedChildren
  }

  return { node: pn, height: Math.max(totalHeight, NODE_HEIGHT + V_GAP) }
}

/** Flatten positioned tree into a list for rendering. */
function flatten(node: PositionedNode, result: PositionedNode[] = []): PositionedNode[] {
  result.push(node)
  if (node.children && !node.collapsed) {
    for (const child of node.children) {
      flatten(child as PositionedNode, result)
    }
  }
  return result
}

/** Collect edges (parent → child) for SVG line rendering. */
function collectEdges(node: PositionedNode, edges: { from: PositionedNode; to: PositionedNode }[] = []): { from: PositionedNode; to: PositionedNode }[] {
  if (node.children && !node.collapsed) {
    for (const child of node.children) {
      edges.push({ from: node, to: child as PositionedNode })
      collectEdges(child as PositionedNode, edges)
    }
  }
  return edges
}

export function MindmapEditor({ value, onChange, className }: MindmapEditorProps): JSX.Element {
  const [tree, setTree] = useState<MindNode>(() => parseToTree(value || 'Central Topic'))
  const [editingId, setEditingId] = useState<string | null>(null)
  const [editText, setEditText] = useState('')
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const editInputRef = useRef<HTMLInputElement>(null)

  // Sync external value changes (e.g., file switch)
  const lastExternalValue = useRef(value)
  useEffect(() => {
    if (value !== lastExternalValue.current) {
      lastExternalValue.current = value
      setTree(parseToTree(value || 'Central Topic'))
    }
  }, [value])

  // Focus edit input when editing starts
  useEffect(() => {
    if (editingId && editInputRef.current) {
      editInputRef.current.focus()
      editInputRef.current.select()
    }
  }, [editingId])

  // Sync tree changes back to parent
  const syncChange = useCallback((newTree: MindNode) => {
    setTree(newTree)
    const text = treeToText(newTree)
    lastExternalValue.current = text
    onChange(text)
  }, [onChange])

  // Layout calculation
  const { positionedNodes, edges, svgWidth, svgHeight } = (() => {
    const { node } = layoutTree(tree, 0, 0)
    const nodes = flatten(node)
    const e = collectEdges(node)
    const maxX = Math.max(...nodes.map((n) => n.x + n.width)) + 40
    const maxY = Math.max(...nodes.map((n) => n.y + n.height)) + 40
    return { positionedNodes: nodes, edges: e, svgWidth: Math.max(maxX, 400), svgHeight: Math.max(maxY, 300) }
  })()

  // ===== Node operations =====

  const findNode = (node: MindNode, id: string): MindNode | null => {
    if (node.id === id) return node
    for (const child of node.children) {
      const found = findNode(child, id)
      if (found) return found
    }
    return null
  }

  const updateNode = (node: MindNode, id: string, updater: (n: MindNode) => MindNode): MindNode => {
    if (node.id === id) return updater(node)
    return {
      ...node,
      children: node.children.map((c) => updateNode(c, id, updater))
    }
  }

  const handleAddChild = useCallback(() => {
    if (!selectedId) return
    const newNode: MindNode = { id: genId(), text: 'New Node', children: [], collapsed: false }
    const newTree = updateNode(tree, selectedId, (n) => ({
      ...n,
      collapsed: false,
      children: [...n.children, newNode]
    }))
    syncChange(newTree)
    setEditingId(newNode.id)
    setEditText('New Node')
  }, [selectedId, tree, syncChange])

  const handleAddSibling = useCallback(() => {
    if (!selectedId || selectedId === tree.id) return
    // Find parent of selected node
    const findParent = (node: MindNode, id: string): MindNode | null => {
      for (const child of node.children) {
        if (child.id === id) return node
        const found = findParent(child, id)
        if (found) return found
      }
      return null
    }
    const parent = findParent(tree, selectedId)
    if (!parent) return
    const newNode: MindNode = { id: genId(), text: 'New Node', children: [], collapsed: false }
    const newTree = updateNode(tree, parent.id, (n) => {
      const idx = n.children.findIndex((c) => c.id === selectedId)
      const newChildren = [...n.children]
      newChildren.splice(idx + 1, 0, newNode)
      return { ...n, children: newChildren }
    })
    syncChange(newTree)
    setEditingId(newNode.id)
    setEditText('New Node')
  }, [selectedId, tree, syncChange])

  const handleToggleCollapse = useCallback((id: string) => {
    const newTree = updateNode(tree, id, (n) => ({ ...n, collapsed: !n.collapsed }))
    syncChange(newTree)
  }, [tree, syncChange])

  const handleDeleteNode = useCallback(() => {
    if (!selectedId || selectedId === tree.id) return
    const deleteFromTree = (node: MindNode, id: string): MindNode => ({
      ...node,
      children: node.children.filter((c) => c.id !== id).map((c) => deleteFromTree(c, id))
    })
    syncChange(deleteFromTree(tree, selectedId))
    setSelectedId(null)
  }, [selectedId, tree, syncChange])

  const handleCommitEdit = useCallback(() => {
    if (!editingId) return
    const trimmed = editText.trim()
    if (trimmed) {
      const newTree = updateNode(tree, editingId, (n) => ({ ...n, text: trimmed }))
      syncChange(newTree)
    }
    setEditingId(null)
  }, [editingId, editText, tree, syncChange])

  const handleKeyDown = useCallback((e: KeyboardEvent) => {
    if (editingId) return // Don't intercept while editing
    if (e.key === 'Tab' && selectedId) {
      e.preventDefault()
      handleAddChild()
    } else if (e.key === 'Enter' && selectedId) {
      e.preventDefault()
      handleAddSibling()
    } else if (e.key === 'Delete' && selectedId) {
      e.preventDefault()
      handleDeleteNode()
    }
  }, [editingId, selectedId, handleAddChild, handleAddSibling, handleDeleteNode])

  return (
    <div
      className={`mindmap-editor-wrapper ${className || ''}`}
      style={{ width: '100%', height: '100%', display: 'flex', flexDirection: 'column', backgroundColor: 'var(--bg-primary)' }}
      tabIndex={0}
      onKeyDown={handleKeyDown}
    >
      {/* Toolbar */}
      <div style={{
        display: 'flex',
        gap: 8,
        padding: '8px 16px',
        borderBottom: '1px solid var(--border-light)',
        fontSize: 12,
        color: 'var(--text-tertiary)',
        flexShrink: 0
      }}>
        <span>Tab: Add Child | Enter: Add Sibling | Del: Delete | Dbl-click: Edit</span>
      </div>

      {/* SVG canvas */}
      <div style={{ flex: 1, overflow: 'auto', padding: 24 }}>
        <svg
          width={svgWidth}
          height={svgHeight}
          style={{ display: 'block' }}
        >
          {/* Edges */}
          {edges.map((edge, i) => (
            <path
              key={`edge-${i}`}
              d={`M ${edge.from.x + edge.from.width} ${edge.from.y + edge.from.height / 2} C ${edge.from.x + edge.from.width + 30} ${edge.from.y + edge.from.height / 2}, ${edge.to.x - 30} ${edge.to.y + edge.to.height / 2}, ${edge.to.x} ${edge.to.y + edge.to.height / 2}`}
              fill="none"
              stroke="var(--border-secondary)"
              strokeWidth={1.5}
            />
          ))}

          {/* Nodes */}
          {positionedNodes.map((node) => (
            <g
              key={node.id}
              transform={`translate(${node.x}, ${node.y})`}
              style={{ cursor: 'pointer' }}
              onClick={(e) => {
                e.stopPropagation()
                setSelectedId(node.id)
              }}
              onDoubleClick={(e) => {
                e.stopPropagation()
                setEditingId(node.id)
                setEditText(node.text)
              }}
            >
              <rect
                width={node.width}
                height={node.height}
                rx={6}
                ry={6}
                fill={node.depth === 0 ? 'var(--accent-primary)' : 'var(--bg-tertiary)'}
                stroke={selectedId === node.id ? 'var(--accent-primary)' : 'var(--border-light)'}
                strokeWidth={selectedId === node.id ? 2 : 1}
              />
              {editingId === node.id ? (
                <foreignObject width={node.width} height={node.height}>
                  <input
                    ref={editInputRef}
                    value={editText}
                    onChange={(e) => setEditText(e.target.value)}
                    onBlur={handleCommitEdit}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') { e.preventDefault(); handleCommitEdit() }
                      if (e.key === 'Escape') setEditingId(null)
                      e.stopPropagation()
                    }}
                    style={{
                      width: '100%',
                      height: '100%',
                      border: 'none',
                      outline: 'none',
                      background: 'transparent',
                      textAlign: 'center',
                      fontSize: node.depth === 0 ? 14 : 13,
                      fontWeight: node.depth === 0 ? 700 : 400,
                      color: node.depth === 0 ? '#fff' : 'var(--text-primary)',
                      padding: '0 8px',
                      boxSizing: 'border-box'
                    }}
                  />
                </foreignObject>
              ) : (
                <>
                  <text
                    x={node.width / 2}
                    y={node.height / 2 + 5}
                    textAnchor="middle"
                    fontSize={node.depth === 0 ? 14 : 13}
                    fontWeight={node.depth === 0 ? 700 : 400}
                    fill={node.depth === 0 ? '#fff' : 'var(--text-primary)'}
                    style={{ userSelect: 'none', pointerEvents: 'none' }}
                  >
                    {node.text.length > 15 ? node.text.substring(0, 14) + '…' : node.text}
                  </text>
                  {node.children.length > 0 && (
                    <>
                      <circle
                        cx={node.width + 8}
                        cy={node.height / 2}
                        r={7}
                        fill="var(--bg-secondary)"
                        stroke="var(--border-secondary)"
                        strokeWidth={1}
                        style={{ cursor: 'pointer' }}
                        onClick={(e) => {
                          e.stopPropagation()
                          handleToggleCollapse(node.id)
                        }}
                      />
                      <text
                        x={node.width + 8}
                        y={node.height / 2 + 4}
                        textAnchor="middle"
                        fontSize={10}
                        fill="var(--text-tertiary)"
                        style={{ userSelect: 'none', pointerEvents: 'none' }}
                      >
                        {node.collapsed ? '+' : '−'}
                      </text>
                    </>
                  )}
                </>
              )}
            </g>
          ))}
        </svg>
      </div>
    </div>
  )
}

export default MindmapEditor
