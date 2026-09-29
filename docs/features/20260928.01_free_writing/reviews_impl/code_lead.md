# Code Review Lead: implemented diff (Round 2)

**Short version.** Most of the design was built as written, and most of my 29 first-round findings were built. But two blockers need fixing before the checkpoint:

- **A deleted block comes back.** If the reviewer adds a block in a sitting and then removes it again (Backspace, Cmd-Z or Delete block), the committed record still names the removed block. Replay then puts it back on the page, and the agent places it.
- **Undoing a type change does not stick.** When the reviewer undoes a change like paragraph to heading after the agent placed it, the take-back record carries no tag. The agent has nothing to change, and the heading comes back at the next rebuild with no flag.

Eleven findings are important, including:

- a false conflict card on short headings
- a contract gap around "Use the fixes"
- a "Not sent" state that a reload forgets
- a size estimate that lets the helper refuse what the bar allowed

`editing.js` has become a single closure of about 4,500 lines, with two commit paths that nearly duplicate each other. The first blocker sits exactly in the gap between them.

Diff reviewed: `git diff 97a8270..HEAD` in `.claude/worktrees/free-writing`. `npm run gate:unit` on HEAD printed: 1712 tests, 1710 pass, 0 fail, 2 todo. Four parallel passes covered editing, replay, the helper and the rail. I checked the contract text and its copies myself, and re-checked each blocker and the clash finding against the code or with a script. Scripts are in the session scratchpad (`ceil.js`, `est.js`, `retag.js`, `fuzz.js`, `fnlen.py`, `contract_copies.js`). No `docs/ongoing/diagrams/INDEX.md` exists; the diagrams are in `docs/diagrams/`.

---

## Findings, worst first

### 1. A block the reviewer removed mid-sitting stays in the committed record

- severity: blocker
- kind: defect
- where: `src/layer/editing.js:1041-1049` (`runShaped`), `:1273` (`runShaped: !!existing && record.hasRunFields(existing)`, set once at open), `:2744-2749` (draft branch), `:3095-3108` (plain commit branch)
- what: A sitting takes the run shape only while it has a block, a tag change, a list anchor or a container anchor. `session.runShaped` is never set once a draft has written run fields.
  - Suppose the reviewer presses Enter, types, then merges the block back or undoes it. The next draft takes the plain branch, which overwrites only `after` and `after_html` on a copy of the stored item.
  - The plain commit is `Object.assign({}, item, changes)`, and `changes` has no run keys. So the draft's old `new_blocks`, `anchor_after_html` and `placement` go through to the committed record.
- why: The committed record names a block the reviewer deleted, and its `after_html` disagrees with it. `hasRunFields` is true, so replay's `applyRun` inserts the block and the agent places it. The reviewer's text changes under them, which breaks brief R6 (the words stay as typed). The progress page's own deviation says "a record that has the run fields keeps them". The code does not do that.
- fix: Set `session.runShaped = true` the first time any draft writes run fields. Or have the plain branches delete every run field. Test (red first): Enter, type a word, Cmd-Z back to no blocks, Esc. The record has no `new_blocks`, and after a reload the page shows the word once.

### 2. The take-back of a type change carries no tag, so undo is lost at the next rebuild

- severity: blocker
- kind: defect
- where: `src/shared/record.js:1549-1550` (`revertOf` sends only `isRunRecord` records to `runRevertOf`), `:1872-1897` (`runRevertOf`); `src/layer/editing.js:3744-3756` (`restoreRun`)
- what: A tag-only record has an empty `new_blocks`, so its take-back takes today's path.
  - The script `retag.js` ran on kernel fixture 3 (p to h2). The take-back's `before`, `after` and `after_html` are all "Plain words zqxcanary". It has no `anchor_tag_after`, and `hasRunFields` is false.
  - A run record's take-back never restores the old tag either, even though `anchorTagOf(item)` has it.
- why:
  - The agent is told to "put the markup back" and has nothing to change.
  - Replay's old path counts the take-back as applied, and the page check passes it.
  - The heading returns after the rebuild, with no flag.
  - The architecture says undo gives the anchor "its before_html and old tag back".
  - The kernel listed this as a deviation. It is not sound.
  - The seams test "retag and undo" (`free_writing_seams.spec.js:333-361`) stops at "a take-back exists". It never has the agent act on it and rebuild.
