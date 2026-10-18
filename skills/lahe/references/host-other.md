# Monitor in other hosts

## Antigravity / AGY

Run the printed `lahe monitor` command as a background terminal task. It exits
when new work appears, so task completion wakes the agent. Run the drain, handle
what it prints, drain until empty, launch the same command again, and end the turn so chat
stays available.

## Any other host

Run the printed `lahe monitor` command in the foreground, as printed. Tell the
human before starting that it owns the chat while it waits and that they can
interrupt it when they want to speak.

Antigravity must not use its native `schedule` timer: idle scheduled wakes
spend model allowance. For Gemini CLI, use the foreground monitor.

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
