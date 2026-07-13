import { useEffect, useRef, useState } from 'react'
import { useAIStore } from '../store/ai'
import { useNotes } from '../store/notes'
import { getPlugin } from '../plugin-host/store'
import type { AIConfig } from '@shared'

/**
 * AI 笔记生成面板。
 *
 * 功能：
 *  - 对话式多轮修改（自动注入当前格式插件的 systemPrompt）
 *  - 图片上传（FileReader → base64 → 多模态生成）
 *  - 一键应用到笔记（通过 aiAdapter.parse 转换格式）
 *  - AI 配置（baseURL / apiKey / model）
 */
export function AIPanel(): JSX.Element {
  const { messages, loading, error, config, pendingOutput, send, applyToNote, clearChat, loadConfig, saveConfig, setPanelOpen } =
    useAIStore()
  const { doc } = useNotes()
  const [input, setInput] = useState('')
  const [showSettings, setShowSettings] = useState(false)
  const [images, setImages] = useState<string[]>([])
  const fileInputRef = useRef<HTMLInputElement>(null)
  const scrollRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    void loadConfig()
  }, [loadConfig])

  // 自动滚动到底部
  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight
    }
  }, [messages])

  const plugin = doc ? getPlugin(doc.format) : null
  const hasAdapter = !!plugin?.aiAdapter
  const isConfigured = !!config?.apiKey

  const handleSend = (): void => {
    if (!input.trim() || loading) return
    void send(input.trim(), images.length ? images : undefined)
    setInput('')
    setImages([])
  }

  const handleKeyDown = (e: React.KeyboardEvent): void => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault()
      handleSend()
    }
  }

  const handleImageUpload = (e: React.ChangeEvent<HTMLInputElement>): void => {
    const files = e.target.files
    if (!files) return
    const readers: Promise<string>[] = []
    for (const f of Array.from(files)) {
      readers.push(
        new Promise((resolve) => {
          const reader = new FileReader()
          reader.onload = () => resolve(reader.result as string)
          reader.readAsDataURL(f)
        })
      )
    }
    void Promise.all(readers).then((urls) => {
      setImages((prev) => [...prev, ...urls])
    })
    // 清空 input 以便重复选择同一文件
    e.target.value = ''
  }

  const handleApply = (): void => {
    const ok = applyToNote()
    if (ok) {
      setPanelOpen(false)
    }
  }

  return (
    <div className="ai-panel">
      <div className="ai-header">
        <div className="ai-header-info">
          <span className="ai-title">AI 助手</span>
          <span className="ai-format-tag">
            {doc ? doc.format : '未选择笔记'}
            {hasAdapter ? ' · AI 可用' : ' · 不支持 AI'}
          </span>
        </div>
        <div className="ai-header-actions">
          <button className="ghost ai-icon-btn" onClick={clearChat} title="清空对话">
            清空
          </button>
          <button
            className="ghost ai-icon-btn"
            onClick={() => setShowSettings(!showSettings)}
            title="AI 配置"
          >
            配置
          </button>
          <button className="ghost ai-icon-btn" onClick={() => setPanelOpen(false)} title="关闭">
            关闭
          </button>
        </div>
      </div>

      {showSettings && <AISettings config={config} onSave={(cfg) => { void saveConfig(cfg); setShowSettings(false) }} />}

      {!isConfigured && !showSettings && (
        <div className="ai-banner">
          AI 未配置，请点击"配置"填写 API 信息
        </div>
      )}

      <div className="ai-messages" ref={scrollRef}>
        {messages.length === 0 && (
          <div className="ai-empty">
            <p>告诉 AI 你想生成或修改什么…</p>
            <p className="ai-hint">
              {hasAdapter
                ? 'AI 会自动匹配当前格式输出'
                : '当前格式未提供 AI 适配器'}
            </p>
          </div>
        )}
        {messages.map((msg, i) => (
          <div key={i} className={`ai-msg ${msg.role}`}>
            <div className="ai-msg-label">{msg.role === 'user' ? '我' : 'AI'}</div>
            <div className="ai-msg-content">{msg.content}</div>
          </div>
        ))}
        {loading && <div className="ai-msg assistant"><div className="ai-msg-label">AI</div><div className="ai-msg-content ai-typing">思考中…</div></div>}
        {error && <div className="ai-error">{error}</div>}
      </div>

      {images.length > 0 && (
        <div className="ai-image-preview">
          {images.map((url, i) => (
            <div key={i} className="ai-image-thumb">
              <img src={url} alt="upload" />
              <button
                className="ai-image-remove"
                onClick={() => setImages((prev) => prev.filter((_, idx) => idx !== i))}
              >
                x
              </button>
            </div>
          ))}
        </div>
      )}

      {pendingOutput && (
        <button className="primary ai-apply-btn" onClick={handleApply}>
          应用到笔记
        </button>
      )}

      <div className="ai-input-area">
        <input
          ref={fileInputRef}
          type="file"
          accept="image/*"
          multiple
          style={{ display: 'none' }}
          onChange={handleImageUpload}
        />
        <button
          className="ghost ai-icon-btn"
          onClick={() => fileInputRef.current?.click()}
          title="上传图片"
          disabled={!hasAdapter || !isConfigured}
        >
          图片
        </button>
        <textarea
          className="ai-input"
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={handleKeyDown}
          placeholder="描述你想要的内容…"
          rows={2}
          disabled={loading || !hasAdapter || !isConfigured}
        />
        <button
          className="primary ai-send-btn"
          onClick={handleSend}
          disabled={loading || !input.trim() || !hasAdapter || !isConfigured}
        >
          发送
        </button>
      </div>
    </div>
  )
}

/** AI 配置子组件 */
function AISettings({
  config,
  onSave
}: {
  config: AIConfig | null
  onSave: (cfg: AIConfig) => void
}): JSX.Element {
  const [baseURL, setBaseURL] = useState(config?.baseURL ?? '')
  const [apiKey, setApiKey] = useState(config?.apiKey ?? '')
  const [model, setModel] = useState(config?.model ?? 'gpt-4o')

  return (
    <div className="ai-settings">
      <div className="setting-row">
        <label>API Base URL</label>
        <input
          type="text"
          value={baseURL}
          onChange={(e) => setBaseURL(e.target.value)}
          placeholder="https://api.openai.com"
        />
      </div>
      <div className="setting-row">
        <label>API Key</label>
        <input
          type="password"
          value={apiKey}
          onChange={(e) => setApiKey(e.target.value)}
          placeholder="sk-..."
        />
      </div>
      <div className="setting-row">
        <label>模型</label>
        <input
          type="text"
          value={model}
          onChange={(e) => setModel(e.target.value)}
          placeholder="gpt-4o"
        />
      </div>
      <button
        className="primary"
        onClick={() => onSave({ baseURL, apiKey, model })}
        disabled={!baseURL || !apiKey}
      >
        保存配置
      </button>
    </div>
  )
}
