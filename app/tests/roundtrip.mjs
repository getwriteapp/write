/* .docx round-trip harness.

   For each fixture: editor HTML → Tiptap JSON → export .docx → import via
   mammoth → HTML → Tiptap JSON again, then compare the two JSON trees after
   canonicalization. This tests the real pipeline end to end with the real
   editor schema — if this passes, what you type is what Word gets and what
   comes back.

   Run:  node tests/roundtrip.mjs
   Also writes each fixture's .docx to tests/out/ so they can be opened in
   Word/LibreOffice by hand.

   Fixtures may set `expect` (HTML) when a KNOWN, documented loss applies —
   the fidelity matrix in PROJECT.md must list every use of it. */

import { mkdirSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { deflateSync } from 'node:zlib'

import { generateJSON } from '@tiptap/html'
import StarterKit from '@tiptap/starter-kit'
import Underline from '@tiptap/extension-underline'
import Link from '@tiptap/extension-link'
import Image from '@tiptap/extension-image'

import { exportDocx } from '../src/lib/docx/export.js'
import { importDocx } from '../src/lib/docx/import.js'
import { WELCOME } from '../src/lib/editor.js'

const EXT = [
  StarterKit.configure({ heading: { levels: [1, 2, 3] } }),
  Underline,
  Link.configure({ openOnClick: false }),
  Image.configure({ allowBase64: true }),
]

/* Build a real PNG from spec (signature + IHDR + IDAT + IEND with CRCs) so
   the image fixtures are deterministic and genuinely valid — no hardcoded
   base64 blobs to rot. Solid-color truecolor image. */
function makePngDataUrl(width, height, [r, g, b] = [200, 60, 40]) {
  const crcTable = Array.from({ length: 256 }, (_, n) => {
    let c = n
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1
    return c >>> 0
  })
  const crc32 = (buf) => {
    let c = 0xffffffff
    for (const byte of buf) c = crcTable[(c ^ byte) & 0xff] ^ (c >>> 8)
    return (c ^ 0xffffffff) >>> 0
  }
  const chunk = (type, data) => {
    const len = Buffer.alloc(4)
    len.writeUInt32BE(data.length)
    const body = Buffer.concat([Buffer.from(type, 'ascii'), data])
    const crc = Buffer.alloc(4)
    crc.writeUInt32BE(crc32(body))
    return Buffer.concat([len, body, crc])
  }
  const ihdr = Buffer.alloc(13)
  ihdr.writeUInt32BE(width, 0)
  ihdr.writeUInt32BE(height, 4)
  ihdr[8] = 8   // bit depth
  ihdr[9] = 2   // color type: truecolor
  const row = Buffer.concat([Buffer.from([0]), Buffer.alloc(width * 3)])
  for (let x = 0; x < width; x++) { row[1 + x * 3] = r; row[2 + x * 3] = g; row[3 + x * 3] = b }
  const raw = Buffer.concat(Array.from({ length: height }, () => row))
  const png = Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', deflateSync(raw)),
    chunk('IEND', Buffer.alloc(0)),
  ])
  return `data:image/png;base64,${png.toString('base64')}`
}

const PNG_SMALL = makePngDataUrl(4, 3)
const PNG_WIDE = makePngDataUrl(700, 2, [40, 90, 200]) // wider than the page column — export must scale it
const OUT = join(dirname(fileURLToPath(import.meta.url)), 'out')
mkdirSync(OUT, { recursive: true })

/* ---------- fixtures ---------- */

