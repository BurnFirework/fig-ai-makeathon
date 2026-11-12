import { strFromU8, strToU8, Unzip, UnzipInflate, zipSync } from 'fflate'
import { AssetRecordType, createTLSchema, defaultBindingSchemas, defaultShapeSchemas, vecModelValidator, type TLRecord, type TLStoreSnapshot } from '@tldraw/tlschema'
import { T } from '@tldraw/validate'
import { z } from 'zod'
import { BoardCatalogSchema } from '../client/boards'
import { isUnfoldNode, type UnfoldNode } from './schema'
import { conversationRecord } from './conversation-record'
import { RelationshipSchema } from './board-edits'

export const MAX_WORKSPACE_BYTES = 128 * 1024 * 1024
const MAX_ENTRIES = 4096
export const workspaceTLSchema = createTLSchema({
  records: { unfold_conversation: conversationRecord },
  shapes: { ...defaultShapeSchemas, node: { props: { node: new T.Validator<UnfoldNode>(value => { if (!isUnfoldNode(value)) throw new Error('Invalid Unfold node.'); return value }) } }, connection: { props: { start: vecModelValidator, end: vecModelValidator, relationship: T.optional(T.literalEnum(...RelationshipSchema.options)) } } },
  bindings: { ...defaultBindingSchemas, connection: { props: { portId: T.string, terminal: T.literalEnum('start', 'end') } } },
})
const SnapshotSchema = z.object({
  schema: z.object({ schemaVersion: z.literal(2), sequences: z.record(z.string(), z.number().int().nonnegative()) }),
  store: z.record(z.string(), z.unknown()),
}).transform(({ schema, store }): TLStoreSnapshot => {
  const migrations = workspaceTLSchema.getMigrationsSince(schema)
  if (!migrations.ok) throw new Error('This board requires an unsupported tldraw schema.')
  const validated: Record<TLRecord['id'], TLRecord> = {}
  for (const [id, value] of Object.entries(store)) {
    const header = z.object({ id: z.string(), typeName: z.string() }).parse(value)
    const definition = Object.values(workspaceTLSchema.types).find(type => type.typeName === header.typeName)
    if (!definition || definition.scope !== 'document') throw new Error('Unexpected board record.')
    const record = definition.validate(value)
    if (record.id !== id) throw new Error('A board record ID does not match its key.')
    validated[record.id] = record
  }
  return { schema, store: validated }
})
export const AppearanceSchema = z.object({
  palette: z.enum(['lavender', 'rose', 'sage']),
  pattern: z.enum(['dots', 'grid', 'lined', 'gingham', 'plain']),
  tone: z.enum(['cream', 'white', 'linen', 'tint']),
})
export const WorkspaceAssetSchema = z.object({ mime: z.enum(['image/png', 'image/jpeg', 'image/webp']), data: z.string().max(MAX_WORKSPACE_BYTES * 4 / 3 + 4) })
export const WorkspaceSchema = z.object({
  formatVersion: z.literal(1), id: z.string().min(1).max(200), revision: z.number().int().nonnegative(),
  catalog: BoardCatalogSchema,
  boards: z.record(z.string(), z.object({ document: SnapshotSchema })),
  assets: z.record(z.string(), WorkspaceAssetSchema), appearance: AppearanceSchema,
})
export type Workspace = z.infer<typeof WorkspaceSchema>
export type WorkspaceAsset = Workspace['assets'][string]

export function base64Bytes(value: string): Uint8Array {
  if (value.length % 4 !== 0 || /[^A-Za-z0-9+/=]/.test(value)) throw new Error('Invalid image encoding.')
  const bytes = Uint8Array.from(atob(value), character => character.charCodeAt(0))
  if (bytesBase64(bytes) !== value) throw new Error('Invalid image encoding.')
  return bytes
}
export function bytesBase64(bytes: Uint8Array): string {
  let result = ''
  for (let offset = 0; offset < bytes.length; offset += 32768) result += String.fromCharCode(...bytes.subarray(offset, offset + 32768))
  return btoa(result)
}
function imageSignature(bytes: Uint8Array, mime: WorkspaceAsset['mime']) {
  if (mime === 'image/png') return bytes[0] === 137 && strFromU8(bytes.subarray(1, 4)) === 'PNG'
  if (mime === 'image/jpeg') return bytes[0] === 255 && bytes[1] === 216 && bytes[2] === 255
  return strFromU8(bytes.subarray(0, 4)) === 'RIFF' && strFromU8(bytes.subarray(8, 12)) === 'WEBP'
}

