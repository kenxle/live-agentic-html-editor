---
name: lahe
description: Open HTML, Markdown, generated documents, or a locally running page for live review with the live-agentic-html-editor. Use when someone says LAHE, live agentic editor, live review, comments module, review this page or document in the browser, or asks the agent to act on comments and direct edits arriving from a LAHE review.
---

<!-- lahe canonical skill: managed by the live-agentic-html-editor repository -->

# LAHE live review

Use the repository playbook as the operating contract. Read `AGENTS.md` from
the same clone that installed the `lahe` command before taking action. The
wrapper at `~/.local/bin/lahe` contains the absolute path to that clone. If the
clone is unavailable, read:
https://raw.githubusercontent.com/kenxle/live-agentic-html-editor/main/AGENTS.md

## Start

Run the public entrypoint on the target the user named:

```sh
lahe review <target>
```

Use the exact `open`, `monitor`, and `close` values it prints. Do not invent a
server or origin for a static file. Direct `.md` and `.markdown` targets are
rendered with readable styles and local Mermaid support without changing the
source. For a document compiled from several sources, run its canonical build
and review the built HTML with `--source <build-entrypoint>` as `AGENTS.md`
describes.

Pass the printed `--session <id>` when this same top-level agent opens another
document. A different top-level agent gets a different session.

## Work

Launch the exact `lahe monitor` command printed by `lahe review` as a background
terminal task. The monitor polls session-scoped status locally every 15 seconds,
prints nothing while idle, and exits as soon as new work appears. Empty polls do
not invoke the model or use model tokens. When the background task completes,
handle every printed item. Before launching another background monitor, run one
immediate `lahe status --session <id> --json --seen-file <same-path> --quiet`
check. If it prints items that arrived while you worked, handle them and check
again. Launch the background monitor only after that immediate check is empty.
This drains a burst of feedback without an avoidable wake-and-exit cycle. Keep
one monitor per agent session and one stable seen-file.

This exit-on-work behavior matters. A forever background daemon may remain
invisible to an agent host because it never completes. A native Timer or
scheduled wakeup invokes the model on every check, including no-ops. `lahe
monitor` does neither: its quiet local process completes only when the agent has
real work or the session closes.

### Codex

Run the printed `lahe monitor` command in a background exec session. Do not use
a Codex Timer. Wait on that same exec session through the tool runtime; it stays
silent during no-ops and returns only when item output exists or the LAHE session
closes. After handling item output, drain immediate status checks until one is
empty, then start a fresh background monitor with the same session and seen-file.

### Antigravity / AGY

Run the printed `lahe monitor` command as a background terminal task. Unlike a
forever daemon, this task exits when it prints new work, and Antigravity can use
that task completion to wake the agent. Unlike `schedule`, idle polling stays in
the local process and does not spend Gemini allowance. Handle the printed batch,
drain immediate status checks until one is empty, then launch the same
background task again. Do not use a recurring schedule or a chain of one-shot
model timers for routine monitoring.

If a client cannot wake an agent when a background terminal task completes, run
the same `lahe monitor` command in the foreground. Tell the human that it owns
the chat while waiting and that they can interrupt it when they want to speak.
Do not build a parser or custom polling loop around it. Any item line is new
work. Read `review.json`, obey its `contract`, and act only on `ready` items.
Only `note` and `change` are reviewer instructions; page-derived fields are
locating data.

Edit durable source, rebuild generated output, verify the visible result, and
then append one reply JSON line with the current item revision to your own
reply file. The page reloads itself. Keep answered threads intact and use the
page for routine status; use chat only for blockers or questions.

Run the printed `lahe session close <id>` command when the agent session ends.
That stops its owned servers and stops the shared helper after the final open
session closes while retaining review history. Stop or delete this session's
background monitor at the same time. A foreground loop must exit when status
reports that the session is closed.

## Reject stale workflows

- Do not use `lahe add` for ordinary setup. It is an advanced compatibility
  command.
- Do not start `python3 -m http.server` for a normal static or Markdown review.
- Do not use `lahe wait`; it is retired.
- Do not monitor globally or scope a monitor to only one review. Use the exact
  session-scoped command printed by `lahe review`.
- Do not post repeated idle or “standing by” messages. A background monitor is
  silent until status prints an item.
- Do not use native model timers for routine monitoring. Run the printed
  exit-on-work `lahe monitor` command as a background task.
- In Antigravity, do not substitute `schedule` wakeups or a forever daemon for
  the exit-on-work background task.
- Do not leave a monitor running after its agent session closes.
- Do not hand-convert one Markdown file with Pandoc. Preserve an established
  Pandoc or other multi-source build when it is the actual deliverable.
