/* Shared setup for the pagination e2e suite.

   The dev build exposes `window.__write` (App.svelte, guarded by
   `import.meta.env.DEV` so it never ships) specifically so automation can
   reach the live Tiptap/ProseMirror editor instance — synthetic key events
   never reach ProseMirror's own handlers, and the view isn't otherwise
   reachable from the DOM. We use it here to load exact, known content
   instead of simulating keystrokes, so a test's expected page count depends
   on the pagination engine and nothing else. */

// Tiptap's `setContent` command defaults its second arg (`emitUpdate`) to
// FALSE — i.e. silently skips the onUpdate hook that queues measurePages.
// Without passing `true` here, Page view would keep showing whatever it had
// (or nothing) and every test built on this would hang waiting for sheets
// that are never coming.
export async function setEditorContent(page, html) {
  await page.waitForFunction(() => !!window.__write?.editor)
  await page.evaluate((html) => {
    window.__write.editor.commands.setContent(html, true)
  }, html)
}

export async function gotoApp(page) {
  await page.goto('/')
  await page.waitForFunction(() => !!window.__write?.editor)
}

// Opens the Commander (Ctrl+K) where view/page-size/orientation/margin live,
// and switches to Page view — the two things nearly every test in this file
// needs before it can look at page sheets at all.
export async function openPageView(page) {
  await page.keyboard.press('Control+k')
  const commander = page.locator('.commander')
  await commander.waitFor({ state: 'visible' })
  // Scoped to .cmd-view, not just .commander: the Templates section below it
  // (TEMPLATES in templates.js) has its own "Letter" button — a letter
  // template, not the Letter page-size toggle — with the same accessible
  // name, so a commander-wide lookup is ambiguous.
  const cmdView = commander.locator('.cmd-view')
  await cmdView.getByRole('button', { name: 'Page', exact: true }).click()
  await cmdView.getByRole('button', { name: 'Letter', exact: true }).click()
  await cmdView.getByRole('button', { name: 'Portrait', exact: true }).click()
  await cmdView.getByRole('button', { name: 'Normal', exact: true }).click()
  await page.keyboard.press('Escape')
  await commander.waitFor({ state: 'hidden' })
}

// A single block of unbroken running text long enough to overflow many
// pages, so the engine has to exercise its line-level splitting (lineBoxes /
// breakBeforeLine) rather than only breaking on paragraph boundaries. One
// <p> (not many) is deliberate: isSplittable only line-breaks a block whose
// content is plain text, and a single giant paragraph guarantees every
// break in the document is a line-level one, not a block-boundary one.
export function longParagraphHtml(sentences = 400) {
  const sentence = 'Pagination measures real layout, not a guess about it. '
  return `<p>${sentence.repeat(sentences)}</p>`
}

// `count` pages of content joined by manual page breaks (Wave 3's void
// pageBreak node — see PageBreak in editor.js). measurePages treats that
// node as an unconditional break, so this produces EXACTLY `count` pages
// regardless of font metrics, viewport, or which fonts have loaded yet —
// the one piece of content in this suite whose page count is a fact about
// the test fixture rather than a fact about layout.
export function manualBreaksHtml(count) {
  const pages = Array.from({ length: count }, (_, i) => `<p>Page ${i + 1} of ${count}.</p>`)
  return pages.join('<div data-type="pageBreak"></div>')
}

// Reads back the geometry the app itself computed, straight off the DOM —
// nothing here duplicates measurePages' own arithmetic. `.page-sheet` tops
// and heights are what the app rendered pageRects into (see App.svelte's
// template); PAGE_GAP is a rendering constant, not reproduced here.
export async function pageSheetRects(page) {
  return page.locator('.page-sheet').evaluateAll((els) =>
    els.map((el) => ({
      top: parseFloat(el.style.top),
      height: parseFloat(el.style.height),
      width: el.getBoundingClientRect().width,
    })))
}

// Every rendered text line's viewport rect, and every page-gap band's
// viewport rect — the two things that must never overlap. Built the same
// way lineBoxes() itself gathers rects (TreeWalker over text nodes,
// getClientRects per node) so this check is exercising the identical DOM
// geometry the engine reasoned about, just read independently and later
// (after the fact), rather than trusting the engine's own bookkeeping.
export async function lineAndGapRects(page) {
  return page.evaluate(() => {
    const pm = document.querySelector('.ProseMirror')
    const lines = []
    if (pm) {
      const walker = document.createTreeWalker(pm, NodeFilter.SHOW_TEXT)
      for (let n = walker.nextNode(); n; n = walker.nextNode()) {
        if (!n.data || !n.data.trim()) continue
        const r = document.createRange()
        r.selectNodeContents(n)
        for (const rect of r.getClientRects()) {
          if (rect.height > 0.5 && rect.width > 0) {
            lines.push({ top: rect.top, bottom: rect.bottom, left: rect.left, right: rect.right })
          }
        }
      }
    }
    const gaps = [...document.querySelectorAll('.page-gap')].map((el) => {
      const r = el.getBoundingClientRect()
      return { top: r.top, bottom: r.bottom }
    })
    return { lines, gaps }
  })
}
