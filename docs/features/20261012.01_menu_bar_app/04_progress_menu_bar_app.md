# Progress: Menu bar app

**Phase 6, building.** You approved the plan at 20:35 and every question is settled. Step 0 is done (the wire in CONTRACTS.md, fixtures, proof vectors, the gate script; unit gate 2724 passed, 0 failed) and the three builders are at work in their own worktrees. Nothing needs you right now. Last updated 2026-10-12 20:44.

**Docs:** [Crucible](00_crucible_menu_bar_app.html) · [Brief](01_brief_menu_bar_app.html) · [Architecture](02_architecture_menu_bar_app.html) · [Plan](03_plan_menu_bar_app.html) (each page carries its reviews at the bottom)

## Needs your attention

Nothing right now. The one thing coming later: the menu bar screenshots. The capture probe below shows an agent cannot take them on this Mac, so when the app is built, you will be asked for one picture of the icon and its open menu.

## Currently working on

| Agent or task | Doing | Started | Branch |
|---|---|---|---|
| Orchestrator | Watching the three builders; integrates and runs the browser suite at the checkpoint | 2026-10-12 20:44 | `feat/menu-bar` |
| Builder: summary (Opus) | Step 1: the read mark's round trip, the one-review summary, the summary and its cache, the two routes and the signed auth mode | 2026-10-12 20:44 | `feat/menu-bar-summary` |
| Builder: macapp (Opus) | Step 2: the Swift app, its debug modes, the fake helper | 2026-10-12 20:44 | `feat/menu-bar-macapp` |
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
| summary | 1.1 to 1.4 | `feat/menu-bar-summary` | building |
| macapp | 2.1 to 2.3 | `feat/menu-bar-macapp` | building |
| install | 3.1 to 3.4 | `feat/menu-bar-install` | built, `efe79a40`; waits for integration |

### Passes

No passes yet.

### Changes from plan

- **install:** the app is built under `<state>/menubar/.build-*` rather than the system temp folder, so the final rename stays on one volume. The source stamp also hashes the compiler flags, so a recipe change rebuilds too. The stop message reads "the person using this computer stopped it from the menu bar at <time>" rather than naming Ken, because the repo is public; `lahe status` says "stopped by you". SR6 (labels are constants) is met for the icon and for the new bootstrap path, but kickstart still reads the helper's label from `install.json` as it did before this feature, now limited to the four known label shapes; the three callers are outside this workstream. Noted for the integration review.

### Follow-ups

None.

### Cleanup queue

Nothing queued.

### Test results

No test run yet.

**Capture probe (Step 0, 2026-10-12 20:36):** `screencapture -x -R 0,0,600,30` from the agent's terminal fails with "could not create image from rect" (no screen recording permission). So V29's icon looks come from the app's own `--snapshot` (drawn in code, no permission needed), and the real menu bar picture in V32 is yours to take.

**Starting counts (V33, 2026-10-12 20:36):** helpers 1 (the real one), menu bar apps 0, fake helpers 0, `launchctl list` lahe-test 0, lahe-test plists 0.

### Ship

Not shipped yet.

## Log

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
