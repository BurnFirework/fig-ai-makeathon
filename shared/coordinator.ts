import { z } from 'zod'
import { isEmpty, isNotEmpty } from './arrays'
import { type AgentEvent, type AgentRequest, type AgentResult, type BranchContext, type Conflict, type Handoff, type MemoryUpdate, type Proposal, type Source, MemoryUpdateSchema } from './schema'

/** Hard bounds for one request: model calls, searches, connection revisions and total time. */
export const LIMITS = { calls: 10, research: 2, revisions: 2, deadlineMs: 480_000 }

const memoryField = z.array(MemoryUpdateSchema).max(8).optional().catch(undefined)
const reason = z.string().max(300).optional()
/** What blocks a shared idea, what that is based on, and what each answer would change (one effect per option). */
export const ConflictDraftSchema = z.object({ condition: z.string().min(1).max(240), basis: z.string().max(600).default(''), effects: z.array(z.string().max(240)).max(4).default([]) })
export const QuestionDraftSchema = z.object({
  prompt: z.string().min(1).max(400),
  options: z.array(z.string().min(1).max(120)).min(2, 'A question needs 2 to 4 short answer options.').transform(options => options.slice(0, 4)),
  purpose: z.string().max(400).default(''),
  conflict: ConflictDraftSchema.optional().catch(undefined),
})
const short = (max: number) => z.string().transform(text => text.replace(/\s+/g, ' ').trim().slice(0, max))
export const ActionDraftSchema = z.object({
  title: z.string().min(1).max(160), description: z.string().max(1200).default(''),
  summary: short(300).optional().catch(undefined),
  steps: z.array(short(200)).transform(steps => steps.filter(Boolean).slice(0, 4)).optional().catch(undefined),
  meta: z.object({ time: short(40).optional(), cost: short(40).optional(), place: short(60).optional() }).optional().catch(undefined),
  sources: z.array(z.object({ id: z.string().optional(), title: z.string().max(200), url: z.string().max(2000) })).max(6),
})
export type ActionDraft = z.infer<typeof ActionDraftSchema>
/** The proposal for a drafted step: only the structured fields the agent actually filled in. */
export function actionProposal(draft: ActionDraft, sources: Source[]): Extract<Proposal, { kind: 'action' }> {
  const meta = Object.fromEntries(Object.entries(draft.meta ?? {}).filter(([, value]) => Boolean(value))) as NonNullable<ActionDraft['meta']>
  return {
    kind: 'action', title: draft.title, description: draft.description, sources,
    ...(draft.summary ? { summary: draft.summary } : {}),
    ...(draft.steps && isNotEmpty(draft.steps) ? { steps: draft.steps } : {}),
    ...(isNotEmpty(Object.keys(meta)) ? { meta } : {}),
  }
}
export const OpportunityDraftSchema = z.object({
  title: z.string().min(1).max(160), description: z.string().max(1200), benefitA: z.string().max(400), benefitB: z.string().max(400),
  /** Required when the idea resembles one the user declined. */
  changed: z.string().max(400).optional(),
  /** Research sources the idea relies on; only URLs the research agent returned count. */
  sources: z.array(z.object({ title: z.string().max(200), url: z.string().max(2000) })).max(6).optional().catch(undefined),
})
export type OpportunityDraft = z.infer<typeof OpportunityDraftSchema>
/** A branch (or shared) lead agent chooses its next task. */
export const LeadStepSchema = z.discriminatedUnion('next', [
  z.object({ next: z.literal('ask'), question: QuestionDraftSchema, reason, memory: memoryField }),
  z.object({ next: z.literal('research'), brief: z.string().min(1).max(800), mustMatch: z.array(z.string().max(200)).max(8).default([]), reason, memory: memoryField }),
  z.object({ next: z.literal('propose'), action: ActionDraftSchema, reason, memory: memoryField }),
])
export type LeadStep = z.infer<typeof LeadStepSchema>
/**
 * The connection agent notices (or rules out) an overlap, drafts a candidate for both branches to check,
 * then chooses what the shared idea needs next: research, a revision, the user's decision, or nothing more.
 */
