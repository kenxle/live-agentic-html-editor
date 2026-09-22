# Stop writing unsent drafts so often

Whetstone-size. Part of the [performance and token work](../../ongoing/MEMORY_AUDIT_20260916.md). The analysis behind it, and Ken's decisions, are in [where unsent comments are saved](../../ongoing/DRAFT_PERSISTENCE.md). Progress is at the bottom.

## Summary

While you type an unsent comment, LAHE saves it far more often than it needs to: the browser rewrites every comment on every keystroke, the helper gets a copy about once a second, and each of those copies makes the helper rewrite and force to disk a file agents read, even though drafts never appear in it. This change keeps every protection you asked for and removes the waste. Your typing is still saved in the browser on every keystroke.

## Requirements

1. **The helper stops rewriting `review.json` when nothing in it changed.** A draft save no longer rewrites or flushes that file. It is still rewritten, safely and in full, whenever anything an agent can see changes. (Analysis option d1.)
2. **The browser stops rewriting every comment on every keystroke.** A keystroke saves only the comment being typed. The saved format stays readable by older tabs on the same review until they reload, or the old keys are migrated once. The two-tab safety check from the outbox work covers the new keys. (Option d2.)
3. **The browser still saves every keystroke.** Requirement R1 (nothing you type is lost to a reload, tab close, or navigation) still holds, from browser storage alone.
4. **Unsent drafts go to the helper rarely.** At most once every 10 seconds while typing, plus the risky moments: leaving the comment box, hiding the tab, and leaving the page. Never once per pause. Ken: losing a few seconds of typing to a computer crash is acceptable. (Option c with Ken's floor.)
5. **A pause is a real pause.** After a post finishes, anything queued during it waits its turn instead of posting at once. (Option d4, first half; `sync.js` around line 1829.)
6. **Typing into a reopened edit does not mark it ready.** A hand edit you reopen is withdrawn while it is open, the way comments already are, and becomes ready again only when you commit it. This closes a likely hole in R7 (you decide when something is ready). (Option d4, second half.)
7. **Committed work is unchanged.** Pressing Cmd-Enter, releasing Hold, and ending a review still send immediately.

## Approach

No new subsystem. Three gates on existing calls plus one storage layout change:

- `src/service/projection.js`, `tickReview` (around lines 514 to 537): write only when the projection changed, compared without `generated_at`. Comparing the output is safer than inspecting event types, because it can never skip a write that mattered.
- `src/layer/store.js`: one storage key per comment instead of one key for the whole list, reusing the existing stamp for two-tab safety. A one-time read of the old key on load.
- `src/layer/sync.js`: drafts flush on the 10 second floor and on blur, tab-hide, and unload; lifecycle events (ready, created, deleted) keep flushing as they do today. `protocol.FLUSH` already declares `blur`; tab-hide is new.
- `src/layer/editing.js`: reopening a handled or ready edit sets it back to draft while open.

Rejected for now: sending only the changed fields (option d3). It changes the log format and gets its own spec. Keeping drafts out of the helper entirely (option b): the 10 second backup is cheap and keeps a crash copy.

## Tasks

1. Projection writes only on real change. Tests: a draft-only event leaves `review.json`'s bytes and modified time untouched; a ready event rewrites it; a reply rewrites it.
2. Per-comment browser storage. Tests: a keystroke writes one key; the old whole-list key loads once and migrates; two store instances over one storage see each other's writes.
3. Draft flush cadence. Tests with a fake clock: continuous typing posts at most once per 10 seconds; blur, tab-hide, and unload post at once; Cmd-Enter posts at once.
4. Queued-during-post waits its turn. Test.
5. Reopened edit is withdrawn while open. Test: reopen and type, no `item.ready` posts until commit.
6. Measure before and after on one scripted typing session (a few hundred characters across a few comments): storage writes and bytes, helper posts, `review.json` rewrites. Put the table on this page.

## Acceptance criteria

- [ ] A draft save does not rewrite `review.json`.
- [ ] A keystroke writes one comment to browser storage, not the whole list.
- [ ] Continuous typing sends the helper at most one draft copy per 10 seconds.
- [ ] Leaving a box, hiding the tab, or leaving the page sends the draft at once.
- [ ] Cmd-Enter, Hold release, and ending a review still send at once.
- [ ] Typing into a reopened edit never marks it ready before commit.
- [ ] Before-and-after numbers on this page.
- [ ] `npm run gate:unit` green; full suite green once at merge.

## Progress

- 2026-09-22: spec written from Ken's decisions on the analysis page.
