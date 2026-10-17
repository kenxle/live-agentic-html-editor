# Choice buttons: in progress, nothing waiting on you

**Where it stands.** The crucible is closed, the brief is written and its PM review is folded in, and the architecture is written and going to an architect review now. The plan and the build come next. You said you do not need to be asked, so nothing here waits on you; comment anywhere if you want a different call.

**What you will notice first.** The lesson queue rebuilt with real buttons, served with the rail live, before any PR gate.

Updated 2026-10-17 13:36.

## The documents

- [The crucible summary](00_crucible_choice_buttons.md), and [the questions page](00_crucible_questions.md) with your edits.
- [The brief](01_brief_choice_buttons.md): nineteen requirements, the PM review's twelve findings folded in. [The review prose](01_brief_choice_buttons_reviews.md).
- [The architecture](02_architecture_choice_buttons.md), with [the alternatives](parts/architecture/alternatives.md) it rejected. The standing [architecture doc](../../ongoing/ARCHITECTURE.md) already names the sixth record kind and D3's one exception.
- The plan: not yet written.

## Decisions made without you

Each one is yours to overrule.

- **A click is a commit.** No draft, no Cmd-Enter. Changing your mind before the agent answers is the same reword path a comment uses.
- **A press after the agent handled the group is a new thread.** The agent undoes the old answer where it can, does the new one, and says both.
- **The decision lives in the file.** Handling a press includes the agent writing `data-chosen` onto the group in the source, so the page shows its decisions with no Lahe running.
- **Presses close together travel together.** A short quiet window, then one flush and one wake, so clearing nineteen lessons is not nineteen wakes.
- **A broken group is shown to you, not reported to the agent.** It draws as plain content and the rail names it. An automatic message to the agent is deferred.
- **Only pages the Lahe program serves itself carry live groups.** The program marks its own pages; a dev-server page never gets the mark, so the layer claims no click there.
- **No page-level "all as recommended" switch.** An agent that wants one writes one more group.

## Progress

- 2026-10-13: crucible round 1 on a page; held on your word until the standard docs existed.
- 2026-10-17: hold lifted; round 2 with premises and approaches; you picked B and rewrote the job and the user in your words.
- 2026-10-17: brief written; PM review returned twelve findings, no blockers; eleven accepted, one accepted in part.
- 2026-10-17: architecture written; `docs/ongoing/ARCHITECTURE.md` amended first, as its rule requires.

## To delete at cleanup

Nothing yet.
