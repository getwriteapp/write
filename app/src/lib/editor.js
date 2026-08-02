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
import { DecorationSet } from '@tiptap/pm/view'

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

export function createEditor(element, { onUpdate, onSelection, content = WELCOME, spellcheck = true } = {}) {
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
      Image.configure({ allowBase64: true }),
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
