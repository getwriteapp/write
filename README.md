<div align="center">

# write

**A quiet, beautiful word processor. Start from silence; go up into rich text.**

*Lightweight · offline · free · GPL-3.0*

</div>

---

`write` opens into a single quiet page. No ribbon, no panels. Reach for
emphasis and a small toolbar appears, then leaves. Underneath is a real
rich-text document that saves as clean `.docx`.

It is for letters, résumés, essays, notes and stories — documents that have to
look right and have to open in Word.

[`DESIGN.md`](DESIGN.md) covers the design intent. [`ROADMAP.md`](ROADMAP.md)
covers what's next and how to help.

## Getting it

Download the installer from the [latest
release](https://github.com/getwriteapp/write/releases/latest) — a 5.1 MB
`.exe`. No account, no telemetry.

**Windows only.** The codebase is cross-platform and the macOS and Linux build
targets are configured, but no binary for either has been produced or tested.

Release binaries are not code-signed yet, so Windows SmartScreen warns on first
run. Check the SHA-256 against the release notes before installing.

## Rooms

A room sets the palette, the typeface and the measure together. Six ship built
in. Cycle them with `Ctrl/⌘ + \`.

| Room | Feel | Typeface |
|------|------|----------|
| **Linen** | White, rust caret — the default | Nunito Sans |
| **Cobalt** | White, cobalt caret | Reddit Mono |
| **Dawn** | Blush light, rose caret | Petrona |
| **Paper** | Cream and ink | Source Serif 4 |
| **Slate** | Cool dark, sea-glass caret | Geist |
| **Noir** | Midnight, amber caret | Newsreader |

## Features

### The document

- **Real `.docx` open and save.** Documents round-trip through Microsoft Word
  with structure intact, on a `.docx` reader and writer built for this app.
  A 99-fixture round-trip suite runs on every commit.
- **Rich text that survives the trip** — headings, lists, quotes, code, links,
  bold/italic/underline/strikethrough, colour and highlight, alignment, line
  spacing, indentation, font family and size.
- **Tables** — rows and columns, merged and split cells, a header row that
  repeats across pages. Widths, merges and headers all round-trip.
- **Images** — paste or drag in PNG/JPEG/GIF; embedded byte for byte.
- **Table of contents** — exported as a real Word TOC field.
- **Headers, footers and page numbers** — independently aligned; page numbers
  are a live Word `PAGE` field, not typed text.
- **Word's three-way Tab** — first-line indent at the start of a block, block
  indent across a selection, a tab character anywhere else. All three are
  distinct in the `.docx`.
- **Five templates** — Letter, Meeting Notes, Resume, Report, and a Specimen
  that exercises every feature in one document.

### The page

- **Flow and Page views** — a continuous column for drafting, or discrete
  sheets with true margins.
- **Page view breaks between lines, not just between paragraphs**, with widow
  and orphan control on by default. It renders the document's exported
  typography, so the breaks shown are the breaks Word will produce.
- **Page setup** — Letter or A4, portrait or landscape, narrow/normal/wide
  margins, manual page breaks. A document's own settings drive the view.
- **Zoom** that anchors where you point, with a read-out that fades.
- **Formatting marks** (`Ctrl/⌘ Shift 8`) — a dot per space, an arrow per tab,
  a pilcrow per paragraph. A view overlay only: never in the document, never
  in a copy, never printed.

### The room

- **Six rooms**, remembered between sessions. Flow view adds narrow, normal
  and wide column widths.
- **Twenty-eight bundled typefaces** — seven serif, two slab, thirteen sans,
  two display, four typewriter — previewed live in your own document as you
  arrow through the menu.
- **Focus mode** (`F11` or `Ctrl/⌘ Enter`) — dims everything but the paragraph
  you're in, and clears the chrome from all four corners.
- **Chrome that gets out of the way.** The toolbar, wordmark and status row
  duck when you engage with the page and return when you reach for them.

### The everyday

- **Find & replace** (`Ctrl/⌘ F`).
- **Native spell check**, toggleable.
- Auto-save to an internal draft store; ten recent files; a guard before
  unsaved work is replaced. Auto-save never writes to your file on disk —
  opening someone else's document and closing it cannot alter it.
- Drag a `.docx` or an image onto the window to open it.
- **Offline, enforced in code.** Every font ships inside the app and `write`
  makes no network request at runtime. A document pointing an image at a
  remote server has that image dropped rather than fetched, so opening a file
  cannot report your IP address or the moment you read it. The editor schema
  refuses the reference and the Content Security Policy refuses the request; a
  [test suite](app/tests/sanitize-probe.mjs) fails if either lock loosens.

### Differences from Word

- A table or image taller than the space left on a page moves to the next page
  whole rather than splitting. Text paragraphs do split.
- Headers and footers are in the exported `.docx` but do not appear when
  printing directly from the app.
- TOC page numbers are computed by Word on open rather than cached at export.
- Adjacent blockquotes merge on import.

`write` opens `.docx`, `.html` and `.txt`. It does not open `.doc`, the
pre-2007 binary format: `.docx` is a zip of XML and `.doc` is an OLE compound
binary, so reading it means a second parser sharing nothing with the first.
Word and LibreOffice convert `.doc` to `.docx` in one step.

## Keyboard

| Shortcut | Action |
|----------|--------|
| `Ctrl/⌘ B` / `I` / `U` | Bold / Italic / Underline |
| `Ctrl/⌘ K` | The Commander — rooms, recents, views, file actions |
| `Ctrl/⌘ /` | Show or pin the formatting bar |
| `Ctrl/⌘ \` | Cycle rooms |
| `F11` or `Ctrl/⌘ Enter` | Focus mode |
| `Ctrl/⌘ S` | Save |
| `Ctrl/⌘ O` | Open |
| `Ctrl/⌘ F` | Find & replace |
| `Ctrl/⌘ Shift V` | Paste without formatting |
| `Ctrl/⌘ Shift Enter` | Page break |
| `Ctrl/⌘ Shift 8` | Formatting marks |
| `Ctrl/⌘ =` / `-` / `0` | Zoom in / out / reset |
| `Tab` / `Shift Tab` | Indent — first-line, block, or a tab character |
| `Esc` | Exit focus / close surfaces |

## Built with

- **[Tauri 2](https://tauri.app)** (Rust) — a 7.4 MB binary, 5.1 MB installer,
  using the system webview. Roughly half of that is the bundled typefaces.
- **[Svelte 5](https://svelte.dev)** + **[Vite](https://vite.dev)**
- **[Tiptap](https://tiptap.dev)** / ProseMirror
- The `.docx` reader and writer are this project's own, over
  [fflate](https://github.com/101arrowz/fflate) and
  [fast-xml-parser](https://github.com/NaturalIntelligence/fast-xml-parser)
- No dependency is copyleft — everything upstream is MIT, Apache-2.0 or OFL

## Build and run

```bash
cd app
npm install
npm run dev          # browser dev server at localhost:5173
npm run tauri dev    # the desktop app, hot-reloaded
npm run tauri build  # installers for the current OS
```

Requires Node 24+ and a Rust toolchain (`rustup`). On Windows you also need
the WebView2 runtime (preinstalled on Windows 11) and the MSVC build tools.
`.\dev.ps1` from the repo root runs the desktop app without the `cd`.

```bash
npm test        # .docx round-trip, sanitizer, save model, npm audit
npm run test:e2e  # pagination and chrome, in a real browser
```

[`CONTRIBUTING.md`](CONTRIBUTING.md) covers reporting a bug and sending a
change.

## Security

`write` opens documents made by other people, so hostile input is part of the
job. Four properties are enforced in code:

| A document you open cannot… | How it's stopped |
|---|---|
| run code | the editor schema drops scripts, event handlers, `javascript:` URLs and frames |
| phone home | remote image sources are refused, and the CSP blocks the request anyway |
| read or write other files | the webview has no filesystem access; the Rust side grants one file at a time, after you pick it |
| exhaust the machine | archive decompression is capped before anything is inflated |

Found a way around one? Report it privately — see
[SECURITY.md](SECURITY.md), which also covers verifying a release binary.

## License

[GPL-3.0-or-later](LICENSE). Free to use, study, share and improve. A
distributed modification must stay open under the same license.

Contributions are accepted under the [Contributor License
Agreement](CLA.md) — see [CONTRIBUTING.md](CONTRIBUTING.md).

Bundled typefaces and libraries carry their own licenses, all SIL Open Font
License, MIT or Apache-2.0, listed in
[THIRD-PARTY-NOTICES.md](THIRD-PARTY-NOTICES.md). The notices ship inside the
installed app as well.

The iA Writer typefaces are used under the OFL, unmodified. `write` is an
independent project, not affiliated with or endorsed by Information Architects
Inc.

## Support

`write` is free and stays free. If it earns a place in your day you can support
it through [GitHub Sponsors](https://github.com/sponsors/brettkcherry). No paid
tiers, no subscription.
