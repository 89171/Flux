/**
 * Flux UpdateDialog - Modal that checks for app updates via GitHub Releases.
 *
 * Auto-triggers a check on mount and shows one of four states:
 * checking / has-update / up-to-date / error. No auto-download — the
 * "Download" button opens the release page in the user's browser.
 */

import { useState, useEffect, type CSSProperties } from 'react'
import { RefreshCw, Download, CheckCircle, AlertCircle, ExternalLink } from 'lucide-react'
import type { UpdateCheckResult } from '@shared/types'

interface UpdateDialogProps {
  onClose: () => void
}

type State = 'checking' | 'has-update' | 'up-to-date' | 'error'

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
  width: 460,
  maxWidth: '92vw',
  maxHeight: '80vh',
  background: 'var(--bg-primary)',
  border: '1px solid var(--border-color)',
  borderRadius: 'var(--radius-md, 8px)',
  boxShadow: '0 8px 24px rgba(0, 0, 0, 0.3)',
  overflow: 'hidden',
  display: 'flex',
  flexDirection: 'column'
}

const bodyStyle: CSSProperties = {
  padding: '24px',
  overflowY: 'auto'
}

const titleStyle: CSSProperties = {
  fontSize: 'var(--font-size-lg, 16px)',
  fontWeight: 600,
  color: 'var(--text-primary)',
  marginBottom: 12,
  display: 'flex',
  alignItems: 'center',
  gap: 8
}

const versionStyle: CSSProperties = {
  fontSize: 'var(--font-size-sm)',
  color: 'var(--text-secondary)',
  marginBottom: 16,
  fontFamily: 'var(--font-mono, monospace)'
}

const releaseNotesStyle: CSSProperties = {
  background: 'var(--bg-secondary)',
  border: '1px solid var(--border-light)',
  borderRadius: 'var(--radius-sm, 4px)',
  padding: 12,
  maxHeight: 220,
  overflowY: 'auto',
  fontSize: 'var(--font-size-sm)',
  color: 'var(--text-secondary)',
  whiteSpace: 'pre-wrap',
  wordBreak: 'break-word',
  fontFamily: 'var(--font-sans)',
  marginBottom: 16,
  lineHeight: 1.6
}

const footerStyle: CSSProperties = {
  display: 'flex',
  justifyContent: 'flex-end',
  gap: 8
}

const btnBase: CSSProperties = {
  padding: '8px 16px',
  borderRadius: 'var(--radius-sm, 4px)',
  fontSize: 'var(--font-size-sm)',
  fontWeight: 500,
  cursor: 'pointer',
  border: '1px solid var(--border-color)',
  background: 'transparent',
  color: 'var(--text-primary)'
}

const btnPrimary: CSSProperties = {
  ...btnBase,
  background: 'var(--accent-primary)',
  borderColor: 'var(--accent-primary)',
  color: '#fff'
}

export default function UpdateDialog({ onClose }: UpdateDialogProps) {
  const [state, setState] = useState<State>('checking')
  const [result, setResult] = useState<UpdateCheckResult | null>(null)

  const runCheck = async (): Promise<void> => {
    setState('checking')
    try {
      const res = await window.flux.app.checkForUpdates()
      setResult(res)
      if (res.latestVersion === '') {
        // Handler returns empty latestVersion on failure — treat as error
        setState('error')
      } else if (res.hasUpdate) {
        setState('has-update')
      } else {
        setState('up-to-date')
      }
    } catch (err) {
      console.error('Update check failed:', err)
      setState('error')
    }
  }

  useEffect(() => {
    runCheck()
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

  const openReleaseUrl = (): void => {
    if (result?.releaseUrl) {
      window.flux.app.openUrl(result.releaseUrl)
    }
  }

  return (
    <div style={overlayStyle} onClick={handleOverlayClick}>
      <div style={modalStyle}>
        <div style={bodyStyle}>
          {state === 'checking' && (
            <>
              <h3 style={titleStyle}>
                <RefreshCw size={18} style={{ animation: 'spin 1s linear infinite' }} />
                正在检查更新…
              </h3>
              <div style={{ ...versionStyle, marginBottom: 0 }}>
                正在从 GitHub Releases 获取最新版本信息
              </div>
            </>
          )}

          {state === 'has-update' && result && (
            <>
              <h3 style={titleStyle}>
                <Download size={18} style={{ color: 'var(--accent-primary)' }} />
                发现新版本
              </h3>
              <div style={versionStyle}>
                <span style={{ color: 'var(--text-tertiary)' }}>当前版本：</span>
                {result.currentVersion}
                <span style={{ margin: '0 8px', color: 'var(--text-tertiary)' }}>→</span>
                <span style={{ color: 'var(--accent-primary)', fontWeight: 600 }}>
                  {result.latestVersion}
                </span>
              </div>
              {result.releaseNotes && (
                <>
                  <div
                    style={{
                      fontSize: 'var(--font-size-sm)',
                      color: 'var(--text-tertiary)',
                      marginBottom: 6
                    }}
                  >
                    发布说明
                  </div>
                  <pre style={releaseNotesStyle}>{result.releaseNotes}</pre>
                </>
              )}
              <div style={footerStyle}>
                <button style={btnBase} onClick={onClose}>
                  稍后再说
                </button>
                <button style={btnPrimary} onClick={openReleaseUrl}>
                  <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
                    <ExternalLink size={14} />
                    前往下载
                  </span>
                </button>
              </div>
            </>
          )}

          {state === 'up-to-date' && result && (
            <>
              <h3 style={titleStyle}>
                <CheckCircle size={18} style={{ color: 'var(--success, #22c55e)' }} />
                已是最新版本
              </h3>
              <div style={{ ...versionStyle, marginBottom: 0 }}>
                当前版本 {result.currentVersion} 已是最新
              </div>
              <div style={{ ...footerStyle, marginTop: 16 }}>
                <button style={btnPrimary} onClick={onClose}>
                  确定
                </button>
              </div>
            </>
          )}

          {state === 'error' && (
            <>
              <h3 style={titleStyle}>
                <AlertCircle size={18} style={{ color: 'var(--danger, #ef4444)' }} />
                检查失败
              </h3>
              <div style={{ ...versionStyle, marginBottom: 0 }}>
                无法连接到 GitHub Releases 获取更新信息。请检查网络连接后重试。
              </div>
              <div style={{ ...footerStyle, marginTop: 16 }}>
                <button style={btnBase} onClick={onClose}>
                  关闭
                </button>
                <button style={btnPrimary} onClick={runCheck}>
                  <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
                    <RefreshCw size={14} />
                    重试
                  </span>
                </button>
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  )
}
