# Changelog

All notable changes to `write` are recorded here. Format loosely follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/); versioning is
[SemVer](https://semver.org/), pre-1.0.

## [0.2.3] — 2026-08-05

Session 34: two room typefaces re-picked, judged side by side rather than by
description — see the specimen pages in `assets/`.

### Changed

- **Dawn's body font is now Petrona, not Fraunces.** Brett wanted "a much
  softer serif." Petrona's low-contrast curves and big x-height read quieter
  and more restrained than Fraunces' deliberate wonkiness — a better match
  for "blush morning light." New to the bundle: 27 typefaces now.
- **Paper's body font is now Source Serif 4, not Literata.** Brett wanted it
  "tightened and hardened up... more newspaper-like than print-book-like."
  Literata's unusually tall glyph box was what made Paper the loosest room to
  begin with. Source Serif 4's `opsz` axis tightens proportions and raises
  contrast at larger sizes — the literal mechanism for the ask. Reused from
  Dawn's old slot rather than a fresh bundle addition.

## [0.2.2] — 2026-08-05

Session 33: per-room highlighter palettes.

### Changed

- **Highlight colors are now tuned per room instead of one universal set.**
  The five highlighter colors are still one canonical, .docx-portable value
  each — unchanged by which room you're in, and still what a Word user sees.
  What changed is on-screen presentation: each room now repaints the band
  with its own hand-picked palette instead of a single "dim it if dark"
  rule. Paper corrects orange, which read as too close to its own cream page
  to look highlighted; Slate and Noir replace the old flat 62%-black overlay
  (which flattened all five colors into near-neighbors of each other) with
  five individually tuned deep tints, so highlights stay distinct from one
  another, not just from the page.
- **Canonical pink is no longer washed out.** Replaced `#FBCFE8`
  (Tailwind pink-200) with `#F9A8D4` (pink-300) — the old value was the
  weakest-reading highlight in every room, including the best case (white
  paper). Still a paper pastel, not a hot pink; it just finally registers
  as a highlight instead of a blush.
- **The Bar's highlight swatches now preview the room's actual color**,
  not the canonical stored one — what you click in the toolbar is what
  you'll see on the page.

## [0.2.1] — 2026-08-05

Four passes driven by using the app: Session 29's typography and navigation
work, Session 30's formatting marks, Session 31's real pagination — Page view
now breaks pages between lines, the way a word processor is supposed to — and
Session 32's chrome and visual-identity pass: a new default room, a real app
icon and tray icon, and the typeface library's growth to 26 faces.

### Added

- **Page view now breaks pages between lines, like Word.** A paragraph too long
  for the space left on a page is split at the right line and continued on the
  next sheet, instead of being moved to the next page whole. Pages fill
  properly now — around 99–100% of the page rather than stopping wherever a
  paragraph happened to end — and a paragraph longer than a whole page finally
  works at all. Tables and images are still moved whole rather than split, so a
  page break never falls inside one.
- **Widow and orphan control**, on by default as it is in Word: a page break
  never leaves a single line of a paragraph stranded on its own, at the bottom
  of one page or the top of the next. It either carries an extra line over or
  moves the whole paragraph down.
- **Formatting marks** — Word's ¶ toggle. Shows a dot for every space, an
  arrow for every tab, a pilcrow at the end of every paragraph, and ↵ at a
  line break. `Ctrl+Shift+8` (Word's own shortcut) or **¶ Marks** in the
  Commander; the setting is remembered. Marks are a view overlay only: they
  never enter the document, a copy never picks them up, and they don't print.
- **Anchored zoom with a read-out** — `Ctrl+=` / `Ctrl+-` / `Ctrl+0`, and
  Ctrl+scroll now zooms around the pointer instead of the page origin.
- **Eight more typefaces**, bringing the bundled library to 21 families, and
  a **Specimen** template that exercises every feature in running text.
- **Five more sans, added the same session as the chrome refresh below**:
  Figtree (already the app's own chrome face, now a document option too),
  Source Sans 3 (Adobe's body-copy workhorse — the library had nothing with
  that lineage), Nunito Sans (the library's first rounded-terminal sans),
  Poppins (the one true geometric face — circular bowls, single-story a,
  unlike the geometric-leaning grotesques already in), and Space Grotesk
  (monospace-derived proportions carried into a proportional face; has no
  italic design at all, so Word slants it synthetically like it does Manrope
  and Roboto Slab). Chosen from fourteen candidates shown as running prose
  rather than toolbar chrome, since paragraph readability and toolbar
  compactness are different questions. Bundled library: 21 → 26.
- **A real app icon.** The placeholder "w|" is gone — replaced by a
  hand-brushed lowercase "w", cropped and alpha-masked from the source
  artwork so the corners are genuinely transparent rather than a
  color-matched guess (verified by compositing onto a contrasting color and
  confirming nothing showed through). Regenerated into every size and
  format the app ships — `.ico`, `.icns`, every PNG size, Windows Store
  tiles, Android and iOS — with Tauri's own icon generator, not resized by
  hand.
- **A real system tray icon**, not just artwork sitting unused: a
  right-click menu (Show write / Quit) and left-click brings the window
  forward, the same gesture as clicking a taskbar entry. Follows Windows'
  own light/dark setting live — the badge switches the moment you change
  it in Settings, no restart needed. The window's close button still quits
  the app as it always has — no minimize-to-tray behavior was added
  alongside this, since that's a separate decision.
- **A new default room, Linen**, replacing Quattro. Quattro's problem was
  never the room itself — it was the resemblance: iA Writer's own typeface,
  paired with iA Writer's own blue, as the very first thing a stranger saw.
  Linen keeps the same "one colored cursor on white" discipline but is
  entirely write's own: Nunito Sans, a rust caret, and genuinely neutral
  grays everywhere else — the warmth lives only in the caret and accent,
  not smeared across the whole palette the way Dawn's is. Chosen from four
  candidates shown against the app's real room-card CSS, not a mockup.
  Air is retired outright — the room with the least distinct point of
  view, and the one that read closest to generic modern-app chrome
  (indigo gradients, glass, Geist) rather than something particular to
  this app. Quattro survives, recolored and renamed to **Cobalt** and
  moved into Air's old slot in the room order: identical font and
  everything else, only the accent and caret move, from iA's own
  `#0D99FF` to a muted `#3E6FA6` that stays clear of both Slate's teal and
  Air's retired indigo. Still six rooms.

### Changed

- **Page view now renders the document's real `.docx` typography** rather than
  the room's reading typography, so its page breaks predict Word's. Flow view
  is unchanged — it stays the draft view.
- **Tab behaves the way Word's Tab behaves** — three actions depending on
  where the caret sits (first-line indent, block indent, or a real tab
  character), all of which round-trip through `.docx`.
- **The chrome ducks the moment you engage** with the page, rather than after
  48px of scrolling.
- **Trimmed the empty space above the first line of text**, in both views —
  neither the Bar nor the wordmark actually need it reserved. Page view's cut
  again, and switched from a viewport-relative unit to a flat one: 5vh sat on
  top of the page's own real 96px top margin, and vh meant that gap grew on a
  taller monitor for no reason. The real margin (--page-my, 1in by default)
  is untouched — that part is supposed to look like an inch of white space,
  since it's what Word will actually do. Flow view got the same treatment a
  session later, having been missed the first time even though it's the
  app's actual default view — 6vh flattened to 40px, for the same reason.
  Page view's chrome padding briefly went to 12px on a misread — what looked
  like too much chrome was actually **Wide** margin (144px) left over in
  localStorage from earlier testing, not this padding. Reverted to 28px once
  that came to light. **Normal (96px/1in) is and was already the coded
  default** — nothing to fix there; Narrow (48px/0.5in) and Wide (144px/1.5in)
  are both real, pre-existing, user-selectable presets in the Commander, and
  the margin choice affects all four sides, top and bottom included, not
  only left/right.
- **The Bar's font menu now names the room's actual font**, instead of the
  opaque literal string "Room default." The first group is titled "Room
  Default," matching Serif/Slab/Sans/Display/Typewriter, and the one item
  inside it shows whichever face the current room is really set in — Nunito
  Sans in Linen, iA Writer Quattro in Cobalt, and so on — read live from the
  room's own `--body-font`, not a second hardcoded map that could drift out
  of sync with rooms.css.
- **The typeface button in the Bar now carries a dropdown arrow**, matching
  Size and Spacing next to it. Those two are native `<select>`s, so the
  browser draws their arrow for free; the typeface control is a `<button>`
  standing in for a listbox (so names can render in their own face and
  arrow keys can preview live — see the Session 27 note), which drew nothing
  at all until now. Same glyph vocabulary as the rest of the Bar's icons,
  not an SVG asset. Went a step further once the first pass was up: Size and
  Spacing's own native arrows were a different shape (the browser's own
  chevron) from the new triangle. Stripped the native arrows
  (`appearance: none`) and tried drawing the same ▾ via `::after` directly
  on the `<select>`s — `getComputedStyle` reported it correctly, but
  Chromium never actually painted it, which computed style alone doesn't
  reveal. Generated content on native form controls is unreliable in
  practice no matter what the CSSOM claims. Fixed by wrapping each
  `<select>` in an ordinary `<span class="select-wrap">` and drawing the
  arrow there instead — a plain element paints `::after` reliably, which is
  exactly why the typeface button's own arrow (a `<button>`, never a form
  control in the same sense) worked correctly on the first attempt. All
  three arrows now 14px, up from the original 9px. Size and Spacing's own
  box height was also 2px shorter than the typeface button's the whole time
  (24px vs. an implicit ~22px) — never matched, just not obvious until the
  arrow work put all three controls under closer visual comparison. `height:
  24px` added to `.bar-select` to match exactly.
- **The chrome's own typeface and corners.** The UI font (Bar, Commander,
  whispers) was Geist — Vercel's typeface, and about as close to "made by an
  AI startup in 2023" as a font gets. Tried live against seventeen other
  candidates across three rounds (Libre Franklin and Atkinson Hyperlegible
  both had a turn as the pick before this one); landed on Figtree, a soft
  geometric grotesque built explicitly for product UI — calmer than Geist at
  the same sizes, without reaching for Atkinson's more editorial letterforms.
  Newly bundled (`@fontsource-variable/figtree`, latin + latin-ext, normal
  weight only — chrome text is never italic). The Bar's corners went from
  12px to 4px (buttons 7px to 3px) — the geometric-sans-plus-12px-radius-
  plus-soft-shadow combination is the house style of every dashboard since
  2020, and the radius change moves the register further than the font swap
  does on its own. Document typography is unaffected either way — this is
  only the app's
  own furniture.

### Fixed

- **The alignment and indent buttons' middle corners.** `.bar-seg`'s shared
  button rule never set its own `border-radius`, so the first and last
  buttons in each group were explicitly squared off while the ones between
  them (Centre; the second of the indent pair) kept the browser's own default
  button rounding — a "square" control with two corners nobody had authored.
  Spotted by eye once the radius shrank enough to make it obvious.
- **A paragraph, table or image too tall to fit one page no longer breaks
  pagination for the rest of the document.** Such a block can't be moved to
  the next sheet — nothing would hold it there either — but the pages after it
  were still being drawn as though it had fitted, so text further down ended
  up crossing the gap between sheets, with a line of it hidden behind the
  edge of the paper. The sheet holding an oversized block now grows to hold
  it, so every word stays on the page and visible.
- **The desk background behind the pages no longer turns white partway down
  a short last page.** The page sheets are drawn as an overlay, positioned
  independently of the actual text; a document whose last page isn't full
  (nearly all of them) left nothing painting that background as far down as
  the sheet itself went.
- Scrolling no longer grabs and stretches at the page edges (an accidental
  nested scroll container).
- Modals no longer chain their scrolling to the document behind them.
- The accent rule no longer bleeds across the gap between pages.
- The top-left hover corner that summons the wordmark now actually works.

## [0.1.1] — 2026-08-02

A security and compliance pass done before making the repository public.
Nothing about writing in `write` changes. What changes is what a document you
open is allowed to do to your machine, and whether the app's claims about
itself are actually enforced.

No evidence any of this was ever exploited — v0.1.0 was never publicly
downloadable.

### Security

- **A document can no longer reach the network.** Images pointing at a remote
  server were previously parsed and fetched, which made any opened or pasted
  document a working tracking pixel — it would report the reader's IP address
  and the moment they opened the file. Remote image sources are now refused by
  the editor schema, and a Content Security Policy blocks the request as a
  second lock. The README's "zero network calls, ever" claim is now true;
  before this release it was not.
- **The webview no longer has access to the filesystem.** It previously held
  read *and* write permission on `**` — every file the user could touch — so
  any scripting flaw would have meant total disk access. File access is now
  granted one file at a time by the Rust process, and only after the user
  picked that file in a native dialog or dropped it on the window. A path the
  frontend chooses for itself is never honoured.
- **A malicious `.docx` can no longer exhaust memory.** A 250 KB archive could
  expand to 250 MB (and a 1 MB one to roughly a gigabyte) with nothing
  checking, hanging or killing the app and taking unsaved work with it.
  Decompression is now capped before anything is inflated.
- **Added a Content Security Policy.** None was set previously.
- **Patched four advisories:** `fast-xml-parser` (GHSA-8r6m-32jq-jx6q, in the
  `.docx` parsing path), `postcss` (GHSA-r28c-9q8g-f849), and `quick-xml`
  ×2 (RUSTSEC-2026-0194/0195, transitive through Tauri).
- **Added `npm run test:security`** — a regression suite that fails if scripts,
  event handlers, `javascript:` URLs, frames, or remote images ever survive an
  import again. Wired into `npm test` and CI alongside `npm audit` and
  `cargo audit`.

### Fixed

- `.txt` files were parsed as HTML, so a plain-text file containing `<b>`
  rendered as bold and `a < b` silently lost its `< b`. They are now opened as
  text, which is what they are.

### Added

- [`SECURITY.md`](SECURITY.md) — private vulnerability reporting, and a plain
  statement of the four properties a malicious document must not be able to
  break.
- [`THIRD-PARTY-NOTICES.md`](THIRD-PARTY-NOTICES.md) and
  `app/public/fonts/OFL.txt`. The bundled typefaces are SIL Open Font License,
  which requires the licence to travel with them — it wasn't shipping, in
  source or in the binary. It now does both.
- Dependabot config and a CI workflow running the test suites and both audits.

### Changed

- The build diary (PROJECT.md §17, ~114 KB of working notes) moved to a local
  `SESSIONS.md` that is not committed. PROJECT.md keeps the design reasoning,
  which is the part worth reading.

## [0.1.0] — 2026-07-06

First release. Real `.docx` open and save, images, six rooms, the Commander,
Flow and Page views, focus mode, autosave and recents. Windows only.

[0.2.1]: https://github.com/getwriteapp/write/releases/tag/v0.2.1
[0.1.1]: https://github.com/getwriteapp/write/releases/tag/v0.1.1
[0.1.0]: https://github.com/getwriteapp/write/releases/tag/v0.1.0
