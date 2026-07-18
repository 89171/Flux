# Flux 架构设计

> Flux 是一款 Electron 桌面笔记应用，核心目标是：本地文件优先、插件化格式扩展、AI 辅助创作、窗口置顶，以及可替换的远端存储传输层。

本文档描述当前代码库的真实结构与边界。用户侧功能说明见 `README.md`，这里更关注模块职责、数据流、接口约束和后续演进。

## 一、架构目标

- **本地文件优先**：工作区文件直接保存在用户选择的目录中，方便与外部编辑器、Git、备份工具协作。
- **安全 IPC 边界**：渲染进程不直接访问 Node/Electron 能力，只通过 `preload` 暴露的 `window.flux` API 调用主进程。
- **格式插件化**：文件扩展名到编辑器的绑定由插件系统提供，内置格式和第三方格式走同一套 manifest 与生命周期。
- **存储与同步解耦**：`StorageProvider` 只负责文件读写；`SyncManager` 才负责索引、版本、增量同步与冲突策略。
- **可恢复数据操作**：保存、删除、移动、重命名等关键操作会保留历史快照；删除默认进入应用回收站。
- **配置安全**：AI Key、远端存储 Token/密码等敏感字段在磁盘上通过 Electron `safeStorage` 加密，返回渲染层时使用占位符遮蔽。

## 二、技术选型

| 能力 | 当前选型 | 说明 |
|------|----------|------|
| 桌面框架 | Electron 31 + electron-vite | main/preload/renderer 三端构建 |
| 前端框架 | React 18 + TypeScript | 主窗口、独立笔记窗口、插件开发指南 |
| 状态管理 | Zustand | 文件树、当前文件、回收站、编辑状态 |
| 编辑器 | Milkdown、CodeMirror、tldraw、Excalidraw、Mermaid、PlantUML、BPMN/DMN 等 | 由内置插件或格式绑定选择 |
| 文件监听 | chokidar | 工作区结构变化推送给所有窗口 |
| AI | OpenAI 兼容 Chat Completions API | 支持自定义 provider/baseURL/model/key |
| 存储适配 | Local、GitHub、WebDAV、FTP/FTPS、S3 | 统一 `StorageProvider` 接口 |
| FTP 客户端 | `basic-ftp` | FTP/FTPS list/read/write/delete/move |
| S3 客户端 | `@aws-sdk/client-s3` | AWS S3 与兼容对象存储 |
| 打包 | electron-builder | macOS/Windows/Linux 安装包 |
| 安全桥接 | contextBridge + ipcRenderer | 渲染层不启用 Node 集成 |

## 三、整体分层

```text
┌─────────────────────────────────────────────────────────────┐
│ Renderer: React UI                                           │
│ App / Sidebar / Editor / SettingsPanel / PluginMarket / AI   │
│ Zustand stores                                               │
└───────────────────────┬─────────────────────────────────────┘
                        │ window.flux (contextBridge)
┌───────────────────────▼─────────────────────────────────────┐
│ Preload                                                      │
│ Typed IPC facade: file / plugin / ai / settings / storage    │
└───────────────────────┬─────────────────────────────────────┘
                        │ IPC channels
┌───────────────────────▼─────────────────────────────────────┐
│ Electron Main                                                │
│ FileSystemManager  PluginManager  WindowManager  AIService   │
│ SettingsStore      StorageManager PluginInstaller            │
│ registerIPC()                                               │
└─────────────┬───────────────┬───────────────┬───────────────┘
              │               │               │
              ▼               ▼               ▼
        Local workspace   Plugin dirs    Remote storage providers
        .flux/history     builtin/user    Local/GitHub/WebDAV/FTP/S3
        .flux/trash
```

核心约束：

