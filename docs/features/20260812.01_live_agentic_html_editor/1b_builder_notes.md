# 1B builder notes: the library shell

Worktree `../lahe-worktrees/1b`, branch `task/1b`. Owns `src/layer/store.js`,
`src/layer/sync.js`, `src/layer/overlay.js`, and ranked tests 6, 12, 19, 21, 22, 25, 33.

## What this task is

Three files and one law.

- `store.js` is browser storage: written synchronously on every keystroke, keyed by review id, and
  it holds the durable outbox the sync client drains.
- `sync.js` is everything about talking to the helper: post per event, re-post what was never
  acknowledged, retry forever, never block the reviewer, tell a CSP refusal apart from a helper that
  is down, and poll for replies.
- `overlay.js` is the rail chrome in a closed shadow root: tab shell, status line, failure chips, and
  the card API. Tab contents are other people's files.

The law: **the rail updates in place, and a card holding focus is never re-created.**

## Log

(kept in order, newest at the foot)

### Starting state read

- `protocol.js` is the wire contract and is imported, never retyped: `FLUSH.HELPER_DEBOUNCE_MS`
  (750ms), `FLUSH.IMMEDIATE_ON`, `FLUSH.TRANSPORT_ON_UNLOAD` (keepalive fetch, never `sendBeacon`),
  `FLUSH.KEEPALIVE_MAX_BYTES`, `REPLY_CURSOR_FIELD` (a `seq`, never a timestamp), and the route
  table.
- `sync.js` as landed reads `protocol.SESSION.ON_401`, a symbol 0A-wire removed on purpose. That is
  the deliberate breakage marking this file as mine to rework.

### The demonstrated failure (ranked test 12, the law 1B owns)

Written first, watched fail against the stub rail (no DOM at all), then made to pass. The
demonstration the plan asks for is the one-line revert: make `upsertCard` treat every call as a
creation, which is exactly what "the rail rebuilds its cards" means.

```diff
--- a/src/layer/overlay.js
+++ b/src/layer/overlay.js
       var id = item[record.FIELD.ID];
-      if (!cards[id]) {
+      if (true) {
```

```
  ✘  1 [chromium] › test/browser/rail_focus.spec.js:34:3 › a focused card survives twenty repaints
       with its node, focus and text intact (401ms)

    Error: expect(received).toBe(expected) // Object.is equality
    Expected: "itm_75e2109529949f355d470c14"
    Received: null

      44 |     const before = await page.evaluate((id) => window.__laheRail.activeInfo(), opened.id);
    > 45 |     expect(before.cardId).toBe(opened.id);
  1 failed
```

The failure reads exactly like the bug: the card the reviewer is typing into is not the card on
screen any more, so nothing holds focus. Reverted, the same run is three passes.