export function parseWorkspace(value: unknown): Workspace {
  const workspace = WorkspaceSchema.parse(value)
  const ids = new Set(workspace.catalog.boards.map(board => board.id))
  if (ids.size > 1000 || Object.keys(workspace.boards).length !== ids.size) throw new Error('Board catalog and documents do not match.')
  let size = 0
  for (const asset of Object.values(workspace.assets)) {
    const bytes = base64Bytes(asset.data)
    size += bytes.length
    if (size > MAX_WORKSPACE_BYTES || !imageSignature(bytes, asset.mime)) throw new Error('Invalid or oversized image asset.')
  }
  for (const id of ids) {
    const board = workspace.boards[id]
    if (!board) throw new Error('A board is missing from the backup.')
    const records = Object.values(board.document.store)
    if (!records.some(record => record.typeName === 'document') || !records.some(record => record.typeName === 'page')) throw new Error('A board document or page is missing.')
    for (const record of records) {
      if (record.typeName === 'unfold_conversation' && board.document.store[record.pageId]?.typeName !== 'page') throw new Error('A conversation page is missing from the backup.')
      if (record.typeName === 'asset' && record.type === 'image' && !workspace.assets[record.id]) throw new Error('An image is missing from the backup.')
      if (record.typeName === 'shape' && !board.document.store[record.parentId]) throw new Error('A shape parent is missing from the backup.')
      if (record.typeName === 'binding' && (!board.document.store[record.fromId] || !board.document.store[record.toId])) throw new Error('A connection endpoint is missing from the backup.')
      if (record.typeName === 'shape' && record.type === 'image' && record.props.assetId && !workspace.assets[record.props.assetId]) throw new Error('An image is missing from the backup.')
      if (record.typeName === 'shape' && record.type === 'node' && record.props.node.type === 'inspiration') {
        const assetId = record.props.node.assetId
        if (assetId && (!workspace.assets[assetId] || !Object.values(board.document.store).some(asset => asset.typeName === 'asset' && asset.id === assetId && asset.type === 'image'))) throw new Error('An inspiration image is missing from the backup.')
      }
    }
  }
  return workspace
}

function checksum(bytes: Uint8Array): number {
  let value = 0xffffffff
  for (const byte of bytes) {
    value ^= byte
    for (let bit = 0; bit < 8; bit++) value = (value >>> 1) ^ (value & 1 ? 0xedb88320 : 0)
  }
  return (value ^ 0xffffffff) >>> 0
}
const ManifestSchema = z.object({
  formatVersion: z.literal(1), id: z.string(), revision: z.number(), catalog: BoardCatalogSchema, appearance: AppearanceSchema,
  entries: z.record(z.string(), z.object({ checksum: z.number().int().nonnegative(), size: z.number().int().nonnegative() })),
  assets: z.record(z.string(), z.object({ mime: WorkspaceAssetSchema.shape.mime, path: z.string() })),
  boards: z.record(z.string(), z.string()),
})

export function encodeWorkspace(value: Workspace): Uint8Array {
  const workspace = parseWorkspace(value)
  if (Object.keys(workspace.assets).length + Object.keys(workspace.boards).length + 1 > MAX_ENTRIES) throw new Error('Workspace has too many archive entries to save. Split it into smaller workspaces.')
  const files: Record<string, Uint8Array> = {}
  const assets: z.infer<typeof ManifestSchema>['assets'] = {}
  const boards: Record<string, string> = {}
  let index = 0
  for (const [id, asset] of Object.entries(workspace.assets)) {
    const path = `assets/${index++}`
    files[path] = base64Bytes(asset.data)
    assets[id] = { mime: asset.mime, path }
  }
  index = 0
  for (const [id, board] of Object.entries(workspace.boards)) {
    const document = structuredClone(board.document)
    for (const record of Object.values(document.store)) if (record.typeName === 'asset' && record.type === 'image') record.props.src = record.id
    const path = `boards/${index++}.json`
    files[path] = strToU8(JSON.stringify({ document }))
    boards[id] = path
  }
  const entries = Object.fromEntries(Object.entries(files).map(([path, bytes]) => [path, { checksum: checksum(bytes), size: bytes.length }]))
  files['manifest.json'] = strToU8(JSON.stringify({ formatVersion: 1, id: workspace.id, revision: workspace.revision, catalog: workspace.catalog, appearance: workspace.appearance, entries, assets, boards }))
  if (Object.values(files).reduce((sum, bytes) => sum + bytes.length, 0) > MAX_WORKSPACE_BYTES) throw new Error('Workspace is too large to export.')
  const archive = zipSync(files, { level: 0 })
  if (archive.length > MAX_WORKSPACE_BYTES) throw new Error('Workspace is too large to export.')
  return archive
}

