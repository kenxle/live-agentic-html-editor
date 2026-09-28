# Phase 1, Task 1.3: static server restart, stale origins, Host check

**Status:** done on branch `task/lib-restart`, off `feat/lahe_library` at `000c40b`. `npm run gate:unit` green: 1333 tests, 1331 pass, 0 fail, 2 todo (both pre-existing in `anchor_cases.test.js`). Browser: `test/browser/static_site_folder.spec.js` 4 of 4 pass on Chromium.

## What was built

- A static server takes a preferred port and falls back to a random one when that port is taken.
- Each `ss_*.json` record keeps `ports`, every port it has listened on, oldest first, with no repeats.
- `staticServers.createCatalogOps({dir, reviews, sessions})` returns the two helper-side functions 2.1 calls:
  - `reopenForCatalog(sessionId, serverId)`: reopens the session if closed, restarts that one server (old port first), registers its two loopback origins on every review it serves, and removes the loopback origins of its earlier ports from those reviews.
  - `closeQuiet(sessionId)`: stops the session's static servers and marks it closed. Prints nothing and never stops the helper.
- `reviews.removeOrigin(reviewId, origin)`: removes one origin, rewrites `meta.json`, and appends `origin.removed` to the review's log.
- `recoverFromLog` applies `origin.removed` in order with `origin.registered`.
- The Host check on every static server: only `127.0.0.1:<its port>` and `localhost:<its port>`. Anything else, including a missing Host, gets a plain 400 before any path is looked at. That covers pages, the reserved library route, the health probe, and 404s. This closes board row LAHE-static-server-host-check.

## File by file

- **`src/service/static_servers.js`**
  - `start()` takes `preferredPort` and passes it to the child as one more argument.
  - `runServer()` listens on the preferred port. On `EADDRINUSE` or `EACCES` it listens on 0 instead. It keeps the port history in the record. A record written before `ports` existed gets its history seeded from its one `port`, so its old origin can still be removed.
  - `hostIsOwn(host, port)`: the Host check, exported for tests and 1.2 if wanted. It pins the port, which is narrower than the helper's own `protocol.hostAllowed`.
  - `restartAll()` now also prefers each server's old port (see Deviations).
  - `createCatalogOps()`, with `reviewsServedBy()`: a review counts as served by a server when it belongs to the session and one of its recorded targets is under the server's root or logical root. Mounts are left out, since they hold read-only linked documents and never a review.
  - The stale set is the two loopback origins of each earlier port in `ports`. A port another unstopped server of the same session is on right now is skipped. Non-loopback, dev-server and other-server origins are never in the set.
- **`src/service/reviews.js`**
  - `removeOrigin()` refuses anything but `http://127.0.0.1:<port>` or `http://localhost:<port>`. The rule is also enforced here, so a caller with a wrong list cannot remove a dev server's https origin, a named host, or `"null"`.
  - `recoverFromLog()` handles `origin.removed`.
- **`test/unit/static_restart.test.js`** (new, 14 tests). They cover every item on the plan's "Restart, origins and Host (1.3)" test list, plus these:
  - reopen of a closed session
  - already-up server starts nothing
  - only the named server restarts
  - an unknown or unsafe server id is refused
  - `closeQuiet`
  - remove-then-register order after a log rebuild
  - the `removeOrigin` guard
  - a reused port is kept
  - `restartAll` prefers the old port

  "A POST from the old origin is refused" is checked through `protocol.checkRequest` with the registry's `config()`, which is the function `auth.js` runs for every request.

## Deviations

- **`lahe session reopen` now prefers the old port too.** `restartAll` goes through the same `start()` path, so the CLI reopen brings a server back on its old port when it is free. Before this, it always took a random port. That new port was never registered on the review, so the rail on a reopened page was refused. The old port's origin is already registered, so this change only fixes things. The CLI reopen still does no origin swap when the old port is taken. It cannot, because the registry lives in the helper process. Its output text is unchanged.
- **API shape.** The plan names `reopenForCatalog(sessionId, serverId)` and `closeQuiet(sessionId)`. They need the helper's in-memory review registry, so they come from a factory, `createCatalogOps({dir, reviews, sessions})`, which 2.1 builds once in `index.js` with the helper's `reviews`. The two functions keep the plan's signatures.
- **Return value of `reopenForCatalog`:** `{server, started, origin, reviews, registered, removed}`. `origin` is `http://127.0.0.1:<port>`. 2.1 appends the page path to build the Open URL.

## Surprises

- A test that holds a port with a plain `net` server hung the whole file. The restart's health probe connected to the holder, and closing the holder waited on that socket forever. The test holder now drops every connection at once. This was test-only; production code was not affected.
- A Host of `[::1]:<port>` is refused now. It could never reach these servers anyway, since they bind `127.0.0.1` only.

## Follow-ups (not in this task's scope)

- `docs/CONTRACTS.md` (owned by 1.2) should list the `origin.removed` event. 1.2's spec already includes that row.
- `docs/ongoing/SERVING_ARCHITECTURES.md` and `STATIC_SITE_FOLDER.md` say nothing about the Host check or the preferred port. A line in each would help the next reader. Suggested for 3.4 or the close-out.
- Board row LAHE-static-server-host-check: the orchestrator claimed it on main. It can be closed when this merges.
- Phase 1 seam test (orchestrator): every 1.1 fixture row marked `openable: yes` restarts under `reopenForCatalog`. The fixture's `ss_*.json` records need a `root` that exists on disk for `start()` to succeed.

## Cleanup needed

- `node_modules` in this worktree is a symlink to the main checkout's `node_modules`, made to run the browser spec. It is untracked and not committed. Remove it when the worktree is torn down.
- `/private/tmp/claude-501/.../scratchpad/dbg.js` and `ss.bak`: scratch files under `/tmp`. They are left for the OS to clear.
