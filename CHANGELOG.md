# Changelog

All notable changes to `write` are recorded here. Format loosely follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/); versioning is
[SemVer](https://semver.org/), pre-1.0.

## [0.4.0] — 2026-08-13

### Added

- **A Releases link in the Commander**, beside the version — and deliberately
  nothing more. `write` does not check for updates and now says so in
  [DESIGN.md](DESIGN.md) as a deliberate omission rather than a gap.

  A signed in-app updater was built and then rejected. It worked, but three
  documents promise no network request at runtime, and DESIGN.md is specific
  that the promise is *enforced twice in code and guarded by a test suite, not
  stated as a policy*. A check gated behind a button would still have
  converted that enforced property into a policy — which is the exact trade
  those words rule out. (It survives on the `updater` branch if the calculus
  ever changes.)

  So the link hands one hard-coded URL to the operating system and your
  browser makes the request. The Rust command behind it takes no arguments,
  and `tauri-plugin-opener`'s general `open_url` is deliberately not granted to
  the web view: a document that could open `https://…/?leaked=` in a tab would
  still be a document reporting home, which is what the remote-image rules
  exist to prevent.

  The cost is honest and accepted — nobody is told a fix exists; they have to
  go and look. Watching the repository's releases on GitHub is the way to be
  notified without `write` being the thing that notifies you.
- **Ctrl/Cmd+Click opens a link in a document.** `Link.configure({
  openOnClick: false })` had turned off click-to-navigate entirely — a stray
  click while editing shouldn't launch a browser mid-sentence, but that also
  meant there was no way at all to check where a link actually led, deliberate
  or not. Now the modifier native apps use for exactly this (VS Code, Word,
  most browsers) opens it, in the user's own browser rather than inside
  write's own window — the browser's address bar is what actually answers
  "does this go where it claims to". The URL comes from the document, so it
  is checked twice: the editor schema restricts what can become an `href`,
  and the Rust command that opens it revalidates the scheme independently
  (`http`/`https`/`mailto` only) rather than trusting the schema already did.
  8 new Rust tests cover the scheme check on its own, and `cargo test` now
  runs in CI — the check is the entire security argument, and a test nothing
  runs is a comment.

### Security

- **Licence gate in CI** (`cargo deny check licenses`, policy in
  `app/src-tauri/deny.toml`). `write` is GPL-3.0-or-later, which absorbs
  permissive dependencies but genuinely cannot combine with GPL-2.0-only or
  proprietary terms — so the risk isn't "did something copyleft get in", it's the
  narrower set GPLv3 can't take. THIRD-PARTY-NOTICES.md is the human-readable
  half; this is the half that runs without being remembered.
- **`npm ci --ignore-scripts` in CI.** A compromised package's payload almost
  always runs from an install lifecycle hook, before any of our own code does.
  Verified that no package in this tree declares one, so nothing is suppressed —
  this only removes the path.
- **Dependabot cooldown.** New versions wait a few days before being offered.
  Compromised packages are usually caught and pulled within a day or two, and the
  people they reach are the ones who upgraded within hours of publication.
- **Every CI action pinned to a full commit SHA.** The licence-check job already
  was; `checkout`, `setup-node` (both jobs) and `dtolnay/rust-toolchain` weren't.
  A tag is mutable — whoever controls an action's repository can repoint `v7` at
  new code, and every workflow using it picks that up silently. This workflow
  holds no secrets today, so the exposure was tampered test output rather than
  anything worse — pinned now rather than retrofitted the day a release workflow
  lands beside it.

## [0.3.0] — 2026-08-12

The first public release. Versions 0.2.2 through 0.2.4 exist in the repository
but were never published.

### Added

- **The bottom row now clears out.** The word count, document name, save state
  and key hints duck on scroll and in focus mode, and return when you reach
  into either bottom corner — the same mechanism the toolbar and wordmark have
  had. The wordmark now answers to focus mode as well, so all four corners
  clear together. Typing does not duck the row: the save state and word count
  are what you want while writing.
- **Documentation for contributors** — [CONTRIBUTING.md](CONTRIBUTING.md),
  [ROADMAP.md](ROADMAP.md), [DESIGN.md](DESIGN.md), [CLA.md](CLA.md), an issue
  template, and a CLA check on pull requests.

### Changed

- The Playwright suite now runs in CI. It only ever ran locally, which put the
  one tier that can see real layout on the honour system.

### Fixed

- `nanoid` advisory GHSA-2v37-7h3g-55p8, reached through `vite` → `postcss`.
  Build-time only; nothing shipped was exposed.

## [0.2.4] — 2026-08-06

### Added

- **A component test tier** (`npm run test:unit`, Vitest + jsdom) — 10 tests
  over the save model, driving real `Ctrl+S` events: a document with a file
  saves straight back to it, one without asks where, plus the expired-grant
  fallback, rename unbinding, and both discard-guard paths.
- **A real-browser test tier** (`npm run test:e2e`, Playwright) — 6 tests over
  pagination, which needs real layout that no Node test can reach.
- The `.docx` round-trip suite grew from 65 cases to 99: all five templates
  round-trip, and every bundled typeface is checked in both directions.

### Changed

- **Cobalt's body font is Reddit Mono**, replacing iA Writer Quattro.
- **`Ctrl+S` saves silently once a document has a file** instead of reopening
  the Save dialog. Save As moved to the Commander. The document name is
  click-to-rename, with a live save-state indicator beside it. Autosave still
  writes only to the internal draft store, never to the file on disk.
- **The tray icon is gone.** It never minimized to it, and its only behaviour
  was re-showing a window that was never hidden.
- **The formatting bar is sized to its contents** rather than to roughly half
  the window.
- **Letter, Meeting Notes, Resume and Report templates** carry the shape of a
  real document rather than one stub line per section.

### Fixed

- The app no longer scrolls itself to the bottom on open, and neither does
  opening a template or a file.
- Applying a highlight no longer leaves the text selected over its own colour.
- The page-numbers control no longer overlaps its own labels.
- Picking a room now closes the Commander.
- **Switching orientation, page size or margin no longer runs text through the
  page-gap band.** The sheet animates its width over 300ms and pagination was
  measured a tenth of the way in; it now measures once the resize settles.
- **The same bug again, on a loaded machine.** The 420ms backstop for the case
  where no animation runs also cancelled the real signal, so an animation that
  overran measured mid-flight and then discarded the correction. The backstop
  no longer stands the real one down.
- **Petrona was shipping without its licence notice**, which the SIL Open Font
  License requires to travel with the binary.
- **Dropping a `.doc` file now says so** and points at Word or LibreOffice,
  instead of doing nothing at all.
- A corrupt or truncated `.docx` no longer hangs the browser preview with no
  message; the importer's error now reaches the promise meant to carry it.

## [0.2.3] — 2026-08-05

### Changed

- **Dawn's body font is Petrona**, replacing Fraunces — a softer serif, lower
  contrast, larger x-height.
- **Paper's body font is Source Serif 4**, replacing Literata. Its `opsz` axis
  tightens proportions and raises contrast at larger sizes.

## [0.2.2] — 2026-08-05

### Changed

- **Highlight colours are tuned per room.** The five colours remain one
  canonical `.docx`-portable value each — what a Word user sees is unchanged.
  Each room now repaints the band with its own palette instead of a single
  "dim it if dark" rule, so highlights stay distinct from each other in the
  dark rooms rather than flattening together.
- **Canonical pink is `#F9A8D4`**, not `#FBCFE8` — the old value barely read
  as a highlight on white.
- **The bar's highlight swatches preview the room's actual colour**, not the
  canonical stored one.

## [0.2.1] — 2026-08-05

### Added

- **Page view breaks pages between lines, like Word.** A paragraph too long
  for the space left is split at the right line and continued on the next
  sheet. Pages now fill to 99–100% instead of stopping wherever a paragraph
  ended, and a paragraph longer than a page works at all. Tables and images
  are still moved whole.
- **Widow and orphan control**, on by default as in Word: a break never
  strands a single line of a paragraph on either side.
- **Formatting marks** (`Ctrl+Shift+8`) — a dot per space, an arrow per tab, a
  pilcrow per paragraph, ↵ at a line break. A view overlay only: never in the
  document, never in a copy, never printed.
- **Anchored zoom with a read-out** — `Ctrl+=` / `-` / `0`, and Ctrl+scroll
  zooms around the pointer rather than the page origin.
- **Thirteen more typefaces** (21 → 26) and a **Specimen** template that
  exercises every feature in running text.
- **A real app icon** — a hand-brushed lowercase "w", alpha-masked and
  regenerated into every platform size, replacing the "w|" placeholder.
- **A new default room, Linen** — Nunito Sans, rust caret, neutral greys —
  replacing Quattro, which was too close to iA Writer's own typeface and
  blue. Quattro survives as **Cobalt**, recoloured. Air is retired. Still six
  rooms.

### Changed

- **Page view renders the document's exported `.docx` typography** rather than
  the room's reading typography, so its breaks predict Word's. Flow view is
  unchanged.
- **Tab behaves the way Word's Tab behaves** — first-line indent, block
  indent, or a real tab character depending on the caret, all round-tripping.
- **The chrome ducks the moment you engage** with the page, rather than after
  48px of scrolling.
- **Trimmed the empty space above the first line** in both views, and switched
  it from a viewport-relative unit to a flat one. The page's own margin is
  untouched.
- **The font menu names the room's actual font** instead of the literal string
  "Room default", read live from the room's own `--body-font`.
- **The typeface, size and spacing controls match**: one arrow glyph at one
  size, one box height.
- **The chrome's typeface is Figtree**, replacing Geist; bar corners 12px → 4px
  and buttons 7px → 3px. Document typography is unaffected.

### Fixed

- The alignment and indent buttons' middle corners kept the browser's default
  rounding while the outer ones were squared off.
- **A block too tall for one page no longer breaks pagination for everything
  after it.** The sheet holding an oversized block now grows to hold it.
- **The desk background no longer turns white partway down a short last page.**
- Scrolling no longer grabs and stretches at the page edges.
- Modals no longer chain their scrolling to the document behind them.
- The accent rule no longer bleeds across the gap between pages.
- The top-left hover corner that summons the wordmark now works.

## [0.1.1] — 2026-08-02

A security and compliance pass. Nothing about writing changes; what changes is
what a document you open is allowed to do. No evidence any of this was ever
exploited — v0.1.0 was never publicly downloadable.

### Security

- **A document can no longer reach the network.** Remote image sources were
  parsed and fetched, which made any opened document a working tracking pixel.
  They are now refused by the editor schema, with a Content Security Policy as
  a second lock.
- **The webview no longer has filesystem access.** It previously held read and
  write permission on `**`. Access is now granted one file at a time by the
  Rust process, after a native dialog or a real drag-drop. A path the frontend
  chooses for itself is never honoured.
- **A malicious `.docx` can no longer exhaust memory.** A 250 KB archive could
  expand to 250 MB unchecked. Decompression is capped before inflation.
- **Added a Content Security Policy.** None was set previously.
- **Patched four advisories:** `fast-xml-parser` (GHSA-8r6m-32jq-jx6q, in the
  `.docx` parsing path), `postcss` (GHSA-r28c-9q8g-f849), and `quick-xml` ×2
  (RUSTSEC-2026-0194/0195, transitive through Tauri).
- **Added `npm run test:security`** — a regression suite that fails if scripts,
  event handlers, `javascript:` URLs, frames or remote images ever survive an
  import again.

### Fixed

- `.txt` files were parsed as HTML, so `<b>` rendered as bold and `a < b` lost
  its `< b`. They now open as text.

### Added

- [`SECURITY.md`](SECURITY.md), [`THIRD-PARTY-NOTICES.md`](THIRD-PARTY-NOTICES.md)
  and `app/public/fonts/OFL.txt` — the bundled typefaces are OFL, which
  requires the licence to travel with them, and it wasn't shipping.
- Dependabot config and a CI workflow running the suites and both audits.

## [0.1.0] — 2026-07-06

First release. Real `.docx` open and save, images, six rooms, the Commander,
Flow and Page views, focus mode, autosave and recents. Windows only.

[0.3.0]: https://github.com/getwriteapp/write/releases/tag/v0.3.0
[0.2.1]: https://github.com/getwriteapp/write/releases/tag/v0.2.1
[0.1.1]: https://github.com/getwriteapp/write/releases/tag/v0.1.1
