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
 */

import { useEffect, useRef } from 'react'
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

  useEffect(() => {
    const container = containerRef.current
    if (!container) return

    const modeler = new DmnModeler({
      container,
      keyboard: { bindTo: window }
    }) as unknown as DmnManager
    modelerRef.current = modeler

    const initialXml = value?.trim() ? value : EMPTY_DMN_XML

    modeler
      .importXML(initialXml)
      .then(() => {
        lastSerialisedRef.current = initialXml
      })
      .catch((err) => {
        console.warn('[DMN] importXML failed, falling back to empty diagram:', err)
        return modeler.importXML(EMPTY_DMN_XML)
      })

    const persist = async (): Promise<void> => {
      try {
        const { xml } = await modeler.saveXML({ format: true })
        if (xml === lastSerialisedRef.current) return
        lastSerialisedRef.current = xml
        onChangeRef.current(xml)
      } catch (err) {
        console.warn('[DMN] saveXML failed:', err)
      }
    }

    // Attach a per-sub-view listener. dmn-js may swap the active view
    // (DRD ↔ decision-table ↔ literal-expression); each swap needs a
    // fresh listener since the previous view's eventBus is gone.
    const attachedViewers = new Set<DmnViewer>()
    const attachToActiveViewer = (): void => {
      const active = modeler.getActiveViewer()
      if (!active || attachedViewers.has(active)) return
      attachedViewers.add(active)
      const eventBus = active.get<{
        on: (event: string, cb: () => void) => void
      }>('eventBus')
      eventBus.on('commandStack.changed', () => {
        void persist()
      })
    }

    // First attachment happens after the initial import resolves; the
    // views.changed event covers subsequent swaps.
    modeler.on('import.done', () => attachToActiveViewer())
    modeler.on('views.changed', () => attachToActiveViewer())

    return () => {
      try {
        modeler.destroy()
      } catch {
        // best-effort cleanup
      }
      modelerRef.current = null
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  return (
    <div
      className={`dmn-editor-wrapper ${className || ''}`}
      style={{
        width: '100%',
        height: '100%',
        minHeight: 400,
        background: '#ffffff'
      }}
    >
      <div ref={containerRef} style={{ width: '100%', height: '100%' }} />
    </div>
  )
}

export default DmnEditor
