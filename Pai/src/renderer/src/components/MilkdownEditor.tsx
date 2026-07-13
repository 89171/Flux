/**
 * PaiNote Markdown Editor (Tiptap-based WYSIWYG)
 *
 * Replaces Milkdown with Tiptap — the engine behind Notion-style editors.
 * Features:
 *  - True WYSIWYG: formatted text renders live, no preview toggle needed
 *  - Markdown bidirectional serialization via tiptap-markdown
 *  - StarterKit (bold, italic, headings, lists, code blocks, blockquote, etc.)
 *  - Task lists (checkboxes)
 *  - Links and images
 *  - Placeholder text for empty documents
 *  - External value sync (file switching) without feedback loops
 */

import { useEditor, EditorContent } from '@tiptap/react'
import StarterKit from '@tiptap/starter-kit'
import Placeholder from '@tiptap/extension-placeholder'
import TaskList from '@tiptap/extension-task-list'
import TaskItem from '@tiptap/extension-task-item'
import Link from '@tiptap/extension-link'
import Image from '@tiptap/extension-image'
import { Markdown } from 'tiptap-markdown'
import { useEffect, useRef } from 'react'

export interface MarkdownEditorProps {
  value: string
  onChange: (md: string) => void
  className?: string
}

export function MarkdownEditor({ value, onChange, className }: MarkdownEditorProps): JSX.Element {
  const isInternalChange = useRef(false)
  const onChangeRef = useRef(onChange)
  onChangeRef.current = onChange

  const editor = useEditor({
    extensions: [
      StarterKit.configure({
        heading: { levels: [1, 2, 3] }
      }),
      Placeholder.configure({
        placeholder: 'Start writing... (Markdown supported)',
        emptyEditorClass: 'tiptap-empty'
      }),
      TaskList,
      TaskItem.configure({ nested: true }),
      Link.configure({
        openOnClick: false,
        HTMLAttributes: { class: 'tiptap-link' }
      }),
      Image.configure({
        HTMLAttributes: { class: 'tiptap-image' }
      }),
      Markdown.configure({
        html: false,
        transformPastedText: true,
        transformCopiedText: true
      })
    ],
    content: value || '',
    onUpdate: ({ editor }) => {
      // Serialize to Markdown and notify parent
      isInternalChange.current = true
      const md = editor.storage.markdown?.getMarkdown() || editor.getText()
      onChangeRef.current(md)
    },
    editorProps: {
      attributes: {
        class: 'tiptap-editor prose',
        spellcheck: 'false'
      }
    }
  })

  // Sync external value changes (e.g., switching files) into the editor
  useEffect(() => {
    if (!editor) return

    if (isInternalChange.current) {
      isInternalChange.current = false
      return
    }

    // Only update if the value is genuinely different from current editor content
    const currentMd = editor.storage.markdown?.getMarkdown() || ''
    if (value !== currentMd) {
      // setContent with emitUpdate=false to avoid triggering onUpdate
      editor.commands.setContent(value || '', false)
    }
  }, [value, editor])

  if (!editor) {
    return (
      <div className={`markdown-editor-wrapper ${className || ''}`}>
        <div style={{ padding: '32px 48px', color: 'var(--text-tertiary)', fontSize: '13px' }}>
          Loading editor...
        </div>
      </div>
    )
  }

  return (
    <div className={`markdown-editor-wrapper ${className || ''}`}>
      <EditorContent editor={editor} />
    </div>
  )
}

export default MarkdownEditor
