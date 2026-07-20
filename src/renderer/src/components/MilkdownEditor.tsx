/**
 * Flux Markdown Editor (Milkdown 7)
 *
 * WYSIWYG markdown editor using Milkdown's official API — the same engine
 * behind many production note apps. Round-trips markdown losslessly via
 * remark, so tables, task lists, code blocks, and GFM extensions survive
 * save/load cycles.
 *
 * The parent uses `key={currentFile.path}` on this component, so switching
 * files remounts the editor with fresh content. For same-file external
 * content changes (AI Replace/Append, streaming), a useEffect calls
 * `editor.action(replaceAll(value))` — see the sync effect below.
 */

import { Milkdown, MilkdownProvider, useEditor } from '@milkdown/react'
import { Editor, rootCtx, defaultValueCtx, nodeViewCtx, editorViewCtx } from '@milkdown/kit/core'
import { commonmark } from '@milkdown/kit/preset/commonmark'
import { gfm } from '@milkdown/kit/preset/gfm'
import { listener, listenerCtx } from '@milkdown/kit/plugin/listener'
import { history } from '@milkdown/kit/plugin/history'
import { clipboard } from '@milkdown/kit/plugin/clipboard'
import { upload, uploadConfig } from '@milkdown/kit/plugin/upload'
import { cursor } from '@milkdown/kit/plugin/cursor'
import { replaceAll } from '@milkdown/utils'
import type { Node as ProseNode, NodeType } from '@milkdown/prose/model'
import { Selection } from '@milkdown/prose/state'
import { Decoration, type EditorView, type NodeView, type NodeViewConstructor } from '@milkdown/prose/view'
import { useRef, useEffect, type DragEvent, type MouseEvent } from 'react'
import Prism from 'prismjs'
import { MARKDOWN_ASSETS_DIR, STATIC_ASSETS_ROOT } from '@shared/constants'
import 'prismjs/components/prism-javascript'
import 'prismjs/components/prism-typescript'
import 'prismjs/components/prism-python'
import 'prismjs/components/prism-css'
import 'prismjs/components/prism-json'
import 'prismjs/components/prism-bash'
import 'prismjs/components/prism-yaml'
import 'prismjs/components/prism-markup'

const STATIC_ASSET_PROTOCOL = 'flux-asset'
const previewDataUrlToAssetPath = new Map<string, string>()

function isStaticAssetPath(path: string): boolean {
  const normalized = path.replace(/\\/g, '/').replace(/^\/+/, '')
  const parts = normalized.split('/').filter(Boolean)
  return (
    normalized === STATIC_ASSETS_ROOT ||
    normalized.startsWith(`${STATIC_ASSETS_ROOT}/`) ||
    parts.includes(MARKDOWN_ASSETS_DIR)
  )
}

function isExternalImageHref(href: string): boolean {
  return /^[a-z][a-z0-9+.-]*:/i.test(href) && !href.startsWith(`${STATIC_ASSET_PROTOCOL}:`)
}

function getFileDir(filePath?: string): string {
  if (!filePath) return ''
  const normalized = filePath.replace(/\\/g, '/').replace(/^\/+|\/+$/g, '')
  const slash = normalized.lastIndexOf('/')
  return slash >= 0 ? normalized.slice(0, slash) : ''
}

function normalizeWorkspacePath(path: string): string | null {
  const parts: string[] = []
  for (const part of path.replace(/\\/g, '/').split('/')) {
    if (!part || part === '.') continue
    if (part === '..') {
      if (parts.length === 0) return null
      parts.pop()
    } else {
      parts.push(part)
    }
  }
  return parts.join('/')
}

