import type { PluginModule, FormatPlugin, PluginManifest, PluginLifecycle, PluginContext } from './types'

export type {
  PluginModule,
  FormatPlugin,
  PluginManifest,
  PluginLifecycle,
  PluginContext,
  PluginAPI,
  PluginCommand,
  PluginLogger,
  RenderOptions,
  RenderResult,
  EditorProps,
  EditorResult,
  AIFormatAdapter
} from './types'

export { LIFECYCLE_TRANSITIONS, isValidTransition, getTransitionHook } from './lifecycle'
export type { PluginState, LifecycleTransition } from './lifecycle'

export function definePlugin(plugin: PluginModule): PluginModule {
  return plugin
}

export function defineFormat(format: FormatPlugin): FormatPlugin {
  return format
}

export function createManifest(manifest: PluginManifest): PluginManifest {
  return manifest
}

export const SDK_VERSION = '1.0.0'
