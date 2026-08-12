# Media

Screenshots and clips used by the repository's front page.

Keep each file under about 10 MB so cloning stays quick. GitHub renders
`.png`, `.gif`, `.mp4` and `.mov` inline in a README and animates `.gif`.

Referenced from the root README as `docs/media/<file>`.

## The social preview card

`social-preview.png` is what GitHub shows when the repo is linked anywhere —
Slack, Twitter, Discord, a search result. It is uploaded in **Settings →
General → Social preview**, not read from here; this is the source of record.

Both 1280×640 (GitHub's recommended size, 1 MB ceiling):

| File | Direction |
|---|---|
| `social-preview.png` | **in use.** The app icon carries it, name and facts alongside. Chosen because it survives being 400px wide in a Slack unfurl. |
| `social-preview-alt-b.png` | Held. The card is the app — Linen's palette and typeface, a rust caret in a half-written line. Its charm is restraint, and restraint is the first thing a thumbnail destroys; revisit once the name carries recognition of its own. |

Regenerate either after a palette or wordmark change:

```bash
node docs/media/build-card.mjs     # or build-card-b.mjs
```

Both scripts embed the icon and typefaces as data URIs and screenshot the
result with the Playwright Chromium the test suite already installs, so the
output does not depend on what fonts happen to be on the machine.
