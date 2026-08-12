# 2A builder notes: editing

Worktree `../lahe-worktrees/2a`, branch `task/2a`. Owns `src/layer/editing.js` and
ranked tests 7, 15, 16, 17.

## What this task is

One file and one promise: the reviewer puts one block into edit state on purpose, types in
it, and leaves. What they typed becomes a record, and leaving is the only thing that commits
it.

`src/layer/editing.js` was a stub whose one real decision was the formatting mechanism
(`execCommand`). That decision survives. Its Chromium-only reasoning does not (three engines
now), and its entry gesture is gone: click-to-edit fought the page for every click, which is
the inversion this design exists to remove. Entry is Cmd-Shift-E.

## The five rules the file is built around

They are at the top of the file too, because the next person to touch it will read the file
before they read this.

1. **`before` is pinned at first touch** and never recaptured. On a RE-ENTRY it comes off the
   record, never off the page: the page now says the reviewer's last committed wording, and
   capturing it there is exactly the drift R29 forbids.
2. **A commit is the reviewer LEAVING the region.** Esc, a click outside, navigation. Never
   the framework yanking the node: a repaint that destroys the focused block commits nothing
   (2B's domain), and a draft stays a draft.
3. **Exactly one commit per session.** `commit()` clears the session as its FIRST statement,
   before anything touches the DOM, and there is no blur handler in the file at all.
4. **`after` is never truncated and never cleaned up.** The text stored is the block's own
   text, raw. Normalization is a comparison rule and it happens in replay. The markup is the
   one exception and only in one direction: `cleanMarkup`, so nothing the library added can
   reach a record.
5. **Nothing the library draws is written to the page.** The frame is drawn in the closed
   shadow surface over the block's box. The only things this file puts on a reviewed element
   are the editing attributes, and they come off at commit.

## Decisions this task made that the plan left open

**A revision is a committed wording, not a keystroke.** Typing inside a session writes the
record on every input event (durable, synchronous) and leaves `rev` where it is. The commit
bumps it exactly once. The other reading (bump per keystroke, which is what the comment
surface does for a ready comment) turns one edit into forty revisions and makes every agent
reply stale on arrival. Ranked test 17 asserts rev 2 after two sessions, not rev 40.

**Entering a block and leaving it unchanged leaves no record.** A draft for a change that does
not exist is a row in the rail and a line in the agent's queue. The draft is still minted the
moment edit state opens (so the first keystroke is not the first durable thing) and is removed
again if nothing changed. A re-entry that changes nothing leaves the existing record alone.

**Deleting a block is a button on the frame.** The gesture table has no keystroke for it, and
a delete with no affordance is a delete nobody finds. The frame carries `B`, `I`,
`Delete block`, and the `Esc to finish` hint. Clicks inside the library's own overlay are the
overlay's per the gesture table, so pressing a button cannot commit the edit by accident, and
the bar refuses focus on `mousedown` so the caret the command applies to is still the
reviewer's.

**On the unload path the commit QUEUES and does not ask for an immediate flush.** This one
changed after a test failure and it is worth reading. `sync.recordItem(item, {immediate})`
schedules an ordinary `fetch` at 0ms. At unload that fetch races the document's teardown and
in Chromium it wins often enough that a body PAST the keepalive cap went out anyway. That is
delivery by the transport `protocol.js` says not to rely on, and it hides the cap. So the
unload commit queues the event (durable in browser storage, synchronously) and `onUnload`
makes exactly one attempt, the keepalive post, per `FLUSH.TRANSPORT_ON_UNLOAD`. Anything the
helper never acknowledged is re-posted by the next page load, which is what ranked test 7
measures.

## The design of the frame

Quiet, because the reviewer is reading their own sentence and not the tool.

- One accent, the rail's (`#3c56a5`, `#93a7ea` in dark), used for the outline and the label.
  A 1.5px border with a 4px wash-coloured ring around it and a background tint light enough
  that the page's own text stays the loudest thing inside the frame.
- The bar is a small white pill above the block: a 10.5px uppercase label, the two format
  buttons, `Delete block`, and the hint as real 12px text rather than fine print.
- **The bar is pinned by its BOTTOM edge**, so its own height never enters the position
  calculation. This is not decoration: measuring the height reads zero on the first frame in
  some engines, which puts the bar in one place and moves it a frame later. See the flake
  below.
- Light and dark both have their own tokens; the frame is drawn in the shadow root, so the
  page cannot restyle it and it cannot leak into the page.

## The demonstrated failure (ranked test 17, TDD)

The spec was written first, against a boot file that called an API that did not exist yet, and
watched to fail (`Cannot read properties of undefined (reading 'isEditing')`). Committed red
in `7c96e42` before any implementation.

The demonstration the plan asks for is the one-line revert. The realistic form of "`before`
drifts to the last committed state" is a re-entry that does not find the record the block
already has, so it mints a second one whose `before` is the wording the reviewer already
edited:

```diff
--- a/src/layer/editing.js
+++ b/src/layer/editing.js
@@ -430,7 +430,7 @@
 
       bootCommands();
 
-      var existing = itemFor(block);
+      var existing = null; // DELIBERATE REVERT
       var before;
       var item;
```

```
  ✘  3 [chromium] › test/browser/editing_before_pinned.spec.js:67:3 › two edit sessions on one
        block leave one record, one id, rev 2, and the original before (1.8s)

    Error: re-entering the same block rewords the SAME record

    expect(received).toHaveLength(expected)

    Expected length: 1
    Received length: 2
```

The second record in that failure output carries
`"before": "Runners come back too fast after a layoff. Most of them know it while they are
doing it."` — the reviewer's own first edit, presented to the agent as the source's wording.
That is the bug, exactly as the plan describes it: nothing on screen looks wrong. Reverted
immediately; the same run is three passes.

## Tests, and what each one would catch

| Ranked test | File | The bug it catches |
| --- | --- | --- |
| 17 | `test/browser/editing_before_pinned.spec.js` | `before` drifting to the last commit, and the blur double-commit bumping a second revision |
| 15 | `test/browser/editing_two_regions.spec.js` | Two neighbouring paragraphs merging into one record; a container made editable instead of a block |
| 16 | `test/browser/editing_undo.spec.js` | An undo that touches the other record, loses the caret, or lets a retired delete re-delete itself; a formatting-only change recorded as no change; library markup in a record |
| 7 | `test/browser/editing_navigation.spec.js` | An edit open at navigation that is stored but never delivered, and an oversize body that is silently lost |
| — | `test/unit/editing_surface.test.js` | The pure core: what counts as a change, the closed command list, what a capture keeps |

Two things in those specs worth knowing:

- **The oversize case cannot pass by accident.** The second page load is given NO credential,
  so it creates no sync client and nothing can drain the queue there. Whatever is on disk at
  that point got there on the unload path, and the assertion is that the ready event is not.
  Only the third load, which has a token, delivers it. Without that, "the oversize edit
  arrived" and "the cap was never hit" are the same passing test.
- **Ranked test 16's counter half is honest about what it proves today.** `replay.js` is 2C's
  and is still the kernel's stub with live counters. Five passes really run (`passes` moves by
  5) and `regionsWritten` stays flat, which is the assertion the plan asks for; it is not a
  claim that 2C's four-branch compare leaves an undone delete alone. 2C re-runs this spec.
