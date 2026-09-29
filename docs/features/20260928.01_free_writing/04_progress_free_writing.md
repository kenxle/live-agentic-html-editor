# Progress: Free writing

**Phase 6, Implement.** You approved the plan and all nine decisions. The first builder is laying the shared pieces. Nothing is blocked on you. Last updated 2026-09-29 12:58.

**Docs:** [Crucible questions](00_crucible_questions.md) · [Crucible](http://127.0.0.1:65155/00_crucible.html) · [Brief](http://127.0.0.1:65155/01_brief_free_writing.html) · [Wireframes](http://127.0.0.1:49513/index.html) ([decision](wireframes/DECISION.md)) · [Architecture](http://127.0.0.1:65155/02_architecture_free_writing.html) · [Plan](http://127.0.0.1:65155/03_plan_free_writing.html)

## Needs your attention

- [ ] **For your information, no action needed unless you disagree.** The Library feature branch (`feat/lahe_library`, 160 commits) changes some of the same files: the rail, the page server, the command list, and shared files. Plan: build free writing on main, and whichever of the two lands second merges the other in. If you want one to land first, say so.

## Currently working on

| Agent or task | Doing | Started | Branch |
|---|---|---|---|
| Kernel builder | Phase 1: the record's new fields, the safe-tag check, the block reader, the agent's instructions and every copy of them | 2026-09-29 12:58 | `feat/free-writing` |

## Phases

| Phase | Status | Changed |
|---|---|---|
| 0 Setup | done | 2026-09-28 |
| 1 Crucible | done | 2026-09-28 |
| 2 Brief | done | 2026-09-28 |
| 3 Wireframe | done | 2026-09-28 |
| 4 Architecture | done | 2026-09-28 |
| 5 Plan | done | 2026-09-29 |
| 6 Implement | in progress | 2026-09-29 |
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

**2026-09-29 12:58.** You approved the plan, and all nine decisions are recorded:
- Lahe's own code for now, Tiptap discussed later
- always check new text
- old revisions keep words only
- notes open ready to type
- "Editing" on the bar
- no proofreading on notes
- reload default
- "Use the fixes" and "Keep mine"

Phase 0: main is at 97a8270, and every branch the plan worried about has already merged. The worktree `feat/free-writing` was created. The kernel builder was dispatched.

**2026-09-28 19:07.** Review gate opened. Before it, three things happened:
- The dossier got a clarity pass, and the architecture was trimmed by about a quarter.
- Two contradictions between docs were fixed.
- The docs were re-checked against main, where four related merges had landed today. Main already fixed half of the lone-paragraph bug; this feature keeps the other half.

Two new items came out of the re-check:
- a size limit for long writing records (AQ4)
- a stronger case for always checking new text (AQ3)

**2026-09-28 18:10.** All four plan reviews are back, with about 105 findings. The blockers, and how each is being fixed:
- **Undoing new text:** it had no way to stay undone after a reload. The take-back now names the blocks to remove.
- **Empty notes page:** nobody put text back on it after a reload. The page container is now only the starting point.
- **`lahe write` serving one page:** the fix needs server code no builder owned. The helper-and-command builder now owns it.
- **Accepting proofreading fixes:** your original words would have reopened the item. The fixes now become your own reword of the card.
- **"+ Write here":** it could not be reached. It now shows whenever an edit is open.
- **A conflict above new text:** it could discard the new section. The conflict card now keeps it.
- **The final phase:** it lacked the required review of the merged code. A review round is added.

The reviewers also found three other branches with unfinished work in the same files. The plan now checks those with you before any builder starts.

**2026-09-28 17:59.** The plan is drafted in three phases:
- shared groundwork first
- three parallel builds: the editor, the page reload, and the helper with `lahe write`
- the rail and integration

Four reviewers are on it now.

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
