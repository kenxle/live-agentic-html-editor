---
title: Zero work waiting means both "finished" and "caught up", and only one of them needs you
category: service
symptoms: [the agent says the review is still active after the reviewer ended it, no signal when the reviewer ends a review, the wake log has no line for it, the drain prints nothing but the reviewer is done, ended_at is set and nothing happened, the monitor wakes on the same thing on every relaunch, status is quiet when it should not be]
applies_to: [src/service/**, src/cli/commands/**, src/shared/protocol.js, src/shared/review_format.js]
first_seen: 2026-08-25
confirmed: 2026-08-25
status: live
---

## What happens

A reviewer presses End review. The route archives the review, `ended_at` lands in
`review.json`, and the agent is never told. Asked directly, the agent reports the
review as still open and still listening, and it is reporting honestly: every number
in front of it says a healthy session.

The reason it says that is the trap. The drain is
`lahe status --session <id> --json --quiet`, and an ended review has no ready items
left. Neither does a review the agent has answered everything in. The two states
produce byte-identical output, so the signal for "the reviewer is finished" is the
absence of work, which is also the signal for "you are doing fine".

**The absence of something is not a signal.** It is the same bytes as success, and
whichever meaning the reader already expects is the one they take.

Two things follow, and the second one bites while you are fixing the first.

**A promise in a contract is not an implementation.** The text every agent is
guaranteed to read said the reviewer "can end a review from the page ... and you are
woken with the rest of the work". Nothing wrote that line. The same contract listed
the feed's three line kinds eleven lines later and this was not among them, so the
document contradicted itself and read as correct anyway, because nobody reads two
paragraphs of the same file against each other.

**A permanent state waking a poll loop is a bill, not a fix.** Unlike an unanswered
item, which stops being reported the moment it is answered, `ended_at` never clears.
Wake a relaunching monitor on it with no memory and it surfaces the state, exits, is
relaunched, surfaces it again, forever, spending a model turn every time round. The
naive fix for the silence is a worse bug than the silence.

## Why

Work queues self-clear and lifecycle states do not. An item leaves the ready list
when it is answered, so "report everything ready" is a safe rule for a watcher: the
act of handling it is what makes it stop. A lifecycle fact like "ended" has no
handling that erases it, so the same rule turns into an unbounded loop, and the
obvious guard against the loop is to stay silent, which is where the original bug
came from.

## What to do instead

**Give the state its own line, and never infer it from a count.** Report the fact
itself (`ended_reviews` in the JSON summary, a named line in the human listing), so
the reader is not asked to distinguish two states from one number. Do not let a
`--quiet` mode that means "nothing is waiting" decide on behalf of a state that is
not a queue.

**Make the delivery idempotent where the loop lives, not where the state lives.**
The state stays true forever; what must happen once is the telling. Record that it
was told, keyed by the thing that ended, in the watcher's own directory:

```
<state-dir>/agent-sessions/<session-id>/ended-delivered.log
```

Only the relaunching watcher marks it. A person or agent running the drain by hand is
always told, because whoever was just woken has to be able to ask why.

**Check both directions on a signal change.** Ask what happens if the signal never
fires, and ask what happens if it fires on every poll for the rest of the session.
The first is silence and the second is a bill, and a change that fixes one commonly
creates the other.

**When a contract sentence describes behavior, grep for the code that performs it.**
Not the constant it names, the write. `grep -rn "appendSessionEvent\|appendWork" src/`
answers "what actually appends to this feed" in one line, and a promise with no
matching writer is a promise that has never been kept.
