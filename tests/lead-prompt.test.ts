import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, writeFile, chmod, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { liveRuntime } from '../server/agents'
import type { BranchContext } from '../shared/schema'

// Regression for a live failure on November 11, 2026: on a step already on the board, the user asked for easy
// warm-up exercises. With no search run, "propose" was not allowed, but the prompt still showed its shape, so
// Claude proposed an uncited step, and the chat failed with “did not follow the expected format”. The prompt now
// shows only the shapes the agent may choose, and practical help without a source is answered in the chat; a card
// is added only when the user asks for one, never on the agent's own initiative.

/** A stand-in for the `claude` binary: it records the prompt and answers with a note on the board. */
const FAKE_CLAUDE = `
const { writeFileSync } = require('node:fs')
let input = ''
process.stdin.on('data', chunk => { input += chunk })
process.stdin.on('end', () => {
  writeFileSync(log, JSON.parse(input).message.content[0].text)
  const result = JSON.stringify({ next: 'respond', text: 'Here are three warm-ups.', edits: [], usedNodeIds: [] })
  process.stdout.write(JSON.stringify({ type: 'result', subtype: 'success', is_error: false, result }) + '\\n')
})`

const branch: BranchContext = { id: 'b1', goal: 'Explore a creative practice', revision: 1, answers: [{ question: 'What would help most before Sunday’s sketch meetup?', answer: 'Easy warm-up exercises' }], confirmed: [], assumptions: [], previousSuggestions: ['Join a free SF sketch meetup'], memory: [], changes: [], declined: [] }
const board = { conversationId: 'c1', focusId: 'n1', selectedIds: [], attachedIds: ['n1'], cards: [{ id: 'n1', title: 'Join a free SF sketch meetup', image: false, revision: 1 }], links: [], messages: [{ role: 'user' as const, text: 'Easy warm-up exercises' }] }

await test('without research results the lead prompt offers no step shape and answers practical help in the chat', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'unfold-lead-'))
  const executable = join(directory, 'claude.cjs'), log = join(directory, 'prompt.txt')
  await writeFile(executable, `#!${process.execPath}\nconst log = ${JSON.stringify(log)}\n${FAKE_CLAUDE}`); await chmod(executable, 0o700)
  try {
    const step = await liveRuntime({ provider: 'claude', binary: executable }).lead({ role: 'branch', operation: 'branch', branches: [branch], note: 'Easy warm-up exercises', previousBriefs: [], allowed: ['ask', 'research', 'respond'], board, outcome: { title: 'Join a free SF sketch meetup', description: 'A free drop-in sketch session.' } }, new AbortController().signal)
    assert.equal(step.next, 'respond')
    const prompt = await readFile(log, 'utf8')
    assert.doesNotMatch(prompt, /"next":"propose"/)
    assert.match(prompt, /do not propose one yet/)
    assert.match(prompt, /needs no real-world source .* is a "respond" that answers in "text" with no edits/)
    assert.match(prompt, /"next":"ask"/)
  } finally { await rm(directory, { recursive: true, force: true }) }
})
