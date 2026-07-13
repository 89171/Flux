# PaiNote 插件开发指南

PaiNote 的引擎与内容格式完全解耦：所有格式（Markdown / Drawio / 思维导图 / 第三方格式）都通过插件提供。本指南说明如何用 `@painote/plugin-sdk` 开发一个插件。

## 一、最小示例

```ts
import { useState } from 'react'
import { definePlugin, defineAIAdapter, textToDoc } from '@plugin-note/plugin-sdk'
import type { EditorProps, PluginDocument } from '@painote/plugin-sdk'

function MyEditor({ doc, onChange }: EditorProps<string>) {
  const [text, setText] = useState(doc.content)
  return (
    <textarea
      value={text}
      onChange={(e) => { setText(e.target.value); onChange({ ...doc, content: e.target.value }) }}
    />
  )
}

export default definePlugin<string>({
  manifest: {
    id: 'myformat',
    name: 'my-format-plugin',
    version: '1.0.0',
    format: 'myformat',
    displayName: '我的格式',
    main: 'dist/index.js',
    permissions: ['fs:notes', 'ai:generate', 'storage']
  },
  editor: MyEditor,
  serialize: (doc) => doc.content,
  deserialize: (raw) => textToDoc('myformat', raw),
  createEmpty: () => textToDoc('myformat', ''),
  aiAdapter: defineAIAdapter({
    systemPrompt: '你是一个笔记助手，请直接输出纯文本。',
    parse: (text) => textToDoc('myformat', text.trim())
  }),
  lifecycle: {
    onActivate: (ctx) => ctx.logger.info('已激活')
  }
})
```

## 二、封装规则

1. **入口**：插件包默认导出一个 `PaiNotePlugin`，必须经 `definePlugin()` 包装（提供类型推导 + manifest 校验）。
2. **manifest**：来自 `package.json` 的 `painote` 字段，主进程加载时二次校验。必填：`id` / `format` / `displayName` / `name` / `version` / `main`。
3. **id 与 format 约定一致**：一份插件对应一种格式，`id === format`（避免一对多混淆）。
4. **id 命名规则**：仅小写字母 / 数字 / 连字符，如 `markdown`、`mindmap`。
5. **权限白名单**：`permissions` 只能取 `fs:notes | fs:plugin | ai:generate | window:pin | notification | storage`。未声明的能力调用会被引擎拒绝。

## 三、封装语法（PaiNotePlugin 接口）

| 字段 | 必填 | 说明 |
|------|------|------|
| `manifest` | 是 | 插件清单 |
| `editor` | 是 | 编辑器组件（React），宿主按 format 动态挂载 |
| `viewer` | 否 | 只读视图，缺省复用 editor 的 readonly |
| `serialize` | 是 | 内存文档 → 存储字符串 |
| `deserialize` | 是 | 存储字符串 → 内存文档 |
| `createEmpty` | 否 | 新建笔记时的空白文档 |
| `aiAdapter` | 否 | AI 输出适配，声明后该格式可被 AI 生成/修改 |
| `lifecycle` | 否 | 生命周期钩子 |

`PluginDocument<T>`：内容在内存中的统一表示，`content: T` 为格式特定数据（Markdown 为 string，Drawio 为 XML，思维导图为层级树）。

## 四、生命周期

```
install  →  load  →  activate  ⇄  deactivate  →  uninstall
 (下载安装)  (加载模块)  (注册格式)    (停用格式)      (删除文件)
```

| 钩子 | 时机 | 典型用途 |
|------|------|----------|
| `onInstall(ctx)` | 安装后一次 | 初始化、数据迁移 |
| `onLoad(ctx)` | 模块加载后 | 注册运行时资源 |
| `onActivate(ctx)` | 激活 | 格式可用，编辑器可渲染 |
| `onDeactivate()` | 停用 | 清理运行时状态 |
| `onUninstall()` | 卸载 | 清理持久化数据 |

引擎维护状态机，非法跃迁会抛错（如未 load 直接 activate）。`ctx` 为 `PluginContext`，注入 `fs / ai / window / storage / notify / logger` 等能力。

## 五、AI 适配器

AI 与格式解耦的关键：AI 模块只生成文本，结构化由各插件 `aiAdapter` 负责。

```ts
aiAdapter: defineAIAdapter<T>({
  systemPrompt: '输出 mxGraph XML …',     // 告诉 AI 如何输出本格式
  parse: (aiOutput) => ({ format, content: ... }), // AI 文本 → 文档
  validate: (doc) => true,                // 可选校验
  toContext: (doc) => '…'                 // 多轮修改时回传给 AI 的上下文
})
```

- 思维导图插件：`systemPrompt` 要求输出缩进层级，`parse` 转为树。
- Drawio 插件：`systemPrompt` 要求输出 mxGraph XML，`parse` 直接取 XML。

## 六、内置 vs 第三方

- **内置插件**：源码在 `plugins/<name>/`，随应用打包，由渲染进程静态导入注册，不可卸载。
- **第三方插件**：预构建为 ESM 包，经插件商城安装到 `dev-plugins/`（运行时目录），渲染进程通过 `painote-plugin://` 协议动态 `import()` 加载，默认导出须为 `PaiNotePlugin`。

## 七、调试

```bash
npm run dev        # 启动应用（热更新）
npm run typecheck  # 类型检查
```

主进程控制台与渲染进程 DevTools 均会输出带 `[PaiNote:<id>]` 前缀的插件日志。
