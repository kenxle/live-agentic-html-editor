# Rail cleanup: what shipped on 2026-10-12, and what to delete

## Shipped to main, each with a green CI run and a green full local gate

| PR | What |
| --- | --- |
| #49 | Head reads "Lahe", status dot with shapes and an instant tip, keyboard shortcuts panel, Export and View menu groups, Hold button, note label, Send on drafts |
| #50 | Ken's wording for the status dot's first lines; a click copies the hand-off message |
| #51 | Helper-down red octagon and restart message, "Message copied" note, card morph, fly-out gap fix |
| #52 | No Edits tab: hand edits live in Active with an All/Comments/Edits filter and a search box; x to delete a card; shortcut wording |
| #53 | Thread cards redesigned as a chat: reviewer on the right, agent on the left, one caption style, files under a hover on the agent's name, "1 new" clears once the card is opened |
| #54 | A long quoted passage opens out on a click; darker quote bar on cards and on the toast's page reference; grey agent bubbles |
| #55 | The kind filter is one button beside the search box, on Active and Done; the style dropdown links to the Lahe Styles page when only International is installed |
| #56 | Mark as done: the reviewer closes an outstanding card from its state chip; the helper records an explicit close at the item's revision |
| #57 | Two specs updated for the chip menu that #56 put inside every outstanding card |

Mark as done needs the helper restarted (`lahe serve --restart`) before a close is recorded. The rail side works after a reload.

## To delete at cleanup

Worktrees under `.claude/worktrees/`, all merged:

- `rail-cleanup` (branch rail-cleanup-3, superseded)
- `rail-r4` (branch rail-cleanup-5)
- `rail-cleanup-6`, `rail-cleanup-7`, `rail-cleanup-8`, `rail-cleanup-9`, `rail-cleanup-10`
- `agent-a42f70013754785a5` (branch remove-edits-tab)

Inside those worktrees: `test-results/` folders, `node_modules` symlinks, `.claude-pr-body.md` files, and `.claude-commit*` files.

Screenshots the gate rewrites on every run (restore with `git checkout --`, do not commit):

- `docs/features/20260922.02_linked_docs_rail/linked_page_rail.png`
- `docs/features/20260923.01_rebuild_not_the_agents_job/card_not_on_page.png`
- `docs/features/20261012.01_rail_cleanup/mark_done_light.png` and `mark_done_dark.png`

Maybe: `docs/features/20261012.01_rail_cleanup/capture_reference.png` and `capture_reference_open.png`, which the capture regenerates and which the mockup does not use.

Not mine, left alone: `test/browser/tmp_image_pick.spec.js` and the two free-writing progress docs in the main checkout.
