import { NodeShapeUtil } from './nodes/NodeShapeUtil'
import { ConnectionShapeUtil } from './connection/ConnectionShapeUtil'
import { ConnectionBindingUtil } from './connection/ConnectionBindingUtil'
import { tldrawLicenseKey } from './tldraw-license'
import { getAssetUrlsByImport } from '@tldraw/assets/imports.vite'
export const canvasAssetUrls = getAssetUrlsByImport()
export const canvasOptions = { assetUrls: canvasAssetUrls, licenseKey: tldrawLicenseKey, shapeUtils: [NodeShapeUtil, ConnectionShapeUtil], bindingUtils: [ConnectionBindingUtil] }
