import { Editor, Extension, Node } from '@tiptap/core'
import StarterKit from '@tiptap/starter-kit'
import Underline from '@tiptap/extension-underline'
import Link from '@tiptap/extension-link'
import Placeholder from '@tiptap/extension-placeholder'
import Image from '@tiptap/extension-image'
import TextStyle from '@tiptap/extension-text-style'
import Color from '@tiptap/extension-color'
import Highlight from '@tiptap/extension-highlight'
import FontFamily from '@tiptap/extension-font-family'
import TextAlign from '@tiptap/extension-text-align'
import Table from '@tiptap/extension-table'
import TableRow from '@tiptap/extension-table-row'
import TableCell from '@tiptap/extension-table-cell'
import TableHeader from '@tiptap/extension-table-header'
import { Plugin, PluginKey } from '@tiptap/pm/state'
import { Decoration, DecorationSet } from '@tiptap/pm/view'

/* ---- Wave 1 formatting: font size + paragraph format extensions ----
   Tiptap ships no font-size extension; this stores it as a `textStyle`
   mark attribute (same mechanism Color and FontFamily use), in pt so the
   .docx export maps 1:1 to Word's half-point units. */
export const FontSize = Extension.create({
  name: 'fontSize',
  addGlobalAttributes() {
    return [{
      types: ['textStyle'],
      attributes: {
        fontSize: {
          default: null,
          parseHTML: (el) => el.style.fontSize || null,
          renderHTML: (attrs) => (attrs.fontSize ? { style: `font-size: ${attrs.fontSize}` } : {}),
        },
      },
    }]
  },
  addCommands() {
    return {
      setFontSize: (size) => ({ chain }) => chain().setMark('textStyle', { fontSize: size }).run(),
      unsetFontSize: () => ({ chain }) =>
        chain().setMark('textStyle', { fontSize: null }).removeEmptyTextStyle().run(),
    }
  },
})

/* Line spacing + left indent as paragraph/heading attributes.
   Indent steps mirror Word: one step = 0.5in = 48px at 96dpi = 720 twips. */
