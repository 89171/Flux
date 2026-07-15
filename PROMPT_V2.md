# Flux 开发 Prompt（完整版）

帮我开发一款名为 Flux 的 Electron 桌面笔记本应用。以下需求已经过充分细化，请严格按照每一条规范实现，不要遗漏任何细节。每个功能模块完成后必须能正常编译运行，不能出现「代码写了但功能不工作」的情况。

---

## 一、技术栈（必须使用）

- 构建工具：`electron-vite`（不要用纯 electron-forge）
- 前端框架：React 18 + TypeScript
- 状态管理：Zustand
- 图标库：`lucide-react`（尽量用图标，少用文字）
- Markdown 编辑器：Milkdown（WYSIWYG 所见即所得，不要用纯 textarea + 预览切换）
- Markdown 渲染/序列化：`marked`（用于只读预览场景）
- 打包：electron-builder

---

## 二、核心需求

### 2.1 插件化格式系统

应用引擎与内容格式完全解耦。通过安装不同插件支持 Markdown、Drawio、思维导图等多种格式。

**内置插件（必须创建实际文件）：**

在 `src/builtin-plugins/` 下创建以下 4 个内置插件目录，每个包含 `manifest.json` 和 `main.js`：

```
src/builtin-plugins/
  ├── markdown/      (manifest.json + main.js, extensions: ["md", "markdown"], icon: "FileText")
  ├── plaintext/     (manifest.json + main.js, extensions: ["txt"], icon: "FileText")
  ├── drawio/        (manifest.json + main.js, extensions: ["drawio"], icon: "GitBranch")
  └── mindmap/       (manifest.json + main.js, extensions: ["mm"], icon: "Network")
```

**manifest.json 格式：**

```json
{
  "id": "markdown",
  "name": "Markdown",
  "version": "1.0.0",
  "author": "Flux",
  "description": "Built-in Markdown editor with WYSIWYG support via Milkdown.",
  "type": "format",
  "extensions": ["md", "markdown"],
  "main": "main.js",
  "icon": "FileText",
  "builtin": true,
  "minAppVersion": "1.0.0"
}
```

**插件图标规范（重要）：**

manifest 中的 `icon` 字段支持两种格式：
1. **lucide 图标名称**（字符串，如 `"FileText"`、`"Network"`、`"GitBranch"`）：用于内置插件，渲染时通过映射表转为对应的 lucide-react 组件
2. **相对文件路径**（如 `"icon.png"`、`"assets/icon.svg"`）：用于第三方插件，主进程加载时解析为 `file://` 绝对 URL

PluginManager 加载插件时的图标解析逻辑：
```typescript
let resolvedIcon = manifest.icon
if (resolvedIcon && (resolvedIcon.includes('/') || resolvedIcon.endsWith('.png') || resolvedIcon.endsWith('.svg') || resolvedIcon.endsWith('.jpg'))) {
  resolvedIcon = `file://${join(pluginDir, resolvedIcon)}`
}
```

渲染层需要同时支持两种图标格式：
```typescript
function renderPluginIcon(icon: string | undefined, size: number = 22): ReactNode {
  if (!icon) return <Package size={size} />
  if (icon.startsWith('file://') || icon.startsWith('http')) {
    return <img src={icon} alt="" style={{ width: size, height: size, borderRadius: '4px' }} />
  }
  // lucide 图标名称映射
  const iconMap: Record<string, ReactNode> = {
    FileText: <FileText size={size} />,
    Network: <Network size={size} />,
    GitBranch: <GitBranch size={size} />,
    FileCode: <FileCode size={size} />,
    Package: <Package size={size} />
  }
  return iconMap[icon] || <Package size={size} />
}
```

**插件生命周期：**

```
installed → activating → active → deactivating → inactive
                                   ↓
                                  error
