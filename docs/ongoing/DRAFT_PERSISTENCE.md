# Where unsent comments are saved, and what it costs

Written 2026-09-21. An analysis, not a change. No code was touched.

## Summary

1. A draft (a comment or edit the reviewer has not sent yet) is saved in the browser on every keystroke, and sent to the helper about once a second while the reviewer types.
2. The browser copy alone covers every failure the brief names in R1 (nothing the reviewer types is lost). The helper copy was added for two failures the brief does not name: the page's own scripts clearing browser storage, and the reviewer switching between `localhost` and `127.0.0.1`.
3. The helper copy of a draft is never read back into the page. Nothing calls the merge that would restore it. So for those two failures the draft is on disk, but only a person or agent digging through the log can get it back.
4. The biggest cost is not the 3.4 MB of draft lines. Each draft post also rewrites `review.json` in full, with a forced disk flush, even though drafts never appear in it. In the busiest review that is up to about 74 times more bytes written than the draft lines themselves. The browser side also rewrites the whole item list on every keystroke (over 300 KB per keystroke on the largest review).
5. Two cheap fixes cut most of the cost without giving up any protection: stop rewriting `review.json` when only drafts changed, and stop the browser rewriting every item on every keystroke. Whether to stop sending draft text to the helper at all is a risk call for Ken, laid out in Options.

---

## 1. The requirements, quoted

### From the brief (`docs/features/20260812.01_live_agentic_html_editor/01_brief_live_agentic_html_editor.md`)

- **Goal, line 34-35:** "Trust is an important aspect of this product. Reviewers work hard leaving feedback and making edits, and we cannot lose their work or clobber their work."
- **User story, lines 69-70:** "As Ken mid-review, I want certainty that closing my laptop, an agent working, or a process restarting cannot take back anything I already typed."
- **R1, lines 91-92:** "Nothing the reviewer types is lost. A reload, a tab close, a navigation, a restart of anything the library talks to, or a machine sleep immediately after a keystroke never loses that keystroke."
  - Written against the old tool (human-review), where "text Ken typed came back reverted" (line 17).
- **R2, line 96:** "An agent working on the page never discards the reviewer's pending feedback." Written against the old tool deliberately discarding pending feedback.
- **R5, line 111:** "The reviewer's unsent work is never silently overwritten."
- **R7, line 121:** "The reviewer decides when a comment is ready to act on, so a half-written thought is not picked up as an instruction."
- **R8, line 126:** "Work reaches the agent even when nothing is running to receive it, and is there when something starts."
- **R10, line 136:** "There is always a way to take the work elsewhere with nothing running: copy it, or export it as a file."
- **R22, line 199:** "A comment survives interruption while it is being written: a reload, the page re-rendering underneath it, navigating away and back."
- **Success metrics, lines 326 and 333:** "Zero lost or altered work across a real review session" and "The review survives a reload, a restart, and a laptop sleep with everything intact."
- **Context, lines 6-8:** the old comments module was trusted because "it does not depend on anything being alive. Notes are kept the instant they are typed." That module kept unsent notes in browser storage only.

### From the architecture (`02_architecture_live_agentic_html_editor.md`)

- **D5, line 143:** "Durability is browser storage plus an append-only log." It cites R1, R8 and R22.
- **D5, lines 149-155:** "Two stores, each sufficient alone: 1. Browser storage, written synchronously on every keystroke, including half-written drafts. A reload, a crash, or a sleep costs nothing ... the helper is what unifies a review across origins, which is one more reason drafts flow to it."
- **D5, lines 164-166:** "Drafts flow to the helper too, marked draft, so a half-written thought has both stores like everything else and does not live only in the reviewed app's own browser bucket, which the app itself can clear. Drafts never appear as actionable in what the agent reads (R7); they exist in the store purely as durability."
- **D5, lines 170-172:** "An open edit commits automatically on navigation or unload (kept synchronously in browser storage, handed to the helper on the way out)."
- **Failure table, line 729:** "Browser crash mid-keystroke: Browser storage has everything up to the last keystroke (R1)."
- **Architecture review table, line 762:** "Drafts had one durable home, inside the reviewed app's own storage. Accepted. Drafts flow to the helper too, marked draft, never actionable."

