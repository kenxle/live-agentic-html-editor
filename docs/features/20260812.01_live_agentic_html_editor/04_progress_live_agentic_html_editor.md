# Progress: live agentic HTML editor

Running record of what each phase and checkpoint actually did, newest section at the foot.

## CP1 integration

Branch `feat/live_agentic_html_editor`, in the main checkout. All four Phase 1 branches were already
merged and the gate was already green; this pass closed the seams the four parallel builders left named
in their notes, and wrote CP1 as a checked-in spec.

### Seam 1: the rail specs now run against the real helper

1B wrote `rail_durability`, `rail_status` and `rail_second_window` against
`test/fixtures/servers/protocol-service.js`, because 1A's helper had not landed. All three now take
`SERVICE_ENTRY` from `test/helpers/service.js`, which is `src/service/index.js`.

Three differences surfaced, which is what CP1 is for.

1. **The helper's port is fixed and the stand-in's was ephemeral.** 7817 is the product's promise to a
   page with the port baked into its script tag, so it is right; parallel specs would collide on it.
   Every spec that does not pin a port now starts the helper with `--port 0` and reads the real port
   out of `service.json`. The two restart cases keep pinning the original port through `LAHE_PORT`,
   because the page they left behind is still pointing at it.

2. **The second window was not refused at all.** The stand-in answered a refused window claim with
   `protocol.errorBody("PROTO_SECOND_WINDOW", ...)`; the real helper answers with the shape
   `protocol.js`'s route table actually names, `{granted, holder, since, heartbeat_seconds}` plus a
   reason, at 409. 1B's sync client only read the error-body form, so a real refusal read as a grant
   and two windows both thought they held the review. Fixed on the client, because the helper is the
   one following the contract: `claimWithHelper` now treats `granted === false` as the refusal and
   keeps the error-code form as a second reading. The reason the reviewer sees is the helper's own
   sentence, which names the window holding the review and how long it has held it.

3. **The real helper writes `review.created` and `origin.registered` into the same log.** The draft
   test polled for "the log has a line in it", which is true before the draft arrives. It polls for
   the draft itself now. That one was latent flake rather than a bug.

`test/fixtures/servers/protocol-service.js` is left in place, on the cleanup list.

### Seam 2: one shadow host, not two

1D's `highlight.js` created a closed shadow host with id `lahe-surface-root`; 1B's `overlay.js` created
its own host for the rail; `markers.OVERLAY_ROOT_ID` was `lahe-overlay-root`, which nothing created.
Three ideas of one thing.

The ruling, implemented: there is ONE page-level element, `highlight.js`'s surface module owns it, and
its id is `markers.OVERLAY_ROOT_ID`. The constant's value became `lahe-surface-root` (the name reality
already used, in 1D's specs and in D8's prose) and `highlight.js` reads its id from the constant rather
than spelling it a second time.

- `overlay.mount()` asks the surface module for the root and mounts inside it. It adds nothing to the
  page now. It puts its own scope element in that root and attaches a closed root to that, so the
  rail's `:host{all:initial}` and its design tokens apply to the rail and not to the shared host it
  does not own. `unmount()` removes the rail's scope element and leaves the page-level host alone,
  which is the host 2D's remount contract re-creates.
- `comments.js` defaults to the shared highlight instance on the real document, for the same reason: a
  second instance would have been a second host.
- `highlight.surface()` fails loud if a host with that id is already in the page, naming the rule. A
  second host is undiagnosable from outside a closed root, so it must not be able to happen quietly.
- The rail and the pill set `pointer-events: auto`, because the shared host is `pointer-events: none`
  so the page stays clickable through it.

### Seam 3: 1D's overlay asks

- **`overlay.attachCardNode(id, node)`** puts a tab owner's node inside the card's body. That is what
  makes `holdsFocus(id)` able to be true for contents a tab file rendered: before this, `tab_active.js`
  kept the rail's model in sync while rendering its rows somewhere else, so the rail held no node and
  the guard that stops a focused card being removed could never fire. The law holds inside the new
  call: a node already in the card is left where it is, nothing is moved into a card that currently
  holds focus, and attached nodes are re-appended when a remount rebuilds the card.
