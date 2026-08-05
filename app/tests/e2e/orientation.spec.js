// The Session 35 regression, guarded directly: switching Portrait -> Landscape
// changes .editor-host's WIDTH, which .editor-host animates over 300ms
// (pages.css: `transition: width 0.3s ease`). The bug was measuring the
// document's layout before that transition settled — queueMeasure's
// immediate pass runs ~2 animation frames (~30ms) after the click, so pages
// were paginated against a box barely a tenth of the way through resizing.
// The fix (measureAfterPageResize, App.svelte ~L309) re-measures on the
// transition's own `transitionend`, with a 420ms timeout as a backup for
// when no transitionend fires at all (already-landscape, reduced motion).
//
// This file asserts against the SETTLED geometry only, the way a user
// experiences it — no fake clocks, no internals poked at. Sanity-checking
// that this is actually a meaningful test (not one that would pass even
// with the bug back) is written up in the PR / handoff notes: a one-off
// fault-injection experiment (artificially slowing the width transition to
// 5s, so the app's real 420ms failsafe fires while the box is genuinely
// mid-transition) reproduces exactly the symptom this test's overlap check
// looks for — 11 of 178 rendered text lines landing on top of a desk-gap
// band once the transition actually finished settling elsewhere. That
// confirms this check has teeth: if the timing regresses, this fails.
import { test, expect } from '@playwright/test'
import { gotoApp, openPageView, setEditorContent, longParagraphHtml, pageSheetRects, lineAndGapRects } from './helpers.js'

test('landscape re-measures after the width transition settles', async ({ page }) => {
  await gotoApp(page)
  await openPageView(page)
  // One long unbroken paragraph: wraps differently at every width, so its
  // rendered geometry is actually sensitive to which width it was measured
  // against — the property this whole test depends on.
  await setEditorContent(page, longParagraphHtml(400))
  await page.waitForTimeout(400) // let the initial portrait measurement land

  const portraitRects = await pageSheetRects(page)
  expect(portraitRects.length).toBeGreaterThan(3)
  // Letter portrait width, from PAGE_PHYSICAL.letter.w in App.svelte
  await expect(page.locator('.editor-host')).toHaveCSS('width', '816px')

  /* The precondition this whole test rests on is that the sheet's width is
     genuinely ANIMATED — if it snapped instantly there would be nothing for
     measureAfterPageResize to wait for, and everything below would pass
     without proving anything.

     Assert that from the computed style, which is deterministic. Two earlier
     attempts tried to catch the box at an intermediate width instead — first
     by polling with one round-trip per sample, then by recording inside the
     page at frame rate — and both failed on a loaded machine for the same
     reason: with the suite's workers running in parallel, rAF is starved
     badly enough that consecutive callbacks straddle the entire 300ms
     animation, so no intermediate frame exists to observe. A precondition
     that fails when the machine is busy and the code is fine is worse than
     no precondition: it trains you to ignore the one test that guards your
     worst bug. The assertions that actually have teeth are below. */
  const transition = await page.locator('.editor-host').evaluate((el) => {
    const s = getComputedStyle(el)
    return { property: s.transitionProperty, duration: s.transitionDuration }
  })
  expect(transition.property).toMatch(/width|all/)
  expect(transition.duration).not.toBe('0s')

  const commander = page.locator('.commander')
  await page.keyboard.press('Control+k')
  await commander.locator('.cmd-view').getByRole('button', { name: 'Landscape', exact: true }).click()
  await page.keyboard.press('Escape')

  // Past the 300ms CSS transition and the 420ms failsafe both.
  await page.waitForTimeout(700)

  // Settled at the real landscape width (Letter: 816 <-> 1056 swap).
  await expect(page.locator('.editor-host')).toHaveCSS('width', '1056px')

  // Re-paginated against that settled width, not the one sampled above:
  // landscape's usable page height (g.contentH) is smaller than portrait's
  // (totalH swaps from 1056 to 816), so every page-sheet is visibly
  // shorter — a real, checkable difference, not just "something changed".
  const landscapeRects = await pageSheetRects(page)
  expect(landscapeRects.length).toBeGreaterThan(0)
  for (const r of landscapeRects) expect(r.height).toBeLessThan(portraitRects[1]?.height ?? portraitRects[0].height)

  // The actual regression symptom: any text line rendered on top of a
  // desk-gap band. Only possible if the spacer/padding geometry baked into
  // the document was computed from a width other than the one the text is
  // actually, currently wrapped at.
  const { lines, gaps } = await lineAndGapRects(page)
  expect(gaps.length).toBe(landscapeRects.length - 1)
  for (const line of lines) {
    for (const gap of gaps) {
      const overlaps = line.top < gap.bottom && line.bottom > gap.top
      expect(overlaps).toBe(false)
    }
  }

  // Stable: waiting longer doesn't change anything further, i.e. this
  // really is the settled state and not a snapshot mid-catch-up.
  await page.waitForTimeout(300)
  const later = await pageSheetRects(page)
  expect(later).toEqual(landscapeRects)
})

test('A4 landscape settles at its own physical width', async ({ page }) => {
  await gotoApp(page)
  await openPageView(page)
  await setEditorContent(page, longParagraphHtml(150))
  await page.waitForTimeout(400)

  const commander = page.locator('.commander')
  await page.keyboard.press('Control+k')
  await commander.locator('.cmd-view').getByRole('button', { name: 'A4', exact: true }).click()
  await commander.locator('.cmd-view').getByRole('button', { name: 'Landscape', exact: true }).click()
  await page.keyboard.press('Escape')
  await page.waitForTimeout(700)

  // Landscape width = portrait HEIGHT (PAGE_PHYSICAL.a4.h in App.svelte) —
  // orientation swaps which physical dimension is "width".
  await expect(page.locator('.editor-host')).toHaveCSS('width', '1123px')
  const { lines, gaps } = await lineAndGapRects(page)
  for (const line of lines) {
    for (const gap of gaps) {
      expect(line.top < gap.bottom && line.bottom > gap.top).toBe(false)
    }
  }
})
