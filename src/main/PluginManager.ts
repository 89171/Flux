import { join } from 'path'
import { existsSync, readdirSync, readFileSync, mkdirSync, writeFileSync } from 'fs'
import { app, BrowserWindow, Notification, ipcMain } from 'electron'
import { is } from '@electron-toolkit/utils'
import type { NoteFormat, PluginInfo, PluginManifest } from '@shared/types'
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
import { BUILTIN_PLUGINS_DIR, USER_PLUGINS_DIR } from '@shared/constants'

export interface LoadedPlugin {
  info: PluginInfo
  module: PluginModule | null
  state: PluginState
  context: PluginContext | null
}

export class PluginManager {
  plugins: Map<string, LoadedPlugin> = new Map()
  formatMap: Map<NoteFormat, string> = new Map()

  private mainWindow: BrowserWindow | null = null
  private workspacePath: string = ''
  private commands: Map<string, PluginCommand> = new Map()
  private eventHandlers: Map<string, Array<(data: unknown) => void>> = new Map()

  setMainWindow(win: BrowserWindow | null): void {
    this.mainWindow = win
  }

  setWorkspacePath(path: string): void {
    this.workspacePath = path
  }

  getBuiltinPluginsPath(): string {
    if (is.dev) {
      return join(app.getAppPath(), 'src', 'builtin-plugins')
    }
    // In production, builtin plugins are packaged alongside the app
    return join(app.getAppPath(), 'src', 'builtin-plugins')
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

        // Resolve the icon: if it looks like a file path (contains / or has
        // a file extension), convert to file:// URL. Otherwise keep as-is
        // (e.g. lucide icon names like "FileText").
        let resolvedIcon = manifest.icon
        if (resolvedIcon && (resolvedIcon.includes('/') || resolvedIcon.endsWith('.png') || resolvedIcon.endsWith('.svg') || resolvedIcon.endsWith('.jpg'))) {
          resolvedIcon = `file://${join(pluginDir, resolvedIcon)}`
        }

        const info: PluginInfo = {
          ...manifest,
          icon: resolvedIcon,
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

      // Register format mapping
      if (mod.format) {
        this.formatMap.set(mod.format.format, pluginId)
      }
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

    try {
      if (loaded.module?.onDeactivate && loaded.context) {
        await loaded.module.onDeactivate(loaded.context)
      }

      // Unregister format mapping
      if (loaded.module?.format) {
        this.formatMap.delete(loaded.module.format.format)
      }

      loaded.state = 'inactive'
      loaded.info.status = 'inactive'
    } catch (err) {
      loaded.state = 'error'
      loaded.info.status = 'error'
      loaded.info.errorMessage = err instanceof Error ? err.message : String(err)
      throw err
    }
  }

  loadPluginModule(info: PluginInfo): PluginModule {
    const entryPath = join(info.installPath, info.main)
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const mod = require(entryPath)
    return mod.default || mod
  }

  createContext(info: PluginInfo): PluginContext {
    const self = this

    const logger: PluginLogger = {
      info: (...args: unknown[]) => console.log(`[Plugin:${info.id}]`, ...args),
      warn: (...args: unknown[]) => console.warn(`[Plugin:${info.id}]`, ...args),
      error: (...args: unknown[]) => console.error(`[Plugin:${info.id}]`, ...args),
      debug: (...args: unknown[]) => console.debug(`[Plugin:${info.id}]`, ...args)
    }

    const api: PluginAPI = {
      readFile: async (path: string): Promise<string> => {
        const fullPath = join(self.workspacePath, path)
        return readFileSync(fullPath, 'utf-8')
      },

      writeFile: async (path: string, content: string): Promise<void> => {
        const fullPath = join(self.workspacePath, path)
        writeFileSync(fullPath, content, 'utf-8')
      },

      notify: (message: string, type: 'info' | 'success' | 'warning' | 'error' = 'info'): void => {
        new Notification({
          title: info.name,
          body: message
        }).show()
      },

      registerCommand: (command: PluginCommand): void => {
        self.commands.set(command.id, command)
      },

      unregisterCommand: (commandId: string): void => {
        self.commands.delete(commandId)
      },

      getWorkspacePath: (): string => self.workspacePath,

      emit: (event: string, data?: unknown): void => {
        // Send to renderer
        self.mainWindow?.webContents.send(`plugin:${event}`, data)
        // Trigger local handlers
        const handlers = self.eventHandlers.get(event)
        if (handlers) {
          for (const handler of handlers) {
            handler(data)
          }
        }
      },

      on: (event: string, handler: (data: unknown) => void): void => {
        const handlers = self.eventHandlers.get(event) || []
        handlers.push(handler)
        self.eventHandlers.set(event, handlers)

        // Also listen for events from renderer
        const channel = `plugin:${event}`
        ipcMain.on(channel, (_e, data) => handler(data))
      }
    }

    return {
      manifest: info,
      pluginPath: info.installPath,
      api,
      logger
    }
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

  async activateBuiltinPlugins(): Promise<void> {
    for (const [id, loaded] of this.plugins) {
      if (loaded.info.isBuiltin) {
        try {
          await this.activate(id)
        } catch (err) {
          console.error(`Failed to activate builtin plugin ${id}:`, err)
        }
      }
    }
  }
}
