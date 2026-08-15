/* File bridge.
   Abstracts file I/O so the web core stays platform-agnostic:
   - Under Tauri (packaged app): uses the Tauri dialog + fs plugins.
   - In a plain browser (dev preview): falls back to download / file-input.

   Milestone 2: .docx is the primary save/open format (the product promise).
   Save offers .docx and .html; the chosen extension decides the writer.
   Open accepts .docx (binary → docx/import.js) and .html/.htm/.txt (text).
   The docx modules are imported dynamically so the editor bundle stays lean.

   Contract with App.svelte:
     saveAs(name, { html, json, pageSettings }) → { name, path? } | null
     saveTo(path, { html, json, pageSettings }) → { name, path } | null
     open() → { name, html, messages?, pageSettings? } | null

   saveAs always asks; saveTo never does. The split is what makes a real
   Ctrl+S possible: the Rust side widens the fs scope to a path the moment the
   user picks it in a dialog (or drops the file on the window), and that grant
   lasts the session — so writing back to a path the user already chose needs
   no second dialog and no new permission. A path the frontend invented still
   fails, because it was never granted. */

/* Tauri v2 detection: `window.__TAURI__` only exists when `withGlobalTauri`
   is enabled (off by default), so check `__TAURI_INTERNALS__` — the IPC bridge
   that is ALWAYS injected in a Tauri webview. Getting this wrong silently
   routes native saves through the browser download path (which a webview
   ignores → "Ctrl+S does nothing"). */
const inTauri = typeof window !== 'undefined' &&
  ('__TAURI_INTERNALS__' in window || '__TAURI__' in window)

const ext = (path) => (path.match(/\.([^.\\/]+)$/)?.[1] || '').toLowerCase()
const baseName = (path) => path.split(/[\\/]/).pop().replace(/\.[^.]+$/, '')

/* .txt is text, not markup. Both open paths below read any non-.docx file as
   a string and hand it to the editor as HTML, so a plain-text file containing
   `<b>` or `a < b` rendered as bold — or lost the "< b" entirely. What the
   file says and what the user sees have to match. Escaping at this boundary,
   the one place the file's type is known, keeps the editor's single content
   path (HTML) intact rather than threading a second content kind through
   every caller. Blank lines become empty paragraphs so spacing survives. */
const escapeHtml = (s) =>
  String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')

const textToHtml = (text) =>
  String(text).replace(/\r\n/g, '\n').split('\n')
    .map((line) => (line ? `<p>${escapeHtml(line)}</p>` : '<p></p>'))
    .join('')

/* markdown-it is already in the tree (a transitive dep of @tiptap/pm, via
   prosemirror-markdown) — dynamically imported, same as the docx modules
   below, so it costs nothing in the main bundle unless a .md is actually
   opened. `html: false` is deliberate, not the default paranoia: CommonMark
   lets raw HTML sit inside a .md file verbatim, and rendering that would mean
   trusting markup an attacker could hand someone as a "note", not a document.
   Declining it here means a stray `<script>` in the source shows up as
   literal escaped text instead of ever becoming markup — the sanitizing
   schema every other HTML-shaped import already goes through would catch it
   regardless, but this is one fewer thing asking it to. */
async function mdToHtml(text) {
  const { default: MarkdownIt } = await import('markdown-it')
  return new MarkdownIt({ html: false, linkify: true }).render(String(text))
}

/* The one place a file's extension decides how its text becomes the editor's
   HTML. .html/.htm pass through as-is (already markup); .txt and .md both
   need a real conversion, or a bold word in someone's notes renders as the
   literal string `**bold**` instead of bold. */
async function textFileToHtml(path, raw) {
  const e = ext(path)
  if (e === 'txt') return textToHtml(raw)
  if (e === 'md') return mdToHtml(raw)
  return raw
}

async function toDocxBytes(json, pageSettings) {
  const { exportDocx } = await import('./docx/export.js')
  return exportDocx(json, pageSettings)
}

async function fromDocxBytes(bytes) {
  const { importDocx } = await import('./docx/import.js')
  return importDocx(bytes)
}

/* ---- Tauri (native dialogs, real paths) ----

   The dialogs live in Rust (src-tauri/src/lib.rs), not here. That is a
   security boundary, not a style choice: the webview holds no filesystem
   scope of its own, so `readFile`/`writeFile` below only succeed on a path
   the Rust side just granted after the user picked it in a native dialog or
   dropped it on the window. Asking JS for a path and then reading it would
   put the choice back in the webview's hands and undo the whole arrangement
   — so if you ever need a new file operation, add a command over there. */

async function tauriSaveAs(name, payload) {
  const { invoke } = await import('@tauri-apps/api/core')
  const path = await invoke('pick_document_to_save', { defaultName: `${name}.docx` })
  if (!path) return null
  return tauriSaveTo(path, payload)
}

