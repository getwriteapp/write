/* .docx import v2 — our own OOXML reader (Wave 2; replaced mammoth).

   Why custom: mammoth deliberately outputs semantic HTML and strips visual
   formatting (alignment, colors, fonts, sizes, spacing). That was the right
   tool while write only kept semantic structure; Wave 1 made those visual
   properties first-class, so the importer must read them back. This module
   is the mirror of export.js — every property the exporter writes has a
   reader here, and the round-trip suite holds the two honest.

   Pipeline: unzip (fflate) → parse XML (fast-xml-parser, order-preserving)
   → resolve styles.xml (block roles + doc defaults), numbering.xml
   (bullet vs ordered per level), rels (hyperlinks, images) → walk
   document.xml body → emit editor-schema HTML.

   Known, accepted losses (documented in PROJECT.md §fidelity):
   - tables: outside the editor schema — dropped, reported in messages
   - images in formats browsers can't show (EMF/WMF/TIFF) — dropped
   - style-inherited run formatting from foreign docs (we read direct
     formatting + our own named styles; full basedOn-chain resolution is
     out of scope)
   - explicit black text (000000/auto) is treated as "default ink" so
     foreign docs stay readable in dark rooms */

import { unzipSync, strFromU8 } from 'fflate'
import { XMLParser } from 'fast-xml-parser'

import { wordToCssFont } from './fonts.js'

/* ---- tiny helpers over fast-xml-parser's preserveOrder shape ----
   A node is { 'w:p': [children], ':@': {attrs} } or { '#text': 'str' }. */

const tagOf = (n) => Object.keys(n).find((k) => k !== ':@')
const kidsOf = (n) => {
  const k = n[tagOf(n)]
  return Array.isArray(k) ? k : []
}
const attrsOf = (n) => n[':@'] || {}
const attr = (n, name) => attrsOf(n)[name]
const find = (nodes, tag) => nodes.find((n) => tagOf(n) === tag)
const findAll = (nodes, tag) => nodes.filter((n) => tagOf(n) === tag)

function* walkNodes(nodes) {
  for (const n of nodes) {
    yield n
    yield* walkNodes(kidsOf(n))
  }
}

function textOf(node) {
  let out = ''
  for (const n of walkNodes(kidsOf(node))) {
    if (tagOf(n) === '#text') out += n['#text']
  }
  return out
}

