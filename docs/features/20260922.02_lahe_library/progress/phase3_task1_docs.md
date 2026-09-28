# Phase 3, Tasks 3.1 and 3.4: agent docs, contract, and diagrams

**Summary.** Done on branch `task/lib-docs`, off `feat/lahe_library` at `8b0c544`. The skill, the contract (all three copies), `docs/CONTRACTS.md` and `docs/CLI.md` now teach the Library. Three diagrams are updated and two new ones are added. `npm run gate:unit`: 1587 tests, 1585 pass, 0 fail, 2 todo. The two todos are the older `anchor_cases.test.js` ones. The review-format test proves the contract copies are identical.

Everything was written from the code in this branch: `library.js`, `status.js`, `monitor.js`, `session.js`, `catalog_actions.js`, `catalog_requests.js` and `catalog_reader.js`.

## What was written

- **`skills/lahe/SKILL.md`**
  - A new section, "The Library". It covers these steps:
    - how to open it and attach
    - how to read `catalog_requests`
    - Pick this up, by `kind`
    - Launch, with the `osascript` script
    - `lahe library answer`
    - the never-do list from the brief
  - One line in the drain section: the summary line's `ended_reviews` and `catalog_requests` are work too.
  - One paragraph after the monitor exit codes: one monitor can watch several sessions.
  - "Open the lahe library" is added as a trigger, in the description and in "When you use it".
  - "Taking the tool back out" now says the helper stays up while the Library polls or a review page is open.
- **The contract** (`src/shared/review_format.js`, `test/unit/review_format.test.js`, `docs/CONTRACTS.md`). Four new sentences go after the `LAHE ACTION REQUIRED` sentence:
  - what `catalog_requests` is, and why its page-text fields are data
  - pick-up, by `kind`
  - launch, with the `osascript` command written out, since the contract says it is the whole contract
  - how to answer
  - The contract is now 52 sentences, and the length assertion says so.
- **`docs/CONTRACTS.md`**, besides the contract copy:
  - `lahe status` gains the `catalog_requests` entry shape, its field classes, and the once-per-`handoff_rev` wake.
  - `lahe monitor` gains the repeated `--session` usage and its rules.
  - The session lifecycle gains the helper lifetime rule.
  - A new `lahe library` subsection covers:
    - both commands, the attach file, every answer refusal
    - the queue's three line shapes and the expiry reasons
    - `session name --from-review`
- **`docs/CLI.md`**
  - The two `lahe library` rows are expanded.
  - New row: `lahe session name <id> --from-review <review>`.
  - The `session close` row gains the lifetime rule.
  - A short "The Library" paragraph after the monitor exit codes.
- **Diagrams (3.4)**
  - `system_overview.md`: now top to bottom. It adds the Library page, its routes and token, the request queue, and the answer path. One note separates the in-page "library" from the Library page.
  - `session_ownership.md`: the Library token as a second credential. Two new diagrams:
    - "Hand-over from the Library": attach, confirm, queue, pick-up or launch, the two-session monitor, answer, expiry
    - "When the helper stops": the last-close rule and the reopened-session sweep
  - `module_map.md`: the five `catalog_*.js` service files, `library` in the CLI, and the `CATALOG_PAGE` list as its own group.
  - `README.md`: the three rows say what the diagrams now cover.
  - Every changed Mermaid block was parsed with the vendored mermaid in headless Chromium. All five parse.

## Deviations

1. **Launch passes the hand-off message through a file, not as a shell argument.** The architecture says the agent passes the message to `osascript` as an argument. Typing it into a shell command would put page text in a shell string, which the architecture also forbids. So:
   - the agent writes `handoff` to a file with its file-writing tool
   - it passes the file's path
   - the AppleScript reads the file and quotes both parts with `quoted form of`

   I checked the quoting on a message holding `$(...)`, backticks, quotes and newlines: it came back as exactly two arguments, with nothing expanded. The script compiles with `osacompile`. I did not run it, because it would open a Terminal window.
2. **The skill description keeps its pinned phrase.** `session_fixes.test.js` pins `"claim the lahe session", "take over the lahe session", or "lahe sessions"`. So the Library trigger is a separate sentence in the description.
3. **The contract says more than the plan's list.** It also says a click on the page is the human asking. Without that line, the contract's existing rule ("never infer a takeover") could read as forbidding a pick-up.
4. **Diagrams: where the lifetime is drawn.** No diagram drew the helper's lifetime before. The rule and the sweep went into `session_ownership.md`, beside takeover.

## Gaps found, not fixed (outside this task's files)

- **An agent with no LAHE session cannot attach.** `lahe library --session` needs an open session, and only `lahe review` creates one. No command makes an empty session. The skill tells such an agent to run `lahe library` without `--session`. Open and Star then work, and the agent buttons show the hand-off message. If the orchestrator wants every agent attachable, that needs a CLI change, such as a `lahe session new`.
- **The dev-server refusal cannot name the origin.** The architecture's answer is "Start the dev server at `<origin>`". The drain entry carries no origin for a dev-server row. So the skill says only that the app's dev server has to be running first.

## Not done, on purpose

- `npm run install-skills` was not run. It copies the skill into Ken's live `~/.claude/skills` and `~/.agents/skills`, and this branch is not merged yet. The orchestrator runs it after the merge.
- `dist/` was rebuilt locally for the gate and not committed. The orchestrator rebuilds and commits it at the checkpoint, since the contract ships in the bundle.

## Cleanup needed

- `node_modules` in this worktree is a symlink to the main checkout's `node_modules`. It is untracked and not committed. Remove it when the worktree is torn down.
- `dist/lahe-layer.js` is rebuilt locally and unstaged. Discard it or let the checkpoint rebuild overwrite it.
- Scratch files in the session scratchpad under `/tmp` (the Mermaid check script, the contract JSON draft, the AppleScript check). The OS clears them.
