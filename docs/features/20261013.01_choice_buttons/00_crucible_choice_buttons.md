# Crucible: choice buttons on a document

Date: 2026-10-17
Status: ACCEPTED (Ken on approach B, 2026-10-17: "let's do this")

The questions, Ken's comments and how each was folded in are on [the questions page](00_crucible_questions.md). This file is the summary the brief is written from.

## The idea, as stated

"We need to teach lahe how to present buttons for basic choices. This page for example, the lesson queue, is a bunch of yes no choices. I have to highlight, create a comment, and submit, when it could just as easily be a click to accept. We already have buttons that send info to the agent ("send"). It should be very doable to have it present buttons that can be clicked, which send messages back to the agent to take action, and have enough identifiers that repetitive buttons are not confused (multiple lessons to approve)."

## Jobs to be done

In Ken's words, written onto the questions page by hand: **answer a question from the agent quickly and easily.**

My longer framing (clear a queue of verdicts the agent framed, each tied to the thing it is about) was his starting point and he replaced it. He also deleted my claim that the misread, not the gesture count, was the deeper pain. The brief takes his sentence as the job and treats the identity requirement as a constraint, not the job.

## Who the user is

In Ken's words, written onto the questions page by hand: **the agent writing the page. Instructions must be clear and communication must be good.**

The reviewer reading the page is the other party, but Ken put the agent first: the feature is only as good as an agent's ability to author it correctly from the instructions it is given.

## User context

In Ken's words: a laptop, the page in a browser tab, amid eighteen other things. He cut my two consequences (the page shows the answer after a click; the phone is out of scope). The first survives as part of approach B; the second is a non-goal for the brief to state.

## What already exists

