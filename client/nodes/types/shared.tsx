import type { ComponentType } from 'react'
import type { Editor, TLUiIconJsx } from 'tldraw'
import type { NodeShape } from '../NodeShapeUtil'
import type { NodeTypePorts } from '../nodeTypes'

export interface NodeComponentProps<Node extends { type: string }> {
  shape: NodeShape
  node: Node
}

export abstract class NodeDefinition<Node extends { type: string }> {
  constructor(public readonly editor: Editor) {}
  abstract readonly title: string
  abstract readonly heading?: string
  abstract readonly icon: TLUiIconJsx
  abstract getDefault(): Node
  abstract getBodyWidthPx(shape: NodeShape, node: Node): number
  abstract getBodyHeightPx(shape: NodeShape, node: Node): number
  abstract getPorts(shape: NodeShape, node: Node): NodeTypePorts
  abstract Component: ComponentType<NodeComponentProps<Node>>
}