export const ConnectionStepSchema = z.discriminatedUnion('next', [
  z.object({ next: z.literal('none'), reason: z.string().min(1).max(400), memory: memoryField }),
  z.object({ next: z.literal('ask'), question: QuestionDraftSchema, reason, memory: memoryField }),
  z.object({ next: z.literal('check'), candidate: OpportunityDraftSchema, reason, memory: memoryField }),
  z.object({ next: z.literal('research'), brief: z.string().min(1).max(800), mustMatch: z.array(z.string().max(200)).max(8).default([]), reason, memory: memoryField }),
  z.object({ next: z.literal('propose'), opportunity: OpportunityDraftSchema, reason, memory: memoryField }),
  z.object({ next: z.literal('revise'), candidate: OpportunityDraftSchema, reason, memory: memoryField }),
])
export type ConnectionStep = z.infer<typeof ConnectionStepSchema>
export const FitCheckSchema = z.object({
  fit: z.enum(['fits', 'partial', 'conflict']), reason: z.string().max(400),
  conflicts: z.array(z.string().max(200)).max(6).default([]),
  /** A missing detail only the user can answer. */
  missing: z.string().max(300).nullish(),
  /** A condition only real data can confirm (a price, a schedule, a place). */
  verify: z.string().max(300).nullish(),
})
export type FitCheck = z.infer<typeof FitCheckSchema>
export interface Finding { status: 'found' | 'none'; summary: string; sources: Source[]; limits: string }

export interface LeadInput {
  role: 'branch' | 'connection'; operation: AgentRequest['operation']; branches: BranchContext[]; note: string
  image?: string | undefined; evidence?: Finding | undefined; previousBriefs: string[]; allowed: LeadStep['next'][]
  /** The conversation continues from this outcome; agents build beyond it instead of repeating it. */
  outcome?: { title: string; description: string } | undefined
}
export interface ConnectionInput {
  phase: 'draft' | 'decide'; branches: BranchContext[]; note: string; focus?: AgentRequest['focus']
  trigger?: AgentRequest['trigger']
  candidate?: OpportunityDraft | undefined; checks?: (FitCheck & { goal: string })[] | undefined; allowed: ConnectionStep['next'][]
  /** Research result the connection agent has not yet built into the candidate. */
  evidence?: Finding | undefined; previousBriefs?: string[] | undefined
  /** Sources found earlier in this conversation; citable, but the user's latest decision decides whether they still apply. */
  earlierSources?: Source[] | undefined
}
/**
 * A step that produced no usable reply: unreadable output, a failed CLI or a timeout. It is a technical failure,
 * never a finding: it must not read as “nothing suitable exists” or lead to changing the user's conditions.
 */
export class AgentFailure extends Error {
  constructor(message: string, options?: ErrorOptions) { super(message, options); this.name = 'AgentFailure' }
}
/** Extra model calls a step may need (for example one correction of an unreadable reply), taken from the request's call budget. */
export interface Budget { spend(): boolean }
/** Role implementations: live CLI prompts or deterministic preview agents. */
export interface AgentRuntime {
  mode: 'live' | 'demo'
  lead(input: LeadInput, signal: AbortSignal, budget?: Budget): Promise<LeadStep>
  research(input: { brief: string; mustMatch: string[]; branches: BranchContext[]; attempt: number }, signal: AbortSignal, budget?: Budget): Promise<Finding>
  connection(input: ConnectionInput, signal: AbortSignal, budget?: Budget): Promise<ConnectionStep>
  checkFit(input: { branch: BranchContext; candidate: OpportunityDraft }, signal: AbortSignal, budget?: Budget): Promise<FitCheck>
}

/** A reason folded into a longer sentence, without its own closing punctuation. */
const because = (reason: string | undefined) => reason ? `: ${reason.replace(/[.!?;\s]+$/u, '')}` : ''
const clip = (text: string, length = 140) => { const value = text.replace(/\s+/g, ' ').trim(); return value.length > length ? `${value.slice(0, length - 1)}…` : value }
const label = (branch: BranchContext | undefined) => clip(branch?.goal ?? 'this goal', 60)
const normalize = (text: string) => text.toLowerCase().replace(/[^\p{L}\p{N}]+/gu, ' ').trim()
const plural = (count: number, word: string) => `${count} ${word}${count === 1 ? '' : 's'}`
export const sameUrl = (a: string, b: string) => a === b || a.replace(/\/$/, '') === b.replace(/\/$/, '')
const conditions = (branch: BranchContext) => branch.memory.filter(item => item.kind === 'constraint').map(item => item.text)

