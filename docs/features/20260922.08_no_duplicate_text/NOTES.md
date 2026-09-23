# The reviewer's words, once

Summary: replay was writing every paragraph of a multi-paragraph edit into the
one block it anchors, while the rebuilt page already carried those paragraphs
as blocks of its own. The reviewer's words then stood twice, and a reload put
it right. Two changes stop it: the split compare now reads past typography, and
no write happens that the page's own blocks would double.

Not one of today's merges. The same walk duplicates text at `e4346f1`, before
the anchor climb, the conflict toast, and the split-counts-as-applied change.

## The report

2026-09-22: "multiple agents have now duplicated my written text. i highlight
and write what i want, and they just write it again above or below. i think
after refresh it might fix, but that's not an ok ux." No source file on disk
carried a duplicated paragraph, so the second copy was drawn in the page.

![The Intro paragraphs, each of the reviewer's standing twice](duplicated_before.png)

## Cause

The shape that duplicates:

- The reviewer keeps a paragraph and types more under it, so the record's
  `after` is several paragraphs and its `before` is the first one.
- The agent writes them into the Markdown as separate paragraphs, which is
  right, and the rebuilt page has one `<p>` per paragraph.
- The split check (`splitApplied`, 2026-09-22) asks whether the anchored block
  plus the blocks right after it spell the after. It compares strings exactly,
  so a curly apostrophe or an em dash the Markdown came back with is a miss.
- With the split missed, the anchored block still reads as the `before`. That
  is branch two, re-apply, and the write puts all of the after into that one
  block. The page then says the second and third paragraphs twice: merged into
  the first block, and still standing below it.

A reload did fix it, for one pass: the page renders from its own source again,
and the duplicate only comes back when replay next writes.

## Fix

Both in `src/layer/replay.js`.

- **The split compare reads past typography.** `samePiece` compares two
  paragraphs through `normalize.foldTypography` when the strict compare misses,
  and `splitApplied`, `runAt` and `splitRegion` try strict first and folded
  only after. The question a piece answers is "are these words already on the
  page, in a block of their own", and a curled quote does not change that
  answer. Folding is not used to decide that a SINGLE block already says the
  after, so a punctuation fix the reviewer made to one paragraph still
  re-applies, exactly as before.
- **A write the page would double does not happen.** `wouldDuplicate` asks, of
  every write of a multi-paragraph after, whether the block right after the
  anchored one already says the after's second paragraph. When it does, replay
  writes nothing and flags the record instead. Flagging is the honest answer:
  the page carries some of the reviewer's paragraphs and not the rest, and
  picking which of the page's own blocks to replace is a guess (D9).

`counters.regionsRefusedDuplicate` counts the refusals.

![The same page, each paragraph once](once_after.png)

## Known gap

"Keep mine" on a conflict still writes the whole after into the one anchored
block. When the page carries the rest of the paragraphs below, that press
doubles them, the same way the automatic pass used to. It is a press the
reviewer makes rather than something that happens to them, and fixing it means
deciding which of the page's blocks the press replaces, so it is left as its
own change.

## Tests

- `test/browser/no_duplicate_text.spec.js`, the real `lahe review post.md`
  walk, six cases. The typography one was red before the fix and is the
  reported bug:
  - a single paragraph replacement
  - a multi-paragraph replacement the source carries as separate paragraphs
  - a replacement whose first paragraph comes back curled
  - paragraphs appended under an unchanged one
  - the same, where the rebuild curled a quote and lengthened a dash (red
    before the fix: the second and third paragraphs were each on the page
    twice)
  - the same, where the agent reworded the last paragraph
- `test/unit/replay_pass.test.js`, three cases: the folded split is applied,
  one block is still compared strictly, and a write the page's blocks would
  double is refused and flagged.
- `npm run gate:unit`: 1279 passed, 0 failed.
- Browser, `--workers=1`, 39 passed: `split_not_conflict`, `replay_branches`,
  `replay_human_and_agent`, `conflict_toast`, `italic_sticks`, `inline_reword`,
  `reword_rev`, `paragraph_break`, `no_duplicate_text`.
