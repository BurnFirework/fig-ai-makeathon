import { test } from 'node:test'
import assert from 'node:assert/strict'
import { parseAgentRequest } from '../server/runtime'
import { demoProposal } from '../shared/preview'
const branch = { id: 'a', goal: 'Painting', revision: 0, answers: [], confirmed: [], assumptions: [], previousSuggestions: [] }
const cases: Promise<void>[] = []
cases.push(test('all transports reject ambiguous connections and unsupported images', () => {
  const request = { requestId: '1', operation: 'connect', branches: [branch], note: '' }
  assert.throws(() => parseAgentRequest(request), /two different/)
  assert.throws(() => parseAgentRequest({ ...request, branches: [branch, branch] }), /two different/)
  assert.throws(() => parseAgentRequest({ ...request, operation: 'branch', image: 'data:text/html;base64,AA==' }), /Unsupported/)
}))
cases.push(test('preview runs without a server or CLI module', () => {
  const request = parseAgentRequest({ requestId: 'p', operation: 'branch', branches: [branch], note: '' })
  if (request.operation === 'explore') throw new Error('Unexpected Explore request')
  assert.equal(demoProposal(request).kind, 'question')
  assert.equal(demoProposal({ ...request, operation: 'research' }).kind, 'action')
}))

await Promise.all(cases)
