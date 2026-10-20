# Lahe verification map

This folder is the maintained list of what a Lahe user can do, and how to prove
each one works. Read this page, then the file for the feature you are proving.
Each recipe was driven end to end with `lahe-verify` against version 0.4.0.
Entries marked "not yet driven" are written from source and the browser specs,
and need a live run before anyone calls them verified.

## Baseline preconditions

- A run started from this checkout: `lv up --run <name>` (or `--write` for a notes page).
- `lv doctor --run <name>` prints only `ok` lines.
- The document is [fixtures/sample.md](../fixtures/sample.md) unless the recipe says otherwise. Its sentences are unique, so an anchor never has to guess.
- Nothing from the real helper (port 7817, `~/.local/state/lahe`) is involved.

## Driving conventions

- `lv` means `skills/verify-lahe/bin/lahe-verify`, run from the checkout root.
- Every command takes `--run <name>`. The recipes leave it out to stay short.
- Start each recipe from a fresh run unless it says it continues another.
- Reviewer actions use real input: `page select`, `page caret`, `page key`, `page type`, `page click`.
- Read state with `page rail`, `page eval`, `agent drain`. Never cause the outcome with them.
- Wait with `page wait` or `agent wait`, never a sleep.
- `<item>` and `<rev>` come from the `id` and `rev` fields of the `agent drain` line.
- `<source>` is the `source` path that `up` printed.

## Proof and skip reporting

- Capture the action and the result: a `page shot` or `page rail <name>` after the key step, plus the drain line or the source file.
- An agent-side change is proven only after `page reload` still shows it.
- Record the feature file, the sub-feature id and the entry point with every result.
- Report each entry point as passed, failed, blocked (name the missing precondition and the command you tried), or not run.
- Never report one entry point as verified because a different one passed.

## Feature entry contract

Each feature file has an H1, one paragraph on what the user sees, then exactly
these H2s in order:

1. `Sub-features`: short ids, one line each.
2. `How to get to it (user POV)`: every way a user reaches it.
3. `Driving it with lahe-verify`: `Preconditions:`, then labelled bullets pairing each user action with the exact command and what you should observe.
4. `Gotchas`: traps that waste a run or make a result wrong, plus the regression spec for the area.

Keep code details out. Name user paths, stable handles, commands and proof.

## Features

- [Comments and replies](reviews-and-comments.md): comment on a passage, leave a page note, read the agent's answer, answer back, delete.
- [Editing and writing](editing-and-writing.md): edit a passage, see the agent place it, and write on a blank notes page.
- [Choices](choices.md): press an answer button in a document and change the answer.
- [Review controls](review-controls.md): mark a card done, hold sending, end the review.
- [Document style and PDF](document-presentation.md): preview a style, ask the agent to keep it, ask for a PDF.
- [Library and hand-off](library-and-handoff.md): find a review in the Library, open it, hand it to an agent.
- [The agent's loop](agent-loop.md): drain, reply, monitor wake and exit codes.

## Not yet mapped

These are real user paths with browser specs but no recipe here yet. Add them
as recipes once driven:

- conflicts between a reviewer edit and an agent change (`replay_branches` behaviour, `keep_mine_live_page.spec.js`, `conflict_toast.spec.js`)
- the Edits tab and undo (`edits_tab.spec.js`, `editing_undo.spec.js`)
- two windows on one review (`duplicate_tab.spec.js`)
- linked documents in one review (`linked_docs_rail.spec.js`)
- present mode and zoom (`present_mode.spec.js`, `zoom_viewer.spec.js`)
- offline and helper restarts (`helper_restart_holds.spec.js`, `graceful_failure.spec.js`)
- install and upgrade (`install_walk_3b.spec.js`)
- the Mac menu bar (needs macOS; `npm run check:menubar`)
- a real Claude or Codex host waking on feedback (needs that host; see [cloud.md](../references/cloud.md))
