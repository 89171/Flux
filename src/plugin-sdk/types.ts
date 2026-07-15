import type { NoteFormat, PluginManifest, PluginPermission } from '@shared/types'

/**
 * Lifecycle hooks a plugin's `main.js` may implement. All are optional
 * except `onActivate`, which the host calls when the user (or bootstrap)
 * activates the plugin.
 *
 * Hooks run in a Node vm sandbox (main process). They cannot access DOM
 * or React — editor UI is picked from the host's built-in renderers via
 * `manifest.formatBinding`. Renderer-side plugin code is v2 territory.
 */
export interface PluginLifecycle {
  onInstall?: (context: PluginContext) => void | Promise<void>
  onActivate: (context: PluginContext) => void | Promise<void>
  onDeactivate?: (context: PluginContext) => void | Promise<void>
  onUninstall?: (context: PluginContext) => void | Promise<void>
}

/**
 * Optional format-plugin extensions. Only fields that work across the
 * sandbox boundary survived from earlier drafts — anything that needed
 * to ship a DOM node or React element has been removed because the
 * plugin runs in the main process and cannot produce them.
 *
 * Prefer declaring `formatBinding` in the manifest over supplying a
 * FormatPlugin here; the manifest path requires no code at all.
 */
export interface FormatPlugin {
  format: NoteFormat
  validate?: (content: string) => boolean
  getDefaultContent?: () => string
  serialize?: (content: string) => string
  deserialize?: (raw: string) => string
  aiAdapter?: AIFormatAdapter
}

export interface AIFormatAdapter {
  /** System prompt that instructs the AI how to generate content for this format */
  systemPrompt: string
  /** Post-process the AI's raw response (e.g. strip markdown fences, validate XML) */
  parseResponse: (response: string) => string
  /** Format the current document content before sending to AI as context */
  formatContext?: (content: string) => string
  /**
   * Suggested prompts shown in the AI panel when this format is active.
   * Helps users discover what AI can do for this format.
   */
  suggestedPrompts?: string[]
  /**
   * Validate AI-generated content before applying to the document.
   * Returns an error message string if invalid, or null if valid.
   */
  validateResponse?: (response: string) => string | null
}

export interface PluginContext {
  manifest: PluginManifest
  pluginPath: string
  api: PluginAPI
  logger: PluginLogger
}

/**
 * Host-provided API surface for plugins. Every FS-touching method
 * requires the matching `PluginPermission`, declared in the manifest.
 * File paths are resolved relative to the workspace root and pass
 * through the same realpath / traversal guards as core code — a plugin
 * cannot escape the workspace even with fs:read permission.
 */
export interface PluginAPI {
  /** Requires 'fs:read'. Path is relative to workspace root. */
  readFile: (path: string) => Promise<string>
  /** Requires 'fs:write'. Path is relative to workspace root. */
  writeFile: (path: string, content: string) => Promise<void>
  /** Requires 'notifications'. */
  notify: (message: string, type?: 'info' | 'success' | 'warning' | 'error') => void
  /** Requires 'commands'. */
  registerCommand: (command: PluginCommand) => void
  unregisterCommand: (commandId: string) => void
  getWorkspacePath: () => string
  /** Requires 'events'. */
  emit: (event: string, data?: unknown) => void
  /** Requires 'events'. Listener is auto-detached when the plugin deactivates. */
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
  manifest?: PluginManifest
  format?: FormatPlugin
}

export type { PluginPermission }
