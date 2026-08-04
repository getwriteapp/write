# Security policy

`write` opens documents that other people made. That is its job, so hostile
input is a permanent part of its threat model rather than an edge case. If you
find a way to make it misbehave, please tell us.

## Reporting a vulnerability

Use GitHub's [private vulnerability
reporting](https://github.com/getwriteapp/write/security/advisories/new) —
it's the "Report a vulnerability" button on the Security tab. That keeps the
report private until there's a fix.

Please don't open a public issue for a security bug.

**What to expect:** an acknowledgement within 7 days, an assessment within 14,
and a fix released before public disclosure wherever the severity warrants it.
`write` is maintained by one person in their own time — if that timeline slips,
it is capacity, not indifference, and you're welcome to chase.

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

That runs the `.docx` round-trip suite, the sanitizer regression suite, and an
`npm audit` gate at `--audit-level=high`. The Rust side is covered by:

```bash
cd app/src-tauri && cargo audit
```
