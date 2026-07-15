/**
 * CodeMirrorEditor — full-featured CodeMirror 6 source editor.
 *
 * Replaces the bare textarea for non-markdown source files. Detects the
 * language from the file extension, wires up the standard CM6 keymaps /
 * gutters / brackets, and tracks the app's `data-theme` attribute so the
 * editor swaps between `oneDark` and a CSS-variable light theme live
 * (via a MutationObserver on documentElement).
 *
 * Dynamic concerns (language, theme, font size, editable) live in
 * Compartments so they can be reconfigured without rebuilding the editor.
 */

import { useEffect, useRef } from 'react'
import { Compartment, EditorState } from '@codemirror/state'
import type { Extension } from '@codemirror/state'
import {
  EditorView,
  keymap,
  lineNumbers,
  highlightActiveLineGutter,
  highlightSpecialChars,
  drawSelection,
  dropCursor,
  rectangularSelection,
  crosshairCursor,
  highlightActiveLine
} from '@codemirror/view'
import { defaultKeymap, historyKeymap, toggleComment } from '@codemirror/commands'
import { bracketMatching, indentOnInput, foldGutter, foldKeymap } from '@codemirror/language'
import { closeBrackets, completionKeymap } from '@codemirror/autocomplete'
import { searchKeymap } from '@codemirror/search'
import { json } from '@codemirror/lang-json'
import { javascript } from '@codemirror/lang-javascript'
import { python } from '@codemirror/lang-python'
import { css } from '@codemirror/lang-css'
import { html } from '@codemirror/lang-html'
import { xml } from '@codemirror/lang-xml'
import { markdown } from '@codemirror/lang-markdown'
import { oneDark } from '@codemirror/theme-one-dark'

export interface CodeMirrorEditorProps {
  value: string
  onChange: (value: string) => void
  fileName?: string
  fontSize?: number
  readOnly?: boolean
}

/**
 * Resolve a CodeMirror language extension from the file name's extension.
 * Returns an empty array (a no-op extension) for unknown / plain text.
 */
function getLanguageExtension(fileName?: string): Extension {
  if (!fileName) return []
  const ext = fileName.split('.').pop()?.toLowerCase() ?? ''
  switch (ext) {
    case 'json':
      return json()
    case 'js':
    case 'jsx':
    case 'ts':
    case 'tsx':
    case 'mjs':
      return javascript({ jsx: true, typescript: true })
    case 'py':
      return python()
    case 'css':
      return css()
    case 'html':
    case 'htm':
      return html()
    case 'xml':
    case 'svg':
      return xml()
    case 'md':
      return markdown()
    default:
      return []
  }
}

function isDarkTheme(): boolean {
  return document.documentElement.getAttribute('data-theme') === 'dark'
}

function getThemeExtension(): Extension {
  // oneDark carries its own (dark) background; the light theme is
  // transparent so the container's --bg-primary shows through.
  return isDarkTheme() ? oneDark : lightTheme
}

function buildFontSizeTheme(size: number): Extension {
  return EditorView.theme({
    '.cm-content': { fontSize: `${size}px` }
  })
}

/**
 * Always-on base theme: make the editor fill its container and scroll
 * properly. Color/background concerns belong to the theme compartment.
 */
const baseTheme = EditorView.theme({
  '&': { height: '100%' },
  '.cm-scroller': {
    overflow: 'auto',
    fontFamily: 'var(--font-mono)'
  }
})

/**
 * Custom light theme driven by the app's CSS variables. Background is
 * transparent so the container's `var(--bg-primary)` shows through.
 */
const lightTheme = EditorView.theme({
  '&': {
    backgroundColor: 'transparent',
    color: 'var(--text-primary)'
  },
  '.cm-content': {
    color: 'var(--text-primary)',
    caretColor: 'var(--text-primary)'
  },
  '.cm-gutters': {
    backgroundColor: 'transparent',
    color: 'var(--text-tertiary)',
    border: 'none'
  },
  '.cm-activeLine': {
    backgroundColor: 'var(--bg-hover)'
  },
  '.cm-activeLineGutter': {
    backgroundColor: 'transparent',
    color: 'var(--text-primary)'
  },
  '&.cm-focused .cm-selectionBackground, .cm-selectionBackground, .cm-content ::selection': {
    backgroundColor: 'var(--bg-selected)'
  },
  '.cm-cursor': {
    borderLeftColor: 'var(--text-primary)'
  },
  '.cm-matchingBracket': {
    backgroundColor: 'var(--bg-tertiary)',
    color: 'var(--text-primary)'
  }
})