```

插件 SDK（`src/plugin-sdk/types.ts`）定义以下接口：
- `PluginModule`: onActivate, onDeactivate, format (可选)
- `PluginContext`: manifest, pluginPath, api, logger
- `PluginAPI`: readFile, writeFile, notify, registerCommand, getWorkspacePath, emit, on
- `FormatRenderer`: render(content) → 渲染 HTML
- `AIFormatAdapter`: 用于 AI 生成时匹配格式

**插件激活流程（main/index.ts）：**

```typescript
// 启动时自动发现并激活所有内置插件
pluginManager.discoverPlugins()
await pluginManager.activateBuiltinPlugins()
```

### 2.2 桌面置顶系统

任何笔记窗口可一键 Pin 到桌面最顶层（always-on-top）。

**主窗口配置（重要，不要搞混）：**

```typescript
// 主窗口：使用 macOS 原生红黄绿按钮
const mainWindow = new BrowserWindow({
  width: 1200, height: 800,
  minWidth: 800, minHeight: 600,
  show: false,
  titleBarStyle: 'hidden',        // 显示系统交通灯按钮
  trafficLightPosition: { x: 16, y: 16 },
  backgroundColor: '#ffffff',
  webPreferences: { preload: join(__dirname, '../preload/index.js'), sandbox: false }
})
// 注意：主窗口不要设 frame: false，否则会隐藏系统红黄绿按钮
```

```typescript
// 笔记置顶窗口：无边框透明
const noteWindow = new BrowserWindow({
  width: 400, height: 500,
  frame: false,              // 置顶笔记窗口用自定义标题栏
  transparent: isPinned,
  alwaysOnTop: isPinned,
  opacity: opacity,
  webPreferences: { ... }
})
```

**自定义 TitleBar（主窗口）：**

```typescript
// 主窗口 TitleBar：不包含自定义按钮，不包含图钉图标
// "Flux" 文字居中，左右各留 78px 给系统交通灯按钮
export function TitleBar() {
  return (
    <div style={{ display: 'flex', alignItems: 'center', height: '40px',
      WebkitAppRegion: 'drag', borderBottom: '1px solid var(--border-light)' }}>
      <div style={{ width: '78px' }} />           {/* 左侧交通灯空间 */}
      <div style={{ flex: 1, textAlign: 'center' }}>
        <span style={{ fontSize: '13px', fontWeight: 600 }}>Flux</span>
      </div>
      <div style={{ width: '78px' }} />           {/* 右侧对称空间 */}
    </div>
  )
}
```

**置顶窗口行为：**
- `win.setAlwaysOnTop(true, 'screen-saver')` 在失焦时保持置顶
- `win.setAlwaysOnTop(true, 'floating')` 在聚焦时浮于上层
- 支持自定义透明度（0.3 - 1.0）
- 支持贴边自动收起（blur 后延迟 500ms 检测窗口位置）
- 支持开机自启（使用 `auto-launch` 库）

### 2.3 AI 笔记生成

- 自然语言描述生成内容
- 对话式多轮修改（conversationId 跟踪）
- AI 生成内容自动匹配当前笔记格式
- AI Settings 支持配置 provider / apiKey / model / baseUrl

### 2.4 文件浏览器（Sidebar，参考 VSCode）

**布局：**

```
┌─────────────────────────────┐
│ Explorer    [📄][📁][🔄]    │  ← 标题 + 3个无边框图标按钮
├─────────────────────────────┤
│ ▾ 📁 notes                  │
│   📄 note1.md               │
│   📄 diagram.drawio         │  ← 文件图标根据扩展名匹配插件图标
│ ▸ 📁 templates              │
└─────────────────────────────┘
```

**侧边栏操作按钮规范（重要）：**

3 个操作按钮（新建文件、新建文件夹、刷新）的样式：
- **无边框**（`border: none; outline: none; -webkit-appearance: none`）
- **图标尺寸 16px**，`strokeWidth={1.8}`
- **按钮尺寸 26x26px**，图标完美居中（`display: flex; align-items: center; justify-content: center; padding: 0`）
- hover 时显示背景色，无边框

```css
.sidebar-action-btn {
  width: 26px; height: 26px;
  border: none; outline: none;
  background: transparent;
  display: flex; align-items: center; justify-content: center;
  padding: 0; margin: 0;
  color: var(--text-tertiary);
  cursor: pointer;
  border-radius: var(--radius-sm);
  -webkit-appearance: none; appearance: none;
}
.sidebar-action-btn:hover { background: var(--bg-hover); color: var(--text-primary); }
.sidebar-action-btn svg { display: block; flex-shrink: 0; }
```

**新建文件下拉菜单（重要，不要遗漏任何细节）：**

点击"新建文件"按钮后，弹出下拉菜单（不是直接创建），列出所有可用文件类型：
- 内置格式：Markdown (.md)、Plain Text (.txt)、DrawIO (.drawio)、Mindmap (.mm)
- 已激活插件的自定义格式

下拉菜单规范：
- `z-index: 10000`（确保不被其他内容遮盖）
- `position: absolute`，在按钮下方显示
- 每个选项显示：插件图标 + 格式名称 + 扩展名（如 `.md`）
- 点击选项后，在文件树顶部显示创建输入框

```css
.new-file-dropdown {
  position: absolute; top: 100%; left: 0; margin-top: 4px;
  min-width: 180px;
  background: var(--bg-primary);
  border: 1px solid var(--border-light);
  border-radius: var(--radius-md);
  box-shadow: 0 4px 16px rgba(0,0,0,0.15);
  z-index: 10000;    /* 重要：必须足够高 */
  padding: 4px;
}
```

**创建文件的完整流程（重要，这是最容易出bug的地方）：**

1. 用户点击"新建文件"按钮 → 弹出下拉菜单
2. 用户选择文件类型（如 Markdown）
3. **立即**在文件树顶部显示创建输入框（InlineEditInput）
   - 预填文件名 `Untitled.{扩展名}`（如 `Untitled.md`）
   - 输入框自动聚焦并全选文字（`input.focus(); input.select()`）
   - 用户可以直接输入替换文件名，或按 Enter 确认
4. 确认后调用 `createFile(parentPath, name, isDir)`
5. 创建成功后刷新文件树（`loadTree()`）

**创建输入框必须在所有状态下可见（重要）：**

创建输入框的渲染逻辑必须在空状态和非空状态之外（公共区域），不能只在某个分支内渲染：

```typescript
// ✅ 正确：创建输入框在 isEmpty 判断之前渲染
{creating && creating.parentPath === '' && (
  <div className="tree-node" style={{ paddingLeft: 8, background: 'var(--bg-hover)' }}>
    <span className="tree-chevron" />
    <span className="tree-icon">{/* 图标 */}</span>
    <InlineEditInput
      initialValue={creating.initialName || ''}
      allowUnchanged={!!creating.initialName}    // 允许不修改直接提交
      placeholder="note name.md"
      onSubmit={handleCreateSubmit}
      onCancel={handleCreateCancel}
    />
  </div>
)}

