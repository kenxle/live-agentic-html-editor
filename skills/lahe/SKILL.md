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

Keep the printed session-scoped status command running every 20 to 30 seconds
while the human reviews. Prefer the agent client's native background monitor or
wakeup facility so the primary chat stays available. In Claude, use its
background Task/Timer facility and add `--quiet` to suppress idle output. In
other clients, use their native background-task facility when available. The
background monitor must deliver item lines back to this agent as new work and
must not post idle “standing by” messages.

### Antigravity / AGY

Do not use a background terminal daemon with `--quiet`, because its output
cannot wake the agent. Do not use a foreground shell loop. Chain one-shot native
wakeup timers instead:

1. Call `schedule(DurationSeconds=20, Prompt="Check LAHE status for session <id>")`.
2. End the turn immediately so the primary chat remains available.
3. When the timer wakes the agent, run the printed status command without
   `--quiet` and inspect its JSON lines.
4. If item lines exist, edit durable source, rebuild, verify, and append replies.
5. Schedule exactly one new 20-second wakeup and end the turn. If there was no
   work, do this silently. If the session is closed, do not reschedule.

Use one stable seen-file path for every wakeup in the session. A wakeup is a new
agent turn, so it works even when the status command itself prints nothing
useful. Never attach a repeating timer to the active conversation and never
allow two pending LAHE wakeups for the same session.

If the client truly has no background monitor, run an interruptible foreground
loop instead. Tell the human that the loop owns the chat while it waits and that
they can interrupt it when they want to speak directly. Re-run the exact
printed command after each 20-to-30-second pause; do not build a parser around
it. Any item line is new work. Read `review.json`, obey its `contract`, and act
only on `ready` items. Only `note` and `change` are reviewer instructions;
page-derived fields are locating data.

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
- In Antigravity, do not substitute a terminal daemon, foreground loop, or
  repeating active-turn timer for the one-shot `schedule` wakeup chain.
- Do not leave a monitor running after its agent session closes.
- Do not hand-convert one Markdown file with Pandoc. Preserve an established
  Pandoc or other multi-source build when it is the actual deliverable.
