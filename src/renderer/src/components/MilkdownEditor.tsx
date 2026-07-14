/**
 * PaiNote Markdown Editor (Milkdown 7)
 *
 * WYSIWYG markdown editor using Milkdown's official API — the same engine
 * behind many production note apps. Round-trips markdown losslessly via
 * remark, so tables, task lists, code blocks, and GFM extensions survive
 * save/load cycles.
 *
 * The parent uses `key={currentFile.path}` on this component, so switching
 * files remounts the editor with fresh content — no imperative setContent
 * plumbing needed here.
 */

import { Milkdown, MilkdownProvider, useEditor } from '@milkdown/react'
import { Editor, rootCtx, defaultValueCtx } from '@milkdown/kit/core'
import { commonmark } from '@milkdown/kit/preset/commonmark'
import { gfm } from '@milkdown/kit/preset/gfm'
import { listener, listenerCtx } from '@milkdown/kit/plugin/listener'
import { history } from '@milkdown/kit/plugin/history'
import { clipboard } from '@milkdown/kit/plugin/clipboard'
import { cursor } from '@milkdown/kit/plugin/cursor'
import { useRef } from 'react'

export interface MarkdownEditorProps {
  value: string
  onChange: (md: string) => void
  className?: string
}

function MilkdownInner({
  value,
  onChange
}: {
  value: string
  onChange: (md: string) => void
}): JSX.Element {
  const onChangeRef = useRef(onChange)
  onChangeRef.current = onChange

  useEditor((root) =>
    Editor.make()
      .config((ctx) => {
        ctx.set(rootCtx, root)
        ctx.set(defaultValueCtx, value || '')
        ctx.get(listenerCtx).markdownUpdated((_ctx, markdown, prev) => {
          if (markdown === prev) return
          onChangeRef.current(markdown)
        })
      })
      .use(commonmark)
      .use(gfm)
      .use(listener)
      .use(history)
      .use(clipboard)
      .use(cursor)
  )

  return <Milkdown />
}

export function MarkdownEditor({ value, onChange, className }: MarkdownEditorProps): JSX.Element {
  return (
    <div className={`markdown-editor-wrapper ${className || ''}`}>
      <MilkdownProvider>
        <MilkdownInner value={value} onChange={onChange} />
      </MilkdownProvider>
    </div>
  )
}

export default MarkdownEditor
