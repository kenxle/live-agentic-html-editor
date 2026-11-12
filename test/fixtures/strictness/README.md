---
read-when: A case in test/unit/strictness_gate.test.js fails, or you are adding a rule to the TypeScript gate.
---

# Strictness fixtures

Each `.ts` file here is written to break one rule of the TypeScript gate. A few trip a second one on the way: the two whose subject is a comment (`eslint-disable-any.ts`, `ts-nocheck.ts`) also trip the comment rule, `exports-var.ts` also trips `no-var`, and `src/cli/imports-browser.ts` is not in an ES module folder yet. The test checks only for the rule each file is there for. The files that break nothing are listed as `CLEAN` in the test: `src/contract/clean-module.ts`, `src/server/imports-contract.ts`, the `plain-value.ts` files the boundary fixtures import, and `test/unit/server/clean.test.ts`. `src/cli/plain-value.ts` is only an import target: `src/cli` is not an ES module folder until the CLI slice, so it does not compile on its own.

The folders mirror the repo (`src/...`, `test/unit/...`), because the folder decides which project, `lib`, `types`, import boundary and lint rules apply.

`test/unit/strictness_gate.test.js` copies the real `tsconfig` files, `package.json` files, ESLint config and local rules into a temporary folder, lays these files over it, and runs `tsc -b` and ESLint there. The clean files get a second temporary folder of their own, because a project holding a refused fixture writes no declarations, so a clean file importing from it would fail too. The table of which file must be refused by which rule or error code lives in that test, and the test fails if a file here is in neither list.

These files are never part of the real build: no project includes `test/fixtures/`, and ESLint ignores it.
