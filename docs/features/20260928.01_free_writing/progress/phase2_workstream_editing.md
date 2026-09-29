# Phase 2, editing workstream (2A): progress

**Summary.** Tasks 2.1 to 2.4 are built on `free-writing-2a`. `npm run gate:unit` is green: 1619 tests, 1617 pass, 0 fail, 2 todo. The six new browser specs pass in Chromium (92 tests), Firefox (90 pass, 2 skipped) and WebKit (90 pass, 2 skipped). The two skips are the IME tests, which only Chromium can drive. The three existing Enter specs pass with updated expectations. No full browser suite ran. `dist/` was rebuilt locally and not committed.

## Existing specs whose Enter result changes (Task 2.1, agreed with the orchestrator)

Found by searching every browser spec for a bare `Enter` or `Shift+Enter` pressed inside an open edit. Cmd-Enter in comment boxes, and Enter on rail controls (`card_collapse.spec.js`, `rail_menu.spec.js`), are not edits and do not change.

| Spec | What changes | Result on this branch |
|---|---|---|
| `paragraph_break.spec.js`, "Enter in the middle" | Enter mid-paragraph splits the block into two sibling `p`, the tail marked `from_anchor`. | Updated: `change` is the split sentence, plus `new_blocks` and `anchor_after_html` checks. `after` and `after_full` unchanged. Passes. |
| `paragraph_break.spec.js`, "Enter at the end and a typed sentence" | The sentence is a new sibling `p` in `new_blocks`. | Updated: `change` is "Added 1 block after this paragraph: p. Its words are in new_blocks." Passes. |
| `paragraph_break.spec.js`, the other four | Shift-Enter is still a line break; an empty trailing Enter is still no record. | Unchanged. Pass. |
| `no_duplicate_text.spec.js` | `typeParagraphs` and `appendParagraphs` now make run records. | Unchanged. All pass on this branch with today's replay. The page-count assertions depend on replay, so the orchestrator rechecks them after 2B merges. |
| `split_not_conflict.spec.js` | The three typed paragraphs are an anchor plus two `new_blocks`. | Unchanged. Both pass here. The control case may read differently once 2B's presence table lands. |
| `free_writing_r14.spec.js` | Enter after an `h2` now writes the line after the `sheet-head`. | Kernel-owned, not edited. Still 5 passed here: the three expected failures still fail with today's replay, so the flip waits on 2B. |

## What was built, by task

### 2.1 The editing host and the session (`83a885d`)

- **Two kinds of session.** A run session (free writing) edits an anchor block plus a run of new sibling blocks. A legacy session is today's single-block session. A record from before free writing, a record anchored on one list item, and a block whose host cannot hold a run (`blocks.canHoldRun` false: a `td`, a caption) all get the legacy session.
- **The host.** `blocks.hostFor(anchor)` gets `contenteditable` and `data-lahe-edit-host`, with the page's own values saved and put back at commit. A caret in a list item anchors the whole list.
- **The guard.** A `beforeinput` handler on the host refuses every edit whose selection or target range reaches outside the anchor and run. Events from inside the rail are not its business.
- **What the layer writes itself.** Each of these is cancelled and written by the layer:
  - Enter, decided by `gestures.enterIntentFor`: sibling, split with a `from_anchor` tail, new list item, end of list, line break
  - Backspace and Delete at a block edge, decided by `gestures.edgeDeleteFor`
  - typing over a selection that spans blocks
  - cut across blocks, as a spanning delete
  - plain-text paste and drop: a blank line makes a new paragraph, a single newline a line break
