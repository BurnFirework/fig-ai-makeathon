import { z } from 'zod'
import { isEmpty, isNotEmpty } from './arrays'
import { type AgentEvent, type AgentRequest, type AgentResult, type BranchContext, type Handoff, type MemoryUpdate, type Proposal, type Source, MemoryUpdateSchema } from './schema'

/** Hard bounds for one request: model calls, searches, connection revisions and total time. */
export const LIMITS = { calls: 8, research: 2, revisions: 1, deadlineMs: 240_000 }

const memoryField = z.array(MemoryUpdateSchema).max(8).optional().catch(undefined)
const reason = z.string().max(300).optional()
export const QuestionDraftSchema = z.object({
  prompt: z.string().min(1).max(400),
  options: z.array(z.string().min(1).max(120)).min(2, 'A question needs 2 to 4 short answer options.').transform(options => options.slice(0, 4)),
  purpose: z.string().max(400).default(''),
})
export const ActionDraftSchema = z.object({
  title: z.string().min(1).max(160), description: z.string().max(1200),
  sources: z.array(z.object({ id: z.string().optional(), title: z.string().max(200), url: z.string().max(2000) })).max(6),
})
export const OpportunityDraftSchema = z.object({
  title: z.string().min(1).max(160), description: z.string().max(1200), benefitA: z.string().max(400), benefitB: z.string().max(400),
  /** Required when the idea resembles one the user declined. */
  changed: z.string().max(400).optional(),
})
export type OpportunityDraft = z.infer<typeof OpportunityDraftSchema>
/** A branch (or shared) lead agent chooses its next task. */
export const LeadStepSchema = z.discriminatedUnion('next', [
  z.object({ next: z.literal('ask'), question: QuestionDraftSchema, reason, memory: memoryField }),
  z.object({ next: z.literal('research'), brief: z.string().min(1).max(800), mustMatch: z.array(z.string().max(200)).max(8).default([]), reason, memory: memoryField }),
  z.object({ next: z.literal('propose'), action: ActionDraftSchema, reason, memory: memoryField }),
])
export type LeadStep = z.infer<typeof LeadStepSchema>
/** The connection agent drafts a candidate for both branches to check, then decides from their answers. */
export const ConnectionStepSchema = z.discriminatedUnion('next', [
  z.object({ next: z.literal('ask'), question: QuestionDraftSchema, reason, memory: memoryField }),
  z.object({ next: z.literal('check'), candidate: OpportunityDraftSchema, reason, memory: memoryField }),
  z.object({ next: z.literal('propose'), opportunity: OpportunityDraftSchema, reason, memory: memoryField }),
  z.object({ next: z.literal('revise'), candidate: OpportunityDraftSchema, reason, memory: memoryField }),
])
export type ConnectionStep = z.infer<typeof ConnectionStepSchema>
export const FitCheckSchema = z.object({
  fit: z.enum(['fits', 'partial', 'conflict']), reason: z.string().max(400),
  conflicts: z.array(z.string().max(200)).max(6).default([]),
  /** A missing detail only the user can answer. */
  missing: z.string().max(300).nullish(),
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
  candidate?: OpportunityDraft | undefined; checks?: (FitCheck & { goal: string })[] | undefined; allowed: ConnectionStep['next'][]
}
/** Role implementations: live CLI prompts or deterministic preview agents. */
export interface AgentRuntime {
  mode: 'live' | 'demo'
  lead(input: LeadInput, signal: AbortSignal): Promise<LeadStep>
  research(input: { brief: string; mustMatch: string[]; branches: BranchContext[]; attempt: number }, signal: AbortSignal): Promise<Finding>
  connection(input: ConnectionInput, signal: AbortSignal): Promise<ConnectionStep>
  checkFit(input: { branch: BranchContext; candidate: OpportunityDraft }, signal: AbortSignal): Promise<FitCheck>
}

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
  const call = async <T>(task: (signal: AbortSignal) => Promise<T>): Promise<T> => {
    combined.throwIfAborted()
    if (calls >= limits.calls) throw new OutOfBudget()
    calls++
    try { return await task(combined) } catch (error) {
      if (deadline.aborted && !signal.aborted) throw new Error(`The agents reached the ${Math.round(limits.deadlineMs / 60_000)}-minute limit. Your conversation is saved; please retry.`, { cause: error })
      throw error
    }
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
    const briefs: string[] = []
    report('coordinator', `Asking the ${role === 'branch' ? 'branch' : 'shared'} agent for its next step.`)
    for (;;) {
      const allowed: LeadStep['next'][] = evidence ? (searches < limits.research ? ['propose', 'ask', 'research'] : ['propose', 'ask']) : ['ask', 'research']
      let step: LeadStep
      try {
        step = await call(task => runtime.lead({ role, operation: request.operation, branches, note: request.note, image: evidence ? undefined : request.image, evidence, previousBriefs: briefs, allowed, outcome: request.outcome }, task))
      } catch (error) { if (error instanceof OutOfBudget) return flexibleQuestion(evidence, searches); throw error }
      remember(step)
      if (!allowed.includes(step.next)) return flexibleQuestion(evidence, searches)
      switch (step.next) {
        case 'ask':
          hand({ from: role, fromLabel: roleLabel, to: 'you', task: 'ask', outcome: 'waiting', summary: `${evidence ? (evidence.status === 'none' ? 'After a search without a suitable result, needs' : 'After reviewing the research, needs') : 'Needs'} your answer: ${step.question.prompt}` })
          return question(step.question)
        case 'research': {
          searches++
          briefs.push(step.brief)
          const must = isNotEmpty(step.mustMatch) ? ` · Must fit: ${step.mustMatch.join(' · ')}` : ''
          hand({ from: role, fromLabel: roleLabel, to: 'research', task: evidence ? 'refine-search' : 'research', outcome: 'requested', summary: `${evidence ? 'Search again, more specifically' : 'Find'}: ${step.brief}${must}${evidence && step.reason ? ` — ${step.reason}` : ''}` })
          let finding: Finding
          try {
            finding = await call(task => runtime.research({ brief: step.brief, mustMatch: step.mustMatch, branches, attempt: searches }, task))
          } catch (error) { if (error instanceof OutOfBudget) return flexibleQuestion(evidence, searches); throw error }
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
          return { kind: 'action', title: step.action.title, description: step.action.description, sources: cited }
        }
      }
    }
  }

  async function connect(): Promise<Proposal> {
    const [a, b] = branches
    if (!a || !b) throw new Error('Choose two different branches.')
    report('coordinator', request.focus ? 'Asking the connection agent to revise the proposal with your comment.' : 'Asking the connection agent for a shared direction.')
    let step: ConnectionStep
    try {
      step = await call(task => runtime.connection({ phase: 'draft', branches, note: request.note, focus: request.focus, allowed: ['ask', 'check'] }, task))
    } catch (error) { if (error instanceof OutOfBudget) throw new Error('The connection agent could not finish. Please retry.', { cause: error }); throw error }
    remember(step)
    if (step.next === 'ask') {
      hand({ from: 'connection', to: 'you', task: 'ask', outcome: 'waiting', summary: `Needs your answer before proposing: ${step.question.prompt}` })
      return question(step.question)
    }
    if (step.next !== 'check') throw new Error('The connection agent did not draft a proposal to check. Please retry.')
    let candidate = step.candidate
    let revisions = 0
    for (;;) {
      const declined = resemblesDeclined(candidate.title, branches)
      if (declined && !candidate.changed) {
        if (revisions >= limits.revisions) return pause('The only remaining idea resembles one you declined, so it was not proposed again.', 'What should a shared direction avoid or include this time?', ['Something smaller', 'Something outdoors', 'Something at home'], clip(`You declined “${declined.idea}”${declined.reason ? `: ${declined.reason}` : ''}.`, 380))
        revisions++
        hand({ from: 'coordinator', to: 'connection', task: 'revise', outcome: 'requested', summary: `“${candidate.title}” resembles an idea you declined; asked for a different direction or what changed.` })
        let retry: ConnectionStep
        try { retry = await call(task => runtime.connection({ phase: 'draft', branches, note: `${request.note}\nDo not repeat the declined idea “${declined.idea}” unless you state what changed.`.trim(), focus: request.focus, allowed: ['ask', 'check'] }, task)) } catch (error) { if (error instanceof OutOfBudget) return flexibleQuestion(undefined, 0); throw error }
        remember(retry)
        if (retry.next === 'ask') { hand({ from: 'connection', to: 'you', task: 'ask', outcome: 'waiting', summary: `Needs your answer: ${retry.question.prompt}` }); return question(retry.question) }
        if (retry.next !== 'check') throw new Error('The connection agent did not draft a proposal to check. Please retry.')
        candidate = retry.candidate
        continue
      }
      const current = candidate
      for (const branch of [a, b]) {
        const must = conditions(branch)
        hand({ from: 'connection', to: 'branch', toLabel: label(branch), task: 'check-fit', outcome: 'requested', summary: `Check “${current.title}” against this goal’s intentions and current conditions${isNotEmpty(must) ? ` (${must.slice(0, 4).join(' · ')})` : ''}.` })
      }
      let checks: (FitCheck & { goal: string })[]
      try {
        checks = await Promise.all([a, b].map(branch => call(task => runtime.checkFit({ branch, candidate: current }, task)).then(check => ({ ...check, goal: branch.goal }))))
      } catch (error) { if (error instanceof OutOfBudget) throw new Error('The branch agents could not finish checking. Please retry.', { cause: error }); throw error }
      checks.forEach((check, index) => hand({ from: 'branch', fromLabel: label(branches[index]), to: 'connection', task: 'check-fit', outcome: check.fit,
        summary: `${check.fit === 'fits' ? 'Fits' : check.fit === 'partial' ? 'Partly fits' : 'Conflicts'}: ${check.reason}${isNotEmpty(check.conflicts) ? ` · ${check.conflicts.join('; ')}` : ''}${check.missing ? ` · Missing: ${check.missing}` : ''}` }))
      const finalize = (draft: OpportunityDraft, summary: string): Proposal => {
        hand({ from: 'connection', to: 'you', task: 'propose', outcome: 'proposed', summary })
        return { kind: 'opportunity', title: draft.title, description: draft.changed ? `${draft.description}\n\nWhat changed since a similar idea was declined: ${draft.changed}` : draft.description, benefitA: draft.benefitA, benefitB: draft.benefitB }
      }
      if (checks.every(check => check.fit === 'fits' && !check.missing)) return finalize(current, `Proposed “${current.title}” after both branch agents confirmed it fits. Waiting for your decision.`)
      const allowed: ConnectionStep['next'][] = revisions < limits.revisions ? ['ask', 'propose', 'revise'] : ['ask', 'propose']
      let decision: ConnectionStep
      try {
        decision = await call(task => runtime.connection({ phase: 'decide', branches, note: request.note, focus: request.focus, candidate: current, checks, allowed }, task))
      } catch (error) {
        if (!(error instanceof OutOfBudget)) throw error
        return pause('Reached the coordination limit while the branches disagreed.', 'Which goal should guide the shared direction?', [label(a), label(b), 'Find a compromise'], clip(checks.map(check => `${check.goal}: ${check.reason}`).join(' · '), 380))
      }
      remember(decision)
      if (!allowed.includes(decision.next)) return pause('The branches still disagreed after a revision.', 'Which goal should guide the shared direction?', [label(a), label(b), 'Find a compromise'], clip(checks.map(check => `${check.goal}: ${check.reason}`).join(' · '), 380))
      switch (decision.next) {
        case 'ask':
          hand({ from: 'connection', to: 'you', task: 'ask', outcome: 'waiting', summary: `The branch checks need your input: ${decision.question.prompt}` })
          return question(decision.question)
        case 'propose':
          return finalize(decision.opportunity, `Adjusted the proposal after the branch checks${decision.reason ? `: ${decision.reason}` : ''}. Waiting for your decision.`)
        case 'revise':
          revisions++
          hand({ from: 'connection', to: 'connection', task: 'revise', outcome: 'requested', summary: `Revised the direction to resolve the conflicts${decision.reason ? `: ${decision.reason}` : ''}; checking again.` })
          candidate = decision.candidate
          continue
        case 'check':
          throw new Error('The connection agent returned an unsupported step. Please retry.')
      }
    }
  }

  const proposal = request.operation === 'connect' ? await connect() : await lead()
  combined.throwIfAborted()
  return { requestId: request.requestId, proposal, activity, mode: runtime.mode, handoffs: handoffs.slice(-24), memory }
}
