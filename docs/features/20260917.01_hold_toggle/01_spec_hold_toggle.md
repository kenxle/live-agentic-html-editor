# Hold: queue several comments, release them to the agent at once

Whetstone-size. Ken, 2026-09-17: "we should probably put in a feature to hold
sending to the agent, so that i can leave a bunch of comments and then let the
agent get them all at once. it's needed at times like now when i'm at my
budget and actively managing turns."

## Problem

Every comment and edit reaches the agent the moment it is committed (Cmd-Enter).
That is right most of the time, but not when Ken is burning through his own
turn budget: five separate comments mean five separate wakes, and each wake is
a turn he is spending on purpose. He wants to leave a batch and choose when the
agent sees any of it.

## Requirements

1. A toggle in the rail turns Hold on and off, per review. While on, Cmd-Enter
   still commits a comment or edit to state `ready`, durably, in the browser,
   exactly as today. Nothing about the item lifecycle changes (see
   `docs/diagrams/item_lifecycle.md`): Hold gates delivery, not state.
2. While Hold is on, a newly-ready item's `item.ready` event is never posted to
   the helper. It queues in the browser's outbox exactly as it does today
   (`store.js` `queueEvent`), but `sync.js`'s flush never sends it while held.
3. Turning Hold off flushes the queue immediately, in one pass, no confirm
   dialog. The helper receives everything at once and the agent's next drain
   sees it all.
4. Because a held item never reaches the helper, it must not appear in
   `review.json`, must not fire a wake line, and must not affect tonight's
   agent-liveness overdue clock (`protocol.AGENT_LIVENESS`, entirely
   helper-side, starts a wait only on an item it has received). Proven by a
   test, not asserted.
5. The toggle shows a live count while on ("Holding, 3 queued"), so it cannot
   be left on silently. A held card reads as its own calm state, distinct from
   `ready` (about to be seen) and from the overdue amber built tonight
   (it was never sent, so "waiting on an agent" would be false).
6. Ending the review force-flushes anything still held. Nothing queued is
   silently lost, matching the existing rule that ending a review discards
   nothing.
7. Hold persists across a page reload (stored the same way the rest of review
   state is), so a reload mid-burst does not silently flush everything.
8. Per-review, not global. Only the holder tab may create items today (the
   refused-window model), so Hold needs no new multi-tab handling.

## Approach

No new state machine and no new wire event. This is a gate on an existing
call, not a new subsystem, which is why it fits at whetstone size:

- `store.js`: a `held` boolean per review, read and written through the same
  storage the rest of review state uses. `setHeld(reviewId, bool)`,
  `isHeld(reviewId)`.
- `sync.js`: `scheduleFlush` and `flush` (around lines 1726 and 1916) check
  `store.isHeld(reviewId)` before actually sending. Held: the event stays
  queued, nothing goes over the wire. Not held: unchanged today's behavior.
  Releasing Hold calls `flush({ immediate: true })` (the same call the
  existing `blur`/`ready`/`navigation`/`unload` immediate-flush paths use,
  see `protocol.FLUSH.IMMEDIATE_ON`).
- `overlay.js`: the toggle control and the held card's visual state. Use the
  existing token pattern (`--draft-wash`, `--handled-wash` around line 402)
  rather than inventing new hex; a held card gets its own `data-state='held'`
  or a `data-queued='true'` attribute distinct from `ready`, styled calm (no
  amber, no green). Read the amber/overdue work from tonight
  (`docs/features/20260916.04_unanswered_prominence/`) before choosing colors
  so the two states never collide.
- The agent-liveness overdue clock needs no code change: it already only
  starts once the helper has the item, so a held item is invisible to it for
  free. The test in Requirement 4 is there to prove that stays true, not to
  add a new check.

Rejected: a fourth item-lifecycle state ("queued"). The item already IS ready,
durably, the moment Cmd-Enter fires; modeling Hold as a delivery gate rather
than a state keeps `item_lifecycle.md` and the contract's state vocabulary
untouched, and it is the smaller change.

## Tasks

1. `store.js`: `setHeld`/`isHeld`, persisted per review. Unit tests: set,
   read, survives a simulated reload (rehydrate a fresh store instance from
   the same backing).
2. `sync.js`: gate `scheduleFlush`/`flush` on `isHeld`. Unit tests: a queued
   event does not post while held; releasing Hold flushes immediately;
   an item committed while NOT held still posts on the existing debounce,
   unaffected.
3. `overlay.js`: the toggle (with live count) and the held card's distinct
   visual state, light and dark. Unit or browser test per the existing
   pattern for card state.
4. Integration: a held item does not appear in `review.json`, does not
   fire a wake line, and the overdue rule never marks it loud. One browser
   test exercising all three together.
5. End-of-review force-flush: ending a review with items still held posts
   them first. Test.
6. Screenshot of the toggle on, with a held card next to a ready card and a
   handled card, light and dark, per tonight's screenshot rule in `CLAUDE.md`.
7. Docs: one paragraph in the skill (`skills/lahe/SKILL.md`) and
   `docs/CONTRACTS.md` if the wire payload gains a field, saying Hold exists
   and that a held item is invisible to the agent until released.

## Acceptance criteria

- [ ] Turning Hold on, leaving three comments, then off: the agent's drain
      sees all three at once, not as they were typed.
- [ ] A held item is absent from `review.json` until released.
- [ ] A held item never fires a wake line and never turns amber.
- [ ] The toggle shows a live queued count while on.
- [ ] Ending a review with items held flushes them first.
- [ ] Hold survives a page reload.
- [ ] `npm run gate:unit` green; one named browser spec proves the visual and
      wake-suppression claims; full suite green once at merge.

## Progress

- 2026-09-17: spec written.
