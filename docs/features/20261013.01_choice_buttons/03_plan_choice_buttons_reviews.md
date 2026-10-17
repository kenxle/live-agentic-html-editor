## Plan Review (Round 1)

Reviewer: review-plan (orchestration and test plan). Read: the plan, the brief, the architecture and its review, CLAUDE.md, the menu bar plan, feature-forge `agent-contracts.md` and `implementation-slices.md`, the Step 0 commit `d6e08e0b` on `feat/choice-buttons`, and the code each ownership claim names.

**Short version.** The plan's shape is sound: one PR is the right call, the verification table maps every requirement, and the Step 0 idea (write shared names first) is good. Four things stop it working as written:

- The layer cannot run a single browser row until most of the kernel has landed, but the plan runs them side by side and treats the kernel as needed only "for the final run".
- `planned: true` keeps `choices.js` out of the bundle, and the layer builder is forbidden to remove it.
- The stylesheet cannot draw the chosen button from `data-chosen="<value>"` on the group. CSS cannot compare one attribute's value to another's.
- The lesson-queue preview (the row that proves the lesson queue works with real buttons) uses the bundle-copy trick, which cannot carry the helper-side changes this feature needs.

Step 0 as committed also turns the unit gate red, though the progress page says it is green.

---

### F1. The layer depends on the kernel for nearly every browser row, not just the final run

```
severity   blocker
kind       defect
area       orchestration
where      Workstreams and PRs table, layer row "Depends on" (plan line 146); Summary diagram (lines 13-22)
what       The layer's browser spec cannot pass any of V2 to V8, V11 or V22 until kernel Tasks 1.1 and 1.3 are on its branch, so "parallel" means the layer builds blind for its whole run.
why        Each of these is a hard dependency in today's code:
           - record.newItem copies a fixed list of fields and drops `choice` (src/shared/record.js:1013-1050). A press cannot be minted with its intent until Task 1.1 lands.
           - The layer arms groups only when the tag carries `data-lahe-document`. Only Task 1.3 makes the helper write it (src/service/page_routes.js:116-117 returns null today when the tag is already there, so even that path needs the change). The harness's own tag builder has no such option (test/browser/support/with_layer.js scriptTagFor).
           - The click decision is gestures.gestureFor(input). Its input fields are a fixed list (src/shared/gestures.js:225-243). PRESS_CHOICE needs new fields: in an armed group, document page, may write, presenting, block open. Step 0 named the outcome but not those input field names. The layer writes the caller and the kernel writes the rule, so the two can disagree.
           - merge.js must list `choice` as browser-owned before a reload test (V5) can pass.
           The result is a layer builder that either stubs the kernel (and is then tested against its own stub), or edits kernel files (a merge conflict), or waits.
fix        Pick one and write it into the plan:
           (a) Recommended: one "core" builder (Opus) does kernel Tasks 1.1 and 1.3, then the layer tasks, then Task 1.2, in one context. It already has to read record, merge and gestures to use them. Build the thin end-to-end path first, as implementation-slices.md asks: tag attribute, arm, press, record, door, drain line. Then states, hold and card.
           (b) Keep three builders but sequence them: kernel 1.1 and 1.3 first, merged to the feature branch; then dispatch layer; kernel 1.2 runs alongside layer.
           Either way, Step 0 (or the kernel's first commit) names the gestureFor input fields, and the layer spec runs against a real helper (`lahe review` on choice-doc.md), not with_layer.js, so the browser-to-door seam is exercised.
```

### F2. `planned: true` keeps choices.js out of the bundle, and nobody may remove it

