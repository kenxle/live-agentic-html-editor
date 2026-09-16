# One outbox entry per item, not one per keystroke

Written 2026-09-16, alongside the fix. This is the design note the
`docs/ongoing/MEMORY_AUDIT_20260916.md` finding 1 asked for, and it covers three
changes that all sit on the same hot path:

1. the outbox stops growing one entry per keystroke
2. the poll tick stops parsing the outbox, and the keystroke stops parsing the
   items
3. a full browser storage stops throwing out of the keystroke handler

## What was happening

Every keystroke in an edit or a comment became its own event in the browser
outbox, and every event carried the whole record. Idempotence in
`store.queueEvent` was by `event_id`, and `sync.js` `eventFor` mints a fresh id
per call, so the rule never fired and every keystroke appended.

What that cost, measured on disk on 2026-09-16:

- 144,724 `item.content` lines across 383 review logs
- one item written 1,515 times
- one review log at 84.2 MB, which the helper re-parses on every fold

## What is dropped now

`store.queueEvent` drops a queued `item.content` for the same item AT THE SAME
REVISION and appends the new one in its place.

So the intermediate keystroke states of one wording never reach the log. If the
reviewer types "make this fifteen" one character at a time and the helper picks
the queue up once, the log gets one line saying "make this fifteen" instead of
seventeen lines saying every prefix of it.

## What is kept

- **Every lifecycle event.** `item.created`, `item.ready`, `item.deleted` and
  `item.reopened` are never coalesced. Each one is the only line in the log that
  says a thing happened, and `item.ready` is what wakes the agent
  (`src/service/routes.js` WAKE_EVENTS).
- **Every revision.** Revision is part of the match, so a content event at
  revision 2 joins a queued one at revision 1 rather than replacing it. See "Why
  revision is part of the match" below.
- **The committed wordings.** The record carries `after_history`, which
  `record.bumpRev` appends to at each commit. That is the history of what the
  reviewer settled on, and it rides inside every event, so it is unaffected.
- **Everything the reviewer has typed.** The browser store is still written
  synchronously on every keystroke (D5). Only the OUTBOX, the queue of events
  not yet acknowledged, is coalesced.
- **Anything the helper has already acknowledged.** Coalescing only ever touches
  an event still sitting in the queue. An event the helper accepted is already a
  line in the log and was dropped from the queue at that point.

## Why D5 still holds

D5 says the log is the source of truth and everything else is a projection of
it, and that the browser wins on content until the helper acknowledges.

The log is still the truth. What changed is how many lines one wording costs on
the way there, not what the log means. The projection
(`src/service/projection.js`, `itemsFrom`) takes the newest record for each item
and has no field-level event vocabulary: the record rides whole inside the
event. A dropped intermediate content event is therefore a record that a later
record in the same queue already supersedes, and the projection would have
thrown it away on the next line anyway.

The browser still wins on content. The record that reaches the helper is the one
the browser holds, exactly as before.

## Why revision is part of the match

The audit proposed "same item and revision" and this follows it, which is
narrower than "same item". The reason is in `projection.js` `itemsFrom`: when a
record arrives at `prev.rev + 1` carrying one more thread round than the helper
holds, the helper writes its own deterministic winner into the archived round
rather than letting the browser's snapshot erase it. Dropping the event that
carried a revision would make the next revision arrive against a revision two
back, and that composition would not run.

This costs the saving nothing. Keystrokes never move the revision: it is a
committed wording, stated in `comments.js` `type()` and `editing.js`
`captureTyping` and enforced by `record.bumpRev` being the only thing that moves
it. All 1,515 events on the worst item sat at one revision.

## Why the replacement goes to the back of the queue

The projection folds events in log order and the last one for an item wins. A
replacement dropped into the old entry's slot could leave a fresh content event
sitting IN FRONT of an older `item.ready` for the same item, and the helper would
fold the older one as final. So the queue is kept in recency order: the old entry
is removed and the new one is appended.

## The failure modes considered, and the test that covers each

