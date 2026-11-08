import { Editor, T, WeakCache } from 'tldraw'
import { isUnfoldNode, type UnfoldNode } from '../../shared/schema'
import type { ShapePort } from '../ports/Port'
import type { NodeShape } from './NodeShapeUtil'
import { UnfoldNodeDefinition } from './types/UnfoldNodes'

export type NodeType = UnfoldNode
export const NodeType = new T.Validator<UnfoldNode>(value => {
  if (!isUnfoldNode(value)) throw new Error('Invalid Unfold node')
  return value
})
const definitions = new WeakCache<Editor, UnfoldNodeDefinition>()
export function getNodeDefinition(editor: Editor, _node: NodeType | NodeType['type']) {
  return definitions.get(editor, () => new UnfoldNodeDefinition(editor))
}
export function getNodeHeightPx(editor: Editor, shape: NodeShape) { return getNodeDefinition(editor, shape.props.node).getBodyHeightPx(shape, shape.props.node) }
export function getNodeWidthPx(editor: Editor, shape: NodeShape) { return getNodeDefinition(editor, shape.props.node).getBodyWidthPx(shape, shape.props.node) }
export type NodeTypePorts = Record<string, ShapePort>
export function getNodeTypePorts(editor: Editor, shape: NodeShape): NodeTypePorts { return getNodeDefinition(editor, shape.props.node).getPorts(shape, shape.props.node) }
export function onNodePortConnect(_editor: Editor, _shape: NodeShape, _port: string) {}
export function onNodePortDisconnect(_editor: Editor, _shape: NodeShape, _port: string) {}
