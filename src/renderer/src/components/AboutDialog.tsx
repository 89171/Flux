/**
 * Flux AboutDialog - Custom About dialog showing Flux branding and version
 * info, replacing Electron's default about panel.
 */

import { useState, useEffect, type CSSProperties } from 'react'
import { Github } from 'lucide-react'
import appIcon from '../assets/app-icon.png'

interface AboutDialogProps {
  onClose: () => void
}

const REPO_URL = 'https://github.com/jianmin-zhu/Flux'

const overlayStyle: CSSProperties = {
  position: 'fixed',
  inset: 0,
  background: 'rgba(0, 0, 0, 0.4)',
  zIndex: 1000,
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center'
}

const modalStyle: CSSProperties = {
  width: 420,
  maxWidth: '92vw',
  background: 'var(--bg-primary)',
  border: '1px solid var(--border-color)',
  borderRadius: 'var(--radius-md, 8px)',
  boxShadow: '0 8px 24px rgba(0, 0, 0, 0.3)',
  overflow: 'hidden',
  display: 'flex',
  flexDirection: 'column'
}

const headerStyle: CSSProperties = {
  padding: '32px 24px 16px',
  textAlign: 'center',
  background: 'var(--bg-secondary)',
  borderBottom: '1px solid var(--border-light)'
}

const appIconStyle: CSSProperties = {
  width: 64,
  height: 64,
  margin: '0 auto 12px',
  borderRadius: 14,
  display: 'block'
}

const appNameStyle: CSSProperties = {
  fontSize: 20,
  fontWeight: 700,
  color: 'var(--text-primary)',
  marginBottom: 4
}

const versionBadgeStyle: CSSProperties = {
  display: 'inline-block',
  padding: '2px 10px',
  borderRadius: 12,
  background: 'var(--bg-active)',
  color: 'var(--text-secondary)',
  fontSize: 'var(--font-size-sm)',
  fontFamily: 'var(--font-mono, monospace)'
}

const bodyStyle: CSSProperties = {
  padding: '20px 24px',
  overflowY: 'auto'
}

const descStyle: CSSProperties = {
  fontSize: 'var(--font-size-sm)',
  color: 'var(--text-secondary)',
  lineHeight: 1.6,
  marginBottom: 20,
  textAlign: 'center'
}

const metaRowStyle: CSSProperties = {
  display: 'flex',
  justifyContent: 'space-between',
  padding: '6px 0',
  fontSize: 'var(--font-size-sm)',
  borderBottom: '1px solid var(--border-light)'
}

const metaLabelStyle: CSSProperties = {
  color: 'var(--text-tertiary)'
}

const metaValueStyle: CSSProperties = {
  color: 'var(--text-primary)',
  fontWeight: 500
}

const footerStyle: CSSProperties = {
  display: 'flex',
  justifyContent: 'space-between',
  alignItems: 'center',
  gap: 8,
  padding: '16px 24px',
  borderTop: '1px solid var(--border-light)',
  background: 'var(--bg-secondary)'
}

const btnBase: CSSProperties = {
  padding: '8px 16px',
  borderRadius: 'var(--radius-sm, 4px)',
  fontSize: 'var(--font-size-sm)',
  fontWeight: 500,
  cursor: 'pointer',
  border: '1px solid var(--border-color)',
  background: 'transparent',
  color: 'var(--text-primary)',
  display: 'inline-flex',
  alignItems: 'center',
  gap: 6
}

const btnPrimary: CSSProperties = {
  ...btnBase,
  background: 'var(--accent-primary)',
  borderColor: 'var(--accent-primary)',
  color: '#fff'
}

export default function AboutDialog({ onClose }: AboutDialogProps) {
  const [version, setVersion] = useState('')

  useEffect(() => {
    window.flux.app.getVersion().then(setVersion)
  }, [])

  useEffect(() => {
    const handler = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') {
        e.preventDefault()
        onClose()
      }
    }
    window.addEventListener('keydown', handler)
    return () => window.removeEventListener('keydown', handler)
  }, [onClose])

  const handleOverlayClick = (e: React.MouseEvent<HTMLDivElement>): void => {
    if (e.target === e.currentTarget) onClose()
  }

  const openRepo = (): void => {
    window.flux.app.openUrl(REPO_URL)
  }

  return (
    <div style={overlayStyle} onClick={handleOverlayClick}>
      <div style={modalStyle}>
        <div style={headerStyle}>
          <img src={appIcon} alt="Flux" style={appIconStyle} />
          <div style={appNameStyle}>Flux</div>
          <span style={versionBadgeStyle}>v{version || '—'}</span>
        </div>

        <div style={bodyStyle}>
          <div style={descStyle}>
            A plugin-based desktop note-taking app with AI and pin-to-top.
          </div>

          <div style={metaRowStyle}>
            <span style={metaLabelStyle}>版本</span>
            <span style={metaValueStyle}>{version || '—'}</span>
          </div>
          <div style={metaRowStyle}>
            <span style={metaLabelStyle}>作者</span>
            <span style={metaValueStyle}>Flux</span>
          </div>
          <div style={metaRowStyle}>
            <span style={metaLabelStyle}>许可证</span>
            <span style={metaValueStyle}>MIT</span>
          </div>
          <div style={{ ...metaRowStyle, borderBottom: 'none' }}>
            <span style={metaLabelStyle}>技术栈</span>
            <span style={metaValueStyle}>Electron · React · TypeScript</span>
          </div>
        </div>

        <div style={footerStyle}>
          <button style={btnBase} onClick={openRepo} title="打开 GitHub 仓库">
            <Github size={14} />
            GitHub
          </button>
          <button style={btnPrimary} onClick={onClose}>
            确定
          </button>
        </div>
      </div>
    </div>
  )
}
