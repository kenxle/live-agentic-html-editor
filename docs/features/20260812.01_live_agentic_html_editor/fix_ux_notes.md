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

---

## Bug 2: one rewording was 29 revisions (a bump per keystroke)

**One line:** a rewording session is now one revision, bumped when the reword
commits, so an agent's reply at the revision it read is still accepted.

Rewording one sentence on the walk took rev from 1 to 29. `comments.js`'s `type()`
called `record.bumpRev` on every keystroke of a ready item. rev is the number an
agent's reply names, and a reply naming an older rev is refused as stale (R21), so a
racing rev refuses every reply the moment the reviewer touches the box: the protection
turns into reply-blocking noise. The contract (docs/CONTRACTS.md: "rev, monotonic and
bumped on every rewording"; drafts do not bump) reads a rewording as one act.

### What changed

`src/layer/comments.js` only:

- `type()` now writes content the same way for a draft and for a rewording in
  progress: the note moves, `updated_at` moves, rev does not. Keystrokes stay durable
  at once, which is unchanged.
- A new `flushReword()` is the end of a rewording session: if the note differs from
  what the box last committed, it calls `record.bumpRev` once, carrying the record as
  it stands. `markReady()` (Cmd-Enter) and `close()` (Esc, or the rail closing the box)
  both call it, and it is idempotent between them, so the two paths cannot double-bump.
- Typing a word and taking it back leaves rev alone: the words the agent reads did not
  change.
- The applied-after history is untouched by this: `bumpRev` appends only when the
  compared `after` moved, so a comment reword adds no history entry and the 28
  intermediates never existed as revisions. The walk confirms `after_history` is empty
  after the commit.

The wire needs nothing: drafts already flow with `draft: true` and idempotence is by
`event_id`, never by (item, rev), so repeated content events at one revision are
legitimate (`src/shared/protocol.js`).

Two existing tests asserted the old per-keystroke behaviour and were updated to the
contract, not around it: `test/unit/comments_surface.test.js` (now asserts typing does
not bump, the commit does, Esc commits too, and typing the same words back is not a
rewording) and `test/browser/comments_highlights.spec.js`. `agent_replies.spec.js`'s
`reword` helper now commits the way Cmd-Enter does.

### Failing first

`test/browser/reword_rev.spec.js`, against the code before the fix:

```
Running 1 test using 1 worker

  ✘  1 reword_rev.spec.js:123 › typing a reword does not race rev; the commit bumps it once, and the agent can answer it (1.7s)

    Error: an uncommitted rewording is content, not a revision: rev has not moved yet

    expect(received).toBe(expected) // Object.is equality

    Expected: 1
    Received: 50

      153 |         midway.rev,
      154 |         "an uncommitted rewording is content, not a revision: rev has not moved yet"
    > 155 |       ).toBe(revBefore);

  1 failed
```

Rev 50 off one reworded sentence, which is the walk's 1 -> 29 with a longer sentence.

### Green after

```
Running 1 test using 1 worker

  ✓  1 reword_rev.spec.js:123 › typing a reword does not race rev; the commit bumps it once, and the agent can answer it (2.2s)

  1 passed (2.7s)
```

Gate (`npm run gate:builder`), whole run, exit 0:

```
lint passed (syntax: 149 files, no jsdom, manifest complete)
# tests 364
# pass 364
# fail 0

  1 skipped
  158 passed (36.9s)
```

### My own click-through

A real Chromium window, the real app fixture, a real helper, and a real agent reply
appended to `replies-claude.jsonl`. The reword was made by clicking the card's own
Reword button and typing 48 characters by hand at 25ms a key:

```
after the first comment: rev 1
midway, 48 characters in: rev 1 | note: shorten this, and lead with the number of clients
after Cmd-Enter: rev 2 | note: shorten this, and lead with the number of clients
after_history entries: 0
review.json says rev 2 | note: shorten this, and lead with the number of clients
the reply at the committed rev was ACCEPTED
```

- `fix_ux_shots/04_reword_midway.png` — the box mid-sentence, the whole new wording
  already in the card, rev still 1.
- `fix_ux_shots/05_after_reword_commit.png` — committed at rev 2.
- `fix_ux_shots/06_agent_answer_accepted.png` — the agent's answer at rev 2 folded and
  the item in Done.