### Where "drafts go to the helper" came from

It was not in the brief. It came from the architecture review, finding RF4 (`02_architecture_live_agentic_html_editor_reviews.md` lines 475-486, also `hr_arch_v2_review_notes.md` lines 73-84):

> "For drafts there is one store, and it is the reviewed page's origin storage, which the app's own scripts own: a sign-out flow, a `localStorage.clear()`, a Turbo cache reset, or a switch from `localhost:3000` to `127.0.0.1:3000` all take it."

The review asked this as its most important open question, Q-A (line 777): "Are draft events posted to the helper, or do drafts live only in the browser?" D5 answered yes.

No requirement lives only in an `archive_` file. `archive_brief_reviews_workflow_tool_draft.md` line 95 only notes that the Steady Thread dev layer kept unsent comments as a localStorage draft.

---

## 2. Every place a draft is saved today

In the order they happen on one keystroke in a comment box.

| # | Where | When written | How often | Bytes per write | Survives browser crash | Tab close | Cleared browser storage | Other browser, profile or origin | Helper restart | Machine restart |
|---|---|---|---|---|---|---|---|---|---|---|
| 1 | The text box itself (page memory) | as typed | every keystroke | the text | no | no | yes | no | yes | no |
| 2 | Browser storage, item list `lahe.items.v1:<review>` | `store.write`, synchronously (`store.js:399-418`; comments `comments.js:1710`; edits `editing.js:581-583` from `captureTyping`, `editing.js:997`) | every keystroke | the WHOLE list of every item in the review, re-serialized. Largest review: at least 311,859 bytes (see section 4) | yes (see note A) | yes | **no** | **no** | yes | yes |
| 3 | Browser storage, outbox `lahe.outbox.v1:<review>` | `sync.recordItem` then `store.queueEvent` (`sync.js:1638-1659`, `store.js:601-620`) | every keystroke; one entry per item kept, older keystroke entries replaced | the whole outbox list, re-serialized; each entry carries the whole record (about 2.8 KB) | yes | yes | no | no | yes | yes |
| 4 | Helper log `events.jsonl` | `flush` posts the outbox (`sync.js:1726`); helper appends (`log.js:465`, `state_dir.js:397-399`, append without fsync) | after 750 ms of no typing (`protocol.js:638`), at once on ready and unload (`protocol.js:640`, `sync.js:2363-2364`). Measured: about once a second while typing (section 4) | 2,797 bytes mean per draft line | yes, up to the last post | yes (unload post, keepalive, `sync.js:2802`) | yes, on disk | yes, on disk | yes | yes (see note B) |
| 5 | Helper's `review.json` | rewritten after every post that moved the log (`routes.js:69-71`, `projection.js:535`), with fsync and rename (`review_writer.js:129-133`) | every draft post | the whole file; 236,324 bytes on the largest review | n/a: **drafts are withheld from it** (`projection.js:30-34`, `251-255`) | | | | | |
| 6 | Helper memory (the kept fold) | as posts arrive | every post | holds the draft record | n/a | | | | lost, rebuilt from log | |

Also saved, for completeness:

- **Follow-up drafts** (text typed into a reply box on an existing card) live only in browser storage, `lahe.followups.v1:<review>` (`store.js:87`, `889-894`; written from `tab_active.js:690` and `tab_done.js:1300`). They never go to the helper, by design: the comment at `store.js:85-86` says "an unfinished follow-up must never enter review.json." This is a working precedent for browser-only drafts.
- **The acknowledged table** `lahe.acked.v1:<review>` is read on every keystroke and rewritten when an acknowledgement is cleared (`store.js:407`, `468-474`). It holds no text.
- **Hold.** When the reviewer turns Hold on, nothing is posted (`sync.js:1737-1739`). Drafts then live only in browser storage, the same as option (b) below.

Notes:

