import { basename } from 'path'
import { existsSync, readFileSync } from 'fs'
import type {
  AIRequest,
  AIResponse,
  AIMessage,
  AIConversation,
  NoteFormat
} from '@shared/types'
import type { PluginManager } from './PluginManager'
import { DEFAULT_AI_MODEL, DEFAULT_AI_BASE_URL } from '@shared/constants'

interface AIConfigOptions {
  provider?: 'openai' | 'anthropic' | 'local' | 'none'
  apiKey?: string
  model?: string
  baseUrl?: string
}

interface AIMessageEntry {
  role: string
  content: string
}

interface AICallResult {
  content: string
  usage?: {
    promptTokens: number
    completionTokens: number
  }
}

export class AIService {
  conversations: Map<string, AIConversation> = new Map()
  activeRequests: Map<string, AbortController> = new Map()

  private apiKey: string = ''
  private model: string = DEFAULT_AI_MODEL
  private baseUrl: string = DEFAULT_AI_BASE_URL
  private provider: 'openai' | 'anthropic' | 'local' | 'none' = 'none'

  constructor(private pluginManager: PluginManager) {}

  configure(opts: AIConfigOptions): void {
    if (opts.provider !== undefined) this.provider = opts.provider
    if (opts.apiKey !== undefined) this.apiKey = opts.apiKey
    if (opts.model !== undefined) this.model = opts.model
    if (opts.baseUrl !== undefined) this.baseUrl = opts.baseUrl
  }

  isConfigured(): boolean {
    return this.provider !== 'none' && (this.provider === 'local' || !!this.apiKey)
  }

  async generate(request: AIRequest): Promise<AIResponse> {
    const conversationId = request.conversationId || this.generateConversationId()
    const adapter = this.pluginManager.getAIAdapter(request.format)

    // Build system prompt
    const systemPrompt =
      adapter?.systemPrompt || this.getDefaultSystemPrompt(request.format)

    // Get or create conversation
    let conversation = this.conversations.get(conversationId)
    if (!conversation) {
      conversation = {
        id: conversationId,
        noteId: conversationId,
        messages: [],
        createdAt: Date.now()
      }
      this.conversations.set(conversationId, conversation)
    }

    // Build user message with context
    const userMessage: AIMessage = {
      role: 'user',
      content: request.context
        ? `${request.context}\n\n${request.prompt}`
        : request.prompt,
      timestamp: Date.now()
    }
    conversation.messages.push(userMessage)

    // Build API messages with conversation history
    const apiMessages: AIMessageEntry[] = [
      { role: 'system', content: systemPrompt }
    ]
    for (const msg of conversation.messages) {
      apiMessages.push({ role: msg.role, content: msg.content })
    }

    // Set up abort controller — passed all the way down into fetch so that
    // AIService.cancel() actually terminates the network request instead of
    // just deleting the controller from the map.
    const abortController = new AbortController()
    this.activeRequests.set(conversationId, abortController)

    try {
      const rawResponse = await this.callAI(apiMessages, abortController.signal)

      // Parse response through adapter
      const parsedContent = adapter?.parseResponse
        ? adapter.parseResponse(rawResponse.content)
        : rawResponse.content

      // Add assistant message to conversation
      const assistantMessage: AIMessage = {
        role: 'assistant',
        content: parsedContent,
        timestamp: Date.now()
      }
      conversation.messages.push(assistantMessage)

      return {
        content: parsedContent,
        format: request.format,
        conversationId,
        usage: rawResponse.usage
      }
    } finally {
      this.activeRequests.delete(conversationId)
    }
  }

  async chat(request: AIRequest): Promise<AIResponse> {
    return this.generate(request)
  }

  async transcribe(audioPath: string): Promise<string> {
    if (!this.isConfigured()) {
      throw new Error('AI is not configured')
    }

    if (!existsSync(audioPath)) {
      throw new Error(`Audio file not found: ${audioPath}`)
    }

    if (this.provider === 'openai') {
      return this.transcribeWithOpenAI(audioPath)
    }

    throw new Error(`Transcription not supported for provider: ${this.provider}`)
  }

