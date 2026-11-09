import { isEmpty } from './arrays'
import type { AgentRequest, Proposal } from './schema'

export function demoProposal(request: AgentRequest): Proposal {
  const first = request.branches[0]
  if (!first) throw new Error('Choose an inspiration first.')
  if (request.operation === 'connect') return { kind: 'opportunity', title: 'A first experience, together', description: `Explore “${first.goal}” alongside “${request.branches[1]?.goal || 'your second inspiration'}” in one small, shared experience. This is an example proposal; availability has not been checked.`, benefitA: `Try ${first.goal.toLowerCase()} without a big commitment.`, benefitB: `Make room for ${request.branches[1]?.goal.toLowerCase() || 'your other goal'} at the same time.` }
  if (request.operation === 'research' || first.answers.length >= 2) return { kind: 'action', title: 'Find one beginner-friendly session', description: `Example next step: use the linked directory to find one session related to ${first.goal.toLowerCase()}. Check location, price and availability against your answers: ${first.answers.map(a => a.answer).join('; ') || 'your preferences'}. No live search was performed in preview mode.`, sources: [{ id: 'example-source', title: 'Example directory · Eventbrite', url: 'https://www.eventbrite.com/d/online/classes/' }] }
  if (isEmpty(first.answers)) return { kind: 'question', prompt: `What draws you to ${first.goal.toLowerCase()} — would you like to try it yourself?`, options: ['Yes, I want to try', 'Just exploring'], purpose: 'Find the part of this inspiration that feels like you.' }
  return { kind: 'question', prompt: `What would make a first step toward ${first.goal.toLowerCase()} feel manageable?`, options: ['One hour, low budget', 'An afternoon with others'], purpose: `Your last answer was “${first.answers.at(-1)?.answer || ''}”. Add a location, budget or time limit below.` }
}