const fixtures = [
  {
    name: 'paragraphs-and-marks',
    html: '<p>Plain, <strong>bold</strong>, <em>italic</em>, <u>underline</u>, <s>strike</s>, <code>inline code</code>.</p><p>Nested: <strong><em>bold italic</em></strong> and <strong><u>bold underline</u></strong>.</p>',
  },
  {
    name: 'headings',
    html: '<h1>One</h1><p>Body.</p><h2>Two</h2><p>Body.</p><h3>Three</h3><p>Body.</p>',
  },
  {
    name: 'links',
    html: '<p>A <a href="https://example.com/">plain link</a> and a <a href="https://example.com/b"><strong>bold</strong> mixed <em>link</em></a> in text.</p>',
  },
  {
    name: 'bullet-list',
    html: '<ul><li><p>first</p></li><li><p>second with <strong>bold</strong></p></li><li><p>third</p></li></ul>',
  },
  {
    name: 'ordered-list',
    html: '<ol><li><p>one</p></li><li><p>two</p></li></ol><p>between</p><ol><li><p>restarts at one</p></li></ol>',
  },
  {
    name: 'nested-lists',
    html: '<ul><li><p>fruit</p><ul><li><p>apple</p></li><li><p>pear</p></li></ul></li><li><p>veg</p></li></ul>',
  },
  {
    name: 'blockquote',
    html: '<blockquote><p>First quoted paragraph.</p><p>Second quoted paragraph.</p></blockquote><p>After.</p>',
  },
  {
    name: 'code-block',
    html: '<pre><code>const x = 1\n\nfunction f() {\n  return x\n}</code></pre><p>After code.</p>',
  },
  {
    name: 'hard-break',
    html: '<p>line one<br>line two</p>',
  },
  {
    name: 'empty-paragraph-preserved',
    html: '<p>Above the gap.</p><p></p><p>Below the gap.</p>',
  },
  {
    name: 'horizontal-rule',
    html: '<p>Before.</p><hr><p>After.</p>',
  },
  {
    name: 'deep-mixed-nesting',
    html: '<ul><li><p>level 0 bullet</p><ol><li><p>level 1 numbered</p><ul><li><p>level 2 bullet</p></li></ul></li></ol></li></ul>',
  },
  {
    name: 'special-characters',
    html: '<p>Escapes: &lt;tag&gt; &amp; "quotes" — em-dash … ellipsis</p><p>Unicode: naïve café København 東京 🚀</p>',
  },
  {
    name: 'code-inside-link',
    html: '<p>See <a href="https://example.com/api?a=1&amp;b=2">the <code>fetch()</code> docs</a> here.</p>',
  },
  {
    name: 'image-block',
    html: `<p>Before the image.</p><img src="${PNG_SMALL}"><p>After the image.</p>`,
  },
  {
    name: 'image-wide-scaled',
    html: `<h2>Photo</h2><img src="${PNG_WIDE}"><p>Caption-ish text below.</p>`,
  },
  {
    name: 'image-adjacent-images',
    html: `<img src="${PNG_SMALL}"><img src="${PNG_WIDE}"><p>Two in a row above.</p>`,
  },
  {
    name: 'welcome-document',
    html: WELCOME,
  },
]

/* ---------- canonicalization ---------- */

const LINK_ATTR_KEEP = new Set(['href'])

function canon(node) {
  if (Array.isArray(node)) {
    return node.map(canon).filter(Boolean)
  }
  const out = { type: node.type }

  if (node.attrs) {
    const attrs = {}
    for (const [k, v] of Object.entries(node.attrs)) {
      if (v === null || v === undefined) continue
      if (node.type === 'heading' && k !== 'level') continue
      if (node.type === 'codeBlock') continue // language: null noise
      if (node.type === 'image' && k !== 'src') continue // alt/title don't survive .docx (documented)
      attrs[k] = v
    }
    if (Object.keys(attrs).length) out.attrs = attrs
  }

  if (node.marks) {
    const marks = node.marks
      .map((m) => {
        const mm = { type: m.type }
        if (m.attrs) {
          const attrs = {}
          for (const [k, v] of Object.entries(m.attrs)) {
            if (v === null || v === undefined) continue
            if (m.type === 'link' && !LINK_ATTR_KEEP.has(k)) continue
            attrs[k] = v
          }
          if (Object.keys(attrs).length) mm.attrs = attrs
        }
        return mm
      })
      .sort((a, b) => a.type.localeCompare(b.type))
    if (marks.length) out.marks = marks
  }

  if (node.text !== undefined) out.text = node.text

  if (node.content) {
    let content = canon(node.content)
    // merge adjacent text nodes with identical marks (docx runs re-split text)
    const merged = []
    for (const child of content) {
      const prev = merged[merged.length - 1]
      if (
        prev && prev.type === 'text' && child.type === 'text' &&
        JSON.stringify(prev.marks || []) === JSON.stringify(child.marks || [])
      ) {
        prev.text += child.text
      } else {
        merged.push(child)
      }
    }
    if (merged.length) out.content = merged
  }
  return out
}

/* ---------- runner ---------- */

let pass = 0
let fail = 0
const failures = []

for (const f of fixtures) {
  const beforeJson = generateJSON(f.html, EXT)
  const bytes = await exportDocx(beforeJson)
  writeFileSync(join(OUT, `${f.name}.docx`), bytes)

  const { html: importedHtml, messages } = await importDocx(bytes)
  const afterJson = generateJSON(importedHtml, EXT)

  const expected = canon(generateJSON(f.expect ?? f.html, EXT))
  const actual = canon(afterJson)

  const ok = JSON.stringify(expected) === JSON.stringify(actual)
  if (ok) {
    pass++
    console.log(`  PASS  ${f.name}`)
  } else {
    fail++
    failures.push({ name: f.name, expected, actual, importedHtml, messages })
    console.log(`  FAIL  ${f.name}`)
  }
}

console.log(`\n${pass} passed, ${fail} failed — .docx files written to tests/out/`)

for (const f of failures) {
  console.log(`\n===== ${f.name} =====`)
  console.log('--- imported html ---')
  console.log(f.importedHtml)
  if (f.messages?.length) console.log('--- mammoth messages ---\n' + f.messages.join('\n'))
  console.log('--- expected json ---')
  console.log(JSON.stringify(f.expected, null, 1))
  console.log('--- actual json ---')
  console.log(JSON.stringify(f.actual, null, 1))
}

process.exit(fail ? 1 : 0)
