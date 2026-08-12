/* The bottom row (word count, document name, save state, key hints) used to
   sit through everything the top chrome ducks away from — including focus
   mode, the one place the app asks for the least chrome of all.

   These tests need a real browser for the same reason the pagination ones
   do: the behaviour is `:hover` against a fixed-position corner catcher, and
   jsdom has neither a pointer nor a compositor. They assert the settled
   state (Playwright's toHaveCSS retries, so the 0.6s fade is waited out
   rather than raced) instead of poking at classes. */
import { test, expect } from '@playwright/test'
import { gotoApp, setEditorContent, longParagraphHtml } from './helpers.js'

const stats = '.foot-zone .stats'
const hint = '.foot-zone .hint'

// Bottom-left corner, inside .foot-zone::before's 300px x 64px catcher.
async function hoverBottomCorner(page) {
  const box = page.viewportSize()
  await page.mouse.move(60, box.height - 24)
}

async function hoverAwayFromChrome(page) {
  const box = page.viewportSize()
  await page.mouse.move(box.width / 2, box.height / 2)
}

// Every whisper drops to 0.05 for 2.2s after the last keystroke (markTyping),
// which is a different mechanism from the duck under test here. Loading
// content counts as typing, so wait it out before reading opacities.
async function settleTyping(page) {
  await page.waitForFunction(() => !document.body.classList.contains('typing'), null, { timeout: 5000 })
}

test('the bottom row is present and lit before anything ducks it', async ({ page }) => {
  await gotoApp(page)
  await expect(page.locator(stats)).toHaveCSS('opacity', '1')
  await expect(page.locator(hint)).toHaveCSS('opacity', '1')
})

test('focus mode fades the bottom row away, and the corner brings it back', async ({ page }) => {
  await gotoApp(page)
  await hoverAwayFromChrome(page)

  await page.keyboard.press('Control+Enter')
  await expect(page.locator('body')).toHaveAttribute('data-focus', 'on')

  await expect(page.locator(stats)).toHaveCSS('opacity', '0')
  await expect(page.locator(hint)).toHaveCSS('opacity', '0')

  // Reaching into the corner is the whole point: the row has to be
  // recoverable without leaving focus mode.
  await hoverBottomCorner(page)
  await expect(page.locator(stats)).toHaveCSS('opacity', '1')
  await expect(page.locator(hint)).toHaveCSS('opacity', '1')

  // ...and it goes away again when you stop reaching for it.
  await hoverAwayFromChrome(page)
  await expect(page.locator(stats)).toHaveCSS('opacity', '0')

  await page.keyboard.press('Escape')
  await expect(page.locator('body')).toHaveAttribute('data-focus', 'off')
  await expect(page.locator(stats)).toHaveCSS('opacity', '1')
})

test('focus mode clears the wordmark too, and its corner brings it back', async ({ page }) => {
  await gotoApp(page)
  await hoverAwayFromChrome(page)
  await expect(page.locator('.wordmark')).toHaveCSS('opacity', '1')

  await page.keyboard.press('Control+Enter')
  await expect(page.locator('.wordmark')).toHaveCSS('opacity', '0')

  await page.mouse.move(40, 30) // the top-left corner catcher
  await expect(page.locator('.wordmark')).toHaveCSS('opacity', '1')
})

test('scrolling ducks the bottom row; scrolling home restores it', async ({ page }) => {
  await gotoApp(page)
  await setEditorContent(page, longParagraphHtml(200))
  await hoverAwayFromChrome(page)
  await settleTyping(page)
  // Typing alone must NOT duck the row — the save state and word count are
  // exactly what you want while writing. Only scrolling does.
  await expect(page.locator(stats)).toHaveCSS('opacity', '1')

  // Past DUCK_AFTER_PX (8) — the same signal that ducks the Bar and the
  // wordmark, now shared by the bottom row.
  await page.evaluate(() => window.scrollTo(0, 400))
  await expect(page.locator(stats)).toHaveCSS('opacity', '0')

  await page.evaluate(() => window.scrollTo(0, 0))
  await expect(page.locator(stats)).toHaveCSS('opacity', '1')
})

test('the zone never swallows clicks meant for the page', async ({ page }) => {
  await gotoApp(page)
  const box = page.viewportSize()
  // Dead centre of the bottom edge, between the two corner catchers: whatever
  // is under the pointer there must not be the chrome zone.
  const atCentre = await page.evaluate(
    ([x, y]) => document.elementFromPoint(x, y)?.closest('.foot-zone') !== null,
    [box.width / 2, box.height - 10],
  )
  expect(atCentre).toBe(false)
})
