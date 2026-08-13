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

### NEW-5 (loud drop of a malformed item event)
RED/GREEN recorded below once implemented.

## Per-finding one-liners
- Finding 24 + NEW-6 committed together (both are in review_format.js, not
  cleanly separable): reply.files typed/capped/bounded; source_hint.note ->
  source_hint.instruction; lost.note -> lost.hint; hint.path bounded.

## Cleanup needed
(none yet)
