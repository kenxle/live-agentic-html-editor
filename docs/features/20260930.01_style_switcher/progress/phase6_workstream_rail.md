# Phase 6, Rail workstream (Tasks 2.1 and 2.2)

**Summary.** The Document style panel works on a real review: it lists International Style and the installed styles, one click restyles the page with no reload, a preview survives the agent's rebuild, and "Ask the agent to use" sends one ready note and shows the waiting line until any reply. 16 browser tests pass on Chromium. The one Markdown end-to-end test waits for pull request A. Building this found a real bug in comment boxes, fixed in its own commit (see Needs a decision).

Branch `feat/style-switcher-rail`, off `feat/style-switcher` at `f2bdab5`.

## Needs a decision

- **Comment boxes were never placed beside their passage.** `comments.js` had two functions named `positionAt` in one scope. The later one, a text lookup added in `58157dc` on 2026-08-23, replaced the box placer. Since then every comment box has opened in the top-left corner of the window instead of beside its passage. I renamed the lookup to `segmentAt`, in its own commit (`89cab7d`). Boxes now open where the code always meant them to. `comments_highlights.spec.js` passes with the fix (12 of 12). The full browser suite has not run on it. It is a change people will see, so the orchestrator may want it as its own pull request.

## What was built

- `src/layer/style_switch.js` (new). It holds the rules (id, colour, name), the note's exact words, the marker and the waiting test, the storage key, and the panel's words for every state, as a pure `panelView`. The switch adds one chrome-marked link after the house style and disables the document's own style links. Only the latest pick applies. It keeps the reading block where it was and stores the preview per page. It puts a stored preview back on boot, or drops it when the document now carries that style. A link that fails to load clears the preview and says why.
- `src/layer/overlay.js`. "Document style" sits in the head menu just before "Hide for presenting". It shows only on a page that uses the house style, and the menu keys skip it when it is hidden. The panel sits under the head, below the overdue banner, on the end-review panel's surface. It uses `.refusal__btn` for "Ask the agent to use …" and `.endpanel__no` for Back and Close. The radio rows are updated in place by id, so an arrow key keeps its focus. The status line is `aria-live="polite"`. Esc and Close return focus to the menu button. `stylePanelInfo()` reports what the panel shows, for specs.
- `src/layer/comments.js`. `mintReadyNote(words, page)` stores a ready note with no box and emits "ready", the same path as `markReady`. `replaceOpenBoxes()` puts each open anchored box back beside its passage. Boxes the reviewer dragged stay put.
- `src/layer/index.js`. Boot restores the preview first, then the reading position. The panel is wired to the switch and to the note. Replies, note changes and SPA remounts repaint it. After a switch lands, open boxes are re-placed and the rail's light or dark scheme is read again.
- Fixtures: `test/fixtures/style-switch-doc.html` (a house-style page) and `test/fixtures/style-switch-own-css.html` (a page with its own CSS).
- `test/browser/support/style_fixtures.js` installs styles. With the service merged it runs `lahe style add` on `test/fixtures/styles/`. Before that, it writes the three served shapes beside the page.

## Tests

- `npm run gate:unit`: 2296 tests, 2294 pass, 0 fail, 2 todo. Lint passed.
- `test/unit/style_switch.test.js`: 19 pass.
- `test/browser/style_switcher.spec.js`: 16 of 16 pass on Chromium.
- `test/browser/style_switcher_keep.spec.js`: 1 skipped, with the reason "needs pull request A". It runs once the service half is on the branch.
- Specs touched by the menu change all pass with the planned file treated as built: `rail_menu`, `present_mode`, `end_review`, `card_collapse`, `copy_export` (19 tests). So do `comments_highlights` (12).

**Specs to re-run after pull request A merges.** Both switcher spec files. On this branch the styles are files beside the page. After the merge, the same helper installs them with `lahe style add`. The keep spec and the Markdown half of V8 only run then.

**Specs that fail on this branch until the planned mark goes.** Any spec that builds the bundle in memory from `manifest.builtFiles()` (`comments_highlights`, `selection_popover`, and others). `overlay.js` now needs `style_switch.js`, and the manifest still marks it planned. Once the orchestrator removes the mark, these build it in. I ran them with a local preload that does the same.

| Row | State |
| --- | --- |
| V8 | HTML page and own-CSS page pass. The rendered Markdown half is in the keep spec and waits for A. |
| V9 | Pass, including the 40-character name, which wraps |
| V10 | Pass: colour, font, no navigation, the open box, the highlight, the reading block, an edit's words and caret, and held arrows ending on the last pick |
| V11 | Pass |
| V12 | Pass, including the overdue banner above the status line |
| V13 | Pass |
| V14 | Pass |
| V15 | Pass |
| V16 | Pass |
| V18 | Pass |
| V19 | Screenshots below |
| V22, layer half | Pass |
| V23 | Written. Skipped until A merges. |
| V25, layer half | Pass |
| V26 | Pass |
| V27 | Pass |

