---
read-when: A reviewed page with a live chart is slow while the mouse moves, or you are changing which page changes schedule a replay pass.
---

# A live chart no longer re-runs replay on every hover

Board row LAHE-mousemove-rereads-page-text. Whetstone size: one cause, one fix, tests and a measurement.

## Problem

The layer watches the whole page body for changes (`pageObserver` in `src/layer/index.js`, child lists and text on all of body). Every batch of changes scheduled a replay pass, and a pass re-resolves every saved record against the page.

Plotly rewrites its svg on every hover. So on Seneschal's knowledge tree page, with one element comment on the chart and two committed edits, every hover frame ran a whole pass. The row's numbers: a Ring click plus 30 hovers spent 886 ms in the pass, each hover frame ran 100 ms, and the browser hung. Where the pass spends it:

- `resolve`, then `candidatesFor`, `findMatches` and `textOf` walking the page's text for each text-anchored edit;
- `findSignatureMatches` calling `signatureOf`, which serializes the whole unnamed svg for the element comment.

## Requirements

1. Changes inside a redrawing svg do not run one pass per redraw.
2. A real text change outside the svg still runs a pass at once, even in the middle of a redraw burst, and replay still writes a committed edit back after the page reverts it.
3. A change inside an svg that carries a comment is not dropped: once the svg settles, a pass runs, so a comment lost while a hover label was drawn is found again.
4. Nothing else about replay changes: the epoch rule, the settling window, the four branches, and every existing test.

## Approach

**Hold changes the anchor engine cannot see.** The anchor engine never reads inside a tag in `anchor.SKIP_TAGS`. An svg or a canvas is a leaf compared by its signature; a script or a style has no prose. So a change whose target is inside one of those cannot move where any record is found. It can change two things, and neither needs a pass per frame: the drawing an element comment on that svg was minted from, and the text replay compares for an edited block that holds an inline svg with words in it.

The observer now hands each batch to `replay.noteMutations(records)`:

- A batch with any change outside those tags goes to `schedule(MUTATION)`, exactly as before.
- A batch made only of changes inside them arms one quiet pass. It runs 250 ms after the last held change, and never later than 2 s after the first, so a chart that never stops redrawing still gets a pass every 2 s.
- Any pass that runs first cancels the held one, since it read the page after those changes.

The change that adds or replaces the svg itself is not held: its target is the svg's parent, and the element a comment is bound to may be the one that went.

**Choices made, and why the other two fixes are not in it.**

- **Not caching `textOf` per DOM version.** Replay writes the page in the middle of a pass (one record's write lands before the next record resolves), so a cache that lives across records has to be dropped on every write. The DOM gives no cheap version number for that, and the observer's records arrive after the pass, not during it. A cache scoped to one record's resolve is safe, but it only saves when the first probe fails, and in the measured case the first probe binds. With the gate, the pass no longer runs per frame, so the pass cost matters only when the page really changed.
- **Not adding a "skip handled items" step.** It is already there: `applyRecord` returns at once for a record that is not outstanding, and a handled record is not.
- **Not reordering the element comment's resolve.** Trying the last bound element before the signature would skip the svg serialization, but it changes which element wins when the page holds a second svg with the same drawing. That is an anchoring decision, not a speed fix.
- **The full `SKIP_TAGS` list, not only svg and canvas.** A CSS-in-JS library that writes rules into a `<style>` in the body, or a framework that streams data into a `<script>`, was also scheduling passes for changes no record can see.

## Tests

| Test | What it proves | Red before the fix |
|---|---|---|
| [observer_gate.test.js](../../../test/unit/observer_gate.test.js) | Which changes are held (inside svg, foreignObject, canvas, style, script) and which are not (a paragraph, the svg's parent, the body, an empty batch); the gate's timing on a fake clock (a burst gives one pass after it, a mixed batch schedules at once, a chart that never stops gets a pass every 2 s, cancel drops the held pass); replay's own gate with real timers | All 9 failed: the functions did not exist |
| [live_chart_observer.spec.js](../../../test/browser/live_chart_observer.spec.js), first test | Real boot, one element comment on the svg, two committed edits: 30 redraws inside the svg run at most 2 passes, then one quiet pass follows. Counts passes, no clock | 15 passes for 30 redraws |
| Same spec, second test | A paragraph reverted by the page during a 60-frame redraw burst is written back before the burst ends | Passed before and after (a guard) |
| Same spec, third test | A comment on the svg, reloaded with a hover label stuck on, is reported lost; clearing the label (a change inside the svg only) brings it back | Passed before and after (a guard). With the held pass made to do nothing, it timed out, so it does catch a gate that drops held changes |

[measure.js](measure.js) times 30 hovers on a 10,217-element page before and after; the numbers are on the progress page.

## Risks

- **A drawing that changes more often than every 250 ms** gets a pass every 2 s instead of every frame. The only thing such a pass can do is re-find an element comment on that drawing, which cannot match while it keeps changing.
- **A comment found again 250 ms later** than before, after a hover ends. The card and the highlight lag by that much.
- **An inline svg inside an edited block** that redraws: replay's compare reads the block's text and markup with the svg in it, so a change there is compared 250 ms later instead of on the next frame. The outcome is the same, later.
