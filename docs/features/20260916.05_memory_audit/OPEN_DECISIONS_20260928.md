# What I still need from you

**Project:** LAHE, the live agentic HTML editor. **Feature:** the performance and token work (the memory audit), which began 2026-09-16 after Claude Code kept stopping LAHE monitors for low memory. Its hub is [the memory audit page](MEMORY_AUDIT_20260916.md).

**Short version:** one call on the wake banner, two small goes, and one read. The auto-answer docs come to you when they are all written.

## Still open

1. **The banner an agent sees on every wake.** Each time an agent is woken it gets: "LAHE ACTION REQUIRED: do not end this turn or report that work is ready. Handle every item below now, rebuild and verify visible output, append replies, drain status until empty, then relaunch..." It exists because agents, Codex especially, used to announce that work had arrived and stop without doing it. It is also instruction text repeated on every wake. The suggestion: cut it to "LAHE ACTION REQUIRED: handle these now, do not end the turn." plus the two commands the agent needs. Cut it, or keep it? The auto-answer work below may make this moot for Claude.

2. **Two goes, both small.**
   - **The browser keeps an old copy of your comments** from before last week's fix. Nothing writes to it; the page only reads it once on load. This deletes it the next time you open each review. No other agent has done it.
   - **A page can tell the agent which file to edit.** The helper still accepts a "the source is X" note from anything holding a review's key. The fix makes it refuse that from a browser. No other agent has done it.

3. **A read, not a decision:** the subagent pool proposal on the memory audit hub (item 13).

4. **Coming to you when finished, not yet:** the full doc set for auto-answer, the headless LAHE agent. Crucible, brief, wireframes and a real test run are done; the architecture is being written, then the plan. You asked not to be stopped until all of it is written.

## Done since this page was written

- **The old logs are trimmed:** 735 million bytes down to 77 million, with only the helper paused for 33 seconds. The five image records store their image once.
- **Selecting the whole page** highlights the whole page again. A selection has to cover 90% of what it sits in to count as whole. Merging now.
- **A visible page you have not clicked** makes 132 requests an hour, down from 600.

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
