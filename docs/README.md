# Docs

The README is the short version. Everything longer lives here.

## For people using the tool

- [INSTALL.md](INSTALL.md): what you need, installing the command and the agent
  skill, running from the clone without installing, the per-review token,
  Markdown review, and removing a review or the tool.
- [CLI.md](CLI.md): every `lahe` command and flag, what a person says to their
  agent, and the files a review writes.
- [CONTRACTS.md](CONTRACTS.md): the numbered contracts between the reviewer, the
  tool, and the agent. What the tool guarantees, and what an agent must do.

## For people working on the tool

- [BULLETIN.md](BULLETIN.md): the task board. Append-only, newest first.
- [features/20260818.01_release_readiness/04_progress_release_readiness.md](features/20260818.01_release_readiness/04_progress_release_readiness.md):
  the release-readiness progress record, which is where the current push toward
  a public release is tracked.

## Build history

`features/` holds the record of how the tool was built, folder per feature: the
brief, the architecture, the plan, the review rounds, and the notes each builder
left behind. It is history, not current documentation. It says what we set out
to build and why we chose what we chose, and it is not rewritten as the tool
changes. When it disagrees with the tool, the tool is right.

The living truth for how the tool works today is three files: this repo's
`README.md`, `AGENTS.md` (the playbook an agent follows), and the `contract`
field embedded in every `review.json`, which is authored in
`src/shared/review_format.js` and restated in
[CONTRACTS.md](CONTRACTS.md).
