/* Cycling rooms must not leave the caret behind.

   A room carries its own typeface, and a different typeface re-wraps the
   text under the cursor. The caret is not the browser's — it is an
   absolutely-positioned element whose transform is computed from
   coordsAtPos — so unless something re-reads that position after the reflow,
   it stays drawn against wrap points that no longer exist. Reported by Brett
   against 0.4.1: the caret sat mid-word, or past the end of the line, and
   snapped back the moment he started typing (typing fires a selection
   change, which is one of the triggers that DOES call updateCaret).

   Why this has to be a real-browser test, and specifically why it asserts
   the RENDERED rect rather than the transform: `.caret` carries
   `transition: transform 75ms`, so the inline transform is the target, not
   the position. Checking the inline value passes even when the caret is
   visibly in the wrong place, which is exactly the mistake that let this
   ship — measuring the number the code wrote instead of the pixel the user
   sees. Only a compositing browser resolves the two into one answer. */
import { test, expect } from '@playwright/test'
import { gotoApp, setEditorContent } from './helpers.js'

// Long enough to wrap several times at every room's measure: one line hides
// this bug almost entirely, because with nothing to re-wrap only the tail
// shifts a few pixels. The wrapping is the whole point.
const MULTILINE =
  '<p>All stories begin with a knowing. Before the words. The measure of a room '
  + 'decides where every line breaks, and a new typeface moves all of them at '
  + 'once. This paragraph is deliberately long enough to wrap several times.</p>'

// How far the painted caret sits from where the document says the cursor is.
async function caretError(page) {
  return page.evaluate(() => {
    const ed = window.__write.editor
    const c = ed.view.coordsAtPos(ed.state.selection.head)
    const r = document.querySelector('.caret').getBoundingClientRect()
    return { x: Math.abs(r.left - c.left), y: Math.abs(r.top - c.top) }
  })
}

test('the caret stays on the cursor through a full cycle of rooms', async ({ page }) => {
  await gotoApp(page)
  await setEditorContent(page, MULTILINE)
  await page.locator('.ProseMirror').click()
  // Park the cursor at the very end, where re-wrapping moves it furthest.
  await page.evaluate(() => {
    const ed = window.__write.editor
    ed.commands.setTextSelection(ed.state.doc.content.size - 1)
  })
  await expect(page.locator('.caret')).toHaveClass(/show/)

  // Settled before we start: if this is already wrong the rest proves nothing.
  await expect.poll(async () => Math.round((await caretError(page)).x)).toBeLessThanOrEqual(2)

  const seen = []
  for (let i = 0; i < 6; i++) {
    await page.keyboard.press('Control+\\')

    /* Poll, don't sleep-then-check. A fixed 1200ms wait was tuned against an
       unloaded machine: settleCaret's own convergence has a 900ms ceiling,
       and when the suite's other workers starve this browser of frames, that
       ceiling can arrive before the layout has stopped moving — so the caret
       is still mid-settle when a fixed wait samples it (observed: 49px out in
       "slate"). Polling still FAILS on the bug this test exists for, because
       a caret that never converges never satisfies it; it only stops failing
       when the sole problem was the sampling instant. See TESTALL-FLAKE.md. */
    const room = await page.evaluate(() => document.body.getAttribute('data-room'))
    await expect
      .poll(async () => Math.round((await caretError(page)).x), {
        timeout: 5000,
        message: `caret never landed on the cursor horizontally in room "${room}"`,
      })
      .toBeLessThanOrEqual(2)
    await expect
      .poll(async () => Math.round((await caretError(page)).y), {
        timeout: 5000,
        message: `caret never landed on the cursor vertically in room "${room}"`,
      })
      .toBeLessThanOrEqual(2)

    const err = await caretError(page)
    seen.push({ room, x: Math.round(err.x), y: Math.round(err.y) })
  }

  // Every room actually got visited — a cycle that silently stopped moving
  // would pass every assertion above while testing one room six times.
  expect(new Set(seen.map((s) => s.room)).size).toBeGreaterThanOrEqual(5)
})
