# Phase 7 flow-walk fixes, group G1 (editing side)

Branch `free-writing-g1`. Summary: all eight items are fixed. Each has a test that failed before the fix and passes after it. One item came with a trade-off Ken should see: the bar placement (item 4). The other trade-off, how a split tail is recorded (item 2), was decided by the coordinator and is built that way.

Green:

- `npm run gate:unit`: 1789 tests, 1787 pass, 0 fail, 2 todo.
- Chromium, by name: every `free_writing_*` spec, `f1_editing_fixes`, and `undo_reaches_helper`. 180 passed. After the item 2 change: every `free_writing_*` spec, `f1_editing_fixes` and `paragraph_break`, 183 passed.
- WebKit and Firefox: the two new specs, `free_writing_flow_fix` and `free_writing_undo_reload`. 52 passed.

Files outside my list: `src/layer/index.js`, one option for item 6 (below). Nothing in G2's files was edited.

## By item

| Item | What changed | Test, and how it failed before |
|---|---|---|
| 1. Undo after a reload reaches the helper | `sync.deleteItem` skipped the delete for any item this page had not posted itself. The list it checked lives in memory, so after a reload every item looked never-sent. It now also checks two things that survive a reload: the helper's acknowledged stamp, and an event still queued for the item. The delete is queued in browser storage, so it survives another reload. | `sync_client.test.js`: "after a reload, deleting an item the helper acknowledged still queues item.deleted" and "...whose post is still queued...". Both failed (no event). `free_writing_undo_reload.spec.js`, a real `lahe review` walk: commit a run, reload, undo, and the item leaves review.json, then stays gone after another reload. Before the fix it timed out waiting for the item to leave. |
| 2. from_anchor only for the page's own words | A block split off the anchor now remembers the page's words it carried (`moved`). If the tail is exactly those words, it is one from_anchor block. If the writer typed into it at all, the whole tail is one new block. The agent then writes `anchor_after_html` (the head, without the moved words) and adds the tail once, so the page keeps one paragraph and no word shows twice. A tail made of words the writer typed into the anchor before splitting is new too. No record shape change. | `free_writing_flow_fix.spec.js`, "from_anchor marks only the page's own words": 6 tests. Against the old code, 5 failed: the flow walk's case, typing at the start, at the end, in the middle, and typed-then-split. The start and end tests rebuild the page from the record the way a literal agent would, and expect one paragraph with the moved words once. They also failed against the first version of this fix, which split the tail in two. The no-typing split still gives one from_anchor tail. Green in Chromium, WebKit and Firefox. |
| 3. A sitting on a placed block is an ordinary edit | New `isPlaced` in `editing.js`. A record counts as placed if it is handled, or if it is a run the agent answered with a proofreading question, now or in an earlier round. `itemFor` and `runRecordHolding` skip placed records. A record the handled check could not find on the page is not placed. | "a sitting on a placed block is an ordinary edit": the proofread case failed before (the placed record went to rev 2). The handled case and "an unplaced run still reopens its own record" pass as guards. |
| 4. The bar never covers the text above | The bar goes in the page's own gap above the frame when the gap fits it. The gap is measured from the nearest text line above, so margins count as gap and words never do. Otherwise the bar goes below the frame. When the space below is empty (end of page), the bar leaves the first line under the frame free for "+ Write here". | "the edit bar never covers the text above the frame": a dense page, light and dark, and a page with a real gap. All 3 failed before: the bar covered `#h2` or `#p2`. |
| 5. "+ Write here" hit target, and near misses | The line is 28px tall, up from 20. It stays put while the pointer is on it. It moves under the frame's bottom border rather than sitting on it, and starts past the bar when the bar shares its gap. A press in the page's gap between blocks, or just below the last one, now starts writing there. It only counts a press on the page's containers, never on content. A click on a block's text, or in the margin outside the column, still commits as before. | "+ Write here: a comfortable target, and a near miss still writes": 5 tests. The 24px target and the near-miss test failed before (the session closed). |
| 6. Cmd-Shift-E right after clicking the rail | The chord pressed while the rail has focus now does three things. It takes focus back from the rail. It puts back the last caret the writer had on the page. Then it opens that block, or enters edit state when there was no caret. It is left alone while the writer is typing in a rail field. The rail's root is closed, so `index.js` passes `railTextFocus`, which reads `rail.activeElementInfo()`. | "Cmd-Shift-E right after clicking the rail": 2 tests, both timed out before. In all three engines. WebKit never focuses a button on click, so the spec focuses the tab itself to start every engine from the same place. |
| 7. Opening a block draws no card | `persist` no longer tells the rail about the `opened` draft. The draft is still written to browser storage and posted marked draft. The first change draws the card as usual. | "opening a block without changing it shows no card", light and dark: both failed before (one card). |
| 8. Markdown shortcuts match Markdown | `## ` makes h2, `### ` h3, `#### ` h4, and `# ` makes h2 too. The menu shows `##`, `###`, `####`. Updated the architecture's "Block types while writing" (md and html), the plan's pinned hotkey table (md and html), and `docs/CONTRACTS.md`. | `regions_gestures.test.js` (2 failed before), `free_writing_types.spec.js` menu row test updated, and 4 new tests in "Markdown heading shortcuts match Markdown". |

