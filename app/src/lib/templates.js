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
<p>Highlights sit behind the words, so the test is whether the band clears the line above: <mark data-color="#FEF08A">sunlight yellow</mark>, <mark data-color="#BBF7D0">a pale green</mark>, <mark data-color="#BFDBFE">a cold blue</mark>, <mark data-color="#FBCFE8">a soft pink</mark>, and <mark data-color="#FED7AA">a warm orange</mark> — all five, in a paragraph that wraps, in a dark room and a light one.</p>
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
