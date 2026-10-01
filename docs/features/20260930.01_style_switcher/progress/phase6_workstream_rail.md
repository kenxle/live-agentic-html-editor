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

## To delete at cleanup

- `test-results/` in the worktree, from the spec runs
- Scratch helpers in the session scratchpad under `/private/tmp`, which the OS clears: `build_with_planned.js`, `unplan_preload.js`, `edit1.py`, and the `shots/` folder
