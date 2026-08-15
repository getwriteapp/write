/* Component-tier coverage for the Session 35 save-model rework in
   App.svelte (saveDoc/saveDocAs/writeFileTo/bindSaved/commitRename/
   guardThen, the saveState/saveLabel derivation). Before this file, every
   one of these invariants was verified by clicking through the app by hand —
   an audit found zero automated coverage on the file-I/O boundary itself.

   This mounts the REAL App.svelte (real Tiptap/ProseMirror editor, real
   Svelte reactivity) against a MOCKED fileBridge, and drives it the way a
   user would: keyboard shortcuts and real button clicks read back out of the
   DOM. The save/open/rename functions are never exported — the component's
   script has no `export`s to reach into — so going through the DOM isn't a
   workaround, it's the only surface that exists, and it happens to also be
   the surface an audit can trust: what's asserted here is what's on screen.

   Driving typed content: rather than simulate keystrokes into ProseMirror's
   contenteditable (unreliable in jsdom — real typing relies on browser input
   events jsdom does not fully implement), tests call the same dev-only
   `window.__write.editor` handle editor.js exposes for exactly this reason
   (see its comment: "a way to reach ProseMirror from the automation
   harness"). editor.commands.insertContent() runs a real ProseMirror
   transaction, which is what actually fires the onUpdate that flips
   `touched` — so this exercises the real trigger, not a stand-in for it. */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { render, fireEvent } from '@testing-library/svelte'

vi.mock('../../src/lib/bridge.js', () => ({
  fileBridge: {
    saveAs: vi.fn(),
    saveTo: vi.fn(),
    open: vi.fn(),
    openPath: vi.fn(),
    openFile: vi.fn(),
  },
  isTauri: false,
  DOC_EXT_RE: /\.(docx|html?|txt|md)$/i,
  /* Mirrors the real module. App.svelte's drop handlers call .test() on this,
     so a mock that omits it fails as a confusing "cannot read properties of
     undefined" the moment someone adds the first drop test — not here. */
  LEGACY_DOC_RE: /\.doc$/i,
}))

import { fileBridge } from '../../src/lib/bridge.js'
import App from '../../src/App.svelte'

/* vi.mock's factory runs once per file, so the same fn instances are reused
   test to test — reset explicitly rather than trust it, since a leftover
   mockResolvedValue from one test silently changes what the NEXT test's
   save actually does (call count and resolved value both), and that's
   exactly the kind of false pass a save-model suite must not produce. */
beforeEach(() => vi.resetAllMocks())

// silence the "swallow and toast" console.error the app deliberately logs
// on a failed/rejected save (see writeFileTo) — expected in the rejection
// test below, not a sign anything is broken.
const consoleErrorSpy = () => vi.spyOn(console, 'error').mockImplementation(() => {})

const tick = (ms = 0) => new Promise((resolve) => setTimeout(resolve, ms))
const saveStateOf = () => document.querySelector('.save-state')?.dataset.state
const findButton = (text) => [...document.querySelectorAll('button')].find((b) => b.textContent.includes(text))

/* Ctrl+S is how a real user saves; App.svelte listens for it on window in
   onMount, so dispatching it there — not calling a function — is what
   exercises the real routing decision (saveDoc: filePath ? saveTo : saveAs). */
async function pressCtrlS() {
  await fireEvent.keyDown(window, { key: 's', ctrlKey: true })
  await tick()
}

function type(text) {
  window.__write.editor.commands.insertContent(text)
}

async function openCommander() {
  await fireEvent.keyDown(window, { key: 'k', ctrlKey: true })
}

/* Common setup for tests that need to start from an already-bound document:
   type something, Ctrl+S while unbound routes to Save As, and the mocked
   resolution binds the doc to DOC_PATH. Every caller gets a document whose
   next Ctrl+S should go straight to saveTo. */
const DOC_PATH = 'C:/docs/Untitled.docx'
async function bindDocument() {
  fileBridge.saveAs.mockResolvedValueOnce({ name: 'Untitled', path: DOC_PATH })
  type('hello world')
  await tick()
  await pressCtrlS()
}

