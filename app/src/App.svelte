<script>
  import { onMount, onDestroy, tick } from 'svelte'
  import { createEditor, WELCOME, insertImageFiles, bytesToDataUrl, IMAGE_EXT_MIME, findReplaceKey, markPastePlain, countRemoteImages, pageSpacerKey, pageSpacerDOM } from './lib/editor.js'
import { Decoration, DecorationSet } from '@tiptap/pm/view'
  import { ROOMS, DEFAULT_ROOM } from './lib/rooms.js'
  import { fileBridge, isTauri, DOC_EXT_RE } from './lib/bridge.js'
  import { TEMPLATES } from './lib/templates.js'
  import * as store from './lib/store.js'

  let host          // the editor mount point
  let editor        // Tiptap instance
  let room = $state(localStorage.getItem('write:room') || DEFAULT_ROOM)
  let focus = $state(false)
  let words = $state(0)
  let readMin = $state(1)
  let saved = $state(true)
  let docName = $state('Untitled')

  // the summonable command surface (replaces the persistent pill)
  let commanderOpen = $state(false)
  let recents = $state([])

  // view: flow (default, the iA lineage) vs page (paper + margins + real discrete sheets)
  let view = $state(localStorage.getItem('write:view') || 'flow')
  // Flow view's column width (the --measure): a scale on each room's own
  // measure, the parked "user-adjustable Flow-view column width" item —
  // Page view already has real margins, this is Flow's equivalent.
  let flowWidth = $state(localStorage.getItem('write:flowWidth') || 'normal')
  function applyFlowWidth(w) {
    flowWidth = w
    document.body.setAttribute('data-flow-width', w)
    localStorage.setItem('write:flowWidth', w)
  }
  let pageSize = $state(localStorage.getItem('write:pageSize') || 'letter')
  let orientation = $state(localStorage.getItem('write:orientation') || 'portrait')
  let margin = $state(localStorage.getItem('write:margin') || 'normal')
  // Wave 6: native OS/browser spellchecker toggle — applies in both views
  let spellcheck = $state(localStorage.getItem('write:spellcheck') !== '0')
  function toggleSpellcheck() {
    spellcheck = !spellcheck
    localStorage.setItem('write:spellcheck', spellcheck ? '1' : '0')
    editor?.view.dom.setAttribute('spellcheck', String(spellcheck))
  }
  /* Session 30: formatting marks — Word's ¶ toggle. A view preference like
     spellcheck (persisted, app-wide, never part of the document), so a doc
     opened with marks on shows them and the .docx never hears about it. */
  let formattingMarks = $state(localStorage.getItem('write:marks') === '1')
  function toggleFormattingMarks() {
    formattingMarks = !formattingMarks
    localStorage.setItem('write:marks', formattingMarks ? '1' : '0')
    editor?.commands.setFormattingMarks(formattingMarks)
    showToast(formattingMarks ? '¶ marks shown' : '¶ marks hidden')
    // the pilcrow occupies real width at the end of a line, so a block can
    // gain a line when marks come on — Page view has to re-measure
    queueMeasure()
  }
  // Wave 4: header/footer text + page numbers — same "app-wide default for
  // new docs, document's own on open" pattern as pageSize/orientation/margin.
  // Rendered as read-only preview bands on the page-sheet; edited via the
  // Commander (there's no per-page contenteditable — one header/footer
  // applies to every page, so one summonable editor is all that's needed).
  function loadJSON(key, fallback) {
    try { return JSON.parse(localStorage.getItem(key)) ?? fallback } catch { return fallback }
  }
  let header = $state(loadJSON('write:header', { text: '', align: 'center' }))
  let footer = $state(loadJSON('write:footer', { text: '', align: 'center' }))
  let pageNumbers = $state(loadJSON('write:pageNumbers', { enabled: false, place: 'footer', align: 'center' }))
  function saveHF() {
    localStorage.setItem('write:header', JSON.stringify(header))
    localStorage.setItem('write:footer', JSON.stringify(footer))
    localStorage.setItem('write:pageNumbers', JSON.stringify(pageNumbers))
  }
  function setHeader(patch) { header = { ...header, ...patch }; saveHF() }
  function setFooter(patch) { footer = { ...footer, ...patch }; saveHF() }
  function setPageNumbers(patch) { pageNumbers = { ...pageNumbers, ...patch }; saveHF() }
  // a document's own header/footer/pageNumbers (read back from .docx) take
  // over the current view on open, same rule as pageSettings below
  function applyHeaderFooterSettings(s) {
    if (s.header) header = s.header
    if (s.footer) footer = s.footer
    if (s.pageNumbers) pageNumbers = s.pageNumbers
    saveHF()
  }
  // one rect per physical page: {top, height, n} — the on-screen home of Tier-4
  let pageRects = $state([])
  // physical page size in CSS px at 96dpi, PORTRAIT orientation; kept in
  // sync with pages.css and export.js's PAGE_SIZE_TWIPS
  const PAGE_PHYSICAL = { letter: { w: 816, h: 1056 }, a4: { w: 794, h: 1123 } }
  const MARGIN_PX = { narrow: 48, normal: 96, wide: 144 } // 0.5in / 1in / 1.5in
  const PAGE_GAP = 28 // desk showing through between discrete sheets
  // Compact junctions: the DISPLAYED vertical margin where one page meets the
  // next (page N's bottom edge, page N+1's top edge) is trimmed to this, so
  // typing onto a fresh page doesn't strand the text ~236px from where you
  // left off. Display only — the real margin (g.my) still governs how much
  // content fits a page, so pagination stays true to print/.docx. The first
  // page's top and the last page's bottom keep the full real margin: the
  // document still opens and closes looking like an actual page. 48 = the
  // Narrow preset, so Narrow documents keep their true proportions; it also
  // leaves room for a two-line header/footer band (see .page-band).
  const JUNCTION_MY = 48
  // How far a block may hang past its page's capacity line before it gets
  // pushed to the next sheet instead. Small on purpose — this is tolerance for
  // sub-pixel layout rounding, not a licence to overhang.
  const OVERHANG_SLOP = 4
  // the current page's usable geometry — my (margin) + contentH (writable height)
  function geom() {
    const phys = PAGE_PHYSICAL[pageSize] || PAGE_PHYSICAL.letter
    const totalH = orientation === 'landscape' ? phys.w : phys.h
    const my = MARGIN_PX[margin] || MARGIN_PX.normal
    return { my, contentH: totalH - 2 * my }
  }
  let pageStyleEl
  let pageGapStyleEl
  /* Three features inject a <style> into the head (page setup, the page-break
     padding, focus dimming) because ProseMirror strips foreign classes off its
     own nodes. Each one is claimed by NAME rather than freshly created, so a
     component remount can't orphan the previous one in the head with its rules
     still live. That is not hypothetical: a hot reload resets these module
     variables, and a leaked page-break stylesheet keeps pushing blocks around
     while the next measurement — which starts by clearing what it thinks is
     its own stylesheet — computes sheet positions from a layout it isn't
     controlling. It looks exactly like a pagination bug, and it cost time in
     Session 30 before the cause was clear. */
  function claimStyleEl(name) {
    let el = document.head.querySelector(`style[data-write="${name}"]`)
    if (!el) {
      el = document.createElement('style')
      el.setAttribute('data-write', name)
      document.head.appendChild(el)
    }
    return el
  }

  // zoom: scales the document view only (never the app chrome) via CSS zoom
  // on <main>. Standardized CSS zoom (Chrome 128+) leaves layout reads like
  // offsetTop unscaled, so measurePages uses them raw — zoom is a viewing
  // convenience, not something that should change pagination.
  let zoomPct = $state(parseInt(localStorage.getItem('write:zoom'), 10) || 100)
  let mainEl

  // a brief whispered toast (e.g. room name on Ctrl+\)
  let toast = $state('')
  let toastTimer

  // drag-drop: hint shown while a file hovers the window
  let dropHint = $state(false)
  let unlistenDragDrop = null

  // discard guard: edits since the doc last touched a real file (save/open/new)
  let touched = false
  let confirmState = $state(null) // { action } → quiet "unsaved changes" surface

  /* While the Commander or the discard guard is up, the page behind them must
     hold still. `overscroll-behavior: contain` on the Commander stops the
     scroll chaining once you reach its end, but a wheel over the veil itself —
     which is most of the screen — still reaches the document. So the page
     scroll is locked outright for as long as a modal is open.
     The padding compensates for the scrollbar the lock removes: without it the
     whole layout jumps sideways by the scrollbar's width the moment the
     Commander opens, and jumps back when it closes. */
  $effect(() => {
    const open = commanderOpen || !!confirmState
    const el = document.documentElement
    if (!open) { el.style.overflow = ''; el.style.paddingRight = ''; return }
    const gap = window.innerWidth - el.clientWidth
    el.style.overflow = 'hidden'
    if (gap > 0) el.style.paddingRight = `${gap}px`
    return () => { el.style.overflow = ''; el.style.paddingRight = '' }
  })

  // selection bubble
  let bubble = $state({ show: false, x: 0, y: 0 })
  let active = $state({ bold: false, italic: false, underline: false, strike: false, block: '' })

  // chrome fades while typing
  let typing = $state(false)
  let typingTimer
  let autosaveTimer

  /* Page view's line height, measured from the font actually in use.
     Word stores line spacing as a multiple of the font's OWN natural line
     height (`w:line="276"`, lineRule="auto" = 1.15x), while CSS line-height
     multiplies the font SIZE. The two only agree for a font whose natural
     line height happens to be 1.0, which is none of them — ours range from
     1.15em (Literata, Source Serif, Newsreader) to 1.31em (Quattro, Geist).
     So the multiplier has to be computed per font rather than written down,
     or Page view mis-predicts how much fits on a page. Measuring also keeps
     this correct for any typeface added later, with no table to maintain. */
  const WORD_LINE_MULTIPLE = 1.15 // export.js: spacing { line: 276 } / 240
  function syncPageLeading() {
    const family = getComputedStyle(document.body).getPropertyValue('--body-font')
    const measure = (display, lineHeight) => {
      const el = document.createElement(display === 'inline' ? 'span' : 'div')
      el.style.cssText = `position:absolute;visibility:hidden;white-space:nowrap;font-size:100px;display:${display};line-height:${lineHeight}`
      el.style.fontFamily = family
      el.textContent = 'Hxg' // ascender, x-height, descender
      document.body.appendChild(el)
      const h = el.getBoundingClientRect().height / 100
      el.remove()
      return h
    }
    const natural = measure('block', 'normal')
    /* The second measurement is the one that stops highlights spilling. An
       inline element's background is painted over its CONTENT AREA (the font's
       ascent + descent), which is NOT the same as `line-height: normal` — for
       Literata normal is 1.15em while the content area is ~1.5em. If the line
       box is shorter than that, a <mark> is taller than its own line and bleeds
       onto the one above (Brett's screenshot). So the leading is Word's
       multiple, floored at the height the glyphs actually occupy. */
    const contentArea = measure('inline', 'normal')
    if (!natural || !isFinite(natural)) return // font not ready; the fallback holds
    const leading = Math.max(natural * WORD_LINE_MULTIPLE, contentArea * 1.02)
    document.documentElement.style.setProperty('--page-leading', leading.toFixed(3))
  }

  function applyRoom(next, { toastIt = false } = {}) {
    room = next
    document.body.setAttribute('data-room', next)
    localStorage.setItem('write:room', next)
    if (toastIt) showToast(ROOMS.find((r) => r.id === next)?.label || next)
    // a room carries its own typeface, size, leading and measure — every one
    // of which changes how much text fits a page (and the new family may not
    // even be downloaded yet, hence the font-aware pass as well as the frame one)
    syncPageLeading() // the new room's font has its own natural line height
    queueMeasure()
    measureWhenFontReady(getComputedStyle(document.body).getPropertyValue('--body-font'))
  }

  function showToast(text) {
    toast = text
    clearTimeout(toastTimer)
    toastTimer = setTimeout(() => { toast = '' }, 1400)
  }

  function setFocus(on) {
    focus = on
    document.body.setAttribute('data-focus', on ? 'on' : 'off')
    if (on) { commanderOpen = false; litParagraph() } else clearLit()
  }

  function toggleCommander(force) {
    commanderOpen = force ?? !commanderOpen
  }

  // ---- view: flow vs page ----
  function applyView(v) {
    view = v
    document.body.setAttribute('data-view', v)
    localStorage.setItem('write:view', v)
    queueMeasure()
  }
  function applyPageSize(s) {
    pageSize = s
    document.body.setAttribute('data-page-size', s)
    localStorage.setItem('write:pageSize', s)
    syncPageStyle()
    queueMeasure()
  }
  function applyOrientation(o) {
    orientation = o
    document.body.setAttribute('data-orientation', o)
    localStorage.setItem('write:orientation', o)
    syncPageStyle()
    queueMeasure()
  }
  function applyMargin(m) {
    margin = m
    document.body.setAttribute('data-margin', m)
    localStorage.setItem('write:margin', m)
    syncPageStyle()
    queueMeasure()
  }
  const MARGIN_IN = { narrow: '0.5in', normal: '1in', wide: '1.5in' }
  function syncPageStyle() {
    if (!pageStyleEl) pageStyleEl = claimStyleEl('page')
    const size = pageSize === 'a4' ? 'A4' : 'letter'
    const orient = orientation === 'landscape' ? ' landscape' : ''
    const marginIn = MARGIN_IN[margin] || '1in'
    pageStyleEl.textContent = `@media print{@page{size:${size}${orient};margin:${marginIn};}}`
  }

  /* The zoom read-out. Zoom is otherwise invisible while you're doing it —
     you can end up at 90% and not know why the page looks slightly off, with
     the only number buried in the Commander. This shows the percentage while
     you zoom and fades once you stop, and marks 100% as the resting state so
     "am I back to normal?" is answerable at a glance. It borrows the toast's
     visual language, so it inherits every room's palette for free. */
  let zoomBadge = $state(false)
  let zoomBadgeTimer
  function flashZoomBadge() {
    zoomBadge = true
    clearTimeout(zoomBadgeTimer)
    zoomBadgeTimer = setTimeout(() => { zoomBadge = false }, 1100)
  }

  /* ---- zoom: Ctrl+scroll, Ctrl+= / Ctrl+- / Ctrl+0, or the Commander's +/− ----
     Zoom holds a point of the document STILL rather than growing everything
     away from the top-left. Without this, `zoom` scales from the origin while
     the scroll offset stays put, so the page appears to run away upward and
     you have to chase it back — the whole document slides even though you only
     wanted it bigger.

     The anchor is the mouse for Ctrl+scroll (what maps, Figma and browsers do —
     zoom goes where you're pointing) and the centre of the viewport for the
     keyboard and the Commander's buttons, where there's no pointer to speak of.

     The maths: with CSS zoom, a point at unzoomed document coordinate `docY`
     is painted at `docY * zoom - scrollY`. Solve for the scroll that keeps
     that point under the same screen offset before and after. Both axes,
     because a zoomed page sheet can be wider than the window too. */
  function applyZoom(pct, anchor) {
    const prev = zoomPct / 100
    const next = Math.max(50, Math.min(200, Math.round(pct / 10) * 10))
    // the badge shows even when the value doesn't move — at the 50/200 stops,
    // and on Ctrl+0 when you're already at 100%, where confirming "yes, you
    // are at default" is exactly the question being asked
    flashZoomBadge()
    if (next === zoomPct) return
    // screen offsets to hold fixed; default to the middle of the window
    const ax = anchor?.x ?? window.innerWidth / 2
    const ay = anchor?.y ?? window.innerHeight / 2
    // the document point currently sitting under the anchor, in unzoomed coords
    const docX = (window.scrollX + ax) / prev
    const docY = (window.scrollY + ay) / prev

    zoomPct = next
    localStorage.setItem('write:zoom', String(zoomPct))
    // no zoom style at all at 100%: any zoom on the scrolling subtree can
    // demote scrolling to the main thread in some engines
    const scale = zoomPct / 100
    if (mainEl) mainEl.style.zoom = zoomPct === 100 ? '' : String(scale)

    // read a layout property so the new zoom is applied before we scroll —
    // otherwise the scroll lands against the OLD document height and is clamped
    if (mainEl) void mainEl.offsetHeight
    window.scrollTo({
      left: Math.max(0, docX * scale - ax),
      top: Math.max(0, docY * scale - ay),
      behavior: 'instant',
    })
    queueMeasure()
  }
  function onWheel(e) {
    if (!e.ctrlKey) return
    e.preventDefault()
    // zoom toward the pointer
    applyZoom(zoomPct + (e.deltaY < 0 ? 10 : -10), { x: e.clientX, y: e.clientY })
  }
  // Ctrl+scroll zoom needs a NON-passive wheel listener (to preventDefault
  // the browser's own zoom) — but a permanently-registered one forces every
  // ordinary wheel tick to wait on the JS thread before the compositor may
  // scroll, which reads as sticky, laggy scrolling (WebView2 especially).
  // So the blocking listener only exists while Ctrl is actually held.
  let ctrlZoomArmed = false
  function armCtrlZoom() {
    if (ctrlZoomArmed) return
    window.addEventListener('wheel', onWheel, { passive: false, capture: true })
    ctrlZoomArmed = true
  }
  function disarmCtrlZoom() {
    if (!ctrlZoomArmed) return
    window.removeEventListener('wheel', onWheel, { capture: true })
    ctrlZoomArmed = false
  }
  function onCtrlUp(e) { if (e.key === 'Control') disarmCtrlZoom() }
  function queueMeasure() {
    requestAnimationFrame(() => requestAnimationFrame(measurePages))
  }
  /* Repagination while TYPING is debounced; everything else measures at once.

     A full measure costs ~23ms on a nine-page document, and profiling says
     essentially all of it is the two forced full-document relayouts either
     side of the natural-layout reading (8.6ms + 12.4ms) — the line-level
     measurement itself is 0.3ms a block. That cost is not new (the old
     block-only engine cleared and rewrote the same stylesheet, forcing the
     same two relayouts); it was simply never on the keystroke path's
     conscience before. Running it per keystroke is what would make a long
     document feel heavy, so the typing path waits for a pause instead. Word
     repaginates in the background for exactly this reason, and at this delay
     the breaks settle before the eye leaves the word just typed. */
  let measureTimer
  function queueMeasureSoon() {
    clearTimeout(measureTimer)
    measureTimer = setTimeout(() => requestAnimationFrame(measurePages), 90)
  }
  /* Re-measure once a newly-requested typeface has actually arrived.
     @font-face is lazy: the file is only fetched when something on screen
     first asks for that family, and every face this app ships is
     `font-display: swap`. So the moment you pick a font, the text is laid out
     in a FALLBACK — and it silently reflows to different metrics a beat later
     when the real font lands. A measurement taken on the next frame (which is
     all queueMeasure waits for) is therefore measuring text that is about to
     change height, and Page view's break positions come out computed for the
     wrong document: text overruns the bottom of its sheet and carries on
     across the desk gap. This was Brett's "changing fonts mid-page breaks
     pagination" bug. Same reason the very first measurement at mount hangs
     off document.fonts.ready. */
  function measureWhenFontReady(css) {
    if (!document.fonts) return
    let kick
    // load() takes a CSS `font` shorthand, so the stack needs a size in front
    try { kick = document.fonts.load(`16px ${css || 'sans-serif'}`) } catch { kick = null }
    Promise.resolve(kick)
      .catch(() => {})
      // .ready as well as the explicit load: bold/italic faces of the same
      // family are separate files, requested only as they're painted
      .then(() => document.fonts.ready)
      // leading first: it depends on the font's own metrics, and it changes
      // how much fits a page, so measurePages must run after it
      .then(() => { syncPageLeading(); measurePages() })
      .catch(() => {})
  }

  // tracks the page count across measurements so we can tell "you just grew
  // onto a new page" (while typing) apart from "the doc/view just loaded" —
  // only the former should auto-follow the cursor down to the new sheet
  let lastMeasuredPages = null
  function followCaretToNewPage() {
    const sel = window.getSelection()
    const pm = host?.querySelector('.ProseMirror')
    if (!sel?.focusNode || !pm?.contains(sel.focusNode)) return
    const el = sel.focusNode.nodeType === 1 ? sel.focusNode : sel.focusNode.parentElement
    el?.scrollIntoView({ block: 'center', behavior: 'smooth' })
  }

  /* Tier-4: discrete floating pages. ProseMirror keeps one continuous
     document — we never split its DOM — so the "pages" are an illusion made
     of two parts kept in sync:
       1. paper rects (pageRects, below) drawn behind the text with a real
          gap between them — full-height margins on the document's outer
          edges, compact JUNCTION_MY margins where sheets meet;
       2. a margin-top pushed onto the block that starts each new page, via
          an injected `:nth-child` stylesheet rule — the same technique
          the focus-dimming feature uses, because ProseMirror strips foreign
          classes/attrs on its own nodes but leaves an external <style> alone.
     Breaks always fall on a block boundary (never mid-paragraph) — a
     paragraph that would straddle a page in Word is moved down whole here
     instead. Documented as the known Tier-4 gap; true reflow needs a real
     pagination engine, a further increment.

     Wave 3 rewrite: a single forward sweep over top-level blocks (instead of
     the old "compute a nominal page count, then search for each target"
     approach), tracking how much natural content height has accumulated
     since the current page began. One pass handles three break triggers: a
     block that starts past the page, a block that starts on the page but
     ends past it (Session 27 — see the loop), and a manual pageBreak node,
     which forces the next block onto a fresh page unconditionally. It's also more accurate than the old approach for 3+
     page documents — each page's fill baseline is the ACTUAL previous break
     point, not a rigid global target that assumed every prior page filled
     exactly to capacity. offsetTop reads are used RAW — never divided by
     the zoom factor. Chromium standardized CSS zoom (Chrome 128+, so every
     WebView2 this app can meet): layout properties like offsetTop report
     unzoomed layout-space values; only rendered geometry (e.g.
     getBoundingClientRect) is scaled. The sheets, the text, and the
     injected padding all live inside the zoomed <main>, so the whole
     computation stays in one consistent unzoomed coordinate space. A
     legacy `/ zoom` division here was a real shipped bug: at any zoom
     other than 100% it shrank every measured position by the zoom ratio,
     pushing breaks late and rendering text across the desk gap. */
  function isPageBreakEl(el) {
    return !!el?.getAttribute && el.getAttribute('data-type') === 'pageBreak'
  }

  /* ---- Session 31: line-level pagination ----
     A block may be cut BETWEEN its own lines only if everything in it is text.
     An image or a table cannot be sliced, and a paragraph built around one is
     safer moved whole — so those keep the block-granular behaviour that has
     always been here. Everything else (paragraphs, headings, lists,
     blockquotes) can now break mid-block, the way Word does. */
  function isSplittable(el) {
    if (!el || isPageBreakEl(el)) return false
    return !el.querySelector('img, table, [data-type="pageBreak"], [data-type="tableOfContents"]')
  }

  /* The visual line boxes of a block, in .ProseMirror's own UNZOOMED layout
     space — the same space offsetTop reports in, so the two can be added.

     Three traps live in here, all of them paid for the hard way:
     1. Rects are collected from TEXT NODES, never from a range over the block
        itself. A range spanning element content also yields those elements'
        own border boxes — for a list, every `<li>` box — which are not lines,
        are full-width, and (on a block carrying injected page padding) extend
        straight through the desk gap. Clustering those in with real line rects
        made a list look like one line per item and put its break in the wrong
        place. Text nodes yield one rect per line fragment and nothing else.
     2. Even then it is one rect per FRAGMENT, not per line. A bold run, a
        link, or (with formatting marks on) every single space is its own
        fragment on the same line, so rects still have to be clustered back
        into lines by vertical overlap before they mean anything.
     3. Rect geometry is scaled by CSS zoom; offsetTop is not (see the zoom
        Gotcha). Intra-block offsets are therefore divided by the zoom factor
        and added to the block's own offsetTop — keeping the division INSIDE
        one block, so any rounding error stays bounded to that block instead of
        accumulating down the whole document. */
  function lineBoxes(el) {
    const z = zoomPct / 100
    const base = el.getBoundingClientRect().top
    const walker = document.createTreeWalker(el, NodeFilter.SHOW_TEXT)
    const rects = []
    for (let n = walker.nextNode(); n; n = walker.nextNode()) {
      if (!n.data) continue
      /* Which paragraph owns this line. Widow/orphan control is a rule about
         a PARAGRAPH, not about a top-level block, and the two are only the
         same thing for plain body text: one `<ul>` holds many paragraphs, and
         "the last line" of the list is not "the last line" of the item being
         broken. Carrying the owner through lets the rule stay per-paragraph
         wherever it is applied. */
      const owner = n.parentElement?.closest('p, h1, h2, h3, li, blockquote, pre, td, th') || el
      const r = document.createRange()
      r.selectNodeContents(n)
      for (const rect of r.getClientRects()) {
        if (rect.height > 0.5 && rect.width > 0) rects.push({ rect, owner })
      }
    }
    rects.sort((a, b) => a.rect.top - b.rect.top || a.rect.left - b.rect.left)
    const lines = []
    for (const { rect: r, owner } of rects) {
      const cur = lines[lines.length - 1]
      if (cur && r.top < cur.rawBottom - 1) {
        cur.rawBottom = Math.max(cur.rawBottom, r.bottom)
        cur.rawLeft = Math.min(cur.rawLeft, r.left)
      } else {
        lines.push({ rawTop: r.top, rawBottom: r.bottom, rawLeft: r.left, owner })
      }
    }
    return lines.map((l) => ({
      top: (l.rawTop - base) / z,       // layout px, relative to the block
      bottom: (l.rawBottom - base) / z,
      rawTop: l.rawTop, rawBottom: l.rawBottom, rawLeft: l.rawLeft, // viewport px
      owner: l.owner,                   // the paragraph this line belongs to
    }))
  }

  /* The document position of a line's first character. Only ever asked for
     lines after a block's first, so the coordinate always sits on a soft-wrap
     boundary — where the end of one line and the start of the next are the
     SAME document position, which is what makes the ±1px aim harmless. */
  function posAtLineStart(line) {
    const hit = editor?.view.posAtCoords({
      left: line.rawLeft + 0.5,
      top: (line.rawTop + line.rawBottom) / 2,
    })
    return hit ? hit.pos : null
  }

  /* The spacer set last pushed into the editor, as a cheap identity string, so
     an unchanged pagination doesn't dispatch a transaction.

     The memo is checked against what the editor ACTUALLY holds, never against
     itself alone. A signature describes what we want; it says nothing about
     what survived. Replacing the document (`setContent`, opening a file, a
     template) destroys every decoration — and if the new content paginates the
     same way, the freshly computed signature is byte-identical to the stale
     one, so a self-comparing memo concludes "nothing changed" and never puts
     the spacers back. That is exactly how it failed: the same document loaded
     twice in a row lost all nine of its line breaks and ran text through nine
     desk gaps, with the engine having computed all nine correctly. */
  let lastSpacerSig = ''
  function applySpacers(list) {
    const sig = list.map((s) => `${s.pos}:${Math.round(s.height)}`).join('|')
    let liveCount = 0
    editor && pageSpacerKey.getState(editor.state)?.find().forEach(() => liveCount++)
    if (sig === lastSpacerSig && liveCount === list.length) return
    lastSpacerSig = sig
    if (!editor) return
    const decos = list.map((s) =>
      Decoration.widget(s.pos, pageSpacerDOM(s.height), { side: -1, marks: [], key: `pg-${s.pos}-${Math.round(s.height)}` }))
    // metadata-only: no steps, so it can never reach the undo stack, mark the
    // document dirty, or (since the doc doesn't change) re-enter measurePages
    editor.view.dispatch(
      editor.state.tr.setMeta(pageSpacerKey, DecorationSet.create(editor.state.doc, decos)).setMeta('addToHistory', false))
  }
  function measurePages() {
    // Flow view has no pages, so it must have no line spacers either — leaving
    // them behind would put page-sized holes in a continuous document
    const clearPaging = () => {
      pageRects = []
      lastMeasuredPages = null
      if (pageGapStyleEl) pageGapStyleEl.textContent = ''
      applySpacers([])
    }
    if (view !== 'page' || !host) { clearPaging(); return }
    const pm = host.querySelector('.ProseMirror')
    if (!pm) { clearPaging(); return }
    const g = geom()
    // compact-junction display geometry (see JUNCTION_MY): trimmed vertical
    // margins where sheets meet; capacity (g.contentH) is untouched
    const jmy = Math.min(g.my, JUNCTION_MY)
    const firstH = g.my + g.contentH + jmy // page 0's height when it has a successor
    const midH = jmy + g.contentH + jmy    // every later non-final page

    if (!pageGapStyleEl) pageGapStyleEl = claimStyleEl('page-breaks')
    /* Measure the NATURAL layout: both kinds of injected space are taken out
       first — the block padding by clearing these rules, the line spacers by
       hiding them. Deliberately NOT by subtracting their known heights
       arithmetically, even though that would save a reflow: every pagination
       bug this project has had was an arithmetic error about its own injected
       offsets, and measuring from a clean layout is the one approach that
       cannot inherit them. The spacers stay in the document as decorations —
       only their display is suppressed, so this costs no transaction. */
    pageGapStyleEl.textContent = '.page-spacer{display:none}'
    // hiding the spacers shortens the document, and Chromium's scroll
    // anchoring will compensate — restore the scroll position afterwards so a
    // measurement never moves the page under the writer
    const scrollBefore = window.scrollY

    const children = [...pm.children]
    const rules = []
    let cumMargin = 0     // total logical margin injected so far
    let pageIndex = 0     // 0-based index of the page currently being filled
    // Logical Y where the current page's content began, in .ProseMirror's own
    // coordinate space. That space already starts exactly g.my below each
    // page-sheet's own top edge (.editor-host's CSS padding does that for
    // page 1, for free), so page 1 begins at 0 here, NOT g.my — adding g.my
    // again double-counts the top margin for every page after the first,
    // pushing content that far too low and starving the PRECEDING page of
    // its bottom margin by the same amount (content crowds its sheet's outer
    // edge instead of stopping a full margin short of it).
    let pageStartY = 0
    let pageStartIdx = 0 // the block that opens the page being filled; it can
                         // never be pushed further down (there is nowhere left
                         // to push it to, and trying would loop forever)
    /* How much taller than `contentH` each page actually turned out, and the
       running total. A block taller than a page can't be moved down (nothing
       would hold it there either), so its page genuinely holds more than a
       page of content — and that surplus has to be given back to the SHEET,
       or the paper stops describing the text.

       Without this, one over-tall block silently broke pagination for the
       whole rest of the document. `marginNeeded` below is clamped at 0
       (correctly — a block can't be pushed UP), so once content sat lower
       than its page's ideal start, every later break asked for a negative
       offset, got 0, and injected nothing: the sheets carried on being drawn
       at their ideal positions while the text ran free below them. Measured
       on a Specimen with one 1083px paragraph (page capacity 864px): ZERO
       padding rules injected across 8 pages, and a perfectly ordinary
       197px list four blocks later had a line of itself buried behind a desk
       gap. That was Brett's screenshot. */
    const pageExtras = []
    let extraTotal = 0

    // line-level breaks, collected as {pos, height} and pushed into the editor
    // as widget decorations once the walk is done (see applySpacers)
    const spacers = []

    /* Close the page being filled and open the next one at `naturalTop`,
       returning the gap that has to be inserted there to carry content down
       to the new sheet. Shared by both kinds of break — a block boundary and
       a line boundary differ only in how that gap gets applied. */
    const openPageAt = (naturalTop) => {
      // what did the page being left actually consume? Everything beyond
      // capacity is something that could not be split or moved, and the sheet
      // grows to cover it so no text is ever stranded on the desk (or, worse,
      // hidden behind the gap mask painted over it).
      pageExtras[pageIndex] = Math.max(0, naturalTop - pageStartY - g.contentH)
      extraTotal += pageExtras[pageIndex]
      pageIndex++
      // where page k's first text lands in .ProseMirror space (whose origin
      // sits g.my below sheet 0's top): every page before k has a successor,
      // so its displayed bottom margin is jmy; page k's displayed top margin
      // is jmy too (k ≥ 1 here, so it always has a predecessor)
      // + extraTotal: every page closed so far may have grown past contentH,
      // and this page's content starts that much further down the screen
      const desiredY = firstH + (pageIndex - 1) * midH + pageIndex * PAGE_GAP + jmy - g.my + extraTotal
      const needed = Math.max(0, desiredY - naturalTop - cumMargin)
      cumMargin += needed
      pageStartY = naturalTop
      return needed
    }

    const breakBefore = (idx) => {
      const needed = openPageAt(children[idx].offsetTop)
      // padding-top, not margin-top: adjacent vertical margins collapse in
      // CSS (two touching margins become one, sized to the larger — not the
      // sum), so a margin-top here would silently lose up to the previous
      // sibling's own margin-bottom, landing content short of its page-2+
      // target by that amount. Padding never collapses with anything.
      rules.push(`.ProseMirror>*:nth-child(${idx + 1}){padding-top:${needed}px}`)
      pageStartIdx = idx
    }

    // break INSIDE a block, before the line whose natural top is `naturalTop`
    const breakBeforeLine = (pos, naturalTop, blockIdx) => {
      spacers.push({ pos, height: openPageAt(naturalTop) })
      pageStartIdx = blockIdx
    }

    for (let i = 0; i < children.length; i++) {
      if (isPageBreakEl(children[i])) {
        // a manual break: the NEXT block starts a fresh page, regardless of
        // how much room is left on the current one
        if (i + 1 < children.length) breakBefore(i + 1)
        continue
      }
      /* Where does this block belong?

         Until Session 27 the only question asked was "does the block START
         below the capacity line?", which says nothing about where it ENDS: a
         paragraph starting just above the line and running past it stayed put
         and rendered off the bottom of its sheet, through the desk gap, and
         over the next page's top edge. Session 27 added the second question
         and moved such a block down entire — correct, but it made pages end
         where the text allowed rather than where the paper did (~11% more
         pages, measured over 3000 synthetic documents), and a paragraph
         taller than a page had nowhere to go at all.

         Session 31 asks the real question instead: where does this block's
         own TEXT cross the line? A block of pure text is now cut between its
         own lines, which is what Word does and what makes a page actually
         fill. Blocks that cannot be cut — anything holding an image or a
         table — keep the Session 27 move-it-whole rule, and a page break
         still never falls inside one of those. */
      const el = children[i]
      const top = el.offsetTop
      let capacity = pageStartY + g.contentH

      // 1. starts past the page — it belongs to the next one
      if (top >= capacity) { breakBefore(i); capacity = pageStartY + g.contentH }
      // 2. fits where it is — nothing to decide
      if (top + el.offsetHeight <= capacity + OVERHANG_SLOP) continue

      if (!isSplittable(el)) {
        // 3a. can't be cut: move it down whole, unless it is taller than a
        //     page can ever be (nothing holds it, and pushing it along would
        //     only repeat the overhang one sheet later) or it opens this page
        //     (there is nowhere left to push it to)
        if (i > pageStartIdx && el.offsetHeight <= g.contentH) breakBefore(i)
        continue
      }

      /* 3b. cut it between its own lines. The lines are measured ONCE, from
         the natural layout, and stay valid for every break made here: a
         spacer inserted at a line boundary shifts the lines below it but
         never re-wraps them, so their natural tops keep describing the block
         (measured — that property is what this whole mechanism rests on).
         The loop runs over every line, so one paragraph can span as many
         pages as it needs. */
      const lines = lineBoxes(el)
      if (!lines.length) continue
      // if even its first line won't fit here, the whole block moves first
      if (top + lines[0].bottom > capacity + OVERHANG_SLOP && i > pageStartIdx) {
        breakBefore(i)
        capacity = pageStartY + g.contentH
      }

      // first line of `lines` that is on the page currently being filled — the
      // page's opening line can never be pushed anywhere, so a break is only
      // ever looked for after it
      let pageFirstLine = 0
      const firstOverflow = (from) => {
        for (let j = from; j < lines.length; j++) {
          if (top + lines[j].bottom > capacity + OVERHANG_SLOP) return j
        }
        return -1
      }
      // the run of lines belonging to the same paragraph as line j
      const paraStart = (j) => { let k = j; while (k > 0 && lines[k - 1].owner === lines[j].owner) k--; return k }
      const paraEnd = (j) => { let k = j; while (k < lines.length - 1 && lines[k + 1].owner === lines[j].owner) k++; return k }

      for (;;) {
        let j = firstOverflow(pageFirstLine + 1)
        if (j < 0) break

        /* Word's widow/orphan control, which is on by default in Word and is
           most of what makes a broken paragraph look deliberate rather than
           chopped: never leave a single line of a paragraph alone on either
           side of a break. `j` is the first line that moves to the next page,
           so the lines staying behind are [max(pageFirstLine, paraStart) .. j-1]
           and the lines going over are [j .. paraEnd]. */
        const pStart = paraStart(j)
        const pEnd = paraEnd(j)
        const floor = Math.max(pageFirstLine, pStart)
        // widow: only the paragraph's LAST line would go over — take two
        if (j === pEnd && j - 1 > floor) j -= 1
        // orphan: only ONE line of the paragraph would stay behind — send it
        // over with the rest, which for a paragraph that starts the block
        // means moving the whole block down
        if (j - floor === 1) {
          if (pStart === 0 && pageFirstLine === 0 && i > pageStartIdx) {
            // `breakBefore` sets pageStartIdx = i, so this can run at most
            // once per block — no way to loop here
            breakBefore(i)
            capacity = pageStartY + g.contentH
            continue
          }
          // a later paragraph inside the same block can simply break at its
          // own first line instead
          if (pStart > pageFirstLine) j = pStart
          // otherwise there is no better break available — take the orphan
        }

        const pos = posAtLineStart(lines[j])
        if (pos === null) break // can't locate it — leave the rest whole
        breakBeforeLine(pos, top + lines[j].top, i)
        capacity = pageStartY + g.contentH
        // j > pageFirstLine always (every branch above preserves it), so this
        // strictly advances and the loop is guaranteed to terminate
        pageFirstLine = j
      }
    }

    // the final page closes at the last block's bottom rather than at a break,
    // so it needs the same surplus treatment (a document ENDING in an over-tall
    // block would otherwise run off the last sheet)
    const lastEl = children[children.length - 1]
    if (lastEl) pageExtras[pageIndex] = Math.max(0, lastEl.offsetTop + lastEl.offsetHeight - pageStartY - g.contentH)

    // scoped to screen only: these margins are a visual illusion for the
    // editor surface, not something print's own @page pagination should see.
    // Writing this also drops the `.page-spacer{display:none}` measuring rule.
    pageGapStyleEl.textContent = rules.length ? `@media screen{${rules.join('')}}` : ''
    applySpacers(spacers)
    if (window.scrollY !== scrollBefore) window.scrollTo({ top: scrollBefore, behavior: 'instant' })

    const pages = pageIndex + 1
    // variable sheet heights: full margins on the document's outer edges,
    // compact ones at every junction (a lone page is exactly nominal pageH),
    // plus any surplus from a block too tall for the page to hold
    const rects = []
    let rectTop = 0
    for (let i = 0; i < pages; i++) {
      const h = (i === 0 ? g.my : jmy) + g.contentH + (pageExtras[i] || 0) + (i === pages - 1 ? g.my : jmy)
      rects.push({ top: rectTop, height: h, n: i })
      rectTop += h + PAGE_GAP
    }
    pageRects = rects
    // grew onto a new page (typing past the bottom, not a doc/view load) —
    // follow the cursor down so the writer lands at the top of the new sheet
    if (lastMeasuredPages !== null && pages > lastMeasuredPages) followCaretToNewPage()
    lastMeasuredPages = pages
    // the injected padding just moved blocks; the caret must move with them
    updateCaret()
  }

  // ---- focus dimming: light only the block the cursor is in ----
  // ProseMirror owns its DOM and strips foreign classes added to its nodes, so
  // we dim every top-level block via CSS and un-dim exactly one with an
  // injected :nth-child rule.
  let litStyleEl
  function clearLit() { if (litStyleEl) litStyleEl.textContent = '' }
  function litParagraph() {
    if (document.body.getAttribute('data-focus') !== 'on') return
    const root = document.querySelector('.ProseMirror')
    const sel = window.getSelection()
    if (!root || !sel || !sel.rangeCount) return
    let n = sel.anchorNode
    if (!n || !root.contains(n)) return
    while (n && n.parentNode !== root) n = n.parentNode
    if (!n || n.nodeType !== 1) return
    const idx = [...root.children].indexOf(n) + 1 // :nth-child is 1-based
    if (idx < 1) return
    if (!litStyleEl) litStyleEl = claimStyleEl('focus-dim')
    litStyleEl.textContent = `body[data-focus="on"] .ProseMirror > *:nth-child(${idx}){opacity:1}`
  }

  // ---- selection bubble ----
  function refreshActive() {
    if (!editor) return
    active = {
      bold: editor.isActive('bold'),
      italic: editor.isActive('italic'),
      underline: editor.isActive('underline'),
      strike: editor.isActive('strike'),
      block: editor.isActive('heading', { level: 1 }) ? 'h1'
           : editor.isActive('heading', { level: 2 }) ? 'h2'
           : editor.isActive('blockquote') ? 'quote'
           : editor.isActive('bulletList') ? 'ul'
           : 'p',
    }
  }
  function updateBubble() {
    // hideBubble (not a bare reassignment): this runs on EVERY scroll event,
    // and re-assigning $state each tick makes Svelte re-render for nothing
    const hideBubble = () => { if (bubble.show) bubble = { ...bubble, show: false } }
    const sel = window.getSelection()
    if (!editor || !sel || sel.isCollapsed || !sel.rangeCount) { hideBubble(); return }
    const range = sel.getRangeAt(0)
    const root = host.querySelector('.ProseMirror')
    if (!root || !root.contains(range.commonAncestorContainer)) { hideBubble(); return }
    const r = range.getBoundingClientRect()
    if (!r || (r.width < 1 && r.height < 1)) { hideBubble(); return }
    const x = Math.min(Math.max(r.left + r.width / 2, 140), window.innerWidth - 140)
    bubble = { show: true, x, y: Math.max(r.top, 68) }
    refreshActive()
  }

  // ---- the caret: a custom gliding cursor (see .caret in app.css) ----
  // Positioned via ProseMirror's coordsAtPos (robust in empty paragraphs,
  // where a collapsed DOM range has no rect). Styles are written directly to
  // the element — this runs on every keystroke/selection tick, and routing
  // x/y through $state would make Svelte re-render for nothing.
  let caretEl
  let caretVisible = $state(false) // also drives .custom-caret (hides the native caret)
  let composing = false
  let caretLastX = null, caretLastY = null
  function updateCaret() {
    if (!caretEl || !host) return
    // activeElement (not editor.isFocused): the caret should hide exactly
    // when another control (Commander, Find, the Bar) takes the keyboard —
    // and isFocused also goes false whenever the OS window loses focus,
    // which reads as the caret losing your place
    const pmRoot = host.querySelector('.ProseMirror')
    const engaged = pmRoot && (pmRoot === document.activeElement || pmRoot.contains(document.activeElement))
    if (!editor || composing || !engaged || !editor.state.selection.empty) {
      caretVisible = false
      return
    }
    let c
    try { c = editor.view.coordsAtPos(editor.state.selection.head) } catch { caretVisible = false; return }
    // viewport coords are zoom-scaled; the caret element lives in the zoomed
    // subtree's own layout space, so divide the difference back out
    const zoom = zoomPct / 100
    const hostRect = host.getBoundingClientRect()
    const x = (c.left - hostRect.left) / zoom
    const y = (c.top - hostRect.top) / zoom
    const h = (c.bottom - c.top) / zoom
    const appearing = !caretVisible
    if (appearing) caretEl.style.transition = 'none' // materialize in place, don't glide in from the old spot
    caretEl.style.transform = `translate(${x}px, ${y}px)`
    caretEl.style.height = `${h}px`
    if (appearing) { void caretEl.offsetWidth; caretEl.style.transition = '' }
    caretVisible = true
    if (x !== caretLastX || y !== caretLastY) {
      // restart the breathe cycle so a moving caret is always solid
      caretEl.classList.remove('blinking'); void caretEl.offsetWidth; caretEl.classList.add('blinking')
      caretLastX = x; caretLastY = y
    }
  }

  // ---- the Bar: summonable formatting strip (Ctrl+/, or via the Commander) ----
  // The Q10 hybrid made real: quiet by default, chrome when asked for.
  let barOpen = $state(localStorage.getItem('write:bar') === '1')
  let barState = $state({ font: '', size: '', color: '', highlight: '', align: 'left', lineHeight: '', indent: 0, firstLine: 0 })
  // Is there any Bar-owned formatting on the current selection to reset? Drives
  // the Reset button's live/inert state (see .bar-reset). "left" and the empty
  // strings are the room defaults, so they don't count as something to clear.
  // Deliberately scoped to what Reset actually touches — bold/italic/underline
  // (the selection bubble) and heading level (a block type) are NOT cleared by
  // it, so they must not light it up either.
  let barDirty = $derived(
    !!barState.font || !!barState.size || !!barState.color || !!barState.highlight ||
    (barState.align && barState.align !== 'left') || !!barState.lineHeight ||
    barState.indent > 0 || barState.firstLine > 0
  )
  // scroll-duck: a pinned bar gets out of the way once the page actually
  // scrolls (reading, not formatting). It returns via the top-edge hover
  // peek, Ctrl+/, or scrolling back to the very top of the document.
  let barScrollHidden = $state(false)
  let barShownAtY = 0 // scrollY when the bar last became visible — hide on real travel, not caret nudges
  /* Duck the chrome — the Bar and the wordmark — the moment the writer engages
     with the page at all. Brett: "it can start to go away the moment someone
     points and clicks on the page, starts typing, starts scrolling down...
     other than at startup we really want it hidden most of the time."
     So this is called from three places: the first keystroke (markTyping), a
     pointer landing in the editor, and any real scroll. It comes back on the
     hover zones, Ctrl+/, or scrolling home. */
  function duckChrome() {
    if (barScrollHidden) return
    barScrollHidden = true
    barShownAtY = window.scrollY
  }
  // 8px, not 48: a deliberate scroll should hide the chrome immediately rather
  // than after most of a wheel notch. The threshold exists only so a caret
  // nudge or a follow-scroll doesn't count as "the reader is moving".
  const DUCK_AFTER_PX = 8
  function onDocScroll() {
    const y = window.scrollY
    if (y <= 4) {
      if (barScrollHidden) { barScrollHidden = false; refreshBar() }
      barShownAtY = y
      return
    }
    if (!barScrollHidden && Math.abs(y - barShownAtY) > DUCK_AFTER_PX) barScrollHidden = true
    if (barScrollHidden) barShownAtY = y
  }

  /* The typeface library — 27 families. Every one ships with the app; no
     network call has ever been made for type and none ever will be. Grouped by
     voice rather than listed flat, because 21 names in one column is a wall.
     Each is a deliberate pick, not a dump of what Fontsource happens to have:
       Serif  — Literata (screen-first book face) · Source Serif (Adobe's
                workhorse) · EB Garamond (the classic old-style, for anything
                that wants to feel printed) · Crimson Pro (old-style, lighter
                colour on the page) · Lora (contemporary, brushed contrast) ·
                Newsreader (editorial warmth) · Petrona (Session 34 — soft,
                low-contrast curves, a big x-height; Dawn's room default)
       Slab   — Roboto Slab (sturdy, neutral) · Bitter (contrasty slab that
                still sets as body text)
       Sans   — Geist · Inter (the neutral workhorse) · Work Sans · Libre
                Franklin (a Franklin Gothic descendant) · Archivo (grotesque,
                slightly condensed) · Manrope (geometric, soft) · IBM Plex Sans
                (humanist, slightly technical) · Atkinson Hyperlegible (drawn
                by the Braille Institute for maximum letter distinction —
                genuinely the kindest face here for tired eyes) · Figtree
                (soft geometric, the app's own chrome face) · Source Sans 3
                (Adobe's body-copy workhorse) · Nunito Sans (rounded terminals,
                a register the library didn't have) · Poppins (the one true
                geometric here — circular bowls, single-story a) · Space
                Grotesk (monospace-derived proportions, no italic exists)
       Display— Playfair Display (high-contrast) · Fraunces (soft, wonky
                old-style). Title faces, not body faces.
       Type-  — iA Writer Quattro (the app's own voice) · JetBrains Mono
       writer   (warmer, rounder mono) · Geist Mono (tight and neutral) */
  const FONT_GROUPS = [
    { name: 'Room Default', items: [{ label: 'Room default', value: '' }] },
    { name: 'Serif', items: [
      { label: 'Literata', value: "'Literata Variable', serif" },
      { label: 'Source Serif', value: "'Source Serif 4 Variable', serif" },
      { label: 'EB Garamond', value: "'EB Garamond Variable', Garamond, serif" },
      { label: 'Crimson Pro', value: "'Crimson Pro Variable', Garamond, serif" },
      { label: 'Lora', value: "'Lora Variable', Georgia, serif" },
      { label: 'Newsreader', value: "'Newsreader Variable', serif" },
      { label: 'Petrona', value: "'Petrona Variable', Georgia, serif" },
    ] },
    { name: 'Slab', items: [
      { label: 'Roboto Slab', value: "'Roboto Slab Variable', Rockwell, serif" },
      { label: 'Bitter', value: "'Bitter Variable', Rockwell, serif" },
    ] },
    { name: 'Sans', items: [
      { label: 'Geist', value: "'Geist Variable', sans-serif" },
      { label: 'Inter', value: "'Inter Variable', -apple-system, sans-serif" },
      { label: 'Work Sans', value: "'Work Sans Variable', -apple-system, sans-serif" },
      { label: 'Libre Franklin', value: "'Libre Franklin Variable', -apple-system, sans-serif" },
      { label: 'Archivo', value: "'Archivo Variable', -apple-system, sans-serif" },
      { label: 'Manrope', value: "'Manrope Variable', -apple-system, sans-serif" },
      { label: 'Plex Sans', value: "'IBM Plex Sans', sans-serif" },
      { label: 'Atkinson Hyperlegible', value: "'Atkinson Hyperlegible', -apple-system, sans-serif" },
      { label: 'Figtree', value: "'Figtree Variable', -apple-system, sans-serif" },
      { label: 'Source Sans 3', value: "'Source Sans 3 Variable', -apple-system, sans-serif" },
      { label: 'Nunito Sans', value: "'Nunito Sans Variable', -apple-system, sans-serif" },
      { label: 'Poppins', value: "'Poppins', -apple-system, sans-serif" },
      { label: 'Space Grotesk', value: "'Space Grotesk Variable', -apple-system, sans-serif" },
    ] },
    { name: 'Display', items: [
      { label: 'Playfair Display', value: "'Playfair Display Variable', Georgia, serif" },
      { label: 'Fraunces', value: "'Fraunces Variable', Georgia, serif" },
    ] },
    { name: 'Typewriter', items: [
      { label: 'iA Writer Quattro', value: "'iA Writer Quattro S', monospace" },
      { label: 'JetBrains Mono', value: "'JetBrains Mono Variable', ui-monospace, monospace" },
      { label: 'Geist Mono', value: "'Geist Mono Variable', monospace" },
    ] },
  ]
  const BAR_FONTS = FONT_GROUPS.flatMap((g) => g.items) // flat, for index math
  const BAR_SIZES = ['10pt', '11pt', '12pt', '14pt', '16pt', '18pt', '24pt', '32pt']
  /* Text colors are picked to survive BOTH surfaces. The old set was Tailwind's
     700s — chosen for white paper, and close to invisible on a Slate or Noir
     page (dark red ink on a dark sheet). These are mid-tones: every one clears
     ~4:1 contrast against white AND against Noir's near-black sheet, so the
     same document is legible in every room and still prints as a real color.
     (Unlike a highlight, ink can't be dimmed per-room without lying about what
     the .docx contains — so the palette itself has to be the honest one.) */
  const BAR_COLORS = ['#D64545', '#BE7016', '#2E8B57', '#3B7DE0', '#8E5FD3', '#7C818B']
  /* Highlights stay true pastels: a highlighter is a paper instrument and the
     .docx must carry real marker colors — these five are the canonical,
     stored values, perfected for a white page. Every room repaints the BAND
     on screen from its own palette instead (`--hl-*` in rooms.css, applied
     via `mark[data-color]` in app.css); the toolbar swatches below read the
     same variables, so the picker always matches what lands on the page. */
  const BAR_HIGHLIGHTS = ['#FEF08A', '#BBF7D0', '#BFDBFE', '#F9A8D4', '#FED7AA']
  const BAR_LINE_HEIGHTS = [['1', '1.0'], ['1.15', '1.15'], ['1.5', '1.5'], ['2', '2.0']]

  function toggleBar(force) {
    // a pinned bar that scroll-ducked away: the first Ctrl+/ summons it back
    // rather than silently unpinning a bar that isn't even visible
    if (force === undefined && barOpen && barScrollHidden) {
      barScrollHidden = false
      barShownAtY = window.scrollY
      refreshBar()
      return
    }
    barScrollHidden = false
    barShownAtY = window.scrollY
    barOpen = force ?? !barOpen
    localStorage.setItem('write:bar', barOpen ? '1' : '0')
    if (barOpen) refreshBar()
  }
  function refreshBar() {
    // no barOpen guard: the bar can now appear via hover-peek even when
    // unpinned, so its state must always be current, not just while pinned
    if (!editor) return
    const ts = editor.getAttributes('textStyle')
    const para = editor.isActive('heading') ? editor.getAttributes('heading') : editor.getAttributes('paragraph')
    barState = {
      font: ts.fontFamily || '',
      size: ts.fontSize || '',
      color: ts.color || '',
      highlight: editor.getAttributes('highlight')?.color || '',
      align: para.textAlign || 'left',
      lineHeight: para.lineHeight ? String(para.lineHeight) : '',
      indent: para.indent || 0,
      firstLine: para.firstLine || 0,
    }
  }
  const barCmd = {
    font: (v) => (v ? editor.chain().focus().setFontFamily(v).run() : editor.chain().focus().unsetFontFamily().run()),
    size: (v) => (v ? editor.chain().focus().setFontSize(v).run() : editor.chain().focus().unsetFontSize().run()),
    color: (v) => (v ? editor.chain().focus().setColor(v).run() : editor.chain().focus().unsetColor().run()),
    highlight: (v) => (v ? editor.chain().focus().setHighlight({ color: v }).run() : editor.chain().focus().unsetHighlight().run()),
    align: (v) => editor.chain().focus().setTextAlign(v).run(),
    lineHeight: (v) => (v ? editor.chain().focus().setLineHeight(v).run() : editor.chain().focus().unsetLineHeight().run()),
    indent: () => editor.chain().focus().indent().run(),
    outdent: () => editor.chain().focus().outdent().run(),
    clear: () => {
      editor.chain().focus()
        .unsetColor().unsetFontFamily().unsetFontSize().unsetHighlight()
        .setTextAlign('left').unsetLineHeight().run()
      editor.commands.updateAttributes('paragraph', { indent: 0, firstLine: 0 })
      editor.commands.updateAttributes('heading', { indent: 0, firstLine: 0 })
    },
  }
  function barRun(name, v) {
    barCmd[name](v)
    requestAnimationFrame(() => { refreshBar(); queueMeasure() })
    if (name === 'font' || name === 'clear') measureWhenFontReady(v)
  }

  /* ---- the typeface menu ----
     A real listbox instead of a native <select>, for two reasons a <select>
     can't do on Windows: it renders every name IN its own face (the only
     honest way to choose type), and arrowing through it previews each font
     live in the document underneath. Word does the same thing and it's the
     one piece of its formatting UI worth stealing outright.

     Contract: ↑/↓ (or hover) previews · Enter or click keeps it · Escape or
     clicking away puts back what you started with. Preview transactions carry
     `addToHistory: false`, so cycling past ten fonts leaves ten *nothings* in
     the undo stack and only the choice you keep is a real, undoable edit.
     Note the previews deliberately do NOT call .focus() — the menu owns the
     keyboard while it's open, and ProseMirror applies a mark command to its
     stored selection whether or not its DOM node is focused. */
  let fontMenuOpen = $state(false)
  let fontIdx = $state(0)
  // $state because the menu is inside an {#if}: the binding is written on
  // every open and cleared on close, and Svelte 5 flags a plain `let` for that
  let fontMenuEl = $state(null)
  let fontOriginal = ''
  /* The room's own body font, by name — reads the same --body-font custom
     property applyRoom() already reads (right after setting data-room, so
     it's never stale), rather than a second hardcoded room->label map that
     could drift from rooms.css. `room` is referenced only to create the
     reactive dependency; the actual value comes from the DOM.
     Matches on the PRIMARY family only, not the whole stack — every room's
     --body-font carries its own fallback chain (Dawn falls back through
     Georgia, Cobalt through IBM Plex Sans, etc.) that doesn't byte-match the
     generic single-fallback strings in BAR_FONTS, even though both name the
     same family. */
  const primaryFamily = (css) => String(css).split(',')[0].replace(/["']/g, '').trim()
  const roomFontLabel = $derived.by(() => {
    room
    const family = primaryFamily(getComputedStyle(document.body).getPropertyValue('--body-font'))
    return BAR_FONTS.find((f) => primaryFamily(f.value) === family)?.label ?? 'Default'
  })
  const fontLabel = (v) => (v ? BAR_FONTS.find((f) => f.value === v)?.label ?? 'Mixed' : roomFontLabel)

  // tick(), not requestAnimationFrame: focusing the menu and keeping the
  // selected row in view must happen as soon as Svelte has written the DOM,
  // and rAF is not a promise that it ever will — a backgrounded or occluded
  // window throttles it to nothing, which would leave the menu open but
  // unfocused, swallowing every arrow key
  function scrollFontRow() {
    tick().then(() => fontMenuEl?.querySelector(`[data-fi="${fontIdx}"]`)?.scrollIntoView({ block: 'nearest' }))
  }
  function setFontQuiet(v) {
    if (!editor) return
    const c = editor.chain().setMeta('addToHistory', false)
    ;(v ? c.setFontFamily(v) : c.unsetFontFamily()).run()
    queueMeasure()
  }
  function previewFont(i) {
    fontIdx = i
    setFontQuiet(BAR_FONTS[i].value)
    scrollFontRow()
  }
  function openFontMenu() {
    if (fontMenuOpen) { closeFontMenu(false); return }
    fontOriginal = barState.font
    const i = BAR_FONTS.findIndex((f) => f.value === fontOriginal)
    fontIdx = i < 0 ? 0 : i
    fontMenuOpen = true
    tick().then(() => { fontMenuEl?.focus(); scrollFontRow() })
  }
  function closeFontMenu(commit) {
    if (!fontMenuOpen || !editor) return
    fontMenuOpen = false
    const v = commit ? BAR_FONTS[fontIdx].value : fontOriginal
    // only a kept, actually-different choice earns a place in the undo stack;
    // a cancelled preview must leave the history exactly as it found it
    const real = commit && v !== fontOriginal
    let c = editor.chain().focus()
    if (!real) c = c.setMeta('addToHistory', false)
    ;(v ? c.setFontFamily(v) : c.unsetFontFamily()).run()
    refreshBar()
    queueMeasure()
    if (real) measureWhenFontReady(v)
  }
  function onFontKey(e) {
    if (!fontMenuOpen) {
      if (e.key === 'ArrowDown' || e.key === 'Enter' || e.key === ' ') { e.preventDefault(); openFontMenu() }
      return
    }
    const n = BAR_FONTS.length
    if (e.key === 'ArrowDown') { e.preventDefault(); previewFont((fontIdx + 1) % n) }
    else if (e.key === 'ArrowUp') { e.preventDefault(); previewFont((fontIdx - 1 + n) % n) }
    else if (e.key === 'Home') { e.preventDefault(); previewFont(0) }
    else if (e.key === 'End') { e.preventDefault(); previewFont(n - 1) }
    else if (e.key === 'Enter' || e.key === 'Tab') { e.preventDefault(); closeFontMenu(true) }
    // stopPropagation: Escape here means "cancel the preview", not the
    // window-level Escape that closes the Commander / leaves focus mode
    else if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); closeFontMenu(false) }
  }

  // ---- commands ----
  // ---- Wave 3: insert a manual page break ----
  function insertPageBreak() {
    editor.chain().focus().insertPageBreak().run()
    commanderOpen = false
    requestAnimationFrame(queueMeasure)
  }

  // ---- Wave 5: tables ----
  // Insert lives in the Commander (like Page Break); everything else lives
  // in the table bar, a quiet strip that appears only while the caret is
  // inside a table — the same summon-on-need philosophy as the Bar.
  let inTable = $state(false)
  function refreshTableState() {
    inTable = editor?.isActive('table') ?? false
  }
  function insertTable() {
    editor.chain().focus().insertTable({ rows: 3, cols: 3, withHeaderRow: true }).run()
    commanderOpen = false
    requestAnimationFrame(() => { refreshTableState(); queueMeasure() })
  }
  const tableCmd = {
    rowAbove: () => editor.chain().focus().addRowBefore().run(),
    rowBelow: () => editor.chain().focus().addRowAfter().run(),
    delRow:   () => editor.chain().focus().deleteRow().run(),
    colLeft:  () => editor.chain().focus().addColumnBefore().run(),
    colRight: () => editor.chain().focus().addColumnAfter().run(),
    delCol:   () => editor.chain().focus().deleteColumn().run(),
    merge:    () => editor.chain().focus().mergeCells().run(),
    split:    () => editor.chain().focus().splitCell().run(),
    header:   () => editor.chain().focus().toggleHeaderRow().run(),
    delTable: () => editor.chain().focus().deleteTable().run(),
  }
  function tableRun(name) {
    tableCmd[name]()
    requestAnimationFrame(() => { refreshTableState(); queueMeasure() })
  }

  // ---- Wave 6: table of contents ----
  function insertToc() {
    editor.chain().focus().insertTableOfContents().run()
    commanderOpen = false
    requestAnimationFrame(queueMeasure)
  }

  // ---- Wave 6: templates ----
  // "＋ New" stays instant-blank (the fast path); templates are an explicit
  // alternate start, same discard-guard rule as New/Open/drop.
  function useTemplate(t) { guardThen(() => doUseTemplate(t)) }
  function doUseTemplate(t) {
    editor.commands.setContent(t.html)
    docName = 'Untitled'; saved = true; touched = false; recount()
    commanderOpen = false
    editor.commands.focus()
    queueMeasure()
    /* And again once the document's own typefaces have arrived. A document can
       name families that have never been painted before — the Specimen alone
       uses twenty-six — and @font-face fetches each only at first use. So the
       next-frame measurement above runs against FALLBACK metrics, the real
       faces land a moment later, every one of those blocks changes height, and
       the page breaks (and the desk-gap masks drawn from them) are left
       describing a layout that no longer exists: text ends up clipped at the
       top of a sheet. Brett's screenshot. Same trap as changing a font from
       the Bar, which measureWhenFontReady already covered — document LOADING
       simply never went through it. */
    measureWhenFontReady()
  }

  // ---- Wave 3: Find & Replace ----
  // A quiet, summonable find bar (Ctrl+F). Matches are found by a plain
  // text scan over the document (case-insensitive) and shown as
  // decorations via the findReplace ProseMirror plugin (editor.js) — never
  // mutating the document just to highlight something.
  let findOpen = $state(false)
  let findQuery = $state('')
  let replaceQuery = $state('')
  let findMatches = [] // [{from,to}], not reactive — only the count needs to be
  let findActive = -1
  let findCount = $state(0)
  let findActiveDisplay = $state(0)

  function computeMatches(query) {
    const matches = []
    const q = query.toLowerCase()
    if (!q) return matches
    editor.state.doc.descendants((node, pos) => {
      if (!node.isText) return
      const text = node.text.toLowerCase()
      let idx = 0
      while (true) {
        const found = text.indexOf(q, idx)
        if (found === -1) break
        matches.push({ from: pos + found, to: pos + found + q.length })
        idx = found + q.length
      }
    })
    return matches
  }
  function paintFindDecorations() {
    const decos = findMatches.map((m, i) =>
      Decoration.inline(m.from, m.to, { class: i === findActive ? 'find-match find-active' : 'find-match' })
    )
    editor.view.dispatch(editor.state.tr.setMeta(findReplaceKey, DecorationSet.create(editor.state.doc, decos)))
  }
  function scrollToActiveMatch() {
    if (findActive < 0) return
    const m = findMatches[findActive]
    const dom = editor.view.domAtPos(m.from)
    const el = dom.node.nodeType === 1 ? dom.node : dom.node.parentElement
    el?.scrollIntoView({ block: 'center', behavior: 'smooth' })
  }
  function runFind() {
    findMatches = computeMatches(findQuery)
    findActive = findMatches.length ? 0 : -1
    findCount = findMatches.length
    findActiveDisplay = findActive + 1
    paintFindDecorations()
    scrollToActiveMatch()
  }
  function findStep(dir) {
    if (!findMatches.length) return
    findActive = (findActive + dir + findMatches.length) % findMatches.length
    findActiveDisplay = findActive + 1
    paintFindDecorations()
    scrollToActiveMatch()
  }
  function replaceCurrent() {
    if (findActive < 0) return
    const m = findMatches[findActive]
    editor.chain().focus().insertContentAt({ from: m.from, to: m.to }, replaceQuery).run()
    runFind()
  }
  function replaceAll() {
    if (!findQuery) return
    const matches = computeMatches(findQuery)
    if (!matches.length) return
    let tr = editor.state.tr
    for (let i = matches.length - 1; i >= 0; i--) tr = tr.insertText(replaceQuery, matches[i].from, matches[i].to)
    editor.view.dispatch(tr)
    runFind()
  }
  function openFind() {
    findOpen = true
    requestAnimationFrame(() => document.querySelector('.find-input')?.focus())
    if (findQuery) runFind()
  }
  function closeFind() {
    findOpen = false
    findMatches = []; findActive = -1; findCount = 0
    if (editor) editor.view.dispatch(editor.state.tr.setMeta(findReplaceKey, DecorationSet.empty))
    editor?.commands.focus()
  }
  function onFindKey(e) {
    if (e.key === 'Enter') { e.preventDefault(); findStep(e.shiftKey ? -1 : 1) }
  }

  const cmd = {
    bold:   () => editor.chain().focus().toggleBold().run(),
    italic: () => editor.chain().focus().toggleItalic().run(),
    underline: () => editor.chain().focus().toggleUnderline().run(),
    strike: () => editor.chain().focus().toggleStrike().run(),
    h1:    () => editor.chain().focus().toggleHeading({ level: 1 }).run(),
    h2:    () => editor.chain().focus().toggleHeading({ level: 2 }).run(),
    p:     () => editor.chain().focus().setParagraph().run(),
    quote: () => editor.chain().focus().toggleBlockquote().run(),
    ul:    () => editor.chain().focus().toggleBulletList().run(),
  }
  function run(name, e) {
    e?.preventDefault()   // keep selection alive
    cmd[name]()
    requestAnimationFrame(() => { updateBubble(); litParagraph() })
  }

  // ---- word count ----
  function recount() {
    if (!editor) return
    const t = editor.getText().trim()
    words = t ? t.split(/\s+/).length : 0
    readMin = Math.max(1, Math.round(words / 200))
  }

  function markTyping() {
    typing = true
    duckChrome() // writing is not formatting: get the chrome out of the way
    document.body.classList.add('typing')
    clearTimeout(typingTimer)
    typingTimer = setTimeout(() => { typing = false; document.body.classList.remove('typing') }, 2200)
  }

  // ---- autosave (debounced): the invisible save promised in the vision ----
  function scheduleAutosave() {
    clearTimeout(autosaveTimer)
    autosaveTimer = setTimeout(persist, 900)
  }
  function persist() {
    if (!editor) return
    const doc = { name: docName, html: editor.getHTML(), savedAt: Date.now() }
    store.saveDoc(doc)
    recents = store.pushRecent(doc)
    saved = true
  }

  // ---- discard guard ----
  // Replacing a page that has edits never saved to a file asks first — a
  // quiet surface, not a system dialog. Autosave keeps the text in Recents,
  // but a same-named autosave can overwrite that slot, so the guard is real.
  function guardThen(action) {
    if (touched && words > 0) confirmState = { action }
    else action()
  }
  async function confirmSaveFirst() {
    if (await saveDoc()) {
      const { action } = confirmState
      confirmState = null
      action()
    } // save cancelled or failed → stay on the guard
  }
  function confirmDiscard() {
    const { action } = confirmState
    confirmState = null
    action()
  }

  // surface .docx conversion notes quietly, never modally
  /* An image that lived on someone else's server can't come in — fetching it
     would announce the reader's IP and the moment they opened the document.
     The editor's schema drops it (OfflineImage); this says so out loud, so
     content never disappears without explanation. */
  function noteRemoteImages(count) {
    if (!count) return
    showToast(`${count} online image${count > 1 ? 's' : ''} left out — write stays offline`)
  }

  function noteImportMessages(messages) {
    if (!messages?.length) return
    console.warn('[write] .docx import notes:', messages)
    showToast(`Opened · ${messages.length} conversion note${messages.length > 1 ? 's' : ''}`)
  }

  // ---- explicit file actions ----
  async function saveDoc() {
    persist()
    try {
      const res = await fileBridge.save(docName, { html: editor.getHTML(), json: editor.getJSON(), pageSettings: { pageSize, orientation, margin, header, footer, pageNumbers } })
      if (res?.name) { docName = res.name; touched = false; persist(); showToast('Saved'); return true }
    } catch (err) {
      console.error('[write] save failed:', err)
      showToast('Save failed')
    }
    return false
  }
  function openDoc() { guardThen(doOpenDoc) }
  async function doOpenDoc() {
    try {
      const res = await fileBridge.open()
      if (res?.html) {
        loadInto(res.html, res.name || 'Untitled', res.pageSettings)
        noteImportMessages(res.messages)
      }
    } catch (err) {
      console.error('[write] open failed:', err)
      showToast('Open failed')
    }
  }
  function newDoc() { guardThen(doNewDoc) }
  function doNewDoc() {
    editor.commands.clearContent()
    editor.commands.focus()
    docName = 'Untitled'; saved = true; touched = false; recount()
    commanderOpen = false
  }
  function loadInto(html, name, pageSettings) {
    const remoteImages = countRemoteImages(html)
    editor.commands.setContent(html)
    docName = name; saved = true; touched = false; recount()
    commanderOpen = false
    editor.commands.focus()
    // a document's own page settings (read back from .docx sectPr) take over
    // the current view — the app-wide localStorage prefs are for new/blank
    // documents, not a signal to override what's actually in the file
    if (pageSettings?.pageSize) applyPageSize(pageSettings.pageSize)
    if (pageSettings?.orientation) applyOrientation(pageSettings.orientation)
    if (pageSettings?.margin) applyMargin(pageSettings.margin)
    if (pageSettings) applyHeaderFooterSettings(pageSettings)
    queueMeasure()
    // an opened .docx can name any typeface it likes, loaded only on first
    // paint — so re-measure once they've landed (see doUseTemplate)
    measureWhenFontReady()
    noteRemoteImages(remoteImages)
  }
  function openRecent(entry) {
    guardThen(() => loadInto(entry.html, entry.name))
  }

  // ---- drag-drop: a .docx (or image) dropped anywhere on the window ----
  async function openDroppedDoc(read) {
    try {
      const res = await read()
      if (res?.html) {
        loadInto(res.html, res.name || 'Untitled', res.pageSettings)
        noteImportMessages(res.messages)
      }
    } catch (err) {
      console.error('[write] drop open failed:', err)
      showToast('Open failed')
    }
  }
  async function handleDroppedPaths(paths, position) {
    const docPath = paths.find((p) => DOC_EXT_RE.test(p))
    if (docPath) {
      guardThen(() => openDroppedDoc(() => fileBridge.openPath(docPath)))
      return
    }
    const imgPaths = paths.filter((p) => IMAGE_EXT_MIME[extOf(p)])
    if (!imgPaths.length) return
    try {
      // Tauri reports the drop point in physical pixels; convert to CSS px
      // and ask ProseMirror which document position sits under it, so the
      // image lands where the user aimed — not at the text cursor.
      let insertPos = null
      if (position) {
        const scale = window.devicePixelRatio || 1
        const coords = editor.view.posAtCoords({ left: position.x / scale, top: position.y / scale })
        if (coords) insertPos = coords.pos
      }
      const { readFile } = await import('@tauri-apps/plugin-fs')
      for (const p of imgPaths) {
        const src = bytesToDataUrl(IMAGE_EXT_MIME[extOf(p)], await readFile(p))
        const node = { type: 'image', attrs: { src, alt: p.split(/[\\/]/).pop() } }
        const chain = editor.chain().focus()
        if (insertPos !== null) {
          chain.insertContentAt(insertPos, node)
          insertPos += 1 // keep multiple dropped images in drop order
        } else {
          chain.insertContent(node)
        }
        chain.run()
      }
    } catch (err) {
      console.error('[write] image drop failed:', err)
      showToast('Drop failed')
    }
  }
  const extOf = (p) => (p.match(/\.([a-z0-9]+)$/i)?.[1] || '').toLowerCase()

  async function setupNativeDragDrop() {
    const { getCurrentWebview } = await import('@tauri-apps/api/webview')
    unlistenDragDrop = await getCurrentWebview().onDragDropEvent((event) => {
      const p = event.payload
      if (p.type === 'enter' || p.type === 'over') dropHint = true
      else if (p.type === 'drop') { dropHint = false; handleDroppedPaths(p.paths || [], p.position) }
      else dropHint = false
    })
  }
  // browser fallback (dev preview) — native drops never reach these handlers
  function onDragOver(e) {
    if ([...(e.dataTransfer?.types || [])].includes('Files')) { e.preventDefault(); dropHint = true }
  }
  function onDragLeave(e) {
    if (!e.relatedTarget) dropHint = false
  }
  function onDrop(e) {
    dropHint = false
    const files = [...(e.dataTransfer?.files || [])]
    if (!files.length) return
    const docFile = files.find((f) => DOC_EXT_RE.test(f.name))
    if (docFile) {
      e.preventDefault()
      guardThen(() => openDroppedDoc(() => fileBridge.openFile(docFile)))
      return
    }
    // images dropped outside the editor surface (the editor handles its own)
    if (!e.defaultPrevented && insertImageFiles(editor, files) > 0) e.preventDefault()
  }

  function onKey(e) {
    const mod = e.ctrlKey || e.metaKey
    if (e.ctrlKey) armCtrlZoom() // see armCtrlZoom: blocking wheel listener only while Ctrl is down
    if (e.key === 'Escape') {
      if (findOpen) { closeFind(); return }
      if (confirmState) { confirmState = null; return }
      if (commanderOpen) { commanderOpen = false; return }
      setFocus(false); bubble = { ...bubble, show: false }
    }
    if (e.key === 'F11') { e.preventDefault(); setFocus(!focus) }
    if (mod && e.key.toLowerCase() === 'k') { e.preventDefault(); toggleCommander() }
    if (mod && e.key === '/') { e.preventDefault(); toggleBar() }
    if (mod && e.key.toLowerCase() === 's') { e.preventDefault(); saveDoc() }
    if (mod && e.key.toLowerCase() === 'o') { e.preventDefault(); openDoc() }
    if (mod && e.key.toLowerCase() === 'f') { e.preventDefault(); openFind() }
    // Ctrl+Enter already toggles focus mode, so the manual page break gets
    // Ctrl+Shift+Enter instead — a deliberate deviation from Word's Ctrl+Enter
    if (mod && e.shiftKey && e.key === 'Enter') { e.preventDefault(); insertPageBreak() }
    // paste-as-plain-text: the keydown fires before the browser's own paste,
    // so we just flag it here and let editor.js's handlePaste consume the flag
    if (mod && e.shiftKey && e.key.toLowerCase() === 'v') { markPastePlain() }
    if (mod && e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); setFocus(!focus) }
    /* Zoom from the keyboard — the shortcuts every app has, and the first
       place anyone reaches. Zoom itself already existed (Ctrl+scroll, and the
       ± in the Commander) and already applied to BOTH views, but with no
       keys bound it was effectively undiscoverable. `=` rather than `+`
       because that's the unshifted key; `+` is accepted too for the shifted
       form and the numpad. Ctrl+0 returns to 100%, as everywhere else. */
    if (mod && (e.key === '=' || e.key === '+')) { e.preventDefault(); applyZoom(zoomPct + 10) }
    if (mod && e.key === '-') { e.preventDefault(); applyZoom(zoomPct - 10) }
    if (mod && e.key === '0') { e.preventDefault(); applyZoom(100) }
    /* Show/hide formatting marks — Word's own Ctrl+Shift+8. The shifted `8`
       reports as `*` on most layouts, so accept both. */
    if (mod && e.shiftKey && (e.key === '8' || e.key === '*')) { e.preventDefault(); toggleFormattingMarks() }
    // cycle rooms with Ctrl/Cmd + \
    if (mod && e.key === '\\') {
      e.preventDefault()
      const i = ROOMS.findIndex((r) => r.id === room)
      applyRoom(ROOMS[(i + 1) % ROOMS.length].id, { toastIt: true })
    }
  }

  onMount(() => {
    document.body.setAttribute('data-room', room)
    document.body.setAttribute('data-view', view)
    document.body.setAttribute('data-flow-width', flowWidth)
    document.body.setAttribute('data-page-size', pageSize)
    document.body.setAttribute('data-orientation', orientation)
    document.body.setAttribute('data-margin', margin)
    syncPageStyle()
    if (mainEl && zoomPct !== 100) mainEl.style.zoom = String(zoomPct / 100)
    recents = store.loadRecents()
    const last = store.loadDoc()
    editor = createEditor(host, {
      content: last?.html || WELCOME,
      spellcheck,
      formattingMarks,
      onUpdate: () => { saved = false; touched = true; recount(); markTyping(); scheduleAutosave(); queueMeasureSoon(); refreshTableState() },
      onSelection: () => { updateBubble(); litParagraph(); updateCaret() },
      onRemoteImagesBlocked: noteRemoteImages,
    })
    /* Dev-only handle. Three sessions running now have had to reverse-engineer
       a way to reach ProseMirror from the automation harness (synthetic key
       events don't reach its handlers; the view isn't reachable from the DOM).
       `import.meta.env.DEV` is a literal at build time, so Vite drops this
       whole branch from the production bundle — it cannot ship. */
    if (import.meta.env.DEV) {
      window.__write = {
        get editor() { return editor },
        // enough to build and push a DecorationSet from a test script
        pm: { Decoration, DecorationSet },
        keys: { findReplaceKey },
      }
    }
    editor.on('focus', updateCaret)
    editor.on('blur', updateCaret)
    {
      // IME composition: get fully out of the way — hide the custom caret and
      // let the browser's own caret/underline drive until composition ends
      const pmRoot = host.querySelector('.ProseMirror')
      pmRoot?.addEventListener('compositionstart', () => { composing = true; updateCaret() })
      pmRoot?.addEventListener('compositionend', () => { composing = false; updateCaret() })
    }
    if (last?.name) docName = last.name
    recount()
    queueMeasure()
    // custom web fonts can finish loading a moment after mount and shift
    // text metrics — remeasure once they're actually ready. Calls
    // measurePages() directly (not via queueMeasure/rAF): reading
    // offsetTop/scrollHeight forces a synchronous layout regardless of
    // paint timing, and rAF itself can be throttled in a backgrounded tab.
    syncPageLeading() // best-effort now; redone below once the real font lands
    document.fonts?.ready?.then(() => { syncPageLeading(); measurePages() })
    window.addEventListener('keydown', onKey)
    window.addEventListener('scroll', updateBubble, { passive: true })
    window.addEventListener('scroll', onDocScroll, { passive: true })
    // a pointer landing on the page means the writer is working, not reaching
    // for a control — the Bar and wordmark duck. Bound to <main> rather than
    // the document so clicking the Bar, the Commander or the corner itself
    // doesn't dismiss the very thing being reached for.
    mainEl?.addEventListener('pointerdown', duckChrome, { passive: true })
    window.addEventListener('resize', onResize)
    document.addEventListener('selectionchange', onSelectionChange)
    document.addEventListener('mousemove', clearTyping)
    window.addEventListener('keyup', onCtrlUp)
    window.addEventListener('blur', disarmCtrlZoom) // Ctrl can be released outside the window (alt-tab)
    if (isTauri) {
      setupNativeDragDrop()
    } else {
      window.addEventListener('dragover', onDragOver)
      window.addEventListener('dragleave', onDragLeave)
      window.addEventListener('drop', onDrop)
    }
  })

  function onResize() { updateBubble(); measurePages(); updateCaret() }

  function onSelectionChange() { updateBubble(); litParagraph(); refreshBar(); refreshTableState(); updateCaret() }
  function clearTyping() { if (typing) { typing = false; document.body.classList.remove('typing') } }

  onDestroy(() => {
    clearTimeout(measureTimer)
    editor?.destroy()
    window.removeEventListener('keydown', onKey)
    window.removeEventListener('scroll', updateBubble)
    window.removeEventListener('scroll', onDocScroll)
    mainEl?.removeEventListener('pointerdown', duckChrome)
    window.removeEventListener('resize', onResize)
    document.removeEventListener('selectionchange', onSelectionChange)
    document.removeEventListener('mousemove', clearTyping)
    window.removeEventListener('dragover', onDragOver)
    window.removeEventListener('dragleave', onDragLeave)
    window.removeEventListener('drop', onDrop)
    window.removeEventListener('keyup', onCtrlUp)
    window.removeEventListener('blur', disarmCtrlZoom)
    disarmCtrlZoom()
    unlistenDragDrop?.()
  })
