# Progress: Menu bar app

**Phase 5, your review.** The full set is ready: brief, architecture and plan, with all three reviews taken in. Three things need your attention: read the set, and answer two questions. No code is written until you say go. Last updated 2026-10-12 10:37.

**Docs:** [Crucible](00_crucible_menu_bar_app.html) · [Brief](01_brief_menu_bar_app.html) · [Architecture](02_architecture_menu_bar_app.html) · [Plan](03_plan_menu_bar_app.html) (each page carries its reviews at the bottom)

## Needs your attention

- [ ] **Review the full set:** start with the [brief](01_brief_menu_bar_app.html), then the [architecture](02_architecture_menu_bar_app.html) and the [plan](03_plan_menu_bar_app.html). Comment anywhere. Building waits for your go.
- [ ] **Should the count include documents you do not have open?** A: every document, with the menu marking which are open (recommended). C: only documents open in a browser. Details at the top of the brief's Questions section.

## Currently working on

| Agent or task | Doing | Started | Branch |
|---|---|---|---|
| Orchestrator | Waiting on your review of the full set | 2026-10-12 10:37 | `feat/menu-bar` |

## Phases

| Phase | Status | Changed |
|---|---|---|
| 0 Setup | done | 2026-10-12 |
| 1 Crucible | done | 2026-10-12 |
| 2 Brief | done | 2026-10-12 |
| 3 Architecture | done | 2026-10-12 |
| 4 Plan | done | 2026-10-12 |
| 5 Human review | in progress | 2026-10-12 |
| 6 Implement | not started | |
| 7 Verify | not started | |
| 8 Ship and land | not started | |
| 9 Cleanup | not started | |

## The record

### Task index

No tasks dispatched yet.

### Passes

No passes yet.

### Changes from plan

None.

### Follow-ups

None.

### Cleanup queue

Nothing queued.

### Test results

No test run yet.

### Ship

Not shipped yet.

## Log

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
