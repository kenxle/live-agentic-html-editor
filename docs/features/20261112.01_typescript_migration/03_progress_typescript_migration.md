---
read-when: Checking where the TypeScript migration stands, what it waits on, or what happened so far.
---

# Progress: TypeScript migration

The architecture and the plan are written and served to Ken, he answered all three questions on it, approved it, and reshaped it: every conversion slice is now a rebuild to a written spec, test first. Slices S0a (Node floor 24.12) and S0b (TypeScript, ESLint and the strict gate, with the Node pilot) are merged. Slice S0c (esbuild bundles, with the browser pilot) is being built in `.claude/worktrees/ts-s0c`.

## Attention needed

Ken: run `! lahe install` once. Your login item still starts the server with Node 20, and from S0a on that Node prints the upgrade message instead of starting. Until you run it, the server will not come back after a reboot. The `lahe` wrapper and the Stop hook are already on Node 24.22.3.

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
| S0a Node floor | Sonnet builder | merged | PR #104; gate:unit 3221 tests, 0 failed, on Node 24.22.3; CI pass; old-Node message checked on Node 18 and 20 | Ken runs `lahe install` |
| S0b Toolchain and pilot | Opus builder | merged | PR #105; gate:unit 3263 tests, 0 failed; 22 strictness fixtures each refused by their rule; lint 39.6s; CI pass | none |
| S0c Bundling | Opus builder | building | worktree `ts-s0c`, branch `ts/s0c-bundling` | review, then checkpoint 0 |

## Decisions and events

- **2026-11-12 11:32.** Plan and architecture written. Version facts were rechecked live at Ken's request. TypeScript stays on 6.0.3, because typescript-eslint cannot load TypeScript 7 yet. Node 24.12.0 is proposed as the minimum, since it is the first release where running `.ts` directly is stable. No approval is needed to start: Ken said the planner and builders go ahead without waiting.
- **2026-11-12 11:34.** Ken chose to rename "helper" in user-facing text, following BRAND. Slice W1 does it after the CLI converts.
- **2026-11-12 11:35.** Ken ruled that the `read-when` header is metadata, not a comment. It stays as the one comment lint allows, with its shape checked. The why behind the code still moves to a doc per source folder.
- **2026-11-12 11:36.** Ken confirmed Node 24.12 as the minimum. Every question on the plan is answered.
- **2026-11-12 11:42.** Ken: prefer better structure and best practice over forcing old unit tests to stay green. The plan now lets each slice restructure its files and rewrite the unit tests that pinned internals. Tests that pin what people and agents see stay fixed, and every deleted or narrowed test is listed for the testing reviewer, now at every checkpoint.
- **2026-11-12 11:41.** Ken approved the plan and cleared the build to start. Node 24.22.3 installed on Ken's Mac for the builders.
- **2026-11-12 11:43.** Ken: the code got lazy and sloppy and needs a real refactor; each section should write out the functionality it aims for and redo TDD. Every conversion slice is now a two-stage rebuild: an Opus spec of behavior and module design, then a test-first build. Old test cases are carried into new tests or listed as dropped with a reason.
- **2026-11-12 12:50.** The pilots swap. `elapsed.js` is in the browser bundle, which cannot load `.ts` until S0c, so S0b pilots the Node-only `script_line.js` and S0c pilots `elapsed` through the new bundle.
- **2026-11-12 12:48.** S0a merged as PR #104. Node 22 and later refuse a directory as a `node --test` path, so `test:unit` now passes a glob. Wrapper and Stop hook reinstalled on Node 24.22.3. `lahe install` refuses to run from an agent, so the login item waits on Ken.
- **2026-11-12 13:31.** S0b merged as PR #105. Departures, all reasonable: `tsc` cannot use `noEmit` across project references, so projects write declarations into the ignored `.tsbuild/`; the graph script is `scripts/import-layers.mts`, because `scripts/` is still CommonJS; `max-lines` is set to 400 and stays off until the split slices. CI now proves a bare clone runs before it installs the dev tools. Every checkout needs `npm install` once. The graph script found two more import cycles, both in the CLI, and the plan converts each pair together. Folder docs get one section per source file, so slices sharing a folder do not collide.
