import type { NoteFormat, PluginManifest } from '@shared/types'

export interface PluginLifecycle {
  onInstall?: (context: PluginContext) => void | Promise<void>
  onActivate: (context: PluginContext) => void | Promise<void>
  onDeactivate?: (context: PluginContext) => void | Promise<void>
  onUninstall?: (context: PluginContext) => void | Promise<void>
}

export interface FormatPlugin {
  format: NoteFormat
  render: (content: string, options?: RenderOptions) => RenderResult
  renderEditor: (props: EditorProps) => EditorResult
  validate?: (content: string) => boolean
  getDefaultContent?: () => string
  serialize?: (content: string) => string
  deserialize?: (raw: string) => string
  aiAdapter?: AIFormatAdapter
}

export interface RenderOptions {
  theme?: 'light' | 'dark'
  readonly?: boolean
}

export type RenderResult = string | HTMLElement

export interface EditorProps {
  content: string
  onChange: (content: string) => void
  onSave: () => void
  readonly?: boolean
  theme?: 'light' | 'dark'
}

export type EditorResult = string

export interface AIFormatAdapter {
  systemPrompt: string
  parseResponse: (response: string) => string
  formatContext?: (content: string) => string
}

export interface PluginContext {
  manifest: PluginManifest
  pluginPath: string
  api: PluginAPI
  logger: PluginLogger
}

export interface PluginAPI {
  readFile: (path: string) => Promise<string>
  writeFile: (path: string, content: string) => Promise<void>
  notify: (message: string, type?: 'info' | 'success' | 'warning' | 'error') => void
  registerCommand: (command: PluginCommand) => void
  unregisterCommand: (commandId: string) => void
  getWorkspacePath: () => string
  emit: (event: string, data?: unknown) => void
  on: (event: string, handler: (data: unknown) => void) => void
}

export interface PluginCommand {
  id: string
  title: string
  icon?: string
  handler: () => void
}

export interface PluginLogger {
  info: (...args: unknown[]) => void
  warn: (...args: unknown[]) => void
  error: (...args: unknown[]) => void
  debug: (...args: unknown[]) => void
}

export interface PluginModule extends PluginLifecycle {
  manifest: PluginManifest
  format?: FormatPlugin
}
