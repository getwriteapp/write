// Page size and margin both change geom()'s usable content height
// (App.svelte ~L106) the same way orientation does, and both go through the
// identical measureAfterPageResize path (~L322-342) — so a regression here
// is the same bug class as orientation.spec.js, just a milder version of it
// per that function's own comment. Covered separately because the trigger
// (a settings toggle, not a CSS transition) and the expected direction of
// change are different enough to be worth pinning down on their own.
import { test, expect } from '@playwright/test'
import { gotoApp, openPageView, setEditorContent, longParagraphHtml, pageSheetRects } from './helpers.js'

test('widening margins adds pages (less room per page, same content)', async ({ page }) => {
  await gotoApp(page)
  await openPageView(page)
  await setEditorContent(page, longParagraphHtml(400))
  await page.waitForTimeout(400)

  const normalRects = await pageSheetRects(page)

  const commander = page.locator('.commander')
  await page.keyboard.press('Control+k')
  await commander.locator('.cmd-view').getByRole('button', { name: 'Wide', exact: true }).click()
  await page.keyboard.press('Escape')
  await page.waitForTimeout(700)

  const wideRects = await pageSheetRects(page)
  // Wide margin shrinks g.contentH (144px each side vs 96px) for the exact
  // same document — capacity can only go down, so the page count is
  // monotonic: switching to Wide can never need FEWER pages than Normal did.
  expect(wideRects.length).toBeGreaterThan(normalRects.length)

  // And it's reversible — switching back re-measures again rather than
  // leaving the Wide-margin break positions stuck on screen.
  await page.keyboard.press('Control+k')
  await commander.locator('.cmd-view').getByRole('button', { name: 'Normal', exact: true }).click()
  await page.keyboard.press('Escape')
  await page.waitForTimeout(700)
  const backToNormalRects = await pageSheetRects(page)
  expect(backToNormalRects.length).toBe(normalRects.length)
})

test('switching page size re-paginates (A4 vs Letter have different physical heights)', async ({ page }) => {
  await gotoApp(page)
  await openPageView(page)
  await setEditorContent(page, longParagraphHtml(400))
  await page.waitForTimeout(400)

  const letterRects = await pageSheetRects(page)

  const commander = page.locator('.commander')
  await page.keyboard.press('Control+k')
  await commander.locator('.cmd-view').getByRole('button', { name: 'A4', exact: true }).click()
  await page.keyboard.press('Escape')
  await page.waitForTimeout(700)

  const a4Rects = await pageSheetRects(page)
  // A4 portrait (1123px tall) has more usable height per page than Letter
  // (1056px), so it can never need MORE pages for the same content — but a
  // genuine re-measure has to have happened, which the page-sheet geometry
  // (not just the count) is what actually proves: a stale/unmeasured layout
  // would leave heights identical to Letter's even though the physical page
  // itself is a different size.
  expect(a4Rects.length).toBeLessThanOrEqual(letterRects.length)
  const sameHeights = a4Rects.length === letterRects.length
    && a4Rects.every((r, i) => Math.abs(r.height - letterRects[i].height) < 0.5)
  expect(sameHeights).toBe(false)
})
