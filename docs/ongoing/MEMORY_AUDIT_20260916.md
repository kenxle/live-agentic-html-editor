# Is LAHE leaking memory?

Ken asked on 2026-09-16, after Claude Code killed several background monitors for low memory and a sibling session blamed Chrome. His point: a leak in the injected layer would show up as Chrome, not as a LAHE process. This is what was measured and what was found. Numbers come from `ps`, a Playwright soak test, and a Python pass over the event logs on disk.

## Short answer

- The idle page does not leak. A review page left open with the poll loop running held a flat heap, a flat DOM node count, and a flat listener count for four minutes with garbage collection forced before every sample.
- The layer has a handful of small, bounded retention issues. They are worth fixing but they do not explain gigabytes.
- The heavy thing is the per-keystroke event model. Every keystroke in an edit becomes its own event carrying the whole item record. That event is written to browser storage, posted to the helper, appended to the log on disk, and then the helper re-reads the entire log to regenerate review.json. That is where the memory spikes and the disk growth come from.
- Chrome's total is dominated by open tabs, not by LAHE pages.

## What was measured

| Measurement | Value |
| --- | --- |
| Physical memory | 32 GB |
| Compressed memory at the time | 11.97 GB |
| Swap in use | 0 |
| Chrome, all processes | 11.21 GB across 77 processes |
| Claude Code sessions | 2.04 GB across 5 |
| Node processes (MCP servers and others) | 1.97 GB across 56 |
| LAHE: helper, static servers, monitors | 1.34 GB across 13 |
| LAHE helper alone, after 17 hours up | 147 MB |
| One LAHE static server | 35 to 40 MB, the same at 5 minutes and at 4 hours |

Twelve gigabytes compressed with zero swap means the machine is squeezing hard. That is the state where Claude Code drops background tasks. "50% free" in the memory pressure report counts compressible pages as free.

## The soak test

A headless Chromium opened a live review page (the served DOC_STYLE_BUILD render, script line injected, polling the helper) and sampled every 20 seconds after a forced garbage collection.

| Sample | JS heap | DOM nodes | Listeners |
| --- | --- | --- | --- |
| start | 1.45 MB | 824 | 92 |
| 2 minutes | 1.51 MB | 823 | 92 |
| 4 minutes | 1.51 MB | 823 | 92 |

The poll runs once a second while the tab is visible and every ten seconds when hidden. Four minutes is about 240 polls. Nothing grew.

What the soak did not exercise: typing, edits, replay passes after a rebuild, toasts, and conflict cards. Those are the paths the code audit covers.

## The event logs on disk

| Measurement | Value |
| --- | --- |
| Reviews with a log | 383 |
| Total log size | 654 MB |
| Total event lines | 156,917 |
| Of which item.content (one per keystroke) | 144,724 |
| Largest single review log | 84.2 MB, 12,832 content events across 162 items |
| Most content events on one item | 1,515 |

Every item.content event carries the full record, including after_history. So one item that was typed into 1,515 times has its whole record on disk 1,515 times.

The helper regenerates review.json by reading the whole log for that review and projecting it, on every fold and on every change an agent can act on (`regenerate` in `src/service/projection.js`). For the 84 MB review that is an 84 MB parse per flush. The helper's steady RSS is modest because that memory is freed afterward, but each parse is a spike, which is exactly what the sibling session saw: transient spikes, not sustained growth.

## What the code audit found in the layer

Ranked by impact. File and line references are into `src/layer/`.

