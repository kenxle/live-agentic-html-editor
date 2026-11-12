---
read-when: Reviewing or merging slice S0b (the TypeScript toolchain and the script line pilot) of the TypeScript migration.
---

# S0b: toolchain and the Node pilot

## Needs the orchestrator before the pull request

- **CI will fail as it stands.** `.github/workflows/gate.yml` runs `npm run lint` with no `npm ci`, on purpose, to prove a clean clone works. `npm run lint` now runs `tsc` and `eslint`, and `strictness_gate.test.js` loads both, so on GitHub they are "command not found" until the workflow installs the dev dependencies. I do not own `gate.yml`. The smallest change is a `- run: npm ci` step before `npm run lint`. The "clean clone with no install" proof can stay as a separate step before it (for example `node bin/lahe.js --help`, or the unit tests that need nothing), which is your call.
- **Every checkout needs `npm install` once.** The main checkout's `node_modules` has no TypeScript. After this merges, run `npm install` on main, and every builder runs it in its worktree (CLAUDE.md already says so for a fresh worktree).

## What I read

- Role file `builder.md`, the principles index, and the leaves Type System Discipline, Encode Lessons in Structure, Build the Lever, Test Behavior Not Implementation, Prove It Works and Sequence Verifiable Units.
- The plan (Wave 0 row, "How each slice is built", "Strict rules that cannot be on from the first slice", the verification table), the architecture (Summary, Decisions, Questions 3, 5, 6, 7), `parts/target_layout.md`, `research/node_and_typescript.md`, `research/codebase_recon.md` sections 3 and 10, the repo `CLAUDE.md`, and S0a's progress detail.
- The project's CLAUDE.md has no documents table; I used the docs it names.

## Outcome

Done and green. Every S0b item in the contract is built, with the departures listed below.

## Commits (branch `ts/s0b-toolchain`, on `de90c307`)

| Commit | What |
| --- | --- |
| `320d94d8` | exact-pinned dev dependencies and lockfile |
| `57a706fa` | `tsconfig.base.json`, one project per folder, nested `package.json` files, ESLint config, the two local rules, `lint.js` changes, `test:unit` glob |
| `e147f0a8` | `strictness_gate.test.js` and its fixtures |
| `1baee649` | the spec, `slices/S0b-spec.md` |
| `4383d54a` | the new `.ts` tests, red (module missing); the four script line cases moved out of `add_command.test.js` |
| `c12f4049` | `src/server/sites/script-line.ts`, the forwarder, `FORWARDERS` in the manifest |
| `5838d740` | `scripts/import-layers.mts` |
| `b4efa0f9` | `docs/ongoing/code/README.md`, `docs/ongoing/code/server-sites.md`, `module_map.md` |
| `f37b9811` | `eslint --max-warnings 0` |
| this file's commit | progress detail |

## Changes and proof

**Dependencies.** `typescript` 6.0.3, `eslint` 10.14.0, `typescript-eslint` 8.72.2, `@types/node` 24.19.2, all exact. `dependencies` is still `{}` (npm dropped the empty key on install; I put it back).

**Projects.** `tsconfig.base.json` holds every flag in the architecture's Question 5 list. Eight projects: the six target folders, `test/unit` and `scripts`, each extending the base and setting only `lib`, `types` and `outDir`. References follow the "May import" column. The root `tsconfig.json` lists all eight.

