import { test } from 'node:test'
import assert from 'node:assert/strict'
import type { NodeRecord } from '../shared/context'
import { type AgentRuntime, type ConnectionInput, type Finding, LIMITS, collaborationStages, runCoordinator } from '../shared/coordinator'
import { branchSignature, lastScan, pairChat, pairIsSettled, pairSignature, pairsToScan } from '../shared/links'
import { applyDrafts, chatMemory, classifyMessage, interpretMessage, questionFor } from '../shared/memory'
import { demoRuntime } from '../shared/preview'
import { type AgentEvent, type AgentRequest, type BranchContext, type Chat, type ChatMessage, ChatSchema, NodeSchema, ResultSchema } from '../shared/schema'

const base = { sequence: 0, revision: 0, stale: false, dependsOn: [], agent: 'you', createdAt: 0 }
const root = (id: string, goal: string, chats: Chat[] = [], extra: Record<string, unknown> = {}): NodeRecord => ({ id, node: NodeSchema.parse({ ...base, branchId: id, type: 'inspiration', goal, assetId: 'asset:test', started: true, chats, ...extra }) })
const chat = (id: string, branchIds: string[], operation: Chat['operation'] = 'branch', messages: ChatMessage[] = []): Chat => ({ id, title: id, sourceIds: [...branchIds], branchIds, operation, messages, createdAt: 0 })
/** Mirrors the client's send(): classify, interpret and remember the user's message. */
function say(thread: Chat, id: string, text: string, at = 1): Chat {
  const message: ChatMessage = { id, role: 'user', text, stance: classifyMessage(text) }
  const messages = [...thread.messages, message]
  let index = 0
  return { ...thread, messages, memory: applyDrafts(chatMemory(thread), interpretMessage(text, message.stance ?? 'answer', questionFor(messages, message)), [id], 'you', at, () => `${id}:${index++}`) }
}
const branch = (goal: string, memory: BranchContext['memory'] = [], declined: BranchContext['declined'] = []): BranchContext => ({ id: goal, goal, revision: 0, answers: [], confirmed: memory.map(item => item.text), assumptions: [], previousSuggestions: [], memory, changes: [], declined })
const constraint = (key: 'budget' | 'time' | 'group' | 'place', text: string) => ({ id: `${key}:${text}`, kind: 'constraint' as const, key, text })
const request = (branches: BranchContext[], extra: Partial<AgentRequest> = {}): AgentRequest => ({ requestId: 'r', operation: 'connect', branches, note: '', trigger: 'auto', ...extra })
const run = (req: AgentRequest, runtime: AgentRuntime, limits = LIMITS) => {
  const events: AgentEvent[] = []
  return runCoordinator(req, runtime, new AbortController().signal, event => events.push(event), limits).then(result => ({ result, events, handoffs: result.handoffs }))
}
/** A runtime that records every task it receives, delegating to the preview agents unless overridden. */
function recorded(overrides: Partial<AgentRuntime> = {}) {
  const preview = demoRuntime(0)
  const log: { task: string; input: unknown }[] = []
  const briefs: string[] = []
  const checked: BranchContext[] = []
  const runtime: AgentRuntime = {
    mode: 'demo',
    lead: (input, signal) => { log.push({ task: 'lead', input }); return (overrides.lead ?? preview.lead)(input, signal) },
    research: (input, signal) => { log.push({ task: 'research', input }); briefs.push(input.brief); return (overrides.research ?? preview.research)(input, signal) },
    connection: (input, signal) => { log.push({ task: 'connection', input }); return (overrides.connection ?? preview.connection)(input, signal) },
    checkFit: (input, signal) => { log.push({ task: 'checkFit', input }); checked.push(input.branch); return (overrides.checkFit ?? preview.checkFit)(input, signal) },
  }
  return { runtime, log, checked, briefs: () => [...briefs] }
}

const cases: Promise<void>[] = []

