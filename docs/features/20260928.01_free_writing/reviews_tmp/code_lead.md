## Code Review Lead Review (Round 1)

**Short version.** I could review Phase 1 and most of 2C against these docs. I could not review 2A or 2B yet. Four things are missing, and without them the builders would each make up their own answer:

- how a take-back of a run gets replayed
- how the layer finds a record's run blocks on the page after a reload
- how an anchor on `main` compares once the notes are placed
- what `lahe write` serves, given what `--only` really does today

After those come unpinned function shapes between the three builders, copy and failure codes that Phase 2 is not allowed to add, and a few write-cost and size limits that the numbers do not back up.

Code checked: `src/shared/record.js`, `merge.js`, `normalize.js`, `review_format.js`, `protocol.js`, `gestures.js`, `manifest.js`, `src/layer/editing.js`, `replay.js`, `anchor.js`, `sync.js`, `store.js`, `index.js`, `src/service/handled_check.js`, `log.js`, `routes.js`, `markdown.js`, `src/cli/commands/review.js`, `src/cli/index.js`, the spike scripts under the old scratchpad, and the wireframe screens in `wireframes/a-block-menu/`. No `docs/ongoing/diagrams/INDEX.md` exists; the diagrams live in `docs/diagrams/` with a `README.md`.

---

### 1. A take-back of a run has no replay path, and the plan's shape makes replay put the text back

- severity: blocker
- kind: defect
- where: plan Task 1.4 ("take-back records carrying the run"), Task 2.4; architecture "Undo of a committed record"; `src/shared/record.js` `revertOf` (line 1459)
- what: The architecture defines a run record as any record with a non-empty `new_blocks`. Task 1.4 says a take-back "carries the run", and no task gives replay a way to remove placed blocks.
- why: Today `revertOf` swaps `before` and `after`. That only covers the anchor. If the take-back carries the blocks in `new_blocks`, every reader treats it as a run, and replay's insert path puts back the words the reviewer just undid. If it does not carry them, then after the next reload (before the agent acts) the placed blocks are still in the source and still on the page. Brief R15 (undo removes the text from the page) then fails on every reload. The "undo of a handled run" tests in 2.4 and 3.4 run before any reload, so they cannot catch this.
- fix: Name a separate field for blocks to remove, for example `remove_blocks`, and say that a take-back never carries `new_blocks`. Add a replay row for it: find the listed blocks through the same walk and matcher, and hide them until the agent answers, as today's revert does for the anchor. Add a test: undo a handled run, reload before the agent replies, and check that the run is not on the page. **Lands in:** architecture (Data / State Changes, Replay after a rebuild), plan Task 1.4 (field and fixture), Task 2.6 (the remove row), Task 3.4 (seam test).

### 2. No shared way to find a record's run blocks on the live page after a reload

