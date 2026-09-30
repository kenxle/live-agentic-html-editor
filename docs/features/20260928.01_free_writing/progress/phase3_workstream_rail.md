# Phase 3, rail workstream: progress

**Summary.** Tasks 3.2 and 3.3 are built on `free-writing-rail`, in commits `5b99588` and `4267dac`. `npm run gate:unit` is green: 1696 tests, 1694 pass, 0 fail, 2 todo. The named browser specs pass in Chromium: 81 passed, 1 skipped (a `test.fixme` that records a replay defect, below). No full suite ran. `dist/` was rebuilt locally for the specs and screenshots and is not staged.

One thing needs the orchestrator: a replay defect found here (see "Found, not fixed").

## What was built

### Task 3.2: the edits row and the card show new blocks

- **The two pinned lines.** `overlay.runSummary(item)` is pure and at module scope. The folded card and the Edits row both read it, so they say the same thing. It gives:
  - the first line: "New text after '{first words}'", "Edit of '{first words}' plus new text", or "New text at the start of the page"
  - the second line: the shape by count, for example "A heading, 'What the chat window cost me', then 2 paragraphs and a 3-item list."
  - each block with the block menu's label, read from `gestures.BLOCK_TYPES`
- **The Edits row** (`tab_edits.js`):
  - it leads with the two lines, then lists the blocks by type
  - the before-and-after pair shows only when the anchor itself changed, and then shows the anchor alone
  - the agent-facing `change` text is no longer printed on a run's row
- **The folded card** shows the first line (`collapsedLineText`). Folding hides the block list.
- **A split tail** reads "Paragraph, moved" in the list and "a paragraph moved out of it" in the second line.
- **Replay's notes.** `REPLAY_RUN_WRONG_TAG` and `REPLAY_RUN_PLACED_ELSEWHERE` already reach the card as badges through `setCardBadge`. The specs prove both are drawn.
- **The refusal** (`RUN_EVENT_REFUSED`):
  - `index.js` wires sync's `onItemRefused` to `rail.refreshCard`
  - it hands the rail `sync.refusalFor` through the new `rail.setRefusalSource`
  - a refused card shows the pinned badge, and its state chip reads "Not sent", never "Ready"
  - the late-card clock does not run on it
- **The wash.** When a sitting commits, `tab_edits.js` puts the changed-text wash (`highlight.markChanged`) on its new blocks. A moved tail is not washed. This stands in for the dashed rule the plan cut.
- **The empty page.** On a page with no content blocks, the Active and Edits panes show the four pinned lines. The file name comes from the marked file-name title. A page without one gets "Start typing."
- **The empty page's draft.** The empty page opens with an empty draft, and a card for it would hide those lines. So a `start_of_container` draft with no words is not drawn and not counted, until the reviewer types.

### Task 3.3: the proofreading question

- **Which question gets buttons.** Only a `question` reply marked `proofread` on a run record shows "Use the fixes" and "Keep mine". They sit under the question text, two `cardact` buttons at equal weight. Today's question treatment and follow-up box are unchanged.
- **"Use the fixes":**
  - it applies `record.applySuggestions` as the reviewer's reword
  - it makes exactly one new revision, carrying the pinned text as the reviewer's turn
  - replay rewrites the placed block, and the Edits row lists the fixed words
  - the button is left out when `applySuggestions` refuses
- **"Keep mine"** posts its pinned text and changes no words.
- **After either answer:**
  - the card says "Waiting on the agent"
  - the thread shows the pinned text as "You"
  - both are worked out from the record, so a reload shows them too
  - the card stays on its own tab (Edits) instead of jumping to Active
- **The toast and the thread round** for a run name it by the summary's first line, not by the change text written for the agent.

## Files

| File | Why |
|---|---|
| `src/layer/overlay.js` | `runSummary`, `emptyPageLines`, `isBlankStartDraft`, the refusal source and "Not sent" chip, the empty-page panes, the folded line for a run. Takes `gestures`, `normalize` and `blocks` as factory dependencies now (all load before it). |
| `src/layer/tab_edits.js` | The run row, the block list, the commit wash, `runWashIndexes`. |
| `src/layer/tab_done.js` | The proofread fold fields, the two buttons, `proofreadOffer`, `keepMineRecord`, the waiting line and pending turn, the toast line. |
| `src/layer/index.js` | `onItemRefused` and the refusal source (the handoff). Also `onContinued`: see Deviations. |
| `src/service/replies.js` | See Deviations. |
| `test/unit/rail_run_cards.test.js` (new) | 16 tests: the summary lines, the block list, the split, the start of page, the empty lines, the proofread offer, both answers, the pinned words. |
| `test/unit/block_changes.test.js` | +1: the wash indexes, and that a moved tail is never washed. |
| `test/browser/edits_tab.spec.js` | +8 tests and 1 fixme: summary and disclosure, split, wash, both replay notes, refusal, the empty notes page, an empty HTML page, a page with content. |
| `test/browser/agent_replies.spec.js` | +4 tests on the real app with a real helper: Use the fixes end to end, Keep mine, a fix that cannot apply, a placement question. |
| `test/browser/support/refusing_helper.js` (new) | A stand-in helper that refuses every run event. It replaces `window.fetch` for the helper's origin. |
| `test/fixtures/rail-empty-page.html` (new) | An HTML page with no content blocks and no file-name title. |