{isEmpty ? (
  // 空状态：显示 empty-state + New Note 按钮
  <div className="empty-state">
    <button onClick={() => handleNewFileWithType(BUILTIN_FILE_TYPES[0])}>
      New Note
    </button>
  </div>
) : (
  // 非空状态：渲染文件树
  tree.children.map(...)
)}
```

**InlineEditInput 的 allowUnchanged 参数：**

```typescript
function InlineEditInput({ initialValue, allowUnchanged, onSubmit, onCancel }) {
  // allowUnchanged = true 时，即使值未修改也允许提交
  // 用于预填了 Untitled.md 等初始文件名的场景
  const finish = () => {
    const trimmed = value.trim()
    if (trimmed && (allowUnchanged || trimmed !== initialValue)) {
      onSubmit(trimmed)
    } else {
      onCancel()
    }
  }
}
```

**空状态的 New Note 按钮（重要）：**

空状态下的 "New Note" 按钮必须**直接开始创建**（调用 `handleNewFileWithType`），不能只是切换下拉菜单：

```typescript
// ✅ 正确：直接创建
<button onClick={() => handleNewFileWithType(BUILTIN_FILE_TYPES[0])}>
  New Note
</button>

// ❌ 错误：只切换下拉菜单，空状态下输入框不显示
<button onClick={handleNewFile}>New Note</button>
```

**右键菜单（重要）：**

右键菜单必须同时支持文件和目录节点：

```typescript
// 右键文件 → 在文件所在父目录中新建
// 右键目录 → 在该目录中新建
// 右键空白区域 → 在根目录新建

