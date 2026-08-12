# Feature Brief: Live Agentic HTML Editor

## Context

Ken reviews a lot of pages: specs and reports his agents wrote, landing pages, and features running on a
dev server. The tool he uses today is a **comments module**, a script that lives in the page. Highlight a
passage, press a key, type a note. It exists in two shapes, one baked into built documents and one
injected into every page of the Steady Thread dev server, and it is reliable for one specific reason:
**it does not depend on anything being alive.** Notes save to the browser on every keystroke, post to a
local helper when one is running, and can be copied or exported when one is not.

What it cannot do is let him fix the wording by typing the better wording.

**human-review** (Peter Yang's tool, MIT, github.com/petergyang/human-review) can. It makes the page
editable, so a reviewer corrects a sentence by typing it rather than describing it, and hands the agent
before-and-after pairs. That is the missing half: typing the correction is faster than writing a comment
about the correction, and it carries the reviewer's exact words instead of a paraphrase.

It has not held up. Text Ken typed came back reverted, the send control stopped working, the reviewed app
stopped responding to clicks, and agents did not reliably collect the feedback. Those are not random. The
reviewer's work lives in short-lived places and routine events empty them: an agent writing a file clears
pending edits by design, the send button is disabled whenever no agent process is blocked on a read, and
delivery depends on an agent holding a foreground process open across a turn, which agents do not do.

::: callout-flag
Their **storage** design is careful and well tested. Their **liveness** design, the part deciding when
work moves from the screen into storage, has no browser-level test at all, and every symptom lives there.
Our comments module survives because it barely has a liveness layer.
:::

## Goal / Problem

Build **a standalone JavaScript library that anyone adds to any HTML page with one script tag**, to
comment on that page and edit it live, plus a small local server the library posts to. Everything the
reviewer leaves is written to a file their coding agent reads.

That is the whole product. One script tag, one background process, one file the agent reads. It is our
comments module with live editing added, packaged so Ken, his students, and anyone else can wire it into
their own pages.

The bar is not features, it is trust. A reviewer has to spend an hour leaving feedback and never once
wonder whether it survived.

## Non-Goals

::: callout-nongoal
- **Not a workflow tool.** It does not know about feature-forge, research reports, build pipelines, or
  any particular document type. A page is a page.
- **Not something that writes into an agent's configuration.** No installing skill files, no editing
  instruction files, no assumptions about which agent the reviewer uses. The agent contract is a file on
  disk; how a reviewer points their agent at it is their business.
- **Not a build-step dependency.** Adding the library to a page must not require the host page to have a
  bundler, a package manager, or a build.
- Not multiplayer. One reviewer, one outbox. No replies, no threads, no second author.
- Not a CMS, a page builder, or a design tool. It edits the words and arrangement of a page that already
  exists. No color pickers, no spacing controls, no CSS editing, and no theming of the reviewed page.
- Not a hosted service. Everything runs on the reviewer's own machine against their own pages.
- Not Markdown. Cut on Ken's call: a Markdown file is already easy to edit in an editor. Every target is
  HTML.
- Not reviewing pages the reviewer did not produce. v1 assumes the page is the reviewer's own.
- Not mobile, and not Windows in v1. macOS first, Chromium only.
- Not an agent. It collects feedback and hands it off. Applying it is the agent's job.
:::

## User Stories

- **As Ken reviewing a built spec his agent wrote**, I want to fix a clumsy sentence by typing the better
  sentence into the page, so the agent gets my exact words instead of a note describing them.
- **As Ken reviewing a feature on his dev server**, I want to move through real screens behind a login,
  leaving comments and typed fixes, and send the whole walk at once.
- **As Ken mid-review**, I want to click a button in the app to reach the next screen without leaving the
  review or losing what I typed.
- **As Ken mid-review**, I want certainty that closing my laptop, an agent saving a file, or a server
  restarting cannot take back anything I already typed.
- **As Ken with no agent running**, I want to send anyway and have it waiting when I next start one.
- **As Ken watching an agent work**, I want handled items to clear off the page so what is left on screen
  is what is still outstanding.
- **As a coding agent**, I want feedback as a file naming each page, quoting what each comment is about,
  and giving before and after text for each edit, so I make targeted changes instead of regenerating a
  document.
- **As a coding agent that finished**, I want to report which items I applied and which I could not, and
  why, so nothing is marked handled that was not.
- **As one of Ken's students**, I want to add one script tag to my own page, start one process, and be
  reviewing, without learning a workflow.

## Requirements

### The library

::: callout-req
**R1: One script tag, any HTML page.** Adding the library is one line in the page's markup. It needs no
bundler, no package manager, and no build step in the host page.
:::

::: callout-req
**R2: Configuration travels on the tag.** Where the server is, and which review this page belongs to, are
attributes on the script tag. There is no config file to create and no project to register.
:::

::: callout-req
**R3: The library does not disturb the page it is in.** It adds no stylesheet over the content, overrides
no font, color, spacing, or layout, never sets a style attribute on a reviewed element, and never shifts
the page's layout. What the reviewer sees is what the page looks like without it.
:::

::: callout-req
**R4: The library does not fight the page's own JavaScript.** It does not break the host page's event
handling, its framework, or its routing, and it survives the page re-rendering parts of itself.
:::

::: callout-req
**R5: Nothing the library adds can end up in the reviewer's feedback.** Its own markup, highlights,
chips, and panels are never part of a quoted passage, an edit, or anything handed to the agent.
:::

### Nothing is ever taken back

The reason for the rebuild. Each names a specific way the current tool loses work, and each needs a test
that fails without it.

::: callout-req
**R6: Nothing the reviewer types is lost.** A browser reload, a tab close, a navigation, a restart of the
server, or a machine sleep immediately after a keystroke never loses that keystroke.
:::

::: callout-req
**R7: An agent changing the underlying source never discards pending feedback.** This is the single
largest cause of lost work in the current tool, where discarding it is deliberate.
:::

::: callout-req
**R8: The reviewer's unsent work is never silently overwritten.** When the content under an edit changes,
the reviewer's version is not replaced without them being told. When the page re-renders different data
in the same place, the edit is set aside with its text intact rather than stamped over live content.
:::

::: callout-req
**R9: Sending never depends on an agent being present.** Send is available whenever unsent feedback
exists. Agent presence is information shown to the reviewer, never a gate.
:::

::: callout-req
**R10: Send sends everything on screen**, including the sentence typed a moment before pressing it.
:::

::: callout-req
**R11: Outstanding feedback is one queue, not a frozen snapshot.** Sending again while an earlier send is
unconfirmed adds to what is outstanding rather than replacing it.
:::

::: callout-req
**R12: Feedback is offered until an agent confirms it, and applied once.** A confirmation naming
something never delivered is refused, so a stale confirmation cannot erase newer feedback.
:::

::: callout-req
**R13: Failures are loud and they persist.** A failed send, a server that cannot be reached, an item that
could not be placed: each stays visible in a state the reviewer can still see a minute later. The library
never shows a success state for something that did not succeed.
:::

::: callout-req
**R14: There is always a path that needs no server.** The reviewer can copy everything to the clipboard
and export it as a file with nothing running but the browser. This is what makes the current comments
module trustworthy.
:::

::: callout-req
**R15: A second window on the same page does not cost the reviewer work.** It joins the same review or is
refused with a reason, and never accumulates separate feedback that overwrites.
:::

::: callout-req
**R16: The reviewer always knows where their typing goes.** A sentence on screen at all times says what
happens to an edit on this page.
:::

### Commenting

::: callout-req
**R17: Comment on selected text.** Select a passage, take one action, type a note. The passage is marked
in the page and the note appears keyed to it.
:::

::: callout-req
**R18: Comment on a whole element** by holding Alt and clicking it, for when the problem is not in the
words: an image, a diagram, a chart, a card, a section. **A plain click never opens a compose box**,
because a plain click places the text cursor.
:::

::: callout-req
**R19: A comment holds on when the page changes around it.** Anchoring survives edits elsewhere,
reformatting, and rewrapping, and when the same phrase appears more than once the surrounding text
decides which was meant.
:::

::: callout-req
**R20: A comment that cannot find its subject says so, on screen and to the agent**, so the agent is told
the quote may no longer be there rather than sent looking for it.
:::

::: callout-req
**R21: A comment can be reworded or deleted before it is sent**, safe from anything else happening on the
page at the same time.
:::

::: callout-req
**R22: An in-progress comment survives interruption**: a reload, the page re-rendering underneath it, and
navigating away and back.
:::

::: callout-req
**R23: A note tied to nothing is first-class feedback.** It counts as unsent feedback for R9 (send is
available whenever unsent feedback exists) and can be sent alone with no comments and no edits.
:::

::: callout-req
**R24: Every comment carries enough context for an agent to find its subject in source**: the quoted
text, the text around it, the section it sits under, and a description of the element.
:::

### Editing the page

::: callout-req
**R25: There is no edit mode to find or forget.** The page is editable from the moment the library loads.
Click anywhere and type.
:::

::: callout-req
**R26: Ordinary text editing works the way text editing works.** Type, select and replace, delete, paste
text, undo, redo.
:::

::: callout-req
**R27: The formatting a reviewer reaches for**: bold, italic, links, bulleted and numbered lists. Nothing
beyond that in v1.
:::

::: callout-req
**R28: Images can be resized and moved**, keeping the size the reviewer gave them. Pasting a new image is
cut from v1: it is the one action that would force the library to write a file.
:::

::: callout-req
**R29: Whole blocks can be deleted and reordered.** Deleting a block is feedback in itself and is
reported as a deletion.
:::

::: callout-req
**R30: Every edit can be undone on its own**, without disturbing any other edit. The current tool's only
escape is discarding every edit at once, so one misplaced drag costs an hour.
:::

::: callout-req
**R31: An edit is reported as a before and an after, keyed to a named region.** The before is the wording
as it was when the reviewer first touched it, however many times they retype it after.
:::

::: callout-req
**R32: Region names are stable and distinct.** Two separate edits never collapse into one, and no edit is
silently overwritten by another that happened to be named the same.
:::

::: callout-req
**R33: Formatting-only changes are reported as changes.** Bolding a word is an edit even though the plain
text is unchanged.
:::

::: callout-req
**R34: The reviewer can see every edit they have made**, listed by region, without leaving the page.
:::

### Using the page while reviewing it

::: callout-req
**R35: A plain click while editing does not fire the page's own behavior.** Links do not navigate,
buttons do not act, forms do not submit, because a plain click places the cursor.
:::

::: callout-req
**R36: The reviewer can use the page for real, and it is obvious how.** An editing toggle turns
interception off for a stretch and gives back an ordinary page. Holding Cmd and clicking a link follows
it. Both are taught on screen rather than in documentation.
:::

::: callout-req
**R37: Leaving a page to use the app costs nothing.** Feedback left on a page survives navigating away,
and returning shows it still there.
:::

### What the agent gets

::: callout-req
**R38: One file per review, readable by a person.** Every send writes a plain markdown record at a
documented location, grouped by page, listing comments with their quoted subject and edits with their
before and after. This is the whole handoff contract.
:::

::: callout-req
**R39: A structured file alongside it** carrying the same content with identifiers, for an agent that
would rather parse than read.
:::

::: callout-req
**R40: The reviewer's own words are never truncated on the way through.** A clipped `after` becomes an
agent faithfully truncating the reviewer's own paragraph. Text quoted out of the page is a search key
rather than the reviewer's intent, so it may be bounded, visibly.
:::

::: callout-req
**R41: Delivery needs no live connection.** An agent that was not running when the reviewer sent still
gets everything outstanding whenever it next looks.
:::

::: callout-req
**R42: Each item is keyed so the correct action is a targeted change**, never a document rewrite.
:::

::: callout-req
**R43: The agent reports per item.** Applied, or not applied with a reason. Anything it does not name
stays outstanding.
:::

::: callout-req
**R44: The agent can write back to the reviewer, in the page.** When it cannot apply an item, applied it
differently, or has a question, it attaches a message the reviewer reads on that item's own card.
:::

::: callout-req
**R45: The page is the channel back to the reviewer.** Anything the library or the agent needs to tell
them arrives in the page they are looking at. Nothing important lives only in a log, a terminal, or a
chat transcript, because that is not where the reviewer is.
:::

### Keeping up with the agent

::: callout-req
**R46: The page updates itself when the agent lands a change**, without the reviewer reloading, and
without discarding anything unsent.
:::

::: callout-req
**R47: Applied feedback clears itself from the page.** Its highlight disappears and it leaves the active
list, so what is on screen is what is still outstanding.
:::

::: callout-req
**R48: Cleared means moved, not deleted.** A completed list holds every item the agent applied, so the
reviewer can confirm a fix landed and reopen it if it did not.
:::

### Install and safety

::: callout-req
**R49: Install is a git clone and one command to start the server.** No package registry, no build step,
no background service left behind.
:::

::: callout-req
**R50: Local only.** The server listens on the loopback interface and refuses remote addresses.
:::

::: callout-req
**R51: A page cannot drive the server just by being open in the reviewer's browser.** Any page the
reviewer visits can attempt to reach a loopback server, so reaching it takes more than being in the
browser. A page the reviewer did not authorize can neither write feedback, read it, nor confirm items on
an agent's behalf.
:::

::: callout-req
**R52: Text taken out of a reviewed page is data, never instructions.** It reaches an agent as something
to search on, clearly marked, and never as a directive the agent might follow.
:::

::: callout-req
**R53: Nothing the reviewer drops or pastes reaches disk**, and a file dropped from the desktop does not
navigate the page away from the review.
:::

## Success Metrics

::: callout-metric
- **Zero lost feedback across a real review session.** Ken runs a full review of a Steady Thread feature,
  with an agent applying fixes while he keeps working, and every comment and edit is accounted for at the
  end. This decides whether it ships.
- **Send is never unavailable while unsent feedback exists**, verified by test.
- **A review survives a browser reload, a server restart, and a laptop sleep** with all pending feedback
  intact, verified by test for each.
- **Ken reviews a page behind a login and drives the app through it**, clicking into at least three
  screens and leaving feedback on each, without the review breaking or the app becoming unusable.
- **A student adds the script tag to their own page and completes a review** with no help from Ken.
- **The interactive surface is tested against a real browser.** The tool being replaced has no
  browser-level test at all, and every symptom Ken hit lives in the untested part.
:::

## Open Questions

::: callout-question
**Q1: Does the library ship as one file or several?** One file is the simplest thing to add to a page and
the easiest to host anywhere. Several files are easier to work on and let separate builders own separate
diffs. A concatenation step gives both, at the cost of a generated artifact in the repository.
:::

::: callout-question
**Q2: How does a page authorize itself to the server?** R51 says being open in the browser is not enough.
The reviewer has to do something deliberate once, and what that something is decides how much friction
sits between adding the script tag and being able to send.
:::

## Review Disposition

Findings from the PM review of the first draft, and from the four reviews that followed on the
architecture and plan. The scope correction, from a workflow tool to a standalone library, came from Ken
directly and is what this draft is.

| Finding | Disposition | Notes |
| --- | --- | --- |
| The product had drifted into a workflow tool: a setup command writing agent skill files, build-system source hints, per-project review roots, a four-command CLI (Ken, live) | Accepted | Rewritten as a library plus a small server. Those requirements are gone rather than reworded |
| Batch-level confirmation cannot drive item-level clearing | Accepted | R43 makes the item the unit; R47 and R48 depend on it |
| Nothing said who wins when an agent rewrites a region being edited | Accepted | R8 |
| Reviewing a running app said nothing about authentication | Resolved by shape | A library in the page runs in the reviewer's own logged-in browser, so there is no session to forward |
| Nothing covered the page's own re-renders eating typed text | Accepted | R4 and R8 |
| No requirement for a free-text note tied to nothing | Accepted | R23, tied to R9 so the note-only-send bug cannot be rebuilt |
| Element comment and pass-through both called a modifier click | Accepted | Alt-click comments, Cmd-click follows a link, plus the R36 toggle |
| Verification cannot match a rendered string to its template | Accepted | Verification is cut from v1 along with the source-hint machinery; R42 and R43 carry the intent |
| Image paste forces a write path the design forbids | Accepted | Cut from R28 |
| Truncation read as an absolute covering text the reviewer did not write | Accepted | R40 bounded to the reviewer's own words |
| Nothing said what a second window does | Accepted | R15 |
| Nothing said what a second send does while one is unconfirmed | Accepted | R11 |
| Nothing important should live only in the chat window (Ken, live) | Accepted | R44 and R45 |
| The tool imposed its own styling on the reviewed page (Ken, live) | Accepted | R3 |
| Markdown dropped as a target (Ken, live) | Accepted | Every target is HTML |
| Sequence the build into releases | Deferred to plan | Phasing belongs in the plan |
