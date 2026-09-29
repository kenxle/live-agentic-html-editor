# Stop page servers nobody is looking at

Whetstone-size. Part 2 of [GitHub issue 16](https://github.com/kenxle/live-agentic-html-editor/issues/16) (idle reviews cost too much). Part 1, quiet tab polling, is `docs/features/20260928.01_quiet_tab_polling/`, and this branch is cut from it because it reads that change's heartbeat. Progress is at the bottom.

## Summary

The helper now stops a session's page servers once no browser window has been open on any of that session's pages for two minutes. The session itself stays open, so its agent keeps watching and nothing is written to the wake feed. Running `lahe review` on the same document brings the server back, on the same port when it is free, so an old link works again.

## The owner's decision (2026-09-28)

> I don't really mind leaving servers running for open docs, but they should be closed when a session is closed (if they're not used by another open doc/agent)... if there are no browser windows open, then I think we're ok to close... as I'll need to go to the agent or the doc index to ask to get the page back, so those entry points can manage opening the review.

He then confirmed: stop the servers, keep the session open, so its agent keeps watching.

## Before: what is running on this machine

Measured read-only with `ps` on 2026-09-28 at 18:32, counted by `count_servers.py` and `classify_real.py` (session scratchpad; one row per server in `server_rows.csv` and `real_rows.csv`). Nothing was stopped.

| What | Processes | Resident memory |
| --- | --- | --- |
| Page servers, all | 122 | 2,215.1 MB |
| Page servers on the real state directory (32 sessions) | 63 | 786.8 MB |
| of those: session open, a window open now | 15 | 249.2 MB |
| of those: session open, no window open now | 48 | 537.6 MB |
| of those: session closed | 0 | 0 MB |
| Page servers on test or temp state directories (13 sessions) | 59 | 1,428.3 MB |
| All node processes whose command names LAHE | 181 | 6,187.5 MB |

What this says:

- Every real page server belongs to a session that is still open. So "stop servers when the session closes", which the tool already does, frees nothing here. The idle rule is the one that matters.
- 48 of the 63 real servers, 537.6 MB, had no window open. This change stops those.
- 59 servers belong to state directories that tests made and never cleaned up. No helper sweeps those directories, so this change does not touch them. They are a separate problem: test teardown.

## Requirements

1. **Stop a session's page servers after two minutes with no window open.** "Open" means the helper holds a live window for one of the session's reviews: a heartbeat inside its claim window (30 seconds, or 390 seconds for a hidden tab on the slow beat), and no goodbye since. The two minutes are counted from the last moment a window was open.
2. **The grace covers a reload.** A reload sends a goodbye and then a fresh claim. The fresh claim lands well inside two minutes, so nothing stops.
3. **A hidden tab keeps its servers.** A hidden tab beats every five minutes, and the helper holds it for 390 seconds. It counts as open for all of that.
4. **Sessions are separate.** Another session's windows never keep this session's servers running, and never stop them.
5. **The session stays open.** Stopping servers does not close the session, does not touch its monitor, writes nothing to the wake feed, and changes no review history.
6. **`lahe review` brings the server back.** On the same document and session, it starts the stopped server again, on its old port when that port is free and a new one otherwise, and prints the working link.
7. **A freshly handed-out link gets its own two minutes.** A server that `lahe review` just started or reused is not stopped before the reviewer has had two minutes to open the link.
8. **A window that comes back brings its servers back.** When a window claims or beats for a review whose session had its servers stopped this way, the helper starts them again, old port first. This covers a laptop waking after a long sleep, and a hidden second window that was not the holder.
9. **`lahe status` says the server is stopped** and names the command that restarts it. `--json` carries the same fact.
10. **Closing the session still wins.** `lahe session close` on a session whose servers were stopped for idleness marks them stopped by the close, and nothing restarts them until the session is reopened.

## Approach

### The helper (`src/service/idle_servers.js`, new)

- A sweep runs every 30 seconds inside the helper, on an unref'd timer, so it never keeps the process alive.
- The sweep asks the review registry which reviews have an open window (`reviews.openWindowReviews()`: a holder that is not stale by its own claim window, quiet or not). It maps each to its agent session.
- For each open agent session with a running page server:
  - a window open: remember now as the last open time
  - no window: count from the latest of the last open time, the first time the sweep saw this server instance, and the server's `link_given_at` (below). At two minutes or more, stop every running server of the session.
- A stop is written as `stopped_at` plus `stop_reason: "no window open"` on the server's record. The session record is not touched.
- The claim and release routes tell the sweeper a window was active. A release starts the two minutes at the goodbye rather than at the last sweep. A claim for a session whose servers were stopped for idleness starts them again (requirement 8).
- Stops and restarts for one session run one at a time, and a stop re-checks for an open window just before it acts.
- `lahe serve` reads `LAHE_IDLE_GRACE_MS` and `LAHE_IDLE_SWEEP_MS` for tests only. The defaults are 120,000 and 30,000.

### The page server (`src/service/static_servers.js`)

- `start()` asks for the old port first. The server listens there, and falls back to a random port if it is taken. The option name and the argument position match the Library branch (`feat/lahe_library`), which does the same for its Open button, so the two merge cleanly.
- `noteLinkGiven()` stamps `link_given_at` on the server's record. `lahe review` calls it every time it prints a link.
- `stopOne()` takes a reason. A later session close relabels an idle stop as a session close.
- A server stopped for idleness still counts as serving its page when the helper decides whether to write a script line into the file on disk. It is coming back the moment anyone asks, and the line on disk would put a token in the reviewer's working tree.

