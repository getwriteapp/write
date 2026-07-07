/* .docx export — Tiptap JSON → OOXML via the `docx` package.

   Mapping philosophy: emit named Word styles (Quote, Code, Code Char) rather
   than raw formatting wherever a structure exists, so the import side
   (mammoth style map, see import.js) can recover the structure instead of
   guessing from appearance. Anything styled here must have a matching rule
   in import.js — the two files are a pair.

   Schema covered (the full editor schema as of Wave 1):
     blocks: paragraph, heading 1–3, bulletList, orderedList (nested),
             blockquote, codeBlock, horizontalRule, image (data-URL png/jpeg/gif)
     block attrs: textAlign, lineHeight, indent (0.5in steps)
     inline: text, hardBreak
     marks:  bold, italic, underline, strike, code, link, highlight,
             textStyle (color, fontFamily, fontSize)
   As of Wave 2 (importer v2), everything above round-trips: import.js reads
   back every property this file writes. Keep the two files paired. */

import {
  AlignmentType,
  BorderStyle,
  Document,
  ExternalHyperlink,
  HeadingLevel,
  ImageRun,
  LevelFormat,
  Packer,
  Paragraph,
  TextRun,
} from 'docx'

import { cssToWordFont } from './fonts.js'

const HEADING = { 1: HeadingLevel.HEADING_1, 2: HeadingLevel.HEADING_2, 3: HeadingLevel.HEADING_3 }
const MONO = 'Consolas'

/* Nine indent levels; Word's own list styles stop at nine too. */
const OL_LEVELS = Array.from({ length: 9 }, (_, i) => ({
  level: i,
  format: [LevelFormat.DECIMAL, LevelFormat.LOWER_LETTER, LevelFormat.LOWER_ROMAN][i % 3],
  text: `%${i + 1}.`,
  alignment: AlignmentType.START,
  style: { paragraph: { indent: { left: 720 * (i + 1), hanging: 360 } } },
}))

const STYLES = {
  /* The typography pass (Milestone 2b): a considered scale instead of
     Word's defaults. Body font is deliberately left unset — the recipient's
     Word supplies its own Normal font — but sizes, spacing, and heading
     hierarchy are ours. Sizes are half-points; spacing is twentieths of a
     point (240 = 12pt). */
  default: {
    document: {
      run: { size: 22 }, // 11pt body
      paragraph: { spacing: { line: 276, after: 160 } }, // 1.15 line, 8pt after
    },
    heading1: {
      run: { size: 40, bold: true, color: '1A1A1A' }, // 20pt
      paragraph: { spacing: { before: 360, after: 160 }, keepNext: true },
    },
    heading2: {
      run: { size: 30, bold: true, color: '1A1A1A' }, // 15pt
      paragraph: { spacing: { before: 300, after: 120 }, keepNext: true },
    },
    heading3: {
      run: { size: 25, bold: true, color: '404040' }, // 12.5pt
      paragraph: { spacing: { before: 240, after: 100 }, keepNext: true },
    },
  },
  paragraphStyles: [
    {
      id: 'Quote', name: 'Quote', basedOn: 'Normal', quickFormat: true,
      run: { italics: true, color: '444444' },
      paragraph: {
        indent: { left: 480 },
        spacing: { before: 120, after: 120 },
        border: { left: { style: BorderStyle.SINGLE, size: 12, space: 12, color: 'BBBBBB' } },
      },
    },
    {
      id: 'Code', name: 'Code', basedOn: 'Normal', quickFormat: true,
      run: { font: MONO, size: 20 },
      paragraph: {
        spacing: { before: 0, after: 0 },
        shading: { fill: 'F4F4F2' },
        indent: { left: 240, right: 240 },
      },
    },
    {
      /* a horizontal rule: an empty paragraph whose style draws a bottom
         border — looks like a rule in Word, and the style NAME lets the
         import side turn it back into a real <hr> */
      id: 'HorizontalRule', name: 'Horizontal Rule', basedOn: 'Normal',
      paragraph: {
        spacing: { before: 120, after: 120 },
        border: { bottom: { style: BorderStyle.SINGLE, size: 6, space: 1, color: 'AAAAAA' } },
      },
    },
  ],
  characterStyles: [
    { id: 'CodeChar', name: 'Code Char', basedOn: 'DefaultParagraphFont', run: { font: MONO, size: 20 } },
  ],
}

/* ---- images ----
   The editor stores images as data URLs (self-contained, offline docs).
   Dimensions are read from the file header bytes so this works in both the
   browser and Node (the round-trip tests) without a DOM. Width is capped to
   the usable text column of a Letter page with 1in margins (6.5in = 624px
   at Word's 96 px/in) so pasted photos never overflow the page. */

const MAX_IMAGE_PX = 624
const DOCX_IMAGE_TYPE = { 'image/png': 'png', 'image/jpeg': 'jpg', 'image/gif': 'gif' }

