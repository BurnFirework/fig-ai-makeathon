import { test } from 'node:test'
import assert from 'node:assert/strict'
import { canPublish, chatContext, foldLegacyMessages, lineage } from '../shared/chats'
import { type NodeRecord } from '../shared/context'
import { ChatSchema, NodeSchema, type Chat, type ChatMessage, type UnfoldNode } from '../shared/schema'

const base = { branchId: 'a', sequence: 0, revision: 0, stale: false, dependsOn: [], agent: 'you', createdAt: 0 }
const root = (id: string, chats: Chat[] = []): NodeRecord => ({ id, node: NodeSchema.parse({ ...base, type: 'inspiration', branchId: id, goal: id === 'a' ? 'Make pottery' : 'Meet people', assetId: 'asset:test', started: true, chats }) })
const question: ChatMessage = { id: 'q', role: 'assistant', proposal: { kind: 'question', prompt: 'What is your budget?', purpose: 'Plan a small step', options: ['Under $50', 'Flexible'] }, dependsOn: [{ id: 'a', revision: 0 }] }
const chat = (id: string, answer: string, branchId = 'a'): Chat => ({ id, title: id, sourceIds: [branchId], branchIds: [branchId], operation: 'branch', messages: [question, { id: `${id}-answer`, role: 'user', text: answer, replyTo: 'q' }], createdAt: 0 })
const action = (id: string, origin: UnfoldNode['origin']): NodeRecord => ({ id, node: NodeSchema.parse({ ...base, type: 'action', title: 'Try a class', description: 'Make a small pot', sources: [], completed: false, reflection: '', origin }) })

await test('chat context isolates sibling explorations and retains question/answer pairing', () => {
  const current = chat('budget', 'Under $50, in Oakland')
  const sibling = chat('other', 'A week in Tokyo')
  const siblingOutcome = action('sibling-result', { nodeId: 'a', chatId: sibling.id, messageId: 'other-answer' })
  if (siblingOutcome.node.type === 'action') siblingOutcome.node.reflection = 'Private sibling reflection'
  const context = chatContext([root('a', [current, sibling]), root('b'), siblingOutcome], 'a', current, 'a')
  assert.deepEqual(context.answers, [{ question: 'What is your budget?', answer: 'Under $50, in Oakland' }])
  assert.ok(!JSON.stringify(context).includes('Tokyo'))
  assert.ok(!JSON.stringify(context).includes('Private sibling reflection'))
  assert.ok(!context.previousSuggestions.includes('Try a class'))
  assert.ok(!JSON.stringify(context).includes('Meet people'))
})

await test('derived outcomes inherit their originating chat, not newer sibling chats', () => {
  const original = chat('original', 'Under $50')
  original.messages.push({ id: 'later', role: 'user', text: 'A later unrelated thought' })
  const newer = chat('newer', '$5000')
  const outcome = action('outcome', { nodeId: 'a', chatId: original.id, messageId: 'original-answer' })
  const followup = { ...chat('followup', 'Saturday mornings'), sourceIds: ['outcome'] }
  const context = chatContext([root('a', [original, newer]), outcome], 'outcome', followup, 'a')
  assert.deepEqual(context.answers.map(answer => answer.answer), ['Under $50', 'Saturday mornings'])
})

await test('shared outcomes preserve each branch context without mixing their answers', () => {
  const first = chat('pottery', 'Under $50')
  const second = chat('social', 'A small group', 'b')
  const shared: Chat = { id: 'shared-chat', title: 'Connect', sourceIds: ['a', 'b'], branchIds: ['a', 'b'], operation: 'connect', contextChats: [{ nodeId: 'a', chatId: first.id }, { nodeId: 'b', chatId: second.id }], messages: [{ id: 'correction', role: 'user', text: 'Keep it local' }], createdAt: 0 }
  const sharedNode: NodeRecord = { id: 'shared', node: NodeSchema.parse({ ...base, type: 'opportunity', branchId: 'shared', title: 'Pottery with neighbors', description: '', benefitA: '', benefitB: '', status: 'accepted', refinement: '', sourceBranchIds: ['a', 'b'], origin: { nodeId: 'a', chatId: shared.id, messageId: 'correction' } }) }
  const followup: Chat = { ...shared, id: 'followup', operation: 'research', sourceIds: ['shared'], contextChats: [], messages: [] }
  const records = [root('a', [first, shared]), root('b', [second]), sharedNode]
  assert.deepEqual(chatContext(records, 'shared', followup, 'a').answers.map(answer => answer.answer), ['Under $50', 'Keep it local'])
  assert.deepEqual(chatContext(records, 'shared', followup, 'b').answers.map(answer => answer.answer), ['A small group', 'Keep it local'])
})

