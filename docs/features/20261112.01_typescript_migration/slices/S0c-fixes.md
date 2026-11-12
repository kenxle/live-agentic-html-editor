---
read-when: Reviewing or merging the checkpoint 0 fix round of the TypeScript migration (branch ts/s0c-bundling, after S0c).
---

# S0c fixes: the checkpoint 0 fix round

## Outcome

All ten findings are fixed on `ts/s0c-bundling`, each with its test written red first where the reviewer named one. `npm run gate:unit` reads 0 failed. The reviewer's mutation probe now fails the gate test on **18 of 18** weakenings (it was 2 of 18), with the unweakened baseline still green.

## What I read

- Role file `builder.md`, the principles index, and the leaves Encode Lessons in Structure and Test Behavior, Not Implementation.
- The architecture's Question 5, `docs/ongoing/code/README.md`, `parts/target_layout.md` ("The folders"), `slices/S0c.md`, the repo `CLAUDE.md`. S0b's progress detail only by its length; nothing in this round needed it.
- The project has no documents table; I used the docs `CLAUDE.md` names.

Principles that changed a choice:

- **Encode Lessons in Structure:** the "never export a `let`" rule was only written down; it is now a lint selector with a fixture. The gate's configuration is pinned by tables in the test, so a weakened rule fails a check instead of relying on a reviewer to notice.
- **Test Behavior, Not Implementation:** the ESLint table's expected side is resolved by ESLint itself from typescript-eslint's preset plus the table, not by copying ESLint's merge logic into the test. The `export let` fixture reassigns the variable, because an unassigned one is already caught by `prefer-const` and would not prove the new selector does anything.

## Commits

| Finding | Commit | Test, red then green |
| --- | --- | --- |
| 1. lint misses a package import in old `.js` (security) | `51cd12c5` | `test/unit/lint_imports.test.js`: red (module missing), then 7 of 7 |
| 2. CI token (security) | `ebaa1ac4` | none named; the YAML was parsed to check both keys land |
| 5, 6, 9. old-Node guard, its message, temp folders | `8711e6d9` | `test/unit/node_floor.test.js`: the two 24.11.1 message tests red, then 15 of 15. The ES5 parse test went red when `require("node:path")` was planted in `bin/lahe.js` and again when a `const` was planted in `bin/node_floor.js` (both put back with `git checkout`) |
| 7. planned Library entries | `c93a0941` | `test/unit/manifest_library_files.test.js`: 2 of 2 red, then green |
| 10. stale comment | `c6ffb009` | comment only |
| 8. browser specs test a stale `dist/` | `4dcbe4ba` | with `dist/lahe-layer.js` replaced by a file that only throws, `conflict_toast.spec.js` failed 3 of 3 before, passed 3 of 3 after; `dist/` put back with `git checkout` |
| 3, 4. the gate pins the configuration; `export let` refused | `3b041b0b` | `test/unit/strictness_gate.test.js`: before the selector, the two export fixtures and all nine ESLint table checks failed; after, 66 of 66 |
| this page | the commit that adds it | |

## Changes

### 1. No package import in old `.js` (`scripts/lint_imports.js`, `scripts/lint.js`)

A new lint check, in its own file like the duplicate check, so the test can point it at a temp folder and leave the real tree alone. It parses each `.js` file under `src/` and directly in `bin/` with espree and checks every `require()`, `import`, `export ... from` and `import()`: each must be relative or `module.isBuiltin`. A package named in a comment or a string is not an import. A `require` or `import()` whose name is not a fixed string fails too, since it cannot be checked; there are none today. The failure line names the file, the line and the package.

espree comes with ESLint, which `npm run lint` already needs (CI runs `npm ci` before lint). `lint.js`'s header said "zero dependencies"; it now reaches a dev dependency through this check, and the header no longer says that.

### 2. CI (`.github/workflows/gate.yml`)

Top-level `permissions: contents: read`, and `persist-credentials: false` on the checkout.

