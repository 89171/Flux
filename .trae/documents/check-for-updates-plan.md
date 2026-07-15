# 检查更新功能实现计划

## 概述

为 Flux 编辑器添加「检查更新」功能。采用**仅检查版本**方案：通过 GitHub Releases API 对比当前版本与最新发布版本，**不**接入 electron-updater 自动下载，**不**改动 CI。检查结果通过**独立模态对话框**展示，入口为 Help 菜单与命令面板（Cmd+P）。

## 当前状态分析

经代码探索，**主进程侧已完成**，**渲染进程/preload 侧缺失**：

| 层 | 状态 | 位置 |
|---|---|---|
| IPC 通道 `APP_CHECK_FOR_UPDATES` | ✅ 已存在 | `src/shared/ipc-channels.ts:53` |
| `UpdateCheckResult` 类型 | ✅ 已存在 | `src/shared/types.ts:306-312` |
| 主进程 IPC handler（GitHub API + semver 对比） | ✅ 已存在 | `src/main/ipc/index.ts:553-601` |
| `APP_VERSION` 未使用导入（死代码） | ⚠️ 需清理 | `src/main/ipc/index.ts:5` |
| Preload `app.checkForUpdates` 方法 | ❌ 缺失 | `src/preload/index.ts:110-122` |
| Help 菜单「Check for Updates...」入口 | ❌ 缺失 | `src/main/index.ts:214-234` |
| 渲染进程更新结果对话框 | ❌ 缺失 | 新建组件 |
| `handleCommand` 的 `case 'check-for-updates'` | ❌ 缺失 | `src/renderer/src/App.tsx:103-140` |
| 命令面板「Help: Check for Updates」 | ❌ 缺失 | `src/renderer/src/App.tsx:88-101` |

关键事实：
- 仓库 URL：`https://github.com/jianmin-zhu/Flux`（主进程 handler 已使用对应 API `https://api.github.com/repos/jianmin-zhu/Flux/releases/latest`）
- `app.getVersion()` 已在主进程使用，无需 `APP_VERSION` 常量（该常量仍被 `PluginInstaller.ts` 使用，**不可**从 `constants.ts` 删除，仅删除 `main/ipc/index.ts` 中的未使用导入）
- Help 菜单通过 `sendMenuAction(action)` 辅助函数（`src/main/index.ts:80-82`）经 `IPC.MENU_ACTION_EVENT` 转发到渲染进程
- 渲染进程 `on.menuAction` 回调最终调用 `handleCommand(cmdId)`（`App.tsx:103`）
- 设置面板已有 `version` state 与 About 区段，但本次**不改 SettingsPanel**（用户选择独立模态对话框方案）

## 设计决策

1. **结果展示**：独立模态对话框（非设置面板内联），打开时自动发起检查
2. **入口**：Help 菜单 + 命令面板（Cmd+P），两者触发同一流程
3. **无自动下载**：仅显示「有更新/已是最新/检查失败」三种状态，提供「前往下载」按钮打开 release 页面
4. **复用现有样式**：对话框使用与 QuickOpen/FindReplace 一致的 CSS 变量与遮罩层模式

## 待修改文件

### 1. `src/main/ipc/index.ts` — 清理死代码

**什么**：删除第 5 行未使用的 `APP_VERSION` 导入。

**为什么**：`APP_GET_VERSION` 与 `APP_CHECK_FOR_UPDATES` handler 均使用 `app.getVersion()`，该导入已无引用，且 `noUnusedLocals` 会报类型错误。

**怎么做**：
- 删除：`import { APP_VERSION } from '@shared/constants'`
- 注意：**不**改动 `src/shared/constants.ts`（`APP_VERSION` 仍被 `PluginInstaller.ts` 使用）

### 2. `src/preload/index.ts` — 暴露 checkForUpdates API

**什么**：在 `app` 命名空间（第 110-122 行）添加 `checkForUpdates` 方法，并在类型导入中添加 `UpdateCheckResult`。

**为什么**：渲染进程需通过 `window.flux.app.checkForUpdates()` 调用主进程 handler，当前 preload 未桥接该通道。

**怎么做**：
- 在第 3-14 行的 `import type { ... } from '../shared/types'` 中追加 `UpdateCheckResult`
- 在 `app` 对象的 `openUrl` 后追加：
```ts
checkForUpdates: (): Promise<UpdateCheckResult> =>
  ipcRenderer.invoke(IPC.APP_CHECK_FOR_UPDATES)
```

### 3. `src/main/index.ts` — Help 菜单添加入口

**什么**：在 Help 菜单（第 214-234 行）中，于「About Flux」之后、第一个 separator 之前插入「Check for Updates...」菜单项。

**为什么**：提供从菜单栏触发检查更新的入口，符合 macOS 把「Check for Updates…」置于「About」下方的惯例。

**怎么做**：在 `{ role: 'about', label: 'About Flux' }` 后插入：
```ts
{
  label: 'Check for Updates...',
  click: () => sendMenuAction('check-for-updates')
}
```
（`sendMenuAction` 已定义于本文件第 80-82 行，无需新增导入）

### 4. `src/renderer/src/components/UpdateDialog.tsx` — 新建更新结果对话框组件

