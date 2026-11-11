import { expect, test, type Page } from '@playwright/test'
import { ExploreRequestSchema } from '../shared/explore'
import { resolve } from 'node:path'

const live = process.env.UNFOLD_EXPLORE_LIVE === '1'
const recording = live && process.env.UNFOLD_RECORD_EXPLORE === '1'
test.use({ video: recording ? { mode: 'on', size: { width: 1440, height: 1000 } } : 'off' })
const eventTitle = 'Live jazz in the Bay Area'
const jobTitle = 'Remote design engineering roles'
const jobTerms = 'Design Engineer OR Design Technologist OR Design Systems Engineer'
const button = (page: Page, name: string) => page.getByRole('button', { name, exact: true })

async function caption(page: Page, message: string, delay = 3500) {
  if (!recording) return
  await page.evaluate(text => {
    let label = document.getElementById('explore-caption')
    if (!label) {
      label = document.createElement('div')
      label.id = 'explore-caption'
      Object.assign(label.style, { position: 'fixed', bottom: '95px', left: '50%', transform: 'translateX(-50%)', zIndex: '10000', maxWidth: '760px', textAlign: 'center', background: '#241e2a', color: '#fff', borderRadius: '12px', padding: '14px 23px', font: '500 17px/1.45 system-ui', boxShadow: '0 4px 20px #241e2a33', pointerEvents: 'none' })
      document.body.append(label)
    }
    label.textContent = text
  }, message)
  await page.waitForTimeout(delay)
}

async function seed(page: Page) {
  if (live) {
    for (const [file, title, count] of [['jazz.png', eventTitle, 1], ['design.png', jobTitle, 2]] as const) {
      await page.locator('input[accept^="image/png"]').setInputFiles(resolve('output/explore-demo', file))
      const inputs = page.getByRole('textbox', { name: 'Inspiration goal' })
      await expect(inputs).toHaveCount(count)
      const field = inputs.last()
      await field.fill(title)
      await field.blur()
    }
    await page.getByRole('button', { name: /^Mood boards:/ }).click()
    await page.getByRole('menuitem', { name: 'Rename board' }).click()
    await page.getByRole('textbox', { name: 'Board name' }).fill('November · Life & work')
    await button(page, 'Save name').click()
  } else {
    await button(page, 'Explore a sample board').click()
    const cards = page.getByRole('textbox', { name: 'Inspiration goal' })
    await expect(cards).toHaveCount(2)
    await cards.first().fill(eventTitle)
    await cards.first().blur()
    await cards.last().fill(jobTitle)
    await cards.last().blur()
  }
  await button(page, 'Fit board').click()
}

async function review(page: Page) {
  await button(page, 'Explore board').click()
  const dialog = page.getByRole('dialog', { name: 'Explore board' })
  await expect(dialog.getByRole('checkbox', { name: eventTitle })).toBeChecked()
  await expect(dialog.getByRole('checkbox', { name: jobTitle })).toBeChecked()
  return dialog
}