export function decodeWorkspace(bytes: Uint8Array): Workspace {
  if (bytes.length > MAX_WORKSPACE_BYTES || bytes.length < 22) throw new Error('Invalid or oversized workspace file.')
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
  let end = bytes.length - 22
  while (end >= Math.max(0, bytes.length - 65557) && (view.getUint32(end, true) !== 0x06054b50 || end + 22 + view.getUint16(end + 20, true) !== bytes.length)) end--
  if (end < Math.max(0, bytes.length - 65557) || view.getUint16(end + 4, true) !== 0 || view.getUint16(end + 6, true) !== 0 || view.getUint32(end + 12, true) + view.getUint32(end + 16, true) !== end) throw new Error('Truncated or unsupported workspace archive.')
  const files: Record<string, Uint8Array> = {}
  const names = new Set<string>()
  let total = 0, count = 0
  const unzip = new Unzip(file => {
    if (++count > MAX_ENTRIES || names.has(file.name) || !/^(manifest\.json|boards\/[0-9]+\.json|assets\/[0-9]+)$/.test(file.name)) throw new Error('Unexpected or duplicate archive entry.')
    names.add(file.name)
    if (file.originalSize !== undefined && file.originalSize > MAX_WORKSPACE_BYTES) throw new Error('Archive entry is too large.')
    const chunks: Uint8Array[] = []
    let length = 0
    file.ondata = (error, chunk, final) => {
      if (error) throw error
      total += chunk.length; length += chunk.length
      if (total > MAX_WORKSPACE_BYTES) throw new Error('Expanded workspace is too large.')
      chunks.push(chunk)
      if (final) {
        const result = new Uint8Array(length)
        let offset = 0
        for (const part of chunks) { result.set(part, offset); offset += part.length }
        files[file.name] = result
      }
    }
    file.start()
  })
  unzip.register(UnzipInflate)
  for (let offset = 0; offset < bytes.length; offset += 65536) unzip.push(bytes.subarray(offset, offset + 65536), offset + 65536 >= bytes.length)
  if (count !== view.getUint16(end + 10, true)) throw new Error('Workspace archive directory does not match its contents.')
  const manifestBytes = files['manifest.json']
  if (!manifestBytes) throw new Error('Workspace manifest is missing.')
  const manifest = ManifestSchema.parse(JSON.parse(strFromU8(manifestBytes)))
  if (Object.keys(files).length !== Object.keys(manifest.entries).length + 1) throw new Error('Workspace archive entries do not match.')
  for (const [path, expected] of Object.entries(manifest.entries)) {
    const file = files[path]
    if (!file || file.length !== expected.size || checksum(file) !== expected.checksum) throw new Error('Workspace file is corrupt or incomplete.')
  }
  const assets = Object.fromEntries(Object.entries(manifest.assets).map(([id, asset]) => {
    const data = files[asset.path]
    if (!data || !asset.path.startsWith('assets/')) throw new Error('An archived image is missing.')
    return [id, { mime: asset.mime, data: bytesBase64(data) }]
  }))
  const boards = Object.fromEntries(Object.entries(manifest.boards).map(([id, path]) => {
    const data = files[path]
    if (!data || !path.startsWith('boards/')) throw new Error('An archived board is missing.')
    return [id, JSON.parse(strFromU8(data))]
  }))
  return parseWorkspace({ ...manifest, boards, assets })
}

export function mergeWorkspaces(current: Workspace, incoming: Workspace): Workspace {
  const base = structuredClone(parseWorkspace(current))
  const imported = structuredClone(parseWorkspace(incoming))
  const assetIds = new Map(Object.keys(imported.assets).map(id => [id, `asset:${crypto.randomUUID()}`]))
  for (const [oldId, asset] of Object.entries(imported.assets)) {
    const id = assetIds.get(oldId)
    if (id) base.assets[id] = asset
  }
  for (const board of imported.catalog.boards) {
    const saved = imported.boards[board.id]
    if (!saved) throw new Error('Imported board is missing.')
    const id = `unfold-board-${crypto.randomUUID()}`
    const store: Record<TLRecord['id'], TLRecord> = {}
    for (const record of Object.values(saved.document.store)) {
      if (record.typeName === 'asset' && record.type === 'image') {
        const newId = assetIds.get(record.id)
        if (!newId) throw new Error('Imported asset is missing.')
        const renamed = workspaceTLSchema.types.asset.validate({ ...record, id: newId, props: { ...record.props, src: newId } })
        store[renamed.id] = renamed
      } else {
        if (record.typeName === 'shape' && record.type === 'node' && record.props.node.type === 'inspiration') record.props.node.assetId = assetIds.get(record.props.node.assetId) ?? record.props.node.assetId
        if (record.typeName === 'shape' && (record.type === 'image' || record.type === 'video') && record.props.assetId) {
          const assetId = assetIds.get(record.props.assetId)
          if (assetId) record.props.assetId = AssetRecordType.createId(assetId.slice(6))
        }
        store[record.id] = record
      }
    }
    base.boards[id] = { document: { ...saved.document, store } }
    base.catalog.boards.push({ id, name: board.name })
  }
  base.revision++
  return parseWorkspace(base)
}