- fix:
  - Send every record with run fields, tag-only included, through `runRevertOf`.
  - Set the take-back's `anchor_tag_after` to the fingerprint tag, which `validateRun` already allows. The existing contract line and replay's tag leg then apply.
  - Add the retag sentence to the take-back's change text.
  - Extend the seams test through the agent's reply and a rebuild: the anchor is a `p` again.

### 3. A short new block reads as a conflict with the page's own next paragraph

- severity: important
- kind: defect (in the doc and in the code)
- where: `src/shared/normalize.js:1686-1704` (`runClash`, `nextLeaf = 0` when nothing matched); called at `src/layer/replay.js:3129-3132`; architecture presence table, the "Inside a leaf that also holds words the reviewer never typed" row (BP1)
- what: Before the agent places a run, the leaf "where the block would sit" is the page's existing next block. A new block whose words sit inside that block as whole words counts as a clash. I reproduced it: `runClash([{h3:"Next"},{p:"Some new words here today"}], leafBlocks("<p>Next, we tested the build on Windows.</p>"))` gives `{"index":0,"blocks":1,"leaf":0}`. `"Yes"` against "Yes, that is the plan we agreed." gives the same.
- why:
  - Any reload between commit and placement triggers it: the reviewer's own reload, or the agent rebuilding for another item.
  - The item gets the "neither matches" conflict card, and nothing is written, anchor included.
  - The reviewer's new text disappears from the page until they press a button.
  - Short headings are the common first block of a new section.
  - The architecture exempts short blocks from the page-wide search for exactly this reason. BP1 brought the problem back.
- fix: Raise a clash only after an earlier run block matched (`nextLeaf > 0`), or only for blocks of `SHORT_BLOCK_WORDS` or more. Fix the BP1 row to say so. Add both probe cases as unit tests.

### 4. After "Use the fixes", the contract steers the agent to insert a duplicate block

- severity: important
- kind: defect (contract gap)
- where: `src/shared/review_format.js:110` ("place only the blocks not already in the source"), `:115` (the proofreading line: "put them in the source"), `boundHistory` at `:337-351`; the matching lines in `skills/lahe/SKILL.md` and `docs/CONTRACTS.md`
- what: After "Use the fixes", the fixed block is "not already in the source", so an agent following the contract adds it and leaves the old sentence.
  - Projected `after_history` entries carry no `new_blocks`, and their `after_html` is cut at 2000 characters.
  - The agent's own suggestions (`from` and `to`) are not projected anywhere in `review.json`. I searched `review_format.js` for `suggestions`, and it appears only in the contract text.
  - Proofreading only fires above 150 words, so the history entry is almost always cut.
- why:
  - The seams builder had to give the scripted agent a rule the contract does not state: rewrite a block that shows an earlier revision's words (`scripted_agent.js:92-110`, `:279`, `:399`). It rebuilds that from the cut history.
  - The seams page says an agent that inserts instead of replacing fails the test. A contract-only agent would do exactly that.
  - Nothing catches the duplicate afterward. The fixed words are on the page, so the handled check and the page check both pass.
- fix:
  - Add a contract line, in all three copies: "When a new rev changes the words of a block you already placed, replace that block in place; the reviewer's note names the fix." Say where the old words are.
  - Either project `new_blocks` on the last `RUN_HISTORY_KEEP` history entries, uncut, or project the reply's `suggestions` in the thread.
  - Test: a scripted agent that follows only the contract text passes the seams "Use the fixes" test.

### 5. "Not sent" does not survive a reload, so a refused edit reads as sent

- severity: important
- kind: defect
- where: `src/layer/sync.js:1484` (`var refusedRuns = Object.create(null);`), `:1808`, `:2021-2029` (`store.acknowledge(requireReview(), accepted.concat(refusedIds))`)
- what: The refused event is removed from the outbox, and the refusal is held only in page memory.
- why:
  - After any reload the card shows Ready, though the helper never stored the item. Plan Task 3.2 says a refused item is never shown as sent.
  - The late-card clock starts.
  - The main case is an over-ceiling notes record, which is exactly the one a reviewer comes back to later.
- fix: Save the refusal in browser storage beside the item, the way the acknowledged stamp is stored. Test: refuse, reload, and the card still reads "Not sent".

