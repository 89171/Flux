import { Suspense, lazy, useEffect, useMemo, useState, type CSSProperties } from 'react'
import { Renderer, marked } from 'marked'
import plantumlEncoder from 'plantuml-encoder'
import type {
  BuiltinRendererId,
  FileHistoryReadResult,
  FormatBinding,
  NoteFile
} from '@shared/types'
import CodeMirrorEditor from './CodeMirrorEditor'
import PluginIframeEditor from './PluginIframeEditor'
import { usePluginStore } from '../stores/pluginStore'

const DrawioEditor = lazy(() => import('./DrawioEditor'))
const MindmapEditor = lazy(() => import('./MindmapEditor'))
const WhiteboardEditor = lazy(() => import('./WhiteboardEditor'))
const BpmnEditor = lazy(() => import('./BpmnEditor'))
const DmnEditor = lazy(() => import('./DmnEditor'))

export type HistoryPreviewMode = 'preview' | 'source'

interface FileHistoryPreviewProps {
  file: NoteFile
  entry: FileHistoryReadResult | null
  isLoading: boolean
  mode: HistoryPreviewMode
}

type PreviewBinding =
  | { kind: 'builtin'; renderer: BuiltinRendererId }
  | { kind: 'plugin-editor'; entryUrl: string }
  | null

interface KanbanColumn {
  id: string
  name: string
}

interface KanbanCard {
  id: string
  columnId: string
  title: string
  description?: string
  labels?: string[]
  archived?: boolean
  order: number
}

interface KanbanDoc {
  columns: KanbanColumn[]
  cards: KanbanCard[]
}

const builtinByExtension: Record<string, BuiltinRendererId> = {
  md: 'markdown',
  markdown: 'markdown',
  mdx: 'markdown',
  drawio: 'drawio',
  mm: 'mindmap',
  mindmap: 'mindmap',
  tldr: 'whiteboard',
  excalidraw: 'excalidraw',
  todo: 'kanban',
  mmd: 'mermaid',
  puml: 'plantuml',
  bpmn: 'bpmn',
  dmn: 'dmn',
  txt: 'plaintext'
}

const builtinRenderers = new Set<BuiltinRendererId>([
  'markdown',
  'drawio',
  'mindmap',
  'plaintext',
  'whiteboard',
  'excalidraw',
  'kanban',
  'mermaid',
  'plantuml',
  'bpmn',
  'dmn'
])

const previewShellStyle: CSSProperties = {
  flex: 1,
  minHeight: 0,
  background: 'var(--bg-primary)',
  overflow: 'hidden'
}

const messageStyle: CSSProperties = {
  height: '100%',
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
  padding: 24,
  color: 'var(--text-tertiary)',
  fontSize: 13,
  textAlign: 'center'
}

const noop = (): void => {}

function getExtension(fileName: string): string {
  return fileName.split('.').pop()?.toLowerCase() ?? ''
}

function resolveBinding(
  fileName: string,
  fileFormat: string | undefined,
  formatMap: Record<string, FormatBinding>
): PreviewBinding {
  const extension = getExtension(fileName)
  const mapped = formatMap[extension]
  if (mapped?.kind === 'builtin') return { kind: 'builtin', renderer: mapped.renderer }
  if (mapped?.kind === 'plugin-editor') return { kind: 'plugin-editor', entryUrl: mapped.entryUrl }

  const byExtension = builtinByExtension[extension]
  if (byExtension) return { kind: 'builtin', renderer: byExtension }

  if (fileFormat && builtinRenderers.has(fileFormat as BuiltinRendererId)) {
    return { kind: 'builtin', renderer: fileFormat as BuiltinRendererId }
  }

  return { kind: 'builtin', renderer: 'plaintext' }
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
}