- **IME is a manual check at 4A**, stated rather than faked. Composition events are deferred
  to `compositionend` in the code and there is no test driving them: composition is not
  reliably drivable from Playwright, and a test that drove it would be asserting the harness.
  4A types one composed string by hand and records the result.

## The one flake, seen once, and fixed rather than retried away

On the first three-lane run of my four specs:

```
  1 failed
    [webkit] › test/browser/editing_undo.spec.js:118:3 › undo a delete: the block comes back
    where it was and five replay passes leave it alone
```

It did not reproduce on a re-run, which is the moment to fix determinism rather than move on.
The cause is in the product code, not the test: the frame's bar was positioned by measuring
its own height, which reads zero before the first layout, so the bar landed in one place and
the animation-frame tick moved it a frame later. A click aimed between those two reads misses.
Fixed by pinning the bar by its bottom edge (no height in the calculation), plus a poll in the
test that waits for the button to be on screen before aiming at it. Seven three-lane runs
since, all green.

## Gate

`npm run gate:builder`, green:

```
lint passed (syntax: 124 files, no jsdom, manifest complete)
# tests 304
# pass 304
# fail 0
  96 passed (19.2s)
```

Ranked test 7 on all three lanes (`LAHE_ALL_BROWSERS=1 npx playwright test
test/browser/editing_navigation.spec.js`):

