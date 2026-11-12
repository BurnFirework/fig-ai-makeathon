import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, writeFile, chmod, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { z } from 'zod'
import { join } from 'node:path'
import { AgentFailure, type AgentRuntime, type Budget, type ConnectionStep, collaborationStages, LeadStepSchema, LIMITS, runCoordinator } from '../shared/coordinator'
import { pairsToScan } from '../shared/links'
import type { NodeRecord } from '../shared/context'
import { type AgentEvent, type AgentRequest, type BranchContext, type Chat, NodeSchema } from '../shared/schema'
import { CliError, callCli } from '../server/cli'
import { liveRuntime, parseWithRetry } from '../server/agents'

// Regression for the live failure found on November 10, 2026: Claude Code's research replies were valid JSON
// but longer than the reply schema allows (a 1,700-character summary, a 650-character "limits"), because the
// prompt stated no limits. The runtime then returned { status: 'none', summary: 'The research reply could not
// be read.' }, so a technical failure read as “no suitable option” and the agents went on to search again or ask
// the user to change a condition. A CLI that stopped at its turn limit failed with an unexplained message.

/** A stand-in for the `claude` binary that answers in Claude Code's stream-json format. */
const FAKE_CLAUDE = `
const { appendFileSync } = require('node:fs')
let input = ''
process.stdin.on('data', chunk => { input += chunk })
process.stdin.on('end', () => {
  const text = JSON.parse(input).message.content[0].text
  const formatter = text.includes('Role: formatter')
  appendFileSync(log, JSON.stringify({ args: process.argv.slice(2), formatter }) + '\\n')
  const out = event => process.stdout.write(JSON.stringify(event) + '\\n')
  const reply = value => out({ type: 'result', subtype: 'success', is_error: false, result: typeof value === 'string' ? value : JSON.stringify(value) })
  const valid = { status: 'found', summary: 'Clay social at the studio, Saturday 2 p.m., $20 per person.', sources: [{ title: 'Clay social', url: 'https://studio.example/social' }], limits: 'Group size not stated.' }
  if (mode === 'timeout') { setInterval(() => {}, 1000); return }
  if (mode === 'turns') { out({ type: 'assistant', message: { content: [{ type: 'tool_use', name: 'WebSearch', input: {} }] } }); out({ type: 'result', subtype: 'error_max_turns', is_error: false, num_turns: 15 }); return }
  if (formatter) { reply(mode === 'unreadable' ? 'Here is the research summary you asked for, without JSON.' : valid); return }
  out({ type: 'assistant', message: { content: [{ type: 'tool_use', name: 'WebSearch', input: { query: 'pottery' } }] } })
  out({ type: 'user', message: { content: [{ type: 'tool_result', content: 'Clay social https://studio.example/social' }] } })
  if (mode === 'none') { reply({ status: 'none', summary: 'Searched SF studios; every beginner class costs over $25.', sources: [], limits: '' }); return }
  if (mode === 'prose') { reply('Based on my research:\\n' + JSON.stringify(valid) + '\\nLet me know if you need more.'); return }
  reply({ ...valid, summary: 'Clay social, Saturdays. '.repeat(75), limits: 'Not verified. '.repeat(50) })
})`

async function withFakeClaude(mode: string, check: (runtime: AgentRuntime, calls: () => Promise<{ args: string[]; formatter: boolean }[]>, binary: string) => Promise<void>) {
  const directory = await mkdtemp(join(tmpdir(), 'unfold-research-'))
  const executable = join(directory, 'claude.cjs'); const log = join(directory, 'calls.log')
  await writeFile(executable, `#!${process.execPath}\nconst mode = ${JSON.stringify(mode)}, log = ${JSON.stringify(log)}\n${FAKE_CLAUDE}`); await chmod(executable, 0o700); await writeFile(log, '')
  try {
    await check(liveRuntime({ provider: 'claude', binary: executable }), async () => (await readFile(log, 'utf8')).split('\n').filter(Boolean).map(line => CallSchema.parse(JSON.parse(line))), executable)
  } finally { await rm(directory, { recursive: true, force: true }) }
}
const CallSchema = z.object({ args: z.array(z.string()), formatter: z.boolean() })
const counter = (left: number) => { const budget = { spent: 0, spend: () => { if (budget.spent >= left) return false; budget.spent++; return true } }; return budget satisfies Budget }
const branch = (goal: string, memory: BranchContext['memory'] = []): BranchContext => ({ id: goal, goal, revision: 0, answers: [], confirmed: memory.map(item => item.text), assumptions: [], previousSuggestions: [], memory, changes: [], declined: [] })
const budget25 = { id: 'b', kind: 'constraint' as const, key: 'budget' as const, text: 'Budget: up to $25' }
const researchInput = { brief: 'Pottery class in San Francisco on Saturday under $25', mustMatch: ['Budget: up to $25'], branches: [branch('Explore a creative practice', [budget25])], attempt: 1 }
const signal = () => new AbortController().signal

