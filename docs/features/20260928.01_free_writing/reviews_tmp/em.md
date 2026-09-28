## Engineering Manager Review (Round 1)

**Summary.** The three-way split in Phase 2 is mostly clean. The owned-file lists do not overlap, and the Phase 1 fixtures give each builder something to build against. Three things stop it from being dispatchable as written:

- `lahe write` needs server changes that no task owns.
- The empty-page placement (`start_of_container`) has no builder on the replay side.
- Phase 3 skips the integrated-diff review and fix round that CLAUDE.md requires.

The rest are seams with no named owner, and risks from other branches that are editing the same files right now.

Read against:

- the plan, brief, architecture, and `wireframes/DECISION.md`
- repo `CLAUDE.md` ("Running the gate", "Running the loop")
- `docs/diagrams/README.md`, `module_map.md`, and `src/shared/manifest.js`
- `docs/BULLETIN.md`
- the live worktrees and branches, and the spike seeds under `/private/tmp`

`docs/ongoing/BULLETIN.md` does not exist. The board is `docs/BULLETIN.md`.

---

### EM1. `lahe write`'s "no folder mount" needs server code that no task owns

```
severity   blocker
kind       defect
where      03_plan Task 2.10 (lines 334-357), Phase 2 ownership table (line 168)
what       Serving one file with no folder behind it is new static-server behavior, and 2C's files do not include the code that serves pages.
why        Today a single page's server is rooted at the page's own folder, and the page is told so ("the page's own folder, which is everything this server can serve", src/cli/commands/review.js:318). `--only` only limits which pages get the rail. Other pages under that root are still served (review.js:323). So the test "a request for a sibling file in the same folder gets a 404" cannot pass inside 2C's files. The builder must either edit `src/service/static_servers.js` and `src/cli/commands/review.js`, which nobody owns in this plan, or invent a mode. There is also a trap: servers are keyed by their root folder (`serverId(root)`, static_servers.js:73), and `start()` reuses an existing server for the same root (static_servers.js:237). So a notes file in a folder that another review in the session already serves would silently get the whole folder.
fix        Name the files. Add `static_servers.js` and `review.js` (or a new shared helper that both `review` and `write` call) to 2C's owned list. Say how a file-only server is keyed so it never reuses a folder server. Add a test for that reuse case. Since this touches serving and paths, say the security reviewer reads this task's diff (see EM3).
```

### EM2. Replay and the page check never learn `start_of_container`

```
severity   blocker
kind       defect
where      Task 1.3 (line 98), Task 2.6 (lines 268-286), Task 2.7 (lines 288-303)
what       No 2B task inserts or checks a run placed at the start of the container, and `insertPointAfter(main)` gives the wrong spot.
why        Task 2.6 walks forward from `blocks.insertPointAfter(anchor)`. For an empty page the anchor is `main`, so that is the point after `main`, not "the start of the container, after any leading chrome". Tasks 2.6 and 2.7 never mention `start_of_container`, and neither acceptance list tests it. So after a reload on a notes page, nobody has built the code that puts the run back or checks it. R12 (blank document from the command line) and R13 (notes in a named file) both depend on it. There is a second gap: finding `main` at all is 2A's new anchor rung (Task 2.3, `anchor.js`), which 2B cannot see until the merge. The first test that covers this is the "All three" spec in Task 3.4, and that spec has no fix owner (EM3).
fix        Give Task 1.3 a `startPointIn(container)` helper beside `insertPointAfter`. It returns the point after leading chrome, including the marked file-name title. Add `start_of_container` rows to Task 2.6's and 2.7's acceptance, using Phase 1's `start_of_container` fixture on the empty-notes render. Tell 2B to resolve that fixture's anchor by stamp, the way Task 2.5 already does for tag swaps, so it does not wait on 2A's rung.
```

### EM3. Phase 3 has no integrated-diff review, no fix round, and no owner for seam failures

```
severity   blocker
kind       defect
where      Phase 3 (lines 369-437), Task 3.4 (lines 404-422), Task 3.5 (lines 424-437)
what       CLAUDE.md "Running the loop" requires one review set on the integrated diff, then one fix round. The plan goes straight from the seam specs to the gates.
why        Task 3.4 is where the three branches first meet, so it is where the failures will show up. The fixes will be in 2A, 2B, or 2C files. The plan does not say who makes them: the orchestrator, or a builder sent back to its worktree. It also does not say how the fixed branch comes back in. Security has to join, because the diff touches serving and paths (`lahe write`), the helper's append path (`log.js`), and a new page-write allowlist. None of that is scheduled, so it will be improvised at the most expensive point.
fix        Add a task between 3.4 and 3.5, "Integrated review and fix round". List the reviewers: code lead, testing, security, and design for the rail. They run on the diff of `integration/free-writing` against its base. Each finding names its test. Fixes go to the original owner, as a branch off the integration branch, with the test written red then green. The orchestrator merges and checks that the test exists and passes. A seam spec that fails in 3.4 follows the same path.
```

