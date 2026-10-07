# Progress: Re-arm guard

**Done.** Claude agents restart their Lahe watcher without having to remember: a Stop hook blocks the end of a turn while one of the agent's reviews has nobody watching. Shipped in https://github.com/kenxle/live-agentic-html-editor/pull/31. The leaked test helpers found along the way are fixed in their own pull request. Nothing is waiting on you. Last updated 2026-10-07 18:52.

**Docs:** [Decision](00_decision.md) · [Review log](04_progress_rearm_guard_review_log.md) · [Review log, main copy](04_progress_rearm_guard_review_log_main.md)

## Needs your attention

Nothing is waiting on you.

## Currently working on

Nothing is running.

## Phases

This ran as a whetstone-size change: a decision page, then build, review, and ship.

| Phase | Status | Changed |
| --- | --- | --- |
| Decision page and approval | done | 2026-10-06 19:14 |
| Build | done | 2026-10-06 19:47 |
| Review and fix round | done | 2026-10-06 20:08 |
| Ship (PR 31) | done | 2026-10-06 20:23 |
| Cleanup | done | 2026-10-07 18:52 |

## The record

**What shipped**
- `lahe hook stop`, a Claude Code Stop hook. It finds the Lahe sessions this agent started from its own session log, and blocks the end of a turn once if one is open with no live watcher. The block message names the exact restart command.
- `npm run install-skills` adds the hook to `~/.claude/settings.json` without touching other settings. It refuses to install from a worktree, and the hook does nothing quietly if its target is missing.
- The skill and the contract tell Claude agents to start the watcher with the largest background timeout.
- Ken's settings: `BASH_MAX_TIMEOUT_MS` set to 24 hours.

**Review findings, all fixed before merge**
- The ended-review check read the wrong field, so ended reviews would still block.
- A removed install target would have shown a hook error on every turn in every project.
- A wall-clock test would have flaked on CI.
- The transcript scan cap went from 256 MB to 32 MB.
- A stale heartbeat from a live watcher after sleep no longer starts a second watcher.

**Test results:** the full gate passed locally before each push (2430 unit tests passed, 807 browser tests passed, 0 failed), and GitHub's run on PR 31 passed.

**Seen working:** this session's watcher lapsed and the hook blocked the turn with the restart command.

**Found along the way**
- 1,892 leaked test helpers filled swap and drained the battery. They were stopped on 2026-10-07. The cause is fixed in its own pull request, and `CLAUDE.md` now has "Tests leave nothing running".
- iTerm2's Claude Code integration was costing battery. Ken uninstalled it.

**Follow-ups** (on docs/BULLETIN.md)
- LAHE-bg-reap-setting: Claude Code's low-memory stop. Ken left the setting off for now.
- LAHE-hook-known-limits: non-ASCII and Windows paths, and a reused pid.

**Cleanup queue:** the builder worktrees for this feature are already removed. Nothing else is queued.

## Log

- 2026-10-07 18:52: Closed out. The guard works in practice. The memory-pressure question was checked against Anthropic's docs and left as Ken's call (off for now). The helper leak was the real battery drain.
