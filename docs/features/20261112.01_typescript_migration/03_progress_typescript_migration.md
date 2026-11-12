---
read-when: Checking where the TypeScript migration stands, what it waits on, or what happened so far.
---

# Progress: TypeScript migration

The architecture and the plan are written and served to Ken, he answered all three questions on it, approved it, and reshaped it: every conversion slice is now a rebuild to a written spec, test first. Slice S0a (raise the Node floor to 24.12) is being built in `.claude/worktrees/ts-s0a`.

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
| S0a Node floor | Sonnet builder | building | worktree `ts-s0a`, branch `ts/s0a-node-floor` | merge, then reinstall the wrapper, login item and Stop hook on Node 24.22.3 |
| S0b Toolchain and pilot, S0c Bundling | orchestrator | waiting on S0a | none | start S0b after S0a merges |

## Decisions and events

- **2026-11-12 11:32.** Plan and architecture written. Version facts were rechecked live at Ken's request. TypeScript stays on 6.0.3, because typescript-eslint cannot load TypeScript 7 yet. Node 24.12.0 is proposed as the minimum, since it is the first release where running `.ts` directly is stable. No approval is needed to start: Ken said the planner and builders go ahead without waiting.
- **2026-11-12 11:34.** Ken chose to rename "helper" in user-facing text, following BRAND. Slice W1 does it after the CLI converts.
- **2026-11-12 11:35.** Ken ruled that the `read-when` header is metadata, not a comment. It stays as the one comment lint allows, with its shape checked. The why behind the code still moves to a doc per source folder.
- **2026-11-12 11:36.** Ken confirmed Node 24.12 as the minimum. Every question on the plan is answered.
- **2026-11-12 11:42.** Ken: prefer better structure and best practice over forcing old unit tests to stay green. The plan now lets each slice restructure its files and rewrite the unit tests that pinned internals. Tests that pin what people and agents see stay fixed, and every deleted or narrowed test is listed for the testing reviewer, now at every checkpoint.
- **2026-11-12 11:41.** Ken approved the plan and cleared the build to start. Node 24.22.3 installed on Ken's Mac for the builders.
- **2026-11-12 11:43.** Ken: the code got lazy and sloppy and needs a real refactor; each section should write out the functionality it aims for and redo TDD. Every conversion slice is now a two-stage rebuild: an Opus spec of behavior and module design, then a test-first build. Old test cases are carried into new tests or listed as dropped with a reason.