test('Explore approves jazz and remote jobs, retries a failed topic and preserves dismissals on refresh', async ({ page }) => {
  test.setTimeout(live ? 230000 : 60000)
  await page.setViewportSize({ width: 1440, height: 1000 })
  let eventCalls = 0
  let jobCalls = 0
  if (!live) {
    await page.route('**/api/config', route => route.fulfill({ json: { mode: 'demo', provider: 'Preview', providers: [] } }))
    await page.route('**/api/agent', async route => {
      const request = ExploreRequestSchema.parse(route.request().postDataJSON())
      const reports = request.topics.map(topic => {
        const event = topic.kind === 'events'
        if (event) eventCalls++
        else if (++jobCalls === 1) return { sourceId: topic.sourceId, status: 'failed', message: 'JSearch Instant failed. Retry this interest.' }
        if (event) expect(topic.query).toBe('Jazz')
        else expect(topic.query).toBe(jobTerms)
        const title = event ? 'Jazz at the corner club' : 'Design Engineer · US remote'
        const url = event ? 'https://example.com/jazz' : 'https://example.com/apply'
        return { sourceId: topic.sourceId, status: 'complete', checkedAt: Date.now(),
          findings: [{ id: event ? 'ticketmaster:1' : 'job:1', title, subtitle: event ? 'Oakland' : 'Product team', why: 'Confirmed by source',
            url, source: url, price: eventCalls === 1 ? '$35' : '$39', state: 'new' }] }
      })
      await route.fulfill({ contentType: 'application/x-ndjson', body: JSON.stringify({ type: 'explore-result', result: { requestId: request.requestId, reports } }) + '\n' })
    })
  }

  await page.goto(live ? 'http://127.0.0.1:43135/' : '/')
  await seed(page)
  await caption(page, 'Two interests on one board: catch live jazz this month and find a design engineering role I can do remotely.', 4600)
  const dialog = await review(page)
  if (!live) {
    await expect(dialog.getByRole('heading', { name: 'Explore board' })).toBeFocused()
    const jobs = dialog.getByRole('checkbox', { name: jobTitle })
    await jobs.uncheck()
    await expect(dialog.getByRole('status')).toHaveText('1 interest selected')
    await expect(dialog.getByRole('checkbox', { name: 'US remote only' })).toHaveCount(0)
    await jobs.check()
    await expect(dialog.getByRole('status')).toHaveText('2 interests selected')
  }
  await dialog.getByLabel('From', { exact: true }).fill('2026-11-13')
  await dialog.getByLabel('Through', { exact: true }).fill('2026-11-30')
  await dialog.getByLabel('Max price ($)', { exact: true }).fill('60')
  const jobSearch = dialog.getByRole('group', { name: jobTitle }).getByLabel('Search terms')
  await jobSearch.fill(jobTerms)
  await expect(dialog.getByRole('checkbox', { name: 'US remote only' })).toBeChecked()
  if (!live) {
    await jobSearch.blur()
    await page.setViewportSize({ width: 390, height: 700 })
    const action = dialog.getByRole('button', { name: 'Start search' })
    await expect(action).toBeInViewport({ ratio: 1 })
    const narrowForm = dialog.locator('.explore-topic-list')
    expect(await narrowForm.evaluate(list => list.scrollWidth)).toBe(await narrowForm.evaluate(list => list.clientWidth))
    await dialog.getByRole('checkbox', { name: 'US remote only' }).scrollIntoViewIfNeeded()
    await expect(action).toBeInViewport({ ratio: 1 })
    await page.setViewportSize({ width: 1440, height: 1000 })
  }
  await caption(page, 'I choose what to search. Jazz in San Francisco and Oakland, under $60. Design engineering roles with US remote work.', 5200)
  await button(page, 'Start search').click()
  await caption(page, 'Unfold searches Ticketmaster and JSearch in parallel, then uses Parallel to check the venue and employer listings.', 4400)
  await expect(button(page, 'Back to board')).toBeVisible({ timeout: live ? 125000 : 10000 })
  if (!live) {
    await expect(dialog).toContainText('JSearch Instant failed')
    await button(page, 'Retry failed').click()
    await expect(button(page, 'Back to board')).toBeVisible()
    expect(eventCalls).toBe(1)
    expect(jobCalls).toBe(2)
  }
  const groups = page.locator('.card-findings')
  await expect(groups).toHaveCount(2)
  await button(page, 'Back to board').click()
  await expect(button(page, 'Explore board')).toBeFocused()
  await button(page, 'Fit board').click()
  await caption(page, 'The best sourced findings appear beside the interests. The photos and the rest of the board stay in place.', 5600)
  const events = groups.filter({ hasText: 'Explore board · Events' }).locator('.finding-row')
  const jobs = groups.filter({ hasText: 'Explore board · Jobs' }).locator('.finding-row')
  const candidates = !live || await events.count() > 1 ? events : await jobs.count() > 1 ? jobs : undefined
  const dismissedTitle = candidates ? (await candidates.first().getByRole('link').first().innerText()).trim() : undefined
  if (candidates && dismissedTitle) {
    const dismiss = candidates.first().getByRole('button', { name: /^Dismiss / })
    await dismiss.click()
    await expect(groups.getByRole('link', { name: dismissedTitle, exact: true })).toHaveCount(0)
    await caption(page, 'I can dismiss an option I’m not interested in. The decision stays with this board.', 4200)
  }
  await expect(page.getByText('Saved in browser', { exact: true })).toBeAttached()
  await page.reload()
  await expect(groups).toHaveCount(2)
  if (dismissedTitle) await expect(groups.getByRole('link', { name: dismissedTitle, exact: true })).toHaveCount(0)
  await button(page, 'Fit board').click()
  if (!live) {
    await review(page)
    await button(page, 'Start search').click()
    await expect(button(page, 'Back to board')).toBeVisible()
    await button(page, 'Back to board').click()
    await expect(groups).toHaveCount(2)
    if (dismissedTitle) await expect(groups.getByRole('link', { name: dismissedTitle, exact: true })).toHaveCount(0)
  }
  await caption(page, 'A later visit picks up where I left off. Each finding keeps its source, and another search can refresh the board.', 5000)
})
