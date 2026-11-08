import { NodeShapeUtil } from './nodes/NodeShapeUtil'
import { ConnectionShapeUtil } from './connection/ConnectionShapeUtil'
import { ConnectionBindingUtil } from './connection/ConnectionBindingUtil'
export const canvasOptions = { shapeUtils: [NodeShapeUtil, ConnectionShapeUtil], bindingUtils: [ConnectionBindingUtil] }
