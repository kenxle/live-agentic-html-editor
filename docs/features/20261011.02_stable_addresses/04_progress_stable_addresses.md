# Progress: Stable addresses

**Phase 6, Implement.** You approved the doc set and asked me to keep going until it is done. The CI workflow PR is open and the core builder is on Step 1. Waiting on you later: approving the old tests to retire, running `lahe install`, and merge approval. Last updated 2026-10-11 15:14.

**Docs:** [Decisions page](../../ongoing/STABLE_ADDRESSES.md) · [Crucible](00_crucible_stable_addresses.html) · [Brief](01_brief_stable_addresses.html) · [Architecture](02_architecture_stable_addresses.html) · [Plan](03_plan_stable_addresses.html) · [Code survey](parts/architecture/recon.md)

## Needs your attention

None.

## Currently working on

| Agent or task | Doing | Started | Branch |
|---|---|---|---|
| Orchestrator | Step 0: hand-run CI workflow in [PR #40](https://github.com/kenxle/live-agentic-html-editor/pull/40) (local gate 844 passed, 0 failed); idle-cost baseline next | 2026-10-11 15:14 | `chore/spike-dispatch-workflow` |
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

- `docs/features/20261011.02_stable_addresses/02_architecture_stable_addresses_reviews_security.html`: stale build output from before the review files were combined.
- `docs/features/20261011.02_stable_addresses/parts/reviews/`: the two original review files, now copied into `02_architecture_stable_addresses_reviews.md`.

### Test results

No test run yet.

### Ship

Not shipped yet.

## Log

- 2026-10-11 15:02: Ken approved the doc set: the login gap accepted, and the hand-run CI workflow approved on condition it costs nothing (standard GitHub machines are free for this public repo). Phase 5 done.
- 2026-10-11 14:52: Ken finished the brief. Settled in review: names are the folder plus two parents joined by dots (`live-agentic-html-editor.docs.ongoing`), one name per folder; pages on port 1483 with the API staying on 7817; `lahe review` prints `.lahe.localhost`; `lahe install --port-80` drops the port on macOS; `.lahe` is an option on all three systems, by command on macOS and written steps elsewhere; no npm package. Architecture and plan updated to match. HTTPS for `.lahe` added as a follow-up.
- 2026-10-11 12:56: Plan review returned 22 findings (2 blockers: main would have been broken between pull requests). All accepted: the Library's new Open ships with the first PR behind the switch, the page lookups ask both old and new until the switch flips, and nine verification rows were added. Doc set served for your review.
- 2026-10-11 12:48: Plan written: four workstreams, five PRs, 64 verification rows. Plan review dispatched.
- 2026-10-11 12:48: Architecture and security reviews returned 5 blockers between them. Architecture reworked: a name per folder (today's isolation unit) so paths, Markdown links, and rail rules keep working; binding is CLI-only; `.lahe` becomes a guarded Mac option with `.lahe.localhost` recommended as the printed ending, which reverses your earlier choice and is queued for your decision.
- 2026-10-11 12:35: Architecture written. Security and architecture reviews dispatched.
- 2026-10-11 12:35: PM review returned 12 findings (1 blocker: switching between `.lahe` and `.lahe.localhost` would kill addresses). All accepted into the brief. Recon found four blockers the architecture handles, including one worth your eye: a plain `.lahe` address is "Not secure" to the browser (see the architecture's failure modes).
- 2026-10-11 12:27: Crucible and brief written from the decisions page. PM review dispatched.
- 2026-10-11 12:24: Feature started. Ken settled all four questions on the decisions page and asked for the full doc set without stopping.
