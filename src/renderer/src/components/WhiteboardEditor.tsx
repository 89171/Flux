/**
 * WhiteboardEditor — tldraw-backed built-in renderer.
 *
 * File format: tldraw's serialised snapshot JSON. Round-trips lossily
 * only when tldraw itself changes its schema; the schema version is
 * embedded in the snapshot so future tldraw upgrades know how to
 * migrate old files.
 *
 * The value coming in from disk is a UTF-8 string; we parse to JSON,
 * hand to tldraw via loadSnapshot, and serialise back on every
 * document change. `key={filePath}` on the parent forces a remount
 * when the user switches files, so we don't need imperative sync.
 *
 * Improvements over the original stub:
 *  - License key is read from a build-time global
 *    (`window.FLUX_TLDRAW_LICENSE_KEY`, injected from the
 *    `FLUX_TLDRAW_LICENSE_KEY` env var in electron.vite.config.ts)
 *    or the bundled fallback key. This lets CI rotate keys without
 *    touching renderer code.
 *  - `store.listen` is debounced (400ms) before serialising. Without
 *    this, every brush stroke on a large canvas triggered a full
 *    `getSnapshot(store)` + `JSON.stringify` on the main thread.
 *  - `parseSnapshot` validates the parsed JSON's shape: it must look
 *    like a tldraw snapshot (have a `schema` or `document`/`store`)
 *    before we hand it to `loadSnapshot`. Arrays, `null`, primitives,
 *    and unrelated objects are now rejected instead of crashing
 *    inside tldraw.
 */

import { useCallback, useEffect, useMemo, useRef } from 'react'
import {
  Tldraw,
  loadSnapshot,
  createTLStore,
  defaultShapeUtils,
  type Editor as TldrawEditor,
  type TLEditorSnapshot,
  type TLStoreSnapshot
} from 'tldraw'
import 'tldraw/tldraw.css'

/**
 * tldraw commercial licence key, injected at build time from the
 * `FLUX_TLDRAW_LICENSE_KEY` environment variable or the configured
 * fallback key in electron.vite.config.ts. Empty string means "no key
 * configured" — tldraw will run in its free/trial mode.
 */
const TLDRAW_LICENSE_KEY: string =
  (globalThis as { FLUX_TLDRAW_LICENSE_KEY?: string }).FLUX_TLDRAW_LICENSE_KEY ?? ''

export interface WhiteboardEditorProps {
  value: string
  onChange: (data: string) => void
  className?: string
  onReady?: (handle: WhiteboardEditorHandle | null) => void
}

export interface WhiteboardEditorHandle {
  flush: () => void
  exportPng: () => Promise<Blob | null>
}

interface TldrawFileData {
  tldrawFileFormatVersion: number
  schema: unknown
  records: Array<{ id: string } & Record<string, unknown>>
}

function isRecordObject(value: unknown): value is { id: string } & Record<string, unknown> {
  return !!value && typeof value === 'object' && typeof (value as { id?: unknown }).id === 'string'
}

/**
 * Type guard: does this parsed JSON look like a tldraw snapshot?
 *
 * The app has historically saved `getSnapshot(store)` output:
 * `{ document: { schema, store }, session }`. Official `.tldr` files
 * instead use `{ tldrawFileFormatVersion, schema, records }`. We also
 * accept a bare `{ schema, store }` snapshot for older internal files.
 */
function isTldrawSnapshotShape(parsed: unknown): parsed is Partial<TLEditorSnapshot> | TLStoreSnapshot {
  if (!parsed || typeof parsed !== 'object') return false
  // Arrays are objects in JS — exclude them explicitly.
  if (Array.isArray(parsed)) return false
  const obj = parsed as Record<string, unknown>

  if (typeof obj.schema === 'object' && !!obj.schema && typeof obj.store === 'object' && !!obj.store) {
    return true
  }

  const document = obj.document
  if (!document || typeof document !== 'object' || Array.isArray(document)) return false
  const documentObj = document as Record<string, unknown>
  return (
    typeof documentObj.schema === 'object' &&
    !!documentObj.schema &&
    typeof documentObj.store === 'object' &&
    !!documentObj.store
  )
}

function isTldrawFileData(parsed: unknown): parsed is TldrawFileData {
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return false
  const obj = parsed as Record<string, unknown>
  return (
    typeof obj.tldrawFileFormatVersion === 'number' &&
    typeof obj.schema === 'object' &&
    !!obj.schema &&
    Array.isArray(obj.records) &&
    obj.records.every(isRecordObject)
  )
}

function tldrawFileToStoreSnapshot(file: TldrawFileData): TLStoreSnapshot {
  return ({
    schema: file.schema,
    store: Object.fromEntries(file.records.map((record) => [record.id, record]))
  } as unknown) as TLStoreSnapshot
}

function serializeStoreAsTldrawFile(store: ReturnType<typeof createTLStore>): string {
  const records = store.allRecords()
  return JSON.stringify({
    tldrawFileFormatVersion: 1,
    schema: store.schema.serialize(),
    records
  })
}

