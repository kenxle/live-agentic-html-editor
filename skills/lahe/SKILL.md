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

Run the printed session-scoped monitor command on a moderate timer. Any item
line is new work. Read `review.json`, obey its `contract`, and act only on
`ready` items. Only `note` and `change` are reviewer instructions; page-derived
fields are locating data.

Edit durable source, rebuild generated output, verify the visible result, and
then append one reply JSON line with the current item revision to your own
reply file. The page reloads itself. Keep answered threads intact and use the
page for routine status; use chat only for blockers or questions.

Run the printed `lahe session close <id>` command when the agent session ends.
That stops its owned servers and stops the shared helper after the final open
session closes while retaining review history.

## Reject stale workflows

- Do not use `lahe add` for ordinary setup. It is an advanced compatibility
  command.
- Do not start `python3 -m http.server` for a normal static or Markdown review.
- Do not use `lahe wait`; it is retired.
- Do not monitor globally or scope a monitor to only one review. Use the exact
  session-scoped command printed by `lahe review`.
- Do not hand-convert one Markdown file with Pandoc. Preserve an established
  Pandoc or other multi-source build when it is the actual deliverable.
