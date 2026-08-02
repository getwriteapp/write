# Third-party notices

`write` is distributed under the [GPL-3.0-or-later](LICENSE). It also ships
other people's work — typefaces embedded in the binary, and libraries compiled
into it. Their licences are reproduced or referenced below, which is a
condition of using them, not a courtesy.

Two of these obligations are easy to miss and worth stating plainly:

- **The SIL Open Font License requires the copyright notice and licence to
  travel with the fonts** — in source *and* in the shipped binary. The full
  OFL text lives at [`app/public/fonts/OFL.txt`](app/public/fonts/OFL.txt),
  which Vite copies into the bundle, so every installed copy of `write`
  carries it.
- **No dependency here is copyleft.** Everything below is MIT, Apache-2.0, or
  OFL. `write` is GPL because its author chose that, not because anything
  upstream forced it — which is what keeps relicensing options open.

---

## Typefaces

Every typeface `write` ships is licensed under the **SIL Open Font License,
Version 1.1** (<https://scripts.sil.org/OFL>).

### Bundled directly

Shipped as files in `app/public/fonts/`, byte-identical to the publisher's
originals — no subsetting, no format conversion, so the Reserved Font Name
restriction on Modified Versions does not apply.

| Typeface | Copyright |
|---|---|
| iA Writer Quattro S | © 2018 Information Architects Inc., with Reserved Font Name "iA Writer" — based on IBM Plex, © 2017 IBM Corp., with Reserved Font Name "Plex" |

Full licence: [`app/public/fonts/OFL.txt`](app/public/fonts/OFL.txt)

> The iA Writer typefaces are used here under the OFL, which expressly permits
> bundling them with software. iA asks that projects using their fonts
> "reference iA Writer clearly"; `write` credits them in its README, this file,
> and the app's own Rooms list. `write` is an independent project and is not
> affiliated with, endorsed by, or a product of Information Architects Inc.

### Bundled via [Fontsource](https://fontsource.org)

Compiled into the application bundle by Vite. Each package's full OFL text is
in its `node_modules/<package>/LICENSE`.

| Typeface | Copyright |
|---|---|
| EB Garamond | © 2017 The EB Garamond Project Authors |
| Geist | © 2024 The Geist Project Authors |
| Geist Mono | © 2024 The Geist Project Authors |
| Inter | © 2016 The Inter Project Authors |
| JetBrains Mono | © 2020 The JetBrains Mono Project Authors |
| Literata | © 2017 The Literata Project Authors |
| Lora | © 2011 The Lora Project Authors |
| Newsreader | © 2020 The Newsreader Project Authors |
| Playfair Display | © 2017 The Playfair Display Project Authors |
| Source Serif 4 | © Google Inc. |
| Atkinson Hyperlegible | © 2020 Braille Institute of America, Inc. |
| IBM Plex Sans | © 2019 IBM Corp. |

---

## JavaScript libraries

| Package | Licence |
|---|---|
| Svelte | MIT |
| Vite, `@sveltejs/vite-plugin-svelte` | MIT |
| Tiptap (`@tiptap/*`) and ProseMirror | MIT |
| `docx` | MIT |
| `fast-xml-parser` | MIT |
| `fflate` | MIT |
| `@tauri-apps/api`, `@tauri-apps/plugin-fs` | MIT OR Apache-2.0 |

## Rust crates

The desktop shell is built on **Tauri 2** (MIT OR Apache-2.0) and its
dependency tree, including `wry`, `tao`, `serde`, and `serde_json`. Full
licence texts for every crate are reproducible with:

```bash
cargo install cargo-about && cargo about generate about.hbs
```

---

## Regenerating this file

The font copyright lines come from each package's own `LICENSE`. To re-derive
them after a dependency change:

```bash
cd app && for p in node_modules/@fontsource*/*; do printf '%-30s' "$(basename $p)"; head -1 "$p/LICENSE"; done
```