const handleContextNewFile = (node: NoteFile) => {
  const parentPath = node.type === 'file'
    ? node.path.substring(0, node.path.lastIndexOf('/'))
    : node.path
  startCreatingInDir(parentPath, false)
}
```

右键菜单项（文件和目录都显示前两项）：
- New File
- New Folder
- ---分隔线---
- Rename
- Open Externally
- ---分隔线---
- Delete

**文件树图标：**

根据文件扩展名匹配插件图标。构建 `extensionIconMap`（扩展名 → 图标），在 TreeNode 中渲染：

```typescript
const extensionIconMap = useMemo(() => {
  const map = new Map<string, string>()
  for (const plugin of plugins) {
    if (plugin.type !== 'format' || !plugin.icon || !plugin.extensions) continue
    for (const ext of plugin.extensions) {
      map.set(ext.toLowerCase().replace(/^\./, ''), plugin.icon)
    }
  }
  return map
}, [plugins])
```

### 2.5 编辑器

- Markdown 文件：使用 Milkdown WYSIWYG 编辑器（所见即所得，不要用 textarea + 预览切换）
- 其他格式：使用 textarea
- 快捷键 Cmd/Ctrl+S 保存
- 拖拽文件到编辑器可在新窗口打开
- 编辑器工具栏：编辑/预览切换、保存、Pin到桌面、在新窗口打开、AI 生成

**Milkdown 编辑器组件：**

```typescript
// MilkdownEditor.tsx
import { Editor, rootCtx, defaultValueCtx } from '@milkdown/core'
import { nord } from '@milkdown/theme-nord'
import { gfm } from '@milkdown/preset-gfm'
import { listener, listenerCtx } from '@milkdown/plugin-listener'
import '@milkdown/theme-nord/style.css'
```

### 2.6 Plugin Market（独立页面）

**从 ActivityBar 切换到 Plugin Market 时，隐藏左侧 ActivityBar，使插件市场成为全屏独立页面。**

```typescript
// App.tsx
{view === 'plugins' ? (
  <PluginMarket onBack={() => setView('editor')} />
) : (
  <div style={{ display: 'flex' }}>
    <div className="activity-bar">{/* ... */}</div>
    <Sidebar /><Editor />
  </div>
)}
```

**Plugin Market 必须展示所有已安装插件，包括内置插件。**

内置插件在 Plugin Market 中的显示规则：
- 显示插件图标、名称、版本、状态
- Enable/Disable 按钮**禁用**（`disabled={plugin.isBuiltin}`），内置插件不可关闭
- 不显示 Uninstall 按钮（`{!plugin.isBuiltin && <UninstallButton />}`）
- 状态标签显示 "Active"（因为内置插件启动时自动激活）

**Plugin Market 功能：**
- Install Plugin：通过文件对话框安装 .zip 插件包
- Load Local：通过目录路径加载本地插件
- Plugin Development Guide：打开插件开发指南窗口
- 输入框粘贴插件目录路径直接加载

---

## 三、UI/UX 设计规范

### 配色（参考 Notion、Typora，黑白配色）

```css
:root {
  --bg-primary: #ffffff;
  --bg-secondary: #fafafa;
  --bg-tertiary: #f5f5f5;
  --bg-hover: #f0f0f0;
  --bg-active: #e8e8e8;
  --bg-selected: #e8f0fe;

  --text-primary: #1a1a1a;
  --text-secondary: #4a4a4a;
  --text-tertiary: #888888;
  --text-disabled: #c0c0c0;

  --border-light: #ececec;
  --border-secondary: #e0e0e0;

  --accent: #2d7ff9;
  --accent-primary: #2d7ff9;

  --font-sans: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;
  --font-mono: 'SF Mono', 'Fira Code', monospace;
  --font-size-base: 13px;

  --radius-sm: 4px;
  --radius-md: 8px;
  --transition-fast: 0.1s ease;
}
```

### 整体布局

```
┌──────────────────────────────────────────┐
│              Flux (居中)               │  ← TitleBar (40px, 系统红黄绿)
├────┬─────────┬──────────────────┬────────┤
│ A  │ Sidebar │     Editor       │   AI   │
│ B  │ 240px   │                  │ Panel  │
│ 48 │         │                  │ 300px  │
│ px │         │                  │        │
└────┴─────────┴──────────────────┴────────┘

ActivityBar (48px): 图标导航栏
  - Editor (FileText)
  - AI Assistant (Sparkles)
  - Plugin Market (Puzzle)
