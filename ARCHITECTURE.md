# Flux 架构设计

> 一款插件化、支持桌面置顶与 AI 生成的 Electron 笔记本应用。

## 一、技术选型（优先开源/脚手架）

| 能力 | 选型 | 说明 |
|------|------|------|
| 应用脚手架 | `electron-vite` + React + TypeScript | 官方推荐模板，自带 main/preload/renderer 三端热更新 |
| UI 框架 | React 18 + TypeScript | 渲染进程 |
| 状态管理 | Zustand | 轻量，适合多窗口共享 |
| Markdown 编辑器 | Milkdown 7 (WYSIWYG) | 基于 ProseMirror + remark，GFM 无损往返 |
| 纯文本编辑 | `<textarea>` | 非 markdown 格式的兜底编辑器 |
| 思维导图 | markmap | 开源，Markdown 驱动 |
| Drawio | drawio iframe embed | 开源，免打包 |
| AI | OpenAI 兼容 API（可配置 baseURL/key） | 兼容主流模型 |
| 打包 | electron-builder | 跨平台安装包 |
| 进程通信 | contextBridge + ipcRenderer | 安全隔离 |

## 二、整体架构

```
┌─────────────────────────────────────────────────────────┐
│                    Electron Main                         │
│  ┌───────────┐  ┌───────────┐  ┌──────────────────────┐ │
│  │ 窗口管理器 │  │ 插件管理器 │  │   AI Provider        │ │
│  │ (置顶/透明 │  │ (加载/卸载 │  │   (OpenAI 兼容)      │ │
│  │  /贴边)    │  │  /生命周期)│  │                      │ │
│  └─────┬─────┘  └─────┬─────┘  └──────────┬───────────┘ │
│        │              │                    │             │
│        └──────────────┴────────────────────┘             │
│                       IPC Handlers                       │
└───────────────────────┬─────────────────────────────────┘
                        │ contextBridge (安全 API)
┌───────────────────────┴─────────────────────────────────┐
│                   Renderer (React)                       │
│  ┌───────────┐  ┌───────────┐  ┌──────────────────────┐ │
│  │ 笔记列表   │  │ 编辑器宿主 │  │   AI 面板            │ │
│  │           │  │ (插件组件  │  │   (对话/多模态)      │ │
│  │           │  │  动态挂载) │  │                      │ │
│  └───────────┘  └─────┬─────┘  └──────────────────────┘ │
│                       │                                  │
│              ┌────────▼─────────┐                        │
│              │ Plugin Registry  │ ← 渲染端组件注册表      │
│              └──────────────────┘                        │
└──────────────────────────────────────────────────────────┘
```

## 三、目录结构

```
Flux/
├── package.json
├── electron.vite.config.ts
├── tsconfig.json / tsconfig.node.json / tsconfig.web.json
├── electron-builder.yml
├── ARCHITECTURE.md
│
├── packages/
│   ├── main/                         # Electron 主进程
│   │   └── src/
│   │       ├── index.ts              # 应用入口
│   │       ├── window/
│   │       │   ├── manager.ts        # 窗口管理（创建/复用）
│   │       │   ├── pin.ts            # 置顶、透明度、贴边收起
│   │       │   └── autostart.ts      # 开机自启
│   │       ├── plugin/
│   │       │   ├── manager.ts        # 插件生命周期编排
│   │       │   ├── loader.ts         # 模块加载/校验
│   │       │   └── store.ts          # 安装状态持久化
│   │       ├── ai/
│   │       │   ├── provider.ts       # 提供方抽象
│   │       │   └── client.ts         # API 调用 + 流式
│   │       ├── marketplace/
│   │       │   └── registry.ts       # 插件市场客户端
│   │       ├── ipc/
│   │       │   └── handlers.ts       # IPC 通道注册
│   │       └── store/
│   │           └── notes.ts          # 笔记存储（本地 JSON/SQLite）
│   │
│   ├── preload/                      # 安全桥接层
│   │   └── src/
│   │       ├── index.ts
│   │       └── api.ts                # window.flux API 定义
│   │
│   ├── renderer/                     # React UI
│   │   └── src/
│   │       ├── App.tsx / main.tsx
│   │       ├── components/
│   │       │   ├── NoteList/
│   │       │   ├── EditorHost/       # 动态挂载插件编辑器
│   │       │   ├── AIPanel/
│   │       │   ├── Marketplace/
│   │       │   └── WindowControls/   # 置顶/透明度按钮
│   │       ├── store/                # Zustand stores
│   │       ├── hooks/
│   │       └── plugin-host/
│   │           └── registry.tsx      # 渲染端组件注册表
│   │
│   ├── plugin-sdk/                   # 插件 SDK（独立包 @flux/plugin-sdk）
│   │   └── src/
│   │       ├── types.ts              # 核心接口定义
│   │       ├── context.ts            # PluginContext API
│   │       ├── lifecycle.ts          # 生命周期类型与常量
│   │       ├── ai-adapter.ts         # AI 适配器接口
│   │       └── index.ts              # 统一导出
│   │
│   └── shared/                       # 跨进程共享类型/常量
│       └── src/
│           ├── types.ts
│           └── constants.ts
│
├── plugins/                          # 内置插件源码
│   └── markdown/
│       ├── package.json              # 含 flux 字段的 manifest
│       └── src/
│           ├── index.ts              # 导出 FluxPlugin
│           ├── Editor.tsx
│           ├── Viewer.tsx
│           ├── serialize.ts
│           └── ai-adapter.ts
│
├── dev-plugins/                      # 运行时：已安装的第三方插件
└── resources/                        # 应用图标等静态资源
```