- **`createActiveTab({host})`** is wired. With a host, `tab_active.js` draws the tab's CONTENTS only:
  no panel of its own, no head, no pill, no counts, no `PANEL_STYLE`. Its rows go inside the rail's own
  cards, and the untethered-note box sits at the foot of the Active pane, kept last by flex `order`
  rather than by re-appending it, because re-appending would re-parent a box the reviewer may be typing
  in. `collapse`, `isCollapsed` and `bounds` delegate to the rail when the rail is the panel. The
  standalone fallback is untouched, which is what keeps ranked test 18 scoring 1D on its own.
- **Rewording happens inside the card.** `comments.reopen(id, {host, placement})` takes a host now, and
  the hosted Reword button passes the card's body. So the box the reviewer types into is really inside
  the card, which is the whole point of the ask.

### CP1 as a spec

`test/browser/cp1_walk.spec.js`, three tests, all three browsers.

1. **The walk.** The helper creates the review and mints its token (the real mint path, 1A's
   `reviews.create`), and the page is handed that token. The fixture is
   `test/fixtures/cp1-doc.html`: `built-doc.html` byte for byte with one script tag for the built
   bundle and one for `test/fixtures/assets/cp1-boot.js`, which wires the four pieces the way 2D's
   `index.js` will. It is a copy rather than an edit because `built-doc.html` is the anchor engine's
   corpus and other specs load it deliberately WITHOUT the library.

   Three comments and one untethered note through real gestures: a selection plus Cmd-Shift-C twice,
   element-pick (Cmd-Shift-C with nothing selected, hover, click) once, and a mouse click into the note
   box at the foot of the rail. The rail is in a closed shadow root, so the spec asks the library where
   the box is and clicks the real pixels. Then `kill -9`, a fourth comment against a dead helper, a
   restart on the same port and state directory, and all five records in `events.jsonl` exactly once
   with the reviewer's text compared byte for byte (`Buffer.compare`), asserted through
   `test/helpers/service.js`'s readers. The token survived the restart; `seq` is monotonic across it.

