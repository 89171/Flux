import type { ComponentType } from 'react'

/**
 * PaiNote 插件 SDK 核心类型定义。
 *
 * 一个插件 = 一份 manifest + 一组格式能力（编辑/查看/序列化/AI 适配/生命周期）。
 * 引擎与格式完全解耦：引擎只认本接口，不关心具体是 Markdown / Drawio / 思维导图。
 */

/** 插件清单：来自 package.json 的 `painote` 字段，描述插件元信息与权限 */
export interface PluginManifest {
  /** 全局唯一标识，如 "markdown" */
  id: string
  /** npm 包名 */
  name: string
  version: string
  /** 格式标识，一份笔记的 format 字段对应此值，如 "markdown" / "drawio" / "mindmap" */
  format: string
  displayName: string
  description?: string
  /** 图标相对路径（相对插件根目录） */
  icon?: string
  author?: string
  /** 入口文件相对路径 */
  main: string
  /** 声明所需权限，未声明的能力调用会被引擎拒绝 */
  permissions: PluginPermission[]
  /** 支持的最低宿主版本 */
  minAppVersion?: string
  /** 是否内置插件（内置插件随应用分发，不可卸载） */
  builtin?: boolean
}

export type PluginPermission =
  | 'fs:notes' // 读写笔记内容
  | 'fs:plugin' // 读写插件私有数据
  | 'ai:generate' // 调用 AI 生成
  | 'window:pin' // 控制窗口置顶/透明度
  | 'notification' // 发送通知
  | 'storage' // 插件私有 KV 存储

/**
 * 插件文档：内容在内存中的统一表示。
 * content 为格式特定数据（Markdown 为 string，Drawio 为 XML 串，思维导图为层级树）。
 */
export interface PluginDocument<T = unknown> {
  format: string
  content: T
  meta?: Record<string, unknown>
}

/** 编辑器组件 Props */
export interface EditorProps<T = unknown> {
  doc: PluginDocument<T>
  onChange: (doc: PluginDocument<T>) => void
  readonly?: boolean
}

/** 只读视图组件 Props */
export interface ViewerProps<T = unknown> {
  doc: PluginDocument<T>
}

/**
 * AI 适配器：让通用 AI 模块的输出适配本格式。
 * AI 只负责生成文本，具体如何结构化由各插件适配器决定 —— 这是格式解耦的关键。
 */
export interface AIAdapter<T = unknown> {
  /** 注入给 AI 的系统提示，告诉它如何输出本格式（如"输出 Markdown""输出 mxGraph XML"） */
  systemPrompt: string
  /** 将 AI 文本输出解析为插件文档 */
  parse: (aiOutput: string) => PluginDocument<T>
  /** 校验文档合法性，非法时引擎不会写入 */
  validate?: (doc: PluginDocument<T>) => boolean
  /** 将当前文档转为给 AI 的上下文文本（多轮修改时回传给 AI） */
  toContext?: (doc: PluginDocument<T>) => string
}

/** 生命周期钩子：引擎在各阶段调用 */
export interface PluginLifecycle {
  /** 安装后调用一次（可做初始化、迁移） */
  onInstall?: (ctx: PluginContext) => void | Promise<void>
  /** 模块加载后调用（注册能力前） */
  onLoad?: (ctx: PluginContext) => void | Promise<void>
  /** 激活：格式可用，编辑器可渲染 */
  onActivate?: (ctx: PluginContext) => void | Promise<void>
  /** 停用：格式卸载，清理运行时状态 */
  onDeactivate?: () => void | Promise<void>
  /** 卸载：删除插件前调用，清理持久化数据 */
  onUninstall?: () => void | Promise<void>
}

export type PluginStatus = 'installed' | 'loaded' | 'active' | 'inactive' | 'error'

// ---------- 注入给插件的能力上下文 ----------

export interface PluginContext {
  pluginId: string
  manifest: PluginManifest
  fs: PluginFS
  ai: PluginAI
  window: PluginWindow
  storage: PluginStorage
  notify: (title: string, body?: string) => void
  logger: PluginLogger
}

export interface PluginFS {
  /** 读取某条笔记的原始内容 */
  readNote: (noteId: string) => Promise<string | null>
  /** 写入某条笔记的原始内容 */
  writeNote: (noteId: string, raw: string) => Promise<void>
  /** 读取插件私有数据（相对插件数据目录） */
  readData: (path: string) => Promise<string | null>
  /** 写入插件私有数据 */
  writeData: (path: string, raw: string) => Promise<void>
}

export interface PluginAI {
  /** 单次生成 */
  generate: (prompt: string, opts?: { images?: string[]; files?: string[] }) => Promise<string>
  /** 多轮对话 */
  chat: (
    messages: Array<{ role: 'system' | 'user' | 'assistant'; content: string }>
  ) => Promise<string>
}

export interface PluginWindow {
  pin: () => Promise<void>
  unpin: () => Promise<void>
  setOpacity: (opacity: number) => Promise<void>
}

export interface PluginStorage {
  get: <T = unknown>(key: string) => Promise<T | null>
  set: (key: string, value: unknown) => Promise<void>
  delete: (key: string) => Promise<void>
}

export interface PluginLogger {
  info: (...args: unknown[]) => void
  warn: (...args: unknown[]) => void
  error: (...args: unknown[]) => void
}

/**
 * 插件主接口：每个插件必须实现并默认导出（或经 definePlugin 包装）。
 */
export interface PaiNotePlugin<T = unknown> {
  manifest: PluginManifest
  /** 编辑器组件（在渲染进程动态挂载） */
  editor: ComponentType<EditorProps<T>>
  /** 只读视图（可选，缺省复用 editor 的 readonly 模式） */
  viewer?: ComponentType<ViewerProps<T>>
  /** 内存文档 -> 存储字符串 */
  serialize: (doc: PluginDocument<T>) => string
  /** 存储字符串 -> 内存文档 */
  deserialize: (raw: string) => PluginDocument<T>
  /** 创建空白文档（新建笔记时用） */
  createEmpty?: () => PluginDocument<T>
  /** AI 适配器（可选，支持则该格式可被 AI 生成/修改） */
  aiAdapter?: AIAdapter<T>
  /** 生命周期钩子 */
  lifecycle?: PluginLifecycle
}
