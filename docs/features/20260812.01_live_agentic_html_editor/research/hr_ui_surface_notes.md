# human-review: feature spec of the browser surface

Extracted read-only from `/Users/kennethstclair/.claude/tools/human-review/` (clone of
github.com/petergyang/human-review, v0.4.0). This describes **what the human can do in the page**,
written so a designer or PM can rebuild it. Their file layout and module structure are ignored
deliberately.

Vocabulary used below:

- **Rail** — the review panel pinned to the right of the screen.
- **Document** — the thing being reviewed (an HTML file, a rendered Markdown file, or a live
  localhost route), shown in the remaining space to the left.
- **Block** — the nearest block-level chunk around whatever the user touched (a paragraph, a
  heading, a list, a card, an image). Everything in the edit list is keyed to a block.

---

## 0. The shape of the screen

The window is split into exactly two regions, side by side, full viewport height, no page scroll
on the shell itself:

- **Left, flexible width:** the document, rendered at full fidelity in its own frame with its own
  CSS, fonts and layout. The review tool adds nothing to the document's visual language except a
  yellow highlight for commented text, a thin hover outline, and a few small floating controls.
- **Right, fixed 352px:** the rail.

A **collapse handle** sits on the seam: a 22×46px vertical tab, rounded on its left side only,
centered vertically, showing `›` when open and `‹` when collapsed. Clicking it slides the rail to
zero width (140ms ease-out) and parks the handle at the right screen edge, giving the document the
full window. The collapsed/expanded choice is remembered across sessions.

**Visual language of the chrome** (deliberately *not* the document's language, so the two never
read as one surface): a warm paper palette. Canvas `#eceae4`, rail `#fbfaf7`, cards pure white with
a `#e9e7e0` hairline border and 8px radius, ink `#26241e`, muted text `#8b877d`, hairlines
`#e4e2db`. 13px system UI stack, 1.5 line height, antialiased. Section headers are 11px, 600
weight, uppercase, 0.08em letter-spaced, muted. The one saturated color in the whole product is a
document-marker yellow (`rgba(245,196,0,0.32)` for highlights, `#e0a800` for the active card's left
edge, `#c99500` amber for in-progress dots). Danger is a muted brick `#b23b2e`. The primary button
is near-black `#1b1a16` on cream text, full-width, 6px radius. Everything else is a ghost or link
button. Animation is a single 130ms `rise` (4px up + fade). `prefers-reduced-motion` kills all of
it.

A **theme toggle** (☾ / ☀, 26px rounded-square icon button) sits at the top-right of the rail and
switches *only the chrome* between light and dark. The document is never re-themed; the tool's job
is to leave the artifact looking exactly as it will look standalone. Choice persists.

**Collision avoidance with the host page.** The document lives in its own frame, so the rail's CSS
can never leak into it and the document's CSS can never restyle the rail. The few controls that do
float over the document (hover outline, delete chip, image resize grip, block move handle, link
popup, drop line, cursor hint) live in a shadow root with `all: initial` and z-index at the top of
the stack, so a page with its own aggressive resets or high z-indexes cannot swallow them. They are
also excluded from every text/selection/serialization operation, so they can never end up in a
comment quote, an edit, or the saved file.

---

## 1. The review chrome

### 1.1 Rail, top to bottom

1. **Header: `FEEDBACK` + count + theme toggle.** The count is the number of comments on the page
   currently on screen.
2. **Compose card** (only while composing) — see §2.
3. **Comment cards** — one per comment on this page, newest at the bottom.
4. **Empty state** — a dashed-border, centered, muted box: *"Select text or click an element to
   comment on it."* Shown only when there are zero comments and no compose card open.
5. **`OTHER PAGES` section** (only when the user has left feedback on pages they are not currently
   looking at). Header + count, then one clickable row per page: filename on the left, item count
   on the right. Clicking a row navigates the document to that page.
6. **`YOUR EDITS` section** (only when at least one direct edit exists). Header, count, and a
   `Revert all` link on the right that turns brick-red on hover. Below it, a **save status line**,
   then the edit list.
7. **Footer, pinned to the bottom of the rail** (never scrolls away): the overall-note textarea,
   the Send button, an agent status line, an optional handoff card, and `End review`.

