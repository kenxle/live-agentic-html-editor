# Spec: the Stop hook says one launch waits until there is work

**Summary.** The Stop hook still tells a Claude Code agent to relaunch the
monitor with a two-hour timeout. The skill, the contract and `docs/CLI.md` were
updated on 2026-10-11 to say one background launch waits until there is work,
with no timer. This change brings the hook, its test, the agent workflow
diagram and one pitfall in the skill onto the same story.

## Problem, user, and context

An agent on Claude Code waits for the reviewer's next comment with
`lahe monitor --session <id>` in a background Bash call. Since Claude Code
2.1.288 an interactive session puts no time limit on a background command, so
one launch waits until there is work. The skill's Claude Code section, the
contract line in review.json and `docs/CLI.md` say exactly that since the
commit "Watcher: one launch waits until there is work" (2026-10-11).

The Stop hook (`lahe hook stop`, installed by `npm run install-skills`) was
not touched by that commit. When it blocks a turn it tells the agent to pass a
timeout of two hours, or `BASH_MAX_TIMEOUT_MS` when that is larger. On Ken's
machine the env var is set to 24 hours, so the hook happens to print 86400000;
on a fresh install it prints 7200000, which the skill now says not to do. Two
docs still carry the old picture as well: the agent workflow diagram names the
two-hour timeout and says the monitor ends when it hits it, and pitfall 10 in
the skill says to use "the largest timeout allowed".

The user is the agent reading the hook's block reason, and Ken, who reads the
diagram and the skill to know what his agents are doing.

## Requirements

1. **The hook's default timeout is 24 hours.** `lahe hook stop` names
   86400000, or `BASH_MAX_TIMEOUT_MS` when that is larger, the same number the
   skill and the contract name.
2. **The hook's reason says one launch waits until there is work.** It tells
   the agent not to add a timer, a scheduled wakeup or a loop. It stays short:
   the reason is read on every block, and repeated agent-facing text steers
   behavior.
3. **The diagram matches.** `docs/diagrams/agent_workflow.md` names 86400000,
   says one launch waits until there is work in an interactive session, and
   describes the timeout as mattering only in an unattended run. Its "What to
   notice" text says the same.
4. **The CLI doc's hook section matches.** The "What it prints" bullet in
   `docs/CLI.md` says the reason tells the agent one launch waits until there
   is work, instead of "the largest timeout allowed".
5. **The skill's pitfall 10 matches.** It says one launch waits until there is
   work, not "the largest timeout allowed". The installed copy is refreshed
   with `npm run install-skills`.

## Approach

No design call. The contract text in review.json already says the right thing
and is not touched, so the bundle does not change. The one choice is to keep a
timeout number in the hook's reason at all: it stays, because an unattended run
(`-p`, the Agent SDK, CI, cloud) still has a real limit, and the skill keeps the
number for the same reason.

## Tasks

Done directly in this worktree, no builder dispatched.

| # | Task | Verification |
|---|---|---|
| 1 | `src/cli/commands/hook.js`: raise `DEFAULT_MAX_TIMEOUT_MS` to 24 hours, reword the two comments that call it Claude Code's two-hour limit, reword `blockReason` so it says one launch waits until there is work | `test/unit/hook_stop.test.js`: the default-timeout cases expect 86400000; a lower `BASH_MAX_TIMEOUT_MS` leaves the 24-hour default; the `blockReason` fixture matches the new wording |
| 2 | `docs/diagrams/agent_workflow.md`: the Claude Code node and the paragraph after the second diagram | read-through against the skill's Claude Code section |
| 3 | `docs/CLI.md`, "What it prints" | read-through |
| 4 | `skills/lahe/SKILL.md`, pitfall 10, then `npm run install-skills` | `diff` of the installed copy against the repo copy |
| 5 | `npm run gate:unit` | lint and the unit suite pass; counts in the PR body |

## Acceptance criteria

The verification column above is the list. In one line: a fresh machine's
Stop hook prints 86400000 and says one launch waits until there is work, and
no doc in the repo still says the monitor ends at a two-hour timeout.

No analytics, no flag: the hook runs on every turn or not at all, and the
installer already handles adding and removing it.

**Open questions.** None. Ken set the direction in chat: "we want to go back to
indefinite for claude".

## Review

Pending.
