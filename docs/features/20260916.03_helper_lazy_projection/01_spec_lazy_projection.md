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
