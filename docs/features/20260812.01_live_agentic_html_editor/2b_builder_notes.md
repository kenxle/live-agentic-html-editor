# 2B: protection, the three layers

Branch `task/2b`, worktree `../lahe-worktrees/2b`. Cut after CP1.

D7's first half: protect the active region. All three layers ship, or protection
does not.

## What was built

### `src/layer/protect.js`, the stub made real

The stub's whole surface survives with its meaning intact (`mark`, `isProtected`,
`protectedElement`, `veto`, `snapshot`, `restore`, `release`, the five counters,
`LAYER`). What is new:

| Added | What it is |
| --- | --- |
| `FRAMEWORKS` | The vocabulary table. Every skip attribute layer one writes and every pre-morph event layer two listens for, in ONE place: Turbo, the harness repaint engine, and 0C's app fixture morph engine |
| `SKIP_ATTRIBUTES`, `BEFORE_MORPH_EVENTS` | Derived from that table, never typed twice |
| `install(options)` | Wires the three layers to a document: one veto listener per known event, a snapshot refresh on the reviewer's own typing, and the document-level restore observer. `layers` names a subset, which is how ranked test 1 scores each layer alone |
| `uninstall()`, `detect(win)` | Teardown, and a diagnostic list of which frameworks look present |
| `touches(el)` | The veto's predicate, and it is not `isProtected` (see below) |
| `regionKeyFor(el)` | Region identity: an attribute the PAGE's own markup carries (`data-review-region`, `data-region`, `id`), with the selector that finds the region again after the element it was on was destroyed |
| `lastFailure()` | What stopped the last restore, so a zero counter has a sentence attached to it |

**Layer one** marks with every known skip attribute rather than trying to work
out which framework the page runs. An attribute a framework has never heard of is
inert to it; guessing wrong costs the reviewer their caret. The library's own
`data-lahe-protected` goes on as well, because `data-turbo-permanent` alone does
not say who put it there.

**Layer two** is `install`'s listener on every known pre-morph event, calling
`veto`, which calls `touches`.

**Layer three** snapshots the region's HTML, its editing-surface attributes, and
the selection as CHARACTER OFFSETS from the start of the region. It re-snapshots
on every `input` and `keyup` (both at the document, in capture) so the snapshot is
always ahead of the observer; without that ordering the observer reads the
reviewer's own typing as damage and restores it away. One `MutationObserver` on
`document.documentElement` restores. The restore itself runs inside
`epoch.write("protect_restore", ...)`, so replay does not read protection's own
writes as a page change.

**The commit seam.** `release()` takes every mark back off, drops the snapshot,
and calls `replay.schedule(REASON.COMMIT, { immediate: true })`. A missing replay
module throws rather than lifting protection quietly: protection lifting without
the pass that follows it is exactly the silent swallow the seam exists to
prevent. Replay is resolved LAZILY (a function passed into the factory) because
the bundle concatenates `protect.js` before `replay.js`, so reading
`root.LAHE.replay` at factory time captures `undefined` forever.

### The three traps, and where each one now lives in the code

1. **The veto checks both directions.** `isProtected` answers "is el the block or
   inside it". A frame-level morph fires its cancelable event on an element that
   CONTAINS the block. `touches()` is the veto's predicate: the target is the
   block, is inside it, or contains it. Two tests hold it down, and both were
   watched failing against the one-line revert (below).
2. **Layer three holds no node reference and observes no region.** Snapshots are
   keyed by region identity, one observer watches the document. When the region
   comes back as a new element, `restore` moves `active.element` onto it and
   re-marks it.
3. **A restore re-establishes the editing surface.** `SURFACE_ATTRIBUTES`
   (contenteditable, spellcheck, autocorrect, autocapitalize, tabindex, role) are
   part of the snapshot and go back on the rebuilt element, which is then focused
   and given the caret. The `onRestore(el, snapshot)` callback is the seam 2A and
   2D re-bind through. Without this the block comes back dead to the keyboard:
   the text looks repaired, the next keystroke goes nowhere, and every later
   repaint restores the same one sentence.

### Tests

**`test/browser/protection_layers.spec.js`** (9 tests). Ranked test 1 six times:
each of the three layers alone, in both fixture flavors.

