# Progress: LAHE starts your agent when a comment is ready

**Phase 2, Brief.** The brief is written, PM-reviewed, and clarity-checked; a measurement spike (one real headless run) runs in parallel and its numbers feed the architecture. Nothing is waiting on you. Last updated 2026-09-29 12:49.

**Docs:** [Crucible](00_crucible_lahe_agent_sdk.md) · [Research](research_agent_sdk.md) · [Brief](01_brief_lahe_agent_sdk.md) · [Wireframe](02_wireframe_lahe_agent_sdk.md) · [Wireframes](wireframes/index.html)

## Needs your attention

Nothing is waiting on you. You asked not to be stopped until all the docs are written, so every call made on your behalf is recorded as an assumption in the crucible and the brief. The open questions come to you together once the doc set is done.

## Currently working on

| Agent or task | Doing | Started | Branch |
|---|---|---|---|
| Measurement spike | One real review run headless: usage per run, reply quality, missing chat context | 2026-09-29 | feat/lahe-agent-sdk |

## Phases

| Phase | Status | Changed |
|---|---|---|
| 0 Setup | done | 2026-09-29 |
| 1 Crucible | done | 2026-09-29 |
| 2 Brief | in progress | 2026-09-29 |
| 3 Wireframe | done, awaiting your reaction | 2026-09-29 |
| 4 Architecture | not started | |
| 5 Plan | not started | |
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

- **2026-09-29.** Wireframes drawn: three directions for where auto-answer lives in the rail (in the status line's words, as a switch beside Hold, or as a strip under the tabs), 48 linked screens. Recommended B, the switch beside Hold. Three decisions passed to the architecture, chiefly that the overdue banner must stand down while auto-answer owns the review.
- **2026-09-29 12:49.** PM review returned 17 findings (two blockers: the cost gate had no number, and runs share the owner's usage limit with his other agents). 16 accepted, 1 partly accepted; the table is in the brief and the full prose in the brief's reviews file. The clarity pass then rewrote 22 passages for plain wording; the title now says what the mode does.
- **2026-09-29 12:40.** Brief drafted from the crucible's recommendation: an opt-in mode where LAHE starts the user's own agent headless for each batch of work, Claude Code first, rules given once per run, no new dependency. Five assumptions added beyond the crucible's seven; all are listed in the brief.
