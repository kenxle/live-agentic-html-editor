# Feature Brief: Live Agentic HTML Editor

## Context

Ken reviews a lot of pages: specs and reports his agents wrote, landing pages, and features running on a
dev server. The tool he uses today is a **comments module** that lives in the page. Highlight a passage,
press a key, type a note. It is reliable for one reason worth naming: **it does not depend on anything
being alive.** Notes are kept the instant they are typed, they reach an agent when one is around, and
they can be copied or exported when nothing is.

What it cannot do is let him fix the wording by typing the better wording.

**human-review** (Peter Yang's tool, MIT, github.com/petergyang/human-review) can. It makes the page
editable, so a reviewer corrects a sentence by typing it rather than describing it. That is the missing
half: typing the correction is faster than writing a comment about the correction, and it carries the
reviewer's exact words instead of a paraphrase.

It has not held up. Text Ken typed came back reverted, the send control stopped working, the reviewed app
stopped responding to clicks, and agents did not reliably collect the feedback. Its tests are careful in
one half of the tool and absent in the other, and every symptom lives in the untested half. Being well
tested is not the same as being well designed, and the lesson to take is narrower than "write tests":
the reviewer's work lived in short-lived places, and routine events emptied them.

## Goal / Problem

Build a library that can be added to any locally run HTML page, by anyone, and allows for live editing,
commenting that is auto-read by an agent, and agent communication that can appear on the page without
having to go read the chat (which is constantly scrolling and loses the important agent requests
quickly).

The library has to enable live editing and agentic editing simultaneously **without clobbering each
other's work**. That is the hard part and it is the reason this exists.

Trust is an important aspect of this product. Reviewers work hard leaving feedback and making edits, and
we cannot lose their work or clobber their work.

## Non-Goals

::: callout-nongoal
- **Not integrated into or relying on our existing tools.** It is standalone, not requiring
  feature-forge or research-report skills. Those skills, or any other user's skills, should be able to
  easily insert this module into any locally run or opened HTML.
- **Not tied to one agent.** Claude, Codex, and anything else a person uses should be able to work with
  it.
- Not multiplayer in the human sense. One human reviewer. It may well be working with several agents at
  once, since a coordinating agent may hand work to others.
- Not a CMS, a page builder, or a design tool. It edits the words and arrangement of a page that already
  exists. No color pickers, no spacing controls, no CSS editing, and no restyling of the page.
- Not a hosted service. It runs on the reviewer's own machine against pages on that machine.
- Not Markdown. Cut on Ken's call: a Markdown file is already easy to edit in an editor.
- Not an agent. It collects feedback, carries it, and shows the agent's answers. Doing the work is the
  agent's job.
- **Not reordering blocks by hand, in v1.** Ken asks for reordering often, so this is a real need rather
  than one nobody wants, and it is the first thing to revisit. It is out for now because doing it badly
  breaks pages, and asking the agent to reorder something works today.
:::

## User Stories

- **As Ken reviewing a page his agent wrote**, I want to fix a clumsy sentence by typing the better
  sentence, so the agent gets my exact words rather than a description of them.
- **As Ken**, I want my exact words to stay on the page. I do not want an agent rewriting them back in
  and changing them on the way; a comma I typed has come back as an em dash before.
- **As Ken reviewing a feature on his dev server**, I want to move through real screens behind a login,
  leaving comments and typed fixes, with those reaching the agent as I go so I can keep exploring rather
  than waiting.
- **As Ken mid-review**, I want every link, button, and piece of interactivity on the page to keep
  working, so I can reach the next screen without leaving the review or losing what I typed.
- **As Ken mid-review**, I want certainty that closing my laptop, an agent working, or a process
  restarting cannot take back anything I already typed.
- **As Ken with nothing running**, I want to grab my comments and take them somewhere else.
- **As Ken watching an agent work**, I want a finished item's highlight to disappear and the item to
  leave the active thread, so the thread gets shorter as work gets done.
- **As Ken at the end of a session**, I want a list of all the human edits that were made, so that we
  can review and see if there is anything we should add to our writing style guide, compounding our
  learnings.
- **As any new user**, I want an install I can do quickly, or hand to my agent, and a page I can figure
  out without reading instructions.
- **As a coding agent**, I want feedback that names what each comment is about and gives before and
  after text for each edit, so I make targeted changes instead of regenerating a document.
- **As a coding agent that could not complete something**, I want to report that back onto the page,
  where the reviewer will actually see it.

## Requirements

### The user's work is never clobbered

The reason this is being built. Each names a way the current tool loses work.

::: callout-req
**R1: Nothing the reviewer types is lost.** A reload, a tab close, a navigation, a restart of anything
the library talks to, or a machine sleep immediately after a keystroke never loses that keystroke.
:::

::: callout-req
**R2: An agent working on the page never discards the reviewer's pending feedback.** In the current tool
discarding it is deliberate, and it is the single largest cause of lost work.
:::

::: callout-req
**R3: The reviewer's own words stay exactly as typed.** Nothing rewrites them: not on the page, not on
the way to the agent, and not when the agent applies them somewhere else.
:::

::: callout-req
**R4: An agent never rewrites the whole document.** Changes are targeted at what the reviewer raised, and
nothing they did not raise is touched.
:::

::: callout-req
**R5: The reviewer's unsent work is never silently overwritten.** When the content under an edit changes,
their version is not replaced without them being told.
:::

::: callout-req
**R6: Feedback reaches the agent as the reviewer works.** The reviewer does not stop, batch, or wait for
a round trip before continuing, and an agent can be working through earlier items while they keep going.
:::

::: callout-req
**R7: The reviewer decides when a comment is ready to act on**, so a half-written thought is not picked
up as an instruction.
:::

::: callout-req
**R8: Work reaches the agent even when nothing is running to receive it**, and is there when something
starts.
:::

::: callout-req
**R9: The same feedback is never acted on twice**, and something the agent has not actually handled is
never treated as handled.
:::

::: callout-req
**R10: There is always a way to take the work elsewhere with nothing running**: copy it, or export it as
a file. This is what makes the current module trustworthy and it is not being given up.
:::

::: callout-req
**R11: Failures say so, and the reviewer can dismiss them.** Nothing shows a success state for something
that did not succeed, and nothing that the reviewer has decided not to care about keeps nagging them.
:::

::: callout-req
**R12: The reviewer always knows what is happening to their typing.**
:::

### The page keeps working

::: callout-req
**R13: The module does not break functionality on the page**, including native links, buttons, forms,
interactivity, and JavaScript event handling. **This outranks the convenience of editing.** If editing
has to be entered deliberately so the page stays usable, that is the right trade.
:::

::: callout-req
**R14: The library does not change how the page looks.** It adds nothing to the page's own styling,
moves nothing, and leaves the page rendering exactly as it does without the library.
:::

::: callout-req
**R15: The library keeps working while the page changes underneath it**, including on pages that
re-render parts of themselves.
:::

### Commenting

::: callout-req
**R16: Comment on a selected passage.** One action, whether a key or a click, and the comment box is
ready to type into immediately. The passage is marked on the page and the comment is tied to it.
:::

::: callout-req
**R17: Comment on a whole element**, for when the problem is not in the words: an image, a diagram, a
chart, a card, a section.
:::

::: callout-req
**R18: Leave a note that is not tied to anything**, for something about the page as a whole.
:::

::: callout-req
**R19: A comment holds onto its subject when the page changes around it**, and when the same phrase
appears more than once it stays on the one that was meant.
:::

::: callout-req
**R20: A comment that can no longer find its subject says so**, on the page and to the agent, rather
than being dropped or silently moved.
:::

::: callout-req
**R21: A comment can be reworded or deleted before an agent acts on it**, safe from anything else
happening on the page at the same time.
:::

::: callout-req
**R22: A comment survives interruption while it is being written**: a reload, the page re-rendering
underneath it, navigating away and back.
:::

::: callout-req
**R23: A comment carries enough for an agent to find its subject in the source**, without the reviewer
having to read anything technical in the comments thread.
:::

### Editing

::: callout-req
**R24: Edit the text of the page directly**, entered deliberately enough that R13 (the page keeps
working) holds.
:::

::: callout-req
**R25: Ordinary text editing works the way text editing works**, including undo.
:::

::: callout-req
**R26: Basic formatting only.** Anything beyond the basics can be asked of the agent instead and is not
worth the complexity here.
:::

::: callout-req
**R27: Delete a block.** Deleting is feedback in itself and reads as a deletion rather than an empty
edit.
:::

::: callout-req
**R28: Every edit can be undone on its own**, without disturbing the others. The current tool's only
escape is discarding every edit at once, so one mistake costs an hour.
:::

::: callout-req
**R29: An edit is carried as a before and an after, tied to a place on the page.** The before is the
wording as it was when the reviewer first touched it, however many times they retype it after.
:::

::: callout-req
**R30: Two separate edits stay two separate edits**, and no edit silently overwrites another.
:::

::: callout-req
**R31: A change to formatting alone still counts as a change.**
:::

::: callout-req
**R32: The reviewer can see the edits they have made by hand**, kept apart from the comment thread so
neither buries the other.
:::

### Working with the agent

::: callout-req
**R33: The agent reports on each item.** Handled, or not handled with a reason. Anything it does not
speak to is still outstanding.
:::

::: callout-req
**R34: An agent that cannot do something says so on the page**, where the reviewer will see it, because
the reviewer is not reading the chat window.
:::

::: callout-req
**R35: Anything the reviewer needs to know arrives on the page they are looking at.** Nothing important
lives only in a log, a terminal, or a chat transcript.
:::

::: callout-req
**R36: The page updates itself as the agent lands changes**, without the reviewer reloading and without
losing anything of theirs.
:::

::: callout-req
**R37: A handled item loses its highlight and leaves the active thread**, so what is left on screen is
what is still outstanding and the thread gets shorter as work gets done.
:::

::: callout-req
**R38: Handled items are kept, not deleted**, somewhere the reviewer can look back over to confirm a fix
landed and reopen it if it did not.
:::

::: callout-req
**R39: At the end of a session the reviewer can see every edit they made by hand**, as a list, so
patterns worth adding to a style guide can be spotted.
:::

### Getting the library and running it

::: callout-req
**R40: Installing the library is easy, and an agent can do it.** Clone and run a command, or ask an
agent to make the library ready. One place the library comes from, so there is nothing to keep in sync.
:::

::: callout-req
**R41: Adding the library to a page is something a person or their agent does in one step.**
:::

::: callout-req
**R42: The requirements to run the library are stated plainly**, and it does not depend on anything unusual. Any
constraint on browsers or platforms has to be a real technical need, stated with its reason, rather than
a default.
:::

::: callout-req
**R43: A new user can work out how to use the library from the page itself**, without reading documentation.
:::

### Safety

::: callout-req
**R44: Only the reviewer's own review can reach their work.** Something the reviewer did not put on the
page cannot read their feedback, write feedback as them, or tell their agent an item was handled. This
takes no action from the reviewer beyond having added the library.
:::

::: callout-req
**R45: Text taken off the page is context, never instructions.** Quoted passages and original wording are
there for an agent to search on and understand, and are never followed as directives.
:::

## Success Metrics

::: callout-metric
- **Zero lost or altered work across a real review session.** Ken runs a full review of a Steady Thread
  feature with an agent working alongside him, and at the end every comment and every edit is accounted
  for and his words read exactly as he typed them. This decides whether it ships.
- **He never stops to wait for the agent.** He can keep commenting and exploring while earlier items are
  being worked.
- **Nothing on the page stops working** while he reviews it: he drives the app through at least three
  screens behind a login.
- **The review survives a reload, a restart, and a laptop sleep** with everything intact.
- **The thread gets shorter as the agent works**, and he can still find what was handled.
- **A new user adds it to their own page and completes a review** with no help.
- **The interactive parts are tested against a real browser**, since the tool being replaced has no such
  test and every symptom lives where the tests are not.
:::

## Open Questions

::: callout-question
**Q1: What is the gesture for entering an inline edit, and for commenting on a whole element?** R13 (the
page keeps working) means editing cannot simply be "click and type", and element commenting needs
something a new user will find. Both need to be worked out together rather than picked separately, since
they share the same small vocabulary of clicks and keys.

**Answered (Ken, round 2):** the edit keystroke is Cmd-Shift-E, chosen to be one-handed. The
element-comment gesture still gets worked out in the architecture alongside it.
:::

::: callout-question
**Q2: Is resizing an image by hand worth building?** It is only worth having if it works well, and if it
does not, asking the agent is a perfectly good answer.

**Answered (Ken, round 2):** not at this time. Asking the agent to resize is the v1 answer.
:::

## Ken's Review, Round 1

Sixty-two comments on the first draft. The full record is in
`archive_ken_comments_round1_brief.md`.

| Finding | Disposition | Notes |
| --- | --- | --- |
| The brief was full of implementation detail, against the skill's own rule (raised on eleven separate passages) | Accepted | Goal, non-goals, and requirements rewritten as what rather than how. Script tags, servers, file formats, bundlers, and file counts are all gone |
| The send-and-wait model is wrong; the current module works continuously and the reviewer should not wait | Accepted | R6, R7, R8. Send as a concept is gone from the brief |
| Everything on the page must keep working, and that outranks click-to-edit | Accepted | R13 says so explicitly, R24 defers to it, and Q1 carries the open gesture question |
| The reviewer's exact words must stay on the page, not be rewritten back in by an agent | Accepted | R3, and the user story that names the comma-to-em-dash case |
| Never rewrite the whole document | Accepted | R4, promoted to its own requirement |
| A simple install is wanted; the non-goal misread the earlier instruction | Accepted | R40, R41 |
| Agent agnostic, and possibly several agents at once | Accepted | Non-goals |
| Reviewing a document someone else sent is fine as long as it is local | Accepted | That non-goal is removed |
| Chromium-only and platform limits need a real reason | Accepted | R42 makes the reason a requirement rather than a default. The architecture has to justify any limit |
| Completed items leave the thread; hand edits belong apart from comments | Accepted | R32, R37, R38 |
| New story: an end-of-session list of hand edits to feed the style guide | Accepted | R39 and its user story |
| Trust framing reworded | Accepted | Ken's wording used in the goal |
| "Well tested does not mean well designed" | Accepted | Context reworded |
| Lists are not needed; keep formatting basic | Accepted | R26 |
| Reordering blocks needs thought and could break things; image resize can slip | Accepted | Reordering is a stated non-goal for v1 with its reason and its standing as a frequent request recorded, so it is the first thing to revisit. Image resize is Q2 |
| "Region" was never defined, so the requirement was hazy | Accepted | R29 and R30 now say it in plain words |
| Unclear why library markup must be kept out of feedback | Accepted | Folded into R23, which says what the reviewer should not have to read |
| Errors should be dismissible | Accepted | R11 |
| Element commenting by Alt-click is hard to discover | Accepted | Moved to Q1 rather than fixed in the brief |
| A comment box should take focus immediately | Accepted | R16 |
| An untethered note needs somewhere to live | Accepted | R18 |
| Authorization should need no user action beyond adding the library | Accepted | R44 |
| Two files for the agent contradicted each other | Accepted | Both removed as implementation |
| Two windows on one page: is it worth the complexity | Deferred | Left out of the brief; the architecture can decide whether it is cheap |
| A database is worth considering for storage | Deferred | Architecture |
| The visible banner text at the top of built docs | Fixed | An HTML comment cannot nest, and the module's banner contained a literal comment. Fixed at the source, so every doc built from now on is clean |
