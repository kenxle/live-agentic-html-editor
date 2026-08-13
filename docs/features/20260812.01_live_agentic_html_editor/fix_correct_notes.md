# fix-correct notes (Phase 5 review wave)

Branch: `task/fix-correct`. Owns replay/epoch/record correctness fixes and the conflict-card
design polish. Findings 9, 11, 25, 30, 18, 26, 27.

Files I touched (only these):
- `src/layer/replay.js` — findings 9, 25, 30, 27
- `src/shared/record.js` — finding 11 (bumpRev only, surgical/add-only)
- `test/unit/replay_pass.test.js` — finding 11 failing-first test
- `test/unit/replay_scheduler.test.js` — finding 9 failing-first test

Gate: `npm run gate:builder` = EXIT 0. lint passed (164 files), unit 405/405, browser 149 passed
(1 skipped). Three named lanes (replay_branches, replay_human_and_agent, cp2_mid): 12/12 passed.

---

## Per-finding results

### Finding 9 (important) — the owed-pass seam is now consumed. FIXED (mine).
`epoch.takePendingExternal()` had no caller. When a genuine repaint's mutations land in the
same microtask batch as one of replay's own writes, `schedule()` early-returns during the open
write epoch and only calls `noteExternalMutation()` ("a pass is owed"); nothing read it, so a
committed edit the repaint reverted waited for some later unrelated mutation.

Fix in `replay.js`: `runPass()` ends by calling `scheduleOwedPass()`, which queues a microtask
that runs AFTER the epoch's deferred close and the observer's own notify microtask, then
`takePendingExternal()` and, if true, `schedule(REASON.MUTATION)`. The take is done inside the
microtask on purpose: reading synchronously at end of `runPass` would read the flag before the
observer set it and while the epoch depth is still non-zero (schedule would be refused and would
re-arm the flag with nobody to run it).

Note on the wired product: the production observer (`index.js:386`) calls `schedule()` on every
mutation with no tool/repaint classification, so replay's OWN writes also set the owed flag. The
consequence is one extra branch-one (idempotent, no-write) pass after each writing pass; it is
coalesced by `schedule()` and self-terminates (the follow-up writes nothing, so it arms nothing).
The three reverting-page lanes still pass with exact write/pass counts, so this is bounded and safe.

### Finding 11 (important) — format_only history now extends. FIXED (mine).
`record.bumpRev` gated the applied-after history push on `FIELD.AFTER` only. A format_only
record's `after` text equals its `before` by construction and never moves, so from the 3rd
formatting revision on the history never grew, `priorAfters(item, AFTER_HTML)` was empty, replay
branch three missed, and it flagged a FALSE conflict on the reviewer's own change.

Fix in `record.js`: push a history entry when EITHER the compared `after` OR the `after_html`
moved (dedupe keyed on the field the record actually compares on). Add-only change to the push
condition; the two other builders adding functions to record.js are untouched.

### Finding 25 (minor) — keep_mine now clears lost + refreshes element memory. FIXED (mine).
`resolveConflict`'s `keep_mine` branch wrote and bumped `regionsWritten` but did not
`clearLost(item)` or refresh `lastElement[id]`. A record that was both lost and conflict-flagged
kept a stale `region.lost` stamp (which 3A projects into review.json) after the reviewer resolved
in its favour. Fix: `clearLost(item)` + `lastElement[id] = element` right after the write, same as
the ordinary write path.