**什么**：新建模态对话框组件，打开时自动调用 `window.flux.app.checkForUpdates()`，展示三种状态。

**为什么**：用户选择独立模态对话框方案；现有组件中无更新展示 UI。

**怎么做**：
- Props：`{ onClose: () => void }`
- 状态机：`'checking' | 'has-update' | 'up-to-date' | 'error'`
- 挂载时（`useEffect`）调用 `window.flux.app.checkForUpdates()`，根据 `result.hasUpdate` 与 `result.latestVersion` 切换状态
- UI 结构：
  - 遮罩层（`position: fixed; inset: 0; background: rgba(0,0,0,0.4)`，点击外侧关闭）
  - 居中卡片（复用 `--bg-primary`、`--text-primary`、`--border-color` 等 CSS 变量）
  - `checking` 态：spinner 文案「正在检查更新…」
  - `has-update` 态：标题「发现新版本」+ 当前版本 → 最新版本 + release notes（`<pre>` 折叠展示）+ 按钮「前往下载」（`window.flux.app.openUrl(releaseUrl)`）/「稍后再说」
  - `up-to-date` 态：标题「已是最新版本」+ 当前版本 + 「确定」按钮
  - `error` 态：标题「检查失败」+ 错误说明 + 「重试」按钮（重新调用 API）/「关闭」
- 按 Esc 关闭（监听 keydown）

### 5. `src/renderer/src/App.tsx` — 接入菜单事件 + 命令面板

**什么**：
- 在 `handleCommand`（第 103-140 行）switch 中添加 `case 'check-for-updates'`
- 在命令面板 `commands` 数组（第 88-101 行）添加 `check-for-updates` 条目
- 新增 `showUpdateDialog` state 并渲染 `<UpdateDialog>`

**为什么**：串联菜单/命令面板触发 → 对话框展示的完整链路。

**怎么做**：
- 添加 state：`const [showUpdateDialog, setShowUpdateDialog] = useState(false)`
- 在 `handleCommand` 的 switch 中（`case 'settings'` 之后）添加：
```ts
case 'check-for-updates':
  setShowUpdateDialog(true)
  break
```
- 在 `commands` 数组中添加：
```ts
{ id: 'check-for-updates', label: 'Help: Check for Updates', shortcut: '' }
```
- 在 JSX 渲染区（与其他对话框并列）添加：
```tsx
{showUpdateDialog && (
  <UpdateDialog onClose={() => setShowUpdateDialog(false)} />
)}
```
- 顶部导入：`import { UpdateDialog } from './components/UpdateDialog'`

## 假设与决策

- **GitHub API 限流**：未认证 60 次/小时，手动检查足够；不做本地缓存或节流
- **版本号格式**：假设 GitHub Release tag 形如 `v1.0.0` 或 `1.0.0`，主进程 handler 已 strip `v` 前缀并按 `.` 分段数值比较
- **无离线降级**：网络失败时对话框显示「检查失败」+ 重试按钮，不静默吞错
- **不修改 SettingsPanel**：用户明确选择独立模态对话框，About 区段保持现状
- **不接入 electron-updater**：仅版本检查，下载由用户在浏览器中自行完成
- **新增组件文件合理**：UpdateDialog 有独立状态机与样式，内联到 App.tsx 会过大，符合现有 `components/` 目录组织惯例

## 发布新版本流程（参考）

检查更新功能调用 GitHub API `/releases/latest`，**该端点只返回非预发布的最新 Release**。项目已有 CI（`.github/workflows/release.yml`），发布流程已打通：

### 3 步发布

1. **改版本号**：`package.json` 的 `"version"` 字段（如 `1.0.0` → `1.0.1`）
2. **提交并打 tag**：
   ```bash
   git add package.json
   git commit -m "release: v1.0.1"
   git tag v1.0.1
   git push origin main --tags
   ```
3. **等待 CI**：GitHub Action 三平台并行构建，`softprops/action-gh-release` 自动创建正式 Release（`generate_release_notes: true` 自动生成发布说明）

### 关键约束

- **tag 格式必须 `v*.*.*`**：CI 触发条件 `tags: ['v*.*.*']`，也是 handler strip `v` 前缀的依据
- **`package.json` version 与 tag 一致**：`app.getVersion()` 读 `package.json`，与 `tag_name`（去 `v`）做数值比较
- **Release 不能是 prerelease**：`/releases/latest` 跳过 prerelease；CI 里 tag 推送走正式 Release（不带 `prerelease: true`），符合要求；main 分支的滚动预发布（`latest` tag）**不会**被检测到
- **发布说明可手动编辑**：CI 自动生成的 `body` 作为 `releaseNotes` 显示在更新对话框，可在 GitHub Release 页面润色

## 验证步骤

1. 运行 `npm run typecheck`，确认 0 错误（重点验证 `APP_VERSION` 死代码已清理、preload 类型导入完整）
2. `npm run dev` 启动应用
3. 验证 Help 菜单出现「Check for Updates...」项，点击后弹出对话框并自动检查
4. 验证 Cmd+P 命令面板出现「Help: Check for Updates」，触发同一对话框
5. 验证对话框三种状态：有更新（显示版本对比 + 下载链接）、已是最新、检查失败（重试可用）
6. 验证 Esc 键与点击遮罩可关闭对话框
