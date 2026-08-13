/* The caret breathes through the Web Animations API (App.svelte's
   restartBreathe), not through a CSS class. That swap fixed a real cost —
   the old restart forced a synchronous full-document layout on every
   keystroke — but it moved the animation from the selector-driven cascade to
   the element itself, and a WAAPI animation OVERRIDES ordinary author CSS.

   That is the trap these tests exist for. The old CSS animation stopped
   applying on its own the moment `.show` came off the element, because its
   selector stopped matching. A WAAPI animation does not: left running, it
   keeps writing an opacity onto the caret and holds it visible in exactly
   the states where the caret is supposed to be gone. Every hide path
   therefore has to cancel it, and only a real browser can check that — jsdom
   implements neither compositing nor Element.animate. */
import { test, expect } from '@playwright/test'
import { gotoApp, setEditorContent } from './helpers.js'

const caret = '.caret'

// What the element is actually painted at, which is the only question that
// matters here: it folds the CSS cascade and any running animation together.
async function caretOpacity(page) {
  return page.locator(caret).evaluate((el) => getComputedStyle(el).opacity)
}

async function breatheState(page) {
  return page.locator(caret).evaluate((el) =>
    el.getAnimations().map((a) => a.playState),
  )
}

test('the caret breathes once it is left alone, and restarts solid when it moves', async ({ page }) => {
  await gotoApp(page)
  await setEditorContent(page, '<p>Something to put a caret into.</p>')
  await page.locator('.ProseMirror').click()

  await expect(page.locator(caret)).toHaveClass(/show/)
  // An animation exists and is running — the breath is real, not a static caret.
  await expect.poll(() => breatheState(page)).toContain('running')

  /* Poll rather than sleep-then-check. The breath is a 3.4s WAAPI cycle and
     its WALL-CLOCK progress depends on how much CPU this browser is actually
     getting; with the suite's other workers running, 1900ms of wall clock can
     be a small fraction of that in animation time. Sleeping a fixed 1900ms
     and sampling once made this the flakiest test in the suite — it failed
     reading 0.99 and 0.97, i.e. the breath had barely started, not that it
     was broken. What the test means is "left alone, it dims"; so wait for
     that, with a ceiling generous enough that only a genuinely stuck breath
     fails. See TESTALL-FLAKE.md. */
  await expect
    .poll(async () => parseFloat(await caretOpacity(page)), { timeout: 8000 })
    .toBeLessThan(0.95)

  // ...then move it. A moving caret must be solid again immediately, which is
  // what restarting into the animation's 150ms delay buys.
  await page.keyboard.press('ArrowLeft')
  await page.waitForTimeout(60)
  expect(parseFloat(await caretOpacity(page))).toBeGreaterThan(0.95)
})

test('a running breath cannot hold the caret visible once it should be gone', async ({ page }) => {
  await gotoApp(page)
  await setEditorContent(page, '<p>Selecting this text hides the caret.</p>')
  await page.locator('.ProseMirror').click()
  await expect.poll(() => breatheState(page)).toContain('running')
  await page.waitForTimeout(1200) // mid-breath, animation actively writing opacity

  // A non-empty selection is one of updateCaret's hide paths.
  await page.keyboard.press('Control+a')

  await expect(page.locator(caret)).not.toHaveClass(/show/)
  // The real assertion: painted opacity is 0. If the animation were left
  // running it would keep overriding the stylesheet's `.caret { opacity: 0 }`
  // and this would read somewhere between 0.38 and 1.
  await expect.poll(() => caretOpacity(page)).toBe('0')
})

test('the caret is gone while another surface holds the keyboard', async ({ page }) => {
  await gotoApp(page)
  await setEditorContent(page, '<p>The Commander takes focus.</p>')
  await page.locator('.ProseMirror').click()
  await expect.poll(() => breatheState(page)).toContain('running')
  await page.waitForTimeout(1200)

  await page.keyboard.press('Control+k')
  await page.locator('.commander').waitFor({ state: 'visible' })

  await expect.poll(() => caretOpacity(page)).toBe('0')
})

test('restarting the breath does not accumulate animations', async ({ page }) => {
  await gotoApp(page)
  await setEditorContent(page, '<p>Typing moves the caret a great many times.</p>')
  await page.locator('.ProseMirror').click()

  await page.keyboard.type('one two three four five')
  for (let i = 0; i < 12; i++) await page.keyboard.press('ArrowLeft')

  // One breathe animation, reused. The old implementation tore the CSS
  // animation down and rebuilt it on every move; this one keeps a single
  // object and rewinds it, and a leak would mean dozens stacked on the
  // element. Counted by constructor, not by length: getAnimations() also
  // returns the caret's own transform/height CSSTransitions, which come and
  // go with every move and are not what this is guarding.
  const count = await page.locator(caret).evaluate(
    (el) => el.getAnimations().filter((a) => a.constructor.name === 'Animation').length,
  )
  expect(count).toBe(1)
})

/* Every room carries its own typeface, size, leading and measure, so changing
   one reflows the text under the cursor. The caret is an absolutely-positioned
   element driven by coordsAtPos, so it only lands correctly if something
   re-reads that after the reflow.

   Nothing did, in Flow view. measurePages() ends with an updateCaret() — but
   it returns early when `view !== 'page'`, straight past it, so the caret kept
   the x it had under the PREVIOUS room's font. Reported from real use: cycling
   rooms left it sitting mid-word, worst in Cobalt (monospace, the biggest
   metric change). It looked self-healing because typing fires a selection
   change, which calls updateCaret by another route.

   The assertion is drift: where the caret is PAINTED versus where ProseMirror
   says it is. Comparing against a fixed pixel value would only encode one
   room's metrics. */
async function caretDrift(page) {
  return page.evaluate(() => {
    const ed = window.__write.editor
    const c = ed.view.coordsAtPos(ed.state.selection.head)
    const r = document.querySelector('.caret').getBoundingClientRect()
    return { x: Math.abs(r.left - c.left), y: Math.abs(r.top - c.top) }
  })
}

test('the caret stays on the cursor through a room change (Flow view)', async ({ page }) => {
  await gotoApp(page)
  // Flow is the default view and the one that was broken; assert that rather
  // than assume it, so this cannot quietly start testing Page view instead.
  await expect(page.locator('body')).toHaveAttribute('data-view', 'flow')

  await setEditorContent(page, '<p>Every story starts with a knowing. Before the words.</p>')
  await page.locator('.ProseMirror').click()
  await page.keyboard.press('Control+End') // end of the line, where drift shows most
  await page.waitForTimeout(300)

  expect((await caretDrift(page)).x).toBeLessThan(2)

  // All six rooms, back round to the start.
  for (let i = 0; i < 6; i++) {
    await page.keyboard.press('Control+\\')
    // Past the room's own settle and any webfont swap. Deliberately does NOT
    // touch the keyboard otherwise: typing would mask the bug by updating the
    // caret through the selection path.
    await page.waitForTimeout(900)
    const room = await page.locator('body').getAttribute('data-room')
    const drift = await caretDrift(page)
    expect(drift.x, `x drift in room "${room}"`).toBeLessThan(2)
    expect(drift.y, `y drift in room "${room}"`).toBeLessThan(3)
  }
})
