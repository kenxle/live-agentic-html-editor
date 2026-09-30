# Free writing

Shipped in PR #20 (merge 6f3bc6b). Read this before touching `src/layer/editing.js`, `blocks.js`, `replay.js`, or the run fields in `src/shared/record.js`. The feature folder (`docs/features/20260928.01_free_writing/`) is the history of why; this page is how it works now. Where the two differ, this page and the code win.

## Summary

- A reviewer can write new paragraphs, headings, and lists on a page, not only reword a block that is already there.
- One sitting (everything typed between opening an edit and leaving it) is still one `edit` record. There is no new record kind.
- The record is an existing block, called the anchor, plus a run of new sibling blocks written after it.
- Replay puts the run back after every reload, one block at a time, and never writes a block the page already shows.
- `lahe write notes.md` starts a blank notes page for writing from nothing.
- A long run (over 150 words) gets a proofreading question from the agent, with two buttons on the card.

## How the reviewer gets there

- Cmd-Shift-E in a block opens an edit on it, as before. Enter at the end of a block starts a new paragraph after it.
- With the caret in no block, Cmd-Shift-E opens edit state with no block open. The "+ Write here" lines show between blocks and below the last one. A click on one opens a session with an empty first block.
- The bar has a block menu before B and I (Paragraph, Heading, Subheading, Small heading, Bulleted list, Numbered list). The menu, the hotkeys, and the Markdown shortcuts all go through one function per type in `editing.js`.
- The hotkey table and the shortcut list are pinned in the plan (`03_plan_free_writing.md`, "Block-type hotkeys"); the matcher lives in `src/shared/gestures.js`. The `#` shortcuts follow Markdown: `## ` makes h2, `### ` h3, `#### ` h4, and `# ` also makes h2, because the page title is the h1.
- Paste is plain text. Rich paste is board row `LAHE-rich-paste`.

## The editing host

- The session makes one element `contenteditable`: the host. It is the nearest parent that holds both the anchor and its run. For a container anchor it is the container itself. `blocks.js` owns this rule.
- A `beforeinput` guard refuses every edit outside the anchor and the run: select-all then type, drop, cut, the browser's own undo, and formatting commands.
- The layer writes block changes itself (Enter, type changes, Backspace across a block edge, typing over a selection that spans blocks). The browser's undo no longer matches, so the session keeps its own undo history in `editing.js`.
- A new block goes after the anchor's parent when that parent holds only the anchor plus inline chrome. On the Markdown render, that puts a block written under a heading after `sheet-head`, not inside it. `blocks.insertPointAfter` is the one copy of that rule; Enter, replay, and a missing block all use it.
- The host's focus ring is hidden by one scoped rule in `highlight.js`. It matches only the attribute the layer sets, which goes away at commit.
- Protection (`protect.js`) holds the anchor and every run block. After a repaint it re-finds the anchor, rebuilds the run, puts the caret back by block index and character offset, and makes the new parent the host again. See `docs/diagrams/protected_region.md`.

## The run record

An edit record gains these fields. They are spelled in `src/shared/record.js`; the wire and review.json side is in `docs/CONTRACTS.md`.

| Field | Meaning |
| --- | --- |
| `new_blocks` | The run, in order: `{tag, html}` per block, `tag` one of p, h2, h3, h4, ul, ol. A record is a run record when this is not empty |
| `from_anchor` | On a `new_blocks` entry: the tail of an anchor split with Enter. Those words moved; they are not new. Words the reviewer typed into the tail make the whole tail one ordinary new block |
| `anchor_after_html` | The anchor's own inner markup after the sitting |
| `anchor_tag_after` | The anchor's new tag when the reviewer changed its type, else null |
| `placement` | `after_anchor`, or `start_of_container` when the page has no content blocks |
| `remove_blocks` | Take-back records only: blocks to remove, each with `tag` and `html`. A take-back never carries `new_blocks` |

