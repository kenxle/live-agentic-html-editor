# Stop writing unsent drafts so often

Whetstone-size. Part of the [performance and token work](../../ongoing/MEMORY_AUDIT_20260916.md). The analysis behind it, and Ken's decisions, are in [where unsent comments are saved](../../ongoing/DRAFT_PERSISTENCE.md). Progress is at the bottom.

## Summary

While you type an unsent comment, LAHE saves it far more often than it needs to: the browser rewrites every comment on every keystroke, the helper gets a copy about once a second, and each of those copies makes the helper rewrite and force to disk a file agents read, even though drafts never appear in it. This change keeps every protection you asked for and removes the waste. Your typing is still saved in the browser on every keystroke.

## Requirements

1. **The helper stops rewriting `review.json` when nothing in it changed.** A draft save no longer rewrites or flushes that file. It is still rewritten, safely and in full, whenever anything an agent can see changes. (Analysis option d1.)
2. **The browser stops rewriting every comment on every keystroke.** A keystroke saves only the comment being typed, in its own storage key. An index key lists the review's comments in creation order and is touched only on create and delete. Write order is: the comment's key, then the index, then one stamp for the whole review, so a crash never leaves a comment nothing lists. The old whole-list key is merged in whenever it is present (per comment, newest by revision then by `updated_at`), only by the tab holding the review's lock, never by a read-only tab, and it is not deleted in this release: an old tab that is mid-unload, or takes the review back, can still write or read it. (Option d2.)
3. **The browser still saves every keystroke.** Requirement R1 (nothing you type is lost to a reload, tab close, or navigation) still holds, from browser storage alone.
4. **Unsent drafts go to the helper rarely.** At most once every 10 seconds while typing, plus the risky moments: leaving the comment box, hiding the tab, and leaving the page. Never once per pause. The floor lives inside `flush`, which every sender goes through (the typing timer, the poll loop, the follow-up after a post), and it is a maximum wait, not a timer that resets on every keystroke. It holds back an item's queued events only when all of them are drafts, so a ready event never posts ahead of its own older draft. Held items stay held on blur and tab-hide. Ken: losing a few seconds of typing to a computer crash is acceptable. (Option c with Ken's floor.)
5. **Drafts wait their turn; committed work never does.** After a post finishes, drafts queued during it wait for the floor. A commit asked for during a post is remembered and sent the moment the post finishes, and the flush timer always keeps the earliest deadline it has been given. (Option d4, first half; `sync.js` around lines 1829 and 1928.)
6. **Typing into a reopened edit does not mark it ready.** A ready hand edit is withdrawn to draft on the first keystroke that changes its text, not on opening it, the way comments already work, and is restored when its text matches the committed wording again. Committing it bumps the revision, decided from whether it was new when opened (or its history), never from whether it is currently a draft, so the agent sees a new revision and a reply to the old wording is refused as stale. Handled edits are left alone. (Option d4, second half; `editing.js` around line 1093.)
7. **Committed work is unchanged.** Pressing Cmd-Enter, releasing Hold, and ending a review still send immediately.

## Approach

No new subsystem. Three gates on existing calls plus one storage layout change:

- `src/service/projection.js`, `tickReview` (around lines 514 to 537): write only when the projection changed, compared without `generated_at`, against the last bytes this process wrote. The baseline starts empty when the helper starts (so a contract-text upgrade is always written), and the file is written whenever it is missing. Comparing output is safer than inspecting event types, because it can never skip a write that mattered.
- `src/layer/store.js`: one key per comment plus an index key, one stamp per review, and the merge-when-present rule for the old key (requirement 2).
- The outbox is still queued per keystroke (one coalesced entry per comment, from the outbox work). Task 6 measures it; if it dominates what is left, sending drafts from the stored comments at flush time is the follow-up.
- `src/layer/sync.js`: drafts flush on the 10 second floor and on blur, tab-hide, and unload; lifecycle events (ready, created, deleted) keep flushing as they do today. `protocol.FLUSH` already declares `blur`; tab-hide is new.
- `src/layer/editing.js`: reopening a handled or ready edit sets it back to draft while open.

Rejected for now: sending only the changed fields (option d3). It changes the log format and gets its own spec. Keeping drafts out of the helper entirely (option b): the 10 second backup is cheap and keeps a crash copy.

## Tasks

