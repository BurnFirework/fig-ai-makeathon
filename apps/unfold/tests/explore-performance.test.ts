import assert from 'node:assert/strict'
import { test } from 'node:test'
import { z } from 'zod'
import { acquireCli } from '../server/cli-queue'
import { runCardExplore, type CardDecision } from '../server/explore-cards'
import { ExploreRequestSchema } from '../shared/explore'
import { isNotEmpty } from '../shared/arrays'
import type { AgentEvent } from '../shared/schema'

const cases = [
  test('interactive CLI calls have a reserved slot and stopped background work leaves the queue', async () => {
    const previous = process.env.UNFOLD_EXPLORE_CONCURRENCY
    process.env.UNFOLD_EXPLORE_CONCURRENCY = '1'
    const running = new AbortController()
    const stopped = new AbortController()
    const releases: (() => void)[] = []
    try {
      releases.push(await acquireCli(running.signal, true))
      const waiting = acquireCli(stopped.signal, true)
      const interactive = acquireCli(running.signal, false)
      stopped.abort()
      await assert.rejects(waiting, { name: 'AbortError' })
      releases.push(await interactive)

      const order: string[] = []
      const background = acquireCli(running.signal, true).then(release => { order.push('background'); release() })
      const nextInteractive = acquireCli(running.signal, false).then(release => { order.push('interactive'); release() })
      releases.pop()?.()
      await nextInteractive
      releases.pop()?.()
      await background
      assert.deepEqual(order, ['interactive', 'background'])
    } finally {
      releases.forEach(release => release())
      if (previous === undefined) delete process.env.UNFOLD_EXPLORE_CONCURRENCY
      else process.env.UNFOLD_EXPLORE_CONCURRENCY = previous
    }
  }),
  test('independent Explore opens another card on demand, batches web requests and still verifies a primary source', async () => {
    const studio = { url: 'https://claystudio.example/wheel-intro', title: 'Intro to the Wheel | Clay Studio', excerpts: ['Beginner wheel throwing class for adults. Saturdays, 2:30pm–4:30pm at our Mission studio, San Francisco. $89 per class. Small groups of 6. 3 spots left this month.'] }
    const image = 'data:image/png;base64,AA=='
    const makeCard = (id: string) => ({ id, image, node: { type: 'inspiration', assetId: id, goal: id, started: true, branchId: id, sequence: 1, revision: 1, stale: false, dependsOn: [], agent: 'you', createdAt: 1 } })
    const request = ExploreRequestSchema.parse({
      operation: 'explore', requestId: 'context-and-batch',
      topics: [{ kind: 'card', sourceId: 'pottery', title: 'Pottery', query: 'pottery wheel class', city: 'San Francisco', category: 'activity', dependencies: [{ id: 'pottery', revision: 1 }] }],
      board: { cards: [makeCard('pottery'), makeCard('related')], conversations: [], relations: [] },
    })
    const pending: ((response: Response) => void)[] = []
    const reply = () => Response.json({ result: { content: [{ text: JSON.stringify({ results: [studio] }) }] } })
    const fetch = globalThis.fetch
    let requests = 0
    let simultaneous = false
    globalThis.fetch = (_input, init) => {
      requests++
      if (requests > 2) return Promise.resolve(reply())
      return new Promise((resolve, reject) => {
        const signal = init?.signal
        signal?.addEventListener('abort', () => reject(new Error('Search was stopped.')), { once: true })
        pending.push(resolve)
        if (pending.length === 2) {
          simultaneous = true
          pending.splice(0).forEach(complete => complete(reply()))
        }
      })
    }
    const inputSchema = z.object({ imageOrder: z.array(z.string()), history: z.array(z.object({ result: z.unknown().optional() })) })
    const events: AgentEvent[] = []
    let turn = 0
    try {
      const result = await runCardExplore(request, AbortSignal.timeout(3000), event => events.push(event), { provider: 'codex', binary: '' }, (value) => {
        const input = inputSchema.parse(value)
        const current = turn++
        const decide = (): CardDecision => {
          if (current === 0) {
            assert.deepEqual(input.imageOrder, ['pottery'])
            return { action: 'read_context', cardIds: ['related'], chatIds: [], imageIds: ['related'], message: 'Reading the related card.' }
          }
          if (current === 1) {
            assert.deepEqual(input.imageOrder, ['related'])
            assert.equal(z.object({ cards: z.array(z.object({ id: z.string() })) }).parse(input.history[0]?.result).cards[0]?.id, 'related')
            return { action: 'web_batch', steps: [
              { action: 'web_search', query: 'pottery wheel class', message: 'Searching for classes.' },
              { action: 'web_fetch', urls: [studio.url], objective: 'Read the studio page.', message: 'Reading the studio page.' },
            ], message: 'Looking for local classes.' }
          }
          assert.deepEqual(input.imageOrder, [])
          if (current === 2) return { action: 'find_options', query: 'pottery wheel class', category: 'activity', message: 'Searching and checking studio pages.' }
          const evidence = z.object({ findings: z.array(z.object({ id: z.string() })).min(1) }).parse(input.history[2]?.result)
          return { action: 'finish', findingIds: evidence.findings.map(finding => finding.id), developments: [], usedCardIds: ['pottery', 'related'], message: 'One studio confirmed.' }
        }
        return Promise.resolve(decide())
      })
      assert.ok(simultaneous)
      assert.equal(requests, 4)
      const report = result.reports[0]
      assert.ok(report?.status === 'complete' && isNotEmpty(report.findings))
      assert.equal(report.findings[0].source, studio.url)
      assert.deepEqual(report.usedCardIds, ['pottery', 'related'])
      assert.ok(events.some(event => event.type === 'explore-report' && event.report === report))
    } finally {
      globalThis.fetch = fetch
    }
  }),
]

await Promise.all(cases)
