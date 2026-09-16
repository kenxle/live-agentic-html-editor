# The helper stops re-reading every log

Ken said go on 2026-09-16 (fix 2 on the memory audit page, board row LAHE-helper-boot-storm). This is the brief. Progress is at the bottom and updates as the work lands.

## The problem, in plain words

The helper keeps one summary file per review (review.json) that agents read. It rebuilds that file from the review's log, and the log is every message the browser ever sent, one line per keystroke until today's fix. Two things are wrong with how it rebuilds:

- **On startup it rebuilds every review on the machine**, all 400 of them, reading 654 MB of logs in one go before it answers a single request. Every restart today looked like a hang for minutes, every page said "helper not available", and a force-kill only started it over.
- **Every rebuild reads the whole log from the top.** A review with an 84 MB log is parsed from byte zero each time anything changes on it.

## What is already there to build on

Read these first; the brief does not restate them.

- `docs/diagrams/item_lifecycle.md` and `docs/diagrams/merge_on_load.md`: the rules the rebuild must honour (who may move an item's state, and the browser-wins-on-content, store-wins-on-lifecycle rule per revision, decision D5).
- `src/service/log.js` already has `since(reviewId, cursor)`: read only the lines after a point. The rebuild does not use it yet.
- `src/service/projection.js` `itemsFrom` is a single forward pass over events that keeps three pieces of state (items by id, their order, and the revision each reply answered). A pass like that can be paused and resumed if that state is kept.
- `src/service/replies.js` already folds reply files by byte offset, so that half is incremental today.
- The projector (`createProjector` in projection.js) has `watch`, `tickReview`, `tick`, and `discoverReviews`. `tick` is what walks every review.

## The change

1. **Startup rebuilds nothing.** The projector starts with an empty watch list. A review is watched the first time something asks about it (a page poll, an agent's status call, a review read), which the routes already do. `tick` walks only watched reviews and stops calling `discoverReviews`. A review nobody has asked about since the helper started is left exactly as its last rebuild wrote it.
   - The one thing that used to depend on the walk: an agent appending a reply to a review no page is polling. Check that the agent's own `lahe status` or `lahe reply` path touches the review through the helper so it gets watched. If it does not, make the reply route watch it. Do not bring the walk back.
2. **A rebuild reads only what is new.** The projector keeps, per watched review, the fold state from `itemsFrom` plus the small extras the summary needs (the review's times and its source hint) and the log cursor it has folded to. On a tick where the sequence number moved, it reads `log.since(review, cursor)`, folds those events into the kept state, and writes review.json from it. The first rebuild after startup still reads the whole log once for that review; after that, never.
   - The summary must be byte-identical to what a full rebuild from the top would produce. Prove it, not argue it: a test that takes real event sequences (copy a few real logs from `~/.local/state/lahe/reviews` into test fixtures, read-only, including the largest one and one with many replies and rewordings), folds them incrementally in random chunk sizes, and asserts equality with the full fold.
   - Memory: kept state is the items, not the events. Do not cache parsed event arrays.
3. **Nothing else changes.** The log format, the summary file format, the routes, the browser, the reply files, the folding rules. The `regenerate` function stays as the from-the-top path for tests and for a review the projector has no state for.

## What Ken will notice

- Restarting the helper is fast again, and pages stop saying "helper not available" for minutes after a restart.
- Nothing else. Agents read the same file with the same contents.

## Tests

Written first, watched fail:

- Startup with 50 reviews on disk rebuilds none of them; touching one rebuilds only that one.
- The incremental fold equals the full fold on the fixture logs, chunked at random sizes, including a chunk boundary inside a revision bump and one right after a reply.
- A reply appended to a review with no page polling is still folded and lands in review.json.
- The existing projection, replies, status, and routes tests stay green.

## Review

Two independent passes on the diff before merge, because this is the code that decides what agents read: one on the fold equivalence and D5, one adversarial. Unit tests only for the builder and the reviewers; the browser suite runs once on the merged result.

## Not in this change

- Compacting old logs (fix 4). Smaller logs help but this change does not need them.
- Closing stale sessions (fix 5).

## Progress

- 2026-09-16 18:58: brief written, builder dispatched.
- 2026-09-16 19:05: implementation started. Five real logs copied into test fixtures. The largest log on the machine is 88,298,746 bytes, over the builder brief's 20 MB fixture cap, so the largest under the cap was taken instead: 19,483,436 bytes. Equivalence and startup tests written and watched fail, 12 of 14 red.
- 2026-09-16 19:12: builder reported back, unit gate green (1,109 tests). Startup now rebuilds nothing; a review is rebuilt the first time it is asked about and only new lines are read after that. Measured on a 19 MB log: first rebuild 111 ms, every rebuild after it 5 ms, most of which is writing the summary file. Same code path for both the from-the-top and the incremental fold, so they cannot drift.
- 2026-09-16 19:12: held before review. The builder copied five real review logs into the test fixtures to prove the fold matches. Those carry Ken's real comments, the reviewed documents' text, and review tokens, and this repo is public, so they are not being pushed. The builder is redoing the fixtures scrubbed (same shape and lengths, placeholder text, dummy tokens) on a fresh branch so the raw logs never enter history.
- 2026-09-16 19:20: Ken said fix the page-load and status read too, so it joins this change. The builder is doing it on the clean branch after the scrubbed fixtures.
- 2026-09-16 19:40: both review passes are in. The fold itself held up under everything the adversarial pass tried. Two real problems to fix before merge: the reviewer's page still triggers a whole-log read on every event (the poll's cursor sits one step behind and falls to the slow path), and a log that is rewritten or shrunk does not reset the in-memory copy, which matters before log compaction. Builder is on the fix round.
- 2026-09-16 19:42: equivalence tests green. The fold is a value now (`createFold`, `foldEvents`, `projectFold` in `src/service/projection.js`), and `itemsFrom`, `reviewTimes`, `reviewSourceHint` and `project` all run it, so there is one folding implementation rather than two that could drift. Incremental and full folds agree byte for byte at every chunk boundary of all five fixtures, at three random chunkings each, plus every boundary that sits on a revision bump and every boundary right after a folded reply. `log.since` now reads only the bytes after its cursor, in 64 KB chunks, instead of reading the file whole and filtering.
- 2026-09-16 19:45: first `npm run gate:unit` green. lint passed (264 files, no jsdom, manifest complete); 1,111 unit tests, 0 failures, the same 2 pre-existing todos. Measured on the 19,483,436 byte fixture: the first rebuild after startup takes 111 ms and every rebuild after it takes 5 ms, most of which is writing the 171 KB `review.json`. Nothing under `src/` was added, so `src/shared/manifest.js` and `src/shared/review_format.js` are untouched.
- 2026-09-16 20:10: the fixtures are scrubbed, and the raw logs are in no commit that will ever leave the machine. They carried the reviewer's comments, the text of the documents under review, and each review's bearer token, and this repository is public. `scripts/scrub-log-fixtures.js` keeps everything the fold reads (line order, every seq and ts, every event type, item id, revision, lifecycle field, the LENGTH of every string, and the length of `thread` and `after_history`) and replaces every word, path, origin, token and agent name with a deterministic fake. Its table is default-deny: an unnamed field is scrubbed as prose AND reported. Three tests hold the line: the fixtures still match the recorded shape down to each item's max revision; every prose field IS a lorem slice, which nothing a person wrote can be; and the bytes carry no `@`, no url but the minted loopback origins, no hex run of 32 or more, no home path, and no spelling of Ken's name. Work moved to a fresh branch cherry-picked from the base, so no raw log is in this history.
- 2026-09-16 20:58: Ken said fix the routes too, so they are in. `review.read` read the log from the top and folded it TWICE on every call, once for the summary and once to count drafts; the reply poll's outstanding-work count folded it again; the reply folder folded it once per accepted reply line. All three now take the projector's kept fold, which `currentProjection` exposes and `catchUp` brings current before answering. The from-the-top read stays as the fallback for a caller with a partial projection module. Measured on the 19 MB fixture: the first `review.read` takes 118 ms and every one after it under 1 ms, against 90 ms for a single from-the-top read and fold, which the route used to do twice per call. One thing the change turned up: `attach` cached a single projector for whichever state directory called first, which was harmless while nothing read back out of it and is a wrong answer now; it is keyed by directory. `review.end` still folds from the top, deliberately: it runs once in a review's life.
- 2026-09-16 21:05: `npm run gate:unit` green again. lint passed (266 files, no jsdom, manifest complete); 1,120 unit tests, 0 failures, the same 2 pre-existing todos.
- 2026-09-16 23:50: two reviews came back with eight findings, all fixed on this branch. The page's reply poll was still reading the whole log once per event, because the helper ticks the projector first and the page's own cursor is then one behind; the reader keeps a bounded buffer of the events it last scanned and answers from it. A rewritten log was not recognised as a rewrite unless it shrank, so the cursor could land mid-line and skip lines in silence; the reader now checks the size, the inode, the mtime moving without the size growing, the first 256 bytes and the 256 bytes ending at the cursor, and reports a reset through `log.epoch`, on which the projector throws its fold away and refolds from the top. **This is what makes compacting old logs (fix 4) safe to build:** compaction rewrites a log in place under a running helper, which is exactly the case a size check does not notice. A duplicate seq from a second writer and a line with no seq were both being filtered out and lost; either one now forces the from-the-top read. The write gate was `log.currentSeq`, which only moves on this process's appends, so an event from another writer never reached disk; it is the fold's own seq now. And the equivalence proof runs through the real path: three fixtures written into a state directory in byte chunks that cut mid-line, ticking after each write, comparing the bytes of review.json with `regenerate` at every step.
- 2026-09-16 23:55: `npm run gate:unit` green. lint passed (266 files, no jsdom, manifest complete); 1,132 unit tests, 0 failures, the same 2 pre-existing todos. Both reviewers' probe scripts report no failures. Timings unchanged: on the 19 MB fixture the first `review.read` takes 116 ms and every one after it under 1 ms.
- Follow-on noted, not in this change: a page load, reconnect, or `lahe status` on a big review still reads its whole log once (about half a second on the 84 MB one). Same fix, different call site; its own line on the performance page.
