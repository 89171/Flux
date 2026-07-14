/**
 * PaiNote Plugin Marketplace Page
 *
 * Full-page plugin marketplace with install bar, plugin cards grid,
 * enable/disable toggle, uninstall, and local plugin loading.
 */

import { useCallback, useState, useEffect, type ReactNode } from 'react'
import {
  Trash2,
  Download,
  BookOpen,
  Package,
  FolderOpen,
  Check,
  AlertCircle,
  ArrowLeft,
  RefreshCw,
  FileText,
  Network,
  GitBranch,
  FileCode,
  LayoutGrid,
  GitMerge,
  Waypoints,
  Workflow,
  Table
} from 'lucide-react'
import { usePluginStore } from '../stores/pluginStore'
import type { PluginInfo, PluginStatus } from '@shared/types'

interface PluginMarketProps {
  onBack: () => void
}

/**
 * Returns a human-readable label for a plugin status.
 */
function statusLabel(status: PluginStatus): string {
  switch (status) {
    case 'active':
      return 'Active'
    case 'installed':
      return 'Available'
    case 'inactive':
      return 'Inactive'
    case 'error':
      return 'Error'
    case 'installing':
      return 'Installing...'
    default:
      return status
  }
}

/**
 * Returns the CSS class suffix for a plugin status badge.
 */
function statusClass(status: PluginStatus): string {
  switch (status) {
    case 'active':
      return 'status-active'
    case 'error':
      return 'status-error'
    case 'installing':
      return 'status-installing'
    default:
      return 'status-inactive'
  }
}

/**
 * Returns the display label for a plugin type.
 */
function typeLabel(type: string): string {
  switch (type) {
    case 'format':
      return 'Format'
    case 'tool':
      return 'Tool'
    case 'theme':
      return 'Theme'
    default:
      return type
  }
}

/**
 * Renders a plugin icon. Supports file:// URLs (img) and lucide icon names.
 */
function renderPluginIcon(icon: string | undefined, size: number = 22): ReactNode {
  if (!icon) return <Package size={size} />
  // File URL or HTTP URL → render as img
  if (icon.startsWith('file://') || icon.startsWith('http')) {
    return (
      <img
        src={icon}
        alt=""
        style={{ width: size, height: size, borderRadius: '4px' }}
      />
    )
  }
  // Lucide icon name → render the matching component
  const iconMap: Record<string, ReactNode> = {
    FileText: <FileText size={size} />,
    Network: <Network size={size} />,
    GitBranch: <GitBranch size={size} />,
    FileCode: <FileCode size={size} />,
    Package: <Package size={size} />,
    LayoutGrid: <LayoutGrid size={size} />,
    GitMerge: <GitMerge size={size} />,
    Waypoints: <Waypoints size={size} />,
    Workflow: <Workflow size={size} />,
    Table: <Table size={size} />
  }
  return iconMap[icon] || <Package size={size} />
}

/**
 * Single plugin card component.
 */
