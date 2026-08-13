# Fix-seam builder notes

Owns findings 1, 2, 3, 10, 12, 13, NEW-1, NEW-2, NEW-3 of the Phase 5 review.

Files owned: src/layer/sync.js, src/layer/store.js, src/service/reviews.js,
src/shared/merge.js, src/shared/lifecycle.js, src/layer/overlay.js, src/layer/tab_done.js,
src/shared/failures.js, src/layer/index.js, src/shared/record.js, src/shared/protocol.js,
src/service/routes.js (window.claim response glue), docs/CONTRACTS.md (window.claim row).

---

## The window-session state machine (design first, per NEW-2)

Three states a window can be in for one review:

- **HOLDER** — this window owns the review. It has the client Web Lock (when storage
  is shared) and the helper session (when a helper is up). It installs the edit and
  comment handlers, writes items, and RE-POSTS `window.claim` on a heartbeat interval
  (carrying `window_id` + the server-minted `session_secret`) so the helper keeps
  seeing it alive. Stops the heartbeat in `sync.stop`.

- **REFUSED-READ-ONLY (still polling)** — a window that lost the claim. It installs NO
  edit/comment handlers (they are torn down), `recordItem` is a no-op, so it writes
  nothing to the shared bucket. It shows a refusal panel with a "Review here instead"
  button. It keeps a lightweight liveness poll: it re-sends `window.claim` with
  `takeover:false` on an interval. While the holder is alive the poll is refused and
  nothing happens; once the holder's heartbeat has been quiet past `STALE_AFTER_MS` the
  helper auto-grants that same poll, which is D5's 30s auto-takeover, and the window
  transitions to HOLDER.

- **TAKEOVER (manual)** — the reviewer clicks "Review here instead". The read-only
  window re-sends `window.claim` with `takeover:true`. On success it becomes HOLDER
  (re-acquires the client lock best-effort, re-binds editing + comments, hides the
  panel, starts the heartbeat). A holder that gets deposed this way discovers it on its
  next heartbeat (its secret no longer matches) and drops to REFUSED-READ-ONLY.

### The possession decision (NEW-2's open question)

**Takeover is a same-token-trusted action, not a secret-proven one.** Every
`window.claim` already passes D11's per-review token check, and D11 states the token is
the working trust factor. So any window holding the review token may take over (auto,
after stale; or manual, deposing a live holder — that is Ken's "Review here instead").
The `session_secret` is required ONLY to be recognized as the CURRENT holder on a
heartbeat. This is what closes finding 3: knowing the holder's `window_id` (which used
to be disclosed in the 409 body) is no longer enough to masquerade as its heartbeat,
because the heartbeat now needs the secret, which is never disclosed. A rival with the
token can still take OVER (one active window at a time, the holder is deposed), but can
never run as a SECOND concurrent live window, which was the finding-3 hole.

Written into `reviews.js` and `docs/CONTRACTS.md` so a later reader does not re-open it.

---

## Per-finding change log

**Finding 1 (refused window keeps writing).** sync.js: `start()` now inspects the
claim outcome (`finalizeClaim`); on refusal the window goes read-only (`recordItem`
is a no-op, `onRefused` fires). index.js: `enterReadOnly` tears down the edit and
comment handlers and shows the refusal panel. Demonstrated: with the `if (readOnly)
return null;` guard removed, `test/unit/sync_client.test.js` "finding 1: a window
refused the claim goes read-only and writes nothing to the shared bucket" FAILS
("the write path is a no-op in a refused window"); with the guard it passes.

**Finding 2 (heartbeat sent once).** sync.js: a holder runs `startHeartbeat`, which
re-posts `window.claim` (with the session secret) every `heartbeatMs`, and `stop()`
clears it. Covered by the browser rail specs staying green and the session unit test.

**Finding 3 (409 discloses window_id, replayable as heartbeat).** reviews.js: the
holder is identified by a server-minted `session_secret` (constant-time compare),
never the window id; a refusal returns neither the holder id nor the secret. routes.js
+ protocol.js + CONTRACTS.md updated for the new body. Demonstrated: reverting the
heartbeat check to `holder.window_id === windowId` makes
`test/unit/service_helper.test.js` "finding 3: a rival that knows the holder's window
id but not its secret is refused" FAIL ("presenting the holder's id is not proof of
being the holder"); with the secret check it passes.

**Finding 10 (acknowledged never set).** store.js: `markAcknowledged` records the
confirmed rev in a side-table (NOT a field on the item, so it never leaks into a
snapshot/export/review.json); `mergeWithHelper` decorates browser items transiently
so merge.js reaches `SAME_REV_ACKED`; a content write clears the ack. sync.js stamps
it in `flush` beside `store.acknowledge`. Demonstrated: before the stamp,
`test/unit/sync_client.test.js` "finding 10 ..." FAILS; after, it passes (the initial
version stamped a field on the item, which broke ac3_walk's raw-JSON snapshot — moved
to the side-table).

**Finding 12 (Review-here-instead button does not exist).** overlay.js: a refusal
panel with the "Review here instead" button, wired through `onAction("takeover")`.
index.js wires it to `sync.takeover()`. Covered by "finding 12/NEW-2: the refused
window's takeover makes it the holder and lifts read-only".

**Finding 13 (teardown leaks).** index.js `teardown` now calls `sync.stop()` first;
sync.stop clears the heartbeat and liveness timers too.

**NEW-1 (reopen keeps same rev).** tab_done.js: `reopenItem` uses `record.bumpRev`.
Demonstrated: without the bump, `test/unit/done_tab_replies.test.js` "NEW-1:
reopening bumps the rev ..." FAILS ("reopen bumps the rev"); with it, a stale same-rev
fold is refused and the reopen survives.

**NEW-2 (the four C1 fixes cancel).** State machine written first (above). Decision:
takeover is same-token-trusted; the refused window keeps a liveness poll (`startLiveness`)
that becomes D5's auto-takeover when the holder goes stale.

**NEW-3 (corrupt meta.json silently dropped).** reviews.js: the token now rides the
REVIEW_CREATED event; `loadFromDisk` fails loud (helper log + stderr) and recovers the
token and origins from the log. Test: "NEW-3: a corrupt meta.json on restart is
recovered from the log, loudly, not silently dropped".

## Extra fix found while implementing (not a numbered finding)

Same-tab navigation of one review used to mint a NEW window id per page load, so the
helper (still holding the previous load's session, not yet stale) refused the reload
as a second window. With findings 1/2/3 enforcing read-only on refusal, that would
have made every navigation read-only. Fix: the window identity and the session secret
now live in `sessionStorage` (store.js), so a same-tab navigation re-presents them and
is recognized as the holder's heartbeat, while a genuinely new tab gets a fresh
sessionStorage and is correctly refused. This is what makes the copy_export and
ac2_walk two-page walks pass.

## Gate + lanes

- `npm run lint`: pass. `npm run test:unit`: 409 pass, 0 fail.
- `npm run gate:builder` (Chromium): 149 passed, 1 skipped, 0 failed.
- `LAHE_ALL_BROWSERS=1` on rail_second_window, agent_replies, rail_durability,
  rail_status: 42 passed (14 tests x 3 lanes), 0 failed.

## Cleanup needed

- `test/browser/_dbg_seam.spec.js` — emptied debug scratch spec; delete it.
- `/tmp/reviews_fixed.js`, `/tmp/sync_fixed.js`, `/tmp/sync_noguard.js`,
  `/tmp/mine_*.js`, `/tmp/sync_dbg.js` — throwaway copies used for the demonstrated
  failures; outside the repo, safe to leave or delete.
