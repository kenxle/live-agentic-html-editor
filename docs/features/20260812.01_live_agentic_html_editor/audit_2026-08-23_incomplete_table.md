# Audit: "Homed but broken or incomplete as written"

Scope: the 13 rows of the table at line 805 of
`docs/features/20260812.01_live_agentic_html_editor/02_architecture_live_agentic_html_editor_reviews.md`,
audited against the code on `main` at commit `d4f8ffa`. Every verdict below rests on source and
tests, not on progress docs or builder notes.

## Summary

| # | Row | Verdict |
| --- | --- | --- |
| 1 | R1 (nothing typed is lost): durable home for drafts, commit on navigation | PARTLY BUILT |
| 2 | R5 (unsent work not silently overwritten): fourth compare branch, message when protection hides a repaint | PARTLY BUILT |
| 3 | R9 (never acted on twice): claim mechanism, rev-aware merge | BUILT (claims NO LONGER APPLIES) |
| 4 | R15 (keeps working as the page changes): morph veto, selection snapshot | BUILT |
| 5 | R17 (comment on an element): an anchor for things with no text | BUILT |
| 6 | R19/R20 (highlights hold their subject): re-resolved every replay pass | PARTLY BUILT |
| 7 | R23 (agent can find the subject in source): the per-page source hint | BUILT |
| 8 | R25/R28 (undo): what an undo means after the item was handled | NOT BUILT |
| 9 | R27 (delete a block): replay and idempotence for an absent region | BUILT |
| 10 | R30 (two edits stay two): per-region decomposition, atomic group id | NO LONGER APPLIES |
| 11 | R31 (format-only counts): an HTML-level comparison rule | BUILT |
| 12 | R36 (page updates as changes land): an owner for the refresh | BUILT |
| 13 | R26 (basic formatting): no implementation, vocabulary, or paste rule | PARTLY BUILT |

Counts: 6 BUILT, 4 PARTLY BUILT, 1 NOT BUILT, 1 NO LONGER APPLIES, 1 BUILT with a rejected half.

## Ranked: what is not built, most likely to reach a reviewer first

1. **Undo tells nobody (row 8, NOT BUILT).** A reviewer who undoes a hand edit gets the page and the
   rail back, and the helper is never told, so `review.json` still lists the item. An unhandled edit
   is then applied by the agent after the reviewer took it back.
2. **The veto path never reports what it swallowed (row 2, PARTLY BUILT).** On a Turbo app, an
   agent's landed change to the block the reviewer is typing in is cancelled and thrown away with
   nothing recorded and nothing on the card. This is the flagship dev-server case.
3. **Highlights are only re-resolved on a narrow trigger list (row 6, PARTLY BUILT).** On any
   framework that is not Turbo and does not remove the rail's own root, a comment marker vanishes
   mid-session and nothing brings it back until a navigation.
4. **No paste rule in an edit region (row 13, PARTLY BUILT).** Pasting from another document carries
   underline, highlight, tables, and images into `after_html`, past a vocabulary the design says is
   closed at bold and italic.
5. **No commit on `visibilitychange` or Turbo's `before-visit` (row 1, PARTLY BUILT).** An open edit
   stays a draft when the tab is backgrounded or when a same-document visit swaps the page.
6. **The helper's copy is never read back (residual under rows 1 and 3).** `shared/merge.js` and
   `store.mergeWithHelper` are unreachable at runtime, so D5's "two stores, each sufficient alone" is
   true on the write path only.

---

## Row 1. R1 (nothing typed is lost): a durable home for drafts, and a commit on navigation