function PluginCard({
  plugin,
  onSetEnabled,
  onUninstall
}: {
  plugin: PluginInfo
  onSetEnabled: (id: string, enabled: boolean) => void
  onUninstall: (id: string) => void
}): JSX.Element {
  const [confirmRemove, setConfirmRemove] = useState(false)
  const isActive = plugin.status === 'active'
  const isError = plugin.status === 'error'
  // Treat transitional states as present so the button stays "Remove"
  // and disabled until the transition completes.
  const isPresent =
    isActive ||
    isError ||
    plugin.status === 'activating' ||
    plugin.status === 'deactivating'
  const isInstalling =
    plugin.status === 'installing' ||
    plugin.status === 'activating' ||
    plugin.status === 'deactivating'

  /**
   * Single action button that switches between Install / Remove based
   * on the current state. Semantics:
   *   - built-in + present  → Remove disables (safe, files stay on disk)
   *   - built-in + removed  → Install re-enables
   *   - user plugin + present → Remove uninstalls (deletes plugin dir)
   *   - user plugin + removed → shouldn't render; row disappears when
   *                             uninstall drops the entry from the list
   *
   * Third-party remove asks for double-click confirmation because it's
   * destructive; built-in remove is one-click because it's reversible.
   */
  const handlePrimaryAction = useCallback(() => {
    if (isPresent) {
      if (plugin.isBuiltin) {
        onSetEnabled(plugin.id, false)
        return
      }
      // Destructive: two-click confirm for third-party uninstall.
      if (confirmRemove) {
        onUninstall(plugin.id)
        setConfirmRemove(false)
      } else {
        setConfirmRemove(true)
        setTimeout(() => setConfirmRemove(false), 3000)
      }
    } else {
      onSetEnabled(plugin.id, true)
    }
  }, [confirmRemove, isPresent, onSetEnabled, onUninstall, plugin.id, plugin.isBuiltin])

  return (
    <div className={`plugin-card ${isError ? 'plugin-card-error' : ''}`}>
      {/* Icon + Name row */}
      <div style={{ display: 'flex', alignItems: 'flex-start', gap: '12px', marginBottom: '12px' }}>
        <div
          className="plugin-card-icon"
          style={{
            width: '42px',
            height: '42px',
            borderRadius: '10px',
            background: 'var(--bg-tertiary)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            fontSize: '18px',
            fontWeight: 700,
            color: 'var(--accent)',
            flexShrink: 0
          }}
        >
          {renderPluginIcon(plugin.icon, 22)}
        </div>
        <div style={{ minWidth: 0, flex: 1 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '8px', flexWrap: 'wrap' }}>
            <h3
              style={{
                margin: 0,
                fontSize: '15px',
                fontWeight: 600,
                color: 'var(--text-primary)',
                overflow: 'hidden',
                textOverflow: 'ellipsis',
                whiteSpace: 'nowrap'
              }}
            >
              {plugin.name}
            </h3>
            <span
              style={{
                fontSize: '11px',
                color: 'var(--text-tertiary)',
                padding: '1px 5px',
                background: 'var(--bg-tertiary)',
                borderRadius: '3px'
              }}
            >
              v{plugin.version}
            </span>
            {plugin.isBuiltin && (
              <span
                title="Bundled with the app — removing only disables it, files stay on disk."
                style={{
                  fontSize: '11px',
                  fontWeight: 600,
                  padding: '1px 6px',
                  borderRadius: '3px',
                  background: 'var(--bg-tertiary)',
                  color: 'var(--accent)',
                  lineHeight: 1.4
                }}
              >
                Built-in
              </span>
            )}
            <span
              className={`plugin-status-badge ${statusClass(plugin.status)}`}
              style={{
                fontSize: '11px',
                fontWeight: 600,
                padding: '2px 6px',
                borderRadius: '4px',
                lineHeight: 1
              }}
            >
              {statusLabel(plugin.status)}
            </span>
          </div>
          <p
            style={{
              margin: '2px 0 0',
              fontSize: '12px',
              color: 'var(--text-tertiary)'
            }}
          >
            {plugin.author}
          </p>
        </div>
      </div>

      {/* Description */}
      <p
        style={{
          margin: '0 0 10px',
          fontSize: '13px',
          lineHeight: 1.5,
          color: 'var(--text-secondary)',
          display: '-webkit-box',
          WebkitLineClamp: 2,
          WebkitBoxOrient: 'vertical',
          overflow: 'hidden'
        }}
      >
        {plugin.description}
      </p>

      {/* Meta info: type + extensions */}
      <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap', marginBottom: '12px' }}>
        <span
          style={{
            fontSize: '11px',
            padding: '2px 8px',
            borderRadius: '4px',
            background: 'var(--bg-tertiary)',
            color: 'var(--text-tertiary)',
            fontWeight: 500
          }}
        >
          {typeLabel(plugin.type)}
        </span>
        {plugin.extensions && plugin.extensions.length > 0 && (
          plugin.extensions.map((ext) => (
            <span
              key={ext}
              style={{
                fontSize: '11px',
                padding: '2px 6px',
                borderRadius: '4px',
                background: 'var(--bg-tertiary)',
                color: 'var(--text-secondary)',
                fontWeight: 500
              }}
            >
              .{ext}
            </span>
          ))
        )}
      </div>

      {/* Error message */}
      {isError && plugin.errorMessage && (
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: '6px',
            padding: '6px 8px',
            marginBottom: '10px',
            borderRadius: '6px',
            background: 'rgba(239, 68, 68, 0.1)',
            color: '#ef4444',
            fontSize: '12px'
          }}
        >
          <AlertCircle size={14} />
          <span>{plugin.errorMessage}</span>
        </div>
      )}

      {/* Action buttons */}
      <div style={{ display: 'flex', gap: '8px', marginTop: 'auto', paddingTop: '10px', borderTop: '1px solid var(--border-light)' }}>

        {/* Install — visible only when plugin is not active */}
        {!isPresent && (
          <button
            onClick={handlePrimaryAction}
            disabled={isInstalling}
            title="Install plugin"
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: '5px',
              padding: '5px 14px',
              borderRadius: '6px',
              border: '1px solid var(--accent)',
              background: 'var(--accent)',
              color: '#fff',
              cursor: isInstalling ? 'not-allowed' : 'pointer',
              fontSize: '12px',
              fontWeight: 600,
              opacity: isInstalling ? 0.5 : 1,
              transition: 'all 0.15s ease'
            }}
          >
            <Download size={13} />
            Install
          </button>
        )}

        {/* Remove / Disable — visible only when plugin is active */}
        {isPresent && (
          <button
            onClick={handlePrimaryAction}
            disabled={isInstalling}
            title={
              plugin.isBuiltin
                ? 'Disable plugin (files stay bundled, re-installable)'
                : confirmRemove
                  ? 'Click again to confirm — this deletes the plugin dir'
                  : 'Remove plugin'
            }
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: '5px',
              padding: '5px 12px',
              borderRadius: '6px',
              border: '1px solid',
              borderColor: !plugin.isBuiltin && confirmRemove
                ? '#ef4444'
                : 'var(--border-color)',
              background: !plugin.isBuiltin && confirmRemove
                ? '#ef4444'
                : 'transparent',
              color: !plugin.isBuiltin && confirmRemove
                ? '#fff'
                : 'var(--text-secondary)',
              cursor: isInstalling ? 'not-allowed' : 'pointer',
              fontSize: '12px',
              fontWeight: 500,
              opacity: isInstalling ? 0.5 : 1,
              transition: 'all 0.15s ease'
            }}
          >
            <Trash2 size={13} />
            {!plugin.isBuiltin && confirmRemove ? 'Confirm' : 'Remove'}
          </button>
        )}

      </div>
    </div>
  )
}

