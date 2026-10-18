# Monitor in Codex

## Codex

Run `lahe monitor --session <id> --codex`, keeping any printed `--state-dir`.
It starts a local watcher and returns. Once it confirms the watcher is active,
finish your current work and end the turn. Codex can then restart normally.
The bare printed monitor command also selects this mode when Codex supplies
`CODEX_THREAD_ID` or `CODEX_SESSION_ID`.

The watcher polls locally, with no Codex Timer and no idle model calls. When
real feedback arrives, it uses `codex queue` to send one `LAHE ACTION REQUIRED`
message to this same conversation, then exits. Detached task completion alone
is not the wake channel: the native queue starts the follow-up turn. The message
names the drain. Run it, handle every item, rebuild and verify, append replies,
and drain until empty. Then re-arm with the same `--codex` command and end the
turn after it returns. Re-arming while the watcher is active is harmless.

Queued drain commands carry `--handoff-rev`. Copy it too. Exit 6 means this wake
predates a takeover: skip that session without handling or re-arming it. Keep
working the other sessions in the wake. A guarded re-arm drops stale or closed
sessions and continues with the ones you still own.
If new work arrives while you handle a batch, the drain sees it. Re-arming
checks again, so feedback in the gap still wakes you without repeated prompts
while the current batch is being handled.

This mode needs a Codex CLI with `codex queue`, the current conversation id in
the environment, and access to the existing local shared daemon's socket. It
checks those prerequisites before reporting success. If the sandbox blocks the
socket, rerun the monitor command with the host's normal permission mechanism.
An older Codex or a remote-only host gets a clear error, without a foreground
fallback. Queue failures during a restart are retried locally; feedback is
marked delivered only after Codex accepts it. The watcher's log is
`agent-sessions/<id>/codex-monitor.log` under the state directory.

Do not keep a model turn pending on an idle monitor. That can prevent a
graceful Codex restart from finishing. Do not replace it with scheduled model
wakeups or a timer that relaunches the monitor on empty results.

## Monitor exit codes

| Code | Meaning | What to do |
| --- | --- | --- |
| 0 | Watcher started, or already active | Finish current work and end the turn; real feedback arrives as a queued message |
| 4 | Bad usage, unknown session, or a live monitor already holds this session | Fix the command. Keep the monitor you have |
| 5 | The agent session is closed | Stop |
| 6 | Another agent took the session over | Stop |

**One monitor can watch several sessions.** Give `--session` more than once:
`lahe monitor --session <yours> --session <other>`. The first is the primary.
Add `--codex`. One watcher covers the conversation; adding a session updates
its watch list. A worker drops sessions that
close or change hands. After handling work, re-arm the sessions you still own.
You need this after you pick a document up from the Library.
