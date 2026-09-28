# Quiet tabs: a tab nobody is looking at stops asking

Whetstone-size. Part 1 of [GitHub issue 16](https://github.com/kenxle/live-agentic-html-editor/issues/16) (idle reviews cost too much). Part 2 of that issue, page servers that are never cleaned up, is not in this change. Progress is at the bottom.

## Summary

Every open review tab used to ask the helper for news once a second, forever. Now focus is the switch. The tab you are looking at still asks once a second, so it feels exactly as responsive as before. A tab whose window is not focused, or that is hidden, asks nothing at all: it only tells the helper "still open" once every five minutes. Coming back to it checks at once, so anything that arrived while you were away shows up straight away. Measured over an hour, an unfocused tab went from 3,960 requests to 12.

## The problem

The battery drains on an idle machine with review tabs open. Measured in issue 16, on one machine (macOS, 32 GB), idle:

| Thing | Number |
| --- | --- |
| Page servers left running from finished work | 58 processes, 711 MB |
| All LAHE node processes | 73 processes, 1.2 GB resident |
| CPU used by those processes in a live sample | about 0 percent (the issue's own wording) |

The issue names the page's own polling as the first place to look:

- A visible tab polled the helper once per second (`POLL_INTERVAL_MS` 1000 in `src/layer/sync.js`).
- A hidden tab polled every 10 seconds (`HIDDEN_POLL_INTERVAL_MS` 10000).
- On top of that every holding page posted a heartbeat every 10 seconds, and a read-only window re-asked for the review every 10 seconds.

Each request wakes the helper, which reads from disk, and each heartbeat makes the helper rewrite `windows.json`.

The owner's first description: "an exponential slowdown of polling for every empty poll, but when the page receives focus or action is taken, the poll interval gets reset... if the window is not focused, then we can drop the poll to a low number because nothing is coming from an empty page. like a couple minutes would be fine."

He then simplified it twice. On focus: "we can use [focus] as the primary thing and we can drop the out of focus down to this like really slow heartbeat that just lets it know if that tab is still open... Five minutes... if we just do a check when I bring focus back then it should be sufficient for most cases." And on the slowdown: "don't worry about the slowdown i don't think. with this design we'll only have one tab that is ever running at top speed. and i want it to feel responsive. waiting 30sec for it to pick up, just because you've been reading the doc for awhile, isn't a great experience."

## Requirements

1. **Focus is the switch.** A tab is away when `document.hasFocus()` is false (the reviewer switched to another app or another tab) or the tab is hidden, which is unfocused by definition. Focus inside a frame on the page still counts as focused.
2. **Focused: poll once a second, steadily.** No slowdown. Only one tab can have focus, so only one tab ever runs at this pace.
3. **Away: no reply poll and no read-only re-ask at all.** The only request is a "still open" heartbeat every 5 minutes. The helper holds a quiet tab's review for 390 seconds (see Approach for why that number and what it costs).
4. **Coming back: poll at once, once.** That one poll shows any reply that arrived while the tab was away and triggers any reload a rebuild owes. Then the once-a-second schedule resumes. A return that fires both a visibility and a focus event polls once.
5. **Closing the tab says goodbye, focused or not.** The existing goodbye on `pagehide` frees the review at once. It must still go out from an unfocused tab.
6. **Drafts unchanged.** Hiding the tab or leaving a comment box still sends drafts at once. A window blur with nothing queued sends nothing.
7. **A keystroke costs nothing.** The owner, when he approved the design: "be careful about anything that is firing on every keystroke, as i think that was part of what slowed us down before. we were writing multiple places every keystroke." A key press, click or selection change starts no request, writes nothing to browser storage and schedules no timer. The one listener on keys and clicks returns at once while the tab is focused; it only does work while the page believes it is away, to catch a missed focus event (a reviewer typing into the page is plainly here).

## Approach

### The page (`src/layer/sync.js`)

- **The poll is a chain.** Each poll schedules the next one when it has answered, so going away simply does not schedule one. One poll in flight at most, one timer armed at most.
- **One handler for focus, blur and visibility** (`onAttention`). It compares `isAway(doc)` with the last reading. Going away clears the poll timer and the read-only re-ask. Coming back polls at once, resumes the chain, and re-asks at once in a read-only window.
- **The missed-focus guard.** `keydown` and `pointerdown` listeners (capture, passive) that return immediately unless the page believes it is away. Then they re-check `isAway`, and a return is handled as a return.
- **The heartbeat is a chain too**, because its pace changes with focus. Every claim the page sends carries `quiet`: true while away, if the helper has offered a slow beat. The beat only slows after the helper has been told, so the blur itself sends nothing: the beat already due, at most 10 seconds out, carries `quiet: true`, and the next one is 5 minutes later. Coming back beats at once with `quiet: false` if the helper had been told quiet, which is also the check that this tab still holds the review. A quick look away shorter than one beat costs nothing extra.
- **An away tab with the helper down no longer retries every 1.2 seconds.** Before this, an unreachable helper made the holder re-post its claim every 1.2 seconds forever. While away it now waits for its next beat.
- Against an older helper that does not offer `quiet_heartbeat_seconds`, the page keeps the 10 second beat while away, because that helper would call a slower holder gone after 30 seconds. It still stops polling.

### The helper (`src/service/reviews.js`, `routes.js`, `protocol.js`)

- `window.claim` takes an optional boolean `quiet`. The route passes `body.quiet === true` and nothing else.
- The helper stores `quiet` on the holder at every grant and every heartbeat, writes it to `windows.json`, and reads it back after a restart.
- Grants and refusals carry `quiet_heartbeat_seconds: 300`.
- A quiet holder is stale after `QUIET_STALE_AFTER_MS`, 390 seconds. Any other holder keeps `STALE_AFTER_MS`, 30 seconds. Staleness is still checked only when another window asks, so a quiet holder loses nothing unless someone else wants the review.
- The refusal names the holder's own wait ("wait 7 minutes after it stops responding" for a quiet holder, rounded up from 390 seconds).

**Why 390 seconds.** The 5 minute beat, plus 60 seconds because Chrome wakes a long-hidden tab's timers only once a minute (so a 5 minute timer can fire up to a minute late), plus the same 30 seconds of slack a focused holder already gets over its 10 second beat.

**What it costs.** A tab that crashes, or a browser that is force-quit, while the tab is unfocused now holds its review for up to 390 seconds (6.5 minutes) before another window can take it on its own. Before, that was 30 seconds. A tab that crashes while focused is unchanged at 30 seconds. Closing the tab normally still frees the review at once, and "Review here instead" in the next window still takes it at once (unit test "Review here instead takes a quiet holder's review at once").

**Left unchanged on purpose.** The CLI's "somebody is using this helper" window (`LIVE_WINDOW_MS`, 120 seconds) is shorter than the quiet beat, so a command may replace the helper while only unfocused tabs are open. That is safe: the session table is saved with the quiet flag and restored by the new helper, and the away page makes no request until its next beat or its return. `lahe status` "page last seen" will show an older time for an unfocused tab, which is true.

### Page reload after a rebuild

No code change. The reload is triggered by the poll seeing a new modified time on the page's file. An away tab does not poll, so it does not reload while away; the poll on return sees the new time and reloads after the existing 1.5 second debounce.

## Tasks

1. Spec (this page).
2. Unit tests, red first (`test/unit/quiet_tab_polling.test.js`, on `node:test` mock timers): steady 1 second polling focused; 200 keystrokes cost no request, write or timer; no poll while unfocused or hidden; heartbeat every 5 minutes away, only after the helper was told; coming back polls once and beats once; a reply and a reload that were owed arrive on return; goodbye while unfocused; read-only re-ask stops away; no fast retry away with the helper down; old helper keeps the fast beat. Helper side: 390 second quiet window, 30 seconds otherwise, quiet survives a restart, Review here instead is immediate, the route passes only a boolean.
3. Build the page side in `src/layer/sync.js`.
4. Build the helper side in `src/service/reviews.js`, `src/service/routes.js`, `src/shared/protocol.js`.
5. Browser spec `test/browser/quiet_tab_polling.spec.js` on Playwright's page clock: an unfocused tab sends two heartbeats and no poll in 10 minutes, and focusing it polls once and shows a reply written while it was away; a hidden tab likewise; closing an unfocused tab frees the review for the next window at once.
6. `scripts/measure_idle_requests.js`: request counts over a fixed window in five states, before and after.
7. `docs/CONTRACTS.md`: the `window.claim` body and answers, the quiet staleness rule, and the page's polling.

## Acceptance criteria

- [x] A focused tab polls once a second, as before.
- [x] An unfocused or hidden tab sends no reply poll; its only request is one heartbeat per 5 minutes.
- [x] Coming back polls at once, once, and shows what arrived; an owed reload happens.
- [x] Closing an unfocused tab frees the review at once.
- [x] The helper holds a quiet holder for 390 seconds and a focused one for 30; Review here instead is immediate.
- [x] Keystrokes cause no request, storage write or timer.
- [x] Commit, Hold, the draft floor and hide-flush behave as before (existing tests pass unchanged).
- [x] Before and after request counts on this page, from the script.
- [x] `npm run gate:unit` green; the named browser specs green.

## Measurements

From `node scripts/measure_idle_requests.js <tree> --minutes N`. "Before" is `git archive 7c86bed` (main when this branch was cut) run through the same script. The script runs each tree's own `sync.js` and `store.js` on a virtual clock, with window claims answered by that tree's own `reviews.js`, and counts every request the page makes. Each state is a fresh page that already holds its review. "Active" is a key press every 2 seconds and a click every 10. "Closed" counts only what the close itself sends. The percentages were computed with Python from these counts.

Ten minutes:

| State | Before: total (polls, claims) | After: total (polls, claims) | Change |
| --- | --- | --- | --- |
| Focused, idle | 660 (600, 60) | 660 (600, 60) | 0% |
| Focused, active | 660 (600, 60) | 660 (600, 60) | 0% |
| Unfocused, visible | 660 (600, 60) | 2 (0, 2) | -99.7% |
| Hidden | 120 (60, 60) | 2 (0, 2) | -98.3% |
| Closed while unfocused | 1 (the goodbye) | 1 (the goodbye) | 0% |

One hour:

| State | Before | After | Change |
| --- | --- | --- | --- |
| Focused, idle | 3,960 | 3,960 | 0% |
| Unfocused, visible | 3,960 | 12 | -99.7% |
| Hidden | 720 | 12 | -98.3% |

In every state except "closed", the page still held its review at the end of the window, as the helper saw it (the script's `helper_still_holds` column). The focused tab is unchanged on purpose: it is the one the reviewer is looking at. The saving comes from every other open tab. What the script does not model is a real browser's own timer throttling for hidden tabs, which only ever lowers the hidden counts further.

## Progress

- 2026-09-28: first spec written with the exponential slowdown. The owner then made focus the switch (no polling at all while unfocused, a 5 minute "still open" beat), then dropped the slowdown so the focused tab stays at once a second. This page is the final shape; the backoff code was removed, not left switched off.
- 2026-09-28: built. Unit tests in `test/unit/quiet_tab_polling.test.js` (29 tests; 18 fail on the old code, the other 11 pin behavior that must not change). One old test in `test/unit/sync_client.test.js` asserted the old hidden cadence and now asserts no poll while hidden. `npm run gate:unit`: 1,378 tests, 1,376 pass, 0 fail, 2 todo.
- 2026-09-28: browser. `test/browser/quiet_tab_polling.spec.js` (3 tests) passes on the rebuilt bundle, and its first two fail on main's committed bundle. Existing specs run on the rebuilt bundle (not staged), all green, 61 passed and 1 skipped (the file's own): `window_goodbye`, `duplicate_tab`, `takeover_walk`, `rail_second_window`, `reload_claim`, `helper_restart_holds`, `auto_reload`, `rail_agent_liveness`, `agent_replies`, `graceful_failure`, `end_review`, `ac4_probe`, `bfcache_restore`, `status_truth`, `rebuild_not_the_agents_job`.

## To delete at cleanup

- `.claude/worktrees/quiet-tab-polling/node_modules`: a symlink to the main checkout's `node_modules`, made so Playwright runs in this worktree. Untracked, never staged.