### 6. The bar's size estimate undercounts, so the helper refuses what the bar allowed

- severity: important
- kind: defect
- where: `src/layer/editing.js:1087-1107` (`estimate = session.baseBytes + bytes * 2 + count * 48`)
- what: The run rides in the record at least three times (`new_blocks`, `after_html`, `after`), not twice. At commit, `appendHistory` or `bumpRev` add another entry carrying the run, and JSON escaping is not counted.
  - `ceil.js` (using `record.js` itself) measured a 400-block run: estimate 403,535 bytes, real 1,177,050 bytes.
  - Over repeated sittings, at rev 13 the estimate is 3,900,328 bytes, so the bar only warns. The real record is 4,278,477 bytes, and `validateRun` refuses it with `RUN_OVER_CEILING`.
- why:
  - Task 2.2's acceptance says the record is never over the ceiling.
  - The handoff says the layer never sends a run over any ceiling.
  - Together with finding 5, a long notes page gets refused silently.
- fix: At open, measure the next committed record: `record.recordBytes(record.bumpRev(item, fields))` with the run taken out. Then add a per-byte factor taken from that measurement. Or call `recordBytes` once per block change. Test: the rev-13 case is stopped by the bar before the helper sees it.

### 7. Projected `new_blocks[].text` keeps entities, while the contract calls it the words

- severity: important
- kind: defect
- where: `src/shared/review_format.js` `projectBlocks` (`text: record.blockText(b.html)`); `record.js` `rewordBlock` decodes (`decodeBasic`)
- what: "a &lt; b & c", as typed, is projected with `text: "a &amp;lt; b &amp;amp; c"`. `applySuggestions` accepts `from: "b & c"` and refuses the entity form.
- why:
  - The contract says "text is its words" and "write < as &lt;".
  - An agent that escapes `text` writes `&amp;lt;`. The page then shows "&lt;", and the handled check holds the item.
  - An agent that proofreads from `text` quotes `from` strings that `lahe reply` refuses.
  - The scripted agent reads only `html`, so Task 3.4 never exercises `text`.
- fix: Project `text` with `normalize.decodeEntities`. Add a projection test for `<` and `&`, and a `reply_proofread` test whose `from` holds `&`.

### 8. Replay resolves a run's anchor without `tagAfter`

- severity: important
- kind: defect
- where: `src/layer/replay.js:2495-2508` (`resolveRegion` calls `ctx.anchor.resolve(refWithProbe(ref, probes[i]), ctx.root)` with no options); damage at `:3147-3153`; compare `editing.js:3869`, which passes it
- what: 2A's handoff says replay must pass `{placement, tagAfter}`. Without `tagAfter`, the ladder's tie-breaker (`anchor.js:1388`) stops only at the minted tag.
- why: Take an anchor whose words are one inline element, such as a line that is all italic. Once it is placed as an `h2`, the ladder returns the `em`. The tag leg then runs `swapTag(em, "h2")`, which nests an `h2` inside the `h2`.
- fix: Pass `{ tagAfter: item.anchor_tag_after, placement: item.placement }`. Let the tag leg swap only an element in `BLOCK_TAGS`. Add a replay spec with a retagged anchor that is all italic.

### 9. Replay's per-block tag fix breaks lists when a block changes to or from a list

- severity: important
- kind: defect
- where: `src/layer/replay.js:3229-3246` (`fixBlock`: `swapTag`, then markup is rebuilt only `if (force || missingEmphasis(...))`)
- what: A `ul` block matched one to one with a `p` leaf (an old agent wrote the one-item list as a paragraph) is fixed by moving its children. The result is `<ul>text</ul>`, or `<p><li>..</li></p>` the other way. The string page check then sees the right tag and passes.
- fix: When exactly one of the two tags is a list tag, rebuild through `blocks.writeBlock(block.tag, block.html)`, which is the same as `force = true`.

### 10. The run notes on a card never clear

