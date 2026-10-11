# Progress: Stable addresses

**Phase 3, Architecture.** The brief is reviewed and updated; the architecture is written and two reviewers (security, architecture) are reading it. Nothing is waiting on you until the full set is ready. Last updated 2026-10-11 12:35.

**Docs:** [Decisions page](../../ongoing/STABLE_ADDRESSES.md) · [Crucible](00_crucible_stable_addresses.md) · [Brief](01_brief_stable_addresses.md) · [Architecture](02_architecture_stable_addresses.md) · [Plan](03_plan_stable_addresses.md)

## Needs your attention

Nothing is waiting on you.

## Currently working on

| Agent or task | Doing | Started | Branch |
|---|---|---|---|
| Security reviewer | Reviewing the architecture | 2026-10-11 12:35 | `feat/stable-addresses` |
| Architecture reviewer | Reviewing the architecture | 2026-10-11 12:35 | `feat/stable-addresses` |

## Phases

| Phase | Status | Changed |
|---|---|---|
| 0 Setup | done | 2026-10-11 |
| 1 Crucible | done | 2026-10-11 |
| 2 Brief | done | 2026-10-11 |
| 3 Architecture | in progress | 2026-10-11 |
| 4 Plan | not started | 2026-10-11 |
| 5 Human review | not started | 2026-10-11 |
| 6 Implement | not started | 2026-10-11 |
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
- Test leak: 60 page servers left running from the idle-server tests (state folders named `lahe-idle-state-*`), found 2026-10-11.

### Cleanup queue

Nothing queued.

### Test results

No test run yet.

### Ship

Not shipped yet.

## Log

- 2026-10-11 12:35: Architecture written. Security and architecture reviews dispatched.
- 2026-10-11 12:35: PM review returned 12 findings (1 blocker: switching between `.lahe` and `.lahe.localhost` would kill addresses). All accepted into the brief. Recon found four blockers the architecture handles, including one worth your eye: a plain `.lahe` address is "Not secure" to the browser (see the architecture's failure modes).
- 2026-10-11 12:27: Crucible and brief written from the decisions page. PM review dispatched.
- 2026-10-11 12:24: Feature started. Ken settled all four questions on the decisions page and asked for the full doc set without stopping.
