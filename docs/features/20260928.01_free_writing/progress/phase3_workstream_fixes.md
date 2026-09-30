# Phase 3, integration fixes: progress

**Summary.** The five fixes are built on `free-writing-fix`, in four code commits plus this page. `npm run gate:unit` is green: 1693 tests, 1691 pass, 0 fail, 2 todo (the base's 2). The named browser specs pass in Chromium: 73 tests, 0 failed, after a local `dist/` rebuild that is not committed. No full browser suite ran.

## What was fixed

1. **A run block with words the reviewer never typed is a conflict.**
   - The bug: the agent added a sentence to the third typed paragraph. The walk stopped at that leaf, the block read as missing, and replay inserted it again below, with no flag. The words showed twice. This was not the "joined" rule (that rule was already exact); it was the missing-block path.
   - `normalize.runClash` finds the leaf that holds a block's words plus other words. It reads only the leaf where the block would sit, and whole words only. `blocks.runClashFor` is its live twin.
   - Replay checks it before writing anything. A clash writes nothing, anchor included, and flags the record with the anchor conflict's badge, card and toast. The card shows the reviewer's block and the page's.
   - "Keep mine" rewrites that leaf through `blocks.writeBlock` and remembers the page state with `record.acceptPageText`. A repaint that brings the agent's sentence back is rewritten again, not raised again.
   - "Take the page's" makes the page's block the record's own, as a new revision.
   - Either answer places the rest of the run.
   - The presence table in the architecture and in `docs/diagrams/replay_branches.md` says so. A new "Build Back-patches" table in the architecture records it.
2. **R14 spec.** The header-line cases (click and Esc) and "bold two words" are ordinary tests now. The SECOND-paragraph bold case still failed, and the test was wrong: Enter now makes the second paragraph its own `p`, and the spec looked for "bold" in the first `p`, so the B press bolded nothing. It now looks across the section, asserts the phrase was found and the record's block carries the `strong`, and passes. All five R14 cases are ordinary tests.
3. **Hyphens.** `normalize.foldTypography` folds a run of hyphens to one, after the dashes. Every reader now agrees. The local fold in `src/service/handled_check.js` is gone.
4. **Manifest.** `planned` is cleared on `src/cli/commands/write.js`. The build now reports 0 files still planned.
5. **Other flags in the Phase 2 progress files.** None was left in replay, normalize or tests. 2A's follow-up (rerun `no_duplicate_text`, `split_not_conflict`, `free_writing_r14` on the integrated bundle) is done here. 2C's `onItemRefused` wiring is `index.js`, so it is the rail builder's.

## Files

| File | Why |
|---|---|
| `src/shared/normalize.js` | Hyphen fold in `foldTypography`; `runClash` and `heldInside` |
| `src/layer/blocks.js` | `runClashFor`; `runElementsFor` shares its walk with it (`runWalk`) |
| `src/layer/replay.js` | The clash check in `applyRun`, `holdBlockClash`, `resolveBlockClash`, `writeClashMine`, `takePageBlock`; `flagConflict` takes the reviewer's side as an option |
| `src/service/handled_check.js` | Local hyphen fold removed |
| `src/shared/manifest.js` | `planned` cleared on `write.js` |
| `test/unit/normalize.test.js` | The fold, and `blockWords` on top of it |
| `test/unit/leaf_blocks.test.js` | The matcher with a dash; seven `runClash` tests |
| `test/unit/replay_run.test.js` | The run page check with a dash; a handled block with added words reopens |
| `test/unit/replay_pass.test.js` | The split search with a dash |
| `test/unit/write_command.test.js` | `write.js` is not planned |
| `test/browser/replay_run_insert.spec.js` | Five clash tests: flagged and nothing written, a second pass, Keep mine over a repaint, Take the page's, the agent fixing the page |
| `test/browser/free_writing_r14.spec.js` | `test.fail` marks removed; the SECOND case's selector fixed; header comment |
| `docs/features/20260928.01_free_writing/02_architecture_free_writing.md` | Presence table row; "Build Back-patches" table (BP1, BP2) |
| `docs/diagrams/replay_branches.md` | The clash in the run flowchart and in the presence table |
| `progress/phase3_fix_screens/` | The two screenshots below |

## Tests, red first

- The fold: the normalize, matcher and page-check tests failed before the fold. The split-search test was re-run with the fold stashed and failed. `handled_check_run`'s "-- rendered as a dash" failed with the local fold removed and no shared fold, then passed with the shared one.
- The clash: `split_not_conflict`'s control was the failing spec. The seven `runClash` unit tests and four of the five new `replay_run_insert` tests failed before the code. The fifth ("the page fixed by the agent clears the conflict") passed before too; it stays as a guard.
- The manifest test failed before the marker was cleared.

## Commands and results

| Command | Result |
|---|---|
| `npm run gate:unit` (final) | 1693 tests, 1691 pass, 0 fail, 2 todo |
| `node scripts/build-layer.js` | 34 files, 0 still planned (not committed) |
| `npx playwright test` on `split_not_conflict`, `no_duplicate_text`, `replay_old_records`, `replay_run_anchor`, `replay_run_check`, `replay_run_insert` (Chromium) | 68 passed |
| `npx playwright test test/browser/free_writing_r14.spec.js` (Chromium) | 5 passed |

## Screenshots

The control's scenario on the booted layer, with the rail open on Edits: the agent's added sentence is marked on "On the page now", and nothing was written.

- [light](phase3_fix_screens/block_clash_card_light.png)
- [dark](phase3_fix_screens/block_clash_card_dark.png)

The script is in the session scratchpad (`shots/`), not the repo.

## Deviations

- **Why the control failed.** The brief said the "joined" rule counted the leaf as present. It did not: `matchRun`'s joined rule was already exact. The block read as missing and was inserted a second time. The fix is the one decided: a clash on that block.
- **`matchRun` keeps its four statuses.** The clash is a separate function over the same walk. A fifth status would have changed every caller of `runElementsFor`: editing's reopen and undo, and the handled check. The handled check and the page check already read the clashed block as missing, which is right for a handled item: the agent changed the reviewer's words, so it reopens as undone.
- **The two answers remember in different ways.** Keep mine uses `acceptPageText`, as an anchor's Keep mine does. Take the page's makes a new revision, as the held run's Take the page's does for the anchor. A remembered "page wins" in `accepted_page_texts` would mean the opposite of what that list means for the anchor. So a revision carries it, and the agent sees that the page's version stands.
- **Take the page's takes the page's tag** when it is one of the six writable tags. Otherwise the block keeps the reviewer's tag.
- **The card's badge line is the anchor conflict's** ("This region is neither what you edited nor what you changed it to..."). It is reused as decided. It reads a little off for a new block. The rail may want its own line.
- **An accepted block text shares the anchor's list.** In theory an anchor whose page text equals an accepted block text would re-apply. That needs the anchor itself to read as the reviewer's new block plus the agent's sentence, which is unlikely. It is noted, not handled.

## For the orchestrator

- 2C noted that the file-name title marker changes the rendered hero `h1` on Markdown pages with no `#` heading. Any browser spec that anchors an edit to that title will change. No named spec here does. The checkpoint run will show any others.

## Cleanup needed

- None in the repo. No file was removed. The screenshot script and its config are in the session scratchpad under `/private/tmp`, which the OS owns. The `node_modules` symlink in the worktree is untracked and must not be committed. The `.claude-commit*` message files are gitignored.
