# Progress: Free writing

**Phase 5, Plan.** You approved wireframe direction A. The architecture is reviewed and revised. The plan is being written. Two decisions are waiting on you. Last updated 2026-09-28 17:51.

**Docs:** [Crucible questions](00_crucible_questions.md) · [Crucible](http://127.0.0.1:65155/00_crucible.html) · [Brief](http://127.0.0.1:65155/01_brief_free_writing.html) · [Wireframes](http://127.0.0.1:49513/index.html) ([decision](wireframes/DECISION.md)) · [Architecture](http://127.0.0.1:65155/02_architecture_free_writing.html)

## Needs your attention

Both are on the [architecture page](http://127.0.0.1:65155/02_architecture_free_writing.html) under Open Questions. The plan is written with the recommended answer for each, and changes if you say otherwise.

- [ ] **AQ1, Tiptap or Lahe's own editing code.** The recommendation is Lahe's own code, against your lean. A test put an existing block next to a Tiptap editor, which is exactly what one sitting does. In all three browsers:
  - the caret could not cross between them
  - a selection could not span both
  - Backspace did not merge
  - undo ran out of order
  Lahe's own approach passed everything.
- [ ] **AQ3, should the "is it really on the page" check always run for new text?** Today it only runs when the agent wrote nothing at all. Running it every time for new text would catch words that turned into markup in the source, and a header placed as a paragraph. It changes a standing rule, so it is your call. The recommendation is yes.

## Currently working on

| Agent or task | Doing | Started | Branch |
|---|---|---|---|
| Plan | Breaking the architecture into build tasks, with a test list | 2026-09-28 17:51 | `main` (docs only) |

## Phases

| Phase | Status | Changed |
|---|---|---|
| 0 Setup | done | 2026-09-28 |
| 1 Crucible | done | 2026-09-28 |
| 2 Brief | done | 2026-09-28 |
| 3 Wireframe | done | 2026-09-28 |
| 4 Architecture | done | 2026-09-28 |
| 5 Plan | in progress | 2026-09-28 |
| 6 Implement | not started | |
| 7 Review | not started | |
| 8 Ship and land | not started | |
| 9 Cleanup | not started | |

## The record

### Task index

No tasks dispatched yet.

### Loop passes

No passes yet.

### Changes from plan

None.

### Follow-ups

- Board rows added from the architecture reviews and the reproduction, all older than this feature:
  - `LAHE-static-server-host-check`
  - `LAHE-markdown-link-schemes`
  - `LAHE-anchor-markup-denylist`
  - `LAHE-early-rebuild-no-reload`
- `LAHE-rich-paste` on the board: keep formatting when pasting text written elsewhere. Out of this feature unless Tiptap brings it for free.

### Cleanup queue

Nothing queued.

### Test results

No test run yet.

### Ship

Not shipped yet.

## Log

Newest first.

**2026-09-28 17:51.** You approved wireframe direction A:
- "B" lost on its insert style
- "C" was too busy
- Markdown shortcuts and hotkeys stay as extras

The editing-area test found one approach that works in all three browsers: make the block's parent editable and refuse changes outside the sitting. The same test showed a Tiptap editor next to an existing block fails every check.

The formatting reproduction confirmed all three cases:
- the doubled header line
- the lone paragraph losing its bold
- a handled reply accepted for a bold edit the agent never made

The architecture is revised with all of it. The plan is starting.

**2026-09-28 17:38.** Both architecture reviews are back.

The security review found three gaps:
- the markup filter ran only in the browser
- a symlink hole in the blank-document command
- a notes file in the home folder could expose the whole folder

The architect review found 21 issues, 8 of them serious. Its main point: the Tiptap question cannot be answered fairly until someone tests whether one editing area can span several blocks. That test and a reproduction of the formatting bugs are running now. The revision folds in everything else meanwhile.

**2026-09-28 17:26.** The wireframes are built: three clickable directions, every link checked, all showing one sitting as one edit.

The architecture is drafted from three research passes:
- how editing works today
- a Tiptap test build
- how a blank document would start

It recommends Lahe's own editing code over Tiptap, which goes against your lean. The architecture page lays out why for you to decide. The research also found the cause of the doubled header line: the new paragraph is nested inside the header. The architecture fixes that and the lone paragraph that loses its bold. The architecture and security reviewers are running.

**2026-09-28 17:18.** Ken settled the last brief question: what the reviewer writes in one sitting is one edit, with no logic splitting new text out of it. He asked to finish the docs, so the architecture starts now alongside the wireframes.

**2026-09-28 17:16.** Ken finished reading the brief on its page. He answered the four questions:
- the agent writes the notes file
- lists are in
- rich paste is out, to the board
- larger edits fail the same way, so they are covered by the same requirements

He also leaned toward Tiptap as the engine. He gave steps for the doubled line after a header. He made three wording edits. Brief closed.

**2026-09-28 17:00.** The brief and crucible are now built with the feature-forge document builder, so the callout boxes render. The Docs links above point at the built pages; the earlier Markdown renders are retired.

**2026-09-28 15:41.** PM review returned eleven findings, all accepted: two blockers (the formatting bug had no reproduction and missed a board row; the brief pre-decided record shape and gesture), six important, three minor. Brief rewritten, clarity pass applied, served for Ken.

**2026-09-28 15:34.** Brief written from the accepted crucible. PM review dispatched.

**2026-09-28 15:33.** Crucible accepted. Ken chose approach B (a writing region that feels like today's edit mode), kept the formatting bug and note-taking in scope, and put Tiptap back on the table as an open architecture question after I had wrongly ruled it out on the dependency rule.
