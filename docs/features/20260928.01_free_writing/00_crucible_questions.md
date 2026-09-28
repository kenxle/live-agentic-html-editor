# Free writing in LAHE: the crucible

Date: 2026-09-28
Status: ROUND 4, Tiptap question waiting on Ken

Round 1 answers are folded in under each question. Premises are settled below. You picked B. One more decision at the bottom: **Approach D, Tiptap**, which I had wrongly ruled out.

## What you asked for

"The tool is very good at editing already-written AI text, but sometimes I just want to write a few paragraphs myself. It's kinda hacky looking at the moment the way that works. Let's improve the free-writing ability."

## How free writing works today

- The only way in is Cmd-Shift-E on a block that already exists, put the caret at its end, press Enter, and type.
- Your new paragraphs are recorded as one edit of that neighboring block. The agent sees "the paragraph that said X now says X plus three new paragraphs."
- There is no record kind for "new text goes here," and no gesture for it. The three edit kinds are: change a block, change only its formatting, delete a block.
- There is no way to make a header, a list, or any block type other than a paragraph.

## What I looked for first

- No brief, board row, or ongoing doc covers inserting new text. The original brief's editing rules (R24 through R31) all assume the text already exists.
- Prior art: Notion and Google Docs treat a new block as its own thing, created by Enter at the end of a block or a click in empty space. Medium shows a "+" between blocks. Editor libraries (ProseMirror, Tiptap) make a region editable with headers, lists, bold, undo, and paste handling built in. I first ruled them out on the zero-dependency rule, which was wrong: the rule forbids npm installs, not vendored files, and marked and mermaid are already vendored. See Approach D.

## The questions and your answers

### Q1. What is the job?

Three jobs, in Ken's words:

- **Writing material to publish.** Articles and blog posts. Lots of hand writing, needs new paragraphs and headers, and sometimes all he wants afterward is a proofread.
- **Writing material for himself.** Notes. Today he types notes into the terminal and the agent records them, but he cannot see what he already wrote because it is lost in the chat stream. He needs to look back at it often. Letting the agent organize the notes afterward would be great.
- **Editing material.** Word-for-word changes and formatting changes (bold these words) that must be kept exactly.

### Q2. Who is the user?

Ken and others. No defined ideal customer yet. Lahe is a co-authoring tool, so the user is probably someone co-writing with an agent.

### Q3. Where and how does it happen?

Same as normal Lahe: a document, on a laptop, with the normal Lahe functions still running.

### Q4. How do you know the problem is real?

- Basic editing features feel missing. He cannot make headers at all.
- Formatting-only edits are often lost or misinterpreted.
- A new paragraph after an existing one gets inconsistent vertical spacing.
- To add something like an intro, he has to ask the agent for a new header with sample text just so there is a block to open the edit function on.
- On screen it looks underbaked while writing.

### Q5. What do you do about it today?

Ask the agent for sections before writing in them. Ask for things to be formatted as headers. Putting text under a header often breaks the formatting in buggy ways. A lot of extra steps compared to regular text editing.

### Q6. Does this matter more or less as models improve?

Not answered directly. My reading from Q1 and Q2: more, because the tool is co-authoring, and better models make the agent half stronger while the human half stays stuck.

### Q7. Why this now?

Ken is publishing blog posts frequently now. That puts the publish job ahead of the npm package and the Product Hunt launch.

### Gesture

Ken leans toward a keystroke plus a click. Maybe just the edit keystroke and then click somewhere to start typing.

## Premises

Settled in round 2. Ken's answer on each is recorded.

1. **The gap is creating, not editing.** Agreed, with a caveat: small edits work, but larger edits are still lacking. What is missing is a way to make new blocks, write larger chunks, and do more formatting.
2. **Headers are required, not just paragraphs.** Agreed.
3. **A new block is its own record.** Agreed. Follow the same logic a line break already uses inside a block.
4. **The lost formatting edits are a separate bug.** Disagreed. This feature is largely about editing, so the formatting bug is in scope.
5. **Notes are a separate feature.** Disagreed. Notes are just writing new documentation by hand, which is what this feature is.
6. **Typed text stays word for word.** Agreed, and on longer blocks the agent should proofread and offer suggestions.

## What the feature is, after the premises

Free writing in Lahe means:

- open a blank document, or a spot on an existing page, and write
- new paragraphs and headers as you type, each its own block and its own record
- bold and italic edits that reach the agent correctly and stay put
- your words kept as written; on longer blocks the agent proofreads and suggests, never rewrites unasked
- consistent spacing on screen while you write

## Approaches

### Approach A: insert after, minimal