## Screenshots

From the passing run, in `screens/`:

- `panel_open_previewing_light.png`, `panel_open_previewing_dark.png`
- `collapsed_line_light.png`, `collapsed_line_dark.png`
- `waiting_light.png`
- `missing_style_light.png`
- `nothing_installed_light.png`
- `long_name_light.png`
- `keyboard_focus_light.png`, `keyboard_focus_dark.png`
- `overdue_banner_with_status_light.png`
- `style_removed_light.png`

## Changes from plan

- **No change to `sync.js`.** The reading-position restore is called from `index.js`, not from `sync.js`. So the stored preview is put back in `index.js`, one line above that call. That gives the order the plan asked for.
- **The list is fetched once on boot when a preview came back with the page.** The architecture says boot does not fetch the list. Without it, the collapsed line after a reload says "Previewing sample" instead of "Previewing Sample". The fetch happens only when a preview is active, and after boot.
- **The collapsed line is a column, not a row.** Back beside the words left about 90 pixels for them, and "Previewing Sample" was cut off. The words now wrap rather than end in an ellipsis. The waiting sentence is long and has to be read whole.
- **Words the table did not cover:**
  - When nothing is previewed, the status line says "The document uses International Style." (or the style's name).
  - When the document's style is missing, the status line is empty, so it does not repeat the missing-style line.
  - The removed-style line, shown collapsed, gets a "Close" button that dismisses it.
  - A style removed before the page learned its name is named by its id, set as code.
- **The layer re-checks names too.** A list entry whose name fails the name rule is dropped, because the name goes into the note to the agent. The rule allows Unicode letters.
- **Shared rules.** `style_switch.js` has its own copies of the id pattern, the hex colour rule and the name rule. The coordinator says these move to `src/shared/style_rules.js`, and the orchestrator will switch them at the merge.
- **A spec-only hook.** `rail.clickStyleAsk()` presses the hidden primary button, to prove that a second press sends nothing. It works the same way as the existing `clickEnd`.

## Integration round (on `rail-integration`, from `b7796ec`)

- **Shared rules.** `style_switch.js` now takes the id, colour and name rules, and the house id and name, from `src/shared/style_rules.js`. The shared name rule allows the same characters as before, including Unicode letters, up to 40 characters. One difference: a name with a space at either end is now refused. No real style name has one.
- **Real server.** The stub fallback is gone. The specs install `test/fixtures/styles/sample` and `sample-dark` with `lahe style add`. Only V22 still routes a crafted list.
  - `style_switcher.spec.js`: 16 of 16 pass.
  - `style_switcher_keep.spec.js`: 1 of 1 passes. V23 and the Markdown half of V8 now run.
  - `comments_highlights.spec.js` and `rail_menu.spec.js`: 16 of 16 pass.
- **Task 2.3.** One contract instruction is added, word for word the same in four places: `review_format.js`, the restated copy in `review_format.test.js` (the count is now 62), `docs/CONTRACTS.md`, and a bullet in `skills/lahe/SKILL.md`. A new unit test checks that the instruction names each required part (V17). `npm run install-skills` has been run. The contract ships inside the bundle, so `dist/` needs a rebuild. That rebuild is the orchestrator's.
- `npm run gate:unit`: 2391 tests, 2389 pass, 0 fail, 2 todo.

## Fix round 1 (on `rail-fix1`, from `9af2c71`)

Each fix has a test. The new browser tests failed against the bundle from before the fix and pass after it. The one exception is the Markdown missing-style case, which is new coverage and already passed.

1. **A style removed during a live preview.** When the list loads and the previewed style is not in it, the switch ends the preview the way a failed load does: the link goes, the stored choice is cleared, and the removed line shows. `panelView` applies the same rule by itself, so a missing style never shows "Previewing" or the Ask button. A new browser test covers the case with no reload.
2. **One paint per pick.** A new preview link goes in beside the one on screen. The swap happens in the new link's `load` handler, before the browser paints: the new sheet goes on, and the document's links and the old preview go off. A failed load leaves the old preview on screen. A browser test holds the next stylesheet mid-load and checks the page still wears the old preview, never the house style.
3. **The latest pick wins, really tested.** The first stylesheet is held with `page.route`. The test picks `sample`, then `sample-dark`, then releases the first. It ends with `shown` = `sample-dark`, one preview link, and stored `sample-dark`. An overtaken pick's promise now settles at once with `{ok: false, superseded: true}`. The keyboard spec's comment now says two presses.
4. **Boot order.** Boot now waits for a restored preview to load, fail or be overtaken before it restores the reading position. The wait is capped at 1.5 seconds (`STYLE_RESTORE_WAIT_MS`). V11's tolerance is now 1 pixel, and it passes. It also passed at 1 pixel before the fix, so no test proves the wait itself.
5. **Waiting.** One browser test covers each way a request stops waiting: a question reply, a not handled reply, deleting the note, and rewording it. It then calls the ask handler directly (`handle.askForStyle("sample")`) while a request waits, and checks that no second note is made.
6. **V10 checks the font.** The test now checks that `Sample Face` is declared, loaded, and passes `document.fonts.check`.
7. **V15 on rendered Markdown.** A `.md` file with `lahe-style: foo` shows International Style and the missing-style line.
8. **The removed-style line** now reads "Sample is no longer installed, so the page is back to its own style." It uses the style's name whenever this page ever saw it in a list. If it never did, the open panel shows the id as code. The collapsed line is plain text, so it shows the bare id there, as in `style_removed_after_reload_light.png`. The Close button stays.

Counts:
- `npm run gate:unit`: 2392 tests, 2390 pass, 0 fail, 2 todo.
- Chromium: `style_switcher.spec.js`, `style_switcher_keep.spec.js` and `rail_menu.spec.js` together: 27 of 27 pass.

Screenshots: every one is retaken. Two are new: `style_removed_live_light.png` (the open panel after a live removal) and `style_removed_after_reload_light.png` (the reload case). `style_removed_light.png` is now the collapsed line after a live removal.

## Fix round 2 (on `rail-fix2`, from the flow walk on Ken's real styles)

1. **Going back leaves no empty block.**
   - `splitFrontmatter` in `src/service/markdown.js` now reads a block with nothing between its fences as frontmatter. A block of only blank lines is no longer shown as "Document metadata". So `---`/`---` left at the top of a file renders nothing.
   - The contract instruction now also says: in a Markdown file, remove the whole front matter block, fences too, when the style line was all it held. The new words are in all four copies, and the count stays 62. `npm run install-skills` has been run.
   - Tests: a unit test (four variants of an empty block), the V17 content check, and a going-back leg in the keep spec. In that leg the agent leaves the bare fences, and the page shows no rule, no metadata block and no `---`.
2. **The reading position in a long table.** The real cause was a sticky column head. A ledger-like style pins the table's head row to the top of the window. That head row was the first visible block, so the kept position followed it and the page landed rows away. The switch now asks the page which elements sit at the top of the window (`elementsFromPoint`). It anchors to the finest block found there: a table row, list item, paragraph or heading. It skips anything sticky or fixed. A browser test with an 80-row table and a made-up "Tall Rows" style with a sticky head failed by 2585 pixels before the fix. It now holds within 2 pixels.
3. **Going back has its own waiting line:** "Sent to the agent. Waiting for it to return this page to International Style."
4. **The line on reload.**
   - The stored preview now keeps the style's name beside its id, as JSON. An older stored value that is a bare id still reads.
   - A reloaded preview is named from its first frame. If no name was ever stored, no line shows until the list answers.
   - A browser test records every status line from the first animation frame of the reload. It saw "Previewing sample" before the fix and now sees only "Previewing Sample".
   - **The house-style flash on reload stays.** The preview link cannot go in earlier than it does. The layer is one script at the end of the body (D1), and putting the preview back is already the first thing boot does. An earlier link would need a script in the page's head, or the page server writing the link in as it serves the page. The architecture rejects the second option: the file on disk would no longer match what the reviewer sees. The roughly 40 ms left is the body being read plus the stylesheet's fetch.

Counts:
- `npm run gate:unit`: 2396 tests, 2394 pass, 0 fail, 2 todo.
- Chromium:
  - `style_switcher.spec.js`: 25 of 25 pass.
  - `style_switcher_keep.spec.js`: 1 of 1 passes.
  - `markdown_style_file.spec.js`: 2 of 2 pass.
  - `rail_menu.spec.js`: 4 of 4 pass.

Screenshots: every one is retaken. `waiting_back_light.png` is new.

## To delete at cleanup

- `test-results/` in the worktree, from the spec runs
- Scratch helpers in the session scratchpad under `/private/tmp`, which the OS clears: `build_with_planned.js`, `unplan_preload.js`, `edit1.py`, and the `shots/` folder
