import { defineAIAdapter, textToDoc } from '@plugin-sdk'

/**
 * Markdown 插件的 AI 适配器。
 * 让 AI 直接输出 Markdown 文本，引擎无需理解格式结构。
 */
export const markdownAIAdapter = defineAIAdapter<string>({
  systemPrompt:
    '你是一个 Markdown 笔记助手。请直接输出 Markdown 内容（支持 GFM：表格、任务列表、代码块等），' +
    '不要用 ```markdown 代码块包裹整体输出，标题用 # 语法。内容应当结构清晰、可读。',
  parse: (text) => {
    // 容错：去掉模型可能整体包裹的 ```markdown ... ``` 包裹
    const trimmed = text.trim()
    const fenced = /^```(?:markdown|md)?\s*\n([\s\S]*?)\n```$/.exec(trimmed)
    const content = fenced ? fenced[1] : trimmed
    return textToDoc('markdown', content)
  },
  validate: (doc) => typeof doc.content === 'string',
  toContext: (doc) => doc.content
})
