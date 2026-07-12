/* Local persistence: the current document + a recent-files list.
   Milestone 1 keeps this in localStorage (instant, offline, no permissions).
   Milestone 2 will additionally round-trip real files on disk via bridge.js. */

const DOC_KEY = 'write:doc'
const RECENTS_KEY = 'write:recents'
const MAX_RECENTS = 10

export function loadDoc() {
  try { return JSON.parse(localStorage.getItem(DOC_KEY)) } catch { return null }
}

export function saveDoc(doc) {
  // doc: { name, html, savedAt }
  try { localStorage.setItem(DOC_KEY, JSON.stringify(doc)) } catch {}
}

export function loadRecents() {
  try { return JSON.parse(localStorage.getItem(RECENTS_KEY)) || [] } catch { return [] }
}

export function pushRecent(entry) {
  // entry: { name, html, savedAt }
  const recents = loadRecents().filter((r) => r.name !== entry.name)
  recents.unshift({ ...entry, words: wordCount(entry.html) })
  const trimmed = recents.slice(0, MAX_RECENTS)
  try { localStorage.setItem(RECENTS_KEY, JSON.stringify(trimmed)) } catch {}
  return trimmed
}

function wordCount(html) {
  const t = (html || '').replace(/<[^>]+>/g, ' ').replace(/&[a-z]+;/g, ' ').trim()
  return t ? t.split(/\s+/).length : 0
}

export function relativeTime(ts) {
  if (!ts) return ''
  const s = Math.round((Date.now() - ts) / 1000)
  if (s < 45) return 'just now'
  if (s < 90) return 'a minute ago'
  const m = Math.round(s / 60)
  if (m < 45) return `${m} min ago`
  const h = Math.round(m / 60)
  if (h < 24) return `${h} hr ago`
  const d = Math.round(h / 24)
  if (d === 1) return 'yesterday'
  if (d < 7) return `${d} days ago`
  return new Date(ts).toLocaleDateString()
}
