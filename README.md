# Flux

> 插件化、桌面置顶、AI 辅助的 Electron 笔记与文档工作台。

Flux 使用 Electron + React + TypeScript 构建，核心目标是把本地文档编辑、格式插件、AI 辅助、文件历史、回收站和多存储同步统一到一个桌面应用里。

完整架构设计见 [ARCHITECTURE.md](./ARCHITECTURE.md)。

## 内置格式

当前项目包含这些内置格式/编辑器插件：

- Markdown
- Plain Text
- Draw.io
- Mindmap
- Whiteboard
- Excalidraw
- Kanban
- Mermaid
- PlantUML
- BPMN
- DMN

## 开发

```bash
npm install
npm run dev          # 启动开发模式
npm run typecheck    # Node + Web 类型检查
npm run build        # 构建生产产物
npm run preview      # 预览构建产物
```

常用分项检查：

```bash
npm run typecheck:node
npm run typecheck:web
```

## 项目结构

```text
src/
  main/
    FileSystemManager.ts      # 工作区文件树、历史、回收站、本地读写
    SettingsStore.ts          # 设置读取、迁移、敏感字段加密
    storage/                  # StorageProvider / StorageManager / SyncManager
    ipc/                      # 主进程 IPC 注册
  preload/
    index.ts                  # window.flux 安全桥接 API
  renderer/
    src/
      components/             # React UI
      stores/                 # Zustand 状态
      styles/                 # 全局与组件样式
  shared/
    types.ts                  # 跨进程共享类型
    ipc-channels.ts           # IPC 通道常量
  plugin-sdk/                 # 插件 SDK
  builtin-plugins/            # 内置格式插件
```

## 当前进度

| 模块 | 进度 | 备注 |
| --- | --- | --- |
| Electron + React 基础应用 | 完成 | electron-vite、主/预加载/渲染进程已接通 |
| 文件工作区 | 完成 | 文件树、创建、读写、重命名、移动、搜索 |
| 文件历史 | 完成 | 保存、删除、重命名、移动、恢复前快照 |
| 回收站 | 完成 | 删除先入回收站，支持还原和永久删除 |
| 插件系统 | 完成 | 插件发现、启停、市场 UI、权限、格式绑定 |
| 内置格式插件 | 进行中 | 常用格式已内置，仍可继续补格式能力 |
| AI 模块 | 完成基础版 | 多 Provider 配置、流式输出、基础工具调用 |
| Storage Provider 中间层 | 完成 | Local/GitHub/WebDAV/FTP/S3 Provider 已实现 |
| SyncManager | 骨架完成 | 已与 Provider 解耦，后续需要接完整同步入口、冲突 UI 和增量策略 |
| 设置面板 | 完成基础版 | 主题、AI、Storage 配置与指南 |
| 自动化测试 | 待完善 | 当前主要依赖 typecheck/build 验证 |

## 最近验证

最近一次验证通过：

```bash
npm run typecheck:node
npm run typecheck:web
npm run build
```

## 插件开发

插件依赖 Flux 插件 SDK，通过 manifest 声明类型、格式扩展名、权限和入口。示例可参考：

- [src/plugin-sdk/examples/json-editor](./src/plugin-sdk/examples/json-editor)
- [src/builtin-plugins](./src/builtin-plugins)

基础形态：

```ts
import { definePlugin } from '@flux/plugin-sdk'

export default definePlugin({
  manifest: {
    id: 'myformat',
    name: 'My Format',
    type: 'format',
    extensions: ['myfmt'],
    main: 'main.js'
  },
  activate(ctx) {
    ctx.log.info('plugin activated')
  }
})
```

第三方插件访问文件系统、通知、命令等能力时，需要在 manifest 中声明对应权限。
