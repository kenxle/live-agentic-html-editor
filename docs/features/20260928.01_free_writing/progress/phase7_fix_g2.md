# Phase 7 fix round, G2: replay and rail side of the flow walk

**Summary.** Items 1 to 5 are fixed, each with a test that failed before the fix and passes after. Item 6 waits on G1's description of the split record. `npm run gate:unit` is green. The named Chromium specs pass, and the new specs pass in WebKit and Firefox. Screenshots are in `flow_fix_g2/`.

Branch `free-writing-g2`, five commits on top of fd09989:

- 9c2ec77: a later edit of a placed block no longer reopens the placed run (item 1)
- 1dad16a: a reworded anchor the agent also reworded raises the choice card (item 2)
- 484a6dc: a proofreading question goes on the Active tab (item 3)
- 763c824: the conflict and reopen lines say what is true (item 4)
- 842f6da: a draft that changes nothing draws no card (item 5)

## Item 1: editing a placed block (flow walk Fail 2)

**What was wrong.** The agent placed a heading, a paragraph and a list, and replied handled. Then the reviewer added a third list item. The later edit already became its own record. The page check still read the placed run's list, now three items, as its own block going missing. It reopened the placed record with "the original text is back. Reapply it". Replay then raised "Which version stands?" between the reviewer's two lists.

**The fix.**

- `record.handedOverBlocks(item, items)` names the blocks of a run that a later record took over. A block is taken over when another hand edit, made at or after the run and not a take-back, has an anchor whose words before its sitting are exactly that block's words. The run's own anchor is checked the same way.
- The page check reads the run twice: once as placed, and once with each taken-over block replaced by the later record's version. It counts the reading that finds more of the run, and it never judges a taken-over block. `revertedHandledEditIds` hands the item list to the check.
- If the run is outstanding again, replay does not clash on a taken-over block and never puts the old block back beside the new one. Putting the old block back is what showed the list twice.

**The messy case.** This covers a list item plus a new paragraph after a placed list, the agent placing it, a reload, and Undo. After the fix, each block shows once and Undo finds its anchor. No `editing.js` change was needed. Undo's "the anchor is not on the page" came after the wrong reopen.

**Tests.**

- `test/unit/flow_fix_g2.test.js`: takeover rules, the check with and without the other records (the without case is the red case), a block not taken over still reopens, and the anchor takeover.
- `test/browser/replay_run_flow_fix.spec.js`: the outstanding run raises no clash and draws one list. It was red on the old `replay.js`: a conflict was raised.
- `test/browser/free_writing_flow_fix.spec.js`: the two Fail 2 tests on a real review. The first was red before the fix: the placed record went back to ready.

## Item 2: the agent rewords the reworded anchor (flow walk Fail 3)

**What was wrong.** The anchor's words matched neither the reviewer's version nor its old one. So the text ladder found nothing, the record went lost, and the new paragraphs never appeared. The card showed only "could not be safely matched".

**The fix.**

- When the reviewer changed the anchor and the text ladder finds nothing, replay asks the point ladder (`pointing.bestGuess`) where the anchor stands. It asks only for a run that is not a container, and not when the text ladder found two places. The guess must be a block with words and not page-sized.
- A guessed anchor always raises the anchor conflict card, with the run on it. The anchor is written only by the reviewer's answer.
- A held run's blocks are now placed after the page's anchor while the card waits, since either answer keeps them. A block that clashes with the page's words still waits.

**Design drift, for the orchestrator.** Two behaviours now differ from the architecture's "Replay after a rebuild" section:

- It says the run is held until the reviewer answers. The run is now placed while the card waits.
- It says the run is never placed by guess. It is now placed after a guessed anchor, but only with the conflict card up. On that card the reviewer sees the page's words and chooses.

I did not edit the architecture, because the feature folder is history. This needs a back-patch row if you agree.

**Tests.**

