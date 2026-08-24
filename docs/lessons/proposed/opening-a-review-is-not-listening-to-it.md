---
title: Opening a review is not listening to it, and nothing makes the agent notice
category: process
symptoms: [it doesn't seem like you're listening, comments not picked up, agent never responded, no reply to my feedback, a comment was already waiting, forgot to arm the monitor]
applies_to: [AGENTS.md, skills/lahe/SKILL.md, src/cli/commands/review.js, src/shared/protocol.js]
first_seen: 2026-08-24
confirmed: 2026-08-24
status: live
---

## What happens

An agent runs `lahe review`, hands over the URL, and reports that the review is
ready. The reviewer leaves comments and nothing happens. When challenged the agent
answers some version of "you're right, I opened the tabs and never armed the wake
channel", arms it, drains, and finds feedback already waiting.

It reads as carelessness and it is not. The command succeeded, the page works, the
rail is live, and the agent has no signal that anything is missing.

## Why

`lahe review` prints eight labelled lines: `review`, `session`, `folder`, `open`,
`wake`, `monitor`, `drain`, `close`. Seven are values to record and one, `wake`, is a
command that must be run for any of the rest to matter. Nothing distinguishes them,
and the command exits zero either way.

The setup is then complete from every angle the agent can see. The page really is
serving, the rail really did boot, and the reviewer really can comment. The only
missing piece is a process on the agent's side that nothing checks.

## What to do instead

Arm the wake channel in the same turn that runs `lahe review`, before handing over
the URL. Not after the reviewer asks, not once the first comment lands. On Claude
Code that is the Monitor tool on the printed `wake` command with `persistent` true;
other hosts run `lahe monitor` per `AGENTS.md`.

Then drain once immediately. A reviewer who commented while the agent was still
opening tabs has work waiting before the watcher exists, and the wake feed only
reports lines written after the tail starts.

**This wants a mechanism and does not have one yet.** The repo already states the
principle, in `src/service/heal.js`: a rule an agent has to remember is not a
mechanism. Two facts are now available that were not when the printed block was
designed. The helper can see whether anything holds a session's wake feed open, which
is what `service/watchers.js` reads for the rail's status line. And the rail already
tells the reviewer when nothing is listening. Until the command itself refuses to look
finished with no watcher armed, this lesson is the only thing standing between a
reviewer and a silent review.
