---
read-when: Checking where the live-chart replay fix stands, or what it measured.
---

# Progress: A live chart no longer re-runs replay on every hover

**Built, waiting for the orchestrator's checkpoint.** Hovering a redrawing chart used to run one whole replay pass per frame; on the measured page it now runs none while the mouse moves and one after it stops. Nothing is waiting on you.

## Needs your attention

Nothing is waiting on you.

## Spec

[01_spec_observer_perf.md](01_spec_observer_perf.md): the problem, the requirements, the approach and the choices made, the tests and the risks.

**Scope.** Board row LAHE-mousemove-rereads-page-text. Changes inside an svg, a canvas, a script or a style hold one quiet pass instead of scheduling one per batch. Nothing an agent or a reviewer does changes.

**Rollout.** Merge when the gate is green. Nothing to enable.

**Review owner.** One independent reviewer (whetstone size), the orchestrator's to assign.

## Phases

| Step | Status | Changed |
|---|---|---|
| 0 Size it | done: whetstone, one cause | 2026-11-07 |
| 2 Spec | done | 2026-11-07 |
| 5 Build | done: unit and spec tests red first, then green | 2026-11-07 |
| 6 Code review and verify | independent review done, its four fixes and two tests in; full gate is the orchestrator's | 2026-11-07 |
| 7 Ship and land | not started | |
| 8 Close out | not started | |

## The record

### Measured

[measure.js](measure.js), adapted from the Seneschal session's `repro2.js`, run once on the old code and once on the new. Page: 300 sections, each 20 divs deep, a 600-bar unnamed svg, 10,217 elements; one element comment on the svg and two committed edits; 30 mouse moves over the chart, 30 ms apart. The raw output is [measure_before.json](measure_before.json) and [measure_after.json](measure_after.json).

| | Before | After |
|---|---|---|
| Replay passes during the 30 hovers | 30 | 0 |
| Replay passes after the hovers stopped | 1 | 1 |
| Time the profiler saw inside `runPass` during the hovers | 428 ms | 0 ms |
| Longest gaps between frames | 19, 18, 18, 17, 17 ms | 10, 10, 10, 10, 10 ms |
| One replay pass on this page, timed directly | 13 ms | 11.4 ms |

One pass on this generated page costs far less than the 100 ms the row measured on the real knowledge tree page, so this page never hung. What it shows is the count: one pass per hover before, none after. The cost of one pass is unchanged by design (see the spec's "Choices made").

### Red before green

- `observer_gate.test.js`: all 9 tests failed on the old code (the gate's functions did not exist).
- `live_chart_observer.spec.js`, the counting test: 15 passes for 30 redraws on the old code (it allowed 2 then; see Review for the limit now).
- The spec's two guard tests passed on the old code too, as they should. The lost-and-found test was also run with the held pass made to do nothing: it timed out, so it catches a gate that drops held changes.

### Checks

| Check | Result |
|---|---|
| `npm run gate:unit`, after the review fixes | 3,195 pass, 0 fail, 5 skipped, 2 todo |
| `npx playwright test test/browser/live_chart_observer.spec.js`, after the review fixes | 4 passed |
| Helpers running (`ps -axo command \| grep -c "[l]ahe.js serve"`) | 1 before, 1 after, both rounds |
| Full gate, all browsers | the orchestrator's |
| Independent review | done; see Review |

### Review

One independent reviewer. Nothing blocked. Four fixes and two extra tests, each test written red first where it could fail:

| Finding | What was done | Test |
|---|---|---|
| Teardown left a held quiet pass running | `replay.cancelQuietPass()`, called from the boot handle's teardown right after the observer disconnects | Spec "teardown drops a held quiet pass": red (still held after teardown), then green |
| "Cannot move where any record is found" was wrong: `signatureOf` reads inside the svg | Reworded in the gate's comment in `replay.js`, the spec's Approach and the diagram note: a change inside an svg cannot move a text anchor; it can move an element comment on that svg between lost and found and change an edited block's text compare, and both wait for the quiet pass. The diagram line now names the text compare too | Wording only |
| The gate captured `setTimeout` and `clearTimeout` at load, so a fake clock installed after boot split the held pass across two clocks | Looked up each time the gate arms or cancels, as `defer()` does | Unit "the gate reads the page's timer functions when it arms": red, then green |
| The counting test's "at most 2" assumed the burst finished in about 4 s | The burst is timed in the page with `performance.now()`; the limit is 1 + floor(elapsed / 2000) | The same test, still green |
| Lower finding: a change on a detached node | No code change: already held only when the walk up passes through an svg | Unit "a change on a detached node...": passed on the first run |

### Screenshot

None: nothing on screen changed.

## To delete at cleanup

- `test-results/` folders left by the spec runs in this worktree.
