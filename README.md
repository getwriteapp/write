<div align="center">

# write

**A quiet, beautiful word processor. Start from silence; go up into rich text.**

*Lightweight · offline · free forever · GPL-3.0*

</div>

---

`write` is a word processor for people who just want to write — a letter, a résumé, an essay, a short story — without the ceremony of Word or the fossilized UI of AbiWord, Atlantis, and Jarte.

It opens into a single quiet page. No ribbon, no panels, no chrome asking to be clicked. Reach for emphasis and a small toolbar finds you, then leaves. Underneath is a real rich-text document that leaves the app as clean `.docx`.

It borrows its soul from iA Writer — and goes *up* from there into full rich text.

## Why it exists

The "lightweight word processor" category has a genuine gap: nothing in it is beautiful. The best-looking writing apps (iA Writer, Ulysses, Bear, Craft) are Markdown-only and don't produce `.docx`. The apps that *do* real documents (AbiWord, Atlantis, Jarte, LibreOffice) look like they were designed fifteen to twenty years ago. `write` aims squarely at the empty middle: **as light as Jarte, as designed as iA Writer, and it saves `.docx`.**

See [`PROJECT.md`](PROJECT.md) for the full design philosophy, competitive analysis, and decision log.

## Getting it

Download the installer from the [latest
release](https://github.com/getwriteapp/write/releases/latest) — a 5.1 MB
`.exe`, no account, no telemetry, no bundled anything.

**Windows only for now.** The codebase is cross-platform and the build targets
for macOS and Linux are configured, but no macOS or Linux binary has ever been
produced or tested, so it would be dishonest to list them. Building from source
on those platforms should work; nobody has confirmed it.

Release binaries aren't code-signed yet, so Windows SmartScreen will warn on
first run — check the SHA-256 against the release notes before installing.

## Rooms

A *room* is more than a theme — it sets the light (palette), the voice (typeface), and the temperature of the work. Six ship built in:

| Room | Feel | Typeface |
|------|------|----------|
| **Linen** | White silence, one rust cursor — the default | Nunito Sans |
| **Cobalt** | White silence, one cobalt cursor | iA Writer Quattro |
| **Dawn** | Blush morning light, rose caret | Source Serif 4 |
| **Paper** | Cream and ink, a printed book | Literata |
| **Slate** | Cool dark, sea-glass caret | Geist |
| **Noir** | Midnight serif, amber caret — writing at 1 a.m. | Newsreader |

Cycle them with `Ctrl/⌘ + \`.

## Features

### The document

- **Real `.docx` open and save** — documents round-trip through Microsoft Word
  and back with structure intact, on a `.docx` reader and writer built for this
  app rather than a generic converter. Verified by an automated **65-fixture
  round-trip suite** that runs on every commit.
- **Rich text that survives the trip** — headings, lists, quotes, code, links,
  bold/italic/underline/strikethrough, text colour and highlight, alignment,
  line spacing, indentation, font family and size. Everything the app can set,
  Word can read; everything Word sets, the app can read back.
- **Tables** — insert, add and delete rows and columns, merge and split cells,
  toggle a header row that repeats across pages. Column widths, merged cells
  and repeating headers all round-trip.
- **Images** — paste or drag-drop PNG/JPEG/GIF into the page; embedded in the
  document and in the exported `.docx`, byte for byte.
- **Table of contents** — a snapshot of your headings, refreshed on demand,
  exported as a genuine Word TOC field that Word will keep up to date.
- **Headers, footers and page numbers** — each independently left/centre/right
  aligned; page numbers are a live Word `PAGE` field, not typed-in text.
- **Word's real Tab** — three different things depending on where the caret
  sits, exactly as Word does it: a first-line indent at the start of a block, a
  block indent across a selection, a real tab character anywhere else. All
  three are distinct concepts in the `.docx`, and all three round-trip.
- **Five templates** to start from — Letter, Meeting Notes, Resume, Report, and
  a Specimen that exercises every feature in the app in one running document.

### The page

- **Flow and Page views** — an endless quiet column for drafting, or real
  discrete paper sheets with true margins for seeing what Word will see.
- **Page view paginates the way Word does.** Pages break *between lines*, not
  just between paragraphs: a paragraph too long for the space left is split at
  the right line and continued on the next sheet. **Widow and orphan control**
  is on by default, so a single line is never stranded alone on either side of
  a break. Page view also renders the document's real exported typography
  rather than the room's reading typography — so the breaks it shows you are
  the breaks Word will produce.
- **Page setup** — Letter or A4, portrait or landscape, narrow/normal/wide
  margins, and insertable manual page breaks (`Ctrl/⌘ Shift Enter`). A
  document's own page settings drive the view when you open it.
- **Zoom** that anchors where you point (`Ctrl/⌘ =` / `-` / `0`, or
  Ctrl+scroll), with a read-out that fades away.
- **Formatting marks** — Word's ¶ toggle (`Ctrl/⌘ Shift 8`): a dot for every
  space, an arrow for every tab, a pilcrow at each paragraph, ↵ at a line
  break. Purely a view overlay — the marks never enter the document, never
  survive a copy, and never print.

### The room

- **Six built-in rooms** (palette + typeface + measure) with instant switching;
  your choice is remembered. Flow view adds narrow/normal/wide column widths.
- **Twenty-six bundled typefaces** — six serif, two slab, thirteen sans, two
  display, three typewriter — in a menu that previews each face live in your
  own document as you arrow through it, and restores on Escape.
- **Focus mode** — dims everything except the paragraph you're in (`F11` or
  `Ctrl/⌘ Enter`).
- **Chrome that gets out of the way** — the toolbar and wordmark duck the
  moment you engage with the page and return when you reach for them. A
  selection toolbar appears on demand and vanishes when you're done.
- Live word count and reading time, in a whisper at the corner.

### The everyday

- **Find & replace** (`Ctrl/⌘ F`) in a quiet bar rather than a dialog.
- **Native spell check**, toggleable.
- Auto-save that never asks; ten recent files; a quiet guard before unsaved
  work is replaced.
- Drag a `.docx` or an image from your file manager onto the window to open it.
- **Fully offline, and built so it can't quietly stop being true** — every font
  ships inside the app, and `write` makes no network requests at runtime. A
  document that points an image at someone else's server has that image left
  out rather than fetched, so opening a file can't announce your IP address or
  the moment you read it. Enforced twice over: the editor's schema refuses to
  parse the reference, and the app's Content Security Policy refuses to make
  the request. There's a [test suite](app/tests/sanitize-probe.mjs) that fails
  if either lock comes loose.

Known differences from Word, stated plainly rather than buried: a table or an
image taller than the space left on a page is moved to the next page whole
rather than split across the break (text paragraphs *do* split); headers and
footers are in the exported `.docx` but don't yet appear when printing directly
from the app; and TOC page numbers are computed by Word on open rather than
cached at export. [`PROJECT.md`](PROJECT.md) documents the full fidelity list.

## Keyboard

| Shortcut | Action |
|----------|--------|
| `Ctrl/⌘ B` / `I` / `U` | Bold / Italic / Underline |
| `Ctrl/⌘ K` | The Commander — rooms, recents, views, file actions |
| `Ctrl/⌘ /` | Show or pin the formatting bar |
| `Ctrl/⌘ \` | Cycle rooms |
| `F11` or `Ctrl/⌘ Enter` | Toggle focus mode |
| `Ctrl/⌘ S` | Save (`.docx` by default) |
| `Ctrl/⌘ O` | Open (`.docx`, `.html`, `.txt`) |
| `Ctrl/⌘ F` | Find & replace |
| `Ctrl/⌘ Shift V` | Paste without formatting |
| `Ctrl/⌘ Shift Enter` | Insert a page break |
| `Ctrl/⌘ Shift 8` | Show or hide formatting marks (¶) |
| `Ctrl/⌘ =` / `-` / `0` | Zoom in / out / reset to 100% |
| `Tab` / `Shift Tab` | Indent — first-line, block, or a tab character (see above) |
| `Esc` | Exit focus / close surfaces |

## Tech

- **[Tauri 2](https://tauri.app)** (Rust) shell — a **7.4 MB** binary (**5.1 MB**
  installer), using the system webview instead of bundling Chromium. Roughly
  half of that is the twenty-six bundled typefaces, which is the price of never
  making a network request for type.
- **[Svelte 5](https://svelte.dev)** + **[Vite](https://vite.dev)** frontend
- **[Tiptap](https://tiptap.dev)** / ProseMirror editor core
- The `.docx` reader and writer are this project's own, over
  [fflate](https://github.com/101arrowz/fflate) and
  [fast-xml-parser](https://github.com/NaturalIntelligence/fast-xml-parser)
- Fonts are all SIL Open Font License, safe to bundle with a GPL app
- No dependency is copyleft — everything upstream is MIT, Apache-2.0, or OFL

## Develop

```bash
cd app
npm install
npm run dev          # browser dev server at localhost:5173
npm run tauri dev    # the real desktop app (hot-reloaded)
npm run tauri build  # produce installers for the current OS
```

On Windows, `.\dev.ps1` from the repo root does the second of those without
the `cd`.

Requires Node 20+ and a Rust toolchain (`rustup`). On Windows you also need the WebView2 runtime (preinstalled on Windows 11) and the MSVC build tools.

```bash
npm test    # .docx round-trip suite + sanitizer regression suite + npm audit
```

## Security

`write` opens documents made by other people, so hostile input is part of the
job rather than an edge case. Four properties are meant to hold, and each is
enforced in code rather than promised:

| A document you open cannot… | How it's stopped |
|---|---|
| run code | the editor's schema drops scripts, event handlers, `javascript:` URLs, and frames |
| phone home | remote image sources are refused, and the CSP blocks the request anyway |
| read or write other files | the webview has no filesystem access; the Rust side grants one file at a time, only after you pick it |
| exhaust your machine | archive decompression is capped before anything is inflated |

Found a way around one of them? See [SECURITY.md](SECURITY.md) — please report
it privately rather than opening an issue. It also covers verifying a release
binary, which isn't code-signed yet.

## Design prototypes

The design was explored in two standalone HTML labs before any code was written — they still open in any browser and are worth a look:

- [`design-lab.html`](design-lab.html) — Lab I, the chrome-forward direction
- [`design-lab-2.html`](design-lab-2.html) — Lab II, the iA-derived direction that became the app
- [`fonts-preview.html`](fonts-preview.html) — every candidate typeface, side by side

## License

[GPL-3.0-or-later](LICENSE). `write` is free forever. You may use, study, share, and improve it. If you distribute a modified version, it must stay open under the same license — nobody gets to close the source and sell it.

Bundled typefaces and libraries carry their own licenses — all of them SIL
Open Font License, MIT, or Apache-2.0. Every one is listed in
[THIRD-PARTY-NOTICES.md](THIRD-PARTY-NOTICES.md), and the notices ship inside
the installed app as well as living here.

The iA Writer typefaces are used under the OFL, unmodified. `write` is an
independent project, not affiliated with or endorsed by Information
Architects Inc.

## Support

`write` is free and always will be. If it earns a place in your day, you can support development via GitHub Sponsors *(link to be added at publish)*. No paid tiers, no subscription, no upsell.
