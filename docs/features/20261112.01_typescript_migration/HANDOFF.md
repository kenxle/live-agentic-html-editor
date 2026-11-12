---
read-when: Planning or starting the move of Lahe's source from JavaScript to TypeScript.
---

# Handoff: plan the TypeScript migration

You are the planning agent. Your job is to turn this handoff into a plan that
other agents can build from. You do not convert code yourself.

## What you deliver

1. A plan in this folder, built with the feature-forge route (`/feature-forge`).
   Treat this handoff as the brief. You decide whether the open questions below
   need an architecture document before the plan. Several of them probably do.
2. The plan served to Ken as a Lahe page, so he can mark it up before any
   builder starts. Load the lahe skill before running any `lahe` command.
3. A slice list builders can pick up. Each slice should be one pull request that
   leaves main working, with its owner files, its model, its gate, and the
   evidence that proves it is done.

Builders do not start until Ken approves the plan on the page.

## Why we are doing this

Ken's words: "it's just buggy and hard to maintain. it's gotten beyond what
agents are good at without strict typing and enforced structure."

The goal is a codebase where the compiler and the gate catch mistakes before a
reviewer has to. The measure of success is that an agent cannot easily merge a
wrong record shape, a missed state, or an import across a forbidden boundary.
Converting the syntax is not enough on its own.

## What is decided, and what is only recommended

**Decided by Ken:**

- Migrate to TypeScript.
- Not Rust, for either half. The reasons he accepted:
  - the browser layer has to stay JavaScript or TypeScript;
  - splitting the shared shapes across two languages brings back the
    "two sides disagree" bugs;
  - a Rust helper ends "clone and run" and needs a prebuilt binary for every
    platform.

**Recommended in the chat, not yet ruled on by Ken.** Confirm these or argue
against them in the plan:

- Real `.ts` files in `strict` mode. Type comments on plain `.js` were
  considered and set aside, because an agent can skip writing them.
- No escape hatches: the gate rejects `any`, `@ts-ignore` and unchecked `as`
  casts.
- Every switch on a state or kind handles every case, so a new state that some
  code ignores fails the build.
- The compiler enforces folder boundaries. For example, the browser layer cannot
  import helper code.
- `tsc` runs inside `npm run gate:unit`.
- The helper runs its `.ts` files directly with Node's built-in type stripping,
  so the helper keeps no build step. The belief is that this works without a
  flag from Node 22.18. **Verify that before planning around it**, along with its
  limits: only syntax that can be erased (no `enum`, no `namespace`), and imports
  that name the `.ts` extension.
- Raise the Node minimum from 18.2 to whatever type stripping needs. Node 18 and
  20 are past end of life. Ken's Mac runs 20.19 today (`.nvmrc` says 20.19.0).
- Order: `src/shared` first, then the helper, then the browser layer.

## The codebase you are planning for

Line counts from `wc -l` over each folder's `.js` files on 2026-11-12:

| Folder | Lines | What it is |
| --- | --- | --- |
| `src/layer` | 47,909 | The browser review layer |
| `src/service` | 23,579 | The helper's HTTP service, store and rendering |
| `src/shared` | 12,493 | Record shapes, protocol and rules used by both halves |
| `src/cli` | 8,751 | The `lahe` commands |
| `test/unit` | 67,523 | `node:test` unit tests |

**Where the bugs have been.** I looked at commits since 2026-08-01 whose messages
match "fix", "bug" or "regress" (189 commits) and counted the files under each
folder that they touched. Each file is counted once per commit, so these numbers
are file changes, not commits:

| Folder | File changes |
| --- | --- |
| `src/layer` | 240 |
| `src/service` | 124 |
| `src/shared` | 106 |
| `src/cli` | 40 |

The method is a keyword match on commit messages, so treat the counts as a rough
signal and not as a ranking.

**Structural facts that shape the plan.** Read the files; these lines only tell
you where to look.

- **The browser layer has no module system.** `scripts/build-layer.js`
  concatenates files in the order `src/shared/manifest.js` gives, and each file
  registers on a shared global namespace. Files use the old `var` and
  `function` style.
- **Shared files run in both places.** Files such as `src/shared/record.js` use
  a wrapper that works in both Node and the browser. 43 helper and CLI files and
  23 layer files import from `src/shared`.
