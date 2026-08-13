# fix-intent notes (D12 data-vs-intent path)

Owner: fix-intent worktree, branch `task/fix-intent`.
Findings owned: 7, 8, 22, 24, NEW-4, NEW-5, NEW-6.

## Where the agent-name bound landed
Finding 22: bounded in `src/layer/tab_done.js` (the two boundData calls in
`agentMessageFor`), NOT in the projection layer. Reason: the browser rail's
`item.reply` is populated by the sync/poll path (sync.js, off-limits), not by
`review_format.projectItem` (that is the server-side agent file). There is no
projection/replies layer I own on the rail path, so the minimal self-contained
tab_done edit is the correct chokepoint. Kept to exactly the two boundData
calls so the fix-seam builder's merge stays trivial.

## Demonstrated RED -> GREEN

### Finding 7 (the `change` field) — test/browser/editing_change_intent.spec.js
RED (before wiring editChangeText into commit):
```
Error: the edit commit populates the intent field
expect(received).not.toBeNull()
Received: null
  > 71 |     expect(item.change, "the edit commit populates the intent field").not.toBeNull();
```
GREEN (after commit sets change = record.editChangeText(kind, before.text, after.text)):
```
✓ a committed edit sets `change`, and the projection carries it verbatim (1.4s)
✓ a long edit keeps its intent whole while the page-text field is bounded (401ms)
2 passed
```
The real edit produces `change` = `Added "..."` and the projection carries it
verbatim; a >2000-char edit keeps `change` whole while `after_full` is bounded.

### NEW-4 (title bound + field_classes align) — test/unit/review_format.test.js
RED (before fix):
```
not ok 6 - a long page title is bounded at the group header, with the marker visible
not ok 7 - field_classes names the fields the projection emits, and no stale ones
# fail 2
```
GREEN (after boundData(title, CONTEXT_MAX) + explicit PROJECTED_FIELD_CLASS):
```
# pass 24
# fail 0
```

### NEW-5 (loud drop of a malformed item event) — test/unit/projection_review_json.test.js
RED (before fix): `not ok 4 - a malformed item event is reported, not silently dropped (NEW-5)`.
GREEN (after threading onDropped through itemsFrom -> project -> regenerate ->
projector.reportDropped, deduped by event_id + helperLog): `# pass 13 # fail 0`.
Note: full parity with the reply path (a rejected EVENT + a rail chip) would
require a new event type in protocol.js EVENT_TYPES (frozen wire, off-limits)
and a chip in overlay.js/index.js (off-limits). The fix makes the drop LOUD via
the helper log diagnostic (deduped), which removes the "no log" asymmetry the
finding names; the reject-event/chip parity is left as a wire-owned follow-up.

### Finding 8 (log injection) — test/unit/log_injection.test.js
RED: both assertions failed (a newline forged a 2nd physical line; no cap).
GREEN after adding sanitizeLogLine chokepoint in log.js helperLog (escape
C0/C1 controls, cap length) + JSON.stringify/cap of attacker-controlled values
at the auth.js call sites: `# pass 2 # fail 0`. The chokepoint closes the
confirmed review-id-newline vector even though it enters via protocol.js:340's
refusal builder (off-limits, off my file list).

## Per-finding one-liners
- Finding 7: edit commit now sets `change` via record.editChangeText(kind,
  before, after) (the changed span stated in one line; delete + format_only get
  their own sentence). The tool's primary gesture ships a real, verbatim,
  non-truncated intent field instead of null.
- Finding 8: log.js helperLog neutralizes C0/C1 control chars + caps length (one
  chokepoint, covers the protocol.js review-id vector I can't edit); auth.js
  JSON.stringify+caps the request-supplied values.
- Finding 22: bounded agent name + rejection reason in tab_done.js (the two
  boundData(CONTEXT_MAX) calls). Landed in tab_done.js, NOT the projection layer,
  because the browser rail's reply comes from sync.js (off-limits), not the
  server-side projectItem. Kept to exactly the two calls for a trivial merge.
- Finding 24: reply.files typed to strings, count capped (REPLY_FILES_MAX=100),
  each entry bounded (review_format.js).
- NEW-4: page.title bounded with the marker; PROJECTED_FIELD_CLASS rewritten to
  name the emitted fields (title/origin/path/region_label, dropped
  after_history/region.label/page_title/page_path).
- NEW-5: a malformed item event is now reported via a deduped helper-log
  diagnostic (onDropped threaded itemsFrom -> project -> regenerate -> projector).
- NEW-6: source_hint.note -> source_hint.instruction; lost.note -> lost.hint;
  hint.path bounded. `note` now means exactly one thing (an intent field).

Findings 24 and NEW-6 share review_format.js and were committed together (not
cleanly separable).

## Gate
`npm run gate:builder` GREEN: lint passed; unit `# tests 409 # pass 409 # fail 0`;
browser `151 passed, 1 skipped`.
```
  1 skipped
  151 passed (25.7s)
```

## Cleanup needed
- None requiring deletion. Note: `dist/lahe-layer.js` was rebuilt locally to run
  the browser tests and is intentionally left UNSTAGED (builders never commit
  dist; the orchestrator rebuilds/commits it at the checkpoint). `package-lock.json`
  is also modified (npm install) and left unstaged.
