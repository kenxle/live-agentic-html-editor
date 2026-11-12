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
2. The plan served to Ken as a Lahe page. Do not wait for confirmation to
   begin. Load the lahe skill before running any `lahe` command.
3. A slice list builders can pick up. Each slice should be one pull request that
   leaves main working, with its owner files, its model, its gate, and the
   evidence that proves it is done.

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
- Use every strict feature the language and its tools offer. His reason:
  agents write better code that way. In practice:
  - real `.ts` files in `strict` mode, not type comments on plain `.js`;
  - every stricter compiler flag on top of `strict`;
  - no escape hatches: the gate rejects `any`, `@ts-ignore` and unchecked `as`
    casts;
  - every switch on a state or kind handles every case, so a new state that
    some code ignores fails the build;
  - the compiler enforces folder boundaries, so the browser layer cannot import
    helper code;
  - `tsc` runs inside `npm run gate:unit`.
  Where a strict rule cannot be turned on yet, the plan names it and the slice
  that turns it on.
- Raise the Node minimum from 18.2 to a Node release line that is not past end
  of life and also runs `.ts` files directly. Node 18 and 20 are already past
  end of life. Node 22 is believed to reach end of life in April 2027, which
  would make 24 the lowest safe choice. Check both against the official Node
  release schedule and pick the lowest line that meets both conditions. Ken's
  Mac runs 20.19 today (`.nvmrc` says 20.19.0), so the `.nvmrc` and his machine
  both move up.
- This is a restructure as well as a change of language. Ken: "refactor this
  into proper best practice for code structure. use correct names."
  - **Structure.** Propose the folder and module layout an experienced
    TypeScript team would choose for a local server, a browser client, a CLI and
    the contract between them. The current folders are not a constraint. The
    new layout replaces `docs/diagrams/module_map.md`, and the compiler enforces
    it.
  - **Names.** Call things what they are in standard terms. Ken: "if it's a
    server, don't call it a helper." That covers folders, files, modules, types
    and functions. User-facing wording follows
    [docs/ongoing/BRAND.md](../../ongoing/BRAND.md), which uses "helper" today.
    Whether that wording changes too is Ken's call, so list it as a question
    on the plan page and keep working.
  - **No comments in code.** Ken: "refuse comments. move them into
    documentation." What a comment explains today (the why, the history, the
    traps) moves into the docs under `docs/ongoing/` and `docs/diagrams/`. Types
    and names carry the rest. The gate should reject new comments. One known
    conflict to settle on the plan page: Ken's global rules ask every source file
    to start with a short `read-when` header comment. Propose an answer, such as
    keeping only that header or moving the routing into a doc index.
  - **The comment-sicko reviewer** (the `pstack:comment-sicko` agent) reviews
    every slice for comments that slipped through and for code that works around
    a problem instead of fixing it. Give it its own review slot in each
    checkpoint.

**Recommended in the chat, not yet ruled on by Ken.** Confirm these or argue
against them in the plan:

- The helper runs its `.ts` files directly with Node's built-in type stripping,
  so the helper keeps no build step. Verify the limits before planning around
  it: only syntax that can be erased (no `enum`, no `namespace`), and imports
  that name the `.ts` extension.
- Order: `src/shared` first, then the helper, then the browser layer.

## The codebase you are planning for

Line counts from `wc -l` over each folder's `.js` files on 2026-11-12:

| Folder | Lines | What it is |
| --- | --- | --- |
| `src/layer` | 47,909 | The browser review layer |
| `src/service` | 23,579 | The helper's HTTP service, store and rendering |
| `src/shared` | 12,493 | Code both the helper and the browser run: record shapes, the protocol, item states, and logic both sides must agree on |
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
2. **What `src/shared` becomes.** It is more than an interface. It mixes three
   kinds of code:
   - the contract between helper and browser: record shapes (`record.js`), the
     wire protocol (`protocol.js`), item states (`lifecycle.js`) and failure
     codes (`failures.js`);
   - logic both sides run and must agree on, such as text normalizing
     (`normalize.js`), merging (`merge.js`) and the anchor-safety rule
     (`uniqueness.js`);
   - files that only one side or only the tooling uses, such as the build
     manifest (`manifest.js`) and test fixtures (`record_fixtures.js`).

   Much of its size is hand-written validation and long comments. Comments
   are 38 to 40 percent of the lines in `record.js` and `protocol.js` (counted
   by matching comment markers at the start of a line), and in TypeScript much
   of that checking becomes types. Ken finds the name `shared` unclear. The
   plan should decide whether the contract becomes its own clearly named module
   of types, which logic stays shared, and where the one-sided files move. It
   should also say how a `.ts` file there reaches both Node and the bundle.
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