- Renderer 只拿到 `window.flux`，不能直接读写文件系统。
- `FileSystemManager` 是本地工作区文件操作的唯一入口。
- `StorageManager` 是远端/备用存储读写入口，供同步层使用。
- `SyncManager` 不导入任何具体 provider，只依赖 `StorageProvider`。
- 插件代码不能直接访问工作区，只能通过受权限约束的 `PluginAPI`。

## 四、当前目录结构

```text
Flux/
├── src/
│   ├── main/
│   │   ├── index.ts                  # 应用启动与模块装配
│   │   ├── ipc/index.ts              # IPC handler 注册
│   │   ├── FileSystemManager.ts      # 本地工作区、历史、回收站、搜索
│   │   ├── SettingsStore.ts          # 设置持久化与敏感字段加密
│   │   ├── PluginManager.ts          # 插件发现、激活、格式绑定
│   │   ├── PluginInstaller.ts        # 用户插件安装/卸载
│   │   ├── PluginSandbox.ts          # 第三方插件 vm 沙箱
│   │   ├── WindowManager.ts          # 主窗口/笔记窗口/置顶/透明度
│   │   ├── AIService.ts              # AI 生成、流式输出、工具调用
│   │   └── storage/
│   │       ├── StorageProvider.ts    # 统一存储接口
│   │       ├── StorageManager.ts     # provider 选择、连接、兜底能力
│   │       ├── SyncManager.ts        # 同步层骨架
│   │       └── providers/
│   │           ├── LocalProvider.ts
│   │           ├── GitHubProvider.ts
│   │           ├── WebDAVProvider.ts
│   │           ├── FTPProvider.ts
│   │           └── S3Provider.ts
│   ├── preload/
│   │   ├── index.ts                  # window.flux API
│   │   └── index.d.ts                # 渲染层类型声明
│   ├── renderer/
│   │   ├── index.html / note.html
│   │   └── src/
│   │       ├── App.tsx / main.tsx / note.tsx
│   │       ├── components/           # 编辑器、侧边栏、设置、AI、插件市场
│   │       └── stores/               # Zustand stores
│   ├── shared/
│   │   ├── types.ts                  # 跨进程类型
│   │   ├── ipc-channels.ts           # IPC 通道常量
│   │   ├── constants.ts
│   │   └── shortcuts.ts
│   ├── plugin-sdk/                   # 第三方插件 SDK 类型与工具
│   └── builtin-plugins/              # 内置格式插件 manifest + main.js
├── resources/                        # 图标等静态资源
├── scripts/                          # 构建辅助脚本
├── README.md
└── ARCHITECTURE.md
```

## 五、启动与依赖装配

`src/main/index.ts` 是主进程装配点：

1. 读取 `SettingsStore.getSettings()`。
2. 创建 `PluginManager`，并注入 workspace 路径。
3. 创建 `FileSystemManager`，格式识别委托给 `PluginManager.detectFormat()`。
4. 将 `FileSystemManager` 反向注入 `PluginManager`，让插件文件 API 复用同一套路径安全检查。
5. 创建 `PluginInstaller`、`WindowManager`、`AIService`、`StorageManager`。
6. 调用 `registerIPC(...)` 注册所有 IPC handler。
7. 发现内置和用户插件，并按 `SettingsStore.pluginState` 激活启用的插件。
8. 创建主窗口。

这个顺序保证了：

- 文件格式识别不硬编码在文件系统模块里。
- AI 可通过插件 adapter 获取格式提示。
- 设置变更后，工作区路径和存储 provider 都可以重新配置。

## 六、本地文件系统

`FileSystemManager` 负责本地工作区中的用户文件：

