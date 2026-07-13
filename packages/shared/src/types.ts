/** 一条笔记的元信息（内容体由插件序列化后单独存储） */
export interface Note {
  id: string
  title: string
  format: string // 对应插件的 format 标识
  createdAt: number
  updatedAt: number
  pinned?: boolean
}

/** AI 提供方配置 */
export interface AIConfig {
  baseURL: string
  apiKey: string
  model: string
}

/** 插件商城条目 */
export interface MarketplaceEntry {
  id: string
  name: string
  displayName: string
  description: string
  version: string
  format: string
  author: string
  icon?: string
  downloadUrl: string
  homepage?: string
}

/** 已安装插件的状态记录（持久化） */
export interface InstalledPluginRecord {
  id: string
  format: string
  version: string
  installedAt: number
  builtin: boolean
  status: 'installed' | 'active' | 'inactive' | 'error'
  installPath: string // 插件目录绝对路径
}

/** 窗口置顶状态 */
export interface WindowState {
  pinned: boolean
  opacity: number
  autoStart: boolean
  autoHide: boolean
  collapsed: boolean
}
