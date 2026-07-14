import type { PluginModule, FormatPlugin } from './types'
import type { PluginManifest } from '@shared/types'

export type {
  PluginModule,
  FormatPlugin,
  PluginLifecycle,
  PluginContext,
  PluginAPI,
  PluginCommand,
  PluginLogger,
  AIFormatAdapter,
  PluginPermission
} from './types'
export type { PluginManifest, BuiltinRendererId } from '@shared/types'

export { LIFECYCLE_TRANSITIONS, isValidTransition, getTransitionHook } from './lifecycle'
export type { PluginState, LifecycleTransition } from './lifecycle'

/**
 * Helper for third-party plugin authors: `module.exports = definePlugin({ ... })`.
 * The function itself is an identity — it exists so TypeScript can infer the
 * PluginModule shape at the callsite and surface missing hooks at compile time.
 */
export function definePlugin(plugin: PluginModule): PluginModule {
  return plugin
}

export function defineFormat(format: FormatPlugin): FormatPlugin {
  return format
}

export function createManifest(manifest: PluginManifest): PluginManifest {
  return manifest
}

/**
 * SDK ABI version. Bump the major when a change to the interfaces in
 * `./types` breaks plugins compiled against this SDK. Kept in sync with
 * `SDK_ABI_VERSION` in shared/constants.ts.
 */
export { SDK_ABI_VERSION as SDK_VERSION } from '@shared/constants'
export { SDK_ABI_VERSION } from '@shared/constants'

// Browser-side SDK for iframe editor plugins. Kept in a separate file so
// plugin authors can copy just `browser.ts` into their bundle without
// pulling in the main-process types.
export {
  createPluginEditor,
  type PluginEditorHandle,
  type PluginEditorHandlers,
  type InitPayload,
  type ExternalUpdatePayload,
  type ThemeChangedPayload
} from './browser'
