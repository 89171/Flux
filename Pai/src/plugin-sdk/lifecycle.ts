export type PluginState =
  | 'uninstalled'
  | 'installed'
  | 'activating'
  | 'active'
  | 'deactivating'
  | 'inactive'
  | 'error'

export interface LifecycleTransition {
  from: PluginState
  to: PluginState
  hook: 'onInstall' | 'onActivate' | 'onDeactivate' | 'onUninstall'
}

export const LIFECYCLE_TRANSITIONS: LifecycleTransition[] = [
  { from: 'uninstalled', to: 'installed', hook: 'onInstall' },
  { from: 'installed', to: 'activating', hook: 'onActivate' },
  { from: 'inactive', to: 'activating', hook: 'onActivate' },
  { from: 'activating', to: 'active', hook: 'onActivate' },
  { from: 'active', to: 'deactivating', hook: 'onDeactivate' },
  { from: 'deactivating', to: 'inactive', hook: 'onDeactivate' },
  { from: 'installed', to: 'uninstalled', hook: 'onUninstall' },
  { from: 'inactive', to: 'uninstalled', hook: 'onUninstall' },
  { from: 'error', to: 'activating', hook: 'onActivate' }
]

export function isValidTransition(from: PluginState, to: PluginState): boolean {
  return LIFECYCLE_TRANSITIONS.some((t) => t.from === from && t.to === to)
}

export function getTransitionHook(from: PluginState, to: PluginState): string | null {
  const transition = LIFECYCLE_TRANSITIONS.find((t) => t.from === from && t.to === to)
  return transition?.hook ?? null
}
