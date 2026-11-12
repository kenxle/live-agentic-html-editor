---
read-when: Checking a fact about Node versions, type stripping or TypeScript tooling that the migration plan relies on.
---

# Node and TypeScript facts for the migration plan

Research date: 2026-11-12. Role: researcher, outside dependencies angle. Every fact carries its source URL. Anything not confirmed from a primary source is marked UNVERIFIED. Facts marked OBSERVED were reproduced on this machine in a scratch folder (commands listed under "Experiments run").

## Rechecked live on 2026-11-12 at 11:17

Ken asked for every version fact to be checked against live sources, since they change quickly. The planning agent pulled these straight from the machine-readable feeds with `curl` and summarized them with a script (`versions.py` in the session scratchpad). Each row agrees with the researcher's findings below.

| Fact | Value | Source |
| --- | --- | --- |
| Node 20 end of life | 2026-04-30 (past) | https://raw.githubusercontent.com/nodejs/Release/main/schedule.json |
| Node 22 end of life | 2027-04-30; in maintenance since 2025-10-21 | same |
| Node 24 end of life | 2028-04-30; in maintenance since 2026-10-20 | same |
| Node 26 | Active LTS since 2026-10-28; end of life 2029-04-30 | same |
| Newest releases | 22.23.5 (2026-11-11), 24.22.3 (2026-11-10), 26.13.1 (2026-11-10) | https://nodejs.org/dist/index.json |
| Type stripping on by default | 22.18.0 and 23.6.0 | https://github.com/nodejs/node/blob/main/doc/api/typescript.md (YAML history) |
| Type stripping without a warning | 22.18.0 and 24.3.0 | same |
| Type stripping marked stable | 24.12.0 (2025-12-10) and 25.2.0; Node 22's own docs still say "1.2 Release candidate" | same, and the v22.x branch copy of the file |
| `--experimental-transform-types` removed | 26.0.0 | same |
| TypeScript on npm | `latest` 7.0.2 (2026-07-08); 6.0.3 (2026-04-16) is the newest 6.0; 7.1.0-beta out | https://registry.npmjs.org/typescript |
| typescript-eslint | 8.72.2 (2026-11-09); peer range `typescript >=4.8.4 <6.1.0`, `eslint ^8.57.0 or ^9 or ^10` | https://registry.npmjs.org/typescript-eslint |
| typescript-eslint on TypeScript 7 | Not supported. The day-one request was closed as not planned because 7.0 has no API; a `tsgo` backend exists behind `EXPERIMENTAL_backend` and its maintainer says it "is not yet ready for use" (issue opened and closed 2026-11-10) | https://github.com/typescript-eslint/typescript-eslint/issues/12518, https://github.com/typescript-eslint/typescript-eslint/issues/13181 |
| ESLint | `latest` 10.14.0 (2026-10-30); engines `^20.19.0 or ^22.13.0 or >=24` | https://registry.npmjs.org/eslint |
| esbuild | `latest` 0.28.2 (2026-08-08) | https://registry.npmjs.org/esbuild |
| `@types/node` | newest 24.x is 24.19.2; `latest` is 26.6.6 | https://registry.npmjs.org/@types/node |

## Answer first: five surprises

1. TypeScript 7.0 (the native Go compiler) is already stable. It shipped 2026-07-08, and `typescript@latest` on npm is 7.0.2. But the 7.0 package ships no compiler JavaScript API. A repo script that walks the AST with `import ts from "typescript"` does not work on 7.0. It needs `@typescript/typescript6` (6.0.2) or the 7.1 API.
2. typescript-eslint 8.72.2 supports TypeScript `>=4.8.4 <6.1.0` only. So ESLint with typescript-eslint cannot sit on TypeScript 7 today. That ties the lint stack to TypeScript 6.0.x.
3. Type stripping is "stable" only from Node 24.12.0 and 25.2.0. Node 22 (every release, up to the latest 22.23.5) still documents it as Stability 1.2, release candidate, though it is on by default and warning-free from 22.18.0. The Node 24.11.1 installed here is one release below the stable mark.
4. `--experimental-transform-types` was removed in Node 26.0.0. On Node 26 there is no built-in way to run enums, runtime namespaces or parameter properties. Code must be erasable, full stop.
5. Under `module: nodenext`, a `.ts` file with `import`/`export` in a package with no `"type"` field is an error with `verbatimModuleSyntax` (TS1287 for exports, TS1295 for imports). Node will run it, but prints a `MODULE_TYPELESS_PACKAGE_JSON` warning. A nested `package.json` with `"type":"module"` fixes both tools.

## Local machine state (OBSERVED)

