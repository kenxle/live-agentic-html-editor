# A split is not a conflict

Summary: when the reviewer types several paragraphs into one block and the
source carries them as separate blocks, replay now reads that as applied. No
conflict card and no conflict toast.

## Cause

Review r88dec64b8451. The reviewer typed seven paragraphs into one `<p>`. The
record's after had blank lines between them. The agent wrote them into the
Markdown source as separate paragraphs, which is right.

The rebuilt page had one `<p>` per paragraph. Two things then went wrong:

- The text search binds the innermost element holding all of the probe's
  words. Spread over several blocks, that element is their container (the
  whole section), not the first paragraph.
- Replay compared that one element against the whole after. It matched
  neither the after nor the before, so it took branch four and the toast said
  the edit clashed with the page. Every word was there.

The same false conflict happened for a single newline that the page showed as
a new block or ran into one line.

## Fix

All in `src/layer/replay.js`.

- **Region:** when the bound element is not itself where the run starts,
  replay looks inside it for the one block where it does (`splitRegion`).
  Exactly one, or the bind stays where the search put it.
- **Compare, branch one:** an edit whose after has breaks is applied when the
  anchored block plus the blocks right after it, read in order, spell the after
  split on its breaks (`splitApplied`). The rules:
  - the first piece has to be the anchored block
  - only consecutive siblings, at most as many blocks as the after has pieces
  - an empty block or loose words between blocks end the run as a miss
  - text mode only

  It is asked before the before check. A first block that is both the before
  and the first piece is applied when the siblings carry the rest.
- **Reflow:** the same words with the breaks moved. Matching the after is
  branch one; matching the before (a page that merged the before's
  paragraphs) is branch two. When before and after have the same words, the
  breaks are the edit, so reflow decides nothing.

## Branch two does not write across blocks

Branch two still writes into the one anchored block, as before. That is how a
live page keeps a break the reviewer typed. It does not learn to write a
multi-block after across siblings, because that means deciding which of the
page's own blocks to replace, which is a guess (D9).

A source that already carries the split is caught by branch one first, so it
is never rewritten. The bold and italic check is skipped for a split for the
same reason: its fix is a write into one block.

## Not changed

A conflict raised before the agent's reply arrives stays standing after the
item turns handled. This fix stops this case from raising one at all.
Clearing a standing conflict when the reply lands would be a separate change.

## Tests

- `test/unit/replay_pass.test.js`: 12 new tests, 8 red before the fix. They
  cover:
  - blank-line paragraphs
  - a single line break shown as a new block, or run into one line
  - three pieces, over three blocks or over two with a `<br>`
  - a sibling that differs, a missing piece, an empty block
  - a first piece that is not the anchored block
  - split beats before
  - a merged before
  - the same-words guard
  - three pass-level cases, including the container bind
- `test/browser/split_not_conflict.spec.js` covers the real sequence:
  - type three paragraphs, commit, the source becomes three `<p>`, reload: no
    conflict card and no toast (red before the fix)
  - the control, where the last paragraph differs, still conflicts
- `npm run gate:unit`: 1271 passed, 0 failed.
- Browser, `--workers=1`, 33 passed:
  - `replay_branches`
  - `replay_human_and_agent`
  - `conflict_toast`
  - `inline_reword`
  - `reword_rev`
  - `italic_sticks`
  - `paragraph_break`
  - `split_not_conflict`