export const INDENT_STEP_PX = 48
export const MAX_INDENT = 8
export const ParagraphFormat = Extension.create({
  name: 'paragraphFormat',
  addGlobalAttributes() {
    return [{
      types: ['paragraph', 'heading'],
      attributes: {
        lineHeight: {
          default: null,
          parseHTML: (el) => el.style.lineHeight || null,
          renderHTML: (attrs) => (attrs.lineHeight ? { style: `line-height: ${attrs.lineHeight}` } : {}),
        },
        indent: {
          default: 0,
          parseHTML: (el) => parseInt(el.getAttribute('data-indent'), 10) || 0,
          renderHTML: (attrs) =>
            attrs.indent
              ? { 'data-indent': attrs.indent, style: `margin-left: ${attrs.indent * INDENT_STEP_PX}px` }
              : {},
        },
        /* First-line indent — the whole block's left edge stays put and only
           its FIRST line moves. Separate from `indent` because Word treats
           them as separate things, and so does .docx (`w:ind/@left` vs
           `w:ind/@firstLine`): the Bar's ⇥ button moves the block, the Tab key
           at the start of a paragraph moves the first line. */
        firstLine: {
          default: 0,
          parseHTML: (el) => parseInt(el.getAttribute('data-first-line'), 10) || 0,
          renderHTML: (attrs) =>
            attrs.firstLine
              ? { 'data-first-line': attrs.firstLine, style: `text-indent: ${attrs.firstLine * INDENT_STEP_PX}px` }
              : {},
        },
      },
    }]
  },
  addCommands() {
    const setAttr = (name, value) => ({ commands }) =>
      ['paragraph', 'heading'].every((type) => commands.updateAttributes(type, { [name]: value }))
    return {
      setLineHeight: (v) => setAttr('lineHeight', v),
      unsetLineHeight: () => setAttr('lineHeight', null),
      indent: () => ({ state, commands }) => {
        const cur = state.selection.$from.parent.attrs.indent || 0
        return setAttr('indent', Math.min(cur + 1, MAX_INDENT))({ commands })
      },
      outdent: () => ({ state, commands }) => {
        const cur = state.selection.$from.parent.attrs.indent || 0
        return setAttr('indent', Math.max(cur - 1, 0))({ commands })
      },
      indentFirstLine: () => ({ state, commands }) => {
        const cur = state.selection.$from.parent.attrs.firstLine || 0
        return setAttr('firstLine', Math.min(cur + 1, MAX_INDENT))({ commands })
      },
      outdentFirstLine: () => ({ state, commands }) => {
        const cur = state.selection.$from.parent.attrs.firstLine || 0
        return setAttr('firstLine', Math.max(cur - 1, 0))({ commands })
      },
    }
  },
  /* Tab must do SOMETHING in the editor. With no handler, the browser default
     runs — Tab moves focus to the next control, out of ProseMirror entirely,
     which blurs the editor and makes the (custom AND native) caret vanish:
     Brett's "tab does not function properly, caret just disappears". Bound to
     the indent commands the Bar already exposes, it now nudges the paragraph's
     left indent instead. Returning `true` swallows the keystroke so focus can
     never escape. Tables and lists get first refusal: `sinkListItem` /
     `liftListItem` return false when not in a list, and returning false from
     here lets the Table extension's own Tab (cell navigation) take over — its
     keymap plugin sits ahead of this one, but the explicit guard makes the
     precedence intentional rather than incidental.

     Backspace and Enter are bound here for the same reason: once Tab can
     create an indent, the other two keys have to know indents exist, or the
     feature is a trap door. Both fall through (`return false`) whenever they
     have nothing indent-specific to do, so every default behaviour is intact.

     Ordering note — this works without touching `priority`: Tiptap REVERSES
     the extension list before building plugins (see ExtensionManager.plugins,
     "run plugins at the end of an array first"), and core extensions are
     prepended. So a user extension's keymap runs ahead of core's Backspace/
     Enter, which is exactly what these two need. Don't "fix" that by raising
     priority — it's already correct, and priority would also reorder the
     schema attributes. */
  addKeyboardShortcuts() {
    // the caret sits at the very start of a formattable top-level block
    const atBlockStart = (editor) => {
      const { empty, $from } = editor.state.selection
      return empty && $from.parentOffset === 0
        && ['paragraph', 'heading'].includes($from.parent.type.name)
    }
    // does the selection cross more than one block? (Word indents them all)
    const spansBlocks = (editor) => {
      const { $from, $to, empty } = editor.state.selection
      return !empty && $from.blockRange($to) && $from.parent !== $to.parent
    }
    return {
      /* Word's Tab, faithfully: it does THREE different things depending on
         where the caret is, and the difference is the whole point — a tab
         should move one line, not the paragraph, unless you asked for the
         paragraph. Brett: "it tabs the whole paragraph over rather than just
         the line where the caret is... I would like this to perfectly mimic
         Word's functionality."
           1. selection across several blocks  -> increase each block's LEFT
              indent (Word's Increase Indent — the Bar's ⇥ button does this too)
           2. caret at the very start of a block -> FIRST-LINE indent: only
              that first line moves, the rest of the paragraph stays put
           3. caret anywhere else -> insert a real tab character, which
              advances to the next tab stop (CSS `tab-size` in app.css is set
              to the same 0.5in step Word uses) and exports as a real <w:tab/>
         Lists and tables still get first refusal, as before. */
      Tab: ({ editor }) => {
        if (editor.isActive('table')) return false
        if (editor.can().sinkListItem('listItem') && editor.commands.sinkListItem('listItem')) return true
        if (spansBlocks(editor)) return editor.commands.indent()
        if (atBlockStart(editor)) return editor.commands.indentFirstLine()
        return editor.commands.command(({ tr, dispatch }) => {
          if (dispatch) tr.insertText('\t')
          return true
        })
      },
      /* Shift-Tab is Tab's inverse, unwinding in the same order it was built:
         the first-line indent first, then the block's left indent. */
      'Shift-Tab': ({ editor }) => {
        if (editor.isActive('table')) return false
        if (editor.can().liftListItem('listItem') && editor.commands.liftListItem('listItem')) return true
        if (editor.state.selection.$from.parent.attrs.firstLine > 0) return editor.commands.outdentFirstLine()
        return editor.commands.outdent()
      },
      /* Backspace at the start of an indented block removes the INDENT before
         it will merge the block into whatever precedes it — Word's rule, and
         the inverse of Tab. Without this, Tab's indent had no undo on the key
         you'd naturally reach for, and Backspace jumped straight to
         joinBackward: a body paragraph following a heading got swallowed INTO
         that heading and re-rendered at H1 size (Brett's four-shot sequence —
         the whole paragraph turned into giant heading text). Now Backspace
         walks the indent back down to 0, and only then behaves normally.
         `editor.commands.outdent()` reports success unconditionally
         (updateAttributes returns true whenever the schema has the type), so
         the guard above — not the return value — is what decides. */
      Backspace: ({ editor }) => {
        if (editor.isActive('table')) return false
        if (!atBlockStart(editor)) return false
        // unwind in the same order Tab built it: first line, then the block
        const { firstLine, indent } = editor.state.selection.$from.parent.attrs
        if (firstLine > 0) return editor.commands.outdentFirstLine()
        if (indent > 0) return editor.commands.outdent()
        return false
      },
      /* Enter carries the indent onto the new block, the way every word
         processor does — paragraph formatting continues until you change it.
         PM's splitBlock builds the new node from `defaultBlockAt` with default
         attrs, so the indent was silently dropped the moment you pressed
         Enter. Narrow on purpose: top-level paragraphs/headings with an actual
         indent, nothing else, so list/blockquote/code/table Enter behaviour is
         untouched. */
      Enter: ({ editor }) => {
        const { empty, $from } = editor.state.selection
        if (!empty || $from.depth !== 1) return false
        if (!['paragraph', 'heading'].includes($from.parent.type.name)) return false
        const indent = $from.parent.attrs.indent || 0
        const firstLine = $from.parent.attrs.firstLine || 0
        if (!indent && !firstLine) return false
        return editor.chain().splitBlock().updateAttributes('paragraph', { indent, firstLine }).run()
      },
    }
  },
})

