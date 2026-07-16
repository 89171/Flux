import { join, relative, resolve as pathResolve } from 'path'
import { existsSync, readdirSync, readFileSync, mkdirSync } from 'fs'
import { app, BrowserWindow, Notification, ipcMain } from 'electron'
import { is } from '@electron-toolkit/utils'
import type {
  FormatBinding,
  NoteFormat,
  PluginInfo,
  PluginManifest,
  PluginPermission
} from '@shared/types'
import type {
  PluginModule,
  PluginContext,
  PluginAPI,
  PluginLogger,
  PluginCommand,
  AIFormatAdapter
} from '@plugin-sdk/types'
import { isValidTransition } from '@plugin-sdk/lifecycle'
import type { PluginState } from '@plugin-sdk/lifecycle'
import { SDK_ABI_VERSION, USER_PLUGINS_DIR } from '@shared/constants'
import { loadPluginInSandbox } from './PluginSandbox'
import type { FileSystemManager } from './FileSystemManager'

/**
 * IPC handler disposers registered by a plugin's on() calls, so we can
 * detach them cleanly when the plugin deactivates. Prevents listener
 * leaks across activate/deactivate cycles.
 */
type PluginDisposer = () => void

/**
 * Resolve an icon manifest field. Paths containing a slash or ending in a
 * known image extension are treated as files relative to the plugin dir
 * and returned as file:// URLs; anything else (lucide names like
 * "FileText") passes through unchanged. Returns undefined for null/empty.
 * Exported so PluginInstaller can use the same rules for freshly-installed
 * plugins.
 */
export function resolvePluginIcon(
  pluginDir: string,
  icon: string | undefined
): string | undefined {
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
  // Guard against traversal — same containment check as resolvePluginEditorEntry.
  const dirAbs = pathResolve(pluginDir)
  const target = pathResolve(dirAbs, icon)
  const rel = relative(dirAbs, target)
  if (rel.startsWith('..') || pathResolve(dirAbs, rel) !== target) {
    console.warn(`[PluginManager] icon path escapes plugin dir; ignoring: ${icon}`)
    return undefined
  }
  return `file://${target}`
}

/**
 * Turn a manifest.editor.entry (relative path) into a file:// URL,
 * guarding against traversal so a manifest can't point the iframe at
 * ~/.ssh or anywhere outside its own directory. Returns undefined if
 * the entry is missing, escapes the plugin dir, or doesn't exist.
 */
export function resolvePluginEditorEntry(
  pluginDir: string,
  entry: string | undefined
): string | undefined {
  if (!entry) return undefined
  const dirAbs = pathResolve(pluginDir)
  const target = pathResolve(dirAbs, entry)
  const rel = relative(dirAbs, target)
  if (rel.startsWith('..') || pathResolve(dirAbs, rel) !== target) {
    console.warn(
      `[PluginManager] editor.entry escapes plugin dir; ignoring: ${entry}`
    )
    return undefined
  }
  return `file://${target}`
}

export interface LoadedPlugin {
  info: PluginInfo
  module: PluginModule | null
  state: PluginState
  context: PluginContext | null
}

export class PluginManager {
  plugins: Map<string, LoadedPlugin> = new Map()
  /** Legacy: plugins that export a FormatPlugin code object claim a format. */
  formatMap: Map<NoteFormat, string> = new Map()
  /**
   * Data-driven format binding — extension (lowercase, no dot) → binding.
   * Populated from active plugin manifests, refreshed on activate/deactivate.
   * The wire shape carries the discriminated union so renderers know
   * whether to mount a built-in editor or an iframe from a plugin.
   */
  private extensionBindings: Map<string, FormatBinding> = new Map()

  private mainWindow: BrowserWindow | null = null
  private workspacePath: string = ''
  private fsManager: FileSystemManager | null = null
  private commands: Map<string, PluginCommand> = new Map()
  private eventHandlers: Map<string, Array<(data: unknown) => void>> = new Map()
  /** Disposers owned by each plugin, cleared on deactivate. */
  private pluginDisposers: Map<string, PluginDisposer[]> = new Map()
  /** Notified whenever the active format binding changes. */
  private formatMapListeners: Array<() => void> = []

  setMainWindow(win: BrowserWindow | null): void {
    this.mainWindow = win
  }

  setWorkspacePath(path: string): void {
    this.workspacePath = path
  }

