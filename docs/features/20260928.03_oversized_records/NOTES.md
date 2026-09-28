# Oversized records

Branch `oversized-records`. The three oversized-record bugs from the [draft persistence analysis](../20260916.05_memory_audit/DRAFT_PERSISTENCE.md) ("Later findings"), fixed for new records. Old records still load and replay. No real data was touched.

## Summary

- **All three are fixed for new records.** Each fix has a test that was red on the old code for the reported reason and is green now.
- **The whole-page highlight is found.** A triple-click ends its selection at the start of the next block. So the comment's region climbed to the container of both blocks: on a flat page, `<main>` or `<body>`. The whole page was then the comment's "passage", and it got painted.
- **Measured today:** 199 of 3,900 records are oversized. Every save repeats the whole record, so those records account for 157,363,892 bytes of the 734,182,327-byte logs.
  - Most of those bytes are draft snapshots, which the compaction tool already drops.
  - 4,651,373 bytes sit on committed lines, which compaction keeps.
- **Cleanup:** only the embedded-image case can be rewritten safely offline. The other two need the page to rebuild the right values. See "Cleaning up the old records".
- **D9 is untouched.** A write still needs exactly one candidate.

## 1. The text after a spot ran to the end of the page

**Cause.** Mint widens the context outward and then up, ring by ring, until the region is unique. If no ring makes it unique, it keeps the comment anyway (text_unique: false). The bug: the stored `prefix` and `suffix` were whatever the last, widest ring held.

That happens whenever the words cannot be found again. A label inside an inline diagram is one example: the text walk never enters an `<svg>`. Another is a row of identical items. Near the top of a document, the widest ring is the next whole sections of the page. One Mermaid comment stored 64 KB this way.

**What a text selection stores today.** When a text selection's words are unique on the first ring, mint stores one whole sibling on each side, from the nearest ring. That is the bar.

**Fix** (`src/layer/anchor.js`, end of `mintInner`). When widening runs out, the reference keeps the nearest ring's context, one whole sibling each side, with `context_level: 0`. That is the same neighbourhood a unique text selection keeps. It is also what the point ladder reads as "text before" and "text after". No ring made the region unique, so no wider ring earned its place. Nothing the reviewer wrote is touched.

**Not changed:** a region that becomes unique on some ring still keeps that ring's context. It is one whole sibling, so a big neighbour (a 3 KB editor panel next to a paragraph) is still stored whole. The measurement below counts only the run-out case.

## 2. An embedded image was stored three times

**Cause.** An image written into the page as a `data:` URL is stored whole in three places:

- `region.ref.probe`, the signature
- `context.subject.src`
- inside `context.subject.html`

One comment came to 516 KB.

**Fix.** The value is stored once, whole, in `context.subject.src`. The other two refer to it:

- **The signature** holds a fixed-size name: `embedded:<media type>:<length>:<64-bit digest>`, from `normalize.embeddedName`. Two pictures that differ anywhere get two names. Two copies of one picture get one name, so they are ambiguous exactly as before.
- **`subject.html`** carries `src="lahe:subject.src"` in place of the value (`record.SUBJECT_SRC_REF`). `record.subjectHtmlOf` puts the value back. `review.json` and Copy/Export use it, so the agent sees the same full tag as before.
- **Old records:** a signature stored before this carries the value in full. `anchor.isLegacyProbe` spots it, and the candidates are compared in the old spelling. Old `subject.html` has no pointer and passes through unchanged.

**Owner's direction, as built.** An element's identity is its opening tag minus the library's own attributes, plus child `<source>` tags for media, stored once:

- `subject.html` now carries the `<source>` children of a `<video>`, `<audio>` or `<picture>`.
- "Volatile attributes" means what the code already strips: the library's own attributes, such as the stamp. No other attribute was dropped.
- The signature attributes did not change, so matching did not change.

## 3. A highlight that covered the whole page

**Found in the records.** 103 records have a region that is the page itself. 102 of them came from selections. The quotes are one heading or a few paragraphs, but the region is `<main>` or `<body>`, and its probe is the whole page's text.

**Why.** `commentOnSelection` took the element around both ends of the selection's range. A triple-click on a heading gives a range that ends at offset 0 of the next block. So "around both ends" is the shared parent. On a flat page that is `<main>` or `<body>`. From there, two paths wash the whole page:

- **The stamp.** It goes on `<main>`. Any change anywhere on the page then reads as "your passage was reworded". Replay took the stamp as a certain place, and painted `<main>` end to end.
- **A repaint.** If the quote's words appear twice on the page, the repaint cannot narrow to them. It falls back to the whole region, and the region is the page.

Both need "something on the page moves", which matches Ken's report.

**Fix, three parts:**

- **The real region** (`src/layer/comments.js`, `selectionElementOf`). The region is the smallest element that holds every character the selection actually selects. Range ends that select nothing visible are ignored. A triple-clicked heading is now the heading.
- **Honestly lost** (`src/layer/replay.js`, `stampedPlace`). A stamp on a page-sized element is no longer a certain place for a comment. The pass goes on to the point ladder, and the record is reported lost.
- **Never painted end to end** (`src/layer/highlight.js`, `coversWholePage`). Every paint goes through this file. A range covering the whole contents of a page-sized element is refused, and `paint` returns null. "Page-sized" is `anchor.isPageSized`: `<body>`, `<html>`, or an element holding every word the page has. A range the reviewer drew over their own words, even "select all", starts and ends inside text, so it is never refused.

