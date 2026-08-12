# 2C builder notes: replay, history-aware, four branches

Branch `task/2c`, worktree `../lahe-worktrees/2c`. Owns `src/layer/replay.js` plus the
specs below. Ranked tests 2, 8, 13 and 14.

## What landed

**`src/layer/replay.js` (rework).** The stub's signatures, pass ordering, epoch discipline,
counters and `compare()` were 0A-kernel's and did not move. What is new:

- **A pass context.** Replay does not own the store, the rail or protection; it is handed
  them through `replay.configure({root, items, cards, protect, anchor, document, hooks})`,
  or per pass through `runPass(reason, override)`. That is what let this task be built and
  tested against 0A-kernel's record fixture generator without waiting on 2A, and what lets a
  unit test drive a whole pass over a simulated DOM with no browser.
- **`runPass` runs PASS_ORDER.** The pass counter increments first and unconditionally.
  Steps replay does not own (fold_replies, merge_store, retire_handled, update_rail) are
  hooks; a missing hook is reported in the summary as `ran: false`, never silently skipped.
  `resolve_anchors` is not a separate step: each record resolves and applies together,
  because an anchor resolved in one step and written in the next was resolved against a
  document the write has already changed.
- **`applyRecord`,** in the order it enforces: not outstanding, skip; the reviewer is in
  this region, skip; the anchor does not bind uniquely, surface as lost and write nothing;
  otherwise branch on `compare()`, and branch four writes nothing at all. Every DOM write is
  inside `epoch.write("replay", ...)`.
- **The conflict card.** Branch four sets a `REPLAY_NEITHER_MATCHES` badge whose detail
  carries both texts, and attaches a node to the card holding **both versions in full**,
  labelled "Your version" and "On the page now". No "see theirs" indirection (Ken's call at
  the wireframe). One node per item, reused and emptied when the conflict resolves, because
  rebuilding a node inside a card the reviewer may be typing in is the rail's own law broken
  from outside.
- **Branch three's card message** is `replay.EARLIER_REVISION_MESSAGE`, set through
  `setCardNotice`. The test asserts the module's own constant, so the message a test asserts
  and the message the reviewer reads cannot drift apart.

### Two decisions that were not in the plan, and why they had to be made

**1. Multi-probe resolution (D9 at replay time).** A reference's probe is the region's text
at mint time, which is the record's `before`. The moment replay writes `after` into that
region, the probe no longer describes what is on the page, and a single-probe resolve calls
its own successful write a lost anchor on the very next pass. So a record is resolved
against every text it knows about, newest first: current `after`, `before`, then every
earlier `after` from the applied history. **Only the probe varies.** The stored context, the
widening depth and `uniqueness.selectUnique` are untouched, so this is 1C's resolve asked
the same question about several known spellings of one region, not a second anchor engine.
A probe that binds to two nodes is a lost anchor exactly like one that binds to none.

**2. Protection is asked BEFORE the anchor.** While the reviewer types, the region's text is
neither the record's `before` nor its `after` nor anything in the history, so the anchor
cannot find it and would report the region the reviewer is looking at right now as lost.
Replay keeps the node each record was last bound to and asks `protect.isProtected` about it
first. That map is used for one thing only, the protection question; it never places a
write, and a stale detached node is harmless because a detached node is not the protected
one. See the cross-task ask below for the cleaner CP2-mid version.

**3. A lost record is not re-stamped.** If the record is already lost for the same reason,
`region.lost.at` is left alone. Otherwise every pass rewrites the timestamp, which turns
"this record was untouched" into a diff on every pass and makes ranked test 2's
byte-identical assertion unstateable.

## Where a conflict actually comes from (worth knowing before reading the tests)

Because the anchor matches by text, a region rewritten *beyond recognition* is a **lost
anchor**, not branch four. Branch four is the case where the region is still recognizably
itself and its text is neither version: the agent appended or reworked a sentence
(`contains` still matches), or 2B hands replay the element directly on commit. Both shapes
are tested. This is the honest split, and it is what the counters say.

## Tests

