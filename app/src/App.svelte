<script>
  import { onMount, onDestroy } from 'svelte'
  import { createEditor, WELCOME, insertImageFiles, bytesToDataUrl, IMAGE_EXT_MIME, findReplaceKey, markPastePlain } from './lib/editor.js'
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
  // the current page's usable geometry — my (margin) + contentH (writable height)
  function geom() {
    const phys = PAGE_PHYSICAL[pageSize] || PAGE_PHYSICAL.letter
    const totalH = orientation === 'landscape' ? phys.w : phys.h
    const my = MARGIN_PX[margin] || MARGIN_PX.normal
    return { my, contentH: totalH - 2 * my }
  }
  let pageStyleEl
  let pageGapStyleEl

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

  // selection bubble
  let bubble = $state({ show: false, x: 0, y: 0 })
  let active = $state({ bold: false, italic: false, underline: false, strike: false, block: '' })

  // chrome fades while typing
  let typing = $state(false)
  let typingTimer
  let autosaveTimer

  function applyRoom(next, { toastIt = false } = {}) {
    room = next
    document.body.setAttribute('data-room', next)
    localStorage.setItem('write:room', next)
    if (toastIt) showToast(ROOMS.find((r) => r.id === next)?.label || next)
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
    if (!pageStyleEl) { pageStyleEl = document.createElement('style'); document.head.appendChild(pageStyleEl) }
    const size = pageSize === 'a4' ? 'A4' : 'letter'
    const orient = orientation === 'landscape' ? ' landscape' : ''
    const marginIn = MARGIN_IN[margin] || '1in'
    pageStyleEl.textContent = `@media print{@page{size:${size}${orient};margin:${marginIn};}}`
  }

  // ---- zoom: Ctrl+scroll, or the Commander's +/− ----
  function applyZoom(pct) {
    zoomPct = Math.max(50, Math.min(200, Math.round(pct / 10) * 10))
    localStorage.setItem('write:zoom', String(zoomPct))
    // no zoom style at all at 100%: any zoom on the scrolling subtree can
    // demote scrolling to the main thread in some engines
    if (mainEl) mainEl.style.zoom = zoomPct === 100 ? '' : String(zoomPct / 100)
    queueMeasure()
  }
  function onWheel(e) {
    if (!e.ctrlKey) return
    e.preventDefault()
    applyZoom(zoomPct + (e.deltaY < 0 ? 10 : -10))
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
     Natural overflow breaks snap to the nearest block boundary (never
     mid-paragraph) — a paragraph that would straddle a page in Word stays
     whole here instead. Documented as the known Tier-4 gap; true reflow
     needs a real pagination engine, a further increment.

     Wave 3 rewrite: a single forward sweep over top-level blocks (instead of
     the old "compute a nominal page count, then search for each target"
     approach), tracking how much natural content height has accumulated
     since the current page began. One pass now handles two break triggers:
     natural overflow (same nearest-boundary rounding as before) AND a
     manual pageBreak node, which forces the next block onto a fresh page
     unconditionally. It's also more accurate than the old approach for 3+
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
  function measurePages() {
    if (view !== 'page' || !host) { pageRects = []; lastMeasuredPages = null; if (pageGapStyleEl) pageGapStyleEl.textContent = ''; return }
    const pm = host.querySelector('.ProseMirror')
    if (!pm) { pageRects = []; lastMeasuredPages = null; if (pageGapStyleEl) pageGapStyleEl.textContent = ''; return }
    const g = geom()
    // compact-junction display geometry (see JUNCTION_MY): trimmed vertical
    // margins where sheets meet; capacity (g.contentH) is untouched
    const jmy = Math.min(g.my, JUNCTION_MY)
    const firstH = g.my + g.contentH + jmy // page 0's height when it has a successor
    const midH = jmy + g.contentH + jmy    // every later non-final page

    if (!pageGapStyleEl) { pageGapStyleEl = document.createElement('style'); document.head.appendChild(pageGapStyleEl) }
    pageGapStyleEl.textContent = ''

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
    let lastBreakIdx = -1 // guards against re-breaking at/before the last break

    const breakBefore = (idx) => {
      const naturalTop = children[idx].offsetTop
      pageIndex++
      // where page k's first text lands in .ProseMirror space (whose origin
      // sits g.my below sheet 0's top): every page before k has a successor,
      // so its displayed bottom margin is jmy; page k's displayed top margin
      // is jmy too (k ≥ 1 here, so it always has a predecessor)
      const desiredY = firstH + (pageIndex - 1) * midH + pageIndex * PAGE_GAP + jmy - g.my
      const marginNeeded = Math.max(0, desiredY - naturalTop - cumMargin)
      // padding-top, not margin-top: adjacent vertical margins collapse in
      // CSS (two touching margins become one, sized to the larger — not the
      // sum), so a margin-top here would silently lose up to the previous
      // sibling's own margin-bottom, landing content short of its page-2+
      // target by that amount. Padding never collapses with anything.
      rules.push(`.ProseMirror>*:nth-child(${idx + 1}){padding-top:${marginNeeded}px}`)
      cumMargin += marginNeeded
      pageStartY = naturalTop
      lastBreakIdx = idx
    }

    for (let i = 0; i < children.length; i++) {
      if (isPageBreakEl(children[i])) {
        // a manual break: the NEXT block starts a fresh page, regardless of
        // how much room is left on the current one
        if (i + 1 < children.length) breakBefore(i + 1)
        continue
      }
      const naturalTop = children[i].offsetTop
      const used = naturalTop - pageStartY
      if (used < g.contentH) continue

      // overflow — snap to the nearer boundary (this child vs. the previous
      // one still on the current page): the Session-16 rounding rule
      let idx = i
      if (i - 1 > lastBreakIdx && !isPageBreakEl(children[i - 1])) {
        const prevTop = children[i - 1].offsetTop
        const overshoot = naturalTop - (pageStartY + g.contentH)
        const undershoot = (pageStartY + g.contentH) - prevTop
        if (undershoot < overshoot) idx = i - 1
      }
      breakBefore(idx)
    }

    // scoped to screen only: these margins are a visual illusion for the
    // editor surface, not something print's own @page pagination should see
    pageGapStyleEl.textContent = rules.length ? `@media screen{${rules.join('')}}` : ''

    const pages = pageIndex + 1
    // variable sheet heights: full margins on the document's outer edges,
    // compact ones at every junction (a lone page is exactly nominal pageH)
    const rects = []
    let rectTop = 0
    for (let i = 0; i < pages; i++) {
      const h = (i === 0 ? g.my : jmy) + g.contentH + (i === pages - 1 ? g.my : jmy)
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
    if (!litStyleEl) { litStyleEl = document.createElement('style'); document.head.appendChild(litStyleEl) }
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
  let barState = $state({ font: '', size: '', color: '', highlight: '', align: 'left', lineHeight: '', indent: 0 })
  // scroll-duck: a pinned bar gets out of the way once the page actually
  // scrolls (reading, not formatting). It returns via the top-edge hover
  // peek, Ctrl+/, or scrolling back to the very top of the document.
  let barScrollHidden = $state(false)
  let barShownAtY = 0 // scrollY when the bar last became visible — hide on real travel, not caret nudges
  function onDocScroll() {
    const y = window.scrollY
    if (y <= 4) {
      if (barScrollHidden) { barScrollHidden = false; refreshBar() }
      barShownAtY = y
      return
    }
    if (!barScrollHidden && Math.abs(y - barShownAtY) > 48) barScrollHidden = true
    if (barScrollHidden) barShownAtY = y
  }

  // every family here ships with the app (fully offline holds)
  const BAR_FONTS = [
    { label: 'Room default', value: '' },
    { label: 'Quattro', value: "'iA Writer Quattro S', monospace" },
    { label: 'Literata', value: "'Literata Variable', serif" },
    { label: 'Source Serif', value: "'Source Serif 4 Variable', serif" },
    { label: 'Newsreader', value: "'Newsreader Variable', serif" },
    { label: 'Geist', value: "'Geist Variable', sans-serif" },
    { label: 'Plex Sans', value: "'IBM Plex Sans', sans-serif" },
    { label: 'Geist Mono', value: "'Geist Mono Variable', monospace" },
  ]
  const BAR_SIZES = ['10pt', '11pt', '12pt', '14pt', '16pt', '18pt', '24pt', '32pt']
  const BAR_COLORS = ['#B91C1C', '#B45309', '#15803D', '#1D4ED8', '#7E22CE', '#6B7280']
  const BAR_HIGHLIGHTS = ['#FEF08A', '#BBF7D0', '#BFDBFE', '#FBCFE8', '#FED7AA']
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
      editor.commands.updateAttributes('paragraph', { indent: 0 })
      editor.commands.updateAttributes('heading', { indent: 0 })
    },
  }
  function barRun(name, v) {
    barCmd[name](v)
    requestAnimationFrame(() => { refreshBar(); queueMeasure() })
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
      onUpdate: () => { saved = false; touched = true; recount(); markTyping(); scheduleAutosave(); queueMeasure(); refreshTableState() },
      onSelection: () => { updateBubble(); litParagraph(); updateCaret() },
    })
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
    document.fonts?.ready?.then(() => measurePages())
    window.addEventListener('keydown', onKey)
    window.addEventListener('scroll', updateBubble, { passive: true })
    window.addEventListener('scroll', onDocScroll, { passive: true })
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
    editor?.destroy()
    window.removeEventListener('keydown', onKey)
    window.removeEventListener('scroll', updateBubble)
    window.removeEventListener('scroll', onDocScroll)
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

