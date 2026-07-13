import { definePlugin, textToDoc } from '@plugin-sdk'
import type { PluginDocument } from '@plugin-sdk'
import { MarkdownEditor } from './Editor'
import { markdownAIAdapter } from './ai-adapter'

/**
 * 内置 Markdown 插件 —— 第一个正式格式插件。
 * 编辑器：CodeMirror 6 + react-markdown 实时预览（GFM）。
 * 存储：纯 Markdown 字符串。
 * AI：直接生成 Markdown 文本，自动去除整体代码块包裹。
 */
export default definePlugin<string>({
  manifest: {
    id: 'markdown',
    name: '@painote/builtin-markdown',
    version: '1.0.0',
    format: 'markdown',
    displayName: 'Markdown',
    description: 'CodeMirror 6 编辑 + react-markdown 实时预览',
    main: 'dist/index.js',
    permissions: ['fs:notes', 'ai:generate', 'storage'],
    builtin: true
  },

  editor: MarkdownEditor,

  serialize: (doc: PluginDocument<string>): string => doc.content,
  deserialize: (raw: string): PluginDocument<string> => textToDoc('markdown', raw),
  createEmpty: (): PluginDocument<string> =>
    textToDoc('markdown', '# 新笔记\n\n在这里开始你的 Markdown 创作…\n'),

  aiAdapter: markdownAIAdapter,

  lifecycle: {
    onInstall: (ctx) => ctx.logger.info('markdown 插件安装'),
    onLoad: (ctx) => ctx.logger.info('markdown 插件已加载'),
    onActivate: (ctx) => ctx.logger.info('markdown 插件已激活'),
    onDeactivate: () => console.log('[markdown] 已停用'),
    onUninstall: () => console.log('[markdown] 已卸载')
  }
})
