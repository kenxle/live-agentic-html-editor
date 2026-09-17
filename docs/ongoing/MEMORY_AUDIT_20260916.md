# LAHE: performance and token work, one page to follow

Ken asked on 2026-09-16, after Claude Code killed several background monitors for low memory and a sibling session blamed Chrome. His point: a leak in the injected layer would show up as Chrome, not as a LAHE process. This is what was measured and what was found. Numbers come from `ps`, a Playwright soak test, and a Python pass over the event logs on disk.

## Where this stands (updated 2026-09-16 19:55)

This is the one progress page for all of the memory, CPU, and token work. The merge record for the first batch is in `docs/ongoing/CHECKPOINT_20260916.md` and is not updated any more.

| Work | State |
| --- | --- |
| 1. One message per pause instead of one per keystroke | ✅ Done. |
| 2. Helper stops re-reading logs (startup rebuilds nothing; rebuilds read only what is new) | ✅ Done. Brief: `docs/features/20260916.03_helper_lazy_projection/01_spec_lazy_projection.md` |
| 3. The page lets go of old memory | ✅ Done. |
| 4. Compact or archive the 654 MB of old logs | ⬜ Not started. Easier once 1 has run a while |
| 5. Close stale agent sessions and their little servers | ⬜ Not started. Cheap |
| 6. The drain stops repeating the agent instructions (3,800 tokens per wake) | ✅ Done. Spec: `docs/features/20260916.02_contract_once/01_spec_contract_once.md` |
| 7. Trim the agent playbook (AGENTS.md, 14,000 tokens per session start) | 🔨 In progress. Rebuilt draft is `docs/AGENTS.next.md` (about 5,400 tokens); waiting on your answers in `docs/AGENTS.next.questions.md` |
| 8. The instructions tell agents to read the summary file once, not every wake | 🔨 In progress. Folded into 7: it changes the instructions inside the review file, and ships with the playbook swap |
| 9. The rail follows the reviewer through a folder of pages | ✅ Done. (not a performance item, but it shipped in the same batch) |
| 10. A page load or status call on a big review still reads its whole log once | ✅ Done. |

✅ done and live · 🔨 in progress · ⬜ not started

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

## CPU and battery, measured 2026-09-16 afternoon

Ken's battery drained in about two hours off the charger and the machine ran hot. Measured the same afternoon:

| Where the CPU went | Accumulated |
| --- | --- |
| Chrome, iTerm2, Superwhisper, and the rest | 10.4 cpu-hours |
| WindowServer (drawing the screen) | 3.9 cpu-hours |
| Claude Code sessions | 0.7 cpu-hours |
| All Node processes | 0.5 cpu-hours |
| LAHE helper, up 19.5 hours | 28 minutes |
| One LAHE static server, up for hours | about 1 second |

At the moment of measurement the hot processes were a Playwright gate run: four headless Chrome workers and four Node test workers. The full browser suite ran at least six times that day across builders and reviewers, with up to seven agents in parallel, each with its own checkout and npm install. That is the burn, not the tool's runtime.

A controlled A/B of one review page in headless Chromium, 90 seconds each, CPU read from Chrome's own process info:

| Page | Renderer CPU | Browser process CPU |
| --- | --- | --- |
| With the rail and the one-second poll | 0.2% of one core | 0.1% |
| Same HTML from disk, no rail | 0.0% | 0.0% |

So an open LAHE tab costs about a fifth of a percent of one core while visible, and hidden tabs poll ten times less often. Twenty open tabs is a few percent of one core. The helper's poll route caches on the log's sequence number and only re-projects when something new landed, so an idle tab is a cheap read on both ends.

Policy change from this: builders run the unit suite only; the orchestrator runs the browser suite once per checkpoint, plugged in; fewer parallel agents on battery.

## Found later the same day: every helper restart re-reads every log

At 17:28 the helper was restarted twice within a few minutes (once by me after the merge, once by another session after its own merge). Each time, every open review page said "helper not available" for several minutes, and the helper sat at over 100 percent CPU answering nothing. A third session noticed the cause and it is right: on boot, the projector's first tick (`tick()` in `src/service/projection.js`) discovers every review on disk, reads each one's whole log, projects it, and rewrites its review.json. Today that is 400 reviews and about 654 MB of log, parsed in one synchronous pass with the event loop blocked. Once the pass finishes the helper is fine: the one that came up at 17:30 answered a health check in under a millisecond and sat at 0 percent CPU after rewriting 400 review.json files.

