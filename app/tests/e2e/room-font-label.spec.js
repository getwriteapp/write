/* Does the Bar's typeface button name the room the document is actually in?
   Brett hit a screenshot where the Bar read "Nunito Sans" over what looked
   like serif text, which is only possible if the label and the page have
   drifted apart. `roomFontLabel` is a $derived that reads
   getComputedStyle(body) for --body-font, keyed on the `room` state — so if
   the state updates before Svelte writes the data-room attribute, the read
   lands on the OUTGOING room's font and never recomputes. This drives the
   real Commander path and compares the label against what is actually
   painted. */
import { test, expect } from '@playwright/test'
import { gotoApp } from './helpers.js'

// [what the page must actually render, what the Bar calls it]. The two differ
// for Paper: the CSS stack names the variable build "Source Serif 4
// Variable", the Bar's own menu has always called that family "Source Serif".
const ROOM_FONT = {
  linen: ['Nunito Sans', 'Nunito Sans'],
  cobalt: ['Reddit Mono', 'Reddit Mono'],
  dawn: ['Petrona', 'Petrona'],
  paper: ['Source Serif 4', 'Source Serif'],
  slate: ['Geist', 'Geist'],
  noir: ['Newsreader', 'Newsreader'],
}

async function pickRoom(page, id) {
  await page.keyboard.press('Control+k')
  await page.locator('.commander').waitFor({ state: 'visible' })
  await page.locator(`.room-card[data-room="${id}"]`).click()
  await page.locator('.commander').waitFor({ state: 'hidden' })
}

async function showBar(page) {
  const bar = page.locator('.bar-font')
  if (!(await bar.isVisible())) await page.keyboard.press('Control+/')
  await bar.waitFor({ state: 'visible' })
}

for (const [id, [family, label]] of Object.entries(ROOM_FONT)) {
  test(`${id}: the Bar names the font the page is actually set in`, async ({ page }) => {
    await gotoApp(page)
    await pickRoom(page, id)
    await showBar(page)

    const rendered = await page
      .locator('.ProseMirror')
      .evaluate((el) => getComputedStyle(el).fontFamily.split(',')[0].replace(/["']/g, '').trim())

    // The stacks name variable builds ("Nunito Sans Variable"); the Bar's
    // menu names the family. Comparing on the family is the real question.
    expect(rendered).toContain(family)
    await expect(page.locator('.bar-font')).toHaveText(new RegExp(label, 'i'))
  })
}

test('switching rooms twice in a row leaves the label on the current room', async ({ page }) => {
  await gotoApp(page)
  await pickRoom(page, 'linen')
  await pickRoom(page, 'dawn')
  await showBar(page)
  await expect(page.locator('.bar-font')).toHaveText(/Petrona/i)

  await pickRoom(page, 'cobalt')
  await expect(page.locator('.bar-font')).toHaveText(/Reddit Mono/i)
})