| 能力 | 说明 |
|------|------|
| 文件树 | `buildFileTree()` 缓存工作区结构，过滤隐藏目录、`.flux` 与 `node_modules` |
| 文件读写 | `readFileWithMeta()` 返回内容与 mtime，`writeFileGuarded()` 用 mtime 检测外部修改冲突 |
| 文件创建 | 支持文件与目录创建，自动创建父目录 |
| 重命名/移动 | 操作前写历史快照，并迁移历史索引 |
| 删除 | 不直接硬删除，移动到 `.flux/trash` |
| 历史 | `.flux/history` 保存文件内容快照，默认保留 30 天 |
| 回收站 | `.flux/trash/items` 保存实体，`.flux/trash/metadata` 保存原路径、类型、删除时间等元数据 |
| 搜索 | 递归文本搜索，跳过隐藏目录、`node_modules` 与二进制文件 |
| 安全 | 防目录穿越，已存在路径会做 `realpath` 检查以阻止符号链接逃逸 |

删除流程：

```text
Renderer delete action
  ↓
window.flux.file.delete(path)
  ↓
IPC.FILE_DELETE
  ↓
FileSystemManager.delete(path)
  ↓
写入历史快照
  ↓
生成 trash id + metadata
  ↓
rename 原文件/目录 → .flux/trash/items/<id>-<name>
  ↓
广播文件树变化，刷新回收站列表
```

恢复流程：

```text
Trash entry
  ↓
FileSystemManager.restoreTrashEntry(id)
  ↓
读取 metadata
  ↓
如果原路径已被占用，生成 "restored" 后缀路径
  ↓
rename 回工作区
  ↓
删除 metadata 并广播文件树变化
```

## 七、Storage Provider 中间层

存储中间层位于 `src/main/storage`，目标是把“协议读写”和“同步策略”拆开。

```text
Flux App
  ↓
StorageManager / SyncManager
  ↓
StorageProvider Interface
  ↓
LocalProvider / GitHubProvider / WebDAVProvider / FTPProvider / S3Provider
```

核心接口：

```ts
export interface StorageProvider {
  name: string

  connect(config: unknown): Promise<void>

  list(path: string): Promise<StorageFile[]>

  read(path: string): Promise<Uint8Array>

  write(path: string, data: Uint8Array): Promise<void>

  delete(path: string): Promise<void>

  move?(from: string, to: string): Promise<void>

  exists?(path: string): Promise<boolean>
}
```

职责划分：

| 模块 | 职责 | 不负责 |
|------|------|--------|
| `StorageProvider` | 单一后端协议的连接、列目录、读、写、删、移动、存在性检查 | 索引、版本、冲突、增量同步 |
| `StorageManager` | 根据设置创建 provider，统一连接，给 `move/exists` 提供兜底实现，提供连接测试 | 同步策略 |
| `SyncManager` | 基于 provider 上传/下载 note 与 index，是同步逻辑的入口 | 具体协议 API |

当前 provider：

| Provider | 配置字段 | 当前能力 | 说明 |
|----------|----------|----------|------|
| Local | `rootPath` | list/read/write/delete/move/exists | 本地目录，可作为同步目标或测试目标 |
| GitHub | `owner`、`repo`、`branch`、`basePath`、`token` | list/read/write/delete/move/exists | 基于 GitHub Contents API；写入/删除需要 token |
| WebDAV | `endpoint`、`username`、`password`、`basePath` | list/read/write/delete/move/exists | 使用 PROPFIND/PUT/DELETE/MOVE |
| FTP/FTPS | `host`、`port`、`username`、`password`、`secure`、`basePath` | list/read/write/delete/move/exists | 基于 `basic-ftp`，每次操作建立连接并关闭 |
| S3 | `endpoint`、`region`、`bucket`、`accessKeyId`、`secretAccessKey`、`basePath`、`forcePathStyle` | list/read/write/delete/move/exists | 支持 AWS S3 与兼容对象存储，目录通过 prefix 表达 |

同步层示例：

```ts
class SyncManager {
  constructor(private provider: StorageProvider) {}

  async uploadNote(note: SyncNote): Promise<void> {
    const path = `notes/${note.id}.md`
    await this.provider.write(path, encodeMarkdown(note))
  }

  async downloadIndex(): Promise<SyncIndex> {
    const data = await this.provider.read('index.json')
    return JSON.parse(new TextDecoder().decode(data)) as SyncIndex
  }
}
```