describe('save routing (Ctrl+S)', () => {
  it('a never-saved document routes Ctrl+S to Save As', async () => {
    render(App)
    type('hello world')
    await tick()

    await pressCtrlS()

    expect(fileBridge.saveAs).toHaveBeenCalledTimes(1)
    expect(fileBridge.saveTo).not.toHaveBeenCalled()
  })

  /* The headline behaviour of the whole rework: once a document has a home,
     Ctrl+S must never ask again. Two more edit+save cycles after the first
     bind, and Save As must still show exactly the one call it made to
     establish that home — not one per save. */
  it('a document already bound to a path routes Ctrl+S to saveTo and never asks again', async () => {
    render(App)
    fileBridge.saveTo.mockResolvedValue({ name: 'Untitled', path: DOC_PATH })
    await bindDocument()
    expect(fileBridge.saveAs).toHaveBeenCalledTimes(1)

    type(' — more text')
    await tick()
    await pressCtrlS()

    type(' — and more')
    await tick()
    await pressCtrlS()

    expect(fileBridge.saveAs).toHaveBeenCalledTimes(1) // still just the one bind
    expect(fileBridge.saveTo).toHaveBeenCalledTimes(2)
    expect(fileBridge.saveTo).toHaveBeenNthCalledWith(1, DOC_PATH, expect.anything())
    expect(fileBridge.saveTo).toHaveBeenNthCalledWith(2, DOC_PATH, expect.anything())
  })
})

describe('bindSaved', () => {
  it('binds filePath to the path the bridge actually returned, and clears touched', async () => {
    render(App)
    // deliberately different from any name the component invented, so a
    // pass here means bindSaved trusted the bridge's answer, not a guess
    const returnedPath = 'D:/elsewhere/Renamed By Dialog.docx'
    fileBridge.saveAs.mockResolvedValueOnce({ name: 'Renamed By Dialog', path: returnedPath })
    type('hello world')
    await tick()

    await pressCtrlS()

    expect(saveStateOf()).toBe('saved') // touched cleared, filePath set → 'saved'
    fileBridge.saveTo.mockResolvedValueOnce({ name: 'Renamed By Dialog', path: returnedPath })
    type(' more')
    await tick()
    await pressCtrlS()
    expect(fileBridge.saveTo).toHaveBeenCalledWith(returnedPath, expect.anything())
  })
})

describe('saveTo rejection', () => {
  it('falls back to Save As instead of dying when the fs grant has expired', async () => {
    const errSpy = consoleErrorSpy()
    render(App)
    await bindDocument()
    expect(saveStateOf()).toBe('saved')

    fileBridge.saveTo.mockRejectedValueOnce(new Error('grant expired'))
    fileBridge.saveAs.mockResolvedValueOnce({ name: 'Untitled', path: 'C:/docs/Untitled-2.docx' })
    type(' more, after the grant died')
    await tick()

    await pressCtrlS()
    await tick(50) // the fallback is a second await inside the catch handler

    expect(fileBridge.saveTo).toHaveBeenCalledTimes(1) // the doomed attempt
    expect(fileBridge.saveAs).toHaveBeenCalledTimes(2) // 1 to bind + 1 fallback
    // recovered, not stuck: the fallback's own resolution re-binds the doc
    expect(saveStateOf()).toBe('saved')
    errSpy.mockRestore()
  })
})

describe('renaming unbinds', () => {
  it('commitRename clears filePath, so the next save asks where the new name should go', async () => {
    render(App)
    await bindDocument()
    expect(saveStateOf()).toBe('saved')

    await fireEvent.click(findButton('Untitled')) // the .doc-name button, showing the current name
    const input = document.querySelector('.name-input')
    expect(input).toBeTruthy()
    await fireEvent.input(input, { target: { value: 'A New Name' } })
    await fireEvent.keyDown(input, { key: 'Enter' })
    await tick()

    // unbound: never 'saved' with no file, and the old-name overwrite path is closed
    expect(saveStateOf()).not.toBe('saved')

    fileBridge.saveAs.mockResolvedValueOnce({ name: 'A New Name', path: 'C:/docs/A New Name.docx' })
    await pressCtrlS()

    expect(fileBridge.saveAs).toHaveBeenCalledTimes(2) // original bind + the post-rename ask
    expect(fileBridge.saveTo).not.toHaveBeenCalled()
  })
})