/* ---- Wave 3: manual page breaks ----
   A void block node. In Flow view it shows a labeled dashed marker (there's
   no physical page to imply a break otherwise); in Page view it renders as
   near-zero height — the sheet gap itself already shows the transition, and
   Page-view pagination (measurePages in App.svelte) treats this node as a
   mandatory break regardless of how much content has accumulated. Exports
   to a real Word manual page break (`docx`'s PageBreak → <w:br w:type="page"/>);
   import.js reads that back into this same node. */
export const PageBreak = Node.create({
  name: 'pageBreak',
  group: 'block',
  atom: true,
  selectable: true,
  parseHTML() {
    return [{ tag: 'div[data-type="pageBreak"]' }]
  },
  renderHTML() {
    return ['div', { 'data-type': 'pageBreak' }]
  },
  addCommands() {
    return {
      insertPageBreak: () => ({ chain }) => chain().insertContent({ type: this.name }).run(),
    }
  },
})

/* ---- Wave 3: Find & Replace ----
   A ProseMirror plugin that owns nothing but a DecorationSet — the actual
   search/replace logic lives in App.svelte (plain functions over
   editor.state/editor.view), which pushes a fresh decoration set in via
   transaction meta whenever matches change. Kept this thin so the "what
   counts as a match" policy stays in one place, in application code. */
export const findReplaceKey = new PluginKey('findReplace')
export const FindReplace = Extension.create({
  name: 'findReplace',
  addProseMirrorPlugins() {
    return [
      new Plugin({
        key: findReplaceKey,
        state: {
          init: () => DecorationSet.empty,
          apply(tr, old) {
            const next = tr.getMeta(findReplaceKey)
            return next !== undefined ? next : old.map(tr.mapping, tr.doc)
          },
        },
        props: {
          decorations(state) { return findReplaceKey.getState(state) },
        },
      }),
    ]
  },
})