当前状态：

- Provider 适配层已经实现并接入设置页连接测试。
- `SyncManager` 已建立独立于具体 provider 的骨架。
- 完整同步调度、冲突 UI、远端索引合并、离线队列和增量策略仍是后续工作。
- 本地工作区文件浏览与编辑仍由 `FileSystemManager` 管理；远端 provider 不直接替代工作区文件系统。

## 八、设置与密钥安全

`SettingsStore` 持久化 `AppSettings`：

- 工作区路径：`workspacePath`
- AI 配置：`provider`、`apiKey`、`model`、`baseUrl`
- 窗口配置：置顶、透明度、贴边收起、开机启动
- 主题：`light` / `dark`
- 存储配置：Local/GitHub/WebDAV/FTP/S3
- 插件启用状态：`pluginState`
- 快捷键覆盖：`shortcuts`

敏感字段：

- `ai.apiKey`
- `storage.github.token`
- `storage.webdav.password`
- `storage.ftp.password`
- `storage.s3.secretAccessKey`

处理方式：

1. 写入磁盘前用 Electron `safeStorage.encryptString()` 加密，并加 `enc:v1:` 前缀。
2. 读取时识别 `enc:v1:` 并解密；历史明文值会被接受，下次保存时迁移为加密值。
3. `SETTINGS_GET` 返回给渲染层前会用 `API_KEY_SENTINEL` 遮蔽。
4. `SETTINGS_SET` 和 `STORAGE_TEST_CONFIG` 会识别 sentinel，保留原真实密钥，避免空保存覆盖。
5. 设置页可测试未保存配置，测试时也会解析 sentinel 到真实密钥。

## 九、IPC 与 Preload API

IPC 通道集中定义在 `src/shared/ipc-channels.ts`，`src/preload/index.ts` 暴露类型化 facade：

| API 分组 | 代表能力 |
|----------|----------|
| `window.flux.file` | 文件树、读写、guarded write、历史、回收站、搜索、导出 |
| `window.flux.window` | 打开独立笔记窗口、置顶、透明度、贴边收起、开机启动 |
| `window.flux.plugin` | 列表、安装、本地加载、卸载、激活、停用、格式映射 |
| `window.flux.ai` | 生成、聊天、转写、取消、配置测试、流式生成 |
| `window.flux.settings` | 读取和更新应用设置 |
| `window.flux.storage` | 测试存储配置 |
| `window.flux.dialog` | 打开文件、目录、保存文件 |
| `window.flux.app` | 版本、路径、外链、更新检查 |

重要事件：

- `FILE_CHANGED_EVENT`：guarded write 或历史恢复后广播给其他窗口，避免覆盖。
- `FILE_TREE_CHANGED_EVENT`：chokidar 或内部 mutation 后广播文件树。
- `PLUGIN_FORMAT_MAP_CHANGED_EVENT`：插件激活/停用后广播扩展名到编辑器绑定。
- `AI_STREAM_CHUNK / DONE / ERROR`：流式 AI 输出。
- `AI_TOOL_EXECUTED`：AI 工具调用完成，例如创建文件。
- `MENU_ACTION_EVENT`：主进程菜单动作转发给当前窗口。

## 十、渲染层结构

主要组件：

| 组件 | 职责 |
|------|------|
| `App.tsx` | 主窗口组合、菜单动作、全局快捷键、主题 |
| `Sidebar.tsx` | 文件树、新建文件、回收站入口、插件文件图标 |
| `Editor.tsx` | 根据文件格式选择具体编辑器，处理保存、查找、上下文菜单 |
| `SettingsPanel.tsx` | AI、窗口、存储、快捷键、插件等设置 |
| `PluginMarket.tsx` | 内置/用户插件启用、安装、卸载、开发指南入口 |
| `AIPanel.tsx` | AI 对话、生成、流式结果与工具调用展示 |
| `FileHistoryDialog.tsx` | 历史版本列表、预览与恢复 |
| `PluginIframeEditor.tsx` | 第三方 iframe 编辑器宿主 |

