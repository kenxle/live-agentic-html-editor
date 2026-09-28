# Compact draft history

A one-time repair for log bloat the tool caused. Before the draft write-cost fix ([spec 20260922.01](../20260922.01_draft_write_cost/01_spec_draft_write_cost.md)), the browser posted the whole record on about every keystroke. The result is long runs of `item.content` events marked `draft: true`, each one replaced by the next. `scripts/compact_draft_history.js` drops those and keeps everything else byte for byte, in order.

## Summary

- On a fresh copy of this machine's 515 reviews, the dry run takes the logs from 734,024,360 bytes (700.0 MB) to 79,351,026 bytes (75.7 MB).
- It drops 152,834 events. Every one is a draft snapshot that the same item's next `item.content` replaces.
- 239 reviews have something to drop. All 239 pass the projection check. None fails.
- The dropped event_ids are listed beside each log, and the helper counts them as already seen. So a browser re-posting a dropped draft cannot bring it back.
- The script refuses to run while the helper or any static server is running.
- It is a dry run unless you pass `--apply`.

## The rule

The script drops an event only when all four of these hold:

1. It is `item.content` with `draft: true`, and it carries a usable record.
2. The next event in the log for the same item is also `item.content` with a usable record. That next event is the one that replaces it.
3. Folding that next event gives the same item, the same reply revision, and the same place in the item order, with or without the draft before it. The script checks this with the repo's own fold (`foldEvents` in `src/service/projection.js`), run on just that item's part of the fold state.
4. Sometimes the item has no state yet when the draft arrives: its first sighting, or its first after a delete. In that case no other item's record event may sit between the draft and the event that replaces it.

Every other event stays:

- every committed record
- every reply
- every lifecycle event
- the last draft snapshot of each item, so an unfinished comment the reviewer never sent survives

## Why rules 2 to 4 exist: what can change the result

I read the fold in `projection.js` for each shape the brief named. Most of them cannot change:

- **`after_history`, `created_at` (which becomes `card_first_created_at`), the note, the region.** The fold takes each record whole from the newest event. It never merges fields across events. Dropping an earlier snapshot cannot change these.
- **Revision numbers.** These also come whole from the newest record, so they cannot change either.
- **Deletes and reopens.** These only ever touch the item's current record. Rule 2 keeps any draft whose next event for its item is a delete, reopen, reply, or `item.ready`. So these always read exactly what they read before.

Three shapes can change the result, and each has a rule:

- **A reply lands between the draft and its replacement (rule 2).** `reply.folded` is accepted only when it names the item's current revision. That revision comes from the draft when the draft changed it. Drop the draft and the same reply can be accepted or refused differently. The next content event then keeps or loses that reply. This happened 226 times across the real logs, and those drafts are kept.
- **The reviewer answers an agent's question (rule 3).** The fold has a continuation branch. When a record arrives at one revision past an item that has a reply, with one more round in its thread, the fold copies the helper's reply into that round. Suppose the draft starting the answer is at the new revision, and the replacing event is at the same revision. With the draft, the fold patches the draft and then takes the replacing event's thread as sent. Without the draft, the fold would patch the replacing event instead. So the thread can differ. The item's same-revision rule for replies (D5's merge on the helper's side) has the same dependency on the revision and reply that the draft leaves behind. Rule 3 catches both by folding the item's next event both ways and comparing. No real log hit it (0 times), but the test fixture for it fails the proof without the rule.
- **Item order (rule 4).** The fold lists items in first-seen order. If a draft is an item's first sighting and another item is first seen before the replacing event, dropping the draft would move this item after that one. No real log hit it (0 times).

## The proof

Before the script swaps any file, it reads both logs with the helper's own line parser (`protocol.parseEventLine`). It skips the same lines `log.js` skips: empty, unreadable, and a torn final line. It folds each log from the top with the repo's projection code and compares:

- the whole fold state: every item with drafts included, the item order, the reply revisions, the review's times, the source hint, and the highest seq
- the `review.json` bytes from `projectFold`
- the list of malformed item events the fold reports

If anything differs, the review is left untouched and the report says what differed.

**Ignored fields:** only `generated_at`. `projectReview` stamps it with the current time on every projection, so both sides get the same pinned value. `linked_files` is not ignored. The proof passes no static-server lookup to either side, so both sides build the same map from the items' page paths, and those paths are compared.

As a separate check, I ran `--apply` on a second scratch copy. I then re-read all 239 compacted logs with the helper's own reader (`createEventLog().read`). I compared `project()` and `itemsFrom()` against the original restored from each `.gz`. All 239 matched.

## The write

For each review with something to drop, `--apply` does these steps in order:

1. It opens `events.jsonl` and holds that handle to the end. It reads the log through the handle.
2. It gzips the original to a temp file and fsyncs it. It reads it back and confirms it restores the exact bytes. Then it renames it to `events.jsonl.pre-compact.gz`.
3. It writes the dropped event_ids to `events.jsonl.compacted-ids`, one JSON string per line, fsynced, by temp file and rename. (See the next section.)
4. It fsyncs the folder, so both renames are on disk before the log is touched.
5. It writes the compacted log to a temp file in the same folder, mode 0600, and fsyncs it.
6. It stats `events.jsonl` again. If the file changed since it was read, the script undoes its own files and leaves the review alone.
7. It renames the temp file over `events.jsonl`.
8. It checks the old file's size through the held handle. If the old file grew, the script copies the new bytes onto the new log, and repeats until the old file stops growing. The report counts these bytes.
9. It fsyncs the folder again and reads the log back to confirm the bytes.