- **A.** Browser storage survives a crash only once the browser has written it to its own disk. I did not verify how quickly Chrome, Safari or Firefox do that. The design and its tests treat a synchronous `setItem` as durable.
- **B.** The helper appends without fsync. After a clean shutdown the OS has written it. After a sudden power loss the last few appends could be missing. Not tested.
- **The helper copy is never read back into the page.** `store.mergeWithHelper` (`store.js:521`) is the only code that would pull helper records into the browser, and nothing outside unit tests calls it (`grep mergeWithHelper` finds only `store.js` and `test/unit/`). The page's cards come from browser storage only (`index.js:1053-1065`). The `review.read` route the page and export ask returns the projection, which holds no drafts (`routes.js:256-311`; `export.js:188-200` notes it cannot use those items as records). So "survives cleared storage" in row 4 means "is on disk in `events.jsonl`", not "comes back on the rail".

---

## 3. The failure modes

"Covered today" lists which rows from section 2 keep the words. "If drafts stop going to the helper" is option (b) below: browser storage only until the reviewer sends.

| Way work could be lost | Where it comes from | Covered today | If drafts stop going to the helper |
|---|---|---|---|
| Tab closed mid-sentence | R1 | browser storage (2, 3); helper (4) via the unload post | browser storage. Same result for the reviewer: the rail shows the draft next time |
| Reload, including the automatic reload after a rebuild (R36) | R1, R22 | browser storage; helper | browser storage |
| Navigation, link click | R1, D5 | browser storage; an open edit commits and posts (`editing.js:1023-1036`) | same. A committed edit is not a draft, so it still posts |
| Browser crash | R1, D5 line 729 | browser storage (note A); helper up to about a second behind | browser storage (note A) |
| Machine sleep | R1 | browser storage; helper | browser storage |
| Laptop dies suddenly | user story, line 69 | browser storage (note A); helper (note B) | browser storage (note A) |
| Helper down or restarted | R1 "a restart of anything the library talks to", R8 | browser storage; outbox re-posts later (`sync.js` header, promise 2) | browser storage. Nothing to re-post for drafts |
| Machine restart | success metric | browser storage; helper | browser storage |
| The page's own script clears browser storage (sign-out, `localStorage.clear()`) | RF4 | helper log **on disk only**; not shown on the rail | **lost** |
| Reviewer clears site data, or a private window closes | not named in the docs | helper log on disk only | **lost** |
| Same review opened on another origin (`localhost` vs `127.0.0.1`), another browser, or another profile | RF4, D5 lines 153-155 | helper log on disk only; the rail on the new origin does not show it | **lost from the new origin's view**; still in the first origin's storage |
| Browser storage full | memory audit | the keystroke is refused and a chip says so; words stay in the box only (`comments.js:1705-1722`, `OUTBOX_COALESCING.md`) | same |
| Disk full | not named in the docs | neither store can write | same |
| Two tabs on one review | D5 lines 202-211 | second tab refused and read-only, writes nothing | same |
| Agent working on the page | R2 | drafts are never in `review.json`, so no agent sees or discards them | same |

The honest reading:

- Every failure the brief names is covered by browser storage alone.
- The helper copy only matters for the storage-cleared and other-origin rows. For those it keeps the words on disk, but no tool brings them back. A human or agent would have to read `events.jsonl`.

---

## 4. What each layer costs

### What I measured

Scripts, both saved in the session scratchpad
`/private/tmp/claude-501/-Users-kennethstclair-Documents-workspace-live-agentic-html-editor/599b483c-2815-4ea5-b125-b1bad2bc9f3b/scratchpad/`:

- `draft_cost.py` reads every `~/.local/state/lahe/reviews/*/events.jsonl`, keeps events stamped on or after `2026-09-18T00:00:00Z`, and writes one row per event to `draft_cost_events.csv` and the totals to `draft_cost_summary.json`.
- `browser_write_size.py` writes `browser_write_size.csv`: per review, the size of the newest record for every item.
- `review_json_rewrites.py` bounds the `review.json` bytes rewritten because of draft posts.

Results, run 2026-09-21 (438 log files, 14 reviews with events in the window):

