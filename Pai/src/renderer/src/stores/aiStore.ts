import { create } from 'zustand'
import type { AIMessage, AIRequest } from '@shared/types'

interface AIState {
  isGenerating: boolean
  conversationId: string | null
  messages: AIMessage[]
  error: string | null
  isPanelOpen: boolean
  attachments: Array<{ type: 'file' | 'image' | 'audio'; path: string; name: string }>
  togglePanel: () => void
  openPanel: () => void
  closePanel: () => void
  generate: (prompt: string, format: string, context?: string) => Promise<string | null>
  addAttachment: (attachment: { type: 'file' | 'image' | 'audio'; path: string; name: string }) => void
  clearAttachments: () => void
  clearMessages: () => void
  transcribe: (audioPath: string) => Promise<string | null>
}

export const useAIStore = create<AIState>((set, get) => ({
  isGenerating: false,
  conversationId: null,
  messages: [],
  error: null,
  isPanelOpen: false,
  attachments: [],
  togglePanel: () => set((state) => ({ isPanelOpen: !state.isPanelOpen })),
  openPanel: () => set({ isPanelOpen: true }),
  closePanel: () => set({ isPanelOpen: false }),
  generate: async (prompt, format, context) => {
    set({ isGenerating: true, error: null })
    try {
      const request: AIRequest = {
        prompt,
        format,
        context,
        conversationId: get().conversationId || undefined,
        attachments: get().attachments.length > 0 ? get().attachments : undefined
      }
      const userMsg: AIMessage = { role: 'user', content: prompt, timestamp: Date.now() }
      set((state) => ({ messages: [...state.messages, userMsg] }))
      const result = await window.painote.ai.generate(request)
      if (result.success && result.data) {
        const aiMsg: AIMessage = { role: 'assistant', content: result.data.content, timestamp: Date.now() }
        set((state) => ({ messages: [...state.messages, aiMsg], conversationId: result.data!.conversationId, isGenerating: false }))
        return result.data.content
      } else {
        set({ isGenerating: false, error: result.error || 'AI generation failed' })
        return null
      }
    } catch (err) {
      set({ isGenerating: false, error: err instanceof Error ? err.message : String(err) })
      return null
    }
  },
  addAttachment: (attachment) => set((state) => ({ attachments: [...state.attachments, attachment] })),
  clearAttachments: () => set({ attachments: [] }),
  clearMessages: () => set({ messages: [], conversationId: null }),
  transcribe: async (audioPath) => {
    try {
      const result = await window.painote.ai.transcribe(audioPath)
      if (result.success && result.data) return result.data
      set({ error: result.error || 'Transcription failed' })
      return null
    } catch (err) {
      set({ error: err instanceof Error ? err.message : String(err) })
      return null
    }
  }
}))
