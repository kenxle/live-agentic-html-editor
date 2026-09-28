# Phase 2, Task 2.1: routes, helper lifetime, drain text, log lines

**Summary.** Done on branch `task/lib-wiring`, off `feat/lahe_library` at `6c872d7`. The Library's four API routes are real, the helper builds every Library piece once, the last `session close` leaves the helper up while the Library is open, the reopened-session sweep runs on a helper timer, the drain names each request's document, and every action writes one `catalog` log line. `npm run gate:unit`: 1492 tests, 1490 pass, 0 fail, 2 todo. The two todos are the older `anchor_cases.test.js` ones. Nothing in scope was punted.

## What was built

- **The four routes.** `catalog.list`, `open`, `star` and `request` hand straight to a new module, `src/service/catalog_actions.js`. It joins the reader, the store, the queue and the static-server restart; it adds no rule of its own.
- **One of each piece, built in `index.js`:**
  - the queue: `createQueue({dir, writeExpired: true, log})`, the only one that records an expired line
  - the reader: wired to the queue's `readAttached` and `requestFor`
  - the ops: `createCatalogOps({dir, reviews, sessions})`, so Open uses `reopenForCatalog` and the sweep uses `closeQuiet`
- **`catalog_seen_at`.** The list handler calls `deps.catalog.markSeen(now)` after an authenticated list, and only then.
- **Helper lifetime.** The last `lahe session close` reads `catalog_seen_at` from `health`. It leaves the helper up if the Library polled within `LIBRARY_SEEN_MS`, or if a document window is held.
- **The sweep.** `sweepReopened(now)` runs every `POLL_MS` on a helper timer. It closes a Library-reopened session after `REOPENED_AUTOCLOSE_MS` of quiet, with the three exemptions, and clears the entry.
- **Drain text.** `lahe status` fills `kind`, `title`, `path`, `candidate` and `handoff` from the reader's `describeReview` by default.
- **`lahe session name <id> --from-review <review>`.** It names the session after the review's display name, read by the CLI.
- **The log line.** One `catalog <action> review=<id> age_days=<n>` line per Open, Star, unstar, Pick up and Launch, stamped with the helper's clock. The captured week is committed as `test/fixtures/catalog_log.txt` for 3.3.
- **`SERVICE_CONTRACT` is 14.** See "The contract bump" below.

## The seven seams from Phase 1

1. **One coverage rule.** `static_servers.coveragePath(meta, file)` returns the URL path a file has on a server (root, logical root, or a mount), or null. `servesPath` is now "running right now" plus `coveragePath`. The reader calls it and its own copy is gone. The reader's agreement test now checks `openable` against `coveragePath`; a new `static_servers` test checks `servesPath` against it.
2. **Reader wired to 1.4.** Two shape differences, both adapted in the reader:
   - `requestFor` from 1.4 already fills `by_name` and carries no `by` or `for`. The reader now uses `by_name` when present, and still names a bare record itself.
   - `readAttached` from 1.4 carries its own `watching`, judged by the queue's liveness rule. The reader now takes it. Before, the header could say "watching" while Open said "no agent" (see Surprises).
3. **`describeRequest`.** `status.catalogEntries` defaults to a describer built on the reader. One reader per drain, made only when a request exists, so an idle monitor poll scans nothing.
4. **The helper's queue** is built with `writeExpired: true` and the helper log.
5. **The 501 placeholders** are gone. `markSeen` is called only after an authenticated list.
6. **`createCatalogOps`** is built once in `index.js`; Open uses `reopenForCatalog`.
7. **The contract bump:** yes, to 14. Details below.

## The contract bump

`SERVICE_CONTRACT` went from 13 to 14. The reason is written above the constant in `protocol.js`, and a new test checks every contract has such a line.

- A helper from before the Library has no `/catalog` and none of its API.
- It never replays `origin.removed`, so a restarted server's stale origins would come back after its own restart.
- It runs no sweep and reports no `catalog_seen_at`.
- Without the bump, `startHelper` keeps an old helper in place whenever a reviewer has a page open on it. `lahe library` would then print a URL that answers 404. With the bump, a lower contract is always replaced.

## File by file

- **`src/service/catalog_actions.js` (new).** `createCatalogActions` returns `list`, `open`, `star`, `request` and `sweepReopened`. Each takes `now`.
  - **Open, in order:**
    1. unknown or missing: `PROTO_NOT_OPENABLE`
    2. a `via-agent` row: its Open is the pick-up. It needs `handoff` and a live agent, and answers `url: null`.
    3. the owner check on the recorded files
    4. the confirm step, before anything starts
    5. `reopenForCatalog`
    6. `reopened` is recorded only if the session was closed before
    7. the pick-up is queued, or `not_asked` says why not
  - **Star:** through the store; a corrupt `catalog.json` is `PROTO_CATALOG_UNREADABLE`.
  - **Request:** ids only. It needs a live agent, and the confirm step applies.
  - **Log lines:** every other line this module writes starts with "Library", so no count script mistakes it for an action.
- **`src/service/index.js`.** Builds the Library pieces and the sweep timer. It takes four test-only options: `now`, `pidAlive`, `uid` and `schedule`. The handle exposes `sweepReopened(now)`.
- **`src/service/routes.js`.** The four handlers call `deps.catalogActions` with `deps.now()`.
- **`src/service/catalog_reader.js`.**
  - It uses `coveragePath`.
  - It adapts to 1.4's two shapes.
  - `describeReview` also returns `server`, `url_path`, `served_path`, `watching` and `last`. Open needs all five, and the reader already had them.
