# Quiet tabs: poll less when nobody is looking

Whetstone-size. Part 1 of [GitHub issue 16](https://github.com/kenxle/live-agentic-html-editor/issues/16) (idle reviews cost too much). Part 2 of that issue, page servers that are never cleaned up, is not in this change. Progress is at the bottom.

## Summary

An open review tab asks the helper for news once a second, forever, even when nothing is happening. This change makes a quiet tab ask less often. A focused tab starts at once a second and slows down each time it hears nothing, to once every 15 seconds. A tab you are not looking at asks once every two minutes. Anything you do on the page, or anything arriving from the agent, snaps it back to fast, and coming back to the tab checks at once. Nothing you do is ever delayed by this.

## The problem

The battery drains on an idle machine with review tabs open. Measured in issue 16, on one machine (macOS, 32 GB), idle:

| Thing | Number |
| --- | --- |
| Page servers left running from finished work | 58 processes, 711 MB |
| All LAHE node processes | 73 processes, 1.2 GB resident |
| CPU used by those processes in a live sample | about 0 percent (the issue's own wording) |

The issue names the page's own polling as the first place to look:

- A visible tab polls the helper once per second (`POLL_INTERVAL_MS` 1000 in `src/layer/sync.js`).
- A hidden tab polls every 10 seconds (`HIDDEN_POLL_INTERVAL_MS` 10000).
- On top of that every page posts a heartbeat every 10 seconds, and a read-only window re-asks for the review every 10 seconds.

Each request wakes the helper, which reads from disk, and each heartbeat makes the helper rewrite `windows.json`.

The owner's design, in his words: "an exponential slowdown of polling for every empty poll, but when the page receives focus or action is taken, the poll interval gets reset... if the window is not focused, then we can drop the poll to a low number because nothing is coming from an empty page. like a couple minutes would be fine."

## Requirements

1. **Focused and active: back off on empty polls.** The reply poll starts at 1 second. Each poll that brings nothing new doubles the next wait, up to a cap of 15 seconds (1, 2, 4, 8, 15, 15...). "Nothing new" means no reply or other log event and no change to the page's file on disk. A change in the agent-listening line alone does not count, because the agent's monitor updates its timestamp every 15 seconds and would keep the tab fast forever.
2. **Reset to fast** on any of:
   - the window gaining focus
   - the tab becoming visible
   - the reviewer pressing a key, clicking, or changing the selection anywhere on the page, the rail included
   - the reviewer committing or saving anything (any write the page queues for the helper)
   - a poll that brings a reply or any new event
   - a flush of the reviewer's own work reaching the helper

   Gaining focus or becoming visible also polls once right away, so a returning reviewer sees what arrived while they were gone. The other triggers only bring the next poll forward to 1 second; a keystroke never causes a request of its own.
3. **Unfocused or hidden: poll every two minutes.** "Unfocused" means `document.hasFocus()` is false (focus inside a frame on the page still counts as focused). Hidden means `document.hidden`.
4. **The heartbeat slows down when the tab is unfocused or hidden, and the helper is told.** Details and cost under Approach.
5. **The agent-listening line and the read-only window's re-ask follow the same rules.** The agent line rides on the reply poll, so it inherits requirements 1 to 3. The read-only window's re-ask (the one that takes the review over once the holder goes away) stays at the heartbeat cadence while focused and drops to every two minutes while unfocused or hidden, and re-asks at once on return.
6. **Nothing the reviewer does is delayed.** A commit still sends at once, Hold still holds, drafts keep their 10 second floor, and hiding the tab still sends drafts at once. None of the flush code paths wait on the poll.
7. **A page rebuilt while the tab is unfocused still reloads when the reviewer returns.** The reload is driven by the poll seeing the file's new modified time. An unfocused tab sees it within two minutes, and returning to the tab polls at once, so the reload happens within the existing 1.5 second debounce of coming back.

## Approach

### The reply poll (`src/layer/sync.js`)

- The poll loop becomes a chain: wait, poll, then decide the next wait from what the poll brought back. Today it schedules the next poll before the current one has answered, so it cannot know whether the poll was empty.
- `pollIntervalFor(doc, emptyPolls)` returns 120000 when the tab is away (hidden or unfocused), and otherwise `min(1000 * 2^emptyPolls, 15000)`.
- A reset sets `emptyPolls` to 0 and, if the next poll is further out than 1 second, moves it to 1 second from now.
- Listeners on the document for `keydown`, `pointerdown` and `selectionchange` (capture, passive), and on the window for `focus` and `blur`. `recordItem` and a successful flush call the reset directly.
- Focus and visibility both call one "attention changed" handler, so a return that fires both events polls once, not twice. A poll already in flight is never doubled.
- A failed poll (helper down) counts as empty. The flush retry keeps its own backoff, so this only slows how fast an idle page notices the helper came back, to at most 15 seconds focused.

**Why the cap is 15 seconds.** It is the longest a reviewer who is sitting on the page, but not touching it, waits to see an agent's reply. Fifteen seconds is short enough that a reply still feels like it arrived while you were watching. Most of the saving is already made by then (the Measurements section has the counts), so the next doubling to 30 seconds would buy little and would start to feel broken. The owner was offered 15 seconds and did not object.

### The heartbeat and the review claim

How the claim works today (`src/service/reviews.js`): the page holding a review re-posts its claim every `HEARTBEAT_SECONDS` (10). The helper calls the holder gone after `STALE_AFTER_MS` (30 seconds) of silence, but only when another window asks: staleness is checked lazily, so a quiet holder loses nothing until someone else wants the review. Closing the tab sends a goodbye that frees the review at once.

The change:

- **The page says when it is going quiet.** Every claim the page sends carries `quiet: true` when the tab is away. The helper stores that on the holder.
- **The helper gives a quiet holder a longer window.** A quiet holder is stale after `QUIET_STALE_AFTER_MS`, 180 seconds. A holder that is not quiet keeps 30 seconds. The value is the helper's, not the page's: the page can only say yes or no.
- **The grant tells the page how slow it may go.** Grants and refusals carry `quiet_heartbeat_seconds: 60`. A page talking to an older helper that does not send it never slows down, so an old helper never sees a quiet page it would wrongly call gone.
- **The page beats every 60 seconds while away**, and every 10 seconds while focused. On every change between the two it beats at once, so the helper learns the new mode before the page goes silent, and a returning tab learns straight away if another window took the review while it was away.
- The read-only window's re-ask uses 10 seconds while focused and 120 seconds while away.

Why 60 and 180: Chrome throttles timers in a tab that has been hidden for five minutes to one wake-up a minute, aligned to the minute, so a 60 second timer can fire up to about 120 seconds late in the worst case. 180 seconds is three beats, the same "two missed beats before anyone can take it" rule as today's 10 and 30, and still leaves a minute of slack over the worst throttled beat. A 60 second beat also stays inside the CLI's 120 second "somebody is using this helper" window (`LIVE_WINDOW_MS`), which is left unchanged.

**What it costs.** A tab that crashes (or a machine that loses power) while unfocused or hidden now holds its review for up to 3 minutes before another window can take it over on its own. Before, that was 30 seconds. A tab that crashes while focused is unchanged at 30 seconds. Closing the tab normally still frees the review at once, and "Review here instead" still takes it at once from any window.

### Page reload after a rebuild

No change needed. The reload trigger is the poll seeing a new modified time on the page's file (`noteTargetMtime`), then a 1.5 second debounce, then a reload unless the reviewer is mid-work. An unfocused tab notices within two minutes and reloads then; returning to the tab polls at once, so it never waits longer than the debounce once the reviewer is back.

## Tasks

1. Spec (this page).
2. Unit tests, red first: backoff doubling and cap; each reset trigger; unfocused and hidden interval; immediate poll on focus and on visibility; no double poll when both fire; an empty-but-liveness-changed poll still counts as empty; a rebuilt page reloads when the tab comes back. Uses `node:test` mock timers, as `test/unit/draft_flush_cadence.test.js` does.
3. Unit tests, red first, for the heartbeat: the page beats at 10 seconds focused and 60 away, beats at once on each change, sends `quiet`, and stays at 10 seconds against a helper that does not send `quiet_heartbeat_seconds`. For the helper: a quiet holder survives 179 seconds of silence and is taken at 181; a holder that is not quiet is still taken after 30; a quiet holder that beats again unquiet goes back to 30; the quiet flag survives a helper restart.
4. Build the poll chain, the attention handler and the reset triggers in `src/layer/sync.js`.
5. Build `quiet` in `src/service/reviews.js` and `src/service/routes.js`, and the page side of the heartbeat.
6. Browser spec `test/browser/quiet_tab_polling.spec.js`: an idle focused tab's request rate drops; a hidden tab polls every two minutes; focusing it polls at once and shows a reply that arrived while hidden. Uses Playwright's page clock to move time.
7. `scripts/measure_idle_requests.js`: count requests over a fixed window in three states, run before and after.
8. Update `docs/CONTRACTS.md` (the `window.claim` body and answer, the staleness rule, the reply poll cadence) and the route description in `src/shared/protocol.js`.

## Acceptance criteria

- [ ] An idle focused tab backs off 1, 2, 4, 8, 15 seconds and stays at 15.
- [ ] Every reset trigger in requirement 2 brings the next poll back to 1 second.
- [ ] An unfocused or hidden tab polls every 2 minutes, and polls at once on return.
- [ ] The heartbeat is 10 seconds focused and 60 seconds away; the helper holds a quiet holder for 180 seconds and a focused one for 30.
- [ ] Commit, Hold, the draft floor and hide-flush behave exactly as before (existing tests pass unchanged).
- [ ] A page rebuilt while the tab was away reloads when the reviewer returns.
- [ ] Before and after request counts on this page, from the script.
- [ ] `npm run gate:unit` green; the named browser specs green.

## Measurements

Filled in from `scripts/measure_idle_requests.js` output.

## Progress

- 2026-09-28: spec written.
