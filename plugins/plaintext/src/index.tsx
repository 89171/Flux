import { useState } from 'react'
import { definePlugin, defineAIAdapter, textToDoc } from '@plugin-sdk'
import type { EditorProps, PluginDocument } from '@plugin-sdk'

/**
 * 内置"纯文本"插件 —— 插件系统的最小可用示例。
 * 演示完整封装语法：manifest + editor + serialize/deserialize + aiAdapter + lifecycle。
 */

function PlaintextEditor({ doc, onChange, readonly }: EditorProps<string>): JSX.Element {
  const [text, setText] = useState(doc.content)

  const handleChange = (e: React.ChangeEvent<HTMLTextAreaElement>): void => {
    const next = e.target.value
    setText(next)
    onChange({ ...doc, content: next })
  }

  return (
    <textarea
      value={text}
      onChange={handleChange}
      readOnly={readonly}
      placeholder="在这里开始书写…"
      style={{
        width: '100%',
        height: '100%',
        border: 'none',
        outline: 'none',
        resize: 'none',
        padding: '24px 32px',
        fontSize: '15px',
        lineHeight: '1.8',
        fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace',
        background: 'transparent',
        color: 'inherit'
      }}
    />
  )
}

export default definePlugin<string>({
  manifest: {
    id: 'plaintext',
    name: '@painote/builtin-plaintext',
    version: '1.0.0',
    format: 'plaintext',
    displayName: '纯文本',
    description: '最朴素的文本笔记格式',
    main: 'dist/index.js',
    permissions: ['fs:notes', 'ai:generate', 'storage'],
    builtin: true
  },

  editor: PlaintextEditor,

  serialize: (doc: PluginDocument<string>): string => doc.content,
  deserialize: (raw: string): PluginDocument<string> => textToDoc('plaintext', raw),
  createEmpty: (): PluginDocument<string> => textToDoc('plaintext', ''),

  aiAdapter: defineAIAdapter<string>({
    systemPrompt: '你是一个笔记助手。请直接输出纯文本笔记内容，不要包裹代码块。',
    parse: (text) => textToDoc('plaintext', text.trim()),
    validate: (doc) => typeof doc.content === 'string',
    toContext: (doc) => doc.content
  }),

  lifecycle: {
    onInstall: (ctx) => ctx.logger.info('plaintext 插件安装'),
    onLoad: (ctx) => ctx.logger.info('plaintext 插件已加载'),
    onActivate: (ctx) => ctx.logger.info('plaintext 插件已激活'),
    onDeactivate: () => console.log('[plaintext] 已停用'),
    onUninstall: () => console.log('[plaintext] 已卸载')
  }
})