cases.push(test('a link is looked for only once both goals have a clear intention, and only when something changed', () => {
  const plain = [root('a', 'Pottery', [chat('ca', ['a'])]), root('b', 'Meet people', [chat('cb', ['b'])])]
  assert.equal(branchSignature(plain, 'a').ready, false)
  assert.deepEqual(pairsToScan(plain, ['a']), [])
  const a = say(chat('ca', ['a']), 'm1', 'Saturdays, under $30')
  const b = say(chat('cb', ['b']), 'm2', 'Saturday afternoons with friends')
  const ready = [root('a', 'Pottery', [a]), root('b', 'Meet people', [b])]
  const pairs = pairsToScan(ready, ['b'])
  assert.equal(pairs.length, 1)
  const signature = pairs[0]?.signature ?? ''
  assert.equal(signature, pairSignature(ready, 'b', 'a'))
  // The same confirmed state, already checked, is not checked again (kept on the inspiration whose id sorts first).
  const checked = [root('a', 'Pottery', [a], { links: [{ otherId: 'b', signature, status: 'none', reason: 'Nothing shared', at: 1 }] }), root('b', 'Meet people', [b])]
  assert.equal(lastScan(checked, 'b', 'a')?.status, 'none')
  assert.deepEqual(pairsToScan(checked, ['a', 'b']), [])
  // A new confirmed condition is a substantive change; an unconfirmed reply is not.
  const unsure = [root('a', 'Pottery', [say(a, 'm3', 'Maybe in the evening')], { links: checked[0]?.node.type === 'inspiration' ? checked[0].node.links : [] }), root('b', 'Meet people', [b])]
  assert.deepEqual(pairsToScan(unsure, ['a']), [])
  const changed = [root('a', 'Pottery', [say(a, 'm4', 'In Oakland')], { links: checked[0]?.node.type === 'inspiration' ? checked[0].node.links : [] }), root('b', 'Meet people', [b])]
  assert.equal(pairsToScan(changed, ['a']).length, 1)
}))

cases.push(test('a large board checks at most two pairs per action, most recently active first, and leaves waiting links alone', () => {
  const developed = (id: string, at: number) => root(id, `Goal ${id}`, [say(chat(`c${id}`, [id]), `m${id}`, 'Weekends with friends', at)])
  const board = [developed('a', 50), developed('b', 10), developed('c', 40), developed('d', 30), developed('e', 20)]
  const pairs = pairsToScan(board, ['a'])
  assert.deepEqual(pairs.map(pair => pair.b), ['c', 'd'])
  // A shared conversation that waits for the user's decision is never re-run in the background.
  const waiting: ChatMessage = { id: 'q', role: 'assistant', proposal: { kind: 'question', prompt: 'Keep your budget?', options: ['Keep it', 'Raise it'], purpose: '' }, dependsOn: [] }
  const shared = chat('shared', ['a', 'c'], 'connect', [waiting])
  const withShared = board.map(record => record.id === 'a' && record.node.type === 'inspiration' ? { ...record, node: { ...record.node, chats: [...(record.node.chats ?? []), shared] } } : record)
  assert.equal(pairChat(withShared, 'c', 'a')?.chat.id, 'shared')
  assert.equal(pairIsSettled(shared), true)
  assert.deepEqual(pairsToScan(withShared, ['a']).map(pair => pair.b), ['d', 'e'])
  // Accepted directions stay settled; a declined one may be looked at again once the goals change.
  assert.equal(pairIsSettled(chat('s', ['a', 'c'], 'connect', [{ id: 'o', role: 'assistant', proposal: { kind: 'opportunity', title: 'Pottery social', description: '', benefitA: '', benefitB: '' }, dependsOn: [], decision: { status: 'accepted', note: '', at: 1 } }])), true)
  assert.equal(pairIsSettled(chat('s', ['a', 'c'], 'connect', [{ id: 'o', role: 'assistant', proposal: { kind: 'opportunity', title: 'Pottery social', description: '', benefitA: '', benefitB: '' }, dependsOn: [], decision: { status: 'declined', note: 'Too far', at: 1 } }])), false)
}))

cases.push(test('without a real overlap the agents say so and nothing is proposed or checked', async () => {
  const { runtime, log } = recorded()
  const { result, handoffs } = await run(request([branch('Learn pottery', [constraint('budget', 'Budget: up to $30')]), branch('Run a marathon', [constraint('place', 'Place: Oakland')])]), runtime)
  assert.equal(result.proposal.kind, 'none')
  assert.deepEqual(log.map(entry => entry.task), ['connection'])
  assert.deepEqual(handoffs.map(handoff => `${handoff.task}:${handoff.outcome}`), ['overlap:none'])
  assert.equal(collaborationStages(handoffs).current, 'none')
}))

