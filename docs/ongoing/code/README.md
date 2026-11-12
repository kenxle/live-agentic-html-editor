---
read-when: Adding or converting a .ts file, adding a folder to the TypeScript build, or when tsc or ESLint fails in npm run lint.
not-for: Why one source folder's code works the way it does; see that folder's doc beside this one, such as server-sites.md.
---

# The TypeScript build and its rules

Lahe is moving from JavaScript to strict TypeScript in slices; the [plan](../../features/20261112.01_typescript_migration/02_plan_typescript_migration.md) lists them and the [target layout](../../features/20261112.01_typescript_migration/parts/target_layout.md) says where every file goes. This page says how the build is set up while the move is under way, and what to do when you add to it.

This folder also holds one doc per source folder (`server-sites.md` for `src/server/sites/`, and so on). Source files carry no comments except their `read-when` header, so the why, the traps and the history live in those docs.

## What runs

`npm run lint` runs three things, and `gate:unit` runs `lint` first:

1. `node scripts/lint.js`: syntax of every `.js` file, duplicate declarations, Lua, no jsdom, manifest completeness, and kebab-case `.ts` names under `src/`.
2. `tsc -b`: the compiler, over every project below.
3. `eslint --max-warnings 0`: the rules below, over every `.ts` and `.mts` file. A warning fails it too.

All three need the dev dependencies, so a fresh clone or worktree runs `npm install` first.

The server and the CLI run their `.ts` files directly on Node 24.12 or newer, which strips the types. Nothing is compiled for them. So only syntax Node can erase is allowed (no `enum`, no runtime `namespace`, no parameter properties), and imports name the `.ts` extension.

## The projects

Each folder is its own TypeScript project, and a project can import only the projects it lists as references. An import outside them fails with TS6307. The browser projects have the DOM and no Node types; the server and CLI have Node's types and no DOM; `contract` and `domain` have neither.

| Project | `lib` | `types` | May import |
| --- | --- | --- | --- |
| `src/contract` | es2024 | none | nothing |
| `src/domain` | es2024 | none | contract |
| `src/server` | es2024 | node | contract, domain |
| `src/cli` | es2024 | node | contract, domain, server |
| `src/browser/review-layer` | es2024, dom | none | contract, domain |
| `src/browser/library-page` | es2024, dom | none | contract, domain |
| `test/unit` | es2024 | node | every `src` project |
| `scripts` | es2024 | node | nothing (its `.mts` files and `eslint-rules/`) |

Every project's `tsconfig.json` extends `tsconfig.base.json` and sets only `lib`, `types` and `outDir`. The root `tsconfig.json` lists every project. `test/unit/strictness_gate.test.js` fails if a project sets anything else, because that could turn a strict flag off for one folder.

**Every project keeps `"files": []` beside its `include`. Never remove it.** A project whose `include` matches nothing is an error (TS18003), and several folders have no `.ts` file yet. An explicit `files` list stops that check, and `include` still picks up every `.ts` file the folder gains. So a slice that adds a folder's first file changes no config: the folder is already built, and its references are already in place.

**Projects write declarations, not nothing.** The architecture asked for `noEmit`, but tsc refuses it for a project another project references (TS6310). Each project writes `.d.ts` files and its build info into `.tsbuild/<folder>/`, which git ignores. `noEmitOnError` keeps a failing build from writing a stray `.d.ts` beside the source. The build info also makes a second `tsc -b` with nothing changed much faster.

### Adding a folder

