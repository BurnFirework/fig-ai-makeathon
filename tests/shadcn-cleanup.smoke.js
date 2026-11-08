// With a preview server running after pnpm build (UNFOLD_PROVIDER=demo pnpm start):
// pnpm dlx @playwright/cli -s=shadcn-smoke open http://127.0.0.1:3001 --browser=chrome --idle-timeout=900000
// pnpm dlx @playwright/cli -s=shadcn-smoke run-code "$(cat tests/shadcn-cleanup.smoke.js)"
// pnpm dlx @playwright/cli -s=shadcn-smoke close
// Use a fresh session: this check creates boards and sample content in its isolated browser storage.
async (page) => {
  const assert = (value, message) => { if (!value) throw new Error(message) }
  const results = []
  await page.getByRole('button', { name: 'New board', exact: true }).click()
  const dialog = page.getByRole('dialog')
  const name = page.getByRole('textbox', { name: 'Board name', exact: true })
  assert(await name.evaluate(el => document.activeElement === el), 'New-board input must receive focus')
  const primary = dialog.getByRole('button', { name: 'Create board', exact: true })
  assert(await primary.isDisabled(), 'An empty board name must disable creation')
  const styles = await primary.evaluate(el => ({ weight: getComputedStyle(el).fontWeight, size: getComputedStyle(el).fontSize, background: getComputedStyle(el).backgroundColor }))
  assert(styles.weight === '500' && styles.size === '14px', `Shadcn typography overridden: ${JSON.stringify(styles)}`)
  assert(styles.background === 'rgb(222, 116, 153)', 'Primary action must use the shared primary token (default rose palette)')
  await name.fill('A long mood board name '.repeat(4).slice(0, 80))
  await name.focus()
  await page.keyboard.press('Tab')
  await page.keyboard.press('Tab')
  assert(await primary.evaluate(el => document.activeElement === el), 'Tab must reach the primary action inside the dialog')
  const focus = await primary.evaluate(el => getComputedStyle(el).boxShadow)
  assert(focus !== 'none' && focus.includes('rgba'), `Shared focus ring must be visible: ${focus}`)
  await page.keyboard.press('Enter')
  await dialog.waitFor({ state: 'hidden' })
  results.push({ typography: styles, focusRing: focus })

  for (const width of [320, 375, 850, 851, 1280]) {
    await page.setViewportSize({ width, height: 900 })
    const bounds = await page.locator('.app-header').evaluate(header => {
      const headerRect = header.getBoundingClientRect()
      return [...header.querySelectorAll('button, a')].map(el => {
        const r = el.getBoundingClientRect()
        return { label: el.getAttribute('aria-label') || el.textContent, left: r.left, right: r.right, top: r.top, bottom: r.bottom, headerBottom: headerRect.bottom }
      })
    })
    for (const box of bounds) assert(box.left >= 0 && box.right <= width && box.top >= 0 && box.bottom <= box.headerBottom, `Header control clipped at ${width}px: ${JSON.stringify(box)}`)
    for (let i = 0; i < bounds.length; i++) for (let j = i + 1; j < bounds.length; j++) {
      const a = bounds[i], b = bounds[j]
      assert(Math.min(a.right,b.right) <= Math.max(a.left,b.left) || Math.min(a.bottom,b.bottom) <= Math.max(a.top,b.top), `Header controls overlap at ${width}px: ${a.label}, ${b.label}`)
    }
    const toolbar = await page.locator('.bottom-toolbar').boundingBox()
    assert(toolbar && toolbar.x >= 0 && toolbar.x + toolbar.width <= width, `Toolbar clipped at ${width}px`)
    results.push({ width, headerControls: bounds.length })
  }
  await page.setViewportSize({ width: 375, height: 900 })
  await page.getByRole('button', { name: 'New board', exact: true }).click()
  assert(await name.evaluate(el => getComputedStyle(el).fontSize) === '16px', 'Mobile dialog inputs must retain text-base')
  await page.keyboard.press('Escape')
  await dialog.waitFor({ state: 'hidden' })
  await page.getByRole('combobox', { name: 'Agent provider', exact: true }).click()
  await page.getByRole('option', { name: 'Preview agents', exact: true }).waitFor()
  await page.keyboard.press('Escape')
  await page.getByRole('button', { name: 'Agent activity', exact: true }).click()
  assert(await page.getByRole('button', { name: 'Agent activity', exact: true }).getAttribute('aria-pressed') === 'true', 'Activity toggle must expose its selected state')
  await page.getByRole('button', { name: 'Close activity', exact: true }).click()
  await page.screenshot({ path: 'output/playwright/shadcn-header-mobile.png' })

  await page.getByRole('button', { name: /^Mood boards:/ }).click()
  await page.getByRole('menuitem', { name: 'Rename board', exact: true }).click()
  await name.fill('Summer plans')
  await page.keyboard.press('Enter')
  await page.getByRole('button', { name: 'Mood boards: Summer plans', exact: true }).waitFor()
  await page.reload()
  await page.getByRole('button', { name: 'Mood boards: Summer plans', exact: true }).waitFor()
  assert(await page.locator('.unfold-card').count() === 0, 'New boards must remain independent')
  await page.getByRole('button', { name: 'Mood boards: Summer plans', exact: true }).click()
  await page.getByRole('menuitem', { name: 'Your next chapter', exact: true }).focus()
  await page.keyboard.press('Enter')
  await page.getByRole('button', { name: 'Mood boards: Your next chapter', exact: true }).waitFor()
  await page.setViewportSize({ width: 1280, height: 900 })
  await page.getByRole('button', { name: 'Or explore a sample board', exact: true }).click()
  await page.getByRole('button', { name: /^\d+ Meet new people$/ }).waitFor()
  await page.getByRole('button', { name: /^\d+ Explore a creative practice$/ }).click()
  const star = page.getByRole('button', { name: 'Explore Explore a creative practice', exact: true })
  await star.waitFor()
  assert(await star.evaluate(el => parseFloat(getComputedStyle(el).borderRadius) >= parseFloat(getComputedStyle(el).width) / 2), 'Star variant must keep its circular shape at icon sizes')
  await star.click()
  const question = page.locator('.card-question').first()
  await question.waitFor()
  const choice = question.locator('.choices button').first()
  const unselected = await choice.evaluate(el => getComputedStyle(el).backgroundColor)
  await choice.click()
  assert(await choice.getAttribute('aria-pressed') === 'true', 'Question choice must expose its selected state')
  await page.waitForFunction(() => [...document.querySelectorAll('.card-question .choices button')].some(el => el.getAttribute('aria-pressed') === 'true' && getComputedStyle(el).backgroundColor === 'rgb(251, 231, 238)'))
  assert(await choice.evaluate(el => getComputedStyle(el).backgroundColor) !== unselected, 'Selected choice must have a visible selected style')
  const follow = question.getByRole('button', { name: 'Follow this thread', exact: true })
  assert(await follow.isEnabled(), 'Selecting a choice must enable the primary action')
  await follow.click()
  await page.locator('.card-answer').first().waitFor()
  await page.getByRole('button', { name: 'Fit all nodes', exact: true }).click()
  await page.getByRole('button', { name: 'Fold branch', exact: true }).first().click()
  assert(await page.getByRole('button', { name: 'Expand branch', exact: true }).getAttribute('aria-expanded') === 'false', 'Fold control must expose its collapsed state')
  await page.getByRole('button', { name: 'Expand branch', exact: true }).click()
  await page.getByRole('button', { name: 'Pan tool', exact: true }).click()
  assert(await page.getByRole('button', { name: 'Pan tool', exact: true }).getAttribute('aria-pressed') === 'true', 'Pan selection must update')
  await page.getByRole('button', { name: 'Select tool', exact: true }).click()
  await page.getByRole('button', { name: 'Fit all nodes', exact: true }).click()
  await page.screenshot({ path: 'output/playwright/shadcn-controls-desktop.png' })
  results.push({ boardCreation: true, renameAndReload: true, keyboardSwitching: true, providerPicker: true, activity: true, questionChoiceAndAnswer: true, branchFolding: true, toolbar: true })
  return results
}
