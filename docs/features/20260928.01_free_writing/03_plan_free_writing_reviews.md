# Reviews: Free writing plan

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


## Code Review Lead Review (Round 1)

**Short version.** I could review Phase 1 and most of 2C against these docs. I could not review 2A or 2B yet. Four things are missing, and without them the builders would each make up their own answer:

- how a take-back of a run gets replayed
- how the layer finds a record's run blocks on the page after a reload
- how an anchor on `main` compares once the notes are placed
- what `lahe write` serves, given what `--only` really does today

After those come unpinned function shapes between the three builders, copy and failure codes that Phase 2 is not allowed to add, and a few write-cost and size limits that the numbers do not back up.

Code checked: `src/shared/record.js`, `merge.js`, `normalize.js`, `review_format.js`, `protocol.js`, `gestures.js`, `manifest.js`, `src/layer/editing.js`, `replay.js`, `anchor.js`, `sync.js`, `store.js`, `index.js`, `src/service/handled_check.js`, `log.js`, `routes.js`, `markdown.js`, `src/cli/commands/review.js`, `src/cli/index.js`, the spike scripts under the old scratchpad, and the wireframe screens in `wireframes/a-block-menu/`. No `docs/ongoing/diagrams/INDEX.md` exists; the diagrams live in `docs/diagrams/` with a `README.md`.

---

### 1. A take-back of a run has no replay path, and the plan's shape makes replay put the text back

- severity: blocker
- kind: defect
- where: plan Task 1.4 ("take-back records carrying the run"), Task 2.4; architecture "Undo of a committed record"; `src/shared/record.js` `revertOf` (line 1459)
- what: The architecture defines a run record as any record with a non-empty `new_blocks`. Task 1.4 says a take-back "carries the run", and no task gives replay a way to remove placed blocks.
- why: Today `revertOf` swaps `before` and `after`. That only covers the anchor. If the take-back carries the blocks in `new_blocks`, every reader treats it as a run, and replay's insert path puts back the words the reviewer just undid. If it does not carry them, then after the next reload (before the agent acts) the placed blocks are still in the source and still on the page. Brief R15 (undo removes the text from the page) then fails on every reload. The "undo of a handled run" tests in 2.4 and 3.4 run before any reload, so they cannot catch this.
- fix: Name a separate field for blocks to remove, for example `remove_blocks`, and say that a take-back never carries `new_blocks`. Add a replay row for it: find the listed blocks through the same walk and matcher, and hide them until the agent answers, as today's revert does for the anchor. Add a test: undo a handled run, reload before the agent replies, and check that the run is not on the page. **Lands in:** architecture (Data / State Changes, Replay after a rebuild), plan Task 1.4 (field and fixture), Task 2.6 (the remove row), Task 3.4 (seam test).

### 2. No shared way to find a record's run blocks on the live page after a reload