function resolveWorkspaceImagePath(href: string, filePath?: string): string | null {
  if (!href || isExternalImageHref(href) || href.startsWith('#')) return null
  let decoded: string
  try {
    decoded = decodeURI(href.replace(/^file:\/\//i, ''))
  } catch {
    return null
  }
  const normalizedHref = decoded.replace(/\\/g, '/').replace(/^\/+|\/+$/g, '')
  if (normalizedHref === STATIC_ASSETS_ROOT || normalizedHref.startsWith(`${STATIC_ASSETS_ROOT}/`)) {
    return normalizeWorkspacePath(normalizedHref)
  }
  if (decoded.startsWith('/')) return normalizeWorkspacePath(decoded)
  const baseDir = getFileDir(filePath)
  return normalizeWorkspacePath(baseDir ? `${baseDir}/${decoded}` : decoded)
}

function relativeFromFileDir(targetPath: string, filePath?: string): string {
  const fromParts = getFileDir(filePath).split('/').filter(Boolean)
  const toParts = targetPath.replace(/\\/g, '/').replace(/^\/+/, '').split('/').filter(Boolean)
  let shared = 0
  while (shared < fromParts.length && shared < toParts.length && fromParts[shared] === toParts[shared]) {
    shared += 1
  }
  const result = [
    ...Array(fromParts.length - shared).fill('..'),
    ...toParts.slice(shared)
  ].join('/')
  return result || targetPath
}

function toStaticAssetPreviewUrl(path: string): string {
  const normalized = path.replace(/\\/g, '/').replace(/^\/+/, '')
  const encoded = normalized.split('/').map(encodeURIComponent).join('/')
  return `${STATIC_ASSET_PROTOCOL}:///${encoded}`
}

function fromStaticAssetPreviewUrl(url: string): string | null {
  try {
    const parsed = new URL(url)
    if (parsed.protocol !== `${STATIC_ASSET_PROTOCOL}:`) return null
    const normalized = decodeURIComponent(`${parsed.hostname}${parsed.pathname}`)
      .replace(/^\/+/, '')
    return isStaticAssetPath(normalized) ? normalized : null
  } catch {
    return null
  }
}

function toPreviewMarkdownForFile(markdown: string, filePath?: string): string {
  return markdown.replace(/(!\[[^\]]*]\()([^)\s]+)((?:\s+"[^"]*")?\))/g, (match, open, href, close) => {
    const protocolPath = fromStaticAssetPreviewUrl(href)
    if (protocolPath) return `${open}${toStaticAssetPreviewUrl(protocolPath)}${close}`

    const assetPath = resolveWorkspaceImagePath(href, filePath)
    if (!assetPath || !isStaticAssetPath(assetPath)) return match
    return `${open}${toStaticAssetPreviewUrl(assetPath)}${close}`
  })
}

function toStorageMarkdown(markdown: string, filePath?: string): string {
  return markdown
    .replace(/flux-asset:\/\/\/[^\s)"']+/g, (url) => {
      const assetPath = fromStaticAssetPreviewUrl(url)
      return assetPath ? relativeFromFileDir(assetPath, filePath) : url
    })
    .replace(/data:image\/[a-z0-9.+-]+;base64,[A-Za-z0-9+/=]+/gi, (dataUrl) => {
      const assetPath = previewDataUrlToAssetPath.get(dataUrl)
      return assetPath ? relativeFromFileDir(assetPath, filePath) : dataUrl
    })
}

function arrayBufferToDataUrl(buffer: ArrayBuffer, mimeType: string): string {
  const bytes = new Uint8Array(buffer)
  let binary = ''
  const chunkSize = 0x8000
  for (let i = 0; i < bytes.length; i += chunkSize) {
    binary += String.fromCharCode(...bytes.subarray(i, i + chunkSize))
  }
  return `data:${mimeType || 'image/png'};base64,${btoa(binary)}`
}

function isImageFile(file: File): boolean {
  if (file.type.startsWith('image/')) return true
  return /\.(png|jpe?g|gif|webp|svg)$/i.test(file.name)
}

