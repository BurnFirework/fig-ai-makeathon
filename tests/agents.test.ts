import { test } from 'node:test'
import assert from 'node:assert/strict'
import { chatContext, currentRevisions, decisionOf, memoryDependencies } from '../shared/chats'
import { invalidatedBy, type NodeRecord } from '../shared/context'
import { type AgentRuntime, type Finding, LIMITS, LeadStepSchema, runCoordinator } from '../shared/coordinator'
import { applyAgentMemory, applyDrafts, chatMemory, classifyMessage, interpretMessage, mergeMemory, questionFor } from '../shared/memory'
import { demoRuntime } from '../shared/preview'
import { type AgentEvent, type AgentRequest, type BranchContext, type Chat, type ChatMessage, ChatSchema, NodeSchema, memoryKey, revisionsMatch } from '../shared/schema'
import { parseWithRetry } from '../server/agents'

const base = { sequence: 0, revision: 0, stale: false, dependsOn: [], agent: 'you', createdAt: 0 }
const root = (id: string, goal: string, chats: Chat[] = []): NodeRecord => ({ id, node: NodeSchema.parse({ ...base, branchId: id, type: 'inspiration', goal, assetId: 'asset:test', started: true, chats }) })
const ask = (id: string, prompt: string): ChatMessage => ({ id, role: 'assistant', proposal: { kind: 'question', prompt, options: ['Yes', 'No'], purpose: '' }, dependsOn: [] })
const newChat = (id: string, branchIds: string[], operation: Chat['operation'] = 'branch', extra: Partial<Chat> = {}): Chat => ({ id, title: id, sourceIds: [...branchIds], branchIds, operation, messages: [], createdAt: 0, ...extra })
/** Mirrors the client's send(): classify, interpret and remember the user's message. */
function say(chat: Chat, id: string, text: string, replyTo?: string): Chat {
  const message: ChatMessage = { id, role: 'user', text, stance: classifyMessage(text), ...(replyTo ? { replyTo } : {}) }
  const messages = [...chat.messages, message]
  let index = 0
  return { ...chat, messages, memory: applyDrafts(chatMemory(chat), interpretMessage(text, message.stance ?? 'answer', questionFor(messages, message)), [id], 'you', 1, () => `${id}:${index++}`) }
}
const active = (branch: BranchContext, key: string) => branch.memory.filter(item => item.key === key).map(item => item.text)
const request = (operation: AgentRequest['operation'], branches: BranchContext[], extra: Partial<AgentRequest> = {}): AgentRequest => ({ requestId: 'r', operation, branches, note: '', ...extra })
const branch = (goal: string, memory: BranchContext['memory'] = [], declined: BranchContext['declined'] = []): BranchContext => ({ id: goal, goal, revision: 0, answers: [], confirmed: memory.map(item => item.text), assumptions: [], previousSuggestions: [], memory, changes: [], declined })
const found: Finding = { status: 'found', summary: 'A community studio class', sources: [{ id: 's1', title: 'Studio class', url: 'https://studio.example/class' }], limits: '' }

/** A scripted runtime that records every task it receives. */
function scripted(script: Partial<AgentRuntime>): AgentRuntime & { log: { task: string; input: unknown }[] } {
  const log: { task: string; input: unknown }[] = []
  const fail = (task: string) => () => Promise.reject(new Error(`unexpected ${task}`))
  return {
    mode: 'demo', log,
    lead: (input, signal) => { log.push({ task: 'lead', input }); return (script.lead ?? fail('lead'))(input, signal) },
    research: (input, signal) => { log.push({ task: 'research', input }); return (script.research ?? fail('research'))(input, signal) },
    connection: (input, signal) => { log.push({ task: 'connection', input }); return (script.connection ?? fail('connection'))(input, signal) },
    checkFit: (input, signal) => { log.push({ task: 'checkFit', input }); return (script.checkFit ?? fail('checkFit'))(input, signal) },
  }
}
const run = (req: AgentRequest, runtime: AgentRuntime, signal = new AbortController().signal, limits = LIMITS) => {
  const events: AgentEvent[] = []
  return runCoordinator(req, runtime, signal, event => events.push(event), limits).then(result => ({ result, events }))
}

const cases: Promise<void>[] = []

