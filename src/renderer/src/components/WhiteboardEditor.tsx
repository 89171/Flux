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
 */

import { useCallback, useEffect, useMemo, useRef } from 'react'
import {
  Tldraw,
  getSnapshot,
  loadSnapshot,
  createTLStore,
  defaultShapeUtils,
  type Editor,
  type TLEditorSnapshot,
  type TLStoreSnapshot
} from 'tldraw'
import 'tldraw/tldraw.css'

/**
 * Commercial licence key issued by tldraw. Embedding it in the source
 * is the officially recommended way to consume the licence — it's not
 * a secret credential (it merely proves the app is licensed) so
 * checking it in is safe. Rotate this constant when the licence renews.
 */
const TLDRAW_LICENSE_KEY =
  'tldraw-2026-07-28/WyI1S0s4WDI1WiIsWyIqIl0sMTYsIjIwMjYtMDctMjgiXQ.Co00PkZK5Y9riUOpUZ1epqucZY3ICPqLN4khtffwseNd6VftYmhztDXyUuMrIHa6z3SIxu7/+eWHS+F3XNMrJA'

export interface WhiteboardEditorProps {
  value: string
  onChange: (data: string) => void
  className?: string
}

/**
 * Parse the stored string into a tldraw snapshot. Accepts:
 *   - empty string / whitespace → start with a fresh empty store
 *   - a full TLEditorSnapshot (document + session state)
 *   - a bare TLStoreSnapshot (document only, older files)
 *
 * On malformed JSON we log and return null so the caller falls back to
 * an empty store — losing the parse is better than crashing the editor.
 */
function parseSnapshot(raw: string): Partial<TLEditorSnapshot> | TLStoreSnapshot | null {
  const trimmed = raw?.trim()
  if (!trimmed) return null
  try {
    const parsed = JSON.parse(trimmed)
    if (parsed && typeof parsed === 'object') {
      return parsed as Partial<TLEditorSnapshot> | TLStoreSnapshot
    }
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

  const editorRef = useRef<Editor | null>(null)
  const onChangeRef = useRef(onChange)
  onChangeRef.current = onChange
  const lastSerialisedRef = useRef<string | null>(null)

  // Subscribe to document changes and serialise back to the parent.
  useEffect(() => {
    const unlisten = store.listen(
      () => {
        try {
          const snapshot = getSnapshot(store)
          const serialised = JSON.stringify(snapshot)
          if (serialised === lastSerialisedRef.current) return
          lastSerialisedRef.current = serialised
          onChangeRef.current(serialised)
        } catch (err) {
          console.warn('[Whiteboard] serialisation error:', err)
        }
      },
      // Only fire for document (persistent) changes — otherwise cursor
      // movement, camera pans etc. would mark the file dirty on every
      // pixel of interaction.
      { source: 'user', scope: 'document' }
    )
    return unlisten
  }, [store])

  const handleMount = useCallback((editor: Editor) => {
    editorRef.current = editor
  }, [])

  return (
    <div
      className={`whiteboard-editor-wrapper ${className || ''}`}
      style={{ width: '100%', height: '100%', position: 'relative' }}
    >
      <Tldraw store={store} onMount={handleMount} licenseKey={TLDRAW_LICENSE_KEY} />
    </div>
  )
}

export default WhiteboardEditor