| Category | Events | Bytes | Share of bytes | Mean line |
|---|---|---|---|---|
| Draft saves (`draft: true`) | 1,204 | 3,368,171 | 79.1% | 2,797 |
| Committed (`item.ready`, content of a ready item, deletes) | 272 | 799,737 | 18.8% | 2,940 |
| Agent replies | 124 | 75,239 | 1.8% | 607 |
| Everything else | 41 | 12,483 | 0.3% | 304 |

These are close to the numbers in the brief for this task (1,196 draft events, 3.2 MB, 79%). The difference is events written since that count. My "committed" row is 272 rather than 242 because it also counts 27 content events on ready items and 2 deletes; plain `item.ready` is 243.

More from the same run:

- **133 items** had draft saves. Per item: median 5, 90th percentile 20, most 110.
- **Time between two draft saves on the same item:** median 0.964 s, 10th percentile 0.213 s, 90th percentile 1.429 s. So the helper hears from the page about once a second while the reviewer types, not only when they pause. The likely reason is `sync.js:1829`: after each post, anything that arrived meanwhile is posted at once (`scheduleFlush(0)`), which cancels the 750 ms wait. I did not confirm this with a test.
- **What is actually new in a draft line:** the fields that change while typing (`note`, `after`, `after_html`, `updated_at`) are 147,944 bytes, 4.4% of the draft bytes. The rest is the unchanged record repeated (2,984,832 bytes of records in total) plus the event envelope (318 bytes mean).
- **One review dominates:** `r44ebfa0738bc` has 1,020 of the 1,204 draft saves.
- **Since the coalescing fix merged (2026-09-16 21:23 UTC):** 6,496 draft events, 87.5% of bytes. Many of those came from tabs still running the old bundle, so I used the 2026-09-18 cutoff for the main numbers.

### The helper's hidden cost: `review.json` rewrites

Every accepted post moves the log, and the helper then rewrites `review.json` in full, with fsync (`routes.js:69-71`, `projection.js:533-537`, `review_writer.js:129`). Drafts are not in that file, so a draft-only post rewrites a file whose content did not change, apart from its `generated_at` time.

- Upper bound, from `review_json_rewrites.py`: 248,896,695 bytes rewritten for the 1,204 draft events. That is the draft count per review times that review's current `review.json` size.
- That is about 74 times the 3,368,171 bytes of draft lines appended (calc-mcp).
- It is an upper bound on bytes, since `review.json` was smaller earlier in each review. It is also an upper bound on rewrites, since one post can carry several events.
- These are writes, not growth. The file is replaced each time, so the disk does not fill up. But each one is a forced disk flush, which is the kind of write that costs energy and wears an SSD.

### The browser's cost

From the code, per keystroke in a comment or edit:

- `store.write` re-serializes the whole item list and writes it, plus a small stamp key (`store.js:399-418`, `324-345`).
- `clearAcknowledged` parses the acknowledged table (`store.js:468`).
- `sync.recordItem` re-serializes and writes the whole outbox, plus its stamp (`store.js:601-620`).

So that is two full-list writes and two stamp writes per keystroke. From `browser_write_size.py`, the item list on the largest review is at least 311,859 bytes (105 items). That is about 111 draft lines' worth of bytes on every keystroke (calc-mcp), before the outbox.

What I could not measure:

- Energy. I have no power reading for either the browser or the helper.
- How often the browser actually writes its storage to disk. Browsers batch this, and I did not look.
- The true size of browser item lists. Browser storage is not readable from here. The log only gives a floor.

### Something the numbers turned up

A committed hand edit that the reviewer opens again and types into keeps its `ready` state while they type (`editing.js:676-681` reuses the record; `captureTyping` at `editing.js:997-1010` does not change the state). `sync.eventTypeFor` then labels each post `item.ready` (`sync.js:1566-1571`), and `item.ready` is never coalesced (`store.js:584-587`).

- Measured: 3 cases, 113 `item.ready` events, 110 of them extra, all on hand edits in `r44ebfa0738bc` on 2026-09-18.
- The likely effect is that `review.json` shows the half-typed after-text as work the agent may act on. That is an R7 problem (the reviewer decides when something is ready), not only a cost. Comments do not have this problem: rewording a ready comment turns it back into a draft (`comments.js:1690-1705`).
- I did not confirm the `review.json` effect with a test.

