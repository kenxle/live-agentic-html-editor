---
read-when: Deciding how a piece of the TypeScript migration works (module format, bundling, enforcement, the mixed period) before building or reviewing a slice.
---

# Architecture: Lahe in strict TypeScript, with the compiler enforcing structure

This document answers the eight questions in the [handoff](HANDOFF.md), which serves as the brief. The [plan](02_plan_typescript_migration.md) turns it into slices. Every version fact below was checked against live sources on 2026-11-12; the table is in [research/node_and_typescript.md](research/node_and_typescript.md), and the facts about today's code are in [research/codebase_recon.md](research/codebase_recon.md).

## Summary

- **Node 24.12.0 is the new minimum.** That is the first Node 24 release where running `.ts` files directly is marked stable. Node 24 is supported until 2028-04-30. Node 22 also runs `.ts` files, but it reaches end of life on 2027-04-30 and its own docs still call the feature a release candidate. `.nvmrc` moves to 24.22.3, the newest 24 release.
- **The server and the CLI run their `.ts` files directly,** with no build step. Only syntax Node can erase is allowed, and imports name the `.ts` extension.
- **The browser layer becomes ES modules, bundled by esbuild** (a dev dependency) into the same committed `dist/lahe-layer.js`. The global namespace and the hand-kept load order go away. That is what gives the browser code real type checking across files.
- **`src/shared` splits by what each file is.** The wire contract becomes `src/contract/`. Logic both sides run becomes `src/domain/`. Files only the browser runs move into the browser folder, and the test fixtures move into `test/`.
- **The folder layout is enforced by the compiler.** Each folder is its own TypeScript project, and a project can import only the projects it lists. The browser projects cannot see Node's types, and the server cannot see the DOM.
- **The gate rejects escape hatches and comments.** TypeScript 6.0.3 runs with every strict flag. ESLint with typescript-eslint rejects `any`, `@ts-ignore`, `as` casts, `!` and switches that miss a case. A small rule in the repo rejects comments. Both run inside `npm run gate:unit`.
- **The migration is incremental, from the bottom up.** The contract converts first. Then the server and the browser layer convert side by side, each from the files with no dependencies upward. The CLI converts last, then the tests. Main works after every slice.

## Decisions

