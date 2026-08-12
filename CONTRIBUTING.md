# Contributing

## The most useful thing you can do

Open real documents in `write` and tell us what broke.

Fidelity is the whole product: a document that looks right here and wrong in
Word is a failure, and the failures that matter are subtle. A 99-fixture test
suite cannot cover what a real document from a real employer, professor or
editor does. A bug report with that document attached becomes a permanent test
fixture.

## Reporting a bug

Open an [issue](https://github.com/getwriteapp/write/issues/new/choose) with:

- what you did, what happened, what you expected;
- the app version (in the Commander, `Ctrl/⌘ K`) and your Windows version;
- the document, if you can share it — a small excerpt that still reproduces it
  is ideal;
- a screenshot, for anything visual.

Security bugs go through [private
reporting](https://github.com/getwriteapp/write/security/advisories/new)
instead. See [SECURITY.md](SECURITY.md).

## Building it

```bash
git clone https://github.com/getwriteapp/write.git
cd write/app
npm install
npm run tauri dev
```

Requires Node 24+, a Rust toolchain (`rustup`), and on Windows the WebView2
runtime and MSVC build tools.

`npm run dev` runs the frontend alone in a browser at `localhost:5173`, which
is faster for UI work but has no file dialogs — those live on the Rust side.

## Testing it

```bash
npm test          # round-trip, sanitizer, save model, npm audit
npm run test:e2e  # pagination and chrome, in a real browser
npm run test:all  # both
```

All of it runs in CI on every push and pull request. Four tiers:

| Suite | Covers |
|---|---|
| `tests/roundtrip.mjs` | 99 `.docx` fixtures, both directions |
| `tests/sanitize-probe.mjs` | scripts and remote images must not survive an import |
| `tests/unit/` | the save model, in jsdom |
| `tests/e2e/` | pagination and chrome, in Chromium |

A fix for a `.docx` bug should come with a fixture. A fix for anything that
depends on real layout belongs in the e2e tier — jsdom cannot see geometry, and
a pagination bug has shipped twice past tests that could not.

## Sending a change

1. Open an issue first for anything larger than a fix. It saves you writing
   something that doesn't fit the direction in [ROADMAP.md](ROADMAP.md).
2. Branch from `main`.
3. Keep the change focused. Match the surrounding style; the codebase comments
   *why*, not *what*.
4. Make sure `npm run test:all` passes.
5. Open the pull request.

A bot will ask you to sign the [CLA](CLA.md) on your first pull request. It is
one click. It exists so the project can keep the option of dual licensing and
of releasing the `.docx` engine under a permissive license — both of which
require holding rights to all the code. You keep the copyright in your work.

## What won't be merged

- Anything that makes a network request at runtime, or adds telemetry,
  analytics or a crash reporter. The offline guarantee is enforced by tests
  and is not negotiable.
- New dependencies without a clear reason. Every one is weight in a 7.4 MB
  binary and another licence to check.
- Copyleft dependencies. Everything upstream is MIT, Apache-2.0 or OFL, which
  is what keeps the licensing options in the CLA real.
- Features from [ROADMAP.md](ROADMAP.md)'s "Not planned" list.
- Reformatting passes, and refactors without a behavioural reason.
