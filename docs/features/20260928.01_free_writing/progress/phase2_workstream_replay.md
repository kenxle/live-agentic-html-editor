# Phase 2, replay workstream (2B): progress

**Summary.** Tasks 2.5 to 2.7 are built on `free-writing-2b` in commit `51bb8d6`. `npm run gate:unit` is green: 1621 tests, 1619 pass, 0 fail, 2 todo (the same 2 as the base). The four new browser specs pass (53 tests), and the five existing specs the plan names pass unchanged (40 tests). No full browser suite ran. `dist/` was rebuilt locally for the existing specs and screenshots, then put back; it is not committed.

## What was built

All code is in `src/layer/replay.js`.

- **One gate.** `applyRecord` sends any record with free-writing fields (`record.hasRunFields`) to a new `applyRun`. Every other record takes today's path, byte for byte.
- **The anchor view** (`runAnchorView`): `record.anchorView`, plus two things the compare also reads:
  - the history: each entry's anchor markup, so branch three never matches a whole sitting
  - a take-back: its before is the undone sitting with the removed run cut off
- **The anchor compare**: today's `compare` on the view, so `splitPieces`, `pieceMarkup`, `mayFold` and `formattingLost` never see the sitting. The anchor is written with `blocks.writeBlock` and `blocks.swapTag`. When `cleanBlock` refuses the anchor's markup (a link), it falls back to today's anchor write.
- **The tag leg**: a right-worded anchor with the wrong tag is rewritten with its tag. A paragraph turned into a list gets its `li`.
- **A container anchor**: the page's one `main` (or `body`), found by tag. No compare.
- **The run** (`placeRun`): the presence table, row for row, using `blocks.runElementsFor`. Missing blocks go in after the last present block, using `blocks.insertPointAfter`, so they land after a `sheet-head`.
- **Branch three for the run**: an earlier revision's block found one to one is rewritten in place.
- **The held run** (`holdRun`): branch four flags the anchor and places nothing. The card shows:
  - the pinned line
  - each block's words
  - "Take the page's, keep my new text"
- **Answering a held run** (`resolveRunConflict`):
  - "Keep mine" writes the anchor, then the run.
  - "Take the page's, keep my new text" bumps a revision whose anchor is the page's markup, then places the run.
- **Take-backs** remove `remove_blocks` found one to one and never insert. A record another record takes back is never replayed.
- **Refusals**: a record with a block outside the six tags, or one `cleanBlock` refuses, writes nothing. A gone anchor is LOST.
- **The page check** (`runCheckReason`): pure. It reads the page markup with `normalize.leafBlocks` and `matchRun`, starting after the anchor. The order is missing (undone note), then wrong tag (`PAGE_CHECK_TAG_NOTE`), then lost bold or italic. `formattingMissingFromPage` uses it for run records. `CHECK_NOTICES` has a line for the tag note.

## Files

| File | Why |
|---|---|
| `src/layer/replay.js` | Everything above. It now takes `blocks` as a factory dependency (already loaded before it). |
| `docs/diagrams/replay_branches.md` | A new section: the run path, the presence table as built, the held run, the take-back. |
| `test/unit/replay_run.test.js` | 17 tests: the anchor view, the page check on string pages, the card words. |
| `test/browser/support/replay_run_page.js` | Loads the manifest's layer files up to `replay.js` from `src/`, with a card recorder. No rebuild needed. |
| `test/browser/replay_run_anchor.spec.js` | 5 tests (Task 2.5). |
| `test/browser/replay_run_insert.spec.js` | 18 tests (Task 2.6), one per presence-table row plus each acceptance line. |
| `test/browser/replay_run_check.spec.js` | 7 tests (Task 2.7), including both R14 cases and both lone-paragraph positions. |
| `test/browser/replay_old_records.spec.js` | 23 tests: every scenario of `no_duplicate_text`, `split_not_conflict` and `replay_branches`, as injected old-shape records. |
| `progress/phase2_replay_screens/` | The four screenshots below. |

