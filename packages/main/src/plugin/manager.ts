import { app } from 'electron'
import { join } from 'path'
import { cpSync, existsSync, rmSync } from 'fs'
import type { InstalledPluginRecord } from '@shared/types'
import { PluginStage, assertTransition } from '@plugin-sdk/lifecycle'
import { getPluginsRoot, listInstalledPlugins, upsertPluginRecord, removePluginRecord, findPluginRecord } from './store'
import { loadManifest, type LoadedManifest } from './loader'

/** 内置插件 id 白名单（不可卸载） */
export const BUILTIN_PLUGIN_IDS = ['plaintext', 'markdown']

export interface PluginListItem extends InstalledPluginRecord {
  name?: string
  displayName: string
  description?: string
  icon?: string
  /** 渲染进程加载入口用的 URL（内置插件为 null，由渲染进程静态导入） */
  entryUrl: string | null
}

/**
 * 插件管理器（主进程侧）。
 *
 * 职责：
 *  - 第三方插件的安装 / 卸载（文件级操作 + 状态持久化）
 *  - 插件生命周期状态机维护（install → load → activate ⇄ deactivate → uninstall）
 *  - 为渲染进程提供入口 URL（通过 painote-plugin:// 协议）
 *
 * 注意：插件 UI 组件（React）在渲染进程加载，主进程只管理元信息与文件。
 * 内置插件由渲染进程静态导入注册，主进程仅记录其 id 以阻止卸载。
 */
export class PluginManager {
  /** 内存中已加载的 manifest 缓存（id -> LoadedManifest） */
  private loaded = new Map<string, LoadedManifest>()
  /** 各插件当前所处的生命周期阶段 */
  private stage = new Map<string, PluginStage>()

  constructor() {
    // 应用启动时扫描已安装插件，恢复到 loaded 状态（不自动 activate，由渲染进程按需激活）
    for (const rec of listInstalledPlugins()) {
      try {
        const loaded = loadManifest(rec.installPath)
        this.loaded.set(rec.id, loaded)
        this.stage.set(rec.id, PluginStage.Load)
      } catch (e) {
        console.error(`[PluginManager] 恢复插件 ${rec.id} 失败:`, e)
        removePluginRecord(rec.id)
      }
    }
  }

  isBuiltin(id: string): boolean {
    return BUILTIN_PLUGIN_IDS.includes(id)
  }

  /** 列出所有插件（内置 + 已安装第三方） */
  list(): PluginListItem[] {
    const items: PluginListItem[] = []

    // 内置插件：渲染进程静态注册，这里只输出元信息（entryUrl=null）
    for (const id of BUILTIN_PLUGIN_IDS) {
      items.push({
        id,
        name: `@painote/builtin-${id}`,
        format: id,
        version: '1.0.0',
        installedAt: 0,
        builtin: true,
        status: 'active',
        installPath: '',
        displayName: id,
        entryUrl: null
      })
    }

    // 第三方已安装插件
    for (const rec of listInstalledPlugins()) {
      const loaded = this.loaded.get(rec.id)
      items.push({
        ...rec,
        displayName: loaded?.manifest.displayName ?? rec.id,
        description: loaded?.manifest.description,
        icon: loaded?.manifest.icon,
        entryUrl: this.buildEntryUrl(rec.id, loaded?.manifest.main ?? 'dist/index.js')
      })
    }
    return items
  }

  /**
   * 安装插件（从本地目录拷贝到 pluginsRoot）。
   * 第三方插件市场安装最终也走这里（下载解压后得到目录）。
   */
  async install(sourceDir: string): Promise<InstalledPluginRecord> {
    const { manifest, pluginDir } = loadManifest(sourceDir)
    if (this.isBuiltin(manifest.id)) {
      throw new Error(`[PluginManager] id "${manifest.id}" 与内置插件冲突`)
    }
    const existing = findPluginRecord(manifest.id)
    if (existing && !existing.builtin) {
      // 已存在则先卸载旧版再装新版（升级）
      await this.uninstall(manifest.id)
    }

    const dest = join(getPluginsRoot(), manifest.id)
    if (existsSync(dest)) rmSync(dest, { recursive: true, force: true })
    cpSync(pluginDir, dest, { recursive: true })

    // 重新从目标加载校验
    const loaded = loadManifest(dest)
    this.loaded.set(manifest.id, loaded)
    this.stage.set(manifest.id, PluginStage.Install)

    const record: InstalledPluginRecord = {
      id: manifest.id,
      format: manifest.format,
      version: manifest.version,
      installedAt: Date.now(),
      builtin: false,
      status: 'installed',
      installPath: dest
    }
    upsertPluginRecord(record)
    return record
  }

  /** 激活插件（状态机：installed/load -> activate） */
  async activate(id: string): Promise<void> {
    const from = this.stage.get(id) ?? PluginStage.Install
    assertTransition(from, PluginStage.Activate)
    this.stage.set(id, PluginStage.Activate)
    const rec = findPluginRecord(id)
    if (rec) {
      upsertPluginRecord({ ...rec, status: 'active' })
    }
  }

  /** 停用插件 */
  async deactivate(id: string): Promise<void> {
    const from = this.stage.get(id) ?? PluginStage.Activate
    assertTransition(from, PluginStage.Deactivate)
    this.stage.set(id, PluginStage.Deactivate)
    const rec = findPluginRecord(id)
    if (rec) {
      upsertPluginRecord({ ...rec, status: 'inactive' })
    }
  }

  /** 卸载插件（内置不可卸载） */
  async uninstall(id: string): Promise<void> {
    if (this.isBuiltin(id)) {
      throw new Error(`[PluginManager] 内置插件不可卸载: ${id}`)
    }
    const from = this.stage.get(id) ?? PluginStage.Activate
    assertTransition(from, PluginStage.Uninstall)
    const rec = findPluginRecord(id)
    if (rec && existsSync(rec.installPath)) {
      rmSync(rec.installPath, { recursive: true, force: true })
    }
    removePluginRecord(id)
    this.loaded.delete(id)
    this.stage.delete(id)
  }

  /** 获取插件入口文件绝对路径（供协议 handler 读取） */
  getEntryPath(id: string): string | null {
    const loaded = this.loaded.get(id)
    if (!loaded) return null
    return loaded.entryPath
  }

  /** 构造渲染进程可动态 import 的入口 URL */
  private buildEntryUrl(id: string, main: string): string {
    return `painote-plugin://plugin/${id}/${main}`
  }
}

let managerInstance: PluginManager | null = null
export function getPluginManager(): PluginManager {
  if (!managerInstance) managerInstance = new PluginManager()
  return managerInstance
}

export { app }