### 3. The gate pins the configuration (`test/unit/strictness_gate.test.js`)

- **Compiler.** For each of the eight projects, `tsc --showConfig` must give exactly the base options, the project's `lib`, `types` and `outDir`, the four options tsc adds because others imply them, its references, its `include`, and an `exclude` of only its output folder. The raw file must keep `"files": []`. The set of `tsconfig.json` files found must equal the table, and the root must reference every one, in order. The table matches "The folders" in `parts/target_layout.md`, plus `test/unit` and `scripts`.
- **ESLint.** For one path in each lint area (`src/contract`, `src/domain`, `src/server`, `src/cli`, both browser folders, `test/unit`, `scripts/*.mts`, `scripts/eslint-rules/`), `calculateConfigForFile` must equal what ESLint resolves, with no config file, from typescript-eslint's `strict-type-checked` plus the test's own rule table, and `linterOptions` must be `noInlineConfig: true` and `reportUnusedDisableDirectives: 2`. Whole rule sets are compared, so a rule added, removed or loosened anywhere fails. Two simplifications: a rule that is off compares as just "off" (ESLint fills in default options for some, and they do nothing), and the messages of `no-restricted-syntax` and `no-restricted-imports` are left out (the selectors and patterns are the rule).
- **New fixtures:** `/* eslint-disable */` over an `any`; `export { x as default }`; `export * from` and `export { x } from` a `.js` file; an exhaustive switch with a `default`; a non-union switch with no `default`; a snake_case function; `document` and `process` in `src/domain`; a boundary fixture for every `src/` folder (contract to domain, domain to server, server to cli, cli to browser, each browser folder to the other); an `any` and a floating promise in a `test/` file, and a clean `node:test` file; `@ts-nocheck`; and one each for `no-unsafe-call`, `-return`, `-member-access` and `-argument`.
- **Two builds.** A project holding a refused fixture writes no declarations (`noEmitOnError`), so the clean files, which import across projects, failed with TS6305 once every folder had a refused fixture. The clean files now build in a temp folder of their own, and that build must report no error at all, which is stricter than before. A new check fails if a fixture file is in neither list.

The `export { x } from "./y.js"` fixture is beyond the contract's list: the probe's mutation of `lahe/no-js-imports` disables only that form, which `export *` does not reach.

### 4. `export let` refused (`eslint.config.mjs`)

`no-restricted-syntax` selector `ExportNamedDeclaration > VariableDeclaration[kind!='const']`, fixtures `src/domain/exports-let.ts` and `exports-var.ts`. **Limit:** a `let` declared and then exported by name (`let x; export { x }`) is not caught; a selector cannot see the declaration from the specifier. `docs/ongoing/code/README.md` says so.

### 5, 6, 9. The old-Node guard

- The message now says "Install Node 24.12 or newer" in `bin/node_floor.js` and `scripts/install-cli.js`.
- `bin/lahe.js` and `bin/node_floor.js` must parse with espree at `ecmaVersion: 5` and hold no string starting `node:`.
- The three tests that made temp folders remove them in `t.after`.

### 7. `libraryFiles()`

Leaves out `planned: true` entries after resolving `sameAsLayer`, so a Library entry standing for a planned layer entry is left out too.

### 8. `with_layer.js`

Serves `layerBundle()` from `bundles.js` instead of reading `dist/lahe-layer.js`. Its `BUNDLE_PATH` export went; nothing imported it. **It is used by more than 16 specs:** 14 specs import it directly and 18 more reach it through `free_writing_page.js`. I ran all 32, plus `bundle_registration`.

### 10. `src/service/index.js`

The comment no longer says `closeAllConnections()` is why `engines.node` is 18.2.

## The mutation probe

`mutate_gate.py` from the session scratchpad, unchanged, against copies of the worktree.