Once step 7 has happened, the script never removes the backup or the id list. If anything fails after that point, it still copies any late bytes. It reports the review as "applied, but ... check the log", names the backup, and exits with code 3.

**fsync on macOS.** Node has no separate call for `F_FULLFSYNC`, and none is needed. `fs.fsyncSync` goes through libuv's `uv__fs_fsync`, which on Apple already calls `fcntl(F_FULLFSYNC)`. If the file system refuses that, libuv falls back to `F_BARRIERFSYNC` and then `fsync(2)`. That is in libuv's `src/unix/fs.c`; Node 20.19 ships libuv 1.46.0. I could not trace the system calls to confirm it on this machine, because `dtruss` needs root.

The script never writes `review.json`, `meta.json`, or reply files. If `events.jsonl.pre-compact.gz` already exists from an earlier run, the review is left alone, so the true original is never overwritten.

To restore a review, stop the helper and run `gunzip -c events.jsonl.pre-compact.gz > events.jsonl`. You can leave `events.jsonl.compacted-ids` in place. Every id in it is back in the log, so the helper would count it as seen anyway.

## Re-posted drafts: the id list the helper reads

The helper's log reader keeps a set of every event_id on disk. When an event arrives with an id already in that set, the helper answers "duplicate" and appends nothing. Browsers rely on this. The browser keeps each event in its outbox until the helper acknowledges it, and re-posts it on the next load. A page closed mid-post never reads the answer, so it re-posts events that are already on disk.

Without the id list, a dropped draft's id would leave that set. A browser re-posting it would get it appended as new, after the commit that replaced it. The item would fall back to an old draft that the agent never sees. The reviewer reproduced this.

So `src/service/log.js` now reads `events.jsonl.compacted-ids` in `load()`, the first time a process touches a review, and adds every id to the seen set. It reads the file again whenever it notices the log was rewritten. The helper only ever reads this file; the compaction script is its only writer. It is on disk, so it holds across helper restarts, and every CLI command that opens the log reads it too. `src/service/state_dir.js` names the file (`compactedIdsPath`). The test re-posts a dropped id through two fresh log readers, standing in for a helper restart. Both answer "duplicate", and the item stays at its committed revision.

On the applied scratch copy, the id lists for all 239 reviews total 4,737,854 bytes (4.5 MB).

## Never racing the helper

The helper holds no per-review lock that a script could take. `windows.json` records which page window holds a review. It is not a file lock on the log. So the script refuses to run when either of these is true:

- `service.json` names a pid that is alive
- any static server record under `agent-sessions/*/static-servers/` is unstopped and names a pid that is alive

The refusal names each process and how to stop it: `lahe session close <session-id>` (the last close also stops the helper), or `kill <pid>`. A pid that answers counts as running even if it might be a reused pid. A wrong "running" only costs a refusal. A wrong "stopped" could lose an event.

That check cannot see `lahe add` or `lahe review`. Both can append to a log with no helper up. Two guards in the write cover them:

- The re-stat before the rename (step 6) leaves the review alone if the log changed after it was read.
- The late-append copy (step 8) catches anything that lands between that re-stat and the rename, or reaches the old file after the rename.

A running helper would also cope with the rewrite. `log.js` sees the inode change and re-reads the log from the top.

## How to run it

```
node scripts/compact_draft_history.js                    # dry run, every review
node scripts/compact_draft_history.js --review <id>      # dry run, one review
node scripts/compact_draft_history.js --apply            # do it
node scripts/compact_draft_history.js --state-dir <path> # like the rest of the tool
node scripts/compact_draft_history.js --json             # the same report as JSON
```

Exit codes:

- `0`: done
- `1`: a usage error
- `2`: refused, because something is running
- `3`: done, but at least one review was left alone or needs its log checked (the report says why)

## Dry-run totals from a copy of the real state

After the review fixes, I copied `~/.local/state/lahe/reviews` to a fresh scratch folder. Then I ran `node scripts/compact_draft_history.js --state-dir <scratch>`. Every number below is the script's own output.

| | |
| --- | --- |
| Reviews | 515 |
| Reviews with drafts to drop | 239 |
| Bytes before | 734,024,360 (700.0 MB) |
| Bytes after | 79,351,026 (75.7 MB) |
| Events dropped | 152,834 of 156,375 draft `item.content` events |
| Kept as an item's last draft | 3,315 |
| Kept by rule 2 (next event not `item.content`) | 226 |
| Kept by rule 3 (fold would differ) | 0 |
| Kept by rule 4 (order would move) | 0 |
| Projection check passed / failed / nothing to drop | 239 / 0 / 276 |

The dry run took 5.86 seconds of wall time.

I then ran `--apply` on a second copy of that folder:

- It swapped all 239 logs.
- It copied 0 late bytes.
- It flagged 0 reviews to check.

Space on that copy after the swap:

| | |
| --- | --- |
| Compacted logs | 79,351,026 bytes (75.7 MB) |
| The 239 gzip backups | 55,849,204 bytes (53.3 MB) |
| The 239 id lists | 4,737,854 bytes (4.5 MB) |
| Total, until the backups are removed | 139,938,084 bytes (133.5 MB) |

A small side effect: the compacted logs have gaps in `seq`. Readers use seq only as an "after this" cursor, so gaps are safe. The one visible effect: the reply poll's in-memory tail buffer can fall back to a full read when a page's cursor sits inside a gap. That is slower, but the answer is the same.

## To delete at cleanup

Nothing. The scratch copies used for the numbers above live under `/private/tmp`, which the operating system owns.