| File | What it covers |
| --- | --- |
| `test/unit/replay_pass.test.js` | All four branches, format-only on structure, delete idempotent by absence, both lost shapes, the post-commit element seam, protection, and that every write is inside the epoch. Runs over a simulated DOM (the same eight questions 1C's unit test uses; no jsdom) |
| `test/browser/replay_branches.spec.js` | Ranked 13 (four branches with counters, branch three via **two** rewordings, `regionsWritten` +1 exactly, the card message asserted), ranked 8 (`assertNoSecondWrite` over five passes with `minReplayPasses: 5`, plus the positive control that a repaint does make it write), ranked 14 (zero matches and two matches, both lost, `replayPasses` up and `regionsWritten` flat) |
| `test/browser/replay_human_and_agent.spec.js` | Ranked 2, both halves |
| `test/fixtures/replay-doc.html`, `test/fixtures/assets/replay-boot.js` | 2C's own fixture page and boot. Its own rather than an edit of `repainting.html`, which loads the harness STUB layer: a page carrying both would have two things claiming the same counters |

Counters reach the harness as **getters** over `replay.counters` (`replayPasses`,
`regionsWritten`, `regionsSkippedIdentical`, `regionsSkippedProtected`,
`regionsBlockedChanged`, `regionsEarlierRevision`, `regionsLost`), so the published number
cannot drift from what the engine counted.

**A trap for whoever writes the next replay spec.** Replay schedules itself off the page's
own mutations, so between a `page.evaluate` that changes the page and a later
`readCounters` over the wire, another pass can legitimately have run. A delta measured
across that gap is the sum of two passes. Anything asserting "this pass did exactly this"
changes the page, reads the counters, and runs the pass **in one task**, inside the page.

## The demonstrated failure

One-line revert in `src/layer/replay.js`, dropping the applied-history lookup so branch
three falls into branch four:

```diff
     // Branch three. Every `after` this record has had, other than the current
     // one, read from the applied history the record carries.
-    var priors = record.priorAfters(item, fields.after);
+    var priors = []; // DELIBERATE REVERT: drop the applied-history lookup
```

Unit half:

```
not ok 1 - branch three: an earlier revision landed, so the current one is re-applied and the card says so
  error: |-
    Expected values to be strictly equal:
    + actual - expected

    + 'content_changed'
    - 'earlier_revision'
```

Browser half:

```
  1) [chromium] › test/browser/replay_branches.spec.js:64:3 › branch three: an earlier revision landed, so the current one is re-applied once and the card says so

    Error: expect(received).toBe(expected) // Object.is equality

    Expected: "earlier_revision"
    Received: "content_changed"

    >  98 |     expect(result.branch).toBe("earlier_revision");
```

Reverted, rebuilt, green again.

## Gate

`npm run gate:builder`, from this worktree, on Node 20:

```
93 passed (19.8s)
```

lint passed (syntax: 122 files, no jsdom, manifest complete); unit tests 304 pass, 0 fail
(11 of them this task's); browser 93 passed, 10 of them this task's. `dist/` was rebuilt locally for
the browser tests and is **not** committed.

## Cross-task asks

- **2B (protection):** pass the item id into `protect.mark(el, {item: id})`, or expose
  `protectedItemId()`. Replay currently answers "is the reviewer in this record's region"
  from the node it last bound the record to. That works, and an id from the side that
  actually knows it is better. Nothing in `protect.js` was touched.
- **2B:** on commit, call `replay.applyRecord(item, {element})` (or
  `replay.schedule("commit", {immediate: true})` once the context is configured). The
  element form is the seam that makes a change the page made to a protected block surface as
  branch four instead of being swallowed; it is exercised in both test files.
- **2A (editing):** replay writes `after` with `textContent` and `after_html` with
  `innerHTML`. If the edit surface ever produces markup inside an edited region, say so and
  the write becomes markup for edits too.
- **3A (projection):** a lost record carries `region.lost = {code: "ANCHOR_LOST", reason,
  at}` with the reason naming zero matches or several. `review_format.js` was not touched.
- **2D:** replay's self-scheduling in the fixture boot is `lahe:repainted` →
  `schedule(REMOUNT, {immediate: true})` plus a `MutationObserver` →
  `schedule(MUTATION)`. `index.js` and `listeners.js` are yours; the shape is in
  `test/fixtures/assets/replay-boot.js`.
- **1B (rail):** replay attaches the conflict node through `attachCardNode` and reads
  nothing back except through `getCard`/`cardBadges`. If the Active tab ever wants to render
  the conflict itself, the data is on the badge's `detail` (`{yours, theirs}`) and in
  `replay.conflictFor(id)`.

## Cleanup needed

Nothing was deleted. For the Phase 4B batch:

- `test/unit/consumer_2c_replay.test.js` — 0A-kernel's throwaway stub consumer for this
  task. It still passes; it is on the plan's cleanup list now that 2C has landed.
- `test-results/` — Playwright's failure artifacts from this session (traces and
  error-context files). Untracked, gitignored, safe to remove.