| Weakening | Before | After |
| --- | --- | --- |
| baseline (no change) | pass | pass |
| `noInlineConfig` removed | pass | **fail** (10) |
| `allowDefaultCaseForExhaustiveSwitch: true` | pass | **fail** (10) |
| `requireDefaultForNonUnion: false` | pass | **fail** (10) |
| domain `lib` gets `dom` | pass | **fail** (2) |
| domain `types` gets `node` | pass | **fail** (2) |
| domain references server | fail (5) | **fail** (14) |
| library-page references server | pass | **fail** (1) |
| naming `default` format null | pass | **fail** (10) |
| contract and domain boundaries removed | pass | **fail** (4) |
| `ts-nocheck` allowed | pass | **fail** (10) |
| `no-unsafe-call` off | pass | **fail** (10) |
| `no-unsafe-return` off | pass | **fail** (10) |
| `export { x as default }` selector removed | pass | **fail** (10) |
| `lahe/no-js-imports` skips `export ... from` | pass | **fail** (1) |
| test files: `no-explicit-any` off | pass | **fail** (2) |
| test files: floating promises off | pass | **fail** (2) |
| base: `forceConsistentCasingInFileNames` off | pass | **fail** (8) |
| server `lib` gets `dom` | fail (1) | **fail** (2) |

18 of 18 weakenings fail the test. The number in brackets is the count of failing test cases.

## Gate and specs

`npm run gate:unit` at `3b041b0b`:

```
lint passed (syntax: 559 files, no duplicate declarations, lua: 1 file via pandoc lua, no jsdom, manifest complete, kebab-case .ts names, no package imports in .js)
ℹ tests 3337
ℹ pass 3330
ℹ fail 0
ℹ skipped 5
ℹ todo 2
no_stray_helpers: no helper from this run is still running
```

Playwright, Chromium, by name, at `3b041b0b`: the 14 specs that import `with_layer.js`, the 18 that reach it through `free_writing_page.js`, and `bundle_registration.spec.js`. **343 passed, 0 failed, 3 skipped**, in 4.7 minutes. The skips are conditions written into those specs (for example, the zoom screenshot test runs only with `LAHE_ZOOM_SHOTS=1`); I did not check which three they were.

## Leftover processes

`ps -axo command | grep -c "[l]ahe.js serve"`: 1 before the first test run, 1 after the red and green `conflict_toast` runs, 1 before and after `gate:unit`, 1 before and after the 33-spec run. `esbuild --service` processes after the Playwright runs: 0. The 1 is Ken's own helper.

## Deviations

- **A new file, `scripts/lint_imports.js`,** outside the owned list (which named `scripts/lint.js`). The check lives beside `lint_duplicates.js` and `lint_lua.js`, in the same pattern, so its test can run it on a temp folder.
- **More specs than the contract named** for finding 8 (33, not 17): the change reaches every spec that uses `free_writing_page.js`.
- **Two extra fixtures** beyond the contract's list (`export-from-js.ts`, and the four `no-unsafe-*` and `ts-nocheck` fixtures), so each probe mutation has a fixture that bites as well as a table row.
- **Finding 2 has no test.** The reviewer named none.

## Follow-ups

- **`test/fixtures/app/server.js`** still serves `dist/lahe-layer.js` to the specs that ask the app fixture to carry the script tag (`startAppServer({ layer })`), and `r10_offline_fallback` and `ac1_walk` copy `dist/` too. Those specs can still test a stale `dist/`. Not in this round's scope.
- **`let x; export { x }`** is not caught by lint (finding 4's limit above).

## Cleanup needed

In the repo: none. `dist/` was put back with `git checkout -- dist/lahe-layer.js` after each red demonstration; `git status` shows no change there. The `.claude-commit202611121427-*` message files in the worktree root are git-ignored.

Outside the repo, in the session scratchpad (the OS owns it): `probe_eslint.js`, `write_fixtures.py`, `probe_before.txt`, `probe_after.txt`, `gate_unit_fix.log`, `pw_f8.log`, `specs_f8.txt`, and the `mut-*` copies the mutation probe made.
