import { join, resolve as pathResolve, relative } from 'path'
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

/**
 * Plugin id must be a bare kebab/snake/dot slug so it can safely be used as
 * a filesystem name. Rejects "../", "/", ":", null bytes, etc.
 */
const PLUGIN_ID_PATTERN = /^[a-z0-9][a-z0-9._-]{0,62}$/

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

    // id must be a safe filesystem slug — this is the directory name we'll
    // create in ~/Library/Application Support, so anything with slashes,
    // backslashes, colons, "..", or leading dots would let a malicious
    // manifest write outside the plugin sandbox.
    if (typeof m.id !== 'string' || !PLUGIN_ID_PATTERN.test(m.id)) return false
    if (typeof m.name !== 'string' || !m.name) return false
    if (typeof m.version !== 'string' || !m.version) return false
    if (typeof m.author !== 'string') return false
    if (typeof m.description !== 'string') return false
    if (m.type !== 'format' && m.type !== 'tool' && m.type !== 'theme') return false
    // main is validated for containment below in installFromDirectory,
    // once we know the destination directory; here we only check the type.
    if (typeof m.main !== 'string' || !m.main) return false

    if (m.minAppVersion && typeof m.minAppVersion === 'string') {
      if (!this.isVersionCompatible(m.minAppVersion, APP_VERSION)) {
        return false
      }
    }

    return true
  }

  /**
   * Ensure `candidate`, resolved against `root`, cannot escape it. Returns
   * the resolved absolute path if safe; throws otherwise.
   */
  private resolveInside(root: string, candidate: string): string {
    const rootAbs = pathResolve(root)
    const resolved = pathResolve(rootAbs, candidate)
    const rel = relative(rootAbs, resolved)
    if (rel.startsWith('..') || pathResolve(rootAbs, rel) !== resolved) {
      throw new Error(
        `Path escape rejected: ${candidate} resolves outside ${rootAbs}`
      )
    }
    return resolved
  }

  /**
   * Turn a manifest icon field into what the renderer expects.
   *   - Lucide icon names (no slash, no image extension) pass through.
   *   - Paths become file:// URLs, but only after passing resolveInside so
   *     a malicious "../../foo.png" can't leak files from outside.
   *   - Fields that fail containment silently drop to undefined; the UI
   *     falls back to a generic icon rather than crashing the install.
   */
  private resolveIconField(destPath: string, icon?: string): string | undefined {
    if (!icon) return undefined
    const looksLikePath =
      icon.includes('/') ||
      icon.endsWith('.png') ||
      icon.endsWith('.svg') ||
      icon.endsWith('.jpg') ||
      icon.endsWith('.jpeg') ||
      icon.endsWith('.webp') ||
      icon.endsWith('.gif')
    if (!looksLikePath) return icon
    try {
      const iconPath = this.resolveInside(destPath, icon)
      return `file://${iconPath}`
    } catch {
      return undefined
    }
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

    // Both destPath (built from user-provided id) and entryPath (built from
    // user-provided main) must resolve inside the plugins directory. The id
    // regex above already blocks slashes and "..", but resolveInside is the
    // authoritative check — regex changes shouldn't be able to widen this.
    const pluginsRoot = this.getUserPluginsPath()
    const destPath = this.resolveInside(pluginsRoot, manifest.id)

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

    // Reject `"main": "../../foo.js"` and other traversal tricks by
    // requiring the entry path to stay within destPath.
    let entryPath: string
    try {
      entryPath = this.resolveInside(destPath, manifest.main)
    } catch (err) {
      // Clean up partially copied files so a rejected plugin doesn't linger
      rmSync(destPath, { recursive: true, force: true })
      throw err
    }
    if (!existsSync(entryPath)) {
      rmSync(destPath, { recursive: true, force: true })
      throw new Error(`Entry file not found: ${manifest.main}`)
    }

    // Icon fields — if the manifest ships a path, verify it stays inside
    // the plugin dir before we hand a file:// URL to the renderer. Lucide
    // names (e.g. "FileText") aren't paths and pass through unchanged.
    const iconUrl = this.resolveIconField(destPath, manifest.icon)
    const fileIconUrl = this.resolveIconField(destPath, manifest.fileIcon) ?? iconUrl

    // Custom editor entry — same containment check as `main`. Refuse the
    // whole install if the entry escapes, since a broken editor plugin
    // is worse than no plugin.
    let editorEntryUrl: string | undefined
    if (manifest.editor?.entry) {
      let entryAbs: string
      try {
        entryAbs = this.resolveInside(destPath, manifest.editor.entry)
      } catch (err) {
        rmSync(destPath, { recursive: true, force: true })
        throw err
      }
      if (!existsSync(entryAbs)) {
        rmSync(destPath, { recursive: true, force: true })
        throw new Error(`Editor entry file not found: ${manifest.editor.entry}`)
      }
      editorEntryUrl = `file://${entryAbs}`
    }

    const info: PluginInfo = {
      ...manifest,
      icon: iconUrl,
      fileIcon: fileIconUrl,
      editorEntryUrl,
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

    // Builtins stay in the registry — they are bundled with the app and
    // will be rediscovered on the next startup. Removing them from the
    // in-memory map would make the card disappear from the market and
    // prevent re-installation without a restart.
    if (!loaded.info.isBuiltin) {
      this.manager.removePlugin(pluginId)
    }
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