- Default `node --version`: v20.19.0. Installed under `~/.nvm/versions/node`: v18.20.8, v20.10.0, v20.19.0, v24.11.1. No Node 22 or 26.
- No global `tsc`, `esbuild` or `eslint`. The Lahe repo's `node_modules` has only `@playwright/test` and `@types` (via the existing devDependency); no `typescript`.
- TypeScript 5.9.2 and 5.9.3 exist inside other repos' `node_modules` (for example `/Users/kennethstclair/Documents/workspace/tricorder-readout-verdicts/readout/node_modules/typescript`). I ran the TypeScript experiments below with 5.9.3 from there. Nothing was installed. Behaviour on TypeScript 6 and 7 was not run locally (see Open questions).

## 1. Node release lines and end-of-life

Source for all dates: https://github.com/nodejs/Release (release schedule table) and https://nodejs.org/en/about/previous-releases (status column, as of 2026-11-12).

| Line | Initial release | Active LTS from | Maintenance from | End of life | Status 2026-11-12 |
|---|---|---|---|---|---|
| 20 (Iron) | 2023-04-18 | 2023-10-24 | 2024-10-22 | 2026-04-30 | EOL |
| 22 (Jod) | 2024-04-24 | 2024-10-29 | 2025-10-21 | 2027-04-30 | Maintenance LTS |
| 24 (Krypton) | 2025-05-06 | 2025-10-28 | 2026-10-20 | 2028-04-30 | Maintenance LTS (since 2026-10-20) |
| 26 (Lithium) | 2026-05-05 | 2026-10-28 | 2027-10-20 | 2029-04-30 | Active LTS (since 2026-10-28) |

