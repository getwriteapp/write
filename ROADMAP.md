# Roadmap

What's being worked on, what's likely next, and what isn't planned.

## Now

- **Windows release polish.** Code signing (SmartScreen currently warns on
  first run), installer verification, `winget` and Scoop packaging.
- **Printing headers and footers.** They are correct in the exported `.docx`
  but do not appear when printing directly from the app.

## Next

- **macOS build.** The codebase is cross-platform and the target is
  configured; nobody has produced or tested a binary. Needs notarisation,
  hardware to test on, and its own bug tail.
- **Splitting tables across a page break.** Today a table taller than the
  space left moves whole.
- **Linux build**, on the same terms as macOS.

## Under consideration

- A frameless window, with the app supplying its own titlebar and snap
  behaviour.
- Cached TOC page numbers at export, so Word does not have to update the field
  on open.

## Not planned

- `.doc` (pre-2007 binary Word). See [DESIGN.md](DESIGN.md).
- Telemetry or analytics, in any form, opt-in or otherwise.
- Paid tiers. `write` is GPL and stays free.

## How to test it

The most useful thing anyone can do is open real documents in it.

1. Install the [latest release](https://github.com/getwriteapp/write/releases/latest),
   or build from source — see [CONTRIBUTING.md](CONTRIBUTING.md).
2. Open documents that came from Word, especially ones with tables, images,
   headers, footers or a table of contents.
3. Save from `write`, reopen in Word, and compare.
4. Anything that changed on the way through is a bug worth reporting, however
   small. Attach the file if you can share it — a failing document becomes a
   permanent test fixture.

Running the suites locally:

```bash
cd app && npm test        # round-trip, sanitizer, save model, audit
npm run test:e2e          # pagination and chrome, in a real browser
```

## How to contribute

Read [CONTRIBUTING.md](CONTRIBUTING.md). In short: bug reports with a document
attached are the highest-value contribution; code contributions need a signed
[CLA](CLA.md), which is checked automatically on every pull request.
