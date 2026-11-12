---
read-when: Building, reviewing or orchestrating a slice of the TypeScript migration, or checking what it waits on.
---

# Plan: move Lahe to strict TypeScript in slices that each leave main working

This page lists every slice of the migration: what each one rebuilds, what it waits on, and how it proves it is done. Each slice rebuilds its part of the code to a written spec, test first; it does not translate the old code line by line. You have answered all three questions at the top, and work can start. The reasoning behind each slice is in [the architecture](01_architecture_typescript_migration.md). Where every file goes is in [the target layout](parts/target_layout.md). [The progress page](03_progress_typescript_migration.md) tracks the build.

## Your answers

**1. Should "helper" change to "server" in what people read?** The code will say "server" whatever you choose, as you asked. The open question is the CLI output, the docs and the skill. [BRAND.md](../../ongoing/BRAND.md) already says "the Lahe program" for most people and "the Lahe server" for developers, and never "helper". The CLI and many docs still say "helper". **Decided: rename.** Slice W1 changes it, following BRAND, after the CLI converts, so wording changes never mix with conversions.

<div class="choice" data-choice="helper-wording">
<p class="choice-q">Rename "helper" in CLI output, docs and the skill?</p>
<button type="button" value="rename" data-recommended data-chosen>Rename, following BRAND</button>
<button type="button" value="keep">Keep "helper" in user-facing text</button>
</div>

**2. Does the `read-when` header stay?** **Decided: yes.** Your note on the page: frontmatter and metadata are not comments. Each `.ts` file opens with one header block holding only the `read-when` field, and `not-for` when it applies, as your global rule describes. Lint allows exactly that block, first in the file, in that shape, and rejects every other comment. The why, the traps and the history that comments carry today move to a doc per source folder, `docs/ongoing/code/<folder>.md`.

<div class="choice" data-choice="read-when-headers">
<p class="choice-q">How do agents find the right source file?</p>
<button type="button" value="folder-doc" data-recommended>A table per folder in docs, checked by lint; no comments</button>
<button type="button" value="header" data-chosen>Keep one read-when header line per file</button>
</div>