| Failure mode | What happens | Test |
| --- | --- | --- |
| The helper is down for an hour while the reviewer types | One entry per item per revision instead of thousands. Everything the reviewer typed is in the browser store either way, and the newest wording is what the helper gets when it comes back | `outbox_coalescing.test.js`, "twenty keystrokes on one comment are one creation and one content event" |
| The tab closes mid-typing | The outbox is written synchronously on every keystroke and holds the newest wording, so the next load posts it. Coalescing changes nothing here: the entry that survives IS the newest | `outbox_coalescing.test.js`, "two content events for one item at one revision collapse to one" |
| The revision bumps while a content event is queued | Both events stay, so the helper sees every revision in order and its continuation composition still runs | `outbox_coalescing.test.js`, "a content event at a higher revision joins the queue rather than replacing a lower one" |
| A ready is queued and then the reviewer types again | The ready stays and the new content is appended behind it, so the helper folds the content as final, which is what the reviewer did | `outbox_coalescing.test.js`, "a ready queued after a content stays alongside it" |
| A post fails and the same event is queued again | Unchanged: same `event_id` still replaces, in place | `outbox_coalescing.test.js`, "the same event_id still replaces" |
| The helper accepts some of a batch and not the rest | Unchanged: only the ids it named are dropped | `outbox_coalescing.test.js`, "acknowledge still drops only the ids the helper named" |
| A flush is in flight and the reviewer types | The event being posted is replaced in the queue, so the helper's acknowledgement names an id that is no longer there and nothing is dropped. The replacement is posted on the next flush. Conservative, which is the safe direction | covered by the same acknowledge test; the behaviour is identical to the old code, which also kept the newer event |
| Two tabs on one origin | Below | `outbox_coalescing.test.js`, "a second tab's write to the outbox is visible to the first"; `store_item_cache.test.js`, "a second tab's write to the items is visible to the first" |

## The in-memory copies, and the two-tab hazard

Finding 1's other half was that both poll-tick callers parsed the whole outbox to
count it, once a second while the tab is visible. Finding 2 was that `store.write`
parses and re-serializes every item on every keystroke. Both are answered by
holding the parsed list in memory in `store.js`.

The hazard: browser storage is shared by every tab on the origin, so a copy held
in one tab goes stale the moment another tab writes. Two answers were possible.

- **The `storage` event.** Correct in a browser and nothing at all in Node or in
  a test, where the backing is a plain object. It also means a window listener
  inside a module that has never touched `window`, and a window listener with no
  unmount is finding 5 of this same audit.
- **A stamp in storage.** One small key beside each list, rewritten on every
  write. A reader compares the stamp it is holding with the stamp in storage:
  equal means nobody has written since, in this tab or any other.

The stamp is what this uses. It costs one `getItem` of a short string per read,
which is the cheap half, and it removes the `JSON.parse` of the whole list, which
is the expensive half and the one the audit measured. It needs no events, so it
is equally correct in a second tab, in Node, and between two store instances over
one backing object, which is what the tests drive.

Two details that are load bearing:

- **The stamp moves before the list.** If the list write then fails on a full
  storage, the stamp in storage matches no held copy, so every reader goes back
  to the bytes rather than believing a write that never landed.
- **Records are copied one level on the way in and on the way out.** `replay.js`
  and `tab_done.js` write a region stamp straight onto an item they got from the
  store and only then persist it, and `overlay.js` writes a card's state onto its
  copy and never persists it at all. Without the copy all three would reach the
  held list with no write behind them.

The storage format is unchanged, so records and outbox entries written by the old
code still load. The stamp is simply absent for them, which reads as "nobody has
stamped this" and costs one parse.

## A full browser storage during typing

The same finding: with the helper down the outbox used to grow until browser
storage hit its quota, and `store.js` `writeJson` then threw out of the keystroke
handler. The block or the comment box stopped taking keystrokes and the only sign
was a console error.

Coalescing makes that far harder to reach, and does not make it impossible, so
the typing paths now tolerate it. `failures.js` has the one question
(`isStorageQuota`) and the one wrapper (`tolerateStorageQuota`): a quota failure
is reported and swallowed, and every other error is rethrown, because a silently
dropped bug in the write path is worse than the quota was. `editing.js` `persist`
and `comments.js` `type()` use it, and `index.js` hands both surfaces an
`onFailure` that adds a chip to the rail's failure list.

The report is guarded too, and only against the same failure. The rail remembers
its chips in the SAME storage that just refused the write being reported, so
`saveChips` tolerates a quota failure rather than throwing while painting the chip
that says storage is full. Losing that chip's durability across a reload is the
right trade; losing the chip is not.

## What this does not do

- It does not change the helper, the log format, or the projection.
- It does not touch finding 2 of "what to do about it", which is the helper
  re-reading the whole log on every fold. That is still a separate piece of work,
  and it is the other half of the 84 MB parse.