cases.push(test('each branch’s own conditions change the result: a low budget becomes a decision, a sufficient one a sourced proposal', async () => {
  const people = branch('Meet people', [constraint('time', 'Time: Saturday afternoons')])
  const low = recorded()
  const tight = await run(request([branch('Learn pottery', [constraint('time', 'Time: Saturdays'), constraint('budget', 'Budget: up to $30')]), people]), low.runtime)
  assert.equal(tight.result.proposal.kind, 'question')
  const conflict = tight.result.proposal.conflict
  assert.ok(conflict)
  assert.equal(conflict.condition, 'Budget: up to $30')
  assert.ok(conflict.basis.includes('$45'))
  assert.ok(conflict.sources.some(source => source.url.includes('eventbrite')))
  assert.equal(conflict.effects.length, tight.result.proposal.options.length)
  assert.deepEqual(collaborationStages(tight.handoffs).reached, ['overlap', 'checking', 'researching', 'conflict', 'decision'])
  // Each fit check reads only its own goal's context (the shared candidate is the only common part).
  const checks = low.checked.map(context => JSON.stringify(context))
  assert.ok(checks.some(input => input.includes('Budget: up to $30') && !input.includes('Saturday afternoons')))
  const enough = await run(request([branch('Learn pottery', [constraint('time', 'Time: Saturdays'), constraint('budget', 'Budget: up to $60')]), people]), recorded().runtime)
  assert.equal(enough.result.proposal.kind, 'opportunity')
  assert.ok(enough.result.proposal.sources?.some(source => source.url.includes('eventbrite')))
  assert.equal(collaborationStages(enough.handoffs).current, 'ready')
}))

cases.push(test('the user’s decision changes the next search, and a search already run is not repeated', async () => {
  const people = branch('Meet people', [constraint('time', 'Time: Saturday afternoons')])
  const first = recorded()
  await run(request([branch('Learn pottery', [constraint('time', 'Time: Saturdays'), constraint('budget', 'Budget: up to $30')]), people]), first.runtime)
  const priorBriefs = first.briefs()
  assert.equal(priorBriefs.length, 1)
  // Keep the budget: the agents look for something different, not the same listing again.
  const keep = recorded()
  const kept = await run(request([branch('Learn pottery', [constraint('time', 'Time: Saturdays'), constraint('budget', 'Budget: up to $30')]), people], { trigger: 'manual', note: 'Keep my budget, search further', priorBriefs }), keep.runtime)
  assert.ok(keep.briefs()[0]?.startsWith('Free or low-cost'))
  assert.ok(kept.result.proposal.kind === 'opportunity' && kept.result.proposal.sources?.some(source => source.url.includes('meetup')))
  assert.ok(kept.handoffs.some(handoff => handoff.task === 'refine-search'))
  // Raise the budget: the search uses the new condition and the paid option now fits.
  const raise = recorded()
  const raised = await run(request([branch('Learn pottery', [constraint('time', 'Time: Saturdays'), constraint('budget', 'Budget: $45')]), people], { trigger: 'manual', note: 'Raise budget to $45', priorBriefs }), raise.runtime)
  assert.ok(raise.briefs()[0]?.includes('$45'))
  assert.equal(raised.result.proposal.kind, 'opportunity')
  // An agent that repeats an earlier brief does not get to run it again.
  const stubborn = recorded({ connection: input => Promise.resolve(input.phase === 'draft' ? { next: 'research' as const, brief: priorBriefs[0] ?? '', mustMatch: [] } : { next: 'none' as const, reason: 'x' }) })
  const repeated = await run(request([branch('Learn pottery'), people], { priorBriefs }), stubborn.runtime)
  assert.equal(stubborn.briefs().length, 0)
  assert.equal(repeated.result.proposal.kind, 'question')
}))

cases.push(test('a version changed after research is checked again by both goals; a check of the old version never counts', async () => {
  const found: Finding = { status: 'found', summary: 'Pottery social, $25', sources: [{ id: 's', title: 'Studio', url: 'https://studio.example/social' }], limits: '' }
  const versions: string[] = []
  const { runtime } = recorded({
    connection: (input: ConnectionInput) => Promise.resolve(input.phase === 'draft'
      ? { next: 'check' as const, candidate: { title: 'Pottery social', description: 'A social pottery evening', benefitA: '', benefitB: '' } }
      : input.evidence ? { next: 'revise' as const, candidate: { title: 'Pottery social at Studio', description: 'Saturday, $25', benefitA: '', benefitB: '', sources: [{ title: 'Studio', url: 'https://studio.example/social' }] } }
        : { next: 'research' as const, brief: 'Pottery social under $30', mustMatch: ['Budget: up to $30'] }),
    research: () => Promise.resolve(found),
    checkFit: input => { versions.push(input.candidate.title); return Promise.resolve(input.candidate.sources ? { fit: 'fits' as const, reason: 'Within budget', conflicts: [] } : { fit: 'fits' as const, reason: 'Probably fits', conflicts: [], verify: 'The price' }) },
  })
  const { result, handoffs } = await run(request([branch('Pottery', [constraint('budget', 'Budget: up to $30')]), branch('Meet people')]), runtime)
  assert.deepEqual(versions, ['Pottery social', 'Pottery social', 'Pottery social at Studio', 'Pottery social at Studio'])
  assert.equal(result.proposal.kind, 'opportunity')
  assert.equal(result.proposal.title, 'Pottery social at Studio')
  assert.equal(result.proposal.sources?.[0]?.url, 'https://studio.example/social')
  assert.ok(handoffs.some(handoff => handoff.task === 'revise' && handoff.summary.startsWith('Built the research into the idea')))
}))

