# Choice buttons in Lahe: the crucible

Date: 2026-10-13, round 2 on 2026-10-17
Status: CLOSED. Ken picked B on 2026-10-17; the summary is [the crucible summary](00_crucible_choice_buttons.md), and the brief comes next.

**Nothing open here.** Approach B (a choice record) is chosen and every premise edit you made is folded in. [The crucible summary](00_crucible_choice_buttons.md) is what the brief is written from. Comment there or here if a reading below is wrong.

**What changed since round 1.** You put this on hold until the standard docs existed. They do now: [the product brief](../../ongoing/PRODUCT_BRIEF.md), [the architecture doc](../../ongoing/ARCHITECTURE.md), [the style guide](../../ongoing/STYLE_GUIDE.md) and [the brand doc](../../ongoing/BRAND.md). I read all four and the rewritten lahe skill. Three things in them bear on this feature:

- The brand paragraph now promises "interactive modules". Pages already carry some: Plotly charts, zoomable diagrams. None of them talks back to the agent. This feature is the first interactive module whose use is itself a message to the agent. (Ken: "we load interactive graphs all the time.")
- The style guide names option cards with a Recommended badge as the component for a choice. A clickable choice should grow out of that component, not stand beside it. Ken: "love this." Taken as decided.
- The architecture doc says a change that needs a new kind of record changes that doc first. Approach B below adds a kind, so the brief and architecture for this feature land in that doc too.

## What you asked for

"We need to teach lahe how to present buttons for basic choices. This page for example [the lesson queue](http://docs.features.20261012-01-forge-international-style.lahe.localhost/02_lesson_queue.md) is a bunch of yes no choices. I have to highlight, create a comment, and submit, when it could just as easily be a click to accept. We already have buttons that send info to the agent ("send"). It should be very doable to have it present buttons that can be clicked, which send messages back to the agent to take action, and have enough identifiers that repetitive buttons are not confused (multiple lessons to approve)."

And on the page since: documents and live websites are two different cases, and only the second has existing functionality to protect. Agents should learn to author the element through the lahe skill, and that skill change should be made with the skill-creator skill.

## Premises

Agree or disagree with each. Silence is agreement.

1. **The job is clearing a queue of verdicts the agent already framed.** A question with a free answer stays a comment. Buttons are for the case where the agent can name every answer in advance.
2. **Documents only. Never on a live site.** Ken: "just don't do it on live sites. only docs." A choice group works on a page Lahe renders from Markdown or an agent wrote as HTML, where there is no page functionality to protect. On a page served from someone else's dev server (the `lahe add` path), the library claims no clicks at all, so rule D3 (browse is the page untouched) is never touched. A choice group on such a page draws as plain content and does nothing.
3. **A press is a record like any other.** Durable, revisioned, listed in the drain, answered on its thread. Never a side channel to the agent that the store does not hold. The product brief's rule is that the record is the truth and the page is a view.
4. **A press can never be confused with another press.** Two buttons that read "Promote" under two different lessons reach the agent as two different answers, with no parsing and no guessing. How the identity is carried is the architecture's to decide, not this page's. (Ken: "this is architecture.")
5. **Agents learn to author it from the lahe skill and the component catalog,** and that skill change is made with the skill-creator skill. The authoring block has to be short enough that an agent gets it right from the skill text alone.
6. **This goes ahead of the npm package and the launch.** Behind nothing else open on the board except a real security hole.

## Approaches

### Approach A: buttons that post a comment

**Summary.** The agent writes a button with a Lahe marker into the page. A click posts an ordinary comment on the block the button sits in, with the button's label as the reviewer's words. No new record kind, no new drain field.

- **Effort:** S. **Risk:** medium.
- **For:** the smallest diff. Everything downstream already works: lifecycle, threads, drain, replies, Mark as done.
- **Against:** identity rides on the anchor (the heading and the quoted text), which is exactly the thing you are worried about. The agent has to read "Promote" out of a comment and match it to a lesson by its quote. After a reload the page cannot show which button was pressed. The handled check would look for words on the page that were never typed there.
- **Reuses:** the comment record, the anchor engine, the cards, the drain.

### Approach B: a choice record

**Summary.** A new component in the catalog, grown out of option cards: a choice group with one button per answer. A click mints a new kind of item, a choice, that carries its own identity and the answer. It is sent at once, since a click is a commit, and it reaches the agent as a field to read rather than words to parse. The page shows the chosen answer and keeps it after a reload. Which fields carry the identity, how the page shows the choice and how the agent records the decision are for the architecture.

