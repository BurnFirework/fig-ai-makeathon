import { z } from 'zod'

export const BOARD_CATALOG_KEY = 'unfold-boards-v1'
export const BoardNameSchema = z.string().trim().min(1, 'Give your board a name.').max(80)
const BoardSchema = z.object({ id: z.string().min(1), name: BoardNameSchema })
export const BoardCatalogSchema = z.object({
  boards: z.array(BoardSchema).min(1),
  activeId: z.string(),
}).refine(catalog => catalog.boards.some(board => board.id === catalog.activeId), 'Active board is missing')
  .refine(catalog => new Set(catalog.boards.map(board => board.id)).size === catalog.boards.length, 'Duplicate board IDs')
export type BoardCatalog = z.infer<typeof BoardCatalogSchema>

// Keep the original persistence key so existing canvases and image assets stay intact.
export function initialBoardCatalog(): BoardCatalog {
  return { boards: [{ id: 'unfold-board-v1', name: 'Your next chapter' }], activeId: 'unfold-board-v1' }
}

export function readBoardCatalog(storage: Pick<Storage, 'getItem'>): BoardCatalog {
  const saved = storage.getItem(BOARD_CATALOG_KEY)
  return saved === null ? initialBoardCatalog() : BoardCatalogSchema.parse(JSON.parse(saved))
}

export function createBoard(catalog: BoardCatalog, name: string): BoardCatalog {
  const board = { id: `unfold-board-${crypto.randomUUID()}`, name: BoardNameSchema.parse(name) }
  return { boards: [...catalog.boards, board], activeId: board.id }
}

export function renameBoard(catalog: BoardCatalog, name: string): BoardCatalog {
  const parsed = BoardNameSchema.parse(name)
  return { ...catalog, boards: catalog.boards.map(board => board.id === catalog.activeId ? { ...board, name: parsed } : board) }
}
