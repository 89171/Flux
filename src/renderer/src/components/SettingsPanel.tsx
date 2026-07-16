/**
 * Flux Settings Panel
 *
 * Modal settings dialog with three sections:
 *  - Appearance: Light/Dark theme toggle
 *  - AI Configuration: provider, API key, model, base URL
 *  - About: app version
 *
 * Loads current settings via window.flux.settings.get() on mount and
 * persists changes via window.flux.settings.set(). Uses inline styles
 * with CSS variables so it adapts to the active theme automatically.
 */

import { useState, useEffect, useCallback, type CSSProperties } from 'react'
import { X, Save, Sun, Moon, BookOpen, Copy, Check, ExternalLink } from 'lucide-react'
import type { AppSettings } from '@shared/types'
import { API_KEY_SENTINEL } from '@shared/constants'

interface SettingsPanelProps {
  onClose: () => void
  onThemeChange?: (theme: 'light' | 'dark') => void
}

type AIProvider = AppSettings['ai']['provider']
type Theme = 'light' | 'dark'

const PROVIDERS: { value: AIProvider; label: string }[] = [
  { value: 'none', label: 'None' },
  { value: 'openai', label: 'OpenAI' },
  { value: 'deepseek', label: 'DeepSeek' },
  { value: 'kimi', label: 'Moonshot Kimi' },
  { value: 'minimax', label: 'MiniMax' },
  { value: 'glm', label: 'Zhipu GLM' },
  { value: 'anthropic', label: 'Anthropic Claude' },
  { value: 'local', label: 'Local (Ollama/LM Studio)' }
]

/**
 * Configuration guide for mainstream AI providers. Rendered inside the
 * "How to configure" modal — each entry shows the portal URL, the base
 * URL to paste, recommended models, and notes about API key acquisition
 * or compatibility quirks.
 */
interface ProviderGuideEntry {
  name: string
  portal: string
  baseUrl: string
  models: string[]
  notes: string
}

const PROVIDER_GUIDE: ProviderGuideEntry[] = [
  {
    name: 'OpenAI',
    portal: 'https://platform.openai.com/api-keys',
    baseUrl: 'https://api.openai.com/v1',
    models: ['gpt-4o-mini', 'gpt-4o', 'gpt-4.1-mini', 'o1-mini', 'gpt-3.5-turbo'],
    notes:
      'Sign in at platform.openai.com, create an API key (starts with sk-), then paste it above. Billing is usage-based — set a monthly spend limit in the dashboard.'
  },
  {
    name: 'DeepSeek',
    portal: 'https://platform.deepseek.com/api_keys',
    baseUrl: 'https://api.deepseek.com/v1',
    models: ['deepseek-chat', 'deepseek-reasoner', 'deepseek-coder'],
    notes:
      'DeepSeek is OpenAI-API compatible — the same base URL format works. deepseek-reasoner returns chain-of-thought in the response. Recharge credits at platform.deepseek.com.'
  },
  {
    name: 'Moonshot Kimi',
    portal: 'https://platform.moonshot.cn/console/api-keys',
    baseUrl: 'https://api.moonshot.cn/v1',
    models: ['moonshot-v1-8k', 'moonshot-v1-32k', 'moonshot-v1-128k', 'kimi-latest'],
    notes:
      'Kimi exposes an OpenAI-compatible endpoint. Create a key at platform.moonshot.cn. The v1-128k model accepts up to 128K tokens of context — pick the context variant that matches your request size to control cost.'
  },
  {
    name: 'MiniMax',
    portal: 'https://platform.minimaxi.com/user-center/basic-information/interface-key',
    baseUrl: 'https://api.minimaxi.com/v1',
    models: ['MiniMax-Text-01', 'abab6.5s-chat', 'abab6.5-chat'],
    notes:
      'MiniMax offers an OpenAI-compatible /chat/completions endpoint at api.minimaxi.com. Create an API key in the platform console. The international host is api.minimaxi.com; the domestic one is api.minimax.chat — pick the one with lowest latency.'
  },
  {
    name: 'Zhipu GLM',
    portal: 'https://open.bigmodel.cn/usercenter/apikeys',
    baseUrl: 'https://open.bigmodel.cn/api/paas/v4',
    models: ['glm-4-plus', 'glm-4-air', 'glm-4-airx', 'glm-4-long', 'glm-4-flash'],
    notes:
      'Zhipu publishes an OpenAI-compatible endpoint under /api/paas/v4 (NOT /v1). Generate a key at open.bigmodel.cn. glm-4-flash is free-tiered and good for testing; glm-4-plus is the flagship. The Authorization: Bearer <key> header works unchanged.'
  },
  {
    name: 'Anthropic Claude',
    portal: 'https://console.anthropic.com/settings/keys',
    baseUrl: 'https://api.anthropic.com',
    models: ['claude-sonnet-4-20250514', 'claude-opus-4-20250514', 'claude-3-5-haiku-20241022'],
    notes:
      'Create a key at console.anthropic.com. Flux speaks the Anthropic Messages API directly — do NOT append /v1 to the base URL. Verify your account to add credits.'
  },
  {
    name: 'Local — Ollama',
    portal: 'https://ollama.com/download',
    baseUrl: 'http://localhost:11434/v1',
    models: ['llama3', 'qwen2.5', 'gemma2', 'mistral', 'deepseek-r1'],
    notes:
      'Install Ollama, run `ollama pull llama3` in a terminal, then leave the API Key field empty (Ollama ignores it). The OpenAI-compatible endpoint is on port 11434.'
  },
  {
    name: 'Local — LM Studio',
    portal: 'https://lmstudio.ai',
    baseUrl: 'http://localhost:1234/v1',
    models: ['(whatever you loaded in LM Studio)'],
    notes:
      'In LM Studio: download a GGUF model, open the "Local Server" tab, hit Start. The API key field is ignored. Use the model identifier LM Studio prints in its server log.'
  }
]

