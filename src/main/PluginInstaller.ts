import { join } from 'path'
import {
  existsSync,
  readdirSync,
  readFileSync,
  mkdirSync,
  copyFileSync,
  rmSync
} from 'fs'
import { app, dialog } from 'electron'
import type { PluginManifest, PluginInfo } from '@shared/types'
import { USER_PLUGINS_DIR, APP_VERSION } from '@shared/constants'
import type { PluginManager } from './PluginManager'

export class PluginInstaller {
  constructor(private manager: PluginManager) {}

  getUserPluginsPath(): string {
    return join(app.getPath('userData'), USER_PLUGINS_DIR)
  }

  ensureUserPluginsDir(): void {
    const dir = this.getUserPluginsPath()
    if (!existsSync(dir)) {
      mkdirSync(dir, { recursive: true })
    }
  }

  validateManifest(manifest: unknown): manifest is PluginManifest {
    if (!manifest || typeof manifest !== 'object') return false

    const m = manifest as Record<string, unknown>

    if (typeof m.id !== 'string' || !m.id) return false
    if (typeof m.name !== 'string' || !m.name) return false
    if (typeof m.version !== 'string' || !m.version) return false
    if (typeof m.author !== 'string') return false
    if (typeof m.description !== 'string') return false
    if (m.type !== 'format' && m.type !== 'tool' && m.type !== 'theme') return false
    if (typeof m.main !== 'string' || !m.main) return false

    if (m.minAppVersion && typeof m.minAppVersion === 'string') {
      if (!this.isVersionCompatible(m.minAppVersion, APP_VERSION)) {
        return false
      }
    }

    return true
  }

  isVersionCompatible(required: string, current: string): boolean {
    const parseVersion = (v: string): number[] =>
      v.split('.').map((n) => parseInt(n, 10) || 0)

    const req = parseVersion(required)
    const cur = parseVersion(current)

    for (let i = 0; i < Math.max(req.length, cur.length); i++) {
      const r = req[i] || 0
      const c = cur[i] || 0
      if (c > r) return true
      if (c < r) return false
    }

    return true
  }

  async installFromDirectory(sourcePath: string): Promise<PluginInfo> {
    const manifestPath = join(sourcePath, 'manifest.json')
    if (!existsSync(manifestPath)) {
      throw new Error('manifest.json not found in the selected directory')
    }

    const manifestRaw = readFileSync(manifestPath, 'utf-8')
    let manifest: unknown
    try {
      manifest = JSON.parse(manifestRaw)
    } catch {
      throw new Error('Invalid manifest.json: not valid JSON')
    }

    if (!this.validateManifest(manifest)) {
      throw new Error(
        'Invalid manifest.json: missing required fields or incompatible app version'
      )
    }

    this.ensureUserPluginsDir()

    const destPath = join(this.getUserPluginsPath(), manifest.id)

    // If already installed, deactivate and remove first
    const existing = this.manager.getPlugin(manifest.id)
    if (existing) {
      if (existing.state === 'active') {
        await this.manager.deactivate(manifest.id)
      }
      if (existsSync(destPath)) {
        rmSync(destPath, { recursive: true, force: true })
      }
    }

    this.copyDirectory(sourcePath, destPath)

    // Verify entry file exists
    const entryPath = join(destPath, manifest.main)
    if (!existsSync(entryPath)) {
      throw new Error(`Entry file not found: ${manifest.main}`)
    }

    const info: PluginInfo = {
      ...manifest,
      icon: manifest.icon ? `file://${join(destPath, manifest.icon)}` : undefined,
      status: 'installed',
      installPath: destPath,
      isBuiltin: false
    }

    this.manager.addPlugin(info)

    // Auto-activate
    try {
      await this.manager.activate(info.id)
    } catch (err) {
      console.error(`Failed to auto-activate plugin ${info.id}:`, err)
    }

    return info
  }

  async installFromPicker(): Promise<PluginInfo | null> {
    const result = await dialog.showOpenDialog({
      title: 'Select Plugin Directory',
      properties: ['openDirectory']
    })

    if (result.canceled || result.filePaths.length === 0) {
      return null
    }

    return this.installFromDirectory(result.filePaths[0])
  }

  async uninstall(pluginId: string): Promise<void> {
    const loaded = this.manager.getPlugin(pluginId)
    if (!loaded) {
      throw new Error(`Plugin not found: ${pluginId}`)
    }

    // Deactivate if active
    if (loaded.state === 'active') {
      await this.manager.deactivate(pluginId)
    }

    // Remove from disk (only user plugins, not builtin)
    const pluginPath = loaded.info.installPath
    if (!loaded.info.isBuiltin && existsSync(pluginPath)) {
      rmSync(pluginPath, { recursive: true, force: true })
    }

    this.manager.removePlugin(pluginId)
  }

  copyDirectory(src: string, dest: string): void {
    if (!existsSync(dest)) {
      mkdirSync(dest, { recursive: true })
    }

    const entries = readdirSync(src, { withFileTypes: true })
    for (const entry of entries) {
      // Skip node_modules and .git
      if (entry.name === 'node_modules' || entry.name === '.git') continue

      const srcPath = join(src, entry.name)
      const destPath = join(dest, entry.name)

      if (entry.isDirectory()) {
        this.copyDirectory(srcPath, destPath)
      } else {
        copyFileSync(srcPath, destPath)
      }
    }
  }

  getDevGuidePath(): string {
    if (!app.isPackaged) {
      return join(app.getAppPath(), 'src', 'renderer', 'plugin-dev-guide.html')
    }
    return join(app.getAppPath(), 'build', 'plugin-dev-guide.html')
  }
}
