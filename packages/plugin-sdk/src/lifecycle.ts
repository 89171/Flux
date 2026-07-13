/**
 * 插件生命周期阶段常量。
 *
 * 完整流转：
 *   install  →  load  →  activate  ⇄  deactivate  →  uninstall
 *   (下载安装)  (加载模块)  (注册格式)    (停用格式)      (删除文件)
 *
 * 每个阶段对应 PluginLifecycle 上的一个可选钩子，引擎按顺序调用。
 */
export const PluginStage = {
  Install: 'install',
  Load: 'load',
  Activate: 'activate',
  Deactivate: 'deactivate',
  Uninstall: 'uninstall'
} as const

export type PluginStage = (typeof PluginStage)[keyof typeof PluginStage]

/** 正向生命周期顺序 */
export const LIFECYCLE_ORDER = [
  PluginStage.Install,
  PluginStage.Load,
  PluginStage.Activate,
  PluginStage.Deactivate,
  PluginStage.Uninstall
] as const

/**
 * 校验某次状态跃迁是否合法，非法跃迁抛错。
 * 例如：未 load 不允许 activate；active 才能 deactivate。
 */
const ALLOWED: Record<PluginStage, PluginStage[]> = {
  install: [PluginStage.Load],
  load: [PluginStage.Activate],
  activate: [PluginStage.Deactivate],
  deactivate: [PluginStage.Activate, PluginStage.Uninstall],
  uninstall: []
}

export function assertTransition(from: PluginStage, to: PluginStage): void {
  const allowed = ALLOWED[from]
  if (!allowed.includes(to)) {
    throw new Error(`[PaiNote] 非法的生命周期跃迁: ${from} -> ${to}`)
  }
}
