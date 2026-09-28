# LAHE: the 2026-09-16 merge record

This page is the record of what merged on 2026-09-16 and why. The one page to follow for progress on all of the performance and token work is `docs/features/20260916.05_memory_audit/MEMORY_AUDIT_20260916.md` (LAHE: performance and token work). Nothing here is updated any more.

Three changes are built and tested. Ken said merge on 2026-09-16, and they are on main. The full test run passed on all three together: 1,091 small tests and the full browser suite.

## The three changes, in one line each

| Change | What you will notice |
| --- | --- |
| Less chatter per keystroke | Typing a comment used to send one message per key. Now it sends one per pause. The pile of logs on disk stops growing so fast. |
| The page lets go of old memory | A page left open for hours used to keep small scraps of memory about comments that were long finished. Now it lets them go. |
| The rail follows you through a folder | Point LAHE at a folder of pages and the comment rail shows up on every page in it, and follows you as you click around. |

## How each one was checked

Each change was built by one agent, then read by two other agents whose only job was to find problems. They found real ones, listed below. The builder fixed every one, and wrote a test for each fix that fails without the fix and passes with it. Then all three changes were merged together and the whole test suite was run once.

## Decisions I made that you should know about

- **The rail follows links everywhere, and you can opt out.** You said the rail should follow you into anything you can click on. It now does, whether you pointed LAHE at a folder or at a single file. If you want the rail on one file only (say the file sits in Downloads next to a lot of unrelated pages), add `--only` to the command. One thing to know: `--only` cannot be switched back off for that review, on purpose, because the same switch is reachable from a page's own scripts and "show me more pages" is what a hostile page would ask for. To go wide again, start a new review.
- **Nothing is written to your files up front.** The rail is added to each page as it is served to the browser. No file on disk is touched, and a page you never open costs nothing.
- **Typing does not make a new version of a comment; Cmd-Enter does.** Keystrokes are merged into one message per pause. Pressing Cmd-Enter, or rewording a comment the agent already answered, counts as a new version, and versions are kept separate so the conversation on the card stays in order.
- **The page keeps remembering where a finished comment was.** The Done tab can scroll you back to the passage a finished comment was about. That memory is kept on purpose. It is dropped only when the comment is deleted, or the page redraws and that passage is gone.
- **One thing the audit called a leak turned out to be on purpose.** The rail keeps a short list of pop-ups it has already shown, so a pop-up you dismissed does not come back. That list grows a little and is never emptied. That is the rule working, not a leak. The audit page now says so.

## What the checkers caught that the tests did not

All of these are fixed. In plain words:

- A brand-new comment on a picture or chart would have been marked "lost" a moment after you made it.
- A "your version or theirs" card that you resolved would have come back, hidden, the next time the rail redrew.
- Resolving one of those cards would have left any other one on the page without its styling.
- On a site with several pages, walking from page A to page B and back would have made the rail forget which replies on A it had already told you about.
- Pointing LAHE at a folder inside a folder you were already reviewing would have quietly taken over the outer folder's pages.
- A check that was supposed to keep one agent's review out of another agent's pages was written in a comment but not in the code.
- Two browser tabs on the same review could have ended up with one tab showing stale comments.
- When the browser's storage was full, a keystroke could have been sent to the helper but not saved locally, so a reload would have lost it.

## Two write-ups that should become permanent docs

- The builder wrote the first plain description of how the browser stores comments before sending them. It should live with the other "how this works" docs, not just as a note on this change.
- The rules for what the page remembers about each comment, and when it forgets, are only in the code and in the audit page. They deserve a doc of their own.


## Merged

2026-09-16: merged to main after the final test run, helper restarted.

## Not in this checkpoint

- The helper still re-reads a review's whole history every time it rebuilds the summary file. That is the next big saving and is only written down so far.
- Cleaning up the 654 MB of old review logs.
- Closing old agent sessions and the little servers they left running.
- Better guidance for the wireframing skill.
