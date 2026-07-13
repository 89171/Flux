import { app, BrowserWindow, protocol } from 'electron'
import { join, extname } from 'path'
import { existsSync, readFileSync } from 'fs'
import { registerIpcHandlers } from './ipc/handlers'
import { getPluginManager } from './plugin/manager'
import { getWindowManager } from './window/manager'

/**
 * 主进程入口。
 *
 * 职责：
 *  - 注册 painote-plugin:// 自定义协议（渲染进程借此动态加载第三方插件 UI 包）
 *  - 注册 IPC 处理器
 *  - 创建主窗口
 */

// 自定义协议需在 app ready 前注册为 privileged，才能支持 fetch / ESM import
protocol.registerSchemesAsPrivileged([
  {
    scheme: 'painote-plugin',
    privileges: {
      standard: true,
      secure: true,
      supportFetchAPI: true,
      stream: true,
      bypassCSP: true
    }
  }
])

const MIME: Record<string, string> = {
  '.js': 'text/javascript',
  '.mjs': 'text/javascript',
  '.css': 'text/css',
  '.json': 'application/json',
  '.html': 'text/html',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.woff2': 'font/woff2'
}

function mimeOf(p: string): string {
  return MIME[extname(p).toLowerCase()] ?? 'application/octet-stream'
}

/** painote-plugin://plugin/<id>/<相对路径> -> 读取 pluginsRoot/<id>/<相对路径> */
function registerPluginProtocol(): void {
  protocol.handle('painote-plugin', async (request) => {
    try {
      const url = new URL(request.url)
      // host 固定为 "plugin"，pathname 形如 /<id>/<相对路径>
      const segments = decodeURIComponent(url.pathname).replace(/^\/+/, '').split('/')
      const id = segments[0]
      const relPath = segments.slice(1).join('/')
      if (!id || !relPath) {
        return new Response('Bad plugin resource path', { status: 400 })
      }
      const entryPath = getPluginManager().getEntryPath(id)
      if (!entryPath) {
        return new Response(`Plugin not loaded: ${id}`, { status: 404 })
      }
      // entryPath 是入口绝对路径；相对路径相对插件根目录解析
      const pluginDir = join(entryPath, '..')
      const filePath = join(pluginDir, relPath)
      if (!existsSync(filePath)) {
        return new Response(`Not found: ${relPath}`, { status: 404 })
      }
      const body = readFileSync(filePath)
      return new Response(body, {
        status: 200,
        headers: { 'content-type': mimeOf(filePath) }
      })
    } catch (e) {
      return new Response(`Plugin protocol error: ${(e as Error).message}`, { status: 500 })
    }
  })
}

function createMainWindow(): BrowserWindow {
  return getWindowManager().createMainWindow()
}

app.whenReady().then(() => {
  registerPluginProtocol()
  registerIpcHandlers()
  // 触发插件管理器初始化（扫描已安装插件）
  getPluginManager()

  createMainWindow()

  // 冒烟测试模式：8 秒后自动退出，输出捕获到的渲染进程日志
  if (process.env.PAINOTE_SMOKE) {
    setTimeout(() => {
      console.log('[smoke] 8s reached, quitting')
      app.quit()
    }, 8000)
  }

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createMainWindow()
  })
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit()
})