- severity: important
- kind: defect
- where: `src/layer/replay.js:3047-3052` (`setRunNote`); the only `clearCardBadge` in replay is for `REPLAY_NEITHER_MATCHES` (`:2001`)
- what: `REPLAY_RUN_WRONG_TAG` and `REPLAY_RUN_PLACED_ELSEWHERE` are set and never cleared. The card says "already further down the page" after the agent has fixed the page.
- why: This is the same false note the seams fix removed for one path. It stays for every other path.
- fix: Clear both codes at the start of each `placeRun`, then set them again from this pass. Test: a wrong tag, the agent fixes it, reload, and there is no badge.

### 11. Session undo copies the whole run on every step

- severity: important
- kind: defect (my first-round finding 29, accepted as "changed blocks only", not built)
- where: `src/layer/editing.js:1812-1820` (`stateNow`)
- what: Each step copies every run block's `innerHTML` plus the anchor, up to `SESSION_HISTORY_MAX` (100) steps.
- why: At the byte ceiling that is about 20 MB of strings held while the frame is open. The plan's constant table says "changed blocks only".
- fix: Store the indexes each step touched, with their html before the step. Or cap the history by bytes as well as by count.

### 12. Replay walks the whole page again for every missing block

- severity: important
- kind: risk
- where: `src/layer/replay.js:3217-3221` (`leafAfter`: `blocks.leafWalk(doc.body)` per call), `:3202-3210` (`placedElsewhere`: a full walk plus `cleanMarkup` of every leaf, per call); `placeRun` also runs `runElementsFor`, `runClashFor` and `priorRunLeaves`, each its own walk
- what: A run that is not yet placed has every block missing after a reload. A 250-block notes sitting then costs about 500 full-body walks per pass, each cleaning every leaf.
- why: That work runs on the main thread, for the long-notes case this feature exists for, and no test measures it.
- fix: Walk once per `placeRun`, keep each leaf's words, and update both on insert. Add a timing line to `scripts/measure_draft_write_cost.js`.

### 13. `editing.js` is a single 4,485-line closure with two commit paths that nearly match

- severity: important
- kind: risk
- where: `src/layer/editing.js:572-5056` (`createEditing`). The longest functions, measured by `fnlen.py`:
  - `commit` 135 lines (2875-3009)
  - `buildBar` 131 lines
  - `openRun` 116 lines
  - `deleteBlock` 110 lines
  - `commitRun` 107 lines (3015-3121)
- what:
  - The run session and the legacy session live side by side.
  - `commit` and `commitRun` repeat the withdraw, discard and restore logic almost line for line (compare 3052-3071 with the legacy path).
  - Crash recovery adds a third "did it change" rule (finding 14).
- why: A fix to one path misses the other, and finding 1 lives in that gap. `CLAUDE.md` says code goes in the file that matches its job in the architecture. The run session (capture, ceiling, guard, history, block types) is a job of its own.
- fix: Move the run session into its own layer file behind a small interface, with one manifest entry. Share one "finish the commit" helper between the two paths. This can follow the blockers, but it should be on the board before more work lands in `editing.js`.

### 14. Crash recovery commits a tag-only sitting as the wrong kind

- severity: minor
- kind: defect
- where: `src/layer/editing.js:2832-2863` (`recoverRun`, `runChanged`)
- what: Drafts never set `kind`, and `recoverRun` never works it out, so a crashed tag-only sitting commits as `edit`, not `format_only`. `runChanged` is a strict `!==` string test, while commit uses `runVerdict`.
- fix: Build the fields and call `runVerdict` for both the changed test and the kind.

### 15. Undo can remove a page block the reviewer never wrote

- severity: minor
- kind: risk
- where: `src/layer/editing.js:3747-3751` (`restoreRun` removes every element `runElementsFor` matched)
- what: `matchRun` skips unmatched leaves before its first match. When the run's first block is gone, a page block with the same short words inside the slack is matched and removed.
- fix: Remove only blocks matched in order with no leaf skipped, or only elements the layer remembered for this record (`rememberAlso`).

### 16. The page check's tag note points at the wrong field for a retagged anchor

- severity: minor
- kind: defect (copy)
- where: `src/shared/record.js` `PAGE_CHECK_TAG_NOTE` ("a block landed with a different tag from the one in new_blocks")
- what: For an anchor retag, the tag is in `anchor_tag_after`, not `new_blocks`.
- fix: "...from the one in new_blocks or anchor_tag_after." Update the plan's pinned table and the contract copies that quote it.

### 17. `anchor_after_html` is still cut at 2000 characters, possibly mid-tag