2. **The anchor step.** With a comment placed on `#intro`, the live DOM is mutated around it (a
   paragraph inserted above, the region wrapped in a div, a neighbour's whitespace rewritten) and
   `resolve` still returns the same node. Then the region is deleted and the failure is the honest one:
   not bound, no element, `ANCHOR_NO_TEXT_MATCH`, and the reviewer's words untouched.

3. **The seam this checkpoint closed.** The Reword button is clicked, the card holds focus, and the
   card node the reviewer is typing into is the same node after a sentence of typing.

No arbitrary sleeps: every wait is `pollUntil` or `pollPage` on a named condition.

### Gate

- `npm run gate` green (lint, `check:layer`, 293 unit tests, 83 browser tests on Chromium).
- `npm run gate:all` green: 249 browser tests across Chromium, Firefox and WebKit.
- `cp1_walk.spec.js` on all three browsers: 9 passed.
- `dist/lahe-layer.js` was rebuilt and committed, which is the orchestrator's job at a checkpoint.

### Cleanup needed

Nothing was deleted. For the Phase 4B batch:

- `test/fixtures/servers/protocol-service.js` — the stand-in helper. Nothing points at it now.
- `test/fixtures/servers/stub-service.js` — speaks the archived send model's route; nothing points at
  it either.
- `test-results/` — Playwright artifacts from the failing runs during this pass. Gitignored.
- `.claude-commit202608121340`, `.claude-commit202608121712` in the repo root — earlier sessions'
  commit-message scratch files. Gitignored.

## CP2-mid: 2A's records meet 2B and 2C

The plan's short checkpoint in the middle of Phase 2: merge 2A, 2B and 2C only, and run ranked test 2
(human and agent edit at once) end to end with **real** edit records instead of the fixture generator,
before 2D merges. It earned its place. The seam between real records and replay was broken in three
places, and none of the three builders could have seen it from inside their own task.

### What was broken, and what it took to close each one

**1. The commit pass never ran. (The big one.)**

2B's `release()` calls `replay.schedule(COMMIT, {immediate: true})`, and `schedule` refuses while the
write epoch is open, by design, because replay's own writes must not schedule replay. `epoch.write`
closes on a MICROTASK, not when its function returns, so a caller that just wrote to the DOM is still
inside a write epoch for the rest of the synchronous turn. 2A's commit takes `contenteditable` back off
(a write) and releases protection in the same turn. So every real commit was refused: protection lifted,
no pass ran, and a change the page made to the block underneath the reviewer was swallowed exactly as if
the seam had never been wired.

Nobody could see it before this checkpoint. 2B's specs call `release()` straight, with no epoch open, and
pass. 2A's specs scheduled their own pass from a microtask afterwards, which hid it from that side too.
It took the two real surfaces on one page.

Closed in `protect.js`: `release()` runs the commit pass through `runCommitPass`, which queues a
microtask when the epoch is open. The epoch's own close is queued as one, so ours runs immediately after
it, still in the same task and still before anything paints.

**2. A change the page made to a protected block was destroyed without trace.**

Layer three restores the reviewer's words over whatever the page wrote. That is its job, and it is also
the only moment a page's change to a protected block is readable anywhere. Thrown away, an agent that
rewrote that very block is swallowed silently: the reviewer commits, the page holds their own words,
replay compares their words against their words, reads branch one, and nothing ever tells them the
source moved.

Closed on both sides. `protect.restore()` keeps what the page tried to say (`displacedChange()`), and
`release()` hands it to the commit pass as `{item, element, observed}`. `replay.applyRecord` compares the
record against that observation and, when it is neither the reviewer's version nor any version this
record has had, flags branch four: the badge, the card carrying BOTH versions in full, nothing written.
It only ever flags; a value that is not on the page is never a reason to write to the page, so every
other branch falls through to the DOM compare that a write is actually decided on.

One rule came out of watching it: a conflict raised this way is **not cleared by an ordinary pass**. The
page holds the reviewer's words (protection put them there), so the next pass reads branch one and would
clear a warning the reviewer has not answered yet, usually within a frame of it appearing. It clears when
they commit that record again, which is the moment they have decided something.

**3. Replay deferred through `requestAnimationFrame` alone, so a page that never paints never replayed.**

2B found this as a thirty-second hang on the WebKit lane and left it as an open product question. The
product-side answer is in replay's own scheduler: `defer` races the frame against a timer
(`FRAME_FALLBACK_MS`, 50ms), whichever arrives first runs the pass and cancels the other. The frame is
still preferred on any page that is painting. No caller has to know, and the CP2-mid fixture wires replay
through the ORDINARY coalescing path with no `{immediate: true}` anywhere, so a regression hangs this
spec rather than hiding.

### The asks, reconciled

| Ask | From | Where it landed |
| --- | --- | --- |
| The item id on the mark | 2C to 2B | `protect.mark(el, {item})` stores it, `protectedItemId()` exposes it, `editing.editBlock` passes it, and `replay.protectedForItem` asks by id with the node map as the fallback |
| Commit reaches replay with the element | 2C to 2B | `release()` builds `{item, element, observed}` and `applyRecord` takes the element as its short-circuit for the anchor |
| Replay asks `isProtected`, never `touches` | 2B to 2C | Verified: `isProtectedNow` calls `isProtected` and only that. The reason is now written next to it |
| `protect.mark` on entry, `protect.release` on commit | 2B to 2A | Already true. Moved: `release` now runs AFTER the record is written. With the microtask fix the two orders behave the same, so this half is not independently demonstrated; it is kept because a pass that runs on commit must never depend on microtask ordering to see a committed record |
| `onRestore` to re-bind the block | 2B to 2A | `editing.rebind(el)` is new: it moves the open session onto the node the repaint built, with its listeners, its editing attributes and the element-to-record memory. Without it the text on screen is right and the next keystroke goes nowhere |
| `--project=<name>` needs `LAHE_ALL_BROWSERS=1` | 2B to the harness | One paragraph in `test/helpers/README.md` |

### The test

`test/browser/cp2_mid.spec.js`, ranked test 2, both halves, on `test/fixtures/cp2-mid-doc.html` with
`test/fixtures/assets/cp2-mid-boot.js`. Nothing stands in: 2A's editing entered with Cmd-Shift-E and
committed with Esc, 2B's three layers installed on the document, 2C's replay scheduled the way 2D will
schedule it, the repaint engine actively reverting the page, and **every record minted by the reviewer's
own gestures**.

Half one: three real records first (two edits and a deleted block), then region A is edited, committed,
and RE-ENTERED. The re-entry is the point: a first-touch draft is not outstanding, so replay never
considers it and cannot show that anything protected anything. With the record outstanding, replay has a
committed version of that block it would write over the reviewer's in-progress sentence. Assert: the
text and caret survive, region B's committed record re-applies (its text polled back to the record's
`after`), `regionsWritten` up, `regionsSkippedProtected` up, `regionsBlockedChanged` delta exactly zero,
no flagged cards, the deleted block stays deleted however often the page puts it back, every other record
byte-identical, and A's record still on revision one with `before` pinned to the page's original wording.

