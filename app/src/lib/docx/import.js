/* .docx import — OOXML → editor HTML via mammoth.

   The style map is the mirror of export.js: every named style the exporter
   emits is mapped back to the editor structure it came from, so a write
   document round-trips .docx → write losslessly for everything in the
   editor schema. Foreign .docx files (Word, Google Docs, LibreOffice) get
   mammoth's default semantic mapping on top of these rules.

   Known, accepted losses on import (documented in PROJECT.md §fidelity):
   - images in formats browsers can't show (EMF/WMF/TIFF clipart) — dropped;
     png/jpeg/gif are kept as data URLs (Milestone 2b)
   - tables: outside the editor schema — mammoth emits <table>, Tiptap strips */

import mammoth from 'mammoth'

/* Image formats the editor (and every browser engine) can actually render.
   Kept in sync with editor.js IMAGE_TYPES and export.js DOCX_IMAGE_TYPE. */
const KEEP_IMAGE_TYPES = new Set(['image/png', 'image/jpeg', 'image/gif'])

const STYLE_MAP = [
  // our exported named styles → structure
  "p[style-name='Quote'] => blockquote > p:fresh",
  "p[style-name='Code'] => pre:separator('\n')",
  "p[style-name='Horizontal Rule'] => hr:fresh",
  "r[style-name='Code Char'] => code",
  // Word's own quote styles, so foreign docs read as quotes too
  "p[style-name='Intense Quote'] => blockquote > p:fresh",
  "p[style-name='Block Text'] => blockquote > p:fresh",
  // mammoth ignores underline by default (legacy caution); we want it
  'u => u',
]

/* bytes: Uint8Array (browser or Node). Returns { html, messages }. */
export async function importDocx(bytes) {
  const input = typeof window === 'undefined'
    ? { buffer: Buffer.from(bytes) }
    : { arrayBuffer: bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) }

  const result = await mammoth.convertToHtml(input, {
    styleMap: STYLE_MAP,
    // a writer's deliberate blank line is content, not noise
    ignoreEmptyParagraphs: false,
    // browser-renderable images come through as self-contained data URLs;
    // vector clipart formats (EMF/WMF) are dropped — nothing can show them
    convertImage: mammoth.images.imgElement((image) => {
      if (!KEEP_IMAGE_TYPES.has(image.contentType)) return Promise.resolve({})
      return image.readAsBase64String().then((b64) => ({
        src: `data:${image.contentType};base64,${b64}`,
      }))
    }),
  })

  return {
    html: result.value
      // mammoth closes void elements ("<hr></hr>"); browsers tolerate it but
      // strict parsers nest the following content inside — normalize
      .replace(/<(hr|br|img)([^>]*)><\/\1>/g, '<$1$2>')
      // Word stores an image inside a paragraph; our image node is a block,
      // so unwrap paragraphs that contain exactly one image and nothing else
      .replace(/<p>(<img[^>]*>)<\/p>/g, '$1'),
    messages: (result.messages || []).map((m) => `${m.type}: ${m.message}`),
  }
}
