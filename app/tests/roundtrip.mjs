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

import { unzipSync, strFromU8 } from 'fflate'

import { generateJSON } from '@tiptap/html'
import StarterKit from '@tiptap/starter-kit'
import Underline from '@tiptap/extension-underline'
import Link from '@tiptap/extension-link'
import Image from '@tiptap/extension-image'

import { exportDocx } from '../src/lib/docx/export.js'
import { importDocx } from '../src/lib/docx/import.js'
import { WELCOME, FORMATTING_EXTENSIONS, WAVE3_EXTENSIONS, TABLE_EXTENSIONS, WAVE6_EXTENSIONS } from '../src/lib/editor.js'

const EXT = [
  StarterKit.configure({ heading: { levels: [1, 2, 3] } }),
  Underline,
  Link.configure({ openOnClick: false }),
  Image.configure({ allowBase64: true }),
  ...FORMATTING_EXTENSIONS,
  ...WAVE3_EXTENSIONS,
  ...TABLE_EXTENSIONS,
  ...WAVE6_EXTENSIONS,
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
  /* ---- Wave-1 formatting: FULL round-trip (importer v2) ---- */
  {
    name: 'fmt-alignment',
    html: '<p style="text-align: center">centered</p><p style="text-align: justify">justified text long enough to matter</p><h2 style="text-align: right">right heading</h2><p>plain after</p>',
  },
  {
    name: 'fmt-spacing-indent',
    html: '<p style="line-height: 2">double spaced</p><p data-indent="2">indented two steps</p><p style="line-height: 1.5" data-indent="1">both at once</p>',
  },
  {
    name: 'fmt-textstyle',
    html: `<p><span style="color: #b91c1c">red text</span> plain <mark data-color="#fef08a">sunny</mark> <span style="font-size: 18pt">big</span> <span style="font-family: 'Literata Variable', serif">literata</span> <span style="font-family: Georgia">georgia</span>.</p>`,
  },
  {
    name: 'fmt-combined-marks',
    html: '<p><strong><span style="color: #1d4ed8">bold blue</span></strong> and <a href="https://example.com/"><span style="font-size: 14pt">a sized link</span></a> and <em><mark data-color="#bbf7d0">green italic</mark></em>.</p>',
  },
  {
    name: 'fmt-in-structures',
    html: '<ul><li><p><span style="color: #15803d">green bullet</span></p></li><li><p style="text-align: center">centered item</p></li></ul><blockquote><p><span style="font-size: 16pt">a big quote</span></p></blockquote>',
  },
  /* ---- Wave 3: manual page breaks (the shape our OWN exporter produces —
     a pageBreak as its own top-level block, never embedded in running text) ---- */
  {
    name: 'page-break-alone',
    html: '<p>Before the break.</p><div data-type="pageBreak"></div><p>After the break.</p>',
  },
  /* ---- Wave 5: tables ---- */
  {
    name: 'table-basic',
    html: '<p>Before.</p><table><tbody><tr><td><p>a1</p></td><td><p>b1</p></td></tr><tr><td><p>a2</p></td><td><p>b2</p></td></tr></tbody></table><p>After.</p>',
  },
  {
    name: 'table-header-row',
    html: '<table><tbody><tr><th><p>Name</p></th><th><p>Amount</p></th></tr><tr><td><p>Ink</p></td><td><p>12</p></td></tr><tr><td><p>Paper</p></td><td><p>7</p></td></tr></tbody></table>',
  },
  {
    name: 'table-cell-formatting',
    html: '<table><tbody><tr><td><p style="text-align: center"><strong>bold centered</strong></p></td><td><p><span style="color: #b91c1c">red</span> and <mark data-color="#fef08a">marked</mark></p></td></tr><tr><td><ul><li><p>one</p></li><li><p>two</p></li></ul></td><td><p>plain</p><p>two paragraphs</p></td></tr></tbody></table>',
  },
  {
    name: 'table-merged-cells',
    html: '<table><tbody><tr><td colspan="2"><p>spans two columns</p></td><td><p>c1</p></td></tr><tr><td rowspan="2"><p>spans two rows</p></td><td><p>b2</p></td><td><p>c2</p></td></tr><tr><td><p>b3</p></td><td><p>c3</p></td></tr></tbody></table>',
  },
  {
    name: 'table-column-widths',
    html: '<table><tbody><tr><td data-colwidth="120"><p>narrow</p></td><td data-colwidth="360"><p>wide</p></td></tr><tr><td data-colwidth="120"><p>n2</p></td><td data-colwidth="360"><p>w2</p></td></tr></tbody></table>',
  },
  /* ---- Wave 6: table of contents ---- */
  {
    name: 'toc-basic',
    html: `<h1>Title</h1><div data-type="tableOfContents" data-entries='[{"level":1,"text":"Title"},{"level":2,"text":"Section"}]'></div><h2>Section</h2><p>Body.</p>`,
  },
  {
    name: 'toc-three-levels',
    html: `<div data-type="tableOfContents" data-entries='[{"level":1,"text":"One"},{"level":2,"text":"Two"},{"level":3,"text":"Three"}]'></div><h1>One</h1><h2>Two</h2><h3>Three</h3>`,
  },
  {
    name: 'toc-empty',
    html: `<div data-type="tableOfContents" data-entries='[]'></div><p>No headings yet.</p>`,
  },
  {
    name: 'welcome-document',
    html: WELCOME,
  },
]

