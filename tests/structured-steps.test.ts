import { test } from 'node:test'
import assert from 'node:assert/strict'
import { ActionDraftSchema, actionProposal } from '../shared/coordinator'
import { NodeSchema, ProposalSchema } from '../shared/schema'

const source = { id: 'source-1', title: 'Guide', url: 'https://example.org/guide' }
const cases: Promise<void>[] = []

cases.push(test('a drafted step keeps at most four short steps and only the facts that are known', () => {
  const draft = ActionDraftSchema.parse({ title: 'Tidy one spot', summary: '  Clip your   cables to the desk.  ', steps: ['One', '', 'Two', 'Three', 'Four', 'Five'], meta: { time: '15 min', cost: '', place: 'At home' }, sources: [] })
  const proposal = actionProposal(draft, [source])
  assert.equal(proposal.summary, 'Clip your cables to the desk.')
  assert.deepEqual(proposal.steps, ['One', 'Two', 'Three', 'Four'])
  assert.deepEqual(proposal.meta, { time: '15 min', place: 'At home' })
  assert.equal(proposal.description, '')
  assert.ok(ProposalSchema.safeParse(proposal).success)
}))

cases.push(test('a step without structure stays a plain description', () => {
  const proposal = actionProposal(ActionDraftSchema.parse({ title: 'Visit', description: 'Go once.', sources: [] }), [source])
  assert.equal(proposal.description, 'Go once.')
  assert.ok(!('summary' in proposal) && !('steps' in proposal) && !('meta' in proposal))
}))

cases.push(test('malformed optional fields are dropped instead of failing the reply', () => {
  const draft = ActionDraftSchema.parse({ title: 'Try it', steps: 'not a list', meta: 'soon', summary: 42, sources: [] })
  assert.equal(draft.steps, undefined); assert.equal(draft.meta, undefined); assert.equal(draft.summary, undefined)
}))

cases.push(test('older next-step cards without summary, steps or checked steps still load', () => {
  const base = { branchId: 'b', sequence: 1, revision: 0, stale: false, dependsOn: [], agent: 'research', createdAt: 1 }
  assert.ok(NodeSchema.safeParse({ ...base, type: 'action', title: 'Old', description: 'Long text', sources: [source], completed: false, reflection: '' }).success)
  assert.ok(NodeSchema.safeParse({ ...base, type: 'action', title: 'New', description: '', summary: 'Why', steps: ['A', 'B'], meta: { time: '5 min' }, doneSteps: [1], sources: [source], completed: false, reflection: '' }).success)
}))
await Promise.all(cases)
