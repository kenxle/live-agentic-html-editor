# Diagrams

Standalone mermaid diagrams, so a fresh agent can get the shape of this repo
without reading every file first. Each diagram lives in its own `.md` file with
the mermaid source in a fenced code block tagged `mermaid`, so GitHub and
Obsidian render it inline. Each one is also embedded in, or linked from, the doc it belongs to;
when behavior changes, change both.

## The diagrams

| File | What it shows | Lives with |
| --- | --- | --- |
| `system_overview.md` | The four things that exist and what talks to what: the browser running the library, the session-owned static server, the helper, the store on disk, and the agent | `README.md`, `AGENTS.md` |
| `module_map.md` | The four folders under `src/`, which way dependencies point, and why `layer/` is an ordered list rather than a cloud | `CLAUDE.md`, Directory layout |
| `item_lifecycle.md` | The four states an item can be in, with the actor on every transition | `docs/CONTRACTS.md` |
| `review_round_trip.md` | One comment end to end: a shared spine, then a labeled fan for the agent's half | `AGENTS.md`, Step 3 |
| `session_ownership.md` | What an agent session owns, the immutable-owner rule, and what takeover does | `AGENTS.md`, Agent-session isolation |
| `agent_workflow.md` | The agent's loop with commands on the arrows, plus the wake channel and its exit codes | `AGENTS.md`, `docs/CLI.md` |
| `finding_the_region.md` | How a saved comment finds its spot on the page again, as a ladder ending in an honest refusal | architecture D9 |
| `replay_branches.md` | The four-way compare after a repaint, and what each outcome does | architecture D7 |
| `protected_region.md` | The three protection layers during an edit, and what happens at commit | architecture D7 |
| `merge_on_load.md` | Browser wins on content, store wins on lifecycle per revision | architecture D5 |

## Diagrams that live elsewhere on purpose

These were not moved. They belong to the docs that explain them, and this table
is here so the index is still the one place you look.

| Where | How many | What they cover |
| --- | --- | --- |
| `docs/ongoing/SERVING_ARCHITECTURES.md` | 6 | How LAHE gets into a page, one per use case |
| `docs/ongoing/FINGERPRINTING.md` | 4 | The element fingerprint research and the queued-edits case |
| `docs/features/20260812.01.../02_architecture...md` | 4 | The original design pictures |

The architecture doc is history and is not rewritten. Where a diagram here
supersedes one of its pictures, that picture stays where it is and carries a
one-line pointer to the current file.

## Adding a diagram

One test, and it has already cut two proposals that looked reasonable:

**If the thing has no branch, no ordering that matters, and no two parties
passing something back and forth, it is a table. Write the table.**

A list of commands and what they do is a table. A list of checks a request
passes, applied in one place with no branch, is a table. A loop with exit codes
that mean opposite things is a diagram.

The full record of what was proposed, what was approved, what was renamed and
what was cut is in `docs/ongoing/DIAGRAMS_PLAN.md`. Read the cuts before adding
something.
