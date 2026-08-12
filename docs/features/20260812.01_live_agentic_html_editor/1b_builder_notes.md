# 1B builder notes: the library shell

Worktree `../lahe-worktrees/1b`, branch `task/1b`. Owns `src/layer/store.js`,
`src/layer/sync.js`, `src/layer/overlay.js`, and ranked tests 6, 12, 19, 21, 22, 25, 33.

## What this task is

Three files and one law.

- `store.js` is browser storage: written synchronously on every keystroke, keyed by review id, and
  it holds the durable outbox the sync client drains.
- `sync.js` is everything about talking to the helper: post per event, re-post what was never
  acknowledged, retry forever, never block the reviewer, tell a CSP refusal apart from a helper that
  is down, and poll for replies.
- `overlay.js` is the rail chrome in a closed shadow root: tab shell, status line, failure chips, and
  the card API. Tab contents are other people's files.

The law: **the rail updates in place, and a card holding focus is never re-created.**

## Log

(kept in order, newest at the foot)

### Starting state read

- `protocol.js` is the wire contract and is imported, never retyped: `FLUSH.HELPER_DEBOUNCE_MS`
  (750ms), `FLUSH.IMMEDIATE_ON`, `FLUSH.TRANSPORT_ON_UNLOAD` (keepalive fetch, never `sendBeacon`),
  `FLUSH.KEEPALIVE_MAX_BYTES`, `REPLY_CURSOR_FIELD` (a `seq`, never a timestamp), and the route
  table.
- `sync.js` as landed reads `protocol.SESSION.ON_401`, a symbol 0A-wire removed on purpose. That is
  the deliberate breakage marking this file as mine to rework.

### The demonstrated failure (ranked test 12, the law 1B owns)

Written first, watched fail against the stub rail (no DOM at all), then made to pass. The
demonstration the plan asks for is the one-line revert: make `upsertCard` treat every call as a
creation, which is exactly what "the rail rebuilds its cards" means.

```diff
--- a/src/layer/overlay.js
+++ b/src/layer/overlay.js
       var id = item[record.FIELD.ID];
-      if (!cards[id]) {
+      if (true) {
```

```
  ✘  1 [chromium] › test/browser/rail_focus.spec.js:34:3 › a focused card survives twenty repaints
       with its node, focus and text intact (401ms)

    Error: expect(received).toBe(expected) // Object.is equality
    Expected: "itm_75e2109529949f355d470c14"
    Received: null

      44 |     const before = await page.evaluate((id) => window.__laheRail.activeInfo(), opened.id);
    > 45 |     expect(before.cardId).toBe(opened.id);
  1 failed
```

The failure reads exactly like the bug: the card the reviewer is typing into is not the card on
screen any more, so nothing holds focus. Reverted, the same run is three passes.

### What each file became

**`store.js`.** Four things live in browser storage now, all keyed by review id and all written
synchronously: the items, an **outbox**, the **chips**, and the **holder** record.

The outbox is the one that matters. "Re-post anything unacknowledged" is only true across a reload if
the queue is durable, so the queue is in browser storage rather than in a JS array, appended in the
same task as the keystroke that caused it, and drained by `acknowledge(reviewId, eventIds)`.
Acknowledgement is by `event_id`, never by `(item, rev)`: drafts do not bump `rev`, so many events
legitimately share an item and a revision.