  setFileSystemManager(fs: FileSystemManager): void {
    this.fsManager = fs
  }

  getBuiltinPluginsPath(): string {
    if (is.dev) {
      return join(app.getAppPath(), 'src', 'builtin-plugins')
    }
    // In production, builtin-plugins are placed in extraResources by
    // electron-builder so they land at <resourcesPath>/builtin-plugins —
    // outside the asar archive where normal fs operations work without
    // Electron's asar shim.
    return join(process.resourcesPath, 'builtin-plugins')
  }

  getUserPluginsPath(): string {
    return join(app.getPath('userData'), USER_PLUGINS_DIR)
  }

  discoverPlugins(): PluginInfo[] {
    this.plugins.clear()
    this.formatMap.clear()

    const builtinPath = this.getBuiltinPluginsPath()
    console.log('[PluginManager] Discovering builtin plugins at:', builtinPath)
    console.log('[PluginManager] Builtin path exists:', existsSync(builtinPath))
    this.loadPluginsFromDir(builtinPath, true)

    // Ensure user plugins directory exists
    const userPluginsPath = this.getUserPluginsPath()
    if (!existsSync(userPluginsPath)) {
      mkdirSync(userPluginsPath, { recursive: true })
    }
    console.log('[PluginManager] Discovering user plugins at:', userPluginsPath)
    this.loadPluginsFromDir(userPluginsPath, false)

    const list = this.listPlugins()
    console.log('[PluginManager] Discovered plugins:', list.map(p => ({ id: p.id, name: p.name, status: p.status, isBuiltin: p.isBuiltin })))
    return list
  }

  loadPluginsFromDir(dir: string, isBuiltin: boolean): void {
    if (!existsSync(dir)) {
      return
    }

    const entries = readdirSync(dir, { withFileTypes: true })
    for (const entry of entries) {
      if (!entry.isDirectory()) continue

      const pluginDir = join(dir, entry.name)
      const manifestPath = join(pluginDir, 'manifest.json')
      if (!existsSync(manifestPath)) continue

      try {
        const manifestRaw = readFileSync(manifestPath, 'utf-8')
        const manifest: PluginManifest = JSON.parse(manifestRaw)

        // Defence-in-depth: reject stale user plugins whose id is not a
        // safe filesystem slug. Same rule as PluginInstaller, kept in sync
        // by hand — a fresh install path validates too, but plugins from
        // before this patch may still be sitting on disk.
        if (!isBuiltin && !/^[a-z0-9][a-z0-9._-]{0,62}$/.test(manifest.id)) {
          console.warn(
            `[PluginManager] Skipping plugin with invalid id: ${manifest.id}`
          )
          continue
        }

        // Resolve icon fields: paths become file:// URLs, lucide names
        // pass through untouched. The renderer's icon component handles
        // both. `fileIcon` (file-tree badge) falls back to `icon` (plugin
        // branding) when the manifest doesn't distinguish them.
        const resolvedIcon = resolvePluginIcon(pluginDir, manifest.icon)
        const resolvedFileIcon = resolvePluginIcon(pluginDir, manifest.fileIcon) ?? resolvedIcon

        // Resolve custom-editor entry to a file:// URL, guarded against
        // traversal so a manifest saying `"entry": "../../.ssh/id_rsa"`
        // can't leak host files into an iframe.
        const editorEntryUrl = resolvePluginEditorEntry(pluginDir, manifest.editor?.entry)

        const info: PluginInfo = {
          ...manifest,
          icon: resolvedIcon,
          fileIcon: resolvedFileIcon,
          editorEntryUrl,
          status: 'installed',
          installPath: pluginDir,
          isBuiltin,
          builtin: isBuiltin
        }

        const loaded: LoadedPlugin = {
          info,
          module: null,
          state: 'installed',
          context: null
        }

        this.plugins.set(info.id, loaded)
      } catch (err) {
        console.error(`Failed to load plugin manifest from ${pluginDir}:`, err)
      }
    }
  }