- severity: minor
- kind: defect
- where: `src/shared/review_format.js` `projectItem`: `boundData(... ANCHOR_AFTER_HTML ..., BEFORE_MAX)`
- what: The contract calls this field "the anchor's own change". For a list-append record the anchor is the whole list. `boundData` cuts by character, so it can end mid-tag.
- fix: Use `sittingMax` for it, as `after_html` does. Add it to the over-2000 projection test.

### 18. A punctuation-only fix inside a run is invisible to every check

- severity: minor
- kind: risk
- where: `src/shared/normalize.js:1376-1379` (`blockWords` folds typography, and runs of hyphens since BP2); `src/layer/replay.js:3193` (branch three skips a prior revision whose folded words are equal); the stale comment at `normalize.js:99-100`
- what: A proofread fix of "well--known" to "well-known" is never rewritten on the page and never flagged.
- fix: Compare prior and current revisions with `normalizeText`, not the fold. Correct the comment.

### 19. The page check skips lost bold on a `format_only` anchor

- severity: minor
- kind: defect
- where: `src/layer/replay.js:3652` (`if (item[F.KIND] === record.KIND.EDIT && missingEmphasis(...))`)
- what: A sitting that retags and bolds the anchor is `format_only`, so its bold is never checked.
- fix: Check the anchor's bold and italic for `format_only` too.

### 20. One shape, spelled in several places

- severity: minor
- kind: taste (the repo rule that a shape is spelled once, in `src/shared/`)
- where:
  - Block type names, five tables:
    - `gestures.js:497-502` (`BLOCK_TYPES`)
    - `review_format.js:957` (`BLOCK_TYPE_NAMES`)
    - `replay.js:2906-2911`
    - `overlay.js:1301` (`shapePhrase`, whose own comment says it reads gestures)
    - `record.js` `TYPE_NAMES`, where h3 is "heading" while replay says "subheading"
  - "First six words": `editing.js:249`, `replay.js:2948-2952`, `overlay.js:1270-1280`
  - Field names and `"start_of_container"`: `replay.js:2889-2896` (`RUN_FIELD`), `blocks.js:241-242`, `anchor.js` `containerRung` (with a local `CONTAINER_TAGS` that repeats `blocks.isContainerAnchor`)
  - The inline allowlist again in the layer: `editing.js:962-986` (`INLINE_KEEP`)
  - `isOldShape`'s tag regex at `editing.js:1181`, which repeats `BLOCK_TAGS`
- why: The conflict line and the tag note already name the same `h3` two ways. A rename on the menu leaves the export, the card notes and the shape line behind.
- fix:
  - Read the labels from `gestures.BLOCK_TYPES`.
  - One `normalize.firstWords(text, n)`.
  - `record.FIELD` and `record.PLACEMENT` everywhere.
  - Export the allowlist from `normalize.js`.

### 21. Answering a proofread copies `continueThread` by hand and is detected by note text

- severity: minor
- kind: risk
- where: `src/layer/tab_done.js` `answerOnto`, `answeredProofread` (`item[F.NOTE] === PROOFREAD.USE_TEXT || ... KEEP_TEXT`)
- what:
  - "Use the fixes" repeats `continueThread`'s steps to avoid a second revision bump.
  - The waiting state is worked out by comparing the note to the pinned text.
- why:
  - A later change to `continueThread` misses this path.
  - A reviewer who types the pinned sentence into the follow-up box gets the proofread treatment.
- fix: Add `record.continueOnto(item, base, turn)` and call it from both paths. Mark the turn with a field rather than matching text.

### 22. `washCommitted` finds the run again through globals

- severity: minor
- kind: taste (hidden coupling)
- where: `src/layer/tab_edits.js` `washCommitted`
- what: It reaches `root.LAHE.anchor`, `blocks` and `highlight` outside its factory, resolves the anchor again and calls `runElementsFor`, with every error swallowed. Editing held those elements a moment earlier.
- fix: Have editing's `committed` event carry the run's elements. At least name the three modules as factory dependencies.

### 23. Notes mode is spread through `review.run`