```
severity   blocker
kind       defect
area       orchestration
where      Step 0 "Manifest" (line 30); Every builder's contract "Never edit ... src/shared/manifest.js" (line 39)
what       The build skips planned entries, so the layer builder's local bundle never contains choices.js, and the builder is forbidden to clear the flag.
why        manifest.builtFiles() filters out `planned: true` (src/shared/manifest.js:385-389), and scripts/build-layer.js:44 builds only builtFiles(). Every browser spec loads dist/lahe-layer.js (test/browser/support/with_layer.js:51, and the helper serves the same file). So Task 2.1's spec runs against a bundle with no choices.js in it, and V2 to V8 fail for a reason that has nothing to do with the code. The Step 0 commit (d6e08e0b) does carry `planned: true`.
fix        Give the layer builder explicit authority to remove `planned: true` from that one entry in its first commit, and say so in its packet. Or have the orchestrator commit an empty choices.js (one line that registers the namespace) in Step 0 and drop the flag. State in Task 4.1 that integration checks the flag is gone before the dist rebuild.
```

### F3. CSS cannot draw the chosen or pressed button from a value on the group

```
severity   blocker
kind       defect
area       test plan
where      Task 3.1 (line 107); V14 (line 175); V6 (line 167); V23 (line 184); architecture "The component" (02_architecture line 49) and "State on the page" (lines 86-89)
what       The architecture puts `data-chosen="promote"` and `data-lahe-pressed="promote"` on the group, and the stylesheet is meant to fill the matching button. No CSS selector can match a button whose `value` equals an attribute on its parent.
why        CSS has no attribute-to-attribute comparison, and :has() does not add one. The style-skill builder can only (1) write one rule per possible value, which is impossible with agent-chosen values, or (2) draw the whole group as decided without showing which answer. V14 (decided with no script) and R17 (the page shows the chosen answer with no Lahe) cannot pass. The pressed state in V6 and V23 has the same problem unless the layer also marks the button.
fix        Move the marker to the button. The agent writes `data-chosen` (no value) on the chosen `<button>`. The layer paints `data-lahe-pressed` on the pressed button and keeps `data-lahe-choice-state` on the group. Update the architecture's component block and state table first (CLAUDE.md: the doc changes before the code), then Step 0's names, Task 2.1's validation (at most one `data-chosen` button), Task 3.1's rules, the skill text and the contract paragraph. V14 then asserts a computed style on the chosen button, for example its background is the ink colour.
```

### F4. The lesson-queue preview cannot work by copying the bundle

```
severity   blocker
kind       defect
area       test plan
where      Task 4.3 (line 131); V17 (line 178); acceptance "The lesson queue works with real buttons on Ken's machine before the PR opens" (line 211)
what       Swapping main's dist/lahe-layer.js for the integration build gives Ken the new layer on his old helper, and his old helper never writes `data-lahe-document`, so no group arms.
why        This feature changes the helper: page_routes.js (the attribute), log.js (the door check), projection.js and status.js (the drain line). The memory note this rule comes from says the bundle copy is "only for the layer ... a helper-side change still needs the merge". The acceptance criterion cannot go green this way.
fix        Use the pattern from the menu bar plan's Task 4.3. Run the feature branch's helper on another port against a copy of Ken's state folder, with every `ss_*.json` pid removed and every `monitor.json` blanked. Reach it with `lahe review --port <n> --state-dir <copy>`. Keep real-data screenshots outside the repo. Change V17 from "screenshot light" to a bar that can fail: every group arms, a press shows `open` in the rail, and a stand-in agent's handled reply turns it `done`.
```

### F5. Step 0 turns the unit gate red, and the progress page says it is green

```
severity   important
kind       defect
area       orchestration
where      Step 0 "The names, written once ... Names only, no behavior" (line 28); 04_progress_choice_buttons.md line 36
what       Adding `KIND.CHOICE` is behavior: KINDS grows to six, and test/unit/record_lifecycle.test.js:170-172 asserts exactly five.
why        I ran that file on feat/choice-buttons: "not ok 8 - the kinds are exactly D4's closed list", 63 pass, 1 fail. All three builder worktrees are cut from this commit (cb-kernel and cb-layer sit at d6e08e0b). Each builder's first gate:unit is red. The contract says "do not report back red", so each may "fix" the same line in a file only the kernel owns. KINDS growing also means newItem and validateItem now accept a choice record with no checks until Task 1.1 lands. That is harmless on a feature branch, but it is not "names only".
fix        Orchestrator updates that assertion in Step 0 and re-runs gate:unit before dispatch, then corrects the progress line. Say in Step 0 that KIND.CHOICE opens the door to unchecked choice records until Task 1.1, which is acceptable because nothing lands on main before the PR.
```

