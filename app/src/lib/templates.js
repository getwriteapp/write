/* Wave 6: templates — one-click starters offered alongside "＋ New" (which
   stays instant-blank, the fast keyboard-driven path). Each is plain editor
   HTML, same shape as WELCOME, so they load through the exact same
   setContent() path a .docx import uses — no separate machinery. */

export const TEMPLATES = [
  {
    id: 'letter',
    label: 'Letter',
    note: 'A formal letter, ready to address',
    html: `
<p>Your Name<br>Your Address<br>City, State ZIP</p>
<p>${new Date().toLocaleDateString(undefined, { year: 'numeric', month: 'long', day: 'numeric' })}</p>
<p>Recipient Name<br>Recipient Address<br>City, State ZIP</p>
<p>Dear [Name],</p>
<p>Begin the body of your letter here.</p>
<p>Sincerely,</p>
<p>Your Name</p>
`,
  },
  {
    id: 'meeting-notes',
    label: 'Meeting Notes',
    note: 'Attendees, agenda, action items',
    html: `
<h1>Meeting Notes</h1>
<p>Date: · Attendees:</p>
<h2>Agenda</h2>
<ul><li><p>Topic one</p></li><li><p>Topic two</p></li></ul>
<h2>Notes</h2>
<p>Write as you go.</p>
<h2>Action Items</h2>
<ul><li><p>Owner — task</p></li></ul>
`,
  },
  {
    id: 'resume',
    label: 'Resume',
    note: 'Experience, education, skills',
    html: `
<h1>Your Name</h1>
<p>Email · Phone · City</p>
<h2>Experience</h2>
<p><strong>Role — Company</strong><br>Dates</p>
<ul><li><p>What you did and its impact.</p></li></ul>
<h2>Education</h2>
<p><strong>Degree — School</strong><br>Dates</p>
<h2>Skills</h2>
<p>Skill, skill, skill.</p>
`,
  },
  {
    id: 'report',
    label: 'Report',
    note: 'Title, sections, a table of contents',
    html: `
<h1>Report Title</h1>
<p>A one-line summary of what this report covers.</p>
<div data-type="tableOfContents" data-entries='[{"level":2,"text":"Introduction"},{"level":2,"text":"Findings"},{"level":2,"text":"Conclusion"}]'></div>
<h2>Introduction</h2>
<p>Set up the problem or question.</p>
<h2>Findings</h2>
<p>What you learned.</p>
<h2>Conclusion</h2>
<p>What it means and what's next.</p>
`,
  },
  {
    /* A specimen: every feature the editor has, in one multi-page document, so
       typography and pagination can be judged against real running text rather
       than a half-edited welcome page. Deliberately written ABOUT what it's
       demonstrating, so reading it and inspecting it are the same activity.
       Covers: all three heading levels, first-line and block indents, bulleted
       and numbered and nested lists, a blockquote, every character mark, all
       five highlights and all six inks, tab stops, a table, alignment, line
       spacing, a rule, and a manual page break. Long enough to run past three
       pages in Page view, which is what makes break behaviour visible. */
    id: 'specimen',
    label: 'Specimen',
    note: 'Every feature, in running text — for judging type and pagination',
    html: `
<h1>A Specimen</h1>
<p>This document exists to be looked at. It runs every feature the editor has through real sentences, so the type can be judged the way it will actually be read — in paragraphs, at length, with the awkward cases included rather than avoided.</p>
<h2>Running text</h2>
<p>Here is an ordinary paragraph, set at the room's own size and leading. It is long enough to wrap several times, because a line of type cannot be judged in isolation: what matters is the rhythm of many lines stacked together, the colour of the block on the page, and whether the eye can find the start of the next line without effort. Read a few sentences and the measure will either feel comfortable or it will not.</p>
<p data-first-line="1">This paragraph opens with a first-line indent — one press of Tab at the start of a block. Only the first line moves; the rest of the paragraph keeps the left margin, which is how a printed book marks a new paragraph without a blank line between them. It is the older convention, and the quieter one.</p>
<p data-first-line="1">A second indented paragraph, so the pattern reads as a pattern. Consecutive indents like these are the classic setting for continuous prose — novels, essays, anything meant to be read straight through rather than scanned.</p>
<p data-indent="1">This block is indented as a whole: every line sits in from the margin, not just the first. That is the other kind of indent, and the one the Bar's arrow button applies. It is for setting a passage apart — an aside, an example, a quotation you do not want to mark as a quotation.</p>
<p data-indent="2">And this one is indented twice, to show the steps accumulating. Each step is half an inch, matching Word.</p>
<h2>Lists</h2>
<p>Bulleted, for things that have no order:</p>
<ul>
  <li><p>A first item, short.</p></li>
  <li><p>A second item, long enough to wrap onto another line so the hanging indent can be judged — the text should align with itself, not run back under the bullet.</p></li>
  <li><p>A third item, with a nested list beneath it:</p>
    <ul>
      <li><p>A nested item.</p></li>
      <li><p>Another nested item.</p></li>
    </ul>
  </li>
</ul>
<p>Numbered, for things that do:</p>
<ol>
  <li><p>Open a page.</p></li>
  <li><p>Write something true.</p></li>
  <li><p>Take out whatever is not.</p></li>
</ol>
<h2>Emphasis</h2>
<p>The character marks, in a sentence rather than a row: this is <strong>bold</strong>, this is <em>italic</em>, this is <strong><em>both at once</em></strong>, this is <u>underlined</u>, this is <s>struck through</s>, and this is <code>monospaced code</code>. Seen inside running text you can tell whether each one interrupts too much or too little.</p>
<p>Highlights sit behind the words, so the test is whether the band clears the line above: <mark data-color="#FEF08A">sunlight yellow</mark>, <mark data-color="#BBF7D0">a pale green</mark>, <mark data-color="#BFDBFE">a cold blue</mark>, <mark data-color="#F9A8D4">a soft pink</mark>, and <mark data-color="#FED7AA">a warm orange</mark> — all five, in a paragraph that wraps, in a dark room and a light one.</p>
<p>The six inks, likewise: <span style="color: #D64545">red</span>, <span style="color: #BE7016">amber</span>, <span style="color: #2E8B57">green</span>, <span style="color: #3B7DE0">blue</span>, <span style="color: #8E5FD3">violet</span>, and <span style="color: #7C818B">grey</span>. Each should stay legible on white paper and on a dark sheet.</p>
<blockquote><p>A quotation sits in its own space, marked by a rule rather than a punctuation mark. The measure narrows slightly, the voice changes, and the reader knows without being told that someone else is speaking.</p></blockquote>
<h2>Tabs and alignment</h2>
<p>Tab stops fall every half inch, as they do in Word:</p>
<p>Typeface<span style="white-space: pre">\t</span>Role<span style="white-space: pre">\t</span>Year</p>
<p>Quattro<span style="white-space: pre">\t</span>Body<span style="white-space: pre">\t</span>2018</p>
<p>Literata<span style="white-space: pre">\t</span>Book<span style="white-space: pre">\t</span>2019</p>
<p>A tab advances to the next stop, so a word that overruns one lands on the following stop instead — which is why the first column here uses words of a similar length. That is how tab stops behave in Word too, and it is why tabs are not a substitute for a table.</p>
<p style="text-align: center">This line is centred.</p>
<p style="text-align: right">And this one is set to the right.</p>
<p style="text-align: justify">This paragraph is justified, which means the spaces between words stretch so that both edges of the block line up. It needs a few lines to show its character, and its character is the thing worth judging: whether the word spacing stays even or opens into rivers of white running down the page.</p>
<hr>
<div data-type="pageBreak"></div>
<h1>The Second Page</h1>
<p>The break above is a manual one, so this heading starts a fresh sheet no matter how much room was left on the last. Below, a table.</p>
<table><tbody>
<tr><th><p>Room</p></th><th><p>Typeface</p></th><th><p>Character</p></th></tr>
<tr><td><p>Quattro</p></td><td><p>iA Writer Quattro</p></td><td><p>White silence, one blue cursor</p></td></tr>
<tr><td><p>Paper</p></td><td><p>Literata</p></td><td><p>Cream and ink, a printed book</p></td></tr>
<tr><td><p>Noir</p></td><td><p>Newsreader</p></td><td><p>Midnight serif, writing at 1 a.m.</p></td></tr>
</tbody></table>
<h2>Spacing</h2>
<p style="line-height: 1">Set solid, at single spacing. Tight enough that the lines begin to interfere with one another, which is exactly what makes leading visible: you only notice it when there is too little.</p>
<p style="line-height: 1.5">At one and a half, the lines separate and the block opens up. This is the setting most people reach for in a word processor, and it is generous without being loose.</p>
<p style="line-height: 2">And double-spaced, the manuscript convention — room between the lines for a pencil, and for a reader who is going to mark the page.</p>
<h2>Size and voice</h2>
<p><span style="font-size: 10pt">Ten point,</span> <span style="font-size: 12pt">twelve point,</span> <span style="font-size: 16pt">sixteen point,</span> <span style="font-size: 24pt">and twenty-four.</span></p>
<p><span style="font-family: 'Literata Variable', serif">Literata sets a book.</span> <span style="font-family: 'EB Garamond Variable', Garamond, serif">EB Garamond sets an older one.</span> <span style="font-family: 'Geist Variable', sans-serif">Geist is plain and modern.</span> <span style="font-family: 'JetBrains Mono Variable', ui-monospace, monospace">JetBrains Mono is for code.</span></p>
<h2>The library, in running text</h2>
<p>A typeface cannot be judged from its name, or from one line of it. Each paragraph below is the same length and says roughly the same thing, set in a different face — which is the only fair way to compare them. Read two or three sentences of each and one will start to feel like yours.</p>
<h3>Serif — for reading at length</h3>
<p style="font-family: 'Literata Variable', serif"><strong>Literata.</strong> Drawn for screens and for long reading, with sturdy shapes that hold up at small sizes. It was made for an e-reader, and it still behaves like one: unfussy, even in colour, content to disappear while you read.</p>
<p style="font-family: 'Source Serif 4 Variable', serif"><strong>Source Serif.</strong> A workhorse with slightly open, humanist shapes. It is the most neutral serif here — the one to choose when you want the page to look considered but not to announce a period or a mood.</p>
<p style="font-family: 'EB Garamond Variable', Garamond, serif"><strong>EB Garamond.</strong> The old-style classic, redrawn. Small on the body for its size, with real calligraphic movement in the strokes. Everything set in it looks a little like a printed book, which is either exactly right or entirely wrong for what you are writing.</p>
<p style="font-family: 'Crimson Pro Variable', Garamond, serif"><strong>Crimson Pro.</strong> Warmer and rounder than Garamond, with a larger x-height that makes it easier at screen sizes. A good middle ground when the old-style feel is wanted but the reading has to be comfortable.</p>
<p style="font-family: 'Lora Variable', Georgia, serif"><strong>Lora.</strong> Contemporary, with brushed contrast in the strokes and a slight sharpness at the joins. It has more personality than a workhorse serif and still sets a long paragraph without tiring the eye.</p>
<p style="font-family: 'Newsreader Variable', serif"><strong>Newsreader.</strong> Editorial warmth — the voice of a long magazine piece. Narrow enough to fit a lot on a line, with enough character that a page of it looks composed rather than typed.</p>
<h3>Slab — heavier, more mechanical</h3>
<p style="font-family: 'Roboto Slab Variable', Rockwell, serif"><strong>Roboto Slab.</strong> Squared-off serifs on a neutral skeleton. It reads as sturdy and slightly technical, and it makes headings feel solid without shouting. Good for reports and documentation.</p>
<p style="font-family: 'Bitter Variable', Rockwell, serif"><strong>Bitter.</strong> A slab drawn specifically for screens, with a tall x-height and tight spacing. More contemporary than Roboto Slab, and it holds its texture better in a long block.</p>
<h3>Sans — plain speech</h3>
<p style="font-family: 'Geist Variable', sans-serif"><strong>Geist.</strong> Clean, tightly spaced, modern. The default sans here, and the most invisible: nothing about it draws attention to itself, which is usually the point.</p>
<p style="font-family: 'Inter Variable', -apple-system, sans-serif"><strong>Inter.</strong> Designed for interfaces, which means it is exceptionally clear at small sizes. In a document it reads as neutral and slightly technical — the typeface of a well-made application.</p>
<p style="font-family: 'Work Sans Variable', -apple-system, sans-serif"><strong>Work Sans.</strong> Humanist, with a little more warmth in the curves than Inter or Geist. It softens a page of plain prose without becoming friendly to a fault.</p>
<p style="font-family: 'Libre Franklin Variable', -apple-system, sans-serif"><strong>Libre Franklin.</strong> A grotesque in the American newspaper tradition — the family of Franklin Gothic. Sturdier and more opinionated than the neutral sans faces, and very good for headings.</p>
<p style="font-family: 'Archivo Variable', -apple-system, sans-serif"><strong>Archivo.</strong> A grotesque built for high performance in small print and captions. Slightly condensed, so it fits more to the line — useful when the measure is tight.</p>
<p style="font-family: 'Manrope Variable', -apple-system, sans-serif"><strong>Manrope.</strong> Geometric and semi-rounded, with an even, modern rhythm. The most contemporary-feeling sans in the library, and the one that looks least like a word processor.</p>
<p style="font-family: 'IBM Plex Sans', sans-serif"><strong>Plex Sans.</strong> Humanist with a technical edge, drawn as a corporate voice and still legible as one. It has more grain than Geist or Inter, which some documents want.</p>
<p style="font-family: 'Atkinson Hyperlegible', -apple-system, sans-serif"><strong>Atkinson Hyperlegible.</strong> Drawn by the Braille Institute to make letters as distinct from one another as possible — the tail of an l, the shape of a 1, the opening of a c. The kindest face here for tired eyes, and a genuinely different design brief from everything else.</p>
<p style="font-family: 'Figtree Variable', -apple-system, sans-serif"><strong>Figtree.</strong> A soft geometric grotesque built explicitly for product interfaces — the app's own chrome typeface, doing a paragraph's work instead. Calmer than Geist at the same size, without reaching for a display face's personality.</p>
<p style="font-family: 'Source Sans 3 Variable', -apple-system, sans-serif"><strong>Source Sans 3.</strong> Adobe's own workhorse, designed for body copy before anything else. Even and unfussy across a long paragraph, with very few surprises in how one letter sits against the next.</p>
<p style="font-family: 'Nunito Sans Variable', -apple-system, sans-serif"><strong>Nunito Sans.</strong> Rounded terminals, approachable without curdling into cutesy. The library's one genuinely warm, soft-cornered sans — a different register from the grotesques around it.</p>
<p style="font-family: 'Poppins', -apple-system, sans-serif"><strong>Poppins.</strong> Everywhere, which is its own kind of risk — but it is also the one true geometric face here, with a circular o and a single-story a the way Futura's descendants draw them.</p>
<p style="font-family: 'Space Grotesk Variable', -apple-system, sans-serif"><strong>Space Grotesk.</strong> Proportions carried over from a monospace design into a proportional face — real quirk, not just marketing copy. The one face in the library that visibly changes how a page feels to read. Has no italic; Word will slant it synthetically.</p>
<h3>Display — for titles, not for paragraphs</h3>
<p style="font-family: 'Playfair Display Variable', Georgia, serif"><strong>Playfair Display.</strong> High contrast, sharp hairlines, a transitional face in the English tradition. Beautiful large and punishing small — set a title in it and a paragraph in something else.</p>
<p style="font-family: 'Fraunces Variable', Georgia, serif"><strong>Fraunces.</strong> A soft, wobbly old-style with deliberate quirks — it is drawn to have personality rather than to disappear. Excellent for a cover or a heading, and a lot of character to live with across a whole page.</p>
<h3>Typewriter — even rhythm</h3>
<p style="font-family: 'iA Writer Quattro S', monospace"><strong>iA Writer Quattro.</strong> The app's own voice: a duospace face, where most letters share a width but the narrow ones do not, so it keeps a typewriter's rhythm while staying readable as prose.</p>
<p style="font-family: 'JetBrains Mono Variable', ui-monospace, monospace"><strong>JetBrains Mono.</strong> A true monospace drawn for code, with tall lowercase and clearly distinguished characters. In a document it reads as deliberate and a little mechanical.</p>
<p style="font-family: 'Geist Mono Variable', monospace"><strong>Geist Mono.</strong> Tighter and more neutral than JetBrains Mono — the same plainness as Geist, in fixed widths.</p>
<h3>A third-level heading</h3>
<p>Below the second level, for when a section needs dividing but not announcing. It should read as a heading and still sit quietly inside the text around it.</p>
<h2>Enough text to paginate</h2>
<p>What follows is ordinary prose, several paragraphs of it, for one reason: page breaks cannot be judged on a short document. You need enough continuous text that the engine has to decide where a page ends, and enough paragraphs of differing lengths that some of those decisions are awkward.</p>
<p>A page break should never split a paragraph in this editor — a block that will not fit is moved down whole. That is a deliberate limit, and it means a page sometimes ends short of its bottom margin. Watch the foot of each sheet: the gap should look like a margin, not like a mistake.</p>
<p>The junction between two pages is compressed on screen so that typing onto a fresh sheet does not strand you a long way from where you left off. The real margins are unchanged in the file and in print; only the display is tightened. If the gap ever looks crowded or cavernous, that is the number to reach for.</p>
<p>Leading is set from the font's own metrics rather than a fixed multiple, because a typeface's natural line height is part of its design. Two faces at the same point size can want noticeably different spacing, and forcing them into the same measure flatters neither.</p>
<p>Zoom scales the sheet and the text together, so it changes only how large the page appears, never where the page ends. That is the difference between a preview you can trust and one you have to second-guess.</p>
<p>Finally, a last paragraph, so that the document ends on running text rather than a heading — and so there is something here to push the final page over, if it is going to.</p>
`,
  },
]
