/* Variant B: the card IS the app. Linen's palette, Linen's typeface, the
   app's own corner wordmark and status whisper, and a rust caret sitting in
   a half-written sentence. Nothing here is a mockup of the app -- every
   value is lifted from rooms.css. */
import { readFileSync, writeFileSync } from 'node:fs'
import { createRequire } from 'node:module'

// repo root, two levels up from docs/media/
const REPO = new URL('../../', import.meta.url).pathname.replace(/^\/(\w:)/, '$1').replace(/\/$/, '')
const { chromium } = createRequire(`${REPO}/app/`)('playwright')
const OUT_HTML = new URL('./.card-b.html', import.meta.url) // scratch, gitignored
const OUT_PNG = process.argv[2] || `${REPO}/docs/media/social-preview-b.png`

const b64 = (p) => readFileSync(p).toString('base64')
const figtree = `data:font/woff2;base64,${b64(`${REPO}/app/node_modules/@fontsource-variable/figtree/files/figtree-latin-wght-normal.woff2`)}`
const nunito = `data:font/woff2;base64,${b64(`${REPO}/app/node_modules/@fontsource-variable/nunito-sans/files/nunito-sans-latin-wght-normal.woff2`)}`
const mono = `data:font/woff2;base64,${b64(`${REPO}/app/node_modules/@fontsource-variable/geist-mono/files/geist-mono-latin-wght-normal.woff2`)}`

const html = `<!doctype html>
<html><head><meta charset="utf-8">
<style>
  @font-face { font-family: 'Figtree'; src: url('${figtree}') format('woff2-variations'); font-weight: 300 900; font-display: block; }
  @font-face { font-family: 'Nunito Sans'; src: url('${nunito}') format('woff2-variations'); font-weight: 200 900; font-display: block; }
  @font-face { font-family: 'Geist Mono'; src: url('${mono}') format('woff2-variations'); font-weight: 100 900; font-display: block; }

  * { margin: 0; padding: 0; box-sizing: border-box; }
  html, body { width: 1280px; height: 640px; }

  body {
    --ink: #242321;
    --soft: #8F8D87;
    --faint: #DAD8D2;
    --accent: #B85C38;
    --caret: #96502E;
    background: #FFFFFF;
    position: relative;
    overflow: hidden;
  }
  .glow {
    position: absolute; inset: 0;
    background: radial-gradient(900px 700px at 88% 96%, rgba(184, 92, 56, 0.10), transparent 66%);
  }

  /* the app's own top-left corner mark, at the app's own proportions */
  .wordmark {
    position: absolute; top: 44px; left: 56px;
    font-family: 'Figtree', sans-serif;
    font-weight: 600; font-size: 26px;
    letter-spacing: -0.01em;
    color: var(--soft);
    display: flex; align-items: center;
  }
  .wordmark::after {
    content: ""; width: 11px; height: 11px; border-radius: 50%;
    background: var(--caret); margin-left: 9px;
  }

  /* the page: Linen's body font, its leading, its measure */
  .page {
    position: absolute; left: 56px; right: 56px; top: 214px;
    font-family: 'Nunito Sans', sans-serif;
    font-weight: 400;
    font-size: 57px;
    line-height: 1.5;
    letter-spacing: -0.012em;
    color: var(--ink);
    max-width: 1000px;
  }
  .dim { color: #B4B1AA; }
  .caret {
    display: inline-block;
    width: 4px; height: 61px;
    background: var(--caret);
    border-radius: 1px;
    vertical-align: -12px;
    margin-left: 4px;
  }

  /* the status whisper, bottom right, exactly as the app writes it */
  .stats, .hint {
    position: absolute; bottom: 46px;
    font-family: 'Geist Mono', monospace;
    font-size: 21px;
    letter-spacing: 0.04em;
    color: var(--soft);
  }
  .stats { right: 56px; }
  .hint { left: 56px; color: var(--accent); }
  .hint b { font-weight: 500; }
  .hint span { color: rgba(184, 92, 56, 0.4); margin: 0 10px; }
</style></head>
<body>
  <div class="glow"></div>
  <div class="wordmark">write</div>
  <div class="page">A quiet, beautiful word processor.<br><span class="dim">Start from silence; go up into rich text.</span><i class="caret"></i></div>
  <div class="hint">OFFLINE<span>·</span>REAL .DOCX<span>·</span>GPL-3.0<span>·</span>WINDOWS</div>
  <div class="stats">7.4 MB · no account</div>
</body></html>`

writeFileSync(OUT_HTML, html)

const browser = await chromium.launch()
const page = await browser.newPage({ viewport: { width: 1280, height: 640 }, deviceScaleFactor: 1 })
await page.goto(OUT_HTML.href)
await page.evaluate(() => document.fonts.ready)
await page.screenshot({ path: OUT_PNG })
await browser.close()
console.log('wrote', OUT_PNG)