| Run | Fixture | Assertion |
| --- | --- | --- |
| layer one alone | harness `morph` flavor, engine protection OFF | `assertCaretSurvivesTyping` (node identity) |
| layer one alone | 0C's app, `?morph=hooked` | `assertCaretSurvivesTyping` |
| layer two alone | harness `morph` flavor | `assertCaretSurvivesTyping` |
| layer two alone | 0C's app, `?morph=hooked` | `assertCaretSurvivesTyping` |
| layer three alone | harness `?repaint=no-hook` | `assertCaretRestoredAcrossRepaints` |
| layer three alone | 0C's app, `?morph=raw` | `assertCaretRestoredAcrossRepaints` |

Ten characters, one per 50ms, engine reverting every 200ms; the paragraph reads
exactly as before with the ten inserted contiguously; the replay pass counter up
by at least five; and at least two real repaints happened, so a page where
nothing repainted cannot pass with a perfect score. Each run also asserts the
counters of the OTHER two layers stayed at zero, so no layer rides on its
neighbour.

Plus: the protected block survives a morph that would otherwise replace it, in
the veto flavor (turbo-frame, the event fires on the frame CONTAINING the block,
node identity preserved) and in the no-hook flavor (the node does not survive, the
block comes back with the reviewer's words, still editable, still protected,
still focused, and typing after the restore lands in it). Plus the commit seam.

**Two things about that spec worth knowing.** The harness stub layer is blocked
at the network (`route.abort` on `/assets/harness-stub.js`), so nothing but the
real `protect.js` can protect, veto or restore anything on the harness fixture;
0C's app fixture never loads a stub at all. And the harness repaint engine is
configured `protection: "off"` for the layer one and two runs: the engine has its
own `data-lahe-protected` shortcut, and leaving it on would let the FIXTURE
protect the block while the library did nothing.

**`test/browser/support/protect_page.js`** is the spec's own support file (not
harness, nothing else reads it): it injects the real modules with
`addScriptTag` in manifest order, mirrors `protect`'s and `replay`'s counters onto
`window.__lahe.counters` as live getters, gives 0C's app fixture the fixture
surface `test/helpers/repaint.js` expects, and stands in for 2D by scheduling a
replay pass when the page changes. `dist/` is not involved: builders may not
rebuild it, so a spec that loaded the bundle would depend on an artifact this
branch cannot refresh.

**`test/unit/protect_vocabulary.test.js`** (8 tests, no DOM library). The veto in
both directions, region identity and its minted fallback, layer one's attributes
going on and coming back off, the commit seam counting a pass, and the vocabulary
table pinned against BOTH engines by reading their source: a fixture that renames
its attribute or its event fails here rather than three fixtures away as a lost
caret.

## The demonstrated failures

### 1. TDD: layer three's run of ranked test 1, before the layer existed

Written first. The first run failed with `protect.install is not a function`,
which is a real failure and a shallow one, so an inert `install` shell went in and
the run was watched again. This is the failure that matters, against a layer that
is wired up and does nothing:

```
  1) [chromium] › protection_layers.spec.js:197 › layer three alone, snapshot and restore, harness no-hook flavor

    Error: assertCaretRestoredAcrossRepaints failed:
      - after keystroke 1 of 10: the region did not come back. Characters were lost and nothing put them back.
          expected: "Marcus is running four easy miles on Tue0sday and resting completely on Wednesday."
          actual:   "Marcus is running four easy miles on Tuesday and resting completely on Wednesday."
      ... (every keystroke, and both trailing repaints, the same)
      - the region does not read as expected at the end of the run.
          expected: "Marcus is running four easy miles on Tue0123456789sday and resting completely on Wednesday."
          actual:   "Marcus is running four easy miles on Tuesday and resting completely on Wednesday."
      - the 'restores' counter went up by 0, wanted at least 10. Text that survived because nothing ever
        damaged it is not layer three working, and this assertion is only meaningful on a page that really
        did destroy the region.
    Repaints: 12, restores: 0
    Counters after:  {"repaints":12,...,"marked":1,"vetoes":0,"snapshots":0,"restores":0,"restoreFailures":0}
```

### 2. The one-line revert on the veto's contains direction

`touches()` with the contains-the-block half dropped:

```js
    if (isProtected(el)) return true;
    return false; // DELIBERATE REVERT: drop the contains-the-block half
```

Browser:

