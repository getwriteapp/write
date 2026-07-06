import { Editor } from '@tiptap/core'
import StarterKit from '@tiptap/starter-kit'
import Underline from '@tiptap/extension-underline'
import Link from '@tiptap/extension-link'
import Placeholder from '@tiptap/extension-placeholder'
import Image from '@tiptap/extension-image'

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
