// Base pagination coverage: does Page view draw the right NUMBER of sheets
// for known content, are they placed somewhere plausible (not all at 0, not
// stacked on top of each other), and does content ever visually run through
// the desk gap between two sheets. None of this is reachable from the
// Node/jsdom tests (roundtrip.mjs, tests/unit) — it needs a real layout
// engine. See measurePages in src/App.svelte.
import { test, expect } from '@playwright/test'
import { gotoApp, openPageView, setEditorContent, pageSheetRects, lineAndGapRects, manualBreaksHtml, longParagraphHtml } from './helpers.js'

test.describe('page sheet count and placement', () => {
  test('renders exactly one sheet per manual page break', async ({ page }) => {
    await gotoApp(page)
    await openPageView(page)
    // 5 paragraphs joined by 4 manual breaks: measurePages treats a
    // pageBreak node as an unconditional break, so this is exactly 5 pages
    // regardless of font metrics or which webfont has loaded — the one
    // fixture in this suite whose page count is a fact about the input, not
    // a fact about layout, so it's the right one to pin an exact number to.
    await setEditorContent(page, manualBreaksHtml(5))

    await expect(page.locator('.page-sheet')).toHaveCount(5)

    const rects = await pageSheetRects(page)
    // "plausible positions": strictly increasing tops, starting at 0, each
    // sheet a real (non-zero) height and clear of the one before it. A
    // regression that stacked every sheet at the same offset (or left them
    // at 0) would still satisfy toHaveCount(5) above — this is the check
    // that would actually catch that.
    expect(rects[0].top).toBe(0)
    for (let i = 0; i < rects.length; i++) {
      expect(rects[i].height).toBeGreaterThan(0)
      if (i > 0) expect(rects[i].top).toBeGreaterThan(rects[i - 1].top + rects[i - 1].height - 1)
    }
  })

  test('a single overflowing paragraph is split at real line boundaries, never through the gap', async ({ page }) => {
    await gotoApp(page)
    await openPageView(page)
    await setEditorContent(page, longParagraphHtml(400))

    // Give the debounced measure (queueMeasureSoon, 90ms) + a settle margin
    // time to land before asserting on its output.
    await page.waitForTimeout(300)

    const sheetCount = await page.locator('.page-sheet').count()
    expect(sheetCount).toBeGreaterThan(3) // 400 sentences is many pages at any reasonable line-height

    // Line-level breaks (Session 31) inject `.page-spacer` widgets sized to
    // exactly the gap needed to carry the next line onto the new sheet. A
    // single unbroken paragraph this long can ONLY be split this way (no
    // paragraph boundaries to break on instead), so seeing real, non-zero
    // spacer heights here is direct evidence the line-level path ran.
    const spacerHeights = await page.locator('.page-spacer').evaluateAll((els) => els.map((el) => el.getBoundingClientRect().height))
    expect(spacerHeights.length).toBeGreaterThan(0)
    for (const h of spacerHeights) expect(h).toBeGreaterThan(0)

    // The actual failure mode this project has shipped (Session 35, and the
    // over-tall-block bug before it): text lines rendered ON TOP OF the
    // desk-gap band between two sheets, because the gap the engine reserved
    // didn't match where the lines actually landed. Check every real text
    // line against every real gap band directly, rather than trusting the
    // engine's own bookkeeping.
    const { lines, gaps } = await lineAndGapRects(page)
    expect(gaps.length).toBe(sheetCount - 1)
    for (const line of lines) {
      for (const gap of gaps) {
        const overlaps = line.top < gap.bottom && line.bottom > gap.top
        expect(overlaps).toBe(false)
      }
    }
  })
})