**Still true after the fix:** a real multi-block selection (a heading plus its paragraph) still anchors on their shared parent. If that parent is the whole page, the comment is never washed end to end. Its paint is its own words when they appear once. Its record is lost once the page changes.

## Tests

| Test | Proves |
| --- | --- |
| `test/unit/oversized_records.test.js` (10 tests) | Cause 1: run-out context is the nearest ring, for an unreachable label and for identical items, and D9 still refuses. Cause 2: one copy in the record, distinct and same-source images, an old full-value signature still resolves, `review.json` projects the same tag, and media `<source>` tags. Cause 3: `isPageSized`. |
| `test/unit/replay_pass.test.js`, "a stamp on an element holding the whole page is not a certain place for a comment" | Cause 3: a stamp on `<main>` gives a lost record and no paint. |
| `test/browser/oversized_records.spec.js` (4 tests, fixture `test/fixtures/oversized-records.html`) | The same three causes in Chromium. It uses a real 480x240 PNG as a `data:` URL (over 100 KB) and a real triple-click. |

All four browser tests failed on the pre-fix `src/`, each for the reported reason: the appendices in the suffix, the image in the record 3 times, the region `section:1` instead of `h2:1`, and a 564-character wash.

**Runs** (Node 20.19, `--workers=1`):

- `npm run gate:unit`: lint passed; 1,358 pass, 0 fail. One earlier run showed 1 failure that did not repeat in the next two full runs.
- Browser specs, 55 passed, 0 failed:
  - anchor_engine
  - element_subject
  - comments_highlights
  - highlights_after_reload
  - late_render_highlights
  - probable_place
  - graceful_failure
  - card_click_jump
  - selection_popover
  - change_highlight
  - heading_context
  - oversized_records

`dist/` was rebuilt locally for the served-page specs and not committed.

## Measurement

`scripts/measure_oversized_records.js` is read-only. It scans `~/.local/state/lahe/reviews/*/events.jsonl` and writes one row per affected record to `/private/tmp/claude-501/oversized_records_2026-09-28.csv`. The summary is beside it, as `.summary.json`. The rule for each cause is at the top of the script.

Run on 2026-09-28: 515 reviews, 175,278 log lines, 734,182,327 bytes, 3,900 records.

| Cause | Records | Oversized bytes now (latest revision) | Bytes across every log line | Of those, on committed lines |
| --- | --- | --- | --- | --- |
| Context ran out | 91 (83 picks, 8 selections) | 774,236 | 22,673,992 | 674,032 |
| Embedded image repeated | 5 (all picks) | 1,179,748 | 3,539,244 | 1,179,748 |
| Region is the whole page | 103 (102 selections, 1 pick) | 2,696,639 | 131,150,656 | 2,797,593 |

- No record matches two causes: 199 records in all.
- "Bytes across every log line" is the oversized field's size, summed over every line that carries it.
- "On committed lines" is the part on lines that are not draft snapshots. The draft compaction keeps all of these, so they are what is left after compaction, at the least.

## Cleaning up the old records

**The compaction tool first.** Branch `compact-draft-history` drops superseded draft snapshots. Across these causes it would remove most of the 157,363,892 repeated bytes on its own, with its existing projection proof. It does not touch record contents. Re-run this script on the compacted copy to get the exact remainder.

**Rewriting record contents does not fit its proof as it stands.** That proof requires the fold state and the `review.json` bytes to be identical before and after. Any content rewrite changes the fold state. Per cause:

- **Embedded image repeated (5 records): safe to rewrite, with a narrower proof.** For every line of the item:
  - replace the full value in `region.ref.probe` with `normalize.embeddedName` of it
  - put the pointer in `context.subject.html`

  Proof: the `review.json` bytes stay identical, because `subjectHtmlOf` restores the tag and the probe is not projected. The fold state is identical except for those two fields, and they re-expand to the originals. Two conditions:
  - It runs only after this branch's layer is in `dist/`. An older layer cannot read the new signature.
  - A browser's local copy may post the old form back on the next edit of that item. That is harmless, because the old form still reads.
- **Context ran out (91 records): not safe offline.** The right value is the nearest ring on the page as it was, and the record does not store it. The only offline rewrite is to empty `prefix` and `suffix`. That changes `review.json` (context is projected), and it removes the "where it was" hint the point ladder uses. It needs Ken's call. Most of these bytes are in drafts anyway.
- **Region is the whole page (103 records): not safe offline.** The real region is the selected block, and finding it needs the page and the original range. Rewriting the probe would change what the record anchors on. These records are already harmless to paint: the paint guard never washes them end to end. Their cost is size, and compaction takes most of it.

## Decisions for Ken

1. **Clean the 5 embedded-image records** with the narrower proof above, after compaction runs. Or leave them: they total 1,179,748 bytes on committed lines.
2. **A pick on the page itself** (clicking the margin in pick mode) still makes a comment whose region is the whole page. It is never washed now, and it is lost once the page changes. It could open a page note instead. That changes a gesture, so it is Ken's call.
3. **A big nearest neighbour** (a 3 KB sibling next to a paragraph) is still stored whole as context. Bounding it to a fixed number of characters is possible without touching the reviewer's words. But it trades away some power to tell identical rows apart, so it is not done here.

## To delete at cleanup

Nothing. The commit message files (`.claude-commit*`) are gitignored. The CSV and summary are under `/private/tmp`.
