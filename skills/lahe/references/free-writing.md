# Place new writing and proofreading

Read this when an item has `new_blocks`, `remove_blocks` or `proofread`.
Use [feedback](feedback.md) for the common item and reply rules.

- **An item with `new_blocks` is new text the reviewer wrote after the anchor.**
  Place the blocks after the anchor, in order, each with its tag and its bold
  and italic: `html` is what to place, `text` is its words. `new_blocks` is the
  whole run at this rev, so place only the blocks not already in the source.
  When a new rev changes the words of a block you already placed, replace that
  block's words in place; never add it a second time.
  `after_html` is still the whole sitting; `anchor_after_html` is the anchor's
  own change.
  - `placement` `after_anchor` is right after the anchor block.
    `start_of_container` is the top of the file, below any front matter, or for
    HTML the start of the container the region names.
  - A block marked `from_anchor` is the anchor's own tail: split the anchor
    there, and do not add those words again.
  - When `anchor_tag_after` is set, change the anchor's element to that tag.
  - The words are literal text, exactly as typed. Escape them for the source:
    in Markdown, backslash-escape anything Markdown reads as syntax and write
    `<` as `&lt;`; in a template (ERB, Jinja, Liquid, JSX), write them so the
    template prints them and never evaluates them.
- **An item with `remove_blocks` is the take-back of new text.** Remove those
  blocks from after the anchor in the source. It never carries `new_blocks`.
  A take-back of a type change carries the anchor's old tag in
  `anchor_tag_after`: change the anchor back to it.
- **When an item carries `proofread: true`**, place its `new_blocks` as
  written, rebuild, then reply `question` with `--proofread` and one
  `--suggest <block> <from> <to>` per fix (`block` is the index in
  `new_blocks`). Say in `--text` that you placed the words as written, and
  change none of them. The reviewer answers with a button:
  - **Use the fixes** posts "Use the fixes you listed. Change nothing else." The
    item comes back at a new rev whose `new_blocks` carry the fixed words and
    whose `proofread` is false or missing. In the source, replace each fix's `from` words
    with its `to` words in the block you already placed, and add no block
    again. The fixes are listed as `block`, `from` and `to` under `suggestions`
    in the thread's last agent turn.
  - **Keep mine** posts "Keep mine as written. No changes." Change nothing and
    reply `handled`.
- **On a notes review** (`review.notes` is true), place the text and stop.
  Organize it only when the reviewer asks. Never write prose of your own into a
  region the reviewer wrote; suggestions go in your reply. When you cannot tell
  where new text belongs, reply `question` and ask.

For new writing, do not use the anchor's after text as the whole run:
`new_blocks` carries it. On every handled reply the page check tests each
new block, or tests that taken-back blocks are gone. See
[the handled check](feedback.md#a-handled-reply-is-checked).