## 四、插件系统设计（核心）

### 4.1 插件 Manifest（package.json 扩展字段）

```json
{
  "name": "@flux/plugin-markdown",
  "version": "1.0.0",
  "main": "dist/index.js",
  "flux": {
    "format": "markdown",
    "displayName": "Markdown",
    "icon": "icon.png",
    "permissions": ["fs:notes", "ai:generate"],
    "minAppVersion": "1.0.0"
  }
}
```

### 4.2 插件接口（SDK 核心）

```typescript
// packages/plugin-sdk/src/types.ts
export interface FluxPlugin {
  manifest: PluginManifest;
  editor: React.ComponentType<EditorProps>;      // 编辑器组件
  viewer?: React.ComponentType<ViewerProps>;     // 只读视图
  serialize: (doc: PluginDocument) => string;    // 内存 -> 存储格式
  deserialize: (raw: string) => PluginDocument;  // 存储 -> 内存
  aiAdapter?: AIAdapter;                         // AI 输出适配
  lifecycle?: PluginLifecycle;                   // 生命周期钩子
}
```

### 4.3 生命周期

```
install  →  load  →  activate  ⇄  deactivate  →  uninstall
 (下载)    (require)  (注册格式)   (卸载格式)     (删文件)
```

每个阶段调用对应钩子：`onInstall / onLoad / onActivate / onDeactivate / onUninstall`。

### 4.4 PluginContext（注入给插件的能力）

```typescript
interface PluginContext {
  pluginId: string;
  fs: PluginFS;          // 作用域受限的文件读写
  ai: PluginAI;          // 调用 AI（受 permissions 控制）
  window: PluginWindow;  // 窗口控制（置顶/透明度）
  storage: PluginStorage;// 插件私有 KV 存储
  notify: (msg: string) => void;
}
```

### 4.5 AI 适配器（格式自动匹配）

插件通过 `aiAdapter` 声明：
- `systemPrompt`：告诉 AI 如何输出本格式（如思维导图输出缩进层级，Drawio 输出 mxGraph XML）
- `parse(aiOutput) -> PluginDocument`：把 AI 文本转成插件文档
- `validate(doc) -> boolean`：校验输出合法性

这样 AI 模块与格式解耦：AI 只管生成文本，具体结构化由各插件适配器负责。

## 五、窗口置顶系统设计

- 每个 `BrowserWindow` 持有 `pinState`：`{ pinned, opacity, autoHide }`
- `win.setAlwaysOnTop(true, 'screen-saver')` 保证高于普通窗口
- 透明度：`win.setOpacity(0~1)`
- 贴边收起：监听 `move` 事件，靠近屏幕边缘时缩为细条，鼠标悬停展开
- 开机自启：`app.setLoginItemSettings({ openAtLogin: true })`
- 多窗口：`WindowManager` 维护窗口 Map，各自独立 pin 状态

## 六、AI 生成模块设计

- 自然语言生成笔记：用户描述 → AI 生成 → 当前插件 aiAdapter 解析
- 多模态：文件/图片/语音 → 主进程预处理（语音转文字 STT）→ 拼入 prompt
- 多轮对话：维护 conversation history，支持"把第二段改成列表"等增量修改
- 流式输出：SSE 流式渲染到编辑器，提升体验

## 七、插件商城设计

- 通用机制：每个插件 = 一个符合 manifest 的 npm 包或 zip
- 安装：从 registry 下载 → 校验签名/manifest → 解压到 `dev-plugins/` → load
- 卸载：deactivate → 删除目录
- 第三方上传：提供 manifest 规范 + 打包脚本 `flux package`，上传到 registry（初期可用 GitHub Release 作为分发源）
- 本地安装：支持从本地路径/zip 安装，便于开发调试

## 八、推进步骤（每步确认后再继续）

1. ✅ 架构与目录结构（本文档）
2. ✅ 插件系统骨架 + SDK（@flux/plugin-sdk，含 definePlugin 封装语法 / 生命周期 / 权限 / AI 适配器）
3. ✅ Markdown 内置插件（CodeMirror 6 编辑 + react-markdown 实时预览 + GFM + AI 适配器）
4. ✅ 窗口置顶功能（always-on-top + macOS 跨 Space + 透明度 + 贴边收起 + 开机自启 + 多窗口 + 右下角悬浮控件）
5. ✅ AI 生成模块（OpenAI 兼容 API + 多轮对话 + 图片多模态 + 插件 AI 适配器格式适配 + 配置持久化）
6. ✅ 插件商城（内置目录 + 远程索引缓存 + zip 下载安装 + 本地安装 + 卸载 + 开发者发布指南）