| # | Decision | Reason |
| --- | --- | --- |
| A1 | Node floor `>=24.12.0`; `.nvmrc` 24.22.3; CI on Node 24 | First release with type stripping marked stable; supported to 2028-04-30. See [the Node question](#question-4-the-node-minimum). |
| A2 | Server and CLI run `.ts` directly through Node's type stripping | Keeps "clone and run" with no build step. Confirms the chat recommendation. |
| A3 | ES modules everywhere in new code; the root becomes `"type": "module"` at the end | Typed imports need ES modules. See [the mixed period](#question-7-the-mixed-period). |
| A4 | The browser layer is ES modules bundled by esbuild 0.28.2 into one IIFE file | The only way the type checker sees real dependencies between browser files. |
| A5 | `src/shared` splits into `contract`, `domain`, and moves of one-sided files | Names say what each part is. Half of `shared` is not shared. |
| A6 | One TypeScript project per folder, with references as the allowed imports | The compiler, not a review, refuses a forbidden import. |
| A7 | TypeScript 6.0.3 now, TypeScript 7 when typescript-eslint supports it | typescript-eslint refuses TypeScript 6.1 and later today. |
| A8 | ESLint 10.14.0 and typescript-eslint 8.72.2 as dev dependencies, plus two local rules | tsc cannot ban `any`, casts, `!` or comments by itself. |
| A9 | No comments in `.ts` files, header included; each source folder gets a doc with a file table that lint checks | Keeps the routing a header gave, in a place lint keeps current. One question for Ken. |
| A10 | Unit tests stay JavaScript while the source converts, then convert in their own wave | Unchanged tests passing is the proof that a conversion changed no behavior. |
| A11 | Two temporary bridges during the mixed period: a one-line forwarder at each old Node path, and a generated registration for each converted browser module | Lets each slice touch only its own files. Both are removed in the finishing slice. |

## The shape today

Line counts and file roles come from the handoff and [the recon](research/codebase_recon.md). What matters for this design:

- **Everything is ES5-style CommonJS.** `src/` has no `const`, no `let`, no arrow functions, no classes and no ES modules. 30.7 percent of its lines are comments.
- **The browser layer is held together at load time.** Each file is a factory that receives the modules it needs as parameters from `window.LAHE`. The order comes from `src/shared/manifest.js`. Only two files reach the namespace after load. One pair of files (`protect` and `replay`) depend on each other.
- **The same files run in Node.** Every shared and layer file also has a `module.exports` branch, and 70 unit test files `require` layer code directly with hand-built fake DOM nodes.
- **The Library page is served as four raw source files** from `src/` (`src/service/catalog_page.js:45-50`), outside the bundle.
- **The server has one import cycle** of five files: `replies`, `projection`, `page_routes`, `rebuild` and `handled_check`.
- **Nothing checks the Node version at runtime.** The docs disagree with one another: some say 18.2, others say 20.
- **The "contract text" the handoff mentions no longer exists.** Commit `82e2f310` moved agent instructions into the skill. What a conversion must keep byte for byte is the Copy and Export text, the `review.json` projection, and the CLI strings that the skill tests quote. All of these are pinned by tests that stay unchanged during the source waves.

## Question 1: the browser module system

**Decision: ES modules with esbuild.** Concatenation with types stripped was rejected. Each file would still receive its neighbours through untyped factory parameters, so the compiler would check each file alone and nothing between them. That is where the "two sides disagree" bugs live.

How it works when done:

- `src/browser/review-layer/main.ts` is the entry. Files import what they use.
- `scripts/build-layer.ts` runs esbuild with `bundle: true`, `format: "iife"`, a fixed `target`, no source maps, and `define` for the version stamp. That replaces the source rewrite `scripts/build-layer.js:90` does today. Output is still `dist/lahe-layer.js`, still committed, and still checked by `npm run check:layer`.
- The bundle keeps exactly two globals. `window.LAHE` holds the version and the public entry points the page and the tests use today. `__lahe` is the debug global the browser tests read. Nothing in the layer reads its own modules off the namespace any more.
- A second entry builds the Library page into `dist/lahe-library.js`. The server serves that one file instead of the four raw sources. This removes the quirk where the page loads `protocol.js` without `failures.js`.
- esbuild is pinned to an exact version. The bundle check compares bytes, and esbuild makes no promise of identical output across versions. Across platforms the risk is low but unproven, so the S0c slice proves it by building on Ken's Mac and in CI on Linux, and comparing the results.
- esbuild does no type checking. `tsc -b` does that in the gate.

## Question 2: what `src/shared` becomes

`shared` holds three kinds of code under one name. Its importers show that five of its files are used only by the browser layer, and one holds test data that ships inside the bundle. The split:

- **`src/contract/`: the contract between the server and the browser.** Types and constant tables for records, the wire protocol, failure codes, markers and style rules. It also holds the parsers that turn untrusted JSON into those types at the boundary. It imports nothing.
- **`src/domain/`: logic both sides run and must agree on.** Text normalizing, item states and their transitions, the gesture vocabulary, elapsed-time wording and the human-readable review format. It imports only `contract`.
- **Moved out because only one side runs them:**
  - `merge`, `regions`, `uniqueness` and `epoch` go to the browser layer;
  - `script_line` goes to the server;
  - `record_fixtures` goes to `test/support/` and leaves the shipped bundle;
  - the `contracts.js` barrel is removed;
  - `manifest.js` shrinks as files convert and is removed at the end.

Much of `record.js` and `protocol.js` is hand-written validation and long comments. In TypeScript, the shapes become types. The validation that is left belongs at the boundary: a function that takes `unknown` (data from the network, a file or browser storage) and returns a typed record or a typed refusal. Inside, code trusts the types (the Boundary Discipline principle). Unions with a `kind` or `state` field replace string checks, so a switch that misses a state fails the build.

How a `.ts` file in `contract` or `domain` reaches both sides: Node imports it directly, and esbuild bundles it into the browser files. One source file serves both, with no wrapper and no environment check.

The full file-by-file mapping is in [parts/target_layout.md](parts/target_layout.md).

## Question 3: how the server and the CLI run

**Decision: Node type stripping, no compiled output.** The chat recommendation holds once its limits are checked:

- Only erasable syntax is allowed: no `enum`, no runtime `namespace`, no parameter properties. Node 26 removed the flag that would have allowed them, so this limit is permanent. `erasableSyntaxOnly` in the compiler enforces it. Constant tables become `as const` objects with a derived union type, which the cast ban allows.
- Imports name the `.ts` extension. The compiler allows this with `allowImportingTsExtensions` and `noEmit`.
- Node ignores `tsconfig.json`, so there are no path aliases. Imports are relative.
- Node does not strip types inside `node_modules`. That does not matter here: Lahe runs from its own clone.
- No top-level `await`. It would stop CommonJS tests from loading a converted module during the mixed period. Lint bans it.

**`bin/lahe.js` stays JavaScript, on purpose.** It is the one file that must run on an old Node: it checks `process.versions.node` and, below 24.12.0, prints a message naming the version found, the version needed and the two commands to run, then exits. Otherwise it loads the CLI entry. Keeping its name also keeps working the five places that spawn `process.execPath` plus `bin/lahe.js`, the Stop hook, the login item and every existing install wrapper.

**The `npm run install-cli` wrapper does not change shape.** It still names the absolute Node that ran it and `bin/lahe.js`. What changes is that it refuses to install from a Node below the floor.

## Question 4: the Node minimum

| Line | End of life | Runs `.ts` with no flag | Feature status |
| --- | --- | --- | --- |
| 20 | 2026-04-30 (past) | no | none |
| 22 | 2027-04-30 | from 22.18.0 | "release candidate" in 22's own docs |
| 24 | 2028-04-30 | from 24.3.0 | stable from 24.12.0 |
| 26 | 2029-04-30 | yes | stable |

Read literally, the rule "the lowest line not past end of life that runs `.ts` files" picks 22.18. But 22 reaches end of life on 2027-04-30, and its own documentation does not call the feature stable. 24.12.0 is the first release where both conditions hold with no asterisk. The plan page asks Ken to confirm this.

What the change touches, all in slice S0a:

- `engines.node`, `.nvmrc`, and `node-version` in `.github/workflows/gate.yml`;
- `bin/lahe.js` (the version check above) and `scripts/install-cli.js` (refuses an old Node);
- the `CLI_RUNTIME_MISSING` text in `failures.js`, which today says Node 20 and is used nowhere;
- `README.md`, `docs/INSTALL.md`, `docs/UPGRADING.md`, the "Node version" section of `CLAUDE.md` (and its stale paragraph about the `contract` field), and `docs/ongoing/TESTING.md`.

**What an existing user sees.** Their wrapper, login item and Stop hook name the Node they installed with. After a pull, the next `lahe` command runs `bin/lahe.js` on that old Node, which prints:

> Lahe needs Node 24.12 or newer, and this is Node 20.19.0. Install Node 24, then run `npm run install-cli` and `lahe install` in &lt;clone&gt;.

The server that is already running keeps serving its old code until it restarts. `docs/UPGRADING.md` gets a section with the same steps.

**Ken's machine.** He has 20.19.0 and 24.11.1, and 24.11.1 is one release below the floor. S0a installs 24.22.3 through nvm, reruns `npm run install-cli`, `lahe install` and `npm run install-skills`, and checks that the wrapper names the new Node.

## Question 5: how the rules are enforced

Every rule below runs in `npm run gate:unit`, so a builder sees it before anyone reviews.

**The compiler (`tsc -b`, TypeScript 6.0.3).** One base config, `tsconfig.base.json`:

- `strict` (which includes `noImplicitAny`, `strictNullChecks`, `useUnknownInCatchVariables` and `strictBuiltinIteratorReturn`);
- `noUncheckedIndexedAccess`, `exactOptionalPropertyTypes`, `noPropertyAccessFromIndexSignature`, `noImplicitOverride`, `noImplicitReturns` and `noFallthroughCasesInSwitch`;
- `noUnusedLocals`, `noUnusedParameters`, `allowUnreachableCode: false` and `allowUnusedLabels: false`;
- `isolatedModules`, `verbatimModuleSyntax`, `erasableSyntaxOnly`, `isolatedDeclarations` (exported functions state their types) and `noUncheckedSideEffectImports`;
- `module: nodenext`, `allowImportingTsExtensions`, `noEmit`, `composite`, and `allowJs: false`.

Each folder's `tsconfig.json` extends the base, sets its `lib` and `types`, and lists the projects it may import as `references`. A file that imports outside its references fails with TS6307. The research reproduced that, along with the DOM and Node separation.

**ESLint with typescript-eslint**, type-aware, starting from `strict-type-checked` and adding:

| Rule | What it stops |
| --- | --- |
| `no-explicit-any` | `any` written by hand |
| `no-unsafe-assignment`, `-call`, `-member-access`, `-return`, `-argument` | an `any` leaking in from `JSON.parse` or a library. The fix is `unknown` and a parser |
| `ban-ts-comment`, every directive banned, no description allowance | `@ts-ignore`, `@ts-expect-error`, `@ts-nocheck` |
| `consistent-type-assertions` with `assertionStyle: "never"` | `as` casts. `as const` is still allowed |
| `no-non-null-assertion` | `x!` |
| `switch-exhaustiveness-check`, with a `default` not counted as handling a union | a new state some switch ignores |
| `no-restricted-imports` per folder | a second, readable error beside TS6307 |
| `naming-convention` | types PascalCase, values camelCase, constants UPPER_CASE |
| `no-restricted-syntax` | default exports, top-level `await`, `enum`, `namespace`, `require` in `.ts` |
| local `lahe/no-comments` | any comment in a `.ts` file under `src/` and, from the test wave, `test/` |
| local `lahe/no-js-imports` | a `.ts` file importing a `.js` file (the mixed-period rule below) |
| `max-lines` | very large files. Off until each area's split slice, then on (see the plan) |

The two local rules live in `scripts/eslint-rules/`. Both are short: one reports every comment ESLint's parser finds, the other checks import specifiers. typescript-eslint was chosen over a hand-written checker because the type-aware rules (`no-unsafe-*`, the switch check) need the type checker. Rebuilding those would be a project of its own.

`scripts/lint.ts` keeps what only it does: no jsdom, Lua compiles, no duplicate top-level functions in the remaining `.js`, kebab-case file names, every file in its folder doc's table, and no `.js` left under `src/` once the finishing slice runs. It also stops walking `docs/` and `.claude/worktrees/`, which it walks today by mistake.

**Every rule has a proof.** `test/unit/strictness_gate.test.js` feeds the compiler and ESLint one small fixture per rule. Each fixture holds one violation (an `any`, a cast, a missing switch case, a browser import of server code, a comment, and so on), and the test asserts the gate rejects each one. A rule someone turns off later fails this test.

## Question 6: tests

- **Unit tests stay `.js` during the source waves.** CommonJS can `require` a converted ES module on Node 24 with no warning (the research reproduced this). The tests that prove behavior today keep proving it, unchanged, while each file converts underneath them. A slice changes a test only where the test reads source text that the slice moves. The plan lists those tests slice by slice.
- **Unit tests convert in wave T1, by area,** once that area's source has finished. They follow the same rules as the source, with no relaxed config for tests. Fake DOM objects are the hard case: code that needs a node will take a small interface listing what it reads, not a full `Element`, so a test's fake fits without a cast. If a case cannot be shaped that way, the builder raises it rather than adding an exception.
- **Browser tests, helpers and `playwright.config` convert in wave T2.** Playwright runs `.ts` specs natively.
- **The 13 browser specs and 2 support files that build the layer from source paths** stop doing that in S0c. They get the bundle from one helper that builds it in memory with esbuild, so they always test the current source.

## Question 7: the mixed period

While some files are `.ts` and some are `.js`, four rules keep main green.

1. **Convert from the bottom up.** A `.ts` file imports only `.ts` files, and lint enforces it. So the type checker never sees JavaScript (`allowJs: false`), and every typed file is checked against typed dependencies. The order comes from the import graph. The [plan](02_plan_typescript_migration.md#slices) lists it, and `scripts/import-layers.ts` (built in S0b) prints it so a builder can check it.
2. **New folders declare ES modules.** Until the root flips, each new top-level folder (`src/contract`, `src/domain`, `src/server`, `src/browser`) carries a one-line `package.json` with `{"type": "module"}`. The research found that without it, `tsc` refuses the file (TS1287, TS1295) and Node warns. `src/cli` already exists and holds CommonJS files, so the CLI converts in one slice that adds its `package.json` at the same time.
3. **Old Node paths forward.** When a file moves, a one-line CommonJS forwarder stays at its old path: `module.exports = require("<new path>.ts")`. Old callers and unit tests keep working untouched. The manifest lists forwarders in their own list, so the completeness check still holds.
4. **Converted browser modules are registered for old ones.** Until the last layer file converts, old layer files still read their dependencies off `window.LAHE`. The build generates, in memory (an esbuild virtual module), a small registration for each converted module, at that module's place in the manifest order: `import * as m from "<path>.ts"; LAHE.<name> = m;`. Unconverted files are bundled as they are, in order.

Both bridges are temporary. Slice F1 rewrites every import to the new paths with a script, then removes the forwarders, the registrations, the manifest and the nested `package.json` files, and sets `"type": "module"` at the root. The Outcome-Oriented Execution principle argues against compatibility code. It is accepted here because without it each slice would edit a hundred files that other slices also edit, and parallel builders would collide on every merge.

**Exported names do not change during conversion.** Forwarders and registrations hand old callers the same names. Renaming exported things, such as "helper" to "server", happens in each area's finishing step, together with its callers.

## Question 8: slicing

Slices follow the target layout, so each file has exactly one owning slice. The rules every slice follows:

- **A conversion changes no behavior.** The unchanged unit suite is the proof.
- **A bug the types reveal gets its own fix.** A tiny fix that is the only way to satisfy the compiler may stay in the slice, if the builder lists it under "Deviations" with a test. Anything else goes on the board as its own row.
- **Comments move to docs in the same slice.** Each target folder gets one doc, `docs/ongoing/code/<folder>.md`, owned by the slice that creates the folder. It opens with a table of the folder's files and a read-when line for each, which lint checks. Then comes the why, the traps and the history worth keeping. History with no future use (old task owners, decision numbers that no longer resolve) is dropped. Existing subsystem docs, such as `FINGERPRINTING.md`, only gain a link, so parallel slices never edit the same doc.
- **Splitting very large files is its own refactor slice.** `overlay.js` (8,878 lines), `editing.js` (6,066) and four more files over 3,000 lines first convert as single files. Then a split slice for each area breaks them up and turns `max-lines` on for that folder.

The slice list, the order, the owners and the evidence are in [the plan](02_plan_typescript_migration.md).

## Failure modes and how they surface

| What goes wrong | How it shows up | Where it is caught |
| --- | --- | --- |
| A converted file changes behavior | an unchanged unit test fails | `gate:unit` in the slice |
| The esbuild bundle behaves differently from the concatenated one | a browser spec fails | full `gate` and `gate:all` at checkpoint 0, before any conversion |
| esbuild output differs between Mac and Linux | `check:layer` fails in CI | S0c proves both; if they differ, CI rebuilds and compares meaning, not bytes, and the plan is revised |
| A slice imports an unconverted `.js` | lint error `lahe/no-js-imports` | `gate:unit` |
| A user on an old Node pulls | the version message from `bin/lahe.js` | S0a unit test on the message; a manual run on Node 20 |
| The running server is on old code after the pull | the existing source-stamp check restarts it | unchanged mechanism. The restart uses the new Node once the wrapper is reinstalled |
| A test that pins source text breaks on a move | that test fails | listed per slice in the plan, and updated in the slice that moves the file |
| typescript-eslint never supports TypeScript 7 | the project stays on 6.0 | a board row checks this; 6.0 is a supported release |

## Security and privacy

The trust boundaries in [ARCHITECTURE.md](../../ongoing/ARCHITECTURE.md#trust-boundaries) do not change. Two parts of the migration touch them:

- **Boundary parsers.** Every place that reads untrusted input (an HTTP body, a file in the state folder, browser storage, a reply line) gets a parser from `unknown` to a typed result. That is stricter than today, and it should be. A parser that turns out stricter than the current hand-written check is a behavior change. It goes in its own fix with a test, never silently into a conversion.
- **The Library page asset allowlist** changes from four raw files to one built file in S0c. `catalog_auth.test.js` and the allowlist tests move with it, and the security reviewer reads that diff at checkpoint 0.

New dev dependencies (TypeScript, ESLint, typescript-eslint, esbuild, `@types/node`) are pinned to exact versions with a lockfile. None of them ship to users, and `dependencies` stays `{}`.

## Alternatives weighed

| Alternative | Why not |
| --- | --- |
| Keep concatenation, strip types per file | The compiler checks each file alone; cross-file mistakes stay invisible. Fails the handoff's measure of success. |
| Compile the server to committed JavaScript | Adds a build step and a second committed artefact for no gain once Node runs `.ts`. |
| Big-bang conversion in one branch | Long drift against a moving main, and one review nobody can read. Parallel builders could not work. |
| Rename every `.js` to `.cjs` and flip the root to ES modules first | A thousand-file mechanical commit that every later slice conflicts with, for what nested `package.json` files give for free. |
| Hand-written lint over the TypeScript compiler API instead of ESLint | Feasible for comments, but rebuilding the type-aware `any` and switch checks is a project of its own. Also, TypeScript 7 ships no compiler API. |
| TypeScript 7 now | typescript-eslint cannot load it; the `tsgo` backend is marked not ready by its maintainer. |
| Keep one-line `read-when` headers in `.ts` files | Reasonable, and offered to Ken as the other answer. The folder doc table gives the same routing, and lint can check that it stays complete. |
