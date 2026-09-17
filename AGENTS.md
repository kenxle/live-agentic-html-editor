# For agents: the live agentic HTML editor

This file is about the tool: how your agent host connects to it, how to install
it, and where the documentation is. The instructions for running a review are in
the lahe skill, `skills/lahe/SKILL.md`. Once the skill is installed, your host
loads it when a review comes up. If your host does not load skills, read that
file before you start a review.

## How each host connects

Every host uses the same command, `lahe`, and the same skill text. Two things
differ by host: where it finds the skill, and how it waits for the reviewer's
next comment without spending model turns.

| Host | Finds the skill at | Waits for work with |
| --- | --- | --- |
| Claude Code | `~/.claude/skills/lahe/SKILL.md` | `lahe monitor --session <id>`, run with Bash in the background and launched again after each batch |
| Codex | `~/.agents/skills/lahe/SKILL.md` | `lahe monitor --session <id>`, run as a foreground pending exec call |
| Gemini CLI | `~/.agents/skills/lahe/SKILL.md` | `lahe monitor --session <id>`, run in the foreground |
| Antigravity | read `skills/lahe/SKILL.md` from the clone | `lahe monitor --session <id>`, run as a background terminal task |
| Any other host | read `skills/lahe/SKILL.md` from the clone | `lahe monitor --session <id>`, run in the foreground |

`npm run install-skills` copies the skill to both skill folders. `lahe review`
prints the exact monitor command for each session.

## Install

See `docs/INSTALL.md`.

## Documentation

- `skills/lahe/SKILL.md`
- `docs/INSTALL.md`
- `docs/CLI.md`
- `docs/CONTRACTS.md`
- `docs/diagrams/`
