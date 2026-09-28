# What I need from you on the open items

**Short version:** five calls are yours. Seven more items need nothing from you, and I'd start them as soon as you say go. One needs a spec before anything else.

Answer on the cards. A word per bullet is enough.

## Your calls

1. **How slow can a quiet tab be?** This is the battery fix (GitHub issue 16). An open review tab asks the helper for news every second. The fix is to slow down when nothing is happening and speed back up the moment you type or an agent replies. The cost: while a review is quiet, an agent's reply can take longer to appear. My recommendation is up to 15 seconds after a minute of quiet, and back to instant as soon as anything moves. Say a different number if 15 feels wrong.

2. **Stop page servers nobody is using?** 58 were running from finished sessions, holding 711 MB. My recommendation: a page server stops itself after an hour with no page requests, and starts again the moment you open its link. Nothing is lost; the review history stays on disk.

3. **Close agent sessions that have gone quiet?** Separate from the servers. My recommendation: a session with no agent activity for 7 days closes itself, with history kept. You can reopen any of them.

4. **Old logs: 654 MB on disk.** Nothing in them is ever deleted, per your no-truncation rule. The choice is between compressing reviews that ended more than 30 days ago (they shrink a lot and stay readable), or leaving them alone. My recommendation is compress.

5. **Hidden files inside the folder under review.** A page server hands out a hidden file like `.env` if it sits in the reviewed folder. My recommendation: refuse every hidden file and folder except `.well-known/`, which some sites legitimately need.

Also waiting on your read, not a yes or no: **the subagent pool proposal** on the memory audit hub (item 13, keeping a few helpers warm instead of starting fresh ones each time).

## Ready to build, nothing needed from you

These are fixes with an obvious right answer, or ones you already decided.

- **Trim the drain.** You decided on 2026-09-16 that it carries only the comments. It also stops repeating every ended review on each run.
- **A refused edit being reworded** no longer goes to the helper at typing speed.
- **A page cannot tell the agent which file to edit.** Found in the linked-docs security review. The page can only report what it is, never name a file.
- **Bold or italic survives** when LAHE writes one paragraph of your edit on its own.
- **The handled check looks at the item, not the whole review.** Today one write anywhere disarms it for every item in the review.
- **The three oversized records**: the rest of the page saved as context, an embedded image stored three times, and a highlight that covers the whole page. You already set the direction: use the element's opening tag, store it once, and never truncate.
- **Delete the old browser copy** that the draft fix left behind, in the next release.

## Needs a spec first

- **Send only what changed in a draft.** You approved it. It changes how the log is written, so the spec comes before the code.

## Left alone unless it bites

- **Keep mine on an edit that spans several blocks** merges them into one. Nothing is doubled, and a reload restores the structure.
