/* .docx import v2 — our own OOXML reader (Wave 2; replaced mammoth).

   Why custom: mammoth deliberately outputs semantic HTML and strips visual
   formatting (alignment, colors, fonts, sizes, spacing). That was the right
   tool while write only kept semantic structure; Wave 1 made those visual
   properties first-class, so the importer must read them back. This module
   is the mirror of export.js — every property the exporter writes has a
   reader here, and the round-trip suite holds the two honest.

   Pipeline: unzip (fflate) → parse XML (fast-xml-parser, order-preserving)
   → resolve styles.xml (block roles + doc defaults), numbering.xml
   (bullet vs ordered per level), rels (hyperlinks, images, header/footer
   parts) → walk document.xml body → emit editor-schema HTML. The default
   header1.xml/footer1.xml parts (Wave 4) are read separately, outside the
   body walk — see readHeaderFooterSettings.

   Known, accepted losses (README, "Differences from Word"):
   - tables (Wave 5): structure, header rows, merged cells, and column
     widths round-trip; per-cell shading/borders from foreign docs are
     dropped (the app styles tables itself)
   - table of contents (Wave 6): entries (heading text + level) round-trip;
     real page numbers do not — our own exporter never caches one (we have
     no print-time layout at export), and a foreign doc's cached page
     number is stripped on import rather than shown stale
   - images in formats browsers can't show (EMF/WMF/TIFF) — dropped
   - style-inherited run formatting from foreign docs (we read direct
     formatting + our own named styles; full basedOn-chain resolution is
     out of scope)
   - explicit black text (000000/auto) is treated as "default ink" so
     foreign docs stay readable in dark rooms
   - page size/orientation/margin (Wave 3) snap to our three discrete
     presets (narrow/normal/wide) — an unusual custom margin in a foreign
     doc imports as whichever preset is numerically closest
   - headers/footers (Wave 4): only the "default" header/footer (not
     first-page or even-page variants) is read; only the first plain-text
     paragraph and first PAGE field per part are kept — a foreign doc with
     multiple header/footer paragraphs collapses to the app's one-line model */

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

/* Wave 3: recognize our own page dimensions (and Word's, close enough) to
   report back a pageSize/orientation/margin the app's discrete presets can
   represent. Foreign documents snap to the closest preset — our UI only
   offers three margin widths, not arbitrary values. */
const PAGE_SIZE_TWIPS_APPROX = { letter: 12240, a4: 11906 } // long-edge-agnostic: compare the SMALLER dimension
const MARGIN_TWIPS_APPROX = { narrow: 720, normal: 1440, wide: 2160 }

