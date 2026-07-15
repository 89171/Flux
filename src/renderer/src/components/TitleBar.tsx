/**
 * Flux Custom Title Bar (macOS traffic-light style)
 *
 * Uses the native macOS traffic-light buttons (red/yellow/green) via
 * `titleBarStyle: 'hidden'` in the main process. This bar provides a
 * draggable region with the app name centered. The left spacer reserves
 * space for the system traffic lights.
 */

import type { CSSProperties } from 'react'

type CSSPropertiesWithAppRegion = CSSProperties & {
  WebkitAppRegion?: 'drag' | 'no-drag' | string
}

/** Width reserved on the left for the macOS traffic-light buttons. */
const TRAFFIC_LIGHT_WIDTH = 78

export function TitleBar() {
  return (
    <div
      style={
        {
          height: 40,
          minHeight: 40,
          display: 'flex',
          alignItems: 'center',
          background: 'var(--bg-secondary)',
          borderBottom: '1px solid var(--border-light)',
          WebkitAppRegion: 'drag',
          userSelect: 'none',
          position: 'relative',
        } as CSSPropertiesWithAppRegion
      }
    >
      {/* Left spacer: reserves space for macOS traffic-light buttons */}
      <div style={{ width: TRAFFIC_LIGHT_WIDTH, flexShrink: 0, height: '100%' }} />

      {/* Centered app name */}
      <div
        style={{
          flex: 1,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          height: '100%',
        }}
      >
        <span
          style={{
            fontSize: 13,
            fontWeight: 600,
            color: 'var(--text-primary)',
            letterSpacing: 0.3,
          }}
        >
          Flux
        </span>
      </div>

      {/* Right spacer: balances the left for visual symmetry */}
      <div style={{ width: TRAFFIC_LIGHT_WIDTH, flexShrink: 0, height: '100%' }} />
    </div>
  )
}