  async activate(pluginId: string): Promise<void> {
    const loaded = this.plugins.get(pluginId)
    if (!loaded) {
      throw new Error(`Plugin not found: ${pluginId}`)
    }

    console.log(`[PluginManager] Activating plugin: ${pluginId} (current state: ${loaded.state})`)

    // Re-activating an already-active plugin is a no-op — the lifecycle
    // table technically forbids it, but throwing here breaks legitimate
    // flows like "refresh plugins after settings change".
    if (loaded.state === 'active') {
      return
    }

    // Reject incompatible plugins early with a clear message instead of
    // letting them fail deep inside the sandbox at first API call.
    if (!loaded.info.isBuiltin && loaded.info.sdkVersion) {
      const expectedMajor = SDK_ABI_VERSION.split('.')[0]
      const actualMajor = loaded.info.sdkVersion.split('.')[0]
      if (expectedMajor !== actualMajor) {
        throw new Error(
          `Plugin ${pluginId}: requires SDK ${loaded.info.sdkVersion}, host is ${SDK_ABI_VERSION}`
        )
      }
    }

    if (!isValidTransition(loaded.state, 'activating')) {
      throw new Error(`Invalid state transition from ${loaded.state} to activating`)
    }

    loaded.state = 'activating'
    loaded.info.status = 'activating'

    try {
      console.log(`[PluginManager] Loading module for ${pluginId} from ${loaded.info.installPath}/${loaded.info.main}`)
      const mod = this.loadPluginModule(loaded.info)
      loaded.module = mod
      console.log(`[PluginManager] Module loaded for ${pluginId}:`, Object.keys(mod))

      const context = this.createContext(loaded.info)
      loaded.context = context

      if (mod.onActivate) {
        console.log(`[PluginManager] Calling onActivate for ${pluginId}`)
        await mod.onActivate(context)
      }

      loaded.state = 'active'
      loaded.info.status = 'active'
      console.log(`[PluginManager] Plugin ${pluginId} activated successfully`)

      // Register format mapping (code-driven, legacy path)
      if (mod.format) {
        this.formatMap.set(mod.format.format, pluginId)
      }

      // Register manifest-driven extension binding — the data-driven path
      // that replaces the hardcoded EXTENSION_FORMAT_MAP. Both are additive
      // so a plugin can migrate incrementally.
      this.registerExtensionBindings(loaded.info)
    } catch (err) {
      loaded.state = 'error'
      loaded.info.status = 'error'
      loaded.info.errorMessage = err instanceof Error ? err.message : String(err)
      console.error(`[PluginManager] Failed to activate plugin ${pluginId}:`, err)
      throw err
    }
  }

  async deactivate(pluginId: string): Promise<void> {
    const loaded = this.plugins.get(pluginId)
    if (!loaded) {
      throw new Error(`Plugin not found: ${pluginId}`)
    }

    if (!isValidTransition(loaded.state, 'deactivating')) {
      throw new Error(`Invalid state transition from ${loaded.state} to deactivating`)
    }

    loaded.state = 'deactivating'
    loaded.info.status = 'deactivating'

    try {
      if (loaded.module?.onDeactivate && loaded.context) {
        await loaded.module.onDeactivate(loaded.context)
      }

      // Unregister format mapping
      if (loaded.module?.format) {
        this.formatMap.delete(loaded.module.format.format)
      }
      this.unregisterExtensionBindings(pluginId)

      // Detach any listeners / commands the plugin registered through the API
      this.tearDownPlugin(pluginId)

      loaded.state = 'inactive'
      loaded.info.status = 'inactive'
    } catch (err) {
      // Still run disposers on failure — better a partial cleanup than none
      this.tearDownPlugin(pluginId)
      loaded.state = 'error'
      loaded.info.status = 'error'
      loaded.info.errorMessage = err instanceof Error ? err.message : String(err)
      throw err
    }
  }

  loadPluginModule(info: PluginInfo): PluginModule {
    return loadPluginInSandbox(info)
  }

  private hasPermission(info: PluginInfo, permission: PluginPermission): boolean {
    if (info.isBuiltin) return true
    return info.permissions?.includes(permission) ?? false
  }

  private requirePermission(info: PluginInfo, permission: PluginPermission, op: string): void {
    if (!this.hasPermission(info, permission)) {
      throw new Error(
        `Plugin ${info.id}: '${op}' requires the '${permission}' permission — declare it in manifest.permissions`
      )
    }
  }

