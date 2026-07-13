import { useMemo, useState } from 'react'
import CodeMirror from '@uiw/react-codemirror'
import { markdown, markdownLanguage } from '@codemirror/lang-markdown'
import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import type { EditorProps } from '@plugin-sdk'

type ViewMode = 'split' | 'edit' | 'preview'

/**
 * Markdown 编辑器：CodeMirror 6 编辑 + react-markdown 实时预览。
 * 支持分栏 / 仅编辑 / 仅预览三种模式。
 */
export function MarkdownEditor({ doc, onChange, readonly }: EditorProps<string>): JSX.Element {
  const [mode, setMode] = useState<ViewMode>('split')
  const extensions = useMemo(() => [markdown({ base: markdownLanguage })], [])

  const update = (value: string): void => {
    onChange({ ...doc, content: value })
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%' }}>
      <div className="md-toolbar">
        <button
          className={mode === 'edit' ? 'primary' : 'ghost'}
          onClick={() => setMode('edit')}
        >
          编辑
        </button>
        <button
          className={mode === 'split' ? 'primary' : 'ghost'}
          onClick={() => setMode('split')}
        >
          分栏
        </button>
        <button
          className={mode === 'preview' ? 'primary' : 'ghost'}
          onClick={() => setMode('preview')}
        >
          预览
        </button>
      </div>
      <div className="md-body">
        {mode !== 'preview' && (
          <div
            className="md-editor"
            style={{ borderRight: mode === 'split' ? '1px solid var(--border)' : 'none' }}
          >
            <CodeMirror
              value={doc.content}
              theme="dark"
              extensions={extensions}
              readOnly={readonly}
              onChange={update}
              height="100%"
              basicSetup={{ lineNumbers: true, foldGutter: true, highlightActiveLine: true }}
            />
          </div>
        )}
        {mode !== 'edit' && (
          <div className="md-preview">
            {doc.content.trim() ? (
              <ReactMarkdown remarkPlugins={[remarkGfm]}>{doc.content}</ReactMarkdown>
            ) : (
              <p className="md-placeholder">实时预览区 —— 开始输入 Markdown 即可看到渲染效果</p>
            )}
          </div>
        )}
      </div>
    </div>
  )
}
