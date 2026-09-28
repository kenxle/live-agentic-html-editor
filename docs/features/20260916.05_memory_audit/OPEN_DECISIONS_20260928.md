# What I still need from you

**Short version:** one go, two quick confirms, and one read. Everything else you already decided.

## Still open

1. **Go on the seven ready items?** Each has an obvious right answer or one you already gave. Say go and I start them all, in parallel, each with its own tests and one code review.
   - **Trim the drain** to only the comments, and stop it repeating every ended review. You decided this on 2026-09-16.
   - **A refused edit being reworded** stops going to the helper at typing speed.
   - **A page cannot tell the agent which file to edit.** Found in the linked-docs security review.
   - **Bold or italic survives** when LAHE writes one paragraph of your edit on its own.
   - **The "handled" check looks at the item**, not the whole review. Today one write anywhere disarms it for every item.
   - **The three oversized records**, using the direction you set: the element's opening tag, stored once, never truncated.
   - **Delete the old browser copy** the draft fix left behind.

2. **Stop the servers, or close the whole session?** You said to close a session once no browser window is open on its pages. I plan to stop its page servers but leave the session open, because closing a session tells its agent to stop watching for good. Reopening the page through the agent or the doc index brings the server back either way. Confirm, or tell me to close the whole session.

3. **Hidden files next to a linked document.** Hidden files stay served in any folder you open for review. The one place they are refused is a folder a document merely links to, which you never chose to open. Keep that refusal, or drop it too?

4. **A read, not a decision:** the subagent pool proposal on the memory audit hub (item 13). It keeps a few helpers warm instead of starting a fresh one for every medium-size job.

## Needs a spec before code

- **Send only what changed in a draft.** You approved it. It changes how the log is written, so I will bring you a spec first.

## Decided today, and building

- **The tab you are looking at** stays at full speed. **Unfocused or hidden tabs** stop checking and send a "still open" heartbeat every 5 minutes. Coming back checks at once. Closing says goodbye. Typing never triggers extra work.
- **Old logs:** drop only the draft snapshots that a later copy of the same comment replaced. That is 625.3 MB of 699.9 MB. Each review's summary is proven identical before its file is swapped, and a compressed copy of each original is kept until cleanup.
- **Hidden files** in a folder you open for review stay served.
- **Keep mine on an edit spanning several blocks** stays as is unless it bites.