### 1.2 The save status line

A colored 6px dot plus one sentence. The wording is the whole point: it tells the user where their
typing actually goes, which differs by target type.

| Target | Dot | Text |
| --- | --- | --- |
| Static HTML file | green | `Saved to page.html · 3:42 PM` |
| — while writing | amber | `Saving to page.html…` |
| — write failed | red | `Couldn't save — retrying…` |
| Markdown file | amber | `Markdown source — edits go to the agent as feedback` |
| Localhost route | amber | `Localhost page — your direct edits go to the agent for source updates` |
| HTML file that renders itself with JS | amber | `Live page — edits go to the agent, the file is left alone` |

### 1.3 The edit list

One row per edited block: a small colored pip, the block's label, and the edit kind right-aligned
and muted (`edited`, `deleted`, `moved`). Amber pip normally, red pip for a deletion. Only the
first 5 rows show; below them a `N more…` button expands to all and turns into `Show fewer`.

Block labels are how the user recognizes their own edit, and they are chosen in this order:

1. An author-supplied name, if the document marked the region (`data-block="Problem body"` or
   `data-container="Metrics callout"`). Authors of the reviewed document can opt into good labels.
2. For a heading: the heading's own text.
3. Otherwise: `<nearest preceding heading, 26 chars> · <tag><ordinal>` — e.g. `Solution · p 2`.
4. Fallback: the first 40 characters of the block's own text.

A label is **pinned the first time it is computed for that block** and never recomputed while the
page is live, so a block does not sprout three contradictory edit rows as the user retypes it.

### 1.4 The footer

- **Overall note**: a textarea, `Overall note…`, min 58px, auto-growing as you type up to 40% of
  the window height, then scrolls.
- **Send**: full-width black button. Its label is a live status readout (§4).
- **Agent line**: amber dot + *"Feedback delivered — page reloads when fixes land"*, shown only
  while an agent is chewing on a batch.
- **Handoff card**: shown only when feedback was sent and nothing is listening. Title *"Sent — but
  no agent is listening yet."*, body *"Paste this into your agent — Claude Code, Codex, or
  Cursor:"*, then a monospace box containing a ready-to-paste sentence (*"Run `<poll command>
  --timeout 600`, apply the feedback it returns, then keep polling with --ack until I end the
  review."*) and a `Copy prompt` button that flips to `Copied` for 1.6s.
- **End review**: a quiet full-width link-style button that turns red on hover.

### 1.5 Controls that float over the document

All appear on hover, all are 1px-bordered white on a soft shadow:

- **Hover outline** — a 1px `#c2beb4` rounded box, 2px of padding, around the block under the
  cursor. Purely informational: "this is the unit I will act on."
- **Active box** — same box in near-black, marking the element a comment is being composed on or
  the element a selected comment points at.
- **Delete chip** — a 23px white circle with `✕` in brick-red, floating at the block's top-right
  corner, half-overlapping it. Hover fills it red. Deletes the whole block.
- **Move handle** — an 18×24px white pill with a grab cursor on the block's *left* edge, half
  overlapping so the pointer can travel from text to handle without the hover dropping.
- **Resize grip** — a 13px white square with a black border pinned to the bottom-right corner of
  any image or video, `nwse-resize` cursor.
- **Drop line** — a 2px near-black horizontal rule showing where a dragged block will land.
- **Cursor hint** — a small black tooltip that follows the pointer, reading `⌘-click to open` over
  any link or button, or `Drag to move` over an image.
- **Link popup** — a white rounded box with a 224px URL input (`Link to…`), a round apply button
  (`↵`) and a round red remove button (`✕`).

---

## 2. Commenting

### 2.1 Two ways to make a comment

**Selection comment.** Select any run of text in the document. On mouse-up the compose card appears
in the rail with a `Selection` chip. The selection is **left completely alone**: still selected,
still editable, no highlight is written into the document yet. This is deliberate — if the user
actually meant to type over the selection or delete it, they can, and the compose card quietly
retires itself the moment they type.

**Element comment.** Click any block that is not a text selection — an image, a chart, a card, a
table, a section. The block gets the near-black active box, and the compose card appears with an
`Element` chip. The quote line shows the block's *label*, not its text.

