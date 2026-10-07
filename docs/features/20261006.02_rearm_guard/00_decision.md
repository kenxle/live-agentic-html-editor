# Re-arm guard: agents keep watching without having to remember

## Needs your attention

Nothing. One thing is still in progress: the fix that stops leftover test helpers from piling up again (PR 35). It's being corrected after GitHub's Linux run failed. When it merges, this page is done.

## Status: shipped

- **Merged.** The guard is on main in pull request 31. GitHub's run and the full local suite both passed.
- **Installed on your machine.** Your Claude Code settings run the hook from the main clone. The 24-hour background limit is set too.
- **Reviewed first.** A separate reviewer found two real problems before merge, and both are fixed:
  - Ending a review in the rail no longer makes its agent keep restarting a watcher.
  - If Lahe's folder moved or was deleted, the hook used to show an error on every turn. Now it does nothing quietly.
- **Seen working.** This session's watcher hit its 2-hour limit, and the guard blocked the end of the turn with the exact restart command.
- **One gap found.** Overnight, Claude Code stopped the watcher because the Mac was low on memory, and it says not to restart a watcher stopped for that reason. The guard still asks for a restart, so the two conflict. You decided to leave the setting that stops those shutdowns off for now (see the last section).

**Short version.** Agents stopped re-arming because Claude Code took away the one tool that made watching automatic. The fix is to put the guarantee back in Claude Code itself: a small hook that won't let an agent finish its turn while one of its Lahe reviews has nobody watching.

## What broke

- Until September 14, a Claude agent armed one persistent watch. It woke the agent whenever work arrived and never expired. The agent never had to remember anything.
- Claude Code 2.1.271 removed the persistent option. Every watch now expires, at most 30 minutes for the Monitor tool and at most 2 hours for a background command.
- Lahe's fallback is its own command, `lahe monitor`, run in the background. It ends every time work arrives, it times out, or Claude Code reaps it to free memory. Each time, the agent has to start it again. That is the step agents forget, so we are back to depending on agent memory, the thing Lahe was built to avoid.

## The fix: a Stop hook that Lahe installs

A hook is a script Claude Code runs on its own, not something the agent decides to do. A **Stop** hook runs each time an agent tries to end its turn, and it can refuse.

```mermaid
flowchart TD
    A["Agent tries to end its turn"] --> B["Claude Code runs Lahe's Stop hook"]
    B --> C{"Does this agent own an open<br/>Lahe review with no live watcher?"}
    C -->|"no"| D["Turn ends normally"]
    C -->|"yes"| E["Hook blocks the stop and hands the agent<br/>the exact command to restart the watcher"]
    E --> F["Agent restarts the watcher"]
    F --> A
```

- **Which reviews are the agent's.** The hook reads the agent's own session log and finds the Lahe session IDs it started. It ignores other sessions' reviews.
- **Whether a watcher is alive.** Lahe already knows: each watcher leaves a fresh heartbeat from a process that still exists. The hook asks Lahe; it doesn't guess.
- **The block message.** It names the exact `lahe monitor` command, ready to run, so the agent has nothing to look up.
- **No endless loop.** Claude Code tells the hook when it is already inside a blocked stop. The hook blocks at most once per turn, so an agent that genuinely can't restart the watcher is never trapped.
- **Closed or handed-over sessions are left alone.** A session the reviewer ended, or that another agent took over, doesn't count.
- **Install.** `npm run install-skills` adds the hook to Claude Code's settings without touching your other hooks, and it is the same step that already installs the Lahe skill.

## The other half: fewer timeouts while idle

- An idle watcher still ends at the background-command limit, which is 2 hours by default. The hook makes the agent restart it, at the cost of one short model turn.
- Claude Code reads a setting, `BASH_MAX_TIMEOUT_MS`, that raises that limit. Setting it to 24 hours drops the idle restarts from up to 12 a day to about 1.
- The skill also tells Claude agents to start the watcher with the largest limit allowed.

## What you'd notice

- Agents keep answering your comments for as long as their session is open, without stalling after an hour or two.
- The rail's "no agent listening" warning should show only when an agent's session has truly stopped, not because a watcher quietly lapsed.
- Nothing changes for Codex or Antigravity. Neither has this kind of hook; their instructions stay as they are.

## How it gets built and checked

- One small change: the hook command, its install step, the skill's Claude Code section, and the docs.
- Tests cover these cases:
  - an agent with an unwatched review is blocked once with the right command
  - a watched one isn't blocked
  - a closed session isn't blocked
  - another agent's review is ignored
  - the second stop in one turn passes
- The full test suite runs locally before anything goes to GitHub.

## The decision

Decided 2026-10-06: build the guard, and set `BASH_MAX_TIMEOUT_MS` to 24 hours. Both are done.

## Low-memory shutdowns: decided, left off

- **What actually stops the watcher, checked against Anthropic's docs.** It is Claude Code itself, not macOS. Claude Code's docs say it "stops your running background tasks when the operating system reports critical memory pressure, provided the session has been idle for at least 30 minutes and no turn or subagent is running" ([interactive mode docs](https://code.claude.com/docs/en/interactive-mode)). The earlier session was right that macOS isn't killing it.
- **The trigger misfires, per open bug reports.** Users report the stop firing on machines with plenty of memory: [#90109](https://github.com/anthropics/claude-code/issues/90109) on a Mac, and [#92228](https://github.com/anthropics/claude-code/issues/92228) and [#78674](https://github.com/anthropics/claude-code/issues/78674) on Linux. All three are still open.
- **Last night was likely real pressure.** The leak had filled 47 of 48 GB of swap. So this stop was probably justified, but the misfire bugs mean it can also happen on a healthy Mac.
- **Recommendation: yes.** The watcher uses about 5 MB, and the setting is Anthropic's documented way to turn this off.
- **Decision 2026-10-07:** leave the setting off for now.
