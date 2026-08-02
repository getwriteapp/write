/* Security probe: what survives the editor's HTML parse?
   Feeds hostile HTML through the SAME schema the app edits with, so the
   answer is about write's real attack surface, not a generic Tiptap one.
   Run: node tests/sanitize-probe.mjs */

import { generateJSON } from '@tiptap/html'
import StarterKit from '@tiptap/starter-kit'
import Underline from '@tiptap/extension-underline'
import Link from '@tiptap/extension-link'
import Image from '@tiptap/extension-image'

import {
  FORMATTING_EXTENSIONS, WAVE3_EXTENSIONS, TABLE_EXTENSIONS, WAVE6_EXTENSIONS,
} from '../src/lib/editor.js'

const extensions = [
  StarterKit.configure({ heading: { levels: [1, 2, 3] } }),
  Underline,
  Link.configure({ openOnClick: false, autolink: true }),
  Image.configure({ allowBase64: true }),
  ...FORMATTING_EXTENSIONS,
  ...WAVE3_EXTENSIONS,
  ...TABLE_EXTENSIONS,
  ...WAVE6_EXTENSIONS,
]

const cases = {
  'script tag':        `<p>hi</p><script>alert(1)</script>`,
  'img onerror':       `<img src="x" onerror="alert(1)">`,
  'remote img (beacon)': `<img src="https://tracker.example/pixel.png?doc=1">`,
  'javascript: link':  `<a href="javascript:alert(1)">click</a>`,
  'data: link':        `<a href="data:text/html,<script>alert(1)</script>">click</a>`,
  'svg onload':        `<svg onload="alert(1)"><circle r="9"/></svg>`,
  'iframe':            `<iframe src="https://evil.example"></iframe>`,
  'style expression':  `<p style="background:url(https://tracker.example/x.png)">t</p>`,
  'event handler on p':`<p onmouseover="alert(1)">hover</p>`,
}

for (const [name, html] of Object.entries(cases)) {
  let json
  try { json = JSON.stringify(generateJSON(html, extensions)) }
  catch (e) { console.log(`${name.padEnd(22)} THREW: ${e.message.slice(0, 60)}`); continue }
  const flags = []
  if (/alert\(1\)/.test(json)) flags.push('!! PAYLOAD SURVIVED')
  if (/tracker\.example/.test(json)) flags.push('!! REMOTE URL SURVIVED')
  if (/evil\.example/.test(json)) flags.push('!! IFRAME SRC SURVIVED')
  console.log(`${name.padEnd(22)} ${flags.length ? flags.join(' ') : 'stripped'}`)
  if (flags.length) console.log(`${' '.repeat(24)}${json.slice(0, 200)}`)
}