### 2.2 The compose card

Header row: the kind chip (`Selection` / `Element`) plus muted instructions *"Click to write · Esc
to dismiss"*. Under it, the quoted text in italic, muted, clamped to 3 lines, with a 2px yellow
left bar (the same yellow as the in-page highlight, which is what visually keys card to page).
Then a 3-row textarea, `What should change?`. Then `Add comment ⏎` (black) and `Cancel` (ghost).

**The card does not steal focus.** Clicking anywhere on the card (except its buttons) focuses the
textarea without disturbing the document's selection.

- `Enter` commits. `Shift+Enter` makes a newline.
- `Esc` cancels, both from the textarea and from anywhere in the shell.
- `⌘Enter` commits the comment *and then* sends the whole batch.
- Starting a second comment while one is half-written auto-commits the first if it has text.
- Typing into the document while a compose card is open dismisses the card.

### 2.3 How a comment sticks to content

On commit, a selection comment wraps its exact text range in a highlight — translucent yellow,
2px radius, pointer cursor, brighter on hover, brightest when the comment is selected. An element
comment stamps an invisible marker on the block instead.

The durable anchor is **the quoted string plus 32 characters of context on each side**. To re-find
it later: look for the exact quote; if it appears more than once, pick the occurrence whose
surrounding text best matches the remembered prefix/suffix; if it does not appear at all, retry
against a whitespace-collapsed copy of the page so a reflow, a reformat, or an agent's rewrap does
not orphan the comment. Element comments re-find their block by a fully-indexed path from the body.

If nothing matches, the comment is marked **orphaned**: a small grey pill badge on its card. It is
not deleted and it still ships to the agent.

### 2.4 Comment cards

`You · 4m` on the left (relative age: *just now*, `Nm`, `Nh`, `Nd`), optional `orphaned` badge,
then `Jump to` and a `✕` delete button on the right. Under the header: the quote in muted italic
with the yellow left bar, clamped to 2 lines. Under that, the user's feedback in normal ink.

- Clicking a card selects it — a 2px amber bar appears inset on the card's left edge and the
  matching highlight in the document brightens.
- `Jump to` also smooth-scrolls the document to the anchor, centered. If the anchor sits inside a
  collapsed accordion or tab, the tool clicks the control that owns it to reveal it first. If the
  target genuinely has no box on screen, a toast says *"That comment is not visible in this view."*
- Clicking the highlight in the document selects the card, the same relationship in reverse.
- **Editing before sending:** click the comment's body text (it shows a soft input-colored hover
  wash and a `Click to edit` tooltip). It becomes a textarea in place. `Enter` commits, `Esc`
  abandons, blur commits, `⌘Enter` commits and sends.
- **Deleting before sending:** the `✕` removes the card and removes the highlight from the document
  in the same motion. No confirmation.

There is no reply, no resolve, no threading, no second author. It is a one-person outbox.

---

## 3. Live editing (the headline)

### 3.1 Entering edit mode

**There is no edit mode.** The entire document is editable from the moment it opens: click anywhere
and type. This is the core product bet — the reviewer's hands never leave the page and there is no
toggle to forget. Spellcheck is forced off so the artifact does not sprout red squiggles.

What is editable: all text content of the document body. What is *not* editable: the review chrome
itself, and anything inside `<script>`/`<style>`/`<template>`.

On a framework-rendered app the editability is re-asserted continuously, so a React/Next hydration
pass that strips the attribute does not silently kill editing halfway through the review.

### 3.2 What normal typing does

Type, select-and-replace, backspace, paste text — all native contenteditable behavior, instant, no
lag, no re-render. Native `⌘Z` / `⌘⇧Z` undo works for typed text (see §3.10 for what it does *not*
cover).

**Inline formatting** — bold, italic, underline via the browser's native `⌘B` / `⌘I` / `⌘U` inside
an editable region. The tool does not implement these itself; it only makes sure the resulting
markup travels to the agent (see §3.8). Practical consequence: exactly what markup you get depends
on the browser, and there is no toolbar and no visible affordance telling the user formatting is
available at all.