- severity: minor
- kind: taste
- where:
  - `src/cli/commands/review.js:226-377`: about eight `notesMode` branches
  - `:391` `isNotesReview`, which reads `meta.json` itself, beside `src/service/reviews.js` `isNotes`
  - `src/service/static_servers.js:1160` (`var pageMode = isPageRoot(root);`, decided by a `stat` at start)
- what: Every later change to the folder-server path must remember to skip notes in several places. There are two readers of the notes marker. A one-page server whose render is missing at restart comes up in folder mode.
- fix: Split `startServer(mode)` and `printScope(mode)`. Use one notes reader. Store `page: true` on the server record.

### 24. The layer makes no helper-contract check

- severity: minor
- kind: challenge (plan versus build)
- where: plan Task 1.5 acceptance ("the version check the CLI and the layer use"); the kernel progress file's Follow-ups
- what: Only `add.js` and `session.js` read `helperContractVerdict`. Since every page start goes through the CLI, a stale helper is replaced there. That is enough, but the architecture's "a new layer or CLI refuses an old helper" is not what was built.
- fix: Change the architecture and plan line to say the CLI does it, or add the check to `sync.js`'s health read.

### 25. Smaller items

- severity: minor
- kind: taste
- where and what:
  - `src/service/replies.js`: the proofread fold changed with no unit test. Only a browser spec covers it. Add one: a proofread reply keeps both fields, and a plain question keeps neither.
  - `src/layer/replay.js:3469-3493` and `:3548-3584`: `resolveBlockClash` and `resolveRunConflict` share an eight-line ending. `takePageBlock` and the held run's "Take the page's" both run `buildRunAfter`, then `bumpRev`, then `runChangeText`. Pull out `finishRunAnswer` and `reviseRun`.
  - `review_format.js` `projectItem`: every drain line of every item now carries seven null or false run fields. This is consistent with one shape per item. It is a deliberate choice worth a sentence in `CONTRACTS.md`, since the repo's rule is that repeated context steers agents.

---

## Contract text and its three copies

- A script (`contract_copies.js`) checked all 57 lines of `review_format.CONTRACT`. Each appears word for word in `docs/CONTRACTS.md` and in `test/unit/review_format.test.js`.
- `skills/lahe/SKILL.md` restates the new rules in its checklist and in "A handled reply is checked", and they agree with the contract.
- The failure texts in `failures.js` match the plan's pinned table.
- Gaps against what the code does:
  - finding 4 (no rule for replacing a fixed block, and no data for it)
  - finding 7 (`text` is not the words)
  - finding 16 (the tag note names the wrong field)
  - finding 2 (a take-back gives no tag instruction, so the existing `anchor_tag_after` line never fires on an undo)
- The skill is not installed and `dist/` is not rebuilt, both as planned for Task 3.6.

## My first-round findings: built or not

