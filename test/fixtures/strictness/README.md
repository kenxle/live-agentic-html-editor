---
read-when: A case in test/unit/strictness_gate.test.js fails, or you are adding a rule to the TypeScript gate.
---

# Strictness fixtures

Each `.ts` file here breaks exactly one rule of the TypeScript gate, except `src/contract/clean-module.ts`, `src/server/imports-contract.ts` and `src/server/plain-value.ts`, which break none. The folders mirror `src/`, because the folder decides which project, `lib`, `types` and import boundary apply.

`test/unit/strictness_gate.test.js` copies the real `tsconfig` files, `package.json` files, ESLint config and local rules into a temporary folder, lays these files over it, and runs `tsc -b` and ESLint there. The table of which file must be refused by which rule or error code lives in that test.

These files are never part of the real build: no project includes `test/fixtures/`, and ESLint ignores it.
