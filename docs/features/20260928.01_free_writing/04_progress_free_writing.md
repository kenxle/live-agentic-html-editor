# Progress: Free writing

**Phase 3 and 4, Wireframe and Architecture.** The wireframes are ready for you to click through. The architecture is drafted and with its reviewers. One thing needs you now. Last updated 2026-09-28 17:26.

**Docs:** [Crucible questions](00_crucible_questions.md) · [Crucible](http://127.0.0.1:65155/00_crucible.html) · [Brief](http://127.0.0.1:65155/01_brief_free_writing.html) · [Wireframes](http://127.0.0.1:49513/index.html)

## Needs your attention

- [ ] Click through the [wireframes](http://127.0.0.1:49513/index.html) and say which direction you like, and what feels wrong about the steps. There are three:
  - **A. Block menu on the bar:** a "Paragraph" menu next to B and I, and a "+ Write here" line when you hover between blocks.
  - **B. Type like Markdown:** no new buttons. Typing `# ` makes a header and `- ` makes a list, and you click any empty space to start writing.
  - **C. Growing frame:** a "+" in the left margin beside every block, and a row of block-type buttons on the frame's bottom edge.
  The plan's layout work waits on your pick.

## Currently working on

| Agent or task | Doing | Started | Branch |
|---|---|---|---|
| Architecture reviewer | Reviewing the architecture | 2026-09-28 17:26 | `main` (docs only) |
| Security reviewer | Reviewing the architecture | 2026-09-28 17:26 | `main` (docs only) |

## Phases

| Phase | Status | Changed |
|---|---|---|
| 0 Setup | done | 2026-09-28 |
| 1 Crucible | done | 2026-09-28 |
| 2 Brief | done | 2026-09-28 |
| 3 Wireframe | in progress | 2026-09-28 |
| 4 Architecture | in progress | 2026-09-28 |
| 5 Plan | not started | |
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

- `LAHE-rich-paste` on the board: keep formatting when pasting text written elsewhere. Out of this feature unless Tiptap brings it for free.

### Cleanup queue

Nothing queued.

### Test results

No test run yet.

### Ship

Not shipped yet.

## Log

Newest first.

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
