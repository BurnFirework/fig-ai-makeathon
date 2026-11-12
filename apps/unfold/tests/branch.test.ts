import { test } from 'node:test'
import assert from 'node:assert/strict'
import { branchFrom, type BranchCard } from '../shared/branch'

// Two photos (a, b); a has a chat outcome a1 and its next step a2; a and b share a direction s.
const cards: BranchCard[] = [
  { id: 'a', branchId: 'a', inspiration: true },
  { id: 'a1', branchId: 'a', inspiration: false },
  { id: 'a2', branchId: 'a', inspiration: false },
  { id: 'b', branchId: 'b', inspiration: true },
  { id: 'b1', branchId: 'b', inspiration: false },
  { id: 's', branchId: 'shared-1', inspiration: false, sourceBranchIds: ['a', 'b'] },
  { id: 's1', branchId: 'shared-1', inspiration: false },
]
const edges = [{ from: 'a', to: 'a1' }, { from: 'a1', to: 'a2' }, { from: 'b', to: 'b1' }, { from: 'a', to: 's' }, { from: 'b', to: 's' }, { from: 's', to: 's1' }]
const sorted = (ids: string[]) => [...ids].sort()

const cases: Promise<void>[] = []
cases.push(test('removing one photo leaves a shared direction and its descendants when another source survives', () => {
  assert.deepEqual(sorted(branchFrom(['a'], cards, edges)), ['a', 'a1', 'a2'])
}))
cases.push(test('a saved branch can still offer cards whose original development line is missing', () => {
  assert.deepEqual(sorted(branchFrom(['a'], cards, edges.filter(edge => edge.to !== 'a2'))), ['a', 'a1', 'a2'])
}))
cases.push(test('only descendants that lose their last source are offered alongside a selected card', () => {
  assert.deepEqual(sorted(branchFrom(['a1'], cards, edges)), ['a1', 'a2'])
  assert.deepEqual(sorted(branchFrom(['s'], cards, edges)), ['s', 's1'])
}))
cases.push(test('a line drawn to another photo never removes that photo', () => {
  assert.deepEqual(sorted(branchFrom(['a'], cards, [...edges, { from: 'a', to: 'b' }])), ['a', 'a1', 'a2'])
}))
cases.push(test('another source protects a referenced card from being offered for removal', () => {
  assert.deepEqual(sorted(branchFrom(['a'], cards, [...edges, { from: 'a', to: 'b1', relationship: 'reference' }])), ['a', 'a1', 'a2'])
}))
cases.push(test('an unknown card removes nothing', () => {
  assert.deepEqual(branchFrom(['missing'], cards, edges), [])
}))
cases.push(test('a shared direction is offered when the last photo is removed or both are removed together', () => {
  const afterFirst = cards.filter(card => !['a', 'a1', 'a2'].includes(card.id))
  assert.deepEqual(sorted(branchFrom(['b'], afterFirst, edges)), ['b', 'b1', 's', 's1'])
  assert.deepEqual(sorted(branchFrom(['a', 'b'], cards, edges)), ['a', 'a1', 'a2', 'b', 'b1', 's', 's1'])
}))
await Promise.all(cases)
