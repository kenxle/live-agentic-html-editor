# Code review: choice buttons (integrated diff)

Reviewer: `feature-dev:code-reviewer` (Opus), on `feat/choice-buttons` at `3abccb7e` against main. Scope: `src`, `test`, `skills`, `vendor`, `docs/CONTRACTS.md`; `dist/` and `docs/features/` excluded. The reviewer had no write tool, so the orchestrator saved its report here verbatim in substance.

**Verdict: no critical findings. Five important ones: two would steer an agent wrong, one is a CSS mismatch with the layer, two are in the tests.**

| # | Finding | File:line | Confidence | Disposition |
|---|---|---|---|---|
| 1 | The contract never says to move `data-chosen`; an agent following it on a changed mind leaves two, and the group goes inert | `src/shared/review_format.js:79`, `COMPONENTS.md:316` | 85 | Accepted: the paragraph says move it, one button only, in all three copies and the catalog |
| 2 | The stylesheet styles only buttons directly inside the group; the layer arms buttons at any depth, so a Markdown block with blank lines renders unstyled and the decision never shows | `document.css:708-782`, `choices.js:87-89`, `replay.js:2845-2847` | 80 | Accepted: the layer refuses a group whose buttons are not direct children, with a chip; the skill and catalog say no blank lines inside the group |
| 3 | The form test cannot fail: the fixture's buttons are `type="button"`, so nothing could submit; the URL is read before any navigation could happen | `test/fixtures/choice-doc.html:29-30`, `choice_buttons.spec.js:641-644` | 95 | Accepted: a submit-default button and a counted `submit` listener, written red first |
| 4 | The skill says never write any `data-lahe-` attribute, which contradicts its own rule to carry `data-lahe-id` | `skills/lahe/SKILL.md:249-250` vs `:619-625` | 80 | Accepted: the skill names the three painted attributes instead |
| 5 | The spec writes screenshots into tracked docs files on every run, leaving main's checkout dirty after the post-merge gate | `choice_buttons.spec.js:46, 371-386, 714-717` | 85 | Accepted: gated behind `CHOICE_SHOTS`, as the style spec already is |

## The findings

### 1. The contract does not say to move `data-chosen`

The contract says to write `data-chosen` onto the chosen button, and that a new press is a new item to undo and redo. It never says to take the old `data-chosen` off. The skill does say "move". The contract is the only text an agent is guaranteed to read. Failure: Ken changes his mind on a handled group; an agent working from review.json adds `data-chosen` to the new button and leaves the old one; on the next load `choices.js` refuses the group ("more than one button carries data-chosen"), draws it dashed with a rail chip, and Ken can no longer press it.

### 2. The stylesheet and the layer disagree on which buttons belong to a group

`document.css` uses `.choice > button` and `:has(> button…)`; `choices.js` and `replay.js` use `querySelectorAll("button")`. An agent that puts blank lines between the buttons in a Markdown file ends the HTML block at the blank line, and each button line becomes `<p><button></p>`. The layer arms the group and presses work; the stylesheet draws plain browser buttons with no badge and no fill; the `data-chosen` "Done" rule never matches, so the decision quietly fails to show with no Lahe running (R17). Nothing tells the agent.

### 3. The form test proves nothing about preventDefault

Both buttons in the `inside-form` group are `type="button"`, so the form can never submit whatever the layer does. Delete `preventDefault` from `choices.js` and V8's form case still passes.

### 4. The skill contradicts its own stamp rule

"Never write an attribute that starts with `data-lahe-`" sits in the same skill that tells agents to write `data-lahe-id`, as the contract does. An agent that read the choice section refuses or skips carrying a stamp.

### 5. The browser spec dirties tracked files on every run

Every run of the browser suite overwrites three screenshots under `docs/features/.../progress/`. CLAUDE.md asks for `npm run gate` on main after each merge, so main's checkout ends up with uncommitted changes, the state that blocks Ken. The sibling `choice_style.spec.js` already gates its shots behind `CHOICE_SHOTS`.

## Below the bar (checked, not filed)

- A refused choice event stays in the outbox, because `CHOICE_REFUSED` is not in `RUN_REFUSAL_CODES` (`sync.js:1889`). It cannot happen today: the layer runs the same `validateChoice` before storing.
- `reply.seen` and Mark as done on a choice item can wait up to 10 s while a press hold is running (`isChoiceEvent` matches by item id). That fits the architecture's "every queued event of a choice item".
- An archived thread round on a choice keeps only `note` and `change`, not the earlier answer (`record.completedRound`).
- The drain paragraph of the contract still says "note and change stay at the top level" and does not mention `choice`. (Fixed by the orchestrator in the same round as finding 1.)
- `choice_kernel.test.js:279` has a dead `if (line === null) return;` guard.

## Checked and clean

1. **Grammar at the door and at projection.** `log.js:532` and `projection.js:172` both run `validateChoice` on every record-carrying event; every write into a review's log goes through `log.append`; the tests cover ten forgeries at both checkpoints.
2. **The click gate.** Off a document page `onClick` returns early and `arm` writes nothing; the `pointerdown` snapshot on the window's capture phase catches pick mode and an open edit before they close; present, read-only and edit state are refused; `defaultPrevented` is respected; only `page_routes` adds the document attribute, and a test pins that `add.js` and `heal.js` never do.
3. **The press hold.** 3 s quiet window and 10 s cap; non-choice events never held; hide and leave flush at once; Hold's gate checked before the split; unit tests with a mocked clock.
4. **The anchor rung.** Runs first, only for refs with `kind: "choice"`; one match binds; zero or two refuse with their own codes; never falls to text search. (The orchestrator's integration run found one gap the reviewer did not: the rung read `record.KIND` where the anchor engine spec mounts the engine without the record module; a one-line guard fixed it.)
5. **Replay.** Writes nothing to the page for the kind; paints the two state attributes inside a write epoch and clears stale paint; handled records never marked lost.
6. **The drain line.** Under `page` only path, quote and `context.heading`; `choice` at the top; unit and end-to-end tests.
7. **The stylesheet.** No pills, no single-edge color, no shadows; every token defined; every selector works apart from finding 2.
8. **Leaks and the real state folder.** Temp state folders throughout; helpers stopped in `afterEach`, including the restarted detached helper in the program-down test; nothing touches `~/.local/state/lahe`.
