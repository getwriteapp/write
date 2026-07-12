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
]