function closestKey(table, value) {
  let best = null
  let bestDist = Infinity
  for (const [key, v] of Object.entries(table)) {
    const d = Math.abs(v - value)
    if (d < bestDist) { bestDist = d; best = key }
  }
  return best
}

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
        const steps = (v) => Math.max(0, Math.min(8, Math.round(v / 720)))
        const left = parseInt(attr(ind, 'w:left') ?? attr(ind, 'w:start'), 10)
        if (left && steps(left)) indentAttr = ` data-indent="${steps(left)}"`
        // w:firstLine is the first-line indent (Tab at the start of a
        // paragraph); w:hanging is its negative twin, which this editor has no
        // representation for, so it's dropped rather than faked
        const firstLine = parseInt(attr(ind, 'w:firstLine'), 10)
        if (firstLine && steps(firstLine)) indentAttr += ` data-first-line="${steps(firstLine)}"`
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
          out.segs.push({ type: attr(child, 'w:type') === 'page' ? 'pagebreak' : 'br', props: {}, href })
        } else if (ct === 'w:tab') {
          // a real tab, not the space it used to be flattened into: the editor
          // now renders tab characters at Word's own 0.5in stops (tab-size in
          // app.css) and exports them back out as <w:tab/>
          out.segs.push({ type: 'text', text: '\t', props, href })
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

/* A tab character cannot travel through HTML as itself: the parser collapses
   every run of whitespace to one space, so both a raw \t and `&#9;` arrive as
   a plain space (verified). Wrapping it in an explicit `white-space: pre` span
   is what survives — ProseMirror's DOM parser honours that and keeps the tab.
   Everything else in the string is escaped normally. */
function escKeepingTabs(text) {
  if (!text.includes('\t')) return esc(text)
  return text.split('\t')
    .map((piece) => esc(piece))
    .join('<span style="white-space: pre">\t</span>')
}

function segHtml(s) {
  if (s.type === 'br') return '<br>'
  if (s.type === 'pagebreak') return ''
  if (!s.text) return ''
  let t = escKeepingTabs(s.text)
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

/* ---------- paragraphs → classified items ----------
   Returns an ARRAY of items (usually one) — a paragraph containing a manual
   page break splits into: [...before, {kind:'pagebreak'}, ...after], so a
   break embedded mid-paragraph (rare, but real) still becomes a real break
   rather than being silently dropped. */

function classifyParagraph(pNode, ctx) {
  const kids = kidsOf(pNode)
  const pPr = find(kids, 'w:pPr')
  const pPrKids = pPr ? kidsOf(pPr) : []

  const styleNode = find(pPrKids, 'w:pStyle')
  const role = styleNode ? ctx.styles.roles[attr(styleNode, 'w:val')] : null

  if (role?.block === 'hr') return [{ kind: 'hr' }]

  const out = { segs: [], imgs: [] }
  collectSegments(kids, ctx, out)

  if (role?.block === 'code') {
    // a manual break inside a code block is vanishingly rare; keep the text whole
    return [{ kind: 'code', codeText: out.segs.filter((s) => s.type === 'text').map((s) => s.text).join('') }]
  }

  const numPr = find(pPrKids, 'w:numPr')
  const isList = !!numPr
  const attrStr = paraAttrs(pPr, ctx, { isList })

  // split the plain-paragraph case on manual page breaks — the common,
  // supported shape (our own exporter always emits a break alone in its own
  // paragraph; foreign docs may embed it mid-paragraph, handled the same way)
  if (!isList && role?.block !== 'heading' && role?.block !== 'quote') {
    const parts = [[]]
    for (const s of out.segs) {
      if (s.type === 'pagebreak') parts.push([])
      else parts[parts.length - 1].push(s)
    }
    if (parts.length > 1) {
      const items = []
      parts.forEach((segs, i) => {
        if (i > 0) items.push({ kind: 'pagebreak' })
        const hasText = segs.some((s) => s.type === 'text' && s.text.trim())
        const isLast = i === parts.length - 1
        // only the paragraph's own images belong on the last part (they were
        // collected once for the whole node); an empty non-last part with no
        // text is just the break's own paragraph — skip its empty <p> shell
        if (hasText || (isLast && (out.imgs.length || segs.length))) {
          items.push({ kind: 'block', html: `<p${attrStr}>${segsToHtml(segs)}</p>` + (isLast ? out.imgs.join('') : '') })
        }
      })
      return items
    }
  }

  const inline = segsToHtml(out.segs)

  if (isList) {
    const ilvlNode = find(kidsOf(numPr), 'w:ilvl')
    const numIdNode = find(kidsOf(numPr), 'w:numId')
    const level = Math.max(0, Math.min(8, parseInt(ilvlNode ? attr(ilvlNode, 'w:val') : '0', 10) || 0))
    const numId = numIdNode ? attr(numIdNode, 'w:val') : '0'
    return [{
      kind: 'list', level, numId,
      listKind: ctx.numKind(numId, level),
      inner: `<p${attrStr}>${inline}</p>` + out.imgs.join(''),
    }]
  }

  if (role?.block === 'heading') {
    const tag = `h${role.level}`
    return [{ kind: 'block', html: `<${tag}${attrStr}>${inline}</${tag}>` + out.imgs.join('') }]
  }
  if (role?.block === 'quote') {
    return [{ kind: 'quote', inner: `<p${attrStr}>${inline}</p>` }]
  }

  // image-only paragraph → bare block image(s), no empty <p> shell
  if (out.imgs.length && !out.segs.some((s) => s.type === 'text' && s.text.trim())) {
    return [{ kind: 'block', html: out.imgs.join('') }]
  }
  return [{ kind: 'block', html: `<p${attrStr}>${inline}</p>` + out.imgs.join('') }]
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
    } else if (it.kind === 'pagebreak') {
      out.push('<div data-type="pageBreak"></div>')
      i++
    } else {
      out.push(it.html)
      i++
    }
  }
  return out.join('')
}

