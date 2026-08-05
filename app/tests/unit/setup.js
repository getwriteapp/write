/* jsdom shims for App.svelte's mount path.
   App.svelte does real layout work on mount (page measurement, font-ready
   callbacks, resize tracking) because Page view has to know actual pixel
   sizes — jsdom computes none of that, it just doesn't implement the APIs at
   all, so mounting throws before a single test assertion runs unless these
   are stubbed. None of this changes what's being tested (the save model);
   it only lets the component reach a mounted state in an environment with no
   rendering engine. */

/* Auto-unmounts whatever the previous test rendered and flushes pending
   Svelte effects first. Without this, App.svelte's window-level listeners
   (keydown, resize, scroll — bound once in onMount, never torn down because
   the real app never unmounts) pile up across tests in the same file: a
   later test's Ctrl+S dispatch fires every earlier test's still-live handler
   too, inflating the very call counts these tests exist to check. */
import '@testing-library/svelte/vitest'
import { beforeEach } from 'vitest'

// Recents/current-doc persistence (store.js) is real localStorage, shared by
// every test in the file unless cleared — carryover would let one test's
// save silently seed the next test's "document" and mask a broken bind.
beforeEach(() => localStorage.clear())

if (!window.matchMedia) {
  window.matchMedia = () => ({
    matches: false,
    media: '',
    addListener: () => {},
    removeListener: () => {},
    addEventListener: () => {},
    removeEventListener: () => {},
    dispatchEvent: () => false,
  })
}

if (!window.ResizeObserver) {
  window.ResizeObserver = class ResizeObserver {
    observe() {}
    unobserve() {}
    disconnect() {}
  }
}

if (!window.IntersectionObserver) {
  window.IntersectionObserver = class IntersectionObserver {
    observe() {}
    unobserve() {}
    disconnect() {}
  }
}

// jsdom lays out nothing, so every element is 0x0 — real enough for the save
// model, which never reads layout, but measurePages()/geom() divide by these
// and a 0 would produce NaN/garbage that trips unrelated assertions.
if (!Element.prototype.getBoundingClientRect || !Element.prototype.getBoundingClientRect.__stub) {
  Element.prototype.getBoundingClientRect = function getBoundingClientRect() {
    return { top: 0, left: 0, right: 100, bottom: 100, width: 100, height: 100, x: 0, y: 0, toJSON() {} }
  }
  Element.prototype.getBoundingClientRect.__stub = true
}

if (!('fonts' in document)) {
  Object.defineProperty(document, 'fonts', {
    value: { ready: Promise.resolve(), addEventListener() {}, removeEventListener() {} },
    configurable: true,
  })
}

// ProseMirror's view checks this on construction; jsdom has no real editing
// host so range/selection plumbing around contenteditable is largely absent.
if (!document.getSelection) {
  document.getSelection = () => ({
    rangeCount: 0,
    getRangeAt: () => null,
    removeAllRanges: () => {},
    addRange: () => {},
  })
}

// jsdom DOES define these already, but only as stubs that print "Not
// implemented" to the console on every call — checking `!window.scrollTo`
// is always false, so that guard would never actually replace them. Real
// no-ops, unconditionally.
window.scrollTo = () => {}
Element.prototype.scrollIntoView = () => {}