```
  1) [chromium] › protection_layers.spec.js:275 › a protected block survives a morph that would otherwise
     replace it › veto flavor: the frame-level event fires on an element CONTAINING the block

    Error: expect(received).toBe(expected) // Object.is equality
    Expected: true
    Received: false
      295 |       const after = await nodeStillIdentical(page, HARNESS_REGION, "veto-block");
    > 296 |       expect(after.identical).toBe(true);
```

Unit:

```
not ok 1 - the veto fires on an element that CONTAINS the protected block
    and the veto still has to fire, because morphing the frame destroys the block
  expected: true
  actual: false
```

Reverted immediately after.

## Gate output

`npm run gate:builder`, tail:

```
lint passed (syntax: 121 files, no jsdom, manifest complete)
# tests 301
# pass 301
# fail 0
  92 passed (22.6s)
```

`npm run test:browser:all` (three lanes, whole suite):

```
  276 passed (45.2s)
```

`dist/` was never rebuilt and never staged.

## Found the hard way: replay's rAF scheduling stalls a non-painting page

Worth a line for 2C and 2D, because it cost an hour and it is not a test-only
problem.

`replay.schedule` defers through `requestAnimationFrame`. A browser that is not
painting the page throttles rAF to nothing. Running the spec on the WebKit lane
with six parallel workers, the layer under test worked perfectly (the page
snapshot from the failure shows all ten characters in the right place) and the
test hung for 30 seconds on `waitForCounter(page, "replayPasses", ...)`, failing
with a bare timeout. Three different tests failed on three consecutive runs,
which is the signature of a throttle rather than a bug in any of them.

The support file now schedules `{ immediate: true }` and says why. The lane went
from 33s with a failure to 4s green, three runs in a row.

**The product question this leaves open, for 2C and 2D:** a background tab never
replays. That may be correct (nobody is reading it) as long as the remount pass on
becoming visible catches up, but it is currently an accident of the scheduler
rather than a decision, and any harness wait written against `replayPasses` will
hang on a page that is merely not being painted.

## Two files I touched that are not mine

- **`test/unit/consumer_2b_protect.test.js`** (0A-kernel's throwaway stub
  consumer, already on the Phase 4B cleanup list, "delete when 2B has landed").
  Two changes: its stand-in element gained `hasAttribute` and `removeAttribute`,
  which the landed layer needs (release takes the skip attributes back off, and
  layer three saves the block's editing surface), and the snapshot count moved
  from 1 to 2 because `mark` now takes the opening snapshot itself. A repaint
  landing before the reviewer's first keystroke would otherwise have nothing to
  restore to.
- Nothing else. `layer/selection.js`, `shared/review_format.js` and
  `shared/manifest.js` are untouched, as are `test/helpers/*` and both fixture
  engines.

## Asks for the orchestrator and other tasks

- **2A (editing):** call `protect.mark(el)` when a block enters edit state and
  `protect.release(el)` on commit, and pass `onRestore` to `install` (or wrap it)
  to re-bind whatever editing binds per element. A commit is the reviewer leaving
  a block, never the framework yanking the node out from under them: 0B hit this
  as a blur-commit that hid layer three completely, and the real editing surface
  has the same trap.
- **2C (replay):** the commit pass is already called for you from `release`, with
  `REASON.COMMIT` and `immediate`. `protect.isProtected(el)` is the predicate to
  ask before writing; `touches()` is the veto's and is not what replay wants.
  See the rAF note above.
- **2D (living in the page):** `install()` is idempotent (a second call
  uninstalls the first) and returns an `uninstall`, so a remount can re-install
  cleanly. In the shipped library 2D owns the "the page changed, run a pass"
  wiring that `test/browser/support/protect_page.js` is standing in for.
- **Harness (0B), nothing blocking:** `playwright test --project=<name>` alone
  fails with `Project "<name>" not found in the worker process`; it needs
  `LAHE_ALL_BROWSERS=1` alongside it, because the config reads `process.argv` and
  the worker process does not carry the flag. Worth a line in
  `test/helpers/README.md`.

## Cleanup needed

Nothing was deleted. For the Phase 4B batch:

- `test/unit/consumer_2b_protect.test.js` (0A-kernel's throwaway consumer, whose
  own header says to delete it when 2B has landed. It has landed).
- `test-results/`, `playwright-report/` (Playwright output, already ignored).