/* ---- Session 30: formatting marks (Word's ¶ toggle) ----
   Show the characters that are normally invisible: a middle dot for every
   space, an arrow for every tab, a pilcrow at the end of every paragraph,
   and ↵ for a line break. Purely a view layer — decorations never touch the
   document, so nothing here can reach the .docx or the undo stack.

   Two deliberate choices, both about cost:

   1. **Paragraph marks are NODE decorations, not widgets.** One decoration
      per block with a class, and the ¶ itself is a CSS `::after`. A widget
      would put a real DOM element inside the paragraph — something the
      caret can land beside, ProseMirror has to reconcile, and a copy could
      conceivably pick up. A pseudo-element can't be any of those things.
   2. **Space dots are the expensive half, so the set is rebuilt in pieces.**
      Every single space needs its own inline decoration (there is no CSS
      that can paint a dot in each gap of a run of text), so a 3000-word
      document is ~3000 decorations and ~3000 spans. Building that on every
      keystroke would be a per-character walk of the whole document. Instead
      the set is built once when the toggle goes on, then MAPPED through each
      transaction and rebuilt only for the top-level blocks the change
      actually touched — so typing costs one paragraph, not one document. */
export const formattingMarksKey = new PluginKey('formattingMarks')

const MARK_BLOCKS = new Set(['paragraph', 'heading'])

function breakWidget() {
  const el = document.createElement('span')
  el.className = 'fm-break'
  el.textContent = '↵'
  el.contentEditable = 'false'
  el.setAttribute('aria-hidden', 'true')
  return el
}

/* Decorations for one slice of the document. `from`/`to` must be whole-block
   boundaries (see blockRange) — every decoration is clamped to them so a
   rebuild can safely remove-then-add exactly this range. */
function markDecorations(doc, from, to) {
  const decos = []
  const ws = /[ \t]/g
  doc.nodesBetween(from, to, (node, pos) => {
    if (node.isText) {
      const text = node.text || ''
      ws.lastIndex = 0
      let m
      while ((m = ws.exec(text))) {
        const at = pos + m.index
        if (at < from || at >= to) continue
        decos.push(Decoration.inline(at, at + 1, { class: m[0] === ' ' ? 'fm-space' : 'fm-tab' }))
      }
      return false
    }
    if (node.type.name === 'hardBreak') {
      if (pos >= from && pos < to) {
        decos.push(Decoration.widget(pos, breakWidget, { side: -1, marks: [], key: 'fm-break' }))
      }
      return false
    }
    if (MARK_BLOCKS.has(node.type.name) && pos >= from && pos + node.nodeSize <= to) {
      decos.push(Decoration.node(pos, pos + node.nodeSize, { class: 'fm-para' }))
    }
    return true
  })
  return decos
}

function buildAll(doc) {
  return DecorationSet.create(doc, markDecorations(doc, 0, doc.content.size))
}

/* Widen a changed range out to whole top-level blocks, plus one block either
   side for slack. Deliberately index-based rather than `$pos.before(1)`:
   positions BETWEEN two top-level blocks resolve to depth 0 (every Enter and
   every joining Backspace produces one), where `before(1)` throws. */
function blockRange(doc, from, to) {
  const size = doc.content.size
  const last = doc.childCount - 1
  if (last < 0) return [0, size]
  const clamp = (p) => Math.max(0, Math.min(p, size))
  const iFrom = Math.max(0, Math.min(doc.resolve(clamp(from)).index(0), last) - 1)
  const iTo = Math.min(doc.resolve(clamp(to)).index(0), last)
  let start = 0
  for (let i = 0; i < iFrom; i++) start += doc.child(i).nodeSize
  let end = start
  for (let i = iFrom; i <= iTo; i++) end += doc.child(i).nodeSize
  return [start, end]
}

/* Every range this transaction rewrote, in the NEW document's coordinates. */
function changedRanges(tr) {
  const ranges = []
  tr.mapping.maps.forEach((map, i) => {
    const rest = tr.mapping.slice(i + 1)
    map.forEach((_fromA, _toA, fromB, toB) => {
      ranges.push(blockRange(tr.doc, rest.map(fromB, -1), rest.map(toB, 1)))
    })
  })
  return ranges
}