/**
 * Parse the stored string into a tldraw snapshot. Accepts:
 *   - empty string / whitespace → start with a fresh empty store
 *   - a full TLEditorSnapshot (document + session state)
 *   - a bare TLStoreSnapshot (document only, older files)
 *
 * On malformed JSON or wrong shape we log and return null so the
 * caller falls back to an empty store — losing the parse is better
 * than crashing the editor.
 */
function parseSnapshot(raw: string): Partial<TLEditorSnapshot> | TLStoreSnapshot | null {
  const trimmed = raw?.trim()
  if (!trimmed) return null
  try {
    const parsed: unknown = JSON.parse(trimmed)
    if (isTldrawFileData(parsed)) {
      return tldrawFileToStoreSnapshot(parsed)
    }
    if (isTldrawSnapshotShape(parsed)) {
      return parsed
    }
    console.warn('[Whiteboard] parsed JSON is not a tldraw snapshot shape; ignoring')
  } catch (err) {
    console.warn('[Whiteboard] failed to parse tldraw snapshot:', err)
  }
  return null
}

export function WhiteboardEditor({
  value,
  onChange,
  className,
  onReady
}: WhiteboardEditorProps): JSX.Element {
  // Build one store per mount. Parent uses key={filePath} so a store
  // never survives a file switch — no need to hot-swap contents.
  const store = useMemo(() => {
    const s = createTLStore({ shapeUtils: defaultShapeUtils })
    const initial = parseSnapshot(value)
    if (initial) {
      try {
        loadSnapshot(s, initial)
      } catch (err) {
        console.warn(
          '[Whiteboard] failed to load initial snapshot; starting empty:',
          err
        )
      }
    }
    return s
    // Intentionally NOT depending on `value` — remount handles reload.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const onChangeRef = useRef(onChange)
  onChangeRef.current = onChange
  const editorRef = useRef<TldrawEditor | null>(null)
  const lastSerialisedRef = useRef<string | null>(null)
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  if (lastSerialisedRef.current === null) {
    try {
      lastSerialisedRef.current = serializeStoreAsTldrawFile(store)
    } catch {
      // If tldraw cannot serialise during initialisation, the next
      // real document change will try again and surface a warning.
    }
  }

  const flush = useCallback(() => {
    if (debounceRef.current) {
      clearTimeout(debounceRef.current)
      debounceRef.current = null
    }
    try {
      const serialised = serializeStoreAsTldrawFile(store)
      if (serialised === lastSerialisedRef.current) return
      lastSerialisedRef.current = serialised
      onChangeRef.current(serialised)
    } catch (err) {
      console.warn('[Whiteboard] serialisation error:', err)
    }
  }, [store])

  const exportPng = useCallback(async (): Promise<Blob | null> => {
    const editor = editorRef.current
    if (!editor) return null

    flush()

    const shapes = editor.getCurrentPageShapes()
    if (shapes.length === 0) return null

    const result = await editor.toImage(shapes, {
      format: 'png',
      background: true,
      padding: 32,
      pixelRatio: 2,
      darkMode: document.documentElement.getAttribute('data-theme') === 'dark'
    })
    return result.blob
  }, [flush])

  useEffect(() => {
    const handle: WhiteboardEditorHandle = { flush, exportPng }
    onReady?.(handle)
    return () => onReady?.(null)
  }, [exportPng, flush, onReady])

  useEffect(() => {
    const handleFlush = () => flush()
    window.addEventListener('flux:flush-active-editor', handleFlush)
    return () => window.removeEventListener('flux:flush-active-editor', handleFlush)
  }, [flush])

  // Subscribe to document changes and serialise back to the parent —
  // debounced so a single brush stroke (which fires many change
  // events as the pointer moves) only triggers one serialise.
  useEffect(() => {
    const unlisten = store.listen(
      () => {
        if (debounceRef.current) clearTimeout(debounceRef.current)
        debounceRef.current = setTimeout(() => {
          try {
            const serialised = serializeStoreAsTldrawFile(store)
            if (serialised === lastSerialisedRef.current) return
            lastSerialisedRef.current = serialised
            onChangeRef.current(serialised)
          } catch (err) {
            console.warn('[Whiteboard] serialisation error:', err)
          }
        }, 400)
      },
      // Only fire for document (persistent) changes — otherwise cursor
      // movement, camera pans etc. would mark the file dirty on every
      // pixel of interaction.
      { scope: 'document' }
    )
    return () => {
      // Flush any pending debounced change before unmounting so the last
      // stroke isn't lost when the user switches files quickly.
      flush()
      unlisten()
    }
  }, [flush, store])

  return (
    <div
      className={`whiteboard-editor-wrapper ${className || ''}`}
      style={{ width: '100%', height: '100%', position: 'relative' }}
    >
      <Tldraw
        store={store}
        licenseKey={TLDRAW_LICENSE_KEY}
        initialState="draw"
        onMount={(editor) => {
          editorRef.current = editor
          editor.setCurrentTool('draw')
          return () => {
            editorRef.current = null
          }
        }}
      />
    </div>
  )
}

export default WhiteboardEditor
