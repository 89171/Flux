/**
 * PaiNote Plugin Marketplace Page
 *
 * Full-page plugin marketplace with install bar, plugin cards grid,
 * enable/disable toggle, uninstall, and local plugin loading.
 */

import { useCallback, useState, useEffect, type ReactNode } from 'react'
import {
  Plus,
  Trash2,
  Power,
  PowerOff,
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
  FileCode
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
 * Returns a fallback icon letter from the plugin name.
 */
function pluginIconLetter(name: string): string {
  return name ? name.charAt(0).toUpperCase() : '?'
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
    Package: <Package size={size} />
  }
  return iconMap[icon] || <Package size={size} />
}

/**
 * Single plugin card component.
 */
function PluginCard({
  plugin,
  onActivate,
  onDeactivate,
  onUninstall
}: {
  plugin: PluginInfo
  onActivate: (id: string) => void
  onDeactivate: (id: string) => void
  onUninstall: (id: string) => void
}): JSX.Element {
  const [confirmUninstall, setConfirmUninstall] = useState(false)
  const isActive = plugin.status === 'active'
  const isError = plugin.status === 'error'
  const isInstalling = plugin.status === 'installing'

  const handleUninstall = useCallback(() => {
    if (confirmUninstall) {
      onUninstall(plugin.id)
      setConfirmUninstall(false)
    } else {
      setConfirmUninstall(true)
      // Auto-cancel confirmation after 3 seconds
      setTimeout(() => setConfirmUninstall(false), 3000)
    }
  }, [confirmUninstall, onUninstall, plugin.id])

  const handleToggle = useCallback(() => {
    if (isActive) {
      onDeactivate(plugin.id)
    } else {
      onActivate(plugin.id)
    }
  }, [isActive, onActivate, onDeactivate, plugin.id])

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
            color: 'var(--accent-primary)',
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
                background: 'var(--accent-primary-dim)',
                color: 'var(--accent-primary)',
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
            background: 'var(--color-error-bg, rgba(239, 68, 68, 0.1))',
            color: 'var(--color-error, #ef4444)',
            fontSize: '12px'
          }}
        >
          <AlertCircle size={14} />
          <span>{plugin.errorMessage}</span>
        </div>
      )}

      {/* Action buttons */}
      <div style={{ display: 'flex', gap: '8px', marginTop: 'auto', paddingTop: '10px', borderTop: '1px solid var(--border-secondary)' }}>
        <button
          onClick={handleToggle}
          disabled={isInstalling || plugin.isBuiltin}
          title={isActive ? 'Disable plugin' : 'Enable plugin'}
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: '5px',
            padding: '5px 12px',
            borderRadius: '6px',
            border: '1px solid var(--border-secondary)',
            background: isActive ? 'var(--accent-primary)' : 'transparent',
            color: isActive ? '#fff' : 'var(--text-secondary)',
            cursor: isInstalling || plugin.isBuiltin ? 'not-allowed' : 'pointer',
            fontSize: '12px',
            fontWeight: 500,
            opacity: isInstalling || plugin.isBuiltin ? 0.5 : 1,
            transition: 'all 0.15s ease'
          }}
        >
          {isActive ? <PowerOff size={13} /> : <Power size={13} />}
          {isActive ? 'Disable' : 'Enable'}
        </button>

        {!plugin.isBuiltin && (
          <button
            onClick={handleUninstall}
            disabled={isInstalling}
            title={confirmUninstall ? 'Click again to confirm uninstall' : 'Uninstall plugin'}
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: '5px',
              padding: '5px 12px',
              borderRadius: '6px',
              border: '1px solid',
              borderColor: confirmUninstall ? 'var(--color-error, #ef4444)' : 'var(--border-secondary)',
              background: confirmUninstall ? 'var(--color-error, #ef4444)' : 'transparent',
              color: confirmUninstall ? '#fff' : 'var(--text-secondary)',
              cursor: isInstalling ? 'not-allowed' : 'pointer',
              fontSize: '12px',
              fontWeight: 500,
              opacity: isInstalling ? 0.5 : 1,
              transition: 'all 0.15s ease'
            }}
          >
            <Trash2 size={13} />
            {confirmUninstall ? 'Confirm' : 'Uninstall'}
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
    activatePlugin,
    deactivatePlugin,
    installPlugin,
    loadLocalPlugin,
    uninstallPlugin,
    openDevGuide
  } = usePluginStore()

  const [installPath, setInstallPath] = useState('')

  // Load plugins on mount
  useEffect(() => {
    loadPlugins()
  }, [loadPlugins])

  // Handle install from directory path
  const handleLoadPath = useCallback(async () => {
    const trimmed = installPath.trim()
    if (!trimmed) return
    const result = await loadLocalPlugin(trimmed)
    if (result.success) {
      setInstallPath('')
    }
  }, [installPath, loadLocalPlugin])

  // Handle install from file dialog
  const handleInstallFromDialog = useCallback(async () => {
    const result = await installPlugin()
    if (result.success) {
      await loadPlugins()
    }
  }, [installPlugin, loadPlugins])

  // Handle load local from file dialog
  const handleLoadLocalDialog = useCallback(async () => {
    const result = await loadLocalPlugin('')
    if (result.success) {
      await loadPlugins()
    }
  }, [loadLocalPlugin, loadPlugins])

  // Handle plugin activate/deactivate
  const handleActivate = useCallback(
    async (id: string) => {
      await activatePlugin(id)
    },
    [activatePlugin]
  )

  const handleDeactivate = useCallback(
    async (id: string) => {
      await deactivatePlugin(id)
    },
    [deactivatePlugin]
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
          borderBottom: '1px solid var(--border-secondary)',
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
            onClick={handleInstallFromDialog}
            disabled={isInstalling}
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: '6px',
              padding: '7px 14px',
              borderRadius: '6px',
              border: 'none',
              background: 'var(--accent-primary)',
              color: '#fff',
              cursor: isInstalling ? 'wait' : 'pointer',
              fontSize: '13px',
              fontWeight: 600,
              opacity: isInstalling ? 0.7 : 1
            }}
          >
            <Plus size={15} />
            Install Plugin
          </button>
          <button
            onClick={handleLoadLocalDialog}
            disabled={isInstalling}
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: '6px',
              padding: '7px 14px',
              borderRadius: '6px',
              border: '1px solid var(--border-secondary)',
              background: 'transparent',
              color: 'var(--text-secondary)',
              cursor: isInstalling ? 'wait' : 'pointer',
              fontSize: '13px',
              fontWeight: 500
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
              border: '1px solid var(--border-secondary)',
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

      {/* Install bar */}
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: '8px',
          padding: '10px 20px',
          borderBottom: '1px solid var(--border-secondary)',
          flexShrink: 0
        }}
      >
        <input
          type="text"
          value={installPath}
          onChange={(e) => setInstallPath(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') handleLoadPath()
          }}
          placeholder="Paste plugin directory path..."
          style={{
            flex: 1,
            padding: '7px 12px',
            borderRadius: '6px',
            border: '1px solid var(--border-secondary)',
            background: 'var(--bg-primary)',
            color: 'var(--text-primary)',
            fontSize: '13px',
            outline: 'none'
          }}
        />
        <button
          onClick={handleLoadPath}
          disabled={isInstalling || !installPath.trim()}
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: '5px',
            padding: '7px 16px',
            borderRadius: '6px',
            border: '1px solid var(--accent-primary)',
            background: 'transparent',
            color: 'var(--accent-primary)',
            cursor: isInstalling || !installPath.trim() ? 'not-allowed' : 'pointer',
            fontSize: '13px',
            fontWeight: 600,
            opacity: isInstalling || !installPath.trim() ? 0.5 : 1
          }}
        >
          {isInstalling ? (
            <>
              <RefreshCw size={14} className="spin-icon" />
              Loading...
            </>
          ) : (
            'Load'
          )}
        </button>
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
              ? 'var(--accent-primary-dim, rgba(59, 130, 246, 0.08))'
              : 'var(--color-error-bg, rgba(239, 68, 68, 0.08))',
            borderBottom: '1px solid var(--border-secondary)',
            fontSize: '13px',
            color: installMessage.startsWith('Installed')
              ? 'var(--accent-primary)'
              : 'var(--color-error, #ef4444)',
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
              Click "Install Plugin" to browse or "Load Local" to load from a directory.
            </p>
          </div>
        ) : (
          <div className="plugin-page-grid">
            {plugins.map((plugin) => (
              <PluginCard
                key={plugin.id}
                plugin={plugin}
                onActivate={handleActivate}
                onDeactivate={handleDeactivate}
                onUninstall={handleUninstall}
              />
            ))}
          </div>
        )}
      </div>
    </div>
  )
}