```

### 图标使用原则

- 尽量使用图标而非文字
- 所有操作按钮使用 `lucide-react` 图标
- 文件类型图标根据扩展名匹配插件定义的图标
- 侧边栏操作按钮：无边框、16px 图标、26x26px 按钮、完美居中

---

## 四、目录结构

```
src/
├── main/                          # Electron 主进程
│   ├── index.ts                   # 入口，bootstrap 启动流程
│   ├── WindowManager.ts           # 窗口管理（主窗口 + 笔记置顶窗口）
│   ├── FileSystemManager.ts       # 文件系统操作
│   ├── PluginManager.ts           # 插件管理（发现、加载、激活、停用）
│   ├── PluginInstaller.ts         # 插件安装（ZIP 解压、目录复制）
│   ├── AIService.ts               # AI 服务
│   ├── SettingsStore.ts           # 设置存储
│   └── ipc/
│       └── index.ts               # IPC 通道注册
├── preload/
│   ├── index.ts                   # contextBridge API 暴露
│   └── index.d.ts                 # API 类型声明
├── renderer/
│   ├── index.html                 # 主窗口 HTML
│   ├── note.html                  # 笔记置顶窗口 HTML
│   ├── plugin-dev-guide.html      # 插件开发指南 HTML
│   └── src/
│       ├── main.tsx               # 主窗口入口
│       ├── note.tsx               # 笔记窗口入口
│       ├── devGuide.tsx           # 开发指南入口
│       ├── App.tsx                # 主应用组件
│       ├── components/
│       │   ├── TitleBar.tsx       # 标题栏
│       │   ├── Sidebar.tsx        # 文件浏览器
│       │   ├── Editor.tsx         # 编辑器
│       │   ├── AIPanel.tsx        # AI 面板
│       │   ├── PluginMarket.tsx   # 插件市场
│       │   └── MilkdownEditor.tsx # Milkdown WYSIWYG 编辑器
│       ├── stores/
│       │   ├── fileStore.ts       # 文件状态
│       │   ├── pluginStore.ts     # 插件状态
│       │   └── aiStore.ts         # AI 状态
│       └── styles/
│           ├── global.css         # 全局样式 + CSS 变量
│           └── components.css     # 组件样式
├── shared/
│   ├── types.ts                   # 共享类型
│   ├── constants.ts               # 常量
│   └── ipc-channels.ts            # IPC 通道定义
├── plugin-sdk/
│   ├── types.ts                   # 插件 SDK 类型定义
│   └── lifecycle.ts               # 插件生命周期状态机
└── builtin-plugins/               # 内置插件（必须有实际文件）
    ├── markdown/
    │   ├── manifest.json
    │   └── main.js
    ├── plaintext/
    │   ├── manifest.json
    │   └── main.js
    ├── drawio/
    │   ├── manifest.json
    │   └── main.js
    └── mindmap/
        ├── manifest.json
        └── main.js
```

---

## 五、实现步骤（按顺序执行，每步完成后验证编译）

### Step 1: 项目初始化
- 使用 `electron-vite` 创建项目
- 安装依赖：react, react-dom, zustand, lucide-react, marked, @milkdown/*, auto-launch
- 配置 tsconfig（node + web 分离）

### Step 2: 核心架构
- 实现 shared/types.ts（所有共享类型）
- 实现 shared/ipc-channels.ts（IPC 通道常量）
- 实现 shared/constants.ts（路径常量，如 BUILTIN_PLUGINS_DIR）
- 实现 main/FileSystemManager.ts
- 实现 preload/index.ts（contextBridge API）

### Step 3: 插件系统
- 实现 plugin-sdk/types.ts 和 lifecycle.ts
- 实现 main/PluginManager.ts（发现、加载、激活、停用）
- 实现 main/PluginInstaller.ts（ZIP 安装、目录加载）
- **创建 4 个内置插件**（markdown、plaintext、drawio、mindmap），每个包含 manifest.json 和 main.js
- 在 main/index.ts 中调用 `discoverPlugins()` + `activateBuiltinPlugins()`

### Step 4: 窗口管理
- 实现 main/WindowManager.ts
  - 主窗口：`titleBarStyle: 'hidden'`（系统红黄绿），**不要 frame: false**
  - 笔记窗口：`frame: false`（自定义标题栏）
- 实现 TitleBar.tsx（Flux 居中，无自定义按钮，无图钉）

### Step 5: 文件浏览器
- 实现 Sidebar.tsx（参考 VSCode）
- 新建文件下拉菜单（z-index: 10000）
- 创建输入框在所有状态下可见
- 右键菜单（文件 + 目录 + 空白区域）
- 文件树图标匹配插件图标
- 空状态 New Note 按钮直接创建

### Step 6: 编辑器
- 实现 MilkdownEditor.tsx（WYSIWYG）
- 实现 Editor.tsx（格式感知、保存、拖拽、AI）
- 创建 note.tsx（笔记窗口入口）
- 创建 devGuide.tsx（开发指南入口）

### Step 7: 插件市场
- 实现 PluginMarket.tsx（独立全屏页面）
- 展示所有插件（包括内置插件）
- 插件图标渲染（lucide 名称 + file:// URL）
- 安装、加载本地、卸载、开发指南

### Step 8: AI 集成
- 实现 AIService.ts
- 实现 AIPanel.tsx
- 实现 aiStore.ts

### Step 9: 最终验证
- `npx electron-vite build` 必须成功
- `npx tsc --noEmit` 无新增错误
- 手动验证每个功能点

---

## 六、常见陷阱清单（必须避免）

1. **主窗口 frame: false**：会隐藏系统红黄绿按钮。主窗口用 `titleBarStyle: 'hidden'`，笔记窗口才用 `frame: false`

2. **内置插件目录不存在**：必须在 `src/builtin-plugins/` 下创建实际的 manifest.json 和 main.js 文件，否则 PluginManager 找不到插件

3. **插件图标处理错误**：manifest 中 `icon: "FileText"` 是 lucide 图标名，不是文件路径。只有包含 `/` 或文件扩展名的才解析为 `file://` URL

