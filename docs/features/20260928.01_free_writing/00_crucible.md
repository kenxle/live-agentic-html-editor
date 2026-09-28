# Crucible: free writing in Lahe

Date: 2026-09-28
Status: DRAFT, pending the Tiptap decision (Approach D on the questions page)
Questions and answers: `00_crucible_questions.md` in this folder, reviewed on a Lahe page.

## The idea, as stated

"The tool is very good at editing already-written AI text, but sometimes I just want to write a few paragraphs myself. It's kinda hacky looking at the moment the way that works. Let's improve the free-writing ability."

## Jobs to be done

Three jobs, in Ken's words:

- **Writing material to publish.** Articles and blog posts. Lots of hand writing, needs new paragraphs and headers, and sometimes all he wants afterward is a proofread.
- **Writing material for himself.** Notes. He needs to see what he already wrote and look back at it often, then let the agent organize it afterward.
- **Editing material.** Word-for-word changes and formatting changes (bold these words) that must be kept exactly.

## Who the user is

Ken today. No defined ideal customer yet. Lahe is a co-authoring tool, so the user is someone co-writing a document with an agent, not only reviewing one.

## User context

A document on a laptop, with the rest of Lahe running as normal. The agent may be working at the same time.

## What already exists

- Edit mode: Cmd-Shift-E on an existing block, one block at a time, with paragraph breaks, line breaks, bold, italic, and delete. New paragraphs typed at the end of a block are recorded as an edit of that block.
- No record kind for inserting a block. No way to make a header. No way to start on an empty page.
- No prior brief, board row, or ongoing doc on this.
- Prior art: Notion and Google Docs make a new block its own thing; Medium puts a "+" between blocks; editor libraries (ProseMirror, Tiptap) make the whole document editable. The zero-dependency rule rules out adopting a library. The pattern to borrow is "a new block is its own record."

## Evidence

One named user, Ken, reporting from his own use:

- He cannot make headers at all.
- Formatting-only edits are often lost or misinterpreted.
- A new paragraph after an existing one gets inconsistent vertical spacing.
- To add an intro he asks the agent for a placeholder header with sample text, just so there is a block to edit.
- Notes today go into the terminal, where he cannot see what he already wrote.

No numbers. No second user.

## Status quo

Ask the agent for sections before writing in them. Ask for things to be formatted as headers. Take notes in the terminal. Cost: a round trip to the agent before every blog post can start, and notes that cannot be looked back at.

## Premises

1. The gap is creating, not editing. **Agreed**, with a caveat: larger edits are also lacking.
2. Headers are required, not just paragraphs. **Agreed.**
3. A new block is its own record, following the logic a line break already uses inside a block. **Agreed.**
4. The lost formatting edits are a separate bug. **Disagreed.** In scope.
5. Notes are a separate feature. **Disagreed.** Notes are writing new documentation by hand, which is this feature.
6. Typed text stays word for word. **Agreed**, and on longer blocks the agent proofreads and offers suggestions.

## The case against building this

The npm package and the Product Hunt launch are both open on the board, and each one widens the audience. Free writing serves one user's current habit (frequent blog posts) and has no second user asking for it. If the goal were more users this quarter, the package and the launch come first. The evidence that would change this: a second user hitting the placeholder-header workaround, or a launch that stalls because reviewers try to write and cannot. Ken's answer is that he is publishing often now and this is the daily friction, which is a fair call for a tool he is the main user of.

## What happens if we do nothing

Ken keeps asking the agent for placeholder headers before each post and keeps notes in the terminal. Every co-author who tries Lahe hits the same wall the first time they want to add a paragraph of their own.

## Approaches considered

### Approach A: insert after, minimal

A new "insert" record kind. From an existing block, a key opens an empty block below it; a key or bar button switches paragraph and header. One record per block. Effort M, risk low. Fails on an empty page, so it fails the notes job.

### Approach B: writing mode, plus a blank document command

Edit keystroke, then click anywhere, and a writing region opens at that spot. Enter makes paragraphs, a prefix or bar button makes a header, later a list. One record per sitting: "insert these blocks after X." Works at the end of the page and on an empty page. A `lahe write notes.md` command starts a blank Markdown document. The formatting bug is fixed alongside. The contract tells the agent to proofread long hand-written blocks and offer suggestions. Effort L, risk medium: a multi-block region is new ground for protection and replay.

### Approach C: write the source, not the page

A Markdown source pane beside the page. No anchors; the agent gets the file diff. Only works for Markdown-sourced pages and moves writing off the document.

### Do nothing

Keep the placeholder-header workaround and terminal notes.

## Recommended approach

B, chosen by Ken, with one constraint he added: **this is an upgrade of the existing edit mode, not a new mode.** It should feel the same to the user as editing does today. The gesture is the edit keystroke plus a click; the bar is the same edit bar with a block-type control added; the record is the same edit record family with an insert kind. Ship in two cuts: paragraphs, headers, the blank document command, and the formatting fix first; lists and the proofread suggestion second.

## Challenges the session leader accepted

- A new block is its own record, not glued onto its neighbor's edit.
- Headers are part of the minimum, not a follow-up.
- Typed text is kept word for word.

## Challenges the session leader rejected

- **Splitting the formatting bug into its own row.** Rejected: the feature is largely about editing, so the bug is in scope. The brief writer treats lost or misread bold and italic as a requirement of this feature, not a separate fix.
- **Splitting notes into a separate brief.** Rejected: notes are hand-written documentation, which is what this feature is. The brief includes starting a blank document.
- **Treating this as a new mode.** Rejected before it was proposed: Ken wants it to feel like the edit mode he already has. The brief and the wireframe must not introduce a second entry point, a second bar, or a second visual state.

## What we skipped and why

Q6 (does this matter more as models improve) went unanswered. My reading stands in for it: more, because better models widen the gap between the agent half and the human half of co-authoring. Ken did not correct it.

## Open questions

- What the block-type control looks like on the edit bar, and whether a Markdown-style prefix (`#`, `-`) is also accepted.
- How one sitting is bounded: commit on click-away as today, or an explicit finish.
- What "proofread and offer suggestions" looks like on the card: a question reply, a suggested rewording, or a diff.
- Whether `lahe write` is a new command or a flag on `lahe review` for a file that does not exist yet.
- What the formatting bug actually is. Nobody has reproduced it; the brief needs a repro before it can be a requirement.

## The assignment

Reproduce the formatting bug first: open any Markdown page, bold two words, commit, and record what the agent receives and what the page shows after the rebuild. That result decides whether it is a layer bug, a contract bug, or an agent-reading bug, and the brief cannot state the requirement until we know.