/* Write to an already-granted path, no dialog. Only ever called with a path
   that came back out of tauriSaveAs or tauriOpen — i.e. one the user picked
   and Rust scoped. The extension still decides the writer, so a document
   opened as .html keeps saving as .html. */
async function tauriSaveTo(path, { html, json, pageSettings }) {
  if (ext(path) === 'docx') {
    const { writeFile } = await import('@tauri-apps/plugin-fs')
    await writeFile(path, await toDocxBytes(json, pageSettings))
  } else {
    const { writeTextFile } = await import('@tauri-apps/plugin-fs')
    await writeTextFile(path, html)
  }
  return { name: baseName(path), path }
}

async function tauriOpen() {
  const { invoke } = await import('@tauri-apps/api/core')
  const path = await invoke('pick_document_to_open')
  if (!path) return null
  return tauriOpenPath(path)
}

/* Shared by the Open dialog and window drag-drop (which hands us a path). */
async function tauriOpenPath(path) {
  if (ext(path) === 'docx') {
    const { readFile } = await import('@tauri-apps/plugin-fs')
    const { html, messages, pageSettings } = await fromDocxBytes(await readFile(path))
    return { name: baseName(path), path, html, messages, pageSettings }
  }
  const { readTextFile } = await import('@tauri-apps/plugin-fs')
  const raw = await readTextFile(path)
  return { name: baseName(path), path, html: await textFileToHtml(path, raw) }
}

/* ---- browser fallback (dev preview) ---- */

/* A browser cannot write back to a file it handed out — every save is a fresh
   download. The returned `path` is therefore a marker, not a real location:
   it exists so the dev preview exercises the same bound/unbound state machine
   the native app does. Nothing ever reads it back; webSaveTo just downloads
   again under the same name. */
async function webSave(name, { json, pageSettings }) {
  const bytes = await toDocxBytes(json, pageSettings)
  const blob = new Blob([bytes], {
    type: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url; a.download = `${name}.docx`; a.click()
  URL.revokeObjectURL(url)
  return { name, path: `web:${name}.docx` }
}

const webSaveTo = (path, payload) => webSave(baseName(path), payload)

function webOpen() {
  return new Promise((resolve) => {
    const input = document.createElement('input')
    input.type = 'file'
    input.accept = '.docx,.html,.htm,.txt,.md'
    input.onchange = () => {
      const file = input.files?.[0]
      if (!file) return resolve(null)
      webOpenFile(file).then(resolve)
    }
    input.click()
  })
}

/* Shared by the file input and window drag-drop (which hands us a File). */
function webOpenFile(file) {
  return new Promise((resolve, reject) => {
    const name = file.name.replace(/\.[^.]+$/, '')
    const reader = new FileReader()
    reader.onerror = () => reject(reader.error || new Error('could not read that file'))
    if (ext(file.name) === 'docx') {
      /* importDocx throws on a file that isn't really a .docx, or that trips
         the zip-bomb cap. The throw used to happen inside this async onload,
         where nothing was listening: it escaped as an unhandled rejection and
         the promise never settled, so openDroppedDoc's `await` hung forever
         and the user got no "Open failed" — just a drop that did nothing. */
      reader.onload = async () => {
        try {
          const { html, messages, pageSettings } = await fromDocxBytes(new Uint8Array(reader.result))
          resolve({ name, html, messages, pageSettings })
        } catch (err) {
          reject(err)
        }
      }
      reader.readAsArrayBuffer(file)
    } else {
      reader.onload = async () => {
        try {
          const raw = String(reader.result)
          resolve({ name, html: await textFileToHtml(file.name, raw) })
        } catch (err) {
          reject(err)
        }
      }
      reader.readAsText(file)
    }
  })
}

export const isTauri = inTauri

export const DOC_EXT_RE = /\.(docx|html?|txt|md)$/i

/* The pre-2007 binary Word format, matched only so it can be refused out loud.
   `.docx` is a zip of XML; `.doc` is an OLE compound binary with nothing in
   common with it, so opening one means a second parser for one of the most
   heavily exploited file formats there is — every mainstream open-source
   reader for it has carried a buffer-overflow CVE, and none of the zip-bomb
   caps in import.js would transfer. Matching on the extension alone is the
   point: we never read the file, so nothing here widens the filesystem scope
   to a format we're going to decline anyway. */
export const LEGACY_DOC_RE = /\.doc$/i

export const fileBridge = {
  /* always asks where */
  saveAs: (name, payload) => (inTauri ? tauriSaveAs(name, payload) : webSave(name, payload)),
  /* never asks — path must be one the user already chose */
  saveTo: (path, payload) => (inTauri ? tauriSaveTo(path, payload) : webSaveTo(path, payload)),
  open: () => (inTauri ? tauriOpen() : webOpen()),
  /* drag-drop entry points: a native path (Tauri) or a File (browser) */
  openPath: (path) => tauriOpenPath(path),
  openFile: (file) => webOpenFile(file),
}
