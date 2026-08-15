/* .md joined .docx/.html/.txt as an openable format. A markdown file is text,
   not markup, so it needs the same real conversion .txt already gets — but
   real formatting (headings, bold, lists, links), not textToHtml's escaped
   paragraphs. This needs a real browser: it drives an actual OS-shaped drop
   event through DataTransfer, which jsdom does not implement. */
import { test, expect } from '@playwright/test'
import { gotoApp } from './helpers.js'

const MD = [
  '# Report Title',
  '',
  'Some **bold** and *italic* text, plus a [link](https://example.com).',
  '',
  '- one',
  '- two',
  '',
  '> a quote',
  '',
  '<script>window.__mdScriptRan = true</script>',
].join('\n')

async function dropFile(page, name, contents, type) {
  await page.evaluate(({ name, contents, type }) => {
    const file = new File([contents], name, { type })
    const dt = new DataTransfer()
    dt.items.add(file)
    document.body.dispatchEvent(new DragEvent('drop', { bubbles: true, cancelable: true, dataTransfer: dt }))
  }, { name, contents, type })
}

test('a dropped .md file renders as real formatting, not literal syntax', async ({ page }) => {
  await gotoApp(page)
  await dropFile(page, 'notes.md', MD, 'text/markdown')

  const pm = page.locator('.ProseMirror')
  /* markdown-it is dynamically imported (see bridge.js: kept out of the main
     bundle, fetched only when a .md is actually opened), so the FIRST drop
     in a fresh page pays for that fetch and parse before any content lands.
     Under this suite's own parallelism -- ~10 browsers sharing one dev
     server, see TESTALL-FLAKE.md -- that cold start can outrun Playwright's
     default 5s auto-retry. Once this one assertion clears, the rest of the
     document arrived in the same setContent call and needs no extra grace. */
  await expect(pm.locator('h1')).toHaveText('Report Title', { timeout: 15000 })
  await expect(pm.locator('strong')).toHaveText('bold')
  await expect(pm.locator('em')).toHaveText('italic')
  await expect(pm.locator('a[href="https://example.com"]')).toHaveText('link')
  await expect(pm.locator('ul li')).toHaveCount(2)
  await expect(pm.locator('blockquote')).toContainText('a quote')

  /* The one that matters most: CommonMark allows raw HTML inside a .md file
     verbatim. markdown-it is configured `html: false` specifically so that
     never becomes markup — it shows up as inert, visible, escaped text (the
     yaml snapshot on a failure here would show literally `<script>...`
     sitting in a paragraph, not hidden), on top of whatever the editor's own
     schema would have stripped anyway. Defense in depth: this proves the
     FIRST layer holds, not only the second. */
  const scriptRan = await page.evaluate(() => window.__mdScriptRan)
  expect(scriptRan).toBeUndefined()
  expect(await pm.locator('script').count()).toBe(0)
})

test('.txt still renders as literal text, not accidentally parsed as markdown', async ({ page }) => {
  await gotoApp(page)
  await dropFile(page, 'plain.txt', 'This has **two stars** and a # sign.', 'text/plain')

  const pm = page.locator('.ProseMirror')
  await expect(pm).toContainText('This has **two stars** and a # sign.')
  await expect(pm.locator('strong')).toHaveCount(0)
  await expect(pm.locator('h1')).toHaveCount(0)
})
