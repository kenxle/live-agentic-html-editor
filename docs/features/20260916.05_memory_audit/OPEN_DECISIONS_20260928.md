# What I still need from you

**Short version:** one go, two quick calls, and one read. Everything else you already decided.

## Still open

1. **Go on the six ready items?** Each has an obvious right answer or one you already gave. Say go and I start them all, in parallel, each with its own tests and one code review.
   - **Trim the drain** to only the comments, and stop it repeating every ended review. You decided this on 2026-09-16.
   - **A refused edit being reworded** stops going to the helper at typing speed.
   - **A page cannot tell the agent which file to edit.** Found in the linked-docs security review.
   - **Bold or italic survives** when LAHE writes one paragraph of your edit on its own.
   - **The "handled" check looks at the item**, not the whole review. Today one write anywhere disarms it for every item.
   - **Delete the old browser copy** the draft fix left behind.

2. **Hidden files next to a linked document.** Hidden files stay served in any folder you open for review. The one place they are refused is a folder a document merely links to, which you never chose to open. Keep that refusal, or drop it too?

3. **A read, not a decision:** the subagent pool proposal on the memory audit hub (item 13). It keeps a few helpers warm instead of starting a fresh one for every medium-size job.

4. **A page visible next to the terminal.** The quiet-tab change is built. It cuts an unfocused tab from 3,960 requests an hour to 12. The catch: a review page you can see beside the terminal, but have not clicked into, counts as unfocused, so a reply only appears once you click into it. Two ways to go:
   - **Keep it as built.** Click the page to see replies.
   - **A middle speed for a visible page.** A page you can see but have not clicked checks every 15 seconds, and only a hidden page goes fully quiet. That costs about 240 requests an hour per visible page instead of 12.

## Needs a spec before code

- **Send only what changed in a draft.** You approved it. It changes how the log is written, so I will bring you a spec first.

## Decided today, and building

- **Page servers stop** once no browser window is open on any of a session's pages, after a two minute grace. The session stays open so its agent keeps watching.
- **The three oversized records** are being fixed, and the old ones measured before any cleanup.

- **The tab you are looking at** stays at full speed. **Unfocused or hidden tabs** stop checking and send a "still open" heartbeat every 5 minutes. Coming back checks at once. Closing says goodbye. Typing never triggers extra work.
- **Old logs:** drop only the draft snapshots that a later copy of the same comment replaced. That is 625.3 MB of 699.9 MB. Each review's summary is proven identical before its file is swapped, and a compressed copy of each original is kept until cleanup.
- **Hidden files** in a folder you open for review stay served.
- **Keep mine on an edit spanning several blocks** stays as is unless it bites.