- **Effort:** M to L. **Risk:** medium.
- **For:** a press reaches the agent as its own record, so two "Promote" buttons can never be confused. Cheaper in tokens than a comment per verdict: a press is a few fields in the drain, where a comment carries a quote, context and region text (Ken: "I think this might be better for token management as well"). The page shows the decision. It is a document-only feature, so D3 and live sites are untouched. Changing your mind is a new revision of the same item, which the lifecycle already handles.
- **Against:** a new record kind touches the record module, the contract text, the skill, the tests and the built bundle, and the architecture doc has to change first. Replay has to learn one more record shape so a pressed choice survives a repaint.
- **Reuses:** the Mark as done event (a small verified act at one revision), the lifecycle, the card, option cards and badges for the look, the uniqueness rule.

### Approach C: checkboxes in the file

**Summary.** The agent writes a task list under each item (`- [ ] Promote`, `- [ ] Discard`). Lahe makes the rendered checkboxes clickable. A click is recorded as a hand edit of that list item, unticked to ticked. The agent edits the source to match and the page re-renders with the tick. The document itself becomes the record of what was decided.

- **Effort:** M. **Risk:** medium to high.
- **For:** no new syntax for agents, since every Markdown tool renders a task list. The decision lives in the file for good, readable with no Lahe at all.
- **Against:** Markdown only, so an HTML decision page or a live site gets nothing. Checkboxes are not exclusive, so Promote and Discard can both be ticked. The hand-edit path (the handled check, replay, protection) around a disabled form control is where the bugs will be. The agent still parses a list item to find the answer.
- **Reuses:** edit records, re-render on source change, the task-list styling already in the house stylesheet.

### Do nothing

Agents keep inventing page-by-page shortcuts like "one comment saying all as recommended is enough", each slightly different. You keep paying four actions for every verdict that is not the recommendation. And the brand paragraph promises interactive modules the product does not have.

## Recommendation

**B, a choice record.** The whole ask is identity, and only B gives a press its own record with identity the agent reads as data. A is the cheapest and fails on exactly the repeated-button case you named. C's one great property, that the document keeps the decision, is worth borrowing: the agent writes the chosen answer back into the source when it handles the item. What would change my mind: if you tell me the queue pages are nearly always Markdown and you want decisions to live in the file above all else, C becomes the contender.

## The questions, with working answers

These stand unless you object on a card.

### Q1. What job is this hired to do?

Clear a queue of decisions the agent has already framed, so the agent can act, without any decision getting lost or misread. The trigger is an agent handing you a page of recommendations: a lesson queue, a crucible like this one, a forge checkpoint, a close-out asking approval on deletions. The job is not "answer a question"; it is "get N small verdicts back to the agent in one sitting, each tied to the thing it is about."

The deeper pain is the misread, not the gestures. "All as recommended, except merge the two monitor ones" is one comment and the agent can still get it wrong. That is why identity, not speed, is the first premise.

### Q2. Who is this for?

Two users. You, reading a decision page an agent made for you, usually while something else is running. And the agent writing the page: if the way to make a button is fiddly, agents will not use it, or will use it wrong, and you are back to comments. The authoring side has to be one short block an agent gets right from the skill text alone. Since there is still no second reviewer, the authoring side is the harder design problem, because you can learn any gesture and the agents cannot.

### Q3. Where and how does it happen?

Laptop, the page in a browser tab, mid eighteen other things. You read decision pages at zero, with no context loaded. Two consequences: the answer has to show on the page after you click it, not only on a card, because you will come back later and want to see what you decided. And the phone is out of scope; Lahe has no mobile story and this feature does not start one.

### Q4. How do you know the problem is real?

- You asked for it, with the gesture count spelled out.
- The lesson-queue agent invented the "all as recommended" shortcut on its own, a workaround built because the real thing is missing.
- Decision pages are now the normal way agents reach you: forge checkpoints, close-outs, lesson queues, this page. Every one is a list of small verdicts.
- The brand doc, written this week, promises interactive modules. The promise is ahead of the product.

What I do not have is a count: decision pages per week, verdicts per page, how often the answer was not "yes to all". Say it if you have a feel for it.

### Q5. What do you do today, and what does it cost?