### 3.3 Links (⌘K)

Select text and press `⌘K`. A popup opens next to the selection (below it, or above if there is no
room), pre-focused, with the text pre-selected:

- Type a URL and press `Enter` (or click `↵`) to wrap the selection in a link.
- Bare domains are accepted and get `https://` added: `example.com`, `localhost:3000/wiki`.
- Relative paths, `#anchors`, `mailto:` and `tel:` pass through untouched.
- Anything with an executable or unrecognized scheme (`javascript:`, `data:`) is rejected — the
  popup stays open with the text re-selected rather than silently discarding what was typed.
- Empty input + `Enter` dismisses and restores the selection.
- `Esc` dismisses and restores the selection.
- Clicking anywhere in the document dismisses it.
- Scrolling dismisses it (the popup is pinned to the viewport, so once its text scrolls away it
  would be pointing at the wrong thing).

`⌘K` with the caret merely *inside* an existing link (nothing selected) opens the same popup
pre-filled with that link's URL. Editing it **retargets the existing link rather than re-wrapping**,
so the markup does not accumulate nested anchors. The red `✕` in the popup unwraps the link,
leaving the text.

If the page's stylesheet resets link styling so a new link is visually indistinguishable from
prose, the tool adds an underline to that one link so the user can see the action took.

### 3.4 Lists

Three ways in, all borrowed from Docs/Notion so nothing has to be learned:

- Type `- ` or `* ` at the start of a line → bulleted list. Type `1. ` or `1) ` → numbered list.
  The marker text is consumed. This works in front of existing text, not only on empty lines, and
  it deliberately does *not* fire mid-sentence or inside a table cell.
- `⌘⇧8` bulleted, `⌘⇧7` numbered, applied to the current line/selection.
- `Tab` indents inside a list, `Shift+Tab` outdents. Tab never moves focus out of the document.

If the page's CSS reset hides list markers or zeroes the indent (Tailwind preflight and friends), a
just-created list gets its bullets and a 1.5em indent restored so the user sees the change happened.
A list that the browser illegally nested inside a paragraph is hoisted out.

### 3.5 Images

- **Resize**: hover any image or video, grab the square grip at its bottom-right, drag. Width
  follows the pointer with a 24px floor, height stays proportional. One edit row is recorded on
  release.
- **Move**: drag an image and drop it at a caret position anywhere in the document. The target
  block is outlined while you hover it. The image keeps the *rendered* size it had before the move,
  so an image dragged out of a constraining card does not suddenly balloon to full resolution. Two
  edit rows can result: the block it left and the block it landed in.
- **Paste**: paste an image from the clipboard anywhere in the document. It is written to an
  `assets/` folder next to the reviewed file with a derived, collision-free name
  (`page-paste-1.png`), and inserted at the caret at `max-width: 100%`. PNG/JPEG/GIF/WebP only;
  anything else gets a toast. Pasting into a localhost review is refused with an explanation
  (*"for localhost pages, add the image to the app source"*).
- Dragging a file in from the desktop is blocked outright, with a no-drop cursor.

### 3.6 Block-level operations

- **Move a block**: hover any block, grab the handle on its left edge, drag. The block fades to 40%
  opacity while held; a near-black drop line shows exactly where it will land (above or below the
  block under the cursor, decided by which half you are over). Release to relocate. Dropping it
  back where it started is treated as a no-op, not an edit. The block is *relocated*, never cloned,
  so its comments, its pinned label, and its captured original text all survive the move.
- **Delete a block**: hover it, click the red `✕` chip at its top-right. It disappears immediately.
  No confirmation dialog.
- Blocks work at the finest sensible grain: the move handle targets the innermost real block (so a
  single paragraph inside a card can travel on its own) even when edits for that region are
  reported under a coarser author-supplied container name.

### 3.7 What the user must NOT be able to trigger

Since a plain click means "put my caret here", the tool intercepts every plain click in the
document and suppresses the page's own behavior: links do not navigate, buttons do not fire, forms
do not submit. Two deliberate exceptions: native `<summary>` disclosures still toggle (so closed
`<details>` sections can be opened and read), and the tool itself may click an accordion control
when it needs to reveal a commented target. To actually *use* a control, hold ⌘ (see §5).

