# Flag, don't hold: spec

## Needs your call

1. **Size.** About three source files, plus the contract and skill text and the docs that travel with them. That is past whetstone's usual limit of about five files. The design analysis is already done in [the diagnosis](00_diagnosis.md), so I'm treating that as the alternatives work instead of running the full forge. Say if you want the full forge.

## Decided

- **No flag, no Reopen, nothing new on the card.** You: "the user just wants to write comments and have things work like a normal doc. they don't understand that things can be different between the browser and the file." So once the agent has answered a card, the page simply shows the file. If you want something changed again, you edit or comment again, as in any document.
- **The cost, accepted:** if a rebuild quietly drops something the agent had placed (your bold, a paragraph), the tool no longer puts it back or asks the agent. You see the page as it is and can edit it again.

## Problem, user, and context

You review a document while an agent edits its source. Sometimes you ask the agent to reshape text you wrote, for example by turning loose lines into a table. The browser then decides your words are missing, reopens the old card, and writes your old words back into the page. If the agent refuses the reopened card, the browser keeps writing them back on every repaint. The page and the file never agree again. The full trace is in [the diagnosis](00_diagnosis.md).

Your direction: the tool holds the line too hard on words you wrote. Often you want them rewritten. And the page should behave like a normal document, without showing you that the browser and the file can differ.

The new rule: **the page differs from the file only while an edit is waiting for the agent's first answer.** After the agent answers, the page is the file.

## Requirements

1. **Refused cards are not written onto the page.** Replay skips a card in `not_handled`. Your words stay on the card with the agent's reason. If you reword a refused card and commit it, it is `ready` again and replay writes it as usual.
2. **The page check stops reopening handled cards over your words.** When a handled card's words, blocks, tag, bold or italic, or take-back are no longer on the page, the check does nothing: no reopen, no write, nothing on the card, and the agent is not woken.
3. **Nothing new is shown.** No badge, note, or button is added to any card for this.
4. **Older stuck cards stop showing.** A card already reopened by the page check and then refused falls under requirement 1 (refused cards are not written), so the hackathon case clears on the next reload.
5. **The stamp round is unchanged.** When the words landed but the `data-lahe-id` stamp did not reach an HTML source, the check still reopens the card for the agent. That exchange is between the tool and the agent, not about your words, and it writes nothing new onto the page.
6. **Agents are told the new rule.** The contract and the skill no longer say the page check reopens handled edits whose words went missing. The four copies that travel together all change: the skill, `src/shared/review_format.js`, `docs/CONTRACTS.md`, and the restated copy in `test/unit/review_format.test.js`.

## Approach

There is one design call: this changes decision D7's practice of replaying every open card. The case for it is in [the diagnosis](00_diagnosis.md) under "Why does replay let the page differ from the file?" and option H. The architecture doc is history and is not rewritten. The living docs change instead.

- **Requirement 1 (refused cards not written).** Replay's gate in `applyRecord` uses `record.isOutstanding`, which counts `ready` and `not_handled`. Replay gets its own predicate that counts only `ready`. Other users of `isOutstanding` (the rail's open count, the start-of-container placement rule) are unchanged. A refused card is still open work for you; it's just not drawn into the page.
- **Requirements 2 and 3 (no reopen, nothing shown).** `runRevertCheck` in `src/layer/index.js` asks `replay.revertedHandledEditIds` which handled cards to reopen. The check keeps only the stamp reason (requirement 5, the stamp round). The other reasons and their notes (reverted, missing, formatting, tag, take-back) become dead code and are removed along with their tests, so nothing half-uses them later.

## Tasks

| # | Task | Files | Owner |
| --- | --- | --- | --- |
| 1 | Replay skips `not_handled` (requirement 1), with a unit test red first | `src/shared/record.js` or `src/layer/replay.js`, `test/unit/` | builder |
| 2 | The page check keeps only the stamp round (requirements 2, 3, 5), the other reasons and their notes removed with their tests | `src/layer/index.js`, `src/layer/replay.js`, `src/shared/record.js`, `test/unit/`, one browser spec | builder |
| 3 | Contract and skill text (requirement 6), all four copies, then `npm run install-skills` | `skills/lahe/SKILL.md`, `src/shared/review_format.js`, `docs/CONTRACTS.md`, `test/unit/review_format.test.js` | builder |
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
| Contract copies agree | `test/unit/review_format.test.js` | the unit test fails on a mismatched copy |

## Acceptance criteria

- Every row of the verification table passes. `npm run gate` locally reads 0 failed. `gate:all` runs once at the checkpoint.
- A screenshot of the fixed hackathon case is on this page.
- The hackathon case replayed by hand: a free-writing run, a comment asking for a table, the agent's restructure. The page shows only the table, and the old card is handled with nothing added.
- **Analytics:** none. This is a local tool with no telemetry. The existing replay counters cover the tests.
- **Rollout:** no flag. It ships to everyone on merge. `SERVICE_CONTRACT` goes up if the contract text changes. After merge: `lahe serve --restart` and `npm run install-skills`.

## Questions

- Open: the size question under "Needs your call".
- Resolved: A plus H, chosen on [the diagnosis](00_diagnosis.md). H and E are different: H needs nothing from the agent.
- Resolved: H ships without a flag or a Reopen. The page behaves like a normal document.
- Boarded separately: a way to dismiss a card and keep its history (LAHE-dismiss-card).

## Progress

Not started.

## To delete at cleanup

Nothing yet.