## Commands and results

| Command | Result | Wall time |
|---|---|---|
| `npm run gate:unit` (final) | 1621 tests, 1619 pass, 0 fail, 2 todo | 39s |
| `npx playwright test` on the four new specs | 53 passed | 9s |
| `npx playwright test` on `no_duplicate_text`, `split_not_conflict`, `replay_branches`, `free_writing_r14`, `blocks_kernel` (dist rebuilt locally) | 40 passed (the R14 spec's 4 `test.fail` still fail as expected) | 66s |

No full browser suite ran. Chromium only.

## Screenshots

Taken with a local dist rebuild, the real rail, and the helper down. The script is in the scratchpad, not the repo.

- `phase2_replay_screens/placed_run_light.png`: a run with an `h2` placed after the first `sheet-head` on `md_render.html`
- `phase2_replay_screens/placed_run_dark.png`: the same run on `dark.html`
- `phase2_replay_screens/conflict_run_light.png` and `conflict_run_dark.png`: the conflict card holding a run of two blocks

## Deviations

- **The run line for one block** is singular: "Your 1 new block after this paragraph is waiting on this choice. Either answer keeps it." The pinned text only gives the plural.
- **The wrong-tag note's types** use the block menu's names, lowercased (paragraph, heading, subheading, small heading, bulleted list, numbered list). Any other tag is "block". The first words are the first six, then "...".
- **The tag-note rail line** was not pinned. It reads "A block in this change is on the page as a different type. The item is open again."
- **"Take the page's, keep my new text"** bumps a revision whose `anchor_after_html` is the page's anchor and whose `anchor_tag_after` is null, and rebuilds `after`, `after_html` and `change`. The architecture says what the answer does, not how the record shows it. A new revision is how the agent learns the anchor change was dropped.
- **The page check starts from the anchor's words** in the page markup, because it is pure and has no DOM anchor. When the anchor's words are gone:
  - it reopens as undone if the anchor's before is back
  - otherwise it looks for the run from its first block found on the page
  - a block of five or more words shown whole elsewhere is not counted missing, which matches replay
- **A take-back keeps today's page check.** Only runs, tag changes and reworded anchors use the run check.
- **The specs drive replay directly** (`runPass`, with the store's items handed in), not through the whole booted layer. That tests the source without a rebuild. The conflict buttons are the real ones. Task 3.4 covers the booted layer.
- **TDD order**: the anchor spec went red first. The insert and check code was written in the same pass as the anchor code, before their specs, so those specs were not seen red against missing code.

## Surprises

- The page's stamp alone does not bind when the page text differs. Replay passes probes, and a stamp over different words is "the stamp points at different words". So a conflict test needs a page anchor that still holds the anchor's before words (the agent added a sentence).
- A structural compare reads `Item words` and `<li>Item words</li>` as equal. So the tag leg rewrites the anchor's markup with the tag, rather than only swapping it.

## What editing (2A) and helper (2C) must know

- **2A**: replay finds a run only through `blocks.runElementsFor` and reads `anchor_after_html` and `anchor_tag_after` exactly as the fixtures carry them. Capture must match the fixtures, `from_anchor` tails included. Replay places a `from_anchor` block like any other block.
- **2A**: a committed run is replayed while `protect.protectedItemId()` names it, as today. Replay does not look at run blocks for protection, only the anchor.
- **2C**: nothing new crosses the wire. The page check's tag reopen writes `record.PAGE_CHECK_TAG_NOTE`, which is already in `PAGE_CHECK_NOTES`.
- **Orchestrator**: `index.js` needs no change. It already calls `pageCheckOptions(body)` and `pageCheckNoteFor`, which now return the tag note.

## Follow-ups

- None owed by this workstream. Task 3.4 types, rebuilds and replays real runs against this path.

## Cleanup needed

- None in the repo. No file was removed. The screenshot script and its output are under the scratchpad (`shots/`), which the OS owns.
