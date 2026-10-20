# Verification skill for Lahe

Updated: 2026-10-19T20:15-04:00

## Latest

- **[PR #84 (verification skill)](https://github.com/kenxle/live-agentic-html-editor/pull/84)
  is ready to merge.** GitHub's check passed, and it still merges cleanly
  even though main has moved ahead by 39 commits since. Nobody has merged it yet.
- **Both cloud runs are waiting on you.** They need a cloud environment to run
  in (see "Needs your call" below). No routine has been created yet.
- **Nothing else changed** on this branch since this morning.

## What it is

**[PR #84 (verification skill)](https://github.com/kenxle/live-agentic-html-editor/pull/84) is open.**
An agent can now start a
throwaway Lahe review, use it the way you do (select, comment, edit, press
choices, use the rail and the Library), answer as the agent through the real
CLI, and keep screenshots and a command log as proof. Eight features are mapped
with recipes that were run end to end. Nothing here changes Lahe itself.

The branch was brought up to date with main first. `npm run gate:unit` on that
merge: 3087 passed, 0 failed, and no helper left running.

## Needs your call

- **Which cloud environment should the two cloud runs use?** Both cloud steps
  below are ready to create as Claude Code routines, but every routine needs an
  environment, and the four you have belong to other projects (Steady Thread,
  Columbia, Morsel, Text Affirmations). Using one of them would hand that
  project's settings and secrets to a run of this public repo. My
  recommendation: make a new environment named **LAHE** at
  [claude.ai/code](https://claude.ai/code) with no secrets, network access on
  (it downloads npm packages and Chromium), and this setup script:
  `npm ci && npx playwright install --with-deps chromium`. Tell me when it
  exists and I will create both routines.

## What changed since the first draft

Codex wrote the first version last night from the upstream pstack skill. It
mapped five features to existing browser specs and ran one of them. This pass
follows the upstream `/create-verification-skill` steps directly. It added the
pieces that version was missing:

- **A control tool, [`lahe-verify`](../../skills/verify-lahe/bin/lahe-verify).**
  `up` starts a review from the checkout in its own temp state folder (never
  your real helper) and opens it in a headless Chromium. `page`, `agent` and
  `cli` commands then act one step at a time. `doctor` checks the run is
  healthy and owned by this run. `down` stops only what the run started and
  keeps the evidence.
- **Recipes an agent can follow cold.** Each [feature file](../../skills/verify-lahe/features/README.md)
  now has the upstream shape: sub-feature ids, how a user gets there, then
  "do this, run this, see this" steps with real labels and selectors.
- **Every recipe was run.** Earlier, only one spec had been run.

## What was proven

Each line was driven with `lahe-verify` on commit `47e786b6` (macOS, Node
20.19.0, Chromium from Playwright 1.62):

- **Comments:** select words, Cmd-Shift-C, Cmd-Enter; the agent drains it, asks a question, the card shows it; the reviewer answers in the thread (revision 2); a page note; delete.
- **Editing:** edit a paragraph; the agent changes the file and replies handled; the page shows it once, after a reload too.
- **Notes page:** `lahe write` opens ready to type; a heading and a paragraph reach the agent as new blocks; placed once in the file and on the page.
- **Choices:** a press, a changed answer (same item, revision 2), a keyboard press (revision 3).
- **Rail controls:** mark as done (leaves the drain, shows in Done), hold sending (nothing reaches the agent until released), end review (shows in the agent's status).
- **Style and PDF:** preview a made-up style, ask the agent to use it, ask for a PDF; both requests reach the agent.
- **Library:** the run's review is listed; "Pick this up" with no agent listening shows the paste-in hand-off message.
- **Agent loop:** `lahe monitor` exits 0 with work waiting and 5 after the session closes.

After every run, `down` printed `left running: nothing`. The Lahe helper count
matched before and after (1, your own helper).

![The agent's question on a comment card, driven by lahe-verify](verification-proof/comment-reply.png)

![A blank notes page after the agent placed the reviewer's notes](verification-proof/notes-placed.png)

## Found along the way

- **Focus.** Chromium blurs the page each time a DevTools client disconnects,
  and a blur ends an open edit. The first version of the tool reconnected per
  command, so a blank notes page closed itself before anyone could type. The
  tool now keeps one process holding the browser for the whole run. This is a
  harness fact, not a Lahe bug: the real browser suite passes the same journey.
- **Library from a test helper.** `lahe library` looks for the real helper on
  7817 unless given `--port`. The recipe passes the run's own port.
- No Lahe bugs turned up.

## Not covered yet

Listed in the map's "Not yet mapped" section: conflicts between a reviewer edit
and an agent change, the Edits tab and undo, two windows on one review, linked
documents, present mode and zoom, helper restarts, install and upgrade, the
menu bar, and a real Claude or Codex host waking up. The Library's queued
hand-off and `lahe session takeover` also still need a live run.

## Next steps (from the bulletin board)

- **Prove a cloud run.** Follow [cloud.md](../../skills/verify-lahe/references/cloud.md):
  one `lahe-verify` journey on a fresh Linux runner, evidence uploaded.
  Approved. Planned as a one-time routine on the `docs/verification-skill`
  branch: `up`, `doctor`, the comment recipe, `down`, then push the evidence
  folder to its own `claude/` branch (a cloud run has no other place to keep
  files). Waiting on the environment above.
- **Keep the map current.** Run [maintain-verification-skill](../../skills/maintain-verification-skill/SKILL.md)
  after user-facing changes, and turn the "not yet mapped" list into recipes.
  Approved as a weekly routine, Sunday at 11pm Eastern, on `main`. It opens a
  PR only for proven fixes to the map, never merges, and never claims board
  rows. Routine times are set in UTC, so it will be `0 4 * * 1` (Monday 04:00
  UTC). That is 11pm from November 1, when clocks change, and midnight on
  October 25. Waiting on the environment above, and on PR #84 merging so the
  skill is on `main`.
- **Pilot a board task** with this as the proof step, stopping at a PR.

## Source

Follows Lauren Tan's pstack
[create-verification-skill](https://github.com/cursor/plugins/blob/main/pstack/skills/create-verification-skill/SKILL.md)
and [maintain-verification-skill](https://github.com/cursor/plugins/blob/main/pstack/skills/maintain-verification-skill/SKILL.md).