const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
const escAttr = (s) => esc(s).replace(/"/g, '&quot;')

const norm = (s) => (s || '').toLowerCase().replace(/[\s_-]+/g, '')

/* Word's named highlight palette (w:highlight) → hex. Our own exporter
   writes w:shd fills instead, but foreign docs use these names. */
const HIGHLIGHT_HEX = {
  yellow: 'FFFF00', green: '00FF00', cyan: '00FFFF', magenta: 'FF00FF',
  blue: '0000FF', red: 'FF0000', darkblue: '00008B', darkcyan: '008B8B',
  darkgreen: '006400', darkmagenta: '8B008B', darkred: '8B0000',
  darkyellow: '808000', darkgray: 'A9A9A9', lightgray: 'D3D3D3',
  black: '000000', white: 'FFFFFF',
}

const IMAGE_MIME = { png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', gif: 'image/gif' }

function u8ToBase64(bytes) {
  if (typeof Buffer !== 'undefined') return Buffer.from(bytes).toString('base64')
  let bin = ''
  for (let i = 0; i < bytes.length; i += 0x8000) {
    bin += String.fromCharCode(...bytes.subarray(i, i + 0x8000))
  }
  return btoa(bin)
}

/* ---------- package parts ---------- */

const parser = new XMLParser({
  preserveOrder: true,
  ignoreAttributes: false,
  attributeNamePrefix: '',
  trimValues: false,
  parseTagValue: false,
  parseAttributeValue: false,
})

function parsePart(zip, path) {
  const bytes = zip[path]
  return bytes ? parser.parse(strFromU8(bytes)) : null
}

function loadRels(zip) {
  const rels = {}
  const doc = parsePart(zip, 'word/_rels/document.xml.rels')
  if (!doc) return rels
  const root = find(doc, 'Relationships')
  if (!root) return rels
  for (const r of findAll(kidsOf(root), 'Relationship')) {
    rels[attr(r, 'Id')] = { target: attr(r, 'Target') || '', external: attr(r, 'TargetMode') === 'External' }
  }
  return rels
}

/* styles.xml → block/char roles for style ids + document defaults
   (defaults let us suppress formatting that merely restates them) */
function loadStyles(zip) {
  const roles = {}      // styleId → { block: 'heading'|'quote'|'code'|'hr', level? } | { char: 'code' }
  const defaults = { sz: null, font: null, line: null }
  const doc = parsePart(zip, 'word/styles.xml')
  if (!doc) return { roles, defaults }
  const root = find(doc, 'w:styles')
  if (!root) return { roles, defaults }

  const dd = find(kidsOf(root), 'w:docDefaults')
  if (dd) {
    const rDef = find(kidsOf(dd), 'w:rPrDefault')
    const rPrNode = rDef ? find(kidsOf(rDef), 'w:rPr') : null
    if (rPrNode) {
      const sz = find(kidsOf(rPrNode), 'w:sz')
      if (sz) defaults.sz = parseInt(attr(sz, 'w:val'), 10) || null
      const fonts = find(kidsOf(rPrNode), 'w:rFonts')
      if (fonts) defaults.font = attr(fonts, 'w:ascii') || attr(fonts, 'w:hAnsi') || null
    }
    const pDef = find(kidsOf(dd), 'w:pPrDefault')
    const pPrNode = pDef ? find(kidsOf(pDef), 'w:pPr') : null
    if (pPrNode) {
      const spacing = find(kidsOf(pPrNode), 'w:spacing')
      if (spacing && (attr(spacing, 'w:lineRule') || 'auto') === 'auto') {
        defaults.line = parseInt(attr(spacing, 'w:line'), 10) || null
      }
    }
  }

  for (const style of findAll(kidsOf(root), 'w:style')) {
    const id = attr(style, 'w:styleId')
    if (!id) continue
    const nameNode = find(kidsOf(style), 'w:name')
    const role = classifyStyle(id, nameNode ? attr(nameNode, 'w:val') : '')
    if (role) roles[id] = role
  }
  return { roles, defaults }
}

function classifyStyle(styleId, name) {
  for (const key of [norm(name), norm(styleId)]) {
    if (!key) continue
    const h = /^heading([1-9])$/.exec(key)
    if (h) return { block: 'heading', level: Math.min(3, +h[1]) }
    if (key === 'title') return { block: 'heading', level: 1 }
    if (key === 'quote' || key === 'intensequote' || key === 'blocktext') return { block: 'quote' }
    if (key === 'code') return { block: 'code' }
    if (key === 'horizontalrule') return { block: 'hr' }
    if (key === 'codechar') return { char: 'code' }
  }
  return null
}

/* numbering.xml → (numId, ilvl) → 'bullet' | 'ordered' */
function loadNumbering(zip) {
  const abstract = {}   // abstractNumId → { ilvl → numFmt }
  const concrete = {}   // numId → abstractNumId
  const doc = parsePart(zip, 'word/numbering.xml')
  if (!doc) return () => 'bullet'
  const root = find(doc, 'w:numbering')
  if (!root) return () => 'bullet'
  for (const an of findAll(kidsOf(root), 'w:abstractNum')) {
    const id = attr(an, 'w:abstractNumId')
    const levels = {}
    for (const lvl of findAll(kidsOf(an), 'w:lvl')) {
      const fmt = find(kidsOf(lvl), 'w:numFmt')
      if (fmt) levels[attr(lvl, 'w:ilvl')] = attr(fmt, 'w:val')
    }
    abstract[id] = levels
  }
  for (const num of findAll(kidsOf(root), 'w:num')) {
    const absRef = find(kidsOf(num), 'w:abstractNumId')
    if (absRef) concrete[attr(num, 'w:numId')] = attr(absRef, 'w:val')
  }
  return (numId, ilvl) => {
    const levels = abstract[concrete[numId]] || {}
    const fmt = levels[String(ilvl)] ?? levels['0']
    return fmt === 'bullet' ? 'bullet' : 'ordered'
  }
}

/* ---------- run properties ---------- */

function boolProp(rPrKids, tag) {
  const n = find(rPrKids, tag)
  if (!n) return false
  const v = attr(n, 'w:val')
  return !(v === '0' || v === 'false' || v === 'none' || v === 'off')
}

function runProps(rPrNode, ctx) {
  const p = {}
  if (!rPrNode) return p
  const kids = kidsOf(rPrNode)

  if (boolProp(kids, 'w:b')) p.bold = true
  if (boolProp(kids, 'w:i')) p.italic = true
  if (boolProp(kids, 'w:u')) p.underline = true
  if (boolProp(kids, 'w:strike')) p.strike = true

  const rStyle = find(kids, 'w:rStyle')
  if (rStyle && ctx.styles.roles[attr(rStyle, 'w:val')]?.char === 'code') p.code = true

  const color = find(kids, 'w:color')
  if (color) {
    const v = (attr(color, 'w:val') || '').toUpperCase()
    // 'auto' and pure black are the default ink, not a choice worth keeping —
    // and imported explicit-black would be unreadable in the dark rooms
    if (/^[0-9A-F]{6}$/.test(v) && v !== '000000') p.color = v
  }

  const sz = find(kids, 'w:sz')
  if (sz) {
    const half = parseInt(attr(sz, 'w:val'), 10)
    if (half && half !== ctx.styles.defaults.sz) p.size = half / 2
  }

  const fonts = find(kids, 'w:rFonts')
  if (fonts) {
    const name = attr(fonts, 'w:ascii') || attr(fonts, 'w:hAnsi')
    if (name && norm(name) !== norm(ctx.styles.defaults.font || '')) {
      const css = wordToCssFont(name)
      if (css) p.font = css
    }
  }

  const hl = find(kids, 'w:highlight')
  if (hl) {
    const hex = HIGHLIGHT_HEX[norm(attr(hl, 'w:val'))]
    if (hex) p.highlight = hex
  }
  const shd = find(kids, 'w:shd')
  if (shd && !p.highlight) {
    const fill = (attr(shd, 'w:fill') || '').toUpperCase()
    if (/^[0-9A-F]{6}$/.test(fill)) p.highlight = fill
  }
  return p
}

/* ---------- paragraph properties ---------- */

const JC_MAP = { center: 'center', right: 'right', end: 'right', both: 'justify', distribute: 'justify' }

function paraAttrs(pPrNode, ctx, { isList = false } = {}) {
  let styles = []
  let indentAttr = ''
  if (pPrNode) {
    const kids = kidsOf(pPrNode)
    const jc = find(kids, 'w:jc')
    if (jc) {
      const mapped = JC_MAP[attr(jc, 'w:val')]
      if (mapped) styles.push(`text-align: ${mapped}`)
    }
    const spacing = find(kids, 'w:spacing')
    if (spacing && (attr(spacing, 'w:lineRule') || 'auto') === 'auto') {
      const line = parseInt(attr(spacing, 'w:line'), 10)
      if (line && line !== ctx.styles.defaults.line) {
        styles.push(`line-height: ${+(line / 240).toFixed(3)}`)
      }
    }
    if (!isList) {
      const ind = find(kids, 'w:ind')
      if (ind) {
        const left = parseInt(attr(ind, 'w:left') ?? attr(ind, 'w:start'), 10)
        if (left) {
          const steps = Math.max(0, Math.min(8, Math.round(left / 720)))
          if (steps) indentAttr = ` data-indent="${steps}"`
        }
      }
    }
  }
  return (styles.length ? ` style="${escAttr(styles.join('; '))}"` : '') + indentAttr
}

/* ---------- runs → inline segments → HTML ---------- */

function collectSegments(nodes, ctx, out, href = null) {
  for (const node of nodes) {
    const tag = tagOf(node)
    if (tag === 'w:r') {
      const kids = kidsOf(node)
      const props = runProps(find(kids, 'w:rPr'), ctx)
      for (const child of kids) {
        const ct = tagOf(child)
        if (ct === 'w:t') {
          const text = textOf(child)
          if (text) out.segs.push({ type: 'text', text, props, href })
        } else if (ct === 'w:br') {
          if (attr(child, 'w:type') !== 'page') out.segs.push({ type: 'br', props: {}, href })
        } else if (ct === 'w:tab') {
          out.segs.push({ type: 'text', text: ' ', props, href })
        } else if (ct === 'w:drawing') {
          collectDrawing(child, ctx, out)
        }
      }
    } else if (tag === 'w:hyperlink') {
      const rid = attr(node, 'r:id')
      const rel = rid ? ctx.rels[rid] : null
      collectSegments(kidsOf(node), ctx, out, rel?.external ? rel.target : href)
    } else if (tag === 'w:sdt') {
      const content = find(kidsOf(node), 'w:sdtContent')
      if (content) collectSegments(kidsOf(content), ctx, out, href)
    } else if (tag === 'w:smartTag' || tag === 'w:ins') {
      collectSegments(kidsOf(node), ctx, out, href)
    }
  }
}

function collectDrawing(drawing, ctx, out) {
  let blip = null
  let hasTextbox = false
  for (const n of walkNodes([drawing])) {
    const t = tagOf(n)
    if (t === 'a:blip') blip = n
    if (t === 'w:txbxContent') hasTextbox = true
  }
  if (!blip) {
    if (hasTextbox) ctx.note('text box dropped (not supported)')
    return
  }
  const rid = attr(blip, 'r:embed')
  const rel = rid ? ctx.rels[rid] : null
  if (!rel || rel.external) return
  let path = rel.target.replace(/^\//, '')
  if (path.startsWith('../')) path = path.slice(3)
  else if (!path.startsWith('word/')) path = `word/${path}`
  const bytes = ctx.zip[path]
  if (!bytes) return
  const ext = (path.match(/\.([a-z0-9]+)$/i)?.[1] || '').toLowerCase()
  const mime = IMAGE_MIME[ext]
  if (!mime) {
    ctx.note(`image dropped (unsupported format: ${ext || 'unknown'})`)
    return
  }
  out.imgs.push(`<img src="data:${mime};base64,${u8ToBase64(bytes)}">`)
}

function segsToHtml(segs) {
  let html = ''
  let i = 0
  while (i < segs.length) {
    const href = segs[i].href
    if (href) {
      let inner = ''
      while (i < segs.length && segs[i].href === href) inner += segHtml(segs[i++])
      html += `<a href="${escAttr(href)}">${inner}</a>`
    } else {
      html += segHtml(segs[i++])
    }
  }
  return html
}

function segHtml(s) {
  if (s.type === 'br') return '<br>'
  if (!s.text) return ''
  let t = esc(s.text)
  const p = s.props
  if (p.code) t = `<code>${t}</code>`
  if (p.strike) t = `<s>${t}</s>`
  if (p.underline) t = `<u>${t}</u>`
  if (p.italic) t = `<em>${t}</em>`
  if (p.bold) t = `<strong>${t}</strong>`
  const styles = []
  if (p.color) styles.push(`color: #${p.color.toLowerCase()}`)
  if (p.font) styles.push(`font-family: ${p.font}`)
  if (p.size) styles.push(`font-size: ${p.size}pt`)
  if (styles.length) t = `<span style="${escAttr(styles.join('; '))}">${t}</span>`
  if (p.highlight) t = `<mark data-color="#${p.highlight.toLowerCase()}">${t}</mark>`
  return t
}

/* ---------- paragraphs → classified items ---------- */

function classifyParagraph(pNode, ctx) {
  const kids = kidsOf(pNode)
  const pPr = find(kids, 'w:pPr')
  const pPrKids = pPr ? kidsOf(pPr) : []

  const styleNode = find(pPrKids, 'w:pStyle')
  const role = styleNode ? ctx.styles.roles[attr(styleNode, 'w:val')] : null

  if (role?.block === 'hr') return { kind: 'hr' }

  const out = { segs: [], imgs: [] }
  collectSegments(kids, ctx, out)

  if (role?.block === 'code') {
    return { kind: 'code', codeText: out.segs.filter((s) => s.type === 'text').map((s) => s.text).join('') }
  }

  const numPr = find(pPrKids, 'w:numPr')
  const isList = !!numPr
  const attrStr = paraAttrs(pPr, ctx, { isList })
  const inline = segsToHtml(out.segs)

  if (isList) {
    const ilvlNode = find(kidsOf(numPr), 'w:ilvl')
    const numIdNode = find(kidsOf(numPr), 'w:numId')
    const level = Math.max(0, Math.min(8, parseInt(ilvlNode ? attr(ilvlNode, 'w:val') : '0', 10) || 0))
    const numId = numIdNode ? attr(numIdNode, 'w:val') : '0'
    return {
      kind: 'list', level, numId,
      listKind: ctx.numKind(numId, level),
      inner: `<p${attrStr}>${inline}</p>` + out.imgs.join(''),
    }
  }

  if (role?.block === 'heading') {
    const tag = `h${role.level}`
    return { kind: 'block', html: `<${tag}${attrStr}>${inline}</${tag}>` + out.imgs.join('') }
  }
  if (role?.block === 'quote') {
    return { kind: 'quote', inner: `<p${attrStr}>${inline}</p>` }
  }

  // image-only paragraph → bare block image(s), no empty <p> shell
  if (out.imgs.length && !out.segs.some((s) => s.type === 'text' && s.text.trim())) {
    return { kind: 'block', html: out.imgs.join('') }
  }
  return { kind: 'block', html: `<p${attrStr}>${inline}</p>` + out.imgs.join('') }
}

/* ---------- consecutive-item grouping (quotes, code, lists) ---------- */

function buildListHtml(items) {
  let html = ''
  const stack = [] // { tag: 'ul'|'ol', numId }
  const closeOne = () => { html += `</li></${stack.pop().tag}>` }
  for (const it of items) {
    const tag = it.listKind === 'bullet' ? 'ul' : 'ol'
    const level = Math.min(it.level, stack.length) // clamp: only one level deeper at a time
    while (stack.length - 1 > level) closeOne()
    if (stack.length - 1 === level) {
      const top = stack[stack.length - 1]
      const topChanged = top.tag !== tag || (level === 0 && top.numId !== it.numId)
      if (topChanged) {
        closeOne()
        stack.push({ tag, numId: it.numId })
        html += `<${tag}><li>${it.inner}`
      } else {
        html += `</li><li>${it.inner}`
      }
    } else {
      // one level deeper: nested list opens inside the current (still-open) <li>
      stack.push({ tag, numId: it.numId })
      html += `<${tag}><li>${it.inner}`
    }
  }
  while (stack.length) closeOne()
  return html
}

function groupItems(items) {
  const out = []
  let i = 0
  while (i < items.length) {
    const it = items[i]
    if (it.kind === 'quote') {
      let inner = ''
      while (i < items.length && items[i].kind === 'quote') inner += items[i++].inner
      out.push(`<blockquote>${inner}</blockquote>`)
    } else if (it.kind === 'code') {
      const lines = []
      while (i < items.length && items[i].kind === 'code') lines.push(items[i++].codeText)
      out.push(`<pre><code>${esc(lines.join('\n'))}</code></pre>`)
    } else if (it.kind === 'list') {
      const run = []
      while (i < items.length && items[i].kind === 'list') run.push(items[i++])
      out.push(buildListHtml(run))
    } else if (it.kind === 'hr') {
      out.push('<hr>')
      i++
    } else {
      out.push(it.html)
      i++
    }
  }
  return out.join('')
}

/* ---------- entry point ---------- */

export async function importDocx(bytes) {
  const zip = unzipSync(bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes))
  const doc = parsePart(zip, 'word/document.xml')
  if (!doc) throw new Error('not a .docx file (word/document.xml missing)')

  const messages = []
  const counts = {}
  const ctx = {
    zip,
    rels: loadRels(zip),
    styles: loadStyles(zip),
    numKind: loadNumbering(zip),
    note: (msg) => { counts[msg] = (counts[msg] || 0) + 1 },
  }

  const docRoot = find(doc, 'w:document')
  const body = docRoot ? find(kidsOf(docRoot), 'w:body') : null
  if (!body) throw new Error('malformed .docx (no document body)')

  const items = []
  const processChildren = (nodes) => {
    for (const node of nodes) {
      const tag = tagOf(node)
      if (tag === 'w:p') items.push(classifyParagraph(node, ctx))
      else if (tag === 'w:tbl') ctx.note('table dropped (not yet supported)')
      else if (tag === 'w:sdt') {
        const content = find(kidsOf(node), 'w:sdtContent')
        if (content) processChildren(kidsOf(content))
      }
      // w:sectPr and friends: page geometry — read in Wave 3, ignored here
    }
  }
  processChildren(kidsOf(body))

  for (const [msg, n] of Object.entries(counts)) {
    messages.push(n > 1 ? `${msg} ×${n}` : msg)
  }

  return { html: groupItems(items), messages }
}