const cases: Promise<void>[] = []

cases.push(test('an over-long research reply gets one correction without a new search, counted in the budget, and keeps only searched sources', () => withFakeClaude('long', async (runtime, calls) => {
  const budget = counter(5)
  const finding = await runtime.research(researchInput, signal(), budget)
  assert.equal(finding.status, 'found')
  assert.deepEqual(finding.sources.map(source => source.url), ['https://studio.example/social'])
  assert.equal(budget.spent, 1)
  const log = await calls()
  assert.equal(log.length, 2)
  assert.equal(log[0]?.formatter, false)
  assert.equal(log[1]?.formatter, true)
  // The correction restates the reply; it gets no search tools.
  const tools = (call: { args: string[] } | undefined) => call ? call.args[call.args.indexOf('--tools') + 1] : undefined
  assert.equal(tools(log[1]), '')
  assert.equal(tools(log[0]), 'WebSearch,WebFetch')
})))

cases.push(test('a research reply that stays unreadable is a technical failure, never “no suitable option”', () => withFakeClaude('unreadable', async runtime => {
  await assert.rejects(runtime.research(researchInput, signal(), counter(5)), (error: Error) =>
    error instanceof AgentFailure && /could not be read/.test(error.message) && /nothing was concluded/i.test(error.message) && !/no suitable/i.test(error.message))
})))

cases.push(test('with no calls left, an unreadable research reply fails without a correction request', () => withFakeClaude('long', async (runtime, calls) => {
  await assert.rejects(runtime.research(researchInput, signal(), counter(0)), (error: Error) => error instanceof AgentFailure && /no calls were left/.test(error.message))
  assert.equal((await calls()).length, 1)
})))

cases.push(test('an honest “nothing fits” stays a finding, and a JSON reply wrapped in prose is still read', async () => {
  await withFakeClaude('none', async (runtime, calls) => {
    const budget = counter(5)
    const finding = await runtime.research(researchInput, signal(), budget)
    assert.equal(finding.status, 'none')
    assert.match(finding.summary, /over \$25/)
    assert.equal(budget.spent, 0)
    assert.equal((await calls()).length, 1)
  })
  await withFakeClaude('prose', async runtime => {
    const finding = await runtime.research(researchInput, signal(), counter(5))
    assert.equal(finding.status, 'found')
  })
}))

cases.push(test('a CLI that stops at its turn limit or times out reports that plainly, as a technical failure', async () => {
  await withFakeClaude('turns', async runtime => {
    await assert.rejects(runtime.research(researchInput, signal(), counter(5)), (error: Error) => error instanceof AgentFailure && /used all its steps/.test(error.message) && /retry/.test(error.message))
  })
  await withFakeClaude('timeout', async (_runtime, _calls, binary) => {
    await assert.rejects(callCli({ provider: 'claude', binary }, 'Synthetic test', signal(), { search: true, timeoutMs: 400 }), (error: Error) => error instanceof CliError && error.kind === 'timeout' && /did not reply within/.test(error.message))
  })
}))