- severity: blocker
- kind: risk
- where: plan Task 2.1 (`itemFor` maps any run block), Task 2.4 (undo removes the run's elements, protection snapshots the run), Task 2.6 (replay inserts); `src/layer/editing.js` `itemFor` (line 1859)
- what: `itemFor` today finds one element through the record's `region.ref`. Run blocks have no ref and no stamp. After a reload they were either inserted by replay (2B) or placed by the agent. Nothing says how 2A finds them again.
- why: Four callers need the list of elements that are this record's run: `itemFor`, committed undo, protection, and the "Cmd-Shift-E on a run block reopens" test. 2A and 2B would each write their own version. One would probably use the matcher and the other a DOM marker, so they would disagree on the same page. The reviewer has no spec to check either against.
- fix: Add `blocks.runElementsFor(record, anchorEl)` to Phase 1 Task 1.3. It returns the live elements matched one-to-one, built on Task 1.2's matcher, and every caller uses it. If the wireframe's dashed "sent, not yet placed" rule (finding 23) is adopted, say whether a layer-only marker on inserted blocks is part of the answer. **Lands in:** plan Task 1.3, Task 2.1, Task 2.4, Task 2.6; architecture (Two sittings in the same place).

### 3. An anchor on `main` cannot compare once the notes are placed

- severity: blocker
- kind: defect
- where: architecture "Empty page and `lahe write`", "Replay after a rebuild"; plan Task 2.3; `src/layer/anchor.js` (probe is the region's text)
- what: On an empty page the anchor is `main`, with `before` and `anchor_after_html` both empty. After the agent writes the notes and the page rebuilds, `main`'s text is the whole page.
- why: The anchor compare reads the anchor's own words. Page text that is neither `before` ("") nor after ("") is branch four, a conflict. The architecture says to "insert nothing until the reviewer answers the conflict". So every notes page would show a conflict card after its first placement. Three more gaps sit behind this:
  - The empty-container rung is defined only for "a page with no content blocks", so after placement nothing says how `main` resolves.
  - The editing host is "the anchor's parent", which for `main` is `body`, while the run goes inside `main`.
  - The handled check has no anchor words to look for (finding 12).
- fix: Add a container-anchor rule. When `placement` is `start_of_container`, the anchor compare is skipped: the anchor is always applied, and only the run is decided by the presence table. The rung resolves by tag whether or not the page has content. The host is the container itself. Add a unit fixture and a 2B test: an empty-page record, the notes placed, a reload, and no conflict. **Lands in:** architecture (Empty page, The editing host, Replay after a rebuild), plan Task 2.3, Task 2.5, Task 2.6.

### 4. `lahe write` is built on a wrong reading of `--only`, and needs files no builder owns

- severity: blocker
- kind: defect
- where: architecture Security ("Every page it serves runs as `--only` with no folder mount"); plan Task 2.10; `src/cli/commands/review.js` lines 226-260 and 321
- what: Today `--only` means "only this page gets the rail; other pages under that root are served without the rail". It does not stop serving the folder. A Markdown review also calls `registerMount` for the source file's folder (`rendered.assetRoot`) and for each linked folder.
- why: The Task 2.10 test "a request for a sibling file gets a 404" cannot pass by passing `--only`. Making it pass means changing either `review.js` or `static_servers.js`, and neither is in 2C's file list. A `lahe write --session X` that joins a session also shares that session's static server. Any folder an earlier `lahe review` in that session mounted stays served. So the promise the security review accepted (SR4, the notes folder is not served) does not hold.
- fix: State the real mechanism. Either `write.js` calls a new `review.js` option that skips the asset mount and the link mounts, or it starts its own single-file server. Add the file that changes to 2C's ownership. Say what happens on `--session` when that session already has mounts: refuse, or start a separate server. **Lands in:** architecture (Security, `lahe write`), plan Task 2.10 and the Phase 2 ownership table.

### 5. The editing host is "the anchor's parent", but the run goes after `sheet-head`, outside that parent

- severity: important
- kind: defect
- where: architecture "The editing host" and "Where after the anchor is"; plan Task 2.1
- what: On the Markdown render, an `h2` anchor's parent is `div.sheet-head`. `insertPointAfter` puts the new block after `sheet-head`, in the `section`. A host set on `sheet-head` does not contain the new block.
- why: The brief R14 header case happens on exactly this page. A builder who follows the text literally ships a new paragraph that cannot be typed into. The alternative is that the builder quietly picks a different host, and the reviewer cannot tell which rule was meant.
- fix: Define the host as the parent of the element `insertPointAfter` climbed to. That is the nearest ancestor holding both the anchor and the run. For a container anchor, the host is the container itself (finding 3). **Lands in:** architecture (The editing host), plan Task 2.1.

### 6. The Phase 1 functions three builders share have no signatures or return shapes

- severity: important
- kind: risk
- where: plan Task 1.2 (reader, matcher), Task 1.4 (validation, anchor view, builder), Task 1.3 (`writeBlock`)
- what: The matcher "says which new blocks are present" but has no return shape. The validation function "returns a named refusal reason", but no name or codes are given. The anchor view and the builder have no names.
- why: 2B's presence table needs to know, per block, whether it is whole, joined, split, or missing, and which leaf indexes it matched. That is how it tells "one-to-one" from the rest and finds "the last present block". 2C's handled check needs the same result. 2A needs it for finding 2. Phase 1 lands first, so the names will exist before Phase 2, but I would be reviewing Phase 1 against nothing, and a shape that fits one consumer can quietly miss another.
- fix: Pin the shapes in Task 1.2 and 1.4. For example, `matchRun(blocks, leaves) -> [{index, status: "whole"|"joined"|"split"|"missing", leaves: [i...]}]`, `validateRun(item) -> null | {code}`, and `anchorView(item) -> item`. List the refusal codes by name. **Lands in:** plan Tasks 1.2 and 1.4.

### 7. The replay walk has no end, so presence is not testable

- severity: important
- kind: risk
- where: architecture "The walk" and "The presence table"; plan Task 2.6
- what: Replay "reads leaf blocks forward from the anchor's insert point", but nothing says where the walk stops.
- why: If it runs to the end of the page, a short block such as "Notes" or "Yes" counts as present when the same words appear anywhere lower down. It then never gets inserted, which breaks the no-duplicate guarantee in the other direction: text goes missing. "In run order" does not bound it either. One test per presence-table row cannot be written without knowing the window.
- fix: State the window. For example, the walk stops at the first leaf that matches no remaining block after at least one match, or at `run length + N` leaves. Name N as a constant beside `SHORT_BLOCK_WORDS`. **Lands in:** architecture (Replay after a rebuild), plan Task 1.2 constants table.

### 8. New card notes and replay flags need shared code that Phase 2 may not touch

- severity: important
- kind: risk
- where: plan Task 2.6 ("through the card's existing flag path"), Task 2.7, Task 3.2; `src/layer/replay.js` `flagConflict` and `CHECK_NOTICES`; `src/shared/record.js` `PAGE_CHECK_FORMAT_NOTE`
- what: Replay's only card flag today is the conflict badge (`failures.failure("REPLAY_NEITHER_MATCHES")`). "Placed in a different spot" and "wrong tag" need new failure codes in `src/shared/failures.js` and new copy. Task 1.4 adds only the two refusal codes. The wrong-tag reopen reuses `PAGE_CHECK_FORMAT_NOTE`, which says "the bold or italic in this edit did not" land.
- why: 2B would have to edit a shared file it is barred from, or reuse the conflict path, which shows a conflict card for something that is not a conflict. A header placed as a paragraph would reopen with a note about bold, so the agent is told the wrong thing to fix.
- fix: In Task 1.4, add the failure codes (placed elsewhere, wrong tag) and a fourth page-check sentence for a wrong tag in `record.js`, with its line in `CHECK_NOTICES`, and write the copy into the plan. **Lands in:** plan Task 1.4 and Task 2.7; architecture (The page check on a run).

### 9. A refused run event loops forever and the reviewer never sees it

- severity: important
- kind: defect
- where: plan Task 2.8, the "Numbers" table (ceiling warning at 90 percent); `src/service/log.js` `append` (returns `rejected`), `src/layer/sync.js` (never reads `rejected`)
- what: The helper will refuse bad or oversized run events with a named code. Today a rejected event is logged by the helper and never acknowledged, so the page re-posts it on every reconnect. The docs also say what the bar does at 90 percent of the ceiling, but not what happens at 100 percent.
- why: A capture bug, or a reviewer who keeps typing past the ceiling, leaves the work sitting in browser storage and never reaching the agent. No chip and no card says so. This is the "work lost silently" failure this tool exists to prevent.
- fix: At the ceiling, the layer stops accepting input into the run, and the bar says so. Write that copy down, along with the 90 percent warning copy. `sync.js` reads `rejected` for the new codes, stops re-posting that event, and shows a card badge. Add a 2C test: a forced over-ceiling event is refused and the card shows it. **Lands in:** architecture (Size ceiling), plan Task 2.2 and Task 2.8.

### 10. The projection still cuts `after_html` at 2000 characters, so the old-agent promise is false

- severity: important
- kind: defect
- where: architecture "Rollout and old agents" and "`before`, `after`, `after_html` keep one meaning"; plan Task 1.6; `src/shared/review_format.js` lines 505 and 528 (`BEFORE_MAX = 2000`)
- what: Only `new_blocks` is exempt from the cut. `after_full` and `after_html` for a run record are still cut at 2000 characters.
- why: The architecture keeps the whole sitting in `after_html` so that an old agent "places every word" and "nothing is dropped silently". For any post over 2000 characters, that agent places a cut-off section. The page check does reopen it later, but that argues against the stated reason for keeping `after_html` whole.
- fix: Either exempt `after_full` and `after_html` for run records (the helper's ceiling is already the limit), or correct the Rollout text to say an old agent gets the first 2000 characters and the page check catches the rest. Add a projection test for whichever is chosen. **Lands in:** architecture (Rollout), plan Task 1.6.

### 11. `after_history` has no cap in the store, so "history full" has no meaning, and the body limit does not fit

- severity: important
- kind: risk
- where: plan Task 2.8 ("a record at both ceilings, with `after_history` full, fits under `MAX_BODY_BYTES`"); `src/shared/record.js` `bumpRev` (no cap); `review_format.js` `AFTER_HISTORY_MAX = 50` (projection only); `src/service/index.js` `MAX_BODY_BYTES = 8 MiB`
- what: A record at the ceiling carries the run three times: in `new_blocks`, `after_html`, and `after`. That is about 600,000 bytes of ASCII, or about 1,800,000 bytes for three-byte characters (computed with Python). Each history entry now carries the same fields. At the ceiling, 12 ASCII entries or 3 CJK entries fit under 8 MiB. The store keeps every entry.
- why: The Task 2.8 test either fails, or passes only because the builder picks a small "full" on their own. A notes page where every sitting bumps the revision grows its history without limit.
- fix: Add a store-side cap on history entries that carry `new_blocks`. For example, keep the runs of the last K entries and drop `new_blocks` from older ones, since branch three only needs recent revisions. Name K. Make the ceiling a byte count, not a character count, or state the three-byte case. **Lands in:** architecture (Data / State Changes), plan Numbers table and Task 1.4.

### 12. The run and bold handled checks have no matching rule the helper can run

- severity: important
- kind: risk
- where: architecture "The handled check"; plan Task 2.9; `src/service/handled_check.js` (a page-wide containment test; its own comment says the helper cannot find a region in a file)
- what: "Anchor words, then each block's words in order" needs a starting point in the built HTML. The helper cannot find the anchor, the anchor's words can be short or appear many times, and a container anchor has no words at all. "Checked for the `strong` and `em` it asked for" does not say what counts as present.
- why: Two builders could write passing tests against different rules. Using a page-wide search with no order also means a block that exists elsewhere on the page passes.
- fix: Spell out both rules:
  - For a run: skip the anchor when it is a container or has fewer than `SHORT_BLOCK_WORDS` words, find the first run block's leaf page-wide, then match the rest in order from there with Task 1.2's matcher.
  - For bold on a `format_only` record: take the changed runs from `record.formattingChangeText`'s run reader, and for each, require the words inside a `strong` or `b` (or `em` or `i`) in the built page's leaf blocks. Say plainly that bold words appearing elsewhere give a false pass.
  **Lands in:** architecture (The handled check), plan Task 2.9.

### 13. Any question on a run record gets the proofreading buttons

- severity: important
- kind: defect
- where: plan Task 3.3; brief "AI Behavior" ("When the agent cannot tell where new text belongs, it asks")
- what: "Use the fixes" and "Keep my words" show on any `question` reply on a run record.
- why: A placement question on a run ("Should this go under Intro or Premise?") would offer "Use the fixes". Clicking it posts a reply that answers a different question.
- fix: Mark the proofreading reply in a structured way. For example, add a reply field or flag in `protocol.js` `REPLY_FIELD` in Phase 1, and have the contract tell the agent to set it. Show the buttons only when it is set. Also write down the exact thread text each button posts, since the agent reads it. **Lands in:** architecture (The proofreading reply), plan Task 1.5 or 1.6 and Task 3.3.

### 14. The agent is asked to count 150 words itself

- severity: important
- kind: risk
- where: architecture "The proofreading reply"; plan Numbers table (`PROOFREAD_MIN_WORDS`)
- what: The contract asks the agent to proofread when the run's words, minus `from_anchor` blocks, number more than 150.
- why: Agents miscount. R11 (proofreading after a long hand-written block) then fires at random near the line, and a reviewer cannot tell a code bug from a counting error.
- fix: Have the projection compute it. Project `run_words` (or `proofread: true`) per item, counted by one named function in `normalize.js`, and have the contract read that field. **Lands in:** architecture (The proofreading reply, Projection), plan Task 1.6.

### 15. The contract does not tell an agent that a later revision repeats blocks it already placed

- severity: important
- kind: risk
- where: architecture "Two sittings in the same place" ("The agent sees a rewording"); Contract changes list
- what: On a notes page, the second sitting grows the same record. If the agent has already placed revision 1's blocks, revision 2's `new_blocks` repeats them and adds more.
- why: An agent that follows "place the blocks after the anchor, in order" writes revision 1's blocks twice in the source. Replay then sees them twice. The presence table does not cover duplicates the agent itself put in the source.
- fix: Add a contract line: `new_blocks` is the whole run at this revision; place only the blocks not already in the source after the anchor. Add a 3.4 case: the agent places revision 1, the reviewer adds a sitting, the agent places revision 2, and every block shows once. **Lands in:** architecture (Contract changes), plan Task 1.6 and Task 3.4.

### 16. "Cmd-Shift-E with the pointer over no block" is not today's rule, and write state has no gesture row

- severity: important
- kind: risk
- where: plan Task 2.3; `src/layer/editing.js` `editBlockAtCaret` (line 2248); `src/shared/gestures.js` rows and `gestureFor`
- what: Today Cmd-Shift-E edits the block at the caret, not under the pointer. The plan's "write state" needs a new gesture decision, a hint row, and a rule for Esc. All of that lives in the shared `gestures.js`, which Phase 2 may not touch, and Task 1.5 adds only the hotkey matcher.
- why: 2A would either change `gestures.js` without permission or put a second gesture rule inside `editing.js`. The file's own rule is one decision, in one place. Nothing says what Esc does with a session open inside write state: commit only, or commit and leave write state.
- fix: In Task 1.5, add a write-state gesture to `gestureFor` and a hint row with its copy. Say whether "over no block" is judged by the caret or the pointer. Say that Esc first commits an open session, and a second Esc leaves write state. **Lands in:** plan Task 1.5 and Task 2.3.

### 17. Mod-Alt digit hotkeys matched on `event.code` take over AltGr characters on Windows

- severity: important
- kind: risk
- where: plan "Block-type hotkeys" table
- what: On Windows, Ctrl-Alt is AltGr. On a German layout, AltGr-7, AltGr-8, AltGr-9 and AltGr-0 type `{`, `[`, `]` and `}`, and AltGr-2 and AltGr-3 type `²` and `³`. Matching on `event.code` alone treats those keys as the chord.
- why: A Windows reviewer typing a closing brace turns the block into a paragraph, and typing `²` turns it into a heading. `CLAUDE.md` names Windows as supported.
- fix: On non-macOS systems, skip the chord when `event.getModifierState("AltGraph")` is true or when `event.key` is a printable character. Add a unit case to Task 1.5's matcher test. **Lands in:** plan Block-type hotkeys and Task 1.5.

### 18. Placement on an HTML page is required but never tested

- severity: important
- kind: defect
- where: brief R9 (how to place new text, for HTML and for Markdown); plan Acceptance R9; plan Task 3.4
- what: The acceptance line says a contract-only agent places a run in HTML and Markdown. Task 3.4's scripted agent only writes Markdown.
- why: "The start of the container the region names", and escaping for HTML and templates, are contract lines nobody runs. An evaluator cannot mark R9 green from the task list.
- fix: Add a 3.4 case that places the worked example into an HTML source (`blog.html`), including one block with `<` and `&` in its words. **Lands in:** plan Task 3.4 and Test List.

### 19. The copied R14 scripts point at the main checkout, so they test the wrong code from a worktree

- severity: important
- kind: risk
- where: plan Task 1.1; `r14_repro/repro.js` line 10 (`const REPO = "/Users/kennethstclair/Documents/workspace/live-agentic-html-editor"`), and the same absolute path in `host_spike/*.js`
- what: The scripts that seed Tasks 2.7, 2.9 and 3.4 run `bin/lahe.js` and Playwright from the main checkout.
- why: Run from a builder's worktree, they exercise main's code, not the branch. A pass means nothing. Task 1.1's acceptance line also asks them to reproduce the bugs, so once the fix lands they "fail" by design.
- fix: Task 1.1 replaces the absolute path with a path relative to the repo root (`path.resolve(__dirname, "../../..")`). The acceptance line becomes a before-and-after pair: the walk reproduces on the Phase 1 base and passes after Task 3.4. **Lands in:** plan Task 1.1.

### 20. The cost of writing to storage on every keystroke is not stated for a whole post

- severity: important
- kind: risk
- where: plan Task 2.1 (capture through `cleanBlock`); `src/shared/protocol.js` `FLUSH.TO_BROWSER_STORAGE` ("every keystroke, synchronously"); `src/layer/store.js` `writeDraft`; code-review checklist "Cost of writes"
- what: Each keystroke rebuilds the whole run through `cleanBlock`, rebuilds `after_html` and `after`, and writes the whole record to `localStorage`, history included. The plan only lengthens the helper's draft floor.
- why: For a long post, each keystroke reads and writes the whole record. That record can reach hundreds of kilobytes (finding 11), which is the same shape as the 300 KB-per-keystroke problem the checklist names. Nobody has measured it.
- fix: Recapture only the block the caret is in and reuse the cleaned html of the rest. Add a measurement with `scripts/measure_draft_write_cost.js` on a 5,000-word run, with a stated budget per keystroke, as a Task 2.1 acceptance line. **Lands in:** architecture (Draft growth), plan Task 2.1.

### 21. "All six types by menu, hotkey, and Markdown shortcut" contradicts the plan's own table

- severity: minor
- kind: defect
- where: plan Acceptance R3, Task 2.2 acceptance, Test List (Writing 2A)
- what: The table leaves h4 out of the menu, and `p` has no Markdown shortcut.
- why: Taken literally, the test cannot pass. Taken loosely, each evaluator reads it differently.
- fix: Reword it as "each type by every route the table gives it". **Lands in:** plan.

### 22. "No mode switch" against "write state"

- severity: minor
- kind: challenge
- where: brief Non-Goals ("A new mode"); plan Acceptance R2; plan Task 2.3; `wireframes/a-block-menu/02-edit-state.html` ("Edit state, no block open")
- what: Ken approved a page-level state with no block open. The plan calls it "write state". The plan's R2 acceptance line says there is no mode switch.
- why: An evaluator reading R2 fails Task 2.3 by design.
- fix: Use the wireframe's name ("edit state, no block open"). Reword the R2 acceptance line to "the same Cmd-Shift-E, frame and bar; no second editor". **Lands in:** plan.

### 23. The wireframe's dashed "sent, not yet placed" rule has no task

- severity: minor
- kind: defect
- where: `wireframes/a-block-menu/05-waiting.html` ("The dashed rule marks it as sent but not yet placed"); plan Task 3.2
- what: The approved direction shows a visual marker on unplaced run text. No task builds it and nothing says it is dropped.
- why: The design review will find a gap against the approved wireframe.
- fix: Add it to Task 3.2 as a layer-only style that never reaches a record, or record it as dropped under Changes from plan. It may also help with finding 2. **Lands in:** plan Task 3.2.

### 24. Change text for a run leaves three cases undefined

- severity: minor
- kind: risk
- where: architecture "Change text"; plan Task 1.4; `record.js` `editChangeText` (today it quotes words: `Changed "..." to "..."`)
- what: Three cases have no rule:
  - When the anchor was also reworded in the sitting, does its half keep today's quoting?
  - What does "after this paragraph" say when the anchor is a header, a list, or `main`?
  - What sentence does `start_of_container` get?
- why: `change` is an intent field, and the security review made "structure only" a rule. A builder who reuses `editChangeText` for the anchor half puts words into the instruction channel.
- fix: Give the sentences for each case in Task 1.4, and say whether the anchor half quotes. **Lands in:** architecture (Change text), plan Task 1.4.

### 25. The leaf-block rule makes each `li` a leaf, but the text says a list is one block

- severity: minor
- kind: defect
- where: architecture "The walk"; plan Task 1.2
- what: `li` is in `BLOCK_TAGS` and holds no block tags, so by the stated rule each item is a leaf and the `ul` is not.
- why: The string reader and the DOM walk could each special-case lists differently, and Task 1.3 asks them to match.
- fix: Add to the rule: "`ul` and `ol` are leaves; their `li` children are lines, not blocks". **Lands in:** architecture, plan Task 1.2.

### 26. The architecture and the plan disagree about `export.js`

- severity: minor
- kind: defect
- where: architecture reader table (`export.js` "writes the whole-sitting `after`, as today"); plan Task 1.6 (formatter shows blocks by type, asserted in `export_text.test.js`); `test/unit/export_text.test.js` header ("no assertion about the wording review_format produces")
- what: One doc says export is unchanged. The other changes it and asserts the wording in a test file whose own rule forbids that.
- why: The reviewer cannot tell which one is the contract.
- fix: Pick one. If the formatter changes, put the wording assertions in `review_format.test.js` and fix the architecture row. **Lands in:** architecture reader table, plan Task 1.6.

### 27. The Phase 2 ownership table leaves out test files the tasks edit

- severity: minor
- kind: risk
- where: plan Phase 2 table and each task's Files list
- what: The tasks edit these test files, but the table does not list them:
  - 2A: `anchor_cases.test.js`, `anchor_engine.test.js`, `protect_vocabulary.test.js`
  - 2C: `draft_flush_cadence.test.js`, `cli_dispatch.test.js`, `markdown_render.test.js`
  - Task 1.6 asserts in `export_text.test.js` but does not list it.
- why: The Phase 2 check that "the diff touches only files its builder owns" flags them, or gets waved through by hand.
- fix: Add them to the table and to Task 1.6's Files. **Lands in:** plan.

### 28. Nothing says which anchors can take a run

- severity: minor
- kind: risk
- where: architecture "Block types while writing"; plan Task 2.1
- what: Enter at the end of a `td`, `th`, `dt`, `dd` or `figcaption` would put a `p` where the parent cannot hold one.
- why: Invalid structure on the page, and a record the agent cannot place.
- fix: Say that a run is offered only when the insert point's parent can hold flow content. Otherwise Enter keeps today's break rule. **Lands in:** architecture, plan Task 2.1.

### 29. Unnamed session-history details

- severity: minor
- kind: risk
- where: architecture "Undo inside a session"; plan Numbers table
- what: What counts as "the end of a typing burst" is not defined (an idle time in milliseconds?). `SESSION_HISTORY_MAX = 100` whole-area snapshots at the ceiling size is about 20 MB of strings.
- why: Undo order tests depend on where a burst ends. The memory cost is not stated.
- fix: Name a `TYPING_BURST_IDLE_MS`. Store snapshots as changed blocks only, or state the memory limit. **Lands in:** plan Numbers table, Task 2.4.


---

**Contradictions between documents, collected:** findings 4 (`--only`), 5 (host against insert point), 10 (Rollout against projection), 18 (R9 against Task 3.4), 21, 22 and 26.

**Cleanup needed:** none from this review.
