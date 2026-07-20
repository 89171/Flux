import { basename, posix } from 'path'
import { existsSync, readFileSync } from 'fs'
import type {
  AIRequest,
  AIResponse,
  AIMessage,
  AIConversation,
  AIToolEvent,
  NoteFormat
} from '@shared/types'
import type { PluginManager } from './PluginManager'
import type { FileSystemManager } from './FileSystemManager'
import { DEFAULT_AI_MODEL, DEFAULT_AI_BASE_URL } from '@shared/constants'

interface AIConfigOptions {
  provider?: 'openai' | 'anthropic' | 'deepseek' | 'kimi' | 'minimax' | 'glm' | 'local' | 'none'
  apiKey?: string
  model?: string
  baseUrl?: string
}

interface AIMessageEntry {
  role: string
  content: string | null
  tool_call_id?: string
  tool_calls?: Array<{
    id: string
    type: 'function'
    function: { name: string; arguments: string }
  }>
}

interface AICallResult {
  content: string
  usage?: {
    promptTokens: number
    completionTokens: number
  }
}

interface AIWithToolsResult {
  content: string
  toolCalls?: Array<{
    id: string
    type: 'function'
    function: { name: string; arguments: string }
  }>
}

const FLUX_TOOLS = [
  {
    type: 'function',
    function: {
      name: 'create_file',
      description: 'Create a new file in the workspace. Only decide the file PATH (with the correct extension); the document body is generated separately and streamed into the file, so do NOT include long content here. Supported extensions: .md (markdown), .todo (kanban board), .mmd (mermaid diagram), .puml (plantuml), .excalidraw, .drawio, .mindmap, .bpmn, .dmn.',
      parameters: {
        type: 'object',
        properties: {
          path: {
            type: 'string',
            description: 'File path relative to workspace root, e.g. "meeting-notes.md" or "projects/todo.todo". Choose a concise, descriptive name with the correct extension.'
          }
        },
        required: ['path']
      }
    }
  }
]

/**
 * System prompt used ONLY for the tool-detection probe. It's deliberately
 * narrow and forceful so OpenAI-compatible models (incl. DeepSeek) reliably
 * emit a create_file tool call when the user asks to create/generate/save a
 * document — instead of just answering with the content inline. Kept
 * separate from the format prompts so it works no matter which file (if any)
 * is currently open. The user's request may be in any language.
 */
const FILE_TOOL_SYSTEM_PROMPT = `You are the file-creation controller for the Flux note app. You have one tool: create_file.

Decide ONLY whether the user's latest message is asking to create, generate, write, or save a new document/file. Examples that MUST trigger create_file: "创建一个Markdown文档…", "帮我生成一个关于X的文件", "写一篇…保存为md", "create a markdown doc about X", "make a todo board for …".

Rules:
- If it is such a request, you MUST call create_file exactly once. Choose a concise filename relative to the workspace root with the correct extension (.md for markdown/articles, .todo for kanban, .mmd for mermaid, .puml for plantuml, .drawio, .mindmap, .bpmn, .dmn). Do NOT include the document body — the content is generated and streamed into the file separately. Do not ask for confirmation.
- If the message is a normal question or chat that does not ask to create a file, do NOT call any tool and reply with an empty message.`

/**
 * Heuristic: does the user's message explicitly ask to create/generate/save a
 * document? Used only as a fallback trigger — when the model's `auto` tool
 * probe declines but the intent is unmistakable, we re-probe with the tool
 * forced. Deliberately keyed on creation *verbs* (not nouns) to avoid firing
 * on questions like "生成的文件在哪" / "how do I create a file".
 */
function looksLikeCreateRequest(text: string): boolean {
  if (!text) return false
  const t = text.toLowerCase()
  // English: a creation verb reasonably near a document/file/diagram noun.
  const enVerb = /\b(create|generate|make|build|draft|compose|write|save)\b/.test(t)
  const enNoun =
    /\b(file|doc|document|note|markdown|md|mindmap|mind map|kanban|todo|board|diagram|chart|flowchart|mermaid|plantuml|drawio|bpmn|dmn)\b/.test(
      t
    )
  if (enVerb && enNoun) return true
  // Chinese: creation verbs, usually self-sufficient (e.g. 创建一个思维导图).
  if (/(创建|新建|生成|做一个|做一份|做一张|建一个|画一个|画一张|画个|帮我写|写一篇|写一个|保存为|存为|导出为)/.test(text)) {
    return true
  }
  return false
}

