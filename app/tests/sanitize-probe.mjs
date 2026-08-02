/* Security regression suite: what survives the editor's HTML parse?

   Every path that brings foreign HTML into the document — paste, drag-drop,
   opening a .html file — funnels through ProseMirror's DOM parser with the
   schema below. So the schema IS the sanitizer, and this file is the proof.
   It runs the real extension set from editor.js, not a stand-in: if someone
   later adds an extension that widens what's accepted, this goes red.

   The remote-image cases matter as much as the script ones. write's promise
   is that it never touches the network; an <img> pointing at someone else's
   server would quietly break that on the next document a user opens.

   Run: node tests/sanitize-probe.mjs   (or npm run test:security) */

import { generateJSON } from '@tiptap/html'
import StarterKit from '@tiptap/starter-kit'
import Underline from '@tiptap/extension-underline'
import Link from '@tiptap/extension-link'

import {
  OfflineImage, countRemoteImages,
  FORMATTING_EXTENSIONS, WAVE3_EXTENSIONS, TABLE_EXTENSIONS, WAVE6_EXTENSIONS,
} from '../src/lib/editor.js'

const extensions = [
  StarterKit.configure({ heading: { levels: [1, 2, 3] } }),
  Underline,
  Link.configure({ openOnClick: false, autolink: true }),
  OfflineImage,
  ...FORMATTING_EXTENSIONS,
  ...WAVE3_EXTENSIONS,
  ...TABLE_EXTENSIONS,
  ...WAVE6_EXTENSIONS,
]

/* `expect: 'blocked'` — none of the marker strings may appear in the parsed
   document. `expect: 'kept'` — the marker MUST appear, so the suite also
   proves we haven't sanitized away something legitimate. */
const cases = [
  ['script tag',            `<p>hi</p><script>alert(1)</script>`,                    'blocked'],
  ['img onerror',           `<img src="x" onerror="alert(1)">`,                      'blocked'],
  ['svg onload',            `<svg onload="alert(1)"><circle r="9"/></svg>`,          'blocked'],
  ['event handler on p',    `<p onmouseover="alert(1)">hover</p>`,                   'blocked'],
  ['javascript: link',      `<a href="javascript:alert(1)">click</a>`,               'blocked'],
  ['data: link',            `<a href="data:text/html,<script>alert(1)</script>">x</a>`, 'blocked'],
  ['iframe',                `<iframe src="https://evil.example"></iframe>`,          'blocked'],
  ['object/embed',          `<object data="https://evil.example/x.swf"></object>`,   'blocked'],
  ['remote img (beacon)',   `<img src="https://tracker.example/pixel.png?doc=1">`,   'blocked'],
  ['protocol-relative img', `<img src="//tracker.example/pixel.png">`,               'blocked'],
  ['uppercase SRC img',     `<IMG SRC="HTTPS://tracker.example/p.png">`,             'blocked'],
  ['css url() background',  `<p style="background:url(https://tracker.example/x.png)">t</p>`, 'blocked'],
  ['data: img',             `<img src="data:image/gif;base64,R0lGODlhAQABAAAAACw=">`, 'kept'],
  ['ordinary https link',   `<a href="https://example.com/docs">docs</a>`,           'kept'],
]

const MARKERS = /alert\(1\)|tracker\.example|evil\.example/i
const KEPT_MARKER = { 'data: img': /^data:image\/gif/m, 'ordinary https link': /example\.com\/docs/ }

let failed = 0
for (const [name, html, expect] of cases) {
  let json
  try {
    json = JSON.stringify(generateJSON(html, extensions))
  } catch (e) {
    console.log(`  FAIL  ${name} — parser threw: ${e.message.slice(0, 60)}`)
    failed++
    continue
  }

  if (expect === 'blocked') {
    const leaked = MARKERS.test(json)
    console.log(`  ${leaked ? 'FAIL' : 'PASS'}  ${name}${leaked ? ' — PAYLOAD SURVIVED' : ''}`)
    if (leaked) { console.log(`        ${json.slice(0, 220)}`); failed++ }
  } else {
    const kept = KEPT_MARKER[name].test(JSON.parse(json).content?.[0]?.attrs?.src ?? json)
    console.log(`  ${kept ? 'PASS' : 'FAIL'}  ${name}${kept ? '' : ' — legitimate content was stripped'}`)
    if (!kept) { console.log(`        ${json.slice(0, 220)}`); failed++ }
  }
}

/* countRemoteImages drives the user-facing "N online images left out" toast.
   It is NOT the security boundary (the schema is) — but a count of 0 when
   images were actually dropped means content vanishes with no explanation,
   which is its own kind of broken. */
const counts = [
  [`<img src="https://a.example/1.png"><img src='http://b.example/2.png'>`, 2],
  [`<img src="data:image/gif;base64,AAAA">`, 0],
  [`<IMG  SRC = "//c.example/3.png">`, 1],
  [``, 0],
]
for (const [html, want] of counts) {
  const got = countRemoteImages(html)
  const ok = got === want
  console.log(`  ${ok ? 'PASS' : 'FAIL'}  countRemoteImages → ${got} (want ${want})`)
  if (!ok) failed++
}

console.log(`\n${cases.length + counts.length - failed} passed, ${failed} failed`)
process.exit(failed ? 1 : 0)
