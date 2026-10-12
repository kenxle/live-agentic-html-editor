# Progress: Menu bar app

**Phase 3, Architecture.** The brief is done with all 15 PM findings taken in, and the architecture is drafted. A security reviewer is on it now. Nothing is waiting on you yet; one question for you will come with the full set. Last updated 2026-10-12 10:17.

**Docs:** [Crucible](00_crucible_menu_bar_app.md) · [Brief](01_brief_menu_bar_app.md) · [Brief reviews](01_brief_menu_bar_app_reviews.md) · [Architecture](02_architecture_menu_bar_app.md) · [Plan](03_plan_menu_bar_app.md)

## Needs your attention

Nothing is waiting on you.

## Currently working on

| Agent or task | Doing | Started | Branch |
|---|---|---|---|
| Security reviewer | Reviewing the architecture | 2026-10-12 10:17 | `feat/menu-bar` |

## Phases

| Phase | Status | Changed |
|---|---|---|
| 0 Setup | done | 2026-10-12 |
| 1 Crucible | done | 2026-10-12 |
| 2 Brief | done | 2026-10-12 |
| 3 Architecture | in progress | 2026-10-12 |
| 4 Plan | not started | |
| 5 Human review | not started | |
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

- 2026-10-12 10:17: PM review returned 15 findings (4 high). All accepted: only a focused tab counts as looking, per page; replies before install never count, so day one shows zero; a distinct "can't tell" look; every way a question clears is listed. One question for you came out of it (when an open question stops counting); it waits for the full review. Architecture drafted; security review started.
- 2026-10-12 10:17: Measured on your real data: building the Library's whole list takes about 150 ms (870 ms cold) over 690 reviews, so the menu reads a per-review cache instead. 45 documents have an old unanswered agent question today.
- 2026-10-12 10:10: Brief written: 20 requirements across the icon, what waiting on you means, the menu, installing, and cost and safety. Sent to the PM reviewer.
- 2026-10-12 10:09: You agreed all five premises. Crucible summary written and marked accepted. Brief started.
- 2026-10-12 10:02: Eleven comments answered. Requirements moved out of the premises into their own list; the job moved to Jobs to be done. A (SwiftBar) and C (Dock badge) ruled out, so the approach is B. Five new premises posted.
- 2026-10-12 09:35: You chose option B (waiting-on-you count) and added recent documents and a busy signal. Six comments answered. Premises, the case against, and approaches A (SwiftBar script), B (native Mac app), C (Library badge in the Dock) added to the crucible page.
- 2026-10-12 09:31: Crucible page written. The other crucible answers are drafted from the stable addresses discussion, for you to correct.
- 2026-10-12 09:29: Feature started. Worktree at `../lahe-worktrees/menu-bar`, branch `feat/menu-bar`, cut from main at `761d226d`. The idea comes from the stable addresses work, which settled that the menu bar app would be its own follow-up.