### F6. No row proves the whole loop, and no task walks it

```
severity   important
kind       risk
area       test plan
where      Test List (lines 160-184); Step 4 (lines 119-139); summary diagram node "walkthrough" (line 21); standard acceptance "Every requirement in the brief walked end to end" (line 194)
what       Nothing proves the architecture's main flow end to end: press, drain line, the agent replies handled and writes the marker into the source, rebuild, the page shows done, then a fresh load with no Lahe shows the decision.
why        Every row tests one hop. V3 stops at the record, V9 tests the drain line in a unit test, V6 seeds reply states, and V14 hand-writes `data-chosen` into a fixture. A break at any seam would pass all of them: for example, the minted record failing the door check, the drain missing the item, or the rebuild losing state. The plan's diagram names a walkthrough, but no task does one. CLAUDE.md's routing asks for flow walking before the PR for changed workflows.
fix        Add V24 (B, at integration). Run `lahe review` on choice-doc.md with a real helper. Press two groups within 3 seconds. Read `lahe status --json` and assert one post carried both, and each line has `choice` at the top level. Run `lahe reply handled` on one, write the marker into the .md, wait for the rebuild, and assert `done` from the record. Stop the helper, serve the built HTML with no tag, and assert the decided look. Then add Task 4.6, a walkthrough of R3 to R17 on the integrated build, run before the PR. Name its owner, either the requirements-check agent from Task 4.1 or a flow walker.
```

### F7. Two agents write the agent-facing words for one workflow

```
severity   important
kind       risk
area       orchestration
where      Task 1.2 (contract paragraph, line 61) in kernel; Task 3.2 (skill section, line 113) in style-skill; Models bullet (line 149)
what       The contract paragraph and the skill section describe the same thing: how a press appears, how to answer it, and the write-back. The plan gives them to different builders who never see each other's text.
why        CLAUDE.md says the skill and the contract travel together. Ken named the agent writing the page as the user who matters most. Two authors writing in parallel will word the write-back and the reply differently, and the fix-round reviewer has to reconcile them.
fix        Give all agent-facing words to style-skill: the skill section, the contract paragraph in review_format.js's contract array, its copies in test/unit/review_format.test.js and docs/CONTRACTS.md, BRAND.md and STYLE_GUIDE.md. Kernel keeps PROJECTED_FIELD_CLASS and projectItem in review_format.js. Those are different hunks, so name both owners of that file in the table. With the words gone, the kernel is mechanical against a complete spec. If it stays its own builder (option b in F1), it fits Sonnet, per the budget policy. If it merges with the layer (option a), the question goes away.
```

### F8. Running install-skills from a builder worktree overwrites Ken's live skill

```
severity   important
kind       risk
area       orchestration
where      Task 3.2 "Run npm run install-skills and confirm the catalog copy ships" (line 113); V15 (line 176); V16 (line 177)
what       install-skills writes to ~/.claude/skills/lahe/SKILL.md and ~/.agents/skills/lahe/SKILL.md (scripts/install-skills.js:50 and the line above it). Only the Stop hook is skipped in a worktree (line 248).
why        Every agent Ken runs today would then read a skill that teaches choice groups, while his helper and layer cannot arm them. That is the exact failure the one-PR rationale (line 153) exists to prevent.
fix        In Task 3.2, V15 and V16, run it with a temporary home: `HOME=<temp dir> npm run install-skills`. os.homedir() honours HOME. Check `references/components.md` there, and point V16's agent at that copy. The real install stays in Task 4.5, after the merge.
```

### F9. V12's wake count has no model and no red line, and the chosen pace never uses the hold

