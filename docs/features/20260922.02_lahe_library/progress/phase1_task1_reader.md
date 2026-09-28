# Phase 1, Task 1.1: catalog reader and catalog store

**Summary:** Done on branch `task/lib-reader`. The reader builds the Library's list from the state dir, the store owns `catalog.json`, and both have a committed fixture. `npm run gate:unit`: 1368 tests, 1366 pass, 0 fail, 2 todo. The two todos are older tests in `anchor_cases.test.js`, not this task's. Three things need the orchestrator: the servesPath split, how 2.1 passes the attach record and requests in, and one new top-level list field.

## What was built

- `src/service/catalog_store.js`: reads and writes `catalog.json`.
  - Handles stars, and the `reopened` map with `handoff_rev`.
  - Writes through the state dir's write-beside-and-rename.
  - The file is owner-only.
  - A corrupt, wrong-shape or symlinked file reads as `PROTO_CATALOG_UNREADABLE`. Every write is refused with the bytes left as they were.
- `src/service/catalog_reader.js`: `createReader({dir, ...})` returns two functions:
  - `list(now)` (async): the `catalog.list` response.
  - `describeReview(reviewId, now)` (sync): `{review, session, display_name, title, path, kind, openable, candidate}`. This is for the drain and for `session name --from-review`.
- `test/fixtures/catalog_state/`: the committed fixture state dir.
  - It holds 28 reviews across 7 sessions plus legacy.
  - It includes the documents those reviews point at.
- `test/fixtures/catalog_state.js`: installs the fixture into a temporary directory.
- `test/fixtures/catalog_state_build.js`: writes the fixture, using the real record, event and projection code.
- `test/fixtures/catalog_list.json`: the reader's output for the fixture. A test asserts the two are equal. Run that test with `LAHE_WRITE_CATALOG_LIST=1` to rewrite the file.
- Tests:
  - `test/unit/catalog_store.test.js`: 9 tests.
  - `test/unit/catalog_reader.test.js`: 40 tests. These cover every item under "Reader and store (1.1)" in the Test List.
- `src/shared/manifest.js`: `planned` is removed from this task's two lines.
- `src/shared/protocol.js`: one line, `MONITOR.HEARTBEAT_FIELD.PRIMARY = "primary"`. The orchestrator asked for it; it is identical to 1.4's line, and one copy is kept at merge.

## File-by-file rationale

- **Reader inputs from 1.4 are injected, not read.**
  - `attachment(now)` returns `{session, at}` or null.
  - `requestFor(reviewId, now)` returns the latest request or null. It has the shape `{id, action, at, for, state, by?, text?, answered_at?}`.
  - The EM review (RF5) gives `readAttached` and `requestFor` to 1.4 and the join to 2.1. So this module never opens `catalog-attach.json` or `catalog-requests.jsonl`.
  - The reader does its own part of the join:
    - it names the agent (`by_name`)
    - it turns an attach into `{session, name, watching}`
    - it treats an attach with no session on disk as no agent
    - it hides an answer at `ANSWER_SHOWN_MS`
- **Liveness goes through `agent_sessions.livenessFrom`** and nothing else. The reader passes only the session and its heartbeat, with no activity and no feed answer. The result's `listening` is then true exactly when the heartbeat is fresh, on this handoff rev, and its pid is alive. The boundary is `livenessFrom`'s own: fresh at `HEARTBEAT_FRESH_MS`, stale one millisecond later.
- **`last` is the log's modified time.** The log is append-only, so its modified time is its newest event, and the reader never has to read a log to get it. This is why the fixture sets every modified time.
- **Re-projection** happens when a review's log is newer than its `review.json` (or the `review.json` is missing or corrupt), and the log is at most `REPROJECT_MAX_BYTES`.
  - The reader projects in memory with `projection.project`. It writes nothing.
  - The log is parsed here, not through `log.js`. `log.load` creates directories and truncates torn tails, and a reader must not change files.
- **Cache:** results are cached per file, keyed on modified time plus size. This covers `meta.json`, `review.json`, `session.json`, `monitor.json`, the `ss_` records, `catalog.json`, and the re-projection (keyed on the log).
- **Probes** use `static_servers.isExactServer` by default.
  - They run in parallel.
  - Each is cached for one `POLL_MS` from `now`.
  - Records with `stopped_at` set are never probed.

## Deviations

1. **`openable` does not call `servesPath` itself.**
   - `servesPath` also asks whether the server is running right now: a live pid and no `stopped_at`.
   - Open's whole purpose is to restart a stopped server. Calling `servesPath` would make every closed review `via-agent`. It would also break 1.3's seam test, which expects fixture rows with no live servers to be `openable: yes`.
   - So the reader has its own copy of the other half of `servesPath`: the rule for which files a server's root and mounts cover.
   - A test makes every record look live and checks that the two agree on every row whose file is on disk.
   - **Follow-up for the orchestrator:** export that half from `static_servers.js` (1.3's file), have `servesPath` call it, and delete my copy. Then the rule is written in one place.
2. **One new top-level field: `notice`.** It is `null`, or `"PROTO_CATALOG_UNREADABLE"` when `catalog.json` is corrupt. The page can look up the remedy in `failures.js`. This is the "notice" the Test List asks for; the architecture's response shape had no field for it.
3. **One new row field: `project`.** The Page Spec's row shows `project / folder / file`, and the architecture only put `projects` on sessions.
4. **Folded rows:**
   - `file` is `null`, and `title` and `display_name` are the folder's name.
   - `counts_as_of` is the row's `last`, unless a folded part's counts are stale. Then it is the oldest stale part's time.
5. **Unreadable `meta.json`:** the row goes in the session named by its `review.json`, or legacy if that is unreadable too.
   - It shows `openable: missing`, `kind: dev-server`, and `file: null`.
   - Its display name falls back to the title, then to the review id.
6. **Corrupt `ss_*.json`:** the reader cannot tell which review the record served. So every row in that session that no readable record covers is marked `unreadable`. `static_servers.list` throws for the whole session, so the reader reads the records one by one with the same shape check.
7. **The oversized log is made at install time.** The install stretches the file past the limit with `fs.truncateSync`, instead of committing 5 MB. The read counter proves the reader never reads it.
8. **`kind` for a review no recorded server covers is `dev-server`.** This includes a static page whose `ss_` record is gone. That is rare, and the agent's reply to a dev-server row still asks the right question.

## Surprises

- `servesPath` checks whether a server is running, which is why deviation 1 exists.
- `record.isUnansweredReady` exists and is the one rule for "waiting". The reader uses it, so the Library's count matches `lahe status` and the rail.
- Reviews with no comments have no title. A review's title comes from its items' page titles, so an empty review shows `folder / file`. This matches the architecture's rule, and it happens often in the fixture.

## Follow-ups

- **Orchestrator:** export the coverage half of `servesPath` (deviation 1).
- **2.1:** wire 1.4's `readAttached` and `requestFor` into `createReader({attachment, requestFor})`. If 1.4's request object uses different names than the shape above, adapt it in 2.1's join.
- **2.2:** the page should handle `notice`, row `project`, and a folded row's `file: null`. All three are in `catalog_list.json`.

## Cleanup needed

Nothing to delete. Every temporary directory is under the OS temp folder.
