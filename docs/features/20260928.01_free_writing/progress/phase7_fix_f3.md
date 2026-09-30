# Phase 7, fix round F3 (shared, service, CLI, contract): progress

**Summary.** Every F3 finding is fixed on `free-writing-f3`, in eight commits (`ce73488` to `62850da`). `npm run gate:unit` is green: 1762 tests, 1760 pass, 0 fail, 2 todo (the base's 2 todo; the base was 1712 tests). One browser spec ran by name in Chromium (`undo_reaches_helper.spec.js`, 3 passed), because the handled check now looks at one kind of take-back. No full browser suite ran. `dist/` was not rebuilt or staged. Five pieces need another group; they are listed at the end.

**The notes flag's name, for F1's gate:** the layer's config field is `notes` (true only on a notes review). It reaches editing as the `createEditing` option `notes` (`src/layer/index.js`), so F1 gates the empty-page session on `opts.notes === true`. On the wire it is the script tag attribute `data-lahe-notes="true"` (`protocol.SCRIPT_ATTR.NOTES`, `protocol.NOTES_ON`).

## Findings

| Finding | Result | Where | Test (red first, then green) |
| --- | --- | --- | --- |
| CR 3, CL 2 (record side), design call 4 | fixed. Any record with the free-writing fields, tag-only included, takes the run take-back. A retag's take-back carries the old tag in `anchor_tag_after`, keeps `reverts`, and its change text says to change it back. | `record.js` `revertOf`, `runRevertOf`, `RUN_TAKEBACK_TAG_LINE` | `fix_round_f3_record.test.js`: the three take-back tests |
| Design call 4 (helper half), ADV 3 | fixed. The handled check now checks a take-back with `remove_blocks`: it is held while any listed block is still a leaf right after the anchor (or anywhere, for a block of 5 or more words, when the anchor is not found). Every other take-back is still not checked. | `handled_check.js` `takeBackVerdictFor`, `checkable` | `handled_check_run.test.js`: five new tests (held with all blocks, held with one of three left, passes when gone, ordinary take-back still unchecked) |
| CR 4, CL 24, T I7, design call 9 | fixed. Sync reads health at start. A helper with an older `service_contract` puts the page read-only before anything is posted, raises `HELPER_CONTRACT_OLDER`, calls `onRefused` with `refusedBy: "contract"`, and takeover refuses. A newer helper, or a health answer with no number, is not refused. | `sync.js` `checkHelperContract`, `refuseOlderHelper`; `failures.js` | `fix_round_f3_sync.test.js`: older, current, newer |
| CL 4, SR 3 (record side), ADV 4, design call 6 | fixed. `applySuggestions` refuses a `from_anchor` block and sets `record.USE_FIXES_CHANGE` as the change text. An archived proofread turn keeps `proofread` and `suggestions` (`copyReply`), and review.json projects them on that thread turn only. `proofread` is false once the thread holds a proofread question. Contract line says to replace in place, where the fixes are, and that proofread is false. New `record.continueOnto` for F4 (see below). | `record.js`, `review_format.js`, contract | `fix_round_f3_record.test.js` (from_anchor, change text, archived turn, continueOnto); `fix_round_f3_projection.test.js` (not proofread again, fixes in thread, plain question has none, Keep mine) |
| CL 5 | fixed. A refused run's failure is saved in browser storage (`store.markRefused`), read back by `sync.refusalFor` after a reload, and cleared when the helper accepts a later event. | `sync.js`, `store.js` | `fix_round_f3_sync.test.js`: refuse, reload, still refused, accepted clears it in storage too |
| CL 7 | fixed. Projected `new_blocks[].text` resolves entities. | `review_format.js` `projectBlocks` | `fix_round_f3_projection.test.js`: `a &lt; b &amp; c` gives `a < b & c`; a `from` quoted from `text` with `&` applies |
| CL 16 | fixed. The tag note names `new_blocks or anchor_tag_after`. | `record.js` `PAGE_CHECK_TAG_NOTE` | `fix_round_f3_record.test.js`; pinned copy updated in `run_record.test.js` |
| CL 17 | fixed. `anchor_after_html` is not cut on any record with the free-writing fields. | `review_format.js` | `fix_round_f3_projection.test.js`: a 200-item list anchor projected whole |
| CL 20 | fixed in F3's files only. The export reads block names from `gestures.blockTypeLabel`, not its own table. `record.TYPE_NAMES` stays: it names anchors in change text ("heading"), and record.js loads before gestures.js. | `gestures.js`, `review_format.js` | `fix_round_f3_projection.test.js`: labels match `BLOCK_TYPES`; export uses them |
| CL 23 | fixed. `review.run`'s two server paths and its scope lines are named helpers (`startNotesServer`, `startFolderServer`, `printScope`). One on-disk notes reader, `stateDir.isNotesReview`. A one-page server's record carries `page: true`, and `registerMount` reads it. | `review.js`, `state_dir.js`, `static_servers.js` | `write_command.test.js`: record carries `page: true` |
| CL 25 | fixed (F3 part). Unit test for the proofread fold in `replies.js`, and a CONTRACTS.md paragraph on why every item carries seven null run fields. The replay refactor half is F2's. | `reply_folding.test.js`, `docs/CONTRACTS.md` | the code already worked, so this test passed on first run: it is a missing test, not a red one |
| SR 1 (helper) | fixed. `validateRun` refuses a run unless `after_html` is exactly `anchor_after_html` plus the blocks, `after` is its words, and `anchor_after_html` is what `cleanMarkup` writes (and under the run byte ceiling). A take-back's `before_html` must be clean anchor markup plus its `remove_blocks`. | `record.js` `sittingRefusal`, `takeBackRefusal` | `fix_round_f3_record.test.js`: script in after_html, forged after, onerror anchor, forged take-back; every fixture still passes |
| SR 2 (order) | fixed. Byte ceilings before the parse. F2 added the nesting cap in `cleanBlock`. | `record.js` `validateRun` | `fix_round_f3_record.test.js`: 1 MiB nested block refused on size in under a second |
| SR 4 | fixed. A reply line holds at most 400 suggestions (`protocol.SUGGESTIONS_MAX`) and each `from` and `to` at most 200000 characters (`SUGGESTION_TEXT_MAX`). The two restate the run ceilings, held equal by a test. | `protocol.js` `suggestionsProblem` | `fix_round_f3_service.test.js` |
| SR 5 | fixed. `lahe write` refuses a file with more than one hard link. A notes source is opened once with `O_NOFOLLOW`, checked on that handle, and read from it, on the first render and on every re-render. | `write.js`, `markdown.js` `readSource`, `rebuild.js` | `write_command.test.js`: hard link refused; no-follow render refuses a symlink |
| SR 6 | fixed. The one-page server answers only `127.0.0.1:<port>` or `localhost:<port>`; any other Host is a 404. | `static_servers.js` | `write_command.test.js`: wrong Host 404, both loopback names 200 |
| SR 8 | fixed. The projection runs `validateRun` on each folded record and drops a failing one through `onDropped`, which writes the helper-log line. | `projection.js` | `fix_round_f3_service.test.js` |
| ADV 5, design call 7 | fixed. Page mode follows the review: a Markdown file whose render belongs to a notes review takes the notes path under `lahe review` too, with `lahe write`'s path rules. | `review.js` | `write_command.test.js`: write, then `review --session`; `.env` and a sibling beside the notes file are 404s, the scope line is the notes one, the notes review is reused |
| ADV 6, design call 8 | fixed. On a drain line, an item with `new_blocks` carries `after_full` and `after_html` as null and its history entries with the words null. review.json is unchanged. Contract, skill and CONTRACTS.md say so. | `status.js` `drainLine` | `fix_round_f3_projection.test.js`: a run's last word appears at most twice on the line; an ordinary edit's line unchanged |
| Design call 2 | fixed. See the notes flag above. The one-page server and `add --notes` write the attribute. | `protocol.js`, `static_servers.js`, `add.js`, `index.js` | `fix_round_f3_sync.test.js` (config and tag); `write_command.test.js` (served notes page has it, ordinary page does not) |
| Adversary cleanup note (literal NUL in `record.js`) | fixed: `"\u0000"`. | `record.js` `runKey` | `fix_round_f3_record.test.js` |

## Contract and copies

Five contract lines changed, word for word in `review_format.js`, `test/unit/review_format.test.js` and `docs/CONTRACTS.md`: the drain line, the handled-check line, the `new_blocks` line, the `remove_blocks` line and the proofread line. `skills/lahe/SKILL.md` carries the same rules, plus the notes page coming back under `lahe review`. `docs/CLI.md` has the `lahe write` row updated. The skill is not installed and `dist/` is not rebuilt; the contract ships in the bundle, so the orchestrator's checkpoint rebuild carries it.

## Needs another group

- **F4 (tab_done.js):** `answerOnto` copies the item's old change sentence over the fixed revision, which undoes `USE_FIXES_CHANGE`. Call `record.continueOnto(item, base, {note})` instead; it keeps a base revision's own change text (CL 21's shared helper).
- **F4 (overlay.js):** the refusal panel shows "Review here instead" for any read-only window. For `refusedBy: "contract"` that button cannot help (sync's takeover refuses); hide it or change its words.
- **F2 (replay.js):** the page check's side of ADV 3. `isRunChecked` still leaves out take-backs; a take-back with `remove_blocks` should be reopened while its blocks are still after the anchor, the same rule as `handled_check.takeBackVerdictFor`.
- **F1 and F2, CL 20's rest:** the type names in `replay.js` and `overlay.js`, "first six words" in three layer files (a `normalize.firstWords`), `RUN_FIELD` in replay and field strings in `blocks.js` and `anchor.js`, and `INLINE_KEEP` and the tag regex in `editing.js`.
- **Orchestrator:** the plan's pinned table (`03_plan_free_writing.md`, line 154) still has the old tag note text. The feature folder is not F3's to edit.

## Deviations

- **`store.js` is outside the F3 row.** CL 5's fix is "save the refusal beside the acknowledged stamp", and that stamp lives in `store.js`. I added three small functions there (`markRefused`, `clearRefused`, `refusedFor`) and changed nothing else in the file. No other group's row names `store.js`.
- **The layer's version check refuses only a helper that reports a number.** A health answer with no `service_contract` is not a verdict, so the page goes on as before. Every helper since contract 13 reports one, and treating a missing number as older would have put every existing sync unit test's fake helper read-only.
- **`proofread` ends for good once the thread holds a proofread question.** A later sitting on the same item is not proofread again. That keeps "Use the fixes" from looping; the cost is that words added in a later sitting on the same record are not offered a second proofread.
- **After ADV 5, `lahe review --new` on a notes file still takes page mode** and mints a new notes review. The notes flag wins, as design call 7 says.

## Commands and results

| Command | Result |
| --- | --- |
| `npm run gate:unit` (base, before any change) | 1712 tests, 1710 pass, 0 fail, 2 todo |
| `npm run gate:unit` (final) | 1762 tests, 1760 pass, 0 fail, 2 todo |
| `npx playwright test test/browser/undo_reaches_helper.spec.js` (Chromium) | 3 passed |

Each new test file was run red before its code. The SR 4 and SR 8 tests were confirmed red by running them with the fix stashed.

## Cleanup needed

- None of mine. The `node_modules` symlink in this worktree is untracked and never committed. Tests write only under the OS temp folder.