Two things follow:

- Do not restart the helper casually, and never force-kill it while it is busy: a kill mid-pass just restarts the pass. Today's sequence of restart, kill, restart made the outage longer.
- This is fix 2 above, made urgent. The helper should project a review the first time something asks for it, not every review at boot, and a review's projection should not require re-reading its whole log. Log compaction (fix 4) shrinks the pass but does not remove it.

## Token cost, measured 2026-09-16

How much text the tool hands an agent to read, per action. One token is roughly four characters.

| What an agent reads | Tokens |
| --- | --- |
| One check for new work (the drain), when nothing is waiting | 3,867 |
| Of which: the agent instructions, repeated word for word every time | 3,817 |
| The summary file for a ten-comment review | 9,584 |
| The agent playbook (AGENTS.md), read once per session | 14,239 |
| The lahe skill, read once per session | 5,741 |

About the summary file: of its 8,822 tokens for that ten-comment review, 3,612 are the instructions (one copy, which is where they belong) and 4,930 are the ten comments themselves, about 480 tokens each. Each comment carries your words, the passage you quoted, a slice of the surrounding text so the agent can find the spot, the agent's reply, and the thread. How often it is read: an agent needs the whole file once, when it opens a review cold. On each wake the drain is enough, and the drain with one comment waiting is now 612 tokens. An agent that re-reads the whole file on every wake is following the instructions too literally; the instructions should say so, and that is a one-line change in the frozen contract text.

So every comment you leave costs the agent about 3,800 tokens of instructions it already has, before it reads your comment. One agent checked about thirty times today. That is the change being built now, on its own page: the drain stops repeating the instructions and points at the summary file instead, where they already live.

What today's helper agents spent, from their own reports:

| Who | Tokens |
| --- | --- |
| Three builders, first attempt each | 611,000 |
| The same builders, fixing what the checkers found (five rounds) | 1,536,000 |
| Six checker passes | 633,000 |
| The memory audit reader | 141,000 |
| Total | 3,093,000 |

All of those ran on Opus, not Fable. Fixing rounds cost more than first attempts, which is the next thing to shrink: better briefs that point at the docs, and builders that ask instead of working around a limit.

Not measured: this Fable session itself, which took a full turn for every comment, wake, and report. That is the case for running the review loop on a smaller model.

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

## Progress

- **2026-09-16, branch `worktree-agent-adfd555be06ed2870`: fix 3 landed, the layer's retention issues 3 to 6.** What it covers:
  - `replay.js`: the element memory (`lastElement`) is released when the record leaves the review, and when the node it names is out of the document AND the record could be found again from its own words. Two records keep their binding through a detach: an element pick (an image, a chart) has no words to be re-found by, and a record already stamped lost has nothing else left. A handled record keeps its entry while its node is live, because the Done card's click-to-find (`locate`) is the only thing that knows where a handled item's passage is.
  - `replay.js`: "gone from the review" is asked of the unscoped store through a `hasItem` hook the library wires in, never of the pass's own page-scoped item list. That list is a cache: a comment made a moment ago and every record made on another page both read as absent in it.
  - `replay.js`: a resolved conflict's card node is detached from the card (through the rail's `detachCardNode`, so the card stops remembering it) and dropped from `conflictNodes`, instead of being emptied and hidden and kept. It is always emptied and hidden first, and it waits for the reviewer's focus to leave the card before it goes. The next collision on the same record builds a fresh one, and the collision stylesheet is now re-installed on every conflict node rather than only on the first.
  - `overlay.js`: the pill's viewport clamp (`resize` and `orientationchange` on the window) is removed on unmount, so a rail rebuilt by `ensureRoot` ends with two listeners rather than two more.
  - `index.js`: the status line's history is capped at the newest 200 entries, the way `sync.js` caps `repliesSeen`.
  - `tab_done.js`: `pageLife.announced` and `pageLife.neglected` drop the ids of records that are no longer in the review, asked of the unscoped store for the same reason replay asks it: a review spans pages, and a page-scoped answer would re-announce page A's backlog on every trip back to it.
  - `comments.js`: the node an item was created on is released when the item is deleted.
  - `editing.js`: the block-to-record list already dropped a record on retire; it now also drops rows whose block the page has replaced.
  - `overlay.js` `toastKeys` was left alone on purpose: it is a rule, not a bug. See the note under issue 6 below.

