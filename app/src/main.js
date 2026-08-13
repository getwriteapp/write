import { mount } from 'svelte'

/* Typography — all bundled locally, zero network dependency, latin-only.
   Every VARIABLE family (the original five and the Session-27 additions) is
   declared in fonts-extra.css with latin + latin-ext faces only. Fontsource's
   own per-family CSS pulls every script it publishes — Cyrillic, Greek,
   Vietnamese, symbols — which was ~1.5 MB of glyphs this app never renders.
   The STATIC families are imported here via their own latin-only per-subset
   files (Fontsource ships those for static families; it does not for variable
   ones, hence fonts-extra.css). iA Writer Quattro lives in fonts.css. */
import './styles/fonts-extra.css'
import '@fontsource/ibm-plex-sans/latin-400.css'
import '@fontsource/ibm-plex-sans/latin-400-italic.css'
import '@fontsource/ibm-plex-sans/latin-600.css'
import '@fontsource/ibm-plex-sans/latin-700.css'
import '@fontsource/atkinson-hyperlegible/latin-400.css'
import '@fontsource/atkinson-hyperlegible/latin-400-italic.css'
import '@fontsource/atkinson-hyperlegible/latin-700.css'
import '@fontsource/atkinson-hyperlegible/latin-700-italic.css'
import '@fontsource/poppins/latin-400.css'
import '@fontsource/poppins/latin-400-italic.css'
import '@fontsource/poppins/latin-700.css'
import '@fontsource/poppins/latin-700-italic.css'
import '@fontsource/reddit-mono/latin-400.css'
import '@fontsource/reddit-mono/latin-700.css'
import '@fontsource/abril-fatface/latin-400.css'
import '@fontsource/instrument-serif/latin-400.css'
import '@fontsource/instrument-serif/latin-400-italic.css'
import '@fontsource/libre-caslon-display/latin-400.css'
import '@fontsource/young-serif/latin-400.css'
import '@fontsource/fjalla-one/latin-400.css'
import './styles/fonts.css'

import './styles/rooms.css'
import './styles/app.css'
import './styles/pages.css'
import App from './App.svelte'

const app = mount(App, { target: document.getElementById('app') })

export default app