export function resemblesDeclined(title: string, branches: BranchContext[]) {
  const value = normalize(title)
  return branches.flatMap(branch => branch.declined).find(item => { const idea = normalize(item.idea); return idea.length > 3 && (idea === value || idea.includes(value) || value.includes(idea)) })
}

class OutOfBudget extends Error {}

export async function runCoordinator(request: AgentRequest, runtime: AgentRuntime, signal: AbortSignal, emit: (event: AgentEvent) => void, limits = LIMITS): Promise<AgentResult> {
  const deadline = AbortSignal.timeout(limits.deadlineMs)
  const combined = AbortSignal.any([signal, deadline])
  const handoffs: Handoff[] = []
  const activity: AgentResult['activity'] = []
  const memory: MemoryUpdate[] = []
  let calls = 0
  const report = (role: AgentResult['activity'][number]['role'], message: string) => { combined.throwIfAborted(); activity.push({ role, message }); emit({ type: 'activity', role, message }) }
  const hand = (handoff: Handoff) => { combined.throwIfAborted(); handoffs.push({ ...handoff, summary: clip(handoff.summary, 480) }); emit({ type: 'handoff', handoff: handoffs[handoffs.length - 1] ?? handoff }) }
  const budget: Budget = { spend: () => { if (calls >= limits.calls) return false; calls++; return true } }
  const call = async <T>(task: (signal: AbortSignal, budget: Budget) => Promise<T>): Promise<T> => {
    combined.throwIfAborted()
    if (!budget.spend()) throw new OutOfBudget()
    try { return await task(combined, budget) } catch (error) {
      if (deadline.aborted && !signal.aborted) throw new Error(`The agents reached the ${Math.round(limits.deadlineMs / 60_000)}-minute limit. Your conversation is saved; please retry.`, { cause: error })
      throw error
    }
  }
  /** Briefs this request sent to the research agent. */
  const searchesRun: string[] = []
  /** A search that could not finish is reported as such and stops the request: no conclusion is drawn from it. */
  const searchFailed = (error: unknown, to: 'branch' | 'connection', toLabel?: string) => {
    if (error instanceof OutOfBudget || combined.aborted) return
    hand({ from: 'research', to, ...(toLabel ? { toLabel } : {}), task: 'research', outcome: 'failed', summary: `The search did not complete: ${error instanceof Error ? error.message : 'unknown error'} Nothing was concluded about available options.` })
  }
  const remember = (step: { memory?: MemoryUpdate[] | undefined }) => { for (const update of step.memory ?? []) if (memory.length < 8) memory.push(update) }
  const branches = request.branches
  const question = (draft: z.infer<typeof QuestionDraftSchema>): Proposal => ({ kind: 'question', prompt: draft.prompt, options: draft.options, purpose: draft.purpose })

  /** When the bounded chain cannot finish, pause and ask one question instead of inventing a result. */
  const pause = (why: string, prompt: string, options: string[], purpose: string): Proposal => {
    hand({ from: 'coordinator', to: 'you', task: 'limit', outcome: 'stopped', summary: why })
    const unique = [...new Set(options.map(option => clip(option, 110)))].slice(0, 4)
    return { kind: 'question', prompt, options: unique.length >= 2 ? unique : [...unique, 'Try a different idea', 'Keep exploring'].slice(0, Math.max(2, unique.length)), purpose }
  }
  const flexibleQuestion = (last: Finding | undefined, searches: number): Proposal => pause(
    `Stopped after ${plural(searches, 'search')} without a verified match, so nothing was invented.`,
    'I couldn’t verify an option that fits all your conditions. Which one could change?',
    [...branches.flatMap(conditions).slice(0, 3), 'Try a different idea'],
    clip(last?.summary ? `Last search: ${last.summary}` : 'Search did not return verifiable sources.', 380),
  )

  async function lead(): Promise<Proposal> {
    const role = branches.length === 2 ? 'connection' : 'branch'
    const roleLabel = branches.length === 2 ? `${label(branches[0])} + ${label(branches[1])}` : label(branches[0])
    let evidence: Finding | undefined
    let searches = 0
    const briefs: string[] = [...(request.priorBriefs ?? [])]
    report('coordinator', `Asking the ${role === 'branch' ? 'branch' : 'shared'} agent for its next step.`)
    // An accepted shared direction already carries sources the research agent verified; the next step can build on them.
    const carried = request.operation === 'research' ? request.outcome?.sources ?? [] : []
    if (isNotEmpty(carried) && request.outcome) {
      evidence = { status: 'found', summary: `Sources found while connecting the goals for “${request.outcome.title}”.`, sources: carried, limits: 'Found before you accepted the direction; check dates and prices on the page.' }
      hand({ from: 'coordinator', to: role, toLabel: roleLabel, task: 'research', outcome: 'found', summary: `Passed on ${plural(carried.length, 'source')} from the accepted shared direction: ${carried.map(source => source.title).slice(0, 2).join('; ')}.` })
    }
    for (;;) {
      const allowed: LeadStep['next'][] = evidence ? (searches < limits.research ? ['propose', 'ask', 'research'] : ['propose', 'ask']) : ['ask', 'research']
      let step: LeadStep
      try {
        step = await call((task, spend) => runtime.lead({ role, operation: request.operation, branches, note: request.note, image: evidence ? undefined : request.image, evidence, previousBriefs: briefs, allowed, outcome: request.outcome }, task, spend))
      } catch (error) { if (error instanceof OutOfBudget) return flexibleQuestion(evidence, searches); throw error }
      remember(step)
      if (!allowed.includes(step.next)) return flexibleQuestion(evidence, searches)
      switch (step.next) {
        case 'ask':
          hand({ from: role, fromLabel: roleLabel, to: 'you', task: 'ask', outcome: 'waiting', summary: `${evidence ? (evidence.status === 'none' ? 'After a search without a suitable result, needs' : 'After reviewing the research, needs') : 'Needs'} your answer: ${step.question.prompt}` })
          return question(step.question)
        case 'research': {
          searches++
          briefs.push(step.brief); searchesRun.push(step.brief)
          const must = isNotEmpty(step.mustMatch) ? ` · Must fit: ${step.mustMatch.join(' · ')}` : ''
          hand({ from: role, fromLabel: roleLabel, to: 'research', task: evidence ? 'refine-search' : 'research', outcome: 'requested', summary: `${evidence ? 'Search again, more specifically' : 'Find'}: ${step.brief}${must}${evidence && step.reason ? ` — ${step.reason}` : ''}` })
          let finding: Finding
          try {
            finding = await call((task, spend) => runtime.research({ brief: step.brief, mustMatch: step.mustMatch, branches, attempt: searches }, task, spend))
          } catch (error) { if (error instanceof OutOfBudget) return flexibleQuestion(evidence, searches); searchFailed(error, role, roleLabel); throw error }
          hand({ from: 'research', to: role, toLabel: roleLabel, task: 'research', outcome: finding.status,
            summary: finding.status === 'found'
              ? `Found ${plural(finding.sources.length, runtime.mode === 'live' ? 'source seen in its search results' : 'example source')}: ${finding.sources.map(source => source.title).slice(0, 2).join('; ')}.${finding.limits ? ` Not verified: ${finding.limits}` : ''}`
              : `No suitable verified result. ${finding.summary}${finding.limits ? ` ${finding.limits}` : ''}` })
          evidence = finding
          continue
        }
        case 'propose': {
          const known = evidence?.status === 'found' ? evidence.sources : []
          const cited = step.action.sources.flatMap(source => known.filter(item => sameUrl(item.url, source.url))).filter((source, index, all) => all.indexOf(source) === index)
          if (isEmpty(cited)) return flexibleQuestion(evidence, searches)
          // A step that is already on the board is not progress: pause and ask what would help next.
          const done = [request.outcome?.title, ...branches.flatMap(branch => branch.previousSuggestions)].filter((title): title is string => Boolean(title)).find(title => normalize(title) === normalize(step.action.title))
          if (done) return pause(`“${step.action.title}” is already part of this exploration, so it was not proposed again.`, `“${clip(done, 80)}” is already on your board. What would help most now?`, ['I did it — what comes next?', 'Something easier to start', 'A different kind of step'], 'Agents build on what you already have instead of repeating it.')
          hand({ from: role, fromLabel: roleLabel, to: 'you', task: 'propose', outcome: 'proposed', summary: `Proposed “${step.action.title}” using ${plural(cited.length, 'cited source')} from the research.` })
          return actionProposal(step.action, cited)
        }
      }
    }
  }

  async function connect(): Promise<Proposal> {
    const [a, b] = branches
    if (!a || !b) throw new Error('Choose two different branches.')
    const pair = [a, b]
    report('coordinator', request.focus ? 'Asking the connection agent to revise the proposal with your comment.' : request.trigger === 'auto' ? 'Two goals developed separately; asking the connection agent whether they overlap.' : 'Asking the connection agent for a shared direction.')
    const briefs = [...(request.priorBriefs ?? [])]
    let searches = 0
    let evidence: Finding | undefined
    /** `fresh`: evidence the candidate has not been revised with yet; proposing now would skip the branch checks. */
    const flow = { fresh: false }
    let candidate: OpportunityDraft | undefined
    let version = 0
    let checkedVersion = -1
    let checks: (FitCheck & { goal: string })[] = []
    let revisions = 0
    // Sources found earlier in this conversation (for example the basis of the decision the user just made) stay citable.
    // They are not new research: whether they still apply depends on the user's decision, so nothing is built on them automatically.
    const carried = request.priorSources ?? []
    const known = () => [...(evidence?.status === 'found' ? evidence.sources : []), ...carried.filter(source => !(evidence?.status === 'found' && evidence.sources.some(item => sameUrl(item.url, source.url))))]
    const conflicting = () => checks.filter(check => check.fit === 'conflict')

    /** The decision only the user can make, with what blocks the idea and what it is based on. */
    const conflictOf = (draft?: z.infer<typeof ConflictDraftSchema>, options: string[] = []): Conflict | undefined => {
      const blocking = conflicting()
      const failedSearch = evidence?.status === 'none'
      if (!draft && isEmpty(blocking) && !failedSearch) return undefined
      const condition = draft?.condition ?? blocking.flatMap(check => isNotEmpty(check.conflicts) ? check.conflicts : [check.reason])[0] ?? 'No verified option matched every condition'
      const basis = draft?.basis || [...blocking.map(check => `${label(pair.find(item => item.goal === check.goal))}: ${check.reason}`), ...(evidence ? [`Research: ${evidence.summary}${evidence.limits ? ` (${evidence.limits})` : ''}`] : [])].join(' · ')
      const effects = draft?.effects.length === options.length ? draft.effects : []
      return { condition: clip(condition, 230), basis: clip(basis, 590), sources: known().slice(0, 4), effects: effects.map(effect => clip(effect, 230)) }
    }
    const ask = (draft: z.infer<typeof QuestionDraftSchema>, from: 'connection', why: string): Proposal => {
      const conflict = conflictOf(draft.conflict, draft.options)
      hand({ from, to: 'you', task: 'ask', outcome: 'waiting', summary: `${conflict ? `Needs your decision on “${clip(conflict.condition, 80)}”` : why}: ${draft.prompt}` })
      return { ...question(draft), ...(conflict ? { conflict } : {}) }
    }
    /** When the agents cannot settle a conflict within the limits, the user chooses; nothing is decided for them. */
    const decisionPause = (why: string): Proposal => {
      const conflict = conflictOf()
      if (!conflict) {
        const missing = checks.find(check => check.missing)?.missing
        return pause(why, missing ? clip(missing, 200) : 'Which goal should guide the shared direction?', missing ? ['I’ll answer below', 'Try a different idea'] : [label(a), label(b), 'Find a compromise'], clip(checks.map(check => `${check.goal}: ${check.reason}`).join(' · ') || 'The agents could not agree on one idea.', 380))
      }
      hand({ from: 'coordinator', to: 'you', task: 'limit', outcome: 'stopped', summary: why })
      const short = clip(conflict.condition, 60)
      return { kind: 'question', prompt: `“${candidate ? clip(candidate.title, 60) : 'This shared idea'}” conflicts with “${short}”. What should change?`, options: [`Keep “${short}”`, `Relax “${short}”`], purpose: 'The agents won’t change a confirmed condition for you.',
        conflict: { ...conflict, effects: ['Agents keep this condition and look for a different option.', 'Agents treat this condition as flexible and check both goals again.'] } }
    }
    const none = (reason: string): Proposal => {
      hand({ from: 'connection', to: 'coordinator', task: 'overlap', outcome: 'none', summary: `No useful overlap: ${reason}` })
      return { kind: 'none', reason: clip(reason, 390) }
    }
    const cite = (draft: OpportunityDraft) => (draft.sources ?? []).flatMap(source => known().filter(item => sameUrl(item.url, source.url))).filter((source, index, all) => all.indexOf(source) === index)
    const finalize = (draft: OpportunityDraft, summary: string, extra: string[] = []): Proposal => {
      const sources = cite(draft)
      const openPoints = [...checks.filter(check => check.fit === 'partial').map(check => `${label(pair.find(item => item.goal === check.goal))}: ${check.reason}`), ...checks.flatMap(check => check.verify ? [`${isNotEmpty(sources) ? 'Check on the source page' : 'Not verified yet'}: ${check.verify}`] : []), ...extra].map(point => clip(point, 230)).slice(0, 3)
      hand({ from: 'connection', to: 'you', task: 'propose', outcome: 'proposed', summary: `${summary}${isNotEmpty(sources) ? ` Cites ${plural(sources.length, 'source')} from the research.` : ''}` })
      return { kind: 'opportunity', title: draft.title, description: draft.changed ? `${draft.description}\n\nWhat changed since a similar idea was declined: ${draft.changed}` : draft.description, benefitA: draft.benefitA, benefitB: draft.benefitB,
        ...(isNotEmpty(sources) ? { sources } : {}), ...(isNotEmpty(openPoints) ? { openPoints } : {}) }
    }
    /** Same idea, ignoring which sources it cites. */
    const same = (x: OpportunityDraft, y: OpportunityDraft) => [x.title, x.description, x.benefitA, x.benefitB].map(normalize).join('|') === [y.title, y.description, y.benefitA, y.benefitB].map(normalize).join('|')
    /** A new version of the shared idea. Checks of an earlier version never count for it. */
    const adopt = (next: OpportunityDraft) => {
      const first = !candidate
      candidate = next; version++; flow.fresh = false
      if (first) hand({ from: 'connection', to: 'coordinator', task: 'overlap', outcome: 'found', summary: `Possible overlap: “${next.title}”. Both goals will check it.` })
    }
    const step = async (input: Omit<ConnectionInput, 'branches' | 'note' | 'focus' | 'trigger' | 'previousBriefs'>): Promise<ConnectionStep | undefined> => {
      try {
        const result = await call((task, spend) => runtime.connection({ ...input, branches, note: request.note, focus: request.focus, trigger: request.trigger, previousBriefs: briefs, ...(isNotEmpty(carried) ? { earlierSources: carried } : {}) }, task, spend))
        remember(result)
        // A "propose" that changes the idea is a revision: it goes back to both branches instead of past them.
        if (result.next === 'propose' && candidate && !same(result.opportunity, candidate) && input.allowed.includes('revise')) return { next: 'revise', candidate: result.opportunity, reason: result.reason, memory: result.memory }
        return input.allowed.includes(result.next) ? result : undefined
      } catch (error) { if (error instanceof OutOfBudget) return undefined; throw error }
    }
    const research = async (draft: { brief: string; mustMatch: string[]; reason?: string | undefined }): Promise<boolean> => {
      if (briefs.some(brief => normalize(brief) === normalize(draft.brief))) return false
      searches++
      briefs.push(draft.brief); searchesRun.push(draft.brief)
      const refine = evidence !== undefined || (request.priorBriefs?.length ?? 0) > 0
      const must = isNotEmpty(draft.mustMatch) ? ` · Must fit: ${draft.mustMatch.join(' · ')}` : ''
      hand({ from: 'connection', to: 'research', task: refine ? 'refine-search' : 'research', outcome: 'requested', summary: `${refine ? 'Search again, more specifically' : 'Find a real option'}: ${draft.brief}${must}${draft.reason ? ` — ${draft.reason}` : ''}` })
      let finding: Finding
      try { finding = await call((task, spend) => runtime.research({ brief: draft.brief, mustMatch: draft.mustMatch, branches, attempt: searches }, task, spend)) } catch (error) { if (error instanceof OutOfBudget) return false; searchFailed(error, 'connection'); throw error }
      hand({ from: 'research', to: 'connection', task: 'research', outcome: finding.status,
        summary: finding.status === 'found'
          ? `Found ${plural(finding.sources.length, runtime.mode === 'live' ? 'source seen in its search results' : 'example source')}: ${finding.summary}${finding.limits ? ` Not verified: ${finding.limits}` : ''}`
          : `No suitable verified option. ${finding.summary}${finding.limits ? ` ${finding.limits}` : ''}` })
      evidence = finding; flow.fresh = true
      return true
    }

    const first = await step({ phase: 'draft', allowed: ['none', 'ask', 'check', ...(searches < limits.research ? ['research' as const] : [])] })
    if (!first) throw new Error('The connection agent could not finish. Please retry.')
    switch (first.next) {
      case 'none': return none(first.reason)
      case 'ask': return ask(first.question, 'connection', 'Needs your answer before proposing')
      case 'check': adopt(first.candidate); break
      case 'research': if (!await research(first)) return flexibleQuestion(evidence, searches); break
      case 'propose': case 'revise': throw new Error('The connection agent returned an unsupported step. Please retry.')
    }
    for (;;) {
      if (candidate && version !== checkedVersion) {
        const current = candidate
        const declined = resemblesDeclined(current.title, branches)
        if (declined && !current.changed) {
          if (revisions >= limits.revisions) return pause('The only remaining idea resembles one you declined, so it was not proposed again.', 'What should a shared direction avoid or include this time?', ['Something smaller', 'Something outdoors', 'Something at home'], clip(`You declined “${declined.idea}”${declined.reason ? `: ${declined.reason}` : ''}.`, 380))
          revisions++
          hand({ from: 'coordinator', to: 'connection', task: 'revise', outcome: 'requested', summary: `“${current.title}” resembles an idea you declined; asked for a different direction or what changed.` })
          const retry = await step({ phase: 'draft', allowed: ['none', 'ask', 'check'] })
          if (!retry) return flexibleQuestion(undefined, 0)
          if (retry.next === 'none') return none(retry.reason)
          if (retry.next === 'ask') return ask(retry.question, 'connection', 'Needs your answer')
          if (retry.next !== 'check') throw new Error('The connection agent did not draft a proposal to check. Please retry.')
          candidate = retry.candidate; version++
          continue
        }
        for (const branch of pair) {
          const must = conditions(branch)
          hand({ from: 'connection', to: 'branch', toLabel: label(branch), task: 'check-fit', outcome: 'requested', summary: `Check ${version > 1 ? 'the revised ' : ''}“${current.title}” against this goal’s intentions and current conditions${isNotEmpty(must) ? ` (${must.slice(0, 4).join(' · ')})` : ''}.` })
        }
        try {
          checks = await Promise.all(pair.map(branch => call((task, spend) => runtime.checkFit({ branch, candidate: current }, task, spend)).then(check => ({ ...check, goal: branch.goal }))))
        } catch (error) { if (error instanceof OutOfBudget) return decisionPause('Reached the coordination limit before both goals could check the idea.'); throw error }
        checkedVersion = version
        checks.forEach((check, index) => hand({ from: 'branch', fromLabel: label(pair[index]), to: 'connection', task: 'check-fit', outcome: check.fit,
          summary: `${check.fit === 'fits' ? 'Fits' : check.fit === 'partial' ? 'Partly fits' : 'Conflicts'}: ${check.reason}${isNotEmpty(check.conflicts) ? ` · ${check.conflicts.join('; ')}` : ''}${check.missing ? ` · Missing: ${check.missing}` : ''}${check.verify ? ` · Needs real data: ${check.verify}` : ''}` }))
        const researched = evidence !== undefined
        if (checks.every(check => check.fit === 'fits' && !check.missing && (!check.verify || researched || searches >= limits.research))) return finalize(current, `Proposed “${current.title}” after both branch agents confirmed it fits. Waiting for your decision.`)
      }
      const blocked = isNotEmpty(conflicting())
      const allowed: ConnectionStep['next'][] = ['ask', 'none',
        ...(candidate && !flow.fresh && !blocked ? ['propose' as const] : []),
        ...(revisions < limits.revisions || !candidate ? ['revise' as const] : []),
        ...(searches < limits.research ? ['research' as const] : [])]
      const decision = await step({ phase: 'decide', candidate, checks, evidence: flow.fresh ? evidence : undefined, allowed })
      if (!decision) return decisionPause(blocked ? 'The goals still conflict and the agents reached their limit, so the choice is yours.' : 'Reached the coordination limit before the agents agreed.')
      switch (decision.next) {
        case 'none': return none(decision.reason)
        case 'ask': return ask(decision.question, 'connection', 'The branch checks need your input')
        case 'research':
          if (!await research(decision)) return decisionPause('The agents had no new search to try, so the choice is yours.')
          continue
        case 'propose': {
          if (!candidate) throw new Error('The connection agent returned an unsupported step. Please retry.')
          if (same(decision.opportunity, candidate)) return finalize({ ...candidate, ...(decision.opportunity.sources ? { sources: decision.opportunity.sources } : {}) }, `Proposed “${candidate.title}” after the branch checks${because(decision.reason)}. Waiting for your decision.`)
          // A changed idea is a new version: both goals check it again before it is shown.
          if (revisions >= limits.revisions) return finalize(candidate, `Proposed the version both goals checked, “${candidate.title}”.`, ['The connection agent suggested further changes that were not checked by both goals.'])
          revisions++
          hand({ from: 'connection', to: 'connection', task: 'revise', outcome: 'requested', summary: `Changed the idea after the branch checks${because(decision.reason)}; both goals check the new version.` })
          adopt(decision.opportunity)
          continue
        }
        case 'revise':
          if (candidate) {
            revisions++
            hand({ from: 'connection', to: 'connection', task: 'revise', outcome: 'requested', summary: `${flow.fresh ? 'Built the research into the idea' : 'Revised the idea to resolve the conflicts'}${because(decision.reason)}; both goals check it again.` })
          }
          adopt(decision.candidate)
          continue
        case 'check':
          throw new Error('The connection agent returned an unsupported step. Please retry.')
      }
    }
  }

  const proposal = request.operation === 'connect' ? await connect() : await lead()
  combined.throwIfAborted()
  return { requestId: request.requestId, proposal, activity, mode: runtime.mode, handoffs: handoffs.slice(-24), memory, searches: searchesRun.slice(0, 6) }
}