  createContext(info: PluginInfo): PluginContext {
    const self = this
    const disposers: PluginDisposer[] = []
    this.pluginDisposers.set(info.id, disposers)

    const logger: PluginLogger = {
      info: (...args: unknown[]) => console.log(`[Plugin:${info.id}]`, ...args),
      warn: (...args: unknown[]) => console.warn(`[Plugin:${info.id}]`, ...args),
      error: (...args: unknown[]) => console.error(`[Plugin:${info.id}]`, ...args),
      debug: (...args: unknown[]) => console.debug(`[Plugin:${info.id}]`, ...args)
    }

    const api: PluginAPI = {
      readFile: async (path: string): Promise<string> => {
        self.requirePermission(info, 'fs:read', 'readFile')
        if (!self.fsManager) {
          throw new Error('Plugin FS unavailable: FileSystemManager not wired')
        }
        // Route through FSM so plugins inherit workspace confinement, the
        // '../' guard, and the realpath-based symlink guard — they cannot
        // read outside the workspace even with fs:read.
        return self.fsManager.readFile(path)
      },

      writeFile: async (path: string, content: string): Promise<void> => {
        self.requirePermission(info, 'fs:write', 'writeFile')
        if (!self.fsManager) {
          throw new Error('Plugin FS unavailable: FileSystemManager not wired')
        }
        self.fsManager.writeFile(path, content)
      },

      notify: (message: string, _type: 'info' | 'success' | 'warning' | 'error' = 'info'): void => {
        self.requirePermission(info, 'notifications', 'notify')
        new Notification({
          title: info.name,
          body: message
        }).show()
      },

      registerCommand: (command: PluginCommand): void => {
        self.requirePermission(info, 'commands', 'registerCommand')
        self.commands.set(command.id, command)
        disposers.push(() => self.commands.delete(command.id))
      },

      unregisterCommand: (commandId: string): void => {
        self.commands.delete(commandId)
      },

      getWorkspacePath: (): string => self.workspacePath,

      emit: (event: string, data?: unknown): void => {
        self.requirePermission(info, 'events', 'emit')
        self.mainWindow?.webContents.send(`plugin:${event}`, data)
        const handlers = self.eventHandlers.get(event)
        if (handlers) {
          for (const handler of handlers) {
            handler(data)
          }
        }
      },

      on: (event: string, handler: (data: unknown) => void): void => {
        self.requirePermission(info, 'events', 'on')
        const handlers = self.eventHandlers.get(event) || []
        handlers.push(handler)
        self.eventHandlers.set(event, handlers)

        const channel = `plugin:${event}`
        const ipcListener = (_e: unknown, data: unknown): void => handler(data)
        ipcMain.on(channel, ipcListener)
        disposers.push(() => {
          ipcMain.removeListener(channel, ipcListener)
          const arr = self.eventHandlers.get(event)
          if (arr) {
            const idx = arr.indexOf(handler)
            if (idx >= 0) arr.splice(idx, 1)
          }
        })
      }
    }

    return {
      manifest: info,
      pluginPath: info.installPath,
      api,
      logger
    }
  }

  /** Runs and clears all disposers a plugin accumulated during activation. */
  private tearDownPlugin(pluginId: string): void {
    const disposers = this.pluginDisposers.get(pluginId)
    if (!disposers) return
    for (const dispose of disposers) {
      try {
        dispose()
      } catch (err) {
        console.warn(`[PluginManager] Disposer for ${pluginId} threw:`, err)
      }
    }
    this.pluginDisposers.delete(pluginId)
  }

  /**
   * Record every `extensions[]` entry of a format plugin. A plugin with
   * an `editor.entry` (iframe editor) wins over one with only a
   * `formatBinding` (built-in renderer) — an editor is more specific.
   * Called on activate.
   */
  private registerExtensionBindings(info: PluginInfo): void {
    if (info.type !== 'format') return

    // A plugin's editor overrides its formatBinding for whichever
    // extensions the editor claims (may be a subset or the whole list).
    const editorEntry = info.editorEntryUrl
    const editorExts = new Set(
      (info.editor?.extensions ?? info.extensions ?? []).map((e) =>
        e.toLowerCase().replace(/^\./, '')
      )
    )
    const allExts = (info.extensions ?? []).map((e) => e.toLowerCase().replace(/^\./, ''))
    if (allExts.length === 0) return

    for (const ext of allExts) {
      if (!ext) continue
      const existing = this.extensionBindings.get(ext)
      if (existing && existing.pluginId !== info.id) {
        console.warn(
          `[PluginManager] Extension .${ext} was claimed by ${existing.pluginId}; ${info.id} is taking it over.`
        )
      }
      let binding: FormatBinding
      if (editorEntry && editorExts.has(ext)) {
        binding = {
          kind: 'plugin-editor',
          pluginId: info.id,
          entryUrl: editorEntry,
          fileIcon: info.fileIcon
        }
      } else {
        binding = {
          kind: 'builtin',
          renderer: info.formatBinding ?? 'plaintext',
          pluginId: info.id,
          fileIcon: info.fileIcon
        }
      }
      this.extensionBindings.set(ext, binding)
    }
    this.notifyFormatMapChanged()
  }