- severity: blocker
- kind: risk
- where: plan Task 2.1 (`itemFor` maps any run block), Task 2.4 (undo removes the run's elements, protection snapshots the run), Task 2.6 (replay inserts); `src/layer/editing.js` `itemFor` (line 1859)
- what: `itemFor` today finds one element through the record's `region.ref`. Run blocks have no ref and no stamp. After a reload they were either inserted by replay (2B) or placed by the agent. Nothing says how 2A finds them again.
- why: Four callers need the list of elements that are this record's run: `itemFor`, committed undo, protection, and the "Cmd-Shift-E on a run block reopens" test. 2A and 2B would each write their own version. One would probably use the matcher and the other a DOM marker, so they would disagree on the same page. The reviewer has no spec to check either against.
- fix: Add `blocks.runElementsFor(record, anchorEl)` to Phase 1 Task 1.3. It returns the live elements matched one-to-one, built on Task 1.2's matcher, and every caller uses it. If the wireframe's dashed "sent, not yet placed" rule (finding 23) is adopted, say whether a layer-only marker on inserted blocks is part of the answer. **Lands in:** plan Task 1.3, Task 2.1, Task 2.4, Task 2.6; architecture (Two sittings in the same place).

### 3. An anchor on `main` cannot compare once the notes are placed

- severity: blocker
- kind: defect
- where: architecture "Empty page and `lahe write`", "Replay after a rebuild"; plan Task 2.3; `src/layer/anchor.js` (probe is the region's text)
- what: On an empty page the anchor is `main`, with `before` and `anchor_after_html` both empty. After the agent writes the notes and the page rebuilds, `main`'s text is the whole page.
- why: The anchor compare reads the anchor's own words. Page text that is neither `before` ("") nor after ("") is branch four, a conflict. The architecture says to "insert nothing until the reviewer answers the conflict". So every notes page would show a conflict card after its first placement. Three more gaps sit behind this:
  - The empty-container rung is defined only for "a page with no content blocks", so after placement nothing says how `main` resolves.
  - The editing host is "the anchor's parent", which for `main` is `body`, while the run goes inside `main`.
  - The handled check has no anchor words to look for (finding 12).
- fix: Add a container-anchor rule. When `placement` is `start_of_container`, the anchor compare is skipped: the anchor is always applied, and only the run is decided by the presence table. The rung resolves by tag whether or not the page has content. The host is the container itself. Add a unit fixture and a 2B test: an empty-page record, the notes placed, a reload, and no conflict. **Lands in:** architecture (Empty page, The editing host, Replay after a rebuild), plan Task 2.3, Task 2.5, Task 2.6.

### 4. `lahe write` is built on a wrong reading of `--only`, and needs files no builder owns

- severity: blocker
- kind: defect
- where: architecture Security ("Every page it serves runs as `--only` with no folder mount"); plan Task 2.10; `src/cli/commands/review.js` lines 226-260 and 321
- what: Today `--only` means "only this page gets the rail; other pages under that root are served without the rail". It does not stop serving the folder. A Markdown review also calls `registerMount` for the source file's folder (`rendered.assetRoot`) and for each linked folder.
- why: The Task 2.10 test "a request for a sibling file gets a 404" cannot pass by passing `--only`. Making it pass means changing either `review.js` or `static_servers.js`, and neither is in 2C's file list. A `lahe write --session X` that joins a session also shares that session's static server. Any folder an earlier `lahe review` in that session mounted stays served. So the promise the security review accepted (SR4, the notes folder is not served) does not hold.
- fix: State the real mechanism. Either `write.js` calls a new `review.js` option that skips the asset mount and the link mounts, or it starts its own single-file server. Add the file that changes to 2C's ownership. Say what happens on `--session` when that session already has mounts: refuse, or start a separate server. **Lands in:** architecture (Security, `lahe write`), plan Task 2.10 and the Phase 2 ownership table.

### 5. The editing host is "the anchor's parent", but the run goes after `sheet-head`, outside that parent

- severity: important
- kind: defect
- where: architecture "The editing host" and "Where after the anchor is"; plan Task 2.1
- what: On the Markdown render, an `h2` anchor's parent is `div.sheet-head`. `insertPointAfter` puts the new block after `sheet-head`, in the `section`. A host set on `sheet-head` does not contain the new block.
- why: The brief R14 header case happens on exactly this page. A builder who follows the text literally ships a new paragraph that cannot be typed into. The alternative is that the builder quietly picks a different host, and the reviewer cannot tell which rule was meant.
- fix: Define the host as the parent of the element `insertPointAfter` climbed to. That is the nearest ancestor holding both the anchor and the run. For a container anchor, the host is the container itself (finding 3). **Lands in:** architecture (The editing host), plan Task 2.1.

### 6. The Phase 1 functions three builders share have no signatures or return shapes

- severity: important
- kind: risk
- where: plan Task 1.2 (reader, matcher), Task 1.4 (validation, anchor view, builder), Task 1.3 (`writeBlock`)
- what: The matcher "says which new blocks are present" but has no return shape. The validation function "returns a named refusal reason", but no name or codes are given. The anchor view and the builder have no names.
- why: 2B's presence table needs to know, per block, whether it is whole, joined, split, or missing, and which leaf indexes it matched. That is how it tells "one-to-one" from the rest and finds "the last present block". 2C's handled check needs the same result. 2A needs it for finding 2. Phase 1 lands first, so the names will exist before Phase 2, but I would be reviewing Phase 1 against nothing, and a shape that fits one consumer can quietly miss another.
- fix: Pin the shapes in Task 1.2 and 1.4. For example, `matchRun(blocks, leaves) -> [{index, status: "whole"|"joined"|"split"|"missing", leaves: [i...]}]`, `validateRun(item) -> null | {code}`, and `anchorView(item) -> item`. List the refusal codes by name. **Lands in:** plan Tasks 1.2 and 1.4.

### 7. The replay walk has no end, so presence is not testable

- severity: important
- kind: risk
- where: architecture "The walk" and "The presence table"; plan Task 2.6
- what: Replay "reads leaf blocks forward from the anchor's insert point", but nothing says where the walk stops.
- why: If it runs to the end of the page, a short block such as "Notes" or "Yes" counts as present when the same words appear anywhere lower down. It then never gets inserted, which breaks the no-duplicate guarantee in the other direction: text goes missing. "In run order" does not bound it either. One test per presence-table row cannot be written without knowing the window.
- fix: State the window. For example, the walk stops at the first leaf that matches no remaining block after at least one match, or at `run length + N` leaves. Name N as a constant beside `SHORT_BLOCK_WORDS`. **Lands in:** architecture (Replay after a rebuild), plan Task 1.2 constants table.

### 8. New card notes and replay flags need shared code that Phase 2 may not touch

- severity: important
- kind: risk
- where: plan Task 2.6 ("through the card's existing flag path"), Task 2.7, Task 3.2; `src/layer/replay.js` `flagConflict` and `CHECK_NOTICES`; `src/shared/record.js` `PAGE_CHECK_FORMAT_NOTE`
- what: Replay's only card flag today is the conflict badge (`failures.failure("REPLAY_NEITHER_MATCHES")`). "Placed in a different spot" and "wrong tag" need new failure codes in `src/shared/failures.js` and new copy. Task 1.4 adds only the two refusal codes. The wrong-tag reopen reuses `PAGE_CHECK_FORMAT_NOTE`, which says "the bold or italic in this edit did not" land.
- why: 2B would have to edit a shared file it is barred from, or reuse the conflict path, which shows a conflict card for something that is not a conflict. A header placed as a paragraph would reopen with a note about bold, so the agent is told the wrong thing to fix.
- fix: In Task 1.4, add the failure codes (placed elsewhere, wrong tag) and a fourth page-check sentence for a wrong tag in `record.js`, with its line in `CHECK_NOTICES`, and write the copy into the plan. **Lands in:** plan Task 1.4 and Task 2.7; architecture (The page check on a run).

### 9. A refused run event loops forever and the reviewer never sees it

- severity: important
- kind: defect
- where: plan Task 2.8, the "Numbers" table (ceiling warning at 90 percent); `src/service/log.js` `append` (returns `rejected`), `src/layer/sync.js` (never reads `rejected`)
- what: The helper will refuse bad or oversized run events with a named code. Today a rejected event is logged by the helper and never acknowledged, so the page re-posts it on every reconnect. The docs also say what the bar does at 90 percent of the ceiling, but not what happens at 100 percent.
- why: A capture bug, or a reviewer who keeps typing past the ceiling, leaves the work sitting in browser storage and never reaching the agent. No chip and no card says so. This is the "work lost silently" failure this tool exists to prevent.
- fix: At the ceiling, the layer stops accepting input into the run, and the bar says so. Write that copy down, along with the 90 percent warning copy. `sync.js` reads `rejected` for the new codes, stops re-posting that event, and shows a card badge. Add a 2C test: a forced over-ceiling event is refused and the card shows it. **Lands in:** architecture (Size ceiling), plan Task 2.2 and Task 2.8.

### 10. The projection still cuts `after_html` at 2000 characters, so the old-agent promise is false

- severity: important
- kind: defect
- where: architecture "Rollout and old agents" and "`before`, `after`, `after_html` keep one meaning"; plan Task 1.6; `src/shared/review_format.js` lines 505 and 528 (`BEFORE_MAX = 2000`)
- what: Only `new_blocks` is exempt from the cut. `after_full` and `after_html` for a run record are still cut at 2000 characters.
- why: The architecture keeps the whole sitting in `after_html` so that an old agent "places every word" and "nothing is dropped silently". For any post over 2000 characters, that agent places a cut-off section. The page check does reopen it later, but that argues against the stated reason for keeping `after_html` whole.
- fix: Either exempt `after_full` and `after_html` for run records (the helper's ceiling is already the limit), or correct the Rollout text to say an old agent gets the first 2000 characters and the page check catches the rest. Add a projection test for whichever is chosen. **Lands in:** architecture (Rollout), plan Task 1.6.

### 11. `after_history` has no cap in the store, so "history full" has no meaning, and the body limit does not fit

- severity: important
- kind: risk
- where: plan Task 2.8 ("a record at both ceilings, with `after_history` full, fits under `MAX_BODY_BYTES`"); `src/shared/record.js` `bumpRev` (no cap); `review_format.js` `AFTER_HISTORY_MAX = 50` (projection only); `src/service/index.js` `MAX_BODY_BYTES = 8 MiB`
- what: A record at the ceiling carries the run three times: in `new_blocks`, `after_html`, and `after`. That is about 600,000 bytes of ASCII, or about 1,800,000 bytes for three-byte characters (computed with Python). Each history entry now carries the same fields. At the ceiling, 12 ASCII entries or 3 CJK entries fit under 8 MiB. The store keeps every entry.
- why: The Task 2.8 test either fails, or passes only because the builder picks a small "full" on their own. A notes page where every sitting bumps the revision grows its history without limit.
- fix: Add a store-side cap on history entries that carry `new_blocks`. For example, keep the runs of the last K entries and drop `new_blocks` from older ones, since branch three only needs recent revisions. Name K. Make the ceiling a byte count, not a character count, or state the three-byte case. **Lands in:** architecture (Data / State Changes), plan Numbers table and Task 1.4.

### 12. The run and bold handled checks have no matching rule the helper can run

- severity: important
- kind: risk
- where: architecture "The handled check"; plan Task 2.9; `src/service/handled_check.js` (a page-wide containment test; its own comment says the helper cannot find a region in a file)
- what: "Anchor words, then each block's words in order" needs a starting point in the built HTML. The helper cannot find the anchor, the anchor's words can be short or appear many times, and a container anchor has no words at all. "Checked for the `strong` and `em` it asked for" does not say what counts as present.
- why: Two builders could write passing tests against different rules. Using a page-wide search with no order also means a block that exists elsewhere on the page passes.
- fix: Spell out both rules:
  - For a run: skip the anchor when it is a container or has fewer than `SHORT_BLOCK_WORDS` words, find the first run block's leaf page-wide, then match the rest in order from there with Task 1.2's matcher.
  - For bold on a `format_only` record: take the changed runs from `record.formattingChangeText`'s run reader, and for each, require the words inside a `strong` or `b` (or `em` or `i`) in the built page's leaf blocks. Say plainly that bold words appearing elsewhere give a false pass.
  **Lands in:** architecture (The handled check), plan Task 2.9.

### 13. Any question on a run record gets the proofreading buttons

- severity: important
- kind: defect
- where: plan Task 3.3; brief "AI Behavior" ("When the agent cannot tell where new text belongs, it asks")
- what: "Use the fixes" and "Keep my words" show on any `question` reply on a run record.
- why: A placement question on a run ("Should this go under Intro or Premise?") would offer "Use the fixes". Clicking it posts a reply that answers a different question.
- fix: Mark the proofreading reply in a structured way. For example, add a reply field or flag in `protocol.js` `REPLY_FIELD` in Phase 1, and have the contract tell the agent to set it. Show the buttons only when it is set. Also write down the exact thread text each button posts, since the agent reads it. **Lands in:** architecture (The proofreading reply), plan Task 1.5 or 1.6 and Task 3.3.

### 14. The agent is asked to count 150 words itself

- severity: important
- kind: risk
- where: architecture "The proofreading reply"; plan Numbers table (`PROOFREAD_MIN_WORDS`)
- what: The contract asks the agent to proofread when the run's words, minus `from_anchor` blocks, number more than 150.
- why: Agents miscount. R11 (proofreading after a long hand-written block) then fires at random near the line, and a reviewer cannot tell a code bug from a counting error.
- fix: Have the projection compute it. Project `run_words` (or `proofread: true`) per item, counted by one named function in `normalize.js`, and have the contract read that field. **Lands in:** architecture (The proofreading reply, Projection), plan Task 1.6.

### 15. The contract does not tell an agent that a later revision repeats blocks it already placed

- severity: important
- kind: risk
- where: architecture "Two sittings in the same place" ("The agent sees a rewording"); Contract changes list
- what: On a notes page, the second sitting grows the same record. If the agent has already placed revision 1's blocks, revision 2's `new_blocks` repeats them and adds more.
- why: An agent that follows "place the blocks after the anchor, in order" writes revision 1's blocks twice in the source. Replay then sees them twice. The presence table does not cover duplicates the agent itself put in the source.
- fix: Add a contract line: `new_blocks` is the whole run at this revision; place only the blocks not already in the source after the anchor. Add a 3.4 case: the agent places revision 1, the reviewer adds a sitting, the agent places revision 2, and every block shows once. **Lands in:** architecture (Contract changes), plan Task 1.6 and Task 3.4.

### 16. "Cmd-Shift-E with the pointer over no block" is not today's rule, and write state has no gesture row

- severity: important
- kind: risk
- where: plan Task 2.3; `src/layer/editing.js` `editBlockAtCaret` (line 2248); `src/shared/gestures.js` rows and `gestureFor`
- what: Today Cmd-Shift-E edits the block at the caret, not under the pointer. The plan's "write state" needs a new gesture decision, a hint row, and a rule for Esc. All of that lives in the shared `gestures.js`, which Phase 2 may not touch, and Task 1.5 adds only the hotkey matcher.
- why: 2A would either change `gestures.js` without permission or put a second gesture rule inside `editing.js`. The file's own rule is one decision, in one place. Nothing says what Esc does with a session open inside write state: commit only, or commit and leave write state.
- fix: In Task 1.5, add a write-state gesture to `gestureFor` and a hint row with its copy. Say whether "over no block" is judged by the caret or the pointer. Say that Esc first commits an open session, and a second Esc leaves write state. **Lands in:** plan Task 1.5 and Task 2.3.

### 17. Mod-Alt digit hotkeys matched on `event.code` take over AltGr characters on Windows

- severity: important
- kind: risk
- where: plan "Block-type hotkeys" table
- what: On Windows, Ctrl-Alt is AltGr. On a German layout, AltGr-7, AltGr-8, AltGr-9 and AltGr-0 type `{`, `[`, `]` and `}`, and AltGr-2 and AltGr-3 type `²` and `³`. Matching on `event.code` alone treats those keys as the chord.
- why: A Windows reviewer typing a closing brace turns the block into a paragraph, and typing `²` turns it into a heading. `CLAUDE.md` names Windows as supported.
- fix: On non-macOS systems, skip the chord when `event.getModifierState("AltGraph")` is true or when `event.key` is a printable character. Add a unit case to Task 1.5's matcher test. **Lands in:** plan Block-type hotkeys and Task 1.5.

### 18. Placement on an HTML page is required but never tested

- severity: important
- kind: defect
- where: brief R9 (how to place new text, for HTML and for Markdown); plan Acceptance R9; plan Task 3.4
- what: The acceptance line says a contract-only agent places a run in HTML and Markdown. Task 3.4's scripted agent only writes Markdown.
- why: "The start of the container the region names", and escaping for HTML and templates, are contract lines nobody runs. An evaluator cannot mark R9 green from the task list.
- fix: Add a 3.4 case that places the worked example into an HTML source (`blog.html`), including one block with `<` and `&` in its words. **Lands in:** plan Task 3.4 and Test List.

### 19. The copied R14 scripts point at the main checkout, so they test the wrong code from a worktree

- severity: important
- kind: risk
- where: plan Task 1.1; `r14_repro/repro.js` line 10 (`const REPO = "/Users/kennethstclair/Documents/workspace/live-agentic-html-editor"`), and the same absolute path in `host_spike/*.js`
- what: The scripts that seed Tasks 2.7, 2.9 and 3.4 run `bin/lahe.js` and Playwright from the main checkout.
- why: Run from a builder's worktree, they exercise main's code, not the branch. A pass means nothing. Task 1.1's acceptance line also asks them to reproduce the bugs, so once the fix lands they "fail" by design.
- fix: Task 1.1 replaces the absolute path with a path relative to the repo root (`path.resolve(__dirname, "../../..")`). The acceptance line becomes a before-and-after pair: the walk reproduces on the Phase 1 base and passes after Task 3.4. **Lands in:** plan Task 1.1.

### 20. The cost of writing to storage on every keystroke is not stated for a whole post

- severity: important
- kind: risk
- where: plan Task 2.1 (capture through `cleanBlock`); `src/shared/protocol.js` `FLUSH.TO_BROWSER_STORAGE` ("every keystroke, synchronously"); `src/layer/store.js` `writeDraft`; code-review checklist "Cost of writes"
- what: Each keystroke rebuilds the whole run through `cleanBlock`, rebuilds `after_html` and `after`, and writes the whole record to `localStorage`, history included. The plan only lengthens the helper's draft floor.
- why: For a long post, each keystroke reads and writes the whole record. That record can reach hundreds of kilobytes (finding 11), which is the same shape as the 300 KB-per-keystroke problem the checklist names. Nobody has measured it.
- fix: Recapture only the block the caret is in and reuse the cleaned html of the rest. Add a measurement with `scripts/measure_draft_write_cost.js` on a 5,000-word run, with a stated budget per keystroke, as a Task 2.1 acceptance line. **Lands in:** architecture (Draft growth), plan Task 2.1.

### 21. "All six types by menu, hotkey, and Markdown shortcut" contradicts the plan's own table

- severity: minor
- kind: defect
- where: plan Acceptance R3, Task 2.2 acceptance, Test List (Writing 2A)
- what: The table leaves h4 out of the menu, and `p` has no Markdown shortcut.
- why: Taken literally, the test cannot pass. Taken loosely, each evaluator reads it differently.
- fix: Reword it as "each type by every route the table gives it". **Lands in:** plan.

### 22. "No mode switch" against "write state"

- severity: minor
- kind: challenge
- where: brief Non-Goals ("A new mode"); plan Acceptance R2; plan Task 2.3; `wireframes/a-block-menu/02-edit-state.html` ("Edit state, no block open")
- what: Ken approved a page-level state with no block open. The plan calls it "write state". The plan's R2 acceptance line says there is no mode switch.
- why: An evaluator reading R2 fails Task 2.3 by design.
- fix: Use the wireframe's name ("edit state, no block open"). Reword the R2 acceptance line to "the same Cmd-Shift-E, frame and bar; no second editor". **Lands in:** plan.

### 23. The wireframe's dashed "sent, not yet placed" rule has no task

- severity: minor
- kind: defect
- where: `wireframes/a-block-menu/05-waiting.html` ("The dashed rule marks it as sent but not yet placed"); plan Task 3.2
- what: The approved direction shows a visual marker on unplaced run text. No task builds it and nothing says it is dropped.
- why: The design review will find a gap against the approved wireframe.
- fix: Add it to Task 3.2 as a layer-only style that never reaches a record, or record it as dropped under Changes from plan. It may also help with finding 2. **Lands in:** plan Task 3.2.

### 24. Change text for a run leaves three cases undefined

- severity: minor
- kind: risk
- where: architecture "Change text"; plan Task 1.4; `record.js` `editChangeText` (today it quotes words: `Changed "..." to "..."`)
- what: Three cases have no rule:
  - When the anchor was also reworded in the sitting, does its half keep today's quoting?
  - What does "after this paragraph" say when the anchor is a header, a list, or `main`?
  - What sentence does `start_of_container` get?
- why: `change` is an intent field, and the security review made "structure only" a rule. A builder who reuses `editChangeText` for the anchor half puts words into the instruction channel.
- fix: Give the sentences for each case in Task 1.4, and say whether the anchor half quotes. **Lands in:** architecture (Change text), plan Task 1.4.

### 25. The leaf-block rule makes each `li` a leaf, but the text says a list is one block

- severity: minor
- kind: defect
- where: architecture "The walk"; plan Task 1.2
- what: `li` is in `BLOCK_TAGS` and holds no block tags, so by the stated rule each item is a leaf and the `ul` is not.
- why: The string reader and the DOM walk could each special-case lists differently, and Task 1.3 asks them to match.
- fix: Add to the rule: "`ul` and `ol` are leaves; their `li` children are lines, not blocks". **Lands in:** architecture, plan Task 1.2.

### 26. The architecture and the plan disagree about `export.js`

- severity: minor
- kind: defect
- where: architecture reader table (`export.js` "writes the whole-sitting `after`, as today"); plan Task 1.6 (formatter shows blocks by type, asserted in `export_text.test.js`); `test/unit/export_text.test.js` header ("no assertion about the wording review_format produces")
- what: One doc says export is unchanged. The other changes it and asserts the wording in a test file whose own rule forbids that.
- why: The reviewer cannot tell which one is the contract.
- fix: Pick one. If the formatter changes, put the wording assertions in `review_format.test.js` and fix the architecture row. **Lands in:** architecture reader table, plan Task 1.6.

### 27. The Phase 2 ownership table leaves out test files the tasks edit

- severity: minor
- kind: risk
- where: plan Phase 2 table and each task's Files list
- what: The tasks edit these test files, but the table does not list them:
  - 2A: `anchor_cases.test.js`, `anchor_engine.test.js`, `protect_vocabulary.test.js`
  - 2C: `draft_flush_cadence.test.js`, `cli_dispatch.test.js`, `markdown_render.test.js`
  - Task 1.6 asserts in `export_text.test.js` but does not list it.
- why: The Phase 2 check that "the diff touches only files its builder owns" flags them, or gets waved through by hand.
- fix: Add them to the table and to Task 1.6's Files. **Lands in:** plan.

### 28. Nothing says which anchors can take a run

- severity: minor
- kind: risk
- where: architecture "Block types while writing"; plan Task 2.1
- what: Enter at the end of a `td`, `th`, `dt`, `dd` or `figcaption` would put a `p` where the parent cannot hold one.
- why: Invalid structure on the page, and a record the agent cannot place.
- fix: Say that a run is offered only when the insert point's parent can hold flow content. Otherwise Enter keeps today's break rule. **Lands in:** architecture, plan Task 2.1.

### 29. Unnamed session-history details

- severity: minor
- kind: risk
- where: architecture "Undo inside a session"; plan Numbers table
- what: What counts as "the end of a typing burst" is not defined (an idle time in milliseconds?). `SESSION_HISTORY_MAX = 100` whole-area snapshots at the ceiling size is about 20 MB of strings.
- why: Undo order tests depend on where a burst ends. The memory cost is not stated.
- fix: Name a `TYPING_BURST_IDLE_MS`. Store snapshots as changed blocks only, or state the memory limit. **Lands in:** plan Numbers table, Task 2.4.


---

**Contradictions between documents, collected:** findings 4 (`--only`), 5 (host against insert point), 10 (Rollout against projection), 18 (R9 against Task 3.4), 21, 22 and 26.

**Cleanup needed:** none from this review.


## Testing Review (Round 1)

**Summary.** The test list is thorough on shapes and allowlists. It is thin in three places:

- flows where two decisions meet (proofreading fixes against the always-on handled check)
- what the editable parent lets the reviewer do outside the session
- the seam between the fixtures 2B builds against and what 2A really captures

Several tests would pass against a wrong implementation, and are named below. Two findings are blockers.

Read for this review:

- the plan's Test List and every task's Acceptance
- brief R1 to R15 and its Decisions
- the architecture's Key Flows, Failure Modes and Test Strategy
- `CLAUDE.md` "Running the gate"
- `test/helpers/README.md`, `test/unit/no_arbitrary_sleeps.test.js`, `no_duplicate_text.spec.js`, `split_not_conflict.spec.js`, `protocol_wire.test.js`, `draft_flush_cadence.test.js`
- the R14 walk (`r14_repro/repro.js`, `probe_reload.js`, `out/results-all.json`)

---

### T1. Accepting the proofreading fixes is untested, and two decisions may collide there

```
severity   blocker
kind       risk
where      plan Task 3.3, Task 2.9 (AQ3), Task 2.7; Test List "Across the seams"
what       No test follows "Use the fixes" through to the agent rewording the run and replying handled.
why        After the reviewer says yes, the agent changes the words (brief R11). The always-on
           handled check (AQ3) then looks for the reviewer's original words and holds the item
           open. The browser page check looks for them too and reopens it as "undone". Replay may
           also treat the reworded blocks as missing and insert the originals beside the fixes.
           Task 3.3 only checks that the button posts a thread reply. So the most likely outcome of
           proofreading ships unseen.
fix        Add a seam spec to Task 3.4. Type a run over 150 words. The scripted agent places it and
           replies question. Click "Use the fixes". The agent rewords one sentence and replies
           handled. Assert: not held open, not reopened after two reloads, and the original
           sentence is not on the page. Add the "Keep my words" twin. If it fails, the fix is a
           design change (the check needs to know which words the reviewer approved), so it goes
           back to the architecture, not into the test.
```

### T2. The guard is tested at the session's edges, not against edits that start outside it

```
severity   blocker
kind       risk
where      plan Task 2.1 Acceptance; Test List "Writing (2A)"; architecture "The editing host"
what       The only outside-the-session tests are Backspace and Delete at the outer edges, and a click
           into another block.
why        The whole parent is contenteditable, so every page block beside the session can take
           input. What the plan does not test:
           - Cmd-A inside the host selects the whole parent. Typing or Backspace then spans page
             blocks outside the session.
           - Arrow keys move the caret into a sibling block without a click. The Test List says
             "caret moving" but Task 2.1 tests only a click.
           - In that sibling: Cmd-B, native undo (historyUndo), drop, and composition start.
           - A page whose anchor sits directly in body, which puts the Lahe overlay's host
             element inside the editable parent.
           A gap here changes page text outside any record. No record means the agent never hears
           of it.
fix        Add to free_writing_host.spec.js, in all three lanes. For each case, snapshot the
           outerHTML of every page block outside the session, act, and assert each is unchanged:
           - Cmd-A then type
           - Cmd-A then Backspace
           - ArrowDown out of the run then type
           - Cmd-B and Cmd-Z in that block
           - a drop onto it
           Add one fixture whose paragraph is a direct child of body, and assert the rail still
           works and takes no edits.
```

### T3. "Old-record specs pass unchanged" stops testing old records once 2A merges

```
severity   important
kind       defect
where      plan Task 2.5 Acceptance, Test List "Old-record specs ... pass unchanged"
what       no_duplicate_text.spec.js and split_not_conflict.spec.js make their edits by pressing Enter
           in a real edit.
why        After 2A, that Enter makes a sibling and the record is a run record. The specs keep
           passing, but now they exercise the new path. Today's replay path for records without
           new_blocks loses its only browser coverage without anyone noticing. The plan also does
           not say which existing specs 2A's Enter change is expected to alter. That list includes
           paragraph_break.spec.js and the append helpers in no_duplicate_text.spec.js. A builder
           facing a red spec at the checkpoint has no written expectation to hold it to.
fix        - Add an injected old-shape record variant to each of the three specs, built from
             record_fixtures.js with nested blocks and no new_blocks. That variant is the old-path
             guard.
           - In Task 2.1, list every existing spec whose expected result changes, with its new
             expected result.
           - List the rest as "must pass unchanged".
```

### T4. The fixtures are the 2A to 2B contract, but only one is checked against real capture

```
severity   important
kind       risk
where      plan "Who owns what at each seam"; Task 2.1 Acceptance (capture test); Task 3.4
what       Task 2.1 deep-equals only the architecture's worked example. 2B builds every other path
           against hand-written fixtures.
why        Those other paths are:
           - split tail, with and without typing
           - tag-only change
           - tag change with new words
           - paragraph turned into a list
           - list append
           - start_of_container
           Each engine writes its own markup: trailing br, nbsp, b against strong, nesting order. If
           a fixture differs from what typing produces, 2B's replay passes on the fixture and fails
           on real records. The first time this shows is Task 3.4, after the merge. Task 3.4 also
           never types a mid-block split (from_anchor) through to a rebuild.
fix        - Make free_writing_capture.spec.js type every fixture that typing can produce, deep-equal
             each one, and run in all three lanes.
           - Add a from_anchor seam case to Task 3.4: Enter mid-paragraph, type, commit, the agent
             splits the source, rebuild. Assert the text shows once and there is no conflict card.
```

### T5. Words with special characters are never typed end to end (brief R6)

```
severity   important
kind       risk
where      Test List (no line for R6); Acceptance "R6"; Task 2.9; architecture "Literal text" contract line
what       No test types words that the source format reads as syntax, and checks that the page
           shows them as typed.
why        Characters to cover:
           - < and &
           - * and _
           - backticks
           - a # or "1." mid-line
           - straight quotes and --
           Possible failures:
           - cleanBlock escaping twice (&amp;lt;)
           - the scripted agent's escaping
           - the typography fold in the handled check
           Each changes the reviewer's words or holds a correct item open forever. Under AQ3 a
           false hold happens on every run that contains a dash or a quote.
fix        - Add a Task 3.4 seam case: a run containing each character above, placed by the
             scripted agent, then a rebuild. Assert the page's text equals the typed text with
             typography folded. Assert the handled check passes and the page check does not reopen.
           - Add unit cases to handled_check_run.test.js: "a < b & c", correctly escaped, passes.
             Straight quotes rendered curly, and -- rendered as a dash, pass.
           - Add a negative Markdown shortcut test: "# " typed mid-paragraph is not a header.
```

### T6. cleanBlock is never shown to accept its own output or real captured markup

```
severity   important
kind       risk
where      Task 1.2 Acceptance; Task 2.8 Acceptance
what       The cleanBlock tests are all refusals. Nothing checks that valid input comes through
           unchanged.
why        The layer cleans at capture and the helper refuses anything that fails. If
           cleanBlock(cleanBlock(x)) is not x, or Firefox or WebKit capture produces markup the
           helper reads as a failure, every real record from that browser is refused. The reviewer
           sees nothing, because the browser keeps the draft. Task 2.8's "a valid run is stored"
           uses hand-written fixtures only.
fix        - Unit test: cleanBlock is a fixed point on its own output for a corpus of engine
             markup. The corpus covers b, i, nbsp, trailing br, nested strong and em, entities,
             and uppercase tags.
           - In Task 3.4, read the item back from review.json at the committed revision in every
             lane. Do not read window.__lahe.items(). That proves the helper accepted real capture.
```

### T7. The "contract-only" scripted agent cannot prove R9 as written

```
severity   important
kind       risk
where      Task 3.4 "The contract" bullet; Acceptance R9
what       The scripted agent is written by someone who read the architecture. It places only
           Markdown, and the plan does not say where it reads the item from.
why        R9 says an agent reading only review.json places runs in HTML and Markdown. A script
           that reads the browser store, or that writes a Markdown-only placement, passes while an
           HTML review fails. The repro walk reads window.__lahe.items(), and seeding from it
           invites the same shortcut.
fix        - Build the scripted agent as a function whose only inputs are the parsed review.json
             item and the source text.
           - Add an HTML source case: lahe review page.html, blocks placed as elements after the
             anchor, rebuild, both checks pass.
           - In Task 3.5, give the real-agent walk a named checklist: HTML and Markdown, a header,
             a list, a split, start_of_container.
```

### T8. The rollout claim about old agents has no test

```
severity   important
kind       risk
where      architecture "Rollout and old agents"; Test List (none)
what       "An old agent still acts through after_html, and nothing is dropped silently" is
           asserted but never exercised.
why        An old agent writes the whole after_html into the anchor. The new blocks then sit inside
           the anchor, before the insert point. Blocks of five or more words are "found elsewhere",
           so they are not written. Blocks under five words are missing from the walk, so they are
           inserted again, which shows them twice. The anchor compare may land in branch four and
           hold everything. None of these outcomes is pinned.
fix        Add two seam cases with an old-contract scripted agent:
           - HTML: after_html applied as the anchor's inner markup.
           - Markdown: `after` pasted as paragraphs.
           Assert that no block shows twice and that the item is reopened or flagged, not quietly
           handled.
```

### T9. The empty-container rung is tested only for success

```
severity   important
kind       risk
where      Task 2.3 Acceptance (anchor_engine.test.js); architecture Failure Modes "anchor block itself is gone"
what       The rung is only tested for resolving on an empty page. Nothing tests that it stays out
           of the way otherwise.
why        If the rung is checked too early, a record whose anchor is gone resolves to main.
           Its run is then placed at the top of the page by guess, not marked LOST. The same
           happens to an after_anchor record on a page the agent emptied. The positive test
           passes either way.
fix        Add to anchor_engine.test.js and replay_run_insert.spec.js:
           - an after_anchor record whose anchor is gone, on a non-empty page, is LOST and inserts
             nothing
           - the same record on an emptied page is also LOST
```

### T10. The merge test would pass a "longer run wins" rule

```
severity   important
kind       defect
where      Task 1.4 (merge_run.test.js); Test List "Merge on load keeps the browser's longer run"
what       The only case is browser longer than store.
why        The rule is "the browser wins on these fields while its work is unacknowledged". A wrong
           implementation that keeps the longer new_blocks passes. It would bring back blocks the
           reviewer deleted in the browser after the helper's last draft.
fix        Add the reverse: at the same revision, the browser's run is shorter, and the browser
           still wins. Add a third case: a later helper revision wins over an acknowledged
           browser copy.
```

### T11. Page styling (brief R4) has screenshots and no assertion

```
severity   important
kind       risk
where      Acceptance R4; Tasks 2.1, 2.2, 2.6 screenshots
what       Nothing fails the gate if a new block stops matching the page's spacing or type.
why        The spike caught exactly this with numbers: spacing went from 53px to 31px, and the
           font from 21px to 16px. A screenshot on a progress page is not read by the gate, so
           a CSS or host regression passes every run.
fix        Add computed-style assertions in free_writing_types.spec.js, in all three lanes, on
           blog.html and md_render.html. Compare against the page's own block of the same tag:
           - margin-top and margin-bottom
           - font-size, line-height and font-weight
           - the gap to the next block
           The only allowed difference is the new h2's section rule. Reuse the spike's measuring
           code.
```

### T12. "The reload waits" can pass without a reload ever being pending

```
severity   important
kind       risk
where      Task 3.4 "agent's rebuild lands mid-sitting"; Test List "Agent rebuild mid-sitting"
what       The test as written checks that the caret stays. It does not prove a reload was pending,
           or that one happens after commit.
why        The repro walk shows the timing traps:
           - a write before the page has its mtime baseline never reloads
           - agentWrites falls back to "reloaded by hand" after 30 seconds
           Seeded from that, the test passes if detection simply has not fired yet. It also passes
           if reloads are suppressed forever.
fix        - Poll sync.status().reloadPending === true while the sitting is open. Then assert the
             caret and the text.
           - Commit, then assert that a main-frame navigation happened and the rebuilt content is
             on the page.
           - Drop the hand-reload fallback from every ported helper. A missing self-reload must
             fail the test.
```

### T13. What happens at the ceiling is untested, only the warning before it

```
severity   important
kind       risk
where      Task 2.2 Acceptance ("a run near the ceiling shows the warning"); Task 2.8
what       No test covers the reviewer typing past NEW_BLOCKS_MAX or NEW_BLOCKS_MAX_CHARS.
why        The helper refuses the event. Nothing tells the reviewer or the card that their post
           no longer reaches the agent. The next drafts and the commit are refused too, while the
           browser still shows the text.
fix        Inject a run at the ceiling, add one block, commit. Assert one of two outcomes, and
           have the plan say which is intended:
           - the layer stops the extra block
           - the card shows the refusal
           Either way, assert the item is not shown as sent.
```

### T14. Undo (brief R15) stops before the agent acts on the take-back

```
severity   important
kind       risk
where      Task 2.4 and Task 3.4 "paragraph to header ... undo"; Acceptance R15
what       The tests end at "a take-back item is raised". Two other paths are missing:
           - an unplaced run is undone and the page reloads
           - the agent removes the placed blocks after the take-back
why        Replay inserts the missing blocks of a run record. If an undone record is still
           replayed, the removed run comes back on the next load. Once the agent removes the
           blocks, the original record's page check may reopen it as "undone", because its
           blocks are gone.
fix        Add two seam cases:
           - Undo a ready run, reload twice. Assert the run is gone.
           - Undo a handled run. The scripted agent removes the blocks and replies handled on
             the take-back. Rebuild. Assert nothing is reinserted and neither item reopens.
```

### T15. A browser crash mid-sitting (brief R5) is untested for run records

```
severity   important
kind       risk
where      Acceptance R5 ("a crash, a reload, and a repaint"); Test List (reload and repaint only)
what       No test covers a crash, where no unload runs.
why        Run drafts now reach the helper only every 30 seconds. After a crash, only the
           browser-storage copy holds the run. A large run in browser storage is also where quota
           trouble would show up (see storage_quota_typing.test.js).
fix        Add a Chromium spec that uses a persistent context:
           - type a multi-block run
           - kill the page without unload (the Page.crash call in Chromium's DevTools protocol, or
             close the context)
           - relaunch
           Assert the next load commits the whole run. If a crash test already exists in the
           repo, reuse its approach.
```

### T16. The matcher is tested only for finding blocks, not for finding them wrongly

```
severity   important
kind       risk
where      Task 1.2 Acceptance (matcher); Task 2.6 presence table tests
what       Tests cover whole, joined, split and missing. None covers a block wrongly counted as
           present.
why        The "joined" rule lets a short block's words match inside a later unrelated
           paragraph. For example, "Notes" matches a paragraph that contains the word "notes".
           The block is then never inserted. A wrong "present" is the silent-loss direction, and
           a matcher that says "present" too often passes every test in the list.
fix        Add negative matcher cases:
           - a short block whose words appear inside a later unrelated block is missing
           - blocks out of run order are not present
           - a block that is a prefix of a longer block is not present
           Also state where the walk stops, and test that limit.
```

### T17. Engine-specific editing is first run in Firefox and WebKit at the checkpoint

```
severity   important
kind       risk
where      "Rules every builder follows"; Task 2.1 to 2.4; Test List "in any browser"
what       2A builds the host, types, undo and paste in Chromium only. The first Firefox and WebKit
           run is Task 3.5, after the merge.
why        Everything AQ1 rests on differs by engine:
           - Enter and Shift-Enter already disagreed across engines (paragraph_break.spec.js)
           - beforeinput for historyUndo
           - native merge spans
           - paste
           A 2A engine bug found at 3.5 costs a fix round on the integrated branch. Paste has a
           second problem: a dispatched paste event does not produce beforeinput
           insertFromPaste, and Playwright grants clipboard only in Chromium (ac1_walk.spec.js).
           So the paste test either tests a different path or skips two lanes without saying so.
fix        - Before handoff, 2A runs its own four spec files in all three lanes by name:
             LAHE_ALL_BROWSERS=1 npx playwright test --project=firefox <file>. This is one named
             file at a time, which the gate rules allow.
           - For paste, name the path each lane tests. Use a real Meta+V in Chromium, and say what
             stands in elsewhere.
```

### T18. The handled check reads HTML with a string reader that is only compared on well-formed pages

```
severity   important
kind       risk
where      Task 1.3 Acceptance ("DOM walk and string reader agree on every Task 1.1 fixture")
what       The two readers are compared on three or four clean pages.
why        The helper's handled check reads built pages with the string reader. That includes
           hand-written HTML reviews. The browser closes a p before a div on its own, and the
           same goes for an unclosed li. Other traps: a script body containing "<p>", template
           contents, comments. Where the readers disagree, the helper holds a correct item open,
           or passes a missing one.
fix        Run the same comparison over every page under test/fixtures, plus a small malformed
           corpus covering each trap above. Where the readers disagree, fix the reader, not the
           fixture.
```

### T19. The `lahe write` overwrite test can pass against a command that refuses existing notes

```
severity   important
kind       defect
where      Task 2.10 Acceptance "it refuses to overwrite"; architecture flow "exists? yes: regular .md file: use it as is"
what       The test line does not say what happens when the file already exists.
why        The architecture says an existing regular .md is served as is. That is how notes are
           reopened the next day. A test that expects an error on an existing file passes for a
           command that breaks the second day.
fix        Split the test in two:
           - An existing regular .md: exit 0, served, contents byte-identical afterwards.
           - A directory named x.md is refused.
           Add a test that the printed folder is the real path when the parent is reached
           through a symlinked folder.
```

### T20. Two tests restate the code and cannot fail

```
severity   minor
kind       defect
where      Task 1.4 ("after read from after_html equals the builder's after"; "change text contains none of the run's words")
what       The first compares the shared reader's output with itself. The second passes on an empty
           or generic change string.
why        Both stay green when the reader or the change text is wrong.
fix        - Assert `after` against literal strings written in each fixture. The worked example's
             `after` is given in the architecture.
           - Assert the exact change sentence per fixture.
           - Put a unique token (for example "zqxcanary") in each run's words and assert it is
             absent from change.
```

### T21. The R14 test lines do not say what the agent does

```
severity   minor
kind       risk
where      Task 3.4 free_writing_r14.spec.js; Test List "R14 lone paragraph: the bold survives"
what       The lone-paragraph case fails only when the agent leaves out the bold paragraph. That is
           what the repro does, in two variants. The test line does not say it.
why        With a correct agent the bold is in the source, and the test passes against today's
           code. The header case doubled with both ways of leaving the editor (click and Esc).
           The line names neither.
fix        Spell out each case:
           - Lone paragraph: bold in the first and in the second paragraph. The agent omits the
             bold one. Assert the item reopens and the bold paragraph shows once, with its bold.
           - Header case: run with click and with Esc. Assert the h2's innerText is exactly the
             header, not the header plus the line.
```

### T22. The R14 walk is not ready to live under test/fixtures as a seed

```
severity   minor
kind       risk
where      Task 1.1
what       repro.js has several problems as a seed:
           - it hard-codes /Users/kennethstclair/... and requires node_modules/playwright directly
           - it writes worlds/ into its own folder
           - it sleeps (3000 ms, 500 ms)
           - it asserts nothing
why        test/fixtures is skipped by the no-sleep scanner, so the sleeps escape the rule. A spec
           that imports its helpers inherits them. Its worlds pile up in the repo, and removing
           them needs Ken's approval. "Reproduces as results-all.json recorded" has no pass or
           fail.
fix        Port the walk's steps onto test/helpers (service.js, poll.js). Put the worlds under
           testInfo.outputPath(). Keep repro.js as a reference file only. Otherwise write the
           three pre-fix outcomes as assertions that are expected to fail today.
```

### T23. The version bump test does not test the bump

```
severity   minor
kind       defect
where      Task 1.5 ("the existing refusal of an older helper passes at 14")
what       protocol_wire.test.js asserts only that SERVICE_CONTRACT is an integer of at least 1.
why        It stays green at any number. Nothing shows that a 14 layer or CLI refuses a 13 helper.
fix        Assert that a 13 helper is refused by the CLI and by the layer, and that a 14 helper
           is accepted.
```

### T24. Hotkey tests cannot see the macOS problem they were designed around

```
severity   minor
kind       risk
where      Task 1.5; Task 2.2
what       Playwright's key events do not produce Option-digit characters. Nor can Playwright see
           shortcuts the browser itself reserves.
why        The browser spec passes whether or not matching uses event.code.
fix        - In the unit test, build events with code "Digit1" and key "¡", and assert they match.
           - Add a reserved-chord check per browser to the Task 3.5 walk.
```

### T25. Smaller editing gaps

```
severity   minor
kind       risk
where      Task 2.1, 2.3, 2.4; Acceptance AQ1
what       Cases with no test:
           - arrow-key and Shift-arrow crossing between the anchor and the run (AQ1's own acceptance)
           - Delete at the anchor's end merging the first run block
           - cut across blocks
           - drop
           - IME composition inside a session block
           - the 101st session history step
           - a new sitting on a run block after the record is handled (it must start a new record)
           - a notes page after the agent places the first record: the next sitting is
             after_anchor on the last block, not start_of_container
why        Each is a named rule in the architecture with nothing that fails if it breaks.
fix        One test each, in the spec that owns the rule.
```

### T26. The proofreading threshold has no boundary test

```
severity   minor
kind       risk
where      Task 1.6 (PROOFREAD_MIN_WORDS); Acceptance R11
what       Only a real agent counting words applies the threshold. Nothing pins 150 against 151,
           or the skipping of from_anchor blocks.
why        The plan says "150 words", while the architecture says "more than". No automated test
           can fail on either.
fix        Have the projection carry the derived word count, or a proofread flag. Then:
           - unit test 150, 151, and a run whose words over the line are all from_anchor
           - have the scripted agent use the field
```

### T27. R7's "the caret stays" is only possible for some reloads

```
severity   minor
kind       challenge
where      Brief R7; Acceptance R7
what       The acceptance claims the caret stays on a reload mid-writing.
why        The tests cover a Lahe rebuild (the reload waits) and a repaint. A dev server's own
           full reload, or the reviewer pressing reload, commits on unload and loses the caret.
           No test can pass that case as written.
fix        Reword the acceptance to name the reloads that keep the caret. For the others, say the
           run is back and reopens where the reviewer clicks. That is what Task 3.4 tests.
```

### T28. Engine-neutral specs pay for three lanes

```
severity   minor
kind       taste
where      Tasks 2.5 to 2.7, 3.2, 3.3
what       replay_run_*, edits_tab and agent_replies inject fixtures and do no typing. They still
           run in all three lanes on gate:all.
why        This triples their cost at the checkpoint for little cross-engine signal. Battery was
           the stated reason for the gate rules.
fix        Optional: keep the full cross-engine budget for the typing specs (2A and 3.4), and
           tag the injected-fixture specs Chromium plus one other lane.
```

---

### Unit or browser, and which need all three engines

- **Unit (node:test, no jsdom):**
  - cleanBlock and its fixed point
  - the string reader and the matcher
  - record validation, change text, merge
  - projection and contract copies
  - hotkey matching by event.code
  - draft cadence, with the mock timers already in use
  - the handled check against rendered pages
  - `lahe write`
  - presence-table decisions (pure)
- **Browser, Chromium is enough:**
  - replay inserts and the page check from injected fixtures
  - edits tab and card
  - the proofreading card
  - the crash spec (it needs Chromium's DevTools protocol)
- **Browser, all three engines, run by 2A before handoff:**
  - free_writing_host, capture, types and undo
  - the T2 guard cases
  - the T11 style assertions
- **Browser, all three engines at the checkpoint:**
  - free_writing_seams and free_writing_r14, since they type for real
  - the reader comparison in blocks_kernel

### Cleanup needed

- Task 1.1 as written copies the R14 walk into `test/fixtures/free_writing/`. The walk writes a `worlds/` folder beside itself. If it is ported as planned, list that folder under "To delete at cleanup".


## Design Review (Round 1)

Reviewed: `03_plan_free_writing.md`, against the brief, the architecture, wireframe direction A (`wireframes/a-block-menu/`), and `wireframes/DECISION.md`. Ken's constraint for this review: editing existing text and writing new text look the same in the editor, and one sitting is one edit.

**Summary.** Three blockers:

- The way into writing in empty space is not reachable in normal use (DR2).
- A conflict on the anchor can drop everything the reviewer wrote (DR14).
- Accepting a proofread would likely reopen the item as undone (DR15).

The rest are missing states, missing words, and keyboard and screen reader gaps. The block menu, the hotkeys, and the rename to "Use the fixes" and "Keep my words" are sound.

Criteria with nothing to add:

- **AI slop risk:** nothing found. The surfaces are specific to this tool and this content.
- **Signature and restraint:** the plan knows the "+ Write here" line is the signature (Decision, wireframe direction A). The only competitor is the dashed rule in DR21.

### DR1. No named design guide

- severity: minor
- kind: risk
- where: repo `CLAUDE.md`; plan, "Rules every builder follows"
- what: The project names no design guide, token file, or component catalog. The de facto standard is:
  - the edit frame and bar in `src/layer/editing.js` (`FRAME_STYLE`): accent `#3c56a5`, dark twin `#93a7ea`, and the scheme sampled from the page, not the OS
  - the rail's tokens in `src/layer/overlay.js` (`--accent`, `--line`, `--surface`, `--ink-soft`)
  - the `cardact` button register, the "More actions" menu, and the question treatment in `tab_done.js`
  - `vendor/stclair-doc-style/` for how a Markdown page draws its own h2, h3, h4, and lists
- why: Four builders on three branches will each pick colors, menus, and button styles. The Acceptance Criteria ask for "consistency with the rest of the app" with nothing to check it against.
- fix: Add one line to "Rules every builder follows" that names the pieces above as the standard. Each new surface (the line, the menu, the placeholder, the quick answers) says which existing piece it copies.

### DR2. Write state is not reachable in normal use

- severity: blocker
- kind: defect
- where: Task 2.3 (starting in empty space)
- what: Cmd-Shift-E today opens "the block under the caret" (`editBlockAtCaret`, based on the selection, not the pointer). The plan says it enters write state "with the pointer over no block". A reviewer who has clicked or selected anything on the page has a caret in a block. So Cmd-Shift-E opens that block, and the "+ Write here" line never shows.
- why: The signature element and R1 (write where no text exists) have no reliable way in. It works in the spec because the spec controls the caret. It fails for Ken on the first real page.
- fix:
  - Keep Cmd-Shift-E caret-based, as today. With no caret in a block, it enters write state.
  - Show the "+ Write here" line whenever an edit is open, not only in write state with no block open. Clicking a line commits the open session and starts the new one. Clicking a gap already commits today.
  - Add a spec: caret in a paragraph, Cmd-Shift-E, hover a gap, the line shows, click it, a new session opens after the right block.

### DR3. Write state with no block open looks like nothing happened

- severity: important
- kind: defect
- where: Task 2.3; wireframe `02-edit-state`
- what: In write state with no block open, the page shows nothing until the pointer rests in a gap. Nothing says the reviewer is in write state, how to start, or how to leave. The plan also does not say what a click on a block does in this state.
- why: The reviewer presses the key, sees no change, and presses it again or gives up. Esc as the only exit is invisible.
- fix: Reuse the edit bar with no block under it, pinned near the top of the viewport. The label is the same as the edit label (see DR12). The hint reads "Click + Write here to add text. Esc to finish." The menu, B, I, and Delete block are hidden. A click on a block opens that block, as Cmd-Shift-E would. A click on the rail or Esc leaves.

### DR4. The empty notes page still needs a pointer click

- severity: important
- kind: challenge
- where: Task 2.3 ("opens in write state on load"); wireframes `b2b-notes-empty` and `b4-empty-rail`
- what: The empty page opens in write state, but the reviewer must still find a line that "appears only under the pointer" and click it. The rail copy says "Move the pointer onto the page and click + Write here."
- why: On a blank page there is only one place to write. A step that exists only to pick that place is friction on the first thing a note-taker does. It also leaves a keyboard user stuck.
- fix: On a page with no content blocks, open a session right away, with the caret in an empty paragraph after the title and the placeholder from DR23. The rail copy becomes "Start typing. Your notes go to notes/2026-09-28.md." This goes against the approved wireframe screen, so Ken decides. If he keeps the click, show the line all the time on an empty page, not only under the pointer.

### DR5. The note-taker first sees the wrong empty text

- severity: important
- kind: defect
- where: Task 3.2 (the empty Edits tab)
- what: The rail opens on the Active tab. Its empty text today is "Nothing outstanding. Select some text and press Cmd-Shift-C." (`emptyTextFor` in `overlay.js`). The plan changes only the Edits tab's empty text.
- why: On a blank notes page, the first line the reviewer reads tells them to select text that does not exist.
- fix: On a page with no content blocks, change the Active tab's empty text too. Pin the exact lines in the plan, taken from `b4-empty-rail` and trimmed to fit DR4. Cover both tabs in `edits_tab.spec.js`.

### DR6. The keyboard path through the block menu

- severity: important
- kind: defect
- where: Tasks 1.5 and 2.2 (hotkeys and the bar menu)
- what: The bar's buttons cannot be reached from the keyboard today. The bar blocks focus on mousedown, and it sits in a shadow root outside the page's tab order. So hotkeys are the only keyboard path to block types, and the menu as drawn shows no hotkeys. The plan also does not say:
  - which Esc wins when the menu is open
  - where focus goes when the menu closes
  - how a keyboard user reaches "+ Write here"
- why: Hotkeys nobody can see are hotkeys nobody uses. Esc that commits the whole sitting when the reviewer meant to close a menu ends their writing by accident.
- fix:
  - Build the menu from the "More actions" menu in `overlay.js`: `role=menu`, `aria-haspopup`, `aria-expanded`, arrow keys, and focus back to the caret on close.
  - Each menu row shows its chord and its Markdown shortcut on the right, drawn from the one matcher in `gestures.js`, so the hints and the keys cannot disagree.
  - Esc with the menu open closes only the menu.
  - Write down that the keyboard way into new text is Enter at the end of the block above.
  - Add each of these to `free_writing_types.spec.js`.

### DR7. The screen reader hears nothing useful

- severity: important
- kind: defect
- where: Tasks 2.1 and 2.2
- what: With the parent as the editing host, a screen reader announces the whole article as editable. Edits outside the session are refused in silence. Block type changes are silent. Nothing is said when a session starts or is sent.
- why: A screen reader user cannot tell where they are writing, what type the block is, or that their typing outside the session went nowhere.
- fix: Add a polite live region in the layer's shadow root. It announces:
  - the session start ("Writing after: What I tried first")
  - each block type change ("Heading")
  - the commit ("Sent to the agent")

  This is a new component. State in Task 2.1 that nothing existing fits: the rail's toasts are for agent replies, not caret events. Assert the announcements in a spec.

### DR8. h4 is in the hotkeys and the Markdown shortcuts but not in the menu

- severity: important
- kind: defect
- where: "Block-type hotkeys" table; Task 2.2 acceptance; Acceptance Criteria R3 (paragraphs, headers, lists by the reviewer)
- what: The table says h4 is not in the menu, and the menu button reads "Small heading" when the caret is in one. Task 2.2 and the R3 line both require "each of the six types by the menu".
- why: The acceptance cannot pass as written. The menu can also show a value it does not offer, which is a dead end: the reviewer sees "Small heading" and cannot find it in the list.
- fix: Add "Small heading" as the fourth row of the menu, so it has six rows. That keeps "one function per block type, three ways in" true everywhere. If Ken wants five rows, drop h4 from the hotkeys and the Markdown shortcuts too, and fix both acceptance lines.

### DR9. What the menu says in a block that is not one of the six

- severity: minor
- kind: defect
- where: Task 2.2
- what: The plan does not say what the menu reads, or what the hotkeys do, when the caret is in a block outside the six types. Examples: a blockquote, the page's h1, an h5, a `pre`, a table cell, a figcaption.
- why: The builder will pick at build time. The likely outcome is a menu that reads "Paragraph" on a quote, and a pick that swaps a tag `swapTag` was never meant to see.
- fix: The button reads "Other block" and is disabled there, and the hotkeys and shortcuts do nothing. Add one spec case.

### DR10. Changing type inside an existing page list

- severity: important
- kind: risk
- where: Task 2.2 ("in an existing list, the anchor is the whole list")
- what: The plan does not say what happens when the reviewer picks Paragraph or Heading with the caret in item 3 of a 5-item list that was already on the page.
- why: The two obvious builds are both surprising. One turns the whole list into a paragraph. The other splits the list into three pieces, which is outside what the record shape covers.
- fix: For an existing list:
  - Bulleted and Numbered swap the whole list.
  - Paragraph on the last item ends the list and moves that item's words into a new paragraph in the run, the same as Enter in an empty last item.
  - Every other type is disabled on a middle item in this cut.

  Put this in Task 2.2 with a spec case.

### DR11. What the frame covers in a "+ Write here" session

- severity: important
- kind: risk
- where: Tasks 2.1 and 2.3; wireframe `03a-new-block`
- what: The plan makes the session the anchor plus the run. The wireframe frames only the new empty block. `positionFrame` reads one block's box today. The plan does not say which blocks the frame wraps.
- why: By default the frame will wrap the paragraph above too. Writing a new section then looks like editing the paragraph above, which breaks Ken's "looks the same" in the other direction.
- fix: One rule for both ways in: the frame wraps every block the sitting created or changed, plus the caret's block. An anchor the reviewer never touched stays outside it. Take the Task 2.1 and 2.3 screenshots so both show the rule.

### DR12. The bar still says "Editing this block"

- severity: minor
- kind: challenge
- where: Task 2.2; wireframe A's open copy point
- what: The wireframe flagged this label as Ken's call. The plan is silent, so today's `LABEL_EDITING` ships. It reads wrong over an empty new block, and over a frame holding five blocks.
- why: The label is the one word on the bar that names what is happening.
- fix: Ask Ken. The recommendation is "Editing" for every case, as one constant, so writing and editing still read the same.

### DR13. How the parent's focus ring gets hidden

- severity: important
- kind: risk
- where: Task 2.1 ("the focus ring is hidden with the layer's own shadow-root style")
- what: A style inside a closed shadow root cannot reach an element on the page, and the parent (`main`, `article`) is on the page. The only page-level style sheet the layer has is the D8 exception in `highlight.js`.
- why: If the stated method fails, Chromium draws its focus outline around the whole article while the reviewer writes. That reads as a mode switch, which is exactly what Ken ruled out.
- fix:
  - Name the method: one rule in the D8 page sheet, scoped to the attribute the layer sets on the host, removed on teardown.
  - Say that the frame is the focus indicator, so it is drawn whenever a session is open, including around an empty new block, and keeps its contrast in both schemes.
  - The Task 2.1 screenshot checks for no outline in all three browsers.

### DR14. A conflict on the anchor can drop the reviewer's whole section

- severity: blocker
- kind: risk
- where: Task 2.6 ("holding everything while the anchor is in branch four"); the conflict card in `replay.js`
- what: While the anchor is in conflict, replay inserts nothing. So after a rebuild, the section the reviewer wrote disappears from the page. The conflict card shows only the anchor's two versions. "Take the page's" retires the record, and with it every new block the reviewer wrote. Nothing on the button says so.
- why: One click on a choice about one paragraph silently throws away a hand-written section.
- fix:
  - For a run record, the card says the new text is held: "Your 4 new blocks after this paragraph are waiting on this choice." The layer fills in the count.
  - Both answers keep the run. "Keep mine" applies the anchor and inserts the run. "Take the page's" keeps the page's anchor and still inserts the run after it.
  - If Ken wants "Take the page's" to drop the run, the button has to say so.
  - Add a spec to Task 3.4 and a screenshot.

### DR15. After "Use the fixes", the item likely reopens as undone

- severity: blocker
- kind: risk
- where: Task 3.3; Tasks 2.6 and 2.7 (the insert path and the page check)
- what: When the reviewer says yes, the agent changes their words in the source. The record still holds the typed words. The plan's page check reopens an item when a block's words are missing. Once the item is reopened, the insert path can write the old sentence back beside the fixed one. No task or test covers this path.
- why: The reviewer accepts two small fixes and gets an "undone" card, or the same sentence twice. That is the exact bug class this feature exists to fix.
- fix: Decide how the record learns the fixed words. The recommended default: the contract has the agent reply handled with the fixed blocks, and the layer saves them as a new revision of the record. `after_history` keeps the typed version. The page check then compares against what the reviewer approved. Add a spec to Task 3.4: question, "Use the fixes", the agent applies them and rebuilds. The item is not reopened, and nothing shows twice.

### DR16. The quick answers show on any question about new text

- severity: important
- kind: defect
- where: Task 3.3 ("a question reply on a run record shows ... two quick answers")
- what: The brief also has the agent ask a question when it cannot tell where new text belongs. That card would offer "Use the fixes" and "Keep my words". Separately, the question treatment in `tab_done.js` says it "deliberately adds no button of its own", and the plan does not say why this question is different.
- why: The reviewer answers "where does this go?" with a button about fixes. Or they miss the question because the buttons look like the answer.
- fix:
  - Show the two answers only when the agent marks the reply as a proofread, with a flag the contract names.
  - Write one sentence in Task 3.3 on why this question earns buttons: the answer is always one of two.
  - Draw both in the `cardact` register at equal weight, as the conflict card does.
  - Keep the follow-up box, for "only the first fix".

### DR17. The words the quick answers post

- severity: minor
- kind: defect
- where: Task 3.3
- what: The rename is right: "Keep mine" already means something else on the conflict card (`KEEP_MINE_LABEL` in `replay.js`). But the plan does not pin the text each button posts, or what the card shows after.
- why: The agent reads that text as an instruction. Vague text gets a vague result.
- fix: "Use the fixes" posts "Use the fixes you listed. Change nothing else." "Keep my words" posts "Keep my words as written. No changes." The thread shows the reviewer's line exactly as posted. The card says "Waiting on the agent" until it replies.

### DR18. Proofreading questions on notes pages

- severity: minor
- kind: challenge
- where: plan, `PROOFREAD_MIN_WORDS`; brief R11 (proofreading after a long hand-written block)
- what: The threshold fires on `lahe write` notes pages too. Every question jumps to the top of Active with the loudest treatment in the rail.
- why: The brief says the agent organizes notes only when asked. A proofreading question on every long sitting of notes is the opposite of that, and it trains the reviewer to ignore question cards.
- fix: The contract skips the proofreading question on a `lahe write` page unless the reviewer asks for it. This is Ken's call.

### DR19. A reload mid-sitting no longer matches the approved wireframe

- severity: important
- kind: defect
- where: Task 3.4 (the reload specs); wireframe `b3-reloaded`
- what: The wireframe shows the session still open after a reload, with the caret in place and a quiet bar line: "Page reloaded after the agent's rebuild. Your writing is where you left it." The plan does something different in each case:
  - The agent's rebuild waits until the sitting ends.
  - A reload by the reviewer commits the sitting. After the reload the frame is closed, and the reviewer must press Cmd-Shift-E on a run block to keep going.
  - A repaint on a framework page keeps the session open.

  The bar line is in no task.
- why: Ken approved a picture the build will not match, and nobody told him. A reviewer who reloads also sees their writing sitting outside a frame, with no sign of how to carry on.
- fix: List each case under Changes from plan with what the reviewer sees. After a reviewer reload, either reopen the session on its own with the caret at the end of the run, which matches the wireframe, or tell Ken the wireframe changed. If the bar line stays for the repaint case, pin its words. If nothing shows a rebuild is waiting, add a quiet bar line for that too.

### DR20. The card lists every block

- severity: important
- kind: taste
- where: Task 3.2 (the edits row and the card)
- what: The plan shows each new block by type ("Heading: ...", "Paragraph: ..."). A whole post, which the ceiling allows, becomes a card that fills the rail. The wireframe used two lines instead: "New text after 'Then I tried asking...'" and "A heading, 'What the chat window cost me', then 2 paragraphs and a 3-item list."
- why: The card has to be readable at a glance among other cards. A block list pushes everything else off the rail.
- fix: The card and the edits row lead with the wireframe's two-line summary, with counts computed by code. The block-by-block list sits under the card's existing disclosure. When the anchor also changed, the first line reads "Edit of '...' plus new text".

### DR21. The dashed "sent, not yet placed" rule

- severity: minor
- kind: taste
- where: wireframe `05-waiting`; Task 3.2
- what: The wireframe draws a dashed rule on the page beside new text that is waiting on the agent. The plan drops it without saying so. Nothing like it exists on the page today: a committed edit gets the changed-text wash in `highlight.js`.
- why: If a builder adds it from the wireframe, it becomes a second signature on the page, competing with "+ Write here".
- fix: Cut it, and say so under Changes from plan. New text gets the same wash after commit as any edit.

### DR22. The ceiling warning and what happens at the ceiling

- severity: minor
- kind: defect
- where: plan, "Numbers this plan sets"; Task 2.2
- what: The bar warns at 90 percent, with no words given. Nothing says what happens at 100 percent. The helper refuses an oversized record, so a whole sitting could fail after the reviewer finishes. On a notes page, "start a new edit" does not help: a sitting on an outstanding record's blocks continues that record.
- why: The one way this feature can lose a long piece of writing is with no words attached.
- fix: Pin the warning: "This edit is getting long. Press Esc to send it. Once the agent places it, you can keep writing." At the ceiling, the layer stops making new blocks and the bar says why. A record over the ceiling never reaches commit.

### DR23. A placeholder in the empty new block

- severity: minor
- kind: risk
- where: Task 2.3; wireframe `03a-new-block` ("Write here" inside the empty block)
- what: The plan does not say whether the empty block shows a placeholder.
- why: The block is blank, so a builder either shows nothing, or writes placeholder text into the block, where it would leak into the record.
- fix: The layer draws "Start writing" in its own shadow root, over the empty block, and removes it on the first keystroke. It never goes into the page's DOM. Drawing it this way also avoids a page style.

### DR24. The words of the replay notes

- severity: minor
- kind: defect
- where: Task 3.2 ("a wrong-tag note and a 'placed in a different spot' note")
- what: The plan names both notes but gives no words.
- fix: "The agent placed 'What the chat window cost me' as a paragraph. You wrote a heading, so Lahe sent it back." and "'Every draft came back...' is already further down the page, so Lahe did not add it again." Neither note asks the reviewer to act.

### DR25. The dark screenshots will not show dark

- severity: important
- kind: risk
- where: every screenshot line in Tasks 2.1 to 3.3
- what: The layer picks its scheme from the page's own background, not the OS (`highlight.js`). The Lahe Markdown style has no dark mode, and the spike's `blog.html` sets no background. So "dark" screenshots on these fixtures show the light scheme, or dark chrome over a white page.
- why: The dark screenshots Ken asked for would prove nothing.
- fix: Add a fixture page with a dark background and take every dark screenshot there. Draw the new line, the menu, and the placeholder in the frame's accent pair under `data-lahe-scheme`, not in new colors.

### DR26. The Ctrl-Alt digit hotkeys on Windows keyboards

- severity: minor
- kind: risk
- where: "Block-type hotkeys" table; Task 1.5
- what: On Windows, Ctrl-Alt acts as AltGr. On German and Polish layouts, AltGr with 0, 2, or 3 types a closing brace, a superscript two, or a superscript three. Matching Mod-Alt-digit by `event.code` would swallow those characters inside a session.
- why: The reviewer cannot type those characters while writing, and the block type changes instead.
- fix: Skip the chord when `event.getModifierState("AltGraph")` is true, and add a unit case for it.

### DR27. Motion is not specified

- severity: minor
- kind: risk
- where: Tasks 2.2 and 2.3
- what: The plan says nothing about motion.
- fix: The "+ Write here" line fades in with the frame's existing opacity transition, and shows at once under reduced motion. The frame follows new blocks without animating its size. There is no other motion.

### DR28. Narrow windows and the rail

- severity: minor
- kind: risk
- where: Tasks 2.2 and 2.3
- what: Mobile is a non-goal, but a laptop window beside a terminal is narrow. The plan does not say:
  - how the wider bar fits
  - where the menu opens near the bottom of the viewport
  - where the line stops when the rail is open
- fix: The menu opens upward when there is no room below. The line stops at the rail's edge, using the berth property the rail already publishes. The bar drops the hint first when space runs out.

## What already exists

Reuse these rather than drawing new ones:

- **The edit frame and bar** (`src/layer/editing.js`, `FRAME_STYLE`, `buildBar`):
  - the accent and its dark twin
  - the label and hint constants
  - the mousedown guard that keeps the caret in the block
  - the 120ms opacity transition

  The block menu, the write state bar (DR3), and the "+ Write here" line all draw from this.
- **The "More actions" menu** in `src/layer/overlay.js`: `role=menu`, `aria-haspopup`, `aria-expanded`, roving focus, and a close that returns focus. It is the model for the block menu (DR6).
- **The `cardact` button register and equal weighting** from the conflict card in `src/layer/replay.js`. The model for "Use the fixes" and "Keep my words" (DR16).
- **The question treatment** in `src/layer/tab_done.js`: pulled to the top, the accent rule, the follow-up box. The proofreading card keeps all of it.
- **Empty text per tab** in `emptyTextFor` in `src/layer/overlay.js` (DR5).
- **The scheme sampled from the page** (`data-lahe-scheme`, `highlight.js`). Every new drawn element follows it (DR25).
- **The D8 page-level style sheet** in `highlight.js`, the only sanctioned page style. It is the home for the focus-ring rule (DR13).
- **The changed-text wash** in `highlight.js`, which marks new text after commit (DR21).
- **The rail's berth property**, published by the rail for other surfaces (DR28).
- **Reduced-motion checks** in `overlay.js` and `highlight.js` (DR27).
- **The Markdown document style** (`vendor/stclair-doc-style/document.css`). Its h2, h3, h4, and list rules give R4 (new blocks use the page's styling) for free, once blocks are siblings and not nested.

## Not in scope

- **Mobile and touch layout:** a non-goal in the brief. The job happens on a laptop.
- **A gutter "+" or always-visible insert points:** Ken rejected direction C as too busy.
- **Nested lists and indent:** cut in the architecture for this round.
- **Rich paste:** waits on board row `LAHE-rich-paste` (keeping formatting from a paste).
- **Moving the frame and bar's raw hex values onto the rail's tokens:** worth doing, but it is a cleanup of existing code and not this feature's.
- **A slash-command or type-ahead block picker:** the menu, hotkeys, and Markdown shortcuts already give three ways in.
- **Showing proofreading fixes inline on the page before the reviewer accepts:** the card text names each fix. An inline preview can come later if Ken finds the card text hard to judge.
- **A first-run tip that teaches Cmd-Shift-E and "+ Write here":** worth a look once Ken has written a few posts with it. The empty rail copy covers the notes page for now.