- **`src/service/static_servers.js`.** `coveragePath` is exported; `servesPath` calls it.
- **`src/service/log.js`.** `helperLog(line, at)` takes an optional time, so catalog lines carry the helper's clock.
- **`src/cli/commands/session.js`.** `helperStillWanted(dir, now)` is the lifetime rule, and `name --from-review` is added. The review must belong to the named session.
- **`src/cli/commands/status.js`.** `readerDescriber`, the default describe step. `handoff` is the rail's own `handoffMessage` for the document's session. A `legacy` session gets the "run `lahe session list`" form.
- **`src/shared/protocol.js`.** `SERVICE_CONTRACT = 14`, with its reason.
- **`src/shared/manifest.js`.** An entry for `catalog_actions.js`.
- **`docs/CONTRACTS.md`.** Under the D11 amendment, two new parts:
  - what each API route takes and answers, including the `PROTO_NOT_OPENABLE` reasons and the `not_asked` values
  - the sweep

## Tests

- `test/unit/catalog_routes.test.js` (new, 25 tests). A real helper in-process, with its clock injected and real static-server children. It covers every Open, request, list, Star, sweep and log item on the plan's 2.1 test list, plus the sweep timer. It also writes the log fixture.
- `test/unit/catalog_lifetime.test.js` (new, 4 tests). A real helper process started the way the CLI starts one. It covers the pair at 1:59 and 2:00, the held window, the plain stop, and R10a (the helper stays up after the last session closes, and the opened document still takes a comment).
- `test/unit/status_catalog.test.js`: 3 new tests plus one updated.
  - the drain's names from the reader
  - the fence test: a title with `"}]}`, a newline and a forged entry stays one entry
  - the candidate cases: outside the repository, hidden, symlinked out, not a page
- `test/unit/session_names.test.js`: 2 new tests for `--from-review`.
- `test/unit/catalog_reader.test.js`:
  - 3 new tests: the queue wiring, the `watching` agreement, and the `describeReview` fields
  - 1 test rewritten, the coverage agreement
- `test/unit/static_servers.test.js`: 2 new tests for `coveragePath`.
- `test/unit/protocol_wire.test.js`: 2 new tests for the contract.
- `test/unit/catalog_auth.test.js`: the two 501 assertions now check that the answer came from the handler, not the check block.

Each new test ran red first, for the reason it names. The sweep was written before its tests. So I stubbed it out, watched all five sweep tests fail, and restored it.

## Deviations

- **A new module, `catalog_actions.js`, instead of growing `routes.js`.** The plan lists `routes.js`. The architecture names "Service, catalog routes and request queue (new)" as its own component, and `routes.js` is already 800 lines. The route handlers are four one-line calls into it.
- **`log.js` changed:** `helperLog` takes an optional time. Without it the log fixture would carry wall-clock times, and 3.3's counts could not be pinned.
- **`agent_sessions.js` is untouched,** though the plan lists it. The sweep reads monitor liveness through `livenessFrom`, which already exists.
- **Open on a `via-agent` row.** The plan's test list wants `PROTO_NOT_OPENABLE` for "no recorded server". The architecture wants `PROTO_NO_AGENT` for a `via-agent` Open with no agent. Both hold:
  - without `handoff`, it is `PROTO_NOT_OPENABLE` with reason `via-agent`
  - with `handoff` and no live agent, it is `PROTO_NO_AGENT`
  - with `handoff` and a live agent, it queues the pick-up and answers `url: null`
- **The owner check is tested with an injected uid.** `chown` needs root, so the test serves the helper with `uid` set to another user rather than skipping.
- **A taken-over session's `reopened` entry is dropped** by the sweep, not kept. It is an agent's session now and can never be swept again.
- **`not_asked: "request_pending"`** is a third value, for an Open whose review already has a pending request. The architecture names only `no_agent` and `queue_full`.
- **Session close with a held window now leaves the helper up.** This is the architecture's rule. Before, a held window did not stop a close from stopping the helper.

## Surprises

- **The reader and the queue disagreed about liveness.** The reader judged `attached.watching` from the heartbeat alone. The queue also counts a closed session as not listening, and a recent command as listening. The fixture's `s_index` is closed with a fresh heartbeat: the header said "watching" while Open would say "no agent". The reader now takes the queue's answer when the attach carries one.
- **A log line starting "catalog open" is an Open to any script that greps.** The actions' own error lines were first written that way, so they now start with "Library".

## Follow-ups

- **3.1:** `docs/CLI.md` and the skill need `lahe session name --from-review` and the lifetime rule. The session command's usage text already has it.
- **3.1:** the drain's `title` is the row's display name, not the raw title, so it is never null for a real row. The skill should say so.
- **2.2:** Open's answer can be `url: null` with a `request_id` (a `via-agent` row). `not_asked` can also be `request_pending`.
- **Orchestrator:** `check:layer` will be stale, since `protocol.js` ships in the bundle. I did not rebuild or commit `dist/`.
- **Performance, not urgent.** The reader calls `requestFor` once per row, and each call re-reads `catalog-requests.jsonl`. For a few hundred reviews that is a few hundred small reads every `POLL_MS`. Reading the queue once per list would fix it.

## Cleanup needed

Nothing to delete in the repo. Test state dirs live under the OS temp folder. One scratch file, `sweep_body.js`, is in the session scratchpad under `/tmp`.