Three things. A comment per item: select, Cmd-Shift-C, type, Cmd-Enter, nineteen times on the lesson page. One blanket comment, fast but every exception is prose the agent can misread. Or buttons in the terminal, which Claude Code already has, and which you do not use for this because the chat scrolls away and you are not watching it.

### Q6. Does this matter more or less as the models improve?

More. A stronger agent brings more finished recommendations and fewer open questions, so your share of the work shifts toward saying yes or no to things the agent already worked out. The counter-argument is that a good enough agent needs no approval at all; your lessons process says otherwise on purpose. As long as you keep the promote-or-discard call, the verdict channel gets busier.

### Q7. Why this, and why now?

What else is open on the board: two security rows (the CLI's raw secret, the missing Host check), both real and both accepted for now; the npm package and the Product Hunt launch, waiting since September; the Library's dismiss-and-hide; teaching the renderer the forge structure. On the project's own order (velocity, dogfooding, security) this belongs ahead of all of them except the security rows, because you hit it on every decision page and every forge run adds more. If the launch is near, launch first and do this right after.

## What I understand about the area

The decisions named below (D3, D4, D12) now live in [ARCHITECTURE.md](../../ongoing/ARCHITECTURE.md), under "Architecture rules", with [the August doc](../20260812.01_live_agentic_html_editor/02_architecture_live_agentic_html_editor.md) kept as the history of why.

- **Documents only, so D3 never comes up.** Ken first split the two uses (document creation has no page functionality to protect; walking a website does), then narrowed the feature to documents. A choice group is live only on a page Lahe renders or serves as a document. On a live site, D3 (browse is the page untouched) stays whole, and the library claims no click.
- **The record kinds are a closed list.** Comment, edit, delete, format_only and note. Free writing added note, which is the precedent for adding one. A press is either a sixth kind (approach B) or a comment (approach A).
- **A non-comment event already exists.** Mark as done on a card's chip posts an `item.closed` event naming the item and its revision, nothing else. The helper checks the id and revision and drops a stale one. That is the shape a button press takes: a small identified act the helper can verify.
- **The Markdown renderer keeps raw HTML.** I ran marked on a `<button>` and it comes out as-is. An agent can already write a button into a Markdown page today. Nothing catches the click.
- **Task-list checkboxes render disabled.** `- [ ] item` becomes a disabled checkbox, and the house stylesheet already draws it. That is approach C's starting point.
- **The drain is where the agent reads.** `lahe status --json` lists ready items with the reviewer's words at the top and page text labeled as data. A press has to arrive there with its identity spelled out.
- **Option cards are the house component for a choice.** The style guide and the skill both say so, with a Recommended badge and never a colored edge. The clickable version is this component grown a button row, not a new look.

## What I looked for first

- **No prior work in this repo.** No brief, board row, ongoing doc or report covered buttons, choices or approvals before this one. The closest is the free-writing crucible (a new record kind and a new gesture), which is the process precedent.
- **Nothing to adopt.** The zero-dependency rule rules out a widget library, and none would fit anyway. Designs worth copying: Slack's Block Kit buttons (an action id and a value on each button, a press posts a payload naming both), Claude Code's AskUserQuestion (buttons with an "Other" free-text option), GitHub's task-list checkboxes (a click rewrites the Markdown source), and Google Docs suggestions (accept and reject per suggestion, which Mark as done already resembles).

## Decisions so far

- 2026-10-17: approach B, a choice record, is the pick. Ken on the card: "I think this might be better for token management as well."
- 2026-10-17: the "answer in words" premise is dropped. Highlighting and commenting is always there, so it needs no saying. Ken on premise 5.
- 2026-10-17: premise 4 restated as the decision (a press is never confused with another) with the mechanism left to the architecture. Ken: "this is architecture."
- 2026-10-17: documents only, never live sites. Ken on premise 2: "just don't do it on live sites. only docs."
- 2026-10-17: the clickable choice grows out of the option-card component, not a new look. Ken agreed on the card.
- 2026-10-17: "interactive modules" already exist on pages (charts, zoomable diagrams); what is new here is one that reports back to the agent. Ken corrected the page.
- 2026-10-13: documents and live sites are two cases; only live sites need D3's protection. Folded into premise 2.
- 2026-10-13: there was no standing architecture doc. Written since as part of the standard docs; the board row LAHE-standing-architecture-doc can close.
- 2026-10-13 to 2026-10-17: on hold until the standard docs existed. Lifted.
