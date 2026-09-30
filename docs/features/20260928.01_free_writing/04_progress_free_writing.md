# Progress: Free writing

**Phase 7, Review.** The full gate is clean apart from one known-flaky test. Your preview is ready: try free writing on a copy of your blog draft and on a blank notes page. An independent workflow walk is running. Two things wait on you. Last updated 2026-09-30 00:47.

**Docs:** [Crucible questions](00_crucible_questions.md) · [Crucible](http://127.0.0.1:65155/00_crucible.html) · [Brief](http://127.0.0.1:65155/01_brief_free_writing.html) · [Wireframes](http://127.0.0.1:49513/index.html) ([decision](wireframes/DECISION.md)) · [Architecture](http://127.0.0.1:65155/02_architecture_free_writing.html) · [Plan](http://127.0.0.1:65155/03_plan_free_writing.html)

## Needs your attention

- [ ] **Try free writing on your own writing.** Both pages run the feature branch with the editor on them. They sit on a separate helper and a copy of your draft, so nothing of yours changes.
  - [Your draft "new-debugging-hell-part2", a copy](http://127.0.0.1:59081/new-debugging-hell-part2-236277651c422e90.html). Press Cmd-Shift-E on a paragraph, then hover between paragraphs for "+ Write here". Try a header, a list, and bold. Leave editing, and I place your text as the agent.
  - [A blank notes page](http://127.0.0.1:59160/notes-2026-09-30-d682203dc75e720a.html). It opens ready to type.
  - Leave comments on the pages. I answer them there.
- [ ] **Losing text on a hard kill.** If the browser is force-quit within a moment of typing, that whole sitting is lost. After about 6 seconds everything survives, and a crashed tab keeps everything. The cause is that long writing now saves after a short pause instead of on every keystroke, which keeps typing fast. Options:
  - keep it as is
  - save a short sitting on every keystroke, and pause only for long ones

  Default: keep it, since a force-quit within seconds of typing is rare.
- [ ] For your information, no action needed: the Library feature branch (`feat/lahe_library`) changes some of the same files. Whichever lands second merges the other in.

## Currently working on

| Agent or task | Doing | Started | Branch |
|---|---|---|---|
| Flow walker | An independent walk of all six user stories on the running app. It acts as the agent from review.json only, and takes screenshots | 2026-09-30 00:47 | `feat/free-writing` |
| Preview agent (me) | Watching your preview pages, and placing your writing into the draft copy as the agent | 2026-09-30 00:47 | preview only |

## Phases

| Phase | Status | Changed |
|---|---|---|
| 0 Setup | done | 2026-09-28 |
| 1 Crucible | done | 2026-09-28 |
| 2 Brief | done | 2026-09-28 |
| 3 Wireframe | done | 2026-09-28 |
| 4 Architecture | done | 2026-09-28 |
| 5 Plan | done | 2026-09-29 |
| 6 Implement | done | 2026-09-29 |
| 7 Review | in progress | 2026-09-29 |
| 8 Ship and land | not started | |
| 9 Cleanup | not started | |

## The record

### Task index

| Phase | Workstream | Tasks | Status | Detail | Outcome |
|---|---|---|---|---|---|
| 3 | seams | 3.4 | merged | [detail](../../../.claude/worktrees/free-writing-seams/docs/features/20260928.01_free_writing/progress/phase3_workstream_seams.md) | 21 end-to-end tests with a scripted agent that follows only the agent's instructions. Fixed a false "further down the page" note, and a crash that lost your writing. |
| 3 | rail | 3.2, 3.3 | merged | [detail](../../../.claude/worktrees/free-writing-rail/docs/features/20260928.01_free_writing/progress/phase3_workstream_rail.md) | Unit gate: 1694 passed, 0 failed. 81 browser tests passed. 16 screenshots of every card state, light and dark. One replay bug left for the seams builder. |
| 3 | integration fixes | after the Phase 2 merge | merged | [detail](../../../.claude/worktrees/free-writing-fix/docs/features/20260928.01_free_writing/progress/phase3_workstream_fixes.md) | Unit gate: 1691 passed, 0 failed. 73 browser tests passed. The agent's extra words now show as a conflict on the card, and "--" matches a rendered dash everywhere. |
| 2 | editing (2A) | 2.1 to 2.4 | merged | [detail](../../../.claude/worktrees/free-writing-2a/docs/features/20260928.01_free_writing/progress/phase2_workstream_editing.md) | Unit gate green. 98 browser tests passed in Chromium; Firefox and WebKit also ran. 22 screenshots. |
| 2 | replay (2B) | 2.5 to 2.7 | merged | [detail](../../../.claude/worktrees/free-writing-2b/docs/features/20260928.01_free_writing/progress/phase2_workstream_replay.md) | Unit gate: 1619 of 1621 passed, 0 failed, 2 to-do. 53 new browser tests and 40 existing replay tests passed in Chromium. Four screenshots, light and dark. |
| 2 | helper (2C) | 2.8 to 2.12 | merged | [detail](../../../.claude/worktrees/free-writing-2c/docs/features/20260928.01_free_writing/progress/phase2_workstream_helper.md) | Unit gate: 1645 of 1647 passed, 0 failed, 2 to-do. Built: the check on arrival, always checking new text, `lahe write` with its own one-page server, `lahe reply --proofread`. |
| 1 | kernel | 1.1 to 1.6 | done | [detail](progress/phase1_workstream_kernel.md) | Seven commits. The unit gate passed 1601 of 1604 with 2 to-do. One timing test failed under full-suite load; alone, it runs the same on the branch and on main. |

### Loop passes

No passes yet.

### Changes from plan

- **Words the agent adds to your new paragraph:** the architecture counted your words as placed even when the agent added a sentence to your paragraph. Per the brief's R6 (your words stay as typed), that is now flagged on the card, with Keep mine and Take the page's. Decided at merge.

- **Only notes pages open ready to type.** An empty page takes writing on its own only on a notes review made by `lahe write`. Any other empty page stays in reading state. From the fix round's design calls.
- **Proofreading ends on a record once it has asked.** After one proofreading question, later sittings on that record are not proofread again.
- **A force-quit within seconds of typing can lose the sitting.** Long writing saves after a short pause. This is open for you under Needs your attention.
- **The old agent on an HTML page counts as correct.** Its `after_html` parses into the right blocks, so "handled" is the right result. The plan line was corrected.
- **Tab reaches the block-type menu.** The plan pinned no key for it.
- **The wrong-tag note also names `anchor_tag_after`.** The plan's pinned wording is older.
- **Two tests run in Chromium only:** East Asian input and a real drag-and-drop. Only Chromium can drive them.
- **Two files were edited outside their builders' rows.** `replies.js` passes proofread fixes through. `store.js` keeps "Not sent" across a reload.
- **Undoing a retagged run carries the old tag.** This replaces the first design, where the record never stored the old tag.

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

- 2026-09-30 00:47, second full gate in all three browsers, 20.2 minutes:
  - Unit: 1785 of 1787 passed, 0 failed.
  - Browser: 1999 passed, 1 failed, 19 skipped.
  - The failure was `duplicate_tab` in Chromium only. It passed 10 of 10 when run alone, so it was load during the full run. No code changed after this run, so it stands as the release result.

- 2026-09-29 23:59, full gate in all three browsers, 18.5 minutes:
  - Unit: 1785 of 1787 passed, 0 failed.
  - Browser: 1978 passed, 19 failed, 19 skipped.
  - The failures are 6 existing tests, broken in all three browsers, plus 1 Firefox-only image test.
- Independent spec check: 35 of 46 criteria pass. The 2 fails are the force-quit question and the unrecorded deviations, which are now recorded. The 9 unverified wait on the workflow walk and a clean full gate.

- 2026-09-29 14:28, merged branch: unit gate 1677 passed, 0 failed, 2 to-do.
- Affected browser specs, once, in Chromium: 187 of 191 passed.
  - Three header and bold-edit tests are marked as expected failures, and they now pass. That is good news, and the marks are coming off.
  - One split-paragraph test shows a real gap: when the agent adds a sentence to your paragraph, it is no longer flagged. The fix builder has it.

### Ship

Not shipped yet.

## Log

Newest first.

**2026-09-30 00:47.** The regression builder fixed the 6 broken tests.
- **One product bug:** protection lost the agent's rewrite during a page rewrite.
- **Five test problems:** among them, two tests were reaching your real helper, which runs an older version.

The second full gate is clean apart from one known-flaky test.

**Before this ships:** your installed helper is one version behind this build, and this build refuses it by design. After merge, the helper needs a restart onto the new code (`lahe serve --restart`).

**2026-09-29 23:29.** All four fix builders returned green, and their branches merged with no conflicts. One stale test was updated. Fixed, among others:
- removed blocks no longer reach the agent
- an undone header change stays undone
- only notes pages open ready to type
- a repaint that strips your bold is restored
- the helper can no longer be frozen
- the notes folder no longer leaks
- the card shows each proofread fix
- the page refuses an outdated helper

The four end-to-end specs now pass in Firefox and WebKit too. The rail builder ran delete commands before being stopped, which blocked you. Builder prompts now spell out the no-delete rule at the top.

**2026-09-29 17:54.** The adversarial review found six more problems. The two worst:
- Undo after a proofread question never takes the words out of the source.
- Writing after a paragraph the agent later changes hides your section behind a conflict.

I made nine design calls for the fix round and wrote them in [FIX_ROUND.md](../../../.claude/worktrees/free-writing/docs/features/20260928.01_free_writing/reviews_impl/FIX_ROUND.md). The main one: a paragraph you did not change is never compared, so the agent fixing it can never hide your new section. Four builders are now fixing everything in parallel.

**2026-09-29 17:41.** Five reviews of the built code are back. They are saved in [reviews_impl](../../../.claude/worktrees/free-writing/docs/features/20260928.01_free_writing/reviews_impl/). The findings that matter most:
- A block you add and then delete in the same sitting still reaches the agent.
- Undoing a header change comes back at the next rebuild.
- Any page with no content opens editing on its own, not only notes pages.
- A page repaint that keeps your words but strips your bold loses the bold.
- The safe-tag check covers new blocks but not the paragraph you started from.
- One oversized post can freeze the helper.
- "Use the fixes" applies changes the card does not show you.
- Several tests cannot fail, and the end-to-end tests have run only in Chromium.

One fix round covers all of it.

**2026-09-29 14:55.** The rail merged. The cards for new text are built:
- each card leads with a short summary
- blocks are listed by their menu names
- refused records say "Not sent"
- a notes page gets its own empty-tab lines
- the proofreading buttons appear only on a proofread

The rail builder also fixed the helper dropping proofread suggestions, so the buttons can show at all. The seams builder was dispatched.

**2026-09-29 14:43.** The fix branch merged. The gap was worse than it looked: when the agent added a sentence to your paragraph, replay wrote your paragraph again below it. Now it shows as a conflict with Keep mine and Take the page's. Screenshots are on the fix builder's page. Waiting on the rail builder.

**2026-09-29 14:28.** The three Phase 2 branches merged with no conflicts, and the unit gate is green. The affected browser tests ran once:
- The header line no longer doubles, and a bold edit the agent never made is no longer accepted as handled. Both came from the editing and replay work together.
- One gap was found and is being fixed: flagging extra words the agent adds to your paragraph.

The rail builder started in parallel.

**2026-09-29 13:58.** The replay builder (2B) returned green. The header case still shows as an expected failure until the editing builder's typing change merges. The conflict card keeps your new text, and choosing "take the page's" still places it.

**2026-09-29 13:58.** The helper builder (2C) returned green. Two things for the merge:
- straight `--` does not match a rendered dash in the shared text folding; I will fold it in the shared normalizer so every check agrees
- the rail needs wiring for refused records, which Phase 3 picks up

**2026-09-29 13:37.** Phase 1 (the shared pieces) is done and verified:
- the new record fields
- the safe-tag check
- the block reader
- contract version 14, with every copy of the agent's instructions updated together

The three Phase 2 builders were dispatched in their own worktrees.

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
