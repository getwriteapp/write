/* File bridge.
   Abstracts file I/O so the web core stays platform-agnostic:
   - Under Tauri (packaged app): uses the Tauri dialog + fs plugins.
   - In a plain browser (dev preview): falls back to download / file-input.

   Milestone 2: .docx is the primary save/open format (the product promise).
   Save offers .docx and .html; the chosen extension decides the writer.
   Open accepts .docx (binary → mammoth) and .html/.htm/.txt (text).
   The docx modules are imported dynamically so the editor bundle stays lean.

   Contract with App.svelte:
     save(name, { html, json, pageSettings }) → { name, path? } | null
     open() → { name, html, messages?, pageSettings? } | null  */

/* Tauri v2 detection: `window.__TAURI__` only exists when `withGlobalTauri`
   is enabled (off by default), so check `__TAURI_INTERNALS__` — the IPC bridge
   that is ALWAYS injected in a Tauri webview. Getting this wrong silently
   routes native saves through the browser download path (which a webview
   ignores → "Ctrl+S does nothing"). */
const inTauri = typeof window !== 'undefined' &&
  ('__TAURI_INTERNALS__' in window || '__TAURI__' in window)

const ext = (path) => (path.match(/\.([^.\\/]+)$/)?.[1] || '').toLowerCase()
const baseName = (path) => path.split(/[\\/]/).pop().replace(/\.[^.]+$/, '')

async function toDocxBytes(json, pageSettings) {
  const { exportDocx } = await import('./docx/export.js')
  return exportDocx(json, pageSettings)
}

async function fromDocxBytes(bytes) {
  const { importDocx } = await import('./docx/import.js')
  return importDocx(bytes)
}

/* ---- Tauri (native dialogs, real paths) ---- */

async function tauriSave(name, { html, json, pageSettings }) {
  const { save } = await import('@tauri-apps/plugin-dialog')
  const path = await save({
    defaultPath: `${name}.docx`,
    filters: [
      { name: 'Word document', extensions: ['docx'] },
      { name: 'Web page', extensions: ['html'] },
    ],
  })
  if (!path) return null

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
  const { open } = await import('@tauri-apps/plugin-dialog')
  const path = await open({
    filters: [
      { name: 'Documents', extensions: ['docx', 'html', 'htm', 'txt'] },
      { name: 'Word document', extensions: ['docx'] },
    ],
  })
  if (!path) return null
  return tauriOpenPath(path)
}

/* Shared by the Open dialog and window drag-drop (which hands us a path). */
async function tauriOpenPath(path) {
  if (ext(path) === 'docx') {
    const { readFile } = await import('@tauri-apps/plugin-fs')
    const { html, messages, pageSettings } = await fromDocxBytes(await readFile(path))
    return { name: baseName(path), html, messages, pageSettings }
  }
  const { readTextFile } = await import('@tauri-apps/plugin-fs')
  return { name: baseName(path), html: await readTextFile(path) }
}

/* ---- browser fallback (dev preview) ---- */

async function webSave(name, { json, pageSettings }) {
  const bytes = await toDocxBytes(json, pageSettings)
  const blob = new Blob([bytes], {
    type: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url; a.download = `${name}.docx`; a.click()
  URL.revokeObjectURL(url)
  return { name }
}

function webOpen() {
  return new Promise((resolve) => {
    const input = document.createElement('input')
    input.type = 'file'
    input.accept = '.docx,.html,.htm,.txt'
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
  return new Promise((resolve) => {
    const name = file.name.replace(/\.[^.]+$/, '')
    const reader = new FileReader()
    if (ext(file.name) === 'docx') {
      reader.onload = async () => {
        const { html, messages, pageSettings } = await fromDocxBytes(new Uint8Array(reader.result))
        resolve({ name, html, messages, pageSettings })
      }
      reader.readAsArrayBuffer(file)
    } else {
      reader.onload = () => resolve({ name, html: String(reader.result) })
      reader.readAsText(file)
    }
  })
}

export const isTauri = inTauri

export const DOC_EXT_RE = /\.(docx|html?|txt)$/i

export const fileBridge = {
  save: (name, payload) => (inTauri ? tauriSave(name, payload) : webSave(name, payload)),
  open: () => (inTauri ? tauriOpen() : webOpen()),
  /* drag-drop entry points: a native path (Tauri) or a File (browser) */
  openPath: (path) => tauriOpenPath(path),
  openFile: (file) => webOpenFile(file),
}
