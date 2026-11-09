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
cases.push(test('removing a photo removes its whole branch and the shared directions built on it', () => {
  assert.deepEqual(sorted(branchFrom('a', cards, edges)), ['a', 'a1', 'a2', 's', 's1'])
}))
cases.push(test('cards of a branch go with their photo even when a line was deleted', () => {
  assert.deepEqual(sorted(branchFrom('a', cards, edges.filter(edge => edge.to !== 'a2'))), ['a', 'a1', 'a2', 's', 's1'])
}))
cases.push(test('removing a card inside a branch keeps its sources and the other photo', () => {
  assert.deepEqual(sorted(branchFrom('a1', cards, edges)), ['a1', 'a2'])
  assert.deepEqual(sorted(branchFrom('s', cards, edges)), ['s', 's1'])
}))
cases.push(test('a line drawn to another photo never removes that photo', () => {
  assert.deepEqual(sorted(branchFrom('a', cards, [...edges, { from: 'a', to: 'b' }])), ['a', 'a1', 'a2', 's', 's1'])
}))
cases.push(test('an unknown card removes nothing', () => {
  assert.deepEqual(branchFrom('missing', cards, edges), [])
}))
await Promise.all(cases)