- **2026-09-16, same branch: two reviews said do not merge, and this is what they caught.** All of it is in the bullets above; it is listed separately because each one was a real defect in the first cut, not a polish note.
  - Reading "is this record gone" from the page-scoped item cache would have deleted a brand new comment's creation binding, which for an element pick is its only anchor. That is the 2026-08-18 regression, and it is now guarded by a unit test.
  - Removing the conflict node from the DOM alone left it in the card's own list of attached nodes, so the rail put a resolved collision back on the card at the next remount.
  - Forgetting announced replies from a page-scoped store would have re-announced page A's backlog on every navigation back to it.
  - The collision stylesheet rides inside the first conflict node built, so dropping that node left any other standing collision drawing in no system at all.
  - Pruning every detached node would have permanently lost an element-bound record whose node a tab panel or accordion takes out and puts back.

  Issue 6's `toastKeys` reading is corrected: the set does not block a later reply on the same item. The key is `reply:<id>:<replyStamp>`, so a new reply is a new key; the neglect re-show adds its own `:waiting` suffix, and the waiting COUNT passes no key at all so the rail cannot refuse a legitimately new one. "Shown once per key, for the life of the rail" is what rules 2 and 5 of the toast contract ask for (the X means read, and once per page life), so deleting a key on dismissal would put a dismissed reply back on screen. It grows by one short string per distinct thing the rail has said, which is bounded by the replies of one session.

## What this does not settle

Whether any of Ken's long-open LAHE tabs is individually large. The Chrome extension was not connected to this session, so per-tab heap could not be read from outside. Chrome's own Task Manager (Window menu, Task Manager) lists memory per tab and would answer it in one look.

## Progress

**2026-09-16, branch `worktree-agent-aa9147257d5b588f7`: fix 1 landed, plus finding 2.** The design note is `docs/ongoing/OUTBOX_COALESCING.md`. What it does:

- **The outbox holds one entry per item per revision, not one per keystroke.** A queued `item.content` for an item is dropped when the next one for that item at the same revision arrives, and the new one goes to the back of the queue. `item.created`, `item.ready`, `item.deleted` and `item.reopened` are never coalesced. Revision is part of the match because the helper composes a thread continuation against `prev.rev + 1`; keystrokes never move the revision, so this costs the saving nothing.
- **The poll tick stops parsing the outbox, and the keystroke stops parsing the items.** Both lists are held in memory in `store.js` beside a small stamp written into storage on every write. A reader compares the stamp it is holding with the stamp on disk, so a write from another tab invalidates the copy here with no window listener and no storage event.
- **A full browser storage no longer throws out of the keystroke handler.** `failures.js` gained `isStorageQuota` and `tolerateStorageQuota`; `editing.js` and `comments.js` use them on the typing path, and `index.js` routes the failure to the rail's failure list. The rail's own `saveChips` tolerates it too, since it writes into the same full storage.

The helper, the log format and the projection are untouched. Fix 2 of the list above, the helper re-reading the whole log on every fold, is still open and is the other half of the 84 MB parse.

**Second pass, after two reviews of the branch.** Four things the reviewers found, all fixed on the same branch:

- **The cross-tab write order was backwards.** Stamping before writing the list let another tab read the new stamp beside the old list and hold that pair forever. The list is written first now, and a cold read takes the stamp twice so the pair it holds is one the storage actually had.
- **The outbox could run ahead of the disk.** A keystroke whose record write was refused still posted. The helper would acknowledge a wording the browser had not saved, and `merge.js`'s SAME_REV_ACKED rule would then let the stale record win on the next load. A refused write now posts nothing.
- **The page-check repair stopped running on warm reads.** It runs on the write path too now, so a record arriving from the helper with the doubled sentence is repaired without waiting for a reload.
- **Three smaller ones:** the acknowledgement writes inside `flush` are guarded (a full storage there was an unhandled rejection), `comments.js` guards each listener separately so one that cannot write does not silence the rest, and a queued event is detached from the record the surface is still editing.
