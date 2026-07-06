<div align="center">

# write

**A quiet, beautiful word processor. Start from silence; go up into rich text.**

*Lightweight · cross-platform · free forever · GPL-3.0*

</div>

---

`write` is a word processor for people who just want to write — a letter, a résumé, an essay, a short story — without the ceremony of Word or the fossilized UI of AbiWord, Atlantis, and Jarte.

It opens into a single quiet page. No ribbon, no panels, no chrome asking to be clicked. Reach for emphasis and a small toolbar finds you, then leaves. Underneath is a real rich-text document that leaves the app as clean `.docx`.

It borrows its soul from iA Writer — and goes *up* from there into full rich text.

## Why it exists

The "lightweight word processor" category has a genuine gap: nothing in it is beautiful. The best-looking writing apps (iA Writer, Ulysses, Bear, Craft) are Markdown-only and don't produce `.docx`. The apps that *do* real documents (AbiWord, Atlantis, Jarte, LibreOffice) look like they were designed fifteen to twenty years ago. `write` aims squarely at the empty middle: **as light as Jarte, as designed as iA Writer, and it saves `.docx`.**

See [`PROJECT.md`](PROJECT.md) for the full design philosophy, competitive analysis, and decision log.

## Rooms

A *room* is more than a theme — it sets the light (palette), the voice (typeface), and the temperature of the work. Six ship built in:

| Room | Feel | Typeface |
|------|------|----------|
| **Quattro** | White silence, one blue cursor — the iA homage | iA Writer Quattro |
| **Air** | Fresh light, glass, indigo gradient washes | Geist |
| **Dawn** | Blush morning light, rose caret | Source Serif 4 |
| **Paper** | Cream and ink, a printed book | Literata |
| **Slate** | Cool dark, sea-glass caret | Geist |
| **Noir** | Midnight serif, amber caret — writing at 1 a.m. | Newsreader |

Cycle them with `Ctrl/⌘ + \`.

## Features (v0.1 — Milestone 0)

- Real rich-text editing (bold, italic, underline, strikethrough, headings, lists, quotes, links) on a ProseMirror/Tiptap core
- Six built-in rooms with instant switching; your choice is remembered
- **Focus mode** — dims everything except the paragraph you're in (`F11` or `Ctrl/⌘ + Enter`)
- Selection toolbar that appears on demand and vanishes when you're done
- Chrome that fades while you type
- Live word count and reading time
- Open / Save (currently `.html` round-trip; `.docx` lands in Milestone 2)

## Keyboard

| Shortcut | Action |
|----------|--------|
| `Ctrl/⌘ B` / `I` / `U` | Bold / Italic / Underline |
| `Ctrl/⌘ \` | Cycle rooms |
| `F11` or `Ctrl/⌘ Enter` | Toggle focus mode |
| `Ctrl/⌘ S` | Save |
| `Ctrl/⌘ O` | Open |
| `Esc` | Exit focus |

## Tech

- **[Tauri 2](https://tauri.app)** (Rust) shell — ~10–15 MB binary, uses the system webview (not bundled Chromium)
- **[Svelte 5](https://svelte.dev)** + **[Vite](https://vite.dev)** frontend
- **[Tiptap](https://tiptap.dev)** / ProseMirror editor core
- Fonts are all SIL Open Font License, safe to bundle with a GPL app

## Develop

```bash
cd app
npm install
npm run dev          # browser dev server at localhost:5173
npm run tauri dev    # the real desktop app (hot-reloaded)
npm run tauri build  # produce installers for the current OS
```

Requires Node 20+ and a Rust toolchain (`rustup`). On Windows you also need the WebView2 runtime (preinstalled on Windows 11) and the MSVC build tools.

## Design prototypes

The design was explored in two standalone HTML labs before any code was written — they still open in any browser and are worth a look:

- [`design-lab.html`](design-lab.html) — Lab I, the chrome-forward direction
- [`design-lab-2.html`](design-lab-2.html) — Lab II, the iA-derived direction that became the app
- [`fonts-preview.html`](fonts-preview.html) — every candidate typeface, side by side

## License

[GPL-3.0-or-later](LICENSE). `write` is free forever. You may use, study, share, and improve it. If you distribute a modified version, it must stay open under the same license — nobody gets to close the source and sell it.

## Support

`write` is free and always will be. If it earns a place in your day, you can support development via GitHub Sponsors *(link to be added at publish)*. No paid tiers, no subscription, no upsell.