### 3.8 How an edit is captured

Every edit is recorded as a **before/after pair keyed to a block**:

- `label` — the block's pinned display name.
- `kind` — `edited`, `deleted`, or `moved`.
- `before` / `after` — the block's plain text, before the first change and as it stands now.
- `before_html` / `after_html` — the block's cleaned markup, so formatting-only changes (bold,
  italic, a new link, a resized image) survive even though the plain text is identical. All review
  artifacts are stripped from this markup, so the agent never sees the tool's own scaffolding.
- For a move: `moved_after` / `moved_before` — the first 90 characters of the blocks it now sits
  between, which is how the agent relocates it in the source without rewriting it.

The `before` text is snapshotted the first time a block is touched, so it stays the *original*
wording no matter how many times the user retypes. Multiple edits to one block collapse into one
row whose `after` is always the latest wording.

### 3.9 When edits are flushed

Two independent debounce timers:

- Edit rows are batched and pushed after **500ms** of quiet.
- The whole document is re-serialized and written to disk after **700ms** of quiet (static HTML
  files only).

Deletions and block moves flush both immediately, because the user needs to see the row appear the
instant the block vanishes.

**Navigation mid-edit** flushes everything first and waits for confirmation (with a 400ms ceiling)
before tearing the document down, so the last few keystrokes are not lost to the debounce window.
`End review` does the same. `⌘S` is reassurance only: it flushes pending keystrokes and repaints
the save line, and changes nothing else. (See Sharp edges — the Send button does *not* do this.)

### 3.10 Undo, revert, and feedback that an edit landed

The only visible confirmation that an edit was captured is the row appearing in `YOUR EDITS` and
the save line flipping amber then green with a timestamp. There is no per-edit undo, no per-edit
revert, and no diff view. The only bulk escape hatch is **`Revert all`**, which confirms
(*"Discard all N of your edits?"*), restores the file to the version the agent last wrote, empties
the edit list, and reloads the document.

Native `⌘Z` covers typed text. It does **not** cover: block delete, block move, image resize, or
link removal — those are structural changes made outside the browser's undo stack, and each has
already been written to disk by the time the user regrets it. Their only recovery is `Revert all`,
which throws away every other edit too.

---

## 4. Sending

### 4.1 The Send button is the status readout

One full-width black button at the bottom of the rail. Its label is always the truth about what
would happen:

| Situation | Label | Enabled |
| --- | --- | --- |
| Nothing yet | `Nothing to send yet` | no |
| Items pending | `Send 4 to agent  ⌘⏎` | yes |
| Only an overall note typed | `Send note to agent  ⌘⏎` | yes |
| Just sent, agent has it | `Sent — waiting for agent` | no |
| Sent, nothing listening | `Sent — agent is not listening` | no |
| Agent working, nothing new | `Feedback delivered` | no |

The count is **comments + edits on this page + all items on every other page visited**. When
enabled, the button carries a faint `⌘⏎` hint.

`⌘Enter` sends from anywhere: the rail, the compose box, an open comment editor, or from inside the
document itself. When pressed from a compose box or comment editor, the in-progress text is
committed first, so the batch is never missing the comment the user just finished typing.

**A disabled Send never fails silently.** Pressing `⌘Enter` when Send is disabled raises a toast
explaining why: *"Nothing to send yet"*, *"Feedback was sent, but no agent is listening"*, *"This
batch was already sent"*, or *"The agent is still working through the last batch. This will send
once it finishes."* (The stated design rationale is that a silent no-op is what teaches people to
stop trusting the key.)

### 4.2 What a send is

One batch, always **everything**, for every page the user visited this session, grouped by target,
plus the overall note. There is no partial send, no per-item checkbox, no "send just this comment".
A note with no comments or edits is a valid send on its own. After sending, the note box clears.

### 4.3 What the user sees after sending

Send goes dead and re-labels itself. The agent line appears: amber dot, *"Feedback delivered — page
reloads when fixes land."* If nothing was listening, the handoff card appears instead with the
copy-paste prompt. When the agent finishes and acknowledges, the sent items disappear from the rail
and the page reloads with the agent's version. Anything the user added *after* pressing Send
survives that cleanup and stays queued for the next batch.

