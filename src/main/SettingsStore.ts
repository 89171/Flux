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

function getDefaultStorageSettings(workspacePath: string): AppSettings['storage'] {
  return {
    provider: 'local',
    local: {
      rootPath: workspacePath
    },
    github: {
      owner: '',
      repo: '',
      branch: 'main',
      basePath: '',
      token: ''
    },
    webdav: {
      endpoint: '',
      username: '',
      password: '',
      basePath: ''
    },
    ftp: {
      host: '',
      port: 21,
      username: '',
      password: '',
      secure: false,
      basePath: ''
    },
    s3: {
      endpoint: '',
      region: 'us-east-1',
      bucket: '',
      accessKeyId: '',
      secretAccessKey: '',
      basePath: '',
      forcePathStyle: false
    }
  }
}

export function getDefaults(): AppSettings {
  const workspacePath = join(app.getPath('documents'), DEFAULT_WORKSPACE)
  return {
    workspacePath,
    ai: {
      provider: 'none',
      apiKey: '',
      model: DEFAULT_AI_MODEL,
      baseUrl: DEFAULT_AI_BASE_URL
    },
    pin: { ...DEFAULT_PIN_CONFIG },
    theme: 'light',
    storage: getDefaultStorageSettings(workspacePath)
  }
}

export function getSettingsPath(): string {
  return join(app.getPath('userData'), 'flux-settings.json')
}

let cachedSettings: AppSettings | null = null

function encryptSecret(plain: string): string {
  if (!plain) return ''
  if (!safeStorage.isEncryptionAvailable()) {
    // Some Linux desktops without a keyring can't do real encryption. In
    // that case Electron falls back to obfuscation-only encryption; a
    // determined local attacker could still read the file, but so could
    // any other process the user runs, so this doesn't make things worse
    // than plaintext. We still tag it as encrypted so decryption knows.
    console.warn(
      '[SettingsStore] safeStorage encryption unavailable; secret values will be obfuscated only.'
    )
  }
  const buf = safeStorage.encryptString(plain)
  return ENCRYPTED_PREFIX + buf.toString('base64')
}

function decryptSecret(stored: string): string {
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
      '[SettingsStore] Failed to decrypt secret value (keychain changed?); clearing.',
      err
    )
    return ''
  }
}

function mergeStorageSettings(
  defaults: AppSettings['storage'],
  parsed?: Partial<AppSettings['storage']>
): AppSettings['storage'] {
  return {
    ...defaults,
    ...parsed,
    local: { ...defaults.local, ...parsed?.local },
    github: { ...defaults.github, ...parsed?.github },
    webdav: { ...defaults.webdav, ...parsed?.webdav },
    ftp: { ...defaults.ftp, ...parsed?.ftp },
    s3: { ...defaults.s3, ...parsed?.s3 }
  }
}

function decryptStorageSettings(storage: AppSettings['storage']): AppSettings['storage'] {
  return {
    ...storage,
    github: {
      ...storage.github,
      token: decryptSecret(storage.github.token)
    },
    webdav: {
      ...storage.webdav,
      password: decryptSecret(storage.webdav.password)
    },
    ftp: {
      ...storage.ftp,
      password: decryptSecret(storage.ftp.password)
    },
    s3: {
      ...storage.s3,
      secretAccessKey: decryptSecret(storage.s3.secretAccessKey)
    }
  }
}

function encryptStorageSettings(storage: AppSettings['storage']): AppSettings['storage'] {
  return {
    ...storage,
    github: {
      ...storage.github,
      token: encryptSecret(storage.github.token)
    },
    webdav: {
      ...storage.webdav,
      password: encryptSecret(storage.webdav.password)
    },
    ftp: {
      ...storage.ftp,
      password: encryptSecret(storage.ftp.password)
    },
    s3: {
      ...storage.s3,
      secretAccessKey: encryptSecret(storage.s3.secretAccessKey)
    }
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
      pin: { ...defaults.pin, ...parsed.pin },
      storage: mergeStorageSettings(defaults.storage, parsed.storage)
    }

    // Decrypt if encrypted; leave alone if legacy plaintext (migrated on
    // next save).
    merged.ai.apiKey = decryptSecret(merged.ai.apiKey)
    merged.storage = decryptStorageSettings(merged.storage)

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
      apiKey: encryptSecret(settings.ai.apiKey)
    },
    storage: encryptStorageSettings(settings.storage)
  }

  writeFileSync(settingsPath, JSON.stringify(onDisk, null, 2), 'utf-8')
  cachedSettings = settings
}

export function setSettings(partial: Partial<AppSettings>): AppSettings {
  const current = getSettings()
  const updated: AppSettings = {
    ...current,
    ...partial,
    ai: partial.ai ? { ...current.ai, ...partial.ai } : current.ai,
    pin: partial.pin ? { ...current.pin, ...partial.pin } : current.pin,
    storage: partial.storage
      ? mergeStorageSettings(current.storage, partial.storage)
      : current.storage
  }
  if (
    partial.workspacePath &&
    !partial.storage &&
    current.storage.provider === 'local' &&
    current.storage.local.rootPath === current.workspacePath
  ) {
    updated.storage = {
      ...updated.storage,
      local: {
        ...updated.storage.local,
        rootPath: partial.workspacePath
      }
    }
  }
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