export default function CodeMirrorEditor({
  value,
  onChange,
  fileName,
  fontSize = 14,
  readOnly = false
}: CodeMirrorEditorProps): JSX.Element {
  const hostRef = useRef<HTMLDivElement | null>(null)
  const viewRef = useRef<EditorView | null>(null)
  // Ref for the latest onChange so the updateListener never closes over
  // a stale callback.
  const onChangeRef = useRef(onChange)
  onChangeRef.current = onChange

  // Compartments are stable for the lifetime of the component.
  const languageCompartment = useRef(new Compartment()).current
  const themeCompartment = useRef(new Compartment()).current
  const fontSizeCompartment = useRef(new Compartment()).current
  const editableCompartment = useRef(new Compartment()).current

  // Create the editor once.
  useEffect(() => {
    if (!hostRef.current) return

    const updateListener = EditorView.updateListener.of((update) => {
      if (update.docChanged) {
        onChangeRef.current(update.state.doc.toString())
      }
    })

    const extensions: Extension[] = [
      lineNumbers(),
      highlightActiveLineGutter(),
      highlightSpecialChars(),
      drawSelection(),
      dropCursor(),
      rectangularSelection(),
      crosshairCursor(),
      highlightActiveLine(),
      keymap.of([
        ...defaultKeymap,
        ...searchKeymap,
        ...historyKeymap,
        ...completionKeymap,
        ...foldKeymap
      ]),
      // Ctrl-/ (Cmd-/ on macOS) to toggle comments. The commands package
      // does not ship a dedicated commentKeymap, so bind toggleComment
      // directly. (defaultKeymap already wires this too — kept explicit
      // for clarity.)
      keymap.of([{ key: 'Mod-/', run: toggleComment }]),
      bracketMatching(),
      closeBrackets(),
      indentOnInput(),
      foldGutter(),
      EditorView.lineWrapping,
      // Required for rectangularSelection to place multiple cursors.
      EditorState.allowMultipleSelections.of(true),
      baseTheme,
      languageCompartment.of(getLanguageExtension(fileName)),
      themeCompartment.of(getThemeExtension()),
      fontSizeCompartment.of(buildFontSizeTheme(fontSize)),
      editableCompartment.of(EditorView.editable.of(!readOnly)),
      updateListener
    ]

    const view = new EditorView({
      parent: hostRef.current,
      state: EditorState.create({ doc: value, extensions })
    })
    viewRef.current = view

    // Live-switch the theme when the app's data-theme attribute flips.
    const observer = new MutationObserver(() => {
      view.dispatch({ effects: themeCompartment.reconfigure(getThemeExtension()) })
    })
    observer.observe(document.documentElement, {
      attributes: true,
      attributeFilter: ['data-theme']
    })

    return () => {
      observer.disconnect()
      view.destroy()
      viewRef.current = null
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // Fold external `value` changes (file switch, external write) into the
  // editor without resetting cursor position. Only dispatch when the new
  // value actually differs from the current document — this also breaks
  // the feedback loop with onChange-driven updates.
  useEffect(() => {
    const view = viewRef.current
    if (!view) return
    if (view.state.doc.toString() !== value) {
      view.dispatch({
        changes: { from: 0, to: view.state.doc.length, insert: value }
      })
    }
  }, [value])

  // Reconfigure the language when the active file changes.
  useEffect(() => {
    const view = viewRef.current
    if (!view) return
    view.dispatch({
      effects: languageCompartment.reconfigure(getLanguageExtension(fileName))
    })
  }, [fileName, languageCompartment])

  // Reconfigure the font size.
  useEffect(() => {
    const view = viewRef.current
    if (!view) return
    view.dispatch({
      effects: fontSizeCompartment.reconfigure(buildFontSizeTheme(fontSize))
    })
  }, [fontSize, fontSizeCompartment])

  // Reconfigure read-only / editable state.
  useEffect(() => {
    const view = viewRef.current
    if (!view) return
    view.dispatch({
      effects: editableCompartment.reconfigure(EditorView.editable.of(!readOnly))
    })
  }, [readOnly, editableCompartment])

  return (
    <div
      ref={hostRef}
      style={{
        width: '100%',
        height: '100%',
        backgroundColor: 'var(--bg-primary)'
      }}
    />
  )
}
