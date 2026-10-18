# Monitor in Claude Code

## Claude Code

One Bash call, and nothing else:

- command: `lahe monitor --session <id>`, exactly as printed
- `run_in_background: true`
- `timeout: 86400000`, or the value of `BASH_MAX_TIMEOUT_MS` when that is larger

```sh
lahe monitor --session <id>
```

It waits in a small local Node process, so it costs no model turns and no model
tokens. It exits when work lands (code 0), the session closes (5), or another
agent takes over (6). On 0, drain to empty and launch the same command again,
the same way. On 5 and 6, stop.

**It stays open until there is work.** In a terminal, desktop app or VS Code
session, Claude Code puts no time limit on a background command (since 2.1.288),
so one launch can wait all day. Do not relaunch it on a schedule, and do not add
a timer, `/loop`, a scheduled wakeup, the Monitor tool, or a `tail` of your own.
The timeout only matters in an unattended run (`-p`, the Agent SDK, CI, cloud),
where the limit is real; there, relaunch when it is stopped.

**It wakes you once per item.** The monitor remembers which items it woke you
for. Relaunched while those items are still unanswered, it waits; it wakes on
the first new item, a new revision of one, an ended review, or a Library
request, and then prints one line naming the drain. So launch it again as soon as you have
drained, even while you are still working an item (a CI run, a build): it will
not exit on work you already have. The drain command is still the full list.
After a takeover it starts fresh and wakes you for everything unanswered.

**A Stop hook reminds you when the watcher is down.** `npm run install-skills`
installs `lahe hook stop` as a Claude Code Stop hook. When you try to end a turn
while a session you started is open and no monitor is running for it, the hook
blocks the stop once and names the exact monitor command. Run that command in
the background, and nothing else: no drain, no message to the reviewer. It
blocks at most once per turn, so if the session really is not yours, or you are
holding after three kills (below), say so in one line and end the turn.

**A kill is not work.** The one thing that ends a quiet monitor in an
interactive session is Claude Code's memory killer. Since 2.1.274 it stops an
idle background command only when the OS reports critically low memory and the
session has been idle for 30 minutes, so this is now rare. The notification
says the command was stopped, not that it exited with a code. When that happens:

- Do not drain, and do not write to the reviewer. Just launch the same monitor
  command again in the background.
- That relaunch is the check. The monitor's first poll wakes you on anything
  that landed during the gap and exits at once, so nothing is missed.
- Keep that turn to the one tool call. A drain, a status note, or a "still
  watching" message turns every kill into a full no-op turn.

**Ask once for the setting that stops these kills.** The first time a monitor
is killed this way, tell the human, once per session, that one line in the
`env` block of their Claude Code `settings.json` turns the killer off:

```json
{ "env": { "CLAUDE_CODE_DISABLE_BG_SHELL_PRESSURE_REAP": "1" } }
```

It is their config, so ask rather than set it. It takes effect in a new session.

**Stop re-arming after three kills in a row.** If the watch is killed three
times in a row with no new item landing between any of the arms, stop
relaunching it and tell the reviewer: the machine is genuinely short of memory,
or the setting above is not in effect, and a fourth relaunch is a guess, not a
fix. Say what you tried and that you are holding until they ask you to watch
again.

## Monitor exit codes

| Code | Meaning | What to do |
| --- | --- | --- |
| 0 | Work is waiting; the line names the drain | Drain, handle every item, drain to empty, run the monitor again |
| 4 | Bad usage, unknown session, or a live monitor already holds this session | Fix the command. Keep the monitor you have |
| 5 | The agent session is closed | Stop |
| 6 | Another agent took the session over | Stop |

**One monitor can watch several sessions.** Give `--session` more than once:
`lahe monitor --session <yours> --session <other>`. The first is the primary.
It exits 0 on work in any of them. A session that closes or is taken over is
dropped with a line, and the rest are still watched; its exit code comes only
when no session is left. You need this after you pick a document up from the
Library.
