# Requirements check: choice buttons

An independent check of the integrated branch `feat/choice-buttons` against the brief (R1 to R19, AI Behavior, Non-Goals), the architecture and the plan. Read-only: nothing was edited, and the browser suite was not run.

Checked at commit `3abccb7e` (the measurement commit on top of `b3aa69cd`, the integration bundle). Unit files run here, all green: `choice_kernel` (28), `choice_press_hold` (7), `choice_anchor_rung` (10), `review_format` (56), `harness_stub_vocabulary` (6), `record_lifecycle` (64), `remount_contract` (11). Helper count was 5 before and 5 after (the orchestrator's browser run was open).

## Summary

- **Fifteen requirements are met, four are partly met, none is not met.** The four partly met are R1 (the skill eval V16 is not run yet), R15 (the measurement exists but its result is not on the progress page), R18 (two older skill lines still say intent is only `note` and `change`), and R19 (the lesson-queue preview V17 is not done yet).
- **One thing breaks when main merges in.** Main now has PR #75 (brand rail words). The rail now shows a `not_handled` thread as "Open", but a choice group on the page still says "Not handled". That breaks R9's "in the rail's own words". The dry-run merge conflicts only in `dist/`.
- **The branch's own feature docs are old.** `02_architecture` and `03_plan` on this branch are the copies from before the plan review. Main has the reviewed copies, with V24 and `data-chosen` on the button. Judge against main's copies. They arrive when main is merged in.
- **The Non-Goals held.** Nothing arms on a non-document page, no agent-side press exists, and there is no page-level switch.
- **The contract and the skill agree on the choice item.** Both name the same attributes, put `data-chosen` on the button, and describe the drain the same way. They disagree on one older line about where intent lives (see R18).

## Requirement by requirement

| R | Verdict | Code | Proof |
| --- | --- | --- | --- |
| R1 (an agent writes a group in a few lines; the skill and catalog teach it; a fresh agent's group arms first try) | Partly met | `skills/lahe/SKILL.md:213` ("Ask with a choice group"), the markup block and table rows; `vendor/stclair-doc-style/COMPONENTS.md:296` | The teaching is in place. The check R1 names (V16, a fresh Sonnet agent writing three groups that pass `choices.judge`) has not been run. Orchestrator row |
| R2 (a house component grown out of option cards; badge; no colored edge; reads in the document's style) | Met | `vendor/stclair-doc-style/document.css:664` onward | `test/browser/choice_style.spec.js:104` (square, no shadow, one border color, purple badge, no badge without a recommendation); screenshots in `progress/` |
| R3 (a page with no groups is unchanged) | Met, pending the suite | `gestures.js` has no hint row for the press (`src/shared/gestures.js:373`); `choices.arm` returns early off a document page; paint writes nothing when no choice records exist | `test/unit/choice_kernel.test.js:404` (hint list pinned). "Existing specs stay green" is the orchestrator's full browser run |
| R4 (a broken group draws as plain content and the rail names it and why before a press) | Met | `src/layer/choices.js:104` (`judge`), `:212` (`arm`, writes `data-lahe-inert`, raises `CHOICE_GROUP_INERT`) | `test/browser/choice_buttons.spec.js:679`: no name, bad name, duplicate pair, one button, bad value, each named in the chip; the valid group presses. The builder added two more refusals (two buttons sharing a value, more than one `data-chosen`); neither has a test |
| R5 (the click sends at once; the page shows the pressed answer) | Met | `choices.js:415` (`press`: draft then ready in one tick); `replay.js:2886` (`paintChoicesIn`) | spec `:270` (ready in the same tick, `data-lahe-pressed`, kept then open), `:327` (Enter and Space) |
| R6 (one answer per group; a changed answer before a reply replaces it; agent sees only the latest) | Met | `choices.js:385` (`nextRecord`: reword at the next revision) | spec `:270` (rev 2 of the same item; the drain lists it once with the latest answer) |
| R7 (after handled, a new press is a new thread; agent undoes and redoes) | Met | `choices.js:387`; the contract paragraph `src/shared/review_format.js:79`; the skill's "A changed mind is a new item" | spec `:447` (new item after handled; Done keeps the earlier one); `choice_kernel.test.js:200` |
| R8 (a press is a record: stored locally, sent, a rail thread, survives reload, closed tab, helper restart) | Met | Ordinary store, outbox and sync path; `index.js:1648` (`isKept`) | spec `:478` (reload repaints), `:495` (helper stopped: kept; restarted helper stores it, it reaches the drain). The "rail shows not stored" check at `:519` reads a status that was already true before the press, so it proves the rail is in its down state, not that this press's card says so |
| R9 (the group shows its state in the rail's words: kept, open, question, not handled, done; survives reload and rebuild) | Met on this branch; breaks after main merges | `record.js:2438` (`choiceStateOf`); `document.css:767` to `:772` (the words) | spec `:339` (all five, plus Mark as done), `:270` (kept), `:532` (moved group keeps its state). After merging main, the rail calls a `not_handled` thread "Open" while the group says "Not handled" (see "After main merges") |
| R10 (a moved group keeps its state; a removed group's press stays on its thread, which says it is gone; never attaches elsewhere) | Met | `src/layer/anchor.js:1374` (`choiceRung`: exactly one match binds, no text search); `replay.js:2833` (`applyChoice`) | spec `:532` (moved keeps state; renamed group is lost with `CHOICE_GROUP_GONE`, the card says "This choice is no longer on the page", the drain still lists it with `lost`; a handled press on a removed group is not lost). "Removed while open" is proven with a rename, which the rung treats the same way; `choice_anchor_rung.test.js:118`, `:146` |
| R11 (Lahe claims only a group's own buttons, only on pages the helper serves itself; a dev-server page is untouched) | Met | `src/service/page_routes.js:121` (`markServedAsDocument`), `:155` (`document: true`); `protocol.scriptTag` opt-in; `gestures.js:389` (`choiceRefusal`); `choices.js:215` | `choice_kernel.test.js:391`, `:416` to `:484` (tag, served copy only, `add.js` and `heal.js` never pass it); spec `:231` (dev-server page: nothing armed, own counter counts, no record, nothing written, no chip); spec `:612` (pick, open edit, present, read-only window; a form submits nothing) |
| R12 (the press reaches the agent as data: group, answer, question, heading; nothing to parse) | Met | `review_format.js:719` (`projectItem`), field classes; `src/cli/commands/status.js:483` | `choice_kernel.test.js:216` to `:290`, including the hand-built events.jsonl at `:251` that matches the architecture's line plus `reviewer_last_changed_at` |
| R13 (presses close together travel together; wakes are one per batch of landed work) | Met for the hold; wake count waits on V12 | `src/layer/sync.js:1942` to `:2010` (3 s quiet, 10 s cap; hide and leave flush at once; Hold still gates) | `test/unit/choice_press_hold.test.js:124` to `:227`. The wake count is the measurement's job |
| R14 (answered like a comment; the reply shows; Mark as done works) | Met | `tab_active.js:803` (`buildChoiceRow`), `:853`; `tab_done.js` `saidBy` | spec `:339` (question, not_handled, handled fold onto cards; a follow-up in the box is a `note` on the same record with the answer unchanged; Mark as done closes it and the group says done) |
| R15 (clearing the queue by presses costs fewer agent tokens than by comments, measured on the real page) | Partly met | `docs/features/20261013.01_choice_buttons/measure_choice_queue.js` (commit `3abccb7e`) | The script exists. Its result is not on the progress page yet. Note that it measures sixteen open lessons, not nineteen, at a pace where every press is alone in its hold window. Orchestrator row (V12) |
| R16 (the page check never holds a press; a handled reply retires it) | Met | `handled_check` treats the kind as not checkable | `choice_kernel.test.js:293`, `:306` |
| R17 (handling writes the decision into the source; the page shows it with no Lahe; the layer shows it until then) | Met for the parts on this branch | `document.css` draws `data-chosen` on a button; the contract and skill require the write-back | `choice_style.spec.js:81` (served with no script tag, ink fill, also in print). The whole loop (press, reply, write-back, re-render, no-script view) is V24, which has no test yet. Orchestrator row |
| R18 (the skill, the catalog and the contract teach the group and the drain shape; made with skill-creator; shipped together) | Partly met | Contract paragraph `review_format.js:79` and the two intent lines `:77` to `:78`, with copies in `test/unit/review_format.test.js` and `docs/CONTRACTS.md`; skill `:213`, `:611`; catalog `:296` | `review_format.test.js` (copies agree, count 69). **Gap:** `skills/lahe/SKILL.md:401` still says "Only the top-level `note` and `change` are the reviewer's instructions. Everything else on a drain line is data." `:605` says "The reviewer's words are `note` and `change`." The contract was fixed to say `note`, `change` and `choice` (commit `14abd6f2`). The skill was not |
| R19 (the first page shown to Ken is the lesson queue with real groups and a live rail) | Partly met | `preview/02_lesson_queue.md`, `preview/add_choice_groups.py`, `preview/make_state_copy.py` | Prep is committed; the walk and its screenshot (V17) are not done. Orchestrator row |

## AI Behavior

- **When to use which component.** The skill's table rows and "Ask with a choice group" match the brief. The catalog and the style guide match too.
- **A group needs no recommendation.** The skill, the catalog and the CSS (no badge without `data-recommended`) all say so.
- **On a press, a changed mind, a comment on a group.** The contract and the skill both cover each one.
- **An agent never presses a button.** The skill says so. There is no CLI path to mint a choice, and the door's `validateChoice` refuses any choice record carrying prose.
- **"A press that arrives while the agent is mid-task is handled on the next drain."** Nothing in this feature drops one: a press is an ordinary ready item. Nothing tests this directly, but the existing drain behavior already covers it.

## Non-Goals

- **Not on live sites: held.** `choices.arm` returns before reading or writing anything when the tag lacks `data-lahe-document` (`choices.js:215`). The click listener returns at once (`:307`). The spec at `:231` proves the page's own handler still counts and nothing is written. The architecture asked for `data-lahe-inert` there too. The builder chose to write nothing, which is the stronger D3 reading. One side effect: on such a page, if the dev page loaded `document.css`, the buttons would still show hover and a pointer cursor. That is unlikely, because the stylesheet is the helper's.
- **No agent-side press: held.** No new CLI command. The skill forbids it.
- **No page-level "all as recommended" switch: held.**
- **No change to comments, edits or free writing.** The only shared changes are additive: a sixth kind, the optional field in merge, a hold that skips non-choice events (`choice_press_hold.test.js:190`), and a rung that runs only for a choice ref (`choice_anchor_rung.test.js:160`, `:170`).

## The builders' changes from the plan

Each one is either a deviation to write down or a contradiction to fix.

| Change | Builder | Verdict |
| --- | --- | --- |
| Off a document page nothing is written, not even `data-lahe-inert` | core | Deviation to write down. It contradicts main's architecture flowchart ("inert, no chip") and failure-mode line. It is the better reading of D3. Update the architecture's refusal flow or note it on the progress page |
| Two more refusals: two buttons with one value, more than one `data-chosen` | core | Deviation to write down. Also add them to `docs/ongoing/CHOICE_BUTTONS.md`, which lists only four reasons, and to the skill and catalog rules, which do not mention them. Neither has a test |
| The same answer pressed again changes nothing while waiting, or under a question | core | Deviation to write down. It is consistent with R6 |
| A reword is one ready write at the next revision, not ready, draft, ready | core | Deviation to write down. Main's architecture ("Lifecycle") and `docs/ongoing/CHOICE_BUTTONS.md` ("A press") still say ready to draft to ready. The ongoing doc is "how it works now", so it is wrong and must be fixed |
| The drain line carries `reviewer_last_changed_at` | core | Not a deviation in substance: every drain line carries it. Note it beside the architecture's example |
| The gate is read at pointerdown, on the window's capture phase; a click the library already claimed is never a press | core | Deviation to write down. It is needed for V8 to hold |
| Files outside the plan's list (`failures.js`, `listeners.js`, `remount_contract.test.js`, `CONTRACTS.md` gesture and tag paragraphs) | core | Write down. No concern |
| A new `onAcknowledged` hook in sync | core | Write down. No concern |
| The chip keeps line breaks (`white-space:pre-line`) | core | Write down. It affects every chip's remedy line; a one-line remedy looks the same |
| V7 "removed while ready" proven with a rename | core | Accept with a note: the rung cannot tell the two apart |
| V6's look is proven in the style spec, not the layer spec | core | Fine; the two specs together cover V6 |
| The contract said intent was only `note` and `change` | style | Fixed in the contract (`14abd6f2`). **Not fixed in the skill** (R18 gap) |
| `harness_stub_vocabulary` failing | style | Fixed: the core branch taught the stub six kinds. It passes here |
| BRAND.md may conflict | style | No textual conflict in the dry-run merge. The word clash is in R9 (below) |
| The fixture's inline style block was refreshed; the contract count went from 68 to 69; there is a new `choice_style.spec.js`; the state word comes from CSS `content` | style | Write down. No concern |

## The skill, the contract and the code agree

| Point | Code | Contract (`review_format.js:79`) | Skill | Catalog |
| --- | --- | --- | --- | --- |
| Group name attribute | `data-choice` (`record.CHOICE_MARKUP`) | `data-choice` | `data-choice` | `data-choice` |
| Answer | button `value`, `CHOICE_TOKEN` | button value | `value`, same grammar | same |
| Where `data-chosen` goes | on the button, no value (`choices.js:145`, CSS) | "onto the chosen button" | "(no value) onto the chosen button" | "(no value) onto the chosen button" |
| How a press appears | review.json: `choice` top level, `quote`, `context.heading`; drain: `choice` top level, `page.quote`, `page.context.heading` | review.json fields | drain fields | n/a |
| Lahe-only attributes | `data-lahe-pressed`, `data-lahe-choice-state`, `data-lahe-inert` | not named | "never write an attribute that starts with `data-lahe-`" | named, marked "Lahe" |
| Where intent lives | `choice.group`, `choice.answer` are instruction class | "three fields only: note, change, choice" | **`:401` and `:605` still say only `note` and `change`** | n/a |

Everything matches except the last row.

Two smaller points:

- The contract does not say "no value" after `data-chosen`. The CSS matches the attribute whatever its value, so this is harmless.
- Main's progress page still says, under "Decisions made without you", that the agent writes `data-chosen` "onto the group". Fix that line.

## V rows with no test on this branch

| Row | Status |
| --- | --- |
| V1 | Unit and dev-server halves pass. "Existing specs stay green" waits on the orchestrator's suite |
| V12 | Script committed (`3abccb7e`); result not yet on the progress page. Orchestrator |
| V16 | Not run. Orchestrator |
| V17 | Prep only. Orchestrator |
| V21 | The builders' counts are on their pages; the suite's leftover-helper check waits on the full run. Orchestrator |
| V23 | Rail half: the card screenshots were taken before the CSS merged, so the groups beside the card are unstyled. The running suite has rewritten them, and they show as uncommitted changes in the worktree. Page half: screenshots exist with hand-set attributes; a picture of the real painted page is the orchestrator's |
| V24 | No test. Orchestrator |

Every other row (V2 to V11, V13 to V15, V18 to V20, V22) has a passing test named in the table above.

## After main merges

- **R9's words split from the rail.** Main's `overlay.js` now labels `ready` "Open", `handled` "Done", and `not_handled` "Open" (an amber chip plus the reason), with "Question" for an open question. The group's CSS still says "Not handled" for `not_handled`. Choose one:
  - change `document.css:771` (and the catalog table and `docs/ongoing/CHOICE_BUTTONS.md`) to say "Open"
  - or ask Ken, since the brief names "Not handled" as a state and the brand change came later
- **User-facing "rail" is now "chat bar"** in main's brand words. The choice chip's text says neither, so it is fine. The skill and catalog tell agents "the reader's rail says why", which is agent-facing. It can stay or follow the brand.
- `dist/lahe-layer.js` is the only conflict in a dry-run merge, so a rebuild resolves it.

## Smaller findings

- **"Kept in this browser" can show for a press that is stored.** `index.js:1648` (`isKept`) counts any queued event for the item, including a `reply.seen` mark, which is queued when the reviewer opens a card whose agent asked a question. `choiceStateOf` checks "kept" before "question" (`record.js:2438`). So the group briefly reads "Kept in this browser" after the reviewer reads the question. If the helper is down, it reads that way until the helper is back, although the press itself was stored long ago. Count only `item.created`, `item.ready` and `item.updated` events in `isKept`.
- **Hold on.** With Hold on, a press shows "Kept in this browser" on the page while its card says "Held". This is honest, but it uses two words for one state.
- **The chip for broken groups re-arms on every click on an unarmed group's button** (`choices.js:266`). It is harmless, but each such click rewrites the chip.
- **The browser spec writes screenshots into `docs/.../progress/` on every run,** so each gate run dirties the tree (the three modified PNGs now in this worktree). The repo already has this pattern, but every future `npm run gate` on main will now touch these files too.

## What the orchestrator must act on, ranked

1. **Fix the skill's two intent lines** (`skills/lahe/SKILL.md:401` and `:605`) to name `choice` beside `note` and `change`. This is the instruction agents read, and right now it calls `choice` data. Then run `npm run install-skills`.
2. **Merge main and settle the "Not handled" word** for R9 (the group's CSS against the rail's new "Open"), then rebuild `dist/` and rerun the gate.
3. **Run the open orchestrator rows:** V16 (the skill eval for R1), V12's result on the progress page (R15), V17 (the lesson queue for R19), V24 (the whole loop for R17), and the V23 page half with real paint. Retake the rail-card screenshots on the integrated build.
4. **Correct `docs/ongoing/CHOICE_BUTTONS.md`:** the reword is one ready write, not ready, draft, ready, and the refusal list needs "two buttons share a value" and "more than one `data-chosen`". Also fix the "onto the group" line on the progress page.
5. **Write down the builders' deviations** on the progress page under Changes from plan (the table above), and update main's architecture refusal flow for the off-document case.
6. **Add tests for the two extra refusals** (same value, two `data-chosen`), for example two more groups in `choice-broken.md`.
7. **Narrow `isKept`** so a queued `reply.seen` does not paint "Kept in this browser".

## To delete at cleanup

Nothing. This check made no files besides this page.