export const FormattingMarks = Extension.create({
  name: 'formattingMarks',
  addOptions() {
    return { initial: false }
  },
  addProseMirrorPlugins() {
    const initial = !!this.options.initial
    return [
      new Plugin({
        key: formattingMarksKey,
        state: {
          init: (_config, state) => ({ on: initial, set: initial ? buildAll(state.doc) : DecorationSet.empty }),
          apply(tr, value) {
            const meta = tr.getMeta(formattingMarksKey)
            if (typeof meta === 'boolean') {
              return meta
                ? { on: true, set: buildAll(tr.doc) }
                : { on: false, set: DecorationSet.empty }
            }
            if (!value.on || !tr.docChanged) return value
            let set = value.set.map(tr.mapping, tr.doc)
            for (const [from, to] of changedRanges(tr)) {
              /* Remove before add, so overlapping ranges can't double up —
                 but remove only what genuinely lives INSIDE the range.
                 `find()` returns everything that *touches* it, boundaries
                 included, and a paragraph's node decoration ends exactly on
                 the block boundary the range starts at. Removing those and
                 not regenerating them cost the blocks either side of every
                 edit their ¶ — measurably: 91 paragraph marks over 76 blocks
                 became 90 over 77 after a single Enter. */
              set = set.remove(set.find(from, to).filter((d) => d.from < to && d.to > from))
              set = set.add(tr.doc, markDecorations(tr.doc, from, to))
            }
            return { on: true, set }
          },
        },
        props: {
          decorations(state) { return formattingMarksKey.getState(state)?.set },
        },
      }),
    ]
  },
  addCommands() {
    return {
      /* The toggle is a metadata-only transaction: no steps, so it can never
         land in the undo stack or mark the document dirty. */
      setFormattingMarks: (on) => ({ tr, dispatch }) => {
        if (dispatch) dispatch(tr.setMeta(formattingMarksKey, !!on).setMeta('addToHistory', false))
        return true
      },
      toggleFormattingMarks: () => ({ state, chain }) =>
        chain().setFormattingMarks(!formattingMarksKey.getState(state)?.on).run(),
    }
  },
})

/* ---- Wave 3: paste as plain text (Ctrl+Shift+V) ----
   Paste events carry no modifier-key info, so App.svelte's keydown handler
   calls markPastePlain() on Ctrl+Shift+V (without preventDefault, so the
   browser's native paste still fires the 'paste' event a moment later);
   the flag is consumed by handlePaste below, then cleared. A short auto-clear
   guards against the flag surviving if paste never fires for some reason. */
let pastePlainNext = false
export function markPastePlain() {
  pastePlainNext = true
  setTimeout(() => { pastePlainNext = false }, 500)
}

/* ---- offline images ----
   "write makes zero network requests" has to be enforced where HTML enters
   the document, not promised in the README. Tiptap's Image with allowBase64
   parses `img[src]` — ANY src, https: included. So a page copied out of a
   browser, or a .html file opened from disk, could carry
   <img src="https://tracker.example/pixel.png"> straight into the document,
   and the webview would fetch it: a tracking pixel telling a stranger the
   reader's IP and the moment they opened the file. That is precisely what
   Word grew protections against.

   Narrowing the parse rule to data: URLs makes the guarantee structural
   rather than advisory — paste, drop, and setContent all funnel through
   ProseMirror's DOM parser, so one rule covers every entry point, and no
   future caller can forget to sanitize. Nothing legitimate is lost: images
   we insert ourselves are data: URLs (insertImageFiles below), and the
   .docx importer already refuses external image relationships. The CSP in
   tauri.conf.json (img-src 'self' data:) is the second lock on the same
   door — if this rule is ever loosened by accident, the webview still
   refuses to make the request. */
export const OfflineImage = Image.extend({
  parseHTML() {
    return [{ tag: 'img[src^="data:"]' }]
  },
})

/* Counting only — the schema above is what actually blocks these. This
   exists so the app can SAY something when it drops an image, instead of
   silently eating content the user watched themselves paste. Deliberately
   a regex and not a parser: a miscount is a slightly wrong toast, never a
   security hole, so it must not be mistaken for the boundary. */
