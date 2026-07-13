import type { PluginContext, PluginLogger } from './types'

/**
 * 构造一个空实现 PluginContext，仅用于单元测试 / 类型占位。
 * 真实上下文由渲染进程宿主通过 preload 桥接注入。
 */
export function createNoopContext(pluginId: string): PluginContext {
  const logger: PluginLogger = {
    info: (...a) => console.log(`[${pluginId}]`, ...a),
    warn: (...a) => console.warn(`[${pluginId}]`, ...a),
    error: (...a) => console.error(`[${pluginId}]`, ...a)
  }
  return {
    pluginId,
    manifest: {} as never,
    fs: {
      readNote: async () => null,
      writeNote: async () => {},
      readData: async () => null,
      writeData: async () => {}
    },
    ai: {
      generate: async () => '',
      chat: async () => ''
    },
    window: {
      pin: async () => {},
      unpin: async () => {},
      setOpacity: async () => {}
    },
    storage: {
      get: async () => null,
      set: async () => {},
      delete: async () => {}
    },
    notify: () => {},
    logger
  }
}

/**
 * 构造带前缀的日志器，供宿主创建真实上下文时复用。
 */
export function createPrefixedLogger(pluginId: string): PluginLogger {
  return {
    info: (...a) => console.log(`%c[PaiNote:${pluginId}]`, 'color:#3b82f6', ...a),
    warn: (...a) => console.warn(`[PaiNote:${pluginId}]`, ...a),
    error: (...a) => console.error(`[PaiNote:${pluginId}]`, ...a)
  }
}