4. **创建输入框在空状态下不渲染**：创建输入框必须在 `isEmpty` 判断之前渲染，不能只在非空分支内

5. **空状态 New Note 按钮只切换下拉菜单**：空状态下下拉菜单可能被遮盖，按钮应直接调用 `handleNewFileWithType` 开始创建

6. **下拉菜单 z-index 太低**：必须设为 `10000`，否则被文件树内容遮盖

7. **右键菜单只支持目录**：文件节点也必须支持右键新建（在文件父目录中创建）

8. **PluginMarket 不显示内置插件**：内置插件状态为 active，Enable/Disable 按钮禁用，不显示 Uninstall

9. **Plugin Market 不是独立页面**：切换到 Plugin Market 时必须隐藏 ActivityBar，全屏显示

10. **侧边栏按钮有边框/图标不居中**：必须 `border: none; -webkit-appearance: none; display: flex; align-items: center; justify-content: center`

11. **import 方式错误**：Editor 和 PluginMarket 如果是 `export default`，导入时不能用 `import { Editor }`，必须用 `import Editor`

12. **preload API 字段名不匹配**：IPC handler 和 preload API 的字段名必须一致（如 `isPinned` 不是 `pinned`）

13. **note.tsx / devGuide.tsx 文件缺失**：HTML 入口引用的 tsx 文件必须存在，否则构建失败

14. **InlineEditInput 不允许预填值提交**：预填了 `Untitled.md` 后，用户不修改直接按 Enter 应该能创建文件，需要 `allowUnchanged` 参数

15. **文件树图标不匹配插件**：需要构建 `extensionIconMap`，根据文件扩展名渲染对应插件图标（支持 lucide 名称和 file:// URL 两种格式）

---

## 七、验收标准

- [ ] `npm run dev` 启动后，主窗口显示系统红黄绿按钮，Flux 居中
- [ ] 侧边栏 3 个操作按钮无边框、图标居中、16px 尺寸
- [ ] 点击"新建文件"弹出下拉菜单，列出 Markdown/Plain Text/DrawIO/Mindmap
- [ ] 选择文件类型后，创建输入框出现，预填 `Untitled.{扩展名}`，自动聚焦选中
- [ ] 按 Enter 创建文件，文件出现在文件树中
- [ ] 空状态下点击 "New Note" 按钮直接出现创建输入框
- [ ] 右键文件和目录都能弹出 New File / New Folder 菜单
- [ ] 文件树中文件图标根据扩展名匹配插件图标
- [ ] Plugin Market 全屏显示，包含 4 个内置插件
- [ ] 内置插件显示 Active 状态，Enable/Disable 按钮禁用
- [ ] Markdown 编辑器是 WYSIWYG（Milkdown），不是 textarea + 预览
- [ ] `npx electron-vite build` 编译成功