```
severity   important
kind       defect
area       test plan
where      Task 4.2 (line 127); V12 (line 173)
what       measure_one_comment.js runs in process with no clock and no agent (its header, lines 4-15), so "the number of monitor wakes" has no defined value. At one press every 8 seconds the 3-second hold never batches two presses.
why        Wakes depend on the monitor's 15-second poll and on how long the agent works between drains. Without a stated agent cycle the script can print any number, and R13 ("a handful of wakes at most") cannot be called red. The 8-second pace is honest, but say outright that V12 does not test the hold, so no one reads it that way. V10 is the hold's proof. The comment arm is also open to rigging: a long comment makes presses win trivially.
fix        Name the model in the plan: presses every 8 s; monitor polls every 15 s; a simulated agent drains on wake and works for W seconds (state W, for example 60) before it re-arms. Name the red line: press wakes are at most comment wakes, and at most the session length divided by W, plus one. Use the real lesson queue page from Task 4.3, as R15 says. For the comment arm, use the shortest realistic comment, the answer word alone ("promote").
```

### F10. Files the feature must change that no workstream owns

```
severity   important
kind       defect
area       orchestration
where      Workstreams and PRs "Owns" column (lines 145-147); architecture files table
what       Several files the V rows depend on are in no workstream, and one is marked optional when it is required.
why        Each of these would otherwise be found at the stitch:
           - src/layer/tab_done.js: the Done row's text is chosen per kind (lines 1247, 1772). V4 asserts "the Done tab keeps the earlier decision". Unowned.
           - src/layer/overlay.js: KIND_LABEL (lines 318-324) has no "choice", so the card says "choice" in lowercase. The card summary (around line 2014) picks the quote and never the answer. Task 2.1 lists overlay.js "only if the chip needs a style". It is required.
           - docs/ongoing/STYLE_GUIDE.md:301 says "A choice for the reader is option cards". Agents and the style-skill builder read that, and it contradicts the new component. Unowned.
           - test/browser/support/with_layer.js and test/helpers: if any spec mounts the layer without the real helper, the tag builder needs a document option. Unowned.
           - The human-readable copy-and-export formatter in review_format.js (kernel's file) is not mentioned. Copying a review that holds a choice record is untested.
fix        Add tab_done.js and overlay.js (label and summary) to layer's Owns and Task 2.3. Add STYLE_GUIDE.md to style-skill (or to the words owner from F7). Either say every layer spec uses the real helper, or give the harness change to the layer. Add one line to Task 1.2: export text for a choice prints the question and the answer.
```

### F11. The PRESS_CHOICE table row puts a new hint on every page's rail

```
severity   important
kind       risk
area       test plan
where      Task 1.3 "gestures.js gains the PRESS_CHOICE row" (line 67); Summary "Nothing on screen changes" for kernel (line 7); V1 / R3 (line 162)
what       Every row in gestures.TABLE becomes a hint line in the rail. The source says so (src/shared/gestures.js:51-53), tab_active.js:505 renders hintLines() unfiltered, and regions_gestures.test.js:181-184 requires one hint per row.
why        A dev-server page, or a page with no groups, would gain a "click an answer" hint. That breaks R3 (a page with no groups is unchanged) and the kernel's "nothing on screen changes". No row checks it.
fix        Decide in Task 1.3. Either the rule lives in gestureFor with no TABLE row (then adjust the stub-vocabulary and hint-count tests on purpose), or the row is filtered out of hintLines() unless the page has an armed group. Add to V1: on a page with no groups, the rail's hint list is unchanged.
```

### F12. Name how V10 and V20 are built so each can be called red

```
severity   minor
kind       defect
area       test plan
where      V10 (line 171); V20 (line 181)
what       V10 says "splitForFloor holds", but splitForFloor is a closure inside createSync (src/layer/sync.js:1386, 1943) and is not exported. V20 says "U or B".
why        A builder may export splitForFloor just to test it, and so test the function rather than the posting. The real risk is that held events wait for the next poll instead of posting at 3 seconds, because nothing re-arms the flush timer. "U or B" lets the builder skip the unit half. anchor's unit tests use a fake DOM that answers five questions (test/unit/anchor_engine.test.js:5-10). A rung written with querySelectorAll passes in Chromium and cannot be unit tested.
fix        V10: drive createSync with node:test mock timers, as test/unit/draft_flush_cadence.test.js:66 does. Assert the post happens at 3 s after the last press with no other trigger, at 10 s under steady pressing, and at once on tab hide. V20: make it U against the fake DOM. Say the rung walks elements with the engine's own walker and reads attributes. It never uses querySelectorAll or builds a selector from the group name.
```

