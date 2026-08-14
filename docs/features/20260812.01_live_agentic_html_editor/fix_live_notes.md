# fix-live: two live-page bugs from the 2026-08-14 browser walks

Branch `task/fix-live`. Two bugs found by real-browser walkers, both invisible to
the existing suite because the suite turns off the thing that causes them.

- **Bug 1.** "Keep mine" on the conflict card did not survive the next repaint.
- **Bug 2.** Comment highlights were never repainted after a page reload.

Both were fixed test-first: the failing spec was written and run against the
unfixed code, then the code changed, then the spec ran green, then I drove the
whole thing myself in a real browser and looked at the screenshots.

---

## Bug 1: "Keep mine" was a one-shot write

### What was wrong

`resolveConflict("keep_mine")` wrote the reviewer's version to the region once
and cleared the conflict. On a page that is still repainting, the page's own
source still says the agent's sentence, so the next morph pass rendered it
again, replay read branch four (neither version matches), and the collision came
back. Forever, and with nothing said to the reviewer. With
`window.__app.morph.stop()` the press stuck, which is what pinned it: every
existing conflict spec runs with the morph off.

### The fix, in three parts

1. **The record remembers what the reviewer answered.**
   `region.accepted_page_texts` (`src/shared/record.js`), with
   `acceptedPageTexts()` and `acceptPageText()`. Add-only, deduped, and capped at
   `ACCEPTED_PAGE_TEXTS_MAX = 8` keeping the newest. The cap is there because a
   page whose source genuinely churns (a feed, a clock) would otherwise hand the
   record a new state on every pass and grow it without limit in browser storage
   and in every event the record posts. When the oldest falls off, a long-ago
   page state can raise the collision once more: that is asking again rather
   than guessing, which is the honest failure direction.
   `before` is untouched (R29): it is still the agent's diff base.

2. **Replay's compare treats an accepted state as branch two.**
   `matchesAcceptedPageState` in `src/layer/replay.js`, checked after the prior
   `after`s and before branch four, in both the delete path and the ordinary
   one. So the ordinary replay pass re-applies the current `after` on every
   pass, exactly like any committed record, and raises nothing. The accepted
   states also join `probesFor`, because the region has to be findable (the
   anchor is placed by text) before it can be re-written.

3. **The decision is written down, not just remembered.**
   This was the part that took a second pass. `index.js` caches the record list
   and `merge()` replaces it from the store on every remount, so the accepted
   state died at the next morph and the fix did nothing. Replay's context gained
   an optional `persist(item)` seam, wired in `src/layer/index.js` to
   `store.write(reviewId, item)` plus a card refresh. A caller that supplies no
   seam keeps the old memory-only behaviour, which is what the simulated-DOM
   unit tests run on.

One more thing fixed in the same press path: keep_mine refused outright when the
node replay last bound had been destroyed by a morph. It now re-resolves the
anchor, the way every pass does. On a morphing page the element is routinely
gone by the time a hand reaches the button.

### The projection

