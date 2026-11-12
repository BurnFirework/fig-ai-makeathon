import assert from 'node:assert/strict'
import test from 'node:test'
import { validateBoardEdits } from '../shared/board-edits'

await test('a generated composition reuses existing images and rejects a batch with a stale or unknown reference', () => {
  const cards = [{ id: 'room', image: true }, { id: 'palette', image: true }]
  const edit = { kind: 'createNode', content: { kind: 'moodboard', title: 'Quiet room', description: 'Wood and stone', items: [{ nodeId: 'palette', caption: 'Warm grain' }] }, links: [{ nodeId: 'room', relationship: 'develops' }, { nodeId: 'palette', relationship: 'reference' }] }
  const board = { cards, conversationIds: ['chat'], revisions: new Map([['room', 0], ['palette', 1]]) }
  assert.deepEqual(validateBoardEdits([edit], board), [edit])
  assert.throws(() => validateBoardEdits([edit], board, [{ id: 'palette', revision: 0 }]), /changed/)
  assert.throws(() => validateBoardEdits([edit, { kind: 'connectNodes', from: 'room', to: 'missing', relationship: 'reference' }], board), /unavailable/)
  assert.throws(() => validateBoardEdits([edit, { kind: 'attachNodeToConversation', conversationId: 'other', nodeId: 'room' }], board), /conversation/i)
})