### F13. V16 needs the layer's validation, which the style-skill builder does not have

```
severity   minor
kind       defect
area       test plan
where      Step 3 step test (line 117); V16 (line 177)
what       "Every group passes Task 2.1's validation" can only run once choices.js exists, which is the layer's branch.
why        The style-skill builder would judge by eye, or copy the rules, and the row would read green without the real check.
fix        Move V16 to Step 4 on the integrated build: load the agent's page through the helper and assert every group arms, with no inert groups and no chip. Let the style-skill builder check its CSS by setting state attributes by hand on a static fixture, and say so in Task 3.1.
```

### F14. Architecture failure modes with no row

```
severity   minor
kind       defect
area       test plan
where      Test List; architecture "Failure Modes" (02_architecture lines 160-174)
what       Keyboard (Enter and Space press a button) and print (a decided group prints its decision) have no row. V22 does not check that the dev-server page shows no chip and no inert marker.
why        The gestureFor keydown branch runs before the click branch. A keyboard press is a real path and is untested. The architecture says a page without the attribute is "inert and chip-less", but V22 only checks the click.
fix        Add a keyboard press to V3: focus a button, press Space, and a record is minted. Add `page.emulateMedia({ media: "print" })` to V14. Add to V22: no chip, and no `data-lahe-inert`.
```

### F15. V21 compares against a count taken hours earlier

```
severity   minor
kind       defect
area       test plan
where      Step 0 "Starting counts" (line 32); V21 (line 182)
what       Ken's other sessions start and stop helpers between Step 0 and the final run, so "equals the Step 0 count" can fail or pass by chance.
why        It is not a test of this feature's teardown.
fix        Make V21 the suites' own checks (scripts/no_stray_helpers.js and the browser global teardown) passing, plus each builder's before-and-after count around its own runs. CLAUDE.md already asks builders for those counts.
```

### F16. Step 4 never runs the three browser lanes, and the merge order is unnamed

```
severity   minor
kind       defect
area       orchestration
where      Task 4.1 (line 123); Test List header "three lanes at the checkpoint" (line 158)
what       Task 4.1 runs `npm run gate` (Chromium only). No step runs `gate:all`, and "merge the three branches" gives no order.
why        The table promises three lanes that nothing runs. CLAUDE.md lets slow checks run after the merge, which is fine, but the plan should say which.
fix        Name the order: core (or kernel), then layer, then style-skill, with gate:unit after each merge. Then rebuild dist and run `npm run gate` before the PR. Run `gate:all` either before the PR or right after the merge on main, and write which.
```

---

### Things checked and found sound

- **Requirement coverage.** R1 to R19 each map to at least one V row. R13 maps to V6, V10 and V12, with the gaps in F9. R17 maps to V14, with F3 and F6.
- **The one-PR decision is right.** The kernel alone adds a kind with no producer, the style alone is inert, and the skill alone teaches dead buttons. With F11 fixed, nothing in the PR is visible on a page without groups.
- **Load order.** Step 0 put choices.js after sync.js and before comments.js. That matches both the plan and the architecture's corrected dependency list, as long as choices.js takes replay and comments as handles from index.js rather than by name.
- **Dispatch contract.** The builder block covers the no-removal rule near the top, worktrees, gate scope, the leak rule, escalation and the progress file. The packet sources are named per workstream.
- **Token cost.** Three Opus builders is defensible for the layer and for the agent-facing words. The kernel, once the contract paragraph moves out (F7), is a complete spec and fits Sonnet. Option (a) in F1 removes it as a separate agent altogether.

### To delete at cleanup

Nothing from this review.
