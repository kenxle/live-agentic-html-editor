# Choice buttons: working on a preview, the full gate is running

**Where it stands.** The feature is built, reviewed, fixed and merged on `feat/choice-buttons`. The whole loop passes by script, and the lesson queue takes a press through the branch's own helper. The full gate is running on the final commit now; after it and the three-browser run, the PR opens and merges, then your helper and skill are brought current.

**Try it now.** [The lesson queue with real buttons](http://personal.docs.features.20261012-01-forge-international-style.lahe.localhost:1484/02_lesson_queue.md) is served by the branch's helper on its own port, against a copy of your Lahe data. Click an answer on any lesson: it paints, the card appears, and the state goes Open once stored. No agent is listening to that copy, so nothing answers there; the real one will once this lands.

**What you will notice first.** The lesson queue rebuilt with real buttons, served with the rail live, before any PR gate.

Updated 2026-10-18 11:57.

## The documents

- [The crucible summary](00_crucible_choice_buttons.md), and [the questions page](00_crucible_questions.md) with your edits.
- [The brief](01_brief_choice_buttons.md): nineteen requirements, the PM review's twelve findings folded in. [The review prose](01_brief_choice_buttons_reviews.md).
- [The architecture](02_architecture_choice_buttons.md), with [the alternatives](parts/architecture/alternatives.md) it rejected. The standing [architecture doc](../../ongoing/ARCHITECTURE.md) already names the sixth record kind and D3's one exception.
- [The plan](03_plan_choice_buttons.md): two workstreams (core, style-skill), one PR, the verification table V1 to V24. [The plan review](03_plan_choice_buttons_reviews.md).

## Decisions made without you

Each one is yours to overrule.

- **A click is a commit.** No draft, no Cmd-Enter. Changing your mind before the agent answers is the same reword path a comment uses.
- **A press after the agent handled the group is a new thread.** The agent undoes the old answer where it can, does the new one, and says both.
- **The decision lives in the file.** Handling a press includes the agent writing `data-chosen` onto the chosen button in the source, so the page shows its decisions with no Lahe running.
- **Presses close together travel together.** A short quiet window, then one flush and one wake, so clearing nineteen lessons is not nineteen wakes.
- **A broken group is shown to you, not reported to the agent.** It draws as plain content and the rail names it. An automatic message to the agent is deferred.
- **Only pages the Lahe program serves itself carry live groups.** The program marks its own pages; a dev-server page never gets the mark, so the layer claims no click there.
- **No page-level "all as recommended" switch.** An agent that wants one writes one more group.
- **The wake count is accepted and measured, not engineered away.** Making `lahe monitor` wait for a quiet spell would cover comments too and changes a loop every host shares, so that is a board row for you rather than part of this feature.

## Changes from plan

Each was made by a builder or by me during integration, and each is written into the architecture.

- **Off a document page the layer writes nothing at all**, not even the inert mark. A page someone else serves keeps its DOM byte for byte.
- **A press checks the page's state at pointerdown.** Leaving an open edit or picking an element both finish before the click arrives, and without this those clicks became presses.
- **Two more refusals:** two buttons sharing a value, and more than one button carrying `data-chosen`.
- **Pressing the same answer again does nothing** while the press is waiting or the agent has asked a question.
- **A reword is one ready write** at the next revision, not a draft in between; there is nothing to type.
- **The group's word for a refused press is Open**, not "Not handled": main's PR #75 moved the rail to the brand's three thread states while this was being built, and the group follows its own card. The attribute keeps `not_handled` underneath.
- **The drain line carries `reviewer_last_changed_at`**, as every drain line does; the architecture's example left it out.
- **Files outside the plan's list:** `src/shared/failures.js` (four codes), `src/layer/listeners.js` (a listener group), `test/unit/remount_contract.test.js`, two short paragraphs in `docs/CONTRACTS.md` under the gestures and the script tag.

## Progress

- 2026-10-13: crucible round 1 on a page; held on your word until the standard docs existed.
- 2026-10-17: hold lifted; round 2 with premises and approaches; you picked B and rewrote the job and the user in your words.
- 2026-10-17: brief written; PM review returned twelve findings, no blockers; eleven accepted, one accepted in part.
- 2026-10-17: architecture written; `docs/ongoing/ARCHITECTURE.md` amended first, as its rule requires.
- 2026-10-17: architect review: fourteen findings, all accepted. The one blocker: the group attribute was under the `data-lahe` prefix the tool strips from captured markup; it is now `data-choice`. The wake story was wrong and is corrected: the monitor's poll is what bounds wakes, and the count is measured rather than promised. A possible monitor quiet spell is on the board for you (LAHE-monitor-quiet-spell).
- 2026-10-17: plan written; Step 0 (shared names, manifest, contract rows, fixtures) committed on `feat/choice-buttons`. One unit test failed on it (the list of kinds); fixed in the next Step 0 commit.
- 2026-10-17: plan review: sixteen findings, four blockers, all folded in; builders dispatched. Ken caught a hand-written timestamp on this page that was ten minutes ahead; the timestamp now comes from the shell clock.

## To delete at cleanup

One batch, at your go, by the orchestrator. Nothing here is removed before that.

- The worktree `~/Documents/workspace/lahe-worktrees/cb-layer` and its branch `feat/cb-layer`: cut for a separate layer builder before the plan review folded the kernel and layer into one core builder. Never used.
- The builder worktrees `~/Documents/workspace/lahe-worktrees/cb-kernel` (branch `feat/cb-core`) and `cb-style` (branch `feat/cb-style`), and the feature worktree `choice-buttons` (branch `feat/choice-buttons`), once the PR is merged.
- Three `.claude-commit2026101714*-core` files in the cb-kernel worktree root, and `test-results/` folders in the builder worktrees.
- `~/Documents/lahe-choice-preview/`: the copied state folder (346 MB), the preview helper's log, the eval home, the walk's work folders, and the preview copy of the lesson queue, once you have looked at the preview. The preview helper (port 7819) is stopped first.
- `.claude-pr-body-choice-buttons.md` in the main checkout (ignored by git).
