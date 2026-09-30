# Phase 7, fix round F5 (follow-ups): progress

Summary: all seven items are done on `free-writing-f5`. `npm run gate:unit` is green (1786 tests, 0 fail, 2 todo). The 14 specs I touched or that cover the touched code pass in Chromium (224 tests, 0 failed). No full suite. `dist/` was rebuilt for the runs and is not staged.

| Item | Outcome | Test |
|---|---|---|
| 1. I8 front matter | Fixed. `editing.js` `hasContent()` skips anything inside `details.frontmatter`. | seams "notes page with front matter" un-fixmed, passes |
| 2. I3 long proofread | Fixed in the test support. The scripted agent reads the fixes (block, from, to) from the thread's last proofread agent turn when the item's note is "Use the fixes", replaces the words in place and adds no block. No product change was needed. | seams "proofreading (long run...)" un-fixmed, passes; the two short cases still pass |
| 3. I7 layer half | Nothing to fix; F3's check works. Un-fixmed. | `helper_contract_layer.spec.js`, 2 pass |
| 4. CL 21 marker | Fixed. `tab_done.js` `answeredProofread` now needs the last thread round's agent reply to carry `proofread: true`, so the pinned sentence in an ordinary follow-up gets no proofread treatment. Also removed the stale fallback comment (`record.continueOnto` exists). Also fixed a stale precondition in the from_anchor test: `applySuggestions` now refuses it, so the test asserts the refusal. | agent_replies "typing the pinned sentence..." un-fixmed; whole file 25 pass |
| 5. Replay take-back check | Fixed. `replay.js` `takeBackBlocksRemain` uses the helper's rule (anchor found: listed blocks in the next N+2 leaves hold it; anchor not found: a listed block of 5+ words still on the page holds it). New reason `PAGE_CHECK_REASON.TAKEBACK`, new note `record.PAGE_CHECK_TAKEBACK_NOTE` (added to the collapse list) and card notice, because the reverted-edit note tells the agent to reapply, which is wrong for a take-back. | `replay_run.test.js`, three new tests; two failed before the change |
| 6. CL 20 leftovers | Done, behavior unchanged. `normalize.INLINE_ALLOWED` and `normalize.firstWords(text, max, more)` exported; `editing.js`, `overlay.js` and `replay.js` use them. `blocks.CONTAINER_TAGS` exported; `anchor.js` takes `blocks` as a new module argument. | existing unit tests plus one for `firstWords` |
| 7. CL 22 wiring | Done. `index.js` passes `washModules: { anchor, blocks, highlight }` to the edits tab. It was not passed before. | edits_tab and free_writing specs pass |

## Commands

- `node scripts/build-layer.js`
- `npm run gate:unit`
- `npx playwright test --project=chromium` on: agent_replies, edits_tab, free_writing_capture, free_writing_empty, free_writing_host, free_writing_seams, free_writing_types, free_writing_undo, helper_contract_layer, replay_run_anchor, replay_run_check, replay_run_fix_round, replay_run_insert, undo_reaches_helper

## Notes

- The new take-back note is a fifth page-check sentence. It is shared record text, so the contract copies do not list it; the orchestrator may want to look.
- One mistake, fixed: my second commit staged `dist/` through `-a`. I undid it with `git reset --soft` and recommitted without it.

## Cleanup needed

- `node_modules` symlink in the worktree (never committed).
- `dist/lahe-layer.js` is rebuilt and unstaged; restore with `git checkout -- dist/lahe-layer.js`.
- `test-results/` (gitignored Playwright output).