function dataUrlToImage(src) {
  const m = /^data:(image\/[a-z+.-]+);base64,(.*)$/is.exec(src || '')
  if (!m) return null
  const type = DOCX_IMAGE_TYPE[m[1].toLowerCase()]
  if (!type) return null
  const b64 = m[2].replace(/\s+/g, '')
  let bytes
  if (typeof Buffer !== 'undefined') {
    bytes = new Uint8Array(Buffer.from(b64, 'base64'))
  } else {
    const bin = atob(b64)
    bytes = new Uint8Array(bin.length)
    for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i)
  }
  return { type, bytes }
}

function imageSize(type, b) {
  try {
    if (type === 'png' && b.length > 24) {
      return {
        width: (b[16] << 24) | (b[17] << 16) | (b[18] << 8) | b[19],
        height: (b[20] << 24) | (b[21] << 16) | (b[22] << 8) | b[23],
      }
    }
    if (type === 'gif' && b.length > 10) {
      return { width: b[6] | (b[7] << 8), height: b[8] | (b[9] << 8) }
    }
    if (type === 'jpg') {
      // scan segments for a start-of-frame marker (C0–CF minus C4/C8/CC)
      let i = 2
      while (i + 9 < b.length) {
        if (b[i] !== 0xff) { i++; continue }
        const marker = b[i + 1]
        if (marker >= 0xc0 && marker <= 0xcf && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc) {
          return { width: (b[i + 7] << 8) | b[i + 8], height: (b[i + 5] << 8) | b[i + 6] }
        }
        i += 2 + ((b[i + 2] << 8) | b[i + 3])
      }
    }
  } catch { /* fall through */ }
  return null
}

function imageRunFor(node) {
  const img = dataUrlToImage(node.attrs?.src)
  if (!img) return null
  const size = imageSize(img.type, img.bytes)
  if (!size || !size.width || !size.height) return null
  const scale = Math.min(1, MAX_IMAGE_PX / size.width)
  return new ImageRun({
    type: img.type,
    data: img.bytes,
    transformation: {
      width: Math.round(size.width * scale),
      height: Math.round(size.height * scale),
    },
  })
}

/* ---- inline content: text runs, marks, links, hard breaks ---- */

const cleanHex = (c) => {
  // CSS color → docx hex; accepts #rrggbb / rgb(r,g,b); anything else is dropped
  if (!c) return null
  const hex = /^#?([0-9a-f]{6})$/i.exec(c.trim())
  if (hex) return hex[1].toUpperCase()
  const rgb = /^rgb\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)\s*\)$/i.exec(c.trim())
  if (rgb) return rgb.slice(1, 4).map((n) => (+n).toString(16).padStart(2, '0')).join('').toUpperCase()
  return null
}

function markProps(marks = []) {
  const p = {}
  for (const m of marks) {
    if (m.type === 'bold') p.bold = true
    if (m.type === 'italic') p.italics = true
    if (m.type === 'underline') p.underline = {}
    if (m.type === 'strike') p.strike = true
    if (m.type === 'code') p.style = 'CodeChar'
    if (m.type === 'highlight') {
      const fill = cleanHex(m.attrs?.color) || 'FFF176'
      p.shading = { fill } // run shading takes any hex (Word's named highlights don't)
    }
    if (m.type === 'textStyle') {
      const color = cleanHex(m.attrs?.color)
      if (color) p.color = color
      const font = cssToWordFont(m.attrs?.fontFamily)
      if (font) p.font = font
      const pt = parseFloat(m.attrs?.fontSize)
      if (pt) p.size = Math.round(pt * 2) // half-points
    }
  }
  return p
}

/* paragraph/heading visual attributes → docx paragraph properties */
const ALIGN = { left: AlignmentType.LEFT, center: AlignmentType.CENTER, right: AlignmentType.RIGHT, justify: AlignmentType.JUSTIFIED }
function paraProps(node) {
  const a = node.attrs || {}
  const p = {}
  if (a.textAlign && a.textAlign !== 'left' && ALIGN[a.textAlign]) p.alignment = ALIGN[a.textAlign]
  const lh = parseFloat(a.lineHeight)
  if (lh) p.spacing = { line: Math.round(lh * 240) } // 240 twips = single spacing
  if (a.indent) p.indent = { left: 720 * a.indent } // one step = 0.5in = 720 twips
  return p
}

function linkHref(marks = []) {
  return marks.find((m) => m.type === 'link')?.attrs?.href || null
}

/* Consecutive inline nodes sharing one href collapse into one hyperlink,
   so "a [linked phrase with bold inside] b" stays a single link in Word. */