**3. Is Node 24.12 the right minimum?** You asked for the lowest Node line that is not past end of life and runs `.ts` files directly. Read literally, that is Node 22.18. But Node 22 reaches end of life on 2027-04-30, and its own documentation still calls the `.ts` feature a release candidate. 24.12.0 is the first release where the feature is marked stable, and Node 24 is supported until 2028-04-30. **Decided: 24.12.** The [architecture](01_architecture_typescript_migration.md#question-4-the-node-minimum) has the table.

<div class="choice" data-choice="node-floor">
<p class="choice-q">Which Node minimum?</p>
<button type="button" value="24.12" data-recommended data-chosen>Node 24.12 (stable, supported to April 2028)</button>
<button type="button" value="22.18">Node 22.18 (supported to April 2027)</button>
</div>

## What is decided

These came from the handoff's open questions. The reasons are in the [architecture's decision table](01_architecture_typescript_migration.md#decisions).

- **The server and the CLI run `.ts` directly** on Node, with no build step. This confirms the recommendation from the chat. `bin/lahe.js` stays a few lines of JavaScript so it can tell someone on an old Node what to install.
- **The browser layer becomes ES modules bundled by esbuild** into the same committed `dist/lahe-layer.js`. The Library page gets its own built file. This is the change that lets the compiler check one browser file against another.
- **`src/shared` splits** into `src/contract/` (the shapes and constants the server and browser exchange), `src/domain/` (logic both run), and moves of files only one side uses.
- **The order changes slightly from the chat's.** The contract goes first, as recommended. After that, the server and the browser layer convert in parallel rather than one after the other, because neither imports the other. The CLI goes last, because it imports the server.
- **TypeScript 6.0.3, not 7.** The lint tools that ban `any` and casts cannot load TypeScript 7 yet. A board row tracks the move.
- **Each slice is a rebuild to a written spec, test first.** You ruled this during the build: the code got lazy and sloppy, so each slice writes out the functionality it aims for, then redoes TDD, rather than forcing old tests green. An Opus spec writer describes the behavior and the module design; a builder writes new tests from that spec and builds to them. Tests that pin what people and agents see stay fixed: the skill wording, the `review.json` and Copy and Export text, the CLI output, and the browser suite. Every old test case is carried into a new test or listed as dropped with its reason. See [how each slice is built](#how-each-slice-is-built).

## Slices

Each slice is one pull request that leaves main working. "Waits on" names the slices that must be merged first. Slice ids are short handles. The id is always followed by what the slice does.

### Wave 0: foundation, one at a time

| Slice | What it does | Waits on | Model | Owned files |
| --- | --- | --- | --- | --- |
| **S0a** Node floor | Raises the floor to 24.12.0, `.nvmrc` to 24.22.3, CI to Node 24. `bin/lahe.js` prints a clear message on an older Node. `install-cli` refuses an old Node. Updates `CLI_RUNTIME_MISSING` and the docs listed in [the architecture](01_architecture_typescript_migration.md#question-4-the-node-minimum), including the stale `contract` paragraph in `CLAUDE.md`. Installs Node 24.22.3 on Ken's Mac and reinstalls the wrapper, the login item and the Stop hook. | nothing | Sonnet | `package.json` (`engines`), `.nvmrc`, `.github/workflows/gate.yml`, `bin/lahe.js`, `scripts/install-cli.js`, `src/shared/failures.js` (one message), `README.md`, `docs/INSTALL.md`, `docs/UPGRADING.md`, `docs/ongoing/TESTING.md`, `CLAUDE.md` (Node section and contract paragraph) |
| **S0b** Toolchain and pilot | Adds the exact-pinned dev dependencies, `tsconfig.base.json` and one project per target folder, ESLint with every rule in [the enforcement table](01_architecture_typescript_migration.md#question-5-how-the-rules-are-enforced), the two local rules, the nested `package.json` files, and `scripts/import-layers.ts`. Puts `tsc -b` and ESLint into `npm run lint`, so they are in `gate:unit`. Fixes lint walking `docs/` and `.claude/worktrees/`. Lets the manifest check skip `.ts` files and list forwarders. Rebuilds the Node pilot, `shared/script_line.js` (Node only, used by the server and the CLI) as `src/server/sites/script-line.ts`, end to end: spec, tests first, forwarder, folder doc. It cannot pilot a file in the browser bundle, because the bundle cannot load `.ts` until S0c. Adds `test/unit/strictness_gate.test.js` with one rejected fixture per rule. Replaces [module_map.md](../../diagrams/module_map.md) with the target layout, marked as in progress. | S0a | Opus | `package.json` (dev dependencies, scripts), `package-lock.json`, `tsconfig*.json`, `eslint.config.js`, `scripts/eslint-rules/`, `scripts/lint.js`, `scripts/import-layers.ts`, `src/*/package.json`, `src/shared/script_line.js`, `src/server/sites/`, `src/shared/manifest.js`, `docs/ongoing/code/server-sites.md`, `docs/diagrams/module_map.md`, `test/unit/strictness_gate.test.js`, `test/fixtures/strictness/` |
| **S0c** Bundling | `scripts/build-layer.js` builds both browser files with esbuild. Unconverted layer files go in as they are, in manifest order, and converted modules get their generated registration. The Library page is served from `dist/lahe-library.js` instead of four raw files. The 13 browser specs and 2 support files that read layer source by path get the bundle from one in-memory build helper. Rebuilds the browser pilot, `shared/elapsed.js` as `src/domain/elapsed.ts`, so the generated registration is proven on a real module in both bundles and in Node. Proves the bundle is byte-identical when built on the Mac and on Linux in CI. | S0b | Opus | `scripts/build-layer.js`, `src/shared/elapsed.js`, `src/domain/`, `docs/ongoing/code/domain.md`, `src/service/catalog_page.js` (asset map and script tags only), `test/browser/support/` (new bundle helper), the 13 specs and 2 support files listed in [the recon](research/codebase_recon.md#6-tests), allowlist tests in `test/unit/catalog_auth.test.js` |

**Checkpoint 0** follows S0c. Nothing converts until it passes.

### Wave 1: contract and domain

| Slice | What it does | Waits on | Model |
| --- | --- | --- | --- |
| **C1** Constants | Converts `markers`, `failures`, `style_rules`, `gestures` and `epoch` | checkpoint 0 | Sonnet |
| **C2** Normalizer | Converts `normalize` (1,968 lines) | C1 | Sonnet |
| **C4** Protocol | Converts `protocol` (2,277 lines). Moves the `SERVICE_CONTRACT` bump history from comments into a table in `docs/ongoing/code/contract.md`, and changes `protocol_wire.test.js:187` to require a row for the current number | C1 | Sonnet |
| **C3** Record | Converts `record` (2,781 lines). Shapes, constants and parsers go to `contract/record.ts`; other logic goes to `domain/record-rules.ts` | C2 | Sonnet |
| **C5** Rules | Converts `lifecycle`, `review_format`, `merge`, `regions` and `uniqueness`. Moves `record_fixtures` to `test/support/` and out of the bundle. Removes the `contracts.js` barrel | C3 | Sonnet |

C2 and C4 run in parallel. **Checkpoint 1** follows C5.

### Wave 2: the server and the browser layer, in parallel

The server chain and the browser chain share no files. Each runs with its own builders.

**Server chain** (`src/service/` to `src/server/`):

| Slice | Converts | Waits on | Model |
| --- | --- | --- | --- |
| **SV1** Leaves | `heal`, `login_item`, `name_server`, `pandoc` (and moves `lahe_render.lua` unchanged), `source_stamp`, `state_dir`, `tab_icon`, `watchers` | checkpoint 1 | Sonnet |
| **SV2** Second layer | `addresses`, `log`, `markdown_links`, `menubar`, `review_writer`, `self_stop`, `static_servers`, `styles`, `wake_feed` | SV1 | Sonnet |
| **SV3** Sessions, auth, rendering | `agent_sessions`, `auth`, `markdown`, `sites` | SV2 | Sonnet |
| **SV4** The import cycle | `replies`, `projection`, `page_routes`, `rebuild`, `handled_check`, converted together because they import one another | SV3 | Opus (cycle and the biggest server file) |
| **SV5a** Library queue | `catalog_launch`, `catalog_page`, `catalog_requests`, `catalog_store` | SV3 | Sonnet |
| **SV5b** Routes and reviews | `catalog_sites`, `routes`, `reviews` | SV4 | Sonnet |
| **SV6** Library catalog and summary | `catalog_actions`, `catalog_reader`, `summary` | SV5a, SV5b | Sonnet |
| **SV7** Server entry | `index` becomes `src/server/main.ts` | SV6 | Sonnet |

**Browser chain** (`src/layer/` to `src/browser/`):

| Slice | Converts | Waits on | Model |
| --- | --- | --- | --- |
| **B1** Leaves | `listeners`, `selection`, `blocks`, `conflict_toast`, `choices`, `export` | checkpoint 1 | Sonnet |
| **B2** Storage and style button | `store`, `style_switch` | checkpoint 1 | Sonnet |
| **B3** Anchor | `anchor` | B1 | Sonnet |
| **B4** Pointing and highlight | `pointing`, `highlight` | B3 | Sonnet |
| **B5** Protection and replay | `protect`, `replay`, together because each depends on the other | B4 | Opus |
| **B6** The rail | `overlay` (8,878 lines, the largest file) | B2, B4 | Opus |
| **B10** Comments | `comments` | B2, B4 | Sonnet |
| **B7** Tabs and zoom | `zoom`, `tab_active`, `tab_edits` | B6 | Sonnet |
| **B8** Done tab | `tab_done` | B6 | Sonnet |
| **B9** Sync | `sync` | B6 | Sonnet |
| **B11** Editing and inject | `editing`, `inject` | B5, B10 | Opus (6,066 lines and the most dependencies) |
| **B12** Layer entry | `index` becomes `main.ts`. Removes the generated registrations and the layer's use of `window.LAHE`, keeping only the version, the public entry points and `__lahe` | B7, B8, B9, B11 | Opus |
| **B13** Library page | `catalog/view_model`, `copy_text`, `catalog/page` | checkpoint 1 | Sonnet |

These run in parallel: B1, B2 and B13; then B5, B6 and B10; then B7, B8 and B9.

**Checkpoint 2** comes after SV4 and B6. **Checkpoint 3** comes after SV7 and B12.

### Wave 3: the CLI, splits and finishing

| Slice | What it does | Waits on | Model |
| --- | --- | --- | --- |
| **CLI** Commands | Converts all of `src/cli/` in one pull request and adds its `package.json`. Two import cycles live here (`codex_monitor` with `monitor`, and `review` with `write`), so each pair converts together. Up to three builders may each take a group of commands on one integration branch. Points `bin/lahe.js` at `src/cli/main.ts` | SV7 | Sonnet |
| **SP1** Split browser files | Splits the browser files over the size limit into modules in the same folders (`overlay`, `editing`, `replay`, `sync`, `comments`, `tab_done`, `main`). Turns `max-lines` on for `src/browser/`. Refactor only | B12 | Opus |
| **SP2** Split server files | The same for the server (`page_routes`, `catalog_reader`, `reviews`, `main` and any other file over the limit). Turns `max-lines` on for `src/server/` and `src/cli/` | CLI | Opus |
| **F1** Finish | A script rewrites every import and `require` to the new paths. Then F1 removes the forwarders, the manifest and the nested `package.json` files, sets `"type": "module"` at the root, and renames exported "helper" identifiers to "server" with their callers. Turns on the lint rule that no `.js` remains under `src/`. Updates `CLAUDE.md` (layout, manifest rules, gate table), [ARCHITECTURE.md](../../ongoing/ARCHITECTURE.md), [CONTRACTS.md](../../CONTRACTS.md) (the shared-module loading section) and the module map | SP1, SP2 | Opus |
| **W1** Wording | Changes "helper" in CLI output, docs and the skill, following BRAND (Ken chose this on the plan page) | F1 | Sonnet |

**Checkpoint 4** follows F1.

### Wave 4: tests and scripts

| Slice | What it does | Waits on | Model |
| --- | --- | --- | --- |
| **T1** Unit tests | Converts the unit tests no earlier slice rewrote to `.ts` under the same rules. Up to four builders, split by area (contract and domain, server, browser, CLI) | F1 | Sonnet |
| **T2** Browser tests | Converts `test/browser/`, `test/helpers/`, `test/support/` and `playwright.config` | F1 | Sonnet |
| **T3** Scripts | Converts `scripts/` to `.ts`. Lint's `node --check` step then covers only `bin/lahe.js` | F1 | Sonnet |

T1, T2 and T3 run in parallel. **Checkpoint 5** follows the last of them, and closes the migration.

## Tests that read source text

These tests read the text of a file a slice moves. The slice that moves the file updates the test, and changes nothing else in it.

| Test | Reads | Updated by |
| --- | --- | --- |
| `test/unit/protocol_wire.test.js:187-191` | a comment in `protocol.js` | C4 (moves to a doc table) |
| `test/unit/fix_round_f3_record.test.js:150-153` | `record.js` bytes | C3 |
| `test/unit/styles.test.js:711-715` | `styles.js`, `style_rules.js` | C1 and SV2 |
| `test/unit/choice_kernel.test.js:448-456` | `heal.js`, `page_routes.js`, `add.js` | SV1, SV4, CLI |
| `test/unit/lint_lua.test.js:46-50` | the manifest's lists | SV1 (the Lua file moves) |
| `test/unit/anchor_engine.test.js:437-444` | `anchor.js` | B3 |
| `test/unit/free_writing_f1_fixes.test.js:116-129` | `anchor.js`, `protect.js`, `editing.js` | B3, B5, B11 |
| `test/unit/conflict_toast.test.js:268-275` and `remount_contract.test.js:268-273` | `layer/index.js` | B12 |
| `test/unit/menubar_cli.test.js:146-155` | `src/cli/commands/*.js` | CLI |
| `test/unit/add_command.test.js:988-998` | `bin/lahe.js`, `package.json` `bin` | S0a, if it changes either |
| Tests that read the manifest (one pins the owner `3C`) | `manifest.js` | F1 |

## Strict rules that cannot be on from the first slice

All compiler flags and lint rules apply to every `.ts` file from S0b onward. These four apply later, each turned on by a named slice:

| Rule | Off until | Why |
| --- | --- | --- |
| `max-lines` | SP1 for the browser, SP2 for the server and CLI | Large files convert whole first, then split |
| No `.js` under `src/` | F1 | Forwarders exist until F1 |
| The root is `"type": "module"` | F1 | Unconverted CommonJS files still need the default |
| The same rules in `test/` and `scripts/` | T1, T2, T3 | A test a slice rewrites becomes `.ts` in that slice; untouched tests wait for T1 |

## How each slice is built

Each slice is a rebuild, not a translation. Ken, during the build: the code "got pretty lazy and sloppy", and each section should write out the functionality it is aiming for and then redo TDD, rather than force old tests to show green. So every conversion slice runs in two stages, with two agents.

### Stage 1: the spec (Opus)

A spec writer reads the old files, their callers, their unit tests, the docs that cover them and the comments, and writes `slices/<slice>-spec.md`. It describes:

- **The functionality, as behavior.** Numbered statements of what the module does that a caller, a person or an agent can observe. For example: "a record with an unknown `kind` is refused with `RECORD_KIND_UNKNOWN`". These are what the new tests will check. Internals do not appear here.
- **The module design.** The modules the slice will create, each with one job; the exported types and functions with their signatures; and which unions replace string checks. The design follows the target layout and the architecture, and is what an experienced TypeScript team would write. It does not have to resemble the old file.
- **Old tests, accounted for.** Every test case in the old unit tests for these files is mapped to the behavior statement that covers it, or listed as dropped with the reason (for example, "pinned an internal helper that no longer exists"). Nothing is dropped silently.
- **Deliberate differences.** Places where the old code is wrong or sloppy and the new code will behave differently. Each one is listed with a test. A difference a person or an agent would notice goes on the progress page as a departure; it does not wait for Ken.
- **Fixed behavior tests.** Which of the tests that pin visible behavior touch this slice. These are the skill wording, the `review.json` and Copy and Export byte pins, the CLI output and the browser specs, and they must still pass unchanged in what they assert.

The orchestrator reads the spec before the build starts. It checks two things: that the spec covers what the callers rely on, and that the design stays inside the slice's folders.

### Stage 2: the build (Sonnet, or Opus where the slice table says so)

The builder works test first from the spec, following the feature-forge build loop (`~/.claude/skills/feature-forge/references/build-loop.md`) and the `tdd` skill:

1. Write the new `.ts` tests for each behavior statement, and see them fail for the right reason.
2. Build the new modules to the design until they pass.
3. Move each old unit test file with `git mv` to its `.ts` successor and rewrite it, so nothing is deleted. Retire the old file's cases according to the spec's mapping.
4. Point old callers at the new modules. Callers in the slice's folders change directly; elsewhere, the old path's forwarder carries them, or the slice edits the call site when an export was renamed.
5. Move the comments' knowledge into the folder doc, and give each file its `read-when` header.

### The builder's contract

The orchestrator fills one contract per agent from the builder role template (`~/.claude/skills/feature-forge/references/roles/builder.md`). These two rules go at the very top of every prompt, above everything else, because builders broke them when they appeared only at the end:

> **Never delete anything.** No `rm`, no `git rm`, no `git clean`, no `git reset --hard`, not even your own temporary files. Move a file with `git mv` when it becomes another file. List anything else you want removed under "To delete at cleanup" in your progress detail.
>
> **Never stage `dist/`.** Rebuild it locally if a test needs it, then put it back with `git checkout -- dist/lahe-layer.js dist/lahe-library.js`.

The rest of the contract:

- **outcome:** the slice's row above, and for the builder, the spec.
- **sources:**
  - the slice's spec (builder only);
  - the architecture's [mixed period](01_architecture_typescript_migration.md#question-7-the-mixed-period), [enforcement](01_architecture_typescript_migration.md#question-5-how-the-rules-are-enforced) and [tests](01_architecture_typescript_migration.md#question-6-tests) sections;
  - its rows in [the target layout](parts/target_layout.md);
  - [CONTRACTS.md](../../CONTRACTS.md) for any shape it types;
  - [CLAUDE.md](../../../CLAUDE.md) for the gate, the never-delete rule, the `dist/` rule and "tests leave nothing running".
  The brief points at these and does not restate them.
- **owned_files:** the old files, the new modules, the forwarders, the folder doc, the unit tests for those files, the call sites of any export the slice renames, and any test listed for the slice in "Tests that read source text". Nothing else. Where a slice must touch a shared file (`package.json`, the manifest, a `tsconfig` reference), it edits only its own lines. The orchestrator resolves line conflicts when it merges.
- **authority:** work in a worktree under `.claude/worktrees/`, commit to its own branch, never push or merge.
- **constraints:**
  - build to the spec's behavior and design, test first. Never bend the new code to keep an old test green;
  - the fixed behavior tests pass unchanged in what they assert;
  - every old test case is either carried into a new test or listed as dropped in the spec, with the reason;
  - a deliberate difference from the old behavior is in the spec with its own test;
  - each `.ts` file has a `read-when` header (and `not-for` only when it applies) that routes and does not summarize;
  - every other comment moves to the folder doc or is dropped as history;
  - a `.ts` file imports only `.ts` files.
- **uncertainty_rule:** read the code, its callers and its tests first. Raise the question with the orchestrator, rather than guessing, when:
  - a type would need a cast or an `any` to compile;
  - the spec and a caller disagree;
  - a dependency is not yet converted.
- **quality_checks:**
  - `npm run gate:unit`, which includes `tsc -b` and ESLint;
  - the Playwright specs for the files touched, by name, for browser slices;
  - leftover processes: `ps -axo command | grep -c "[l]ahe.js serve"` counted before and after, and both counts reported.
- **completion_evidence:**
  - the commit range;
  - gate output reading 0 failed;
  - the counts before and after for lines, comment lines, and old tests carried or dropped;
  - the progress detail at `docs/features/20261112.01_typescript_migration/slices/<slice>.md`.

**Models.** The spec is Opus for every slice, because it is where the design happens. The "Model" column in the slice tables names the builder.

### Each slice, from branch to main

1. The builder returns green in its worktree.
2. The orchestrator merges the branch, rebuilds `dist/` on the merge commit, runs `npm run gate:unit` and `npm run check:layer`, and reads "0 failed".
3. It opens the pull request and waits for CI (lint, bundle check, unit). It runs `gh pr checks`, reads "pass", and then merges in a separate step.
4. It pulls main and runs `npm run gate:unit` there, so two slices merged close together are checked together.

This follows "Priorities" in [CLAUDE.md](../../../CLAUDE.md): a slice merges on lint, the bundle check and the unit suite, and the browser suite runs at the checkpoint. That conflicts with the rule in CLAUDE.md's CI section that `npm run gate` runs before every pull request. The handoff names the checkpoint rule for this work, so the plan follows it. Browser-chain slices also run their named specs, which are cheap and catch most layer breakage early.

### Checkpoints and reviews

At each checkpoint the orchestrator first runs `npm run gate` and then `npm run gate:all`, each alone, with no builder running. Then one review set reads the diff integrated since the previous checkpoint. Each review has one owner:

| Review | Owner | At |
| --- | --- | --- |
| Code review of the integrated diff, for correctness and whether each conversion kept behavior | Opus code reviewer | every checkpoint |
| Comments that slipped through, and code that works around a problem instead of fixing it | `pstack:comment-sicko` | every checkpoint from 1 on |
| Whether the slices did what their rows say, against the verification table below | completion reviewer (Opus) | every checkpoint |
| Security: the Library page's asset list (checkpoint 0); boundary parsers and auth (checkpoints 1 to 3) | security reviewer | checkpoints 0 to 3 |
| Each slice's old-test mapping and dropped tests (is every behavior still covered?), and whether a strict rule is turned off anywhere | testing reviewer | every checkpoint |

There is one fix round. The reviewer names the test that proves each fix, and the builder writes it red, then green. A second review happens only when a fix is itself risky.

## Throughput checkpoint

- **Blocking prerequisites:** S0a, S0b and S0c, in that order, and then checkpoint 0. Nothing converts on an unproven toolchain or bundle.
- **Independent workstreams:**
  - after checkpoint 1, the server chain and the browser chain;
  - inside the browser chain, B1, B2 and B13; then B5, B6 and B10; then B7, B8 and B9;
  - inside the server chain, SV4 and SV5a;
  - after F1, T1, T2 and T3.
  At most about five builders run at once, and Ken's machine runs one browser suite at a time.
- **Shared writable state:** `package.json`, `src/shared/manifest.js`, the `tsconfig` references and `dist/`. Builders edit only their own lines in the first three and never stage `dist/`. The orchestrator owns merges and `dist/`. Folder docs have one section per source file, and a slice writes only its own sections.
- **Smallest safe decomposition:** one slice per step in the import graph. The import cycle (SV4) and the two-way pair (B5) are single slices. The CLI is one pull request fed by several builders, because its folder holds both kinds of module until it flips.

## Verification

This is the one verification table for the migration. A slice links to its rows here and does not copy them.

| Requirement | Acceptance or failure case | Command or observation | Owner | Evidence and status |
| --- | --- | --- | --- | --- |
| Real `.ts` in strict mode, every stricter flag | `tsconfig.base.json` has every flag in the architecture's list; turning one off fails a test | `node --test test/unit/strictness_gate.test.js` | S0b | not started |
| No escape hatches | Fixtures with `any`, `@ts-ignore`, `@ts-expect-error`, an `as` cast and `x!` are each rejected | same test | S0b | not started |
| Every switch on a state or kind handles every case | A fixture switch missing a union member fails | same test | S0b | not started |
| Folder boundaries enforced by the compiler | A browser fixture importing server code fails with TS6307; `document` in a server fixture fails; `node:fs` in a browser fixture fails | same test | S0b | not started |
| `tsc` runs in `gate:unit` | `npm run gate:unit` output shows `tsc -b` and ESLint | read the gate output | S0b | not started |
| The gate rejects new comments, and allows only the header | A fixture with a comment fails `lahe/no-comments`; a header with a field other than `read-when` or `not-for`, or not first in the file, fails; a file with the correct header passes | same test | S0b | not started |
| Node floor is 24.12 everywhere | `engines`, `.nvmrc`, CI and docs agree; `bin/lahe.js` on Node 20 prints the message and exits non-zero | unit test of the message; a manual run with `~/.nvm/versions/node/v20.19.0/bin/node bin/lahe.js status` | S0a | not started |
| The server runs `.ts` with no build step | `lahe review` on Ken's machine serves a page after SV7; no compiled server output exists | real use, and `git ls-files` shows no server build output | SV7 | not started |
| Browser bundle built by esbuild, committed, reproducible | `check:layer` passes on Mac and in Linux CI on the same commit | CI run and local run | S0c | not started |
| Bundle switch changes no behavior | Full Chromium and three-engine suites pass at checkpoint 0 | `npm run gate`, `npm run gate:all` | orchestrator | not started |
| Each rebuild keeps what people and agents observe | Each slice has a spec; the fixed behavior tests pass unchanged in what they assert; the new tests cover every behavior statement; every old test case is carried or listed as dropped with a reason; each deliberate difference has its own test | `npm run gate:unit` per slice; the orchestrator reads each spec before its build; the testing reviewer reads the old-test mapping at each checkpoint | spec writer, builder, testing reviewer | not started |
| Behavior across the waves | Full suites pass at checkpoints 1 to 5 | `npm run gate`, `npm run gate:all` | orchestrator | not started |
| Agent-facing text unchanged | The 8 skill-pinning tests, `review_format.test.js` and `export_text.test.js` pass unchanged | `gate:unit` | each builder | not started |
| Zero runtime dependencies | `dependencies` is `{}`; new packages are under `devDependencies` with exact versions | read `package.json` | S0b | not started |
| Layout matches the target | Every row of [the target layout](parts/target_layout.md) is in place; [module_map.md](../../diagrams/module_map.md) shows the final layout | `scripts/import-layers.ts` and a review of the tree | F1 | not started |
| Standard names | No folder, file or exported identifier says "helper"; files are kebab-case | `git grep -il helper -- src` is empty; lint's file-name check | F1 | not started |
| No temporary bridges left | No forwarders, no generated registrations, no manifest, no nested `package.json`, no `.js` under `src/` | lint rule turned on in F1 | F1 | not started |
| Comments became docs | Every source folder has its doc; comment-sicko finds no comment that slipped through | lint, plus the comment-sicko review at checkpoint 4 | F1 | not started |
| Tests under the same rules | `test/` and `scripts/` are `.ts` and pass the same lint | `npm run gate:unit` | T1, T2, T3 | not started |
| Ken can use it | Ken reviews a real document through Lahe after checkpoints 0, 3 and 5 with no regressions he notices | his use; issues go on the board | Ken | not started |
| Tests leave nothing running | The leftover-process count is the same before and after each builder's run | counts in each slice's progress detail | each builder | not started |

## Release authority

Ken has said the planner and builders go ahead without waiting for his approval. The orchestrator merges each slice once the steps above pass and CI is green, and runs each checkpoint. Shipping still follows the global rule: no slice merges with a failing or erroring test, including one that also fails on main.

Returning to Ken is needed only for:

- a type that cannot be written without an escape hatch;
- a parser that would refuse input Lahe accepts today;
- any change to a rule in this plan.

## Board rows to add

- **TypeScript 7.** Move from 6.0 to 7 once typescript-eslint supports it. It waits on the typescript-eslint issues about the TypeScript 7 API.
- **Old measurement and spike scripts.** Several `measure_*` and `spike_*` files in `scripts/` were one-off tools. T3 converts them as they are; whether to keep each one is Ken's call at cleanup.
