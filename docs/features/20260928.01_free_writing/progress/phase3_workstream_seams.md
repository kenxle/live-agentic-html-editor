# Phase 3, seams workstream: progress

**Summary.** The replay bug is fixed, plan Task 3.4 is built, and two product fixes came out of it. Everything is on `free-writing-seams`, in five commits (`6b00065` to `fd1218d`). `npm run gate:unit` is green: 1712 tests, 1710 pass, 0 fail, 2 todo. The named specs pass in Chromium: `free_writing_seams` (21), `edits_tab` (14) and `free_writing_r14` (6), 41 passed, 0 failed. No full browser suite ran. `dist/` was rebuilt locally and is not staged.

One item needs the orchestrator: the plan's "Old agents" line does not hold for HTML, and the architecture says it should not (see Deviations, first bullet).

## 1. The replay bug (`6b00065`)

- **The bug.** After "Use the fixes" rewords a middle block of a run, replay rewrites that block in place (branch three), which is right. The run walk stops at the first leaf that does not match, so every block after the fixed one read as missing. The block after it was then found "elsewhere" on the page and got a false `REPLAY_RUN_PLACED_ELSEWHERE` note, though the page was right.
- **The fix.** In `src/layer/replay.js` `placeRun`: before calling a missing block "placed elsewhere", replay checks the leaf right after the last placed block. If that leaf holds the block's words, the block is present there (and gets its tag or bold fixed like any one-to-one block). Two small helpers, `leafAfter` and `sameBlockWords`.
- **The test.** `edits_tab.spec.js`, "after Use the fixes, the blocks after the fixed one raise no placed-elsewhere note". The `fixme` is gone. It failed with `["REPLAY_RUN_PLACED_ELSEWHERE"]` before the fix and passes after. The four replay specs (`replay_run_insert`, `replay_run_check`, `replay_run_anchor`, `replay_old_records`) still pass: 72 with `edits_tab`.

## 2. Task 3.4

### Files