- `before`, `after`, and `after_html` still describe the whole sitting. `after_html` is the anchor's markup followed by each new block as its own tagged element, so an agent that only knows "apply after_html" still gets every block.
- Every block passes `normalize.cleanBlock` three times: at capture in the layer, when the helper appends the event (`src/service/log.js`), and before replay writes it. The one tag list is `WRITABLE_BLOCK_TAGS` in `src/shared/normalize.js`. A forged block makes replay write nothing for the whole record.
- Two sittings in the same place: a block that belongs to an outstanding record reopens that record at a new revision. Once the record is handled, its blocks are the page's own and a new sitting starts a new record.
- A change of the anchor's type is `anchor_tag_after`. A tag-only change is `format_only`; a tag change with new words is `edit`.
- Undo of a handled run raises a take-back with `remove_blocks`. Replay removes those blocks and never replays the original run.

## Replay of a run

The path is `applyRun` and `placeRun` in `src/layer/replay.js`. The picture is the second diagram in `docs/diagrams/replay_branches.md`; the ladder that finds the anchor is `docs/diagrams/finding_the_region.md`.

- The anchor is found by the normal ladder. A container anchor is found by its tag alone and never compared, because after the notes land its text is the whole page.
- The four-way compare runs on the anchor view (`anchor_after_html` in place of the whole sitting), so the run's words are never written into the anchor. An anchor the reviewer left alone is never compared at all.
- On a conflict on the anchor (branch four), the run stays on the page after the anchor while the card waits. Either answer then places the run. The anchor is written only when the reviewer says so.
- The run is placed by `blocks.runElementsFor`: walk leaf blocks forward from the insert point, in document order, and decide each new block by the presence table in `replay_branches.md`. The walk stops at the first leaf that matches nothing after a match, or two leaves past the run's length (`RUN_WALK_SLACK`).
- Tag and markup never decide whether a block is present. A present block with the wrong tag or lost bold or italic is rewritten in place, not inserted again.
- Five or more words (`SHORT_BLOCK_WORDS`) that already show as a whole block elsewhere on the page are never written again. Blocks under five words are inserted without that search.
- A leaf that holds a run block's words plus words the reviewer never typed is a conflict on that block. Replay writes nothing, anchor included, and the card shows both versions. "Keep mine" rewrites the leaf and remembers the page state; "Take the page's" makes the page's block the record's own.
- An anchor the reviewer never changed, whose words the agent later rewrote, marks the run lost. Replay never guesses a place without a card. See the known limits below.

## The handled check

There are two checks, and they do different jobs.

- **The page check** runs in the browser once per load on a handled item (`pageCheckReasonFor`, `runCheckReason` in `replay.js`). For a run it reads the anchor and each block on its own. A missing block reopens the item as undone. A wrong tag and lost bold or italic each have their own note. The "Section N" label between blocks never counts against it.
- **The helper's check** runs when the agent replies handled (`src/service/handled_check.js`). It matches by words, because the helper cannot find a region in a built page. For a run it finds the first block's leaf page-wide and matches the rest in order. It does not test tags; the page check does that after the agent's write.
- Because an unchanged anchor makes the whole sitting look like "only added words", the helper judges a run only when nothing in the review was written. An agent that places one run and says handled on two is not caught by the helper. The page check catches the skipped one on the next load.
- Format-only edits (bold or italic added to existing words) are checked the same way: each span whose formatting changed must sit inside a `strong`/`b` or `em`/`i` in the built page.

## `lahe write` and its one-page server

- `lahe write notes/day.md` creates the Markdown file if it is not there (its folder must exist), or opens an existing regular `.md` file as is. It never overwrites, and refuses a symlink, a directory, or a file with more than one hard link. Code: `src/cli/commands/write.js`. Flags and output: `docs/CLI.md`.
- The page gets its own one-page server (`src/service/static_servers.js`): the page, the style and fonts it names, and 404 for everything else, dotfiles and other reviews' pages included. It answers only its own loopback address. The reason is that a notes file in a broad folder must not serve the folder.
- The review carries `notes: true`. That turns off proofreading for the review.
- An empty Markdown file renders a hero title from the file name. `markdown.js` marks that title as chrome (`data-lahe-file-title`) so it is never a content block. The page then has no content blocks, and the first sitting uses `placement: start_of_container` on the page's one `main`.
- After the first record is placed and handled, later sittings use `after_anchor` like any page.