1. **The outbox grows one full record per keystroke and is re-parsed every poll.** `sync.js` mints a new event id per call, so `store.queueEvent` always appends. `captureTyping` in `editing.js` runs on every keystroke and persists. Entries leave only when the helper acknowledges them. While the helper is up this drains within the 750 ms flush debounce and costs a burst of garbage. If the helper is down or refusing, the outbox grows until browser storage hits its quota, and `writeJson` then throws out of the keystroke handler. Two callers parse the whole outbox on every poll tick (`recomputeStatus`, `pendingCount`).
2. **Whole item store re-read and re-written per keystroke.** `store.write` reads all items and writes all items. Not a leak, but heavy garbage on a review with hundreds of items.
3. **Three module-level maps hold DOM elements and never delete.** `replay.js` `lastElement`, `comments.js` `createdOn`, `editing.js` `itemForElement`. One element per item, but after a page rebuild those elements are detached, and a detached node keeps its old ancestors alive. On a page that rebuilds often this pins old document trees. Bounded by item count.
4. **Conflict card nodes are hidden, never removed** (`replay.js` `conflictNodes`). Bounded by items that ever conflicted.
5. **Two window listeners added on rail mount are never removed on unmount** (`overlay.js`, resize and orientationchange). Each rail rebuild adds two more.
6. **Small monotonic sets:** `toastKeys` (one string per toast ever shown, also blocks a repeat toast), `statusLog` (uncapped, grows fast only when the helper flaps), `pageLife.announced` (one key per replied item).

Clean, checked: all three MutationObservers are disconnected; listeners go through the registry with removal before re-registration; highlight ranges are deleted on clear; every fetch body is consumed and every abort timer cleared; replies-seen is capped at 50; toasts cap at 3.

## What to do about it

In the order I would do them.

1. **Coalesce content events per item in the outbox.** A new item.content for the same item and revision replaces the queued one instead of appending. The record already carries after_history, so nothing about the reviewer's convergence is lost, and the log gets one line per flush pause instead of one per keystroke. This is the change that shrinks the outbox, the log, the projection parse, and the disk at once. It touches the idempotence rule in `store.queueEvent`, which is by event id today.
2. **Stop re-reading the whole log per projection.** Keep the folded projection per review in memory in the helper and apply new events to it, or snapshot the log periodically and read only the tail. Decision D5 (the log is the truth) is unaffected: the log stays the truth, the projection just stops being recomputed from byte zero.
3. **Fix the six retention issues in the layer.** Delete map entries on retire, remove the two window listeners on unmount, cap statusLog, prune toastKeys. Small, mechanical, one builder.
4. **Compact or archive closed reviews' logs.** 654 MB on disk for 383 reviews, most of them closed.
5. **Close stale agent sessions.** Eleven static servers are running across six sessions, several with no watcher. Each is 35 to 40 MB.

Items 1 and 2 change the event model and deserve a short brief before a builder touches them. Items 3 to 5 do not.

## What this does not settle

Whether any of Ken's long-open LAHE tabs is individually large. The Chrome extension was not connected to this session, so per-tab heap could not be read from outside. Chrome's own Task Manager (Window menu, Task Manager) lists memory per tab and would answer it in one look.

## Progress

**2026-09-16, branch `worktree-agent-aa9147257d5b588f7`: fix 1 landed, plus finding 2.** The design note is `docs/ongoing/OUTBOX_COALESCING.md`. What it does:

- **The outbox holds one entry per item per revision, not one per keystroke.** A queued `item.content` for an item is dropped when the next one for that item at the same revision arrives, and the new one goes to the back of the queue. `item.created`, `item.ready`, `item.deleted` and `item.reopened` are never coalesced. Revision is part of the match because the helper composes a thread continuation against `prev.rev + 1`; keystrokes never move the revision, so this costs the saving nothing.
- **The poll tick stops parsing the outbox, and the keystroke stops parsing the items.** Both lists are held in memory in `store.js` beside a small stamp written into storage on every write. A reader compares the stamp it is holding with the stamp on disk, so a write from another tab invalidates the copy here with no window listener and no storage event.
- **A full browser storage no longer throws out of the keystroke handler.** `failures.js` gained `isStorageQuota` and `tolerateStorageQuota`; `editing.js` and `comments.js` use them on the typing path, and `index.js` routes the failure to the rail's failure list. The rail's own `saveChips` tolerates it too, since it writes into the same full storage.

The helper, the log format and the projection are untouched. Fix 2 of the list above, the helper re-reading the whole log on every fold, is still open and is the other half of the 84 MB parse.
