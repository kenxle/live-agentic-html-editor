# The selection popover

Ken, from real use: "when i highlight things, i no longer get the button popup with the comment button.
that was actually nice. after highlighting could have 'comment' and 'edit' buttons and tool tips that pop
up with their hotkeys."

The hotkeys are untouched. This is the affordance on top of them.

Branch: `task/feat-popover`. Files changed: `src/layer/comments.js`, plus the new
`test/browser/selection_popover.spec.js` and this note.

## What it does

When a selection settles on the page (selectionchange, debounced 150ms, non-collapsed, not inside the
library's own surface, not inside a block already in edit state), a small pill appears near the end of the
selection with two buttons: **Comment** and **Edit**. Hovering either one shows a keycap tooltip: ⌘⇧C and
⌘⇧E on macOS, Ctrl/Shift elsewhere.

Comment runs this file's own `commentOnSelection`, the exact path Cmd-Shift-C takes. Edit dispatches a real
Cmd-Shift-E keydown on the document, so the editing surface's one handler and the one gesture table decide
it. There is no second way into edit state to keep in step (comments.js holds no reference to the editing
surface, and giving it one would have meant a second instance or a new seam through index.js).

The pill goes away on: selection collapse, Esc (the selection is kept), scroll, entering pick mode,
opening any box, and unbind.

## The design calls

**Placement.** The end of the selection, not its middle: that is where the pointer finished. Above it by
8px when there is room, below when there is not, and the placement is on the node as `data-lahe-placement`
so the tooltip can flip with it. Horizontally centred on the selection's end, clamped to the viewport and
clear of the rail with the same `RAIL_ALLOWANCE` the comment box uses, so the pill is never drawn under the
rail.

**Tooltip treatment.** A styled custom tooltip, not a `title`. Two reasons. A native tooltip waits about a
second, arrives in the OS's font, and lands wherever the OS puts it, which reads as an unfinished control
on a surface this deliberate. And a `title` on top of a custom tooltip shows *both* bubbles, which is worse
than either. The keystroke is still on the button for a screen reader, as `aria-label`
("Comment on this selection (⌘⇧C)"), so nothing is hover-only for a keyboard user. The tooltip's keycap
rule is the rail's keycap rule value for value (`#eef0f4` / `#e2e5eb` / bottom border 2px / 11px 600), so
the two read as one product.

**The register.** White pill, hairline border, the rail's shadow, one hairline separator between the two
buttons, hover in the one accent (`rgba(60,86,165,.10)` / `#2c3f7d`). The dark variants come off the same
`:host([data-lahe-scheme='dark'])` switch the box and the edit bar already use, so the page picks the
scheme, not the OS.

**The mousedown.** `preventDefault` on the buttons' mousedown, and it is the whole reason the buttons work:
without it the press collapses the selection before the gesture that needs the selection can run.

## Two things worth carrying forward

**The pill is re-derived on bind, not left to the next event.** First cut lost the pill permanently on the
app fixture's morphing page: the morph remounts, `bind()` unbinds and rebinds the comments group, the pill
went with it, and selectionchange had already happened and was never going to happen again. The reviewer's
selection survives a morph, so the pill has to. `bind()` now ends with `schedulePopover()`, which re-reads
the selection. Pinned by the remount test.

**Read-only comes for free from the group.** The listener lives in `listeners.GROUP.COMMENTS`, which
`index.js` unbinds when a window is refused, so a refused window cannot even schedule a pill. The test
proves that structurally (`listenerCount("comments") === 0`) rather than by waiting a while, which also
keeps the no-arbitrary-sleeps gate green.

## Tests

`test/browser/selection_popover.spec.js`, seven tests: the pill's geometry and tooltip, a real mouse click
on Comment landing a ready record, a real click on Edit entering edit state on the containing block, the
collapse and Esc paths, the page-identical law with no selection (ranked test 18's shape, clipped left of
the rail, not a weakened version), the remount, and the refused window (two contexts, real boot, real
button, and a real comment through the pill after the takeover).

### Failing first

```
6 failed
  [chromium] › selection_popover.spec.js:152 › finishing a selection shows a pill with Comment and Edit
  [chromium] › selection_popover.spec.js:207 › a real click on Comment ... lands a ready record
  [chromium] › selection_popover.spec.js:246 › a real click on Edit puts the block into edit state
  [chromium] › selection_popover.spec.js:277 › collapsing the selection hides the pill
  [chromium] › selection_popover.spec.js:299 › with nothing selected the page renders identically
  [chromium] › selection_popover.spec.js:422 › a refused window never shows the pill
```

Every one of them on `TypeError: window.__lahe.comments.selectionPopover is not a function`.

### Green

`npm run gate:builder`: **172 passed, 1 skipped** (lint, 379 unit assertions, the whole Chromium browser
suite).

Three lanes, `LAHE_ALL_BROWSERS=1` over `selection_popover`, `comments_highlights`, `takeover_walk`,
`cp2_walk`: **54 passed**, chromium + firefox + webkit.

### Verified by hand

Real browser, real clicks, screenshots read back:
`pill-light.png`, `tooltip-light.png`, `box-light.png`, `edit-light.png`, and the dark set, in the session
scratchpad at
`/private/tmp/claude-501/-Users-kennethstclair-Documents-workspace-steady-thread/de40dd25-653f-4221-9145-33d2c0d7b7d1/scratchpad/popover/`.

One thing the screenshots caught: under Playwright's `devices["Desktop Chrome"]` the tooltip renders
"Ctrl Shift C", because that device emulation ships a Windows user-agent and UA-CH answers "Windows". On a
plain Chromium on this machine it renders ⌘⇧C. Not a bug, but worth knowing before someone reads a CI
screenshot and files one.

## Cleanup needed

Nothing in the repo. `dist/lahe-layer.js` was rebuilt locally to run the app-fixture specs and is
deliberately left uncommitted.