`src/shared/review_format.js` is NOT changed. It projects `region.label` and
`region.lost` and nothing else from the region, and the accepted page states are
bookkeeping for replay, not something an agent should act on. If they ever are
projected, they are `CLASS_DATA` (the page's own words) and they are already
classified that way in `record.js`'s `FIELD_CLASS`.

### Known bound, worth stating

`persist` writes to browser storage. It does not post the record to the helper,
so a reviewer who answers a collision and then reloads before anything else
touches that record keeps the answer (storage is durable) but the helper's
`review.json` does not carry it. Nothing depends on it there today.

### The failing spec, against the unfixed code

`test/browser/keep_mine_live_page.spec.js`, on the app fixture at
`/?morph=raw&poll=250` with the feed source frozen, a real Cmd-Shift-E edit, the
agent's rewrite landing in the served source, and a real mouse click at the
button's on-screen geometry.

```
  ✘  2 [chromium] › test/browser/keep_mine_live_page.spec.js:97:3 › the reviewer's decision on a collision, on a page that keeps repainting › Keep mine survives every later morph pass, and the conflict does not come back (3.5s)

    Error: morph pass 6 ends with the reviewer's sentence on the page

    expect(received).toContain(expected) // indexOf

    Expected value: "Devon has missed two easy runs in a row and has not said why. Text him before lunch."
    Received array: ["Devon has missed two easy runs in a row and has not said why. The agent rewrote this from the source.", "Devon has missed two easy runs in a row and has not said why. The agent rewrote this from the source.", ...]

      263 |     expect(passesAfter.length, "at least eight morph passes after the press").toBeGreaterThanOrEqual(8);
      264 |     passesAfter.forEach(function (n) {
    > 265 |       expect(buckets.get(n), "morph pass " + n + " ends with the reviewer's sentence on the page").toContain(MINE);
```

An earlier run of the same spec, before the press-side re-resolve, caught the
symptom in the walker's own words: the region reads the agent's sentence, the
card is still flagged, and replay had counted the same collision 21 times.

```
    Error: Timed out after 5000ms waiting for the press to put the reviewer's sentence back on the page.
    Context: {"passes":25,"text":"Devon has missed two easy runs in a row and has not said why. The agent rewrote this from the source.","flagged":true,"blocked":21,"replayPasses":35}
```

### Green

```
  ✓  2 [chromium] › test/browser/keep_mine_live_page.spec.js:97:3 › the reviewer's decision on a collision, on a page that keeps repainting › Keep mine survives every later morph pass, and the conflict does not come back (3.4s)
```

Unit coverage added alongside: `test/unit/replay_pass.test.js` ("keep mine: the
answered page state is branch two from then on, and nothing re-raises") and
`test/unit/record_lifecycle.test.js` (the field, add-only, deduped, bounded).

### My own click-through

`walk_keep_mine.js` in the session scratchpad: real browser, real edit, real
press, then eight more morph passes.

```
after 8 more morph passes: {"onPage":"Devon has missed two easy runs in a row and has not said why. Text him before lunch.","stillFlagged":false,"conflictsCounted":1,"morphPasses":10}
```

Screenshots (looked at, not just written):

- `walk_1_conflict_card.png`: the card showing both versions with Keep mine and
  Take the page's, the page holding the agent's sentence.
- `walk_1_after_press_8_passes.png`: eight morph passes later, the page holds
  "... Text him before lunch." and the conflict block is gone from the card.

---

## Bug 2: highlights were never repainted after a reload

### What was wrong

A highlight is DOM, and DOM does not survive a load. Boot's `merge()` redrew the
cards, replay put committed edits back, and nothing ever repainted the comment
highlights, so a reloaded page came back with the records and the cards intact
and not one passage tinted. Reopen-after-reload could not show a highlight
either, for the same reason.

### The fix

`repaintHighlights()` in `src/layer/index.js`, called at the end of `merge()`.
For every merged record of a painted kind (comment, note) that is not handled
and does not currently have its box open, it calls `comments.repaint(id)`, which
resolves the record's own anchor against the page as it is now and paints
nothing when it does not bind.

- A handled item stays unpainted: that is R37, not an accident.
- An open box is skipped: its paint is the louder ACTIVE one, and repainting
  would quietly downgrade the passage the reviewer is looking at.
- A lost anchor stays lost: no paint, no error, record kept.
- The no-reload lifecycle (paint, unpaint on handled, repaint on reopen) is
  unchanged and still covered by `ac3_walk.spec.js`, which is green.

### The failing spec, against the unfixed code

`test/browser/highlights_after_reload.spec.js`: a static document, two comments,
a reload where the agent has deleted one of the two passages.

```
  ✘  1 [chromium] › test/browser/highlights_after_reload.spec.js:111:3 › the reviewer's highlights come back with the page › a reload repaints every outstanding comment, and a lost one stays honestly unpainted (10.4s)

    Error: Timed out after 10000ms waiting in the page for the surviving passage to be tinted again after the reload. Underlying: page.waitForFunction: Timeout 10000ms exceeded.
       at ../helpers/poll.js:72
        at /Users/kennethstclair/Documents/workspace/lahe-worktrees/fix-live/test/browser/highlights_after_reload.spec.js:172:5
```

### Green

```
  ✓  1 [chromium] › test/browser/highlights_after_reload.spec.js:111:3 › the reviewer's highlights come back with the page › a reload repaints every outstanding comment, and a lost one stays honestly unpainted (322ms)
```

### My own click-through

`walk_highlights.js` in the session scratchpad: comment on a passage, look at it,
reload, look again.

```
before reload: {"paintedIds":1,"rangeText":"Runners come back too fast after a layoff, and the third week is where it shows."}
after reload:  {"paintedIds":1,"rangeText":"Runners come back too fast after a layoff, and the third week is where it shows."}
```

Screenshots, compared side by side: `walk_2_painted_before_reload.png` and
`walk_2_painted_after_reload.png`. The same sentence carries the same tint in
both, and the card is in the rail in both.

---

## The gate

`npm run gate:builder` (lint, unit, Chromium browser suite):

```
# tests 364
# pass 364
# fail 0

  1 skipped
  156 passed (35.6s)
```

## Files changed

- `src/shared/record.js`: `region.accepted_page_texts`, `acceptedPageTexts`,
  `acceptPageText`, the cap, the D12 classification.
- `src/layer/replay.js`: accepted states as branch two in `compare` (both the
  delete path and the ordinary one), in `probesFor`, and the keep_mine path
  (remember, persist, re-resolve a destroyed element).
- `src/layer/index.js`: the `persist` seam wired to the store; `repaintHighlights`
  in `merge()`.
- `test/browser/keep_mine_live_page.spec.js` (new).
- `test/browser/highlights_after_reload.spec.js` (new).
- `test/unit/replay_pass.test.js`, `test/unit/record_lifecycle.test.js`.

## Cleanup needed

Nothing was deleted. `test-results/` holds trace zips from the failing runs; it
is build output and already ignored.
