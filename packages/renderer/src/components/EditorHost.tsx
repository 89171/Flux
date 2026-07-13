import { useNotes } from '../store/notes'
import { getPlugin } from '../plugin-host/store'

/**
 * 编辑器宿主：根据当前笔记的 format，从插件注册表取出对应编辑器组件并挂载。
 * 引擎本身不包含任何格式逻辑，完全由插件提供编辑器。
 * key 随笔记 id + format 变化，确保切换笔记时编辑器重新挂载、状态不串。
 */
export function EditorHost(): JSX.Element {
  const { doc, updateDoc, currentId } = useNotes()

  if (!doc) {
    return (
      <div className="empty-state">
        <h2>PaiNote</h2>
        <p>从左侧选择或新建一条笔记开始</p>
      </div>
    )
  }

  const plugin = getPlugin(doc.format)
  if (!plugin) {
    return (
      <div className="empty-state">
        <h2>未找到格式插件</h2>
        <p>当前笔记格式 "{doc.format}" 没有已激活的插件支持</p>
      </div>
    )
  }

  const Editor = plugin.editor
  return <Editor key={`${currentId}:${doc.format}`} doc={doc} onChange={updateDoc} />
}