`fileStore` 负责：

- 当前文件、内容、mtime、dirty 状态。
- 2 秒防抖自动保存。
- `writeGuarded` 冲突检测。
- 接收外部文件变更并根据 dirty 状态决定刷新或标记冲突。
- 删除后刷新回收站；恢复/永久删除/清空回收站。

## 十一、插件系统

插件类型定义在 `src/shared/types.ts` 与 `src/plugin-sdk`。

插件 manifest 当前使用独立 `manifest.json`：

```json
{
  "id": "markdown",
  "name": "Markdown",
  "version": "1.0.0",
  "type": "format",
  "extensions": ["md", "markdown"],
  "primaryExtension": "md",
  "formatBinding": "markdown",
  "main": "main.js",
  "permissions": ["fs:read", "fs:write"]
}
```

格式绑定有两种：

| 绑定方式 | 说明 |
|----------|------|
| `formatBinding` | 复用宿主内置编辑器，例如 markdown、kanban、mermaid |
| `editor.entry` | 插件提供 sandboxed iframe 编辑器，通过 postMessage 协议与宿主交换内容 |

生命周期：

```text
discover → installed → activating → active → deactivating → inactive
                         └──────────── error
```

安全边界：

- 用户插件目录位于 Electron `userData` 下，内置插件位于 `src/builtin-plugins` 或生产环境 `resources/builtin-plugins`。
- `PluginSandbox` 使用 Node `vm` 执行第三方 `main.js`，阻断 `fs`、`process`、`Buffer` 等高危全局能力。
- 插件只能通过注入的 `PluginAPI` 调用工作区能力。
- 插件文件读写复用 `FileSystemManager`，因此继承目录穿越和符号链接逃逸防护。
- 非内置插件会校验 `sdkVersion` 主版本兼容性。
- manifest 中的 icon/editor 路径会解析为 `file://` URL，并检查不能逃出插件目录。

当前内置格式：

- Markdown / Plain Text
- Draw.io / Mindmap / Whiteboard / Excalidraw
- Kanban / Mermaid / PlantUML
- BPMN / DMN

## 十二、AI 模块

`AIService` 位于主进程，负责：

- 读取设置中的 provider、baseURL、model、apiKey。
- 对接 OpenAI 兼容 Chat Completions 接口。
- 支持一次性生成与流式生成。
- 维护内存中的 conversation history。
- 按当前文件格式读取插件 AI adapter，获取 system prompt 与 response parser。
- 支持 `create_file` 工具调用：当用户要求创建/生成文件时，AI 可以通过受控工具在工作区写入文件。
- 支持音频转写入口，并限制音频扩展名，避免任意文件被送去转写。
- 支持取消生成：`AbortController` 贯穿到 fetch。

AI 数据流：

```text
AIPanel
  ↓
window.flux.ai.generateStream()
  ↓
IPC.AI_GENERATE_STREAM
  ↓
AIService.generateStream()
  ↓
OpenAI-compatible endpoint
  ↓
AI_STREAM_CHUNK / AI_TOOL_EXECUTED / AI_STREAM_DONE
  ↓
Renderer updates chat and files
```

## 十三、窗口管理

`WindowManager` 管理主窗口与独立笔记窗口：

- `createMainWindow()` 创建主窗口。
- `openNoteWindow()` 为文件打开独立窗口。
- `pinNote()` / `unpinNote()` / `togglePin()` 控制置顶。
- `setOpacity()` 控制透明度。
- `setAutoCollapse()` 控制贴边收起。
- `setAutoLaunch()` 使用系统能力管理开机启动。

