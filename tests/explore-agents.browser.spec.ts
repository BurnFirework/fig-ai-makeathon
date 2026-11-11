import { expect, test } from '@playwright/test'
import { ExploreRequestSchema } from '../shared/explore'

test('Explore streams seven workers and preserves a shared sourced plan through refresh and dismissal', async ({ page }) => {
  await page.route('**/api/config', route => route.fulfill({ json: { mode: 'demo', provider: 'Preview', providers: [] } }))
  await page.route('**/api/agent', route => {
    const request = ExploreRequestSchema.parse(route.request().postDataJSON())
    const reports = request.topics.map(topic => ({ sourceId: topic.sourceId, status: 'complete', checkedAt: Date.now(), findings: [{
      id: topic.kind, title: topic.kind === 'events' ? 'Jazz evening' : 'Design Engineer', subtitle: topic.kind === 'events' ? 'Oakland' : 'US remote',
      why: 'Verified source', url: `https://example.com/${topic.kind}`, source: `https://example.com/${topic.kind}`, state: 'new',
    }] }))
    const workers = Array.from({ length: 7 }, (_, index) => ({ type: 'explore-worker', worker: {
      id: `worker-${index}`, label: `Agent ${index + 1}`, stage: index === 6 ? 'synthesis' : 'discovery', status: 'complete', message: 'Finished checking the supplied evidence',
    } }))
    return route.fulfill({ contentType: 'application/x-ndjson', body: [...workers, { type: 'explore-result', result: {
      requestId: request.requestId, reports,
      shared: { title: 'Make room for work and jazz', summary: 'Review the remote role and the Oakland performance.', checkedAt: Date.now(), items: reports.flatMap(report => report.findings.map(finding => ({ sourceId: report.sourceId, finding }))) },
    } }].map(event => JSON.stringify(event)).join('\n') + '\n' })
  })
  await page.goto('/')
  await page.getByRole('button', { name: 'Explore a sample board', exact: true }).click()
  const goals = page.getByRole('textbox', { name: 'Inspiration goal' })
  await expect(goals).toHaveCount(2)
  await goals.first().fill('Live jazz in the Bay Area')
  await goals.first().blur()
  await goals.last().fill('Remote design engineering roles')
  await goals.last().blur()
  async function run() {
    await page.getByRole('button', { name: 'Explore board', exact: true }).click()
    await page.getByRole('button', { name: 'Start search', exact: true }).click()
    await page.getByRole('button', { name: 'Back to board', exact: true }).click()
  }
  await run()
  const panel = page.getByRole('complementary', { name: 'Explore agents' })
  await expect(panel.locator('li[data-status="complete"]')).toHaveCount(7)
  await expect(panel).toContainText('3 cards updated')
  const shared = page.locator('.card-explore-shared')
  await expect(shared).toHaveCount(1)
  await page.getByRole('button', { name: 'Fit board', exact: true }).click()
  await expect(shared.getByRole('link')).toHaveCount(2)
  await page.reload()
  await expect(shared).toHaveCount(1)
  await run()
  await expect(shared).toHaveCount(1)
  await page.getByRole('button', { name: 'Fit board', exact: true }).click()
  await page.getByRole('button', { name: 'Dismiss Jazz evening', exact: true }).click()
  await expect(shared).toHaveClass(/is-stale/)
  await run()
  await expect(shared).toHaveCount(1)
  await expect(shared).toHaveClass(/is-stale/)
  await expect(page.locator('.card-findings').getByRole('link', { name: 'Jazz evening', exact: true })).toHaveCount(0)
})