| File | What it is |
|---|---|
| `test/browser/free_writing_seams.spec.js` (new) | 21 tests, one or two per Acceptance bullet |
| `test/browser/support/lahe_world.js` (new) | A real `lahe review` or `lahe write` from this checkout (`LAHE_REPO` or the file's location), its own state folder and helper port. Reads `review.json`, runs the drain command, replies with `lahe reply`, writes the source with a later mtime. `agentWrites` fails when the page does not reload itself; there is no reload-by-hand fallback. |
| `test/browser/support/scripted_agent.js` (new) | The scripted agent. It takes only the parsed item and the source text and returns the new source. Markdown and HTML. It never reads the page or `window.__lahe`. `itemFromDrainLine` lifts a drain line's `page` fields to the item's shape. `oldContract: true` is the old agent. |
| `test/browser/free_writing_r14.spec.js` | The typed cases the plan lists (below) |

### What the scripted agent does, by contract line

- `new_blocks`: placed after the anchor, in order, each with its tag and bold and italic. Only the blocks not already there are added.
- `placement`: `after_anchor`, or `start_of_container` (top of the file).
- `from_anchor`: the anchor becomes `anchor_after_html`, and the tail is placed as its own block.
- `anchor_tag_after`: the anchor's element changes to that tag.
- Literal text: in Markdown every syntax character is backslash-escaped, `<` is written as `&lt;` and `&` as `&amp;`. In HTML the block's html is already escaped and goes in as it is.
- `remove_blocks`: a take-back removes those blocks and adds nothing.
- An earlier revision's words in a block's place are rewritten to this revision's (how "Use the fixes" reaches the source).
- `region.stamp` is carried onto the anchor in HTML when `stamp_carriable` is true.
- The old agent: in HTML it applies `after_html` as the anchor's content; in Markdown it pastes `after_full` as paragraphs in place of the anchor.

### Each Acceptance bullet and its test (`free_writing_seams.spec.js`)

| Bullet | Test |
|---|---|
| Placement | "placement: a header, paragraph and list typed after a block ..." Also checks the drain line: `new_blocks` sits under `page`, and the agent's output from the drain line equals its output from `review.json`. |
| HTML | "HTML: the worked example, one block holding < and & ..." Placed from the drain line itself. |
| Special characters | "special characters: the page's text is the typed text ..." |
| Split | "split: Enter mid-paragraph, type, commit ..." |
| Retag and undo | "retag and undo: paragraph to heading ..." |
| Undo a ready run | "undo a ready run, then reload twice: the run is gone" |
| Undo a handled run | "undo a handled run: the agent removes the blocks and answers the take-back ..." |
| List | "list: Enter at the end of an existing bullet ..." |
| Reload mid-sitting | "reload mid-sitting: the record is ready and the run is back ..." and "reload mid-sitting with a run over FLUSH.KEEPALIVE_MAX_BYTES ..." |
| Crash mid-sitting | "crash mid-sitting (persistent context): the next load commits the whole run" |
| Rebuild mid-sitting | "rebuild mid-sitting: the reload waits while the sitting is open ..." |
| Handled check | three tests: nothing written; raw HTML; two runs, one skipped |
| Notes page | "notes page: three sittings ..." and "notes page: a sitting added after revision 1 ..." |
| Proofreading | "proofreading: ... use-fixes ..." and its "keep-mine" twin |
| Old agents | "old agents (html)" and "old agents (md)" |

Every item the agent acts on is read from `review.json` at its committed rev (`helperHas`), never from `window.__lahe.items()`. The page's own state (`itemById`, card badges) is read only for assertions about what the reviewer sees.

### R14 spec, the typed cases

- The header case (click and Esc): the `h2`'s `textContent` is exactly "Intro", and the new line is the block right after the `sheet-head`. Screenshots while writing and after the rebuild.
- The lone paragraph, bold in the first and in the second paragraph: the agent now replies handled, and the item reopens (the helper holds it, `handled_not_on_page`). The bold paragraph still shows once with its bold.
- Bold two words with a correct agent (new): the agent writes `**too fast**`, replies handled, and the item retires. After a reload the bold is on the page and the page check leaves it handled. The "agent that changes nothing" case was already there.

### Checking the tests catch what they claim

These tests cover code that already exists, so most of them passed on first run. To check they are not passing by accident, I broke the agent on purpose twice and ran the affected tests:

- The agent drops bold: the placement test fails (the handled check holds it).
- The agent inserts the fixed sentence instead of replacing the old one: the "Use the fixes" test fails (the original sentence is still there).

Both mutations were reverted.

## 3. Product fixes found by the seam tests

1. **A crash mid-sitting lost the run from the page and the drain** (`65a0cba`, `fd1218d`). The architecture's failure table says the next load commits it. Two gaps stopped that:
   - `editing.recoverWithdrawn` only committed an edit that had been committed before. A run's first sitting stayed a draft: off the page (replay skips drafts) and off the agent's drain. It now commits a run draft that changed something, with the run's own change text (`recoverRun`, `runChanged`). The blank page's own empty draft is left alone. A plain edit that was never committed is still left alone, as before.
   - After a crash the helper still names the dead window, so the next load starts read-only. Recovery ran only at boot, so it never ran for that load. `index.js` `exitReadOnly` now runs it too, when the window takes the review back.
   - Tests: two new unit tests in `test/unit/reopened_edit.test.js` (red first: 0 recovered, expected 1), and the seams crash test (red before each half of the fix).
2. **The false placed-elsewhere note** (section 1 above).

## Commands and results

| Command | Result |
|---|---|
| `edits_tab` fixme test, before the fix | 1 failed, for the placed-elsewhere note |
| `edits_tab` plus the four replay specs, after | 72 passed |
| `node --test test/unit/reopened_edit.test.js`, before the fix | 1 failed (0 recovered, expected 1) |
| `npm run gate:unit` (final) | 1712 tests, 1710 pass, 0 fail, 2 todo |
| `free_writing_seams`, `edits_tab`, `free_writing_r14` (Chromium, 4 workers, final) | 41 passed, 2.0m by the reporter |
| `free_writing_empty`, `free_writing_undo`, `reload_claim` (they touch the recovery path) | 15 passed |

`node scripts/build-layer.js` ran before every browser run. No full suite ran. Chromium only.

## Deviations

- **Old agents in HTML: plan and architecture disagree.** The plan wants the item "reopened or flagged, never quietly handled" in both sources. In Markdown it is: the headings and list come out as paragraphs, and the page check reopens it for the wrong tag. In HTML the old agent applies `after_html` as the anchor's content. `after_html` now carries every block with its tag, and the browser's parse closes the `p` at the `h2`, so the page comes out right and the item is correctly handled. The architecture ("Rollout and old agents") only promises that nothing wrong is handled silently. So the HTML test checks that: reopened or flagged, or every block on the page with its tag and bold. **The orchestrator decides** whether the plan line or the test changes.
- **How the agent finds the old words for "Use the fixes".** `after_history` in `review.json` carries no `new_blocks`: `boundHistory` in `review_format.js` projects only `rev`, `after`, `after_html` and `at`. The agent reads the earlier revision's blocks back out of that entry's `after_html`. That field is cut at `BEFORE_MAX`, so on a long run an agent may not find the old block that way. The contract does not say how to find the words to replace. This is a follow-up for the orchestrator, not fixed here.
- **The crash test takes the review back by hand.** The helper still names the dead window for up to 30 seconds. The test uses `sync.takeover()` (what "Review here instead" calls) instead of waiting. The fix makes recovery run on either path.
- **The crash itself.** CDP `Page.crash` kills the renderer so no unload runs, then `Browser.close` shuts the browser, and the relaunch waits until the old process is gone. The profile lives under `testInfo.outputPath()`.
- **Reviewer actions through the layer's own calls:** Undo is `editing.undo(id)`, which the Edits row's Undo button calls. The proofread buttons are pressed with the button's own `click()`, as `agent_replies.spec.js` does. Typing, Enter, Esc, Cmd-Shift-E, the B button and reloads are real input.
- **The big-run test pastes** its text (the editing workstream's paste stand-in). Typing 64 KB with the keyboard is slow.

## Screenshots

In `phase3_seams_screens/`, from the passing runs. Light only: neither fix changes anything drawn apart from removing a false note.

- `after-use-fixes-no-note.png`: the card after Use the fixes, with no placed-elsewhere note
- `header-line-writing-click.png`, `header-line-writing-Esc.png`: the R14 header line while writing
- `header-line-rebuilt-click.png`, `header-line-rebuilt-Esc.png`: after the rebuild, the line once, right below the sheet-head

## Cleanup needed

To delete at cleanup:

- `node_modules` symlink in this worktree: untracked, never committed.
- `/private/tmp/.../scratchpad/crash/` (the crash probe and its profiles) and `scratchpad/agent.bak.js`: under `/private/tmp`, which the OS owns, so no removal needed.