### 4.4 End review

`End review` confirms first, and the confirmation states the stakes: *"End this review? 3 unsent
items will be kept for next time."* (or, with nothing pending, *"The waiting agent will be told to
stop polling."*). On confirm, pending keystrokes are flushed, the agent is released with an explicit
stop instruction rather than being left to burn its timeout, and the whole window is covered by a
full-bleed overlay: **"Review ended"** / *"Unsent feedback is saved and ships next time you review
this page. You can close this tab."* Nothing is clickable afterwards. If two windows are open on
the same review, ending one shows the same overlay in the other.

---

## 5. Navigation

The rule: **hold ⌘ (or Ctrl) and click a link** to actually follow it. A plain click is editing.
The hover hint over every link says `⌘-click to open`, so the rule is discoverable without docs.

| Link type | ⌘-click behavior |
| --- | --- |
| Another local HTML or Markdown file | Opens in the same review window and joins the session. Feedback from every page visited stays in one batch. Blocked for non-page files. |
| In-page `#hash` | Sets the real hash if it differs (so single-file sites that route by `:target` actually change section), otherwise smooth-scrolls to the element. |
| `http(s)://` or `mailto:` | Opens in a new browser tab, outside the review entirely. |
| A route on the reviewed dev server | Fetches that route and reviews it, same window, same batch. |

Before any in-session navigation the document flushes its pending edits and saves, so the last
keystrokes are not lost to the teardown. Scroll position is remembered per page and restored on
return; comments re-anchor themselves on arrival.

Pages you have left feedback on but are not looking at surface in the `OTHER PAGES` section with
their item counts — clicking one jumps straight back to it.

---

## 6. Reviewing a live web app

Point the tool at a localhost route instead of a file. What changes:

- **The real route is fetched and reviewed**, with the app's own origin preserved so its routing and
  scripts work, and asset URLs rewritten so the app's CSS, images and fonts load from the dev server
  rather than 404ing. The address bar inside the frame is restored to look like the real route.
- **Editing still works exactly the same.** Typing, deleting blocks, moving blocks, links, lists,
  image resizing — all identical.
- **Nothing is ever written back.** The rendered HTTP response is not a source file, so writing the
  serialized DOM back would be nonsense. The save line says so explicitly: *"Localhost page — your
  direct edits go to the agent for source updates."* Every edit travels as a before/after pair for
  the agent to apply to the matching MDX/TSX/template/component.
- **`Revert all` is unavailable** — there is no file to restore.
- **Image paste is refused** with an explanation pointing at the app source.
- **The page's own interactivity is off** by default (links, buttons and forms are suppressed so
  clicks can mean "place caret"); ⌘-click is the escape hatch to actually use a control or follow a
  route.
- After the agent applies the changes and acknowledges, the route is re-fetched — the reload is
  driven by the acknowledgement rather than by a file change.
- On returning to a dev-server page, the app renders its own (unedited) copy again, which reads as
  data loss, so the tool proactively toasts: *"This page renders from your dev server — 6 edits are
  queued for the agent."*

The same feedback-only treatment applies to two other cases the user will hit:

- **Markdown files** open rendered with a clean reading stylesheet (72ch measure, system font,
  styled tables/code/blockquotes). Embedded raw HTML in the Markdown is shown as inert text, never
  executed. The `.md` file is never touched during review; edits ship to the agent to apply to the
  Markdown source.
- **HTML files that render themselves with JavaScript** (charts, Mermaid, client-rendered apps) are
  detected — by comparing the live document against the file on disk, and by watching for any
  scripted DOM change before the user's first edit — and demoted to feedback-only, because
  serializing the rendered output back over the source would bake the output into the file. Save
  line: *"Live page — edits go to the agent, the file is left alone."*

---

## 7. Empty and edge states