function inlineToChildren(nodes = []) {
  const out = []
  let i = 0
  while (i < nodes.length) {
    const node = nodes[i]
    if (node.type === 'hardBreak') {
      out.push(new TextRun({ text: '', break: 1 }))
      i++
      continue
    }
    if (node.type !== 'text') { i++; continue }

    const href = linkHref(node.marks)
    if (!href) {
      out.push(new TextRun({ text: node.text || '', ...markProps(node.marks) }))
      i++
      continue
    }
    const runs = []
    while (i < nodes.length && nodes[i].type === 'text' && linkHref(nodes[i].marks) === href) {
      runs.push(new TextRun({ text: nodes[i].text || '', style: 'Hyperlink', ...markProps(nodes[i].marks) }))
      i++
    }
    out.push(new ExternalHyperlink({ children: runs, link: href }))
  }
  return out
}

/* ---- block content ---- */

function walkBlocks(nodes, ctx, out) {
  for (const node of nodes || []) walkBlock(node, ctx, out)
}

function walkBlock(node, ctx, out) {
  switch (node.type) {
    case 'paragraph': {
      out.push(new Paragraph({
        children: inlineToChildren(node.content),
        ...(ctx.quote ? { style: 'Quote' } : {}),
        ...(ctx.list ? listOpts(ctx) : {}),
        ...paraProps(node),
      }))
      break
    }
    case 'heading': {
      out.push(new Paragraph({
        children: inlineToChildren(node.content),
        heading: HEADING[node.attrs?.level] || HeadingLevel.HEADING_3,
        ...paraProps(node),
      }))
      break
    }
    case 'blockquote': {
      walkBlocks(node.content, { ...ctx, quote: true }, out)
      break
    }
    case 'bulletList': {
      walkList(node, { ...ctx, list: { kind: 'bullet', level: (ctx.list?.level ?? -1) + 1, instance: ctx.list?.instance } }, out)
      break
    }
    case 'orderedList': {
      /* each top-level ordered list gets its own numbering instance so
         numbering restarts at 1 instead of continuing the previous list */
      const instance = ctx.list?.instance ?? ctx.nextOlInstance()
      walkList(node, { ...ctx, list: { kind: 'ordered', level: (ctx.list?.level ?? -1) + 1, instance } }, out)
      break
    }
    case 'codeBlock': {
      const text = (node.content || []).map((n) => n.text || '').join('')
      for (const line of text.split('\n')) {
        out.push(new Paragraph({ style: 'Code', children: [new TextRun({ text: line })] }))
      }
      break
    }
    case 'horizontalRule': {
      out.push(new Paragraph({ style: 'HorizontalRule' }))
      break
    }
    case 'image': {
      const run = imageRunFor(node)
      if (run) out.push(new Paragraph({ children: [run] }))
      /* non-embeddable src (external URL, unsupported format): dropped —
         the editor only inserts data-URL png/jpeg/gif, so this is rare */
      break
    }
    default: {
      /* unknown block: render its inline content as a plain paragraph
         rather than silently dropping the user's words */
      if (node.content) {
        if (node.content.some((c) => c.type === 'text')) {
          out.push(new Paragraph({ children: inlineToChildren(node.content) }))
        } else {
          walkBlocks(node.content, ctx, out)
        }
      }
    }
  }
}

function listOpts(ctx) {
  const { kind, level, instance } = ctx.list
  return kind === 'bullet'
    ? { bullet: { level: Math.min(level, 8) } }
    : { numbering: { reference: 'write-ol', level: Math.min(level, 8), instance } }
}

function walkList(listNode, ctx, out) {
  for (const item of listNode.content || []) {
    if (item.type !== 'listItem') continue
    let firstParagraphDone = false
    for (const child of item.content || []) {
      if (child.type === 'paragraph') {
        /* only the first paragraph of an item carries the bullet/number;
           follow-on paragraphs indent under it without a fresh marker */
        if (!firstParagraphDone) {
          walkBlock(child, ctx, out)
          firstParagraphDone = true
        } else {
          out.push(new Paragraph({
            children: inlineToChildren(child.content),
            indent: { left: 720 * (ctx.list.level + 1) },
          }))
        }
      } else {
        walkBlock(child, ctx, out) // nested list or other block
      }
    }
  }
}

/* ---- entry points ---- */

export function tiptapToDocument(json) {
  let olInstances = 0
  const ctx = { nextOlInstance: () => olInstances++ }
  const children = []
  walkBlocks(json?.content, ctx, children)
  if (!children.length) children.push(new Paragraph({}))

  return new Document({
    numbering: { config: [{ reference: 'write-ol', levels: OL_LEVELS }] },
    styles: STYLES,
    sections: [{ children }],
  })
}

/* Returns .docx bytes as Uint8Array, in both the browser and Node. */
export async function exportDocx(json) {
  const doc = tiptapToDocument(json)
  if (typeof Blob !== 'undefined' && typeof window !== 'undefined') {
    const blob = await Packer.toBlob(doc)
    return new Uint8Array(await blob.arrayBuffer())
  }
  const buffer = await Packer.toBuffer(doc)
  return new Uint8Array(buffer)
}
