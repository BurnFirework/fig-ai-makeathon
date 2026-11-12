import { createShapeId, StateNode, type TLPointerEventInfo, type TLShapeId } from 'tldraw'
import { createOrUpdateConnectionBinding } from '../connection/ConnectionBindingUtil.tsx'
import { getNextConnectionIndex } from '../connection/keepConnectionsAtBottom.tsx'
import { getNodePortConnections } from '../nodes/nodePorts.tsx'
import type { PortId } from './Port.tsx'

interface PointingPortInfo {
  shapeId: TLShapeId
  portId: PortId
  terminal: 'start' | 'end'
}

export class PointingPort extends StateNode {
  static override id = 'pointing_port'
  info?: PointingPortInfo

  override onEnter(info: PointingPortInfo): void {
    this.info = info
  }

  override onPointerMove(event: TLPointerEventInfo): void {
    if (!this.editor.inputs.getIsDragging() || !this.info) return
    const { shapeId, portId, terminal } = this.info
    const existing = getNodePortConnections(this.editor, shapeId).find(connection => connection.ownPortId === portId)
    if (terminal !== 'start' && existing) {
      const shape = this.editor.getShape(existing.connectionId)
      const handle = this.editor.getShapeHandles(existing.connectionId)?.find(handle => handle.id === terminal)
      if (!shape || !handle) { this.parent.transition('idle', event); return }
      this.parent.transition('dragging_handle', { ...event, target: 'handle', shape, handle })
      return
    }

    const creatingMarkId = this.editor.markHistoryStoppingPoint()
    const connectionId = createShapeId()
    const point = this.editor.inputs.getCurrentPagePoint()
    this.editor.createShape({
      type: 'connection', id: connectionId, x: point.x, y: point.y,
      index: getNextConnectionIndex(this.editor), props: { start: { x: 0, y: 0 }, end: { x: 0, y: 0 } },
    })
    createOrUpdateConnectionBinding(this.editor, connectionId, shapeId, { portId, terminal })
    const draggingTerminal = terminal === 'start' ? 'end' : 'start'
    const shape = this.editor.getShape(connectionId)
    const handle = this.editor.getShapeHandles(connectionId)?.find(handle => handle.id === draggingTerminal)
    if (!shape || !handle) { this.editor.bailToMark(creatingMarkId); this.parent.transition('idle', event); return }
    this.parent.transition('dragging_handle', { ...event, target: 'handle', shape, handle, creatingMarkId, isCreating: true })
  }

  override onPointerUp(event: TLPointerEventInfo): void {
    this.parent.transition('idle', event)
  }
}
