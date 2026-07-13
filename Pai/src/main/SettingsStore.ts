import { join } from 'path'
import { existsSync, readFileSync, writeFileSync, mkdirSync } from 'fs'
import { app } from 'electron'
import type { AppSettings } from '@shared/types'
import {
  DEFAULT_AI_MODEL,
  DEFAULT_AI_BASE_URL,
  DEFAULT_PIN_CONFIG,
  DEFAULT_WORKSPACE
} from '@shared/constants'

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
  return join(app.getPath('userData'), 'painote-settings.json')
}

let cachedSettings: AppSettings | null = null

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

    cachedSettings = {
      ...defaults,
      ...parsed,
      ai: { ...defaults.ai, ...parsed.ai },
      pin: { ...defaults.pin, ...parsed.pin }
    }

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

  writeFileSync(settingsPath, JSON.stringify(settings, null, 2), 'utf-8')
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
