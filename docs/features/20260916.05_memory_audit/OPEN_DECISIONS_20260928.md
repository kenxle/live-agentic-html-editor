# What I still need from you

**Short version:** one time slot, three small calls, two goes, and one read.

## Still open

1. **When can I stop LAHE for a minute to trim the old logs?** The trimmer is built, reviewed twice and tested on a copy of your data: 734 million bytes down to 79 million, with nothing you committed touched. To run it, the helper and every page server have to be stopped, including other agents' open sessions, and started again after. Open review pages lose their connection for that minute. Tell me a time, or "now".

2. **The banner an agent sees on every wake.** Each time an agent is woken it gets: "LAHE ACTION REQUIRED: do not end this turn or report that work is ready. Handle every item below now, rebuild and verify visible output, append replies, drain status until empty, then relaunch..." It exists because agents, Codex especially, used to announce that work had arrived and stop without doing it. It is also instruction text repeated on every wake, which is what you asked us to avoid. The reviewer's suggestion: cut it to "LAHE ACTION REQUIRED: handle these now, do not end the turn." plus the two commands the agent needs. Cut it, or keep it?

3. **Five old records store an embedded image three times.** New records no longer do this. Those five can be rewritten safely to store the image once. Every other old oversized record is mostly draft snapshots, which the log trim removes. Rewrite the five, or leave them?

4. **Selecting across the whole page.** That used to paint the entire page as the comment's spot. Now such a pick is marked as lost rather than painting everything. The alternative is to turn it into a note about the page as a whole. Which do you want?

5. **Two goes.** Both came out of this week's reviews.
   - **The browser keeps a second, old copy of your comments** from before last week's fix. Nothing writes to it any more. This deletes it the next time you open each review.
   - **A page can tell the agent which file to edit.** The fix makes the helper refuse that from a browser, so only the lahe command can name the file.

6. **A read, not a decision:** the subagent pool proposal on the memory audit hub (item 13).

## A correction

I told you a page you can see but have not clicked would cost about 240 requests an hour. The builder measured it: 600 an hour, because the liveness line refreshes too. Background tabs drop from 720 to 12 an hour, and the page you are working in is unchanged.

## Needs a spec before code

- **Send only what changed in a draft.** You approved it. It changes how the log is written, so I will bring you a spec first.

## Decided today

- **Quiet tabs:** full speed in the tab you are in, every 15 seconds for a page you can see but have not clicked, a 5 minute heartbeat for background tabs and other desktops. In its last review.
- **Page servers stop** once no browser window is open on a session's pages, after a two minute grace. Builds after quiet tabs.
- **What agents re-read on every check** is trimmed. At 1,000 items a check drops from 1,045,909 bytes to 870,265, and no rule text repeats. In the final test run.
- **Rewording a refused edit** stops sending every pause. In the final test run.
- **Bold and italic survive** when LAHE writes one paragraph on its own. In the final test run.
- **Hidden files** are treated like any other file everywhere. In the final test run.
- **The "done" check works per edit.** Building.
- **The three oversized records** are fixed for new records. In review.
- **Keep mine on an edit spanning several blocks** stays as is unless it bites.
