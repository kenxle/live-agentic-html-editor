# Phase 7, fix H3: "+ Write here" never outlives its edit

Summary: the "+ Write here" line now shows only while an edit is open and the pointer is in a gap. When edit state ends, the line is taken out of the layer's shadow root, not just hidden. While it shows, it follows its block, so a scroll or a growing paragraph no longer leaves it over text. The new spec has 14 tests. 11 failed before the change, and all 14 pass now in Chromium, Firefox and WebKit.

Ken's reports:

- On a notes page, a leftover line floated beside a list with no edit open (`leftover-write-here.png`).
- On a blog-draft review, the line floated over the middle of a paragraph he had just typed into (`leftover-write-here-2.png`).

## Cause

The line was hidden in one place only: the mousemove handler. That handler returned early when no edit was open. So any way an edit ended without the pointer moving left the line on screen:

- Esc
- a click outside
- the window losing focus
- a click on another block
- a new sitting opened with Cmd-Shift-E

Leaving edit state hid the line but kept its node.

Three more gaps:

- The line is fixed to the window. Nothing redrew it when the page moved under a still pointer, so a scroll, a paragraph wrapping onto more lines, or a block the page rewrote left it over text. This is Ken's second screenshot.
- Moving the pointer onto the rail returned early too, so the line stayed up.
- The pointer leaving the window never hid it.

The rebuild's reload itself was not a cause: a full reload starts with no line. Ken's first screenshot comes from a sitting he opened after the rebuild and then ended with Esc, with the pointer resting in the gap.

## Fix

All in `src/layer/editing.js`:

| Part | What it does |
| --- | --- |
| `removeLine` | Hides the line, cancels its pending frame, and takes the node out of the shadow root. |
| `hideFrame` | Every way a session closes goes through it. With no edit open afterward, it calls `removeLine`. `leaveEditState` and `teardown` call it too. |
| Line watch | Runs once a frame, and only while the line shows. If edit state is gone, it removes the line. If the line's block moved (scroll, typing, a replay pass, a rebuild) or left the page, it places the line again from the pointer. That hides the line when the pointer is no longer in a gap. |
| Sticky rule | The line still stays put while the pointer is on it, but only while its block has not moved. |
| Pointer and focus | The pointer on the rail (anything in the layer but the line) hides the line. So does the pointer leaving the window (`mouseout` with no `relatedTarget`), focus moving into the rail (`focusin`), and the window losing focus (with or without a session). |
| Morph | A line node left in a replaced root is made again in the current root. |

## Tests

New spec: `test/browser/free_writing_line_lifecycle.spec.js`. It runs on real `lahe write` notes pages and `lahe review` pages, each with its own state folder and a free helper port from `lahe_world.js`. Each test reads the layer's shadow root and checks two things:

- no `.lahe-insert-line` node exists when no edit is open
- a showing line's rule never sits inside a block's box

| Test | Before the fix |
| --- | --- |
| Ken's case: list on a notes page, Esc with the pointer in the gap, scripted agent places it, rebuild reloads the page, then a second sitting in the list and Esc | failed (line left after the first Esc) |
| Esc from edit state with no block open | failed (hidden node left) |
| A click outside | failed (hidden node left) |
| Clicking from one block to another, then typing in the new block with the pointer in the gap below it | failed |
| Typing that grows the block under a still pointer | failed (line over the text) |
| A scroll under a still pointer | failed (line over the text) |
| The page rewriting the block under the line (a replay pass) | failed (line over the text) |
| Moving onto the rail, then pressing in it | failed (line stayed on the rail move) |
| The window losing focus | failed |
| The pointer leaving the gap, and leaving the window | failed (window case) |
| A new sitting on another block with Cmd-Shift-E | failed (line left after Esc) |
| Another window taking the review | passed (teardown already removed the node) |
| Screenshot, light and dark | passed |

One note on the block switch: in this build, a click on a block outside the open sitting commits the sitting and does not open the new block. A click on the block right under the sitting lands on the edit bar. The test accepts either outcome and checks the line after each step.

Results after the change:

- `free_writing_line_lifecycle.spec.js`: 14 passed in Chromium, 14 in Firefox, 14 in WebKit, each run by name.
- `free_writing_*` plus `f1_editing_fixes.spec.js` in Chromium: 202 passed, 1 failed. The failure is "the menu opens upward when there is no room below" in `free_writing_types.spec.js`. It also fails 3 of 3 with this fix taken out (the bundle built from HEAD), so it is already on the branch and not from this change. It is for the orchestrator.
- `npm run gate:unit`: 1797 passed, 0 failed, 2 todo.

## Commands

```
node scripts/build-layer.js
npx playwright test test/browser/free_writing_line_lifecycle.spec.js --project=chromium
npx playwright test test/browser/free_writing_line_lifecycle.spec.js --project=firefox
npx playwright test test/browser/free_writing_line_lifecycle.spec.js --project=webkit
npx playwright test test/browser/free_writing_ test/browser/f1_editing_fixes.spec.js --project=chromium
npx playwright test test/browser/free_writing_types.spec.js --project=chromium -g "opens upward" --repeat-each=3
LAHE_SHOTS_DIR=$PWD/docs/features/20260928.01_free_writing/progress/flow_fix_h3 npx playwright test test/browser/free_writing_line_lifecycle.spec.js --project=chromium -g screenshot
npm run gate:unit
```

`dist/lahe-layer.js` was rebuilt locally for the browser runs and is not committed.

## Screenshots

Ken's notes page after the agent placed the list and the rebuild reloaded it, with the pointer resting in the gap below the list. No line is drawn. Taken in the passing Chromium run. In `flow_fix_h3/`:

- `notes-after-rebuild-light.png`
- `notes-after-rebuild-dark.png`

## Cleanup needed

- `test/browser/tmp_h3_probe.spec.js`: probe I used to find the cause. It is emptied (no tests, no timers) and not committed.
- `node_modules` symlink in this worktree (not committed).
- `test-results/` folders from the Playwright runs in this worktree.
- Local change to `dist/lahe-layer.js` from the rebuild: restore with `git checkout -- dist/lahe-layer.js`.
- `editing.h3.js` in the session scratchpad: a copy of my `editing.js`, made while I checked the menu test against HEAD. It is under `/tmp`, so it needs no removal.
