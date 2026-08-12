# Design

Why `write` is shaped the way it is. Short, because most of it is one idea
applied consistently.

## The idea

**The page is the interface.** Everything else is a whisper that arrives when
you reach for it and leaves when you don't.

Most word processors put a permanent frame around your document. `write` puts
the document first and treats chrome as something that has to earn its place on
screen, every time.

## Principles

**Typography first.** The default has to be right without configuration — face,
size, measure, leading, colour. Twenty-eight typefaces ship with the app so the
choice is never a download, and each room picks one deliberately.

**Calm by default.** The toolbar, the wordmark and the status row all duck when
you engage with the page. Focus mode clears all four corners. Nothing blinks,
nothing badges, nothing asks.

**Rooms, not themes.** A theme is a colour swap. A room is light, voice and
temperature together — palette, typeface and measure chosen as one thing. Six
ship built in; each has a point of view rather than a brightness setting.

**Fidelity over features.** A document that looks right in the app and wrong in
Word is a failed document. Page view therefore renders the *exported*
typography rather than the reading typeface, breaks between lines the way Word
does, and applies Word's widow and orphan rule. Where the app cannot match Word
it says so in the README rather than approximating quietly.

**Local by default, permanently.** No account, no sync, no telemetry, no
network request at runtime. This is enforced twice in code and guarded by a
test suite, not stated as a policy.

**Small.** A 7.4 MB binary on the system webview. Roughly half of that is
typefaces, which is the price of never fetching one.

## Deliberate omissions

- **No update check.** Not even a manual one. `write` could ask GitHub whether
  a newer version exists, and gating it behind a button would be defensible —
  but the promise above is that offline-ness is *enforced*, not *policed*, and
  an in-app check would make it a policy no matter how carefully it were
  gated. The Commander links to the releases page instead: the operating
  system opens your browser, and the request that follows is the browser's.
  The cost is real and accepted — nobody is told a fix exists, they have to go
  and look. The alternative was a weaker guarantee, and this one is load-
  bearing for what the app is.
- **No collaboration.** Local files, one writer. Real-time editing is a
  different product with a server in it.
- **No `.doc`.** The pre-2007 binary format shares nothing structurally with
  `.docx`; supporting it means a second parser for a format Word itself can
  convert in one step.
- **No cloud anything.** Sync would mean an account, a server and a promise
  that can be broken later.
- **No plugin API yet.** An extension surface is a compatibility commitment;
  it can come after the document model is settled.

## Trade-offs taken knowingly

- **Pagination is a preview, not a layout engine.** Sheets are absolutely
  positioned with injected spacing rather than a real page model. It matches
  Word's output closely enough to trust, and it keeps one continuous document
  underneath for editing.
- **Tables and images move whole.** A table taller than the space left goes to
  the next page rather than splitting. The exported `.docx` and real print
  output paginate correctly either way.
- **One writer's taste, decided.** Rooms are curated rather than
  user-composable. Fewer knobs, more character.