/* ---------- canonicalization ---------- */

const LINK_ATTR_KEEP = new Set(['href'])
const HEADING_ATTR_KEEP = new Set(['level', 'textAlign', 'lineHeight', 'indent'])

function canon(node) {
  if (Array.isArray(node)) {
    return node.map(canon).filter(Boolean)
  }
  const out = { type: node.type }

  if (node.attrs) {
    const attrs = {}
    for (const [k, v] of Object.entries(node.attrs)) {
      if (v === null || v === undefined) continue
      if (node.type === 'heading' && !HEADING_ATTR_KEEP.has(k)) continue
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
            // hex colors round-trip through Word uppercased — compare case-blind
            attrs[k] = k === 'color' ? String(v).toLowerCase() : v
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

/* ---------- Wave-1 formatting: direct OOXML assertions ----------
   These also round-trip end-to-end via the fmt-* fixtures above; this section
   additionally unzips the .docx and asserts against the raw document.xml, so
   a future regression that "round-trips wrong in a way that cancels out" (or
   the reverse — an importer that quietly compensates for an exporter bug)
   can't hide from the test suite. */

const fmtFixture = `
  <p style="text-align:center">centered</p>
  <p style="text-align:justify">justified</p>
  <p style="line-height: 2">double spaced</p>
  <p data-indent="2" style="margin-left: 96px">indented two steps</p>
  <h2 style="text-align:right">right heading</h2>
  <p><span style="color:#b91c1c">red text</span> and
     <mark data-color="#fef08a" style="background-color:#fef08a">highlighted</mark> and
     <span style="font-family: Georgia">georgia text</span> and
     <span style="font-size: 18pt">big text</span></p>`

const fmtBytes = await exportDocx(generateJSON(fmtFixture, EXT))
writeFileSync(join(OUT, 'wave1-formatting.docx'), fmtBytes)
const documentXml = strFromU8(unzipSync(fmtBytes)['word/document.xml'])

const exportChecks = [
  ['alignment: center', '<w:jc w:val="center"/>'],
  ['alignment: justify', '<w:jc w:val="both"/>'],
  ['alignment: right (heading)', '<w:jc w:val="right"/>'],
  ['line spacing: double (480 twips)', 'w:line="480"'],
  ['indent: two steps (1440 twips)', 'w:left="1440"'],
  ['text color', '<w:color w:val="B91C1C"/>'],
  ['highlight (run shading)', 'w:fill="FEF08A"'],
  ['font family', 'w:ascii="Georgia"'],
  ['font size: 18pt (36 half-points)', '<w:sz w:val="36"/>'],
]
for (const [name, needle] of exportChecks) {
  if (documentXml.includes(needle)) {
    pass++
    console.log(`  PASS  export-prop: ${name}`)
  } else {
    fail++
    failures.push({ name: `export-prop: ${name}`, expected: needle, actual: '(not found in document.xml)', importedHtml: '' })
    console.log(`  FAIL  export-prop: ${name}`)
  }
}

/* ---------- Wave 3: page settings (size, orientation, margin) ---------- */

const pageSettingsCases = [
  { pageSize: 'letter', orientation: 'portrait', margin: 'normal' },
  { pageSize: 'letter', orientation: 'landscape', margin: 'wide' },
  { pageSize: 'a4', orientation: 'portrait', margin: 'narrow' },
]
for (const settings of pageSettingsCases) {
  const bytes = await exportDocx(generateJSON('<p>Page settings test.</p>', EXT), settings)
  const back = await importDocx(bytes)
  const name = `page-settings: ${settings.pageSize}/${settings.orientation}/${settings.margin}`
  const ok = back.pageSettings && Object.entries(settings).every(([k, v]) => back.pageSettings[k] === v)
  if (ok) { pass++; console.log(`  PASS  ${name}`) }
  else {
    fail++
    failures.push({ name, expected: settings, actual: back.pageSettings, importedHtml: '' })
    console.log(`  FAIL  ${name}`)
  }
}

/* ---------- Wave 4: header, footer, page numbers ---------- */

const headerFooterCases = [
  {
    name: 'header + footer text, no page numbers',
    settings: { header: { text: 'Chapter One', align: 'left' }, footer: { text: 'Confidential', align: 'right' } },
  },
  {
    name: 'page numbers in footer, no custom text',
    settings: { pageNumbers: { enabled: true, place: 'footer', align: 'center' } },
  },
  {
    name: 'page numbers in header, alongside header text',
    settings: { header: { text: 'Draft', align: 'center' }, pageNumbers: { enabled: true, place: 'header', align: 'right' } },
  },
  {
    name: 'none set — defaults',
    settings: {},
  },
]
const defaultHF = { header: { text: '', align: 'center' }, footer: { text: '', align: 'center' }, pageNumbers: { enabled: false, place: 'footer', align: 'center' } }
for (const { name, settings } of headerFooterCases) {
  const expected = { ...defaultHF, ...settings }
  const bytes = await exportDocx(generateJSON('<p>Header/footer test.</p>', EXT), settings)
  const back = await importDocx(bytes)
  const actual = { header: back.pageSettings.header, footer: back.pageSettings.footer, pageNumbers: back.pageSettings.pageNumbers }
  const ok = JSON.stringify(actual) === JSON.stringify(expected)
  if (ok) { pass++; console.log(`  PASS  header/footer: ${name}`) }
  else {
    fail++
    failures.push({ name: `header/footer: ${name}`, expected, actual, importedHtml: '' })
    console.log(`  FAIL  header/footer: ${name}`)
  }
}

/* ---------- Wave 3: manual page break embedded MID-paragraph ----------
   Our own exporter always emits a page break as its own top-level block —
   see the page-break-alone fixture above — but a real Word document can
   embed one inside a single paragraph's run sequence (Ctrl+Enter mid-
   sentence). Building that shape requires the docx library directly: our
   own JSON schema has no way to *produce* this input, only import.js's
   splitting logic needs to *consume* it. */

{
  const { Document: Doc2, Packer: Packer2, Paragraph: Para2, TextRun: Run2, PageBreak: Brk2 } = await import('docx')
  const doc = new Doc2({
    sections: [{ children: [
      new Para2({ children: [new Run2('Text before'), new Brk2(), new Run2('text after, one paragraph originally.')] }),
    ] }],
  })
  const bytes = new Uint8Array(await Packer2.toBuffer(doc))
  const back = await importDocx(bytes)
  const hasSplit = /Text before<\/p><div data-type="pageBreak"><\/div><p[^>]*>text after/.test(back.html)
  if (hasSplit) { pass++; console.log('  PASS  page-break: mid-paragraph split (foreign doc)') }
  else {
    fail++
    failures.push({ name: 'page-break: mid-paragraph split (foreign doc)', expected: '<p>Text before</p><div data-type="pageBreak"></div><p>text after...', actual: back.html, importedHtml: back.html })
    console.log('  FAIL  page-break: mid-paragraph split (foreign doc)')
  }
}

/* ---------- Wave 5: tables — raw OOXML assertions ----------
   Same rationale as the Wave-1 block above: the table fixtures round-trip
   end-to-end, and this additionally pins the raw XML shape so a
   compensating exporter/importer bug pair can't hide. */

{
  const tblFixture = `
    <table><tbody>
      <tr><th><p>H1</p></th><th><p>H2</p></th><th><p>H3</p></th></tr>
      <tr><td colspan="2"><p>wide</p></td><td rowspan="2"><p>tall</p></td></tr>
      <tr><td><p>a</p></td><td><p>b</p></td></tr>
    </tbody></table>`
  const tblBytes = await exportDocx(generateJSON(tblFixture, EXT))
  writeFileSync(join(OUT, 'wave5-table.docx'), tblBytes)
  const xml = strFromU8(unzipSync(tblBytes)['word/document.xml'])
  const tableChecks = [
    ['table present', '<w:tbl>'],
    ['column grid', '<w:tblGrid>'],
    ['header row repeats on pages', '<w:tblHeader/>'],
    ['header cell shading', 'w:fill="F2F2F0"'],
    ['colspan (gridSpan 2)', '<w:gridSpan w:val="2"/>'],
    ['rowspan start (vMerge restart)', '<w:vMerge w:val="restart"/>'],
    ['rowspan continuation (vMerge)', '<w:vMerge w:val="continue"/>'],
  ]
  for (const [name, needle] of tableChecks) {
    if (xml.includes(needle)) {
      pass++
      console.log(`  PASS  table-xml: ${name}`)
    } else {
      fail++
      failures.push({ name: `table-xml: ${name}`, expected: needle, actual: '(not found in document.xml)', importedHtml: '' })
      console.log(`  FAIL  table-xml: ${name}`)
    }
  }
}

/* ---------- Wave 5: a FOREIGN table shape (built with the docx lib
   directly) — non-uniform column widths must come back as data-colwidth,
   and Word's vMerge pair must fold into a single rowspan cell. */

{
  const { Document: D, Packer: P, Paragraph: Pa, Table: T, TableRow: Tr, TableCell: Tc, WidthType: W, VerticalMergeType: VM } = await import('docx')
  const doc = new D({
    sections: [{ children: [
      new T({
        columnWidths: [1800, 5400],
        width: { size: 7200, type: W.DXA },
        rows: [
          new Tr({ children: [
            new Tc({ children: [new Pa('narrow tall')], verticalMerge: VM.RESTART }),
            new Tc({ children: [new Pa('wide 1')] }),
          ] }),
          new Tr({ children: [
            new Tc({ children: [], verticalMerge: VM.CONTINUE }),
            new Tc({ children: [new Pa('wide 2')] }),
          ] }),
        ],
      }),
    ] }],
  })
  const bytes = new Uint8Array(await P.toBuffer(doc))
  const back = await importDocx(bytes)
  const wantWidths = back.html.includes('data-colwidth="120"') && back.html.includes('data-colwidth="360"')
  const wantMerge = back.html.includes('rowspan="2"')
  const singleTall = (back.html.match(/narrow tall/g) || []).length === 1
  if (wantWidths && wantMerge && singleTall) {
    pass++
    console.log('  PASS  table: foreign widths + vMerge fold (foreign doc)')
  } else {
    fail++
    failures.push({ name: 'table: foreign widths + vMerge fold', expected: 'data-colwidth 120/360, rowspan=2, one "narrow tall" cell', actual: back.html, importedHtml: back.html })
    console.log('  FAIL  table: foreign widths + vMerge fold (foreign doc)')
  }
}

/* ---------- Wave 6: table of contents — raw OOXML assertions ---------- */

{
  const tocJson = generateJSON(
    `<div data-type="tableOfContents" data-entries='[{"level":1,"text":"Intro"},{"level":2,"text":"Details"}]'></div><h1>Intro</h1><h2>Details</h2>`,
    EXT,
  )
  const tocBytes = await exportDocx(tocJson)
  writeFileSync(join(OUT, 'wave6-toc.docx'), tocBytes)
  const xml = strFromU8(unzipSync(tocBytes)['word/document.xml'])
  const tocChecks = [
    ['TOC field present', 'TOC \\h \\o'],
    ['sdt wrapper', '<w:sdt>'],
    ['level-1 cached style', '<w:pStyle w:val="TOC1"/>'],
    ['level-2 cached style', '<w:pStyle w:val="TOC2"/>'],
    ['cached entry text', '<w:t xml:space="default">Intro</w:t>'],
    ['field marked dirty (so Word offers Update Field)', 'w:dirty="true"'],
  ]
  for (const [name, needle] of tocChecks) {
    if (xml.includes(needle)) {
      pass++
      console.log(`  PASS  toc-xml: ${name}`)
    } else {
      fail++
      failures.push({ name: `toc-xml: ${name}`, expected: needle, actual: '(not found in document.xml)', importedHtml: '' })
      console.log(`  FAIL  toc-xml: ${name}`)
    }
  }
}

/* A FOREIGN Word TOC field (built with the docx lib directly, real cached
   page numbers included) — proves detection works off the locale-independent
   instrText field code (not our own alias string), and that a foreign cached
   page number is stripped rather than shown stale. */
{
  const { Document: D2, Packer: P2, Paragraph: Pa2, HeadingLevel: HL2, TableOfContents: T2, TextRun: TR2 } = await import('docx')
  const doc = new D2({
    sections: [{ children: [
      new T2('Sommaire', { // a non-English alias — detection must not depend on it
        hyperlink: true,
        headingStyleRange: '1-2',
        cachedEntries: [
          { level: 1, title: 'Chapitre Un', page: 1 },
          { level: 2, title: 'Section A', page: 2 },
        ],
      }),
      new Pa2({ heading: HL2.HEADING_1, children: [new TR2('Chapitre Un')] }),
      new Pa2({ heading: HL2.HEADING_2, children: [new TR2('Section A')] }),
    ] }],
  })
  const bytes = new Uint8Array(await P2.toBuffer(doc))
  const back = await importDocx(bytes)
  const m = back.html.match(/data-entries="([^"]*)"/)
  const entries = m ? JSON.parse(m[1].replace(/&quot;/g, '"')) : null
  const ok = entries && JSON.stringify(entries) === JSON.stringify([{ level: 1, text: 'Chapitre Un' }, { level: 2, text: 'Section A' }])
  if (ok) { pass++; console.log('  PASS  toc: foreign field (non-English alias, page numbers stripped)') }
  else {
    fail++
    failures.push({ name: 'toc: foreign field', expected: [{ level: 1, text: 'Chapitre Un' }, { level: 2, text: 'Section A' }], actual: entries, importedHtml: back.html })
    console.log('  FAIL  toc: foreign field (non-English alias, page numbers stripped)')
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
