import { isEmpty, isNotEmpty } from './arrays'
import type { AgentRuntime } from './coordinator'
import type { AgentRequest, BranchContext, Proposal } from './schema'

export function demoProposal(request: AgentRequest): Proposal {
  const first = request.branches[0]
  if (!first) throw new Error('Choose an inspiration first.')
  if (request.operation === 'connect') return { kind: 'opportunity', title: 'A first experience, together', description: `Explore “${first.goal}” alongside “${request.branches[1]?.goal || 'your second inspiration'}” in one small, shared experience. This is an example proposal; availability has not been checked.`, benefitA: `Try ${first.goal.toLowerCase()} without a big commitment.`, benefitB: `Make room for ${request.branches[1]?.goal.toLowerCase() || 'your other goal'} at the same time.` }
  if (request.operation === 'research' || first.answers.length >= 2) return { kind: 'action', title: 'Find one beginner-friendly session', description: `Example next step: use the linked directory to find one session related to ${first.goal.toLowerCase()}. Check location, price and availability against your answers: ${first.answers.map(a => a.answer).join('; ') || 'your preferences'}. No live search was performed in preview mode.`, sources: [{ id: 'example-source', title: 'Example directory · Eventbrite', url: 'https://www.eventbrite.com/d/online/classes/' }] }
  if (isEmpty(first.answers)) return { kind: 'question', prompt: `What draws you to ${first.goal.toLowerCase()} — would you like to try it yourself?`, options: ['Yes, I want to try', 'Just exploring'], purpose: 'Find the part of this inspiration that feels like you.' }
  return { kind: 'question', prompt: `What would make a first step toward ${first.goal.toLowerCase()} feel manageable?`, options: ['One hour, low budget', 'An afternoon with others'], purpose: `Your last answer was “${first.answers.at(-1)?.answer || ''}”. Add a location, budget or time limit below.` }
}

const wait = (signal: AbortSignal, ms: number) => new Promise<void>((resolve, reject) => {
  const abort = () => { clearTimeout(timer); reject(new Error('Stopped.')) }
  const timer = setTimeout(() => { signal.removeEventListener('abort', abort); resolve() }, ms)
  signal.addEventListener('abort', abort, { once: true })
})
const conditionsOf = (branches: BranchContext[]) => [...new Set(branches.flatMap(branch => branch.memory.filter(item => item.kind === 'constraint').map(item => item.text)))]
const lower = (text: string) => text.toLowerCase()

