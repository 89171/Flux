import type { AIAdapter, PluginDocument } from './types'

/**
 * AI 适配器构造辅助函数：提供类型推导与基本校验。
 *
 * 用法（插件内）：
 *   export const aiAdapter = defineAIAdapter<string>({
 *     systemPrompt: '你是一个 Markdown 写作助手，请输出纯 Markdown。',
 *     parse: (text) => ({ format: 'markdown', content: text }),
 *     validate: (doc) => typeof doc.content === 'string'
 *   })
 */
export function defineAIAdapter<T>(adapter: AIAdapter<T>): AIAdapter<T> {
  if (!adapter.systemPrompt || typeof adapter.parse !== 'function') {
    throw new Error('[PaiNote SDK] AIAdapter 必须包含 systemPrompt 与 parse')
  }
  return adapter
}

/**
 * 通用：把一段纯文本包装成最朴素的 PluginDocument（content 即字符串）。
 * 供文本类格式（Markdown / Plaintext）复用。
 */
export function textToDoc(format: string, text: string): PluginDocument<string> {
  return { format, content: text }
}
