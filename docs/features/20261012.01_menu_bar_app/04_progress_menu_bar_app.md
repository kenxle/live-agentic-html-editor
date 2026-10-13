# Progress: Menu bar app

**Phase 6, building.** You approved the plan at 20:35 and every question is settled. Step 0 is done (the wire in CONTRACTS.md, fixtures, proof vectors, the gate script; unit gate 2724 passed, 0 failed) and the three builders are at work in their own worktrees. Nothing needs you right now. Last updated 2026-10-12 20:44.

**Docs:** [Crucible](00_crucible_menu_bar_app.html) · [Brief](01_brief_menu_bar_app.html) · [Architecture](02_architecture_menu_bar_app.html) · [Plan](03_plan_menu_bar_app.html) (each page carries its reviews at the bottom)

## Needs your attention

Nothing right now. The one thing coming later: the menu bar screenshots. The capture probe below shows an agent cannot take them on this Mac, so when the app is built, you will be asked for one picture of the icon and its open menu.

## What it looks like

Drawn by the app itself (`--snapshot`), on made-up data, since an agent cannot capture the real menu bar on this Mac. The real picture comes at the end, from you.

![The icon with a count of 3, light](screenshots/icon_count_3_light.png) ![The icon with a count of 3, dark](screenshots/icon_count_3_dark.png)

![The open menu on the full sample summary, light](screenshots/menu_summary_light.png)

![The menu while Lahe is stopped by you, dark](screenshots/menu_stopped_dark.png)

The icon keeps the review layer's speech bubble. Main changed the browser tab's icon to a document mark on 2026-10-12 (`e5397fda`); the bubble stays here because the count is about replies. Say so on this page if you want the document mark instead. Every look and every menu dump is under [screenshots/](screenshots/).

## Currently working on

| Agent or task | Doing | Started | Branch |
|---|---|---|---|
| Orchestrator | Checkpoint 1 (PR 1): browser suite, code and security reviews of the integrated diff, then the pull request | 2026-10-12 20:44 | `feat/menu-bar` |
| Builder: summary (Opus) | Done: returned and merged at 2026-10-12 21:20 | 2026-10-12 20:44 | `feat/menu-bar-summary` |
| Builder: macapp (Opus) | Done: returned at 2026-10-12 21:10. Waiting for summary before the merge | 2026-10-12 20:44 | `feat/menu-bar-macapp` |
| Builder: install (Opus) | Done: returned at 2026-10-12 21:06. Waiting for the other two before the merge | 2026-10-12 20:44 | `feat/menu-bar-install` |

## Phases

| Phase | Status | Changed |
|---|---|---|
| 0 Setup | done | 2026-10-12 |
| 1 Crucible | done | 2026-10-12 |
| 2 Brief | done | 2026-10-12 |
| 3 Architecture | done | 2026-10-12 |
| 4 Plan | done | 2026-10-12 |
| 5 Human review | done | 2026-10-12 |
| 6 Implement | in progress | 2026-10-12 |
| 7 Verify | not started | |
| 8 Ship and land | not started | |
| 9 Cleanup | not started | |

## The record

### Task index

| Workstream | Tasks | Branch | Status |
|---|---|---|---|
| summary | 1.1 to 1.4 | `feat/menu-bar-summary` | built, `14997075`; merged into `feat/menu-bar` for PR 1 |
| macapp | 2.1 to 2.3 | `feat/menu-bar-macapp` | built, `02503610`; waits for integration |
| install | 3.1 to 3.4 | `feat/menu-bar-install` | built, `efe79a40`; waits for integration |

### Passes

No passes yet.

### Changes from plan

- **summary:** the per-review cache is keyed on `review.json`, `meta.json` and `events.jsonl` (size, time and inode each), as the plan named. The builder first keyed it on the review folder, which was faster (8 to 9 ms against 37 ms for 700 made-up reviews), but the code review showed a folder's time is too coarse on Linux to catch two rewrites in one tick, so the files are the key and the no-symlink walk is cached instead; the reviewed document is checked only while the review has an unread reply. The warm median is still to be measured on a quiet machine (V18). Read marks post through a Hold on the rail, since they are not agent work. `reply_seen` is not in `review.json`, which agents read; it travels on the page's own reads and the summary folds `events.jsonl`. `library_url` ends in `/catalog` because the Library host refuses `/`. Retired reviews appear in no section. A path outside the home folder shows only the file name. Every refusal on the two routes is a signed 401 `AUTH_REFUSED` whose detail names the check. `summary_many.json` had 40 documents with more questions than unread, which the contract rules out; fixed, and a test guards it.
- **macapp:** the executable inside the bundle is `LaheMenuBar` (what Activity Monitor shows), while the install recipe wrote `Lahe`; reconciled at integration to `LaheMenuBar`. The app rereads the secret after a bad signature as well as after a 401, because a replaced secret makes the helper sign its 401 with the new key. Waiting on you is never cut short (brief R12), where the builder's prompt had said otherwise.
- **install:** the app is built under `<state>/menubar/.build-*` rather than the system temp folder, so the final rename stays on one volume. The source stamp also hashes the compiler flags, so a recipe change rebuilds too. The stop message reads "the person using this computer stopped it from the menu bar at <time>" rather than naming Ken, because the repo is public; `lahe status` says "stopped by you". SR6 (labels are constants) is met for the icon and for the new bootstrap path, but kickstart still reads the helper's label from `install.json` as it did before this feature, now limited to the four known label shapes; the three callers are outside this workstream. Noted for the integration review.