function escapeAttribute(value: string): string {
  return escapeHtml(value).replace(/'/g, '&#39;')
}

function sanitizeUrl(url: string, allowImageData = false): string {
  const trimmed = url.trim()
  if (!trimmed) return ''
  if (trimmed.startsWith('#')) return trimmed

  if (!/^[a-z][a-z0-9+.-]*:/i.test(trimmed)) {
    return trimmed
  }

  try {
    const parsed = new URL(trimmed)
    if (parsed.protocol === 'http:' || parsed.protocol === 'https:') return trimmed
    if (!allowImageData && parsed.protocol === 'mailto:') return trimmed
    if (
      allowImageData &&
      parsed.protocol === 'data:' &&
      /^data:image\/(?:png|jpe?g|gif|webp);base64,/i.test(trimmed)
    ) {
      return trimmed
    }
  } catch {
    return ''
  }

  return ''
}

function renderMarkdown(content: string): string {
  const renderer = new Renderer()
  renderer.html = () => ''
  renderer.link = (href, title, text) => {
    const safeHref = sanitizeUrl(href)
    if (!safeHref) return text
    const titleAttr = title ? ` title="${escapeAttribute(title)}"` : ''
    return `<a href="${escapeAttribute(safeHref)}"${titleAttr} target="_blank" rel="noreferrer">${text}</a>`
  }
  renderer.image = (href, title, text) => {
    const safeHref = sanitizeUrl(href, true)
    if (!safeHref) return `<span>${escapeHtml(text)}</span>`
    const titleAttr = title ? ` title="${escapeAttribute(title)}"` : ''
    return `<img src="${escapeAttribute(safeHref)}" alt="${escapeAttribute(text)}"${titleAttr}>`
  }
  return marked.parse(content, { async: false, gfm: true, renderer }) as string
}

function PreviewMessage({ children }: { children: string }): JSX.Element {
  return <div style={messageStyle}>{children}</div>
}

function SourcePreview({ content, fileName }: { content: string; fileName: string }): JSX.Element {
  return (
    <div style={{ height: '100%', minHeight: 0 }}>
      <CodeMirrorEditor
        value={content}
        onChange={noop}
        fileName={fileName}
        fontSize={12}
        readOnly
      />
    </div>
  )
}

function MarkdownHistoryPreview({ content }: { content: string }): JSX.Element {
  const html = useMemo(() => renderMarkdown(content), [content])

  return (
    <div
      className="flux-history-markdown-preview"
      style={{
        height: '100%',
        overflow: 'auto',
        padding: '24px 32px',
        boxSizing: 'border-box'
      }}
    >
      <style>{`
        .flux-history-markdown-preview article {
          max-width: 820px;
          margin: 0 auto;
          color: var(--text-primary);
          font-size: 14px;
          line-height: 1.72;
        }
        .flux-history-markdown-preview h1,
        .flux-history-markdown-preview h2,
        .flux-history-markdown-preview h3 {
          line-height: 1.25;
          margin: 1.1em 0 0.55em;
        }
        .flux-history-markdown-preview h1 { font-size: 28px; }
        .flux-history-markdown-preview h2 { font-size: 22px; }
        .flux-history-markdown-preview h3 { font-size: 18px; }
        .flux-history-markdown-preview p { margin: 10px 0; }
        .flux-history-markdown-preview ul,
        .flux-history-markdown-preview ol { padding-left: 24px; }
        .flux-history-markdown-preview blockquote {
          margin: 12px 0;
          padding-left: 14px;
          border-left: 3px solid var(--border-color);
          color: var(--text-secondary);
        }
        .flux-history-markdown-preview pre {
          padding: 12px;
          border-radius: 6px;
          overflow: auto;
          background: var(--bg-secondary);
          border: 1px solid var(--border-light);
        }
        .flux-history-markdown-preview code {
          font-family: var(--font-mono);
          font-size: 12px;
          background: var(--bg-secondary);
          border-radius: 4px;
          padding: 2px 4px;
        }
        .flux-history-markdown-preview pre code {
          background: transparent;
          padding: 0;
        }
        .flux-history-markdown-preview table {
          width: 100%;
          border-collapse: collapse;
          margin: 14px 0;
        }
        .flux-history-markdown-preview th,
        .flux-history-markdown-preview td {
          border: 1px solid var(--border-color);
          padding: 7px 9px;
        }
        .flux-history-markdown-preview img {
          max-width: 100%;
          border-radius: 6px;
        }
      `}</style>
      <article
        // Raw HTML is stripped by the marked renderer above.
        // eslint-disable-next-line react/no-danger
        dangerouslySetInnerHTML={{ __html: html }}
      />
    </div>
  )
}

function MermaidHistoryPreview({ content }: { content: string }): JSX.Element {
  const [svg, setSvg] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [isRendering, setIsRendering] = useState(false)

  useEffect(() => {
    let cancelled = false
    const trimmed = content.trim()
    setSvg('')
    setError(null)
    if (!trimmed) return

    setIsRendering(true)
    void import('mermaid')
      .then(async ({ default: mermaid }) => {
        mermaid.initialize({
          startOnLoad: false,
          theme: document.documentElement.getAttribute('data-theme') === 'dark' ? 'dark' : 'default',
          securityLevel: 'strict',
          suppressErrorRendering: true
        })
        const id = `history-mermaid-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
        const result = await mermaid.render(id, trimmed)
        if (!cancelled) setSvg(result.svg)
      })
      .catch((err) => {
        if (!cancelled) setError(err instanceof Error ? err.message : String(err))
      })
      .finally(() => {
        if (!cancelled) setIsRendering(false)
      })

    return () => {
      cancelled = true
    }
  }, [content])

  if (!content.trim()) return <PreviewMessage>这个历史版本没有可预览的 Mermaid 内容</PreviewMessage>
  if (isRendering) return <PreviewMessage>正在渲染预览...</PreviewMessage>
  if (error) return <PreviewMessage>{`无法渲染 Mermaid：${error}`}</PreviewMessage>

  return (
    <div
      style={{
        height: '100%',
        overflow: 'auto',
        background: 'var(--bg-secondary)',
        padding: 24,
        boxSizing: 'border-box'
      }}
    >
      <div
        style={{
          minWidth: 'max-content',
          display: 'flex',
          justifyContent: 'center'
        }}
        // Mermaid is initialised with securityLevel:'strict'.
        // eslint-disable-next-line react/no-danger
        dangerouslySetInnerHTML={{ __html: svg }}
      />
    </div>
  )
}

function PlantUmlHistoryPreview({ content }: { content: string }): JSX.Element {
  const previewUrl = useMemo(() => {
    const trimmed = content.trim()
    if (!trimmed) return ''
    try {
      return `https://www.plantuml.com/plantuml/svg/${plantumlEncoder.encode(trimmed)}`
    } catch {
      return ''
    }
  }, [content])

  if (!previewUrl) return <PreviewMessage>这个历史版本没有可预览的 PlantUML 内容</PreviewMessage>

  return (
    <div
      style={{
        height: '100%',
        overflow: 'auto',
        background: 'var(--bg-secondary)',
        padding: 24,
        boxSizing: 'border-box',
        display: 'flex',
        alignItems: 'flex-start',
        justifyContent: 'center'
      }}
    >
      <img src={previewUrl} alt="PlantUML preview" style={{ maxWidth: '100%' }} />
    </div>
  )
}

function ExcalidrawHistoryPreview({ content }: { content: string }): JSX.Element {
  const [svg, setSvg] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [isRendering, setIsRendering] = useState(false)

  useEffect(() => {
    let cancelled = false
    const trimmed = content.trim()
    setSvg('')
    setError(null)
    if (!trimmed) return

    setIsRendering(true)
    void import('@excalidraw/excalidraw')
      .then(async ({ exportToSvg, restore }) => {
        const parsed = JSON.parse(trimmed)
        const restored = restore(parsed, null, null)
        if (!restored.elements.length) return ''
        const svgElement = await exportToSvg({
          elements: restored.elements,
          appState: {
            ...restored.appState,
            exportBackground: true
          },
          files: restored.files,
          exportPadding: 24
        })
        return new XMLSerializer().serializeToString(svgElement)
      })
      .then((nextSvg) => {
        if (!cancelled) setSvg(nextSvg)
      })
      .catch((err) => {
        if (!cancelled) setError(err instanceof Error ? err.message : String(err))
      })
      .finally(() => {
        if (!cancelled) setIsRendering(false)
      })

    return () => {
      cancelled = true
    }
  }, [content])

  if (!content.trim()) return <PreviewMessage>这个历史版本没有可预览的 Excalidraw 内容</PreviewMessage>
  if (isRendering) return <PreviewMessage>正在渲染预览...</PreviewMessage>
  if (error) return <PreviewMessage>{`无法渲染 Excalidraw：${error}`}</PreviewMessage>
  if (!svg) return <PreviewMessage>这个历史版本没有可预览的 Excalidraw 元素</PreviewMessage>

  return (
    <div
      style={{
        height: '100%',
        overflow: 'auto',
        background: 'var(--bg-secondary)',
        padding: 24,
        boxSizing: 'border-box',
        display: 'flex',
        alignItems: 'flex-start',
        justifyContent: 'center'
      }}
    >
      <div
        style={{ maxWidth: '100%' }}
        // SVG is generated by Excalidraw from its scene model.
        // eslint-disable-next-line react/no-danger
        dangerouslySetInnerHTML={{ __html: svg }}
      />
    </div>
  )
}

function parseKanbanDoc(raw: string): KanbanDoc {
  const parsed = JSON.parse(raw || '{}') as Record<string, unknown>
  const columns = Array.isArray(parsed.columns) ? parsed.columns : []
  const cards = Array.isArray(parsed.cards) ? parsed.cards : []

  return {
    columns: columns
      .filter(
        (column): column is KanbanColumn =>
          !!column &&
          typeof column === 'object' &&
          typeof (column as KanbanColumn).id === 'string' &&
          typeof (column as KanbanColumn).name === 'string'
      )
      .map((column) => ({ id: column.id, name: column.name })),
    cards: cards
      .filter(
        (card): card is KanbanCard =>
          !!card &&
          typeof card === 'object' &&
          typeof (card as KanbanCard).id === 'string' &&
          typeof (card as KanbanCard).columnId === 'string' &&
          typeof (card as KanbanCard).title === 'string'
      )
      .map((card) => ({
        id: card.id,
        columnId: card.columnId,
        title: card.title,
        description: typeof card.description === 'string' ? card.description : undefined,
        labels: Array.isArray(card.labels) ? card.labels.filter((label) => typeof label === 'string') : [],
        archived: typeof card.archived === 'boolean' ? card.archived : false,
        order: typeof card.order === 'number' ? card.order : 0
      }))
  }
}

function KanbanHistoryPreview({ content }: { content: string }): JSX.Element {
  const result = useMemo(() => {
    try {
      return { doc: parseKanbanDoc(content), error: null as string | null }
    } catch (err) {
      return { doc: null, error: err instanceof Error ? err.message : String(err) }
    }
  }, [content])

  if (result.error || !result.doc) {
    return <PreviewMessage>{`无法渲染看板预览：${result.error}`}</PreviewMessage>
  }

  if (result.doc.columns.length === 0) {
    return <PreviewMessage>这个历史版本没有可预览的看板列</PreviewMessage>
  }

  return (
    <div
      style={{
        height: '100%',
        overflow: 'auto',
        padding: 16,
        boxSizing: 'border-box',
        background: 'var(--bg-primary)'
      }}
    >
      <div style={{ display: 'flex', gap: 12, minHeight: '100%' }}>
        {result.doc.columns.map((column) => {
          const cards = result.doc.cards
            .filter((card) => card.columnId === column.id && !card.archived)
            .sort((a, b) => a.order - b.order)
          return (
            <section
              key={column.id}
              style={{
                flex: '0 0 240px',
                display: 'flex',
                flexDirection: 'column',
                gap: 8,
                padding: 10,
                borderRadius: 8,
                background: 'var(--bg-secondary)',
                border: '1px solid var(--border-light)'
              }}
            >
              <div style={{ fontSize: 13, fontWeight: 700, color: 'var(--text-primary)' }}>
                {column.name}
              </div>
              {cards.length === 0 ? (
                <div style={{ color: 'var(--text-tertiary)', fontSize: 12, padding: '6px 0' }}>
                  无任务
                </div>
              ) : (
                cards.map((card) => (
                  <article
                    key={card.id}
                    style={{
                      padding: '8px 10px',
                      borderRadius: 6,
                      background: 'var(--bg-primary)',
                      border: '1px solid var(--border-color)',
                      color: 'var(--text-primary)',
                      fontSize: 13
                    }}
                  >
                    <div style={{ fontWeight: 650 }}>{card.title}</div>
                    {card.description && (
                      <div
                        style={{
                          marginTop: 6,
                          color: 'var(--text-secondary)',
                          fontSize: 12,
                          lineHeight: 1.5,
                          whiteSpace: 'pre-wrap'
                        }}
                      >
                        {card.description}
                      </div>
                    )}
                    {!!card.labels?.length && (
                      <div style={{ marginTop: 8, display: 'flex', gap: 4, flexWrap: 'wrap' }}>
                        {card.labels.map((label) => (
                          <span
                            key={label}
                            style={{
                              padding: '2px 5px',
                              borderRadius: 4,
                              background: 'var(--bg-tertiary)',
                              color: 'var(--text-secondary)',
                              fontSize: 11
                            }}
                          >
                            {label}
                          </span>
                        ))}
                      </div>
                    )}
                  </article>
                ))
              )}
            </section>
          )
        })}
      </div>
    </div>
  )
}

function ReadonlyEditorFrame({ children }: { children: JSX.Element }): JSX.Element {
  return (
    <div style={{ height: '100%', minHeight: 0, overflow: 'hidden', background: 'var(--bg-primary)' }}>
      <Suspense fallback={<PreviewMessage>正在加载预览...</PreviewMessage>}>
        <div style={{ width: '100%', height: '100%', pointerEvents: 'none' }}>
          {children}
        </div>
      </Suspense>
    </div>
  )
}

function BuiltinPreview({
  renderer,
  content,
  fileName,
  previewKey
}: {
  renderer: BuiltinRendererId
  content: string
  fileName: string
  previewKey: string
}): JSX.Element {
  switch (renderer) {
    case 'markdown':
      return <MarkdownHistoryPreview content={content} />
    case 'mermaid':
      return <MermaidHistoryPreview content={content} />
    case 'plantuml':
      return <PlantUmlHistoryPreview content={content} />
    case 'excalidraw':
      return <ExcalidrawHistoryPreview content={content} />
    case 'kanban':
      return <KanbanHistoryPreview content={content} />
    case 'drawio':
      return (
        <ReadonlyEditorFrame>
          <DrawioEditor key={previewKey} value={content} onChange={noop} />
        </ReadonlyEditorFrame>
      )
    case 'mindmap':
      return (
        <ReadonlyEditorFrame>
          <MindmapEditor key={previewKey} value={content} onChange={noop} />
        </ReadonlyEditorFrame>
      )
    case 'whiteboard':
      return (
        <ReadonlyEditorFrame>
          <WhiteboardEditor key={previewKey} value={content} onChange={noop} />
        </ReadonlyEditorFrame>
      )
    case 'bpmn':
      return (
        <ReadonlyEditorFrame>
          <BpmnEditor key={previewKey} value={content} onChange={noop} />
        </ReadonlyEditorFrame>
      )
    case 'dmn':
      return (
        <ReadonlyEditorFrame>
          <DmnEditor key={previewKey} value={content} onChange={noop} />
        </ReadonlyEditorFrame>
      )
    case 'plaintext':
    default:
      return <SourcePreview content={content} fileName={fileName} />
  }
}

export default function FileHistoryPreview({
  file,
  entry,
  isLoading,
  mode
}: FileHistoryPreviewProps): JSX.Element {
  const formatMap = usePluginStore((state) => state.formatMap)
  const previewFileName = entry?.name ?? file.name
  const binding = useMemo(
    () => resolveBinding(previewFileName, file.format, formatMap),
    [file.format, formatMap, previewFileName]
  )

  if (isLoading) return <PreviewMessage>正在加载预览...</PreviewMessage>
  if (!entry) return <PreviewMessage>选择一个历史版本查看预览</PreviewMessage>

  if (mode === 'source') {
    return (
      <div style={previewShellStyle}>
        <SourcePreview content={entry.content} fileName={previewFileName} />
      </div>
    )
  }

  if (binding?.kind === 'plugin-editor') {
    return (
      <div style={previewShellStyle}>
        <Suspense fallback={<PreviewMessage>正在加载预览...</PreviewMessage>}>
          <PluginIframeEditor
            key={entry.id}
            entryUrl={binding.entryUrl}
            value={entry.content}
            onChange={noop}
            filePath={entry.path}
            mtime={entry.timestamp}
            readonly
            theme={document.documentElement.getAttribute('data-theme') === 'dark' ? 'dark' : 'light'}
          />
        </Suspense>
      </div>
    )
  }

  return (
    <div style={previewShellStyle}>
      <BuiltinPreview
        renderer={binding?.renderer ?? 'plaintext'}
        content={entry.content}
        fileName={previewFileName}
        previewKey={entry.id}
      />
    </div>
  )
}
