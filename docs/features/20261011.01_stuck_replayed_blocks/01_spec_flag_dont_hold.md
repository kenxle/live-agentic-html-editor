# Flag, don't hold: spec

## Needs your call

Nothing open. Building.

## Decided

- **Whetstone, not the full forge.** You approved this size.
- **No flag, no Reopen, nothing new on the card.** You: "the user just wants to write comments and have things work like a normal doc. they don't understand that things can be different between the browser and the file." So once the agent has answered a card, the page simply shows the file. If you want something changed again, you edit or comment again, as in any document.
- **The cost, accepted:** if a rebuild quietly drops something the agent had placed (your bold, a paragraph), the tool no longer puts it back or asks the agent. You see the page as it is and can edit it again.

## Problem, user, and context

You review a document while an agent edits its source. Sometimes you ask the agent to reshape text you wrote, for example by turning loose lines into a table. The browser then decides your words are missing, reopens the old card, and writes your old words back into the page. If the agent refuses the reopened card, the browser keeps writing them back on every repaint. The page and the file never agree again. The full trace is in [the diagnosis](00_diagnosis.md).

Your direction: the tool holds the line too hard on words you wrote. Often you want them rewritten. And the page should behave like a normal document, without showing you that the browser and the file can differ.

The new rule: **the page differs from the file only while an edit is waiting for the agent's first answer.** After the agent answers, the page is the file.

## Requirements

1. **Refused cards are not written onto the page.** Replay skips a card in `not_handled`. Your words stay on the card with the agent's reason. Editing that passage on the page again starts a new card, as in a normal document; it does not overwrite the refused one. Replying from the refused card's box makes it `ready` again, and replay writes it as usual.
2. **The page check stops reopening handled cards over your words.** When a handled card's words, blocks, tag, bold or italic, or take-back are no longer on the page, the check does nothing: no reopen, no write, nothing on the card, and the agent is not woken.
3. **Nothing new is shown.** No badge, note, or button is added to any card for this.
4. **Older stuck cards stop showing.** A card already reopened by the page check and then refused falls under requirement 1 (refused cards are not written), so the hackathon case clears on the next reload.
5. **The stamp round is unchanged.** When the words landed but the `data-lahe-id` stamp did not reach an HTML source, the check still reopens the card for the agent. That exchange is between the tool and the agent, not about your words, and it writes nothing new onto the page.
6. **Agents are told the new rule.** The skill no longer says a handled edit comes back when the page loses it. If the contract needs a sentence too, all four copies change together.

## Approach

There is one design call: this changes decision D7's practice of replaying every open card. The case for it is in [the diagnosis](00_diagnosis.md) under "Why does replay let the page differ from the file?" and option H. The architecture doc is history and is not rewritten. The living docs change instead.

- **Requirement 1 (refused cards not written).** Replay's gate in `applyRecord` uses `record.isOutstanding`, which counts `ready` and `not_handled`. Replay gets its own predicate that counts only `ready`. The rail's open count keeps using `isOutstanding`. The empty-page check (`editing.js`, start-of-container) uses the new predicate, so a notes page whose only run was refused still opens ready to type. A refused card is still listed for you; it's just not drawn into the page.
- **Requirement 1, the edges (from the architecture review).** On the skip path, replay clears any conflict and any lost stamp the record carried (`forceClearConflict`, `clearLost`), so a refused card doesn't keep a stale conflict or a stale lost state in `review.json`. Keep mine on a refused card's conflict commits it to `ready` instead of writing once. `itemFor` and `withdrawable` in `editing.js` skip `not_handled` records, so typing into that passage starts a new card instead of overwriting the refused card's words with the page's.
- **Requirements 2 and 3 (no reopen, nothing shown).** `runRevertCheck` in `src/layer/index.js` asks `replay.revertedHandledEditIds` which handled cards to reopen. The check keeps only the stamp reason (requirement 5, the stamp round). The other reasons and their notes (reverted, missing, formatting, tag, take-back) become dead code and are removed along with their tests, so nothing half-uses them later.

## Tasks

| # | Task | Files | Owner |
| --- | --- | --- | --- |
| 1 | Replay skips `not_handled` (requirement 1) with the edges above, unit tests red first | `src/shared/record.js`, `src/layer/replay.js`, `src/layer/editing.js`, `test/unit/` | builder |
| 2 | The page check keeps only the stamp round (requirements 2, 3, 5), the other reasons and their notes removed with their tests | `src/layer/index.js`, `src/layer/replay.js`, `src/shared/record.js`, `test/unit/`, one browser spec | builder |
| 3 | Skill text (requirement 6): "A handled edit that comes back" and the line about re-applying outstanding comments. The contract in `review_format.js` only mentions the stamp round, which stays, so it changes only if a new sentence is needed; then all four copies and `SERVICE_CONTRACT`. Then `npm run install-skills` | `skills/lahe/SKILL.md`, maybe the contract copies | builder |
| 4 | Living docs: [item lifecycle](../../diagrams/item_lifecycle.md), [replay branches](../../diagrams/replay_branches.md), free writing, fingerprinting, wherever a page-check reopen is described | `docs/diagrams/`, `docs/ongoing/` | builder |
| 5 | Screenshot of the hackathon case after the fix (page shows only the table, old card in Done), from the browser test run | progress section of this page | builder |
| 6 | Code review of the integrated diff, then `npm run gate` locally, read "0 failed" | | reviewer, orchestrator |

