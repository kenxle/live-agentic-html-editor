---
title: The agent reading a drain did not write every agent turn in it
category: service
symptoms: [a drain item whose note reads like an answer with no question visible, "the reviewer says yes, the second one, to what", follow-up refers to a reply the agent cannot see, taken-over session missing earlier answers, catch-up did not show an item, dropping agent text from the drain loses context]
applies_to: [src/cli/commands/status.js, src/shared/record.js, src/service/agent_sessions.js, src/shared/review_format.js]
first_seen: 2026-10-17
confirmed: 2026-10-17
status: live
---

## What happens

A trim to the drain (`lahe status --json --quiet`) leaves out the agent's own words
from each item's `thread`, on the idea that the agent wrote them and still has them.
Two kinds of item then reach the agent with half a conversation.

- The reviewer answers the agent's question. The drain shows `note: "Yes, the second one"`
  and an agent turn of `{status: "question"}` with no words. The question is gone.
- A new agent takes the session over. Later the reviewer follows up on a card the old
  agent answered. The new agent sees the reviewer's follow-up and none of the replies
  it is following up on.

## Why

"The agent has its own words" is false in two places. When the reviewer answers,
`continueThread` (`src/shared/record.js`) archives the whole round into `thread` and
clears `reply`. The question the agent is being answered about now lives only in
`thread[last].agent.text`. And the takeover catch-up (`lahe status --session <id> --json`)
lists only `ready`, unanswered items. An item that was waiting on the reviewer at
takeover time is not in it, so the new agent never read those turns.

## What to do instead

Before dropping anything from the drain, ask who is reading it, not who wrote it.
Keep an agent turn's words when either is true:

- it is the thread's last turn and its status is `question`, because the reviewer's
  current note answers it;
- its `at` is earlier than the session's `taken_over_at`, because the agent reading
  the drain did not write it.

`withoutAgentWords` in `src/cli/commands/status.js` does both. Proofread
`suggestions` also stay, because the contract tells the agent to read the fixes there.
The contract tells the agent to run the catch-up once after a compaction, so
anything else it needs is one command away.
