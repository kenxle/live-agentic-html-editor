# Monitor in Codex

## Codex

Run the printed `lahe monitor` command as a foreground pending exec call and keep
waiting on it. The monitor keeps its idle polling in one small local Node
process, so it uses no model turns while it waits. When work lands it prints one
`LAHE ACTION REQUIRED` line naming the drain, and exits. It is an interrupt:
continue the same turn, run the drain, handle every item it prints, rebuild and
verify, append replies, then drain until empty and run the monitor again.

Keep the turn pending on the monitor's exec call, with no Codex Timer.
A detached terminal task does not guarantee a new Codex turn after the current
one ends. Use the exec tool's pending-process wait mechanism. Do not replace
the monitor with a timer, parser, dedupe or polling loop.

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