| State | What the user sees |
| --- | --- |
| Nothing selected, no comments | Dashed empty box: *"Select text or click an element to comment on it."* |
| Comments exist, none selected | Cards with no left bar; no highlight is brightened. |
| No edits yet | The whole `YOUR EDITS` section, including the save line, is absent. |
| No agent listening, before sending | Send still works. Nothing warns you in advance. |
| No agent listening, after sending | Handoff card with the exact copy-paste prompt and a Copy button. Send is disabled and reads `Sent — agent is not listening`. |
| Agent working | Amber dot, *"Feedback delivered — page reloads when fixes land."* |
| Agent rewrote blocks you had edited | Toast: *"Agent rewrote 3 blocks you had edited."* The agent's version wins. |
| Comment anchor no longer findable | Grey `orphaned` badge on the card. It still sends. |
| Comment target hidden in a collapsed section | The tool tries to open it; failing that, toast *"That comment is not visible in this view."* |
| Save failed repeatedly | Red dot, *"Couldn't save — retrying…"*, then a toast: *"Couldn't save — your edits still reach the agent as feedback."* |
| Agent wrote the file first | The tool's own pending save is abandoned; the agent's version arrives as a reload. |
| Session ended (here or in another window) | Full-screen **Review ended** overlay. |
| Page reloaded mid-review | Comments and edits are server-side, so they survive a browser refresh and re-anchor themselves; the agent state and handoff card are re-derived from the server. Anything still inside the 500/700ms debounce windows at the moment of reload is lost. |

---

## Sharp edges

Concrete in-page mechanisms that produce the three complaints. Each of these is something we must
design out, not port.

### A. Typed text getting reverted

1. **The rail rebuilds its entire comment list on every repaint, destroying open textareas.** Any
   repaint wipes and re-creates every comment card from scratch. If the user has clicked a comment
   body to reword it, that inline textarea is destroyed and their partial rewording is thrown away
   (it is only committed on Enter or blur, and a destroyed node never blurs). Repaints fire on:
   every keystroke in the overall-note box, every arriving edit-flush response (i.e. **every 500ms
   while the user types in the document**), every agent-status change, and every comment
   add/delete. So the failure is near-guaranteed: start rewording a comment, glance back at the
   document and type one character, and the reworded comment reverts to its old text.
2. **The compose textarea is force-cleared on every repaint where no compose is open.** Any race
   that drops the compose state mid-typing silently blanks what was typed into it.
3. **The reload path throws away the live document wholesale.** When the file changes on disk (the
   agent writing, a formatter, a build step, git checkout), the frame is re-pointed at the file and
   the entire in-memory document — including anything typed inside the last 700ms debounce window,
   and anything typed while the fetch is in flight — is gone. There is no merge and no prompt. The
   file watcher polls every 400ms, so the window is wide. The only signal is a toast, and only when
   the edit list happened to be non-empty.
4. **A save that loses the optimistic-concurrency check is silently discarded.** Each save carries
   the hash of the file version it was based on. If the file changed underneath, the server rejects
   it and the client **abandons the save with no retry and no toast** — and resets the status to
   "saved" with the *old* timestamp. The user's typing is gone and the rail claims it is saved.
5. **On a framework-rendered app, the framework itself reverts typed text.** Editability is forced
   back on after hydration, but the app's own re-renders (state updates, hover, data fetches,
   timers) replace subtrees the user typed into, because the framework's virtual DOM has no idea
   the text changed. The tool watches for scripted DOM changes only *until the first user edit*,
   then stops watching — so a re-render that clobbers typing after that point is never even noticed
   or reported.
6. **Edit rows collapse on label collision.** Rows are deduped by `label + kind`. Labels are
   derived from the nearest preceding heading plus a same-parent ordinal, so two paragraphs in
   different containers under the same heading can produce the *same* label — and the second one's
   `after` silently overwrites the first's. Same for two deletions. The user sees one row and the
   agent receives one change; the other edit is simply gone.
7. **Serialization is a full round-trip through the browser's HTML serializer.** One keystroke in a
   hand-written HTML file rewrites the entire file in browser-normalized form (entity encoding,
   attribute quoting, whitespace, void elements). It is not a targeted patch. A no-op is detected
   and skipped, but any real edit rewrites everything, which makes the diff unreviewable and makes
   an accidental regression impossible to spot.

### B. The Send button silently stopping