## Commands and results

| Command | Result |
|---|---|
| unit tests before the code (`rail_run_cards`, `block_changes`) | 16 failed, the expected red |
| new `edits_tab` specs before the code | 7 of 8 failed, the expected red |
| new `agent_replies` specs before the code | 3 of 4 failed (the placement question already passed, as it should) |
| `npm run gate:unit` (final) | 1696 tests, 1694 pass, 0 fail, 2 todo |
| `npx playwright test` on `edits_tab`, `agent_replies`, `card_collapse`, `edits_undo_rows`, `free_writing_empty`, `rail_design`, `rail_pill_count`, `reply_toast` | 81 passed, 1 skipped (the fixme), 26.8s by the reporter |

Two tests went in after their code, and each was then run red against the old bundle: the empty page's "0 hand edits" count, and "no new_blocks text on a run's thread". The toast-line assertion was added after its fix and was not seen red.

No full browser suite ran. Chromium only.

## Screenshots

Taken from the built page after the passing specs. The script is `scratchpad/rail/shots.js`, outside the repo. Light is on `md_render.html` and dark on `dark.html`. The empty notes page is `empty_notes.html`; its dark shot darkens that page, then calls `rail.refreshScheme()`. The helper is down, so its chip shows in the footer.

| State | Light | Dark |
|---|---|---|
| Waiting on the agent, the three-block run's row, with the commit wash (wireframe 05) | [light](shots/rail/waiting_light.png) | [dark](shots/rail/waiting_dark.png) |
| Placed: handled, in Done (06a) | [light](shots/rail/placed_light.png) | [dark](shots/rail/placed_dark.png) |
| The proofread question with its two buttons (06b) | [light](shots/rail/question_light.png) | [dark](shots/rail/question_dark.png) |
| After Use the fixes (06c) | [light](shots/rail/after_use_fixes_light.png) | [dark](shots/rail/after_use_fixes_dark.png) |
| After Keep mine (06d) | [light](shots/rail/after_keep_mine_light.png) | [dark](shots/rail/after_keep_mine_dark.png) |
| Refused by the helper, "Not sent" | [light](shots/rail/refused_light.png) | [dark](shots/rail/refused_dark.png) |
| Wrong-tag note | [light](shots/rail/wrong_tag_light.png) | [dark](shots/rail/wrong_tag_dark.png) |
| The empty Edits tab on a new notes page (b4) | [light](shots/rail/empty_edits_light.png) | [dark](shots/rail/empty_edits_dark.png) |

The "after Use the fixes" shots also show the false placed-elsewhere note described below.

## Found, not fixed: a replay defect

After "Use the fixes" rewords a middle block of a run (block 1 of a heading, a paragraph and a list), replay's branch three rewrites that block in place, which is right. The block after it then reads as missing from its place, and the card gets `REPLAY_RUN_PLACED_ELSEWHERE` ("... is already further down the page") while the page is exactly right. The fix belongs in `src/layer/replay.js` `placeRun`, which this workstream does not own. The spec is `edits_tab.spec.js`, "after Use the fixes, the blocks after the fixed one raise no placed-elsewhere note". It is `test.fixme` and was seen failing for this reason before it was marked.

## Deviations

- **`src/service/replies.js` changed** (outside the ownership table). The helper's reply fold dropped `proofread` and `suggestions`, so the rail could never see a proofread. The fold now carries both, only on a proofread reply. `agent_replies.spec.js` proves it end to end. There is no unit test of its own.
- **`index.js` `onContinued` changed**, beyond the refusal wiring:
  - after a continuation on a run record, it refreshes replay's item cache, schedules a replay pass, and refreshes the Edits tab
  - without this, "Use the fixes" would not show the fixed words on the page or in the row
  - it is scoped to run records, so every other follow-up is unchanged
- **Wording the plan does not pin:**
  - a pure split's first line is "Edit of '{first words}'", with no "plus new text"
  - the moved tail reads "a paragraph moved out of it" and "Paragraph, moved"
  - a list reads "a 3-item list", or "a 3-item numbered list"
  - the refused chip reads "Not sent"
- **First words** are the first six, then "...", as replay's card notes cut them. The first line quotes the anchor's words from before the edit.
- **"Under the card's existing disclosure"** is the card's chevron fold. An open card leads with the two lines and then lists the blocks. A folded card shows the first line only.
- **The empty page's draft** is hidden and left out of the counts (see Task 3.2 above). This is a rail-only reading; the record is untouched.
- **"Waiting on the agent"** is drawn as the card's notice. It stays until a reply folds.

## Cleanup needed

To delete at cleanup:

- `test/browser/tmp_rail_probe.spec.js`: an untracked scratch probe, emptied to a comment so the no-sleeps lint passes. Never committed.
- `node_modules` symlink in this worktree: untracked, never committed.