---

## 5. What else uses the helper's draft copy

Every reader of draft events or draft state on the helper side:

- **The draft count in `lahe status`.** `projection.js:557-559` counts drafts off the fold. `routes.js:272-311` returns it as `draft_count`. `status.js:631` and `status.js:644` read it, from the helper or from the log on disk. `status.js:737-741` prints "drafts N (the reviewer is still writing these; they are not yours yet)". It is also in the `--json` liveness block (`status.js:687`). The comment at `status.js:467-470` says why: "an edit stuck in draft reaches nobody, and before this there was no way to see one at all."
- **Taking a reworded comment off the agent's desk.** When the reviewer types into a ready comment, the record turns into a draft (`comments.js:1690-1705`). The draft post is what removes it from `review.json`, so the agent stops working from the old wording. This is not about durability, and any option must keep it. The helper needs to hear "this item is being reworded", even if not the words.
- **Deleting a draft.** `sync.deleteItem` only posts a delete for an item the helper has seen (`sync.js:1600-1625`). If drafts never reach the helper, deleting one posts nothing, which is already the handled case.
- **The fold and projection.** They hold drafts and withhold them (`projection.js:30-34`, `251-255`).

Not readers of the helper's draft copy:

- **The rail**, including the "Draft, not sent" label (`tab_active.js:769`), the draft nudge, and the end-review dialog's draft count (`index.js:975-978`, `overlay.js:1265-1276`). All of these read browser storage.
- **Copy and export (R10).** `export.js:278-280` reads browser records, drafts included.
- **The wake feed.** Drafts never wake an agent (`wake_feed.js:26`).
- **The "waiting" clock.** It ignores drafts (`protocol.js:1245-1248`).
- **End review's count.** The helper counts ready items only (`routes.js:418-423`).
- **Agents.** The contract tells them to leave drafts alone (`review_format.js:64`), and drafts are not in the file anyway.

---

## 6. Options

The options can be combined. (d1) and (d2) do not change what is protected at all.

### (a) No change

- **Saves:** nothing.
- **Gives up:** nothing.
- **Breaks:** nothing. The costs in section 4 continue, including the hand-edit `item.ready` repeats.

### (b) Drafts stay in the browser; the helper gets committed work plus a content-free "still writing" signal

The page posts `item.created` and later `item.content` events without the draft text. Instead it sends a small signal: item id, kind, page, and "draft". It sends the full record on ready, as today. A ready comment being reworded sends "withdrawn at rev N" so it still leaves the agent's desk.

- **Saves:** almost all of the 3,368,171 draft bytes (the signal is about the envelope size, 318 bytes mean). It also saves the `review.json` rewrites, if the signal is sent once per draft rather than once a second.
- **Gives up:** the storage-cleared and other-origin rows in section 3. Those drafts are lost instead of sitting on disk where nobody reads them today.
- **Breaks:**
  - D5's "two stores, each sufficient alone" for drafts, and its answer to RF4. The architecture doc would need an amendment first, per CLAUDE.md.
  - An open comment left as a draft when the tab closes stays only in that origin's browser storage.
  - Needs a new event shape or a flag on the existing one, and helper changes so the draft count and the withdrawal still work.
- **Precedent:** follow-up drafts and Hold already work this way.

### (c) Drafts go to the helper only at risky moments

Post the draft text when the reviewer:

- leaves the box,
- hides the tab (today hiding does not flush, `sync.js:2170-2178`),
- or leaves the page (already done, `sync.js:2363`).

Stop posting on every pause.

- **Saves:** most draft posts and their `review.json` rewrites. Each item gets a post per time the reviewer leaves its box, instead of the 1,204 posts across 133 items measured.
- **Gives up:** only the text typed since the last time the reviewer left the box, and only when browser storage is also cleared or the origin changes before the next such moment.
- **Breaks:** nothing in the requirements. D5 still holds. The unload post already exists. Tab-hide needs a new trigger. The `blur` reason in `protocol.js:640` is declared but no caller uses it today.

