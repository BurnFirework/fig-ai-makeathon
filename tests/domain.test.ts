import { test } from 'node:test'
import assert from 'node:assert/strict'
import { branchContext, invalidatedBy } from '../shared/context'
import { type UnfoldNode, revisionsMatch, RequestSchema } from '../shared/schema'
import { readCliEvent } from '../server/cli'
import { requestAgent } from '../client/agentClient'

const common = { branchId: 'a', sequence: 0, revision: 0, stale: false, dependsOn: [], agent: 'you' as const, createdAt: 0 }
const root: UnfoldNode = { ...common, type: 'inspiration', assetId: 'asset:a', goal: 'Learn pottery', started: true }
const question: UnfoldNode = { ...common, type: 'question', prompt: 'What is your budget?', options: ['Under $50', 'Flexible'], purpose: '', agent: 'branch', dependsOn: [{ id: 'a', revision: 0 }] }
const answer: UnfoldNode = { ...common, type: 'answer', text: 'Under $50, in Oakland', questionId: 'q', sequence: 2 }
const records = [{ id: 'a', node: root }, { id: 'q', node: question }, { id: 'answer', node: answer }, { id: 'b', node: { ...root, branchId: 'b', goal: 'Meet people' } }]

const cases: Promise<void>[] = []
cases.push(test('branch context isolates confirmed answers and orders by sequence', () => {
  const context = branchContext(records, 'a')
  assert.deepEqual(context.answers, [{ question: 'What is your budget?', answer: 'Under $50, in Oakland' }])
  assert.equal(context.goal, 'Learn pottery')
  assert.ok(!JSON.stringify(context).includes('Meet people'))
  assert.deepEqual(context.assumptions, [])
}))

cases.push(test('editing either source invalidates shared and downstream suggestions, preserving user answers', () => {
  const opportunity: UnfoldNode = { ...common, branchId: 'shared', type: 'opportunity', title: 'A workshop', description: '', benefitA: '', benefitB: '', status: 'accepted', refinement: '', sourceBranchIds: ['a', 'b'], agent: 'connection', dependsOn: [{ id: 'a', revision: 0 }, { id: 'b', revision: 0 }] }
  const action: UnfoldNode = { ...common, branchId: 'shared', type: 'action', title: 'Check availability', description: '', sources: [], completed: false, reflection: '', agent: 'branch', dependsOn: [{ id: 'shared', revision: 0 }] }
  const all = [...records, { id: 'shared', node: opportunity }, { id: 'step', node: action }]
  assert.deepEqual([...invalidatedBy(all, 'b')].sort(), ['shared', 'step'])
  assert.ok(!invalidatedBy(all, 'a').has('answer'))
}))

cases.push(test('late responses are invalid after a revision change or source deletion', () => {
  assert.equal(revisionsMatch([{ id: 'a', revision: 0 }], new Map([['a', 0]])), true)
  assert.equal(revisionsMatch([{ id: 'a', revision: 0 }], new Map([['a', 1]])), false)
  assert.equal(revisionsMatch([{ id: 'a', revision: 0 }], new Map()), false)
}))

cases.push(test('CLI parser separates real tool evidence from assistant-invented URLs', () => {
  const invented = readCliEvent(JSON.stringify({ type: 'item.completed', item: { type: 'agent_message', text: '{"url":"https://invented.example"}' } }), 'codex')
  assert.deepEqual(invented.urls, [])
  const evidence = readCliEvent(JSON.stringify({ type: 'item.completed', item: { type: 'web_search', action: { type: 'open_page', url: 'https://official.example/class' } } }), 'codex')
  assert.equal(evidence.searched, true)
  assert.deepEqual(evidence.urls, ['https://official.example/class'])
  assert.equal(readCliEvent(JSON.stringify({ type: 'assistant', message: { content: [{ type: 'tool_use', name: 'WebSearch' }] } }), 'claude').searched, true)
}))

cases.push(test('fragmented NDJSON produces exactly one validated result', async () => {
  const original = globalThis.fetch
  const result = { requestId: 'one', mode: 'demo', activity: [], proposal: { kind: 'question', prompt: 'Try it?', options: ['Yes', 'No'], purpose: '' } }
  const content = JSON.stringify({ type: 'activity', role: 'branch', message: 'Working' }) + '\n' + JSON.stringify({ type: 'result', result }) + '\n'
  const encoder = new TextEncoder()
  globalThis.fetch = () => Promise.resolve(new Response(new ReadableStream({ start(controller) { for (let i = 0; i < content.length; i += 7) controller.enqueue(encoder.encode(content.slice(i, i + 7))); controller.close() } })))
  try {
    let count = 0
    const request = RequestSchema.parse({ requestId: 'one', operation: 'branch', branches: [branchContext(records, 'a')], note: '' })
    assert.deepEqual(await requestAgent(request, new AbortController().signal, () => count++), result)
    assert.equal(count, 1)
  } finally { globalThis.fetch = original }
}))

await Promise.all(cases)
