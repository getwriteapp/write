/* Builds the social preview card as a self-contained HTML page, then
   screenshots it at exactly 1280x640 with the Playwright chromium the repo
   already has. Everything (icon, both typefaces) is embedded as data URIs so
   the page renders identically anywhere. */
import { readFileSync, writeFileSync } from 'node:fs'
import { createRequire } from 'node:module'

// repo root, two levels up from docs/media/
const REPO = new URL('../../', import.meta.url).pathname.replace(/^\/(\w:)/, '$1').replace(/\/$/, '')
// resolve playwright out of the app's own node_modules
const { chromium } = createRequire(`${REPO}/app/`)('playwright')
const OUT_HTML = new URL('./.card.html', import.meta.url) // scratch, gitignored
const OUT_PNG = process.argv[2] || `${REPO}/docs/media/social-preview.png`

const b64 = (p) => readFileSync(p).toString('base64')
const icon = `data:image/png;base64,${b64(`${REPO}/app/src-tauri/icons/icon.png`)}`
const figtree = `data:font/woff2;base64,${b64(`${REPO}/app/node_modules/@fontsource-variable/figtree/files/figtree-latin-wght-normal.woff2`)}`
const nunito = `data:font/woff2;base64,${b64(`${REPO}/app/node_modules/@fontsource-variable/nunito-sans/files/nunito-sans-latin-wght-normal.woff2`)}`

const html = `<!doctype html>
<html><head><meta charset="utf-8">
<style>
  @font-face { font-family: 'Figtree'; src: url('${figtree}') format('woff2-variations'); font-weight: 300 900; font-display: block; }
  @font-face { font-family: 'Nunito Sans'; src: url('${nunito}') format('woff2-variations'); font-weight: 200 900; font-display: block; }

  * { margin: 0; padding: 0; box-sizing: border-box; }
  html, body { width: 1280px; height: 640px; }

  /* Linen's own palette, straight from rooms.css */
  body {
    --ink: #242321;
    --soft: #8F8D87;
    --accent: #B85C38;
    --caret: #96502E;
    --hairline: #EFEEEA;
    background: #FDFCFA;
    position: relative;
    overflow: hidden;
    display: flex;
    align-items: center;
    gap: 76px;
    padding: 0 96px;
    font-kerning: normal;
    -webkit-font-smoothing: antialiased;
  }

  /* The warmth sits in the light, not smeared over the whole surface --
     the same rule the Linen room follows. */
  .glow {
    position: absolute; inset: 0;
    background:
      radial-gradient(760px 620px at 14% 82%, rgba(184, 92, 56, 0.13), transparent 68%),
      radial-gradient(900px 700px at 92% 8%, rgba(184, 92, 56, 0.06), transparent 70%);
  }
  /* a paper edge along the bottom, the way the app's own floor works */
  .floor {
    position: absolute; left: 0; right: 0; bottom: 0; height: 120px;
    background: linear-gradient(to bottom, transparent, rgba(255,255,255,0.85) 70%);
  }

  .icon {
    position: relative;
    width: 300px; height: 300px;
    flex: none;
    border-radius: 64px;
    box-shadow: 0 2px 6px rgba(60,40,30,0.06), 0 26px 60px rgba(90,55,35,0.16);
  }

  .type { position: relative; padding-bottom: 6px; }

  .wordmark {
    font-family: 'Figtree', sans-serif;
    font-weight: 700;
    font-size: 116px;
    letter-spacing: -0.035em;
    color: var(--ink);
    line-height: 1;
    display: flex;
    align-items: center;
  }
  /* the app's signature: one coloured cursor, and nothing else shouting */
  .caret {
    display: inline-block;
    width: 8px; height: 92px;
    margin-left: 14px;
    border-radius: 2px;
    background: var(--caret);
  }

  .tagline {
    font-family: 'Nunito Sans', sans-serif;
    font-weight: 400;
    font-size: 35px;
    line-height: 1.35;
    color: #55534E;
    margin-top: 26px;
    letter-spacing: -0.005em;
  }
  .sub {
    font-family: 'Nunito Sans', sans-serif;
    font-weight: 400;
    font-size: 24px;
    color: var(--soft);
    margin-top: 12px;
  }

  .rule { width: 92px; height: 3px; background: var(--accent); margin: 34px 0 20px; border-radius: 2px; }

  .facts {
    font-family: 'Figtree', sans-serif;
    font-weight: 600;
    font-size: 19px;
    letter-spacing: 0.15em;
    color: var(--accent);
    text-transform: uppercase;
  }
  .facts span { color: rgba(184, 92, 56, 0.45); margin: 0 12px; }
</style></head>
<body>
  <div class="glow"></div>
  <div class="floor"></div>
  <img class="icon" src="${icon}" alt="">
  <div class="type">
    <div class="wordmark">write<i class="caret"></i></div>
    <div class="tagline">A quiet, beautiful word processor.</div>
    <div class="sub">From silence, to rich text.</div>
    <div class="rule"></div>
    <div class="facts">Offline<span>·</span>Real .docx<span>·</span>GPL-3.0<span>·</span>Windows</div>
  </div>
</body></html>`

writeFileSync(OUT_HTML, html)

const browser = await chromium.launch()
const page = await browser.newPage({ viewport: { width: 1280, height: 640 }, deviceScaleFactor: 1 })
await page.goto(OUT_HTML.href)
await page.evaluate(() => document.fonts.ready)
await page.screenshot({ path: OUT_PNG })
await browser.close()
console.log('wrote', OUT_PNG)