A new record kind, "insert." Edit keystroke with the caret on a block, then a second key opens an empty block below it. A key or bar button switches the block between paragraph and header. Each block you finish is one insert record naming the block it follows. The formatting bug is fixed alongside.

- Effort: M
- Risk: Low
- Pros: smallest change to the record model; anchors on a block that already exists; fixes the spacing problem because the new block uses the page's own tags.
- Cons: starts from an existing block, so a blank document has nowhere to begin, which fails the notes job; a five-paragraph section is five cards.
- Reuses: the edit session, the edit bar, the paragraph-break code, the contract's break rules.

### Approach B: writing mode, plus a blank document command

Edit keystroke, then click anywhere, and the page opens a writing region at that spot. Enter makes paragraphs, a `#` prefix or a bar button makes a header, `-` makes a list. Everything you write in one sitting is one record: "insert these blocks after X." Works at the end of the page and on an empty page. A new command, `lahe write notes.md`, starts a blank Markdown document and serves it, so notes begin with nothing but the page. The formatting bug is fixed alongside, and the contract tells the agent to proofread long hand-written blocks and offer suggestions as a question on the card.

- Effort: L
- Risk: Med
- Pros: matches the gesture you described; one card per sitting; covers the blank-page start the notes job needs.
- Cons: a multi-block region is new ground for protection and replay, which today guard one block; the contract and the agent skill both grow a new item shape.
- Reuses: everything in A, plus replay's four-way compare for the whole region, plus the Markdown render path for the blank document.

### Approach C: write the source, not the page (lateral)

For a page rendered from Markdown, open a source pane beside the page. You write Markdown there, the page re-renders as you type, and the agent gets the diff of the file. No anchors at all.

- Effort: M
- Risk: Med
- Pros: headers, lists, bold, everything Markdown does, for free; nothing new in the record model; a blank document is trivial.
- Cons: only works for Markdown-sourced pages, not built HTML or an app in dev; a different editing model from the rest of Lahe; you write in a text box, not on the document.
- Reuses: the Markdown re-render path, the file watcher.

### Approach D: Tiptap as the writing engine (vendored)

Tiptap (built on ProseMirror, both MIT) is bundled once at dev time and vendored under `vendor/`, the same way mermaid is. When you open a writing region (the B gesture: edit key, then click), Tiptap mounts on that region and gives you headers, lists, bold, italic, undo, paste cleanup, and keyboard shortcuts out of the box. On commit, Lahe reads the HTML out of the editor, cleans it, and records it exactly as B would. The edit bar and gesture stay the same, so it does not feel like a new mode.

Two ways to cut it:

- **D1: Tiptap for new writing only.** Blank documents and new regions use Tiptap. Existing blocks keep today's editor.
- **D2: Tiptap for everything.** Existing blocks also open in Tiptap.

- Effort: D1 is M plus a spike; D2 is XL
- Risk: D1 medium; D2 high
- Pros: headers, lists, and undo arrive working instead of being built one at a time; the paste and keyboard behavior is the one users already know from Notion-style editors; a blank document is Tiptap's home turf.
- Cons (both): a vendored bundle to keep current; ProseMirror rewrites what it edits through its own schema, so any markup it does not know (a class, a data attribute, an inline SVG, the `data-lahe-id` stamp) is dropped unless whitelisted, and that has to be checked against the normalizer and the anchor rules.
- Cons (D2 only): protection and replay guard the page's own DOM one block at a time; with Tiptap mounted, a repaint mid-edit tears down the editor, not just a text node. That is a rewrite of the protection layers and the replay compare, and the edit record's before-and-after would come from Tiptap's view of the block, not the page's.
- Reuses: the B gesture and bar, cleanMarkup, the record shape; adds a vendored build script like the one mermaid came from.

### Do nothing

Keep asking the agent for placeholder headers, and keep notes in the terminal. Cost: every blog post starts with a round trip to the agent before you can type, and notes stay where you cannot see them.

## Recommendation

**B as the shape, with a spike to decide whether Tiptap (D1) is the engine inside it.** You chose B and asked that it feel like today's edit mode. D1 keeps that: same gesture, same bar, Tiptap only under the hood of a new region. The spike is small and answers the two things I cannot answer from reading: how big the vendored bundle is, and whether the schema drops markup the anchor rules need. If both come back clean, D1 is the cheaper way to get headers, lists, and undo. If not, B is hand-built as described.

D2 (Tiptap for existing blocks too) I recommend against for now: it rewrites protection and replay, which are the parts of Lahe that took longest to get right.

Comment here: spike D1, go straight to hand-built B, or D2 anyway.
