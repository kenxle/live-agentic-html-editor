---
read-when: Checking where the TypeScript migration stands, what it waits on, or what happened so far.
---

# Progress: TypeScript migration

The architecture and the plan are written and served to Ken, and he has answered all three questions on it. No code has changed yet. The next step is slice S0a (raise the Node floor to 24.12).

## Attention needed

None. An orchestrator can start slice S0a.

## Documents

- [Handoff](HANDOFF.md), used as the brief
- [Architecture](01_architecture_typescript_migration.md)
- [Plan](02_plan_typescript_migration.md), with the slice list and the verification table
- [Target layout](parts/target_layout.md), where every file goes
- Research: [Node and TypeScript facts](research/node_and_typescript.md) (rechecked live on 2026-11-12), [the codebase today](research/codebase_recon.md)

## Work and evidence

| Outcome | Owner | State | Evidence or blocker | Next action |
| --- | --- | --- | --- | --- |
| Architecture and plan | planning agent | done | this folder; Ken answered all three questions | none |
| Wave 0: foundation (S0a, S0b, S0c) | orchestrator | not started | none | start S0a |

## Decisions and events

- **2026-11-12 11:32.** Plan and architecture written. Version facts were rechecked live at Ken's request. TypeScript stays on 6.0.3, because typescript-eslint cannot load TypeScript 7 yet. Node 24.12.0 is proposed as the minimum, since it is the first release where running `.ts` directly is stable. No approval is needed to start: Ken said the planner and builders go ahead without waiting.
- **2026-11-12 11:34.** Ken chose to rename "helper" in user-facing text, following BRAND. Slice W1 does it after the CLI converts.
- **2026-11-12 11:35.** Ken ruled that the `read-when` header is metadata, not a comment. It stays as the one comment lint allows, with its shape checked. The why behind the code still moves to a doc per source folder.
- **2026-11-12 11:36.** Ken confirmed Node 24.12 as the minimum. Every question on the plan is answered.
