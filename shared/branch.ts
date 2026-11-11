import type { Relationship } from './board-edits'

export interface BranchCard { id: string; branchId: string; inspiration: boolean; sourceBranchIds?: readonly string[] | undefined }
export interface BranchEdge { from: string; to: string; relationship?: Relationship }

/** Returns the selected cards and any cards that would lose all of their remaining sources. */
export function branchFrom(rootIds: readonly string[], cards: readonly BranchCard[], edges: readonly BranchEdge[]): string[] {
  const byId = new Map(cards.map(card => [card.id, card]))
  const sources = new Map<string, Set<string>>()
  const hasDevelopmentLink = new Set<string>()

  for (const { from, to, relationship } of edges) {
    const card = byId.get(to)
    if (!card || card.inspiration || from === to || !byId.has(from)) continue
    const inputs = sources.get(to) ?? new Set<string>()
    inputs.add(from)
    sources.set(to, inputs)
    if (relationship !== 'reference') hasDevelopmentLink.add(to)
  }

  // Older branch cards can retain their source even when their original line is missing.
  for (const card of cards) {
    if (card.inspiration || hasDevelopmentLink.has(card.id)) continue
    const inputs = sources.get(card.id) ?? new Set<string>()
    for (const id of card.sourceBranchIds ?? [card.branchId]) {
      if (id !== card.id && byId.get(id)?.inspiration) inputs.add(id)
    }
    sources.set(card.id, inputs)
  }

  const removed = new Set(rootIds.filter(id => byId.has(id)))
  for (const id of removed) {
    for (const [child, inputs] of sources) {
      if (inputs.has(id) && [...inputs].every(input => removed.has(input))) removed.add(child)
    }
  }
  return [...removed]
}