/**
 * Parse a tool call's `arguments` JSON, tolerating truncation. When a long
 * document overruns the model's token budget the returned string is cut off
 * mid-value, so plain JSON.parse throws "Unterminated string in JSON". In
 * that case we salvage `path` and the partial `content` with a lenient scan
 * so the user still gets a (near-complete) file instead of a hard error.
 */
function parseToolArguments(raw: string): { path?: string; content?: string; truncated: boolean } {
  try {
    const obj = JSON.parse(raw) as Record<string, unknown>
    return {
      path: typeof obj.path === 'string' ? obj.path : undefined,
      content: typeof obj.content === 'string' ? obj.content : undefined,
      truncated: false
    }
  } catch {
    // Salvage: pull "path" (short, almost always intact) then take everything
    // from "content":" to the end, undoing JSON string escaping and dropping a
    // dangling backslash left by the cut.
    const pathMatch = raw.match(/"path"\s*:\s*"((?:[^"\\]|\\.)*)"/)
    const path = pathMatch ? decodeJsonStringBody(pathMatch[1]) : undefined
    let content: string | undefined
    const contentKey = raw.match(/"content"\s*:\s*"/)
    if (contentKey && contentKey.index !== undefined) {
      let body = raw.slice(contentKey.index + contentKey[0].length)
      // If content wasn't the truncated field, trim at its real closing quote.
      const closer = body.match(/(?<!\\)"\s*[,}]\s*$/)
      if (closer && closer.index !== undefined) body = body.slice(0, closer.index)
      body = body.replace(/\\$/, '') // drop trailing lone backslash from the cut
      content = decodeJsonStringBody(body)
    }
    return { path, content, truncated: true }
  }
}