cases.push(test('messages keep their meaning: questions, doubts and refusals are not confirmed facts', () => {
  assert.equal(classifyMessage('Сколько это стоит?'), 'question')
  assert.deepEqual(interpretMessage('Is $30 enough?', 'question'), [])
  assert.equal(classifyMessage('Может быть по выходным'), 'uncertain')
  assert.deepEqual(interpretMessage('Может быть по выходным', 'uncertain'), [])
  assert.deepEqual(interpretMessage('нет, не хочу', 'decline', 'Попробовать гончарный круг?'), [{ kind: 'declined', text: 'Declined: Попробовать гончарный круг?' }])
  assert.deepEqual(interpretMessage('Oakland', 'answer', 'Where do you live?'), [{ kind: 'constraint', key: 'place', text: 'Place: Oakland' }])
  assert.deepEqual(interpretMessage('In Oakland, small groups', 'answer').map(draft => draft.key), ['place', 'group'])
}))

cases.push(test('1. a corrected budget replaces the old one, keeps history, and reaches every participating agent', async () => {
  let pottery = newChat('pottery', ['a'])
  pottery = { ...pottery, messages: [ask('q1', 'What is your budget?')] }
  pottery = say(pottery, 'm1', '$100', 'q1')
  const people = say(newChat('people', ['b']), 'm2', 'Small groups, on weekends')
  let shared = newChat('shared', ['a', 'b'], 'connect', { contextChats: [{ nodeId: 'a', chatId: 'pottery', messageId: 'm1' }, { nodeId: 'b', chatId: 'people', messageId: 'm2' }] })
  shared = say(shared, 'm3', 'теперь бюджет $30 вместо $100')
  const records = [root('a', 'Learn pottery', [pottery, shared]), root('b', 'Meet people', [people])]
  const first = chatContext(records, 'a', shared, 'a'), second = chatContext(records, 'a', shared, 'b')
  const contexts = [first, second]
  for (const context of contexts) {
    assert.deepEqual(active(context, 'budget'), ['Budget: $30'])
    assert.ok(context.confirmed.includes('Budget: $30') && !context.confirmed.includes('Budget: $100'))
  }
  assert.deepEqual(first.changes, [{ key: 'budget', before: 'Budget: $100', after: 'Budget: $30' }])
  // The connection agent and both branch agents receive the same active budget.
  const runtime = scripted({
    connection: () => Promise.resolve({ next: 'check', candidate: { title: 'Pottery evening for small groups', description: '', benefitA: '', benefitB: '' } }),
    checkFit: () => Promise.resolve({ fit: 'fits', reason: 'Within the budget', conflicts: [] }),
  })
  await run(request('connect', [first, second]), runtime)
  const seen = runtime.log.map(entry => JSON.stringify(entry.input))
  assert.equal(seen.length, 3)
  for (const input of seen) { assert.ok(input.includes('Budget: $30')); assert.ok(!input.includes('"text":"Budget: $100"')) }
  // A later correction in a source chat replaces the inherited condition for derived chats too.
  pottery = say(pottery, 'm4', 'Actually the budget is $20 instead of $100')
  const updated = chatContext([root('a', 'Learn pottery', [pottery, newChat('shared', ['a', 'b'], 'connect', { contextChats: [{ nodeId: 'a', chatId: 'pottery', messageId: 'm1' }] })]), root('b', 'Meet people')], 'a', newChat('shared', ['a', 'b'], 'connect', { contextChats: [{ nodeId: 'a', chatId: 'pottery', messageId: 'm1' }] }), 'a')
  assert.deepEqual(active(updated, 'budget'), ['Budget: $20'])
}))

cases.push(test('2. independent conversations and goals never share memory', () => {
  const current = say(newChat('current', ['a']), 'c1', 'Under $50, in Oakland')
  const sibling = say(newChat('sibling', ['a']), 's1', 'A week in Tokyo, budget $5000')
  const other = say(newChat('other', ['b']), 'o1', 'Online only')
  const records = [root('a', 'Pottery', [current, sibling]), root('b', 'Meet people', [other])]
  const context = chatContext(records, 'a', current, 'a')
  const text = JSON.stringify(context)
  assert.deepEqual(active(context, 'budget'), ['Budget: up to $50'])
  for (const leaked of ['Tokyo', '5000', 'Online only', 'Meet people']) assert.ok(!text.includes(leaked), leaked)
  assert.equal(mergeMemory([{ nodeId: 'a', chat: sibling }]).active.some(item => item.text === 'Budget: up to $50'), false)
}))

