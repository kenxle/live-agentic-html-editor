# Checkpoint 2026-09-16: three branches ready to merge

Branch `integration-20260916` holds three builder branches merged onto main with no conflicts. The full gate ran once on the merged result: lint, 1,086 unit tests, 376 browser tests, all green. Nothing is on main yet. This page is the ask: say merge, or say what to change.

## What is in it

| Branch | What it does | Review verdicts | Fix round |
| --- | --- | --- | --- |
| Outbox coalescing | One content event per item per revision in the browser outbox instead of one per keystroke; outbox and item list cached in memory with a cross-tab stamp; a full browser storage no longer breaks typing | Code-lead: merge with fixes. Adversary: no blocker, two confirmed defects | All eight items fixed, tests red then green |
| Layer retention | Releases per-record DOM references in replay, comments, editing; conflict node handed back to the card; window listeners removed on unmount; status history capped; announced ids forgotten when a record leaves the review | Code-lead: do not merge (two blockers). Adversary: three blockers | All ten items fixed or argued, tests red then green |
| Static-site folder | `lahe review <folder>` serves the folder and puts the rail on every page under it as one review; pages reload after an edit like single pages; status says `unserved` when the server is down | Code-lead: two fixes needed. Security: nothing blocks, one widening flagged | All eight items fixed, unit-tested; browser spec passed at the checkpoint |

## Decisions I made that you should know about

- **The rail goes on every page only when you reviewed a folder, not when you reviewed one file.** Example: `lahe review ~/Desktop/report.html`. To serve that one file, LAHE starts a small server on the Desktop folder, because that is where the file lives. Under "everything our server serves gets the rail," every other HTML file on your Desktop would also have gotten the rail and a live review token, just because they happened to sit next to the file you named. That seemed wrong. So: `lahe review <folder>` puts the rail on every page in the folder; `lahe review <file>` puts it on that file only, as before. If you did want the folder-wide behavior for a single file too, it is a one-line change.
- **The keystroke fix, in plain words.** Today, every keystroke you type into a comment is sent to the helper as its own message, and each message carries the whole comment. That is where the 654 MB of logs came from. The fix: while you are still typing, each new keystroke replaces the unsent message for that comment instead of adding another one. So the helper gets one message per pause, not one per key. The one rule the builder added on top: when you press Cmd-Enter, or reword a comment the agent already answered, that is a new version of the comment, and messages from different versions are never merged into each other. The helper needs to see each version arrive in order to keep the conversation on the card straight. Typing does not create a new version, so nothing about the saving changes.
- **The page keeps remembering where a handled comment was.** The Done tab has a click that scrolls you to the passage a finished comment was about, and that needs the page to remember which element it was. The builder kept that memory for finished comments and only forgets an element when the comment is deleted or the page has redrawn and that element no longer exists, which is where the leaked memory was.
- **One thing the audit called a leak is not one.** The list of pop-up notices the rail has already shown grows by one short entry per notice and is never emptied. The audit flagged that. The builder showed it is the rule that stops a notice you dismissed from popping up again, and that a new reply on the same comment still gets its own notice. Left as is; the audit page is corrected.
- **The folder review's no-reload caveat was removed by building reload** instead of documenting it. Writing that test found a cache-key bug that would have made page two reload on page one's edit.

## What the reviews caught that a green gate did not

- A freshly created element-picked comment would have been marked lost by the next replay pass (stale item cache).
- A resolved conflict node stayed in the rail's card list and came back on remount.
- The conflict stylesheet lived in the first conflict node, so removing it unstyled any other live conflict.
- "Gone from the review" was computed as "not on this page," so a multi-page walk forgot page A's replies.
- A nested folder review would have silently taken over the parent folder's pages.
- The recorded-page branch had no session filter although the comment above it claimed one.
- Writing the cross-tab stamp before the list let another tab cache a stale list.
- A refused record write still posted the newer record, so a reload could roll the helper back.

## Two docs that should move

- `docs/ongoing/OUTBOX_COALESCING.md` is the first written description of the browser store and outbox. It belongs as the store's ongoing doc, not just this change's note.
- The replay retention rules (which bindings live, which are released, and why) are written only in the audit page's progress entries and the code. They deserve their own ongoing doc.

## Not in this checkpoint

- Fix 2 from the audit, the helper re-reading the whole log per projection. Still only written down.
- Compacting or archiving the 654 MB of closed review logs.
- Closing stale agent sessions and their static servers.
- The wireframing skill guidance row.
