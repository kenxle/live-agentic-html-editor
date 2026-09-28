# Quiet tabs: a tab nobody is looking at stops asking

Whetstone-size. Part 1 of [GitHub issue 16](https://github.com/kenxle/live-agentic-html-editor/issues/16) (idle reviews cost too much). Part 2 of that issue, page servers that are never cleaned up, is not in this change. Progress is at the bottom.

## Summary

Every open review tab used to ask the helper for news once a second, forever. Now how often it asks depends on whether you are looking:

- The tab you are working in still asks once a second, so it feels exactly as responsive as before.
- A page you can see but are not in (beside the terminal) asks every 15 seconds.
- A hidden tab asks nothing at all. It only tells the helper "still open" once every five minutes.

Coming back to a tab checks at once, so anything that arrived while you were away shows up straight away. Measured over an hour: a hidden tab went from 720 requests to 12, and a visible page you are not in went from 3,960 to 600.

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

He then simplified it twice, and later added a middle pace. On focus: "we can use [focus] as the primary thing and we can drop the out of focus down to this like really slow heartbeat that just lets it know if that tab is still open... Five minutes... if we just do a check when I bring focus back then it should be sufficient for most cases." On the slowdown: "don't worry about the slowdown i don't think. with this design we'll only have one tab that is ever running at top speed. and i want it to feel responsive. waiting 30sec for it to pick up, just because you've been reading the doc for awhile, isn't a great experience." And on a visible page: "i can see why i might want visible to have a little more responsiveness, without being full speed."

## Requirements

1. **Three states.** Hidden means `document.hidden` is true (a background tab, a minimized window, a window on another macOS desktop). Otherwise the page is focused, unless `document.hasFocus()` is false, which makes it visible but not focused. Focus inside a frame on the page still counts as focused.
2. **Focused: poll once a second, steadily.** No slowdown. Only one tab can have focus, so only one tab ever runs at this pace.
3. **Visible but not focused: the reply poll and the read-only re-ask every 15 seconds.** The heartbeat stays at the ordinary 10 seconds, so the helper keeps its ordinary 30 second window for this page.
4. **Hidden: no reply poll and no read-only re-ask at all.** The only request is a "still open" heartbeat every 5 minutes. The helper holds a hidden tab's review for 390 seconds (see Approach for why that number and what it costs).
5. **Every page polls once at load, whatever its state.** That answer records which version of the file the page shows. Without it, a rebuild that lands before the reviewer comes back would never reload the page.
6. **Gaining focus polls at once and goes to full speed. Becoming visible after being hidden polls at once and goes to the 15 second pace.** That one poll shows any reply that arrived meanwhile and triggers any reload a rebuild owes. A return that fires both a visibility and a focus event polls once. Losing focus while still visible only moves the next poll out to 15 seconds.
7. **Closing the tab says goodbye, in any state.** The existing goodbye on `pagehide` frees the review at once.
8. **Drafts unchanged.** Hiding the tab or leaving a comment box still sends drafts at once. A window blur with nothing queued sends nothing.
9. **A keystroke costs nothing.** The owner, when he approved the design: "be careful about anything that is firing on every keystroke, as i think that was part of what slowed us down before. we were writing multiple places every keystroke." While the page is focused, a key press, click, pointer move or selection change starts no request, writes nothing to browser storage and schedules no timer. One listener watches keys, clicks and pointer moves. It returns at once when the page is focused. Otherwise it re-checks focus, to catch a missed focus event: a reviewer typing into the page is plainly here, and one who clicks straight into a frame on the page sends the top page no focus event.

## Approach

### The page (`src/layer/sync.js`)

- **The poll is a chain.** Each poll schedules the next one when it has answered, at the pace for the page's state (`attentionOf(doc)`: focused, visible or hidden). A hidden page simply does not schedule one. One poll in flight at most, one timer armed at most.
- **One handler for focus, blur and visibility** (`onAttention`). It compares the state with the last reading.
  - Going hidden clears the poll timer and the read-only re-ask.
  - Gaining focus, or leaving hidden, polls at once and resumes the chain at the new pace.
  - Losing focus while visible reschedules the next poll to 15 seconds.
- **The missed-focus guard.** `keydown`, `pointerdown` and `pointermove` listeners (capture, passive). They return at once while the page is focused; otherwise they re-check the state, and a return is handled as a return.
- **The heartbeat is a chain too, and each beat is timed from the answer to the last one.**
  - Every claim the page sends carries `quiet`. It is true only while hidden, and only if the helper has offered a slow beat.
  - The page counts the helper as told only when the helper GRANTS the latest claim, and it schedules the next beat after that answer.
  - So hiding sends nothing itself. The beat already due, at most 10 seconds out, carries `quiet: true`, and once it is granted the next beat is 5 minutes later.
  - If that beat fails (a helper being replaced, say), the page stays at 10 seconds and says quiet again.
  - Leaving hidden beats at once with `quiet: false` if the helper had been told quiet. That beat is also the check that this tab still holds the review.
  - A visible page, focused or not, keeps the 10 second beat.
- **A tab without focus, with the helper down, no longer retries every 1.2 seconds.** Before this, an unreachable helper made the holder re-post its claim every 1.2 seconds forever. Only a focused tab still retries that fast.
- **An older helper keeps the fast beat.** Against a helper that does not offer `quiet_heartbeat_seconds`, a hidden page keeps the 10 second beat, because that helper would call a slower holder gone after 30 seconds. It still stops polling.

### The helper (`src/service/reviews.js`, `routes.js`, `protocol.js`)

- `window.claim` takes an optional boolean `quiet`. The route passes `body.quiet === true` and nothing else.
- The helper stores `quiet` on the holder at every grant and every heartbeat, writes it to `windows.json`, and reads it back after a restart.
- Grants and refusals carry `quiet_heartbeat_seconds: 300`.
- A quiet holder is stale after `QUIET_STALE_AFTER_MS`, 390 seconds. Any other holder keeps `STALE_AFTER_MS`, 30 seconds. Staleness is still checked only when another window asks, so a quiet holder loses nothing unless someone else wants the review.
- After a restart, `page_last_seen_at` (what `lahe status` reports) falls back to the holder's `last_seen` from `windows.json` until the page next speaks. Without that, an open hidden page would be reported as never connected.
- The refusal names the holder's own wait: "wait 7 minutes after it stops responding" for a quiet holder, rounded up from 390 seconds.

**Why 390 seconds.** It adds up three things:

- the 5 minute beat
- 60 seconds, because Chrome wakes a long-hidden tab's timers only once a minute, so a 5 minute timer can fire up to a minute late
- the same 30 seconds of slack a focused holder already gets over its 10 second beat

**What it costs.**

- A tab that crashes, or a browser that is force-quit, while the tab is hidden now holds its review for up to 390 seconds (6.5 minutes) before another window can take it on its own. Before, that was 30 seconds.
- A tab that crashes while visible, focused or not, is unchanged at 30 seconds.
- After a laptop sleep longer than 390 seconds, a hidden page counts as gone until its next beat. A read-only second window may take the review over in the meantime. There is still only one holder, and nothing typed is lost.
- Closing the tab normally still frees the review at once. "Review here instead" in the next window still takes it at once (unit test "Review here instead takes a quiet holder's review at once").

**Left unchanged on purpose.** The CLI's "somebody is using this helper" window (`LIVE_WINDOW_MS`, 120 seconds) is shorter than the quiet beat. So a command may replace the helper while only hidden tabs are open. That is safe: the session table is saved with the quiet flag and restored by the new helper, and the hidden page makes no request until its next beat or its return. `lahe status` "page last seen" will show an older time for a hidden tab, which is true.

### Page reload after a rebuild

The poll triggers the reload when it sees a new modified time on the page's file. A hidden tab does not poll, so it does not reload while hidden. The poll on return sees the new time and reloads after the existing 1.5 second debounce. A visible page notices within 15 seconds. The poll at load (requirement 5) is what makes this safe for a page that loaded while hidden.

## Tasks

1. Spec (this page).
2. Unit tests, red first (`test/unit/quiet_tab_polling.test.js`, on `node:test` mock timers).
   - Page side:
     - the three paces
     - 200 keystrokes cost no request, write or timer
     - a visible page shows a reply within 15 seconds and keeps the ordinary beat
     - no poll while hidden
     - a heartbeat every 5 minutes while hidden, only after a granted quiet beat
     - a failed quiet beat keeps the fast pace
     - leaving hidden polls once and beats once
     - a page loaded hidden still reloads for a rebuild
     - the goodbye goes out while unfocused
     - the read-only re-ask at each pace
     - an old helper keeps the fast beat
   - Helper side:
     - the 390 second quiet window, 30 seconds otherwise
     - quiet survives a restart
     - Review here instead is immediate
     - the route passes only a boolean
     - last-seen falls back to the saved table
3. Build the page side in `src/layer/sync.js`.
4. Build the helper side in `src/service/reviews.js`, `src/service/routes.js`, `src/shared/protocol.js`.
5. Browser spec `test/browser/quiet_tab_polling.spec.js`, on Playwright's page clock:
   - a hidden tab sends two heartbeats and no poll in 10 minutes, and bringing it back polls once and shows a reply written meanwhile
   - a visible page without focus shows a reply from its next 15 second poll
   - closing an unfocused tab frees the review for the next window at once
6. `scripts/measure_idle_requests.js`: request counts over a fixed window per state, before and after.
7. `docs/CONTRACTS.md`:
   - the `window.claim` body and answers
   - the quiet staleness rule
   - the laptop-sleep case
   - the page's three paces

## Acceptance criteria

- [x] A focused tab polls once a second, as before.
- [x] A visible page without focus polls every 15 seconds and shows a reply within 15 seconds.
- [x] A hidden tab sends no reply poll; its only request is one heartbeat per 5 minutes.
- [x] Gaining focus or becoming visible polls at once, once, and shows what arrived. An owed reload happens, including for a page that loaded hidden.
- [x] Closing an unfocused tab frees the review at once.
- [x] The helper holds a quiet (hidden) holder for 390 seconds and any other for 30. Review here instead is immediate. The page slows only after a granted quiet beat.
- [x] Keystrokes cause no request, storage write or timer.
- [x] Commit, Hold, the draft floor and hide-flush behave as before (existing tests pass unchanged).
- [x] Before and after request counts on this page, from the script.
- [x] `npm run gate:unit` green; the named browser specs green.

## Measurements

The counts come from `node scripts/measure_idle_requests.js <tree> --minutes N`.

- "Before" is `git archive 7c86bed` (main when this branch was cut), run through the same script.
- The script runs each tree's own `sync.js` and `store.js` on a virtual clock. That tree's own `reviews.js` answers the window claims. The script counts every request the page makes.
- Each state is a fresh page that already holds its review.
- "Active" is a key press every 2 seconds and a click every 10.
- "Closed" counts only what the close itself sends.
- The percentages were computed with Python from these counts.

Ten minutes:

| State | Before: total (polls, claims) | After: total (polls, claims) | Change |
| --- | --- | --- | --- |
| Focused, idle | 660 (600, 60) | 660 (600, 60) | 0% |
| Focused, active | 660 (600, 60) | 660 (600, 60) | 0% |
| Visible, not focused | 660 (600, 60) | 100 (40, 60) | -84.8% |
| Hidden | 120 (60, 60) | 2 (0, 2) | -98.3% |
| Closed while hidden | 1 (the goodbye) | 1 (the goodbye) | 0% |

One hour:

| State | Before | After | Change |
| --- | --- | --- | --- |
| Focused, idle | 3,960 | 3,960 | 0% |
| Visible, not focused | 3,960 | 600 (240 polls, 360 heartbeats) | -84.8% |
| Hidden | 720 | 12 | -98.3% |

Notes on the numbers:

- In every state except "closed", the page still held its review at the end of the window, as the helper saw it (the script's `helper_still_holds` column).
- The focused tab is unchanged on purpose: it is the one the reviewer is working in. The saving comes from every other open tab.
- On a visible page without focus, the 10 second heartbeat is now most of what is left. It stays because the helper's ordinary 30 second window keeps a crashed visible page from holding the review for long.
- The script does not model a real browser's own timer throttling for hidden tabs. That throttling only ever lowers the hidden counts further.

## Progress

- 2026-09-28: first spec written with the exponential slowdown. The owner then made focus the switch (no polling at all while unfocused, a 5 minute "still open" beat), then dropped the slowdown so the focused tab stays at once a second. The backoff code was removed, not left switched off.
- 2026-09-28: built. Unit tests in `test/unit/quiet_tab_polling.test.js` (29 tests; 18 fail on the old code, the other 11 pin behavior that must not change). One old test in `test/unit/sync_client.test.js` asserted the old hidden cadence and now asserts no poll while hidden. `npm run gate:unit`: 1,378 tests, 1,376 pass, 0 fail, 2 todo.
- 2026-09-28: browser. `test/browser/quiet_tab_polling.spec.js` (3 tests) passed on the rebuilt bundle, and its first two failed on main's committed bundle. The existing specs ran on the rebuilt bundle (not staged): 61 passed, 0 failed, and 1 skipped by its own file. The specs were:
  - `window_goodbye`
  - `duplicate_tab`
  - `takeover_walk`
  - `rail_second_window`
  - `reload_claim`
  - `helper_restart_holds`
  - `auto_reload`
  - `rail_agent_liveness`
  - `agent_replies`
  - `graceful_failure`
  - `end_review`
  - `ac4_probe`
  - `bfcache_restore`
  - `status_truth`
  - `rebuild_not_the_agents_job`
- 2026-09-28: code review fixes, each with a test that failed first.
  1. A page that loads unfocused now polls once at load, so it records which version of the file it shows. Before, a rebuild that landed before the reviewer returned never reloaded it.
  2. The page counts the helper as told "quiet" only when a grant answers that claim, and times the next beat from the answer. Before, a helper replaced during that beat left the page on a 5 minute beat while the new helper allowed 30 seconds.
  3. A pointer move re-checks focus, for a return by clicking straight into a frame.
  4. After a helper restart, `lahe status` takes the page's last-seen time from `windows.json` until the page speaks.

  `docs/CONTRACTS.md` also notes the laptop-sleep case.
- 2026-09-28: the owner decided a visible page without focus gets a middle pace: "i can see why i might want visible to have a little more responsiveness, without being full speed." Built:
  - the reply poll and the read-only re-ask every 15 seconds
  - the ordinary heartbeat, and no quiet flag, so its claim keeps the 30 second window
  - only a hidden page goes quiet
  - every page polls once at load, in any state

  Tests, the browser spec, the measurements and `docs/CONTRACTS.md` were updated to three states. Unit tests are now 37, of which 11 failed on the branch before this round.

## To delete at cleanup

- `.claude/worktrees/quiet-tab-polling/node_modules`: a symlink to the main checkout's `node_modules`, made so Playwright runs in this worktree. Untracked, never staged.
