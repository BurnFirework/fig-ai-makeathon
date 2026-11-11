import { isEmpty, isNotEmpty } from './arrays'
import type { AgentRuntime, LeadStep } from './coordinator'
import type { BoardContext } from './board-edits'
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
/** The example price preview research reports, so a low budget shows a real conflict. */
const PREVIEW_PRICE = 45
const priceIn = (text: string) => { const match = /\$\s?(\d+)/.exec(text); return match?.[1] ? Number(match[1]) : undefined }
/** The price of the option research added to a candidate, never a budget the description repeats. */
const optionPrice = (description: string) => priceIn(description.split('Example option:')[1] ?? '')
const STOP = new Set(['what', 'draws', 'would', 'like', 'yourself', 'want', 'that', 'this', 'with', 'from', 'have', 'just', 'some', 'something', 'about', 'more', 'really', 'maybe', 'make', 'first', 'step', 'toward', 'feel', 'manageable', 'explore', 'exploring', 'there', 'their', 'your', 'yes', 'try', 'trying'])
const words = (branch: BranchContext) => new Set([branch.goal, ...branch.memory.filter(item => item.kind !== 'assumption' && item.kind !== 'declined').map(item => item.text.split(' — ').at(-1) ?? item.text)].join(' ').toLowerCase().split(/[^\p{L}\p{N}]+/u).filter(word => word.length >= 4 && !STOP.has(word)))
/** Preview overlap: a shared kind of condition (time, place, company) or a shared word. */
function overlapOf(a: BranchContext, b: BranchContext): string | undefined {
  const keys = (branch: BranchContext) => new Set(branch.memory.flatMap(item => item.kind === 'constraint' && item.key && ['time', 'place', 'group'].includes(item.key) ? [item.key] : []))
  const key = [...keys(a)].find(item => keys(b).has(item))
  if (key) return key === 'time' ? 'the same time' : key === 'place' ? 'the same area' : 'the same company'
  const word = [...words(a)].find(item => words(b).has(item))
  return word ? `“${word}”` : undefined
}
function draftFor(a: BranchContext, b: BranchContext, conditions: string[], shared?: string) {
  return { title: `${a.goal.replace(/^./, letter => letter.toUpperCase())}, together with ${lower(b.goal)}`, description: `One small session that serves both goals${shared ? `, since both mention ${shared}` : ''}.${isNotEmpty(conditions) ? ` It keeps to ${conditions.join(', ')}.` : ''} This is an example proposal; availability has not been checked.`, benefitA: `Try ${lower(a.goal)} without a big commitment.`, benefitB: `Make room for ${lower(b.goal)} at the same time.` }
}

const moodQuestion = 'What mood should the board capture?'
const moodFollowup = 'Which direction feels closer to what you want?'

