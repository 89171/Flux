# Flux

> 插件化、桌面置顶、AI 生成的 Electron 笔记本应用。

完整架构设计见 [ARCHITECTURE.md](./ARCHITECTURE.md)。

## 开发

```bash
npm install
npm run dev      # 启动开发模式（热更新）
npm run build    # 构建产物
npm run typecheck
```

## 功能路线

1. ✅ 架构与目录结构
2. ✅ 插件系统骨架 + SDK（@flux/plugin-sdk）
3. ⏳ Markdown 内置插件
4. ⏳ 窗口置顶功能
5. ⏳ AI 生成模块
6. ⏳ 插件商城

## 插件开发

插件依赖 `@flux/plugin-sdk`，通过 `definePlugin` 封装后默认导出：

```ts
import { definePlugin } from '@flux/plugin-sdk'

export default definePlugin({
  manifest: { id: 'myformat', format: 'myformat', displayName: 'My Format', ... },
  editor: MyEditor,
  serialize: (doc) => doc.content,
  deserialize: (raw) => ({ format: 'myformat', content: raw }),
  aiAdapter: { systemPrompt: '...', parse: (t) => ({...}) }
})
```
