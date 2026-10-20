# The agent's loop

The agent's side of Lahe is the CLI. It drains what the reviewer sent, answers
with `lahe reply`, and waits for new work with `lahe monitor`, which exits as
soon as there is something to do and tells the agent when to stop for good.

## Sub-features

- `loop-drain`: `lahe status --session <s> --json --quiet` prints one line per waiting item, and nothing when all are answered.
- `loop-reply`: `lahe reply` records an answer the page shows on the card.
- `loop-monitor-work`: `lahe monitor` exits 0 with an "ACTION REQUIRED" line when work is waiting.
- `loop-monitor-closed`: after the session is closed, `lahe monitor` exits 5 and says not to relaunch.
- `loop-takeover`: `lahe session takeover` moves the session to a new agent; an old monitor exits 6 (not yet driven).
- `loop-batch-reply`: `lahe reply --batch` answers many items from one JSON array (not yet driven).

## How to get to it (user POV)

- An agent runs the commands that `lahe review` printed: drain, reply, monitor.
- A human asks for a hand-off, and the new agent runs `lahe session takeover <session>`.

## Driving it with lahe-verify

Preconditions:

- A fresh run with one outstanding comment (see [comments](reviews-and-comments.md)).
- `<session>` is `session` from `lv info`.

- **Drain.** Run `lv agent drain`. One JSON line per waiting item, with `id`, `rev`, `kind`, `state` and the reviewer's words.
- **Reply.** Run `lv agent reply <item> <rev> handled --text "Done."` after making the change, or `question` with `--text`. The CLI prints `{"item":...,"status":...}` and the card shows the answer (see [comments](reviews-and-comments.md)).
- **Monitor with work waiting.** Run `lv cli -- monitor --session <session>`. It exits 0 at once and prints `LAHE ACTION REQUIRED: 1 item ... waiting` with the drain and relaunch commands.
- **Monitor after close.** Run `lv cli -- session close <session>`, then `lv cli -- monitor --session <session>`. It prints `agent session ... is closed; monitoring has ended; do not relaunch this monitor` and exits 5.
- **Proof.** The exit codes and output lines in `commands.jsonl`.

## Gotchas

- With no work waiting, `lahe monitor` blocks until work arrives. `lv cli` runs it in the foreground, so only run it when work is already waiting, or run it from a separate background shell.
- `lv down` closes the session itself. If you closed it already, `down` still stops the processes.
- A reply naming an old revision is refused. Read the current `rev` from the drain before replying.
- Regression specs: `agent_replies.spec.js`; unit tests under `test/unit/` cover monitor exit codes and takeover fencing.
