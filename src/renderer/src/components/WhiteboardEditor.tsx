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
 *    instead of being hardcoded in source. This keeps the secret out
 *    of the repo and lets CI rotate keys without code changes.
 *  - `store.listen` is debounced (400ms) before serialising. Without
 *    this, every brush stroke on a large canvas triggered a full
 *    `getSnapshot(store)` + `JSON.stringify` on the main thread.
 *  - `parseSnapshot` validates the parsed JSON's shape: it must look
 *    like a tldraw snapshot (have a `schema` or `document`/`store`)
 *    before we hand it to `loadSnapshot`. Arrays, `null`, primitives,
 *    and unrelated objects are now rejected instead of crashing
 *    inside tldraw.
 */

import { useEffect, useMemo, useRef } from 'react'
import {
  Tldraw,
  getSnapshot,
  loadSnapshot,
  createTLStore,
  defaultShapeUtils,
  type TLEditorSnapshot,
  type TLStoreSnapshot
} from 'tldraw'
import 'tldraw/tldraw.css'

/**
 * tldraw commercial licence key, injected at build time from the
 * `FLUX_TLDRAW_LICENSE_KEY` environment variable (see
 * electron.vite.config.ts). Empty string means "no key configured"
 * — tldraw will run in its free/trial mode.
 */
const TLDRAW_LICENSE_KEY: string =
  (globalThis as { FLUX_TLDRAW_LICENSE_KEY?: string }).FLUX_TLDRAW_LICENSE_KEY ?? ''

export interface WhiteboardEditorProps {
  value: string
  onChange: (data: string) => void
  className?: string
}

/**
 * Type guard: does this parsed JSON look like a tldraw snapshot?
 *
 * A `TLEditorSnapshot` has `{ schema, document, session?, store? }`.
 * A legacy `TLStoreSnapshot` has `{ schema, store }`. We require at
 * minimum an own `schema` property — that's the field tldraw uses to
 * version the format, and it's present in every snapshot tldraw has
 * ever produced. Without it, `loadSnapshot` throws deep in its
 * migration code with an unhelpful error.
 */
function isTldrawSnapshotShape(parsed: unknown): parsed is Partial<TLEditorSnapshot> | TLStoreSnapshot {
  if (!parsed || typeof parsed !== 'object') return false
  // Arrays are objects in JS — exclude them explicitly.
  if (Array.isArray(parsed)) return false
  const obj = parsed as Record<string, unknown>
  return 'schema' in obj && typeof obj.schema === 'object'
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
  className
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
  const lastSerialisedRef = useRef<string | null>(null)
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  // Subscribe to document changes and serialise back to the parent —
  // debounced so a single brush stroke (which fires many change
  // events as the pointer moves) only triggers one serialise.
  useEffect(() => {
    const unlisten = store.listen(
      () => {
        if (debounceRef.current) clearTimeout(debounceRef.current)
        debounceRef.current = setTimeout(() => {
          try {
            const snapshot = getSnapshot(store)
            const serialised = JSON.stringify(snapshot)
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
      { source: 'user', scope: 'document' }
    )
    return () => {
      // Flush any pending debounced change before unmounting so the last
      // stroke isn't lost when the user switches files quickly.
      if (debounceRef.current) {
        clearTimeout(debounceRef.current)
        debounceRef.current = null
        try {
          const snapshot = getSnapshot(store)
          const serialised = JSON.stringify(snapshot)
          if (serialised !== lastSerialisedRef.current) {
            lastSerialisedRef.current = serialised
            onChangeRef.current(serialised)
          }
        } catch {
          // best-effort
        }
      }
      unlisten()
    }
  }, [store])

  return (
    <div
      className={`whiteboard-editor-wrapper ${className || ''}`}
      style={{ width: '100%', height: '100%', position: 'relative' }}
    >
      <Tldraw store={store} licenseKey={TLDRAW_LICENSE_KEY} />
    </div>
  )
}

export default WhiteboardEditor
