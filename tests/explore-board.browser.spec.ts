import { expect, test, type Page } from '@playwright/test'
import { ExploreRequestSchema } from '../shared/explore'
import { resolve } from 'node:path'
import { writeFile } from 'node:fs/promises'

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
      Object.assign(label.style, { position: 'fixed', bottom: '12px', left: '50%', transform: 'translateX(-50%)', zIndex: '10000', maxWidth: '860px', textAlign: 'center', background: '#241e2a', color: '#fff', borderRadius: '12px', padding: '12px 20px', font: '500 16px/1.45 system-ui', boxShadow: '0 4px 20px #241e2a33', pointerEvents: 'none' })
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
      const field = page.locator('.card-inspiration').filter({ has: page.getByRole('img', { name: file.replace('.png', ''), exact: true }) }).getByRole('textbox', { name: 'Inspiration goal' })
      await field.fill(title)
      await field.blur()
    }
    await page.getByRole('button', { name: /^Mood boards:/ }).click()
    await page.getByRole('menuitem', { name: 'Rename board' }).click()
    await page.getByRole('textbox', { name: 'Board name' }).fill('November · Life & work')
    await button(page, 'Save name').click()
    if (recording) {
      const context = [
        [eventTitle, 'An evening worth going out for', 'Small venues, a warm room, and a set I can share with a friend. San Francisco or Oakland. November 13–30, up to $60 per ticket.'],
        [eventTitle, 'Keep some space in the week', 'Make time for live music alongside the next career move. Save a few concrete options before choosing a night.'],
        [jobTitle, 'What I want to make', 'Thoughtful interfaces, interaction prototypes, and design systems. A role where craft and engineering belong on the same team.'],
        [jobTitle, 'How I want to work', 'Remote within the United States, with room to stay rooted in the Bay Area. Read the employer’s location policy before shortlisting.'],
      ] as const
      for (const [source, title, description] of context) {
        const goals = page.getByRole('textbox', { name: 'Inspiration goal' })
        for (let i = 0; i < await goals.count(); i++) {
          if (await goals.nth(i).inputValue() === source) {
            await page.waitForTimeout(200)
            const image = await goals.nth(i).evaluate(input => {
              const photo = input.closest('article')?.querySelector('.inspiration-image')
              const bounds = photo?.getBoundingClientRect()
              return bounds ? { x: bounds.x, y: bounds.y, width: bounds.width, height: bounds.height } : null
            })
            if (!image) throw new Error('The inspiration photo is missing.')
            await page.mouse.click(image.x + image.width / 2, image.y + image.height / 2)
            break
          }
        }
        await button(page, 'More canvas actions').click()
        await page.getByRole('menuitem', { name: 'Add a note' }).click()
        await page.getByRole('textbox', { name: 'Note title' }).fill(title)
        await page.getByRole('textbox', { name: 'Note text' }).fill(description)
        await button(page, 'Add note').click()
        await page.waitForTimeout(200)
        const cards = page.getByRole('textbox', { name: 'Card title' })
        const note = await cards.evaluateAll((inputs, title) => {
          const input = inputs.find(input => input instanceof HTMLInputElement && input.value === title)
          const bounds = input?.closest('article')?.getBoundingClientRect()
          return bounds ? { x: bounds.x, y: bounds.y, width: bounds.width, height: bounds.height } : null
        }, title)
        let parent: { x: number; y: number; width: number; height: number } | null = null
        for (let i = 0; i < await goals.count(); i++) if (await goals.nth(i).inputValue() === source) {
          parent = await goals.nth(i).evaluate(input => {
            const bounds = input.closest('article')?.getBoundingClientRect()
            return bounds ? { x: bounds.x, y: bounds.y, width: bounds.width, height: bounds.height } : null
          })
        }
        if (!note || !parent) throw new Error('The demo context card is missing.')
        const offset = title === 'Keep some space in the week' || title === 'How I want to work' ? 2 : 1
        const targetX = parent.x + parent.width / 2
        const targetY = parent.y + parent.height + 36 + (offset - 1) * (note.height + 48)
        await page.mouse.move(note.x + note.width / 2, note.y + 8)
        await page.mouse.down()
        await page.mouse.move(targetX, targetY, { steps: 16 })
        await page.mouse.up()
      }
    }
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
  test.setTimeout(live ? 650000 : 60000)
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
  if (process.env.UNFOLD_EXPLORE_SEED_ONLY) { await page.screenshot({ path: 'output/explore-demo-v2/seed.png' }); return }
  await caption(page, 'Meaningful design work, more live music, and room for both. This board keeps my goals and constraints together.', 8500)
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
  await caption(page, 'I approve Bay Area jazz under $60 and design engineering work that is remote in the US.', 10000)
  const liveResponse = recording ? page.waitForResponse(response => response.url().endsWith('/api/agent') && response.request().method() === 'POST') : undefined
  await button(page, 'Start search').click()
  if (recording) {
    await caption(page, 'Seven agents take on discovery, verification, shortlisting, and one shared plan.', 6000)
    await button(page, 'Watch on board').click()
    await expect(page.getByRole('complementary', { name: 'Explore agents' })).toBeVisible()
    await expect(page.locator('.explore-work-panel li')).toHaveCount(7)
    await caption(page, 'Each agent reports its own progress. Ticketmaster and JSearch supply leads; Parallel checks original listings.', 8000)
    await expect(page.locator('.explore-work-summary')).toContainText('agents finished', { timeout: 540000 })
    if (liveResponse) {
      const response = await liveResponse
      await writeFile('output/explore-demo-v2/live-request.json', response.request().postData() ?? '')
    }
    await page.screenshot({ path: 'output/explore-demo-v2/agents-terminal.png' })
    process.stdout.write(await page.locator('.explore-work-panel').innerText() + '\n')
    await expect(page.locator('.explore-work-panel li[data-status="complete"]')).toHaveCount(7)
    await page.screenshot({ path: 'output/explore-demo-v2/agents-complete.png' })
    await caption(page, 'Seven agents finished. Two sourced shortlists and a shared plan are now part of the board.', 9000)
    const download = page.waitForEvent('download')
    await button(page, 'Board menu').click()
    await page.getByRole('menuitem', { name: 'Export', exact: true }).click()
    await (await download).saveAs('output/explore-demo-v2/completed-board.unfold')
    await button(page, 'Show updates').click()
    await expect(page.locator('.card-explore-shared')).toHaveCount(1)
    await caption(page, 'The new cards are highlighted. Each result stays connected to the interest that started it.', 8000)
    await button(page, 'Hide agent activity').click()
  } else {
    await expect(button(page, 'Back to board')).toBeVisible({ timeout: live ? 540000 : 10000 })
  }
  if (!live) {
    await expect(dialog).toContainText('JSearch Instant failed')
    await button(page, 'Retry failed').click()
    await expect(button(page, 'Back to board')).toBeVisible()
    expect(eventCalls).toBe(1)
    expect(jobCalls).toBe(2)
  }
  const groups = page.locator('.card-findings')
  await expect(groups).toHaveCount(2)
  if (!recording) {
    await button(page, 'Back to board').click()
    await expect(button(page, 'Explore board')).toBeFocused()
  }
  await button(page, 'Fit board').click()
  await caption(page, 'The new findings and shared next step join the photos and context I started with.', 8000)
  if (recording) {
    for (const [selector, text] of [
      ['.card-findings', 'The jazz shortlist includes venue, date, ticket price when available, and a source I can open.'],
      ['.card-findings', 'Employer pages are checked for US remote eligibility before a design engineering role makes the shortlist.'],
      ['.card-explore-shared', 'The final agent combines both shortlists into one practical plan, keeping the original sources attached.'],
    ] as const) {
      const card = selector === '.card-explore-shared' ? page.locator(selector) : page.locator(selector).filter({ hasText: text.startsWith('The jazz') ? 'Explore board · Events' : 'Explore board · Jobs' })
      const header = await card.locator('.card-header').boundingBox()
      if (!header) throw new Error('A result card is missing from the demo.')
      await page.mouse.click(header.x + header.width / 2, header.y + header.height / 2)
      await page.keyboard.press('Shift+2')
      await caption(page, text, 11000)
      await page.screenshot({ path: text.startsWith('The jazz') ? 'output/explore-demo-v2/jazz-results.png' : selector === '.card-explore-shared' ? 'output/explore-demo-v2/shared-result.png' : 'output/explore-demo-v2/job-results.png' })
      await button(page, 'Fit board').click()
    }
  }
  const events = groups.filter({ hasText: 'Explore board · Events' }).locator('.finding-row')
  const jobs = groups.filter({ hasText: 'Explore board · Jobs' }).locator('.finding-row')
  const candidates = !live || await events.count() > 1 ? events : await jobs.count() > 1 ? jobs : undefined
  let dismissible = candidates?.first()
  if (recording && candidates) {
    const sharedSources = await page.locator('.card-explore-shared a').evaluateAll(links => links.map(link => link.getAttribute('href')))
    dismissible = undefined
    for (let index = 0; index < await candidates.count(); index++) {
      const links = await candidates.nth(index).getByRole('link').evaluateAll(links => links.map(link => link.getAttribute('href')))
      if (!links.some(link => sharedSources.includes(link))) { dismissible = candidates.nth(index); break }
    }
  }
  const dismissedTitle = dismissible ? (await dismissible.getByRole('link').first().innerText()).trim() : undefined
  if (dismissible && dismissedTitle) {
    const dismiss = dismissible.getByRole('button', { name: /^Dismiss / })
    await dismiss.click()
    await expect(groups.getByRole('link', { name: dismissedTitle, exact: true })).toHaveCount(0)
    await caption(page, 'I can dismiss an option I’m not interested in. The decision stays with this board.', 6500)
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
  await caption(page, 'A later visit picks up where I left off. My board, verified findings, shared plan, and dismissals are saved.', 8500)
})
