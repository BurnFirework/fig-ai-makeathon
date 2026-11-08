// Run against pnpm dev in an isolated Playwright CLI session:
// pnpm dlx @playwright/cli -s=card-layout open http://127.0.0.1:5173 --idle-timeout=900000
// pnpm dlx @playwright/cli -s=card-layout run-code "$(cat tests/card-layout.smoke.js)"
// pnpm dlx @playwright/cli -s=card-layout close
async (page) => {
  await page.setViewportSize({ width: 2100, height: 1000 });
  await page.locator('.chrome').waitFor();
  await page.evaluate(() => {
    const el = document.querySelector('.chrome');
    let fiber = el[Object.keys(el).find(key => key.startsWith('__reactFiber'))];
    // Reach the real editor through React context without a production test hook.
    let editor;
    for (; fiber; fiber = fiber.return) {
      for (let context = fiber.dependencies?.firstContext; context; context = context.next) {
        if (context.memoizedValue?.getCurrentPageShapes) editor = context.memoizedValue;
      }
    }
    if (!editor) throw new Error('Canvas editor not found');
    window.__layoutEditor = editor;
    editor.deleteShapes([...editor.getCurrentPageShapeIds()]);
    const base = { branchId: 'layout', sequence: 0, revision: 0, stale: false, dependsOn: [], agent: 'branch', createdAt: 0 };
    const fixtures = [
      { type: 'question', prompt: 'Which part of the background design would you like to explore?', purpose: 'Focus the exploration on what interests you.', options: ['Curved wooden staircase', 'Materials and colors', 'Overall room design'] },
      { type: 'answer', text: 'A thoughtful answer with enough detail to explain what I want. '.repeat(25), questionId: 'shape:layout-0' },
      { type: 'opportunity', title: 'A shared possibility with a longer title', description: 'Two inspirations can come together in a practical project. '.repeat(20), benefitA: 'A benefit for this inspiration. '.repeat(8), benefitB: 'Another benefit. '.repeat(8), status: 'proposed', refinement: '', sourceBranchIds: ['a', 'b'] },
      { type: 'action', title: 'Try a small first step', description: 'A detailed practical first step. '.repeat(30), sources: [{ id: 'a', title: 'Source'.repeat(70), url: 'https://example.com' }], completed: false, reflection: '' },
      { type: 'inspiration', goal: 'A longer inspiration goal', assetId: 'asset:missing', started: false },
    ];
    editor.createShapes(fixtures.map((node, index) => ({ id: `shape:layout-${index}`, type: 'node', x: 80 + index * 380, y: 280, props: { node: { ...base, ...node } } })));
    editor.setCamera({ x: 0, y: 0, z: 1 });
  });
  const checkLayout = async () => {
    await page.waitForFunction(() => document.querySelectorAll('.card-actions').length === 3);
    const failures = await page.evaluate(() => {
      const errors = [];
      for (const card of document.querySelectorAll('.unfold-card')) {
        const type = card.className;
        const frame = card.getBoundingClientRect();
        for (const item of card.querySelectorAll('.card-actions button, .card-actions textarea, .answer-body button, .answer-form textarea, .card-footer, .root-controls, .job-state, .stale-banner')) {
          const box = item.getBoundingClientRect();
          if (box.top < frame.top || box.bottom > frame.bottom + 1 || box.left < frame.left || box.right > frame.right + 1) errors.push(`${type}: control escapes card`);
          const body = item.closest('.card-body');
          if (body && box.bottom > body.getBoundingClientRect().bottom + 1) errors.push(`${type}: control clipped by body`);
        }
        const content = card.querySelector('.card-content');
        if (content && content.scrollWidth > content.clientWidth + 1) errors.push(`${type}: horizontal content overflow`);
        const body = card.querySelector('.card-body');
        if (body && body.scrollHeight > body.clientHeight + 1) errors.push(`${type}: actions overflow body`);
      }
      return errors;
    });
    if (failures.length) throw new Error(failures.join('\n'));
  };
  await checkLayout();
  const question = page.locator('.card-question');
  // The exact screenshot should fit without scrolling the prompt or choices.
  const normalFits = await question.locator('.card-content').evaluate(el => el.scrollHeight <= el.clientHeight + 1);
  if (!normalFits) throw new Error('Screenshot question still needs scrolling');
  await question.getByRole('textbox', { name: 'Add a little context' }).fill('Context '.repeat(150));
  await page.locator('.card-answer').getByRole('button', { name: 'Edit my answer' }).click();
  await checkLayout();
  await page.evaluate(async () => {
    const editor = window.__layoutEditor;
    const { uiState } = await import('/client/actions.ts');
    const jobs = {};
    for (const shape of editor.getCurrentPageShapes()) {
      if (shape.type !== 'node') continue;
      const node = shape.props.node;
      editor.updateShape({ id: shape.id, type: 'node', props: { node: { ...node, stale: true, ...(node.type === 'question' ? { options: ['Unbroken'.repeat(40), 'A long option label '.repeat(20)] } : {}) } } });
      jobs[shape.id] = { status: 'error', message: 'A detailed request error. '.repeat(40) };
    }
    uiState.update(editor, state => ({ ...state, jobs }));
  });
  await page.locator('.job-state').first().waitFor();
  await checkLayout();
  await page.evaluate(() => {
    const editor = window.__layoutEditor;
    const action = editor.getShape('shape:layout-3');
    editor.updateShape({ id: action.id, type: 'node', props: { node: { ...action.props.node, completed: true, reflection: 'Reflection'.repeat(120) } } });
    const opportunity = editor.getShape('shape:layout-2');
    editor.updateShape({ id: opportunity.id, type: 'node', props: { node: { ...opportunity.props.node, status: 'accepted' } } });
  });
  await page.getByRole('button', { name: 'What could come next?' }).waitFor();
  await checkLayout();
  console.log('Card layouts passed: screenshot, long content, editing, errors, stale, accepted, completed.');
}