主进程菜单只负责发出动作，具体 UI 行为由渲染层处理，避免 IME 输入时被 Electron 菜单 accelerator 误触发。

## 十四、数据存储位置

| 数据 | 位置 |
|------|------|
| 用户文档 | `settings.workspacePath` |
| 文件历史 | `<workspace>/.flux/history` |
| 回收站实体 | `<workspace>/.flux/trash/items` |
| 回收站元数据 | `<workspace>/.flux/trash/metadata` |
| 应用设置 | `app.getPath('userData')/flux-settings.json` |
| 用户插件 | `app.getPath('userData')/<USER_PLUGINS_DIR>` |
| 内置插件 | 开发环境 `src/builtin-plugins`；生产环境 `resources/builtin-plugins` |

`.flux` 是应用内部目录，不显示在文件树中，并且用户文件操作会拒绝修改 `.flux` 下的路径。

## 十五、导出与外部交互

文件导出由主进程处理：

- HTML 导出：使用 `marked` 渲染 Markdown，并禁用原始 HTML passthrough，减少脚本注入风险。
- PDF 导出：创建隐藏 `BrowserWindow`，加载清洗后的 HTML，再调用 `printToPDF()`。
- 通用数据导出：通过 `dialog.showSaveDialog()` 选择路径，支持 `utf8` 与 `base64`。

外链打开只允许 `http:` 与 `https:`，避免 renderer 传入 `file://` 或其他协议触发本地资源访问。

## 十六、当前进度

| 模块 | 状态 | 备注 |
|------|------|------|
| Electron 应用骨架 | ✅ 完成 | main/preload/renderer 分层已落地 |
| 本地工作区文件管理 | ✅ 完成 | 文件树、读写、创建、移动、重命名、搜索 |
| guarded write 冲突保护 | ✅ 完成 | 基于 mtime，跨窗口/外部编辑保护 |
| 文件历史 | ✅ 完成 | 保存/删除/移动/重命名前快照，支持恢复 |
| 回收站 | ✅ 完成 | 删除进入 `.flux/trash`，支持恢复、永久删除、清空、打开目录 |
| 插件系统 | ✅ 基础完成 | manifest、生命周期、内置/用户插件、权限、沙箱、格式绑定 |
| 内置格式插件 | ✅ 持续完善 | Markdown、Draw.io、Mindmap、Whiteboard、Excalidraw、Kanban、Mermaid、PlantUML、BPMN、DMN |
| AI 生成 | ✅ 基础完成 | 配置测试、流式输出、工具调用、格式 adapter |
| 存储设置 | ✅ 完成 | 设置页支持 Local/GitHub/WebDAV/FTP/S3 配置与连接测试 |
| StorageProvider 适配器 | ✅ 完成 | Local、GitHub、WebDAV、FTP/FTPS、S3 |
| SyncManager | 🟡 骨架完成 | 需继续实现完整同步调度、冲突合并、索引策略与 UI |
| 自动化测试 | 🟡 待补强 | 当前以类型检查、构建与手动验证为主 |
| 安全隔离 | 🟡 持续增强 | 插件 vm 沙箱已落地，后续可迁移到 utilityProcess |

## 十七、后续演进

优先级建议：

1. **完整同步引擎**：设计本地索引、远端 `index.json`、增量扫描、冲突标记、同步日志和重试队列。
2. **同步 UI**：展示当前 provider、最近同步时间、待上传/待下载/冲突数量、手动同步按钮。
3. **Provider 测试覆盖**：为 path normalization、basePath、目录删除、移动兜底、S3 prefix 等补单元测试。
4. **插件隔离升级**：将第三方插件主逻辑从 `vm` 迁移到 Electron `utilityProcess` 或更强沙箱。
5. **历史与回收站策略**：提供保留天数、最大占用空间、自动清理设置。
6. **端到端验证**：覆盖删除-恢复、历史恢复、跨窗口冲突、插件启停、存储连接测试等关键路径。