```
  ✓  4 [chromium] › an edit past the keepalive cap is absent at unload and present after the next load (790ms)
  ✓  6 [firefox]  › navigating with an edit open lands the record, once, with the final keystroke (1.8s)
  ✓  8 [webkit]   › an edit past the keepalive cap is absent at unload and present after the next load (2.7s)

  9 passed (4.7s)
```

All four editing specs on all three lanes: `39 passed`.

`dist/` was rebuilt locally to run the browser specs and is NOT committed, per the plan's dist
rule.

## What other tasks need from me, and what I need from them

- **2D (living in the page)**: `LAHE.editing.createEditing({store, reviewId, page, sync})`
  then `bind({page})`. It takes an optional `sync`; pass it and editing posts its own records
  (which is what makes the ordering at unload reliable), or leave it out and wire
  `onChange(item, event)` to `sync.recordItem` the way `cp1-boot.js` does for comments. Events
  emitted: `opened`, `typed`, `committed`, `discarded`, `deleted`, `undone`. Remount must call
  `teardown()` and re-`bind()`; every listener goes through the registry under the group
  `editing`.
- **1B (the rail) and 3D (the Edits tab)**: an edit record reaches the rail through
  `onChange`. Per-record undo is `editing.undo(itemId)`, which returns
  `{reverted, kind, reason}` and returns `reverted: false` with a reason rather than
  pretending, so the card can say why.
- **2B (protection)**: entering edit state calls `protect.mark(block, {reason: "edit"})` and
  committing calls `protect.release(block)`. The editing attributes (`contenteditable`,
  `spellcheck=false`, `autocorrect`, `autocapitalize`, `data-gramm`) are set by this file;
  the cooperative-skip attributes are `mark()`'s, which is 2B's half. **0B's warning is
  honored here**: nothing in this file commits on blur, so a repaint that destroys the focused
  block cannot be scored as the reviewer leaving.
- **2C (replay)**: `commit`, `deleteBlock` and `undo` each schedule a pass
  (`replay.schedule("commit")` / `"undo"`), queued in a microtask so the write epoch has
  closed first — a pass scheduled while the epoch is open is swallowed by design. Every DOM
  write in this file is inside `epoch.write`. `replay.js` loads after `editing.js`, so the
  module is resolved at call time rather than at load time.
- **Nothing was asked of a frozen file.** `selection.js` is read only (`blockFor`,
  `containsCaret`, `placeCaretAtStart`), `gestures.js` drives every decision, and
  `manifest.js` needed no change because `editing.js` already had a row.

## Files changed

```
src/layer/editing.js                        (rework: stub -> real surface)
test/browser/editing_before_pinned.spec.js  (new, ranked test 17)
test/browser/editing_two_regions.spec.js    (new, ranked test 15)
test/browser/editing_undo.spec.js           (new, ranked test 16)
test/browser/editing_navigation.spec.js     (new, ranked test 7)
test/unit/editing_surface.test.js           (new)
test/fixtures/editing-doc.html              (new fixture page)
test/fixtures/assets/editing-boot.js        (new boot for those specs)
```

Nobody else's file was touched.

## Cleanup needed

Nothing was deleted. For the Phase 4B batch:

- `test/unit/consumer_2a_editing.test.js` — 0A-kernel's throwaway consumer for this task. It
  was already on the batch and it still passes; 2A has landed, so it can go.
- `test/fixtures/assets/editing-boot.js` and `test/fixtures/editing-doc.html` — keep while the
  editing specs do. If 2D's `index.js` boot ends up covering the same wiring, the boot file is
  the half to cut, not the fixture page.
- `test-results/` and `playwright-report/` — Playwright output, already ignored.