**Cites:** RF4 (drafts have exactly one durable home, and it is the reviewed app's own storage),
RF5 (nothing commits an edit when the reviewer navigates away).

**Verdict: PARTLY BUILT.** RF4's half is built. RF5's half is built for real navigations and missing
for two of the three triggers the fix named.

### Evidence, RF4: built

- `src/layer/sync.js:515-533`, `eventFor()` stamps every event with `draft: record.isDraft(item)`.
  The comment reads: "Drafts flow to the helper marked draft, and never appear as actionable in what
  the agent reads (D5, R7)."
- `src/layer/editing.js:525-538` creates the draft record the moment edit state opens, and
  `persist()` (`editing.js:448-455`) writes it to browser storage and hands it to `sync.recordItem`
  in the same act.
- Drafts are excluded from actionable work by one definition: `src/shared/record.js:566-568`,
  `isUnansweredReady()`, which requires `state === STATE.READY`.
- Tests: `test/unit/sync_client.test.js:60` ("drafts flow to the helper marked draft (D5, R7)") and
  `test/unit/projection_review_json.test.js:276` ("a draft never appears in review.json, and the same
  record after Cmd-Enter does"). Removing the draft post breaks the first; removing the exclusion
  breaks the second.

### Evidence, RF5: partly built

Built:

- `src/layer/editing.js:1692-1698` registers `pagehide` and `beforeunload`, both calling
  `commit({reason: "navigation"})`.
- The post uses a keepalive request: `src/layer/sync.js:691`, `if (fo.unload) init.keepalive = true`.
- A click on a link commits first, through the ordinary click-outside gesture
  (`src/layer/editing.js:1687-1688`).
- Test: `test/browser/editing_navigation.spec.js:129` asserts the record is `ready`, not a draft,
  after a real navigation, on all three lanes.

Missing:

- `visibilitychange` never commits. `src/layer/sync.js:984-991` handles it by re-running `poll()` and
  `flush()`, which posts what is already queued. `editing.js` does not listen for it at all.
- `turbo:before-visit` appears nowhere in `src/`.

### Consequence and fix

A reviewer who types into a block and then switches apps, locks the screen, or is moved by a
programmatic `Turbo.visit()` or a form submit leaves an open edit sitting as a draft. It is durable
(browser storage plus a draft event), so nothing is lost, but it is invisible to the agent until the
reviewer comes back and commits it. Fix: register `visibilitychange` (hidden) and `turbo:before-visit`
alongside `pagehide` in `editing.js`'s listener set.

### Related residual, found while checking this row

D5 promises a load merge: "its own undelivered work from browser storage wins on content, the store
wins on per-rev status". The merge module exists (`src/shared/merge.js`) and `store.mergeWithHelper`
(`src/layer/store.js:342-363`) implements it, but **nothing in `src/` calls `mergeWithHelper`**. The
only callers are `test/unit/sync_client.test.js:433` and `:442`. The library's own `merge()`
(`src/layer/index.js:520-529`) is a load merge from browser storage only. The layer consumes exactly
two event types from the helper, `REPLY_FOLDED` and `REPLY_REJECTED` (`src/layer/tab_done.js:1037`
and `:1041`), and never item state.

So the helper is a write-only second home from the browser's point of view. If the reviewed app calls
`localStorage.clear()`, which is the exact risk RF4 named, the rail comes back empty even though the
helper holds everything. RF4 asked only for the write side, which is why this is a residual rather
than a failed row, but D5's "two stores, each sufficient alone" is not true on the read path today.

---

## Row 2. R5 (unsent work not silently overwritten): a fourth compare branch, and a message when protection hides a repaint

**Cites:** RF7 (a protected region silently hides an agent's landed change), RF8 (no third state for
"an earlier rev of this record was already applied").

**Verdict: PARTLY BUILT.** RF8 is built. RF7 is built for the fallback path and missing for the
framework path.

### Evidence, RF8: built

- `src/layer/replay.js:505-511` names four branches: `ALREADY_APPLIED`, `REAPPLY`,
  `EARLIER_REVISION`, `CONTENT_CHANGED`.
- `src/layer/replay.js:556-563` reads `record.priorAfters(item, fields.after)` and matches the DOM
  against any earlier rev's `after`.
- The history is a real field, appended on every commit and rewording: `src/shared/record.js:69`
  (`AFTER_HISTORY`), `:592-613`, `:713-720`, plus `appendHistory` in `src/layer/editing.js:956-970`.
  `record.js:834` even validates it: "after_history must be an array; replay's branch three reads it".
- The card says so: `EARLIER_REVISION_MESSAGE` at `src/layer/replay.js:697`, "An earlier version of
  this edit had already landed. Your current version was re-applied."
- Tests: `test/unit/replay_pass.test.js:184` ("branch three: an earlier revision landed...") and
  `test/browser/replay_branches.spec.js:64-112`. `replay_pass.test.js:323` also pins the format-only
  case that would otherwise raise a false conflict.

### Evidence, RF7: partly built

Built, on layer three (the mutation-observer restore, the framework-free fallback):

- `src/layer/protect.js:559-577` keeps what the page tried to write before reverting it:
  `active.displaced = {text, html, at}`. The comment names the reason: "an agent that rewrote this
  very block while the reviewer was in it is swallowed silently".
- `src/layer/protect.js:770-793`, `release()`, hands `observed` and `observedHtml` to a forced replay
  pass on commit.
- `src/layer/replay.js:1484-1503` (the commit seam) turns content matching neither the reviewer's
  version nor any history into `flagConflict(..., displaced)`, and
  `src/layer/replay.js:1024` and `:1501` keep that conflict from being wiped by an ordinary pass.
- Test: `test/browser/cp2_mid.spec.js:216-301`, "the page rewrites region A while the reviewer is in
  it: on commit, one card is flagged and nothing is written".

Missing, on layer two (the pre-morph veto):

```
src/layer/protect.js:385-390
  function veto(el, event) {
    if (!touches(el)) return false;
    counters.vetoes += 1;
    if (event && typeof event.preventDefault === "function") event.preventDefault();
    return true;
  }
```

`veto()` cancels the morph and captures nothing. It never reads the event's payload and never sets
`active.displaced`. `onBeforeMorph` (`src/layer/protect.js:649-652`) calls `veto` and does nothing
else. Because the veto stops the morph, layer three never sees a mutation for that block either, so
`commit.observed` is null and the commit-seam branch never fires. The ordinary compare then finds the
reviewer's own text in the DOM and returns `ALREADY_APPLIED`.

The framework table (`src/layer/protect.js:110-138`) lists `turbo:before-morph-element` first, so
this is the live path on a Rails and Turbo app.

No test covers it. The veto tests in `test/browser/protection_layers.spec.js:151-301` assert
`counters.vetoes` and the absence of restores, never a card. `test/browser/cp2_mid.spec.js` reaches
the commit seam through the fixture's raw `el.textContent = text` rewrite
(`test/fixtures/assets/cp2-mid-boot.js:236-242`), which bypasses the morph hook entirely.

### Consequence and fix

On a Turbo dev server, the reviewer is editing a paragraph, the agent lands a change to that same
paragraph in source, the morph arrives and is vetoed, and the change is gone. The reviewer commits
and sees their own words, the card says nothing, and the counter that fired is diagnostic only. The
page they are looking at no longer matches source, in the one region they care most about, which is
RF7's sentence exactly. A later morph of the same block would surface it as branch four, so this is a
window rather than a permanent loss, but nothing guarantees a later morph.

Fix: in `veto()`, read the replacement content off the event (Turbo carries it on `event.detail`) and
set `active.displaced` before calling `preventDefault`, so the existing commit seam does the rest.

---

## Row 3. R9 (never acted on twice): a claim mechanism for concurrent agents; a rev-aware merge

**Cites:** RF2 (D5's merge rule swallows a rewording), RF11 (review.md plus replies.jsonl is not
sufficient for concurrent agents).

**Verdict: BUILT for the rev rule and RF11's three mechanical asks. NO LONGER APPLIES for claims and
leases.**

### Claims and leases: superseded

The architecture's own disposition table
(`02_architecture_live_agentic_html_editor.md`, Architecture Review row "Agent claims or leases for
concurrent agents") reads "Rejected for v1", and D6 says "the store does not add claims or leases in
v1". No code implements them, and none should.

### Rev-aware lifecycle: built, on the path that actually runs

- `src/layer/tab_done.js:1119`:
  `if (event.accepted !== true || !lifecycle.replyApplies(item, replyRev))` refuses the fold and puts
  a stale notice on the card. The comment names the offline-reword case by hand.
- `src/shared/lifecycle.js:164-169`, `replyApplies`, refuses any reply naming a rev other than the
  item's current one.
- Helper side: `src/service/replies.js` folds through the same rule.
- Tests: `test/unit/record_lifecycle.test.js:472` ("a stale revision cannot retire a current one: the
  reword-offline case"), `test/unit/reply_folding.test.js:249` ("a higher revision beats a later
  arrival"), and `test/browser/reword_rev.spec.js` end to end against a real helper.

### RF11's mechanics: built

- Per-agent reply files: `src/service/replies.js` reads every `replies*.jsonl` in the review folder,
  and validates the agent segment with `protocol.isSafeId`
  (`src/shared/protocol.js:162-165`, `^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$`) before using it as a path
  component. Test: `test/unit/reply_folding.test.js` folds `replies-alpha.jsonl` and
  `replies-zulu.jsonl` independently.
- Conflict precedence: `src/service/replies.js:309-320` implements rev first, then latest wins, with
  both lines kept in the log.
- Atomic projection write: `src/service/review_writer.js:120-136`, `writeAtomic`, opens a temp file
  with `wx`, `fsyncSync`, `renameSync`, then chmod 0600. Test:
  `test/unit/projection_review_json.test.js:478` asserts the mode, the absence of leftover temp
  files, and refusal of a symlinked destination.

### Caveat worth carrying forward

The row's phrase "rev-aware merge" points at `src/shared/merge.js`, which is the module the D5 load
merge would use. That module is correct and unit-tested and **never called at runtime** (see the
residual under row 1). R9 is satisfied anyway, because the live path is the reply fold in
`tab_done.js`, which enforces the same rule. Two implementations of one rule exist and only one runs.

---

## Row 4. R15 (keeps working as the page changes): the morph veto and the selection snapshot

**Cites:** RF6 (the protected region loses the active veto).

**Verdict: BUILT.** All three layers exist and are separately exercised.

- Layer one, cooperative skip: `src/layer/protect.js:110-138` writes every known skip attribute,
  including `data-turbo-permanent`. The library marks with all of them rather than guessing which
  framework the page runs.
- Layer two, the pre-morph veto: `src/layer/protect.js:385-390`, listening on every known
  before-morph event name (`BEFORE_MORPH_EVENTS`, `:153`). `touches()` (`:366-370`) matches both the
  block itself and any ancestor about to be replaced, and the file's header records that a veto
  written against the block alone silently never fires.
- Layer three, the selection snapshot: `snapshot()` (`:481`) stores a region-relative character
  offset via `offsetWithin()` (`:415-427`), and `restore()` (`:526`) rebuilds the block, re-applies
  the editing attributes, and replaces the caret at that offset.
- Tests: `test/browser/protection_layers.spec.js` installs each layer alone against a live repaint
  engine and asserts the counter for that layer moved while the others stayed at zero, so a passing
  layer-two test proves the veto, not the fallback. Caret identity is asserted by node identity for
  layers one and two (`test/helpers/caret.js:189`) and by character offset for layer three, which is
  the only correct bar once the node has been rebuilt.

The one thing layer two does not do is report what it cancelled, which is row 2's finding, not this
one.

---

## Row 5. R17 (comment on an element): an anchor for things with no text

**Cites:** RF19.

**Verdict: BUILT**, fixed 2026-08-23 after it reached a live session.

- The content signature: `src/layer/anchor.js:287-310`, `signatureOf(node)`, built from
  `SIGNATURE_ATTRS` (`:139-147`): `img` uses `src`, `alt`, `srcset`; anything else with no text uses
  `aria-label`, `id`, `href`, `value`.
- The signature runs through the same uniqueness walk text does
  (`src/layer/anchor.js:491-532`), widening by whole siblings and failing honestly rather than
  binding to a guess.
- A failed mint is stamped lost: `src/layer/anchor.js:653` returns `mintFailure(ref, EMPTY_PROBE)`,
  and `src/layer/comments.js:1739` sets `region.lost = regions.lostFromMint(region.ref)`. The comment
  at `comments.js:1732` describes the original silent failure.
- The label prefers a filename over an ordinal: `src/layer/anchor.js:811`.
- The subject reaches the agent as fenced data: `src/shared/review_format.js` classes `subject` as a
  data field, and the contract text tells the agent to use `subject` rather than `region_label` when
  an item points at something with no words in it.
- Tests: `test/unit/anchor_engine.test.js:482`, `:496`, `:539`, `:552` ("a failed mint is stamped
  lost, so no item can read as healthy with a dead anchor"), `:594`, `:610`, `:618`, plus
  `test/browser/element_subject.spec.js:98` and `:151` ("three images in three wrappers get three
  names, not three copies of img 1").

---

## Row 6. R19/R20 (highlights hold their subject): highlight ranges re-resolved every replay pass

**Cites:** RF17.

**Verdict: PARTLY BUILT.** The re-resolve exists. It is not on the replay pass, and nothing tests it
against a repaint.

### What is built

- `src/layer/comments.js:2242-2255`, `repaint(id)`, rebuilds the range from the record's own
  reference through `anchor.resolve`, and paints nothing when it does not bind.
- `src/layer/index.js:556-564`, `repaintHighlights(merged)`, calls it for every outstanding
  comment and note.

### What is missing

`repaintHighlights` is called from exactly three places, all of them load-shaped:

- `src/layer/index.js:526`, inside `merge()`, which runs at boot and on remount.
- `src/layer/index.js:840`, once, after the settle window.

`src/layer/replay.js` never calls it. The replay header (`replay.js:44-58`) lists "re-resolve the
anchor of every outstanding record" as step four, and that step covers edit records only. The broad
mutation observer at `src/layer/index.js:728-734` schedules a replay pass on any DOM change and never
merges, which `index.js:636-640` records as deliberate.

Remount, the other trigger, fires on a fixed list: the three known morph event names, `turbo:load`,
`popstate`, a persisted `pageshow`, and a mutation observer that only reacts when the overlay root
element itself goes missing (`src/layer/inject.js:254-265`).

No test anywhere repaints the page and then asserts a highlight still covers the right text. The
files that drive the repaint engine and the files that read `CSS.highlights` are disjoint sets.
`test/browser/highlights_after_reload.spec.js:111` covers a full reload only.

### Consequence and fix

On a page repainted by anything that is not Turbo or the test fixture (React, Vue, htmx, a plain
`innerHTML` swap), and that leaves the rail's own root in place, the reviewer's comment markers
disappear from the page and stay gone until a navigation. That is one of the old tool's named
symptoms. Fix: call `repaintHighlights(refreshItems())` at the end of every replay pass, and add a
browser test that forces a repaint and asserts the highlight still covers the quoted text.

Smaller and worth noting separately: `repaint()` paints `selectNodeContents(verdict.element)`, the
whole block, rather than the original sub-range, so a comment on a phrase comes back after a reload
highlighting the entire paragraph.

---

## Row 7. R23 (agent can find the subject in source): the per-page source hint

**Cites:** RF14.

**Verdict: BUILT**, including an honest wording for the unknown case.

- `src/cli/commands/add.js:158` documents `--source <path>`, `:232-233` parses it, `:1075` resolves
  it, and `:1097-1113` and `:1144` write it onto the `page.visited` event on both write paths.
- `lahe review` passes it automatically for the Markdown flow:
  `src/cli/commands/review.js:117`, `list.push("--source", originalTarget)`.
- `src/service/routes.js:211-219` accepts it on the held-review route.
- `src/service/projection.js:198-228`, `reviewSourceHint(events)`, folds it review-wide, with the
  comment naming the bug that fixed ("every item read `source_hint: {known: false, ...}` even on a
  review where `--source` had been recorded").
- `src/shared/review_format.js:499-513` puts it on each page header, and `:241-255` writes the
  sentence the agent reads. The unknown case is the load-bearing half: "Source unknown. Nobody has
  told this tool what generates this page. Do not assume the file you are reading about is the
  source."
- Tests: `test/unit/add_command.test.js:459` and `:539`, `test/unit/projection_review_json.test.js:437`
  and `:453` ("the recorded --source reaches the agent as known").

---

## Row 8. R25/R28 (undo): what an undo means after the item was handled

**Cites:** RF18.

**Verdict: NOT BUILT.** There is no reverted-after-handled item, and undo is not communicated to the
helper at all.

### What the code does

```
src/layer/editing.js:1105-1141   function undo(itemId)
  ... restoreRegion(item) or restoreDeleted(item) ...
  store.remove(requireReview(), itemId);
  forget(itemId);
  selection.placeCaretAtStart(restored.element);
  emit(item, "undone");
```

Three things follow from those five lines:

1. **The helper is never told.** `emit()` (`src/layer/editing.js:443-445`) only calls in-page
   listeners. The only caller of `sync.deleteItem` in the whole library is
   `src/layer/index.js:601`, inside the **comments** change handler, for a comment the reviewer
   deleted. The editing change handler (`src/layer/index.js:568-591`) posts nothing, and says so in
   its own comment: "No sync call here: editing posts through the sync it was handed, on the same act
   that wrote the record." Undo is the one act that does not go through `persist()`.
2. **A handled item can be undone, despite the rule.** `lifecycle.canDelete`
   (`src/shared/lifecycle.js:151`) says a handled item cannot be deleted, and
   `test/unit/record_lifecycle.test.js:391` asserts it. `canDelete` is **never called by any
   production code** (`grep -rn canDelete src/` returns only its definition and its export). The
   Edits tab lists rows by `record.isHandEdit` alone, with no state filter
   (`src/layer/tab_edits.js:320`, and `src/shared/record.js:125-126`), and every row carries an Undo
   button (`src/layer/tab_edits.js:460-466`). So a handled hand edit has a pressable Undo.
3. **Nothing becomes actionable.** There is no record kind, state, or field for "reverted after
   handled" anywhere in `src/shared/record.js` or `src/shared/lifecycle.js`. The only reviewer
   control on a handled item is Done's "Reopen issue" (`src/layer/tab_done.js:963-990`), which calls
   `record.reopenIssue` (`src/shared/record.js:698-703`) and carries the **same unchanged** note and
   change forward: "Issue reopened. The unchanged request is back in front of the agent."

The nearest-looking mechanism runs the other way. `replay.revertedHandledEditIds`
(wired at `src/layer/index.js:858-873`) detects the **page** having reverted an agent's applied fix
and reopens the item asking the agent to reapply it. `REVERTED_EDIT_NOTE` reads "Reapply it, or reply
not_handled saying why" (`test/unit/reverted_edit.test.js:116-127`). It is a drift detector, not a
take-back.

### Consequence

Two user-visible failures, and the first is the more likely:

- **An unhandled edit the reviewer took back is applied anyway.** Commit an edit, change your mind,
  press Undo on its Edits row. The page and the rail forget it. `review.json` still lists it as
  `ready`, because the delete never reached the helper, so the agent applies it to source and replies
  handled. The reviewer gets a card back for an edit they cancelled, holding text they deleted.
- **A handled edit the reviewer took back leaves source carrying it.** The page reverts, the row
  disappears, and no event tells the agent to revert the source. This is RF18's sentence exactly.

No test covers either. `test/browser/editing_undo.spec.js` and `test/browser/edits_undo_rows.spec.js`
assert the page and the rows only, never the helper's copy, and neither reloads after an undo.

### Fix sketch

Make undo an event rather than a silent removal: post `ITEM_DELETED` for an unhandled edit (the
comments path already has the call), and for a handled one, mint a new actionable record carrying the
`after` that was applied and the `before` to restore, so the agent is asked to revert rather than
asked to redo.

---

## Row 9. R27 (delete a block): replay and idempotence semantics for an absent region

**Cites:** RF9, delete half.

**Verdict: BUILT.**

- The kind exists and is closed: `src/shared/record.js:106`, with the reason at `:99-105` ("a deleted
  block reads as a deletion rather than as an empty edit (R27)").
- Idempotence by absence, in `compare()` at `src/layer/replay.js:521-544`: a null DOM value returns
  `ALREADY_APPLIED`, and a DOM value equal to `before` returns `REAPPLY`.
- `src/layer/replay.js:1426-1429` keeps an absent delete out of the lost path: "A delete whose block
  is not on the page is APPLIED, not lost. Absence is what a delete asked for".
- Undo restores it: `src/layer/editing.js:1190`, `restoreDeleted(item)`.
- Tests: `test/unit/replay_pass.test.js:352` ("a delete is idempotent by absence: the block gone is
  applied, the block back is re-applied") and `test/browser/replay_branches.spec.js:167`.

One usability note, not a gap in the finding: deleting is a click on a "Delete block" button inside
the edit bar (`src/layer/editing.js:1369-1372`). It has no entry in the gesture table
(`src/shared/gestures.js:32-116`), so it never appears in the rail's keyboard hints.

---

## Row 10. R30 (two edits stay two): per-region decomposition and the atomic group id

**Cites:** RF10.

**Verdict: NO LONGER APPLIES.** The gesture that produced RF10's corrupt record cannot be made.

There is no group id anywhere in `src/`. What replaced the need for one is D3's rule that edit state
binds to exactly one block:

- `src/layer/editing.js:484-494`, `editBlockAtCaret()`, resolves the block with
  `selection.blockFor(null)` first.
- `src/layer/selection.js:63-67` and `:55-58`: `blockFor(null)` starts from `range.startContainer`,
  which for a selection spanning two paragraphs is a text node inside the **first** paragraph. It
  climbs to that paragraph and stops (`selection.js:129-137`).
- `editBlock` then binds `session.block` to that one element
  (`src/layer/editing.js:498-540`), and only that element is made editable.

So a selection dragged across a paragraph boundary opens the first paragraph and nothing else. One
record never covers two anchored regions, which is what the group id existed to make safe. The
`commonAncestorContainer` fallback at `editing.js:486-491` runs only when the start container has no
block ancestor at all, and in that case the ancestor it finds becomes the region in its own right,
with `before` and `after` describing that whole element consistently. Replay then rewrites the region
it anchored, so RF10's "rewrites the first and leaves the second standing" cannot occur.

`test/browser/editing_two_regions.spec.js` does not test RF10's gesture. It runs two separate
Cmd-Shift-E sessions and asserts they undo independently.
`test/browser/paragraph_break.spec.js` is about Enter inside one open block.

**Untested residual:** nothing pins the behavior this verdict rests on. A test that selects across a
paragraph boundary, presses Cmd-Shift-E, and asserts exactly one record naming the first block would
turn "cannot happen by construction" into "cannot happen, and the gate says so".

---

## Row 11. R31 (format-only counts): an HTML-level comparison rule

**Cites:** RF9, format half.

**Verdict: BUILT**, and used rather than merely carried.

- The kind: `src/shared/record.js:107`, `FORMAT_ONLY`. It is chosen at commit by comparing normalized
  text: `src/layer/editing.js:380`, `if (textSame) return {changed: true, kind: record.KIND.FORMAT_ONLY};`
- The comparison mode: `src/shared/normalize.js:629-638`, `modeFor(kind)` returns `STRUCTURE` for
  `format_only`, and `structureEquals` compares a canonical string built from a closed tag list,
  `STRUCTURAL_TAGS = ["em", "strong"]` (`normalize.js:628`). `cleanMarkup` has already renamed `b` to
  `strong` and `i` to `em`, so the comparator only ever sees two tag names and a framework's extra
  wrapper cannot read as a format change.
- The fields: `src/shared/record.js:802-805`, `comparisonFields()` returns `before_html` and
  `after_html` for a format-only record.
- The proof it is wired: `src/layer/replay.js:1148-1158`, `domValueOf`, returns `element.innerHTML`
  for a format-only record and `normalize.blockTextFromNode(element)` for everything else.
- Tests: `test/unit/replay_pass.test.js:307` ("a format-only record compares on structure, so a
  text-equal change is still a change"), `:323` (two successive format-only rewordings resolve as
  branch three rather than a false conflict), and `test/browser/replay_branches.spec.js:167`.

---

## Row 12. R36 (page updates as changes land): an owner for the refresh

**Cites:** RF13.

**Verdict: BUILT.** The helper owns the watch, which is what RF13 asked for.

- The helper reports the reviewed file's mtime on the channel the library already polls:
  `src/service/routes.js:303-310`, `target_mtime: deps.reviews.targetMtime(request.review, request.query.page_path || null)`,
  with the comment "`target_mtime` is R36's refresh trigger for a static page".
- The wire contract names it: `src/shared/protocol.js:246`.
- The helper also heals a rebuild that stripped the script line, and settles a file still being
  written: `src/service/heal.js:109-245`.
- The library reloads on a different non-null value, debounced, and defers while the reviewer is
  mid-work: `src/layer/sync.js:91-121` and `:341-347`, plus `src/layer/index.js:388-398`.
- Tests: `test/unit/target_mtime.test.js:40`, `:82` ("a rebuild moves the mtime the poll reports"),
  `:107` (one page's rebuild does not reload another), `:142` (a missing file reports null rather
  than throwing); `test/unit/viewport_reload.test.js:223`; and
  `test/browser/auto_reload.spec.js:206`, `:235`, `:333` ("no reload lands on an open edit; it waits
  until the edit is committed"), `:404` (a rebuild that stripped the script line heals itself).

---

## Row 13. R26 (basic formatting), the line under the table: "named once as a record kind and never given an implementation, a vocabulary, or a paste rule"

**Verdict: PARTLY BUILT.** The implementation and the vocabulary exist. The paste rule does not, and
the surface itself is untested.

### Built

- The mechanism is decided in writing and implemented: `src/layer/editing.js:74-88` picks
  `document.execCommand` with `styleWithCSS` false so tags are emitted rather than style attributes,
  and `:178` and `:461-471` run that boot command.
- The vocabulary is closed: `src/layer/editing.js:168-174`,
  `COMMANDS = {bold: "bold", italic: "italic"}`, described as "An enum rather than a pass-through
  string, so a builder cannot reach a command this tool never decided to support".
- There is a real surface: the edit bar built at `src/layer/editing.js:1341-1389` carries a B button,
  an I button, and Delete block, and blocks `mousedown` so pressing one does not steal the caret.
- Test: `test/unit/editing_surface.test.js:119` asserts the command list is exactly bold and italic.

So the review note's literal claim ("never given an implementation, a vocabulary") is stale.

### Not built

- **No paste rule.** `onBeforeInput` (`src/layer/editing.js:687-711`) intercepts only the break
  intents, and says so: "Nothing else is intercepted. Every other inputType is the engine's, the way
  typing has always been." `insertFromPaste` is untouched, confirmed by
  `test/unit/editing_surface.test.js:223`. Nothing anywhere in `src/` listens for `paste` or reads
  `clipboardData`.
- `cleanMarkup` is not a formatting whitelist. It drops a fixed list of dangerous subtrees, renames
  `b` to `strong` and `i` to `em`, and strips a short attribute blocklist
  (`src/shared/normalize.js:144-168`). Tags outside that list, `u`, `mark`, `sup`, `sub`, `s`,
  `table`, `img`, headings, links, survive with their attributes cleaned.

### Consequence and fix

A reviewer pastes a sentence from another document or a web page into an open edit region. Whatever
underline, highlight, superscript, table, or image markup rode along stays in the DOM and in
`after_html`, past a vocabulary the design says is closed at bold and italic. Replay's structural
comparator ignores those tags, so a format-only compare can also read equal on two visibly different
blocks.

Fix: handle `paste` in the edit region, insert the clipboard's plain text (or its text with only
`strong` and `em` preserved), and add a test that pastes rich HTML and asserts the captured markup
holds nothing outside the closed list.

### Untested, separately

Nothing drives the B and I buttons. `test/browser/edits_tab.spec.js:63-83` produces its format-only
record through the harness hook `window.__laheEdits.format("bold")`, and no test in the repo
references `lahe-edit-bar` or clicks the buttons. There is also no keyboard route: `Cmd-B` has no
entry in `src/shared/gestures.js`, so it falls through to `PAGE_DEFAULT` and whatever the engine's
own contentEditable does with it, which is undecided rather than decided.