/* ---------- Wave 5: tables ----------
   w:tbl → <table>. The mirror of export.js's tableFor: header rows come
   back from w:tblHeader (not from shading — that's just Word cosmetics),
   colspan from w:gridSpan, rowspan from w:vMerge (a 'restart' cell swallows
   the 'continue' cells below it at the same grid column), and column widths
   from w:tblGrid. Widths are surfaced to the editor (data-colwidth, px)
   only when the grid is genuinely non-uniform — an equal-split table stays
   width-agnostic, exactly the state our exporter writes it from, so the
   default case round-trips cleanly. Cell content reuses the same paragraph
   machinery as the document body (classifyParagraph/groupItems), so
   formatting, lists, images — and nested tables — work inside cells. */

function cellItems(tcNode, ctx) {
  const items = []
  for (const n of kidsOf(tcNode)) {
    const tag = tagOf(n)
    if (tag === 'w:p') items.push(...classifyParagraph(n, ctx))
    else if (tag === 'w:tbl') items.push({ kind: 'block', html: readTable(n, ctx) })
    else if (tag === 'w:sdt') {
      const content = find(kidsOf(n), 'w:sdtContent')
      if (content) {
        for (const c of kidsOf(content)) {
          if (tagOf(c) === 'w:p') items.push(...classifyParagraph(c, ctx))
        }
      }
    }
  }
  return items
}

function readTable(tblNode, ctx) {
  const tblKids = kidsOf(tblNode)
  const gridNode = find(tblKids, 'w:tblGrid')
  const gridTwips = gridNode
    ? findAll(kidsOf(gridNode), 'w:gridCol').map((c) => parseInt(attr(c, 'w:w'), 10) || 0)
    : []
  const nonUniform = gridTwips.length > 1 && Math.max(...gridTwips) - Math.min(...gridTwips) > 30
  const colPx = gridTwips.map((w) => Math.round(w / 15)) // 15 twips per px at 96dpi

  const rows = []   // { header, cells: [{ colspan, rowspan, col, items }] }
  const openAt = {} // grid column index → the cell still spanning down (vMerge)
  for (const tr of findAll(tblKids, 'w:tr')) {
    const trKids = kidsOf(tr)
    const trPr = find(trKids, 'w:trPr')
    const header = trPr ? boolProp(kidsOf(trPr), 'w:tblHeader') : false
    const cells = []
    let at = 0
    for (const tc of findAll(trKids, 'w:tc')) {
      const tcPr = find(kidsOf(tc), 'w:tcPr')
      const tcPrKids = tcPr ? kidsOf(tcPr) : []
      const gs = find(tcPrKids, 'w:gridSpan')
      const colspan = Math.max(1, parseInt(gs ? attr(gs, 'w:val') : '1', 10) || 1)
      const vm = find(tcPrKids, 'w:vMerge')
      const vmVal = vm ? attr(vm, 'w:val') || 'continue' : null
      if (vmVal === 'continue' && openAt[at]) {
        openAt[at].rowspan++ // swallowed by the restart cell above
        at += colspan
        continue
      }
      const cell = { colspan, rowspan: 1, col: at, items: cellItems(tc, ctx) }
      if (vmVal === 'restart') openAt[at] = cell
      else delete openAt[at]
      cells.push(cell)
      at += colspan
    }
    rows.push({ header, cells })
  }

  let html = '<table><tbody>'
  for (const row of rows) {
    html += '<tr>'
    for (const c of row.cells) {
      const tag = row.header ? 'th' : 'td'
      let a = ''
      if (c.colspan > 1) a += ` colspan="${c.colspan}"`
      if (c.rowspan > 1) a += ` rowspan="${c.rowspan}"`
      if (nonUniform && colPx.length >= c.col + c.colspan) {
        a += ` data-colwidth="${colPx.slice(c.col, c.col + c.colspan).join(',')}"`
      }
      html += `<${tag}${a}>${groupItems(c.items) || '<p></p>'}</${tag}>`
    }
    html += '</tr>'
  }
  return html + '</tbody></table>'
}

/* ---------- Wave 6: table of contents ----------
   A w:sdt is a TOC field (ours or a foreign Word doc's) if any w:instrText
   inside it starts with the field code "TOC" — that keyword is locale-
   independent (field codes are always English, regardless of Word's UI
   language), the same trick header/footer's PAGE-field detection uses.
   Entries are read back from the cached TOC1-9 paragraphs Word (and our own
   exporter) always writes alongside the field: collectSegments already
   knows how to separate real text (w:t) from field-code plumbing
   (w:instrText, w:fldChar), so it does the clean extraction for free. A
   trailing " <digits>" is a foreign doc's real cached page number — we
   don't keep page numbers (our own exporter never writes one), so it's
   stripped; the rare heading that itself ends in "<space><digits>" would
   lose that suffix here too, an accepted, documented approximation. */

