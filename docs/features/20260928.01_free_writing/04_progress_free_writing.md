# Progress: Free writing

**Phase 5, Plan. The review gate is open.** Brief, wireframes, architecture, and plan are reviewed, revised, and checked against today's main. Nine decisions wait on you; each has a recommended default. Last updated 2026-09-28 19:07.

**Docs:** [Crucible questions](00_crucible_questions.md) · [Crucible](http://127.0.0.1:65155/00_crucible.html) · [Brief](http://127.0.0.1:65155/01_brief_free_writing.html) · [Wireframes](http://127.0.0.1:49513/index.html) ([decision](wireframes/DECISION.md)) · [Architecture](http://127.0.0.1:65155/02_architecture_free_writing.html) · [Plan](http://127.0.0.1:65155/03_plan_free_writing.html)

## Needs your attention

- [ ] **Review gate: read the dossier and say go, or what to change.** Building starts only after your go. Leave comments on any page; I answer them there.
  - [Brief](http://127.0.0.1:65155/01_brief_free_writing.html): what we are building and why. Unchanged since you read it, apart from today's main being credited with part of one bug.
  - [Architecture](http://127.0.0.1:65155/02_architecture_free_writing.html): how. The edit gains a "run" of new blocks after the block you start from. Replay learns to put that run back after a rebuild, block by block, which also fixes the doubled header line.
  - [Plan](http://127.0.0.1:65155/03_plan_free_writing.html): who and when. One builder lays the shared pieces. Three build in parallel: typing, replay, and the helper plus `lahe write`. Then the rail, one review round, one fix round, and the full gates.

Decisions. Each has a default the plan already builds, so answer only where you disagree.

- [ ] **AQ1, Lahe's own code or Tiptap.** Recommend: Lahe's own code. A test put an existing block next to a Tiptap editor, which is exactly what one sitting does. In all three browsers:
  - the caret could not cross between them
  - a selection could not span both
  - Backspace did not merge
  - undo ran out of order
  Lahe's own approach passed every check.
- [ ] **AQ3, always check that new text really landed.** Recommend: yes. Today the check lets an agent answer "handled" on new text it never placed, as long as it wrote something else in the same review.
- [ ] **AQ4, how big one writing record may get.** Recommend two things together:
  - older revisions keep only their words
  - the bar warns you before a sitting gets too big to send
  Without a limit, a long notes page could eventually be refused by the helper.
- [ ] **PQ1, a blank notes page opens ready to type.** Recommend: yes. The wireframe had you click "+ Write here" first, which a keyboard user cannot do.
- [ ] **PQ2, the bar says "Editing" for every edit.** Recommend: yes. "Editing this block" reads wrong over five new blocks.
- [ ] **PQ3, no proofreading on notes.** Recommend: no proofreading. It would put a question card on every long notes sitting.
- [ ] **PQ4, what a reload does mid-writing.** Recommend:
  - the caret stays through Lahe's own rebuild and a page repaint
  - any other reload saves the sitting as sent, and you reopen it with Cmd-Shift-E
- [ ] **PQ5, the proofreading buttons read "Use the fixes" and "Keep my words".** Recommend: yes. "Keep mine" already means something else on conflict cards.

## Currently working on

Nothing is running. Next: building starts after your go at the review gate.

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
