# Phase 7 fix H1: the repaint spec's caret under load

**Verdict: test.** The spec moved the caret with a script, then repainted before the browser told the layer about the move. No reviewer can move a caret that way. The product already follows the "live caret wins" rule wherever a live caret still exists. The spec now moves the caret with arrow keys, like a reviewer does.

## The failure

`test/browser/free_writing_repaint.spec.js:76` ("keeps every run block, and the caret's block and offset") failed under full-suite load in Chromium. The text survived, but the caret landed at offset 13 (the end of "Run two here.") instead of offset 3.

## Evidence

- **Reproduced under load.** 14 busy-loop node processes plus `--workers 12 --repeat-each 30` on the real spec: 1 failed of 120, on md_render.html, with the same offset 13.
- **Cause confirmed with a probe.** A scratch copy of the test, step for step, counted selectionchange events before running the repaint. Under the same load, 160 runs:
  - 158 runs: selectionchange had arrived, caret at offset 3.
  - 2 runs: selectionchange had not arrived (even after two more round trips to the page), caret at offset 13.
  - The two lists match exactly.
- **Forced ordering, 5 of 5 each, deterministic.** A scratch spec put the script move and the repaint in one task, so selectionchange cannot run first:
  - Right after the repaint, the run block that held the caret is disconnected, and the live selection has collapsed onto the frame DIV. There is no live caret left in the run to prefer.
  - The restore then uses the snapshot's caret, taken at the last keyup: offset 13.
  - The same move made with 10 ArrowLeft presses, then the repaint, lands at offset 3 every time. Each keyup refreshes the snapshot synchronously (`onTyping` in `src/layer/protect.js`).

## Why this is not the 2026-09-15 bug again

That fix (board row LAHE-cp2-walk-caret-reversal: the reviewer's live caret outranks a snapshot that is one beat out of date) covers an UNDAMAGED block: the node survived, so the live caret can be read and adopted. The run path already does the same thing: `runRestore` and `onSelectionMoved` both adopt the live caret when `runUndamaged` holds. This test's repaint destroys the run blocks. Once they are gone, the browser has already moved the selection off them, so no code can read where the caret was. The plain-edit path has the same limit for a destroyed block.

## Residual (not fixed, shared by both paths)

A real reviewer's caret move comes with a keydown and keyup, or a mousedown and mouseup. If a repaint that destroys the block lands after the move but before both keyup and selectionchange, the caret goes back one move. The window is between one input event and the next task. Closing it would mean snapshotting on mouseup or pointerup too; that applies to both paths and is a separate call.

## Fix

`test/browser/free_writing_repaint.spec.js`: the caret moves from offset 13 to offset 3 with ArrowLeft presses instead of `addRange`, and the test checks the caret is at offset 3 before the repaint. No product code changed.

## Commands and results

- `node scripts/build-layer.js`, then the spec by name:
  - `--project=chromium`: 4 passed
  - `--project=firefox`: 4 passed
  - `--project=webkit`: 4 passed
- Load: 14 busy-loop node processes, `npx playwright test test/browser/free_writing_repaint.spec.js --grep "keeps every run block" --repeat-each 80 --workers 12`: 160 passed (the same load gave the probe 2 misses in 160).
- `npm run gate:unit`: 1797 pass, 0 fail, 2 todo.
- `dist/lahe-layer.js` restored with `git checkout -- dist/lahe-layer.js`; not staged.

## Cleanup needed

- `test/browser/tmp_h1_throttle.spec.js`: scratch, CPU-throttling repro (throttling alone never failed it).
- `test/browser/tmp_h1_probe.spec.js`: scratch, selectionchange-timing probe.
- `test/browser/tmp_h1_forced.spec.js`: scratch, forced-ordering check.
- `node_modules` symlink in this worktree (untracked, never committed).
- `test-results/` from the Playwright runs, if present.