  private async transcribeWithOpenAI(audioPath: string): Promise<string> {
    const audioBuffer = readFileSync(audioPath)
    const audioBlob = new Blob([audioBuffer])
    const fileName = basename(audioPath)

    const formData = new FormData()
    formData.append('file', audioBlob, fileName)
    formData.append('model', 'whisper-1')

    const response = await fetch(`${this.baseUrl}/audio/transcriptions`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${this.apiKey}`
      },
      body: formData
    })

    if (!response.ok) {
      throw new Error(`Transcription failed: ${response.statusText}`)
    }

    const data = (await response.json()) as { text: string }
    return data.text
  }

  async fileToNote(
    filePath: string,
    format: NoteFormat,
    prompt: string
  ): Promise<AIResponse> {
    if (!existsSync(filePath)) {
      throw new Error(`File not found: ${filePath}`)
    }

    const content = readFileSync(filePath, 'utf-8')
    const fileName = basename(filePath)

    const request: AIRequest = {
      prompt: `${prompt}\n\nFile: ${fileName}\nContent:\n${content}`,
      format,
      context: `Converting file ${fileName} to ${format} format`
    }

    return this.generate(request)
  }

  cancel(conversationId: string): void {
    const controller = this.activeRequests.get(conversationId)
    if (controller) {
      controller.abort()
      this.activeRequests.delete(conversationId)
    }
  }

  getConversation(conversationId: string): AIConversation | undefined {
    return this.conversations.get(conversationId)
  }

  private async callAI(
    messages: AIMessageEntry[],
    signal?: AbortSignal
  ): Promise<AICallResult> {
    if (!this.isConfigured()) {
      return { content: this.generateMockResponse(messages) }
    }

    if (this.provider === 'local') {
      return this.callLocalAI(messages, signal)
    }

    if (this.provider === 'openai') {
      return this.callOpenAI(messages, signal)
    }

    throw new Error(`Unsupported AI provider: ${this.provider}`)
  }

  private async callLocalAI(
    messages: AIMessageEntry[],
    signal?: AbortSignal
  ): Promise<AICallResult> {
    const response = await fetch(`${this.baseUrl}/chat/completions`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: this.model,
        messages
      }),
      signal
    })

    if (!response.ok) {
      throw new Error(`Local AI request failed: ${response.statusText}`)
    }

    const data = (await response.json()) as {
      choices: Array<{ message: { content: string } }>
    }

    return {
      content: data.choices[0]?.message?.content || ''
    }
  }

  private async callOpenAI(
    messages: AIMessageEntry[],
    signal?: AbortSignal
  ): Promise<AICallResult> {
    const response = await fetch(`${this.baseUrl}/chat/completions`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${this.apiKey}`
      },
      body: JSON.stringify({
        model: this.model,
        messages
      }),
      signal
    })

    if (!response.ok) {
      throw new Error(`OpenAI API request failed: ${response.statusText}`)
    }

    const data = (await response.json()) as {
      choices: Array<{ message: { content: string } }>
      usage?: { prompt_tokens: number; completion_tokens: number }
    }

    return {
      content: data.choices[0]?.message?.content || '',
      usage: data.usage
        ? {
            promptTokens: data.usage.prompt_tokens,
            completionTokens: data.usage.completion_tokens
          }
        : undefined
    }
  }

  generateMockResponse(messages: AIMessageEntry[]): string {
    const lastUserMessage = [...messages].reverse().find((m) => m.role === 'user')
    const prompt = lastUserMessage?.content || ''

    // Determine format from the system prompt or message content
    const systemMessage = messages.find((m) => m.role === 'system')
    const systemContent = systemMessage?.content || ''

    if (systemContent.includes('mindmap') || prompt.toLowerCase().includes('mindmap')) {
      return this.generateMockMindmap(prompt)
    }

    if (systemContent.includes('drawio') || prompt.toLowerCase().includes('drawio')) {
      return this.generateMockDrawio(prompt)
    }

    return this.generateMockMarkdown(prompt)
  }

  private generateMockMarkdown(prompt: string): string {
    const topic = prompt.substring(0, 80).replace(/\n/g, ' ').trim() || 'Generated Note'
    return `# AI Generated Note

This is a mock response generated because AI is not configured.

## Topic

${topic}

## Key Points

- First important point about the topic
- Second consideration to keep in mind
- Third item for reference

## Summary

This content was generated as a placeholder. Configure your AI settings in Preferences to get real, intelligent responses tailored to your notes.

## Next Steps

1. Open Settings
2. Navigate to AI configuration
3. Enter your API key
4. Select your preferred model

> **Note:** Mock responses are returned when no AI provider is configured.`
  }

  private generateMockMindmap(prompt: string): string {
    const topic = prompt.substring(0, 50).replace(/\n/g, ' ').trim() || 'Central Topic'
    return `# ${topic}
## Main Branch 1
### Sub-branch 1.1
### Sub-branch 1.2
## Main Branch 2
### Sub-branch 2.1
### Sub-branch 2.2
## Main Branch 3
### Sub-branch 3.1`
  }

  private generateMockDrawio(prompt: string): string {
    const topic = prompt.substring(0, 30).replace(/\n/g, ' ').trim() || 'Central'
    return `<mxfile host="app.diagrams.net" modified="2024-01-01T00:00:00.000Z" agent="PaiNote" version="1.0.0">
  <diagram name="Page-1" id="mock-diagram">
    <mxGraphModel dx="800" dy="600" grid="1" gridSize="10" guides="1" tooltips="1" connect="1" arrows="1" fold="1" page="1" pageScale="1" pageWidth="850" pageHeight="1100" math="0" shadow="0">
      <root>
        <mxCell id="0"/>
        <mxCell id="1" parent="0"/>
        <mxCell id="2" value="${topic}" style="ellipse;whiteSpace=wrap;html=1;fillColor=#dae8fc;strokeColor=#6c8ebf;" vertex="1" parent="1">
          <mxGeometry x="350" y="500" width="140" height="60" as="geometry"/>
        </mxCell>
        <mxCell id="3" value="Branch 1" style="rounded=1;whiteSpace=wrap;html=1;fillColor=#d5e8d4;strokeColor=#82b366;" vertex="1" parent="1">
          <mxGeometry x="100" y="400" width="120" height="40" as="geometry"/>
        </mxCell>
        <mxCell id="4" value="Branch 2" style="rounded=1;whiteSpace=wrap;html=1;fillColor=#fff2cc;strokeColor=#d6b656;" vertex="1" parent="1">
          <mxGeometry x="600" y="400" width="120" height="40" as="geometry"/>
        </mxCell>
        <mxCell id="5" value="Branch 3" style="rounded=1;whiteSpace=wrap;html=1;fillColor=#f8cecc;strokeColor=#b85450;" vertex="1" parent="1">
          <mxGeometry x="350" y="650" width="120" height="40" as="geometry"/>
        </mxCell>
        <mxCell id="6" edge="1" parent="1" source="2" target="3">
          <mxGeometry relative="1" as="geometry"/>
        </mxCell>
        <mxCell id="7" edge="1" parent="1" source="2" target="4">
          <mxGeometry relative="1" as="geometry"/>
        </mxCell>
        <mxCell id="8" edge="1" parent="1" source="2" target="5">
          <mxGeometry relative="1" as="geometry"/>
        </mxCell>
      </root>
    </mxGraphModel>
  </diagram>
</mxfile>`
  }

  private getDefaultSystemPrompt(format: NoteFormat): string {
    switch (format) {
      case 'markdown':
        return 'You are a helpful assistant that generates well-formatted Markdown notes. Use headings, lists, and code blocks appropriately.'
      case 'mindmap':
        return 'You are a helpful assistant that generates mind maps. Use # for the central topic, ## for main branches, and ### for sub-branches.'
      case 'drawio':
        return 'You are a helpful assistant that generates draw.io XML diagrams. Return valid mxfile XML with mxGraphModel and mxCell elements.'
      default:
        return 'You are a helpful assistant that generates clear and useful notes.'
    }
  }

  private generateConversationId(): string {
    return `conv_${Date.now()}_${Math.random().toString(36).substring(2, 9)}`
  }
}
