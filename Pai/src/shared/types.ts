/**
 * PaiNote Shared Types
 */

// ============ Note & File Types ============

export interface NoteFile {
  id: string
  name: string
  path: string
  type: 'file' | 'directory'
  format?: NoteFormat
  content?: string
  children?: NoteFile[]
  createdAt: number
  updatedAt: number
}

export type NoteFormat = 'markdown' | 'drawio' | 'mindmap' | 'plaintext' | string

// ============ Plugin System Types ============

export interface PluginManifest {
  id: string
  name: string
  version: string
  author: string
  description: string
  type: 'format' | 'tool' | 'theme'
  extensions?: string[]
  main: string
  icon?: string
  builtin?: boolean
  minAppVersion?: string
  homepage?: string
  license?: string
}

export type PluginStatus = 'installed' | 'active' | 'inactive' | 'error' | 'installing'

export interface PluginInfo extends PluginManifest {
  status: PluginStatus
  installPath: string
  isBuiltin: boolean
  errorMessage?: string
}

// ============ Window Types ============

export interface NoteWindowState {
  noteId: string
  notePath: string
  noteName: string
  format: NoteFormat
  isPinned: boolean
  opacity: number
  bounds: { x: number; y: number; width: number; height: number }
}

export interface PinConfig {
  alwaysOnTop: boolean
  opacity: number
  autoCollapse: boolean
  autoLaunch: boolean
}

// ============ AI Types ============

export interface AIRequest {
  prompt: string
  format: NoteFormat
  context?: string
  attachments?: AIAttachment[]
  conversationId?: string
}

export interface AIAttachment {
  type: 'file' | 'image' | 'audio'
  path: string
  name: string
}

export interface AIResponse {
  content: string
  format: NoteFormat
  conversationId: string
  usage?: {
    promptTokens: number
    completionTokens: number
  }
}

export interface AIMessage {
  role: 'user' | 'assistant'
  content: string
  timestamp: number
}

export interface AIConversation {
  id: string
  noteId: string
  messages: AIMessage[]
  createdAt: number
}

// ============ Settings ============

export interface AppSettings {
  workspacePath: string
  ai: {
    provider: 'openai' | 'anthropic' | 'local' | 'none'
    apiKey: string
    model: string
    baseUrl: string
  }
  pin: PinConfig
  theme: 'light' | 'dark'
}
