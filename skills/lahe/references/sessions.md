# Sessions and handoffs

### More than one page or document

Add a page to your workstream with:

```sh
lahe review path/to/another.html --session <session-id>
```

A distinct deliverable, such as a one-pager beside a full report, gets its own
review this way. Use `--review <id>` only to put a page back on the review it
already belonged to, usually after a rebuild. Each page shows the reviewer only
its own items; `lahe status` and `review.json` show all of them.

When you move or rename a reviewed file, run
`lahe review <new path> --session <session-id> --review <review-id>` and hand
over the new link, so its comments follow it. Start a new review instead only
when the reviewer asks for a fresh start.

A page already under its own review keeps it when you later review its folder.
Two reviews over one folder is legal, and it is where a reply lands on the wrong
card.

### Sessions

A LAHE agent session is this tool's own workstream record, with an id like
`s_0e28da9885a6d67a`. It is not a Claude session, not a terminal session, and
not a browser session. Pass it with `--session` whenever you open another
document or monitor. Watch the session, never one review and never the machine:
that covers reviews you add later and nobody else's.

### Take over a session

When the human says "claim the lahe session(s)" or "take over the lahe
session(s)", run `lahe session list`. It is read-only. If more than one session
is open, ask the human which id or ids they mean. Then:

```sh
lahe session takeover <id>
```

This moves the whole session to you with every review intact, stops older
monitors, and reopens anything closed. Run the printed catch-up command first: it
lists every unanswered `ready` item, including work the previous agent saw and
never finished. Then arm your wake channel.

Take over only on an explicit request. A takeover of a session whose
agent is listening right now is refused from the command line: that handoff is
confirmed by your human from the Library page, and the request it makes is
what you pass as `--request <request>`.

An idle-looking agent is not permission. When asked, run the takeover command;
never silently reuse the old session.
When `lahe review` reports another session's review, ask your human.

To start over on your own review, retire it first with
`lahe review retire <review-id> --session <agent-session-id>`.
`--new` and `--new-session` cannot make a second review of that file.

For a Library pickup or launch request, read [Library](library.md).