| # | What it was | Now |
|---|---|---|
| 1 | Take-back had no replay path | Built (`remove_blocks`, removal in `placeRun`). The tag half is not (finding 2) |
| 2 | No shared way to find a run | Built (`blocks.runElementsFor`) |
| 3 | Container anchor compared by text | Built (found by tag, no compare) |
| 4 | `lahe write` relied on `--only` | Built (one-page server, 404 for the rest, no mounts) |
| 5 | Host missed a run after `sheet-head` | Built |
| 6 | Shared functions had no signatures | Built, as the plan pinned them |
| 7 | The walk had no end | Built (`matchRun` limit and stop; the seams `leafAfter` extends it by one leaf) |
| 8 | Card codes and copy | Built |
| 9 | Refused event looped | Partly: no loop, but "Not sent" is lost on reload (finding 5) |
| 10 | Run `after_html` cut at 2000 | Built; `anchor_after_html` still cut (finding 17) |
| 11 | History uncapped | Built (`trimRunHistory`, `RUN_RECORD_MAX_BYTES`); the layer's estimate is off (finding 6) |
| 12 | Handled check had no runnable rule | Built (`runVerdictFor` tries each start leaf) |
| 13 | Buttons on any question | Built |
| 14 | Agent counted 150 words | Built (`run_words`, `proofread`) |
| 15 | Later revision repeats placed blocks | Built as a contract line, but see finding 4 for the proofread case |
| 16 | Cmd-Shift-E with no block | Built |
| 17 | AltGr digits | Built |
| 18 | HTML placement untested | Built (seams "HTML" and "old agents (html)") |
| 19 | R14 scripts ran the main checkout | Built (`LAHE_REPO` or the file's own location) |
| 20 | Write cost per keystroke | Measured and on the progress page |
| 21 | Menu missing a type | Built (six rows) |
| 22 | "No mode switch" wording | Doc only; the code is consistent |
| 23 | Dashed rule had no task | Cut by the plan; the wash stands in |
| 24 | Three change-text cases | Built |
| 25 | Each `li` a leaf | Built (`ul`/`ol` are leaves in both copies of the walk) |
| 26 | `export.js` disagreement | Built (through `renderText`) |
| 27 | Ownership table gaps | Handled; each file outside its row is listed as a deviation |
| 28 | Where a run can go | Built (`canHoldRun`, plus list and table-part hosts) |
| 29 | Session history memory | Not built (finding 11) |

## Deviations, judged

**Kernel (Phase 1)**
- `RUN_BLOCK_REFUSED` spelled in two files, held equal by a test: sound. The manifest's load order forces it.
- The helper refuses anything that is not exactly `cleanBlock`'s output: sound. `fuzz.js` ran 291,836 accepted inputs, and each one comes out the same when cleaned a second time. Real capture is not refused.
- Singular change text for one block; the anchor's type name taken from the fingerprint: sound.
- `after` keeps entities as written: acceptable for `after`. It leaks into the projected `text` (finding 7).
- `insertPointAfter` climbs only past inline chrome; `canHoldRun` also false for list and table hosts: sound.
- Take-back of a retagged run does not restore the tag: **not sound** (finding 2).
- The layer makes no contract check: see finding 24.

**Editing (2A)**
- Tab reaches the menu; the focus-ring rule is its own constant; a split tail loses its link in `new_blocks` (it is `from_anchor`); Delete block in a run session; first six words: sound.
- "A record that has the run fields keeps them": sound as a rule, **not what the code does** (finding 1).
- IME tests only in Chromium, and the paste stand-ins: acceptable for tests. Real IME in Firefox and WebKit is unverified, so add it to the Task 3.6 walk.

**Replay (2B)**
- Singular conflict line; menu names for types; "Take the page's" as a new revision; a take-back keeping today's page check: sound. The menu names add a third name table (finding 20).
- The page check starts from the anchor's words: acceptable. It can disagree with replay only when the anchor's words appear twice.
- Specs drive `runPass` directly: acceptable, since Task 3.4 covers the booted layer.
- Insert and check specs never seen red against missing code: noted, no action.

**Helper (2C)**
- Notes set at creation only, with `--new`; `projection.js` touched; `--proofread` refuses a stale rev; the `rebuild_not_the_agents_job` assertion changed: sound.
- Refusal state in sync, not on the record: the placement is fine, but memory-only is not (finding 5).

**Integration fixes**
- `matchRun` keeps four statuses, with the clash as its own function: sound. The clash rule itself is wrong before placement (finding 3).
- The two answers remember differently; the anchor's badge line reused: acceptable.

**Rail**
- `replies.js` and `index.js` `onContinued` changed outside the table: needed, and scoped. `replies.js` needs its own unit test (finding 25).
- The blank start-of-page draft is hidden and not counted: sound. It hides only a draft with no words.

**Seams**
- `leafAfter` in `placeRun`: it removes the false note and cannot duplicate, because it needs exact words. But it patches around the walk's stop rule and adds a walk per missing block (finding 12). Fold it into one walk.
- Crash recovery (`recoverRun`, recovery in `exitReadOnly`): right fix, with a gap in the kind (finding 14).
- Old agents on HTML: the plan line was changed (9b5fe24) to match the architecture's "nothing wrong is handled silently". Sound.
- History has no `new_blocks` for "Use the fixes": not just a follow-up. It is finding 4.

## What I did not review

- test design in depth (the testing reviewer)
- threat model and path races in `lahe write` (the security reviewer)
- the browser suite, which I did not run

## Cleanup needed

- `node_modules` symlink in the free-writing worktree (untracked, never commit)
- `test/browser/tmp_rail_probe.spec.js` in the rail worktree (untracked scratch probe, per the rail progress page)
- `test/browser/tmp_image_pick.spec.js`, untracked in the main checkout. It is not from this feature; ask before removing.
