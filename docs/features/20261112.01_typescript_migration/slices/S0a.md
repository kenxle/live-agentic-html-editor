---
read-when: Reviewing or merging slice S0a (the Node 24.12 floor) of the TypeScript migration.
---

# S0a: raise the Node floor

## What I read

- Role file `builder.md` and the principles index. Leaves applied: Prove It Works (ran the real guard on Node 18, 20 and 24.11.1, not only the unit test), Test Behavior (tests spawn `bin/lahe.js` and call `install()`), Sequence verifiable units (code commit, then docs commit, then the gate fix).
- The plan's Wave 0 table, the architecture's "Question 4", the repo `CLAUDE.md`.
- No documents table was found in the project's CLAUDE.md; I used the docs it names directly.

## Outcome

The floor is Node 24.12.0 everywhere in the repo's owned files. An older Node gets a message and exit code 1. install-cli refuses an older Node. Docs agree.

## Commits (branch `ts/s0a-node-floor`)

- `b4fc5262` Raise the floor and add the guard (code and tests)
- `1b1b8cbf` Docs say 24.12; CLAUDE.md contract paragraph fixed
- a third commit: the `test:unit` script fix described below, and this file

## Changed files and proof

- `bin/node_floor.js` (new, plain ES5): parse, compare, messages. Shared by `bin/lahe.js` and `scripts/install-cli.js`.
- `bin/lahe.js`: runs the check first, main run guarded by `require.main === module`. Name, shebang and `package.json` `bin` unchanged (`add_command.test.js` still passes).
- `scripts/install-cli.js`: refuses below the floor before writing; `install()` takes a `nodeVersion` option for the test.
- `package.json` `engines.node` is `>=24.12.0`; `.nvmrc` is `24.22.3`; `gate.yml` is `node-version: 24`, comment fixed.
- `src/shared/failures.js`: `CLI_RUNTIME_MISSING` message now says 24.12; see deviations.
- Docs: `README.md` (badge and text), `docs/INSTALL.md`, `docs/UPGRADING.md` (new section), `docs/ongoing/TESTING.md`, `docs/ongoing/ARCHITECTURE.md`, `skills/verify-lahe/SKILL.md`, `CLAUDE.md` (Node section and the "Agent-facing docs" paragraph).
- `test/unit/node_floor.test.js` (new, 12 tests): below, equal and above the floor; malformed strings; message content; `bin/lahe.js` on a pretended Node 20 (a `--require` preload overrides `process.versions`), nothing on stdout; install-cli refusing and proceeding; package.json, `.nvmrc` and CI agree.

Proof:

- Red first: the new tests failed before the change (install-cli returned 0, config disagreed).
- `npm run gate:unit` on Node 24.22.3: lint passed; unit `tests 3221, pass 3214, fail 0, skipped 5, todo 2`. The 5 skips are the menu bar app tests ("set LAHE_MENUBAR_APP"), not Node related.
- Real guard on old Node, `/Users/kennethstclair/.nvm/versions/node/v20.19.0/bin/node <worktree>/bin/lahe.js status`:

```
lahe: Lahe needs Node 24.12 or newer, and this is Node 20.19.0. Install Node 24, then run `npm run install-cli` and `lahe install` in /Users/kennethstclair/Documents/workspace/live-agentic-html-editor/.claude/worktrees/ts-s0a.
exit=1
```

  Node 18.20.8 and 24.11.1 print the same message with their own version and exit 1.
- Leftover helpers, `ps -axo command | grep -c "[l]ahe.js serve"`: 1 before, 1 after. The one is not from my runs (it was running before I started; `no_stray_helpers` also reported none from this run).

## Deviations and surprises

- **The worktree disappeared mid-task** (disk-full incident). The branch survived; I re-added the worktree at the same path with `git worktree add` and re-ran `npm install` (lockfile restored). No work was lost because nothing was uncommitted. Main had advanced by one progress commit, so the branch is based on `14b71706` and not on `0feebbac`; docs only, no overlap.
- **A real Node-change failure: `node --test test/unit/` does not work on Node 24.** Node 22 and later no longer take a directory as a test path (`MODULE_NOT_FOUND`), which made `npm run test:unit` fail at once. I changed the `test:unit` script in `package.json` to `node --test "test/unit/*.test.js"` (every file in `test/unit/` is flat and ends in `.test.js`) and the matching line in `docs/ongoing/TESTING.md`. This touches `package.json` outside `engines`, which the contract did not list; it is the "fails only because of the Node change" case. The orchestrator should know that `test:browser` and other scripts were not affected as far as the unit gate shows.
- `CLI_RUNTIME_MISSING` has two strings; I changed both ("required" and its "Install Node ... then run the add step again" fix line), since leaving the second on 20 would contradict the first.
- The skill line in `skills/verify-lahe/SKILL.md` is not pinned by any test (grepped `test/`).
- I did not touch `Node 18.2` code comments (`src/service/index.js:566`, `scripts/compact_draft_history.js:383`), per instruction. The example in a header comment of `scripts/no_stray_helpers.js` still shows `node --test test/unit/` (not owned).
- The `.nvmrc` change means `docs/BULLETIN.md` entries that mention Node 20.19.0 are history and left alone.

## Not done by me (by contract)

Installing Node 24.22.3 as the shell default, `npm run install-cli`, `lahe install` and the Stop hook on Ken's Mac, and touching `~/.local/bin/lahe`: the orchestrator does these after merge.

## Follow-ups

- `skills/verify-lahe/references/cloud.md` mentions Linux Node 22 for a past cloud run; that is a historical record and the cloud environment will need Node 24 before the next run.
- Any other script that passes a directory to `node --test` would break the same way on Node 24; I found only `test:unit`.

## Cleanup needed

None. Files made outside the repo for scratch are only under the session scratchpad and `/tmp`.
