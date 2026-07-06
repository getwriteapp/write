import { Editor, Extension } from '@tiptap/core'
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
    }
  },
})

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

export function createEditor(element, { onUpdate, onSelection, content = WELCOME } = {}) {
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
    ],
    content,
    autofocus: 'end',
    onUpdate: ({ editor }) => onUpdate?.(editor),
    onSelectionUpdate: ({ editor }) => onSelection?.(editor),
    editorProps: {
      /* image files pasted or dropped into the page become data-URL image
         nodes; .docx drops are handled at the window level (App.svelte) */
      handlePaste: (view, event) => {
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