- **The manifest is enforced.** `npm run lint` fails unless every file under
  `src/` appears exactly once in `src/shared/manifest.js`. Renaming `.js` to `.ts`
  touches this check. The manifest also assigns one owner to each file, which is
  how parallel builders avoid conflicts.
- **`dist/lahe-layer.js` is committed** and checked by `npm run check:layer`.
- **Not in scope:** `src/service/lahe_render.lua` (the pandoc filter) and
  `macos/menubar/` (Swift) stay as they are.

## Questions the plan has to answer

1. **The browser module system.** Do the layer files become ES modules with a
   real bundler? A dev-only bundler such as esbuild is allowed, because the
   zero-dependency rule covers runtime only. Or does the concatenation stay with
   each file's types stripped? The type checker gets little from code that talks
   through one shared global, so this decides how much "enforced structure" the
   layer actually gets.
2. **Shared code in two runtimes.** How does a `.ts` file in `src/shared` reach
   both Node and the bundle?
3. **How the helper runs.** Node type stripping, or compiled output that is
   committed the way `dist/` is? What does `bin/lahe.js` and the
   `npm run install-cli` wrapper become?
4. **The Node minimum and what it touches:** `engines`, `.nvmrc`, CI, the
   install wrapper, `docs/INSTALL.md`, `docs/UPGRADING.md`, and what an
   existing user on an older Node sees.
5. **How the rules are enforced.** Which rules does `tsc` cover on its own
   (`strict`, `noImplicitAny`, `noUncheckedIndexedAccess`, and so on)? Which need
   a lint step, such as banning an explicit `any`? Is that ESLint as a dev
   dependency, or a check added to `scripts/lint.js`?
6. **Tests.** Do the unit tests become `.ts` too, and when? The Playwright tests?
7. **The mixed period.** While some files are `.ts` and some are `.js`, what does
   the type checker see, and how does the gate stay green after every slice?
8. **Slicing for parallel builders.** Slices should follow manifest ownership so
   two builders never touch the same file. Converting a slice should change no
   behavior. Bugs the types reveal become separate fixes, unless the fix is tiny
   and the plan says so. Keep refactors and behavior changes in separate PRs.

## Rules builders will need, with where they live

Point builders at these documents. Don't restate them.

- [CLAUDE.md](../../../CLAUDE.md) covers:
  - the zero-runtime-dependency rule;
  - the gate table, and which gate a builder runs;
  - "builders never commit `dist/`";
  - "tests leave nothing running";
  - "never remove files while work is running";
  - running the full browser suite locally before any PR push.
- [docs/diagrams/module_map.md](../../diagrams/module_map.md): which folder
  depends on which. This is the boundary map the compiler should enforce.
- [docs/ongoing/ARCHITECTURE.md](../../ongoing/ARCHITECTURE.md): the system's
  shape and where code belongs.
- [docs/CONTRACTS.md](../../CONTRACTS.md): the shapes the helper and the browser
  share. It is the starting point for the types in `src/shared`.
- [docs/ongoing/TESTING.md](../../ongoing/TESTING.md): the test layers.
- The contract text that agents read lives in `src/shared/review_format.js` and
  is copied into the skill, `docs/CONTRACTS.md` and a unit test. A conversion
  must not change that text.

Two rules belong near the top of every builder prompt, because builders have
broken them when the rule appeared only at the end:

- **No `rm`, no `git clean`, no deleting anything.** List files for removal under
  a "To delete at cleanup" heading instead.
- **Builders never stage `dist/`.**

## How Ken wants the work run

- **Priorities**, in order: velocity, dogfooding, security. See "Priorities" in
  [CLAUDE.md](../../../CLAUDE.md). A slice can merge once lint, the bundle check
  and the unit suite pass. The browser suite runs once per checkpoint, by the
  orchestrator.
- **Models:** Sonnet for builders working from a complete slice contract. Opus
  for the plan, the architecture calls, and code review.
- **Reviews:** one review of the integrated diff per checkpoint, not one per
  builder branch. One fix round.
- **Worktrees:** every builder works in its own worktree under
  `.claude/worktrees/`.
- **No time estimates** anywhere in the plan. Say what each slice waits on.
