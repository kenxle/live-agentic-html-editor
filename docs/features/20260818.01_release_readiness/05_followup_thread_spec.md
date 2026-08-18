# Answered-comment follow-up specification

## Problem

An answered item is not currently a conversation. The record holds one
reviewer turn and one agent reply.

- `Reopen` increments the revision, returns the old request to Active, and
  clears the visible reply.
- A question's `Answer` control opens the original note editor, prefilled with
  the original request. Typing there rewords that request instead of adding a
  response.

Both paths destroy conversational context. A reviewer who received a useful
answer has no honest way to continue the same thread.

## Product behavior

Every item with an agent response offers a blank `Follow up` composer.

- Opening the composer changes no record state, revision, count, highlight, or
  reply.
- The earlier reviewer turn and agent response remain visible and immutable.
- Follow-up draft text is written synchronously to browser storage and survives
  reload, but does not reach `review.json`, status, export, or the agent until
  the reviewer submits it.
- Cmd/Ctrl-Enter submits nonempty text. Empty submission changes nothing.
- Submission appends the completed exchange to the item's history, increments
  the revision once, makes the follow-up the current reviewer turn, clears only
  the current-revision reply, and returns the item to `ready`.
- The ordinary ready-item event carries the new revision. No second reply-file
  or event protocol is introduced.
- The thread returns to Active and becomes new work for the owning agent
  session.

Agent replies with `handled`, `not_handled`, or `question` all use the same
continuation behavior. A question's `Answer` control opens this composer.

## Reopen versus follow up

`Follow up` means the reviewer has something new to say. It uses the text they
submit as the current instruction.

`Reopen issue` remains a separate secondary action for the case where the
original requested change did not land. It archives the previous exchange,
increments the revision once, and resubmits the same reviewer request without
discarding the answer that preceded it.

Neither action silently overwrites the first reviewer turn or agent response.

## Record model

Add an append-only `thread` array to each item. Legacy items default to an empty
array. Each completed round contains:

```json
{
  "rev": 1,
  "reviewer": {
    "note": "Shorten this paragraph.",
    "change": null,
    "at": "2026-08-18T12:00:00.000Z"
  },
  "agent": {
    "status": "question",
    "agent": "codex",
    "reason": null,
    "text": "Which paragraph ending should remain?",
    "files": [],
    "at": "2026-08-18T12:01:00.000Z"
  }
}
```

Top-level `note` and `change` remain the current actionable reviewer turn.
Top-level `reply` remains the response to the current revision. This preserves
the existing status and reply-file rules.

Follow-up drafts live in a separate versioned, review-scoped browser-storage
bucket. They are not record fields and are never projected to an agent.

## Trust and projection

Only the current top-level `note` and `change` are instructions. Prior thread
rounds are historical context. The contract and field classes must state that
distinction so an agent does not repeat an older request.

`review.json`, JSON export, and text export include the completed thread in
chronological order, followed by the current turn and current reply. Historical
reviewer text is preserved in full under the same authored-text limits as the
current note.

The projected review schema increments because its shape and trust classes
change.

## Revision and merge rules

- Starting or typing in a follow-up draft does not change the item revision.
- Submitting or reopening unchanged increments it exactly once.
- A reply naming an earlier revision remains stale and cannot retire the new
  work.
- Same-revision competing replies retain the existing deterministic winner and
  do not create duplicate historical rounds.
- Browser-newer merges preserve the thread and the private follow-up draft.

## Acceptance tests

1. A handled item shows a blank composer while the original request and answer
   remain visible.
2. A question's `Answer` control uses the same composer and preserves the
   question.
3. A `not_handled` response can be continued the same way.
4. A reload during follow-up drafting restores the draft without exposing it to
   the agent.
5. Empty submission creates no event and no new work.
6. Submission increments the revision once, returns the item to Active, and is
   emitted by status as new work.
7. An old-revision reply cannot retire the follow-up; the new-revision reply
   can.
8. A second exchange renders four chronological turns without duplicating or
   erasing any earlier turn.
9. `Reopen issue` resubmits the original request while retaining its prior
   response in history.
10. Copy, text export, and JSON export include the complete chronological
    conversation.