**The rule for folders with no `.ts` file yet** (written down in [docs/ongoing/code/README.md](../../../ongoing/code/README.md#the-projects)): every project keeps `"files": []` beside `"include": ["**/*.ts"]`. An `include` that matches nothing is TS18003, and an explicit `files` stops that check while `include` still picks up new files. So all projects and their references are in place now, and the slice that adds a folder's first file changes no config. I chose this over "the root references only projects with files", because that version would also have to leave references between projects out (the server referencing an empty `contract` fails the same way), and each later slice would have to edit other folders' configs.

**ESLint.** `eslint.config.mjs`: `strict-type-checked` plus every row of the enforcement table, `noInlineConfig` so no file can switch a rule off, `--max-warnings 0`. Local rules `scripts/eslint-rules/no-comments.ts` and `no-js-imports.ts`.

**`npm run lint`** is `node scripts/lint.js && tsc -b && eslint --max-warnings 0`. `lint.js` skips `docs/` and `.claude/worktrees/` (and `.tsbuild/`), leaves `.ts`, `package.json` and `tsconfig.json` out of the manifest check, checks kebab-case `.ts` names under `src/`, and scans `.ts` tests for jsdom too.

**Nested `package.json`** (`{"type": "module"}`): `src/contract`, `src/domain`, `src/server`, `src/browser`, plus `test/unit/server` and `scripts/eslint-rules` (see Deviations).

**`scripts/import-layers.mts`**, run with `node scripts/import-layers.mts`. First run: 1 converted file, 1 forwarder, 95 unconverted `.js` files in layers, 4 cycles:

- `handled_check`, `page_routes`, `projection`, `rebuild`, `replies` (the plan's SV4)
- `protect`, `replay` (the plan's B5)
- `src/cli/codex_monitor.js` and `src/cli/commands/monitor.js` (not in the plan)
- `src/cli/commands/review.js` and `src/cli/commands/write.js` (not in the plan)

The two CLI cycles do not change the plan, since the CLI converts in one pull request, but its builders should know.

**The pilot.** `src/server/sites/script-line.ts` built to [S0b-spec.md](S0b-spec.md), test first:

- Red: `node --test test/unit/server/sites/script-line.test.ts` failed with `ERR_MODULE_NOT_FOUND` before the module existed.
- The tests describe the old behavior: run against the old `script_line.js` through a throwaway re-export, 21 of 21 passed.
- Green: 21 of 21 on the new module.
- Mutation checks: making every closer count (no comment, script or style exclusion) failed 4 cases; dropping the separator newline failed 1.
- `src/shared/script_line.js` is the one-line forwarder, listed in `FORWARDERS`.

Lines, counted by `count_lines.py` (below):

| File | Total | Comment lines | Blank | Code |
| --- | --- | --- | --- | --- |
| old `src/shared/script_line.js` | 169 | 57 | 13 | 99 |
| new `src/server/sites/script-line.ts` | 104 | 3 (the header) | 17 | 84 |
| new `test/unit/server/sites/script-line.test.ts` | 231 | 3 (the header) | 27 | 201 |

Old tests: 5 cases touched script_line; 4 moved into the new file and 1 stays in `choice_kernel.test.js` (its script line half is also carried). 0 dropped. The spec's table maps each.

**Removed from `add_command.test.js`** (the four moved cases), each with what now covers it:

| Old case | Behavior it covered | Covered now by |
| --- | --- | --- |
| the script line goes before `</body>`, then before `</html>`, then at the end | position rule, indentation, fragments | `script-line.test.ts` cases 4, 6, 7, "4, 8" |
| on a minified page the script line goes directly before `</body>`, and comes out byte for byte | same-line insert, closers in comments and scripts, round trip | cases 5 (three), 6, 9, 12 |
| the fallback form still places, replaces and removes as one line | the fallback tag through place, replace, remove | cases 10 and 12 |
| `--remove` removes the lahe tag and no other script on the page | removal leaves other scripts and no blank line | case 11 |

**Proof of the two Node paths.**

From CommonJS, in the worktree:

```
$ node -e 'console.log(Object.keys(require("./src/shared/script_line.js")))'
[ 'EXISTING_TAG', 'placeScriptLine', 'removeScriptLine', 'replaceScriptLine', 'reviewAlreadyInFile' ]
```

A real `lahe add`, then `lahe add --remove`, on a minified page, with `LAHE_STATE_DIR` and `--state-dir` set to a scratch folder, `--port 47391`, `LAHE_PAGES_PORT=0`:

```
  The script line is in page.html, just before </body>.
...
<!doctype html><html><head><style>p{color:red}</style></head><body><p>minified</p><script src="http://127.0.0.1:47391/lahe-layer.js"
        data-lahe-review="r32d404bb2d39"
        ...
        defer></script></body></html>
...
  Took out the script line for review r32d404bb2d39.
<!doctype html><html><head><style>p{color:red}</style></head><body><p>minified</p></body></html>
```

The page came back byte for byte. The helper it started (pid 32400) was stopped with SIGTERM and confirmed gone. The first try failed with "gave up after 15000ms waiting for the helper": the pages port 1483 was taken by the real helper, so I set `LAHE_PAGES_PORT=0`, as the unit tests do. Not related to this change.

**Strictness gate.** `node --test test/unit/strictness_gate.test.js`: 25 of 25 pass in about 5 seconds. Each fixture and what refuses it:

| Fixture | Refused by |
| --- | --- |
| `src/server/explicit-any.ts` | `@typescript-eslint/no-explicit-any` |
| `src/server/unsafe-json.ts` | `@typescript-eslint/no-unsafe-assignment` (also `-member-access`, `-return`) |
| `src/server/ts-ignore.ts` | `@typescript-eslint/ban-ts-comment` (and `lahe/no-comments`) |
| `src/server/ts-expect-error.ts` | `@typescript-eslint/ban-ts-comment` (and `lahe/no-comments`) |
| `src/server/as-cast.ts` | `@typescript-eslint/consistent-type-assertions` |
| `src/server/non-null.ts` | `@typescript-eslint/no-non-null-assertion` |
| `src/server/switch-missing-member.ts` (a `default` standing in for a member) | `@typescript-eslint/switch-exhaustiveness-check` |
| `src/browser/review-layer/imports-server.ts` | TS6307 (and TS6059), and `no-restricted-imports` |
| `src/server/uses-document.ts` | TS2584 |
| `src/browser/review-layer/imports-node.ts` | TS2591, and `no-restricted-imports` |
| `src/server/imports-package.ts` | `no-restricted-imports` (no packages under `src/`) |
| `src/server/stray-comment.ts` | `lahe/no-comments` |
| `src/server/header-extra-field.ts` (an `owner:` line) | `lahe/no-comments` |
| `src/server/header-misplaced.ts` (header after code) | `lahe/no-comments` |
| `src/server/header-missing.ts` | `lahe/no-comments` |
| `src/server/imports-js.ts` | `lahe/no-js-imports` |
| `src/server/default-export.ts` | `no-restricted-syntax` |
| `src/server/top-level-await.ts` | `no-restricted-syntax` |
| `src/server/uses-enum.ts` | TS1294 (`erasableSyntaxOnly`) and `no-restricted-syntax` |
| `src/server/uses-namespace.ts` | TS1294 and `no-restricted-syntax` |
| `src/server/uses-require.ts` | `no-restricted-syntax` (and `no-require-imports`) |
| `src/server/bad-name.ts` | `@typescript-eslint/naming-convention` |
| clean: `src/contract/clean-module.ts`, `src/server/imports-contract.ts`, `src/server/plain-value.ts` | nothing, from either tool |

Two more cases: every strict flag is present in the base, and no project sets anything but `lib`, `types` and `outDir`. Checked by hand that the test catches a regression: turning `noUncheckedIndexedAccess` off, turning the cast rule off, giving the browser project a server reference, and setting `strict: false` in one project each failed exactly the one matching case.

**Gate.** `npm run gate:unit` on Node 24.22.3, with `f37b9811`'s tree:

```
lint passed (syntax: 549 files, no duplicate declarations, lua: 1 file via pandoc lua, no jsdom, manifest complete, kebab-case .ts names)
ℹ tests 3263
ℹ pass 3256
ℹ fail 0
ℹ skipped 5
ℹ todo 2
no_stray_helpers: no helper from this run is still running
```

The 5 skips are the menu bar app tests ("set LAHE_MENUBAR_APP"), as in S0a. Total wall time 116.9 seconds. (That run was on `b4efa0f9`; `f37b9811` only added `--max-warnings 0`, after which `tsc -b` and `eslint --max-warnings 0` both passed again.)

**How long `npm run lint` takes** (`/usr/bin/time -p`, this Mac, this worktree):

| Part | Seconds |
| --- | --- |
| `node scripts/lint.js` | 28.7 |
| `tsc -b`, no build info | 3.5 |
| `tsc -b`, second run | 0.5 |
| `eslint` | 3.1 |
| `npm run lint`, whole | 39.6 |

For comparison, the old `lint.js` on the same tree took 38.6 seconds, because it still walked `docs/`. `tsc -b` and `eslint` add 3.6 seconds with build info and 6.6 without, and the shorter walk takes back 9.9, so the gate is no slower for builders (sums by `python3 -c`). Most of `lint.js`'s time is one `node --check` process per `.js` file (549 of them). In the main checkout, where `.claude/worktrees/` holds whole copies of the repo, the skip saves much more.

**Leftover helpers.** `ps -axo command | grep -c "[l]ahe.js serve"`: 1 before my first test run, 1 after the targeted runs, 1 after the real `lahe add`, 1 after `gate:unit`. The one is the helper that was running before I started.

**Verification table rows owned by S0b:**

| Requirement | Status |
| --- | --- |
| Real `.ts` in strict mode, every stricter flag | pass: the flags case in `strictness_gate.test.js` |
| No escape hatches | pass: the any, ts-ignore, ts-expect-error, cast and `x!` fixtures |
| Every switch handles every case | pass: `switch-missing-member.ts` |
| Folder boundaries enforced by the compiler | pass: TS6307, TS2584, TS2591 fixtures |
| `tsc` runs in `gate:unit` | pass: `npm run lint` runs `tsc -b` and `eslint` (gate output above) |
| The gate rejects new comments, and allows only the header | pass: four comment fixtures refused, clean files pass |
| Zero runtime dependencies | pass: `dependencies` is `{}`, the four new packages are exact in `devDependencies` |

## Deviations and surprises

- **`noEmit` is not possible; projects write declarations.** tsc refuses `noEmit` on a project another project references: TS6310, "Referenced project may not disable emit". So the base has `emitDeclarationOnly` (which `allowImportingTsExtensions` accepts) and each project writes into the git-ignored `.tsbuild/<folder>/`. I added `noEmitOnError`, because without it a failing build wrote a stray `.d.ts` beside the source (seen in a scratch run).
- **`scripts/import-layers.mts`, not `.ts`.** `scripts/` holds CommonJS scripts, so a `.ts` file there with `import` syntax is refused by tsc (TS1295 and TS1287, reproduced on TypeScript 6.0.3) and Node prints `MODULE_TYPELESS_PACKAGE_JSON`. A nested `package.json` in `scripts/` would break every `.js` script in it. `.mts` is always an ES module for both tools. T3 can rename it. The ESLint rules sit in their own new folder, `scripts/eslint-rules/`, which takes the architecture's nested `package.json` instead.
- **A `package.json` in `test/unit/server/`.** The same rule, for the new `.ts` test: `test/unit/` holds CommonJS tests. Each new top-level test folder (`test/unit/contract/` and so on) needs one.
- **The ESLint config is `eslint.config.mjs`.** It imports the two local rules from `.ts` files, which Node 24 strips. The rules are written in TypeScript and pass every rule themselves.
- **`lahe/no-comments` also requires the header.** The contract asks it to reject every comment but the header. It also reports a file with no header, because the plan's constraints say every `.ts` file has one. If you want the rule to only reject, it is one line.
- **Choices in the ESLint config a reviewer should look at:**
  - `no-floating-promises` allows `node:test`'s own calls (`test`, `describe`, `before` and the rest) in `test/**/*.ts`. `test()` returns a promise the runner handles, so every test line was flagged. This is typescript-eslint's documented setting for test runners, scoped to those names from `node:test`; a floating promise inside a test is still refused (checked with a probe).
  - `naming-convention`: object keys and object-literal methods may be camelCase, PascalCase, snake_case or UPPER_CASE, because outside formats set them (wire fields are snake_case; ESLint's visitor methods are named after node types like `ImportDeclaration`). Types, variables, functions and parameters follow the table. Keys that need quotes, such as `"content-type"`, are not checked.
  - `switch-exhaustiveness-check` also refuses a `default` on a switch that already handles every member, and requires a `default` on a switch over a plain string.
  - `max-lines` is off with `max: 400`. The number is mine; SP1 and SP2 should pick theirs.
- **`lint.js` leaves `package.json` and `tsconfig.json` under `src/` out of the manifest check**, as well as `.ts` files. The contract named only `.ts`; the project files would otherwise each need a manifest owner.
- **Four script line cases moved out of `add_command.test.js`.** There was no test file for `script_line.js` to `git mv`, so the move is by case, and the spec maps each one. This edits a CLI test file; the CLI slice should know the cases are gone on purpose.
- **The `where` phrases became a union type** (`ScriptLinePlace`). People read them in `lahe add`'s output and the server log, so a typo is now a compile error.
- **I wrote one stray file into the main checkout by mistake** (`docs/diagrams/module_map.md.tmp-ignore`, a one-character scratch file from a wrong path). I moved it to the session scratchpad right away; `git -C <main> status` is clean.
- **`npm audit` reports 9 moderate findings**, all one `minimatch` denial-of-service advisory reached through ESLint 10 and typescript-eslint. These are dev tools only and the patterns are our own config. The suggested fix downgrades ESLint to 9, which the architecture did not choose.
- TS2591, not TS2307, is what TypeScript 6 gives for `node:fs` in a browser project. The test accepts either.

## Follow-ups

- **CI** (top of this page): `gate.yml` needs `npm ci` before `npm run lint`. Owner: orchestrator.
- **`docs/ongoing/TESTING.md`** still says `test:unit` runs only `test/unit/*.test.js` (lines 56 and 136) and that unit tests are named `*.test.js`. It now also runs `test/unit/**/*.test.ts`. Not my file.
- **`docs/diagrams/README.md`** row for `module_map.md` still describes the old four-folder picture; **`docs/ongoing/ARCHITECTURE.md`** line 81 still says the map "draws the manifest". F1 owns ARCHITECTURE.md; the README row is a one-line change for whoever owns it.
- **Folder doc ownership.** The plan says each folder doc has one owning slice, but `src/server/sites/` gets files from S0b, SV1, SV2, SV3 and SV4. Those slices will need to add sections to `docs/ongoing/code/server-sites.md`, or the plan should name a different split.
- **`docs/CONTRACTS.md`** line 945 names `src/shared/script_line.js`. Still true while the forwarder exists; F1's doc pass should point it at the new path.
- Two known edges kept as they were, written in `server-sites.md`: `EXISTING_TAG` finds a tag inside an HTML comment, and the append case does not round-trip on a file with no final newline. Neither is a regression; either could be a board row.

## The counting script

`count_lines.py`, in the session scratchpad, run as `python3 count_lines.py <files>`. It counts total lines, lines inside `//` or `/* */` comments, and blank lines. Later slices need the same counts and could commit a copy.

## Cleanup needed

None in the repo. Scratch files outside it, in the session scratchpad (the OS owns that folder): the counting script, a throwaway re-export of the old module (`old-shim-script-line.ts`), two lint probes (`probe-floating.ts`, `probe-inline.ts`), the old `lint.js` copy, the `real-add/` folder and its state, the moved `module_map.md.tmp-ignore`, and the `.tsbuild` folder from before the cold timing (`tsbuild-before-cold/`).