async function createImageNodeFromFile(
  file: File,
  imageNode: NodeType,
  filePath?: string
): Promise<ProseNode | null> {
  if (!isImageFile(file)) return null

  const data = await file.arrayBuffer()
  const saved = await window.flux.file.saveStaticAsset({
    ownerPath: filePath,
    fileName: file.name,
    mimeType: file.type,
    data
  })
  const previewUrl = arrayBufferToDataUrl(data, saved.mimeType || file.type)
  previewDataUrlToAssetPath.set(previewUrl, saved.path)
  const markdownPath = relativeFromFileDir(saved.path, filePath)
  return imageNode.createAndFill({
    src: previewUrl,
    alt: markdownPath,
    title: ''
  })
}

function hasFileDrag(dataTransfer: DataTransfer): boolean {
  return Array.from(dataTransfer.types).includes('Files')
}

function clampDocPos(view: EditorView, pos: number): number {
  return Math.max(0, Math.min(pos, view.state.doc.content.size))
}

function insertImageNodesAtSelection(view: EditorView, nodes: ProseNode[], pos: number): void {
  let tr = view.state.tr.setSelection(Selection.near(view.state.doc.resolve(clampDocPos(view, pos))))
  for (const node of nodes) {
    tr = tr.replaceSelectionWith(node, false)
    if (node.isInline) tr = tr.insertText(' ')
  }
  view.dispatch(tr.scrollIntoView())
  view.focus()
}

function appendImageNodes(view: EditorView, nodes: ProseNode[]): void {
  const paragraphType = view.state.schema.nodes.paragraph
  if (paragraphType && nodes.every((node) => node.isInline)) {
    const content: ProseNode[] = []
    nodes.forEach((node, index) => {
      content.push(node)
      if (index < nodes.length - 1) content.push(view.state.schema.text(' '))
    })
    const paragraph = paragraphType.create(null, content)
    const insertPos = view.state.doc.content.size
    let tr = view.state.tr.insert(insertPos, paragraph)
    const selectionPos = Math.min(tr.doc.content.size, insertPos + paragraph.nodeSize - 1)
    tr = tr.setSelection(Selection.near(tr.doc.resolve(selectionPos), -1))
    view.dispatch(tr.scrollIntoView())
    view.focus()
    return
  }

  insertImageNodesAtSelection(view, nodes, view.state.doc.content.size)
}

function insertDroppedImageNodes(view: EditorView, nodes: ProseNode[], left: number, top: number): void {
  if (nodes.length === 0) return

  const dropPos = view.posAtCoords({ left, top })
  if (!dropPos) {
    appendImageNodes(view, nodes)
    return
  }

  try {
    insertImageNodesAtSelection(view, nodes, dropPos.pos)
  } catch (err) {
    console.warn('[MilkdownEditor] Falling back to appending dropped images:', err)
    appendImageNodes(view, nodes)
  }
}

