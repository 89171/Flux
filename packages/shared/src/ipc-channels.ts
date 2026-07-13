/**
 * 跨进程共享的 IPC 通道名常量。
 * 主进程与渲染进程通过这些通道通信，避免魔法字符串。
 */
export const IPC = {
  // 插件管理
  PLUGIN_LIST: 'plugin:list',
  PLUGIN_INSTALL: 'plugin:install',
  PLUGIN_UNINSTALL: 'plugin:uninstall',
  PLUGIN_ACTIVATE: 'plugin:activate',
  PLUGIN_DEACTIVATE: 'plugin:deactivate',
  PLUGIN_GET_ENTRY: 'plugin:get-entry',

  // 笔记存储
  NOTE_LIST: 'note:list',
  NOTE_CREATE: 'note:create',
  NOTE_GET: 'note:get',
  NOTE_SAVE: 'note:save',
  NOTE_DELETE: 'note:delete',
  NOTE_OPEN_WINDOW: 'note:open-window',

  // AI 生成
  AI_GENERATE: 'ai:generate',
  AI_CHAT: 'ai:chat',
  AI_SET_CONFIG: 'ai:set-config',
  AI_GET_CONFIG: 'ai:get-config',

  // 窗口置顶
  WIN_PIN: 'win:pin',
  WIN_UNPIN: 'win:unpin',
  WIN_OPACITY: 'win:opacity',
  WIN_AUTOSTART: 'win:autostart',
  WIN_SET_AUTOHIDE: 'win:set-autohide',
  WIN_GET_STATE: 'win:get-state',

  // 插件商城
  MARKET_LIST: 'market:list',
  MARKET_INSTALL: 'market:install',
  MARKET_INSTALL_LOCAL: 'market:install-local'
} as const

export type IpcChannel = (typeof IPC)[keyof typeof IPC]
