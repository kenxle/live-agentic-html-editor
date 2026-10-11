# Progress: Stable addresses

**Phase 5, Human review.** The full doc set is written and reviewed by four agents, and is ready for you. Three things need your answer before any code. Last updated 2026-10-11 12:56.

**Docs:** [Decisions page](../../ongoing/STABLE_ADDRESSES.md) · [Crucible](00_crucible_stable_addresses.html) · [Brief](01_brief_stable_addresses.html) · [Architecture](02_architecture_stable_addresses.html) · [Plan](03_plan_stable_addresses.html) · [Code survey](parts/architecture/recon.md)

## Needs your attention

- [ ] **Which ending should `lahe review` print?** You chose `.lahe`. The fix for one page reading another still holds with either ending: it came from giving each document its own name, and every name is its own origin under both. Both architecture reviews found that a plain `http://name.lahe` page counts as "not secure" to the browser. The address bar says "Not secure", Lahe's copy buttons and the two-tab guard need backups, and a hostile network could take over a name wherever Lahe does not control `.lahe` lookups. `.lahe.localhost` has none of these and needs no setup. I recommend printing `.lahe.localhost`, and keeping `.lahe` as a Mac option that answers the same names. Details: the open question in the [brief](01_brief_stable_addresses.html). The skill and contract wait on this answer.
- [ ] **One name per folder, not per file.** The architecture review showed per-file names would break Markdown images and links, folder sites, your rail rules, and which file a comment points at. Addresses now read as folder plus file: `live-agentic-html-editor.docs.ongoing.lahe.localhost:1483/STABLE_ADDRESSES.md`. Isolation stays the same as today. Approve, or say what to change.
- [ ] **Approve the plan's two process items:** a small dispatch-only CI workflow on main (it never runs on push and never emails you), and accepting that CI cannot prove "starts at login" on Linux and Windows. Your reboot of this Mac proves it on macOS.

## Currently working on

| Agent or task | Doing | Started | Branch |
|---|---|---|---|
| Orchestrator | Waiting on your review of the doc set | 2026-10-11 12:56 | `feat/stable-addresses` |

## Phases

| Phase | Status | Changed |
|---|---|---|
| 0 Setup | done | 2026-10-11 |
| 1 Crucible | done | 2026-10-11 |
| 2 Brief | done | 2026-10-11 |
| 3 Architecture | done | 2026-10-11 |
| 4 Plan | done | 2026-10-11 |
| 5 Human review | in progress | 2026-10-11 |
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

- `docs/features/20261011.02_stable_addresses/02_architecture_stable_addresses_reviews_security.html`: stale build output from before the review files were combined.
- `docs/features/20261011.02_stable_addresses/parts/reviews/`: the two original review files, now copied into `02_architecture_stable_addresses_reviews.md`.

### Test results

No test run yet.

### Ship

Not shipped yet.

## Log

- 2026-10-11 12:56: Plan review returned 22 findings (2 blockers: main would have been broken between pull requests). All accepted: the Library's new Open ships with the first PR behind the switch, the page lookups ask both old and new until the switch flips, and nine verification rows were added. Doc set served for your review.
- 2026-10-11 12:48: Plan written: four workstreams, five PRs, 64 verification rows. Plan review dispatched.
- 2026-10-11 12:48: Architecture and security reviews returned 5 blockers between them. Architecture reworked: a name per folder (today's isolation unit) so paths, Markdown links, and rail rules keep working; binding is CLI-only; `.lahe` becomes a guarded Mac option with `.lahe.localhost` recommended as the printed ending, which reverses your earlier choice and is queued for your decision.
- 2026-10-11 12:35: Architecture written. Security and architecture reviews dispatched.
- 2026-10-11 12:35: PM review returned 12 findings (1 blocker: switching between `.lahe` and `.lahe.localhost` would kill addresses). All accepted into the brief. Recon found four blockers the architecture handles, including one worth your eye: a plain `.lahe` address is "Not secure" to the browser (see the architecture's failure modes).
- 2026-10-11 12:27: Crucible and brief written from the decisions page. PM review dispatched.
- 2026-10-11 12:24: Feature started. Ken settled all four questions on the decisions page and asked for the full doc set without stopping.