cases.push(test('format corrections spend from the request budget; with none left the step fails instead of asking again', async () => {
  const prompts: string[] = []
  const reply = (texts: string[]) => (prompt: string) => { prompts.push(prompt); return Promise.resolve(texts.shift() ?? '') }
  const budget = counter(1)
  const step = await parseWithRetry(reply(['not json', '{"next":"ask","question":{"prompt":"When?","options":["Sat","Sun"]}}']), 'base', LeadStepSchema, signal(), undefined, budget)
  assert.equal(step.next, 'ask')
  assert.equal(budget.spent, 1)
  prompts.length = 0
  await assert.rejects(parseWithRetry(reply(['not json', 'unused']), 'base', LeadStepSchema, signal(), undefined, counter(0)), AgentFailure)
  assert.equal(prompts.length, 1)
}))

/** A connection flow whose research step fails or honestly finds nothing. */
function connectionRuntime(research: AgentRuntime['research']) {
  const log: string[] = []
  const runtime: AgentRuntime = {
    mode: 'live',
    lead: () => Promise.reject(new Error('unexpected lead')),
    research: (input, task, budget) => { log.push('research'); return research(input, task, budget) },
    connection: input => {
      log.push(`connection:${input.phase}`)
      const step: ConnectionStep = input.phase === 'draft'
        ? { next: 'check', candidate: { title: 'Small-group pottery social', description: 'A Saturday hand-building class', benefitA: 'Hands-on clay', benefitB: 'Meet a few people' } }
        : input.evidence ? { next: 'ask', question: { prompt: 'Raise the budget to $45?', options: ['Raise to $45', 'Keep $25'], purpose: 'Nothing fit $25.', conflict: { condition: 'Budget: up to $25', basis: 'Classes cost $45+.', effects: ['Search within $45', 'Keep searching under $25'] } } }
          : { next: 'research', brief: 'Pottery social in San Francisco on Saturday under $25', mustMatch: ['Budget: up to $25'] }
      return Promise.resolve(step)
    },
    checkFit: () => { log.push('check'); return Promise.resolve({ fit: 'fits' as const, reason: 'Fits if the price is right.', conflicts: [], missing: null, verify: 'Budget: up to $25' }) },
  }
  return { runtime, log }
}
const connectRequest: AgentRequest = { requestId: 'r', operation: 'connect', note: '', trigger: 'auto', branches: [branch('Explore a creative practice', [budget25]), branch('Meet new people', [{ id: 'g', kind: 'constraint', key: 'group', text: 'Group: small group' }])] }

cases.push(test('a failed search stops the shared work with a clear error; it never becomes a conflict or a request to change a condition', async () => {
  const failing = connectionRuntime(() => Promise.reject(new AgentFailure('The search could not finish: Claude Code did not reply within 170 seconds. Nothing was added; please retry.')))
  const events: AgentEvent[] = []
  await assert.rejects(runCoordinator(connectRequest, failing.runtime, signal(), event => events.push(event)), (error: Error) => /did not reply within 170 seconds/.test(error.message))
  const handoffs = events.flatMap(event => event.type === 'handoff' ? [event.handoff] : [])
  const failed = handoffs.find(handoff => handoff.from === 'research')
  assert.ok(failed)
  assert.equal(failed.outcome, 'failed')
  assert.match(failed.summary, /Nothing was concluded/)
  assert.ok(!handoffs.some(handoff => handoff.outcome === 'none' || handoff.task === 'ask'))
  // Nothing runs after the failure: no second search, no decision for the user.
  assert.deepEqual(failing.log, ['connection:draft', 'check', 'check', 'connection:decide', 'research'])
  assert.notEqual(collaborationStages(handoffs).current, 'conflict')

  // An honest empty search is different: the agents go on and may offer the user a real decision.
  const honest = connectionRuntime(() => Promise.resolve({ status: 'none', summary: 'Every beginner class found costs $45 or more.', sources: [], limits: '' }))
  const result = await runCoordinator(connectRequest, honest.runtime, signal(), () => {}, LIMITS)
  assert.equal(result.proposal.kind, 'question')
  assert.equal(result.proposal.conflict?.condition, 'Budget: up to $25')
  assert.ok(result.handoffs.some(handoff => handoff.from === 'research' && handoff.outcome === 'none'))
}))

