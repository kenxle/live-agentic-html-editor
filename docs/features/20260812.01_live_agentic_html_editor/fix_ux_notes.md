# Two reviewer-facing UX fixes, from the 2026-08-14 real-browser walks

Branch `task/fix-ux`. One commit per bug, each with its failing-then-green run pasted
below and a real click-through of my own.

---

## Bug 1: R28 had no button (every edit can be undone on its own)

**One line:** every hand-edit row in the Edits tab now carries its own Undo, in the
rail's card-action register, and a refused undo says why on the row.

The walker enumerated every button in the rail and found Reword and Delete on comment
cards, Export edits, Copy, Export and Review here instead. No Undo anywhere.
`editing.undo(id)` worked perfectly and was reachable only from the console, so R28
("every edit can be undone on its own") was a capability the reviewer could not use.

### What changed

`src/layer/tab_edits.js` only:

- Each row (`edit`, `format_only`, `delete`) gets a `.cardacts` foot with one
  `.cardact.cardact--quiet` button labelled Undo, the same register Reword and Delete
  wear on a comment card in `tab_active.js`.
- The click calls `editing.undo(id)`, which reverts that record's region and retires
  the record. The row leaves the tab on the refresh the tab already does in place.
- `editing.undo` returns `{reverted, kind, reason}`. A `reverted: false` writes the
  reason onto the row in the rail's warning color, under the before-and-after. It
  never fails quietly.
- Without an editing surface the button renders disabled and its title says why,
  matching how the Export edits button already handles a missing module.

The spec's readers (`undoButtonInfo`, `rowFailure`, `showEditsTab`, page and replay
readers) went into `test/fixtures/assets/edits-tab-boot.js`. `undoButtonInfo` scrolls
the button into view before measuring, because the pane scrolls and the third row sits
below the fold: the first run of the delete test clicked a point the mouse could not
reach, which is the same thing a reviewer would hit.

### Failing first

`test/browser/edits_undo_rows.spec.js`, against the code before the fix:

```
Running 3 tests using 3 workers

  ✘  3 edits_undo_rows.spec.js:199 › an undo that cannot revert says so on the row instead of failing quietly (699ms)
  ✘  2 edits_undo_rows.spec.js:168 › undoing one edit restores its wording and leaves the other rows alone (727ms)
  ✘  1 edits_undo_rows.spec.js:116 › every hand-edit row offers Undo, and undoing the delete puts the block back for good (734ms)

  1) every hand-edit row offers Undo, and undoing the delete puts the block back for good

    Error: an Undo button on the edit row

    expect(received).toBeTruthy()

    Received: null

      131 |     for (const kind of ["edit", "format_only", "delete"]) {
      132 |       const info = await page.evaluate((id) => window.__laheEdits.undoButtonInfo(id), rows[kind].id);
    > 133 |       expect(info, "an Undo button on the " + kind + " row").toBeTruthy();

  3 failed
```

### Green after

```
Running 3 tests using 3 workers

  ✓  1 edits_undo_rows.spec.js:199 › an undo that cannot revert says so on the row instead of failing quietly (710ms)
  ✓  3 edits_undo_rows.spec.js:168 › undoing one edit restores its wording and leaves the other rows alone (749ms)
  ✓  2 edits_undo_rows.spec.js:116 › every hand-edit row offers Undo, and undoing the delete puts the block back for good (779ms)

  3 passed (1.3s)
```

Gate (`npm run gate:builder`) tail:

```
  1 skipped
  157 passed (31.2s)
```

### My own click-through

A real Chromium window, the real boot, a session of one edit, one formatting-only
change and one delete, and real mouse clicks at the buttons' on-screen geometry:

- `fix_ux_shots/01_edits_tab_with_undo.png` — three rows, each with its own Undo.
- `fix_ux_shots/02_after_undo_delete.png` — the deleted paragraph is back between
  "The plan is three pages long." and "Warm up for ten minutes...", and the row is gone
  from the tab (3 hand edits became 2).
- `fix_ux_shots/03_undo_refused_says_why.png` — with the region taken off the page under
  the reviewer, the row says "Could not undo this: the region this record points at is
  not on the page" and the record is kept.

Console from the same walk:

```
gone is back: This paragraph exists to be deleted.
rows left: format_only, edit
refusal on the row: Could not undo this: the region this record points at is not on the page
```