### EM4. 2A's new key behavior belongs in `gestures.js`, which is frozen for Phase 2

```
severity   important
kind       defect
where      Task 1.5 (lines 134-138), Phase 2 "Nobody touches" (lines 170-176), Tasks 2.1, 2.3, 2.4
what       Phase 1 adds only the block-type hotkeys to `gestures.js`. 2A also needs new decisions from that file.
why        `editing.js` makes every key decision from the pure table in `shared/gestures.js` (editing.js:2123, "Every decision comes from the pure table"). Enter is already decided there (`breakIntentFor`), and so are the bar's hint lines (`hintLines`). 2A needs these new decisions:
             - Enter at the end makes a sibling
             - Enter in the middle splits
             - Enter in an empty last item ends the list
             - Backspace and Delete across a block edge
             - Cmd-Z and Shift-Cmd-Z inside a session
             - Cmd-Shift-E over no block enters write state, a new outcome for `gestureFor`
             - Esc leaves write state
           2A cannot touch `src/shared/`. It will either break the file's convention or stall on the orchestrator partway through the phase.
fix        Widen Task 1.5 to add every new gesture and break intent listed above to `gestures.js`, with the matching lines in `regions_gestures.test.js`. Or state plainly that 2A may put these in `editing.js`, and record that under Changes from plan.
```

### EM5. The replay notes on the card have no shared spelling, and 2B and the rail builder each need one

```
severity   important
kind       defect
where      Task 2.6 (line 278), Task 3.2 (line 385)
what       "A wrong tag" and "placed in a different spot" are new item notes. The plan sends them "through the card's existing flag path", but no Phase 1 task defines them.
why        Today's page-check notes are constants in `record.js` (`PAGE_CHECK_NOTE`, `PAGE_CHECK_FORMAT_NOTE`, `PAGE_CHECK_STAMP_NOTE`, read at replay.js:1231-1238). `review_format.js` reads the related `TOOL_ROUND` values. The only thing replay calls a "flag" today is the conflict path (`flagConflict`). So 2B will invent note names inside `replay.js`, which it cannot put in `record.js`. Task 3.2 will then guess what to look for. Nobody writes the words the reviewer sees.
fix        Add the two notes to Task 1.4: constants in `record.js`, with their wording and whether the agent sees them in `review.json`. 2B sets them, and 3.2 reads them. Put a fixture item carrying each note in `record_fixtures.js`, so 3.2 can build before 2B merges.
```

### EM6. Two workers on one integration branch at the same time

```
severity   important
kind       risk
where      Dispatch diagram (lines 18-19), Phase 3 intro (line 371)
what       Tasks 3.2 and 3.3 go to "one builder on the integration branch" while the orchestrator writes Task 3.4 on that same branch, in parallel.
why        Two agents in one checkout step on each other's uncommitted files and on the locally rebuilt `dist/`. Commits land in whatever order they happen. Neither can run a spec by name knowing it is testing only their own change.
fix        Give the rail builder its own worktree, branched from `integration/free-writing` after Task 3.1. The orchestrator merges it back before Task 3.5. Name the branch.
```

### EM7. Other branches are editing this feature's files right now, and one is fixing a bug this feature absorbs

```
severity   important
kind       risk
where      Plan intro (line 3), Phase 1 phase test (line 158), Task 3.1 (lines 377-381)
what       The plan names no base commit and no point where `main` is merged in, while live worktrees change the same files.
why        Right now, from `git worktree list` and `git status` in each worktree:
             - `piece-keeps-formatting` has uncommitted changes to `src/layer/replay.js`, `src/shared/normalize.js`, and `no_duplicate_text.spec.js`. That looks like `LAHE-lone-paragraph-loses-markup`, the board row this feature says it absorbs (R14, bold and italic survive). The row is still open (`[ ]`), not claimed.
             - `refused-reword-floor` has uncommitted changes to `src/layer/editing.js`, `src/service/projection.js`, and `src/shared/lifecycle.js`.
             - `quiet-tab-polling` has committed about 276 changed lines in `src/layer/sync.js`, plus changes to `src/shared/protocol.js`.
           Each of these lands on a file Phase 1, 2A, 2B, or 2C owns. If they merge to `main` mid-build, Task 3.1 hits conflicts that the plan says cannot happen. The lone-paragraph fix could also be built twice, two different ways.
fix        Add a Phase 0 step for the orchestrator:
             - Record the base commit.
             - Ask Ken whether `piece-keeps-formatting` lands first or folds into this feature, and claim the board row either way.
             - Say that `main` is merged into `integration/free-writing` once, as part of Task 3.1, with its conflicts written on the progress page.
```

