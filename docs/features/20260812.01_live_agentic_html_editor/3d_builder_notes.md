# 3D builder notes: the Edits tab

Branch `task/3d`, worktree `../lahe-worktrees/3d`, cut after CP2.

## What it is

`src/layer/tab_edits.js` fills the rail's Edits pane: every hand edit as a
before-and-after row, kept apart from the comment thread, newest first, updated
in place, with a list-export button that goes through 3C's pinned
`exportRecords` seam.

The rail already routes a record to a pane by kind (`overlay.js`'s
`paneForItem` sends `edit`, `delete` and `format_only` to the Edits tab), so this
file never re-decides the separation. What it owns is what a row says.

Three kinds, three readings:

| kind | the row |
| --- | --- |
| `edit` | before struck through and muted, after in the reviewer's words, one accent rule down the left |
| `delete` | before struck through, then the word "Deleted" in italics, so a deletion never reads as an edit into nothing (R27) |
| `format_only` | the words ONCE, because they did not change, plus a line naming what changed in the markup, for example `added <strong>` (R31) |

The structural line is computed from `normalize.structureOf` on both sides, so it
names only what the format-only comparison can actually see. A `<div>` wrapper is
not a structural tag, so wrapping a block does not get reported as "added
`<div>`"; it reports "the markup changed". There is a unit test on exactly that.

Design: the pane's own tokens. The tab lives inside the rail's closed shadow
root, so `:host`'s custom properties (`--ink`, `--ink-faint`, `--accent`,
`--line`) inherit into it and the rows cannot drift from 1B's chrome. One
stylesheet, appended into the pane itself: a `<style>` anywhere in a shadow tree
styles the whole tree, so this needed no change to `overlay.js` and adds nothing
to the page. Verified by eye in light and dark.

## The laws it keeps

- **No rebuild.** Rows are created once, updated where they are, removed only
  when the record is gone. Newest first is `flex order` set on the card the rail
  already built, never a re-append: re-parenting a node blurs anything focused
  inside it, which is the revert mechanism the rail's law exists to stop.
- **One formatter.** This file formats nothing for export. The button calls
  `exportRecords(records, options)`, which renders through the frozen
  `shared/review_format.js`.
- **The export module is resolved lazily.** `export.js` loads AFTER this file in
  the bundle (`manifest.js` pins the order), so a reference captured at factory
  time would be undefined even once 3C lands. It is looked up on every paint and
  every click. With no module on the page the button renders disabled and its
  title says the export is arriving; it never throws and never no-ops silently.

## What the stitch has to finish

1. **Delete the stub, keep the seam.** `test/browser/support/export_stub.js` is a
   one-file stub of the pinned API that calls the real frozen formatter. When
   `src/layer/export.js` lands, drop the stub's `installExportStub(page)` call
   from `test/browser/edits_tab.spec.js` and the spec runs against the real
   module unchanged. The button's own code does not change: it already asks the
   namespace for `LAHE.export`.
2. **Delivery.** `exportList()` returns the text and stops there. The clipboard
   grant and the download path are `copyReview()` and `exportReview()`, whose
   signatures are 3C's; nothing here calls them, because guessing an argument
   list is how two builders ship two contracts. One line at the stitch hands the
   returned text to 3C's delivery action.
3. **A cross-task defect this branch cannot fix (1D's file).**
   `comments.outstanding()` returns every record that is not handled, hand edits
   included, so `tab_active.js` builds a comment row for each hand edit and
   attaches it INTO the edit's card. Every edit card in the Edits tab therefore
   carries "Empty draft" and a Reword/Delete pair under the before-and-after row.
   That is half of R32 broken, and it is visible in any screenshot of the tab.
   The fix is one filter in `src/layer/tab_active.js` (1D's): only kinds
   `comment` and `note`. A written test is waiting for it, marked `test.fixme` so
   it reports instead of failing a branch that cannot land the fix:
   `test/browser/edits_tab.spec.js`, "a hand edit's card carries no
   comment-thread row".

## The one pre-authorized manifest edit

`src/shared/manifest.js`: `src/layer/tab_edits.js` lost its `planned: true`, in
the same commit as the file. Nothing else in that file changed.

## The wiring in index.js

Boot creates the Edits tab the way it creates the Active one: inside the rail's
own pane, from `rail.tabBody(TAB.EDITS)`. It is created after the edit surface
because it subscribes to `editing.onChange`, so a hand edit becomes a row on the
same act that writes the record. It is unmounted and rebuilt in `ensureRoot`'s
rebuild path beside the Active tab, unmounted in `teardown`, and readable off the
boot handle as `editsTab()`.

## The done bar, and how it is measured

`test/browser/edits_tab.spec.js`, a real session in a real browser on
`test/fixtures/edits-tab-doc.html`: four typed edits through Cmd-Shift-E, one
delete, one bold (the formatting-only change), and one real comment through the
real comment surface, because "kept apart from the comment thread" cannot be
measured against a thread with nothing in it.

It asserts six hand-edit records, six rows, the newest at the top, a deletion row
that reads as a deletion, a formatting-only row whose two sides carry the same
words plus a structural line, no edit row anywhere in the Active pane, the rail's
own Active count at one (the comment) and Edits count at six, and the list going
through `exportRecords` once with exactly the six hand edits and no comment.

## The demonstrated failure

The rule is a test that fails without the behavior, demonstrated rather than
asserted. One line, reverting the separation by rendering each edit row into the
Active thread as well:

```diff
--- a/src/layer/tab_edits.js
+++ b/src/layer/tab_edits.js
@@ refresh()
         updateRow(rows[id], item);
+        rail.tabBody(overlayModule.TAB.ACTIVE).appendChild(rows[id].cloneNode(true)); // DELIBERATE REVERT
```

```
Running 2 tests using 2 workers

  ✓  1 [chromium] › edits_tab.spec.js:184:3 › with no export module on the page, the button says so instead of failing quietly (574ms)
  ✘  2 [chromium] › edits_tab.spec.js:111:3 › six hand edits become six before-and-after rows, apart from the thread, and they export (1.9s)

  1) six hand edits become six before-and-after rows, apart from the thread, and they export

    Error: no edit row in the Active pane

    expect(received).toEqual(expected) // deep equality

    - Expected  -    1
    + Received  + 1582

    - Array []
    + Array [
    +   Object {
    +     "id": "itm_ea39e694d9ee9a84273cfb56",
    +     "kind": "edit",
    +     "text": "The trainer writes the plan every week.",
    +   },
    ...
```

The line was reverted and the spec is green again.

## Gate

`npm run gate:builder`, run synchronously in this worktree:

```
lint passed (syntax: 145 files, no jsdom, manifest complete)
# tests 340
# pass 340
# fail 0
# skipped 0
  2 skipped
  129 passed (21.3s)
```

The two skips are the `test.fixme` above and one pre-existing skip. `dist/` was
rebuilt locally for the browser lane and is NOT staged in any commit on this
branch.

## Cleanup needed (Phase 4B batch, nothing deleted here)

- `test/browser/support/export_stub.js` — the stub of 3C's pinned API. Delete
  once `src/layer/export.js` is in the bundle and the spec's
  `installExportStub(page)` call is gone.
- `test/unit/consumer_3d_edits_tab.test.js` — 0A-kernel's throwaway consumer
  stub, already on the batch by its own header, and now genuinely superseded:
  3D has landed.
