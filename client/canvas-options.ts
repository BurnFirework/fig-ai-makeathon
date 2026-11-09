import { NodeShapeUtil } from './nodes/NodeShapeUtil'
import { ConnectionShapeUtil } from './connection/ConnectionShapeUtil'
import { ConnectionBindingUtil } from './connection/ConnectionBindingUtil'
import { tldrawLicenseKey } from './tldraw-license'
export const canvasOptions = { licenseKey: tldrawLicenseKey, shapeUtils: [NodeShapeUtil, ConnectionShapeUtil], bindingUtils: [ConnectionBindingUtil] }