cases.push(test('a conflict is never turned into a proposal: the user decides, with the condition and what each choice changes', async () => {
  const { runtime } = recorded({
    connection: input => Promise.resolve(input.phase === 'draft'
      ? { next: 'check' as const, candidate: { title: 'Saturday pottery social', description: '', benefitA: '', benefitB: '' } }
      // Tries to propose the checked idea although a branch reported a conflict.
      : { next: 'propose' as const, opportunity: { title: 'Saturday pottery social', description: '', benefitA: '', benefitB: '' } }),
    checkFit: input => Promise.resolve(input.branch.goal === 'Meet people' ? { fit: 'conflict' as const, reason: 'Saturday breaks weekday evenings', conflicts: ['Time: weekday evenings'] } : { fit: 'fits' as const, reason: 'ok', conflicts: [] }),
  })
  const { result } = await run(request([branch('Pottery'), branch('Meet people', [constraint('time', 'Time: weekday evenings')])]), runtime)
  assert.equal(result.proposal.kind, 'question')
  assert.equal(result.proposal.conflict?.condition, 'Time: weekday evenings')
  assert.deepEqual(result.proposal.options, ['Keep “Time: weekday evenings”', 'Relax “Time: weekday evenings”'])
  assert.equal(result.proposal.conflict.effects.length, 2)
}))

cases.push(test('a declined link does not return in the background without a reason', async () => {
  const people = branch('Meet people', [constraint('time', 'Time: Saturday afternoons')], [{ idea: 'Learn pottery, together with meet people', reason: 'Too far' }])
  const pottery = branch('Learn pottery', [constraint('time', 'Time: Saturdays')], [{ idea: 'Learn pottery, together with meet people', reason: 'Too far' }])
  const { runtime, log } = recorded()
  const { result } = await run(request([pottery, people]), runtime)
  assert.equal(result.proposal.kind, 'none')
  assert.ok(result.proposal.reason.includes('Too far'))
  assert.equal(log.filter(entry => entry.task === 'checkFit').length, 0)
}))

cases.push(test('link checks, decisions and conflict details survive a reload', () => {
  const decision: ChatMessage = { id: 'q', role: 'assistant', proposal: { kind: 'question', prompt: 'Keep your budget or change it?', options: ['Keep my budget, search further', 'Raise budget to $45'], purpose: '', conflict: { condition: 'Budget: up to $30', basis: 'The class costs $45.', sources: [{ id: 's', title: 'Class', url: 'https://example.com/class' }], effects: ['Search again', 'Check both goals again'] } }, dependsOn: [], trace: [{ from: 'connection', to: 'coordinator', task: 'overlap', outcome: 'found', summary: 'Possible overlap' }], searches: ['Pottery social within $30'] }
  const answer: ChatMessage = { id: 'u', role: 'user', text: 'Raise budget to $45', replyTo: 'q', stance: 'answer' }
  const none: ChatMessage = { id: 'n', role: 'assistant', proposal: { kind: 'none', reason: 'Nothing shared yet' }, dependsOn: [] }
  const record = root('a', 'Pottery', [chat('s', ['a', 'b'], 'connect', [none, decision, answer])], { links: [{ otherId: 'b', signature: 'sig', status: 'found', reason: 'Keep your budget?', chatId: 's', at: 2 }] })
  const node = NodeSchema.parse(JSON.parse(JSON.stringify(record.node)))
  assert.ok(node.type === 'inspiration' && node.links?.[0]?.chatId === 's')
  const restored = ChatSchema.parse(node.chats?.[0])
  assert.deepEqual(restored.messages, [none, decision, answer])
  assert.equal(ResultSchema.parse({ requestId: 'r', proposal: { kind: 'none', reason: 'x' }, activity: [], mode: 'live' }).searches.length, 0)
}))

await Promise.all(cases)
