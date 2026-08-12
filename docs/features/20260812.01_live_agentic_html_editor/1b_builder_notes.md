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