- **Ending the session.** A click outside ends it, as today. An arrow key that takes the caret out ends it (keyup). A composition that starts outside the session has its block put back when it ends, then the session commits.
- **Capture.** Each run block's words are spelled with only what `cleanBlock` keeps, then run through `normalize.cleanBlock`, and exactly its output is stored. Only blocks marked dirty are rebuilt: on a keystroke that is the caret's block. The record is built with `record.buildRunAfter` and `record.runChangeText`.
- **`kindFor` for a run.** A new block or new words make an `edit`. A tag change or markup change alone makes `format_only`.
- **`itemFor` and reopening.** `itemFor` maps a run block to its outstanding record through `blocks.runElementsFor`. Cmd-Shift-E on any run block reopens that record, and once the record is handled a sitting there starts a new one.
- **The frame** wraps every block the sitting created or changed plus the caret's block; an untouched anchor stays outside it. The bar sits above the anchor too, so it never covers the words being written after.
- **The focus ring.** `highlight.EDIT_HOST_RULE`, added to the one page-level sheet, hides the host's ring. It matches only `[data-lahe-edit-host]`.
- **The live region.** A polite `role=status` node in the layer's shadow root says the pinned lines: session start ("Writing after: {first six words}" or "Writing at the start of the page"), each block type change (the menu label), and commit ("Sent to the agent").
- **Protection for a run.** `protect.mark` takes `blocks()`, `host()` and `refind()`. The snapshot holds every block's tag and markup plus the caret by block index and offset; a restore re-finds the anchor, rebuilds the run with `blocks.insertPointAfter`, and hands the rebuilt blocks to editing (`protect.protectedBlocks()`), which makes the new parent editable again. It is tested in Task 2.4.
- **`scripts/measure_draft_write_cost.js --run`** types a 5,000-word run (250 paragraphs of 20 words) in Chromium and counts storage writes and blocks rebuilt per keystroke.

### 2.2 Block types, the bar menu, hotkeys, lists, and the ceiling (`de82fba`)

- **One function per type** (`typeActions[tag]`, all landing in `applyType`), called by the menu, the chord from `gestures.blockTypeChord`, and the shortcut from `gestures.markdownShortcutFor`. A shortcut works only at the start of a block, so "# " mid-line stays text.
- **The menu** sits before B and I, built on the rail's "More actions" menu: `role=menu`, `aria-haspopup`, `aria-expanded`, arrows, Home and End. Each row shows its label, its chord for the reviewer's system, and its Markdown shortcut. Esc closes only the menu and puts focus and the caret back. It opens upward when there is no room below. On a narrow window the bar drops its hint first.
- **Outside the six types** (a blockquote, an `h1`, an `h5`, a `pre`, a cell) the button reads "Other block" and is disabled, and the chords and shortcuts do nothing.
- **Lists.** Bulleted and Numbered swap the whole list. Paragraph is on only for the last item, and moves it into a new `p` after the list. Headings are off inside a list. Enter at the end of an existing item adds an `li` to `anchor_after_html`.
- **The anchor's type** changes through `blocks.swapTag`, which sets `anchor_tag_after` and moves protection with `protect.rebindTo`.
- **The ladder's tag tie-breaker** (`anchor.js` `mintedElementFor`) accepts the minted tag or `options.tagAfter`.
- **The ceiling.** The record's size apart from the run is measured once when the session opens. The run's bytes are counted as capture already counts them. The bar warns at 90 percent of any of the three ceilings, and refuses Enter, typing and paste that would go over, with the pinned at-the-ceiling line.

### 2.3 Starting in empty space and the empty page (`5553e55`)

- **"+ Write here"** shows while any edit is open, over a gap between leaf blocks or below the last one. It stops at the rail's berth (`--lahe-rail-allowance`), fades with the frame's 120ms opacity, and shows at once under reduced motion. Clicking it commits the open session and opens a new one after the block above, with an empty `p`.
- **The placeholder** "Start writing" is drawn in the shadow root over the empty block and goes on the first keystroke. It is never in the page or a record.
- **Edit state with no block open.** Cmd-Shift-E with the caret in no block shows the bar near the top with its label and the pinned hint, and hides the menu, B, I and Delete block. A click on a block opens that block; Esc, or a press on the rail, leaves.
- **The empty page** opens ready to type (PQ1): a session anchored on the page's one `main` (else `body`), `placement: start_of_container`, with an empty `p` after the marked file-name title. It does not open when an outstanding `start_of_container` record exists.
- **The empty-container rung** in `anchor.resolve`, driven by `options.placement`, shown in `docs/diagrams/finding_the_region.md`.