/** Preview responds to explicit board requests with the same edit contract as live agents. */
function previewBoardReply(board: BoardContext | undefined): Extract<LeadStep, { next: 'ask' | 'respond' }> | undefined {
  const latest = board?.messages.at(-1)
  if (!board || latest?.role !== 'user') return undefined
  const focus = board.cards.find(card => card.id === board.focusId)
  if (!focus) return undefined
  const previous = board.messages.at(-2)
  const continuing = previous?.role === 'assistant' && (previous.text === moodQuestion || previous.text === moodFollowup)
  const moodRequest = board.messages.map(message => message.role === 'assistant' && message.text === moodQuestion).lastIndexOf(true)
  const request = continuing ? board.messages[moodRequest - 1]?.text ?? '' : latest.text
  const rename = /^rename (?:this card|this) to (.+)$/iu.exec(request)?.[1]?.trim()
  if (rename) return { next: 'respond', text: `Renamed the card to “${rename.slice(0, 160)}”.`, edits: [{ kind: 'updateNode', nodeId: focus.id, title: rename.slice(0, 160) }], usedNodeIds: [focus.id] }
  const named = board.cards.filter(card => card.id !== focus.id && request.toLowerCase().includes(card.title.toLowerCase()))
  if (/^link (?:this card|this) to /iu.test(request) && named[0]) return { next: 'respond', text: `Linked this card to “${named[0].title}”.`, edits: [{ kind: 'connectNodes', from: named[0].id, to: focus.id, relationship: 'reference' }], usedNodeIds: [focus.id, named[0].id] }
  if (!/\b(?:make|create|build|add|draft)\b/iu.test(request)) return undefined
  if (/\bmood ?board\b/iu.test(request)) {
    const candidates = [...new Map([focus, ...named, ...board.cards.filter(card => board.attachedIds.includes(card.id))].filter(card => card.image).map(card => [card.id, card])).values()].slice(0, 4)
    if (isEmpty(candidates)) return { next: 'ask', question: { prompt: 'Which image should anchor the moodboard?', options: ['Attach an image', 'Make a note instead'], purpose: 'The composition uses photos from your board.' } }
    if (!continuing && /\b(?:ask me|help me decide|unsure)\b/iu.test(request)) return { next: 'ask', question: { prompt: moodQuestion, options: ['Warm and calm', 'Bright and playful', 'Quiet and minimal', 'Help me choose'], purpose: 'The mood guides the composition.' } }
    if (continuing && /\b(?:help me choose|not sure|unsure)\b/iu.test(latest.text)) return { next: 'ask', question: { prompt: moodFollowup, options: ['Warm and calm', 'Quiet and minimal'], purpose: 'Warm tones feel cozy, while a quieter palette puts the focus on shape and texture.' } }
    const mood = continuing ? latest.text.slice(0, 70) : 'Room'
    const title = `${mood} moodboard`
    return { next: 'respond', text: `I made “${title}” using ${candidates.map(card => `“${card.title}”`).join(' and ')}.`, usedNodeIds: candidates.map(card => card.id), edits: [{ kind: 'createNode', content: { kind: 'moodboard', title, description: 'A starting composition using images from this board.', items: candidates.map((card, index) => ({ nodeId: card.id, caption: index === 0 ? 'Anchor image' : card.title.slice(0, 100) })) }, links: [{ nodeId: focus.id, relationship: 'develops' }, ...candidates.filter(card => card.id !== focus.id).map(card => ({ nodeId: card.id, relationship: 'reference' as const }))] }] }
  }
  if (/\bnote\b/iu.test(request)) {
    const title = 'Design note'
    const detail = request.replace(/^.*?\bnote\s*(?:about|on|for|:)?\s*/iu, '').trim()
    return { next: 'respond', text: 'I added a design note to the board.', usedNodeIds: [focus.id], edits: [{ kind: 'createNode', content: { kind: 'note', title, description: (detail || `Develop the idea in “${focus.title}” with one clear detail.`).slice(0, 1200) }, links: [{ nodeId: focus.id, relationship: 'develops' }] }] }
  }
  return undefined
}

