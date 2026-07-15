/**
 * DmnEditor — dmn-js Modeler wrapped as a React component.
 *
 * File format: DMN 1.3 XML. dmn-js's Modeler switches between DRD,
 * decision-table, and literal-expression *sub-editors* depending on
 * what the user drills into — we listen to the `view.contentChanged`
 * event on the active view, plus the manager-level `views.changed`, so
 * we always catch mutations no matter which sub-editor produced them.
 *
 * Empty files boot with a minimal decision definition so the palette
 * is visible immediately.
 *
 * Improvements over the original stub:
 *  - Background uses the app theme (`var(--bg-primary)`) instead of
 *    hardcoded `#ffffff`.
 *  - `importXML` failure surfaces an inline error banner instead of
 *    silently replacing the user's content with the empty diagram.
 *  - Removed `keyboard: { bindTo: window }` — that bound dmn-js's
 *    global keymap to `window`, which hijacked Cmd+S / Cmd+F / etc.
 *    from the main app. dmn-js's keyboard module is opt-in; without
 *    `bindTo`, it only listens when its own container is focused.
 *  - `saveXML` calls are debounced (300ms) so rapid edits in the
 *    decision table don't queue one serialise per keystroke.
 *  - The `attachedViewers` Set is reset on `views.changed` so we
 *    don't accumulate references to dead sub-viewers.
 *  - Listeners are explicitly removed on cleanup, not just `destroy()`.
 */

import { useCallback, useEffect, useRef, useState } from 'react'
import DmnModeler from 'dmn-js/lib/Modeler'
import 'dmn-js/dist/assets/diagram-js.css'
import 'dmn-js/dist/assets/dmn-font/css/dmn.css'
import 'dmn-js/dist/assets/dmn-js-shared.css'
import 'dmn-js/dist/assets/dmn-js-drd.css'
import 'dmn-js/dist/assets/dmn-js-decision-table.css'
import 'dmn-js/dist/assets/dmn-js-decision-table-controls.css'
import 'dmn-js/dist/assets/dmn-js-literal-expression.css'
import 'dmn-js/dist/assets/dmn-js-boxed-expression.css'
import 'dmn-js/dist/assets/dmn-js-boxed-expression-controls.css'

export interface DmnEditorProps {
  value: string
  onChange: (data: string) => void
  className?: string
}

const EMPTY_DMN_XML = `<?xml version="1.0" encoding="UTF-8"?>
<definitions xmlns="https://www.omg.org/spec/DMN/20191111/MODEL/"
             xmlns:dmndi="https://www.omg.org/spec/DMN/20191111/DMNDI/"
             xmlns:dc="http://www.omg.org/spec/DMN/20180521/DC/"
             id="Definitions_1"
             name="New DMN Diagram"
             namespace="http://camunda.org/schema/1.0/dmn">
  <decision id="Decision_1" name="Decision 1">
    <decisionTable id="DecisionTable_1">
      <input id="Input_1">
        <inputExpression id="InputExpression_1" typeRef="string">
          <text></text>
        </inputExpression>
      </input>
      <output id="Output_1" typeRef="string"/>
    </decisionTable>
  </decision>
  <dmndi:DMNDI>
    <dmndi:DMNDiagram id="DMNDiagram_1">
      <dmndi:DMNShape id="DMNShape_1" dmnElementRef="Decision_1">
        <dc:Bounds height="80" width="180" x="160" y="100"/>
      </dmndi:DMNShape>
    </dmndi:DMNDiagram>
  </dmndi:DMNDI>
</definitions>`

// Minimal shape for the parts of the Modeler API we touch. dmn-js
// doesn't ship TS types, so we type only what we need.
interface DmnViewer {
  get: <T>(name: string) => T
}
interface DmnManager {
  importXML: (xml: string) => Promise<{ warnings: unknown[] }>
  saveXML: (opts?: { format?: boolean }) => Promise<{ xml: string }>
  destroy: () => void
  on: (event: string, cb: (payload: unknown) => void) => void
  off: (event: string, cb: (payload: unknown) => void) => void
  getActiveViewer: () => DmnViewer | undefined
}