## Proofreading

- The helper sets `proofread: true` on a run item whose `run_words` (the run's words without `from_anchor` blocks, counted by one function in `normalize.js`) is over `PROOFREAD_MIN_WORDS` (150, in `review_format.js`), unless the review is a notes review. The agent never counts.
- The agent places the words as written, rebuilds, and replies `question` with `--proofread` and one `--suggest <block> <from> <to>` per fix. `lahe reply` refuses a `<from>` that is not in that block's words exactly once.
- The card shows two buttons, only for a proofread reply. "Use the fixes" applies the suggestions as the reviewer's own reword of the same record at a new revision; replay then rewrites the placed blocks in place. "Keep mine" posts a thread reply, and the agent changes nothing. A plain placement question keeps today's question card.

## Size limits

| Limit | Value | Where |
| --- | --- | --- |
| Blocks in one run | 400 | `NEW_BLOCKS_MAX`, `src/shared/record.js` |
| Bytes of run markup | 200000 | `NEW_BLOCKS_MAX_BYTES`, `record.js` |
| Whole committed record | 4 MiB | `RUN_RECORD_MAX_BYTES`, `record.js` |
| Revisions that keep `new_blocks` in `after_history` | 3 | `RUN_HISTORY_KEEP`, `record.js` |
| Draft floor for a run record | 30 seconds (10 for other records) | `FLUSH.RUN_DRAFT_FLOOR_MS`, `src/shared/protocol.js` |
| Session undo steps | 100 | `SESSION_HISTORY_MAX`, `editing.js` |

- The helper refuses an event over a ceiling with `RUN_OVER_CEILING`. The bar warns at 90 percent and refuses input that would grow the run at the ceiling. A refused event is not re-posted; the card says the agent has not seen it and the words stay in the browser.
- For a run record, `new_blocks`, `after_full`, and `after_html` skip the 2000-character data bound in review.json. The ceilings bound them instead.
- The "AQ4" history-size question (history is never trimmed for the whole sitting's `after` and `after_html`) is still Ken's call; see the architecture's Open Questions.

## Known limits (boarded in `docs/BULLETIN.md`)

- `LAHE-untouched-anchor-rewritten`: new text after a paragraph the reviewer never touched goes lost if the agent rewrites that paragraph. Replay cannot find the anchor by its words and will not guess. A fix would ask the reviewer with a card.
- `LAHE-repaint-caret-one-move-back`: if a repaint destroys the block between a click or keypress and the browser's caret-moved event, the caret goes back one move. Text is kept. The fix is to also update the snapshot on mouse-up. The plain-edit path has the same gap.
- `LAHE-rich-paste`: paste is plain text. Bold, italic, headings, and lists from another page are not kept.
- `LAHE-file-title-edit-contract`: a Markdown page with no `#` heading shows the file name as its title, and that title stays editable. The agent contract does not yet say what such an edit means (add a real top-level title to the source, never rename the file).

## Where things live

| Job | File |
| --- | --- |
| Session, block types, Enter, paste, undo, the bar menu | `src/layer/editing.js` |
| DOM block rules: leaf walk, insert point, host, tag swap, a record's run | `src/layer/blocks.js` |
| Protection of the anchor and run | `src/layer/protect.js` |
| Placing a run, the page check, the conflict card | `src/layer/replay.js` |
| Empty-container rung, tag tie-breaker | `src/layer/anchor.js` |
| `cleanBlock`, run matcher, `run_words` | `src/shared/normalize.js` |
| Run fields, validation, ceilings, take-back | `src/shared/record.js` |
| Contract lines, projection, `PROOFREAD_MIN_WORDS` | `src/shared/review_format.js` |
| Helper checks and the size ceiling | `src/service/log.js`, `src/service/handled_check.js` |
| `lahe write` and the one-page server | `src/cli/commands/write.js`, `src/service/static_servers.js` |

The contract lines an agent reads (place blocks in order, escape them as literal text, `from_anchor`, `anchor_tag_after`, `placement`, proofreading) are in `skills/lahe/SKILL.md` and `docs/CONTRACTS.md`, and travel with the contract in `review_format.js`.