1. **Send latches off after one press and only unlatches on specific events.** Pressing Send sets a
   "sent" latch that disables the button. The latch clears only when a new comment is added, a
   comment is edited, an edit-flush lands, or the agent acknowledges. **Typing in the overall-note
   box does not clear it** — so the very common "send, then think of one more overall note, type
   it, press Send" flow finds a dead button. The label says `Sent — waiting for agent`, which reads
   like a transient state rather than "you are blocked."
2. **The stranded state disables Send permanently.** If feedback was sent while nothing was
   listening, Send is hard-disabled with `Sent — agent is not listening` **regardless of how much
   new feedback is added afterwards**. The user can keep commenting and editing all day and the
   button never re-enables; the count in the label does not even update. The only way out is to
   start an agent poll (which the user may not realize, and which the handoff card explains only if
   they read it).
3. **The session can silently expire underneath the page.** A window whose live connection has been
   down for 30 minutes is forgotten server-side. Laptop sleep does exactly this. On wake the page
   looks completely normal — cards, edits, Send all present — but every request now fails, so Send
   produces a toast and nothing else, and there is no "your session ended, reopen" state.
4. **Send does not flush pending edits.** `⌘Enter`, navigation, and End review all flush the two
   debounce windows first. **Clicking the Send button does not.** Type a sentence and click Send
   inside half a second and that sentence is not in the batch — the user sees it on screen, the
   agent never receives it, and the edit row may not even exist yet.

### C. General flakiness

1. **Every mouse-up in the document opens a compose card.** Clicking to place a caret resolves the
   block under the cursor and pops an `Element` compose card in the rail. The rail flickers
   constantly during ordinary editing, and a stray click while a comment is half-typed auto-commits
   that half-typed comment as a real comment.
2. **The "original" text for a before/after pair is captured per document instance.** After any
   reload it resets, so an edit made after a reload reports the post-reload text as its "before".
   Combined with label pinning also resetting on reload, one block edited across two reloads can
   yield two rows with overlapping, contradictory before/after pairs.
3. **The generic input handler can emit an empty edit row.** When it cannot resolve a block it
   queues a row labelled `Document body` with no before and no after — a visible row in the rail
   that carries nothing the agent can act on.
4. **Highlight wrapping can fail silently.** Wrapping a selection that crosses element boundaries
   can be impossible; those pieces are skipped without any error, and the comment quietly orphans.
5. **Orphaned comments still ship with a quote that no longer exists**, while the agent's
   instructions assert the quoted string is in the file. The agent then either guesses or does
   nothing.
6. **Image-move recovery finds the landed image by URL.** If the same image appears twice in the
   destination block, the wrong copy gets pinned to the dragged one's width.
7. **Lists, indent, links and native bold/italic all ride on the browser's legacy editing commands**
   — deprecated, and behaviorally different across browsers. Markup produced for the same gesture
   is not stable, which shows up downstream as inconsistent formatting in the agent's edits.
8. **Two polling loops run continuously:** the file is stat-polled every 400ms per reviewed page,
   and heartbeats run every 15s on both the browser stream and any waiting agent. On a slow or
   networked filesystem the stat poll is the expensive one.
9. **A revert can race an in-flight save.** Revert cancels the pending timers, but a save request
   already on the wire can still land afterwards and write the reverted edits straight back.
10. **The status line only exists when the edit list does.** The `YOUR EDITS` section is hidden with
    zero edits, and the save status line lives inside it — so a save failure before the first
    successful edit row has nowhere to display.

---

## What is worth adopting

- No edit mode. The document is live from the first click. This is the whole product.
- Before/after pairs keyed to a *named block*, with plain text and cleaned markup carried
  separately, plus explicit `moved_after` / `moved_before` for relocations.
- Quote + 32-char context anchoring with a whitespace-collapsed fallback, and an honest `orphaned`
  badge rather than a silent drop.
- Telling the truth about where edits go, per target type, in one sentence on screen at all times.
- ⌘-click as the single "actually use the page" modifier, with a hover hint that teaches it.
- Author-supplied region names (`data-block` / `data-container`) so the edit list reads in the
  document's own vocabulary.
- A disabled primary action that explains itself with a toast instead of no-oping.
- Naming the agent states honestly: listening / working / not listening, with a copy-paste recovery
  prompt for the last one.