export function countRemoteImages(html) {
  return (String(html || '').match(/<img\b[^>]*\bsrc\s*=\s*["'](?!data:)/gi) || []).length
}

/* Image formats we accept: the set that round-trips into .docx (see
   docx/export.js). Everything is stored as a data URL so documents stay
   self-contained and fully offline. */
const IMAGE_TYPES = new Set(['image/png', 'image/jpeg', 'image/gif'])

export function isInsertableImage(file) {
  return file && IMAGE_TYPES.has(file.type)
}

export const IMAGE_EXT_MIME = { png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', gif: 'image/gif' }

/* Uint8Array → data URL, chunked so large photos don't blow the arg limit. */
export function bytesToDataUrl(mime, bytes) {
  let bin = ''
  for (let i = 0; i < bytes.length; i += 0x8000) {
    bin += String.fromCharCode(...bytes.subarray(i, i + 0x8000))
  }
  return `data:${mime};base64,${btoa(bin)}`
}

export function fileToDataUrl(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => resolve(String(reader.result))
    reader.onerror = () => reject(reader.error)
    reader.readAsDataURL(file)
  })
}

/* Insert image files at a position (drop) or the cursor (paste). Returns
   how many files were inserted so callers can decide whether the event
   was handled. */
export function insertImageFiles(editor, files, pos = null) {
  const images = [...(files || [])].filter(isInsertableImage)
  for (const file of images) {
    fileToDataUrl(file).then((src) => {
      const chain = editor.chain().focus()
      if (pos !== null) chain.insertContentAt(pos, { type: 'image', attrs: { src, alt: file.name } })
      else chain.insertContent({ type: 'image', attrs: { src, alt: file.name } })
      chain.run()
    })
  }
  return images.length
}

/* The starting document — the same essay from Lab II, so the app opens
   into something alive rather than a blank rectangle. */
export const WELCOME = `
<h1>Begin again</h1>
<p>Open a page. Not a workspace, not a project, not a canvas of blocks — a page. One column, one cursor, and a quiet so complete you can hear the next sentence coming.</p>
<h2>Start from quiet</h2>
<p>This is <em>write</em>: the typeface holds the line steady, the cursor is the only color, and nothing on the screen asks to be clicked. But reach for emphasis — <strong>select a few words</strong> — and a small toolbar finds you, then leaves when you stop needing it. Real bold. Real headings. A real document underneath, one that leaves this app as a clean <code>.docx</code>.</p>
<blockquote>Make the tool disappear; keep the craft.</blockquote>
<h2>Go up from there</h2>
<p>Going up doesn't mean adding chrome. It means capability arrives in the order you reach for it — headings, lists, and quotes that survive the trip to Word and back; focus that dims everything but the paragraph you're in; and rooms instead of themes, each one changing the light and temperature of the work.</p>
<p>This page is editable. Click anywhere and type. The app should already be gone from your attention by the time you finish this sentence.</p>
`

/* The Wave-1 formatting set, shared with the round-trip test harness so the
   tests always parse with the exact schema the app edits with. */
export const FORMATTING_EXTENSIONS = [
  TextStyle,
  Color,
  Highlight.configure({ multicolor: true }),
  FontFamily,
  FontSize,
  TextAlign.configure({ types: ['heading', 'paragraph'] }),
  ParagraphFormat,
]

/* The Wave-3 document-furniture set: shared with the test harness too. */
export const WAVE3_EXTENSIONS = [PageBreak, FindReplace]

/* ---- Wave 6: table of contents ----
   A snapshot, not a live-bound view: entries are captured from the
   document's own headings (levels 1-3) at insert time or when the user
   clicks Refresh, exactly like a Word TOC field — which also only updates
   on demand (F9 / right-click "Update Field"), never per keystroke. This
   keeps the node a plain atom (no NodeView machinery watching the whole
   document on every transaction) while still matching how real Word TOCs
   behave. Exports to a genuine Word TOC field (docx's TableOfContents,
   pre-populated with these same cached entries so Word/LibreOffice/Google
   Docs all show real content immediately, not a blank dirty field) —
   import.js reads the cached entries back into this same node. */
export function collectHeadings(doc) {
  const entries = []
  doc.descendants((node) => {
    if (node.type.name === 'heading' && node.attrs.level <= 3) {
      const text = node.textContent.trim()
      if (text) entries.push({ level: node.attrs.level, text })
    }
  })
  return entries
}

export const TableOfContents = Node.create({
  name: 'tableOfContents',
  group: 'block',
  atom: true,
  selectable: true,
  addAttributes() {
    return { entries: { default: [] } }
  },
  parseHTML() {
    return [{
      tag: 'div[data-type="tableOfContents"]',
      getAttrs: (el) => {
        try { return { entries: JSON.parse(el.getAttribute('data-entries') || '[]') } }
        catch { return { entries: [] } }
      },
    }]
  },
  renderHTML({ node }) {
    return ['div', { 'data-type': 'tableOfContents', 'data-entries': JSON.stringify(node.attrs.entries || []) }]
  },
  addCommands() {
    return {
      insertTableOfContents: () => ({ chain, state }) =>
        chain().insertContent({ type: this.name, attrs: { entries: collectHeadings(state.doc) } }).run(),
    }
  },
  addNodeView() {
    return ({ node, editor, getPos }) => {
      const dom = document.createElement('div')
      dom.className = 'toc-block'
      dom.setAttribute('data-type', 'tableOfContents')
      dom.contentEditable = 'false'

      const render = (entries) => {
        dom.innerHTML = ''
        const head = document.createElement('div')
        head.className = 'toc-head'
        const title = document.createElement('span')
        title.className = 'toc-title'
        title.textContent = 'Contents'
        const refresh = document.createElement('button')
        refresh.className = 'toc-refresh'
        refresh.title = 'Refresh from headings'
        refresh.textContent = '⟳'
        refresh.addEventListener('mousedown', (e) => {
          e.preventDefault()
          const pos = getPos()
          if (typeof pos !== 'number') return
          const fresh = collectHeadings(editor.state.doc)
          editor.chain().command(({ tr }) => {
            tr.setNodeAttribute(pos, 'entries', fresh)
            return true
          }).run()
        })
        head.append(title, refresh)
        dom.appendChild(head)

        const list = document.createElement('div')
        list.className = 'toc-entries'
        if (!entries.length) {
          const empty = document.createElement('span')
          empty.className = 'toc-empty'
          empty.textContent = 'No headings yet — write some, then Refresh.'
          list.appendChild(empty)
        }
        for (const entry of entries) {
          const a = document.createElement('a')
          a.className = 'toc-entry'
          a.dataset.level = String(entry.level)
          a.textContent = entry.text
          a.addEventListener('mousedown', (e) => {
            e.preventDefault()
            scrollToHeading(editor, entry)
          })
          list.appendChild(a)
        }
        dom.appendChild(list)
      }
      render(node.attrs.entries || [])

      return {
        dom,
        update: (updated) => {
          if (updated.type.name !== 'tableOfContents') return false
          render(updated.attrs.entries || [])
          return true
        },
        ignoreMutation: () => true,
      }
    }
  },
})

/* Click a TOC entry: find the Nth heading (in document order) at that
   level whose text matches — the same lightweight, no-stable-id approach
   Word itself falls back to when a bookmark has drifted. Good enough for
   navigation; worst case it lands on a same-named heading nearby. */
function scrollToHeading(editor, entry) {
  let target = null
  editor.state.doc.descendants((node, pos) => {
    if (target) return false
    if (node.type.name === 'heading' && node.attrs.level === entry.level && node.textContent.trim() === entry.text) {
      target = pos
    }
  })
  if (target === null) return
  editor.chain().focus().setTextSelection(target + 1).run()
  const dom = editor.view.domAtPos(target + 1).node
  const el = dom.nodeType === 1 ? dom : dom.parentElement
  el?.scrollIntoView({ block: 'center', behavior: 'smooth' })
}

/* ---- Wave 5: tables ----
   Tiptap's table family (prosemirror-tables underneath): header rows,
   merge/split (colspan/rowspan), and draggable column resizing. Column
   widths live on cells as the `colwidth` attribute (px), which export.js
   maps to Word's w:tblGrid twips and import.js reads back. Shared with the
   test harness like the other extension sets. */
export const TABLE_EXTENSIONS = [
  Table.configure({ resizable: true, lastColumnResizable: false }),
  TableRow,
  TableHeader,
  TableCell,
]

/* The Wave-6 set: shared with the test harness too. */
export const WAVE6_EXTENSIONS = [TableOfContents]

export function createEditor(element, { onUpdate, onSelection, onRemoteImagesBlocked, content = WELCOME, spellcheck = true, formattingMarks = false } = {}) {
  let instance // assigned below; editorProps handlers only run after construction
  instance = new Editor({
    element,
    extensions: [
      StarterKit.configure({
        heading: { levels: [1, 2, 3] },
      }),
      Underline,
      Link.configure({ openOnClick: false, autolink: true }),
      Placeholder.configure({ placeholder: 'Begin…' }),
      OfflineImage,
      FormattingMarks.configure({ initial: formattingMarks }),
      ...FORMATTING_EXTENSIONS,
      ...WAVE3_EXTENSIONS,
      ...TABLE_EXTENSIONS,
      ...WAVE6_EXTENSIONS,
    ],
    content,
    autofocus: 'end',
    onUpdate: ({ editor }) => onUpdate?.(editor),
    onSelectionUpdate: ({ editor }) => onSelection?.(editor),
    editorProps: {
      /* Keep the caret clear of the app's own furniture when ProseMirror
         scrolls to follow it. Left to itself PM scrolls the caret just barely
         into the viewport — flush against the bottom edge, which in this app
         is underneath the fixed bottom-fade and the word-count/hint whispers.
         The caret is then "in view" by PM's arithmetic and invisible in fact:
         press Enter at the foot of a page and your typing disappears until
         you scroll by hand. scrollMargin reserves that furniture's height, and
         scrollThreshold starts the scroll before the caret reaches it rather
         than after. Top gets a smaller reserve for the Bar's hover strip. */
      scrollMargin: { top: 64, bottom: 132, left: 0, right: 0 },
      scrollThreshold: { top: 64, bottom: 132, left: 0, right: 0 },
      /* native OS/browser spellchecker (Wave 6) — toggled from the Commander,
         persisted like the other view prefs; no custom dictionary, just the
         same spellcheck engine every contenteditable gets for free */
      attributes: { spellcheck: String(spellcheck) },
      /* Runs for pasted AND dropped HTML (both go through PM's
         parseFromClipboard). The HTML is returned untouched — OfflineImage's
         parse rule is what drops remote images. This hook exists purely so
         the app can tell the user an image went missing rather than letting
         it vanish silently. */
      transformPastedHTML: (html) => {
        const blocked = countRemoteImages(html)
        if (blocked) onRemoteImagesBlocked?.(blocked)
        return html
      },
      /* image files pasted or dropped into the page become data-URL image
         nodes; .docx drops are handled at the window level (App.svelte) */
      handlePaste: (view, event) => {
        if (pastePlainNext) {
          pastePlainNext = false
          const text = event.clipboardData?.getData('text/plain')
          if (!text) return false
          event.preventDefault()
          const nodes = text.replace(/\r\n/g, '\n').split('\n')
            .map((line) => ({ type: 'paragraph', content: line ? [{ type: 'text', text: line }] : [] }))
          instance.chain().focus().insertContent(nodes).run()
          return true
        }
        const files = event.clipboardData?.files
        if (!files?.length) return false
        return insertImageFiles(instance, files) > 0
      },
      handleDrop: (view, event) => {
        const files = event.dataTransfer?.files
        if (!files?.length) return false
        const coords = view.posAtCoords({ left: event.clientX, top: event.clientY })
        const handled = insertImageFiles(instance, files, coords?.pos ?? null) > 0
        if (handled) event.preventDefault()
        return handled
      },
    },
  })
  return instance
}
