# Review controls

The reviewer manages the review from the rail: closing a card themselves,
holding messages back while they work, and ending the review when they are
done. Each of these changes what the agent sees.

## Sub-features

- `control-mark-done`: the reviewer closes an outstanding card; it moves to Done and leaves the agent's drain.
- `control-hold`: while held, new comments stay in the browser; releasing sends them.
- `control-end-review`: ending the review shows up in the agent's status as an ended review.

## How to get to it (user POV)

- Click a card's state chip (for example "Open"), then "Mark as done". The Done tab shows it.
- Click "Hold sending messages" at the bottom of the rail. Click "Send N held messages" to release.
- Click the exit icon ("End this review and perform cleanup"), then "End review". "Keep reviewing" backs out.

## Driving it with lahe-verify

Preconditions:

- A fresh run on the sample document with at least one outstanding item (a page note is quickest; see [comments](reviews-and-comments.md)).

- **Mark as done.** Run `lv page click "rail-text:thread actions"` then `lv page click "rail-text:Mark as done"`. `lv page wait "window.__lahe.items()[0].state==='handled'"` passes and `lv agent drain` prints nothing for it.
- **See it in Done.** Run `lv page click "rail:[data-tab=done]"` and `lv page shot done`. The card reads "You marked this done." with a DONE chip.
- **Hold.** Run `lv page click "rail-text:Hold sending messages"`. `lv page rail` shows the control now labelled "Send messages live" with `aria-pressed: true`.
- **Comment while held.** Make a comment as in [comments](reviews-and-comments.md). `lv agent wait "<its text>" --timeout 6000` fails: the agent does not have it. The rail shows "Send 1 held message".
- **Release.** Run `lv page click "rail-text:Send 1 held message"`. `lv agent wait "<its text>"` now passes.
- **End the review.** Run `lv page click "rail-text:End this review"`, then `lv page click "rail-text:End review"`. `lv agent status` ends with `ended_reviews` naming this review and `unanswered_kept`.
- **Proof.** Screenshots of the Done tab and the held rail, plus the drain and status lines.

## Gotchas

- The chip's label changes with state ("Open", "Question", ...), so match "thread actions", which every chip label ends with.
- The release button's label counts the held messages; match the number you expect.
- Ending a review keeps its history. The session stays open until the agent closes it.
- Regression specs: `mark_done.spec.js`, `end_review.spec.js`, `rail_hold.spec.js`.