function isTocSdt(sdtContentNode) {
  for (const n of walkNodes(kidsOf(sdtContentNode))) {
    if (tagOf(n) === 'w:instrText' && textOf(n).trim().toUpperCase().startsWith('TOC')) return true
  }
  return false
}

function readTocEntries(sdtContentNode, ctx) {
  const entries = []
  for (const p of findAll(kidsOf(sdtContentNode), 'w:p')) {
    const pPr = find(kidsOf(p), 'w:pPr')
    const styleNode = pPr ? find(kidsOf(pPr), 'w:pStyle') : null
    const m = styleNode ? /^toc([1-9])$/i.exec(attr(styleNode, 'w:val') || '') : null
    if (!m) continue
    const out = { segs: [], imgs: [] }
    collectSegments(kidsOf(p), ctx, out)
    let text = out.segs.filter((s) => s.type === 'text').map((s) => s.text).join('')
    text = text.replace(/\s+\d+\s*$/, '').trim()
    if (text) entries.push({ level: Math.min(3, +m[1]), text })
  }
  return entries
}

/* w:sectPr → { pageSize, orientation, margin } — snapped to our discrete
   presets (the app doesn't offer arbitrary values, so "closest" is honest
   fidelity, not a bug). Returns null if the section isn't found. */
function readPageSettings(body) {
  const sectPr = find(kidsOf(body), 'w:sectPr')
  if (!sectPr) return null
  const kids = kidsOf(sectPr)
  const pgSz = find(kids, 'w:pgSz')
  const pgMar = find(kids, 'w:pgMar')

  let pageSize = 'letter'
  let orientation = 'portrait'
  if (pgSz) {
    orientation = attr(pgSz, 'w:orient') === 'landscape' ? 'landscape' : 'portrait'
    const w = parseInt(attr(pgSz, 'w:w'), 10) || 0
    const h = parseInt(attr(pgSz, 'w:h'), 10) || 0
    const shortEdge = Math.min(w, h) || PAGE_SIZE_TWIPS_APPROX.letter
    pageSize = closestKey(PAGE_SIZE_TWIPS_APPROX, shortEdge) || 'letter'
  }
  let margin = 'normal'
  if (pgMar) {
    const top = parseInt(attr(pgMar, 'w:top'), 10)
    if (top) margin = closestKey(MARGIN_TWIPS_APPROX, top) || 'normal'
  }
  return { pageSize, orientation, margin }
}

/* ---- Wave 4: header, footer, page numbers ----
   Headers/footers live in their own package parts (word/header1.xml,
   word/footer1.xml, ...), referenced from w:sectPr by rId, resolved through
   document.xml.rels — the same rels map loadRels() already builds for
   hyperlinks/images. Mirrors export.js's hfTextParagraph/pageNumberParagraph:
   a plain-text paragraph (custom header/footer text) and/or a paragraph
   whose run is a live PAGE field (our own page-number feature). */

const HF_ALIGN = { left: 'left', center: 'center', right: 'right', end: 'right', both: 'left', distribute: 'left' }

function headerFooterRefs(sectPr) {
  const kids = kidsOf(sectPr)
  const hdr = findAll(kids, 'w:headerReference').find((n) => attr(n, 'w:type') === 'default')
  const ftr = findAll(kids, 'w:footerReference').find((n) => attr(n, 'w:type') === 'default')
  return { headerRid: hdr ? attr(hdr, 'r:id') : null, footerRid: ftr ? attr(ftr, 'r:id') : null }
}

