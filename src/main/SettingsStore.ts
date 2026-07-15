import { join } from 'path'
import { existsSync, readFileSync, writeFileSync, mkdirSync } from 'fs'
import { app, safeStorage } from 'electron'
import type { AppSettings } from '@shared/types'
import {
  DEFAULT_AI_MODEL,
  DEFAULT_AI_BASE_URL,
  DEFAULT_PIN_CONFIG,
  DEFAULT_WORKSPACE
} from '@shared/constants'

/**
 * Marker prefix stored alongside the encrypted API key so we can tell
 * ciphertext from a legacy plaintext value on disk during migration. The
 * suffix is the base64 payload produced by safeStorage.encryptString.
 */
const ENCRYPTED_PREFIX = 'enc:v1:'

export function getDefaults(): AppSettings {
  return {
    workspacePath: join(app.getPath('documents'), DEFAULT_WORKSPACE),
    ai: {
      provider: 'none',
      apiKey: '',
      model: DEFAULT_AI_MODEL,
      baseUrl: DEFAULT_AI_BASE_URL
    },
    pin: { ...DEFAULT_PIN_CONFIG },
    theme: 'light'
  }
}

export function getSettingsPath(): string {
  return join(app.getPath('userData'), 'flux-settings.json')
}

let cachedSettings: AppSettings | null = null

function encryptApiKey(plain: string): string {
  if (!plain) return ''
  if (!safeStorage.isEncryptionAvailable()) {
    // Some Linux desktops without a keyring can't do real encryption. In
    // that case Electron falls back to obfuscation-only encryption; a
    // determined local attacker could still read the file, but so could
    // any other process the user runs, so this doesn't make things worse
    // than plaintext. We still tag it as encrypted so decryption knows.
    console.warn(
      '[SettingsStore] safeStorage encryption unavailable; API key will be obfuscated only.'
    )
  }
  const buf = safeStorage.encryptString(plain)
  return ENCRYPTED_PREFIX + buf.toString('base64')
}

function decryptApiKey(stored: string): string {
  if (!stored) return ''
  if (!stored.startsWith(ENCRYPTED_PREFIX)) {
    // Legacy plaintext value from before the encryption change — accept it
    // and let the next save re-encrypt. Do not log the value.
    return stored
  }
  const b64 = stored.slice(ENCRYPTED_PREFIX.length)
  try {
    return safeStorage.decryptString(Buffer.from(b64, 'base64'))
  } catch (err) {
    console.warn(
      '[SettingsStore] Failed to decrypt API key (keychain changed?); clearing.',
      err
    )
    return ''
  }
}

export function getSettings(): AppSettings {
  if (cachedSettings) {
    return cachedSettings
  }

  const settingsPath = getSettingsPath()

  if (!existsSync(settingsPath)) {
    cachedSettings = getDefaults()
    return cachedSettings
  }

  try {
    const raw = readFileSync(settingsPath, 'utf-8')
    const parsed = JSON.parse(raw) as Partial<AppSettings>
    const defaults = getDefaults()

    const merged: AppSettings = {
      ...defaults,
      ...parsed,
      ai: { ...defaults.ai, ...parsed.ai },
      pin: { ...defaults.pin, ...parsed.pin }
    }

    // Decrypt if encrypted; leave alone if legacy plaintext (migrated on
    // next save).
    merged.ai.apiKey = decryptApiKey(merged.ai.apiKey)

    cachedSettings = merged
    return cachedSettings
  } catch {
    cachedSettings = getDefaults()
    return cachedSettings
  }
}

export function saveSettings(settings: AppSettings): void {
  const settingsPath = getSettingsPath()
  const dir = join(settingsPath, '..')

  if (!existsSync(dir)) {
    mkdirSync(dir, { recursive: true })
  }

  // Never write the plaintext apiKey to disk — encrypt with the OS keychain
  // (Keychain on macOS, DPAPI on Windows, libsecret on Linux) via
  // Electron's safeStorage. Cached in-memory copy stays plaintext for
  // callers.
  const onDisk: AppSettings = {
    ...settings,
    ai: {
      ...settings.ai,
      apiKey: encryptApiKey(settings.ai.apiKey)
    }
  }

  writeFileSync(settingsPath, JSON.stringify(onDisk, null, 2), 'utf-8')
  cachedSettings = settings
}

export function setSettings(partial: Partial<AppSettings>): AppSettings {
  const current = getSettings()
  const updated: AppSettings = { ...current, ...partial }
  saveSettings(updated)
  return updated
}

export function updateAISettings(partial: Partial<AppSettings['ai']>): AppSettings {
  const current = getSettings()
  const updated: AppSettings = {
    ...current,
    ai: { ...current.ai, ...partial }
  }
  saveSettings(updated)
  return updated
}

export function updatePinSettings(partial: Partial<AppSettings['pin']>): AppSettings {
  const current = getSettings()
  const updated: AppSettings = {
    ...current,
    pin: { ...current.pin, ...partial }
  }
  saveSettings(updated)
  return updated
}

/**
 * Record the user's explicit enable/disable choice for a plugin.
 * Persists so the app remembers across restarts.
 */
export function setPluginEnabled(pluginId: string, enabled: boolean): AppSettings {
  const current = getSettings()
  const pluginState = { ...(current.pluginState ?? {}) }
  pluginState[pluginId] = { enabled }
  const updated: AppSettings = { ...current, pluginState }
  saveSettings(updated)
  return updated
}

/**
 * Resolve the effective activation state for a plugin: user choice wins,
 * else the manifest default (`autoActivate`, default true).
 */
export function isPluginEnabled(pluginId: string, autoActivate: boolean): boolean {
  const explicit = getSettings().pluginState?.[pluginId]
  if (explicit) return explicit.enabled
  return autoActivate
}