cases.push(test('3. a declined idea is not developed again unless the agent says what changed', async () => {
  const declined = [{ idea: 'Pottery night', reason: 'Too late in the evening' }]
  const shared: Chat = { ...newChat('shared', ['a', 'b'], 'connect'), messages: [{ id: 'p1', role: 'assistant', proposal: { kind: 'opportunity', title: 'Pottery night', description: '', benefitA: '', benefitB: '' }, dependsOn: [], decision: { status: 'declined', note: 'Too late in the evening', at: 1 } }] }
  const records = [root('a', 'Pottery', [shared]), root('b', 'Meet people')]
  assert.deepEqual(chatContext(records, 'a', shared, 'b').declined, declined)
  // A new conversation about the same pair also knows the reason.
  assert.deepEqual(chatContext(records, 'b', newChat('again', ['a', 'b'], 'connect', { sourceIds: ['b', 'a'] }), 'a').declined, declined)
  const repeat = scripted({ connection: () => Promise.resolve({ next: 'check', candidate: { title: 'Pottery night', description: 'Same idea', benefitA: '', benefitB: '' } }) })
  const { result } = await run(request('connect', [branch('Pottery', [], declined), branch('Meet people', [], declined)]), repeat)
  assert.equal(result.proposal.kind, 'question')
  assert.equal(repeat.log.filter(entry => entry.task === 'checkFit').length, 0)
  const explained = scripted({
    connection: () => Promise.resolve({ next: 'check', candidate: { title: 'Pottery night', description: 'Earlier start', benefitA: '', benefitB: '', changed: 'It now starts at 5pm, before the late hours you declined.' } }),
    checkFit: () => Promise.resolve({ fit: 'fits', reason: 'ok', conflicts: [] }),
  })
  const accepted = await run(request('connect', [branch('Pottery', [], declined), branch('Meet people', [], declined)]), explained)
  assert.equal(accepted.result.proposal.kind, 'opportunity')
  assert.ok(accepted.result.proposal.description.includes('What changed'))
  const preview = await run(request('connect', [branch('Pottery', [], [{ idea: 'A first experience, together', reason: '' }]), branch('Meet people')]), demoRuntime(0))
  assert.ok(preview.result.proposal.kind === 'opportunity' && preview.result.proposal.title !== 'A first experience, together')
}))

cases.push(test('4. a refinement produces a revised proposal that needs a new decision', async () => {
  const focus = { kind: 'refine' as const, title: 'A first experience, together', description: 'Try both', note: 'Keep it under $30' }
  const { result, events } = await run(request('connect', [branch('Pottery'), branch('Meet people')], { focus }), demoRuntime(0))
  assert.equal(result.proposal.kind, 'opportunity')
  assert.ok(result.proposal.title.endsWith('— revised') && result.proposal.description.includes('Keep it under $30'))
  assert.ok(events.some(event => event.type === 'handoff' && event.handoff.task === 'check-fit'))
  const shared = ChatSchema.parse({ ...newChat('shared', ['a', 'b'], 'connect'), messages: [
    { id: 'v1', role: 'assistant', proposal: { kind: 'opportunity', title: focus.title, description: focus.description, benefitA: '', benefitB: '' }, dependsOn: [], decision: { status: 'refine', note: 'Keep it under $30', at: 1 } },
    { id: 'n', role: 'user', text: 'Keep it under $30', stance: 'refine', replyTo: 'v1' },
    { id: 'v2', role: 'assistant', proposal: result.proposal, dependsOn: [], revises: 'v1', trace: result.handoffs },
  ] })
  const [v1, , v2] = shared.messages
  assert.ok(v1 && v2)
  assert.equal(decisionOf(v1), 'refine')
  assert.equal(decisionOf(v2), undefined)
}))