### EM8. The walks run `main`'s code, not the branch under test

```
severity   important
kind       risk
where      Task 1.1 (line 85), Task 3.4 (line 406), Task 3.5 step 4 (line 430)
what       The R14 walk and the story walks will drive the main checkout, and may disturb Ken's shared helper.
why        Three problems:
             - `r14_repro/repro.js` hardcodes `REPO = "/Users/kennethstclair/Documents/workspace/live-agentic-html-editor"`. It runs that checkout's `bin/lahe.js` and `node_modules`. Copied into a worktree, it still tests `main`, so Task 1.1's "runs against the current code" is true only by accident.
             - It writes `worlds/` and `out/` next to itself. Once it lives in `test/fixtures/free_writing/`, those land in the repo tree.
             - The `lahe` command on PATH is a wrapper pointing at the main clone (CLAUDE.md, `install-cli`). So a "real agent" walk in Task 3.5 runs `main` unless told otherwise. `SERVICE_CONTRACT` goes to 14, and a 14 CLI refuses a 13 helper. A walk against Ken's shared helper either fails or forces a restart that interrupts his other sessions.
fix        In Task 1.1, have the builder make the walk take the repo root from its own location or an environment variable, and write its output under the scratchpad. In Tasks 3.4 and 3.5, say the walks run `node <worktree>/bin/lahe.js` with an isolated state folder, as `repro.js` already does per world, and never touch the shared helper.
```

### EM9. `npm run install-skills` from a builder worktree overwrites Ken's installed skill

```
severity   important
kind       risk
where      Task 1.6 (line 143), Task 2.10 (line 344)
what       Two builders are told to run `install-skills` from unmerged branches.
why        The script writes `~/.claude/skills/lahe/SKILL.md` and `~/.agents/skills/lahe/SKILL.md` (scripts/install-skills.js:22-23). Every live agent on the machine then gets that branch's contract. That includes Ken's current Lahe sessions and the other active worktrees. The 2C run also installs a skill without Phase 1's text if its base is stale, and whichever run happens last wins.
fix        Builders edit `skills/lahe/SKILL.md` and do not install it. The orchestrator runs `install-skills` once, in Task 3.5, after the merge. Add that line to Task 3.5.
```

### EM10. Cross-browser failures surface only at the checkpoint, and the hotkey fallback cannot be followed

```
severity   important
kind       risk
where      Hotkey note (line 71), Phase 2 builder rules (line 32), Acceptance "AQ1 as recommended" (line 578)
what       The plan says a builder whose hotkey fails in one browser "picks another". But builders run Chromium only, and they cannot touch `gestures.js`, where the chords live.
why        The reason for choosing Lahe's own host (AQ1) is that it passed in all three browsers, and the risky parts are exactly 2A's: cross-edge Backspace, spanning selection, IME, and chords. Firefox and WebKit problems would first show up in Task 3.5's `gate:all`, after the merge, with no fix owner.
fix        Let 2A run `free_writing_host.spec.js` and `free_writing_types.spec.js` once on `--project=firefox` and `--project=webkit` before handing back. The playwright config already names `--project` for a builder debugging one lane. A chord change goes to the orchestrator, who edits `gestures.js`.
```

### EM11. The brief's agent rules have no contract line and no task

```
severity   important
kind       defect
where      Task 1.6 (lines 140-156); brief "AI Behavior"; Acceptance "every user story walked" (line 540)
what       Three of the brief's four agent rules are in no task.
why        The brief's AI Behavior section has four rules. Task 1.6 writes only the proofreading one. These three have no line in the contract:
             - organize notes only when asked
             - ask when unsure where new text belongs
             - never write prose into a region the reviewer wrote
           The architecture's Contract changes list omits them too. Task 3.5 walks the notes user story ("the agent organizes my notes afterward when I ask") with a real agent, so it passes or fails on the agent's defaults. An agent that reads only `review.json` (brief R9) is never told.
fix        Add the three lines to Task 1.6's contract list and to every copy of the contract. If Ken wants them left out, record that under Changes from plan. Either way, say which acceptance line covers them.
```

### EM12. The empty-rail copy needs the file name, and the layer does not have it

```
severity   important
kind       defect
where      Task 3.2 (line 385)
what       "The empty Edits tab says which file the notes go to", but no task gives the layer the file name.
why        The layer knows the review id, token, and helper, not the source path. sync.js:2245 says "Only the helper knows the source". The builder will invent a route or scrape the page.
fix        Name the source. The simplest one fits the plan as it stands: Task 2.11's marked file-name title already holds `path.basename(source)` (markdown.js:148). Task 3.2 reads the text of that marked element. Say so, and say what the rail shows on an HTML page, which has no marked title.
```

