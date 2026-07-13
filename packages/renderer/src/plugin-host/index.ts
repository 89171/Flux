import type { PaiNotePlugin, PluginContext } from '@plugin-sdk'
import { usePluginHost } from './store'
import { createPluginContext } from './context'

// 内置插件：随应用打包，由渲染进程静态导入注册
import plaintextPlugin from '@plugins/plaintext/src/index'
import markdownPlugin from '@plugins/markdown/src/index'

const BUILTIN_PLUGINS: PaiNotePlugin<any>[] = [plaintextPlugin, markdownPlugin]

/**
 * 注册单个插件：创建上下文、写入注册表、调用 onLoad 钩子。
 */
async function registerPlugin(plugin: PaiNotePlugin, builtin: boolean): Promise<PluginContext> {
  const ctx = createPluginContext(plugin.manifest)
  usePluginHost.getState().register({
    plugin,
    ctx,
    builtin,
    status: 'loaded'
  })
  await plugin.lifecycle?.onLoad?.(ctx)
  return ctx
}

/**
 * 激活插件：调用 onActivate，状态置为 active。
 */
export async function activatePlugin(format: string): Promise<void> {
  const entry = usePluginHost.getState().entries[format]
  if (!entry) throw new Error(`[PluginHost] 未找到格式插件: ${format}`)
  if (entry.status === 'active') return
  await entry.plugin.lifecycle?.onActivate?.(entry.ctx)
  usePluginHost.getState().setStatus(format, 'active')
  entry.ctx.logger.info(`插件已激活: ${entry.plugin.manifest.displayName}`)
}

/** 停用插件 */
export async function deactivatePlugin(format: string): Promise<void> {
  const entry = usePluginHost.getState().entries[format]
  if (!entry) return
  await entry.plugin.lifecycle?.onDeactivate?.()
  usePluginHost.getState().setStatus(format, 'inactive')
}

/**
 * 动态加载第三方插件（通过 painote-plugin:// 协议拉取预构建的 ESM 包）。
 * 插件包默认导出一个 PaiNotePlugin。
 */
export async function loadExternalPlugin(entryUrl: string): Promise<void> {
  try {
    const mod = (await import(/* @vite-ignore */ entryUrl)) as { default: PaiNotePlugin }
    const plugin = mod.default
    if (!plugin?.manifest) throw new Error('插件包未默认导出有效的 PaiNotePlugin')
    await registerPlugin(plugin, false)
    await activatePlugin(plugin.manifest.format)
  } catch (e) {
    console.error(`[PluginHost] 加载外部插件失败: ${entryUrl}`, e)
  }
}

/**
 * 应用启动时初始化插件宿主：
 *  1. 注册所有内置插件
 *  2. 从主进程拉取第三方已安装插件列表并动态加载
 *  3. 激活所有插件
 */
export async function initPluginHost(): Promise<void> {
  // 1. 内置插件
  for (const plugin of BUILTIN_PLUGINS) {
    try {
      await registerPlugin(plugin, true)
      await activatePlugin(plugin.manifest.format)
    } catch (e) {
      console.error(`[PluginHost] 内置插件注册失败: ${plugin.manifest.id}`, e)
    }
  }

  // 2. 第三方已安装插件
  try {
    const list = await window.painote.plugin.list()
    for (const item of list) {
      if (item.builtin || !item.entryUrl) continue
      await loadExternalPlugin(item.entryUrl)
    }
  } catch (e) {
    console.error('[PluginHost] 拉取已安装插件列表失败', e)
  }
}
