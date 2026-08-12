# Security policy

`write` opens documents other people made, so hostile input is part of its
threat model rather than an edge case.

## Reporting a vulnerability

Use GitHub's [private vulnerability
reporting](https://github.com/getwriteapp/write/security/advisories/new) — the
"Report a vulnerability" button on the Security tab. Please don't open a public
issue for a security bug.

Expect an acknowledgement within 7 days and an assessment within 14, with a fix
released before public disclosure where the severity warrants it. `write` is
maintained by one person; if that slips, you're welcome to chase.

You'll be credited in the release notes unless you'd rather not be.

## Supported versions

Only the latest release. `write` is pre-1.0 and there are no maintenance
branches yet.

## What we consider a vulnerability

`write` is an offline desktop editor with no accounts, no server, and no
network calls. The interesting attack surface is therefore **a malicious
document**, and the properties we intend to hold are:

- **Opening a document cannot execute code.** The editor's schema drops
  scripts, event handlers, `javascript:` URLs, and embedded frames.
  `app/tests/sanitize-probe.mjs` is the regression suite for this — a report
  that adds a failing case there is especially welcome.
- **Opening a document cannot reach the network.** No fonts, images, or
  anything else are fetched at runtime. Images that point at a remote server
  are dropped rather than loaded, so a document cannot be used as a tracking
  pixel. Enforced by the editor schema and again by the Content Security
  Policy in `app/src-tauri/tauri.conf.json`.
- **Opening a document cannot read or write files the user didn't choose.**
  The webview holds no filesystem scope; access is granted per-file by
  `app/src-tauri/src/lib.rs` only after a native dialog or a real drag-drop.
- **Opening a document cannot hang or exhaust the machine.** Archive
  decompression is capped before it is inflated.
- **`write` itself never makes a network request.** There is no update check,
  no telemetry, and no phone-home of any kind. The Commander's **Releases**
  link hands one hard-coded URL to the operating system, which opens your
  browser — the request belongs to the browser, and the command behind that
  link takes no arguments, so nothing in the web view can point it elsewhere.
  A general "open any URL" capability is deliberately not granted, because a
  document opening `https://…/?leaked=` in a tab would still be a document
  reporting home.
- **A link inside a document can be opened, but never by the document.**
  Ctrl/Cmd+Click on a link opens it in the user's own browser; a plain click
  moves the caret, same as clicking anywhere else in the text. The URL comes
  from the document, so it gets two independent checks rather than one: the
  editor's Link extension restricts what can become an `href` in the first
  place, and the Rust command that opens it revalidates the scheme itself
  (`http`, `https`, `mailto` only) without trusting what the schema already
  allowed. Opening in the real browser rather than navigating write's own
  window there is deliberate too — the browser's address bar is what actually
  exposes a lookalike domain, which nothing inside write's own chrome could.

Breaking any of those is a vulnerability. So is anything that lets a document
read another document's contents, or that writes outside the file the user
picked.

## What we don't

- Crashes or hangs on a **corrupt** (rather than malicious) file — those are
  ordinary bugs; please open a normal issue.
- Anything requiring an attacker who already runs code on the machine as the
  user. At that point they don't need `write`.
- Missing hardening that has no demonstrated impact. A report saying "you
  should also do X" is welcome as an issue, but it isn't an advisory.
- Findings from an automated scanner pasted without a working reproduction.

## Verifying a release

Release binaries are not code-signed yet, so Windows SmartScreen will warn on
first run. Check the SHA-256 against the checksum published in the release
notes before installing:

```bash
sha256sum write_<version>_x64-setup.exe
```

## Running the security tests

```bash
cd app && npm test
```

That runs the `.docx` round-trip suite, the sanitizer regression suite, the
save-model tests, and an `npm audit` gate at `--audit-level=high`. The Rust
side is covered by:

```bash
cd app/src-tauri && cargo audit
```

and a licence gate, which answers a different question — not "is anything
known-broken?" but "may we actually ship this?":

```bash
cd app/src-tauri && cargo deny check licenses
```

`write` is GPL-3.0-or-later, which absorbs permissive dependencies but
genuinely cannot combine with GPL-2.0-only or proprietary terms. The policy and
the reasoning are in `app/src-tauri/deny.toml`. Both run in CI on every push and
pull request; `npm ci --ignore-scripts` is used there too, since a compromised
package's payload almost always runs from an install hook before any of our own
code does.
