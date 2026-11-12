---
read-when: Checking where the TypeScript migration stands, what it waits on, or what happened so far.
---

# Progress: TypeScript migration

The architecture and the plan are written and served to Ken, and he has answered one of the three questions. No code has changed yet. The next step is slice S0a (raise the Node floor), which does not depend on the two open questions.

## Attention needed

Two questions on [the plan](02_plan_typescript_migration.md#needs-your-answer), each with a default the build follows until Ken answers:

- what replaces the `read-when` header in source files (default: a lint-checked table per folder in docs);
- whether the Node minimum is 24.12 or 22.18 (default: 24.12).

## Documents

- [Handoff](HANDOFF.md), used as the brief
- [Architecture](01_architecture_typescript_migration.md)
- [Plan](02_plan_typescript_migration.md), with the slice list and the verification table
- [Target layout](parts/target_layout.md), where every file goes
- Research: [Node and TypeScript facts](research/node_and_typescript.md) (rechecked live on 2026-11-12), [the codebase today](research/codebase_recon.md)

## Work and evidence

| Outcome | Owner | State | Evidence or blocker | Next action |
| --- | --- | --- | --- | --- |
| Architecture and plan | planning agent | done | this folder | Ken's answers on the plan page |
| Wave 0: foundation (S0a, S0b, S0c) | orchestrator | not started | none | start S0a |

## Decisions and events

- **2026-11-12 11:32.** Plan and architecture written. Version facts were rechecked live at Ken's request. TypeScript stays on 6.0.3, because typescript-eslint cannot load TypeScript 7 yet. Node 24.12.0 is proposed as the minimum, since it is the first release where running `.ts` directly is stable. No approval is needed to start: Ken said the planner and builders go ahead without waiting.
- **2026-11-12 11:34.** Ken chose to rename "helper" in user-facing text, following BRAND. Slice W1 does it after the CLI converts.