</script>

<!-- Wordmark doubles as the room/command opener. It ducks away on scroll with
     the Bar (see barScrollHidden) and comes back on hover of the top-left
     corner, on Ctrl+/, or on scrolling home — .mark-zone is the always-present
     hover target, the button itself is what fades. -->
<div class="mark-zone" class:ducked={barScrollHidden}>
  <button class="whisper wordmark" onclick={() => toggleCommander()} title="Rooms & recents (Ctrl+K)">write</button>
</div>

  <!-- Page view's sheets are `position: absolute`, so a document whose last
       page is short (nearly every document — pages rarely fill exactly) still
       leaves .editor-host's own auto height sized to the FLOWING content, not
       to the full physical page. Nothing paints in-flow past where the text
       actually ends, so main's desk-gray background — which fills exactly
       .editor-host's box — ran out before the last sheet visually did,
       showing white (the body underneath) below a sparse last page. This
       min-height, computed from the same pageRects the sheets are drawn
       from, is what makes .editor-host's box (and hence main's background)
       always reach the true bottom of the last sheet. Brett's screenshot. -->
<main bind:this={mainEl}>
  <div
    class="editor-host" class:custom-caret={caretVisible} bind:this={host}
    style={view === 'page' && pageRects.length ? `min-height:${pageRects[pageRects.length - 1].top + pageRects[pageRects.length - 1].height}px` : ''}
  >
    <div class="caret" class:show={caretVisible} bind:this={caretEl}></div>
    {#if view === 'page'}
      <!-- Desk showing between sheets, painted ABOVE the text. Page breaks are
           made by injecting padding-top onto the block that starts the new
           page, and a block with a left rule — a blockquote — draws that rule
           down through its own padding, i.e. straight across the gap (Brett's
           screenshot: a stray accent line spanning the break). Masking the gap
           fixes that and every future case of it (table borders, rules) in one
           place, and it is safe because pagination already guarantees no TEXT
           lands here. -->
      {#each pageRects.slice(0, -1) as r}
        <div class="page-gap" style="top:{r.top + r.height}px; height:{PAGE_GAP}px"></div>
      {/each}
      {#each pageRects as r}
        <div class="page-sheet" style="top:{r.top}px; height:{r.height}px">
          {#if header.text || (pageNumbers.enabled && pageNumbers.place === 'header')}
            <div class="page-band page-band-header">
              {#if header.text}<span class="pb-line" data-align={header.align}>{header.text}</span>{/if}
              {#if pageNumbers.enabled && pageNumbers.place === 'header'}
                <span class="pb-line pb-num" data-align={pageNumbers.align}>{r.n + 1}</span>
              {/if}
            </div>
          {/if}
          {#if footer.text || (pageNumbers.enabled && pageNumbers.place === 'footer')}
            <div class="page-band page-band-footer">
              {#if footer.text}<span class="pb-line" data-align={footer.align}>{footer.text}</span>{/if}
              {#if pageNumbers.enabled && pageNumbers.place === 'footer'}
                <span class="pb-line pb-num" data-align={pageNumbers.align}>{r.n + 1}</span>
              {/if}
            </div>
          {/if}
        </div>
      {/each}
    {/if}
  </div>
</main>

<!-- selection bubble -->
<div class="bubble" class:show={bubble.show} style="left:{bubble.x}px; top:{bubble.y}px;">
  <button class:on={active.bold} onmousedown={(e) => run('bold', e)} title="Bold (Ctrl+B)"><b>B</b></button>
  <button class:on={active.italic} onmousedown={(e) => run('italic', e)} title="Italic (Ctrl+I)"><i>I</i></button>
  <button class:on={active.underline} onmousedown={(e) => run('underline', e)} title="Underline (Ctrl+U)"><span style="text-decoration:underline">U</span></button>
  <button class:on={active.strike} onmousedown={(e) => run('strike', e)} title="Strikethrough"><span style="text-decoration:line-through">S</span></button>
  <span class="sep"></span>
  <button class:on={active.block === 'h1'} onmousedown={(e) => run('h1', e)} title="Heading 1">H1</button>
  <button class:on={active.block === 'h2'} onmousedown={(e) => run('h2', e)} title="Heading 2">H2</button>
  <button class:on={active.block === 'p'} onmousedown={(e) => run('p', e)} title="Body text">¶</button>
  <button class:on={active.block === 'quote'} onmousedown={(e) => run('quote', e)} title="Quote">❝</button>
  <button class:on={active.block === 'ul'} onmousedown={(e) => run('ul', e)} title="Bulleted list">•≡</button>
</div>

<!-- the Bar: summoned by Ctrl+/ (pinned) or by hovering the very top edge (peek) -->
<div class="bar-zone" class:pinned={barOpen} class:scroll-ducked={barScrollHidden} class:menu-open={fontMenuOpen}>
  <div class="bar" role="toolbar" aria-label="Formatting">
    <!-- typeface: a listbox, not a <select> — names set in their own face,
         and ↑/↓ previews each one live in the document (see onFontKey) -->
    <span class="font-picker">
      <button
        class="bar-select bar-font"
        aria-haspopup="listbox"
        aria-expanded={fontMenuOpen}
        title="Typeface — ↑↓ to preview"
        style="font-family: {barState.font || 'var(--body-font)'}"
        onclick={openFontMenu}
        onkeydown={onFontKey}
      >{fontLabel(barState.font)}</button>
      {#if fontMenuOpen}
        <div
          class="font-menu"
          role="listbox"
          aria-label="Typeface"
          tabindex="-1"
          bind:this={fontMenuEl}
          onkeydown={onFontKey}
          onblur={() => closeFontMenu(false)}
        >
          {#each FONT_GROUPS as g}
            {#if g.name}<div class="font-group">{g.name}</div>{/if}
            {#each g.items as f}
              {@const i = BAR_FONTS.indexOf(f)}
              <button
                type="button"
                class="font-row"
                class:sel={i === fontIdx}
                role="option"
                aria-selected={i === fontIdx}
                data-fi={i}
                style="font-family: {f.value || 'var(--body-font)'}"
                onmouseenter={() => previewFont(i)}
                onmousedown={(e) => { e.preventDefault(); fontIdx = i; closeFontMenu(true) }}
              >{f.value ? f.label : roomFontLabel}</button>
            {/each}
          {/each}
          <div class="font-menu-foot">↑↓ preview · ↵ keep · esc cancel</div>
        </div>
      {/if}
    </span>
    <span class="select-wrap">
      <select class="bar-select bar-size" value={barState.size} onchange={(e) => barRun('size', e.target.value)} title="Size">
        <option value="">Size</option>
        {#each BAR_SIZES as s}<option value={s}>{s.replace('pt', '')}</option>{/each}
      </select>
    </span>
    <span class="bar-sep"></span>
    <span class="bar-swatches" title="Text color">
      <button class="swatch swatch-none" class:on={!barState.color} onclick={() => barRun('color', '')} title="Default ink">A</button>
      {#each BAR_COLORS as c}
        <button class="swatch" class:on={barState.color.toUpperCase() === c} style="--sw:{c}" onclick={() => barRun('color', c)} title={c}></button>
      {/each}
    </span>
    <span class="bar-sep"></span>
    <span class="bar-swatches" title="Highlight">
      <button class="swatch swatch-none" class:on={!barState.highlight} onclick={() => barRun('highlight', '')} title="No highlight">×</button>
      {#each BAR_HIGHLIGHTS as c}
        <button class="swatch swatch-hl" class:on={barState.highlight.toUpperCase() === c} data-color={c} style="--sw:{c}" onclick={() => barRun('highlight', c)} title={c}></button>
      {/each}
    </span>
    <!-- Forced row break. The Bar used to wrap wherever the window width
         happened to run out, so which controls shared a row changed as you
         resized. This splits it the way Word splits its own ribbon — the top
         row is CHARACTER formatting (typeface, size, ink, highlight: what the
         letters look like), the bottom row is PARAGRAPH formatting (alignment,
         spacing, indent: where the block sits) — and Reset, which clears both.
         `flex-basis: 100%` on a zero-height item is the flexbox idiom for
         "break the line here" in a wrap container. -->
    <span class="bar-row-break"></span>
    <span class="seg bar-seg" title="Alignment">
      <button class:on={barState.align === 'left'} onclick={() => barRun('align', 'left')} title="Align left">⯈</button>
      <button class:on={barState.align === 'center'} onclick={() => barRun('align', 'center')} title="Center">⯀</button>
      <button class:on={barState.align === 'right'} onclick={() => barRun('align', 'right')} title="Align right">⯇</button>
      <button class:on={barState.align === 'justify'} onclick={() => barRun('align', 'justify')} title="Justify">☰</button>
    </span>
    <span class="select-wrap">
      <select class="bar-select bar-lh" value={barState.lineHeight} onchange={(e) => barRun('lineHeight', e.target.value)} title="Line spacing">
        <option value="">Spacing</option>
        {#each BAR_LINE_HEIGHTS as [v, label]}<option value={v}>{label}</option>{/each}
      </select>
    </span>
    <span class="seg bar-seg" title="Indent">
      <button onclick={() => barRun('outdent')} disabled={!barState.indent} title="Decrease indent">⇤</button>
      <button onclick={() => barRun('indent')} title="Increase indent">⇥</button>
    </span>
    <span class="bar-sep"></span>
    <!-- Reset: returns the selection's type styling (font/size/color/highlight/
         alignment/spacing/indent) to the room's defaults. Named with a word, not
         the old "Aa ×" glyph; goes live only when there's actually something to
         reset (see barDirty) but stays mounted so the Bar doesn't reflow. -->
    <button class="bar-reset" class:live={barDirty} disabled={!barDirty}
            onclick={() => barRun('clear')}
            title="Reset type styling to the room's defaults">Reset</button>
  </div>
</div>

<!-- the find bar: summonable Find & Replace (Ctrl+F) -->
{#if findOpen}
  <div class="find-bar" role="toolbar" aria-label="Find and replace">
    <input
      class="find-input"
      type="text"
      placeholder="Find"
      bind:value={findQuery}
      oninput={runFind}
      onkeydown={onFindKey}
    />
    <span class="find-count">{findCount ? `${findActiveDisplay} / ${findCount}` : 'No results'}</span>
    <button onclick={() => findStep(-1)} disabled={!findCount} title="Previous match (Shift+Enter)">↑</button>
    <button onclick={() => findStep(1)} disabled={!findCount} title="Next match (Enter)">↓</button>
    <span class="bar-sep"></span>
    <input class="replace-input" type="text" placeholder="Replace" bind:value={replaceQuery} />
    <button class="find-wide" onclick={replaceCurrent} disabled={!findCount} title="Replace this match">Replace</button>
    <button class="find-wide" onclick={replaceAll} disabled={!findQuery} title="Replace all matches">Replace All</button>
    <span class="bar-sep"></span>
    <button class="find-close" onclick={closeFind} title="Close (Esc)">×</button>
  </div>
{/if}

<!-- the table bar: appears while the caret is inside a table (Wave 5) -->
{#if inTable}
  <div class="table-bar" role="toolbar" aria-label="Table">
    <span class="tb-label">Row</span>
    <span class="seg bar-seg">
      <button onclick={() => tableRun('rowAbove')} title="Add row above">↥</button>
      <button onclick={() => tableRun('rowBelow')} title="Add row below">↧</button>
      <button onclick={() => tableRun('delRow')} title="Delete row">×</button>
    </span>
    <span class="tb-label">Column</span>
    <span class="seg bar-seg">
      <button onclick={() => tableRun('colLeft')} title="Add column left">↤</button>
      <button onclick={() => tableRun('colRight')} title="Add column right">↦</button>
      <button onclick={() => tableRun('delCol')} title="Delete column">×</button>
    </span>
    <span class="bar-sep"></span>
    <button class="tb-wide" onclick={() => tableRun('merge')} title="Merge selected cells">Merge</button>
    <button class="tb-wide" onclick={() => tableRun('split')} title="Split merged cell">Split</button>
    <button class="tb-wide" onclick={() => tableRun('header')} title="Toggle header row">Header</button>
    <span class="bar-sep"></span>
    <button class="tb-wide tb-danger" onclick={() => tableRun('delTable')} title="Delete the whole table">× Table</button>
  </div>
{/if}

<!-- toast whisper (room name on cycle) -->
{#if toast}
  <div class="toast">{toast}</div>
{/if}

<!-- zoom read-out: appears while zooming, fades when you stop. Sits low so it
     never collides with the Bar or the toast, and calls out 100% as "home". -->
{#if zoomBadge}
  <div class="zoom-badge" class:home={zoomPct === 100} aria-live="polite">
    {zoomPct}%{#if zoomPct === 100}<span class="zb-home">default</span>{/if}
  </div>
{/if}

<!-- drag-drop hint while a file hovers the window -->
{#if dropHint}
  <div class="toast drop-toast">Drop to open</div>
{/if}

<!-- discard guard: quiet confirm before replacing unsaved work -->
{#if confirmState}
  <!-- The veil dismisses only when the click LANDS on the veil itself
       (target === currentTarget). That replaces a stopPropagation handler on
       the card, which was a click listener on a non-interactive element —
       unreachable by keyboard and the source of two Svelte a11y warnings.
       The card carries tabindex="-1" (a dialog must be focusable
       programmatically) and aria-modal. Escape already closes both. -->
  <div class="veil" onclick={(e) => { if (e.target === e.currentTarget) confirmState = null }} role="presentation">
    <div class="commander confirm-card" role="dialog" aria-modal="true" tabindex="-1" aria-label="Unsaved changes">
      <p class="confirm-text">This page has changes not yet saved to a file.</p>
      <div class="cmd-actions confirm-actions">
        <button onclick={confirmSaveFirst}>⤓ Save…</button>
        <button class="confirm-discard" onclick={confirmDiscard}>Discard</button>
        <button onclick={() => (confirmState = null)}>Cancel</button>
      </div>
    </div>
  </div>
{/if}

<div class="bottom-fade"></div>
<span class="whisper stats">
  <span class="dot" class:unsaved={!saved}></span>{words.toLocaleString()} words · {readMin} min
</span>
<span class="whisper hint">
  <b>{docName}</b> · <b>Ctrl K</b> rooms &amp; recents · <b>Ctrl \</b> cycle rooms · <b>Ctrl↵</b> focus
</span>

<!-- ============ The Commander: summonable rooms + recents ============ -->
{#if commanderOpen}
  <div class="veil" onclick={(e) => { if (e.target === e.currentTarget) commanderOpen = false }} role="presentation">
    <div class="commander" role="dialog" aria-modal="true" tabindex="-1" aria-label="Rooms and recents">
      <header class="cmd-head">
        <span class="cmd-title">Rooms</span>
        <button class="cmd-focus" class:on={focus} onclick={() => setFocus(!focus)}>
          {focus ? '● Focus on' : '○ Focus'}
        </button>
      </header>

      <div class="room-grid">
        {#each ROOMS as r}
          <button
            class="room-card"
            class:selected={room === r.id}
            data-room={r.id}
            onclick={() => { applyRoom(r.id); }}
          >
            <span class="rc-swatch"><span class="rc-aa">Aa</span></span>
            <span class="rc-meta">
              <span class="rc-name">{r.label}</span>
              <span class="rc-note">{r.note}</span>
            </span>
            {#if room === r.id}<span class="rc-check">●</span>{/if}
          </button>
        {/each}
      </div>

      <div class="cmd-view">
        <span class="cmd-sublabel">View</span>
        <div class="seg">
          <button class:on={view === 'flow'} onclick={() => applyView('flow')}>Flow</button>
          <button class:on={view === 'page'} onclick={() => applyView('page')}>Page</button>
        </div>
        <button class="seg-ghost" class:on={barOpen} onclick={() => toggleBar()} title="Formatting bar (Ctrl+/)">Format</button>
        <button class="seg-ghost" class:on={spellcheck} onclick={toggleSpellcheck} title="Spell check (native)">Spelling</button>
        <button
          class="seg-ghost" class:on={formattingMarks} onclick={toggleFormattingMarks}
          title="Formatting marks — spaces, tabs, paragraphs (Ctrl+Shift+8)"
        >¶ Marks</button>
        {#if view === 'flow'}
          <div class="seg">
            <button class:on={flowWidth === 'narrow'} onclick={() => applyFlowWidth('narrow')}>Narrow</button>
            <button class:on={flowWidth === 'normal'} onclick={() => applyFlowWidth('normal')}>Normal</button>
            <button class:on={flowWidth === 'wide'} onclick={() => applyFlowWidth('wide')}>Wide</button>
          </div>
        {/if}
        {#if view === 'page'}
          <div class="seg">
            <button class:on={pageSize === 'letter'} onclick={() => applyPageSize('letter')}>Letter</button>
            <button class:on={pageSize === 'a4'} onclick={() => applyPageSize('a4')}>A4</button>
          </div>
          <div class="seg">
            <button class:on={orientation === 'portrait'} onclick={() => applyOrientation('portrait')}>Portrait</button>
            <button class:on={orientation === 'landscape'} onclick={() => applyOrientation('landscape')}>Landscape</button>
          </div>
          <div class="seg">
            <button class:on={margin === 'narrow'} onclick={() => applyMargin('narrow')}>Narrow</button>
            <button class:on={margin === 'normal'} onclick={() => applyMargin('normal')}>Normal</button>
            <button class:on={margin === 'wide'} onclick={() => applyMargin('wide')}>Wide</button>
          </div>
        {/if}
        <span class="seg zoom-seg" title="Zoom (Ctrl+scroll)">
          <button onclick={() => applyZoom(zoomPct - 10)} disabled={zoomPct <= 50}>−</button>
          <span class="zoom-pct">{zoomPct}%</span>
          <button onclick={() => applyZoom(zoomPct + 10)} disabled={zoomPct >= 200}>+</button>
        </span>
      </div>

      {#if view === 'page'}
        <div class="cmd-hf">
          <span class="cmd-sublabel">Header</span>
          <input
            class="hf-input" type="text" placeholder="Header text"
            value={header.text} oninput={(e) => setHeader({ text: e.target.value })}
          />
          <span class="seg bar-seg" title="Header alignment">
            <button class:on={header.align === 'left'} onclick={() => setHeader({ align: 'left' })}>⯈</button>
            <button class:on={header.align === 'center'} onclick={() => setHeader({ align: 'center' })}>⯀</button>
            <button class:on={header.align === 'right'} onclick={() => setHeader({ align: 'right' })}>⯇</button>
          </span>
        </div>
        <div class="cmd-hf">
          <span class="cmd-sublabel">Footer</span>
          <input
            class="hf-input" type="text" placeholder="Footer text"
            value={footer.text} oninput={(e) => setFooter({ text: e.target.value })}
          />
          <span class="seg bar-seg" title="Footer alignment">
            <button class:on={footer.align === 'left'} onclick={() => setFooter({ align: 'left' })}>⯈</button>
            <button class:on={footer.align === 'center'} onclick={() => setFooter({ align: 'center' })}>⯀</button>
            <button class:on={footer.align === 'right'} onclick={() => setFooter({ align: 'right' })}>⯇</button>
          </span>
        </div>
        <div class="cmd-hf">
          <button class="seg-ghost" class:on={pageNumbers.enabled} onclick={() => setPageNumbers({ enabled: !pageNumbers.enabled })}>
            {pageNumbers.enabled ? '● Page numbers' : '○ Page numbers'}
          </button>
          {#if pageNumbers.enabled}
            <span class="seg bar-seg" title="Where">
              <button class:on={pageNumbers.place === 'header'} onclick={() => setPageNumbers({ place: 'header' })}>Header</button>
              <button class:on={pageNumbers.place === 'footer'} onclick={() => setPageNumbers({ place: 'footer' })}>Footer</button>
            </span>
            <span class="seg bar-seg" title="Number alignment">
              <button class:on={pageNumbers.align === 'left'} onclick={() => setPageNumbers({ align: 'left' })}>⯈</button>
              <button class:on={pageNumbers.align === 'center'} onclick={() => setPageNumbers({ align: 'center' })}>⯀</button>
              <button class:on={pageNumbers.align === 'right'} onclick={() => setPageNumbers({ align: 'right' })}>⯇</button>
            </span>
          {/if}
        </div>
      {/if}

      <div class="cmd-hf">
        <span class="cmd-sublabel">Templates</span>
        {#each TEMPLATES as t}
          <button class="seg-ghost" onclick={() => useTemplate(t)} title={t.note}>{t.label}</button>
        {/each}
      </div>

      <div class="cmd-actions">
        <button onclick={newDoc}>＋ New</button>
        <button onclick={openDoc}>↥ Open…</button>
        <button onclick={saveDoc}>⤓ Save…</button>
        <button onclick={insertPageBreak} title="Insert a manual page break (Ctrl+Shift+Enter)">↡ Page Break</button>
        <button onclick={insertTable} title="Insert a 3×3 table with a header row">▦ Table</button>
        <button onclick={insertToc} title="Insert a table of contents from the document's headings">≡ Contents</button>
        {#if view === 'page'}<button onclick={() => window.print()}>⎙ Print…</button>{/if}
      </div>

      {#if recents.length}
        <div class="recents">
          <span class="recents-label">Recent</span>
          {#each recents as entry}
            <button class="recent-item" onclick={() => openRecent(entry)}>
              <span class="ri-name">{entry.name}</span>
              <span class="ri-meta">{entry.words ?? 0} words · {store.relativeTime(entry.savedAt)}</span>
            </button>
          {/each}
        </div>
      {/if}
    </div>
  </div>
{/if}
