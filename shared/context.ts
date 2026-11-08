import type { BranchContext,UnfoldNode } from './schema';

export type NodeRecord = { id: string; node: UnfoldNode }
export function branchContext(records: NodeRecord[], branchId: string): BranchContext {
  const root = records.find(record => record.id === branchId)
  if (!root || root.node.type !== 'inspiration') throw new Error('The inspiration no longer exists.')
  const nodes = records.filter(record => record.node.branchId === branchId).sort((a, b) => a.node.sequence - b.node.sequence)
  const answers = nodes.flatMap(record => {
    const answer = record.node
    if (answer.type !== 'answer') return []
    const question = records.find(q => q.id === answer.questionId)?.node
    return [{ question: question?.type === 'question' ? question.prompt : 'Your clarification', answer: answer.text }]
  })
  return { id: branchId, goal: root.node.goal, revision: root.node.revision, answers,
    confirmed: [root.node.goal, ...answers.map(answer => answer.answer)], assumptions: [],
    previousSuggestions: nodes.flatMap(({ node }) => node.type === 'action' ? [node.title, ...(node.reflection ? [`User feedback: ${node.reflection}`] : [])] : node.type === 'question' ? [node.prompt] : []),
  }
}

export function invalidatedBy(records: NodeRecord[], changedId: string): Set<string> {
  const invalid = new Set([changedId])
  let changed = true
  while (changed) {
    changed = false
    for (const record of records) {
      if (invalid.has(record.id) || record.node.agent === 'you') continue
      if (record.node.dependsOn.some(dependency => invalid.has(dependency.id))) { invalid.add(record.id); changed = true }
    }
  }
  invalid.delete(changedId)
  return invalid
}