Half two: the agent rewrites region A while the reviewer is in it, protection takes it back off, and on
commit exactly one card is flagged with both versions in full and nothing is written. Then a further
repaint and pass, and the flag is still there.

Positive controls per the harness laws: `minReplayPasses: 5` inside `assertCaretSurvivesTyping`, at least
two real repaints asserted, and every wait a condition poll or a counter read.

### The demonstrated failures

**The commit pass, one line in `protect.js`** (schedule inside the caller's open write epoch):

```
  ✘  1 [chromium] › cp2_mid.spec.js:214:3 › the page rewrites region A while the reviewer is in it:
        on commit, one card is flagged and nothing is written
    Error: expect(received).toBe(expected)
    Expected: 1
    Received: 0
    > 258 |     expect(countersAfter.regionsBlockedChanged - countersBefore.regionsBlockedChanged).toBe(1);
```

**The displaced change, one line in `protect.js`** (forget what the page tried to say):

```
  ✘  2 [chromium] › cp2_mid.spec.js:214:3 › ...
    Error: Timed out after 10000ms waiting in the page for protection to take the page's change off
    and keep what it said.
```

**The scheduler, one line in `replay.js`** (the frame or nothing), against
`test/unit/replay_scheduler.test.js`, whose first test installs a `requestAnimationFrame` that accepts
the callback and never calls it:

```
not ok 1 - a deferred pass still runs when the frame never comes
  error: 'Promise resolution is still pending but the event loop has already resolved'
```

Every revert was undone immediately after the run.

### Gate

```
lint passed (syntax: 134 files, no jsdom, manifest complete)
# tests 325
# pass 325
# fail 0
  117 passed (19.3s)
```

`npm run gate:all` (three lanes, whole suite): `351 passed (1.1m)`.

`cp2_mid.spec.js` on all three lanes (`LAHE_ALL_BROWSERS=1`): `6 passed (7.5s)`, no flake across runs.

`dist/lahe-layer.js` was rebuilt and committed, which is the orchestrator's job at a checkpoint.

### For 2D, at the merge

- The commit pass now comes out of `protect.release`, once, through the ordinary scheduler. `index.js`
  should NOT add a second pass on commit.
- Wire "the page changed, run a pass" through `replay.schedule(reason)` without `{immediate: true}`.
  The scheduler handles a page that is not painting; forcing immediate hides that it does.
- `protect.install({onRestore})` should call `editing.rebind(el)` on a remount, exactly as
  `test/fixtures/assets/cp2-mid-boot.js` does. That boot file is the shape `index.js` can be written
  from.

### Cleanup needed

Nothing was deleted. For the Phase 4B batch:

- `test/fixtures/cp2-mid-doc.html` and `test/fixtures/assets/cp2-mid-boot.js` — keep while
  `cp2_mid.spec.js` does. If 2D's `index.js` ends up covering the same wiring, the boot file is the half
  to cut, not the fixture page.
- `test-results/` — Playwright artifacts from the deliberate-revert runs. Gitignored.
