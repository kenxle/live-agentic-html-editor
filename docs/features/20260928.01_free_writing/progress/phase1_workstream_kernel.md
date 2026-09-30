# Phase 1, kernel workstream: progress

**Summary.** Tasks 1.1 to 1.6 are built on `feat/free-writing`, in six commits (`bd5e0de` to `7b88752`). `npm run gate:unit` is green: 1604 tests, 1602 pass, 0 fail, 2 todo (the same 2 todo as the base). Both named browser specs are green. No full browser suite ran. `dist/` was rebuilt locally for the R14 spec and not committed.

## What was built, by task

### 1.1 Markers and test seeds (`bd5e0de`)

- `src/shared/markers.js`: `FILE_TITLE_ATTR` (`data-lahe-file-title`, value `file-name`), `EDIT_HOST_ATTR` (`data-lahe-edit-host`), and `isFileTitle(el)`. Both are `data-lahe*` names, so `cleanMarkup` already strips them from any captured markup.
- `test/fixtures/free_writing/`, with a `README.md` naming where each file came from:
  - `blog.html`, `doc.md` from the host spike, unchanged
  - `md_render.html`, re-rendered from `doc.md` with this branch's `markdown.js`
  - `empty_notes.md` and `empty_notes.html` (today's render, marker added by hand to the hero `h1`)
  - `dark.html`, `body_paragraph.html`
  - `corpus.js`: `MALFORMED` and `ENGINE` corpora, loadable by `require()` and as a page script
  - `r14_repro_reference.js`: reference only. Home path, fixed waits and beside-the-script output removed.
- `test/browser/free_writing_r14.spec.js`: the port of the R14 script onto `test/helpers` (`pollPage`, `pollUntil`), one helper per test on its own port and state folder. First-paragraph case is an ordinary test. The other three (second-paragraph bold, header line by click and by Esc, bold two words with an agent that does nothing) are `test.fail`. I read each expected failure's error to check it fails for the recorded reason, not a setup error.

### 1.2 Allowlist, reader, matcher (`855fa6b`)

`src/shared/normalize.js` gains `WRITABLE_BLOCK_TAGS`, `SHORT_BLOCK_WORDS` (5), `RUN_WALK_SLACK` (2), `DROP_SUBTREE_TAGS` (exported for blocks.js), and:

- `cleanBlock(tag, html) -> {html} | {code, reason}`. It parses and rebuilds from constants. Anything outside strong, em, br, the two reset tags, and li-directly-in-a-list refuses the whole block, and so do comments and processing instructions. Whitespace folds, and a trailing br goes. An empty element, an empty item, and an empty block are dropped or refused. It is a fixed point on its own output over the engine corpus.
- `leafBlocks(html)`: a small tree builder that follows the browser's repair of the malformed corpus (a p closed by a block start, li by li, raw-text script and style, inert template, comments). It skips chrome, the overlay root, and the marked title.
- `matchRun(blocks, leaves)`: whole, joined, split, missing, by folded words only. It skips non-matching leaves only before the first match, stops at the first non-matching leaf after one, and never reads past `blocks.length + RUN_WALK_SLACK` leaves.
- `runWords(blocks)`, `blockWords(html)` (entities resolved, typography folded), `decodeEntities`.
- `src/shared/failures.js`: all eight new codes land here now, so Phase 2 never edits it. They are `RUN_BLOCK_REFUSED`, `RUN_OVER_CEILING`, `RUN_PLACEMENT_REFUSED`, `RUN_TAKEBACK_CARRIES_RUN`, `REPLAY_RUN_WRONG_TAG`, `REPLAY_RUN_PLACED_ELSEWHERE`, `RUN_EVENT_REFUSED`, and `SUGGESTION_NOT_FOUND`.

### 1.3 `src/layer/blocks.js` (`fbbf191`)

The functions are `leafWalk`, `insertPointAfter`, `startPointIn`, `hostFor`, `canHoldRun`, `runElementsFor`, `writeBlock`, `swapTag`, `isLeaf`, and `isContainerAnchor`. The manifest loads it right after `selection.js`, and it has a `planned: true` entry for `src/cli/commands/write.js` (2C). `docs/diagrams/module_map.md` shows both.

### 1.4 Record, merge, notes, fixtures (`dd2df38`)

- `src/shared/record.js`:
  - five optional fields in `FIELD` and `FIELD_CLASS` (all data), plus `PLACEMENT`/`PLACEMENTS`
  - the constants `NEW_BLOCKS_MAX` (400), `NEW_BLOCKS_MAX_BYTES` (200000), `RUN_HISTORY_KEEP` (3), `RUN_RECORD_MAX_BYTES` (4194304)
  - `isRunRecord`, `hasRunFields`, `recordBytes`, `blocksBytes`, `buildRunAfter`, `anchorView`, `runChangeText`, `validateRun`, `trimRunHistory`, `applySuggestions`, `blockText`
  - `PAGE_CHECK_TAG_NOTE`, added to `PAGE_CHECK_NOTES`
  - `bumpRev` history entries carry the run fields and are trimmed for run records
  - `revertOf` routes a run record to a take-back with `remove_blocks`
- `src/shared/merge.js`: four fields added to `CONTENT_FIELDS`. When the browser copy lacks one, the merged item drops the key instead of carrying `undefined`.
- `src/shared/record_fixtures.js`: `runItem`, `runFixtures()` (13 named fixtures, each with a literal `after` and `change`), `forgedRuns()` (one per refusal code), `runWithTagNote`, `oldShapeNested`, `proofreadQuestion`.

### 1.5 Wire and gestures (`9d0dea7`)

- `src/shared/protocol.js`:
  - `SERVICE_CONTRACT` 14, plus `CONTRACT_VERDICT` and `helperContractVerdict(health)`
  - `FLUSH.RUN_DRAFT_FLOOR_MS` (30000)
  - `REPLY_FIELD.PROOFREAD` and `SUGGESTIONS`, parsed on a question only
  - `acceptsNotesFlag(body)`, and `notes?: true` in the `review.write` route text
- `src/cli/commands/add.js`, `session.js`: now read `helperContractVerdict` instead of comparing numbers inline, so the unit test exercises the check the CLI runs.
- `src/shared/gestures.js`:
  - `GESTURE.ENTER_EDIT_STATE`, and a TABLE row with the pinned hint, so it also shows on the rail's hint list
  - `GESTURE.CLOSE_MENU`
  - `BLOCK_TYPES` (label, chords, shortcut), `OTHER_BLOCK_LABEL`
  - `blockTypeChord`, `chordLabelFor`, `markdownShortcutFor`
  - `ENTER` with `enterIntentFor`, `EDGE` with `edgeDeleteFor`, `HISTORY` with `historyIntentFor`
  - Esc and Cmd-Shift-E in `gestureFor` read the new descriptor fields `blockMenuOpen`, `editState` and `inBlock`

### 1.6 Projection and the contract (`7b88752`)

- `src/shared/review_format.js`:
  - `PROOFREAD_MIN_WORDS` (150)
  - every item carries `new_blocks`, `anchor_after_html`, `remove_blocks`, `anchor_tag_after`, `placement`, `run_words`, and `proofread`, as null or false when absent, so every item keeps one shape
  - projected blocks are `{tag, html, text, from_anchor?}`
  - a run record's `new_blocks`, `after_full` and `after_html` are unbounded
  - `review.notes` is projected; the three text fields join `DATA_FIELDS`; all seven are classed as data
  - `renderText` prints the anchor change and then the blocks by menu name. It prints a split tail as "(moved from the anchor)".
  - The factory now also takes `normalize`.
- Contract: 57 lines, up from 50.
  - The data-fields line and the handled-check line (the AQ3 sentence) are edited.
  - The after_html line gains the whole-sitting sentence.
  - Seven lines are new: run placement, placement values, from_anchor and anchor_tag_after, literal text, remove_blocks, proofreading with both pinned button texts, and notes and AI behavior.
- Copies: `skills/lahe/SKILL.md` (Step 4 checklist bullets, plus "A handled reply is checked"), `test/unit/review_format.test.js`, and `docs/CONTRACTS.md` (the contract block, the record table and run section, review.json, the lahe status field list, the reply line, the draft floor, gestures, and the failure table). The skill is not installed.

## Tests added

- `test/unit/clean_block.test.js` (20), `test/unit/leaf_blocks.test.js` (22)
- `test/unit/run_record.test.js` (27), `test/unit/merge_run.test.js` (6)
- `test/unit/protocol_wire.test.js` (+10), `test/unit/regions_gestures.test.js` (+22)
- `test/unit/review_format.test.js` (+5, including CONTRACTS.md held to the source and the skill naming each rule), `test/unit/projection_review_json.test.js` (+9), `test/unit/status_command.test.js` (+1)
- `test/browser/blocks_kernel.spec.js` (13), `test/browser/free_writing_r14.spec.js` (5)

Each unit file was run red before its code.

## Commands run and results

| Command | Result | Wall time |
| --- | --- | --- |
| `npm run gate:unit` (base, before any change) | 1482 tests, 1480 pass, 0 fail, 2 todo | 40s |
| `npm run gate:unit` (final) | 1604 tests, 1602 pass, 0 fail, 2 todo | about 40s |
| `npx playwright test test/browser/blocks_kernel.spec.js` | 13 passed | 2s |
| `npx playwright test test/browser/free_writing_r14.spec.js` (base bundle, and again on a locally rebuilt bundle) | 5 passed: 1 ordinary pass, 4 expected failures (the header case runs twice) | 23s |

No full browser suite ran. The rebuilt `dist/lahe-layer.js` was put back to the committed version afterwards.

## Deviations from the plan

- **`RUN_BLOCK_REFUSED` is spelled in both normalize.js and failures.js.** `failures.js` loads after `normalize.js`, so `cleanBlock` returns the string itself, and a unit test holds the two to the same code. I did not reorder the manifest.
- **The helper refuses a block that is not exactly `cleanBlock`'s output**, not only one `cleanBlock` rejects. The helper refuses rather than cleans, so markup the layer would never send reads as a forgery.
- **Change text for one block** reads "Added 1 block after this paragraph: p. Its words are in new_blocks." The architecture only gives the plural. A split's sentence names the tail's real index (`new_blocks[i]`), which is 0 in every fixture.
- **The anchor's type name** comes from `region.ref.fingerprint.tag`, then `context.element`, else "block".
- **`after` of a run record is `normalize.blockText(after_html)`**, the reader today's capture and `markupSaysAfter` use. That reader leaves entities as written, so the special-characters fixture's `after` holds `&lt;` and `&amp;`. That matches today's edits and keeps replay's markup check true. See Surprises.
- **Container anchor detection:** `blocks.hostFor(anchor, placement)` treats `main` or `body`, or `placement === "start_of_container"`, as a container.
- **insertPointAfter climbs** only when the parent holds the anchor plus at least one piece of inline chrome (the sheet-head case). It never climbs out of `body`, `main`, or a parent the anchor sits in alone.
- **canHoldRun** is also false when the host is a table part or a list (a bare `td` anchor's host is `tr`).
- **The Cmd-Shift-E with no block hint is a TABLE row**, so it also shows in the rail's "All shortcuts" list. It is marked R1 (write where none exists).
- **Take-back of a retagged run** does not restore the anchor's old tag: the record never stored the old tag as a field. 2A's committed undo restores it on the page. Replay's anchor view reads `before_html`.

## Surprises

- `src/shared/record.js` holds a literal NUL character (in `runKey`). `grep` without `-a` sees the file as binary and prints nothing. I edited it with Python.
- My first draft of `rewordBlock` added a `segmentsOf` that shadowed record.js's existing path helper of the same name. That broke 12 page-grouping tests; I renamed it `markupSegments`. There are no other duplicate top-level names in normalize.js or record.js now.
- Every existing drain-line test asserts that every `DATA_FIELDS` entry sits under `page` on every item. So the new text fields are emitted as null on every item, not only on runs.

## What Phase 2 must know

- **2A (editing)** must set `region.ref.fingerprint.tag` (anchor.mint already does) so change text names the anchor type. Other contracts for 2A:
  - Capture blocks through `normalize.cleanBlock` and store exactly its output.
  - Build `after`/`after_html` with `record.buildRunAfter`, and `change` with `record.runChangeText`.
  - Typing must deep-equal `record_fixtures.runFixtures()`.
  - The gesture descriptors: `gestureFor({... inBlock, blockMenuOpen, editState})`, `blockTypeChord({code, platform, altGraph, ...})`, `enterIntentFor`, `edgeDeleteFor`, `historyIntentFor`.
- **2B (replay)** reads a run with `blocks.runElementsFor(record, document, anchor)`. It passes the anchor itself, and the container for `start_of_container`. `record.anchorView(item)` is the anchor compare's input, and `blocks.writeBlock` / `blocks.swapTag` are the only writers. `PAGE_CHECK_TAG_NOTE` is in `PAGE_CHECK_NOTES`.
- **2C (helper)** calls `record.validateRun(item)` on append (null or `{code, reason}`). The other pieces 2C needs:
  - `FLUSH.RUN_DRAFT_FLOOR_MS`, and `protocol.acceptsNotesFlag(body)` for `notes: true`
  - The projection reads `review.notes` off the review object that projection.js builds, so reviews.js and projection.js must carry it through.
  - `record.applySuggestions` for `reply --proofread`
  - `markers.FILE_TITLE_ATTR`/`FILE_TITLE_VALUE` for markdown.js
- The R14 spec runs against whatever `dist/lahe-layer.js` holds, because `lahe review` serves the bundle. `blocks_kernel.spec.js` loads `src/` directly and needs no rebuild.
- `SERVICE_CONTRACT` is 14, so a stale shared helper on 7817 is replaced or refused by `lahe add`/`lahe session` after merge.

## Follow-ups

- The layer itself makes no helper-contract check (only the CLI does); the plan's wording "the CLI and the layer" assumed one.

## Cleanup needed

- None. No file was removed, and nothing I created needs removing. The spike folders under `/private/tmp` stay where they are.
