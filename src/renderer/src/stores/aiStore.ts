import { create } from 'zustand'
import type { AIMessage, AIToolEvent, AIRequest } from '@shared/types'

interface AIState {
  isGenerating: boolean
  conversationId: string | null
  messages: AIMessage[]
  error: string | null
  isPanelOpen: boolean
  /** True while the current generation has already created a file via tool call. */
  hasActiveFileCreation: boolean
  /** Accumulated text from the current streaming response. Empty when
   *  not generating. The AIPanel renders this live so the user sees
   *  text appear chunk-by-chunk instead of a spinner. */
  streamingContent: string
  attachments: Array<{ type: 'file' | 'image' | 'audio'; path: string; name: string }>
  togglePanel: () => void
  openPanel: () => void
  closePanel: () => void
  generate: (prompt: string, format: string, context?: string) => Promise<string | null>
  cancelGenerate: () => void
  addAttachment: (attachment: { type: 'file' | 'image' | 'audio'; path: string; name: string }) => void
  clearAttachments: () => void
  clearMessages: () => void
  transcribe: (audioPath: string) => Promise<string | null>
}

/** Holds the IPC cleanup function for the active stream so the caller
 *  can cancel listener registration without storing it in React state. */
let streamCleanup: (() => void) | null = null

export const useAIStore = create<AIState>((set, get) => ({
  isGenerating: false,
  conversationId: null,
  messages: [],
  error: null,
  isPanelOpen: false,
  hasActiveFileCreation: false,
  streamingContent: '',
  attachments: [],
  togglePanel: () => set((state) => ({ isPanelOpen: !state.isPanelOpen })),
  openPanel: () => set({ isPanelOpen: true }),
  closePanel: () => set({ isPanelOpen: false }),

  generate: async (prompt, format, context) => {
    set({
      isGenerating: true,
      error: null,
      hasActiveFileCreation: false,
      streamingContent: ''
    })
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

      let fullContent = ''

      // ─── Streaming path ───
      // Each chunk appends to streamingContent so the UI can render
      // progressively. On done, the full text is committed as a
      // finished AIMessage and streamingContent is cleared.
      await new Promise<void>((resolve, reject) => {
        streamCleanup = window.flux.ai.generateStream(
          request,
          (chunk) => {
            fullContent += chunk
            set({ streamingContent: fullContent })
          },
          (conversationId) => {
            set((state) => ({
              messages: [
                ...state.messages,
                {
                  role: 'assistant',
                  content: fullContent,
                  timestamp: Date.now(),
                  hideApplyActions: state.hasActiveFileCreation
                }
              ],
              conversationId: conversationId || get().conversationId,
              isGenerating: false,
              hasActiveFileCreation: false,
              streamingContent: ''
            }))
            streamCleanup = null
            resolve()
          },
          (error) => {
            set({ isGenerating: false, hasActiveFileCreation: false, streamingContent: '', error })
            streamCleanup = null
            reject(new Error(error))
          },
          (toolEvent: AIToolEvent) => {
            const toolMsg: AIMessage = {
              role: 'tool',
              content: toolEvent.result.success
                ? `Created: ${toolEvent.result.filePath}`
                : `Failed: ${toolEvent.result.error}`,
              timestamp: Date.now(),
              toolEvent
            }
            set((state) => ({
              messages: [...state.messages, toolMsg],
              hasActiveFileCreation:
                state.hasActiveFileCreation || toolEvent.tool === 'create_file'
            }))
          }
        )
      })

      return fullContent || null
    } catch (err) {
      set({
        isGenerating: false,
        hasActiveFileCreation: false,
        streamingContent: '',
        error: err instanceof Error ? err.message : String(err)
      })
      return null
    }
  },

  cancelGenerate: () => {
    if (streamCleanup) {
      streamCleanup()
      streamCleanup = null
    }
    set({ isGenerating: false, hasActiveFileCreation: false, streamingContent: '' })
  },

  addAttachment: (attachment) => set((state) => ({ attachments: [...state.attachments, attachment] })),
  clearAttachments: () => set({ attachments: [] }),
  clearMessages: () => set({ messages: [], conversationId: null }),
  transcribe: async (audioPath) => {
    try {
      const result = await window.flux.ai.transcribe(audioPath)
      if (result.success && result.data) return result.data
      set({ error: result.error || 'Transcription failed' })
      return null
    } catch (err) {
      set({ error: err instanceof Error ? err.message : String(err) })
      return null
    }
  }
}))
