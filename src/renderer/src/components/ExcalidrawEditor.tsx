/**
 * ExcalidrawEditor — Excalidraw-backed built-in renderer.
 *
 * File format: the standard `.excalidraw` JSON —
 *   { type: "excalidraw", version, source, elements, appState, files }
 *
 * That's exactly what `serializeAsJSON` produces, so files created here
 * open in the excalidraw.com web app and vice versa. Empty / new files
 * boot with an empty scene; malformed JSON logs and starts empty rather
 * than trapping the user in a broken canvas.
 */

import { useCallback, useMemo, useRef, useState } from 'react'
import {
  Excalidraw,
  serializeAsJSON,
  restore
} from '@excalidraw/excalidraw'
import type {
  ExcalidrawImperativeAPI,
  ExcalidrawInitialDataState
} from '@excalidraw/excalidraw/types/types'
import type {
  AppState,
  BinaryFiles
} from '@excalidraw/excalidraw/types/types'
import type { ExcalidrawElement } from '@excalidraw/excalidraw/types/element/types'
// v0.17 injects its own styles at mount, no separate CSS file to import.

export interface ExcalidrawEditorProps {
  value: string
  onChange: (data: string) => void
  className?: string
}

/**
 * Parse a stored `.excalidraw` file into the initial-data shape.
 * `restore(...)` handles migration from older schema versions, so we
 * don't have to hand-roll compat code. Returns null if there's nothing
 * usable (empty file, bad JSON) so the caller starts from scratch.
 */
function parseInitialData(raw: string): ExcalidrawInitialDataState | null {
  const trimmed = raw?.trim()
  if (!trimmed) return null
  try {
    const parsed = JSON.parse(trimmed)
    if (!parsed || typeof parsed !== 'object') return null
    const restored = restore(parsed, null, null)
    return {
      elements: restored.elements,
      appState: restored.appState,
      files: restored.files,
      scrollToContent: true
    }
  } catch (err) {
    console.warn('[Excalidraw] failed to parse scene JSON:', err)
    return null
  }
}

export function ExcalidrawEditor({
  value,
  onChange,
  className
}: ExcalidrawEditorProps): JSX.Element {
  const apiRef = useRef<ExcalidrawImperativeAPI | null>(null)
  const onChangeRef = useRef(onChange)
  onChangeRef.current = onChange
  const lastSerialisedRef = useRef<string>('')
  const [hasBooted, setHasBooted] = useState(false)

  // Parent uses `key={filePath}` so we re-mount when files switch;
  // computing initial data once is safe and matches other builtins.
  const initialData = useMemo(() => parseInitialData(value), [])

  const handleChange = useCallback(
    (
      elements: readonly ExcalidrawElement[],
      appState: AppState,
      files: BinaryFiles
    ) => {
      // Skip the very first onChange — Excalidraw fires one immediately
      // after mount before any user input, and serialising the initial
      // scene would flag a fresh file dirty for no reason.
      if (!hasBooted) {
        setHasBooted(true)
        return
      }
      try {
        const serialised = serializeAsJSON(elements, appState, files, 'local')
        if (serialised === lastSerialisedRef.current) return
        lastSerialisedRef.current = serialised
        onChangeRef.current(serialised)
      } catch (err) {
        console.warn('[Excalidraw] serialisation error:', err)
      }
    },
    [hasBooted]
  )

  return (
    <div
      className={`excalidraw-editor-wrapper ${className || ''}`}
      style={{ width: '100%', height: '100%', position: 'relative' }}
    >
      <Excalidraw
        excalidrawAPI={(api) => {
          apiRef.current = api
        }}
        initialData={initialData ?? undefined}
        onChange={handleChange}
      />
    </div>
  )
}

export default ExcalidrawEditor
