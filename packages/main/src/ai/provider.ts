import { app } from 'electron'
import { join } from 'path'
import { existsSync, readFileSync, writeFileSync, mkdirSync } from 'fs'
import type { AIConfig } from '@shared'

/**
 * AIProvider — OpenAI 兼容 API 客户端。
 *
 * 支持：
 *  - 单次生成 generate(prompt, opts)
 *  - 多轮对话 chat(messages)
 *  - 多模态输入：图片（base64）、文件（文本提取）
 *  - 配置持久化（baseURL / apiKey / model 存储在 userData/ai-config.json）
 *
 * 兼容所有 OpenAI 格式的 API（OpenAI / Azure OpenAI / 通义千问 / Moonshot / Ollama 等）。
 */

interface ChatMessage {
  role: 'system' | 'user' | 'assistant'
  content: string | Array<
    | { type: 'text'; text: string }
    | { type: 'image_url'; image_url: { url: string } }
  >
}

class AIProvider {
  private config: AIConfig | null = null
  private configPath: string

  constructor() {
    const configDir = join(app.getPath('userData'), 'ai-config')
    if (!existsSync(configDir)) mkdirSync(configDir, { recursive: true })
    this.configPath = join(configDir, 'config.json')
    this.loadConfig()
  }

  private loadConfig(): void {
    if (!existsSync(this.configPath)) return
    try {
      this.config = JSON.parse(readFileSync(this.configPath, 'utf-8')) as AIConfig
    } catch {
      this.config = null
    }
  }

  getConfig(): AIConfig | null {
    return this.config
  }

  setConfig(cfg: AIConfig): void {
    this.config = cfg
    writeFileSync(this.configPath, JSON.stringify(cfg, null, 2), 'utf-8')
  }

  private ensureConfig(): AIConfig {
    if (!this.config || !this.config.baseURL || !this.config.apiKey) {
      throw new Error('AI 未配置：请在设置中填写 API Base URL 和 API Key')
    }
    return this.config
  }

  /**
   * 单次生成。
   * @param prompt 用户提示词
   * @param opts 可选图片/文件路径列表
   */
  async generate(
    prompt: string,
    opts?: { images?: string[]; files?: string[] }
  ): Promise<string> {
    const cfg = this.ensureConfig()

    // 构建消息内容
    const content = await this.buildContent(prompt, opts)

    const messages: ChatMessage[] = [
      { role: 'user', content }
    ]

    return this.callAPI(cfg, messages)
  }

  /**
   * 多轮对话。
   * @param messages 对话历史（含 system / user / assistant）
   */
  async chat(
    messages: Array<{ role: 'system' | 'user' | 'assistant'; content: string }>
  ): Promise<string> {
    const cfg = this.ensureConfig()
    return this.callAPI(cfg, messages as ChatMessage[])
  }

  // ---------- 内部方法 ----------

  /**
   * 构建多模态消息内容。
   * 图片转 base64 data URL，文件提取文本后拼接到 prompt。
   */
  private async buildContent(
    prompt: string,
    opts?: { images?: string[]; files?: string[] }
  ): Promise<ChatMessage['content']> {
    const parts: Array<
      | { type: 'text'; text: string }
      | { type: 'image_url'; image_url: { url: string } }
    > = []

    // 文件文本提取
    let fileContext = ''
    if (opts?.files?.length) {
      for (const filePath of opts.files) {
        try {
          const text = readFileSync(filePath, 'utf-8')
          fileContext += `\n\n--- 文件: ${filePath} ---\n${text}\n--- 文件结束 ---`
        } catch {
          fileContext += `\n\n[无法读取文件: ${filePath}]`
        }
      }
    }

    parts.push({ type: 'text', text: prompt + (fileContext ? `\n${fileContext}` : '') })

    // 图片：支持文件路径和 data: URL 两种形式
    if (opts?.images?.length) {
      for (const img of opts.images) {
        // data: URL 直接使用（来自渲染进程 FileReader）
        if (img.startsWith('data:')) {
          parts.push({ type: 'image_url', image_url: { url: img } })
          continue
        }
        // 文件路径：读取后转 base64
        try {
          const buf = readFileSync(img)
          const b64 = buf.toString('base64')
          const ext = img.toLowerCase().split('.').pop()
          const mime =
            ext === 'png' ? 'image/png' :
            ext === 'gif' ? 'image/gif' :
            ext === 'webp' ? 'image/webp' :
            'image/jpeg'
          parts.push({
            type: 'image_url',
            image_url: { url: `data:${mime};base64,${b64}` }
          })
        } catch {
          // 跳过无法读取的图片
        }
      }
    }

    // 如果没有图片，简化为纯文本
    if (!opts?.images?.length) {
      return (parts[0] as { type: 'text'; text: string }).text
    }
    return parts
  }

  /** 调用 OpenAI 兼容 API */
  private async callAPI(cfg: AIConfig, messages: ChatMessage[]): Promise<string> {
    const url = `${cfg.baseURL.replace(/\/+$/, '')}/v1/chat/completions`

    const body = JSON.stringify({
      model: cfg.model,
      messages,
      stream: false,
      temperature: 0.7
    })

    const resp = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${cfg.apiKey}`
      },
      body
    })

    if (!resp.ok) {
      const errText = await resp.text().catch(() => resp.statusText)
      throw new Error(`AI API 错误 ${resp.status}: ${errText}`)
    }

    const data = (await resp.json()) as {
      choices?: Array<{ message?: { content?: string } }>
      error?: { message?: string }
    }

    if (data.error) {
      throw new Error(`AI API 返回错误: ${data.error.message ?? '未知错误'}`)
    }

    const content = data.choices?.[0]?.message?.content
    if (!content) {
      throw new Error('AI API 返回空内容')
    }
    return content
  }
}

// 单例
let _instance: AIProvider | null = null

export function getAIProvider(): AIProvider {
  if (!_instance) _instance = new AIProvider()
  return _instance
}