cases.push(test('5. a shared opportunity is checked by each branch agent with only its own goal and conditions; a changed idea is checked again', async () => {
  const a = branch('Learn pottery', [{ id: 'x', kind: 'constraint', key: 'budget', text: 'Budget: up to $30' }])
  const b = branch('Meet people', [{ id: 'y', kind: 'constraint', key: 'time', text: 'Time: weekday evenings' }])
  const runtime = scripted({
    connection: input => Promise.resolve(input.phase === 'draft'
      ? { next: 'check', candidate: { title: 'Saturday pottery social', description: '', benefitA: '', benefitB: '' } }
      // The connection agent tries to slip a changed idea through "propose": it must be checked again.
      : { next: 'propose', opportunity: { title: 'Weekday evening pottery social', description: 'Moved to a weekday evening', benefitA: '', benefitB: '' }, reason: 'Moved to weekday evenings for the second goal' }),
    checkFit: input => Promise.resolve(input.branch.goal === 'Meet people' && input.candidate.title.startsWith('Saturday') ? { fit: 'conflict', reason: 'Saturday breaks the weekday-evening condition', conflicts: ['Time: weekday evenings'] } : { fit: 'fits', reason: 'Fits this goal', conflicts: [] }),
  })
  const { result, events } = await run(request('connect', [a, b]), runtime)
  const checks = runtime.log.filter(entry => entry.task === 'checkFit').map(entry => JSON.stringify(entry.input))
  assert.equal(checks.length, 4)
  assert.ok(checks[0]?.includes('Budget: up to $30') && !checks[0].includes('weekday evenings'))
  assert.ok(checks[1]?.includes('weekday evenings') && !checks[1].includes('$30'))
  assert.ok(checks.slice(2).every(input => input.includes('Weekday evening pottery social')))
  const decide = runtime.log.find(entry => entry.task === 'connection' && JSON.stringify(entry.input).includes('"phase":"decide"'))
  assert.ok(decide && JSON.stringify(decide.input).includes('Saturday breaks'))
  assert.ok(result.proposal.kind === 'opportunity' && result.proposal.title === 'Weekday evening pottery social')
  const routes = events.flatMap(event => event.type === 'handoff' ? [`${event.handoff.from}>${event.handoff.to}:${event.handoff.task}:${event.handoff.outcome}`] : [])
  assert.deepEqual(routes, [
    'connection>coordinator:overlap:found',
    'connection>branch:check-fit:requested', 'connection>branch:check-fit:requested', 'branch>connection:check-fit:fits', 'branch>connection:check-fit:conflict',
    'connection>connection:revise:requested',
    'connection>branch:check-fit:requested', 'connection>branch:check-fit:requested', 'branch>connection:check-fit:fits', 'branch>connection:check-fit:fits',
    'connection>you:propose:proposed'])
  // Only the agents a step needs run: a fitting branch request never calls the connection agent or research.
  const solo = scripted({ lead: () => Promise.resolve({ next: 'ask', question: { prompt: 'Where?', options: ['Home', 'Studio'], purpose: '' } }) })
  await run(request('branch', [a]), solo)
  assert.deepEqual(solo.log.map(entry => entry.task), ['lead'])
}))

