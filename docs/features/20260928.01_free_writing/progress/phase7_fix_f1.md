# Phase 7, fix round F1 (editing): progress

**Summary.** Every F1 finding is fixed on `free-writing-f1`, each with a test that failed first. `npm run gate:unit` is green. The new spec passes in Chromium. Six existing specs now wait on F3 and F4: they expect the empty notes page to open by itself, and design call 2 makes that need the notes flag, which only F3 can deliver. With the flag forced on locally, all of them pass. `dist/` was rebuilt locally and not committed.

## Findings

| Finding | What it was | Status | Test |
|---|---|---|---|
| CR 1 (layer side), design call 2 | Any page with no content blocks opened an edit session | Fixed. The empty page opens only when the review is a notes review. The one input is `notes: true` on `createEditing`, or `editing.setNotes(true)` when the answer comes later. Needs F3 to wire it (below). | spec "an empty page that is not a notes review stays in reading state" |
| CR 2, CL 1, design call 3 | A sitting that ended with no new blocks kept the last draft's `new_blocks` and tag | Fixed. `shapeFor` picks RUN, PLAIN or CLEARED. Once a sitting writes run fields it never falls back to PLAIN. When every new block is gone and the tag is back, the commit writes the run fields empty. | spec "Enter, type, Cmd-Z back to no blocks", "a tag changed and changed back" |
| CR 5 | Each keystroke rewrote the whole run record | Fixed for long runs. Above 16384 bytes of run markup, a keystroke is written after a 300 ms pause, and never more than 1500 ms late. A block change, the keystroke that withdraws a ready record, the commit and teardown all write at once. Shorter runs are unchanged. | spec "typing into a long run writes the record a few times" |
| CX P2 | The run damage check compared words only, so a repaint that stripped bold was not restored | Fixed. `runUndamaged` compares tag and markup too. | spec "a repaint that keeps the words but strips the bold" |
| CL 6 | The bar's size estimate was under the real record | Fixed. The bar measures the record the commit would write (`runRecordBytes`) when the session opens, at each block change, and after every 4096 bytes typed. Between measurements each byte counts 8 times. | unit "the run record estimate is never below what the commit writes, at rev 13", "between measurements, RUN_BYTES_FACTOR covers each byte typed" |
| CL 11 | Session undo copied the whole run on every step | Fixed. A step holds a block's markup only when that block changed; unchanged blocks share the string from the step before. A cap of 4,000,000 characters guards a pathological session. `editState().historyChars` reports what is held. | spec "fifty steps over a long run hold about one copy of the run" |
| CL 13 | Two near-duplicate commit paths | Fixed only where it fixed a bug. The legacy commit, the run commit, crash recovery and the size estimate share `committedRecord` and `runChanges`. Moving the run session into its own file is not done: it is a large refactor, and it belongs on the board. | covered by the existing capture, undo and host specs |
| CL 14 | Crash recovery committed a tag-only sitting as `edit` | Fixed. Recovery uses commit's verdict for both "did it change" and the kind. | spec "a tag-only draft left by a dead page is recovered as format_only" |
| CL 15 | Undo could remove a page block the reviewer never wrote | Fixed. Undo removes the blocks this page remembers for the record, plus the run as found only from its first block, with no leaf skipped. | spec "the run's first block is gone" |
| SR 7 | The protect restore rebuilt run blocks from raw markup | Fixed. Run blocks go through `blocks.writeBlock` on `normalize.cleanMarkup` output. A block it refuses (a split tail holding a link) and the anchor are cleaned with `cleanMarkup`. | spec "the restore rebuilds run blocks through the allowlist" |
| ADV 1, design call 5 | Undo after a proofread question dropped the record silently | Fixed. `lifecycle.undoTakesBack(item)` is true for a handled item and for a ready or draft item with any agent reply. Undo then raises the take-back. Because the original is still actionable, it is removed from the review; the take-back carries everything the agent needs. | unit "undo takes back a ready item the agent already replied to", spec "a ready run with a proofread question" |
| CL 20 (F1's files) | A shape spelled in several places | Fixed where the shared table exists. `anchor.js` reads `record.PLACEMENT.START_OF_CONTAINER`. `editing.js` builds `isOldShape`'s pattern from `normalize.BLOCK_TAGS`. Block type names in `editing.js` already come from `gestures.BLOCK_TYPES`. Two need F2 (below). | unit "the F1 layer files read placement names and block tags from src/shared" |
| SR 1 (F2's request) | Undo wrote `before_html` raw on its fallback path | Fixed. It goes through `normalize.cleanMarkup`, as replay's `writeAnchor` does. | spec "a before_html the run allowlist refuses is cleaned" |

## Needs another group

- **F3:** F3 passes the flag as the `createEditing` option `notes` (from the script tag's `data-lahe-notes="true"`). This branch reads `opts.notes === true`, so the two sides meet at merge with no further change.
- **F2 (CL 20):** two tables in F1 files can fold only once `normalize.js` exports them:
  - `editing.js` `INLINE_KEEP` repeats normalize's `INLINE_ALLOWED`, which is not exported.
  - "first six words" (`editing.js` `firstWords`) needs a shared `normalize.firstWords`.
  - `anchor.js` `CONTAINER_TAGS` repeats `blocks.isContainerAnchor`, which takes an element, not a tag. A tag-level export from `blocks.js` would let it fold.
- **F4:** these six tests expect the empty notes page to open by itself. They need the fixture set-up to carry the notes flag once F3 exposes it:
  - `free_writing_capture.spec.js` "start_of_container, on the empty notes page"
  - `free_writing_empty.spec.js` "the empty notes page opens ready..."
  - `free_writing_empty.spec.js` "a second sitting before the agent places the first..."
  - `free_writing_host.spec.js` "the live region says each pinned line"
  - `free_writing_seams.spec.js` "notes page: three sittings..."
  - `free_writing_seams.spec.js` "notes page: a sitting added after revision 1..."
  With the flag forced on in a local build (not committed), the first four files ran 38 passed, 0 failed.

## Choices worth a look

- **Undo after an agent reply removes the original.** Leaving it would keep it ready, so the agent would be asked to place the words and take them out at the same time. The take-back names it in `reverts`, and replay already skips a taken-back run.
- **The draft pause applies only above 16384 bytes of run markup.** Every existing spec that reads a draft mid-typing is below that, so their behaviour is unchanged. The cost is at most 1500 ms of typing that a crash could lose on a long run.
- **A reopened run record whose blocks were not found on the page stays RUN.** The reviewer never saw those blocks, so a sitting on its anchor does not clear them.

## Commands and results

| Command | Result |
|---|---|
| `npm run gate:unit` (final) | 1717 tests, 1715 pass, 0 fail, 2 todo |
| `node --test test/unit/free_writing_f1_fixes.test.js` before the fix | 4 fail |
| `npx playwright test test/browser/f1_editing_fixes.spec.js --project=chromium` before the fixes | 10 failed, each on its own assertion |
| the same, final | 11 passed |
| F1 spec plus free_writing host, types, undo, repaint, capture, empty, seams, and paragraph_break, editing_undo, protection_layers, no_duplicate_text, split_not_conflict, inline_reword, reword_rev, formatting_survives, editing_change_intent, reverted_edit, edits_undo_rows (Chromium) | 162 passed, 6 failed: the six notes-flag tests above |
| after the SR 1 fix: F1 spec, free_writing_undo, editing_undo (Chromium) | 21 passed |
| after CL 20: F1 spec, anchor_engine, free_writing host, empty, undo, inline_reword, reword_rev, editing_undo, replay_old_records (Chromium) | 81 passed, 3 failed: notes-flag tests above |

All browser runs were after `node scripts/build-layer.js`. The full suite was not run.

## Files

| File | Why it changed |
|---|---|
| `src/layer/editing.js` | Record shape, draft pause, size measure, history sharing, recovery verdict, undo rules, the notes gate, the shared commit rule. |
| `src/layer/protect.js` | Markup-aware damage check; restore through the allowlist. Takes `normalize` as a new factory dependency (already loaded earlier in the manifest). |
| `src/shared/lifecycle.js` | `agentReplied` and `undoTakesBack`. |
| `test/browser/f1_editing_fixes.spec.js`, `test/unit/free_writing_f1_fixes.test.js` | New. |

## To delete at cleanup

- `node_modules` symlink in this worktree (untracked, never committed).