Rules for the builder: no `rm`, no `git clean`, no deleting anything, including your own temp files. Write what you would delete under "To delete at cleanup" on this page. Don't commit `dist/`. Run `npm run gate:unit` and one named browser spec, never the whole browser suite. Report the `ps -axo command | grep -c "[l]ahe.js serve"` count before and after your test runs.

### Verification

| Behavior | Proof | What failure looks like |
| --- | --- | --- |
| A refused card is not written onto the page | unit test: `applyRecord` on a `not_handled` run record writes nothing | the old words reappear after a repaint |
| A reworded refused card is replayed again once committed | unit test: same record at `ready` is written | your new wording never shows on the page |
| A handled run whose blocks were restructured stays handled and is not written back | browser spec: place a run, rewrite the source into a table, reload; the card stays handled with nothing new on it, the page shows only the table | the card reopens, a note appears, or a stray line appears in the table |
| A handled edit whose words a rebuild dropped stays handled | unit test on the check: reverted text gives no reopen | the card reopens |
| The stamp round still reopens | existing stamp tests stay green | a stamp-missing card stays handled |
| Typing into a refused card's passage starts a new card | unit test on `itemFor` | the refused card's words are overwritten |
| A refused card drops its conflict and lost stamp | unit test on the skip path | a stale conflict card or `lost` in review.json |
| Tests built on the old behavior are rewritten, not deleted silently | rewrite: `test/browser/cp2_mid.spec.js` (refused record and protection), reverted_edit (unit and browser), formatting_survives, graceful_failure, free_writing_seams, free_writing_flow_fix_rail, undo_reaches_helper, flow_fix_g2, run_record, replay_run, rebuild_not_the_agents_job | a spec times out or still asserts a page-check reopen |
| Contract copies agree | `test/unit/review_format.test.js` | the unit test fails on a mismatched copy |

## Acceptance criteria

- Every row of the verification table passes. `npm run gate` locally reads 0 failed. `gate:all` runs once at the checkpoint.
- A screenshot of the fixed hackathon case is on this page.
- The hackathon case replayed by hand: a free-writing run, a comment asking for a table, the agent's restructure. The page shows only the table, and the old card is handled with nothing added.
- **Analytics:** none. This is a local tool with no telemetry. The existing replay counters cover the tests.
- **Rollout:** no flag. It ships to everyone on merge. `SERVICE_CONTRACT` goes up if the contract text changes. After merge: `lahe serve --restart` and `npm run install-skills`.

## Questions

- Resolved: A plus H, chosen on [the diagnosis](00_diagnosis.md). H and E are different: H needs nothing from the agent.
- Resolved: H ships without a flag or a Reopen. The page behaves like a normal document.
- Boarded separately: a way to dismiss a card and keep its history (LAHE-dismiss-card).

## Spec review

Architecture review (one reviewer, on the flag version). Accepted: refused cards and in-page rewording, stale conflict and lost state, Keep mine on a refused card, the list of tests to rewrite, skill-only contract scope, the empty-page check. Dropped as moot after the flag was removed: where to store the flag and when to clear it.

## Progress

Done and pushed:

- **A refused card is no longer written onto the page.** Replay now only writes cards still waiting for the agent. A refused card also drops any stale conflict or "lost" mark. Keep mine on a refused card's clash sends it back to the agent. Typing in a refused card's passage starts a new card. New unit tests in `test/unit/refused_not_replayed.test.js`; the refused-reword tests in `test/unit/reword_not_handled_floor.test.js` were rewritten for the new rule.
- **The page check only asks for the missing `data-lahe-id` now.** It no longer reopens a handled card when its words, blocks, tag, bold or italic, or take-back are gone. The old reasons, their sentences and notices, and the run block check were removed with their tests. The stamp round needs the words on the page and is never written by replay.
- **Tests rewritten for the new behavior:** unit `reverted_edit`, `replay_run`, `flow_fix_g2`, `run_record`, `fix_round_f3_record`, `done_tab_replies`; browser `reverted_edit`, `formatting_survives`, `cp2_mid` (plus a new test: a refused edit is not written back after a repaint and typing there starts a new card), `replay_run_check`, `free_writing_flow_fix_rail`, `free_writing_seams`, `no_duplicate_text`.
- `npm run gate:unit` passes. The named browser specs I ran all pass.

Still to do: the hackathon browser spec with screenshots, the skill text, and the living docs.

One trade-off to know: an old-contract agent on a Markdown page that pastes a heading as a paragraph is no longer reopened for the wrong tag (`free_writing_seams`). That follows from requirement 2.

## To delete at cleanup

- `node_modules` in the worktree root: a symlink to the main clone's `node_modules`, made so Playwright runs here.
- `test-results/` from the browser runs.
