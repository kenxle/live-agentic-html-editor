# Phase 7, fix round F2 (replay): progress

**Summary.** Every F2 finding is fixed on `free-writing-f2`, except the parts FIX_ROUND.md gives to other groups (listed below). `npm run gate:unit` is green: 1724 tests, 1722 pass, 0 fail, 2 todo (the base's 2). The named Chromium specs pass: 115 tests across ten files, with one flake in `no_duplicate_text` that passed alone and three times on repeat. `dist/` was rebuilt locally for the seams and old specs, then put back; it is not committed. No screenshots: nothing drawn on screen changed.

## Findings

| Id | What it was | Status | Test (red first) |
|---|---|---|---|
| ADV 2, design call 1 | An agent's fix to a paragraph the reviewer never touched held the new section as a conflict | fixed | fix-round spec: "a run after an anchor the reviewer left alone" (2 tests) |
| CR 3, CL 2, design call 4 (replay side) | Undoing a type change never turned the anchor back | fixed | fix-round spec: "the take-back of a type change" (3 tests); unit: three take-back page-check tests |
| CL 3 | A short new block read as a clash with the page's own next paragraph | fixed | unit `leaf_blocks`: both probe cases, plus a guard that a clash still fires after an earlier match |
| CL 8 | The anchor was resolved without `tagAfter`; an all-italic anchor bound to its `em` | fixed | fix-round spec: "a retagged anchor whose words are all italic" |
| CL 9 | A block moving to or from a list was tag-swapped into `<ul>text</ul>` | fixed | fix-round spec: "a block whose tag changes to or from a list" (2 tests) |
| CL 10 | The run notes on a card never cleared | fixed | fix-round spec: "the run notes on a card" (2 tests) |
| CL 12 | Replay walked the whole page twice per missing block | fixed | fix-round spec: "a 250-block run ... walks the page a fixed number of times" |
| CL 18 | A punctuation-only fix inside a run was invisible | fixed | fix-round spec (2 tests); unit: two page-check tests |
| CL 19 | The page check skipped lost bold on a `format_only` anchor | fixed | unit: "a format_only anchor whose bold the page lost" |
| SR 1 (page-write fallback) | The anchor fallback wrote the record's raw markup into the page | fixed in `replay.js`; `editing.js` `restoreRun` is **needs-other-group (F1)**; the helper check is F3's | fix-round spec: "a stored record whose anchor markup carries a handler" |
| SR 2 (cleanBlock cost, nesting cap) | `cleanBlock` was quadratic on nested tags and overflowed the stack | fixed; the `validateRun` check order is F3's | unit `clean_block`: four tests; `scripts/measure_clean_block_cost.js` |

The fix-round spec is `test/browser/replay_run_fix_round.spec.js`.

## What changed, and why

- **The untouched anchor (design call 1).** `anchorUntouched` holds when the anchor's markup is the same before and after, no revision in the history changed it, and there is no new tag. Such an anchor is still found by the ladder, and a gone one is still LOST. It is never compared or written. The run is placed after it.
- **The take-back tag (design call 4).** The tag leg already swapped the anchor once the record carries the old tag, so the two stamped take-back tests passed before the change. They stay as guards. Three things were missing:
  - The anchor engine's hint for a take-back is the undone record's tag. Until the agent acts, the page shows that tag.
  - The page check read a tag-only take-back with the run check. That check found no anchor (a take-back has no `anchor_after_html`) and called it reverted. Every take-back now keeps today's check.
  - A new tag check reopens a handled take-back whose anchor still has the wrong type, with the tag note.
- **CL 8.** `resolveRegion` passes `{tagAfter, placement}`. A tag change then lands on the block holding the anchor's words (`blockHolding`), never on an inline element, a list item or a cell. Before, the all-italic case bound the `em` and held a false conflict. It did not nest an `h2`, as the review expected.
- **CL 9.** `fixBlock` rebuilds through `writeBlock` when exactly one of the two tags is a list.
- **CL 10.** `placeRun` clears both notes first, then sets them again from what it finds. One exception: a wrong tag that replay swapped itself stays noted while replay's own element is still on the page. Otherwise the note would vanish on the next pass, before the agent fixed anything.
- **CL 12.** `pageLeafIndex` walks the page once per `placeRun` and keeps the leaves and their words in step with each swap, rewrite and insert.
- **CL 18.** A whole block whose leaf shows an earlier revision's words exactly, without the fold, is rewritten. The page check calls the same case undone. A page that draws the dash its own way shows neither revision exactly, so it is left alone. The stale comment on `foldTypography` now says the fold decides where a block is, never whether its words are right.
- **CL 3.** With nothing matched yet, a block under `SHORT_BLOCK_WORDS` never clashes. The BP1 row in the architecture and the presence table in `docs/diagrams/replay_branches.md` say so. One existing test used a three-word first block to show a first-block clash. It now uses five words.
- **SR 1.** `writeAnchor`'s fallback writes `normalize.cleanMarkup(html)`. Links stay; handlers go.
- **SR 2.** `cleanBlock` refuses nesting deeper than `MAX_BLOCK_NESTING` (32). `pruneEmpty` joins neighbouring text once. That was a second quadratic path the review did not name.

## Measured before and after

`node scripts/measure_clean_block_cost.js` (wall clock, one run each):

| Shape, about 512 KB | Before | After |
|---|---|---|
| nested: N `<em>` then N `</b>` | 7941 ms, threw RangeError | 0.4 ms, refused |
| deep: N `<em>`, words, N `</em>` | 38 ms, threw RangeError | 0.4 ms, refused |
| merged: N times `a<em></em>` | 512 ms | 39 ms |

A 250-block missing run, one pass in Chromium (the fix-round spec's log line): before, 499 direct page walks and 256 ms. After, 1 walk and 24 ms.

## Commands and results

| Command | Result |
|---|---|
| `npm run gate:unit` (final) | 1724 tests, 1722 pass, 0 fail, 2 todo |
| `npx playwright test test/browser/replay_run_fix_round.spec.js` against `HEAD`'s old `replay.js` | 11 of 15 failed (red). The 4 that passed are guards: the still-a-p retag, the two stamped take-backs (the tag leg already acted once the record carries the tag), and the rendered dash |
| same, with the fix | 15 passed |
| `node scripts/build-layer.js` | 34 files, 0 planned (not committed) |
| `npx playwright test` on `replay_run_fix_round`, `replay_run_anchor`, `replay_run_insert`, `replay_run_check`, `replay_old_records`, `free_writing_seams`, `split_not_conflict`, `no_duplicate_text`, `replay_branches`, `free_writing_r14` (Chromium) | 114 passed, 1 failed: `no_duplicate_text` "a single paragraph replacement lands once", an old-record path this round did not touch |
| `npx playwright test test/browser/no_duplicate_text.spec.js` | 8 passed |
| the same test, `--repeat-each=3` | 3 passed |

## Deviations

- **CL 12's timing line** is in the fix-round spec's log output, not in `scripts/measure_draft_write_cost.js`. That script times a typing session. A replay pass needs the layer on a page, and the spec already has one, with a walk count that fails if the per-block walks come back.
- **The cap is 32 levels.** The review asked for "a small fixed limit". Capture runs every block through `cleanBlock`, so a real paste nested deeper than the cap would be dropped. 32 leaves room for redundant nesting from contenteditable.
- **An anchor with a trimmed history entry** (no anchor markup in it) still counts as untouched. The entry says nothing about the anchor either way.

## For other groups

- **F1:** `editing.js` `restoreRun` (about line 3761) writes `before_html` raw on the same fallback (SR 1). It should write `normalize.cleanMarkup(html)`, as `writeAnchor` now does.
- **F3:** replay reads the take-back's old tag from `anchor_tag_after` and needs nothing else from the record. A tag-only take-back must still carry `reverts`: that is how the page check tells it from a fresh change. `validateRun` should check bytes before `cleanBlock` (SR 2). Parsing is now linear, but the order still matters for the 8 MiB body.
- **F4:** CL 2 asks for the seams "retag and undo" test to go on through the agent's reply and a rebuild. Replay's side of that is covered here; the seams file is F4's.

## Cleanup needed

- None in the repo. No file was removed. The `node_modules` symlink is untracked and must not be committed. The `.claude-commit*` files are gitignored. A copy of the fixed `replay.js` used for the red run is in the session scratchpad, which the OS owns.
