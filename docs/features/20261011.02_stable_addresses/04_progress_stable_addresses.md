# Progress: Stable addresses

**Phase 6, Implement.** You approved the doc set and asked me to keep going until it is done. The CI workflow is merged and the core builder is on Step 1. Waiting on you later: approving the old tests to retire, running `lahe install`, and merge approval. Last updated 2026-10-11 15:14.

**Docs:** [Decisions page](../../ongoing/STABLE_ADDRESSES.md) · [Crucible](00_crucible_stable_addresses.html) · [Brief](01_brief_stable_addresses.html) · [Architecture](02_architecture_stable_addresses.html) · [Plan](03_plan_stable_addresses.html) · [Code survey](parts/architecture/recon.md)

## Needs your attention

None.

## Currently working on

| Agent or task | Doing | Started | Branch |
|---|---|---|---|
| Core builder (Opus) | Step 1: name registry, page serving on port 1483, binding, behind `LAHE_PAGES=sites` | 2026-10-11 15:14 | `unit/sa-core` |

## Phases

| Phase | Status | Changed |
|---|---|---|
| 0 Setup | done | 2026-10-11 |
| 1 Crucible | done | 2026-10-11 |
| 2 Brief | done | 2026-10-11 |
| 3 Architecture | done | 2026-10-11 |
| 4 Plan | done | 2026-10-11 |
| 5 Human review | done | 2026-10-11 |
| 6 Implement | in progress | 2026-10-11 |
| 7 Verify | not started | 2026-10-11 |
| 8 Ship and land | not started | 2026-10-11 |
| 9 Cleanup | not started | 2026-10-11 |

## The record

### Task index

No tasks dispatched yet.

### Passes

No passes yet.

### Changes from plan

None.

### Follow-ups

- Mac menu-bar companion app with a Library link (settled as its own follow-up).
- HTTPS for `.lahe`, so a `.lahe` page counts as secure and `.lahe` could be printed. Lahe would make its own certificate, limited to `.lahe` names, and the computer would trust it once.
- Test leak: 60 page servers left running from the idle-server tests (state folders named `lahe-idle-state-*`), found 2026-10-11.

### Cleanup queue

- `../lahe-worktrees/sa-ci-dispatch` worktree and its local branch `chore/spike-dispatch-workflow`: PR #40 is merged.
- `.github/workflows/spike.yml` on main: temporary, remove before this feature's last PR merges.
- `docs/features/20261011.02_stable_addresses/02_architecture_stable_addresses_reviews_security.html`: stale build output from before the review files were combined.
- `docs/features/20261011.02_stable_addresses/parts/reviews/`: the two original review files, now copied into `02_architecture_stable_addresses_reviews.md`.

### Test results

**PR 0 local gate** (`npm run gate`, run alone, on `chore/spike-dispatch-workflow`): 844 passed, 0 failed, 6 skipped, 8.8 minutes. Helpers running before and after: 2 and 2.

**Idle-cost baseline (Task 0.2), today's design, on this Mac, 2026-10-11 15:21.** Five minutes of sampling every 10 seconds by [measure_idle_baseline.py](progress/measure_idle_baseline.py); raw samples in [baseline_idle_cost.json](progress/baseline_idle_cost.json). Nothing was done to the processes measured.

| Measure | Value |
|---|---|
| Page servers running at once | 16 to 27, average 21.4 |
| Separate page server processes seen in 5 minutes | 51 |
| Memory of page servers | average 611 MB, peak 866.5 MB |
| Memory of page servers plus helper processes | average 739.9 MB |
| Helper idle wakeups (`top`, one 60-second interval) | 107 |

The page servers belong to about 13 agent sessions. They keep restarting: each lives about two minutes, stops, and a new one starts. Task 5.4 compares the always-on helper against these numbers.

### Ship

Not shipped yet.

## Log

- 2026-10-11 15:29: PR #40 merged (hand-run spike workflow, CI gate passed). Step 0 done. Main merged into `feat/stable-addresses`.
- 2026-10-11 15:21: Idle-cost baseline measured: 51 separate page server processes in 5 minutes, about 21 running at once, about 740 MB with the helpers. PR 0 (hand-run CI workflow) open as #40; local gate 0 failed.
- 2026-10-11 15:02: Ken approved the doc set: the login gap accepted, and the hand-run CI workflow approved on condition it costs nothing (standard GitHub machines are free for this public repo). Phase 5 done.
- 2026-10-11 14:52: Ken finished the brief. Settled in review: names are the folder plus two parents joined by dots (`live-agentic-html-editor.docs.ongoing`), one name per folder; pages on port 1483 with the API staying on 7817; `lahe review` prints `.lahe.localhost`; `lahe install --port-80` drops the port on macOS; `.lahe` is an option on all three systems, by command on macOS and written steps elsewhere; no npm package. Architecture and plan updated to match. HTTPS for `.lahe` added as a follow-up.
- 2026-10-11 12:56: Plan review returned 22 findings (2 blockers: main would have been broken between pull requests). All accepted: the Library's new Open ships with the first PR behind the switch, the page lookups ask both old and new until the switch flips, and nine verification rows were added. Doc set served for your review.
- 2026-10-11 12:48: Plan written: four workstreams, five PRs, 64 verification rows. Plan review dispatched.
- 2026-10-11 12:48: Architecture and security reviews returned 5 blockers between them. Architecture reworked: a name per folder (today's isolation unit) so paths, Markdown links, and rail rules keep working; binding is CLI-only; `.lahe` becomes a guarded Mac option with `.lahe.localhost` recommended as the printed ending, which reverses your earlier choice and is queued for your decision.
- 2026-10-11 12:35: Architecture written. Security and architecture reviews dispatched.
- 2026-10-11 12:35: PM review returned 12 findings (1 blocker: switching between `.lahe` and `.lahe.localhost` would kill addresses). All accepted into the brief. Recon found four blockers the architecture handles, including one worth your eye: a plain `.lahe` address is "Not secure" to the browser (see the architecture's failure modes).
- 2026-10-11 12:27: Crucible and brief written from the decisions page. PM review dispatched.
- 2026-10-11 12:24: Feature started. Ken settled all four questions on the decisions page and asked for the full doc set without stopping.
