/**
 * Flux Markdown Editor (Milkdown 7)
 *
 * WYSIWYG markdown editor using Milkdown's official API — the same engine
 * behind many production note apps. Round-trips markdown losslessly via
 * remark, so tables, task lists, code blocks, and GFM extensions survive
 * save/load cycles.
 *
 * The parent uses `key={currentFile.path}` on this component, so switching
 * files remounts the editor with fresh content. For same-file external
 * content changes (AI Replace/Append, streaming), a useEffect calls
 * `editor.action(replaceAll(value))` — see the sync effect below.
 */

import { Milkdown, MilkdownProvider, useEditor } from '@milkdown/react'
import { Editor, rootCtx, defaultValueCtx } from '@milkdown/kit/core'
import { commonmark } from '@milkdown/kit/preset/commonmark'
import { gfm } from '@milkdown/kit/preset/gfm'
import { listener, listenerCtx } from '@milkdown/kit/plugin/listener'
import { history } from '@milkdown/kit/plugin/history'
import { clipboard } from '@milkdown/kit/plugin/clipboard'
import { cursor } from '@milkdown/kit/plugin/cursor'
import { replaceAll } from '@milkdown/utils'
import { useRef, useEffect } from 'react'
import Prism from 'prismjs'
import 'prismjs/components/prism-javascript'
import 'prismjs/components/prism-typescript'
import 'prismjs/components/prism-python'
import 'prismjs/components/prism-css'
import 'prismjs/components/prism-json'
import 'prismjs/components/prism-bash'
import 'prismjs/components/prism-yaml'
import 'prismjs/components/prism-markup'

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

  // Track the last value we pushed into Milkdown. Used to:
  // 1. Skip replaceAll when value didn't actually change (user typing
  //    fires onChange → setContent → value prop changes back to what
  //    Milkdown already has — no need to re-apply).
  // 2. Avoid a feedback loop: replaceAll → markdownUpdated → onChange
  //    → setContent → value changes → replaceAll → ...
  const lastAppliedRef = useRef(value)
  // True while we're programmatically calling replaceAll so the
  // markdownUpdated listener knows to swallow the resulting event.
  const isApplyingExternalRef = useRef(false)

  const { get } = useEditor((root) =>
    Editor.make()
      .config((ctx) => {
        ctx.set(rootCtx, root)
        ctx.set(defaultValueCtx, value || '')
        ctx.get(listenerCtx).markdownUpdated((_ctx, markdown, prev) => {
          if (markdown === prev) return
          // Update lastApplied so the sync effect knows Milkdown already
          // has this content and doesn't need to re-push it.
          lastAppliedRef.current = markdown
          // Swallow the event if it was triggered by our own replaceAll
          // call — the content came from outside, not from user typing.
          if (isApplyingExternalRef.current) return
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

  // ─── External value → editor sync ───
  // When `value` changes from outside (AI Replace/Append, streaming,
  // file watcher), push the new markdown into the Milkdown instance.
  // Without this, Milkdown only reads `value` at mount time via
  // defaultValueCtx — subsequent prop changes are silently ignored,
  // and the editor shows stale content until a remount (file switch).
  useEffect(() => {
    const editor = get()
    if (!editor) return
    // Skip if Milkdown already has this content (e.g. user typed →
    // onChange → setContent → value comes back identical).
    if (value === lastAppliedRef.current) return

    isApplyingExternalRef.current = true
    try {
      editor.action(replaceAll(value))
      lastAppliedRef.current = value
    } finally {
      // Reset on the next frame so Milkdown's synchronous event cycle
      // (markdownUpdated fires during replaceAll) sees the flag.
      requestAnimationFrame(() => {
        isApplyingExternalRef.current = false
      })
    }
  }, [value, get])

  // Highlight code blocks with Prism after Milkdown renders.
  // Milkdown 7 doesn't ship a prism plugin, so we apply highlighting
  // directly to the rendered DOM. A MutationObserver catches dynamically
  // added/changed code blocks (typing, paste, file switch).
  const containerRef = useRef<HTMLDivElement>(null)
  useEffect(() => {
    const highlight = (): void => {
      const root = containerRef.current
      if (!root) return
      const codeBlocks = root.querySelectorAll('pre code[class*="language-"]')
      codeBlocks.forEach((block) => {
        Prism.highlightElement(block)
      })
    }
    // Initial highlight
    const timer = setTimeout(highlight, 100)
    // Observe DOM changes for dynamic code block additions
    const observer = new MutationObserver(() => {
      clearTimeout(timer)
      setTimeout(highlight, 50)
    })
    if (containerRef.current) {
      observer.observe(containerRef.current, {
        childList: true,
        subtree: true,
        characterData: true
      })
    }
    return () => {
      clearTimeout(timer)
      observer.disconnect()
    }
  }, [value])

  return (
    <div ref={containerRef}>
      <Milkdown />
    </div>
  )
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
