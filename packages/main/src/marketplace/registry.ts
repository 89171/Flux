import { app, dialog } from 'electron'
import { join } from 'path'
import { existsSync, mkdirSync, writeFileSync, readFileSync } from 'fs'
import { tmpdir } from 'os'
import extractZip from 'extract-zip'
import type { MarketplaceEntry, InstalledPluginRecord } from '@shared'
import { getPluginManager } from '../plugin/manager'

/**
 * Marketplace Registry — 插件商城注册表与安装逻辑。
 *
 * 功能：
 *  1. 维护可浏览的插件列表（内置目录 + 可选远程索引）
 *  2. 从远程 URL 下载 zip 包 → 解压 → 安装
 *  3. 从本地 zip 文件安装
 *  4. 从本地目录安装（直接调用 PluginManager.install）
 *  5. 第三方发布：开发者打包 zip → 上传到 registry → 用户一键安装
 *
 * 内置目录包含若干示例插件条目，演示商城交互。
 * 生产环境可替换为远程 registry API。
 */

/** 内置商城目录（示例条目） */
const BUILTIN_MARKET: MarketplaceEntry[] = [
  {
    id: 'drawio',
    name: '@painote/plugin-drawio',
    displayName: 'Drawio 流程图',
    description: '基于 drawio 的流程图、架构图编辑器，支持 XML 格式输出',
    version: '0.9.0',
    format: 'drawio',
    author: 'PaiNote Team',
    downloadUrl: 'https://registry.painote.app/plugins/drawio/0.9.0.zip',
    homepage: 'https://github.com/painote/plugin-drawio'
  },
  {
    id: 'mindmap',
    name: '@painote/plugin-mindmap',
    displayName: '思维导图',
    description: '基于 markmap 的思维导图编辑器，Markdown 驱动层级结构',
    version: '0.8.0',
    format: 'mindmap',
    author: 'PaiNote Team',
    downloadUrl: 'https://registry.painote.app/plugins/mindmap/0.8.0.zip',
    homepage: 'https://github.com/painote/plugin-mindmap'
  },
  {
    id: 'kanban',
    name: '@painote/plugin-kanban',
    displayName: '看板',
    description: '任务看板，支持拖拽列卡片、状态流转',
    version: '0.5.0',
    format: 'kanban',
    author: 'Community',
    downloadUrl: 'https://registry.painote.app/plugins/kanban/0.5.0.zip'
  },
  {
    id: 'excalidraw',
    name: '@painote/plugin-excalidraw',
    displayName: 'Excalidraw 手绘',
    description: '手绘风格白板，适合快速草图和原型',
    version: '0.3.0',
    format: 'excalidraw',
    author: 'Community',
    downloadUrl: 'https://registry.painote.app/plugins/excalidraw/0.3.0.zip'
  }
]

/** 远程索引缓存路径 */
function getCachePath(): string {
  const dir = join(app.getPath('userData'), 'market-cache')
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true })
  return join(dir, 'index.json')
}

class MarketplaceRegistry {
  /**
   * 获取商城插件列表。
   * 合并内置目录 + 缓存的远程索引（如果有）。
   */
  async list(): Promise<MarketplaceEntry[]> {
    const entries = [...BUILTIN_MARKET]

    // 尝试读取远程缓存
    const cachePath = getCachePath()
    if (existsSync(cachePath)) {
      try {
        const remote = JSON.parse(readFileSync(cachePath, 'utf-8')) as MarketplaceEntry[]
        // 合并去重（远程覆盖内置同 id）
        const ids = new Set(entries.map((e) => e.id))
        for (const r of remote) {
          if (!ids.has(r.id)) entries.push(r)
        }
      } catch {
        // 缓存损坏，忽略
      }
    }

    return entries
  }

  /**
   * 从商城安装插件。
   * 下载 zip → 解压到临时目录 → 调用 PluginManager.install
   */
  async install(id: string): Promise<InstalledPluginRecord> {
    const entries = await this.list()
    const entry = entries.find((e) => e.id === id)
    if (!entry) throw new Error(`商城中未找到插件: ${id}`)

    // 下载 zip
    const zipDir = join(tmpdir(), 'painote-downloads')
    if (!existsSync(zipDir)) mkdirSync(zipDir, { recursive: true })
    const zipPath = join(zipDir, `${id}-${entry.version}.zip`)

    try {
      const resp = await fetch(entry.downloadUrl)
      if (!resp.ok) {
        throw new Error(`下载失败: HTTP ${resp.status}`)
      }
      const buf = Buffer.from(await resp.arrayBuffer())
      writeFileSync(zipPath, buf)
    } catch (e) {
      throw new Error(
        `下载插件失败: ${(e as Error).message}\n` +
        `你可以手动下载 zip 后使用"本地安装"功能。`
      )
    }

    // 解压
    const extractDir = join(tmpdir(), 'painote-extract', `${id}-${Date.now()}`)
    try {
      await extractZip(zipPath, { dir: extractDir })
    } catch (e) {
      throw new Error(`解压失败: ${(e as Error).message}`)
    }

    // 安装
    const manager = getPluginManager()
    return manager.install(extractDir)
  }

  /**
   * 从本地 zip 文件安装。
   * 弹出文件选择对话框 → 解压 → 安装
   */
  async installLocal(): Promise<InstalledPluginRecord | null> {
    const result = await dialog.showOpenDialog({
      title: '选择插件包或目录',
      properties: ['openFile', 'openDirectory'],
      filters: [
        { name: '插件包', extensions: ['zip'] },
        { name: '所有文件', extensions: ['*'] }
      ]
    })

    if (result.canceled || result.filePaths.length === 0) {
      return null
    }

    const selectedPath = result.filePaths[0]
    const manager = getPluginManager()

    // 如果是 zip 文件，先解压
    if (selectedPath.endsWith('.zip')) {
      const extractDir = join(tmpdir(), 'painote-extract', `local-${Date.now()}`)
      try {
        await extractZip(selectedPath, { dir: extractDir })
      } catch (e) {
        throw new Error(`解压失败: ${(e as Error).message}`)
      }
      return manager.install(extractDir)
    }

    // 如果是目录，直接安装
    return manager.install(selectedPath)
  }

  /** 卸载插件（委托给 PluginManager） */
  async uninstall(id: string): Promise<void> {
    return getPluginManager().uninstall(id)
  }
}

// 单例
let _instance: MarketplaceRegistry | null = null

export function getMarketplace(): MarketplaceRegistry {
  if (!_instance) _instance = new MarketplaceRegistry()
  return _instance
}