### Finding 30 (minor) — un-hooked ordering is intended; documented. FIXED (mine, comment) + ROUTED (index.js pointer).
The wired product calls `replay.configure` with NO hooks, so fold_replies / merge_store /
retire_handled / update_rail record `{ran:false}` and run on independent schedules. This is
intended, not a dropped guarantee: the file's own "Honest note for 3A" already anticipates a
provisional collision that clears when the reply is folded on its own schedule (an agent's source
morph arrives seconds before its reply on a live page). I added a one-line-anchored explanation at
`configure()` in replay.js.
- ROUTED TO ORCHESTRATOR: `src/layer/index.js` (fix-seam builder's file) at its `replay.configure`
  call site (~line 363) wants a one-line pointer back to the `configure()` comment in replay.js so
  a future reader does not re-file this. I did not touch index.js.

### Finding 18 (minor) — producer state already exists; fix is the sync layer's. CONFIRMED + ROUTED.
Replay ALREADY sets the producer state: in `markLost()` it writes
`item[record.FIELD.REGION].lost = { code: "ANCHOR_LOST", reason, at }` onto the record. `sync.js`
can read `item[record.FIELD.REGION].lost` directly.
- ROUTED TO ORCHESTRATOR / fix-seam sync: `sync.eventFor` (sync.js:161) mints the event from the
  record but does not lift the lost state to the top-level event field that `protocol.countsAsNew`
  reads (`event.lost`). The one-line fix is theirs, in `eventFor`, e.g.:
  `lost: !!(item[record.FIELD.REGION] && item[record.FIELD.REGION].lost)` (and, symmetrically,
  `reworded` when the rev moved). My producer half is done and confirmed; finding 18 is otherwise
  the sync layer's. One open question for them: an event is only minted when `eventFor` is called,
  so wiring must ensure a lost-marking actually re-records the item (today replay marks lost on the
  record in-place during a pass; whether that triggers a sync emission is a sync/index concern).

### Finding 26 / N1 (minor, design) — badge position. ROUTED (not my DOM).
N1 is the amber `REPLAY_NEITHER_MATCHES` badge sitting below the two buttons ("explanation after
the decision"). The badge COPY comes from `failures.js` (not mine) and its PLACEMENT within the
card is decided by `overlay.js` `paintCard` (the rail, not mine): replay only emits it via
`callCard(setCardBadge, ...)` and attaches the conflict node via `attachCardNode`. I cannot move
badge-vs-node ordering from replay.
- ROUTED TO ORCHESTRATOR / fix-seam overlay: in `overlay.js` `paintCard`, render the
  `REPLAY_NEITHER_MATCHES` badge ABOVE the attached conflict node (above the panes) rather than
  after it; or fold the residual sentence ("nothing was written, your text is kept") into a quiet
  line and let `failures.js` shorten the badge. If they prefer, replay can add a quiet one-line
  explanation under the conflict title in `conflictNodeFor` AND overlay can then drop the badge from
  the conflict card entirely — say the word and I will add the line (it is my file), but it must be
  paired with suppressing the badge or it duplicates.

### Finding 27 / N2 (minor, design) — equal button register. FIXED (mine).
The two choice buttons were weighted unequally: "Keep mine" = `cardact` (outlined), "Take the
page's" = `cardact cardact--quiet` (borderless text). On the one screen whose whole claim is that
the decision belongs to the reviewer, that put a thumb on the scale. Fix in `replay.js`
`decideNode`: both buttons now use the same `cardact` register (outline both). The button DOM/class
is minted in replay.js, so this half is fully mine; the CSS for `.cardact` lives in overlay.js and
is unchanged (both buttons already share it). `rail_design.spec.js` asserts labels and the diff
marks, not the classes, so it stays green.

---

## The two demonstrated failures (TDD, watched fail before the fix)

Finding 11 test (`test/unit/replay_pass.test.js`):
```
not ok 6 - finding 11: two successive format-only rewordings resolve as branch three, not a false conflict
  error: 'the earlier formatting revision must be in the applied-after history for branch three'
  name: 'AssertionError'
  expected: true
  actual: false
```

Finding 9 test (`test/unit/replay_scheduler.test.js`):
```
not ok 13 - finding 9: a repaint that owed a pass during replay's own write actually gets that pass
  error: 'the owed pass ran, as a MUTATION pass'
  name: 'AssertionError'
  expected: true
  actual: false
```

Both pass after the fixes (unit 405/405).

---

## Three-lane tails (all green)

`npx playwright test replay_branches replay_human_and_agent cp2_mid` — 12 passed (3.6s):
```
✓ replay_branches.spec.js:201 › five passes with no repaint in between write nothing at all
✓ replay_branches.spec.js:227 › a repaint reverting the page is the only thing that makes replay write again
✓ replay_branches.spec.js:64  › branch three: an earlier revision landed, re-applied once, card says so
✓ replay_branches.spec.js:129 › branch four: page changed underneath, nothing written, both versions in full
✓ replay_branches.spec.js:167 › format-only compares on structure, delete idempotent by absence
✓ replay_human_and_agent.spec.js:66  › reviewer types region A while page rewrites region B, nothing else moves
✓ replay_human_and_agent.spec.js:118 › page changes region A while reviewer is in it: one card flagged, nothing written
✓ cp2_mid.spec.js:114 › reviewer types region A while page rewrites region B, nothing else moves
✓ cp2_mid.spec.js:217 › page rewrites region A while reviewer is in it: one card flagged, nothing written
(+ the two lost-anchor branches)
12 passed
```

Full builder gate: `npm run gate:builder` EXIT 0 — lint passed (164 files, no jsdom, manifest
complete), unit 405 pass / 0 fail, browser 149 passed / 1 skipped.

---

## Routed to orchestrator (summary)
- Finding 30: add a one-line pointer at `index.js` `replay.configure` call site → the `configure()`
  comment in replay.js.
- Finding 18: add `lost` (and `reworded`) top-level fields in `sync.eventFor`, read from the
  record's `region.lost` (producer state confirmed present).
- Finding 26 / N1: move the `REPLAY_NEITHER_MATCHES` badge above the conflict node in `overlay.js`
  `paintCard` (and/or shorten the badge copy in `failures.js`).

## Cleanup needed
None. No files created outside the notes and tests; no deletions deferred; nothing under `dist/`
staged.