### Follow-ups

None.

### Cleanup queue

Nothing queued.

### Test results

- Checkpoint 1 (PR 1, `cc04e6a1`): `npm run gate:unit` 2769 passed, 0 failed; the browser suite alone, Chromium: 884 passed, 0 failed, 7 skipped, in 7.3 minutes; helpers 1 before and 1 after.
- PR 2 integration (`feat/menu-bar-pr2`, `10067c50`): `npm run gate:unit` 2831 passed, 0 failed; `npm run check:menubar` built `Lahe.app` through the real recipe in 7.4 seconds and the app's self-test passed 84 of 84; no helper or launchd job left behind. The app's own four tests against a test build and the fake helper: 4 passed, 0 failed, including Stop and Start on a `lahe-test` launchd job; no job or plist left behind.
- Checkpoint 1 after the fix round (`77ad1ed4`): the browser suite alone, Chromium: 884 passed, 0 failed, 7 skipped, in 7.2 minutes.

**Capture probe (Step 0, 2026-10-12 20:36):** `screencapture -x -R 0,0,600,30` from the agent's terminal fails with "could not create image from rect" (no screen recording permission). So V29's icon looks come from the app's own `--snapshot` (drawn in code, no permission needed), and the real menu bar picture in V32 is yours to take.

**Starting counts (V33, 2026-10-12 20:36):** helpers 1 (the real one), menu bar apps 0, fake helpers 0, `launchctl list` lahe-test 0, lahe-test plists 0.

### Ship

Not shipped yet.

## Log