### EM13. Task 1.1 uses a marker that Task 1.2 defines

```
severity   minor
kind       defect
where      Task 1.1 (line 83), Task 1.2 (line 89)
what       The empty-notes fixture carries "the chrome marker from Task 1.2", which does not exist yet when Task 1.1 runs.
why        It is the same builder, so this costs little. But a fresh agent reading the tasks in order will stop or guess the spelling.
fix        Move the fixture's hand-added marker into Task 1.2, or add the marker to `markers.js` as Task 1.1's first step.
```

### EM14. A test file named in the acceptance is missing from the Files list

```
severity   minor
kind       defect
where      Task 1.6 Files (line 148), acceptance (line 155)
what       `export_text.test.js` is in the acceptance but not in Files.
why        The Phase 2 diff-ownership check in Task 3.1 uses the Files lists. An unlisted file reads as an ownership slip.
fix        Add `test/unit/export_text.test.js` to Task 1.6's Files.
```

### EM15. Diagram and doc updates with no task

```
severity   minor
kind       defect
where      Phase 2 ownership table (line 166), Task 2.3, Task 2.10
what       Some docs change with this feature but are assigned to no task.
why        The unassigned docs:
             - `finding_the_region.md` is owned by 2A, but no task updates it for the empty-container rung.
             - `module_map.md` lists the CLI commands as "serve, review, session, add, status, reply, monitor" (line 38), and no task adds `write`.
           CLAUDE.md sends builders to `docs/diagrams/` first, so stale pictures mislead the next builder.
fix        Add `finding_the_region.md` to Task 2.3's Files. Add the `write` entry in `module_map.md` to Task 2.10, or to Task 3.1, where the orchestrator already edits the manifest.
```

### EM16. Branch names are not stated

```
severity   minor
kind       risk
where      Lines 3, 11, 158, 162, 379
what       "The feature branch" and `integration/free-writing` are both used, and the plan never says how they relate or what reaches `main`.
why        The builders branch from "merged Phase 1" without a name. The orchestrator has to decide where Phase 1 lands and which branch opens the pull request.
fix        Name the branches once in "How the work is dispatched":
             - the feature branch
             - the Phase 1 branch
             - the three Phase 2 branches
             - the rail branch (EM6)
             - the integration branch
           Say which one opens the pull request to `main`.
```

### EM17. 2A is one long run with no midway check

```
severity   minor
kind       risk
where      Tasks 2.1 to 2.4 (lines 182-257)
what       2A runs four large tasks in order, in one worktree, and Task 2.1 alone covers the host, six edit operations, IME, capture, `kindFor`, `itemFor`, and reopening. It is the critical path.
why        A fresh agent's context fills partway through. Without a set point to report, the orchestrator cannot tell a stall from progress ("a stalled small task gets a status check").
fix        Have each 2A task end with a commit and a short report to the orchestrator. Let the orchestrator send 2.2 to 2.4 to a fresh agent in the same worktree if the first one runs long.
```

### EM18. The proofreading answers and the contract are written in different phases

```
severity   minor
kind       risk
where      Task 1.6 (line 142), Task 3.3 (line 400)
what       The contract (Phase 1) says the agent changes words "only if the reviewer says yes". The card's buttons (Phase 3) post "Use the fixes" and "Keep my words".
why        The agent reads the thread reply. Nothing ties the contract's wording to the text the buttons post, so a later rename breaks it silently.
fix        Put the two reply texts in the contract line in Task 1.6, and have Task 3.3 post those exact strings.
```

### EM19. Spec runs by name will add up across three builders

```
severity   minor
kind       risk
where      Builder rules (line 32), Task 2.5 acceptance (line 266)
what       CLAUDE.md allows a builder "one named spec file". The plan allows "its own new browser spec files" plus three existing specs for 2B. That is 6 spec files for 2A and 6 for 2B (counted by grep over the task text).
why        This is the pattern that drained Ken's battery on 2026-09-16, now in three worktrees at once.
fix        Say a builder reruns only the spec file its latest change touched. The three existing regression specs run once, just before handoff.
```

### EM20. The spike seeds sit in another session's scratchpad

```
severity   minor
kind       risk
where      "Spike evidence" (line 38)
what       Task 1.1 copies seeds out of `/private/tmp/.../e688975e.../scratchpad/`. They are there today (checked), but nothing keeps them.
why        If Phase 1 starts after a reboot or cleanup, Task 1.1 has nothing to copy, and Tasks 2.7, 2.9, and 3.4 lose their seeds.
fix        Have the orchestrator copy the seeds into the repo now, or at the start of Phase 1, before dispatching anything.
```

---

**Cleanup needed.** None from this review.
