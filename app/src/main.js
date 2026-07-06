import { mount } from 'svelte'

/* Typography — all bundled locally, zero network dependency. */
import '@fontsource-variable/literata'
import '@fontsource-variable/literata/wght-italic.css'
import '@fontsource-variable/source-serif-4'
import '@fontsource-variable/source-serif-4/wght-italic.css'
import '@fontsource-variable/newsreader'
import '@fontsource-variable/newsreader/wght-italic.css'
import '@fontsource-variable/geist'
import '@fontsource-variable/geist-mono'
import '@fontsource/ibm-plex-sans/400.css'
import '@fontsource/ibm-plex-sans/400-italic.css'
import '@fontsource/ibm-plex-sans/600.css'
import '@fontsource/ibm-plex-sans/700.css'
import './styles/fonts.css'

import './styles/rooms.css'
import './styles/app.css'
import './styles/pages.css'
import App from './App.svelte'

const app = mount(App, { target: document.getElementById('app') })

export default app