### (d1) Stop rewriting `review.json` when only drafts changed

Helper-only change. In `tickReview` (`projection.js:514-537`), skip the write when the new events are all drafts. An alternative is to compare the new projection with the last one, leaving out `generated_at`.

- **Saves:** the largest measured cost, up to 248,896,695 bytes of fsync'd rewrites in the window.
- **Gives up:** nothing. The file's content does not change.
- **Breaks:** anything that uses `review.json`'s modified time as a heartbeat. I found no such reader in `src/`, but I did not check agent-side scripts.

### (d2) Stop the browser rewriting every item on every keystroke

Store one key per item, or write the list only on commit and keep a small per-item draft key for keystrokes.

- **Saves:** over 300 KB of serialization and storage writes per keystroke on a large review.
- **Gives up:** nothing, if the write stays synchronous.
- **Breaks:** the storage format. Old keys need a one-time migration. The two-tab stamp logic in `store.js` (`OUTBOX_COALESCING.md`) has to cover the new keys.

### (d3) Send only what changed

For a draft `item.content`, send the typing fields only: note, after, after_html, updated_at.

- **Saves:** the measured envelope plus typing fields come to 531,283 bytes, 15.8% of today's draft bytes (calc-mcp).
- **Gives up:** nothing.
- **Breaks:**
  - The projection has no field-level events. It takes the newest whole record (`OUTBOX_COALESCING.md`, "Why D5 still holds"), so it would need a patch rule.
  - A patch whose base the helper never saw has to be refused or rebuilt.
  - More moving parts than (c) for a smaller saving.

### (d4) Make the pause really a pause, and fix re-entered edits

Two small fixes:

- Have the follow-up post after a flush respect the 750 ms wait instead of posting at once (`sync.js:1829`).
- Have a re-entered hand edit post as content, not `item.ready`. Better still, mark it as withdrawn while it is open, the way comments already do.

- **Saves:** fewer draft posts, and the 110 extra `item.ready` lines.
- **Gives up:** at most the typing inside one extra pause, and only in the storage-cleared cases.
- **Breaks:** nothing. The second fix closes the likely R7 hole in section 4.

### How they compare

| Option | Bytes saved | Protection given up | Size of change |
|---|---|---|---|
| (a) | none | none | none |
| (b) | nearly all draft bytes and rewrites | cleared storage and other origin | wire change, helper change, D5 amendment |
| (c) | most draft posts and rewrites | typing since the last box exit, in those same two cases | one new trigger, remove the pause post for drafts |
| (d1) | the biggest cost (`review.json` rewrites) | none | helper only |
| (d2) | browser per-keystroke writes | none | browser storage format |
| (d3) | about 84% of draft line bytes | none | projection patch rule |
| (d4) | some posts, plus the ready repeats | none | two small browser fixes |

---

## 7. Open questions for Ken

- Is a draft that exists only on disk, which no tool shows, worth keeping? Or is that the same as lost to you?
- If the page's own script clears browser storage, is losing an unsent comment acceptable? A sent one would still be safe.
- If you move between `localhost` and `127.0.0.1` in the middle of a review, do you expect unsent drafts from the other address to appear?
- Should the page ever restore drafts from the helper (wire up `mergeWithHelper`)? If yes, (b) is off the table and (c) becomes more valuable.
- Is the "drafts N" line in `lahe status` useful enough to keep sending a signal for?
- Is losing the typing since the last time you left a box acceptable, in exchange for a post only when you leave it (option c)?
- Should (d1), (d2) and (d4) go ahead now, since they give up nothing?

## What I could not verify

- Energy use, for either side.
- When browsers write localStorage to disk, so "survives a crash" for browser storage rests on the design's assumption.
- The browser item-list sizes. Only a floor from the log was available.
- That `sync.js:1829` is why saves arrive about once a second rather than on pauses.
- That the re-entered-edit `item.ready` posts put half-typed text in `review.json`.
- Whether any agent-side script watches `review.json`'s modified time.