`acquireWindowLock` (the kernel's stub) is gone and `claimWindow` replaced it. A Web Lock cannot be
claimed synchronously, and a synchronous answer would have been a lie in the only environment that
matters. Where there is no Web Locks API at all, the claim is **granted and marked `unchecked`**:
refusing on a check that never ran would lock a reviewer out of their own review, which is a
work-losing outcome in a tool whose thesis is never losing work.

**`sync.js`.** Post per event on `protocol.FLUSH`, re-post the outbox on start (that is the whole of
"re-posts on the next load"), retry forever on capped backoff, and poll for replies on a `seq`
cursor. Two things are load-bearing and easy to miss:

- **Every request carries a 2s deadline.** A killed helper refuses the connection at once; a
  SIGSTOP'd one accepts the socket and answers nothing. Without the deadline, the page waits on the
  frozen helper forever and the status line keeps saying stored. The deadline is the entire
  difference, and ranked test 22 fails without it.
- **The CSP detection is a real `securitypolicyviolation` listener**, not a guess from the error
  text. The fetch failure either side of a CSP refusal is byte-identical, so nothing else could tell
  them apart, and the two remedies point opposite ways (start the helper, versus fix this app's
  development CSP).

**The status line's rule, stated once because it is a judgment call.** It reads kept-locally whenever
anything failed, refused, or timed out, and stored only when the outbox is empty AND at least one
post has been acknowledged. In between (queued, in flight, nothing wrong) it **holds** its current
reading rather than flickering to kept-locally between every keystroke and its acknowledgement. The
flicker version is technically true and useless: a line that blinks on every keystroke is a line the
reviewer stops reading.

**`overlay.js`.** Real DOM in a **closed** shadow root, one host element on the page and nothing
else. Because the root is closed, nothing outside can read its `activeElement`, so the rail answers
`holdsFocus(id)`, `focusedCardId()` and `activeElementInfo()` itself. That is not a test backdoor:
`removeCard` needs the same answer, and so does the pane placement below.

Three edges of the law, enforced rather than documented:

1. `upsertCard` on an existing id mutates the node it already has.
2. `removeCard` on a card holding focus returns false and removes nothing.
3. A card whose state moves it to another tab is **not re-parented while it holds focus**, because
   re-parenting blurs a focused element in every engine. The move is held and flushed on `focusout`.
   This one was not in the plan; it is the same law applied to the tidying the rail does to itself.

### The rail's visual design

The wireframe settled structure; these are the decisions on top of it.

- **One accent, used three times.** A deep indigo for the active tab underline, the focus ring, and
  the primary button. Nothing else is colored except state: green for handled, amber for anything
  that needs the reviewer. A rail that sits over anyone's page cannot bring a brand with it, so the
  color budget is spent on meaning and nowhere else.
- **Type as hierarchy, not as decoration.** 10-11px uppercase with wide letter-spacing for labels
  (COMMENT, DRAFT), 12px for chrome, 13.5px at 1.5 line-height for anything the reviewer wrote or an
  agent said. The reviewer's own words are the largest text in the rail, which is the right ordering.
  Counts are tabular-numeral so a tab's number does not shift width as it changes.
- **A card is paper on a ground.** The pane behind the cards is a shade darker than the cards, and
  dark mode keeps that relationship rather than inverting it (an inverted dark UI reads as a stack of
  holes). The whole card takes the focus ring via `:focus-within`, so the box the reviewer is typing
  in is unmistakable without a second ring inside the first.
- **The system font stack**, deliberately. A webfont would be an external request the CSP of a
  reviewed app may well refuse, and matching the host's own font is not the goal: looking like a tool
  rather than like part of the page is.
- **Restraint where the wireframe was loud.** No icons except one collapse arrow, no avatars, no
  progress bars, one shadow definition reused everywhere.
- **Keyboard hints are 11.5px real text with rendered keycaps**, not 9px grey fine print (D10 says
  readable, so they are legible at arm's length).
- **The collapsed pill cannot overlap the open rail** because the two are never on screen together:
  collapsing hides the rail and shows the pill. `geometry()` returns both rects and the overlap
  answer, so the claim is checked as geometry rather than asserted as intent.
- **Copy and Export are always visible** in the footer, above the hints, with Copy as the primary
  button. They are the escape hatch, and the moment they are needed is the moment the reviewer cannot
  tell anything is wrong.
- Light and dark were both looked at in a real browser, not reasoned about.

### Tests, and what each one would catch

| Ranked test | File | The bug it catches |
| --- | --- | --- |
| 12 | `test/browser/rail_focus.spec.js` | A rail that rebuilds a card under the reviewer's cursor |
| 6 | `test/browser/rail_durability.spec.js` | A store that debounces its write, so a crash costs a sentence |
| 19 | `test/browser/rail_durability.spec.js` | Drafts that live only in the tab, or reach the helper unmarked |
| 21 | `test/browser/rail_status.spec.js` | A status line that says stored while a backlog sits unposted |
| 22 | `test/browser/rail_status.spec.js` | A sync client written only against a dead helper, which hangs on a frozen one |
| 25 | `test/browser/rail_second_window.spec.js` | Two windows sharing one bucket, the loser's work vanishing silently |
| 33 | `test/browser/rail_chips.spec.js` | A failure list in the DOM, lost on the first navigation |

Ranked test 6's ordering is the sharp one: `typeFinalKeystrokeAndRead` dispatches the final input
event and reads raw browser storage **in the same task**, with no await and no timer in between.

### Two things the next builder needs to know

1. **`test/fixtures/servers/stub-service.js` does not speak the current wire.** It answers the
   archived send model's route (`POST /reviews/<id>/items`, `x-lahe-request`) while `protocol.js`
   pins `POST /lahe/v1/events` with `x-lahe-client` and `x-lahe-token` plus the reply poll. 1B's sync
   client is written against `protocol.js`, which is the contract, so these specs run against a new
   stand-in, **`test/fixtures/servers/protocol-service.js`**, which imports `protocol.js` and uses its
   real `checkRequest` block. It honors the same readiness contract, so `kill9()`, `suspend()` and
   `resume()` work against it. **When 1A's real helper lands, the `SERVICE_ENTRY` constant at the top
   of each rail spec is the only line that changes.**
2. **Dismissed chips stay dismissed for the review, including against a recurrence.** A helper that
   is down stays down and every poll fails, so a chip that reappears after the reviewer waved it away
   is the dismissal not working. The underlying state is still on the status line, so dismissing
   hides the chip and never the truth. Stated here because it is a reading of R11, not a quote of it.

### Gate

`npm run gate:builder`, green:

```
lint passed (syntax: 105 files, no jsdom, manifest complete)
# tests 255
# pass 255
# fail 0
  63 passed (15.5s)
```

`dist/` was rebuilt locally to run the browser specs and is NOT committed, per the plan's dist rule.

### Cleanup needed

Nothing was deleted. For the Phase 4B batch:

- `test/fixtures/servers/protocol-service.js` — the stand-in helper. Delete once 1A's real helper is
  what the rail specs point at (or keep it and cut `stub-service.js` instead, whichever 0B and 1A
  prefer; two fixture helpers speaking two protocols is the thing that should not survive Phase 4).
- `test/unit/consumer_1b_shell.test.js` — the throwaway kernel consumer, already on the batch. It was
  updated in place to the landed API (`claimWindow`, the outbox) rather than left asserting a stub
  signature that no longer exists.
- `shot-tmp.js` in the repo root — an untracked screenshot script used to look at the rail in light
  and dark. Never staged; delete it.