/** The short states of shared work, in the order a connection usually moves through them. */
export const STAGES = ['overlap', 'checking', 'researching', 'conflict', 'decision', 'ready'] as const
export type Stage = typeof STAGES[number] | 'none'
/**
 * Reads the coordinator's own handoffs into collaboration states, so the chat shows what actually happened.
 * Returns the current state and every state reached on the way.
 */
export function collaborationStages(handoffs: Handoff[]): { current: Stage | undefined; reached: Stage[] } {
  const reached: Stage[] = []
  let current: Stage | undefined
  const reach = (stage: Stage) => { current = stage; if (!reached.includes(stage)) reached.push(stage) }
  for (const handoff of handoffs) {
    if (handoff.task === 'overlap') reach(handoff.outcome === 'none' ? 'none' : 'overlap')
    else if (handoff.task === 'check-fit' && handoff.outcome === 'requested') reach('checking')
    else if (handoff.task === 'check-fit' && handoff.outcome === 'conflict') reach('conflict')
    else if ((handoff.task === 'research' || handoff.task === 'refine-search') && handoff.outcome === 'requested') reach('researching')
    else if (handoff.task === 'research' && handoff.outcome === 'none') reach('conflict')
    else if (handoff.to === 'you' && (handoff.task === 'ask' || handoff.task === 'limit')) reach('decision')
    else if (handoff.to === 'you' && handoff.task === 'propose') reach('ready')
  }
  return { current, reached }
}
