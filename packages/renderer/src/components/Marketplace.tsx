import { useEffect, useState } from 'react'
import { useMarketStore } from '../store/market'
import { usePluginHost } from '../plugin-host/store'

/**
 * 插件商城视图。
 *
 * 功能：
 *  - 浏览可用插件（卡片网格）
 *  - 一键安装/卸载
 *  - 本地安装（选择 zip 或目录）
 *  - 开发者发布指南
 */
export function Marketplace(): JSX.Element {
  const { entries, loading, error, installing, loadEntries, install, installLocal, uninstall, setShowMarket } =
    useMarketStore()
  const { entries: pluginEntries } = usePluginHost()
  const [showDevGuide, setShowDevGuide] = useState(false)

  useEffect(() => {
    void loadEntries()
  }, [loadEntries])

  // 获取已安装插件 id 列表
  const installedIds = new Set(
    Object.values(pluginEntries).map((e) => e.plugin.manifest.id)
  )

  const handleInstall = (id: string): void => {
    void install(id).then((ok) => {
      if (ok) {
        // 安装成功后刷新插件列表
        window.location.reload()
      }
    })
  }

  const handleUninstall = (id: string): void => {
    if (!confirm(`确定卸载插件 ${id}？`)) return
    void uninstall(id).then((ok) => {
      if (ok) window.location.reload()
    })
  }

  const handleInstallLocal = (): void => {
    void installLocal().then((ok) => {
      if (ok) window.location.reload()
    })
  }

  return (
    <div className="marketplace">
      <div className="market-header">
        <div className="market-header-info">
          <h2>插件商城</h2>
          <span className="market-subtitle">安装格式插件，扩展 PaiNote 的笔记格式</span>
        </div>
        <div className="market-header-actions">
          <button className="ghost" onClick={() => setShowDevGuide(!showDevGuide)}>
            开发者指南
          </button>
          <button className="ghost" onClick={handleInstallLocal} title="从本地 zip 或目录安装">
            本地安装
          </button>
          <button className="ghost" onClick={() => setShowMarket(false)}>
            返回笔记
          </button>
        </div>
      </div>

      {error && <div className="market-error">{error}</div>}

      {showDevGuide && <DevGuide />}

      {loading ? (
        <div className="market-loading">加载中…</div>
      ) : (
        <div className="market-grid">
          {entries.map((entry) => {
            const isInstalled = installedIds.has(entry.id)
            const isInstalling = installing.has(entry.id)
            return (
              <div key={entry.id} className="plugin-card">
                <div className="plugin-card-header">
                  <div className="plugin-icon">{entry.displayName.charAt(0)}</div>
                  <div className="plugin-card-info">
                    <h3>{entry.displayName}</h3>
                    <span className="plugin-version">v{entry.version}</span>
                  </div>
                </div>
                <p className="plugin-desc">{entry.description}</p>
                <div className="plugin-meta">
                  <span className="plugin-format">格式: {entry.format}</span>
                  <span className="plugin-author">作者: {entry.author}</span>
                </div>
                <div className="plugin-actions">
                  {isInstalled ? (
                    <button
                      className="ghost plugin-uninstall"
                      onClick={() => handleUninstall(entry.id)}
                    >
                      卸载
                    </button>
                  ) : (
                    <button
                      className="primary"
                      onClick={() => handleInstall(entry.id)}
                      disabled={isInstalling}
                    >
                      {isInstalling ? '安装中…' : '安装'}
                    </button>
                  )}
                  {entry.homepage && (
                    <button
                      className="ghost"
                      onClick={() => window.open(entry.homepage, '_blank')}
                    >
                      主页
                    </button>
                  )}
                </div>
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}

/** 开发者发布指南 */
function DevGuide(): JSX.Element {
  return (
    <div className="dev-guide">
      <h3>插件开发与发布指南</h3>
      <ol>
        <li>
          <strong>创建插件项目</strong>
          <pre>{`mkdir my-plugin && cd my-plugin
npm init -y
npm install @painote/plugin-sdk react`}</pre>
        </li>
        <li>
          <strong>在 package.json 中声明 painote 字段</strong>
          <pre>{`{
  "name": "@your-name/my-plugin",
  "painote": {
    "id": "my-plugin",
    "format": "my-format",
    "displayName": "我的插件",
    "main": "dist/index.js",
    "permissions": ["fs:notes", "ai:generate", "storage"]
  }
}`}</pre>
        </li>
        <li>
          <strong>实现插件入口（src/index.tsx）</strong>
          <pre>{`import { definePlugin, textToDoc } from '@painote/plugin-sdk'
export default definePlugin<string>({
  manifest: { /* ... */ },
  editor: MyEditor,
  serialize: (doc) => doc.content,
  deserialize: (raw) => textToDoc('my-format', raw),
  aiAdapter: { systemPrompt: '...', parse: (t) => textToDoc('my-format', t) }
})`}</pre>
        </li>
        <li>
          <strong>打包构建</strong>
          <pre>{`npx tsc --outDir dist
# 或使用 webpack/vite 打包`}</pre>
        </li>
        <li>
          <strong>发布到商城</strong>
          <p>将插件目录打包为 zip，通过"本地安装"测试，或提交到 PaiNote Plugin Registry。</p>
        </li>
      </ol>
      <p className="dev-guide-hint">
        详细文档请参考项目根目录的 <code>PLUGIN_DEV.md</code>
      </p>
    </div>
  )
}
