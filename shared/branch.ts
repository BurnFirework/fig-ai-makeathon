/** A card on the board, reduced to what decides which cards grew from which. */
export interface BranchCard { id: string; branchId: string; inspiration: boolean; sourceBranchIds?: readonly string[] | undefined }
/** A drawn connection from a source card (`from`) to the card that grew from it (`to`). */
export interface BranchEdge { from: string; to: string }

/**
 * The cards removed together with `rootId`: the card itself and everything that grew from it.
 * For an inspiration that is its whole branch, including shared directions that used it as a source.
 * Other inspirations are never included, even when a line was drawn to one: each photo is its own root.
 */
export function branchFrom(rootId: string, cards: readonly BranchCard[], edges: readonly BranchEdge[]): string[] {
  const byId = new Map(cards.map(card => [card.id, card]))
  const root = byId.get(rootId)
  if (!root) return []
  const removed = new Set([rootId])
  if (root.inspiration) for (const card of cards) {
    if (!card.inspiration && (card.branchId === rootId || card.sourceBranchIds?.includes(rootId))) removed.add(card.id)
  }
  const queue = [...removed]
  for (let id = queue.shift(); id !== undefined; id = queue.shift()) {
    for (const edge of edges) {
      const child = edge.from === id ? byId.get(edge.to) : undefined
      if (!child || child.inspiration || removed.has(child.id)) continue
      removed.add(child.id); queue.push(child.id)
    }
  }
  return [...removed]
}