/** Decode the body of a JSON string literal (no surrounding quotes). */
function decodeJsonStringBody(body: string): string {
  try {
    return JSON.parse(`"${body.replace(/\n/g, '\\n').replace(/\r/g, '\\r')}"`) as string
  } catch {
    // Best-effort manual unescape when even that fails.
    return body
      .replace(/\\n/g, '\n')
      .replace(/\\r/g, '\r')
      .replace(/\\t/g, '\t')
      .replace(/\\"/g, '"')
      .replace(/\\\\/g, '\\')
  }
}

function normalizeWorkspacePath(path: string): string {
  return path.trim().replace(/\\/g, '/').replace(/^\/+|\/+$/g, '')
}

function getUniqueWorkspacePath(
  requestedPath: string,
  exists: (path: string) => boolean
): string {
  const normalized = normalizeWorkspacePath(requestedPath)
  if (!exists(normalized)) return normalized

  const dir = posix.dirname(normalized)
  const baseName = posix.basename(normalized)
  const extension = posix.extname(baseName)
  const stem = extension ? baseName.slice(0, -extension.length) : baseName
  const parent = dir === '.' ? '' : dir

  let suffix = 2
  let candidate = ''
  do {
    candidate = parent
      ? posix.join(parent, `${stem} ${suffix}${extension}`)
      : `${stem} ${suffix}${extension}`
    suffix += 1
  } while (exists(candidate))

  return candidate
}

export class AIService {
  conversations: Map<string, AIConversation> = new Map()
  activeRequests: Map<string, AbortController> = new Map()

  private apiKey: string = ''
  private model: string = DEFAULT_AI_MODEL
  private baseUrl: string = DEFAULT_AI_BASE_URL
  private provider: 'openai' | 'anthropic' | 'deepseek' | 'kimi' | 'minimax' | 'glm' | 'local' | 'none' = 'none'

  constructor(private pluginManager: PluginManager, private fsManager?: FileSystemManager) {}

  configure(opts: AIConfigOptions): void {
    if (opts.provider !== undefined) this.provider = opts.provider
    if (opts.apiKey !== undefined) this.apiKey = opts.apiKey
    if (opts.model !== undefined) this.model = opts.model
    if (opts.baseUrl !== undefined) this.baseUrl = opts.baseUrl
  }

  /**
   * Test an unsaved AI configuration with a minimal round-trip request.
   * Temporarily swaps in the candidate config, fires one short "ping"
   * chat, then restores the previously-active config — so a failed test
   * never leaves the service in a broken state for real generate calls.
   *
   * Returns { success: true } on a 2xx response, or { success: false,
   * error } with a human-readable message. The caller (Settings panel)
   * gates Save on this result.
   */
  async testConfig(opts: AIConfigOptions): Promise<{ success: boolean; error?: string }> {
    // 'none' / missing provider is not a configuration we can probe —
    // treat as a skip so the user can still disable AI via Save.
    if (!opts.provider || opts.provider === 'none') {
      return { success: true }
    }

    // For non-local providers an API key is mandatory. Without one,
    // callAI() would silently fall back to the mock responder and we'd
    // report a false positive — so gate explicitly here.
    if (opts.provider !== 'local' && !opts.apiKey) {
      return { success: false, error: 'API key is required' }
    }

    const saved = {
      provider: this.provider,
      apiKey: this.apiKey,
      model: this.model,
      baseUrl: this.baseUrl
    }

    try {
      this.configure(opts)

      // 15s hard cap so a wrong baseUrl / unreachable host doesn't
      // hang the Save button indefinitely. abort → fetch rejects → we
      // surface a friendly "timed out" message.
      const controller = new AbortController()
      const timeout = setTimeout(() => controller.abort(), 15000)
      try {
        await this.callAI(
          [{ role: 'user', content: 'Reply with the single word: ok' }],
          controller.signal
        )
        return { success: true }
      } finally {
        clearTimeout(timeout)
      }
    } catch (err) {
      const raw = err instanceof Error ? err.message : String(err)
      // fetch aborts surface as "The operation was aborted" — make it readable.
      const message =
        raw.includes('aborted') || raw.includes('AbortError')
          ? `Request timed out after 15s — check Base URL and network`
          : raw
      return { success: false, error: message }
    } finally {
      this.provider = saved.provider
      this.apiKey = saved.apiKey
      this.model = saved.model
      this.baseUrl = saved.baseUrl
    }
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

  async *generateStream(
    request: AIRequest,
    onToolExecuted?: (evt: AIToolEvent) => void
  ): AsyncGenerator<string, void, unknown> {
    const conversationId = request.conversationId || this.generateConversationId()
    const adapter = this.pluginManager.getAIAdapter(request.format)
    const systemPrompt = adapter?.systemPrompt || this.getDefaultSystemPrompt(request.format)

    let conversation = this.conversations.get(conversationId)
    if (!conversation) {
      conversation = { id: conversationId, noteId: conversationId, messages: [], createdAt: Date.now() }
      this.conversations.set(conversationId, conversation)
    }

    const userMessage: AIMessage = {
      role: 'user',
      content: request.context ? `${request.context}\n\n${request.prompt}` : request.prompt,
      timestamp: Date.now()
    }
    conversation.messages.push(userMessage)

    let apiMessages: AIMessageEntry[] = [{ role: 'system', content: systemPrompt }]
    for (const msg of conversation.messages) {
      if (msg.role === 'user' || msg.role === 'assistant') {
        apiMessages.push({ role: msg.role, content: msg.content })
      }
    }

    const abortController = new AbortController()
    this.activeRequests.set(conversationId, abortController)

    // Set when the tool probe asks to create a file; the streamed body is
    // written here once generation completes.
    let createFileTarget: { path: string; format: NoteFormat } | null = null

    try {
      // Tool-calling pass: for OpenAI-compatible providers, do a quick
      // non-streaming call with tools to detect if the AI wants to create
      // files. If yes, execute and inject results before streaming the reply.
      if (
        onToolExecuted &&
        this.fsManager &&
        this.isConfigured() &&
        this.provider !== 'anthropic' &&
        this.provider !== 'local' &&
        this.provider !== 'none'
      ) {
        // Probe with a narrow, tool-focused system prompt (not the format
        // prompt) so the model reliably decides to call create_file. Keep
        // the conversation turns for context, drop the original system msg.
        const probeMessages: AIMessageEntry[] = [
          { role: 'system', content: FILE_TOOL_SYSTEM_PROMPT },
          ...apiMessages.filter((m) => m.role !== 'system')
        ]
        let toolsResult = await this.callAIWithTools(probeMessages, abortController.signal)
        // Fallback: the model declined the tool but the user clearly asked to
        // create something — re-probe with the tool forced so the file is
        // actually created instead of silently degrading to a chat reply.
        if (
          (!toolsResult.toolCalls || toolsResult.toolCalls.length === 0) &&
          looksLikeCreateRequest(request.prompt)
        ) {
          console.log('[AIService] auto probe declined but create-intent detected — forcing create_file')
          toolsResult = await this.callAIWithTools(probeMessages, abortController.signal, true)
        }
        const createCall = toolsResult.toolCalls?.find((tc) => tc.function.name === 'create_file')
        if (createCall) {
          // The tool call now carries only the filename (see FLUX_TOOLS) —
          // tiny, so it can't truncate. The document body is produced by the
          // streaming pass below and written to the file, which means long
          // documents stream in cleanly instead of overflowing a single JSON
          // response (the old cause of "Unterminated string in JSON").
          const parsed = parseToolArguments(createCall.function.arguments)
          if (parsed.path && this.fsManager) {
            const uniquePath = getUniqueWorkspacePath(parsed.path, (c) => this.fsManager!.exists(c))
            const created = this.fsManager.createFile(uniquePath, '')
            const targetFormat = this.fsManager.detectFormat(uniquePath)
            createFileTarget = { path: created.path, format: targetFormat }
            onToolExecuted({
              conversationId,
              tool: 'create_file',
              args: { path: created.path },
              result: { success: true, filePath: created.path }
            })
            // Swap to the format-specific prompt so the streamed body matches
            // the new file's type (mindmap outline, mermaid syntax, etc.).
            const targetAdapter = this.pluginManager.getAIAdapter(targetFormat)
            const contentPrompt =
              targetAdapter?.systemPrompt || this.getDefaultSystemPrompt(targetFormat)
            apiMessages = [
              { role: 'system', content: contentPrompt },
              ...apiMessages.filter((m) => m.role === 'user' || m.role === 'assistant')
            ]
          }
        }
      }

      let fullContent = ''
      for await (const chunk of this.callAIStream(apiMessages, abortController.signal)) {
        fullContent += chunk
        yield chunk
      }

      // For a streamed file creation, resolve the body against the target
      // format's adapter (strips ```fences etc.) and write it into the file.
      const writeAdapter = createFileTarget
        ? this.pluginManager.getAIAdapter(createFileTarget.format)
        : adapter
      const parsedContent = writeAdapter?.parseResponse
        ? writeAdapter.parseResponse(fullContent)
        : fullContent
      if (createFileTarget && this.fsManager && parsedContent.trim()) {
        try {
          this.fsManager.writeFile(createFileTarget.path, parsedContent)
        } catch (err) {
          console.error('[AIService] failed to write streamed file content:', err)
        }
      }
      conversation.messages.push({ role: 'assistant', content: parsedContent, timestamp: Date.now() })
    } finally {
      this.activeRequests.delete(conversationId)
    }
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

    if (this.provider === 'anthropic') {
      return this.callAnthropic(messages, signal)
    }

    // All OpenAI-compatible providers share the same Authorization:
    // Bearer <key> header and /chat/completions path. DeepSeek, Kimi
    // (Moonshot), MiniMax, and GLM (Zhipu) all publish OpenAI-compatible
    // endpoints — the only thing that differs is baseUrl + model + apiKey.
    if (
      this.provider === 'openai' ||
      this.provider === 'deepseek' ||
      this.provider === 'kimi' ||
      this.provider === 'minimax' ||
      this.provider === 'glm'
    ) {
      return this.callOpenAI(messages, signal)
    }

    throw new Error(`Unsupported AI provider: ${this.provider}`)
  }

  private async callAnthropic(
    messages: AIMessageEntry[],
    signal?: AbortSignal
  ): Promise<AICallResult> {
    // Extract system message from messages array
    const systemMessage = messages.find(m => m.role === 'system')
    const conversationMessages = messages.filter(m => m.role !== 'system')

    const response = await fetch(`${this.baseUrl}/messages`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': this.apiKey,
        'anthropic-version': '2023-06-01'
      },
      body: JSON.stringify({
        model: this.model,
        max_tokens: 4096,
        system: systemMessage?.content || '',
        messages: conversationMessages.map(m => ({ role: m.role, content: m.content }))
      }),
      signal
    })

    if (!response.ok) {
      throw new Error(`Anthropic API request failed: ${response.statusText}`)
    }

    const data = await response.json() as {
      content: Array<{ type: string; text: string }>
      usage?: { input_tokens: number; output_tokens: number }
    }

    return {
      content: data.content?.[0]?.text || '',
      usage: data.usage
        ? { promptTokens: data.usage.input_tokens, completionTokens: data.usage.output_tokens }
        : undefined
    }
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

  private async *callAIStream(
    messages: AIMessageEntry[],
    signal?: AbortSignal
  ): AsyncGenerator<string, void, unknown> {
    if (!this.isConfigured()) {
      yield this.generateMockResponse(messages)
      return
    }

    // All OpenAI-compatible providers (openai, deepseek, local) support streaming
    const isAnthropic = this.provider === 'anthropic'

    if (isAnthropic) {
      yield* this.callAnthropicStream(messages, signal)
    } else {
      yield* this.callOpenAIStream(messages, signal)
    }
  }

  private async *callOpenAIStream(
    messages: AIMessageEntry[],
    signal?: AbortSignal
  ): AsyncGenerator<string, void, unknown> {
    const headers: Record<string, string> = { 'Content-Type': 'application/json' }
    if (this.provider !== 'local') {
      headers['Authorization'] = `Bearer ${this.apiKey}`
    }

    const response = await fetch(`${this.baseUrl}/chat/completions`, {
      method: 'POST',
      headers,
      body: JSON.stringify({ model: this.model, messages, stream: true }),
      signal
    })

    if (!response.ok) {
      throw new Error(`AI stream request failed: ${response.statusText}`)
    }

    const reader = response.body?.getReader()
    if (!reader) throw new Error('No response body')

    const decoder = new TextDecoder()
    let buffer = ''

    while (true) {
      const { done, value } = await reader.read()
      if (done) break
      buffer += decoder.decode(value, { stream: true })
      const lines = buffer.split('\n')
      buffer = lines.pop() || ''

      for (const line of lines) {
        const trimmed = line.trim()
        if (!trimmed || !trimmed.startsWith('data: ')) continue
        const data = trimmed.slice(6)
        if (data === '[DONE]') return
        try {
          const parsed = JSON.parse(data)
          const delta = parsed.choices?.[0]?.delta?.content
          if (delta) yield delta
        } catch { /* skip malformed chunks */ }
      }
    }
  }

  private async *callAnthropicStream(
    messages: AIMessageEntry[],
    signal?: AbortSignal
  ): AsyncGenerator<string, void, unknown> {
    const systemMessage = messages.find(m => m.role === 'system')
    const conversationMessages = messages.filter(m => m.role !== 'system')

    const response = await fetch(`${this.baseUrl}/messages`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': this.apiKey,
        'anthropic-version': '2023-06-01'
      },
      body: JSON.stringify({
        model: this.model,
        max_tokens: 4096,
        system: systemMessage?.content || '',
        messages: conversationMessages.map(m => ({ role: m.role, content: m.content })),
        stream: true
      }),
      signal
    })

    if (!response.ok) {
      throw new Error(`Anthropic stream request failed: ${response.statusText}`)
    }

    const reader = response.body?.getReader()
    if (!reader) throw new Error('No response body')

    const decoder = new TextDecoder()
    let buffer = ''

    while (true) {
      const { done, value } = await reader.read()
      if (done) break
      buffer += decoder.decode(value, { stream: true })
      const lines = buffer.split('\n')
      buffer = lines.pop() || ''

      for (const line of lines) {
        const trimmed = line.trim()
        if (!trimmed.startsWith('data: ')) continue
        try {
          const parsed = JSON.parse(trimmed.slice(6))
          if (parsed.type === 'content_block_delta' && parsed.delta?.text) {
            yield parsed.delta.text
          }
        } catch { /* skip */ }
      }
    }
  }

  private async callAIWithTools(
    messages: AIMessageEntry[],
    signal?: AbortSignal,
    forceCreateFile = false
  ): Promise<AIWithToolsResult> {
    try {
      // `auto` lets the model decide; when the caller is confident the user
      // asked to create a file (see looksLikeCreateRequest) we pin the choice
      // so providers with flaky auto tool-calling (e.g. DeepSeek) still comply.
      const toolChoice = forceCreateFile
        ? { type: 'function' as const, function: { name: 'create_file' } }
        : 'auto'
      const response = await fetch(`${this.baseUrl}/chat/completions`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${this.apiKey}`
        },
        body: JSON.stringify({
          model: this.model,
          messages,
          tools: FLUX_TOOLS,
          tool_choice: toolChoice,
          // The whole document is returned inside the tool call's `arguments`
          // JSON. Without a high ceiling the model truncates mid-string and
          // the arguments become unparseable JSON. 8192 is DeepSeek's max.
          max_tokens: 8192
        }),
        signal
      })
      if (!response.ok) {
        // Don't swallow — a 400 here usually means the configured model
        // doesn't support function calling (e.g. deepseek-reasoner) or the
        // key/baseUrl is wrong. Log it so file-creation failures are
        // diagnosable instead of silently degrading to a plain answer.
        let body = ''
        try {
          body = await response.text()
        } catch {
          /* ignore */
        }
        console.warn(
          `[AIService] tool probe failed: ${response.status} ${response.statusText} — ${body.slice(0, 500)}`
        )
        return { content: '' }
      }
      const data = (await response.json()) as {
        choices: Array<{
          message: {
            content: string | null
            tool_calls?: Array<{
              id: string
              type: 'function'
              function: { name: string; arguments: string }
            }>
          }
        }>
      }
      const msg = data.choices[0]?.message
      const toolCalls = msg?.tool_calls
      if (!toolCalls || toolCalls.length === 0) {
        console.log('[AIService] tool probe returned no tool_calls (model chose not to create a file)')
      } else {
        console.log(`[AIService] tool probe requested ${toolCalls.length} tool call(s): ${toolCalls.map((t) => t.function.name).join(', ')}`)
      }
      return { content: msg?.content || '', toolCalls }
    } catch (err) {
      // AbortError is expected on cancel; anything else is worth logging.
      if (!(err instanceof Error) || err.name !== 'AbortError') {
        console.warn('[AIService] tool probe threw:', err)
      }
      return { content: '' }
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
    return `<mxfile host="app.diagrams.net" modified="2024-01-01T00:00:00.000Z" agent="Flux" version="1.0.0">
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
        return 'You are an expert Markdown assistant. You can create, edit, and transform Markdown documents. Generate well-structured content with headings, lists, tables, code blocks, and blockquotes. When the user provides existing content, improve or transform it based on their request. Always respond with valid Markdown. When the user asks to create a new file, use the create_file tool with an appropriate filename and content.'
      case 'mermaid':
        return 'You are an expert at creating Mermaid diagrams. Generate valid Mermaid syntax for flowcharts, sequence diagrams, class diagrams, state diagrams, ER diagrams, and Gantt charts. Only output the Mermaid code inside a ```mermaid code block, no explanations. Use proper node shapes, arrow types, and styling. Example flowchart:\n\n```mermaid\nflowchart TD\n    A[Start] --> B{Decision}\n    B -->|Yes| C[Action 1]\n    B -->|No| D[Action 2]\n    C --> E[End]\n    D --> E\n```'
      case 'plantuml':
        return 'You are an expert at creating PlantUML diagrams. Generate valid PlantUML syntax for sequence diagrams, class diagrams, use case diagrams, activity diagrams, component diagrams, and state diagrams. Wrap the PlantUML code between @startuml and @enduml tags. Only output the PlantUML code, no explanations. Example:\n\n@startuml\nstart\n:Action;\nif (Condition?) then (yes)\n  :Do something;\nelse (no)\n  :Do other;\nendif\nstop\n@enduml'
      case 'mindmap':
        return 'You are a helpful assistant that generates mind maps using Markdown headings. Use # for the central topic, ## for main branches, and ### for sub-branches. Keep each heading concise (3-5 words). Generate a well-structured hierarchy with 3-5 main branches.'
      case 'drawio':
        return 'You are an expert at creating draw.io diagrams. Generate valid mxfile XML with mxGraphModel and mxCell elements. Use proper styles for shapes (rectangles, ellipses, rhombus), edges, and labels. Include vertex and edge cells with geometry. Only output the XML, no explanations.'
      case 'bpmn':
        return 'You are an expert at creating BPMN 2.0 diagrams. Generate valid BPMN XML with proper process, startEvent, task, gateway, and endEvent elements. Only output the XML.'
      case 'dmn':
        return 'You are an expert at creating DMN 1.3 decision tables. Generate valid DMN XML with definitions, decision, decisionTable, input, output, and rule elements. Only output the XML.'
      case 'kanban':
        return 'You are a helpful assistant that generates Kanban board content. Create a Markdown-based kanban with columns like ## To Do, ## In Progress, ## Done, and tasks as list items with [ ] or [x] checkboxes.'
      case 'excalidraw':
        return 'You are a helpful assistant that generates Excalidraw-compatible JSON. Generate valid JSON with type, version, elements array, and appState.'
      case 'plaintext':
        return 'You are a helpful assistant. Respond with clear, well-organized plain text.'
      default:
        return 'You are a helpful assistant that generates clear and useful content.'
    }
  }

  generateConversationId(): string {
    return `conv_${Date.now()}_${Math.random().toString(36).substring(2, 9)}`
  }
}
