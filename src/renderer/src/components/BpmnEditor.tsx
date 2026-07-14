/**
 * BpmnEditor — bpmn-js Modeler wrapped as a React component.
 *
 * File format: BPMN 2.0 XML. Empty files boot with a minimal
 * StartEvent process so users see the drag-and-drop palette straight
 * away instead of a blank canvas.
 *
 * Change detection listens to bpmn-js's `commandStack.changed` event —
 * fires on any user-driven mutation (add / move / delete / rename).
 * We serialise back to XML on each change; heavy documents (many
 * hundreds of shapes) may want to debounce here, but the vast majority
 * of BPMN diagrams have <100 shapes so this is fine.
 */

import { useCallback, useEffect, useRef } from 'react'
// bpmn-js is CJS; import the modeler bundle + its CSS. Vite pulls in
// both — the CSS handles the palette, canvas grid, and label editing.
import BpmnModeler from 'bpmn-js/lib/Modeler'
import 'bpmn-js/dist/assets/diagram-js.css'
import 'bpmn-js/dist/assets/bpmn-font/css/bpmn.css'
import 'bpmn-js/dist/assets/bpmn-js.css'

export interface BpmnEditorProps {
  value: string
  onChange: (data: string) => void
  className?: string
}

const EMPTY_DIAGRAM_XML = `<?xml version="1.0" encoding="UTF-8"?>
<bpmn:definitions xmlns:bpmn="http://www.omg.org/spec/BPMN/20100524/MODEL"
                  xmlns:bpmndi="http://www.omg.org/spec/BPMN/20100524/DI"
                  xmlns:dc="http://www.omg.org/spec/DD/20100524/DC"
                  id="Definitions_1"
                  targetNamespace="http://bpmn.io/schema/bpmn">
  <bpmn:process id="Process_1" isExecutable="false">
    <bpmn:startEvent id="StartEvent_1"/>
  </bpmn:process>
  <bpmndi:BPMNDiagram id="BPMNDiagram_1">
    <bpmndi:BPMNPlane id="BPMNPlane_1" bpmnElement="Process_1">
      <bpmndi:BPMNShape id="_BPMNShape_StartEvent_2" bpmnElement="StartEvent_1">
        <dc:Bounds x="180" y="80" width="36" height="36"/>
      </bpmndi:BPMNShape>
    </bpmndi:BPMNPlane>
  </bpmndi:BPMNDiagram>
</bpmn:definitions>`

export function BpmnEditor({
  value,
  onChange,
  className
}: BpmnEditorProps): JSX.Element {
  const containerRef = useRef<HTMLDivElement>(null)
  const modelerRef = useRef<BpmnModeler | null>(null)
  const onChangeRef = useRef(onChange)
  onChangeRef.current = onChange
  const lastSerialisedRef = useRef<string>('')
  // Guards internal saveXML → onChange loops when we're the ones who
  // just pushed content back to the store.
  const suppressChangeRef = useRef(false)

  // One-shot mount. Parent uses key={filePath}, so file switches
  // remount and re-import fresh XML — we don't need to imperatively
  // sync `value` after the first import.
  useEffect(() => {
    const container = containerRef.current
    if (!container) return

    const modeler = new BpmnModeler({ container })
    modelerRef.current = modeler

    const initialXml = value?.trim() ? value : EMPTY_DIAGRAM_XML
    modeler
      .importXML(initialXml)
      .then(() => {
        // Fit the diagram to the viewport once the first import lands.
        try {
          modeler.get<{ zoom: (fitOrLevel: 'fit-viewport' | number) => void }>('canvas').zoom('fit-viewport')
        } catch {
          // canvas isn't mounted yet in some edge cases — ignore.
        }
        lastSerialisedRef.current = initialXml
      })
      .catch((err: unknown) => {
        console.warn('[BPMN] importXML failed, falling back to empty diagram:', err)
        modeler.importXML(EMPTY_DIAGRAM_XML)
      })

    const eventBus = modeler.get<{
      on: (event: string, cb: () => void) => void
      off: (event: string, cb: () => void) => void
    }>('eventBus')

    const handleChanged = async (): Promise<void> => {
      if (suppressChangeRef.current) return
      try {
        const { xml } = await modeler.saveXML({ format: true })
        const serialised = xml ?? ''
        if (serialised === lastSerialisedRef.current) return
        lastSerialisedRef.current = serialised
        onChangeRef.current(serialised)
      } catch (err) {
        console.warn('[BPMN] saveXML failed:', err)
      }
    }
    eventBus.on('commandStack.changed', handleChanged)

    return () => {
      eventBus.off('commandStack.changed', handleChanged)
      try {
        modeler.destroy()
      } catch {
        // best-effort cleanup
      }
      modelerRef.current = null
    }
    // Intentionally only on mount — see comment above.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // Ensure the outer container fills its parent so bpmn-js's canvas
  // sizing works correctly. bpmn-js measures on mount and gets very
  // confused when the container has 0×0.
  const wrapperStyle = useCallback(
    () => ({
      width: '100%',
      height: '100%',
      minHeight: 400,
      background: '#ffffff'
    }),
    []
  )

  return (
    <div
      className={`bpmn-editor-wrapper ${className || ''}`}
      style={wrapperStyle()}
    >
      <div ref={containerRef} style={{ width: '100%', height: '100%' }} />
    </div>
  )
}

export default BpmnEditor