/**
 * PluginMarket - full-page plugin marketplace.
 */
export default function PluginMarket({ onBack }: PluginMarketProps): JSX.Element {
  const {
    plugins,
    isLoading,
    isInstalling,
    installMessage,
    loadPlugins,
    setPluginEnabled,
    installPlugin,
    uninstallPlugin,
    openDevGuide
  } = usePluginStore()

  // Load plugins on mount
  useEffect(() => {
    loadPlugins()
  }, [loadPlugins])

  // Open directory picker to install a local plugin
  const handleLoadLocal = useCallback(async () => {
    const result = await installPlugin()
    if (result.success) {
      await loadPlugins()
    }
  }, [installPlugin, loadPlugins])

  // Persist the user's enable/disable choice (survives restart) and
  // reconcile runtime state. Handles both first-time enables of opt-in
  // builtins and toggling default-active plugins off.
  const handleSetEnabled = useCallback(
    async (id: string, enabled: boolean) => {
      await setPluginEnabled(id, enabled)
      // Explicitly refresh the list so the card's button state (Install /
      // Remove) updates even if the store's internal refresh races with the
      // re-render.
      await loadPlugins()
    },
    [setPluginEnabled, loadPlugins]
  )

  // Handle plugin uninstall
  const handleUninstall = useCallback(
    async (id: string) => {
      const result = await uninstallPlugin(id)
      if (result.success) {
        await loadPlugins()
      }
    },
    [uninstallPlugin, loadPlugins]
  )

  return (
    <div className="plugin-page" style={{ display: 'flex', flexDirection: 'column', height: '100%', width: '100%' }}>
      {/* Header */}
      <div
        className="plugin-page-header"
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          padding: '12px 20px',
          borderBottom: '1px solid var(--border-light)',
          flexShrink: 0,
          gap: '12px'
        }}
      >
        {/* Left: Back button + Title */}
        <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
          <button
            onClick={onBack}
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: '6px',
              padding: '6px 10px',
              border: 'none',
              borderRadius: '6px',
              background: 'none',
              color: 'var(--text-secondary)',
              cursor: 'pointer',
              fontSize: '13px',
              fontWeight: 500
            }}
          >
            <ArrowLeft size={16} />
            <span>Back</span>
          </button>
          <h1
            style={{
              margin: 0,
              fontSize: '18px',
              fontWeight: 700,
              color: 'var(--text-primary)'
            }}
          >
            Plugin Market
          </h1>
        </div>

        {/* Right: Action buttons */}
        <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
          <button
            onClick={handleLoadLocal}
            disabled={isInstalling}
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: '6px',
              padding: '7px 14px',
              borderRadius: '6px',
              border: 'none',
              background: 'var(--accent)',
              color: '#fff',
              cursor: isInstalling ? 'wait' : 'pointer',
              fontSize: '13px',
              fontWeight: 600,
              opacity: isInstalling ? 0.7 : 1
            }}
          >
            <FolderOpen size={15} />
            Load Local
          </button>
          <button
            onClick={openDevGuide}
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: '6px',
              padding: '7px 14px',
              borderRadius: '6px',
              border: '1px solid var(--border-color)',
              background: 'transparent',
              color: 'var(--text-secondary)',
              cursor: 'pointer',
              fontSize: '13px',
              fontWeight: 500
            }}
          >
            <BookOpen size={15} />
            Plugin Development Guide
          </button>
        </div>
      </div>

      {/* Install message banner */}
      {installMessage && (
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: '8px',
            padding: '8px 20px',
            background: installMessage.startsWith('Installed')
              ? 'var(--bg-tertiary)'
              : 'rgba(239, 68, 68, 0.08)',
            borderBottom: '1px solid var(--border-light)',
            fontSize: '13px',
            color: installMessage.startsWith('Installed')
              ? 'var(--accent)'
              : '#ef4444',
            flexShrink: 0
          }}
        >
          {installMessage.startsWith('Installed') ? (
            <Check size={15} />
          ) : (
            <AlertCircle size={15} />
          )}
          <span>{installMessage}</span>
        </div>
      )}

      {/* Body: plugin grid */}
      <div
        className="plugin-page-body"
        style={{
          flex: 1,
          overflow: 'auto',
          padding: '20px'
        }}
      >
        {isLoading && plugins.length === 0 ? (
          <div
            style={{
              display: 'flex',
              flexDirection: 'column',
              alignItems: 'center',
              justifyContent: 'center',
              height: '100%',
              gap: '12px',
              color: 'var(--text-tertiary)'
            }}
          >
            <RefreshCw size={24} className="spin-icon" />
            <span>Loading plugins...</span>
          </div>
        ) : plugins.length === 0 ? (
          <div
            style={{
              display: 'flex',
              flexDirection: 'column',
              alignItems: 'center',
              justifyContent: 'center',
              height: '100%',
              gap: '16px',
              color: 'var(--text-tertiary)'
            }}
          >
            <Package size={48} strokeWidth={1} />
            <p style={{ fontSize: '15px', fontWeight: 500, margin: 0 }}>No plugins installed</p>
            <p style={{ fontSize: '13px', margin: 0, opacity: 0.7 }}>
              Click "Load Local" to select a plugin directory.
            </p>
          </div>
        ) : (
          <div className="plugin-page-grid">
            {plugins.map((plugin) => (
              <PluginCard
                key={plugin.id}
                plugin={plugin}
                onSetEnabled={handleSetEnabled}
                onUninstall={handleUninstall}
              />
            ))}
          </div>
        )}
      </div>
    </div>
  )
}