describe('opening a recent', () => {
  it('loads the document unbound, even when it replaces an already-bound one', async () => {
    // a recent is a localStorage draft with no path (see store.js/pushRecent)
    // — seeding it directly is the honest way to get one on screen without
    // waiting out the real 900ms autosave debounce.
    localStorage.setItem(
      'write:recents',
      JSON.stringify([{ name: 'Old Draft', html: '<p>something from before</p>', savedAt: Date.now(), words: 3 }]),
    )
    render(App)
    await bindDocument() // start from a document that DOES have a file, to prove opening a recent overrides it
    expect(saveStateOf()).toBe('saved')

    await openCommander()
    await fireEvent.click(findButton('Old Draft'))
    await tick()

    expect(saveStateOf()).not.toBe('saved') // no path — the old binding did not carry over

    fileBridge.saveAs.mockResolvedValueOnce({ name: 'Old Draft', path: 'C:/docs/Old Draft.docx' })
    await pressCtrlS()

    expect(fileBridge.saveAs).toHaveBeenCalledTimes(2) // original bind + this ask
    expect(fileBridge.saveTo).not.toHaveBeenCalled()
  })
})

describe('new document / template clears binding', () => {
  it('"+ New" unbinds an already-saved document', async () => {
    render(App)
    await bindDocument()
    expect(saveStateOf()).toBe('saved')

    await openCommander()
    await fireEvent.click(findButton('New'))
    await tick()

    expect(saveStateOf()).not.toBe('saved')
    fileBridge.saveAs.mockResolvedValueOnce({ name: 'Untitled', path: 'C:/docs/Untitled-3.docx' })
    await pressCtrlS()
    expect(fileBridge.saveAs).toHaveBeenCalledTimes(2)
  })

  it('loading a template unbinds an already-saved document', async () => {
    render(App)
    await bindDocument()
    expect(saveStateOf()).toBe('saved')

    await openCommander()
    await fireEvent.click(findButton('Letter')) // one of TEMPLATES (templates.js)
    await tick()

    expect(saveStateOf()).not.toBe('saved')
    fileBridge.saveAs.mockResolvedValueOnce({ name: 'Untitled', path: 'C:/docs/Untitled-4.docx' })
    await pressCtrlS()
    expect(fileBridge.saveAs).toHaveBeenCalledTimes(2)
  })
})

/* guardThen is the discard guard every one of the "clears binding" actions
   above routes through (New/Open/templates/recents). The tests above never
   see its confirm surface because bindDocument() leaves the doc untouched
   (touched cleared by bindSaved) before the next action runs — this is the
   one test that actually has unsaved work in flight when a destructive
   action is requested. */
describe('discard guard (guardThen)', () => {
  it('asks before discarding unsaved edits, and Cancel keeps them', async () => {
    render(App)
    type('unsaved work that never touched a file')
    await tick()
    expect(saveStateOf()).not.toBe('saved')

    await openCommander()
    await fireEvent.click(findButton('New'))
    await tick()

    const confirmCard = document.querySelector('.confirm-card')
    expect(confirmCard).toBeTruthy()
    // still the pre-New content — New was never actually run
    expect(window.__write.editor.getText()).toContain('unsaved work')

    await fireEvent.click(findButton('Cancel'))
    await tick()
    expect(document.querySelector('.confirm-card')).toBeFalsy()
    expect(window.__write.editor.getText()).toContain('unsaved work')
  })

  it('Discard proceeds with the destructive action', async () => {
    render(App)
    type('unsaved work that never touched a file')
    await tick()

    await openCommander()
    await fireEvent.click(findButton('New'))
    await tick()
    await fireEvent.click(findButton('Discard'))
    await tick()

    expect(document.querySelector('.confirm-card')).toBeFalsy()
    expect(window.__write.editor.getText()).not.toContain('unsaved work')
  })
})
