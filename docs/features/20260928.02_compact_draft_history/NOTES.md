# Compact draft history

A one-time repair for log bloat the tool caused. Before the draft write-cost fix ([spec 20260922.01](../20260922.01_draft_write_cost/01_spec_draft_write_cost.md)), the browser posted the whole record on about every keystroke. The result is long runs of `item.content` events marked `draft: true`, each one replaced by the next. `scripts/compact_draft_history.js` drops those and keeps everything else byte for byte, in order.

## Summary

- On a copy of this machine's 515 reviews, the dry run takes the logs from 733,973,648 bytes (700.0 MB) to 79,309,320 bytes (75.6 MB).
- It drops 152,829 events. Every one is a draft snapshot that the same item's next `item.content` replaces.
- 238 reviews have something to drop. All 238 pass the projection check. None fails.
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

As a separate check, I ran `--apply` on the full scratch copy. I then re-read all 238 compacted logs with the helper's own reader (`createEventLog().read`). I compared `project()` and `itemsFrom()` against the original restored from each `.gz`. All 238 matched.

## The write

For each review with something to drop, `--apply` does these steps in order:

1. It gzips the original to a temp file and fsyncs it. It reads it back and confirms it restores the exact bytes. Then it renames it to `events.jsonl.pre-compact.gz`.
2. It writes the compacted log to a temp file in the same folder, mode 0600, and fsyncs it.
3. It stats `events.jsonl` again. If the file changed since it was read, the script undoes its own temp and backup files and leaves the review alone.
4. It renames the temp file over `events.jsonl`, fsyncs the folder, and reads the log back to confirm the bytes.

The script never writes `review.json`, `meta.json`, or reply files. If `events.jsonl.pre-compact.gz` already exists from an earlier run, the review is left alone, so the true original is never overwritten.

To restore a review: `gunzip -c events.jsonl.pre-compact.gz > events.jsonl`, with the helper stopped.

## Never racing the helper

The helper holds no per-review lock that a script could take. `windows.json` records which page window holds a review. It is not a file lock on the log. So the script refuses to run when either of these is true:

- `service.json` names a pid that is alive
- any static server record under `agent-sessions/*/static-servers/` is unstopped and names a pid that is alive

The refusal names each process and how to stop it: `lahe session close <session-id>` (the last close also stops the helper), or `kill <pid>`. A pid that answers counts as running even if it might be a reused pid. A wrong "running" only costs a refusal. A wrong "stopped" could lose an event. The re-stat before each rename is a second guard, against a writer that starts after the check.

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
- `3`: done, but at least one review was left alone (the report says why)

## Dry-run totals from a copy of the real state

I copied `~/.local/state/lahe/reviews` to a scratch folder. Then I ran `node scripts/compact_draft_history.js --state-dir <scratch>`. Every number below is the script's own output.

| | |
| --- | --- |
| Reviews | 515 |
| Reviews with drafts to drop | 238 |
| Bytes before | 733,973,648 (700.0 MB) |
| Bytes after | 79,309,320 (75.6 MB) |
| Events dropped | 152,829 of 156,365 draft `item.content` events |
| Kept as an item's last draft | 3,310 |
| Kept by rule 2 (next event not `item.content`) | 226 |
| Kept by rule 3 (fold would differ) | 0 |
| Kept by rule 4 (order would move) | 0 |
| Projection check passed / failed / nothing to drop | 238 / 0 / 277 |

The dry run took 4.9 seconds of wall time.

I then ran `--apply` on the same scratch copy. It swapped all 238 logs. The 238 backups take 55,844,734 bytes (53.3 MB) of gzip, so the folder holds 128.9 MB in total until the backups are removed. A second dry run over the compacted copy found nothing to drop.

A small side effect: the compacted logs have gaps in `seq`. Readers use seq only as an "after this" cursor, so gaps are safe. The one visible effect: the reply poll's in-memory tail buffer can fall back to a full read when a page's cursor sits inside a gap. That is slower, but the answer is the same.

## To delete at cleanup

Nothing. The scratch copies used for the numbers above live under `/private/tmp`, which the operating system owns.
