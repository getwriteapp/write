/* The bottom row (word count, document name, save state, key hints) used to
   sit through everything the top chrome ducks away from — including focus
   mode, the one place the app asks for the least chrome of all.

   The rules it follows now, all four asserted below:
     - scroll clears it; scrolling home brings it back
     - focus mode clears it
     - moving the pointer into the bottom of the window summons it, and the
       summon is STICKY — it stays lit after the pointer leaves, until the
       next scroll, keystroke or focus toggle
     - typing does NOT clear it from rest; the save state and word count are
       what you want while writing

   These need a real browser: the behaviour is pointer position against a
   fixed-position band, and jsdom has neither a pointer nor a compositor.
   Playwright's toHaveCSS retries, so the 0.6s fade is waited out. */
import { test, expect } from '@playwright/test'
import { gotoApp, setEditorContent, longParagraphHtml } from './helpers.js'

const stats = '.foot-zone .stats'
const hint = '.foot-zone .hint'
const floor = '.foot-zone .bottom-fade'

// Anywhere along the bottom of the window summons the row — the activation
// band is the full width, not a corner. Dead centre is the interesting spot:
// it is the furthest point from either whisper.
async function hoverBottomEdge(page) {
  const box = page.viewportSize()
  await page.mouse.move(box.width / 2, box.height - 20)
}

async function hoverAwayFromChrome(page) {
  const box = page.viewportSize()
  await page.mouse.move(box.width / 2, box.height / 2)
}

async function settleTyping(page) {
  await page.waitForFunction(() => !document.body.classList.contains('typing'), null, { timeout: 5000 })
}

test('the bottom row is present and lit before anything clears it', async ({ page }) => {
  await gotoApp(page)
  await expect(page.locator(stats)).toHaveCSS('opacity', '1')
  await expect(page.locator(hint)).toHaveCSS('opacity', '1')
})

test('focus mode clears the bottom row; the bottom edge summons it back and it stays', async ({ page }) => {
  await gotoApp(page)
  await hoverAwayFromChrome(page)

  await page.keyboard.press('Control+Enter')
  await expect(page.locator('body')).toHaveAttribute('data-focus', 'on')
  await expect(page.locator(stats)).toHaveCSS('opacity', '0')
  await expect(page.locator(hint)).toHaveCSS('opacity', '0')

  await hoverBottomEdge(page)
  await expect(page.locator(stats)).toHaveCSS('opacity', '1')
  await expect(page.locator(hint)).toHaveCSS('opacity', '1')

  // The whole point of the sticky summon: you look at a word count for
  // longer than you can hold a mouse still.
  await hoverAwayFromChrome(page)
  await page.waitForTimeout(800) // longer than the 0.6s fade would take
  await expect(page.locator(stats)).toHaveCSS('opacity', '1')

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

test('scrolling clears the bottom row; scrolling home restores it', async ({ page }) => {
  await gotoApp(page)
  await setEditorContent(page, longParagraphHtml(200))
  await hoverAwayFromChrome(page)
  await settleTyping(page)
  // Typing must NOT clear the row from rest.
  await expect(page.locator(stats)).toHaveCSS('opacity', '1')

  await page.evaluate(() => window.scrollTo(0, 400))
  await expect(page.locator(stats)).toHaveCSS('opacity', '0')
  // The soft floor under the labels goes with them — it exists to keep text
  // from colliding with the labels, so alone it is just grey over the page.
  await expect(page.locator(floor)).toHaveCSS('opacity', '0')

  await page.evaluate(() => window.scrollTo(0, 0))
  await expect(page.locator(stats)).toHaveCSS('opacity', '1')
  await expect(page.locator(floor)).toHaveCSS('opacity', '1')
})

test('a summoned row goes away again on the next keystroke', async ({ page }) => {
  await gotoApp(page)
  await setEditorContent(page, longParagraphHtml(200))
  await page.evaluate(() => window.scrollTo(0, 400))
  await expect(page.locator(stats)).toHaveCSS('opacity', '0')

  await hoverBottomEdge(page)
  await expect(page.locator(stats)).toHaveCSS('opacity', '1')

  // Going back to work ends the loan.
  await page.locator('.ProseMirror').click()
  await page.keyboard.type('back to it')
  await expect(page.locator(stats)).toHaveCSS('opacity', '0')
})

test('the zone never swallows clicks meant for the page', async ({ page }) => {
  await gotoApp(page)
  const box = page.viewportSize()
  // Dead centre of the bottom edge — the activation band's middle, and the
  // place a full-width hover catcher would have stolen clicks from.
  const atCentre = await page.evaluate(
    ([x, y]) => document.elementFromPoint(x, y)?.closest('.foot-zone') !== null,
    [box.width / 2, box.height - 10],
  )
  expect(atCentre).toBe(false)
})