cases.push(test('sources behind a decision stay citable in the next turn, without counting as new research', async () => {
  // Live run of November 10, 2026: after the user chose the $40 drop-in that research had found (rubysclaystudio.org),
  // the next turn started without that source and proposed the drop-in with no source at all.
  const drop = { id: 'source-1', title: 'Drop-in program', url: 'https://www.rubysclaystudio.org/dropin' }
  const seen: { phase: string; evidence: string[]; earlier: string[] }[] = []
  const candidate = { title: 'Saturday drop-in pottery', description: 'A Saturday afternoon drop-in session under $40.', benefitA: 'Hands-on clay', benefitB: 'Meet people at the studio' }
  const runtime = (cites: string): AgentRuntime => ({
    mode: 'live',
    lead: () => Promise.reject(new Error('unexpected lead')),
    research: () => Promise.reject(new Error('no new search is needed')),
    connection: input => {
      seen.push({ phase: input.phase, evidence: input.evidence?.sources.map(source => source.url) ?? [], earlier: input.earlierSources?.map(source => source.url) ?? [] })
      const step: ConnectionStep = input.phase === 'draft' ? { next: 'check', candidate } : { next: 'propose', opportunity: { ...candidate, sources: [{ title: 'Cited', url: cites }] }, reason: 'Both fit; the drop-in page supports it.' }
      return Promise.resolve(step)
    },
    checkFit: () => Promise.resolve({ fit: 'fits' as const, reason: 'Fits the $40 budget.', conflicts: [], missing: null, verify: 'Budget: up to $40' }),
  })
  const request = { ...connectRequest, trigger: 'manual' as const, note: 'Take the drop-in', priorSources: [drop] }
  const result = await runCoordinator(request, runtime(drop.url), signal(), () => {})
  assert.equal(result.proposal.kind, 'opportunity')
  assert.deepEqual(result.proposal.sources?.map(source => source.url), [drop.url])
  // The decide step saw the earlier source as citable, not as a new research result to build in.
  assert.deepEqual(seen, [{ phase: 'draft', evidence: [], earlier: [drop.url] }, { phase: 'decide', evidence: [], earlier: [drop.url] }])
  // A URL from neither this turn's research nor earlier turns is never cited.
  const invented = await runCoordinator(request, runtime('https://invented.example/class'), signal(), () => {})
  assert.equal(invented.proposal.kind, 'opportunity')
  assert.equal(invented.proposal.sources, undefined)
}))

cases.push(test('a link check that failed is kept for Retry after a reload and is not repeated automatically until a goal changes', () => {
  const chat = (id: string, text: string): Chat => ({ id, title: id, sourceIds: [id], branchIds: [id], operation: 'branch', createdAt: 1, messages: [], memory: { revision: 1, entries: [{ id: `${id}:m`, kind: 'constraint', key: 'other', text, status: 'active', sources: [], by: 'you', createdAt: 1 }] } })
  const base = { sequence: 0, revision: 0, stale: false, dependsOn: [], agent: 'you', createdAt: 0, type: 'inspiration', assetId: 'asset:test', started: true }
  const make = (links: unknown[], text = 'Budget: up to $25'): NodeRecord[] => [
    { id: 'a', node: NodeSchema.parse({ ...base, branchId: 'a', goal: 'Pottery', chats: [chat('a', text)], links }) },
    { id: 'b', node: NodeSchema.parse({ ...base, branchId: 'b', goal: 'People', chats: [chat('b', 'Group: small group')] }) },
  ]
  const [pair] = pairsToScan(make([]), ['a'])
  assert.ok(pair)
  const failed = { otherId: 'b', signature: pair.signature, status: 'error', reason: 'The search could not finish: Claude Code did not reply within 170 seconds.', at: 2 }
  const reloaded = make([JSON.parse(JSON.stringify(failed))])
  const saved = reloaded[0]?.node
  assert.equal(saved?.type === 'inspiration' ? saved.links?.[0]?.status : undefined, 'error')
  assert.deepEqual(pairsToScan(reloaded, ['a']), [])
  assert.equal(pairsToScan(make([failed], 'Budget: up to $45'), ['a']).length, 1)
}))

await Promise.all(cases)
