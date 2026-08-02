# Changelog

All notable changes to `write` are recorded here. Format loosely follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/); versioning is
[SemVer](https://semver.org/), pre-1.0.

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

[0.1.1]: https://github.com/getwriteapp/write/releases/tag/v0.1.1
[0.1.0]: https://github.com/getwriteapp/write/releases/tag/v0.1.0