### Links handed to the reviewer

- `lahe review` is the one command that prints a page link. It already restarts a stopped server; it now asks for the old port and stamps the link.
- `lahe status` prints no page link. It now says when a review's server was stopped for idleness and names `lahe review <document> --session <id>`.
- Redirects between linked documents (`liveUrlFor`) already skip a stopped server.
- The document index is not on main. On `feat/lahe_library`, Open calls `start()` for a stopped server, so it already brings one back. When it merges, Open should also call `noteLinkGiven()`, or a server it reuses can be stopped before the reviewer's page loads.

### What an agent sees

An agent that runs `open <old link>` on a stopped server gets a refused connection. The owner accepts that. `lahe status` tells it the server is stopped and which command brings it back.

## Tests (red first)

Unit, `test/unit/stop_idle_servers.test.js`, with real page servers and an injected clock:

- a session whose last window says goodbye stops its servers after the grace, and not before
- a reload inside the grace keeps them
- a hidden tab on the slow heartbeat keeps them for its whole 390 second window
- another session's open window neither keeps nor stops this session's servers
- a server just handed out gets its own grace
- a window claiming again brings an idle-stopped server back on its old port
- the session stays open, the wake feed and the monitor record are unchanged
- `lahe review` restarts a stopped server on its old port and the page loads
- `lahe status` says the server is stopped and names the command
- `lahe session close` relabels an idle stop, and a claim does not restart a closed session's server

Browser, `test/browser/stop_idle_servers.spec.js`: the real `lahe review` walk with a short grace. Closing the tab stops the server; a reload does not; `lahe review` brings it back and the page loads with the rail.

Then `npm run gate:unit`, and the browser specs covering sessions, takeover, window goodbye and static folders, `--workers=1`.

## Progress

- 2026-09-28: spec written, baseline measured.
- 2026-09-28: built.
  - Unit tests: `test/unit/stop_idle_servers.test.js`, 11 tests. They failed first because `src/service/idle_servers.js` did not exist; the first green run then caught a real bug (a session that never had a window started its grace at every sweep, so it never stopped).
  - `npm run gate:unit`: 1,416 tests, 1,414 pass, 0 fail, 2 todo.
  - Browser: `test/browser/stop_idle_servers.spec.js` passes. With the bundle rebuilt locally (not staged), these specs ran `--workers=1`: 35 passed, 0 failed.
    - `stop_idle_servers`
    - `takeover_walk`
    - `window_goodbye`
    - `static_site_folder`
    - `rail_second_window`
    - `reload_claim`
    - `helper_restart_holds`
    - `serve_time_inject`
    - `markdown_render`
    - `linked_docs_rail`
    - `quiet_tab_polling`
    - `status_truth`
    - `duplicate_tab`
  - Docs: `docs/CONTRACTS.md`, `docs/CLI.md`, `docs/ongoing/SESSION_OWNERSHIP.md`, `docs/diagrams/session_ownership.md`.
  - Not changed: the skill and the review contract. `lahe status` says what to run, so an agent that reads it is told.

- 2026-09-28: review round. Main (with quiet tab polling) merged first; the status conflict keeps both `stopped_servers` and main's per-review `liveness` map. Five fixes, each with a test that failed first:
  1. A stop re-reads the server's record under the lock and writes "stopped" only if the record still names the process it stopped. Before, a server started again in the gap between the kill and the write was marked stopped and orphaned.
  2. `start()` holds an exclusive lock file per server (`ss_<id>.json.lock`), so the helper and `lahe review` starting the same server at once get one server. The lock is released on success and failure, and a lock older than 20 seconds is taken over.
  3. A restart that lands after the session closed stops the server again, as closed.
  4. The sweep forgets server instances and sessions it no longer sees.
  5. `noteWindow` moved below `ownerSessionOf` in `routes.js`, so each doc comment sits over its own function.
  - `npm run gate:unit`: 1,478 tests, 1,476 pass, 0 fail, 2 todo. The 13 browser specs: 35 passed, 0 failed.

- 2026-09-28: second review round. Three fixes, each with a test that failed first:
  1. `stopOne` awaits its guarded write. Before, a lock wait that timed out or a failed write was an unhandled rejection, which ends the helper, and `stopOne` could return before the record said stopped.
  2. A stale lock is renamed aside before it is deleted, and deleted only if what was renamed is still stale. A fresh lock another waiter just wrote is linked back. A holder releases only a lock that still carries its own token.
  3. A start whose wait for the new server times out kills that child, so a late child neither runs unnamed nor writes the record.
  - `npm run gate:unit`: 1,481 tests, 1,479 pass, 0 fail, 2 todo. The 13 browser specs: 35 passed, 0 failed.

## Known limits

- If the old port is taken when a server comes back, it gets a new port. `lahe review` registers the new origin and prints the new link. A restart from a returning window only logs it, and that window's old address stays dead.
- A server that `lahe review` reuses at the exact moment the sweep stops it can hand out a link that is already dead. The window is the few milliseconds of the stop itself, because the stop re-checks `link_given_at` just before it acts.
- In the moment between a waiter renaming a fresh lock aside and linking it back, a third starter can create a new lock, and the link back then fails. The first holder and the third would both hold. It needs a dead starter's stale lock and three more starters inside a few microseconds.

## To delete at cleanup

- `.claude/worktrees/stop-idle-servers/node_modules`: a symlink to the main checkout's `node_modules`, made so Playwright runs in this worktree. Untracked, never staged.