- 2026-10-12 21:53: the browser suite on the merged fix round: 884 passed, 0 failed, 7 skipped. The spec check of PR 1 found no blocking gap; its follow-ups (no nulls where the app expects strings, two missing tests, three stale doc lines) are with the summary builder and done in the docs. PR 1 opens after that follow-up and one last full gate on the final commit.
- 2026-10-12 21:44: the fix round came back (`f80c73ae`) with all ten findings fixed, each test written red first, and is merged. gate:unit on the merge: 2780 passed, 0 failed. One number still open: the summary's warm median on a 700-review made-up state folder measured 8.7 to 13.4 ms with the machine at a load of about 9 from other agents; V18's 10 ms limit is measured on a quiet machine at Step 4. The browser suite runs again once another agent's run on this machine finishes; the independent spec check of PR 1 started.
- 2026-10-12 21:32: code review of PR 1 returned three findings, all taken: a Hold on the rail would also hold back read marks, so the icon would keep counting what you had read (read marks now post through a Hold); the cache key stats the review folder, whose time is too coarse on Linux to catch two rewrites in one tick (back to the files the plan named); `reply_seen` was on every item in `review.json`, which agents read, so it moves out of that file and stays on the page's own reads. One fix round sent to the summary builder with the seven security findings.
- 2026-10-12 21:31: PR 2's integrated branch is green on the unit gate (2831 passed, 0 failed) and the real build check (the app compiles through `src/service/menubar.js` and passes its self-test). Its browser suite runs after PR 1's fix round.
- 2026-10-12 21:29: checkpoint 1's browser suite, run alone: 884 passed, 0 failed, 7 skipped. PR 2's unit gate and the real Swift build check run next in the scratch worktree.
- 2026-10-12 21:27: security review of PR 1's code returned: SR1 to SR4 met. One important finding: a page title holding a lone UTF-16 surrogate would reach the summary and make the app refuse the whole answer, so the icon would stick on "can't tell" until that review is retired. Six minor: a proof captured just before a helper restart replays once (refuse proofs older than the helper's start); C1 controls and the line separators are not stripped; `summary.open` buffers 8 MB before any check; one unreadable review darkens the whole count and the 500's text can carry a path; a session file swapped for a symlink after first read is followed; a dropped `reply.seen` still lands in the log in full. All go to the summary builder in one fix round with the code review's findings.
- 2026-10-12 21:23: PR 2 prepared on `feat/menu-bar-pr2` while checkpoint 1 runs: the Mac app and install branches merged with no conflicts; `index.js` now runs the rebuild check on the 15-second beat and clears the stop marker once the helper is up; the executable is `LaheMenuBar` on both sides; the Library fallback address ends in `/catalog`; `docs/ongoing/MENU_BAR.md`, the `macos/` line in CLAUDE.md and the install section written. Its gate runs after checkpoint 1's browser suite finishes, never two at once.
- 2026-10-12 21:20: summary builder returned and merged (`14997075`, merge `67cfcd77`): the `reply.seen` round trip (the rail's read mark now reaches the store and comes back to every browser), the one unread rule in `src/shared/record.js`, the one-review reader, `src/service/summary.js` with its cache and `summary.json`, the two routes on the signed auth mode. gate:unit 2769 passed, 0 failed; the V19 browser spec 4 of 4, twice. On the merge: 2769 passed, 0 failed, bundle rebuilt. Code review and security review of the integrated diff started; the browser suite runs next, alone.
- 2026-10-12 21:10: Mac app builder returned: one Swift file (AppKit, Foundation, CryptoKit), `Info.plist`, a README with the exact build command, the fake helper and its unit test. Self-test 87 passed, 0 failed; gate:unit 2727 passed, 0 failed, 4 skipped on purpose (the app tests run only against a test build); no helper, fake helper or launchd job left behind. Ten icon snapshots and seven menu dumps in the feature folder; three are shown above.
- 2026-10-12 21:06: install builder returned: `src/service/menubar.js` (the one build recipe, the app's login item, rebuild on change), `lahe install --menu-bar` and `--no-menu-bar`, `lahe menubar show` and `rebuild`, Stop holds through `stopped.json`, the status line, `docs/CLI.md`. 59 new unit tests; gate:unit 2783 passed, 0 failed; no helper leaked. A throwaway Swift file compiled through the real recipe and ran. Two wiring points left for integration (`tick` in the 15-second timer, the stop-marker clear after the listener binds).
- 2026-10-12 20:44: Step 0 committed (`13833038`). Three builders dispatched, one per workstream, each in its own worktree cut from that commit.
- 2026-10-12 20:40: Plan approved. Your review changed three rules: "read" is the rail's own "1 new" mark, posted to the store, with no logic of its own and a question treated like any reply; Stop Lahe holds until you start it, and agents' commands fail plainly meanwhile; every document counts, open or not, with open ones marked in the menu. Main merged into the branch (Mark as done and the read mark are what the design now builds on). Step 0 started.
- 2026-10-12 10:37: Plan review returned 23 findings (6 high), all accepted. The most important: a background tab could have marked answers as seen when it reloaded; a test step would have stopped your live helper (tests now use their own labels and never touch your login items); the signed-request format is now written down exactly, with test vectors, so the Node and Swift halves cannot drift. Full set built and ready for you.
- 2026-10-12 10:26: Security review returned 7 findings. The one real hole: the app would have sent its secret to any program sitting on the helper's port, which Stop leaves free. Fixed in the design: the app signs requests instead of sending the secret, and trusts only signed answers. The other five fixes are accepted too. One (whether Stop should hold while agents are connected) is now a question for you. The CLI has the same secret weakness today; filed on the board. Plan drafted (3 parallel workstreams, 2 PRs, 34 checks) and sent to the plan reviewer.
- 2026-10-12 10:17: PM review returned 15 findings (4 high). All accepted: only a focused tab counts as looking, per page; replies before install never count, so day one shows zero; a distinct "can't tell" look; every way a question clears is listed. One question for you came out of it (when an open question stops counting); it waits for the full review. Architecture drafted; security review started.
- 2026-10-12 10:17: Measured on your real data: building the Library's whole list takes about 150 ms (870 ms cold) over 690 reviews, so the menu reads a per-review cache instead. 45 documents have an old unanswered agent question today.
- 2026-10-12 10:10: Brief written: 20 requirements across the icon, what waiting on you means, the menu, installing, and cost and safety. Sent to the PM reviewer.
- 2026-10-12 10:09: You agreed all five premises. Crucible summary written and marked accepted. Brief started.
- 2026-10-12 10:02: Eleven comments answered. Requirements moved out of the premises into their own list; the job moved to Jobs to be done. A (SwiftBar) and C (Dock badge) ruled out, so the approach is B. Five new premises posted.
- 2026-10-12 09:35: You chose option B (waiting-on-you count) and added recent documents and a busy signal. Six comments answered. Premises, the case against, and approaches A (SwiftBar script), B (native Mac app), C (Library badge in the Dock) added to the crucible page.
- 2026-10-12 09:31: Crucible page written. The other crucible answers are drafted from the stable addresses discussion, for you to correct.
- 2026-10-12 09:29: Feature started. Worktree at `../lahe-worktrees/menu-bar`, branch `feat/menu-bar`, cut from main at `761d226d`. The idea comes from the stable addresses work, which settled that the menu bar app would be its own follow-up.