- `free_writing_flow_fix.spec.js`: Fail 3 on Markdown (answered Take the page's) and on HTML (answered Keep mine). Both were red on the old `replay.js`: no conflict card within 20 seconds.
- `replay_run_insert.spec.js`: the held-run test now expects the run on the page and a quiet second pass.

**Screenshots.** `flow_fix_g2/item2-reworded-anchor-{markdown,html}-{light,dark}.png`.

## Item 3: a proofreading question shows on Active

`overlay.paneForItem` puts an unanswered proofread question on a run on Active. The wireframe 06b note reads "The card is back on Active because it needs an answer". Once the reviewer answers, the card waits on the agent and goes back to Edits.

- Test: `agent_replies.spec.js`, "a proofread question sits on the Active tab while it waits on the reviewer, and goes back to Edits once answered". It was red on the old `overlay.js`: pane edits, Active count 0.
- Test change: the older "Use the fixes" test now puts the reviewer on Edits before the question arrives. A question landing on the tab that is already open is on screen, so by design it does not toast.
- Screenshots: `flow_fix_g2/item3-proofread-on-active-{light,dark}.png`.

## Item 4: the clash and reopen lines

Each line below is added to the plan's "Words this plan pins".

| Where | Old | New |
|---|---|---|
| Card line, page check found a run block missing or changed | "This change was undone on the page. The item is open again." | "A block you wrote is not on the page as you wrote it. The item is open again." |
| Agent note, same case (`PAGE_CHECK_RUN_NOTE`) | "...no longer on the page and the original text is back. Reapply it..." | "Reopened by the page check: a block in new_blocks is not on the page as written. Put it in the source as written, or reply not_handled saying why." |
| Conflict note, the anchor changed on the page | "This region is neither what you edited nor what you changed it to..." | "The page's {type} changed after you edited it, so Lahe did not write your version over it. Your new text is kept." |
| Conflict note, a new block with words added | same borrowed line | "On the page, your new {type} has words you did not write. Lahe changed nothing. Pick the version that stands." |
| Conflict card run line, blocks on the page | "...are waiting on this choice..." | "Your {n} new blocks are on the page after this {type}. Either answer keeps them." The old line stays for a clash, where the blocks do wait. |

- The page check has a new reason for runs, `missing`. `reverted` stays for words that went back to what they were before the edit, such as a reworded anchor whose old words are back.
- Tests: `replay_run.test.js` (the lines, and the reason on each missing case), `replay_run_check.spec.js`, `replay_run_insert.spec.js` (both notes), and two tests in `free_writing_flow_fix.spec.js`. Both of those were red on the old code: the borrowed "This region is neither..." line, and the note lacking the new sentence.
- Screenshots: `flow_fix_g2/item4-block-clash-{light,dark}.png` and `flow_fix_g2/item4-run-reopened-{light,dark}.png`.
- The HTML render of the plan (`03_plan_free_writing.html`) was not regenerated.

## Item 5: no struck-through draft card when nothing changed

`overlay.isUnchangedDraft` covers a draft that changes nothing yet: no after, or the same words, bold and italic, and type, with no new block holding words. `isQuietDraft` treats it like the blank draft an empty page opens with, so it is not drawn and not counted, in the pane counts, the pill count and the Edits header. The first change draws the card.

- Tests: `flow_fix_g2.test.js` (the rules) and `free_writing_flow_fix.spec.js` ("opening a block draws no struck-through draft card until something changes"). The browser test was red before the fix: one draft card shown.
- This is the card side only. G1 owns whether capture keeps the draft.

## Item 6: record shape for G1's split

Nothing yet. I will make the `record.js` change when you relay G1's description of `from_anchor` split into moved words plus new words.

## Commands run

- `npm run gate:unit`: 1795 pass, 0 fail, 2 todo.
- `node scripts/build-layer.js`, then Chromium, by name: `edits_tab`, `agent_replies`, `free_writing_seams`, `replay_run_anchor`, `replay_run_check`, `replay_run_fix_round`, `replay_run_insert`, `replay_run_flow_fix`, `free_writing_flow_fix`. That run had 123 pass and 1 fail: the proofread toast test, fixed as item 3 says. `agent_replies` then passed on its own, 26 of 26.
- `--project=webkit --project=firefox`: `free_writing_flow_fix` and `replay_run_flow_fix`, 16 pass, plus the two proofread tests in `agent_replies`, 4 pass.
- Red checks: each fix was stashed, the layer rebuilt, and its tests run to see them fail, then restored.
- `dist/` was never staged. It is restored with `git checkout -- dist/lahe-layer.js`.

## Not done here

- "The reopen note stays on later revisions" (flow walk, Other things) is not fixed.
- An anchor the reviewer never changed, whose words the agent then rewrote, still goes lost. Design call 1 says to count it as applied. Finding it would take the same guess without a card, so I left it for your call.

## Cleanup needed

- `node_modules` symlink in this worktree (untracked, never committed).
- `test-results/` in this worktree, from the spec runs.
- Scratch files under the session scratchpad in `/private/tmp` need no removal.