await test('breadcrumbs follow outcome provenance and terminate at cycles or removed ancestors', () => {
  const outcome = action('outcome', { nodeId: 'a', chatId: 'one', messageId: 'result' })
  assert.deepEqual(lineage([root('a'), outcome], 'outcome').map(record => record.id), ['a', 'outcome'])
  assert.deepEqual(lineage([outcome], 'outcome').map(record => record.id), ['outcome'])
  const cycle = { ...outcome, node: { ...outcome.node, origin: { nodeId: 'outcome', chatId: 'one', messageId: 'result' } } }
  assert.deepEqual(lineage([cycle], 'outcome').map(record => record.id), ['outcome'])
})

await test('only unpublished outcomes can be added to the canvas', () => {
  const outcome: ChatMessage = { id: 'result', role: 'assistant', proposal: { kind: 'action', title: 'Try it', description: '', sources: [] }, dependsOn: [] }
  assert.equal(canPublish(question), false)
  assert.equal(canPublish({ id: 'user', role: 'user', text: 'Hello' }), false)
  assert.equal(canPublish(outcome), true)
  assert.equal(canPublish({ ...outcome, outcomeId: 'shape:published' }), false)
})

await test('legacy migration preserves messages and outcomes, rewrites dependencies, and is idempotent', () => {
  const oldQuestion: NodeRecord = { id: 'question', node: NodeSchema.parse({ ...base, type: 'question', ...question.proposal, sequence: 1 }) }
  const oldAnswer: NodeRecord = { id: 'answer', node: NodeSchema.parse({ ...base, type: 'answer', text: 'Oakland, under $50', questionId: 'question', sequence: 2 }) }
  const outcome = action('outcome', undefined)
  outcome.node.dependsOn = [{ id: 'question', revision: 0 }, { id: 'answer', revision: 0 }]
  const records = [root('a'), oldQuestion, oldAnswer, outcome]
  const migration = foldLegacyMessages(records)
  assert.deepEqual(migration.removed, ['question', 'answer'])
  const migratedRoot = migration.updates.find(record => record.id === 'a')
  assert.equal(migratedRoot?.node.chats?.[0]?.messages.length, 3)
  const migratedOutcome = migration.updates.find(record => record.id === 'outcome')
  assert.deepEqual(migratedOutcome?.node.dependsOn, [{ id: 'a', revision: 0 }])
  assert.equal(migratedOutcome.node.origin?.nodeId, 'a')
  const migrated = records.filter(record => !migration.removed.includes(record.id)).map(record => migration.updates.find(update => update.id === record.id) ?? record)
  assert.deepEqual(foldLegacyMessages(migrated), { updates: [], removed: [] })
  const thread = migratedRoot.node.chats[0]
  assert.ok(thread)
  assert.deepEqual(chatContext(migrated, 'a', thread, 'a').answers, [{ question: 'What is your budget?', answer: 'Oakland, under $50' }])
  assert.ok(migrated.every(record => NodeSchema.safeParse(record.node).success))
})

await test('legacy orphan messages are left intact and saved chats round-trip through node validation', () => {
  const orphan: NodeRecord = { id: 'orphan', node: NodeSchema.parse({ ...base, type: 'answer', text: 'Keep me', questionId: 'missing' }) }
  assert.deepEqual(foldLegacyMessages([orphan]), { updates: [], removed: [] })
  const saved = root('a', [chat('saved', 'Local only')])
  assert.deepEqual(NodeSchema.parse(JSON.parse(JSON.stringify(saved.node))), saved.node)
  assert.equal(ChatSchema.safeParse({ ...chat('invalid', ''), sourceIds: [] }).success, false)
})