function SettingsPanel({ onClose, onThemeChange }: SettingsPanelProps) {
  const [loaded, setLoaded] = useState(false)
  const [aiProvider, setAiProvider] = useState<AIProvider>('none')
  // apiKey holds either '' (not set), a new key typed by the user, or
  // API_KEY_SENTINEL (key is set on disk but not echoed to the renderer).
  const [apiKey, setApiKey] = useState('')
  const [model, setModel] = useState('')
  const [baseUrl, setBaseUrl] = useState('')
  const [theme, setTheme] = useState<Theme>('light')
  const [version, setVersion] = useState('')
  const [error, setError] = useState<string | null>(null)
  // Save-flow status. 'testing' = probing the config with a live API
  // call before persisting; 'saving' = writing to disk; 'success' /
  // 'error' = terminal feedback shown inline below the Save button.
  const [saveStatus, setSaveStatus] = useState<'idle' | 'testing' | 'saving' | 'success' | 'error'>('idle')
  const [saveMessage, setSaveMessage] = useState('')
  const [showGuide, setShowGuide] = useState(false)
  const [copiedField, setCopiedField] = useState<string | null>(null)

  // Load current settings + app version on mount
  useEffect(() => {
    let cancelled = false
    ;(async () => {
      try {
        const s = await window.flux.settings.get()
        if (cancelled) return
        setAiProvider(s.ai.provider)
        // Keep the sentinel as-is — the input renders it as a placeholder.
        setApiKey(s.ai.apiKey)
        setModel(s.ai.model)
        setBaseUrl(s.ai.baseUrl)
        setTheme(s.theme)
        setLoaded(true)
      } catch (err) {
        console.error('Failed to load settings:', err)
        setError('Failed to load settings')
        setLoaded(true)
      }
      try {
        const v = await window.flux.app.getVersion()
        if (!cancelled) setVersion(v)
      } catch (err) {
        console.error('Failed to get app version:', err)
      }
    })()
    return () => {
      cancelled = true
    }
  }, [])

  // Escape key closes the modal
  useEffect(() => {
    const handleKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', handleKey)
    return () => window.removeEventListener('keydown', handleKey)
  }, [onClose])

  const handleThemeChange = useCallback(
    async (next: Theme) => {
      if (next === theme) return
      setTheme(next)
      try {
        await window.flux.settings.set({ theme: next })
        onThemeChange?.(next)
      } catch (err) {
        console.error('Failed to save theme:', err)
        setError('Failed to save theme')
      }
    },
    [theme, onThemeChange]
  )

  const handleProviderChange = useCallback((provider: AIProvider) => {
    setAiProvider(provider)
    // Auto-fill defaults when switching providers
    const defaults: Record<string, { model: string; baseUrl: string }> = {
      openai: { model: 'gpt-4o-mini', baseUrl: 'https://api.openai.com/v1' },
      deepseek: { model: 'deepseek-chat', baseUrl: 'https://api.deepseek.com/v1' },
      kimi: { model: 'moonshot-v1-8k', baseUrl: 'https://api.moonshot.cn/v1' },
      minimax: { model: 'MiniMax-Text-01', baseUrl: 'https://api.minimaxi.com/v1' },
      glm: { model: 'glm-4-flash', baseUrl: 'https://open.bigmodel.cn/api/paas/v4' },
      anthropic: { model: 'claude-sonnet-4-20250514', baseUrl: 'https://api.anthropic.com' },
      local: { model: 'llama3', baseUrl: 'http://localhost:11434/v1' }
    }
    const def = defaults[provider]
    if (def) {
      // Only auto-fill if current values look like they belong to another
      // provider. This prevents wiping out a key the user just typed when
      // they tab through the dropdown.
      const knownModels = [
        'gpt-4o-mini',
        'deepseek-chat',
        'moonshot-v1-8k',
        'MiniMax-Text-01',
        'glm-4-flash',
        'claude-sonnet-4-20250514',
        'llama3'
      ]
      const knownUrls = [
        'https://api.openai.com/v1',
        'https://api.deepseek.com/v1',
        'https://api.moonshot.cn/v1',
        'https://api.minimaxi.com/v1',
        'https://open.bigmodel.cn/api/paas/v4',
        'https://api.anthropic.com',
        'http://localhost:11434/v1'
      ]
      if (knownModels.includes(model) || !model) setModel(def.model)
      if (knownUrls.includes(baseUrl) || !baseUrl) setBaseUrl(def.baseUrl)
    }
  }, [model, baseUrl])

  const handleSaveAI = useCallback(async () => {
    setError(null)
    setSaveMessage('')
    setSaveStatus('testing')
    // When the user hasn't typed a new key, echo the sentinel back so the
    // main process preserves the real key instead of overwriting it.
    const effectiveKey = apiKey === API_KEY_SENTINEL ? API_KEY_SENTINEL : apiKey
    try {
      // 1. Probe the candidate config with a live round-trip before
      //    persisting. testConfig swaps the config in temporarily and
      //    restores the live one on return, so a failed probe doesn't
      //    disrupt in-flight AI calls.
      const testResult = await window.flux.ai.testConfig({
        provider: aiProvider,
        apiKey: effectiveKey,
        model,
        baseUrl
      })
      if (!testResult.success) {
        setSaveStatus('error')
        setSaveMessage(testResult.error || 'Configuration test failed')
        return
      }

      // 2. Test passed — persist to disk.
      setSaveStatus('saving')
      await window.flux.settings.set({
        ai: {
          provider: aiProvider,
          apiKey: effectiveKey,
          model,
          baseUrl
        } as AppSettings['ai']
      })
      setSaveStatus('success')
      setSaveMessage('Configuration test passed. Settings saved.')
    } catch (err) {
      console.error('Failed to save AI settings:', err)
      setSaveStatus('error')
      setSaveMessage(
        err instanceof Error ? err.message : 'Failed to save AI settings'
      )
    }
  }, [aiProvider, apiKey, model, baseUrl])

  // Copy a value to the clipboard with brief "copied" feedback so the
  // user knows the click landed.
  const handleCopy = useCallback(async (key: string, value: string) => {
    try {
      await navigator.clipboard.writeText(value)
      setCopiedField(key)
      setTimeout(() => setCopiedField((prev) => (prev === key ? null : prev)), 1200)
    } catch (err) {
      console.error('Clipboard write failed:', err)
    }
  }, [])

  // ─── Styles ───
  const overlayStyle: CSSProperties = {
    position: 'fixed',
    inset: 0,
    background: 'rgba(0, 0, 0, 0.45)',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    zIndex: 1000
  }

  const modalStyle: CSSProperties = {
    width: 520,
    maxHeight: '80vh',
    background: 'var(--bg-primary)',
    borderRadius: 'var(--radius-lg)',
    boxShadow: 'var(--shadow-lg)',
    border: '1px solid var(--border-color)',
    display: 'flex',
    flexDirection: 'column',
    overflow: 'hidden'
  }

  const headerStyle: CSSProperties = {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
    padding: '16px 20px',
    borderBottom: '1px solid var(--border-light)',
    flexShrink: 0
  }

  const bodyStyle: CSSProperties = {
    overflowY: 'auto',
    padding: 20,
    display: 'flex',
    flexDirection: 'column',
    gap: 20
  }

  const sectionStyle: CSSProperties = {
    border: '1px solid var(--border-light)',
    borderRadius: 'var(--radius-md)',
    padding: 16,
    background: 'var(--bg-secondary)'
  }

  const headingStyle: CSSProperties = {
    fontSize: 'var(--font-size-md)',
    fontWeight: 600,
    color: 'var(--text-primary)',
    margin: 0,
    marginBottom: 12
  }

  const labelStyle: CSSProperties = {
    fontSize: 'var(--font-size-sm)',
    color: 'var(--text-secondary)',
    marginBottom: 4,
    display: 'block'
  }

  const inputStyle: CSSProperties = {
    width: '100%',
    boxSizing: 'border-box',
    padding: '6px 10px',
    fontSize: 'var(--font-size-base)',
    color: 'var(--text-primary)',
    background: 'var(--bg-primary)',
    border: '1px solid var(--border-color)',
    borderRadius: 'var(--radius-sm)',
    outline: 'none'
  }

  const rowStyle: CSSProperties = {
    display: 'flex',
    flexDirection: 'column',
    marginBottom: 12
  }

  const themeBtnStyle: CSSProperties = {
    display: 'inline-flex',
    alignItems: 'center',
    gap: 6,
    padding: '6px 14px',
    fontSize: 'var(--font-size-base)',
    borderRadius: 'var(--radius-sm)',
    cursor: 'pointer',
    border: '1px solid var(--border-color)',
    background: 'var(--bg-primary)',
    color: 'var(--text-primary)'
  }

  const themeBtnActiveStyle: CSSProperties = {
    background: 'var(--accent)',
    color: '#ffffff',
    borderColor: 'var(--accent)'
  }

  const errorStyle: CSSProperties = {
    padding: '8px 12px',
    background: 'var(--bg-tertiary)',
    color: 'var(--text-primary)',
    borderRadius: 'var(--radius-md)',
    fontSize: 'var(--font-size-sm)',
    border: '1px solid var(--border-color)'
  }

  return (
    <div style={overlayStyle} onClick={onClose}>
      <div
        style={modalStyle}
        role="dialog"
        aria-modal="true"
        aria-label="Settings"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div style={headerStyle}>
          <span
            style={{
              fontSize: 'var(--font-size-lg)',
              fontWeight: 600,
              color: 'var(--text-primary)'
            }}
          >
            Settings
          </span>
          <button
            className="btn-icon"
            onClick={onClose}
            title="Close (Esc)"
            aria-label="Close"
            style={{ width: 28, height: 28 }}
          >
            <X size={16} />
          </button>
        </div>

        {/* Body */}
        <div style={bodyStyle}>
          {error && <div style={errorStyle}>{error}</div>}

          {/* Appearance */}
          <div style={sectionStyle}>
            <h3 style={headingStyle}>Appearance</h3>
            <div style={{ display: 'flex', gap: 8 }}>
              <button
                style={{
                  ...themeBtnStyle,
                  ...(theme === 'light' ? themeBtnActiveStyle : {})
                }}
                onClick={() => handleThemeChange('light')}
                aria-pressed={theme === 'light'}
              >
                <Sun size={14} /> Light
              </button>
              <button
                style={{
                  ...themeBtnStyle,
                  ...(theme === 'dark' ? themeBtnActiveStyle : {})
                }}
                onClick={() => handleThemeChange('dark')}
                aria-pressed={theme === 'dark'}
              >
                <Moon size={14} /> Dark
              </button>
            </div>
          </div>

          {/* AI Configuration */}
          <div style={sectionStyle}>
            <div
              style={{
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'space-between',
                marginBottom: 12
              }}
            >
              <h3 style={{ ...headingStyle, marginBottom: 0 }}>AI Configuration</h3>
              <button
                type="button"
                className="btn btn-ghost"
                onClick={() => setShowGuide(true)}
                style={{ gap: 6, padding: '4px 10px', fontSize: 'var(--font-size-sm)' }}
                title="Show how to configure mainstream AI providers"
              >
                <BookOpen size={13} /> Configuration Guide
              </button>
            </div>

            <div style={rowStyle}>
              <label style={labelStyle} htmlFor="settings-provider">
                Provider
              </label>
              <select
                id="settings-provider"
                style={inputStyle}
                value={aiProvider}
                onChange={(e) => handleProviderChange(e.target.value as AIProvider)}
                disabled={!loaded}
              >
                {PROVIDERS.map((p) => (
                  <option key={p.value} value={p.value}>
                    {p.label}
                  </option>
                ))}
              </select>
              {aiProvider === 'deepseek' && (
                <div style={{ fontSize: 'var(--font-size-xs)', color: 'var(--text-tertiary)', marginTop: 4 }}>
                  Get your API key at platform.deepseek.com. DeepSeek supports both chat and reasoning models.
                </div>
              )}
            </div>

            <div style={rowStyle}>
              <label style={labelStyle} htmlFor="settings-apikey">
                API Key
              </label>
              <input
                id="settings-apikey"
                type="password"
                style={inputStyle}
                value={apiKey === API_KEY_SENTINEL ? '' : apiKey}
                placeholder={apiKey === API_KEY_SENTINEL ? '••••••••  (configured — type to replace)' : 'sk-...'}
                onChange={(e) => setApiKey(e.target.value)}
                disabled={!loaded}
                autoComplete="off"
              />
            </div>

            <div style={rowStyle}>
              <label style={labelStyle} htmlFor="settings-model">
                Model
              </label>
              <input
                id="settings-model"
                type="text"
                style={inputStyle}
                value={model}
                placeholder="gpt-4o-mini"
                onChange={(e) => setModel(e.target.value)}
                disabled={!loaded}
                autoComplete="off"
              />
            </div>

            <div style={rowStyle}>
              <label style={labelStyle} htmlFor="settings-baseurl">
                Base URL
              </label>
              <input
                id="settings-baseurl"
                type="text"
                style={inputStyle}
                value={baseUrl}
                placeholder="https://api.openai.com/v1"
                onChange={(e) => setBaseUrl(e.target.value)}
                disabled={!loaded}
                autoComplete="off"
              />
            </div>

            <button
              className="btn btn-primary"
              onClick={handleSaveAI}
              disabled={!loaded || saveStatus === 'testing' || saveStatus === 'saving'}
              style={{ gap: 6, padding: '6px 14px', alignSelf: 'flex-start' }}
            >
              <Save size={14} />
              {saveStatus === 'testing'
                ? 'Testing...'
                : saveStatus === 'saving'
                  ? 'Saving...'
                  : 'Save'}
            </button>

            {/* Save-flow feedback. 'testing'/'saving' are neutral info,
                'success' is affirmative, 'error' is a problem. The
                message clears on the next Save click. */}
            {saveStatus !== 'idle' && saveMessage && (
              <div
                style={{
                  marginTop: 8,
                  padding: '6px 10px',
                  fontSize: 'var(--font-size-xs)',
                  borderRadius: 'var(--radius-sm)',
                  border: '1px solid',
                  display: 'flex',
                  alignItems: 'center',
                  gap: 6,
                  ...(saveStatus === 'success'
                    ? {
                        color: 'var(--text-primary)',
                        background: 'var(--bg-tertiary)',
                        borderColor: 'var(--border-color)'
                      }
                    : saveStatus === 'error'
                      ? {
                          color: 'var(--text-primary)',
                          background: 'var(--bg-active)',
                          borderColor: 'var(--text-secondary)'
                        }
                      : {
                          color: 'var(--text-secondary)',
                          background: 'var(--bg-secondary)',
                          borderColor: 'var(--border-light)'
                        })
                }}
              >
                {saveStatus === 'success' && <Check size={12} />}
                {saveStatus === 'error' && <X size={12} />}
                {saveMessage}
              </div>
            )}
          </div>

          {/* About */}
          <div style={sectionStyle}>
            <h3 style={headingStyle}>About</h3>
            <div style={{ fontSize: 'var(--font-size-sm)', color: 'var(--text-secondary)' }}>
              Flux{' '}
              <span style={{ color: 'var(--text-primary)', fontWeight: 600 }}>
                {version || '—'}
              </span>
            </div>
          </div>
        </div>
      </div>

      {/* AI provider configuration guide. Sits on top of the settings
          modal so its own backdrop can close it without dismissing the
          whole settings dialog. */}
      {showGuide && (
        <div
          style={{
            position: 'fixed',
            inset: 0,
            background: 'rgba(0, 0, 0, 0.5)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            zIndex: 1100
          }}
          onClick={() => setShowGuide(false)}
        >
          <div
            role="dialog"
            aria-modal="true"
            aria-label="AI Configuration Guide"
            onClick={(e) => e.stopPropagation()}
            style={{
              width: 640,
              maxWidth: '90vw',
              maxHeight: '80vh',
              background: 'var(--bg-primary)',
              borderRadius: 'var(--radius-lg)',
              boxShadow: 'var(--shadow-lg)',
              border: '1px solid var(--border-color)',
              display: 'flex',
              flexDirection: 'column',
              overflow: 'hidden'
            }}
          >
            <div
              style={{
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'space-between',
                padding: '14px 18px',
                borderBottom: '1px solid var(--border-light)',
                flexShrink: 0
              }}
            >
              <span
                style={{
                  fontSize: 'var(--font-size-md)',
                  fontWeight: 600,
                  color: 'var(--text-primary)',
                  display: 'inline-flex',
                  alignItems: 'center',
                  gap: 8
                }}
              >
                <BookOpen size={16} /> How to Configure AI Providers
              </span>
              <button
                className="btn-icon"
                onClick={() => setShowGuide(false)}
                title="Close"
                aria-label="Close guide"
                style={{ width: 26, height: 26 }}
              >
                <X size={14} />
              </button>
            </div>

            <div
              style={{
                overflowY: 'auto',
                padding: 16,
                display: 'flex',
                flexDirection: 'column',
                gap: 12
              }}
            >
              {PROVIDER_GUIDE.map((entry) => (
                <div
                  key={entry.name}
                  style={{
                    border: '1px solid var(--border-light)',
                    borderRadius: 'var(--radius-md)',
                    padding: 12,
                    background: 'var(--bg-secondary)'
                  }}
                >
                  <div
                    style={{
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'space-between',
                      marginBottom: 8
                    }}
                  >
                    <span
                      style={{
                        fontSize: 'var(--font-size-base)',
                        fontWeight: 600,
                        color: 'var(--text-primary)'
                      }}
                    >
                      {entry.name}
                    </span>
                    <button
                      type="button"
                      className="btn-icon"
                      onClick={() => window.flux.app.openUrl(entry.portal)}
                      title={`Open ${entry.portal}`}
                      aria-label={`Open ${entry.name} portal`}
                      style={{ width: 26, height: 26, fontSize: 'var(--font-size-xs)' }}
                    >
                      <ExternalLink size={13} />
                    </button>
                  </div>

                  <div
                    style={{
                      display: 'grid',
                      gridTemplateColumns: 'auto 1fr',
                      columnGap: 10,
                      rowGap: 6,
                      alignItems: 'center',
                      fontSize: 'var(--font-size-sm)',
                      color: 'var(--text-secondary)'
                    }}
                  >
                    <span style={{ color: 'var(--text-tertiary)' }}>Base URL</span>
                    <button
                      type="button"
                      onClick={() => handleCopy(`${entry.name}-baseUrl`, entry.baseUrl)}
                      title="Copy base URL"
                      style={{
                        display: 'inline-flex',
                        alignItems: 'center',
                        gap: 6,
                        padding: '2px 8px',
                        background: 'var(--bg-primary)',
                        border: '1px solid var(--border-color)',
                        borderRadius: 'var(--radius-sm)',
                        color: 'var(--text-primary)',
                        fontFamily: 'var(--font-mono)',
                        fontSize: 'var(--font-size-xs)',
                        cursor: 'pointer',
                        justifyContent: 'space-between',
                        width: '100%'
                      }}
                    >
                      <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                        {entry.baseUrl}
                      </span>
                      {copiedField === `${entry.name}-baseUrl` ? (
                        <Check size={12} style={{ color: 'var(--text-primary)' }} />
                      ) : (
                        <Copy size={12} style={{ color: 'var(--text-tertiary)' }} />
                      )}
                    </button>

                    <span style={{ color: 'var(--text-tertiary)' }}>Models</span>
                    <span
                      style={{
                        fontFamily: 'var(--font-mono)',
                        fontSize: 'var(--font-size-xs)',
                        color: 'var(--text-primary)'
                      }}
                    >
                      {entry.models.join(', ')}
                    </span>
                  </div>

                  <p
                    style={{
                      marginTop: 8,
                      marginBottom: 0,
                      fontSize: 'var(--font-size-xs)',
                      color: 'var(--text-tertiary)',
                      lineHeight: 1.5
                    }}
                  >
                    {entry.notes}
                  </p>
                </div>
              ))}

              <p
                style={{
                  fontSize: 'var(--font-size-xs)',
                  color: 'var(--text-tertiary)',
                  marginTop: 4,
                  marginBottom: 0,
                  lineHeight: 1.5
                }}
              >
                Tip: after copying the Base URL, close this guide and paste it into the Base URL
                field, choose the matching Provider, then enter your API key and Save.
              </p>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

export default SettingsPanel