function unescapeMarkdownText(text: string): string {
  return text.replace(/\\([\\[\]()"'])/g, '$1')
}

function escapeMarkdownAlt(text: string): string {
  return text.replace(/\\/g, '\\\\').replace(/]/g, '\\]')
}

function escapeMarkdownTitle(text: string): string {
  return text.replace(/\\/g, '\\\\').replace(/"/g, '\\"')
}

function formatMarkdownHref(href: string): string {
  return /[\s()]/.test(href) ? `<${href.replace(/>/g, '%3E')}>` : href
}

function getImageMarkdownHref(node: ProseNode, filePath?: string): string {
  const src = String(node.attrs.src || '')
  const assetPath =
    previewDataUrlToAssetPath.get(src) ??
    fromStaticAssetPreviewUrl(src) ??
    resolveWorkspaceImagePath(src, filePath)
  return assetPath ? relativeFromFileDir(assetPath, filePath) : src
}

function buildImageMarkdownText(node: ProseNode, filePath?: string): string {
  const href = getImageMarkdownHref(node, filePath)
  const alt = String(node.attrs.alt || '')
  const title = String(node.attrs.title || '')
  const displayAlt = alt && alt !== 'image' ? alt : href || 'image'
  const titlePart = title ? ` "${escapeMarkdownTitle(title)}"` : ''
  return `![${escapeMarkdownAlt(displayAlt)}](${formatMarkdownHref(href)}${titlePart})`
}

function parseMarkdownTitle(text: string): string {
  const trimmed = text.trim()
  if (!trimmed) return ''
  const first = trimmed[0]
  const last = trimmed[trimmed.length - 1]
  if ((first === '"' && last === '"') || (first === "'" && last === "'") || (first === '(' && last === ')')) {
    return unescapeMarkdownText(trimmed.slice(1, -1))
  }
  return unescapeMarkdownText(trimmed)
}

function parseMarkdownImageTarget(text: string): { href: string; title: string } | null {
  const trimmed = text.trim()
  if (!trimmed) return null

  let href = ''
  let rest = ''
  if (trimmed.startsWith('<')) {
    const end = trimmed.indexOf('>')
    if (end < 0) return null
    href = trimmed.slice(1, end)
    rest = trimmed.slice(end + 1).trim()
  } else {
    const match = trimmed.match(/^(\S+)(?:\s+([\s\S]+))?$/)
    if (!match) return null
    href = match[1]
    rest = match[2]?.trim() ?? ''
  }

  if (!href) return null
  return {
    href: unescapeMarkdownText(href),
    title: parseMarkdownTitle(rest)
  }
}

function parseImageMarkdownText(text: string, node: ProseNode, filePath?: string): Record<string, string> | null {
  const trimmed = text.trim()
  if (!trimmed) return null

  let alt = String(node.attrs.alt || '')
  let target = trimmed
  const imageMatch = trimmed.match(/^!\[([\s\S]*?)]\(([\s\S]*)\)$/)
  if (imageMatch) {
    alt = unescapeMarkdownText(imageMatch[1])
    target = imageMatch[2]
  }

  const parsed = parseMarkdownImageTarget(target)
  if (!parsed) return null

  const assetPath = resolveWorkspaceImagePath(parsed.href, filePath)
  const src = assetPath && isStaticAssetPath(assetPath)
    ? toStaticAssetPreviewUrl(assetPath)
    : parsed.href

  return {
    src,
    alt: alt || parsed.href || 'image',
    title: parsed.title
  }
}

class MarkdownImageNodeView implements NodeView {
  dom: HTMLElement

  private image: HTMLImageElement
  private source: HTMLInputElement
  private node: ProseNode
  private requestVersion = 0
  private isEditingSource = false
  private lastSourceText = ''

  constructor(
    node: ProseNode,
    private readonly view: EditorView,
    private readonly getPos: () => number | undefined,
    private readonly filePath?: string
  ) {
    this.node = node
    this.dom = document.createElement('span')
    this.dom.className = 'flux-image-node'
    this.dom.contentEditable = 'false'

    this.image = document.createElement('img')
    this.image.draggable = true

    this.source = document.createElement('input')
    this.source.type = 'text'
    this.source.className = 'flux-image-markdown-source'
    this.source.spellcheck = false
    this.source.autocapitalize = 'off'
    this.source.autocomplete = 'off'
    this.source.setAttribute('aria-label', 'Image markdown source')
    this.source.addEventListener('focus', () => {
      this.isEditingSource = true
    })
    this.source.addEventListener('blur', () => {
      this.commitSourceEdit()
    })
    this.source.addEventListener('keydown', (event) => {
      if (event.key === 'Enter') {
        event.preventDefault()
        this.source.blur()
      } else if (event.key === 'Escape') {
        event.preventDefault()
        this.source.value = this.lastSourceText
        this.source.blur()
      }
    })

    this.dom.append(this.image, this.source)
    this.render()
  }

  update(node: ProseNode): boolean {
    if (node.type !== this.node.type) return false
    this.node = node
    this.render()
    return true
  }

  ignoreMutation(): boolean {
    return true
  }

  stopEvent(event: Event): boolean {
    return event.target instanceof Node && this.source.contains(event.target)
  }

  private render(): void {
    const src = String(this.node.attrs.src || '')
    const alt = String(this.node.attrs.alt || '')
    const title = String(this.node.attrs.title || '')
    const href = getImageMarkdownHref(this.node, this.filePath)

    this.image.alt = alt
    this.image.title = title || href
    this.lastSourceText = buildImageMarkdownText(this.node, this.filePath)
    this.source.title = href ? `Path: ${href}` : this.lastSourceText
    if (!this.isEditingSource) this.source.value = this.lastSourceText
    this.renderImageSrc(src)
  }

  private commitSourceEdit(): void {
    const nextText = this.source.value.trim()
    this.isEditingSource = false
    if (nextText === this.lastSourceText) {
      this.source.value = this.lastSourceText
      return
    }

    const attrs = parseImageMarkdownText(nextText, this.node, this.filePath)
    const pos = this.getPos()
    if (!attrs || typeof pos !== 'number') {
      this.source.value = this.lastSourceText
      return
    }

    this.view.dispatch(
      this.view.state.tr.setNodeMarkup(pos, undefined, attrs, this.node.marks)
    )
  }

  private renderImageSrc(src: string): void {
    const version = ++this.requestVersion
    const assetPath =
      previewDataUrlToAssetPath.get(src) ??
      fromStaticAssetPreviewUrl(src) ??
      resolveWorkspaceImagePath(src, this.filePath)

    if (!assetPath || !isStaticAssetPath(assetPath)) {
      this.image.src = src
      this.image.removeAttribute('data-flux-asset-loading')
      return
    }

    this.image.dataset.fluxAssetPath = assetPath

    if (src.startsWith('data:')) {
      this.image.src = src
      this.image.removeAttribute('data-flux-asset-loading')
      return
    }

    this.image.removeAttribute('src')
    this.image.dataset.fluxAssetLoading = 'true'
    window.flux.file.readStaticAsset(assetPath)
      .then((asset) => {
        if (version !== this.requestVersion || !asset) return
        previewDataUrlToAssetPath.set(asset.dataUrl, assetPath)
        this.image.src = asset.dataUrl
        this.image.removeAttribute('data-flux-asset-loading')
      })
      .catch((err) => {
        if (version !== this.requestVersion) return
        this.image.removeAttribute('data-flux-asset-loading')
        console.warn('[MilkdownEditor] Failed to load local image preview:', err)
      })
  }
}

async function hydrateLocalImagePreviews(root: HTMLElement, filePath?: string): Promise<void> {
  const images = Array.from(root.querySelectorAll('img'))
  for (const image of images) {
    const currentSrc = image.getAttribute('src') ?? ''
    const existingPath = image.dataset.fluxAssetPath
    const assetPath =
      existingPath ??
      fromStaticAssetPreviewUrl(currentSrc) ??
      resolveWorkspaceImagePath(currentSrc, filePath)

    if (!assetPath || !isStaticAssetPath(assetPath)) continue
    if (existingPath === assetPath && currentSrc.startsWith('data:')) continue

    image.dataset.fluxAssetPath = assetPath
    try {
      const asset = await window.flux.file.readStaticAsset(assetPath)
      if (!asset) {
        image.removeAttribute('data-flux-asset-loaded')
        continue
      }
      previewDataUrlToAssetPath.set(asset.dataUrl, assetPath)
      image.src = asset.dataUrl
      image.dataset.fluxAssetLoaded = 'true'
    } catch (err) {
      image.removeAttribute('data-flux-asset-loaded')
      console.warn('[MilkdownEditor] Failed to hydrate local image preview:', err)
    }
  }
}

export interface MarkdownEditorProps {
  value: string
  onChange: (md: string) => void
  filePath?: string
  className?: string
}

function MilkdownInner({
  value,
  onChange,
  filePath
}: {
  value: string
  onChange: (md: string) => void
  filePath?: string
}): JSX.Element {
  const onChangeRef = useRef(onChange)
  onChangeRef.current = onChange

  // Track the last value we pushed into Milkdown. Used to:
  // 1. Skip replaceAll when value didn't actually change (user typing
  //    fires onChange → setContent → value prop changes back to what
  //    Milkdown already has — no need to re-apply).
  // 2. Avoid a feedback loop: replaceAll → markdownUpdated → onChange
  //    → setContent → value changes → replaceAll → ...
  const lastAppliedRef = useRef(value)
  // True while we're programmatically calling replaceAll so the
  // markdownUpdated listener knows to swallow the resulting event.
  const isApplyingExternalRef = useRef(false)

  const { get } = useEditor((root) =>
    Editor.make()
      .config((ctx) => {
        ctx.set(rootCtx, root)
        ctx.set(defaultValueCtx, toPreviewMarkdownForFile(value || '', filePath))
        const imageNodeView: NodeViewConstructor = (node, view, getPos) =>
          new MarkdownImageNodeView(node, view, getPos, filePath)
        const imageNodeViewEntry: [string, NodeViewConstructor] = ['image', imageNodeView]
        ctx.update(nodeViewCtx, (views) => [
          ...views.filter(([name]) => name !== 'image'),
          imageNodeViewEntry
        ])
        ctx.update(uploadConfig.key, (prev) => ({
          ...prev,
          uploadWidgetFactory: (pos, spec) => {
            const widget = document.createElement('span')
            widget.className = 'flux-image-upload-placeholder'
            return Decoration.widget(pos, widget, spec)
          },
          uploader: async (files, schema) => {
            const imageNode = schema.nodes.image
            if (!imageNode) return []

            const nodes: ProseNode[] = []
            for (let i = 0; i < files.length; i++) {
              const file = files.item(i)
              if (!file) continue
              const node = await createImageNodeFromFile(file, imageNode, filePath)
              if (node) nodes.push(node)
            }

            return nodes
          }
        }))
        ctx.get(listenerCtx).markdownUpdated((_ctx, markdown, prev) => {
          if (markdown === prev) return
          const storageMarkdown = toStorageMarkdown(markdown, filePath)
          const prevStorageMarkdown = toStorageMarkdown(prev, filePath)
          if (storageMarkdown === prevStorageMarkdown) return
          // Update lastApplied so the sync effect knows Milkdown already
          // has this content and doesn't need to re-push it.
          lastAppliedRef.current = storageMarkdown
          // Swallow the event if it was triggered by our own replaceAll
          // call — the content came from outside, not from user typing.
          if (isApplyingExternalRef.current) return
          onChangeRef.current(storageMarkdown)
        })
      })
      .use(commonmark)
      .use(gfm)
      .use(listener)
      .use(history)
      .use(upload)
      .use(clipboard)
      .use(cursor)
  )

  // ─── External value → editor sync ───
  // When `value` changes from outside (AI Replace/Append, streaming,
  // file watcher), push the new markdown into the Milkdown instance.
  // Without this, Milkdown only reads `value` at mount time via
  // defaultValueCtx — subsequent prop changes are silently ignored,
  // and the editor shows stale content until a remount (file switch).
  useEffect(() => {
    const editor = get()
    if (!editor) return
    // Skip if Milkdown already has this content (e.g. user typed →
    // onChange → setContent → value comes back identical).
    if (value === lastAppliedRef.current) return

    isApplyingExternalRef.current = true
    try {
      editor.action(replaceAll(toPreviewMarkdownForFile(value, filePath)))
      lastAppliedRef.current = value
    } finally {
      // Reset on the next frame so Milkdown's synchronous event cycle
      // (markdownUpdated fires during replaceAll) sees the flag.
      requestAnimationFrame(() => {
        isApplyingExternalRef.current = false
      })
    }
  }, [value, filePath, get])

  // Highlight code blocks with Prism after Milkdown renders.
  // Milkdown 7 doesn't ship a prism plugin, so we apply highlighting
  // directly to the rendered DOM. A MutationObserver catches dynamically
  // added/changed code blocks (typing, paste, file switch).
  const containerRef = useRef<HTMLDivElement>(null)
  useEffect(() => {
    let cancelled = false
    const refreshRenderedContent = (): void => {
      const root = containerRef.current
      if (!root) return
      const codeBlocks = root.querySelectorAll('pre code[class*="language-"]')
      codeBlocks.forEach((block) => {
        Prism.highlightElement(block)
      })
      hydrateLocalImagePreviews(root, filePath).catch((err) => {
        if (!cancelled) console.warn('[MilkdownEditor] Failed to refresh image previews:', err)
      })
    }
    // Initial highlight + local image hydration.
    let timer = setTimeout(refreshRenderedContent, 100)
    // Observe DOM changes for dynamic code block additions and pasted images.
    const observer = new MutationObserver(() => {
      clearTimeout(timer)
      timer = setTimeout(refreshRenderedContent, 50)
    })
    if (containerRef.current) {
      observer.observe(containerRef.current, {
        childList: true,
        subtree: true,
        characterData: true
      })
    }
    return () => {
      cancelled = true
      clearTimeout(timer)
      observer.disconnect()
    }
  }, [value, filePath])

  const focusEditorEnd = (): void => {
    const editor = get()
    if (!editor) return

    editor.action((ctx) => {
      const view = ctx.get(editorViewCtx)
      const tr = view.state.tr.setSelection(Selection.atEnd(view.state.doc))
      view.dispatch(tr.scrollIntoView())
      view.focus()
    })
  }

  const handleContainerMouseDown = (event: MouseEvent<HTMLDivElement>): void => {
    const target = event.target as HTMLElement | null
    const container = containerRef.current
    const proseMirror = container?.querySelector('.ProseMirror')
    if (!target || !container || !proseMirror) return
    if (proseMirror.contains(target) || target.closest('.flux-image-markdown-source')) return

    event.preventDefault()
    focusEditorEnd()
  }

  const handleContainerDragOver = (event: DragEvent<HTMLDivElement>): void => {
    if (!hasFileDrag(event.dataTransfer)) return
    event.preventDefault()
    event.dataTransfer.dropEffect = 'copy'
  }

  const handleContainerDrop = async (event: DragEvent<HTMLDivElement>): Promise<void> => {
    const files = Array.from(event.dataTransfer.files).filter(isImageFile)
    if (files.length === 0) return

    event.preventDefault()
    event.stopPropagation()

    const editor = get()
    if (!editor) return

    const left = event.clientX
    const top = event.clientY
    const view = editor.action((ctx) => ctx.get(editorViewCtx))
    const imageNode = view.state.schema.nodes.image
    if (!imageNode) return

    try {
      const nodes = (await Promise.all(
        files.map((file) => createImageNodeFromFile(file, imageNode, filePath))
      )).filter((node): node is ProseNode => !!node)
      insertDroppedImageNodes(view, nodes, left, top)
    } catch (err) {
      console.warn('[MilkdownEditor] Failed to insert dropped images:', err)
    }
  }

  return (
    <div
      ref={containerRef}
      className="markdown-editor-surface"
      onMouseDown={handleContainerMouseDown}
      onDragOverCapture={handleContainerDragOver}
      onDropCapture={handleContainerDrop}
    >
      <Milkdown />
    </div>
  )
}

export function MarkdownEditor({ value, onChange, filePath, className }: MarkdownEditorProps): JSX.Element {
  return (
    <div className={`markdown-editor-wrapper ${className || ''}`}>
      <MilkdownProvider>
        <MilkdownInner value={value} onChange={onChange} filePath={filePath} />
      </MilkdownProvider>
    </div>
  )
}

export default MarkdownEditor
