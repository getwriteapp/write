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

  // Let it get well into the dim half of the cycle...
  await page.waitForTimeout(1900)
  const dimmed = parseFloat(await caretOpacity(page))
  expect(dimmed).toBeLessThan(0.95)

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
