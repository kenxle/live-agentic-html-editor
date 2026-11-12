---
read-when: Checking where the TypeScript migration stands, what it waits on, or what happened so far.
---

# Progress: TypeScript migration

Wave 0 is done and merged: the Node 24.12 floor (PR #104), the TypeScript toolchain and strict gate (PR #105), and the esbuild bundles (PR #106). Checkpoint 0 passed. All five Wave 1 specs are written. C1 (constants, PR #107), C2 (normalizer, PR #108) and C4 (protocol, PR #109) are merged. C3 (the record) is building; C5 (item states and the review format) follows, then checkpoint 1.

## Attention needed

None. Ken's login item runs the server on Node 24.22.3, and the menu bar icon is back.

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
| S0c Bundling, with checkpoint 0 fix round | Opus builders | merged | PR #106; gate:all alone 2831 passed, 2 known-kind flakes passing alone; CI pass on Linux | none |
| Specs C1 to C5 | Opus spec writers | written and committed | `slices/C1-spec.md` to `C5-spec.md`, each with orchestrator decisions | none |
| C1 Constants | Sonnet builder | merged | PR #107; gate:unit 3408 tests, 0 failed; 19 browser specs 211 passed; comment lines 706 to 15; 83 old cases carried, 1 dropped | none |
| C2 Normalizer | Sonnet builder | merged | PR #108; gate:unit 3486 tests, 0 failed; 27 browser specs 332 passed; 103 old cases carried, 10 dropped; fuzz and 81-mutation runs | none |
| C4 Protocol | Sonnet builder | merged | PR #109; gate:unit 3595 tests, 0 failed, with C1 and C2; 16 browser specs 78 passed; 94,481-input old-against-new run | none |
| C3 Record | Sonnet builder | building | worktree `ts-c3-record` | review and merge, then C5 |

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
- **2026-11-12 13:58.** Specs written for C1 (constants), C2 (normalizer) and C4 (protocol), and checked against each other. Departures that agents or reviewers will notice, each with its own test: C2's D8 (links with a query string no longer reach agents as `&amp;amp;`) and D9 (words no longer run together in blocks taken from source with line breaks); C4's D6 (a reply whose required reason is not a string becomes a malformed-line chip) and D7 (the chip names a missing field once).

## To delete at cleanup

- `test/browser/support/export_stub.js`: dead; nothing calls `installExportStub` (found by the C1 spec).
- **2026-11-12 14:08.** Ken's `lahe install` failed: launchd refused the new login item while the old one was loaded, and the rollback left no server. The server was restarted on demand. Two board rows filed: the reinstall bug, and the `! lahe install` advice that can never pass the terminal check.
- **2026-11-12 14:10.** S0c built. Both browser files now come from esbuild through one code path. One namespace name can be backed by several modules, and the forwarder hands out a writable copy. The Library page serves one built file. Checkpoint 0 started.
- **2026-11-12 14:21.** Checkpoint 0, first full run (Chromium), on the S0c branch: unit 3284 tests, 0 failed; menu bar app 4 of 5, 1 skipped; browser 943 passed, 5 failed, 8 skipped. The five failures, in `free_writing_r14` and `free_writing_seams`, all timed out waiting for the page check after a reload. That run overlapped three reviewers and a spec writer running commands, and both files then passed alone (32 of 32). So this is the known flake (board row LAHE-list-edit-reload-page-check), not a break. The checkpoint still needs a clean run, alone, after the fix round.
- **2026-11-12 14:22.** Checkpoint 0 reviews: no blockers. Security: a lint check must stop a package import in old `.js` code, now that CI installs dev tools before lint; CI gets read-only permissions. Testing: 16 of 18 one-line weakenings of the rules left the strictness test green, so the test will pin each project's resolved compiler options and the resolved ESLint rules. Code: five minor items. One fix round is running on the S0c branch.
- **2026-11-12 15:20.** Checkpoint 0 passed: `gate:all` alone gave 2831 passed and 2 failed. Both failures are flakes that pass alone 3 of 3 and are on the board: the known Firefox Library hang, and a new WebKit toast timing case. Chromium was fully clean. S0c merged as PR #106 after CI passed on Linux, which also proves the bundle builds the same bytes there. C1 build started.
- **2026-11-12 15:28.** Ken's second `lahe install` installed the server's login item on Node 24.22.3. The menu bar item failed with the same launchd error 5; a plain reload succeeded right after, though launchd said nothing was loaded. The board row now records that the cause is not proven.
- **2026-11-12 15:51.** C1 merged as PR #107. C2 and C4 builds started in parallel.
- **2026-11-12 16:28.** C2 merged as PR #108. Departures agents and reviewers will notice: links with a query string stop reaching agents as `&amp;amp;` (D8), and words stop running together in blocks taken from wrapped source (D9).
- **2026-11-12 16:34.** C4 merged as PR #109. Departures agents will notice: a reply whose required reason is not a string becomes a malformed-line chip (D6), and the chip names a missing field once (D7). C3 build started.