1. Projection writes only on real change. Tests: a draft-only event leaves `review.json`'s bytes and modified time untouched; a ready event rewrites it; a reply rewrites it.
2. Per-comment browser storage. Tests: a keystroke writes one comment key and nothing else; creation order survives; a crash between the comment key and the index loses nothing; the old whole-list key merges whenever present, only in the lock-holding tab, and is not deleted; an old-bundle unload write after migration still lands; two store instances over one storage see each other's writes.
3. Draft flush cadence. Tests with a fake clock and the poll loop running: continuous typing posts at most once per 10 seconds; blur, tab-hide, and unload post at once; Cmd-Enter posts at once, including when pressed during an in-flight post; a ready event never posts ahead of its own older draft; with Hold on, blur and tab-hide post nothing.
4. Queued-during-post waits its turn. Test.
5. Reopened edit. Tests: opening without changing text changes nothing; the first changing keystroke withdraws it; typing it back restores it; commit bumps the revision; a reply naming the old revision is refused; a crash while withdrawn does not drop the committed wording from the page or `review.json`.
6. Measure before and after on one scripted typing session (a few hundred characters across a few comments): storage writes and bytes, helper posts, `review.json` rewrites. Put the table on this page.

## Acceptance criteria

- [ ] A draft save does not rewrite `review.json`.
- [ ] A keystroke writes one comment to browser storage, not the whole list.
- [ ] Continuous typing sends the helper at most one draft copy per 10 seconds.
- [ ] Leaving a box, hiding the tab, or leaving the page sends the draft at once.
- [ ] Cmd-Enter, Hold release, and ending a review still send at once.
- [ ] Typing into a reopened edit never marks it ready before commit.
- [ ] Before-and-after numbers on this page.
- [ ] `npm run gate:unit` green; full suite green once at merge.

## Progress

- 2026-09-22: spec written from Ken's decisions on the analysis page.
- 2026-09-22: Ken approved ("if you feel like this is a thorough writeup, you can continue"). One architecture review (`review-architect`) found two blockers and three important issues, all integrated above.
- 2026-09-22: task 1 done. `tickReview` compares the projection (without `generated_at`) with the bytes this process last wrote and skips the write when they match and the file exists. New `test/unit/review_json_skip.test.js` (5 tests); the draft-only test was red before the change.
- 2026-09-22: task 2 done. `store.js` keeps one key per item (`lahe.item.v2:<review>:<item>`), an index (`lahe.index.v2:<review>`, ids in creation order plus the ids deleted here that the old key still carries), and one stamp per review. The old `lahe.items.v1` key is merged per item on every cold read and whenever its stamp moves; only the lock holder writes the merge down, and taking the lock drops the held copy so an unstamped old-bundle write lands too. New `test/unit/store_per_item.test.js` (12 tests; 7 red before). One addition the spec did not name: a delete records the id in the index as removed when the old key still has it, or the next merge would bring the deleted comment back. Three older tests that read the old key directly now read the new keys (`store_item_cache.test.js`, `storage_quota_typing.test.js`, and the rail harness's durability read).
- 2026-09-22: tasks 3 and 4 done. `protocol.FLUSH.DRAFT_FLOOR_MS` is 10000 and `IMMEDIATE_ON` gains `hide`. `flush` holds back an item only when every queued event for it is a draft and its last draft post was under 10 seconds ago; the floor is a fixed deadline from that post, so the first draft of an item goes within the 750 ms debounce and then at most once per 10 seconds. `scheduleFlush` keeps the earliest deadline. A flush asked for during a post is remembered and runs when it finishes; the follow-up after a post goes through the floor. New `sync.flushNow(reason)`: tab-hide calls it, and the comment surface calls it through a new `onLeave` hook when its input loses focus or the box closes. One reading the spec left open: Cmd-Enter sends its own item at once but leaves other items' young drafts on their floor; leaving (blur, hide, navigation, unload) sends everything. New `test/unit/draft_flush_cadence.test.js` (12 tests; the typing, floor, blur, hide, ordering, Hold-on and queued-during-post tests were red before, the Cmd-Enter ones already passed and stay as guards). `docs/CONTRACTS.md` flush policy updated.
- 2026-09-22: task 5 done. `editing.js` records, when a block opens, the wording it opened with, whether the edit was ever committed (not a draft, or has history), and whether it was ready. A keystroke on a ready edit sets draft when the wording differs from that and ready when it matches, and posts as content (`existing`), so no more `item.ready` per keystroke. Commit bumps the revision when the edit was ever committed. Two things the spec did not spell out: reopening and leaving with the wording unchanged no longer bumps the revision (it used to, on every reopen); and a crash while withdrawn is handled by a new `editing.recoverWithdrawn()`, which boot runs once the window holds the review: it commits the withdrawn edit as leaving the page would have (new revision, ready, the typed words kept), then schedules replay. New `test/unit/reopened_edit.test.js` (7 tests; 6 red before).

## Design review, 2026-09-22

Accepted and integrated: withdraw a reopened edit on its first changing keystroke and bump its revision on commit (was a blocker: the same-revision rule would have hidden the reopen and let a stale reply land); the 10 second floor inside `flush` so the poll loop cannot bypass it (was a blocker); commits never wait behind drafts; the old storage key merged whenever present by the lock holder only, never deleted this release; an index key with a crash-safe write order; `review.json` compared against this process's last write, baseline empty at start, written when missing.
Settled rather than changed: the outbox stays per keystroke for now, measured in task 6.