export function DmnEditor({
  value,
  onChange,
  className
}: DmnEditorProps): JSX.Element {
  const containerRef = useRef<HTMLDivElement>(null)
  const modelerRef = useRef<DmnManager | null>(null)
  const onChangeRef = useRef(onChange)
  onChangeRef.current = onChange
  const lastSerialisedRef = useRef<string>('')
  const saveDebounceRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  const [loadError, setLoadError] = useState<string | null>(null)

  useEffect(() => {
    const container = containerRef.current
    if (!container) return

    // NOTE: no `keyboard: { bindTo: window }` — binding to window let
    // dmn-js hijack Cmd+S/F/etc. from the main app. dmn-js's keyboard
    // module still works when its container has focus.
    const modeler = new DmnModeler({ container }) as unknown as DmnManager
    modelerRef.current = modeler

    const initialXml = value?.trim() ? value : EMPTY_DMN_XML

    modeler
      .importXML(initialXml)
      .then(() => {
        lastSerialisedRef.current = initialXml
        setLoadError(null)
      })
      .catch((err) => {
        const msg = err instanceof Error ? err.message : String(err)
        console.warn('[DMN] importXML failed:', msg)
        setLoadError(`无法解析 DMN XML：${msg}`)
        return modeler
          .importXML(EMPTY_DMN_XML)
          .then(() => {
            lastSerialisedRef.current = EMPTY_DMN_XML
          })
          .catch(() => {
            // even the empty diagram failed — nothing more we can do
          })
      })

    // Debounced persist so rapid decision-table edits don't queue one
    // saveXML per keystroke.
    const scheduleSave = (): void => {
      if (saveDebounceRef.current) clearTimeout(saveDebounceRef.current)
      saveDebounceRef.current = setTimeout(() => {
        void (async (): Promise<void> => {
          try {
            const { xml } = await modeler.saveXML({ format: true })
            if (xml === lastSerialisedRef.current) return
            lastSerialisedRef.current = xml
            onChangeRef.current(xml)
          } catch (err) {
            console.warn('[DMN] saveXML failed:', err)
          }
        })()
      }, 300)
    }

    // Attach a per-sub-view listener. dmn-js may swap the active view
    // (DRD ↔ decision-table ↔ literal-expression); each swap needs a
    // fresh listener since the previous view's eventBus is gone.
    //
    // We track attached viewers AND their listeners so we can remove
    // them explicitly on cleanup (destroy() alone is unreliable).
    const attachedViewers = new Map<DmnViewer, () => void>()
    const attachToActiveViewer = (): void => {
      const active = modeler.getActiveViewer()
      if (!active) return
      if (attachedViewers.has(active)) return
      const eventBus = active.get<{
        on: (event: string, cb: () => void) => void
        off: (event: string, cb: () => void) => void
      }>('eventBus')
      const handler = (): void => scheduleSave()
      eventBus.on('commandStack.changed', handler)
      const detach = (): void => {
        try {
          eventBus.off('commandStack.changed', handler)
        } catch {
          // viewer already torn down
        }
      }
      attachedViewers.set(active, detach)
    }

    const onImportDone = (): void => attachToActiveViewer()
    const onViewsChanged = (): void => attachToActiveViewer()
    modeler.on('import.done', onImportDone)
    modeler.on('views.changed', onViewsChanged)

    return () => {
      if (saveDebounceRef.current) clearTimeout(saveDebounceRef.current)
      try {
        modeler.off('import.done', onImportDone)
        modeler.off('views.changed', onViewsChanged)
      } catch {
        // best-effort
      }
      // Explicitly remove per-view listeners before destroying.
      for (const detach of attachedViewers.values()) detach()
      attachedViewers.clear()
      try {
        modeler.destroy()
      } catch {
        // best-effort cleanup
      }
      modelerRef.current = null
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const handleDismissError = useCallback(() => setLoadError(null), [])

  return (
    <div
      className={`dmn-editor-wrapper ${className || ''}`}
      style={{
        width: '100%',
        height: '100%',
        minHeight: 400,
        background: 'var(--bg-primary)',
        position: 'relative'
      }}
    >
      {loadError && (
        <div
          style={{
            position: 'absolute',
            top: 8,
            left: 8,
            right: 8,
            zIndex: 10,
            padding: '8px 12px',
            borderRadius: 6,
            background: 'var(--bg-secondary)',
            border: '1px solid #ef4444',
            color: 'var(--text-primary)',
            fontSize: 12,
            display: 'flex',
            alignItems: 'flex-start',
            gap: 8,
            boxShadow: 'var(--shadow-md)'
          }}
        >
          <span style={{ flex: 1, wordBreak: 'break-word' }}>{loadError}</span>
          <button
            onClick={handleDismissError}
            style={{
              border: 'none',
              background: 'transparent',
              color: 'var(--text-tertiary)',
              cursor: 'pointer',
              fontSize: 14,
              lineHeight: 1,
              padding: 0
            }}
            title="关闭"
          >
            ×
          </button>
        </div>
      )}
      <div ref={containerRef} style={{ width: '100%', height: '100%' }} />
    </div>
  )
}

export default DmnEditor