  /** Drop every binding a plugin registered. Called on deactivate. */
  private unregisterExtensionBindings(pluginId: string): void {
    let changed = false
    for (const [ext, binding] of this.extensionBindings) {
      if (binding.pluginId === pluginId) {
        this.extensionBindings.delete(ext)
        changed = true
      }
    }
    if (changed) this.notifyFormatMapChanged()
  }

  private notifyFormatMapChanged(): void {
    for (const listener of this.formatMapListeners) {
      try {
        listener()
      } catch (err) {
        console.warn('[PluginManager] format-map listener threw:', err)
      }
    }
  }

  /** Subscribe to format-map changes (returns a disposer). */
  onFormatMapChanged(listener: () => void): () => void {
    this.formatMapListeners.push(listener)
    return () => {
      const idx = this.formatMapListeners.indexOf(listener)
      if (idx >= 0) this.formatMapListeners.splice(idx, 1)
    }
  }

  /**
   * Detect a file's format (renderer id) from its extension by consulting
   * currently-active format plugins. Falls back to 'plaintext' when no
   * plugin claims the extension. This value is used as the file's
   * *label* (badge text) — routing to a specific editor happens against
   * the FormatBinding, not this string. Plugin-owned extensions surface
   * as the raw extension (e.g. 'json') so the badge shows a familiar
   * uppercase acronym instead of an internal plugin id.
   */
  detectFormat(filePath: string): NoteFormat {
    const dotIdx = filePath.lastIndexOf('.')
    if (dotIdx === -1) return 'plaintext'
    const ext = filePath.slice(dotIdx + 1).toLowerCase()
    const binding = this.extensionBindings.get(ext)
    if (!binding) return 'plaintext'
    if (binding.kind === 'builtin') return binding.renderer
    return ext
  }

  /** Snapshot of the current extension → binding map, sent to renderers. */
  getFormatMap(): Record<string, FormatBinding> {
    const map: Record<string, FormatBinding> = {}
    for (const [ext, binding] of this.extensionBindings) {
      map[ext] = binding
    }
    return map
  }

  getFormatPlugin(format: NoteFormat): PluginModule | null {
    const pluginId = this.formatMap.get(format)
    if (!pluginId) return null
    const loaded = this.plugins.get(pluginId)
    return loaded?.module ?? null
  }

  getAIAdapter(format: NoteFormat): AIFormatAdapter | null {
    const mod = this.getFormatPlugin(format)
    return mod?.format?.aiAdapter ?? null
  }

  listPlugins(): PluginInfo[] {
    return Array.from(this.plugins.values()).map((p) => p.info)
  }

  getPlugin(id: string): LoadedPlugin | undefined {
    return this.plugins.get(id)
  }

  addPlugin(info: PluginInfo): void {
    this.plugins.set(info.id, {
      info,
      module: null,
      state: 'installed',
      context: null
    })
  }

  removePlugin(id: string): void {
    // Clean up format mapping
    const loaded = this.plugins.get(id)
    if (loaded?.module?.format) {
      this.formatMap.delete(loaded.module.format.format)
    }
    this.plugins.delete(id)
  }

  /**
   * Activate the builtins the user has (implicitly or explicitly) enabled.
   * Predicate is injected so PluginManager stays decoupled from
   * SettingsStore — main/index.ts passes in `isPluginEnabled`.
   */
  async activateBuiltinPlugins(
    isEnabled: (pluginId: string, autoActivate: boolean) => boolean = () => true
  ): Promise<void> {
    for (const [id, loaded] of this.plugins) {
      if (!loaded.info.isBuiltin) continue
      const autoActivate = loaded.info.autoActivate !== false
      if (!isEnabled(id, autoActivate)) continue
      try {
        await this.activate(id)
      } catch (err) {
        console.error(`Failed to activate builtin plugin ${id}:`, err)
      }
    }
  }
}