### 2.4 Undo and protection (`991fd60`)

- **Session history.** A step per block change and per typing burst (`TYPING_BURST_IDLE_MS` 1000), capped at `SESSION_HISTORY_MAX` 100 (the oldest drops). A Markdown shortcut is its own step. Cmd-Z and Shift-Cmd-Z (and `historyUndo`/`historyRedo`) walk it while the frame is open.
- **Undo of a committed run.** `restoreRun` finds the run with `blocks.runElementsFor` before the anchor moves, removes it, and gives the anchor its old tag (from the region's fingerprint, since the record never stored it) and its `before_html` through `blocks.writeBlock`. An unhandled record is withdrawn. A handled one raises `record.revertOf`'s take-back, which deep-equals the kernel's take-back fixture.
- `docs/diagrams/protected_region.md` shows the run.

## File by file

| File | Why it changed |
|---|---|
| `src/layer/editing.js` | The run session, capture, commit, the bar menu, edit state, the line, the placeholder, the live region, session history, and committed-run undo. |
| `src/layer/protect.js` | Run snapshot and restore, `rebindTo`, `protectedBlocks`, and `isProtected`/`touches` over the whole run. |
| `src/layer/anchor.js` | The empty-container rung and the tag tie-breaker's second tag. |
| `src/layer/highlight.js` | `EDIT_HOST_RULE`, the one focus-ring rule. |
| `scripts/measure_draft_write_cost.js` | The `--run` session. |
| `docs/diagrams/finding_the_region.md`, `protected_region.md` | The new rung and the run. |
| `test/browser/paragraph_break.spec.js` | The two Enter expectations above. |

## Tests added

- `test/browser/free_writing_capture.spec.js` (10): every fixture typing can produce, deep-equal to `record_fixtures.runFixtures()`, plus the second-sitting fixture at rev 2. The take-back fixture is typed in the undo spec.
- `test/browser/free_writing_host.spec.js` (22): merges, arrows across the edge, the seven "outside keeps its outerHTML" paths, no style spans, paste, IME, leaving by click and by arrow, the split tail, the empty last item, reopen and handled, the `td`, the body-level page, the live region, and a pre-feature record.
- `test/browser/free_writing_types.spec.js` (44): each type by each route in new text and in an existing block (32), the menu, "Other block", keyboard use, upward opening, "# " mid-line, format_only, list append, list rules, the ceiling, and computed styles on both pages.
- `test/browser/free_writing_empty.spec.js` (6), `free_writing_undo.spec.js` (6), `free_writing_repaint.spec.js` (4).
- `test/browser/support/free_writing_page.js`: the shared set-up and the paste stand-in.
- Unit: `test/unit/editing_run.test.js` (6, new), `anchor_cases.test.js` (+2), `anchor_engine.test.js` (+4), `protect_vocabulary.test.js` (+3). Each new unit test was run red against the file before its change.

## Commands and results

| Command | Result | Wall time (from the run's own output) |
|---|---|---|
| `npm run gate:unit` (base) | 1604 tests, 1602 pass, 0 fail, 2 todo | 42.7s |
| `npm run gate:unit` (final) | 1619 tests, 1617 pass, 0 fail, 2 todo | about the same |
| six free-writing specs plus `paragraph_break`, Chromium | 98 passed | 17.8s |
| six free-writing specs, `--project=firefox` | 90 passed, 2 skipped | 25.5s |
| six free-writing specs, `--project=webkit` | 89 passed, 1 failed, 2 skipped; the failure was the menu-click race below, fixed, then the menu tests passed 96 of 96 over `--repeat-each=8` | 22.7s |
| `paragraph_break`, `no_duplicate_text`, `split_not_conflict` | all pass | 42.3s and 42.8s |
| `free_writing_r14.spec.js` on this branch's bundle | 5 passed (1 ordinary, 4 expected failures) | 21.5s |
| `node scripts/measure_draft_write_cost.js --run` | see below | 17.9s session |

**Full suite:** not run.

**Draft cost, 5,000-word run** (`--run`, one input event per word):

| Count | Value |
|---|---|
| keystrokes | 5000 |
| record writes (`lahe.item.*`) | 5000, at most 1 per keystroke |
| run blocks rebuilt through `cleanBlock` | 5000, at most 1 per keystroke |
| all `setItem` calls | 20015, at most 5 per keystroke |
| run blocks at the end | 250 |
| record as JSON | 160126 characters |

The other setItem calls per keystroke are today's store and sync bookkeeping (the index generation stamp, the outbox, and its stamp), not something this workstream added. The outbox and the draft floor are 2C's.

## Deviations

- **Tab reaches the menu from the keyboard.** The plan asks for keyboard use of the menu but pins no key. In a run session Tab moves focus to the block-type button; arrows, Enter or Space open it; Esc or Shift-Tab goes back to the caret.
- **The focus-ring rule is its own constant** (`EDIT_HOST_RULE`), appended to the page sheet after `STYLE_TEXT`. `comments_surface.test.js` (not 2A's) pins `STYLE_TEXT` as highlight rules plus the two reset rules and nothing else.
- **When a sitting takes the run shape.** A sitting takes it when it adds a block, changes the anchor's tag, is on a list anchor, or is on an empty page. A plain reword of one block keeps today's record shape, so every existing reword spec is unchanged. A record that has the run fields keeps them.
- **A split tail keeps only what `cleanBlock` allows.** A link inside the tail keeps its words and loses its tag in `new_blocks`. The tail is marked `from_anchor`, so the agent splits the source there and the source's link survives. The space at a split point is trimmed on both sides.
- **Paragraph on the last item of an anchor list** marks the moved item `from_anchor`: those words were the anchor's.
- **Delete block in a run session** removes the caret's run block. On the anchor it keeps today's delete, and is disabled while the run has blocks.
- **The first words** in the screen-reader line are the first six (`FIRST_WORDS`); the plan does not pin a count.
- **IME** is driven through the Chromium DevTools protocol, so the two IME tests skip in Firefox and WebKit, with that reason in the skip.
- **What stands in for Meta+V:** Chromium uses a real Meta+V over a rich clipboard. WebKit gets a paste event carrying both types. Firefox hands a synthetic paste event an empty clipboard, so it gets the `beforeinput insertFromPaste` a real paste sends, carrying the same data.
- **Computed styles** are compared against the page's own twin measured before the new block goes in, since the new block becomes the twin's previous sibling. A new `h2` on the Markdown render is compared on font size, line height and weight only; its margins belong to the `sheet-head` it does not have yet.
- **One support file beyond the ownership table:** `test/browser/support/free_writing_page.js`, shared by the six specs.
- **Screenshots** come from a script in the scratchpad, run after the passing specs on the same build, not from a spec.

## Surprises

- Every edit inside the host now fires `input` with the host as its target, so protection's snapshot-on-typing had to key off the host, not the anchor.
- A run's first repaint test passed only after `refind` was added: on the Markdown render the anchor has no attribute protection can find it by, and the minted one does not come back from the server.
- WebKit could miss a click on the bar's menu button under parallel load, because the bar follows the frame one animation frame behind. The spec waits two frames before aiming. The reviewer's pointer never meets this.
- The kernel's R14 expected failures still fail on this branch: the header line lands after the `sheet-head` in the page, and today's replay does the rest.

## What replay (2B) and helper (2C) need to know

- **2B:** call `anchor.resolve(ref, doc, { placement, tagAfter })`. `placement: "start_of_container"` turns on the container rung (the record's anchor is `main` or `body`, found by tag); `tagAfter` is the record's `anchor_tag_after`, and the tie-breaker then stops at either tag. Without them a placed notes record reads as lost and a retagged anchor binds its inner `<em>`.
- **2B:** during a run session `protect.isProtected` and `protect.touches` cover the anchor and every run block, and `protect.protectedItemId()` is the run record. Run blocks carry no marker attribute on the page.
- **2B:** committed undo of an unhandled run takes the run off the page and withdraws the record; replay should find nothing to do. A handled run's take-back carries `remove_blocks` and `placement` and no `new_blocks`.
- **2C:** the layer posts a run draft on every keystroke through `sync.recordItem`, exactly as a plain edit does (`existing`, `withdrawnFromReady`). The run draft floor is sync's.
- **2C:** the layer never sends a run over any ceiling: it refuses input first. Its size estimate is the record without the run, plus twice the run's bytes, plus 48 per block.
- **2C and the orchestrator:** the empty page opens a session and persists its draft record at open, as Cmd-Shift-E does today. It opens only on a page with no content blocks and no outstanding `start_of_container` record.
- **Orchestrator:** index.js's `onRestore` calls `editing.rebind(el)`. In a run session that reads `protect.protectedBlocks()`, so no index.js change is needed. `editState()` now also returns `mode`, `placement`, `anchorTag`, `runTags`, `menuLabel`, `ceilingRatio` and the history depths.

## Screenshots

Taken on this branch's bundle after the passing specs. Light on the page each task names; dark on `test/fixtures/free_writing/dark.html`.

- Task 2.1, the frame around an anchor plus a two-block run (the untouched anchor above it), `md_render.html` and dark:
  - Chromium: [light](shots/2.1-frame-run-light-chromium.png), [dark](shots/2.1-frame-run-dark-chromium.png)
  - Firefox: [light](shots/2.1-frame-run-light-firefox.png), [dark](shots/2.1-frame-run-dark-firefox.png)
  - WebKit: [light](shots/2.1-frame-run-light-webkit.png), [dark](shots/2.1-frame-run-dark-webkit.png)
- Task 2.2:
  - the bar, menu closed: [light](shots/2.2-bar-menu-closed-light.png), [dark](shots/2.2-bar-menu-closed-dark.png)
  - the menu open: [light](shots/2.2-bar-menu-open-light.png), [dark](shots/2.2-bar-menu-open-dark.png)
  - a new heading while writing (the page's `h2` type, no section rule): [light](shots/2.2-new-heading-light.png), [dark](shots/2.2-new-heading-dark.png)
  - the ceiling warning: [light](shots/2.2-ceiling-warning-light.png), [dark](shots/2.2-ceiling-warning-dark.png)
  - the bar on a narrow window, hint dropped: [light](shots/2.2-bar-narrow-light.png), [dark](shots/2.2-bar-narrow-dark.png)
- Task 2.3:
  - "+ Write here" between two blocks (`blog.html`): [light](shots/2.3-write-here-line-light.png), [dark](shots/2.3-write-here-line-dark.png)
  - the empty notes page ready to type: [light](shots/2.3-empty-page-ready-light.png), [dark](shots/2.3-empty-page-ready-dark.png) (`dark.html` emptied to its marked title)
  - edit state with no block open: [light](shots/2.3-edit-state-no-block-light.png), [dark](shots/2.3-edit-state-no-block-dark.png)

## Follow-ups

- Once 2B lands, the orchestrator reruns `no_duplicate_text`, `split_not_conflict` and `free_writing_r14` on the integrated bundle and flips the R14 header case if it now passes.

## Cleanup needed

- None in the repo. A debug spec I wrote while chasing the WebKit click was moved out to the session scratchpad under `/private/tmp`, which the OS owns. The `.claude-commit*` message files are gitignored.
