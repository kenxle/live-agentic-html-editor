# What I still need from you

**Short version:** three leftovers that need a go, two quick calls, and one read. Everything else you already decided.

## Still open

1. **Three leftovers from this week's code reviews.** These came from reviewers, not from you, so here is what each one means. Say go on any of them.
   - **The browser keeps two copies of your comments.** Last week's typing fix changed how the browser stores comments: one entry per comment instead of the whole list rewritten on every keystroke. For safety it kept each review's old whole-list copy too, so every existing review is stored twice. This deletes the old copy once the new one holds everything.
   - **A page can tell the agent which file to edit.** Any page carrying a review's key can send a note saying "the source file is X". The agent trusts it. A script inside a reviewed page, such as an analytics tag, could point the agent at a different file. The fix: only the command line may say where the source is, never the page.
   - **The "done" check covers the whole review, not each edit.** When an agent says an edit is done but changed nothing, LAHE keeps the edit open. But it asks whether anything in the document changed, not whether that edit did. So an agent that fixes one of five edits and says done to all five slips four past it. The fix asks per edit.

2. **Hidden files next to a linked document.** Hidden files stay served in any folder you open for review. The one place they are refused is a folder a document merely links to, which you never chose to open. Keep that refusal, or drop it too?

3. **A read, not a decision:** the subagent pool proposal on the memory audit hub (item 13). It keeps a few helpers warm instead of starting a fresh one for every medium-size job.

4. **A page visible next to the terminal.** The quiet-tab change is built. It cuts an unfocused tab from 3,960 requests an hour to 12. The catch: a review page you can see beside the terminal, but have not clicked into, counts as unfocused, so a reply only appears once you click into it. Two ways to go:
   - **Keep it as built.** Click the page to see replies.
   - **A middle speed for a visible page.** A page you can see but have not clicked checks every 15 seconds, and only a hidden page goes fully quiet. That costs about 240 requests an hour per visible page instead of 12.

## Needs a spec before code

- **Send only what changed in a draft.** You approved it. It changes how the log is written, so I will bring you a spec first.

## Decided today, and building

- **Trim what agents re-read on every check**, holding to your rule that nothing instruction-like repeats.
- **Rewording an edit the agent refused** stops sending every pause to the helper.
- **Bold and italic survive** when LAHE writes one paragraph of your edit on its own.

- **Page servers stop** once no browser window is open on any of a session's pages, after a two minute grace. The session stays open so its agent keeps watching.
- **The three oversized records** are being fixed, and the old ones measured before any cleanup.

- **The tab you are looking at** stays at full speed. **Unfocused or hidden tabs** stop checking and send a "still open" heartbeat every 5 minutes. Coming back checks at once. Closing says goodbye. Typing never triggers extra work.
- **Old logs:** drop only the draft snapshots that a later copy of the same comment replaced. That is 625.3 MB of 699.9 MB. Each review's summary is proven identical before its file is swapped, and a compressed copy of each original is kept until cleanup.
- **Hidden files** in a folder you open for review stay served.
- **Keep mine on an edit spanning several blocks** stays as is unless it bites.