- **In this repo:** no brief, board row, ongoing doc or report covered buttons, choices or approvals before this one. The process precedent is the free-writing crucible, which added a record kind and a gesture.
- **Standard docs this week:** [the product brief](../../ongoing/PRODUCT_BRIEF.md) (the record is the truth, don't waste tokens), [the architecture doc](../../ongoing/ARCHITECTURE.md) (a new kind of record changes that doc first), [the style guide](../../ongoing/STYLE_GUIDE.md) (option cards with a Recommended badge are the component for a choice), [the brand doc](../../ongoing/BRAND.md) (the one-paragraph description promises "interactive modules").
- **In the code:** the record kinds are a closed list (comment, edit, delete, format_only, note). Mark as done already posts a small non-comment event, `item.closed`, naming an item and its revision, which the helper verifies. The Markdown renderer keeps raw HTML, so an agent can write a button today and nothing catches the click. Task-list checkboxes render disabled. Pages already carry interactive modules (Plotly charts, zoomable diagrams); none talks back to the agent.
- **Prior art, nothing to adopt:** Slack's Block Kit buttons (an action id and a value per button, a press posts a payload naming both), Claude Code's AskUserQuestion (terminal buttons), GitHub task-list checkboxes (a click rewrites the Markdown source), Google Docs suggestions (accept and reject per suggestion). The zero-dependency rule rules out a widget library, and none would fit.

## Evidence

- Ken asked for it with the gesture count spelled out: highlight, comment, submit.
- The lesson-queue agent invented a shortcut on its own, "one comment here saying all as recommended is enough", a workaround built because the real thing is missing.
- Decision pages are now the normal way agents reach Ken: forge checkpoints, close-outs, lesson queues, this crucible. Every one is a list of small verdicts.
- The brand doc, written this week, promises interactive modules. The promise is ahead of the product.

## Status quo

A comment per item: select, Cmd-Shift-C, type, Cmd-Enter, nineteen times on the lesson page. Or one blanket comment, fast but every exception is prose the agent can misread, and a misread costs a round trip nobody notices until later. Or buttons in the terminal, which Claude Code has and Ken does not use for this because the chat scrolls away and he is not watching it.

## Premises

All agreed, after Ken's edits on the page.

1. The job is clearing a queue of verdicts the agent already framed. A question with a free answer stays a comment.
2. Documents only, never on a live site. A choice group works on a page Lahe renders or an agent wrote. On a page from someone else's dev server the library claims no clicks, so D3 (browse is the page untouched) is never touched.
3. A press is a record like any other: durable, revisioned, listed in the drain, answered on its thread. Never a side channel the store does not hold.
4. A press can never be confused with another press. Two "Promote" buttons under two lessons reach the agent as two different answers, with no parsing and no guessing. How identity is carried is the architecture's decision.
5. Agents learn to author it from the lahe skill and the component catalog, and that skill change is made with the skill-creator skill. The authoring block must be short enough that an agent gets it right from the skill text alone.
6. This goes ahead of the npm package and the launch, behind nothing else open on the board except a real security hole.

## The case against building this

The honest case is thin, and it is about cost rather than value. A new record kind touches the record module, the contract text that ships in every review, the skill, the tests, the architecture doc and the built bundle, for a feature with no usage count behind it. The cheap version (a button that posts a comment) exists in principle today and would prove demand before the kind is added. Against that: the cheap version fails on exactly the case Ken named, repeated buttons, and a feature that gets identity wrong once teaches him not to trust it. The evidence that would change the recommendation: a month of decision pages where "all as recommended" was the answer nearly every time, which would make this a convenience rather than a correctness fix.

## What happens if we do nothing

Agents keep inventing page-by-page shortcuts, each slightly different, and the reviewer pays four actions for every verdict that is not the recommendation. Exceptions keep arriving as prose, with the misread risk that carries. The brand paragraph keeps promising interactive modules the product does not have in the one place a reviewer makes decisions.

## Approaches considered

### Approach A: buttons that post a comment

A marked button whose click posts an ordinary comment on its block, label as the words. Smallest diff, everything downstream already works. Fails on identity: it rides on the anchor, the agent parses "Promote" out of a comment, the page cannot show the press after a reload, and the handled check looks for words never typed on the page.

### Approach B: a choice record

A new component grown out of option cards: a choice group with one button per answer. A click mints a new kind of item that carries its own identity and the answer, sent at once, read by the agent as a field. The page shows the chosen answer and keeps it after a reload. Costs a new record kind across record, contract, skill, tests, bundle and the architecture doc, plus one more shape for replay. Ken: "I think this might be better for token management as well." A press is a few fields in the drain, where a comment carries a quote, context and region text.

### Approach C: checkboxes in the file

GFM task lists made clickable, a click recorded as a hand edit, the agent ticking the source so the document itself keeps the decision. No new syntax, works in any Markdown tool. Markdown only, checkboxes are not exclusive, and the hand-edit path around a disabled form control is where the bugs would be.

### Do nothing

See "What happens if we do nothing".

## Recommended approach

B, a choice record. The whole ask is identity, and only B gives a press its own record with identity the agent reads as data. It is also the cheapest in tokens per verdict, which the product brief ranks as a principle. One thing to borrow from C in the architecture: the document should keep the decision once the agent has handled it, so a reader at zero sees what was decided without opening the rail.

## Challenges the session leader accepted

- Documents and live sites are two cases: Ken raised it himself, then narrowed the feature to documents only.
- Premise 4 said how identity would be carried (an agent-written id, checked unique by the helper). Ken: "this is architecture." The premise now states only the decision.
- The "answer in words" premise was redundant: highlighting and commenting is always available. Dropped.
- "Today the product has none on a page" was wrong: pages carry charts and zoomable diagrams. Corrected to "none talks back to the agent".
- Option cards as the base for the clickable component: "love this".

## Challenges the session leader rejected

None. Every challenge raised was taken. The one place Ken pushed back on me was scope: he cut live sites rather than designing for them.

## What we skipped and why

The seven questions were put on one page with pre-filled answers rather than asked one at a time in chat, following the free-writing crucible and the rule that any set of questions goes on a page. Ken did not object to any working answer, so they stand. Ken deleted the request for a count of decision pages; the brief does not depend on one.

## Open questions

- Whether the standard docs' "interactive modules" promise means more components of this kind are planned (a slider, a ranking, a free-text field). The brief should name this as the first and say nothing about the rest.
- Whether a choice should be reversible after the agent handled it, or whether changing one's mind is a new comment. Architecture.

## The assignment

Write the brief for a choice record on documents, with the brief skill, then the architecture, with the new-record-kind change written into `docs/ongoing/ARCHITECTURE.md` as that doc requires. The authoring instruction for agents goes into the lahe skill and the component catalog, and that skill edit is made with the skill-creator skill. Show Ken the lesson queue rebuilt with real buttons as the first working page before any PR gate.