- Node 25 (odd line, never LTS) is already EOL per https://nodejs.org/en/about/previous-releases.
- The schedule page says "Dates are subject to change."
- The previous-releases page lists latest patch dates: v22 last updated 2026-11-11, v24 on 2026-11-10, v26 on 2026-11-10.
- Lowest line not past EOL on 2026-11-12: **22**, EOL 2027-04-30, already in Maintenance (not Active) LTS. The next floor up, **24**, is EOL 2028-04-30, and is also already in Maintenance. Node 26 is the only line in Active LTS.
- Current doc versions seen: Node 22 docs v22.23.5, Node 26 docs v26.13.1 (https://nodejs.org/docs/latest-v22.x/api/typescript.html and https://nodejs.org/api/typescript.html).

## 2. Node built-in type stripping

### Version history

From the history table at https://nodejs.org/api/typescript.html (v26.13.1 docs):

| Version | Change |
|---|---|
| v22.6.0 | Added (behind `--experimental-strip-types`) |
| v22.7.0 | Added `--experimental-transform-types` |
| v23.6.0, v22.18.0 | Type stripping enabled by default |
| v24.3.0, v22.18.0 | No longer emits an experimental warning |
| v25.2.0, v24.12.0 | Type stripping is stable |
| v26.0.0 | Removed `--experimental-transform-types` |

- Flag names: from Node 24.12 / 25.2 the opt-out flag is `--no-strip-types`; the Node 22 docs still use `--no-experimental-strip-types` (https://nodejs.org/docs/latest-v22.x/api/typescript.html).
- Node 22.18.0 was released 2025-07-31. Its release notes call the feature "experimental and subject to change" while also removing the runtime warning (PR 56350): https://nodejs.org/en/blog/release/v22.18.0.
- Stability: Node 22 docs say "Stability: 1.2 - Release candidate" (https://nodejs.org/docs/latest-v22.x/api/typescript.html). Node 26 docs say "Stability: 2 - Stable" (https://nodejs.org/api/typescript.html).
- Floor with no flag, no warning, and "stable" label: **22.x never gets the stable label**; **24.12.0** does; Node 26 any release.
- OBSERVED on v24.11.1: `node main.ts` runs with no flag and prints no ExperimentalWarning. `node --experimental-transform-types enum.ts` on 24.11.1 prints "ExperimentalWarning: Transform Types is an experimental feature".

### Refused syntax and the transform flag

- Docs (https://nodejs.org/api/typescript.html): features that replace TypeScript with new JavaScript error. Listed: `enum` declarations, `namespace` with runtime code, parameter properties, import aliases. Type-only namespaces work. Decorators produce a parser error.
- OBSERVED on 24.11.1: `enum`, parameter property and runtime `namespace` each fail with an uncaught SyntaxError at the file.
- Node 22 and 24: `--experimental-transform-types` handles those (https://nodejs.org/docs/latest-v22.x/api/typescript.html; OBSERVED on 24.11.1: enum ran and printed 0). Node 26: flag removed, and the 26 page offers no built-in alternative, pointing to `tsx` instead.
- `type` modifiers are required on type-only imports or the import is treated as a value import and fails at runtime (https://nodejs.org/api/typescript.html). OBSERVED: `import { x, T } from "./lib.ts"` fails with "does not provide an export named 'T'".

### Extensions, node_modules, tsconfig, paths

- Extensions are mandatory in `import` and `require()`: write `./file.ts` (https://nodejs.org/api/typescript.html). OBSERVED: `import "./lib"` fails with ERR_MODULE_NOT_FOUND.
- Node refuses TypeScript files under `node_modules` (https://nodejs.org/api/typescript.html). OBSERVED: ERR_UNSUPPORTED_NODE_MODULES_TYPE_STRIPPING.
- Node ignores `tsconfig.json`. `paths` produces an error; the nearest alternative is subpath imports starting with `#` (https://nodejs.org/api/typescript.html). The v22 page says "does not read tsconfig.json" (https://nodejs.org/docs/latest-v22.x/api/typescript.html).
- Recommended tsconfig on the Node page (TypeScript 5.8 or newer): `noEmit` (optional), `target: esnext`, `module: nodenext`, `rewriteRelativeImportExtensions: true`, `erasableSyntaxOnly: true`, `verbatimModuleSyntax: true`.
- The parser needs WebAssembly (ERR_WEBASSEMBLY_NOT_SUPPORTED otherwise). Type stripping does not work in the REPL, `--check` or `inspect`. No source maps are generated, since types become whitespace (https://nodejs.org/api/typescript.html).
- `.tsx` files are unsupported.

### ESM versus CommonJS for `.ts`

- Per https://nodejs.org/api/typescript.html: `.ts` follows the same rules as `.js` (nearest `package.json` `"type"`); `.mts` is always ESM; `.cts` is always CommonJS. Node will not convert between module systems.

### `require()` of a `.ts` file

- The Node page states extensions are mandatory in `require()` calls and gives `require('./file.ts')` as the form (https://nodejs.org/api/typescript.html).
- `require()` of ESM: unflagged in Node 22.12.0 and 23.0.0, warning removed in 22.13.0 (https://nodejs.org/docs/latest-v22.x/api/modules.html). The Node 22 modules page still labels it "Stability 1.2 - Release candidate". The module must have no top-level `await`.
- OBSERVED on 24.11.1: a CommonJS `.js` test doing `require("../esm/lib.ts")` (ESM `.ts` under a nested `"type":"module"`) works and prints no warning, even with `--trace-warnings`.

### `node --test` discovery

- With no arguments, `node --test` matches the six JS patterns (`**/*.test.{cjs,mjs,js}`, `**/*-test.…`, `**/*_test.…`, `**/test-*.…`, `**/test.…`, `**/test/**/*.…`) and, "unless `--no-strip-types` is supplied", the same six patterns with `{cts,mts,ts}` (https://nodejs.org/docs/latest-v24.x/api/test.html). The Node 22 docs list the same, gated on `--no-experimental-strip-types` (https://nodejs.org/docs/latest-v22.x/api/test.html).
- Origin: PR 55081 "test_runner: support typescript files in default glob", merged 2024-09-29 (https://github.com/nodejs/node/pull/55081). **UNVERIFIED:** the exact 22.x patch release that first included it. The PR page does not state it, and the 22.18.0 release notes list no test-runner TypeScript item (https://nodejs.org/en/blog/release/v22.18.0). The v22.23.5 docs do contain it.
- OBSERVED on 24.11.1: bare `node --test` found and ran `test/a.test.ts`.
- Relevant to this repo: `test:unit` currently runs `node --test test/unit/` (an explicit directory). A directory argument was not tested with `.ts` files (see Open questions).

## 3. TypeScript compiler options that pair with type stripping

### Versions and status

- Current stable: **TypeScript 7.0.2**, npm `latest`, published 2026-07-08 (https://registry.npmjs.org/typescript). Announcement: 7.0 on 2026-07-08, a "10x faster native port" written in Go (https://devblogs.microsoft.com/typescript/announcing-typescript-7-0/).
- 7.1 Beta published 2026-10-20 (npm tag `beta`: 7.1.0-beta). RC "in about a month" after the beta, no dates (https://devblogs.microsoft.com/typescript/announcing-typescript-7-1-beta/).
- TypeScript 6.0 shipped 2026-03-23 and is "the last release based on the current JavaScript codebase". Latest 6.0.x: 6.0.3 (2026-04-16). Source: https://devblogs.microsoft.com/typescript/announcing-typescript-6-0/ and https://registry.npmjs.org/typescript.
- The `typescript@7.0.2` npm package has `bin: tsc`, `engines.node >=16.20.0`, and `exports` of `"."` pointing at `./lib/version.cjs` plus `./unstable/*` entries (https://registry.npmjs.org/typescript/7.0.2). It has no `main`. It ships a native binary per platform as optional dependencies.
- 7.0 "does not ship with an API"; 7.1 is expected to include "a new (and different) API"; the `@typescript/typescript6` package "re-exports the TypeScript 6.0 API" for tools like typescript-eslint (https://devblogs.microsoft.com/typescript/announcing-typescript-7-0/). `@typescript/typescript6` latest is 6.0.2 with bin `tsc6` (https://registry.npmjs.org/@typescript%2Ftypescript6).
- The 7.1 beta post lists new API entry points (`typescript/sync`, `typescript/async`, `typescript/ast`, and others), while the 7.0.2 package exports use `unstable/*` paths (https://devblogs.microsoft.com/typescript/announcing-typescript-7-1-beta/ versus the 7.0.2 registry entry). The final 7.1 shape is not settled.

### TypeScript 6.0 and 7.0 default changes (relevant to tsconfig authoring)

From https://devblogs.microsoft.com/typescript/announcing-typescript-6-0/ and https://devblogs.microsoft.com/typescript/announcing-typescript-7-0/:

- `strict` defaults to `true`.
- `module` defaults to `esnext`. `target` defaults to the current-year ES version (`es2025` in 6.0).
- `types` defaults to `[]` (set `["node"]` explicitly; `["*"]` restores the old behaviour).
- `rootDir` defaults to the folder holding the tsconfig.
- `noUncheckedSideEffectImports` defaults to `true`. `libReplacement` defaults to `false`.
- Removed or erroring: `target: es5`, `downlevelIteration`, `moduleResolution: node/node10/classic`, `module: amd/umd/systemjs/none`, `baseUrl`, `outFile`, `esModuleInterop: false`, `alwaysStrict: false`. `outFile` removal is in the 6.0 post.
- Passing file names on the command line with a `tsconfig.json` present is error TS5112 unless `--ignoreConfig`.
- `--builders` (parallel project-reference builders) exists in 7.0; `--checkers` multiplies with it.

### Individual options

| Option | Fact | Source |
|---|---|---|
| `erasableSyntaxOnly` | Introduced in TypeScript 5.8. Errors on `enum`, runtime namespaces/modules, parameter properties, `import =` / `export =`, and `<T>x` angle-bracket assertions | https://devblogs.microsoft.com/typescript/announcing-typescript-5-8/ and https://www.typescriptlang.org/tsconfig/ (5.8.3 published 2025-04-05 per registry) |
| `verbatimModuleSyntax` | Released 5.0. Imports/exports without `type` modifier are kept; with it, dropped. Makes `isolatedModules` default to true | https://www.typescriptlang.org/tsconfig/ |
| `allowImportingTsExtensions` | Released 5.0. Allowed only with `noEmit` or `emitDeclarationOnly`. Defaults to true if `rewriteRelativeImportExtensions` is set | https://www.typescriptlang.org/tsconfig/ |
| `rewriteRelativeImportExtensions` | Released 5.7. Rewrites relative `.ts/.tsx/.mts/.cts` specifiers to JS equivalents in emit. Does not rewrite bare specifiers, `paths`, `#` subpath imports, or computed dynamic imports | https://devblogs.microsoft.com/typescript/announcing-typescript-5-7/ |
| `noEmit` | Released 1.5. Writes no output | https://www.typescriptlang.org/tsconfig/ |
| `module: nodenext` | Under it, TypeScript does not error on `require()` of ESM from CommonJS (Node 22 allows it) | https://devblogs.microsoft.com/typescript/announcing-typescript-5-8/ |
| `isolatedModules` | Released 1.5. Defaults to true when `verbatimModuleSyntax` is on | https://www.typescriptlang.org/tsconfig/ |
| `isolatedDeclarations` | Released 5.5. Requires annotations on exports so other tools can generate `.d.ts` | https://www.typescriptlang.org/tsconfig/ |
| `checkJs` | Released 2.3. Reports errors in JS files; works with `allowJs` | https://www.typescriptlang.org/tsconfig/ |
| `composite` | Released 3.0. Requires every implementation file to match `include`/`files`; defaults `declaration` to true; `rootDir` defaults to the tsconfig folder | https://www.typescriptlang.org/tsconfig/ and https://www.typescriptlang.org/docs/handbook/project-references.html |

The Node page's recommended `erasableSyntaxOnly` config means TypeScript 5.8 is the minimum for the pairing (https://nodejs.org/api/typescript.html).

## 4. Strictness flags beyond `strict`

Source: https://www.typescriptlang.org/tsconfig/ (Type Checking section; "Released" is the version column from that page).

Inside `strict` (all on when `strict` is true, `strict` defaults to true from 6.0): `alwaysStrict` (2.1), `noImplicitAny` (1.0), `noImplicitThis` (2.0), `strictNullChecks` (2.0), `strictBindCallApply` (3.2), `strictBuiltinIteratorReturn` (5.6), `strictFunctionTypes` (2.6), `strictPropertyInitialization` (2.7), `useUnknownInCatchVariables` (4.4).

Not in `strict`, must be set by hand:

| Option | Released | What it does |
|---|---|---|
| `noUncheckedIndexedAccess` | 4.1 | Adds `undefined` to index-signature reads |
| `exactOptionalPropertyTypes` | 4.4 | `prop?: T` rejects explicit `undefined` |
| `noImplicitOverride` | 4.3 | Requires `override` keyword |
| `noPropertyAccessFromIndexSignature` | 4.2 | Requires bracket access for index-signature keys |
| `noFallthroughCasesInSwitch` | 1.8 | Errors on non-empty case fallthrough |
| `noImplicitReturns` | 1.8 | Every code path must return |
| `noUnusedLocals` | 2.0 | Errors on unused locals |
| `noUnusedParameters` | 2.0 | Errors on unused parameters (names starting `_` exempt) |
| `allowUnreachableCode` | 1.8 | `false` makes unreachable code an error (default `undefined` = editor hint only) |
| `allowUnusedLabels` | 1.8 | `false` makes unused labels an error |

Other related options: `isolatedModules` (1.5), `isolatedDeclarations` (5.5), `checkJs` (2.3), `libReplacement` (introduced in 5.8 per the 5.8 post; default false from 6.0), `noUncheckedSideEffectImports` (default true from 6.0). `noUncheckedSideEffectImports` and `allowUnreachableCode` descriptions were not on the fetched page section; the defaults come from the 6.0 post. The release version of `noUncheckedSideEffectImports` (5.6) is UNVERIFIED from a primary source here.

## 5. What `tsc` cannot ban, and what covers it

| Thing to ban | tsc alone? | Rule or approach | Needs type info? | Source |
|---|---|---|---|---|
| Explicit `any` | No | `@typescript-eslint/no-explicit-any` (recommended set) | No | https://typescript-eslint.io/rules/ |
| Implicit/leaked `any` use | Partly (`noImplicitAny`) | `no-unsafe-assignment`, `no-unsafe-call`, `no-unsafe-member-access`, `no-unsafe-return`, `no-unsafe-argument` (all recommended-type-checked) | Yes | https://typescript-eslint.io/rules/ |
| `@ts-ignore`, `@ts-nocheck`, `@ts-expect-error` | No | `ban-ts-comment`. Defaults: `ts-ignore` and `ts-nocheck` reported, `ts-expect-error` allowed with description, `ts-check` allowed. Recommended config min description 3 chars; strict raises to 10 | No | https://typescript-eslint.io/rules/ban-ts-comment/ |
| `as` and `<T>x` casts | No | `consistent-type-assertions` with `assertionStyle: 'never'`. `as const` is always allowed by this rule. Whether `as unknown` is blocked under `never`: UNVERIFIED from the page text; it reads as covered since only const assertions are exempted | No | https://typescript-eslint.io/rules/consistent-type-assertions/ |
| Narrowing assertions | No | `no-unsafe-type-assertion` (not in any preset) | Yes | https://typescript-eslint.io/rules/ |
| Non-null `!` | No | `no-non-null-assertion` (strict set), `no-non-null-asserted-optional-chain` (recommended) | No | https://typescript-eslint.io/rules/ |
| Non-exhaustive `switch` | Partly (`noImplicitReturns`, `noFallthroughCasesInSwitch`) | `switch-exhaustiveness-check` (no preset) | Yes | https://typescript-eslint.io/rules/ |
| Folder imports | No | `no-restricted-imports` core rule (no preset) | No | https://typescript-eslint.io/rules/ |
| Comments | No | See below | | |

Needs: ESLint plus typescript-eslint as devDependencies. Type-aware rules require `parserOptions.projectService` or `project` set up. Current versions: ESLint 10.14.0 (latest), 9.39.5 (maintenance); typescript-eslint 8.72.2 (https://registry.npmjs.org/eslint and https://registry.npmjs.org/typescript-eslint). typescript-eslint supports ESLint `^8.57.0 || ^9.0.0 || ^10.0.0`, Node `^18.18.0 || ^20.9.0 || >=21.1.0`, and TypeScript `>=4.8.4 <6.1.0` (https://typescript-eslint.io/users/dependency-versions). It does not support beta releases and RC releases only generally. Its docs do not mention TypeScript 7.

**Comments.** No ESLint core rule bans all comments. `no-inline-comments` only covers comments on the same line as code (https://eslint.org/docs/v9.x/rules/no-inline-comments). A third-party plugin, `eslint-plugin-no-comments` (rule `no-comments/disallowComments`, latest 1.1.10), disallows all comments except those starting `eslint` or `global` unless `allow` is set; it is lightly maintained (https://npmjs.com/package/eslint-plugin-no-comments). Details of another plugin, `eslint-plugin-no-comment`, are UNVERIFIED. A custom ESLint rule is also possible but not researched.

**Compiler-API script alternative.** I tested this with TypeScript 5.9.3 (the compiler API for comment ranges has been stable for many releases; on 6.0 it should be the same code, UNVERIFIED locally):

- A raw `ts.createScanner(...)` loop over a whole file is NOT reliable. It found 4 of 7 comments in a probe file because the scanner needs parser context for template literals and regex (OBSERVED).
- A walk of the parsed tree, calling both `ts.getLeadingCommentRanges(text, pos)` and `ts.getTrailingCommentRanges(text, pos)` at the full start of every leaf token (`node.getChildren(sourceFile)`), found all 7 comments in the probe: line, block, JSDoc, inline-in-parameters, inside a template expression, inside a type literal, and the final comment. It reported no false positives from `//` inside a template string or a regex literal (OBSERVED). Leading ranges alone missed the trailing and inline ones, so both are needed.
- A shebang line was not reported as a comment (OBSERVED).
- On TypeScript 7.0.2 this script cannot run (no JS API in the main package). Options: add `@typescript/typescript6` as the devDependency and import from it, or wait for the 7.1 API (https://devblogs.microsoft.com/typescript/announcing-typescript-7-0/).

## 6. Folder import boundaries

OBSERVED with TypeScript 5.9.3 in `/private/tmp/claude-501/.../scratchpad/refs/` (scratch, three sibling projects `shared`, `node`, `browser`, each `composite`):

- Project that declares `references: [{"path":"../shared"}]` and imports `../shared/s.ts`: builds clean.
- Project with no reference importing `../shared/s.ts`: **fails** with TS6059 ("not under rootDir") and TS6307 ("File ... is not listed within the file list of project ... Projects must list all files or use an 'include' pattern."). Both under `tsc -b` and under `tsc -p browser`.
- Docs behind it: `composite` requires every implementation file to match `include`/`files`, and an importing project loads the referenced project's output `.d.ts` (https://www.typescriptlang.org/docs/handbook/project-references.html). The docs page does not say that importing an unreferenced project's source is an error; the error above is from the experiment, not from that page.
- This enforces the direction of imports between projects. A project cannot import a sibling folder it has not declared as a reference.

`lib` and `types` separation, OBSERVED (TypeScript 5.9.3, `@types/node` 25.0.3 copied from another repo's `node_modules` into the scratch folder):

- Browser-side project (`lib: ["es2023","dom"]`, `types: []`): `import "node:fs"` gives TS2307, and `process` gives TS2591 ("Cannot find name 'process'").
- Node-side project (`lib: ["es2023"]`, `types: ["node"]`): `document` gives TS2584 ("Cannot find name 'document'... change your target library"). `node:fs` and `process` pass.
- The node-side run also printed TS2307 errors for `undici-types` from inside `@types/node`. That is an artifact of copying only the `@types/node` folder without its dependency. Not a finding about real installs.
- So a node project with no `dom` lib and a browser project with `types: []` give real compile-time separation of globals and `node:` modules. In TypeScript 6 and later `types` defaults to `[]` anyway (https://devblogs.microsoft.com/typescript/announcing-typescript-6-0/).
- Caveat: `@types/node` 25.0.3 declares web globals itself (its `web-globals/fetch.d.ts`). Whether `document` or `window` stays rejected in the node project with the real `@types/node` 26.x was seen only as `document` rejected on 25.0.3 (OBSERVED). `window` was not tested.
- Alternatives: `no-restricted-imports` is a core ESLint rule listed in the typescript-eslint rules table (https://typescript-eslint.io/rules/). `eslint-plugin-boundaries` was NOT researched: UNVERIFIED.

## 7. esbuild

- Current version: **0.28.2**, published 2026-08-08 (`engines.node >=18`; native binary per platform as optional dependencies) (https://registry.npmjs.org/esbuild/0.28.2). 0.28.0 was published 2026-04-02. It is a pre-1.0 package, so `^0.28.2` in npm semver only accepts 0.28.x.
- It does not type check: "you will still need to run `tsc -noEmit` in parallel with esbuild to check types" (https://esbuild.github.io/content-types/#typescript). Type checking is on the esbuild FAQ list of features excluded from the roadmap (https://esbuild.github.io/faq/).
- It reads only a small set of tsconfig fields: `experimentalDecorators`, `target`, `useDefineForClassFields`, `baseUrl`, `paths`, JSX fields, `alwaysStrict`, `strict`, `verbatimModuleSyntax`, `extends`. All others are ignored (https://esbuild.github.io/content-types/#typescript). It recommends `isolatedModules`. It does not generate `.d.ts`.
- `format: "iife"` with `bundle` and `globalName` is documented: `iife` is "intended to be run in the browser", is the default when bundling for the browser platform, and `globalName` "only matters when the format setting is `iife`" (https://esbuild.github.io/api/). Legal comments (`@license`, `@preserve`, `//!`, `/*!`) are kept by default: `eof` when bundling (https://esbuild.github.io/api/). This matters if the repo bans comments in source.
- Determinism: the esbuild FAQ says the author did "additional work to ensure that esbuild's published builds are completely reproducible", which is about the published binaries, not about bundle output (https://esbuild.github.io/faq/). **UNVERIFIED:** any official promise that bundle output is byte-identical across runs and platforms. A web search found no such promise, and found a changelog entry about a past nondeterminism bug (CSS colour math differing on ppc64le/s390x, fixed by forcing float64 casts), and earlier fixes for symlink and `index.js` directory naming. The same esbuild version on x64 and arm64 macOS and Linux is the case that matters here; I did not run a build to compare. A byte-comparison of two builds is a cheap check for the plan (the repo already has `check:layer`, which diffs the committed bundle).
- `outFile` in tsc: removed in TypeScript 6.0 (https://devblogs.microsoft.com/typescript/announcing-typescript-6-0/). The historic AMD/System-only behaviour is gone. tsc cannot produce a browser bundle in 6.0+ or 7.

## 8. `@types/node` versus the Node floor

- npm dist-tags (https://registry.npmjs.org/@types/node): `latest` = 26.6.6 (published 2026-10-28); `old-version` = 24.19.2 (2026-10-09).
- Newest published per line (same registry document): 20.19.43, 22.20.5, 24.19.2, 26.6.6.
- Match the major to the Node floor: `@types/node@22` for a floor of 22, `@types/node@24` for 24. `@types/node` 26.6.6 declares `undici-types ~8.9.0` as a dependency.
- `@types/node` 26.6.6 has `typesVersions` entries for TypeScript `<=5.6` and `<=5.7` (https://registry.npmjs.org/@types/node/26.6.6).
- TypeScript 5.7 notes say Buffer/ArrayBufferLike type errors after the `es2024` lib change may need an `@types/node` update (https://devblogs.microsoft.com/typescript/announcing-typescript-5-7/).

## 9. Mixed module format (package.json has no `"type"`; code is CommonJS `.js`)

All of this is OBSERVED on Node v24.11.1 and TypeScript 5.9.3 in `.../scratchpad/mix/`.

**(a) How Node 24 decides the format of an ESM-syntax `.ts` file.**
- Docs: `.ts` follows the same rules as `.js` (nearest `package.json` `"type"`) (https://nodejs.org/api/typescript.html).
- In a package with no `"type"`, a `.ts` file with `export` still ran (syntax detection), but Node printed `[MODULE_TYPELESS_PACKAGE_JSON] Warning: Module type of file:///.../src/nopkg.ts is not specified and it doesn't parse as CommonJS. Reparsing as ES module because module syntax was detected. This incurs a performance overhead.` The warning tells you to add `"type": "module"`.
- A nested `package.json` containing `{"type":"module"}` in the new folder: the `.ts` file ran with no warning. The root `package.json` stays typeless, so the existing CommonJS `.js` files are untouched.
- `.mts` and `.cts` are format-fixed regardless of `package.json` (https://nodejs.org/api/typescript.html).

**(b) tsc with `module: nodenext` and `verbatimModuleSyntax` on a typeless package.**
- `export const x: number = 1;` in a typeless package: **TS1287** "A top-level 'export' modifier cannot be used on value declarations in a CommonJS module when 'verbatimModuleSyntax' is enabled."
- `import { x } from "./nopkg.ts";` in a typeless package: **TS1295** "ECMAScript imports and exports cannot be written in a CommonJS file under 'verbatimModuleSyntax'. Adjust the 'type' field in the nearest 'package.json'..." (not TS1286).
- The same files in a folder with a nested `{"type":"module"}`: no errors. So the nested package.json fixes it for tsc as well as Node.

**(c) CommonJS `.js` test requiring an ESM `.ts` file on Node 24.**
- `require("../esm/lib.ts")` from a `.js` file: works, warning-free, returned the export (`x` = 1). `require("../src/nopkg.ts")` of a typeless-package ESM `.ts` also returned the value, with no extra warning shown.
- Requirement: no top-level `await` in the required file (https://nodejs.org/docs/latest-v22.x/api/modules.html).
- On Node 22: `require(esm)` is unflagged from 22.12.0 and warning-free from 22.13.0 (same page). Combined with type stripping default from 22.18.0, a floor of 22.18.0 makes this work; I did not run Node 22 (not installed). UNVERIFIED on a real 22.x.

**(d) ESM `.ts` importing a CommonJS `.js` file.**
- Default import works at runtime and in tsc. With `allowJs`, tsc types the default import as the shape of `module.exports` (probe error text: type `{ cj: number; fn(a: any): any; }`), and a CJS function parameter without annotation is `any`.
- Named import `import { cj } from "../src/legacy.js"` where `legacy.js` does `module.exports = { cj: 7, fn(a){...} }`: **tsc accepted it, but Node 24 refused it at runtime**: "SyntaxError: Named export 'cj' not found. The requested module '../src/legacy.js' is a CommonJS module, which may not support all module.exports as named exports." This is a place where the two tools disagree. The workaround Node suggests is a default import and destructuring.
- Without `allowJs`, an import of a `.js` CommonJS file gives **TS7016** "Could not find a declaration file for module ... implicitly has an 'any' type" under `strict`.
- Note: `checkJs` was not on in my test, so the JS file itself was not type checked.

## 10. Project references and TS6307

- OBSERVED (TypeScript 5.9.3, `tsc -b` and `tsc -p`): a `composite` project that imports a file outside its `include` and without a declared reference fails with TS6307 ("File ... is not listed within the file list of project ... Projects must list all files or use an 'include' pattern.") plus TS6059 when the file is outside `rootDir`. With a declared `references` entry, the same import builds clean. Details in section 6.
- Docs: the `composite` entry requires every implementation file to be matched by `include` or `files` and says tsc will report which files are not specified (https://www.typescriptlang.org/tsconfig/ and https://www.typescriptlang.org/docs/handbook/project-references.html). The docs do not print the code TS6307.
- Not tested: TypeScript 6 or 7 behaviour for the same case. The 7.0 post mentions `--builders` for parallel project-reference builds, so project references exist in 7.0 (https://devblogs.microsoft.com/typescript/announcing-typescript-7-0/); whether TS6307 text is unchanged is UNVERIFIED.
- Also OBSERVED: with `composite` the setup needs `declaration` and, if `.ts` import specifiers are used, `emitDeclarationOnly` (or `noEmit`, which `composite` does not allow alongside declaration emit in my config) for `allowImportingTsExtensions`; I used `emitDeclarationOnly: true` plus `rewriteRelativeImportExtensions: true`.

## Experiments run

All in `/private/tmp/claude-501/-Users-kennethstclair-Documents-workspace-live-agentic-html-editor/21a4d883-ad54-478a-848f-e7cd1494e537/scratchpad/` (`ts1/`, `mix/`, `refs/`). Leave in place; nothing under the repo was changed except this file. TypeScript 5.9.3 invoked as `node .../tricorder-readout-verdicts/readout/node_modules/typescript/bin/tsc`. Node invoked as `~/.nvm/versions/node/v24.11.1/bin/node`.

## Open questions

- The first 22.x patch release where `node --test` discovers `.ts` files. Needs the Node 22 changelog or a run on a 22.18+ binary.
- `node --test test/unit/` (directory argument, as `npm run test:unit` uses) with `.ts` files inside: not run.
- Node 22.18+ behaviour was not run locally (not installed). Everything marked OBSERVED on Node was on 24.11.1.
- TypeScript 6.0.x and 7.0.x behaviour for sections 6, 9 and 10 was not run; the experiments used 5.9.3. The 6.0 post lists no change to those diagnostics, but I did not search for it.
- Whether `typescript-eslint` can be pointed at `@typescript/typescript6` (npm alias) while `typescript@7` provides `tsc`: not researched. UNVERIFIED.
- `eslint-plugin-boundaries` not researched.
- esbuild byte-level determinism across platforms: no primary-source promise found; not measured.
- The exact release in which `noUncheckedSideEffectImports` landed.

## Files read

- `/Users/kennethstclair/.claude/skills/feature-forge/references/roles/researcher.md`
- `/Users/kennethstclair/.claude/skills/feature-forge/references/principles.md`
- `/Users/kennethstclair/Documents/workspace/live-agentic-html-editor/package.json` (first 50 lines)
- Web pages and registry entries cited inline above.
