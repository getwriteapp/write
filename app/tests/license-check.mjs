/* Licence gate for the npm dependency tree — the half `cargo deny check
   licenses` doesn't cover. That gate only ever reached app/src-tauri's Cargo
   tree; every @fontsource package, and everything docx/import/export pull
   in, lives on the npm side and had no automated check at all. A font added
   under a non-redistributable licence would have passed every existing gate
   silently — this is what would have caught it.

   write is GPL-3.0-or-later, which absorbs almost any permissive dependency
   but genuinely cannot combine with GPL-2.0-only or proprietary terms — same
   reasoning as app/src-tauri/deny.toml, ported to this ecosystem.

   Reads the full resolved tree from package-lock.json (transitive, not just
   package.json's direct dependencies — a font's own transitive deps are
   exactly where a surprise would hide) and reads each package's REAL
   installed package.json from disk for its licence, rather than trusting
   the lockfile's own (sometimes stale) license field alone. devDependencies
   are excluded: they never ship in the built app.

   Run: node tests/license-check.mjs   (or npm run test:licenses) */

import { readFileSync } from 'node:fs'
import { join } from 'node:path'

const ALLOWED = new Set([
  'MIT',
  'ISC',
  'Apache-2.0',
  'BSD-2-Clause',
  'BSD-3-Clause',
  '0BSD',
  'Unlicense',
  'CC0-1.0',
  'MIT-0',
  'BlueOak-1.0.0',
  'Python-2.0',
  // Every bundled typeface — Google Fonts, TypeTogether, and the rest all
  // ship under this. Two (Abril Fatface, Josefin Slab) carry a Reserved
  // Font Name; that restricts reuse of the exact name on a MODIFIED font,
  // not redistribution, so it doesn't change what belongs in this list —
  // see THIRD-PARTY-NOTICES.md for the per-font detail.
  'OFL-1.1',
])

// SPDX `OR`/`AND` expressions and the couple of packages that write theirs
// as `(A OR B)` in package.json rather than a single identifier. Each is
// listed with the reasoning for why the combination is fine, not just
// pattern-matched — an expression that happens to look similar but isn't
// actually satisfiable by an allowed licence must still fail.
const ALLOWED_EXPRESSIONS = new Map([
  // Either horn works: MIT is permissive-in, and the GPL-3.0-or-later horn
  // is write's own outbound licence.
  ['(MIT OR GPL-3.0-or-later)', 'jszip'],
  ['(MIT AND Zlib)', 'pako — both permissive'],
  ['Apache-2.0 OR MIT', '@tauri-apps/api'],
  ['MIT OR Apache-2.0', 'dual-licensed, either horn allowed'],
])

const lockPath = new URL('../package-lock.json', import.meta.url)
const lock = JSON.parse(readFileSync(lockPath, 'utf8'))
const appDir = new URL('../', import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1')

let failed = 0
let checked = 0
const seen = new Map() // licence -> count, for the summary line

for (const [pkgPath, meta] of Object.entries(lock.packages)) {
  if (pkgPath === '') continue // the root package itself
  if (meta.dev) continue // devDependencies never reach a shipped build

  let licence = meta.license
  if (!licence) {
    try {
      const real = JSON.parse(readFileSync(join(appDir, pkgPath, 'package.json'), 'utf8'))
      licence = real.license
        || (Array.isArray(real.licenses) ? real.licenses.map((l) => l.type).join(' OR ') : null)
    } catch {
      licence = null
    }
  }

  checked++
  const name = pkgPath.replace(/^node_modules\//, '')

  if (!licence) {
    console.log(`  FAIL  ${name} — no licence field found anywhere`)
    failed++
    continue
  }

  const allowed = ALLOWED.has(licence) || ALLOWED_EXPRESSIONS.has(licence)
  seen.set(licence, (seen.get(licence) || 0) + 1)
  if (!allowed) {
    console.log(`  FAIL  ${name} — licence "${licence}" is not on the allow-list`)
    failed++
  }
}

console.log(`\n${checked - failed}/${checked} production packages under an allowed licence, ${[...seen.keys()].length} distinct licences seen`)
if (failed) {
  console.log(`\n${failed} package(s) need a human to look at the licence above — add it to`)
  console.log('ALLOWED or ALLOWED_EXPRESSIONS in this file only after actually reading it,')
  console.log('the same standard app/src-tauri/deny.toml holds the Rust tree to.')
}
process.exit(failed ? 1 : 0)
