/**
 * @painote/plugin-sdk
 *
 * PaiNote 插件开发工具包。第三方插件作者只需依赖本包即可开发格式插件。
 *
 * 快速上手：
 *   import { definePlugin, defineAIAdapter, textToDoc } from '@painote/plugin-sdk'
 *
 *   export default definePlugin({
 *     manifest: { id: 'myformat', format: 'myformat', displayName: 'My Format', ... },
 *     editor: MyEditor,
 *     serialize: (doc) => doc.content,
 *     deserialize: (raw) => ({ format: 'myformat', content: raw }),
 *     aiAdapter: defineAIAdapter({ systemPrompt: '...', parse: (t) => ({...}) })
 *   })
 */
export * from './types'
export * from './lifecycle'
export * from './context'
export * from './ai-adapter'

import type { PaiNotePlugin, PluginManifest } from './types'

/**
 * 插件定义辅助函数：提供类型推导 + manifest 校验。
 * 这是插件封装语法的入口：所有插件都应通过 definePlugin 包装后默认导出。
 */
export function definePlugin<T>(plugin: PaiNotePlugin<T>): PaiNotePlugin<T> {
  assertManifest(plugin.manifest)
  assertRequiredFns(plugin)
  return plugin
}

function assertManifest(m: PluginManifest): void {
  const required: (keyof PluginManifest)[] = ['id', 'format', 'displayName', 'name', 'version', 'main']
  for (const key of required) {
    if (!m[key]) {
      throw new Error(`[PaiNote SDK] 插件 manifest 缺少必填字段: ${String(key)}`)
    }
  }
  if (!/^[a-z0-9-]+$/.test(m.id)) {
    throw new Error(`[PaiNote SDK] 插件 id 只能包含小写字母/数字/连字符: ${m.id}`)
  }
  if (m.id !== m.format) {
    // 约定 id 与 format 一致，避免一对多混淆；如需多格式可后续扩展
    console.warn(`[PaiNote SDK] 建议 plugin.id(${m.id}) 与 format(${m.format}) 保持一致`)
  }
}

function assertRequiredFns<T>(plugin: PaiNotePlugin<T>): void {
  if (typeof plugin.serialize !== 'function' || typeof plugin.deserialize !== 'function') {
    throw new Error('[PaiNote SDK] 插件必须实现 serialize / deserialize')
  }
  if (!plugin.editor) {
    throw new Error('[PaiNote SDK] 插件必须提供 editor 组件')
  }
}
