/* Font-name translation between the editor's CSS font stacks and Word's
   plain family names. Shared by export.js and import.js so the mapping
   round-trips exactly.

   The editor stores CSS stacks like "'Literata Variable', serif" (the
   Fontsource variable-font family names the app actually loads). Word wants
   the installable family name ("Literata"). On the way back in, a known
   Word name maps to the app's CSS stack so the document renders with the
   app's own bundled font; unknown names pass through as-is so a doc using
   Georgia still says Georgia. */

/* Word family name → the app's CSS stack (everything here ships bundled). */
const WORD_TO_CSS = {
  'ia writer quattro s': "'iA Writer Quattro S', monospace",
  'literata': "'Literata Variable', serif",
  'source serif 4': "'Source Serif 4 Variable', serif",
  'newsreader': "'Newsreader Variable', serif",
  'geist': "'Geist Variable', sans-serif",
  'ibm plex sans': "'IBM Plex Sans', sans-serif",
  'geist mono': "'Geist Mono Variable', monospace",
  'eb garamond': "'EB Garamond Variable', Garamond, serif",
  'lora': "'Lora Variable', Georgia, serif",
  'playfair display': "'Playfair Display Variable', Georgia, serif",
  'inter': "'Inter Variable', -apple-system, sans-serif",
  'atkinson hyperlegible': "'Atkinson Hyperlegible', -apple-system, sans-serif",
  'jetbrains mono': "'JetBrains Mono Variable', ui-monospace, monospace",
  'work sans': "'Work Sans Variable', -apple-system, sans-serif",
  'archivo': "'Archivo Variable', -apple-system, sans-serif",
  'manrope': "'Manrope Variable', -apple-system, sans-serif",
  'roboto slab': "'Roboto Slab Variable', Rockwell, serif",
  'bitter': "'Bitter Variable', Rockwell, serif",
  'crimson pro': "'Crimson Pro Variable', Garamond, serif",
  'fraunces': "'Fraunces Variable', Georgia, serif",
  'libre franklin': "'Libre Franklin Variable', -apple-system, sans-serif",
}

/* CSS stack → Word family name: first family, quotes stripped, and the
   Fontsource " Variable" suffix removed (the installable family is
   "Literata", not "Literata Variable"). */
export function cssToWordFont(css) {
  if (!css) return null
  const first = String(css).split(',')[0].replace(/["']/g, '').trim()
  return first.replace(/\s+Variable$/i, '') || null
}

export function wordToCssFont(name) {
  if (!name) return null
  const known = WORD_TO_CSS[name.trim().toLowerCase()]
  if (known) return known
  // foreign font: quote multi-word names so the CSS stays valid
  return /\s/.test(name.trim()) ? `'${name.trim()}'` : name.trim()
}
