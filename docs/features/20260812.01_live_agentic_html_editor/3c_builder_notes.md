# 3C builder notes: copy and export

Branch `task/3c`, worktree `../lahe-worktrees/3c`. Cut after CP2.

## What was built

`src/layer/export.js` (new, the task's one file) plus the wiring that makes the rail's two
buttons do something.

**The public API, as pinned in the dispatch, unchanged.** 3D can build against it as written:

- `copyReview()` — resolves the scope live, renders, writes to the clipboard. Returns a promise of
  `{ok, action, scope, text, characters}` or `{ok: false, code: "COPY_FAILED", error}`.
- `exportReview()` — the same text, downloaded as a `.txt` file. Returns
  `{ok, action, scope, text, filename}`.
- `renderReviewText({records, scope, review})` — pure, synchronous, returns the text.
  `scope` is `"full"` or `"slice"`; anything else throws rather than defaulting.
- `exportRecords(records, options)` — the seam 3D's Edits-tab list export calls.
  `options`: `{scope?, download?, filename?, label?}`. With no `scope` it resolves the live one
  the buttons get; with `download: false` it renders and saves nothing. Returns a promise.

Also on the module: `SCOPE`, `SLICE_LABEL`, `filenameFor()`, `createExport()`, `configure()`,
`recordsFromBody()`, `unionById()`. On an instance: `scopeNow()`, `records()`, `last()`.

**The namespace key is `LAHE.exporter`**, and the same object is also published as `LAHE.export`
so a caller who looked the file up in the manifest finds it under its filename too. One object,
two names.

All text comes from `shared/review_format.js`'s `renderText`. Nothing in `export.js` formats a
record. The formatter was not touched and needs no change: it renders records, and both scopes
render the same records.

### The two scopes, and how "reachable" is decided

Decided LIVE at the moment of the click, never from a remembered status. `sync.status()` is read
first and settles one case on its own (a CSP refusal, where no fetch from this page can reach the
helper anyway); everything else is settled by asking the helper on `review.read`, with a 2s
deadline.

- `200` — the helper answered for this review. **full**.
- `501` — the projection route is 3A's and is not built yet, so the helper answers "not
  implemented". The helper is up and talking, and this file does not need the projection to
  render, so this counts as reachable: **full**. **The seam:** when 3A lands, the same call starts
  returning a body, and `recordsFromBody()` picks up records from it with no change here.
- `401 / 403 / 404` — the helper is up but this page cannot see this review. That is not the whole
  review, so it is **slice**, labeled.
- no answer at all (dead, suspended past the deadline, refused) — **slice**, labeled.

A cached "stored" from thirty seconds ago is exactly the reading that would label a dead helper's
export as the whole review, which is why the probe is live and not a status read.

**Where the records come from.** Today: this browser's, from `store.read(review)`, which is keyed
by review id and so already spans every page of the review on this origin (both pages show up in
the export, asserted in the spec). When the helper hands back record-shaped items,
`unionById()` folds them in under D5's rule: the browser wins its own content, a later revision
from the helper wins the id. A projection is deliberately NOT de-projected into records: its data
fields are already bounded, and re-bounding a bounded value truncates it a second time, which
would break the byte-identity the done bar is scored on.

### No false success (R11)

A copy that did not reach the clipboard resolves `ok: false` and puts a persistent chip in the
rail's failures list. Same for an export the browser would not save. Nothing here reports a
success it did not have.

## Files changed

| File | What |
| --- | --- |
| `src/layer/export.js` | NEW. The whole task. |
| `src/shared/manifest.js` | The one pre-authorized edit: `export.js`'s `planned: true` flipped off, same commit. |
| `src/shared/failures.js` | **Not mine, flagged below.** Added `COPY_FAILED` and `EXPORT_FAILED`. |
| `src/layer/index.js` | **2D's, and in scope per the dispatch.** Wires the rail's Copy and Export to the exporter, publishes it on `__lahe`. |
| `test/browser/copy_export.spec.js` | NEW. Ranked test 34. |
| `test/unit/export_text.test.js` | NEW. The pure half: scope rule, label, filename, union, the failure chip. |

`dist/lahe-layer.js` was rebuilt locally to run the browser spec and is **not** committed, per the
dist rule.

### The two edits outside my file, both deliberate

1. **`src/shared/failures.js` (0A-wire's, NOT frozen in the manifest).** There was no code for a
   copy or an export that did not happen, and R11 is only checkable if there is one vocabulary for
   what failed, so inventing a local code in `export.js` would have been the second definition the
   file exists to prevent. Two entries appended at the end of `CODES`, both
   `blocking / persistent / failures_list`. If the orchestrator would rather these arrive some
   other way, they are two contiguous blocks and trivially moved.
2. **`src/layer/index.js` (2D's).** The dispatch put the connecting line in scope, and it was
   needed: `overlay.onAction(name, fn)` exists and nothing in boot ever called it, so both buttons
   were live chrome with no handler. Three things were added, all inside `boot()`: build the
   exporter, `configure()` it as the module-level shared instance, and register the two handlers.
   Plus `exporter` on the boot handle and on the published `__lahe` global, which is how a spec
   reads whether the last click actually succeeded.

## Ranked test 34, and the demonstrated failure

`test/browser/copy_export.spec.js`. Everything under it is real, in the CP2 walk's sense: 0C's app
fixture on its own origin, one script tag, `index.js` booting itself, 1A's helper with a real
minted token, three records made by the reviewer's own gestures across **two pages** of the
application, and `kill -9` for the stop.

**It reads the export through the real controls, never the formatter.** The rail lives in a closed
shadow root, so the spec takes a node the rail hands out (`rail.tabBody("active")`), asks it for
its root with `getRootNode()`, finds the button by the label a reviewer reads, and dispatches a
real click on it. Copy is then read back off the **system clipboard** with a Playwright
`clipboard-read` grant; Export is read out of the **downloaded file** via the `download` event.
The only thing the spec imports from the library is the `SLICE_LABEL` constant, which is the
string it has to look for.

**The three lanes.** The clipboard-read grant is a Chromium capability; Firefox and WebKit have no
equivalent and asking throws. So the copy half runs on Chromium and the download half runs on all
three: every lane still reads an export through a real control end to end, and no lane skips the
test. Stated in the spec's header too.

### The failing run, against a one-line deliberate revert

The revert (drop the slice label, keep everything else):

```diff
     var body = review_format.renderText({ id: reviewId, items: opts.records });
     if (opts.scope === SCOPE.FULL) return body;
-    return SLICE_LABEL + "\n\n" + body;
+    return body;
```

Rebuilt `dist/` and re-ran:

```
      265 |
      266 |       // The slice label is there, and it is the ONLY difference. Byte for byte.
    > 267 |       expect(sliceDownload.text, "with nothing running the export says what it is").toContain(exporter.SLICE_LABEL);
          |                                                                                     ^
      268 |       const withoutLabel = sliceDownload.text.slice((exporter.SLICE_LABEL + "\n\n").length);

  1 failed
    [chromium] › test/browser/copy_export.spec.js:169:3 › Copy and Export: the same review, with the helper
    and without it › the same records export to the same bytes running and stopped, and only the stopped one
    carries the slice label
```

The failure output printed the whole downloaded file, which is worth recording because it is the
positive control on the rest of the assertion: the export really did carry both pages and all
three records, the reviewer's words verbatim and the page's words as data.

```
3 items, 3 ready, 0 still draft, 0 handled, 0 not handled.

Page: Coach dashboard | Steady Thread coaching / (http://127.0.0.1:59952)
Source unknown. Nobody has told this tool what generates this page. ...

comment itm_1824bba23abc6f76b4a16df6 rev 1 (ready)
  Where: Coach dashboard, p 1
  Note (the reviewer's words): This number needs a unit. Nine what?
  Quoted from the page: Nine clients checked in this week. ...

edit itm_ca22ecb01219460078833bb2 rev 1 (ready)
  Where: Today's focus, p 1
  Before (page text): The two people to reach before lunch are Devon, ...
  After (page text, with the edit): ... Say which client to text first, and say it here.

Page: Clients | Steady Thread coaching /clients (http://127.0.0.1:59952)
...
comment itm_1cae969edb33b13645418da7 rev 1 (ready)
  Where: h1 1
  Note (the reviewer's words): The notes column is doing two jobs. Split it.
  Quoted from the page: Clients
```

Reverted the revert, rebuilt, green again.

## The gate

`npm run gate:builder`, run synchronously, tail:

```
lint passed (syntax: 143 files, no jsdom, manifest complete)
# tests 347
# pass 347
# fail 0
  1 skipped
  128 passed (20.8s)
```

The one skip is pre-existing and not mine.

## For the orchestrator

- `src/shared/failures.js` and `src/layer/index.js` are edited outside my file; both are argued
  above. The `failures.js` one is the one worth a second opinion.
- 3D needs no change to the pinned API. `exportRecords(records, {download: false})` gives it the
  text without saving a file, and `{scope: "slice"}` lets it name its own scope for a subset list.
- When 3A's projection lands and `review.read` starts answering 200 with a body, nothing here has
  to change; `recordsFromBody()` only folds in items that are record-shaped, so a projection body
  keeps rendering the browser's records.

## Cleanup needed

Nothing was deleted. For the Phase 4B batch:

- `test/unit/consumer_3c_export.test.js` — the throwaway stub consumer 0A-kernel committed for
  this task. Its own header already puts it on the batch; 3C has now landed, so it is due.
- `test-results/` in this worktree — Playwright artifacts from the deliberate-revert run. Already
  gitignored, so this is disk only.
- `/tmp/export.js.keep` — the copy of `export.js` held while the revert was demonstrated.
