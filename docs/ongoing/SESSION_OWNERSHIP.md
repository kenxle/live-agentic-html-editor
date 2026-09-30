# What the tool guarantees when a session changes hands

A LAHE agent session can move from one agent to another. The human asks for it,
and the new agent runs `lahe session takeover <id>`. This page says what the
tool keeps true during that handoff. None of it is something an agent has to
do: these are promises the tool makes, so the skill leaves them out.

The shape of ownership and takeover is drawn in
`docs/diagrams/session_ownership.md`.

## The guarantees

- **The old agent ran out of tokens after it saw some work.** It may have read
  items it never finished. An item stays listed until a reply lands, so every
  item still unanswered reaches the new agent.
- **The old app closed or crashed without closing LAHE.** The session and its
  reviews are on disk and stay there. Takeover reopens the session and its
  servers if they were closed, and it does not need the old app to take part.
- **The old agent finished some items.** The catch-up command lists only
  unanswered `ready` items. Handled work stays in the history and is not done
  twice.
- **The session holds several reviews or documents.** The whole session moves
  together, with every review, page, token, comment, reply, and server address
  kept.
- **An old monitor process is still running.** Takeover raises the session's
  handoff number. The old monitor checks that number on its next look, throws
  away what it had read, and exits with code 6 before it can wake the old agent.
  A `takeover` line lands in the wake feed at the same moment.
- **Feedback arrives during the handoff.** Catch-up reads what is on disk right
  now, and reading an item does not mark it seen, so nothing that lands at the
  boundary is skipped.
- **Nobody has had a page open for two minutes.** The helper stops the
  session's page servers and leaves the session open. The monitor keeps
  running and the wake feed gets nothing. `lahe review <document> --session
  <id>` brings a page back, on its old port when it is free, and `lahe status`
  names that command. A takeover restarts the servers as before.
- **Nobody asked for a handoff.** The tool refuses to attach a page or a review
  to a session that does not own it. Takeover is the one way across, and the
  skill tells agents to run it only when a human asks.
- **A review from before sessions is picked up in the Library.** It belongs to
  no session, so nothing is taken from another agent. The pick-up adopts it
  into the agent's own session with its old comments, once, and records a
  `review.adopted` event. This needs a Library pick-up of that review pending
  for that session, and the helper checks that again. A review that already
  belongs to a session is never adopted. See `docs/ongoing/LIBRARY.md`.
