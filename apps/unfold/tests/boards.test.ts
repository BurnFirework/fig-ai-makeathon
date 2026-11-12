import { test } from 'node:test'
import assert from 'node:assert/strict'
import { BOARD_CATALOG_KEY, BoardCatalogSchema, createBoard, initialBoardCatalog, readBoardCatalog, renameBoard } from '../client/boards'

const cases: Promise<void>[] = []
cases.push(test('first launch preserves the existing canvas persistence key', () => {
  assert.deepEqual(readBoardCatalog({ getItem: () => null }), initialBoardCatalog())
  assert.equal(initialBoardCatalog().activeId, 'unfold-board-v1')
}))

cases.push(test('creating boards gives each canvas independent persistence and preserves previous boards', () => {
  const original = initialBoardCatalog()
  const next = createBoard(original, '  Summer plans  ')
  const third = createBoard(next, 'Summer plans')
  assert.equal(next.boards[1]?.name, 'Summer plans')
  assert.equal(new Set(third.boards.map(board => board.id)).size, 3)
  assert.equal(third.activeId, third.boards[2]?.id)
  assert.deepEqual(third.boards.slice(0, 1), original.boards)
  assert.equal(original.boards.length, 1)
  const saved = new Map([[BOARD_CATALOG_KEY, JSON.stringify(third)]])
  assert.deepEqual(readBoardCatalog({ getItem: key => saved.get(key) ?? null }), third)
}))

cases.push(test('rename affects only the active board and keeps its persistence key', () => {
  const catalog = createBoard(initialBoardCatalog(), 'Travel')
  const renamed = renameBoard(catalog, '  A new chapter  ')
  assert.equal(renamed.activeId, catalog.activeId)
  assert.deepEqual(renamed.boards[0], catalog.boards[0])
  assert.deepEqual(renamed.boards[1], { id: catalog.activeId, name: 'A new chapter' })
  assert.throws(() => createBoard(catalog, '  '))
  assert.throws(() => renameBoard(catalog, 'x'.repeat(81)))
}))

cases.push(test('invalid stored catalogs cannot silently replace the board list', () => {
  assert.throws(() => readBoardCatalog({ getItem: () => '{invalid' }))
  assert.equal(BoardCatalogSchema.safeParse({ boards: [], activeId: 'missing' }).success, false)
  assert.equal(BoardCatalogSchema.safeParse({ ...initialBoardCatalog(), activeId: 'missing' }).success, false)
  const catalog = initialBoardCatalog()
  assert.equal(BoardCatalogSchema.safeParse({ ...catalog, boards: [...catalog.boards, ...catalog.boards] }).success, false)
}))

await Promise.all(cases)