/** Deterministic preview agents. They follow the same coordinator and task types, without a model or web search. */
export function demoRuntime(delay = 250): AgentRuntime {
  return {
    mode: 'demo',
    async lead(input, signal) {
      await wait(signal, delay)
      const reply = input.allowed.includes('respond') ? previewBoardReply(input.board) : undefined
      if (reply) return reply
      const first = input.branches[0]
      if (!first) throw new Error('Choose an inspiration first.')
      const conditions = conditionsOf(input.branches)
      const followUp = input.outcome ? `How did “${input.outcome.title}” go — what would you like next?` : undefined
      if (input.outcome && input.evidence?.status === 'found' && input.allowed.includes('propose')) {
        const source = input.evidence.sources[0]
        // An accepted shared direction gets its first step; a finished step gets what comes next.
        if (input.operation === 'research') return { next: 'propose', action: { title: `Start “${input.outcome.title}”`, summary: 'Pick one date from the linked page and save it.', steps: ['Open the linked page', isNotEmpty(conditions) ? `Check it against ${conditions.slice(0, 2).join(' and ')}` : 'Check the date and price', 'Save one date that fits'], description: 'Example step: no live search was performed in preview mode.', sources: source ? [source] : [] } }
        const answer = first.answers.at(-1)?.answer ?? ''
        return { next: 'propose', action: { title: `Next after “${input.outcome.title}”`, description: `Example follow-up that builds on what you have: ${answer ? `you said “${answer}”, so ` : ''}use the linked directory to pick one session that goes a step further${isNotEmpty(conditions) ? `, checking it against ${conditions.join(', ')}` : ''}. No live search was performed in preview mode.`, sources: source ? [source] : [] } }
      }
      // An accepted shared direction asks for a real first step, not for how it went.
      if (input.operation === 'research' && input.outcome && !input.evidence) return { next: 'research', brief: `A first step for “${input.outcome.title}”`, mustMatch: conditions.slice(0, 6) }
      if (input.outcome && followUp && !input.evidence && input.operation !== 'research') {
        if (first.answers.at(-1)?.question !== followUp) return { next: 'ask', question: { prompt: followUp, options: ['I tried it — what next?', 'Not yet, something is in the way', 'Show me a different idea'], purpose: 'Agents build on this step instead of repeating it.' } }
        return { next: 'research', brief: `A next step after “${input.outcome.title}”`, mustMatch: conditions.slice(0, 6) }
      }
      // A preview revision keeps the step and its sources and says how it follows the comment.
      if (input.focus && input.evidence?.status === 'found' && input.allowed.includes('propose')) {
        const steps = input.focus.steps && input.focus.steps.length >= 2 ? input.focus.steps : ['Open the linked page', 'Check the details against your comment']
        return { next: 'propose', action: { title: input.focus.title, summary: `Revised to follow your comment: “${input.focus.note.slice(0, 120)}”.`, steps, description: 'Example revision: no live search was performed in preview mode.', sources: input.evidence.sources.slice(0, 2) } }
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
      // Preview research is labelled as an example: a cheaper search finds a free option, a general one a paid class.
      const cheap = /free|low-cost|cheaper|бесплат/i.test(input.brief)
      if (cheap) return { status: 'found', summary: `Example: a free community-run session for ${input.brief.replace(/^.*?:\s*/, '')}.`, sources: [{ id: 'example-free', title: 'Example community meetups · Meetup', url: 'https://www.meetup.com/find/' }], limits: 'Preview only: date and availability were not checked.' }
      return { status: 'found', summary: `Example: $${PREVIEW_PRICE} per person, from a directory listing for “${input.brief.replace(/\s*within .*$/, '')}”.`, sources: [{ id: 'example-source', title: 'Example directory · Eventbrite', url: 'https://www.eventbrite.com/d/online/classes/' }], limits: 'Preview only: price, place and availability were not checked.' }
    },
    async connection(input, signal) {
      await wait(signal, delay)
      const reply = input.allowed.includes('respond') ? previewBoardReply(input.board) : undefined
      if (reply) return reply
      const [a, b] = input.branches
      if (!a || !b) throw new Error('Choose two different branches.')
      const conditions = conditionsOf(input.branches)
      const keep = /\bkeep\b|оставить|сохранить/i.test(input.note)
      if (input.phase === 'decide') {
        if (input.evidence?.status === 'found' && input.allowed.includes('revise')) {
          const base = input.candidate ?? draftFor(a, b, conditions)
          return { next: 'revise', candidate: { ...base, description: `${base.description.replace(/ Example option:.*$/, '')} Example option: ${input.evidence.summary}`, sources: input.evidence.sources.map(source => ({ title: source.title, url: source.url })) }, reason: 'Added the option the research agent found.' }
        }
        const conflict = input.checks?.find(check => check.fit === 'conflict')
        if (conflict || input.evidence?.status === 'none') {
          const budget = conditions.find(text => /budget/i.test(text))
          const price = optionPrice(input.candidate?.description ?? '')
          return { next: 'ask', question: { prompt: 'Keep your budget or change it?', options: price ? ['Keep my budget, search further', `Raise budget to $${price}`] : ['Keep my conditions, search further', 'Relax one condition'],
            purpose: 'Only you can change a confirmed condition.',
            conflict: { condition: conflict?.conflicts[0] ?? budget ?? 'A confirmed condition', basis: conflict?.reason ?? 'The example search found nothing that fits.', effects: ['Agents keep the condition and search for a free or cheaper option.', price ? `Agents use $${price} as your budget and check both goals again.` : 'Agents treat the condition as flexible and check both goals again.'] } } }
        }
        const verify = input.checks?.find(check => check.verify)
        if (verify && input.allowed.includes('research') && input.candidate) {
          const budget = conditions.find(text => /budget/i.test(text))
          return { next: 'research', brief: keep ? `Free or low-cost: ${input.candidate.title}` : `${input.candidate.title}${budget ? ` within ${budget.replace(/^Budget:\s*/, '')}` : ''}`, mustMatch: conditions.slice(0, 6), reason: keep ? 'You kept your budget, so this search looks for free options.' : 'A real option is needed to confirm the conditions.' }
        }
        const missing = input.checks?.find(check => check.missing)
        if (missing?.missing) return { next: 'ask', question: { prompt: missing.missing, options: ['I’ll answer below', 'Try a different idea'], purpose: 'A branch agent needs this to check the idea.' } }
        if (input.candidate && input.allowed.includes('propose')) return { next: 'propose', opportunity: input.candidate, reason: 'Kept the parts both branches accepted.' }
        return { next: 'none', reason: 'The branch checks left nothing both goals could use.' }
      }
      const declined = input.branches.flatMap(branch => branch.declined.map(item => lower(item.idea)))
      const fits = isNotEmpty(conditions) ? ` It keeps to ${conditions.join(', ')}.` : ''
      if (input.focus) return { next: 'check', candidate: { title: `${input.focus.title.replace(/ — revised$/, '')} — revised`, description: `A revised version that follows your comment: “${input.focus.note}”.${fits} This is an example proposal; availability has not been checked.`, benefitA: `Keeps ${lower(a.goal)} small and doable.`, benefitB: `Makes room for ${lower(b.goal)} as you asked.` } }
      const judged = input.branches.every(branch => branch.memory.some(item => item.kind === 'intent' || item.kind === 'constraint'))
      const shared = overlapOf(a, b)
      if (!shared && (input.trigger === 'auto' || judged)) return { next: 'none', reason: `“${a.goal}” and “${b.goal}” don’t share a time, place, company or theme yet.` }
      if (declined.some(idea => idea.includes('a first experience, together'))) return { next: 'check', candidate: { title: 'A small shared ritual at home', description: `Explore “${a.goal}” alongside “${b.goal}” in one small, shared experience.${fits} This is an example proposal; availability has not been checked.`, benefitA: `Try ${lower(a.goal)} without a big commitment.`, benefitB: `Make room for ${lower(b.goal)} at the same time.` } }
      const draft = draftFor(a, b, conditions, shared)
      const refused = input.branches.flatMap(branch => branch.declined).find(item => lower(item.idea) === lower(draft.title))
      if (refused) return { next: 'none', reason: `You declined “${refused.idea}”${refused.reason ? ` (${refused.reason})` : ''}, and nothing new connects these goals yet.` }
      return { next: 'check', candidate: draft }
    },
    async checkFit(input, signal) {
      await wait(signal, delay)
      const conflict = input.branch.declined.find(item => lower(input.candidate.title).includes(lower(item.idea)) || lower(item.idea).includes(lower(input.candidate.title)))
      if (conflict) return { fit: 'conflict', reason: `You declined “${conflict.idea}” for this goal.`, conflicts: [conflict.reason || 'Declined earlier'] }
      const conditions = input.branch.memory.filter(item => item.kind === 'constraint').map(item => item.text)
      const budget = conditions.find(text => /budget/i.test(text))
      const limit = budget ? priceIn(budget) : undefined
      const price = optionPrice(input.candidate.description)
      if (budget && limit !== undefined && price !== undefined && price > limit) return { fit: 'conflict', reason: `The example option costs $${price}, above this goal’s ${budget.toLowerCase()}.`, conflicts: [budget] }
      const priced = budget && !/free/i.test(input.candidate.description.split('Example option:')[1] ?? '') && price === undefined
      return { fit: 'fits', reason: `Matches “${input.branch.goal}”${isNotEmpty(conditions) ? ` and ${conditions.join(', ')}` : ''}.`, conflicts: [], ...(priced ? { verify: `${budget} needs a real price` } : {}) }
    },
  }
}