1. Add its `tsconfig.json`: extend the base, set `lib`, `types` and `outDir` (`.tsbuild/` plus the folder's path), keep `"files": []` and `"include": ["**/*.ts"]`, and list the projects it may import as `references`.
2. Add it to the root `tsconfig.json`.
3. Add a `no-restricted-imports` block for it in `eslint.config.mjs`, so a forbidden import also gets a readable message.
4. If it is a new top-level folder, give it a `package.json` holding `{"type": "module"}` (next section).

## ES modules while the root is CommonJS

The root `package.json` has no `"type"` until the finishing slice, so every `.js` file stays CommonJS. A `.ts` file with `import` syntax in such a folder is refused by tsc (TS1295, TS1287) and warned about by Node. So each folder that holds `.ts` files has a `package.json` holding only `{"type": "module"}`: `src/contract`, `src/domain`, `src/server`, `src/browser`, `test/unit/server` and `scripts/eslint-rules`. `src/cli` gets one in the slice that converts it whole.

`scripts/` itself holds CommonJS scripts, so its one TypeScript entry point is `import-layers.mts`; `.mts` is always an ES module.

CommonJS code can `require` a converted module on Node 24 with no warning, as long as the module has no top-level `await` (lint bans it).

## Moving a file

When a `.js` file becomes a `.ts` file somewhere else, its old path keeps a one-line CommonJS forwarder, so callers that are still JavaScript keep working:

```js
module.exports = require("../server/sites/script-line.ts");
```

The forwarder is listed in `FORWARDERS` in `src/shared/manifest.js`. The `.ts` file is not in the manifest: lint's completeness check skips `.ts` files and the `package.json` and `tsconfig.json` files, because the folder owns them. Forwarders are removed in the finishing slice.

A `.ts` file may import only `.ts` files (`lahe/no-js-imports`). To see what you can convert now, run:

```
node scripts/import-layers.mts
```

It prints the unconverted `.js` files under `src/` in layers. Layer 0 imports nothing unconverted. Files in an import cycle print as one group, to convert together.

## The lint rules

`eslint.config.mjs` holds them all. Starting from typescript-eslint's `strict-type-checked` set, it adds:

- no `any`, written or leaked in from `JSON.parse` or a library (`no-explicit-any`, the `no-unsafe-*` rules). Parse `unknown` into a type at the boundary instead;
- no `@ts-` comment directives, no `as` casts (`as const` is fine), no `x!`;
- a `switch` on a union handles every member, and a `default` does not count as handling one;
- names: types in PascalCase, values in camelCase, constants in camelCase or UPPER_CASE. Object keys may also be snake_case or PascalCase, because the wire format and outside APIs set them;
- no default exports, no top-level `await`, no `enum`, no `namespace`, no `require`;
- per folder, no import of a package (Lahe has no runtime dependencies), of `node:` modules outside the server and CLI, or of a folder the table above forbids;
- `lahe/no-comments` and `lahe/no-js-imports`, the two local rules in `scripts/eslint-rules/`;
- `max-lines`, configured but off until each area's split slice turns it on.

Comments that configure ESLint itself (`eslint-disable` and the like) are switched off, so no file can turn a rule off for itself.

### The header

`lahe/no-comments` allows exactly one comment in a `.ts` file, and requires it: this block, first in the file, holding one `read-when` line and, when it applies, one `not-for` line.

```ts
/*
 * read-when: Changing how the lahe script line is found, placed, replaced or removed in an HTML file.
 */
```

The header routes an agent to the file; it never summarizes what the file does. Every other comment is refused.

### Tests in TypeScript

A `.ts` unit test lives under `test/unit/`, in a folder that mirrors its source (`test/unit/server/sites/script-line.test.ts`), and follows every rule above. `npm run test:unit` runs `test/unit/*.test.js` and `test/unit/**/*.test.ts`. A test cannot import a `.js` file either, so build what it needs (a tag, a record) as literal text in the test. `node:test`'s own calls (`test`, `describe`, `before` and the rest) return promises the runner handles, so `no-floating-promises` allows them in test files; any other floating promise is still refused.

### Proving a rule

`test/unit/strictness_gate.test.js` has a fixture for every rule under `test/fixtures/strictness/` and checks the real configuration refuses each one. When you add a rule, add a fixture that breaks it and a row in that test.