/** Deterministic preview agents. They follow the same coordinator and task types, without a model or web search. */
export function demoRuntime(delay = 250): AgentRuntime {
  return {
    mode: 'demo',
    async lead(input, signal) {
      await wait(signal, delay)
      const first = input.branches[0]
      if (!first) throw new Error('Choose an inspiration first.')
      const conditions = conditionsOf(input.branches)
      const followUp = input.outcome ? `How did “${input.outcome.title}” go — what would you like next?` : undefined
      if (input.outcome && input.evidence?.status === 'found' && input.allowed.includes('propose')) {
        const source = input.evidence.sources[0]
        const answer = first.answers.at(-1)?.answer ?? ''
        return { next: 'propose', action: { title: `Next after “${input.outcome.title}”`, description: `Example follow-up that builds on what you have: ${answer ? `you said “${answer}”, so ` : ''}use the linked directory to pick one session that goes a step further${isNotEmpty(conditions) ? `, checking it against ${conditions.join(', ')}` : ''}. No live search was performed in preview mode.`, sources: source ? [source] : [] } }
      }
      if (input.outcome && followUp && !input.evidence) {
        if (first.answers.at(-1)?.question !== followUp) return { next: 'ask', question: { prompt: followUp, options: ['I tried it — what next?', 'Not yet, something is in the way', 'Show me a different idea'], purpose: 'Agents build on this step instead of repeating it.' } }
        return { next: 'research', brief: `A next step after “${input.outcome.title}”`, mustMatch: conditions.slice(0, 6) }
      }
      if (input.evidence?.status === 'found' && input.allowed.includes('propose')) {
        const source = input.evidence.sources[0]
        return { next: 'propose', action: { title: 'Find one beginner-friendly session', summary: `Pick one small session to try ${lower(first.goal)} for real.`, steps: ['Open the linked directory', isNotEmpty(conditions) ? `Filter by ${conditions.slice(0, 2).join(' and ')}` : 'Filter by date and price', 'Save one session that fits'], meta: { time: '20 min', cost: 'Free to browse', place: 'Online' }, description: 'Example step: no live search was performed in preview mode.', sources: source ? [source] : [] } }
      }
      if (input.evidence) return { next: 'ask', question: { prompt: 'The preview search found nothing that fits. Which condition could be flexible?', options: [...conditions.slice(0, 2), 'Try a different idea'].length >= 2 ? [...conditions.slice(0, 2), 'Try a different idea'] : ['Budget', 'Try a different idea'], purpose: 'Preview agents never invent a result.' } }
      const latest = first.answers.at(-1)
      if (latest?.stance === 'uncertain') return { next: 'ask', question: { prompt: 'No problem. Which part feels most uncertain right now?', options: ['When I would go', 'How much it costs', 'Where to start'], purpose: 'A short clarification keeps the next step realistic.' } }
      const answered = first.answers.filter(answer => answer.stance !== 'question' && answer.stance !== 'uncertain')
      if (input.operation === 'research' || answered.length >= 2 || input.branches.length === 2) {
        return { next: 'research', brief: `Beginner-friendly ${lower(first.goal)}${input.branches[1] ? ` combined with ${lower(input.branches[1].goal)}` : ''}`, mustMatch: conditions.slice(0, 6) }
      }
      const proposal = demoProposal({ requestId: 'preview', operation: 'branch', branches: input.branches, note: input.note })
      if (proposal.kind !== 'question') throw new Error('Preview agents could not choose a question.')
      return { next: 'ask', question: { prompt: proposal.prompt, options: proposal.options, purpose: proposal.purpose } }
    },
    async research(input, signal) {
      await wait(signal, delay)
      return { status: 'found', summary: `Example directory for: ${input.brief}`, sources: [{ id: 'example-source', title: 'Example directory · Eventbrite', url: 'https://www.eventbrite.com/d/online/classes/' }], limits: 'Preview only: price, place and availability were not checked.' }
    },
    async connection(input, signal) {
      await wait(signal, delay)
      const [a, b] = input.branches
      if (!a || !b) throw new Error('Choose two different branches.')
      if (input.phase === 'decide' && input.candidate) return { next: 'propose', opportunity: input.candidate, reason: 'Kept the parts both branches accepted.' }
      const declined = input.branches.flatMap(branch => branch.declined.map(item => lower(item.idea)))
      const conditions = conditionsOf(input.branches)
      const fits = isNotEmpty(conditions) ? ` It keeps to ${conditions.join(', ')}.` : ''
      if (input.focus) return { next: 'check', candidate: { title: `${input.focus.title.replace(/ — revised$/, '')} — revised`, description: `A revised version that follows your comment: “${input.focus.note}”.${fits} This is an example proposal; availability has not been checked.`, benefitA: `Keeps ${lower(a.goal)} small and doable.`, benefitB: `Makes room for ${lower(b.goal)} as you asked.` } }
      const title = declined.some(idea => idea.includes('a first experience, together')) ? 'A small shared ritual at home' : 'A first experience, together'
      return { next: 'check', candidate: { title, description: `Explore “${a.goal}” alongside “${b.goal}” in one small, shared experience.${fits} This is an example proposal; availability has not been checked.`, benefitA: `Try ${lower(a.goal)} without a big commitment.`, benefitB: `Make room for ${lower(b.goal)} at the same time.` } }
    },
    async checkFit(input, signal) {
      await wait(signal, delay)
      const conflict = input.branch.declined.find(item => lower(input.candidate.title).includes(lower(item.idea)) || lower(item.idea).includes(lower(input.candidate.title)))
      if (conflict) return { fit: 'conflict', reason: `You declined “${conflict.idea}” for this goal.`, conflicts: [conflict.reason || 'Declined earlier'] }
      const conditions = input.branch.memory.filter(item => item.kind === 'constraint').map(item => item.text)
      return { fit: 'fits', reason: `Matches “${input.branch.goal}”${isNotEmpty(conditions) ? ` and ${conditions.join(', ')}` : ''}.`, conflicts: [] }
    },
  }
}
