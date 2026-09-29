# Progress: LAHE starts your agent when a comment is ready

**Phase 5, Plan, revised and ready for your review.** You rejected one new agent per batch of comments. The design now keeps one headless agent running per review, owned by LAHE, which wakes it, checks every reply, and replaces it if it dies. The brief, architecture and plan are revised and re-reviewed. Nothing is built yet. Last updated 2026-09-29 14:39.

**Docs:** [Crucible](00_crucible_lahe_agent_sdk.md) · [Research](research_agent_sdk.md) · [Spike: one run per wake](spike_headless_run.md) · [Spike: one kept agent](spike_persistent_run.md) · [Brief](01_brief_lahe_agent_sdk.md) · [Brief reviews](01_brief_lahe_agent_sdk_reviews.md) · [Wireframe](02_wireframe_lahe_agent_sdk.md) · [Wireframes](wireframes/index.html) · [Architecture](02_architecture_lahe_agent_sdk.md) · [Architecture reviews](02_architecture_lahe_agent_sdk_reviews.md) · [Plan](03_plan_lahe_agent_sdk.md) · [Plan reviews](03_plan_lahe_agent_sdk_reviews.md)

## Needs your attention

| What | Where |
|---|---|
| The revised dossier is ready: one kept-running agent per review. New questions: OQ9 (full setup or named context files), OQ10 (resume after a crash; default no), OQ11 (the Library, later). Every question has the default the build takes. | [Plan: Open Questions](03_plan_lahe_agent_sdk.md#open-questions) |

## Currently working on

Nothing is running.

## Phases

| Phase | Status | Changed |
|---|---|---|
| 0 Setup | done | 2026-09-29 |
| 1 Crucible | done | 2026-09-29 |
| 2 Brief | done | 2026-09-29 |
| 3 Wireframe | done, awaiting your reaction | 2026-09-29 |
| 4 Architecture | revised | 2026-09-29 |
| 5 Plan | revised, awaiting your review | 2026-09-29 |
| 6 Implement | not started | |
| 7 Review | not started | |
| 8 Ship and land | not started | |
| 9 Cleanup | not started | |

## The record

### Task index

No tasks dispatched yet.

### Loop passes

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

- **2026-09-29 14:39.** Dossier revised for one kept-running agent per review, after your comment that a new agent per batch burns its start-up cost every time. The second spike showed one `claude -p` process can take each batch on stdin, keep its cache between batches, cost nothing while idle, and be replaced at once if it dies. Brief: added R26 (one agent per review, kept running) and R27 (nothing depends on the model remembering). Architecture: LAHE's supervisor owns the wake, the check after every batch, replies as structured output (no shell), fresh starts and the idle close; lean by default, with named context files for a project's own rules; the Library phase sketched, not built. Plan reworked to match. Architect (9 findings) and code lead (12) reviewed it, all accepted or partly accepted. The biggest change from the reviews: every agent starts fresh, and nothing is resumed or saved to your Claude folder. A clarity pass then ran on the three documents.
- **2026-09-29 13:33.** Plan reviewed by four reviewers: engineering manager 12 findings, code lead 17, testing 14, design 12, all accepted. The code lead's three blockers changed the architecture: a lock that lasts as long as the supervisor, one review per auto-answer session, and the allowance in its own file. Phase 2 now waits for your answer on the subscription terms. A compression pass and a clarity pass then ran on every document.
- **2026-09-29.** Plan drafted: Phase 0 settles the subscription terms and the untested `claude -p` flags before anything is built, then a one-builder kernel, four parallel builders, one merge and review in an integration worktree, and a live check before your dogfood.
- **2026-09-29.** Architecture written and reviewed by the architect and security reviewers: a small per-session process starts a lean `claude -p` run on a copy of the one source file, with no shell, and LAHE writes the edit back itself.
- **2026-09-29.** Spike: a headless `claude -p` run on your subscription handled a real wake correctly in all eight runs. A lean start cut each request from 107,000 to 138,000 tokens down to about 9,000.
- **2026-09-29.** Wireframes drawn: three directions for where auto-answer lives in the rail, 48 linked screens. Recommended B, the switch beside Hold.
- **2026-09-29 12:49.** PM review returned 17 findings (two blockers: the cost gate had no number, and runs share your usage limit with your other agents). 16 accepted, 1 partly accepted. The clarity pass then rewrote 22 passages.
- **2026-09-29 12:40.** Brief drafted from the crucible's recommendation: an opt-in mode where LAHE starts your own agent headless for each batch of work.
