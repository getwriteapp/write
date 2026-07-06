<script>
  import { onMount, onDestroy } from 'svelte'
  import { createEditor, WELCOME, insertImageFiles, bytesToDataUrl, IMAGE_EXT_MIME } from './lib/editor.js'
  import { ROOMS, DEFAULT_ROOM } from './lib/rooms.js'
  import { fileBridge, isTauri, DOC_EXT_RE } from './lib/bridge.js'
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
  let pageSize = $state(localStorage.getItem('write:pageSize') || 'letter')
  let guides = $state(localStorage.getItem('write:guides') !== '0')
  // one rect per physical page: {top, height, n} — the on-screen home of Tier-4
  let pageRects = $state([])
  // CSS-pixel geometry at 96dpi; kept in sync with pages.css
  const PAGE_GEOM = { letter: { my: 96, contentH: 864 }, a4: { my: 96, contentH: 930 } }
  const PAGE_GAP = 44 // desk showing through between discrete sheets
  let pageStyleEl
  let pageGapStyleEl

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
  function toggleGuides() {
    guides = !guides
    localStorage.setItem('write:guides', guides ? '1' : '0')
  }
  function syncPageStyle() {
    if (!pageStyleEl) { pageStyleEl = document.createElement('style'); document.head.appendChild(pageStyleEl) }
    pageStyleEl.textContent = `@media print{@page{size:${pageSize === 'a4' ? 'A4' : 'letter'};margin:1in;}}`
  }
  function queueMeasure() {
    requestAnimationFrame(() => requestAnimationFrame(measurePages))
  }

  /* Tier-4: discrete floating pages. ProseMirror keeps one continuous
     document — we never split its DOM — so the "pages" are an illusion made
     of two parts kept in sync:
       1. paper rects (pageRects, below) drawn behind the text at fixed,
          nominal page-height intervals with a real gap between them;
       2. a margin-top pushed onto the block that starts each new page, via
          an injected `:nth-child` stylesheet rule — the same technique
          the focus-dimming feature uses, because ProseMirror strips foreign
          classes/attrs on its own nodes but leaves an external <style> alone.
     Breaks snap to the nearest block boundary (never mid-paragraph) — a
     paragraph that would straddle a page in Word stays whole here instead.
     Documented as the known Tier-4 gap; true reflow needs a real pagination
     engine, a further increment. */
  function measurePages() {
    if (view !== 'page' || !host) { pageRects = []; if (pageGapStyleEl) pageGapStyleEl.textContent = ''; return }
    const pm = host.querySelector('.ProseMirror')
    if (!pm) { pageRects = []; if (pageGapStyleEl) pageGapStyleEl.textContent = ''; return }
    const g = PAGE_GEOM[pageSize] || PAGE_GEOM.letter
    const pageH = g.my * 2 + g.contentH

    // pass 1: natural (ungapped) measurement — clear any prior injected
    // margins first, since they'd otherwise inflate this very measurement
    if (!pageGapStyleEl) { pageGapStyleEl = document.createElement('style'); document.head.appendChild(pageGapStyleEl) }
    pageGapStyleEl.textContent = ''
    const contentOnly = pm.scrollHeight - 2 * g.my
    const nominalPages = Math.max(1, Math.ceil(contentOnly / g.contentH))

    const children = [...pm.children]
    let searchFrom = 0
    let cumMargin = 0
    const rules = []
    for (let k = 1; k < nominalPages; k++) {
      const naturalTargetY = g.my + k * g.contentH
      const idx = children.findIndex((el, i) => i >= searchFrom && el.offsetTop >= naturalTargetY)
      if (idx === -1) break // content runs out before this nominal page — stop, don't fabricate a break
      searchFrom = idx + 1
      const desiredY = k * (pageH + PAGE_GAP) + g.my
      const margin = Math.max(0, desiredY - children[idx].offsetTop - cumMargin)
      rules.push(`.ProseMirror>*:nth-child(${idx + 1}){margin-top:${margin}px}`)
      cumMargin += margin
    }
    // scoped to screen only: these margins are a visual illusion for the
    // editor surface, not something print's own @page pagination should see
    pageGapStyleEl.textContent = rules.length ? `@media screen{${rules.join('')}}` : ''

    const pages = rules.length + 1
    pageRects = Array.from({ length: pages }, (_, i) => ({ top: i * (pageH + PAGE_GAP), height: pageH, n: i }))
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
    const sel = window.getSelection()
    if (!editor || !sel || sel.isCollapsed || !sel.rangeCount) { bubble = { ...bubble, show: false }; return }
    const range = sel.getRangeAt(0)
    const root = host.querySelector('.ProseMirror')
    if (!root || !root.contains(range.commonAncestorContainer)) { bubble = { ...bubble, show: false }; return }
    const r = range.getBoundingClientRect()
    if (!r || (r.width < 1 && r.height < 1)) { bubble = { ...bubble, show: false }; return }
    const x = Math.min(Math.max(r.left + r.width / 2, 140), window.innerWidth - 140)
    bubble = { show: true, x, y: Math.max(r.top, 68) }
    refreshActive()
  }

  // ---- commands ----
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
      const res = await fileBridge.save(docName, { html: editor.getHTML(), json: editor.getJSON() })
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
        loadInto(res.html, res.name || 'Untitled')
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
  function loadInto(html, name) {
    editor.commands.setContent(html)
    docName = name; saved = true; touched = false; recount()
    commanderOpen = false
    editor.commands.focus()
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
        loadInto(res.html, res.name || 'Untitled')
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
    if (e.key === 'Escape') {
      if (confirmState) { confirmState = null; return }
      if (commanderOpen) { commanderOpen = false; return }
      setFocus(false); bubble = { ...bubble, show: false }
    }
    if (e.key === 'F11') { e.preventDefault(); setFocus(!focus) }
    if (mod && e.key.toLowerCase() === 'k') { e.preventDefault(); toggleCommander() }
    if (mod && e.key.toLowerCase() === 's') { e.preventDefault(); saveDoc() }
    if (mod && e.key.toLowerCase() === 'o') { e.preventDefault(); openDoc() }
    if (mod && e.key === 'Enter') { e.preventDefault(); setFocus(!focus) }
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
    document.body.setAttribute('data-page-size', pageSize)
    syncPageStyle()
    recents = store.loadRecents()
    const last = store.loadDoc()
    editor = createEditor(host, {
      content: last?.html || WELCOME,
      onUpdate: () => { saved = false; touched = true; recount(); markTyping(); scheduleAutosave(); queueMeasure() },
      onSelection: () => { updateBubble(); litParagraph() },
    })
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
    window.addEventListener('resize', onResize)
    document.addEventListener('selectionchange', onSelectionChange)
    document.addEventListener('mousemove', clearTyping)
    if (isTauri) {
      setupNativeDragDrop()
    } else {
      window.addEventListener('dragover', onDragOver)
      window.addEventListener('dragleave', onDragLeave)
      window.addEventListener('drop', onDrop)
    }
  })

  function onResize() { updateBubble(); measurePages() }

  function onSelectionChange() { updateBubble(); litParagraph() }
  function clearTyping() { if (typing) { typing = false; document.body.classList.remove('typing') } }

  onDestroy(() => {
    editor?.destroy()
    window.removeEventListener('keydown', onKey)
    window.removeEventListener('scroll', updateBubble)
    window.removeEventListener('resize', onResize)
    document.removeEventListener('selectionchange', onSelectionChange)
    document.removeEventListener('mousemove', clearTyping)
    window.removeEventListener('dragover', onDragOver)
    window.removeEventListener('dragleave', onDragLeave)
    window.removeEventListener('drop', onDrop)
    unlistenDragDrop?.()
  })
</script>

<!-- Wordmark doubles as the room/command opener. -->
<button class="whisper wordmark" onclick={() => toggleCommander()} title="Rooms & recents (Ctrl+K)">write</button>

<main>
  <div class="editor-host" bind:this={host}>
    {#if view === 'page'}
      {#each pageRects as r}
        <div class="page-sheet" style="top:{r.top}px; height:{r.height}px">
          {#if guides}<div class="margin-guide"></div>{/if}
          <span class="page-num">{r.n + 1}</span>
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
        {#if view === 'page'}
          <div class="seg">
            <button class:on={pageSize === 'letter'} onclick={() => applyPageSize('letter')}>Letter</button>
            <button class:on={pageSize === 'a4'} onclick={() => applyPageSize('a4')}>A4</button>
          </div>
          <button class="seg-ghost" class:on={guides} onclick={toggleGuides} title="Show margin guides">Margins</button>
        {/if}
      </div>

      <div class="cmd-actions">
        <button onclick={newDoc}>＋ New</button>
        <button onclick={openDoc}>↥ Open…</button>
        <button onclick={saveDoc}>⤓ Save…</button>
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
