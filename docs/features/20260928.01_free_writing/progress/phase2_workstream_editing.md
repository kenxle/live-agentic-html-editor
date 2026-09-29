# Phase 2, editing workstream (2A): progress

Work in progress. Sections fill in as each task lands.

## Existing specs whose Enter result changes (Task 2.1, sent to the orchestrator before going on)

Found by searching every browser spec for a bare `Enter` or `Shift+Enter` pressed inside an open edit. Cmd-Enter in comment boxes, and Enter on rail controls (`card_collapse.spec.js`, `rail_menu.spec.js`), are not edits and do not change.

| Spec | What changes | New expected result |
|---|---|---|
| `paragraph_break.spec.js`, "Enter in the middle" | Enter mid-paragraph now splits the block into two sibling `p` elements, with the tail marked `from_anchor`. | `after` and `after_full` unchanged. `change` becomes the split sentence ("Split this paragraph in two after the anchor's new end. The second part is new_blocks[0], marked from_anchor.") instead of `BREAK_ADDED_PARAGRAPH`. |
| `paragraph_break.spec.js`, "Enter at the end and a typed sentence" | The typed sentence is a new sibling `p` in `new_blocks`. | `after` unchanged. `change` becomes "Added 1 block after this paragraph: p. Its words are in new_blocks." |
| `paragraph_break.spec.js`, the other four | Shift-Enter stays a line break; an empty trailing Enter is still no record; the replay and rebuild tests read the same text. | Unchanged. |
| `no_duplicate_text.spec.js`, `typeParagraphs` and `appendParagraphs` | Each Enter makes a sibling block, so these records become run records with `new_blocks`. | Asserted `after` strings unchanged. The "on the page once" counts depend on 2B's replay of run records, so they are phase-tier checks after 2B merges. |
| `split_not_conflict.spec.js` | The three typed paragraphs become an anchor plus two `new_blocks`. | The applied case is unchanged. The control ("last paragraph differs still conflicts") may read differently once 2B's presence table lands; that is 2B's and the orchestrator's call. |
| `free_writing_r14.spec.js`, the header case | Enter after an `h2` now writes the line after the `sheet-head`, never inside the `h2`. | The kernel's `test.fail` on the header case should start passing once 2B lands; the orchestrator flips it at merge. |
