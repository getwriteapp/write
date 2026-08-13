# Third-party notices

`write` is distributed under the [GPL-3.0-or-later](LICENSE). It also ships
other people's work — typefaces embedded in the binary, and libraries compiled
into it. Their licences are reproduced or referenced below.

Two obligations worth stating plainly:

- **The SIL Open Font License requires the copyright notice and licence to
  travel with the fonts**, in source and in the shipped binary. The full OFL
  text lives at [`app/public/fonts/OFL.txt`](app/public/fonts/OFL.txt), which
  Vite copies into the bundle, so every installed copy carries it.
- **No dependency here is copyleft.** Everything below is MIT, Apache-2.0 or
  OFL. `write` is GPL by its author's choice, not because anything upstream
  forced it — which is what keeps the licensing options in [CLA.md](CLA.md)
  real.

---

## Typefaces

Every typeface `write` ships is licensed under the **SIL Open Font License,
Version 1.1** (<https://scripts.sil.org/OFL>), with one exception noted below.

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
| Abril Fatface | © 2011 TypeTogether, with Reserved Font Names "Abril" and "Abril Fatface" |
| Archivo | © 2020 The Archivo Project Authors |
| Atkinson Hyperlegible | © 2020 Braille Institute of America, Inc. |
| Bitter | © 2011 The Bitter Project Authors |
| Bricolage Grotesque | © 2022 The Bricolage Grotesque Project Authors |
| Crimson Pro | © 2018 The Crimson Pro Project Authors |
| EB Garamond | © 2017 The EB Garamond Project Authors |
| Figtree | © 2022 The Figtree Project Authors |
| Fjalla One | © 2012 The Fjalla Project Authors |
| Fraunces | © 2020 The Fraunces Project Authors |
| Geist | © 2024 The Geist Project Authors |
| Geist Mono | © 2024 The Geist Project Authors |
| IBM Plex Sans | © 2019 IBM Corp. |
| Instrument Serif | © 2022 The Instrument Serif Project Authors |
| Inter | © 2016 The Inter Project Authors |
| JetBrains Mono | © 2020 The JetBrains Mono Project Authors |
| Josefin Slab | © 2020 The Josefin Slab Project Authors, with Reserved Font Name "Josefin" |
| Libre Caslon Display | © 2012 The Libre Caslon Display Authors |
| Libre Franklin | © 2020 The Libre Franklin Project Authors |
| Literata | © 2017 The Literata Project Authors |
| Lora | © 2011 The Lora Project Authors |
| Manrope | © 2019 The Manrope Project Authors |
| Newsreader | © 2020 The Newsreader Project Authors |
| Nunito Sans | © 2016 The Nunito Sans Project Authors |
| Petrona | © 2019 The Petrona Project Authors |
| Playfair Display | © 2017 The Playfair Display Project Authors |
| Poppins | © 2020 The Poppins Project Authors |
| Reddit Mono | © 2020-2023 Reddit, Inc. |
| Rokkitt | © 2016 The Rokkit Project Authors |
| Source Sans 3 | © Google Inc. |
| Source Serif 4 | © Google Inc. |
| Space Grotesk | © 2020 The Space Grotesk Project Authors |
| Work Sans | © 2019 The Work Sans Project Authors |
| Young Serif | © 2023 The Young Serif Project Authors |

Full licence for each: `app/node_modules/@fontsource-variable/<slug>/LICENSE`, or
`app/node_modules/@fontsource/<slug>/LICENSE` for statically-weighted families
(Abril Fatface, Atkinson Hyperlegible, Fjalla One, IBM Plex Sans, Instrument
Serif, Libre Caslon Display, Poppins, Reddit Mono, Young Serif).

Abril Fatface and Josefin Slab each carry a Reserved Font Name under the OFL
("Abril"/"Abril Fatface" and "Josefin" respectively) — the same restriction
already noted for iA Writer Quattro above: the exact name can't be reused for
a Modified Version, which doesn't constrain bundling or using the font as-is.

### The one Apache-2.0 exception

**Roboto Slab** is licensed under the **Apache License, Version 2.0**, not
OFL — unlike almost every other typeface here, including the rest of the
Google-published faces on this page. The original Roboto family has shipped
under Apache since its release; Roboto Slab inherited that rather than the
OFL its later Google Fonts siblings use. Apache-2.0 doesn't carry OFL's
"travel with the binary" requirement, but the full text is still bundled at
`app/node_modules/@fontsource-variable/roboto-slab/LICENSE` for anyone who
goes looking.

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
