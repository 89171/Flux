import type { PluginContext, PluginManifest } from '@plugin-sdk'
import { createPrefixedLogger } from '@plugin-sdk'

/**
 * 构造注入给插件的真实 PluginContext。
 * 所有能力通过 preload 暴露的 window.painote 桥接到主进程，
 * 并按 manifest.permissions 做权限闸门：未声明的能力调用会被拒绝。
 */
export function createPluginContext(manifest: PluginManifest): PluginContext {
  const host = window.painote
  const logger = createPrefixedLogger(manifest.id)
  const has = (p: string) => manifest.permissions.includes(p as never)

  return {
    pluginId: manifest.id,
    manifest,
    logger,

    fs: {
      readNote: (id) => host.note.get(id).then((r) => r?.raw ?? null),
      writeNote: async (id, raw) => {
        await host.note.save(id, raw)
      },
      readData: async (relPath) => {
        // 插件私有数据存储在主进程 pluginsRoot/<id>/data/<relPath>
        // 通过 fs:plugin 权限；当前骨架返回 null，第 6 步补全文件读写 IPC
        if (!has('fs:plugin')) throw new Error(`插件 ${manifest.id} 未声明 fs:plugin 权限`)
        return null
      },
      writeData: async () => {
        if (!has('fs:plugin')) throw new Error(`插件 ${manifest.id} 未声明 fs:plugin 权限`)
      }
    },

    ai: {
      generate: (prompt, opts) => {
        if (!has('ai:generate')) throw new Error(`插件 ${manifest.id} 未声明 ai:generate 权限`)
        return host.ai.generate(prompt, opts)
      },
      chat: (messages) => {
        if (!has('ai:generate')) throw new Error(`插件 ${manifest.id} 未声明 ai:generate 权限`)
        return host.ai.chat(messages)
      }
    },

    window: {
      pin: async () => {
        if (!has('window:pin')) throw new Error(`插件 ${manifest.id} 未声明 window:pin 权限`)
        await host.window.pin()
      },
      unpin: async () => {
        if (!has('window:pin')) throw new Error(`插件 ${manifest.id} 未声明 window:pin 权限`)
        await host.window.unpin()
      },
      setOpacity: async (o) => {
        if (!has('window:pin')) throw new Error(`插件 ${manifest.id} 未声明 window:pin 权限`)
        await host.window.setOpacity(o)
      }
    },

    storage: {
      get: async <T = unknown>(key: string): Promise<T | null> => {
        if (!has('storage')) throw new Error(`插件 ${manifest.id} 未声明 storage 权限`)
        // 骨架：用 localStorage 作插件私有 KV（生产环境应走主进程隔离存储）
        const v = localStorage.getItem(`pn:${manifest.id}:${key}`)
        return v ? (JSON.parse(v) as T) : null
      },
      set: async (key, value) => {
        if (!has('storage')) throw new Error(`插件 ${manifest.id} 未声明 storage 权限`)
        localStorage.setItem(`pn:${manifest.id}:${key}`, JSON.stringify(value))
      },
      delete: async (key) => {
        if (!has('storage')) throw new Error(`插件 ${manifest.id} 未声明 storage 权限`)
        localStorage.removeItem(`pn:${manifest.id}:${key}`)
      }
    },

    notify: (title, body) => {
      if (!has('notification')) {
        logger.warn('未声明 notification 权限，通知被拦截')
        return
      }
      host.notify(title, body)
    }
  }
}
