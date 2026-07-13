import { create } from 'zustand'
import type { AIConfig } from '@shared'
import type { PluginDocument } from '@plugin-sdk'
import { getPlugin } from '../plugin-host/store'
import { useNotes } from './notes'

export interface ChatMessage {
  role: 'system' | 'user' | 'assistant'
  content: string
}

interface AIStoreState {
  messages: ChatMessage[]
  loading: boolean
  error: string | null
  config: AIConfig | null
  showPanel: boolean
  /** 待应用到笔记的 AI 输出 */
  pendingOutput: string | null

  loadConfig: () => Promise<void>
  saveConfig: (cfg: AIConfig) => Promise<void>
  setPanelOpen: (open: boolean) => void

  /** 发送消息（多轮对话），自动注入当前格式插件的 systemPrompt */
  send: (userText: string, images?: string[]) => Promise<void>
  /** 将 AI 最后输出通过 aiAdapter.parse 转为文档并应用到当前笔记 */
  applyToNote: () => boolean
  /** 清空对话 */
  clearChat: () => void
}

export const useAIStore = create<AIStoreState>((set, get) => ({
  messages: [],
  loading: false,
  error: null,
  config: null,
  showPanel: false,
  pendingOutput: null,

  loadConfig: async () => {
    const cfg = await window.painote.ai.getConfig()
    set({ config: cfg })
  },

  saveConfig: async (cfg) => {
    await window.painote.ai.setConfig(cfg)
    set({ config: cfg })
  },

  setPanelOpen: (open) => set({ showPanel: open }),

  send: async (userText, images) => {
    const { config } = get()
    if (!config) {
      set({ error: '请先配置 AI API' })
      return
    }

    // 获取当前笔记的格式插件及其 AI 适配器
    const notesStore = useNotes.getState()
    const doc = notesStore.doc
    if (!doc) {
      set({ error: '请先选择一条笔记' })
      return
    }

    const plugin = getPlugin(doc.format)
    if (!plugin?.aiAdapter) {
      set({ error: `格式 ${doc.format} 不支持 AI 生成` })
      return
    }

    set({ loading: true, error: null })

    try {
      // 构建对话消息
      const systemMsg: ChatMessage = {
        role: 'system',
        content: plugin.aiAdapter.systemPrompt
      }

      // 当前文档内容作为上下文
      let contextMsg: ChatMessage | null = null
      if (plugin.aiAdapter.toContext) {
        const ctx = plugin.aiAdapter.toContext(doc)
        if (ctx) {
          contextMsg = {
            role: 'system',
            content: `当前笔记内容（供参考修改）：\n${ctx}`
          }
        }
      }

      const userMsg: ChatMessage = {
        role: 'user',
        content: userText
      }

      // 组装完整消息列表
      const allMessages: ChatMessage[] = [
        systemMsg,
        ...(contextMsg ? [contextMsg] : []),
        ...get().messages.filter((m) => m.role !== 'system'),
        userMsg
      ]

      // 如果有图片，走 generate（多模态）
      let response: string
      if (images?.length) {
        response = await window.painote.ai.generate(userText, { images })
      } else {
        response = await window.painote.ai.chat(allMessages)
      }

      // 更新消息列表
      set((s) => ({
        messages: [...s.messages, userMsg, { role: 'assistant', content: response }],
        pendingOutput: response,
        loading: false
      }))
    } catch (e) {
      set({ error: (e as Error).message, loading: false })
    }
  },

  applyToNote: () => {
    const { pendingOutput } = get()
    if (!pendingOutput) return false

    const notesStore = useNotes.getState()
    const doc = notesStore.doc
    if (!doc) return false

    const plugin = getPlugin(doc.format)
    if (!plugin?.aiAdapter) return false

    try {
      const newDoc = plugin.aiAdapter.parse(pendingOutput) as PluginDocument
      // 校验（如果适配器提供了 validate）
      if (plugin.aiAdapter.validate && !plugin.aiAdapter.validate(newDoc)) {
        set({ error: 'AI 输出内容校验未通过，未应用' })
        return false
      }
      // 保留原标题
      newDoc.meta = { ...newDoc.meta, title: doc.meta?.title }
      notesStore.updateDoc(newDoc)
      return true
    } catch (e) {
      set({ error: `应用失败: ${(e as Error).message}` })
      return false
    }
  },

  clearChat: () => set({ messages: [], pendingOutput: null, error: null })
}))