cases.push(test('6. a failed search leads to a clarifying question, never an invented action', async () => {
  const none: Finding = { status: 'none', summary: 'No classes under $30 this month', sources: [], limits: '' }
  const runtime = scripted({
    lead: input => Promise.resolve(input.evidence ? { next: 'ask', question: { prompt: 'Could the budget stretch to $45?', options: ['Yes', 'No, keep $30'], purpose: 'Nothing verified fits $30.' } } : { next: 'research', brief: 'pottery class under $30', mustMatch: ['Budget: up to $30'] }),
    research: () => Promise.resolve(none),
  })
  const { result, events } = await run(request('branch', [branch('Pottery')]), runtime)
  assert.equal(result.proposal.kind, 'question')
  assert.ok(events.some(event => event.type === 'handoff' && event.handoff.from === 'research' && event.handoff.outcome === 'none'))
  // An action that cites nothing from the research is never shown.
  const invented = scripted({ lead: input => Promise.resolve(input.evidence ? { next: 'propose', action: { title: 'Book a class', description: '', sources: [{ title: 'Made up', url: 'https://invented.example' }] } } : { next: 'research', brief: 'x', mustMatch: [] }), research: () => Promise.resolve(found) })
  assert.equal((await run(request('branch', [branch('Pottery')]), invented)).result.proposal.kind, 'question')
  // A narrower search is allowed, but searches and calls are bounded.
  const stubborn = scripted({ lead: () => Promise.resolve({ next: 'research', brief: 'again', mustMatch: [], reason: 'Results were too expensive' }), research: () => Promise.resolve(none) })
  const bounded = await run(request('branch', [branch('Pottery', [{ id: 'b', kind: 'constraint', key: 'budget', text: 'Budget: up to $30' }])]), stubborn)
  assert.equal(stubborn.log.filter(entry => entry.task === 'research').length, LIMITS.research)
  assert.ok(bounded.result.proposal.kind === 'question' && bounded.result.proposal.options.includes('Budget: up to $30'))
  assert.ok(bounded.events.some(event => event.type === 'handoff' && event.handoff.task === 'refine-search'))
  // A sourced action keeps only cited, verified sources.
  const good = scripted({ lead: input => Promise.resolve(input.evidence ? { next: 'propose', action: { title: 'Check the studio class', description: '', sources: [{ title: 'Studio', url: 'https://studio.example/class/' }, { title: 'Other', url: 'https://other.example' }] } } : { next: 'research', brief: 'x', mustMatch: [] }), research: () => Promise.resolve(found) })
  const sourced = await run(request('research', [branch('Pottery')]), good)
  assert.deepEqual(sourced.result.proposal.kind === 'action' && sourced.result.proposal.sources, found.sources)
}))

cases.push(test('7. stopping or changing conditions blocks late results', async () => {
  const controller = new AbortController()
  const slow = scripted({ lead: (_input, signal) => new Promise((_resolve, reject) => { signal.addEventListener('abort', () => reject(new Error('Stopped.')), { once: true }); setTimeout(() => controller.abort(), 5) }) })
  await assert.rejects(run(request('branch', [branch('Pottery')]), slow, controller.signal), /Stopped/)
  const late = scripted({ lead: (_input, signal) => new Promise((_resolve, reject) => { signal.addEventListener('abort', () => reject(new Error('aborted')), { once: true }) }) })
  // AbortSignal.timeout is unref'ed; the fake runtime has no subprocess I/O keeping Node alive.
  const keepAlive = setInterval(() => {}, 1000)
  try { await assert.rejects(run(request('branch', [branch('Pottery')]), late, new AbortController().signal, { ...LIMITS, deadlineMs: 20 }), /limit/) } finally { clearInterval(keepAlive) }
  // A condition change moves the memory revision, so the request's dependencies no longer match.
  let chat = say(newChat('c', ['a']), 'm1', 'Budget $100')
  const before = [root('a', 'Pottery', [chat])]
  const dependencies = memoryDependencies(before, 'a', chat)
  assert.equal(revisionsMatch(dependencies, currentRevisions(before)), true)
  chat = say(chat, 'm2', 'Now $30 instead of $100')
  const outcome: NodeRecord = { id: 'card', node: NodeSchema.parse({ ...base, branchId: 'a', type: 'action', title: 'Class', description: '', sources: [], completed: false, reflection: '', agent: 'research', dependsOn: dependencies }) }
  const after = [root('a', 'Pottery', [chat]), outcome]
  assert.equal(revisionsMatch(dependencies, currentRevisions(after)), false)
  assert.deepEqual([...invalidatedBy(after, memoryKey('c'))], ['card'])
  // An assumption or a question does not invalidate anything.
  const asked = say(chat, 'm3', 'Is there anything cheaper?')
  assert.equal(chatMemory(asked).revision, chatMemory(chat).revision)
}))