## Trade-offs for Ken

- **Bar below the frame (item 4).** Most real pages have gaps between blocks smaller than the bar, which is about 38px. On those pages the bar now sits below the frame and covers the top of the next block. That is the block after the one being written, not the one being read back. A slimmer bar would let it fit in more gaps. See `item5-write-here-light.png`: the bar covers the top of "What changed".
- **Split tails (item 2), decided.** The first version split a typed-into tail into a moved block and a new block, which showed as two paragraphs after the rebuild. The coordinator chose the other safe option: the whole tail is one new block, so it stays one paragraph. That is what is built now.

## For G2 and the orchestrator

- **`record.runChangeText`** names only the first from_anchor block ("The second part is new_blocks[i]"). Capture now marks at most one untouched tail per split, so the text stays right.
- **Item 7 after a reload.** An untouched draft still in storage after a reload is drawn by whatever builds cards from the store at boot. `overlay.isBlankStartDraft` hides this only for an empty page's draft. Hiding it everywhere would take a wider version of that check: a draft with no `after` and no words in `new_blocks`. That is G2's file.
- **Item 3, the page-check side**, belongs to G2: the reopen text that says "Reapply it", and the block-clash card firing on the writer's own edit. Capture no longer reopens a placed record. But the page check can still reopen a handled run whose list the writer has since changed in a separate record.

## Screenshots

All taken right after the test that proves the change, in the same run (`LAHE_SHOTS_DIR` set). They are in `flow_fix_g1/`.

- Item 4, dense page, bar below the frame: `item4-bar-dense-light.png`, `item4-bar-dense-dark.png`
- Item 4, a page with a real gap, bar in the gap: `item4-bar-gap-light.png`
- Item 5, "+ Write here" at 28px, clear of the bar: `item5-write-here-light.png`, `item5-write-here-dark.png`
- Item 7, a block opened with nothing typed, no card and Edits 0: `item7-opened-no-card-light.png`, `item7-opened-no-card-dark.png`

## Commands

```
npm run gate:unit
node scripts/build-layer.js
npx playwright test test/browser/free_writing_*.spec.js test/browser/f1_editing_fixes.spec.js test/browser/undo_reaches_helper.spec.js --project=chromium
npx playwright test test/browser/free_writing_flow_fix.spec.js test/browser/free_writing_undo_reload.spec.js --project=webkit --project=firefox
LAHE_SHOTS_DIR=$PWD/docs/features/20260928.01_free_writing/progress/flow_fix_g1 npx playwright test test/browser/free_writing_flow_fix.spec.js --project=chromium
```

## Cleanup needed

Nothing was deleted.

- `node_modules` in the worktree root: a symlink to the main clone's, untracked. Never commit it. The `node_modules/` rule in `.gitignore` does not match a symlink, so it shows as untracked.
- `test-results/` in the worktree: Playwright output, gitignored.
- `dist/lahe-layer.js` was rebuilt for the browser runs and restored with `git checkout -- dist/lahe-layer.js`. It was never staged.
- Temp folders `lahe-undo-reload-*` under the OS temp directory, from the new real-helper spec. They are left to the OS. The spec closes its own helper session.