<!-- Wordmark doubles as the room/command opener. -->
<button class="whisper wordmark" onclick={() => toggleCommander()} title="Rooms & recents (Ctrl+K)">write</button>

<main bind:this={mainEl}>
  <div class="editor-host" class:custom-caret={caretVisible} bind:this={host}>
    <div class="caret" class:show={caretVisible} bind:this={caretEl}></div>
    {#if view === 'page'}
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
<div class="bar-zone" class:pinned={barOpen} class:scroll-ducked={barScrollHidden}>
  <div class="bar" role="toolbar" aria-label="Formatting">
    <select class="bar-select" value={barState.font} onchange={(e) => barRun('font', e.target.value)} title="Typeface">
      {#each BAR_FONTS as f}<option value={f.value}>{f.label}</option>{/each}
    </select>
    <select class="bar-select bar-size" value={barState.size} onchange={(e) => barRun('size', e.target.value)} title="Size">
      <option value="">Size</option>
      {#each BAR_SIZES as s}<option value={s}>{s.replace('pt', '')}</option>{/each}
    </select>
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
        <button class="swatch swatch-hl" class:on={barState.highlight.toUpperCase() === c} style="--sw:{c}" onclick={() => barRun('highlight', c)} title={c}></button>
      {/each}
    </span>
    <span class="bar-sep"></span>
    <span class="seg bar-seg" title="Alignment">
      <button class:on={barState.align === 'left'} onclick={() => barRun('align', 'left')} title="Align left">⯈</button>
      <button class:on={barState.align === 'center'} onclick={() => barRun('align', 'center')} title="Center">⯀</button>
      <button class:on={barState.align === 'right'} onclick={() => barRun('align', 'right')} title="Align right">⯇</button>
      <button class:on={barState.align === 'justify'} onclick={() => barRun('align', 'justify')} title="Justify">☰</button>
    </span>
    <select class="bar-select bar-lh" value={barState.lineHeight} onchange={(e) => barRun('lineHeight', e.target.value)} title="Line spacing">
      <option value="">Spacing</option>
      {#each BAR_LINE_HEIGHTS as [v, label]}<option value={v}>{label}</option>{/each}
    </select>
    <span class="seg bar-seg" title="Indent">
      <button onclick={() => barRun('outdent')} disabled={!barState.indent} title="Decrease indent">⇤</button>
      <button onclick={() => barRun('indent')} title="Increase indent">⇥</button>
    </span>
    <span class="bar-sep"></span>
    <button class="bar-clear" onclick={() => barRun('clear')} title="Clear formatting">Aa ×</button>
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

<!-- drag-drop hint while a file hovers the window -->
{#if dropHint}
  <div class="toast drop-toast">Drop to open</div>
{/if}

<!-- discard guard: quiet confirm before replacing unsaved work -->
{#if confirmState}
  <div class="veil" onclick={() => (confirmState = null)} role="presentation">
    <div class="commander confirm-card" onclick={(e) => e.stopPropagation()} role="dialog" aria-label="Unsaved changes">
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
  <div class="veil" onclick={() => (commanderOpen = false)} role="presentation">
    <div class="commander" onclick={(e) => e.stopPropagation()} role="dialog" aria-label="Rooms and recents">
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
