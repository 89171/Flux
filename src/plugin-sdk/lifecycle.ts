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
  // Install path
  { from: 'uninstalled', to: 'installed', hook: 'onInstall' },

  // Activate path
  { from: 'installed', to: 'activating', hook: 'onActivate' },
  { from: 'inactive', to: 'activating', hook: 'onActivate' },
  { from: 'error', to: 'activating', hook: 'onActivate' },
  { from: 'activating', to: 'active', hook: 'onActivate' },

  // Deactivate path
  { from: 'active', to: 'deactivating', hook: 'onDeactivate' },
  { from: 'deactivating', to: 'inactive', hook: 'onDeactivate' },
  // A failing deactivate leaves us in 'error' from which activate can retry.
  { from: 'deactivating', to: 'error', hook: 'onDeactivate' },

  // Uninstall path — need to allow uninstalling from every non-terminal
  // state; users may click "remove" on a plugin that failed to activate
  // or is currently active. The manager stops → then removes; the state
  // machine mirrors that.
  { from: 'installed', to: 'uninstalled', hook: 'onUninstall' },
  { from: 'inactive', to: 'uninstalled', hook: 'onUninstall' },
  { from: 'active', to: 'uninstalled', hook: 'onUninstall' },
  { from: 'error', to: 'uninstalled', hook: 'onUninstall' }
]

export function isValidTransition(from: PluginState, to: PluginState): boolean {
  return LIFECYCLE_TRANSITIONS.some((t) => t.from === from && t.to === to)
}

export function getTransitionHook(from: PluginState, to: PluginState): string | null {
  const transition = LIFECYCLE_TRANSITIONS.find((t) => t.from === from && t.to === to)
  return transition?.hook ?? null
}