function partPathFromRel(rel) {
  if (!rel?.target) return null
  const t = rel.target.replace(/^\//, '')
  return t.startsWith('word/') ? t : `word/${t}`
}

/* A header/footer paragraph → { text, align, hasPageField }. Plain text
   comes only from w:t nodes (never w:instrText, which carries field codes
   like "PAGE" or "NUMPAGES" — text that must NOT be treated as content). */
function paragraphPlainInfo(pNode) {
  const kids = kidsOf(pNode)
  const pPr = find(kids, 'w:pPr')
  const jc = pPr ? find(kidsOf(pPr), 'w:jc') : null
  const align = jc ? (HF_ALIGN[attr(jc, 'w:val')] || 'left') : 'left'
  let text = ''
  let hasPageField = false
  for (const n of walkNodes(kids)) {
    const t = tagOf(n)
    if (t === 'w:t') text += textOf(n)
    else if (t === 'w:instrText' && textOf(n).trim().toUpperCase().startsWith('PAGE')) hasPageField = true
  }
  return { text: text.trim(), align, hasPageField }
}

function readHeaderOrFooterPart(zip, path) {
  const doc = parsePart(zip, path)
  if (!doc) return []
  const root = find(doc, 'w:hdr') || find(doc, 'w:ftr')
  if (!root) return []
  return findAll(kidsOf(root), 'w:p').map(paragraphPlainInfo)
}

/* Returns { header, footer, pageNumbers } — always populated (empty/disabled
   defaults when the document has none), so App.svelte can assign it directly. */
function readHeaderFooterSettings(zip, body, rels) {
  const result = {
    header: { text: '', align: 'center' },
    footer: { text: '', align: 'center' },
    pageNumbers: { enabled: false, place: 'footer', align: 'center' },
  }
  const sectPr = find(kidsOf(body), 'w:sectPr')
  if (!sectPr) return result
  const { headerRid, footerRid } = headerFooterRefs(sectPr)

  const scan = (rid, place, slot) => {
    if (!rid) return
    const path = partPathFromRel(rels[rid])
    if (!path) return
    for (const p of readHeaderOrFooterPart(zip, path)) {
      if (p.hasPageField) result.pageNumbers = { enabled: true, place, align: p.align }
      else if (p.text && !result[slot].text) result[slot] = { text: p.text, align: p.align }
    }
  }
  scan(headerRid, 'header', 'header')
  scan(footerRid, 'footer', 'footer')
  return result
}

/* ---------- entry point ---------- */

/* A .docx is a zip, and a zip can lie about how big it is. DEFLATE reaches
   roughly 1000:1 on repetitive input, so a 1 MB file can ask us to allocate a
   gigabyte — and then `strFromU8` copies it again as a UTF-16 string before
   the parser allocates a node per element. Nothing in the pipeline pushes
   back, so the webview simply dies, taking the user's unsaved work with it.
   Refusing is the only safe answer: a real document is far under this, and
   `.docx` files arrive by email and drag-drop from people you don't know.
   Enforced in fflate's own entry filter, so we reject BEFORE inflating
   rather than after. Sizes come from the zip's central directory, which an
   attacker controls — but fflate allocates from those same numbers, so
   capping them caps the allocation. */
const MAX_TOTAL_BYTES = 50 * 1024 * 1024
const MAX_ENTRIES = 512

export async function importDocx(bytes) {
  let total = 0
  let entries = 0
  const zip = unzipSync(bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes), {
    filter: (file) => {
      if (++entries > MAX_ENTRIES) {
        throw new Error(`.docx rejected: more than ${MAX_ENTRIES} parts in the archive`)
      }
      total += file.originalSize || 0
      if (total > MAX_TOTAL_BYTES) {
        throw new Error(`.docx rejected: unpacks to over ${Math.round(MAX_TOTAL_BYTES / 1048576)} MB`)
      }
      return true
    },
  })
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
      if (tag === 'w:p') items.push(...classifyParagraph(node, ctx))
      else if (tag === 'w:tbl') items.push({ kind: 'block', html: readTable(node, ctx) })
      else if (tag === 'w:sdt') {
        const content = find(kidsOf(node), 'w:sdtContent')
        if (content && isTocSdt(content)) {
          const entries = readTocEntries(content, ctx)
          items.push({ kind: 'block', html: `<div data-type="tableOfContents" data-entries="${escAttr(JSON.stringify(entries))}"></div>` })
        } else if (content) {
          processChildren(kidsOf(content))
        }
      }
      // w:sectPr itself (the section-properties element, not a content
      // node) is read separately below via readPageSettings
    }
  }
  processChildren(kidsOf(body))

  for (const [msg, n] of Object.entries(counts)) {
    messages.push(n > 1 ? `${msg} ×${n}` : msg)
  }

  const pageSettings = { ...readPageSettings(body), ...readHeaderFooterSettings(zip, body, ctx.rels) }
  return { html: groupItems(items), messages, pageSettings }
}