cases.push(test('8. memory, decisions and handoff summaries survive a reload; older chats derive memory deterministically', () => {
  let chat = say(newChat('c', ['a', 'b'], 'connect'), 'm1', 'Under $40, on Saturdays')
  chat = { ...chat, messages: [...chat.messages, { id: 'p', role: 'assistant', proposal: { kind: 'opportunity', title: 'Pottery social', description: '', benefitA: '', benefitB: '' }, dependsOn: [{ id: memoryKey('c'), revision: 1 }], decision: { status: 'declined', note: 'Too far', at: 2 }, trace: [{ from: 'connection', to: 'branch', toLabel: 'Pottery', task: 'check-fit', outcome: 'requested', summary: 'Check it' }] }] }
  const saved = root('a', 'Pottery', [chat])
  const reloaded = NodeSchema.parse(JSON.parse(JSON.stringify(saved.node)))
  assert.deepEqual(reloaded, saved.node)
  assert.deepEqual(chatMemory(reloaded.chats?.[0] ?? chat), chat.memory)
  const legacy: Chat = { ...newChat('old', ['a']), messages: [ask('q', 'What is your budget?'), { id: 'u', role: 'user', text: 'Under $50', replyTo: 'q' }] }
  assert.deepEqual(chatMemory(legacy), chatMemory(ChatSchema.parse(JSON.parse(JSON.stringify(legacy)))))
  assert.deepEqual(chatMemory(legacy).entries.map(entry => entry.text), ['Budget: up to $50'])
  assert.equal(chatMemory(legacy).revision, 0)
}))

cases.push(test('agent memory needs a user message as its basis; otherwise it stays an assumption', () => {
  const start = say(newChat('c', ['a']), 'm1', 'Budget $100')
  const known = new Set(start.memory?.entries.map(entry => entry.id))
  let id = 0
  const next = applyAgentMemory(chatMemory(start), [
    { kind: 'constraint', key: 'place', text: 'Place: Oakland', from: 'invented-message' },
    { kind: 'constraint', key: 'budget', text: 'Budget: up to $90', from: 'm1', replaces: 'm1:0' },
  ], new Set(['m1']), known, 'reply', 3, () => `agent-${id++}`)
  const place = next.entries.find(entry => entry.text === 'Place: Oakland')
  assert.equal(place?.kind, 'assumption')
  assert.equal(place.by, 'agent')
  assert.deepEqual(next.entries.filter(entry => entry.status === 'active' && entry.key === 'budget').map(entry => entry.text), ['Budget: up to $90'])
  assert.equal(next.revision, chatMemory(start).revision + 1)
}))

cases.push(test('an invalid agent reply is retried once with the problem, then fails with a friendly message', async () => {
  const prompts: string[] = []
  const replies = [JSON.stringify({ next: 'ask', question: { prompt: 'Budget?', options: ['Any'], purpose: '' } }), JSON.stringify({ next: 'ask', question: { prompt: 'Budget?', options: ['Under $30', 'Flexible'], purpose: '' } })]
  const step = await parseWithRetry(prompt => { prompts.push(prompt); return Promise.resolve(replies.shift() ?? '') }, 'base', LeadStepSchema, new AbortController().signal)
  assert.equal(step.next, 'ask')
  assert.match(prompts[1] ?? '', /2 to 4/)
  await assert.rejects(parseWithRetry(() => Promise.resolve('{"next":"ask","question":{"prompt":"x","options":[]}}'), 'base', LeadStepSchema, new AbortController().signal), (error: Error) => !error.message.includes('too_small') && /retry/.test(error.message))
}))

cases.push(test('a chat on an outcome builds beyond it instead of repeating it', async () => {
  const outcome = { title: 'Find one beginner-friendly session', description: 'Use the directory' }
  const repeat = scripted({ lead: input => Promise.resolve(input.evidence ? { next: 'propose', action: { title: 'Find one beginner-friendly session', description: '', sources: found.sources } } : { next: 'research', brief: 'x', mustMatch: [] }), research: () => Promise.resolve(found) })
  const repeated = await run(request('branch', [branch('Cozy working space')], { outcome }), repeat)
  assert.equal(repeated.result.proposal.kind, 'question')
  assert.ok(JSON.stringify(repeat.log[0]?.input).includes('Find one beginner-friendly session'))
  // Preview agents ask how it went, then suggest a different, follow-up step.
  const first = await run(request('branch', [branch('Cozy working space')], { outcome }), demoRuntime(0))
  assert.equal(first.result.proposal.kind, 'question')
  const asked = first.result.proposal.prompt
  const answered = { ...branch('Cozy working space'), answers: [{ question: asked, answer: 'I tried it — what next?', stance: 'answer' as const }] }
  const next = await run(request('branch', [answered], { outcome }), demoRuntime(0))
  assert.equal(next.result.proposal.kind, 'action')
  assert.notEqual(next.result.proposal.title, outcome.title)
}))

await Promise.all(cases)
