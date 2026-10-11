# Flag, don't hold: spec

## Needs your call

1. **No new Reopen button.** You removed the Reopen button from handled cards in an earlier round: "reopening without a comment isn't useful". So a flagged card doesn't get one. You push back by writing in the reply box that is already on every handled card. Sending from it reopens the card with your words. Say if you want a button anyway.
2. **The card shows your version, and the page shows the page's.** The card shows what you wrote, as it does today, plus a note saying the page no longer matches. Clicking the card highlights the spot on the page. Showing the page's current text on the card as well would mean the card picks out which page text "replaced" yours, and after a restructure that is often a guess. Say if you want it on the card too.
3. **The flag shows for any change.** You didn't answer whether to flag only changes you didn't ask for, so I went with any change. The tool can't tell the two apart, so the table you asked for will carry a quiet flag too.
4. **Size.** About four source files, plus the contract and skill text and the docs that travel with them. That is past whetstone's usual limit of about five files. The design analysis is already done in [the diagnosis](00_diagnosis.md), so I'm treating that as the alternatives work instead of running the full forge. Say if you want the full forge.

## Problem, user, and context

You review a document while an agent edits its source. Sometimes you ask the agent to reshape text you wrote, for example by turning loose lines into a table. The browser then decides your words are missing, reopens the old card, and writes your old words back into the page. If the agent refuses the reopened card, the browser keeps writing them back on every repaint. The page and the file never agree again. The full trace is in [the diagnosis](00_diagnosis.md).

Your direction: the tool holds the line too hard on words you wrote. Often you want them rewritten. Flag the change, don't fight it.

The new rule: **the page differs from the file only while an edit is waiting for the agent's first answer.** After the agent answers, the page is the file, and the card tells you what changed.

## Requirements

1. **Refused cards are not written onto the page.** Replay skips a card in `not_handled`. Your words stay on the card with the agent's reason. If you reword a refused card and commit it, it is `ready` again and replay writes it as usual.
2. **The page check stops reopening handled cards over your words.** When a handled card's words, blocks, tag, bold or italic, or take-back are no longer on the page, the check does not reopen the card and does not write anything.
3. **It flags the card instead.** The handled card shows a note: your words are no longer on the page as you wrote them. The flag is saved, so it survives a reload. It clears on its own when your words are back on the page. The agent is not told and is not woken.
4. **You can push back from the card.** Sending a reply from a flagged card's reply box reopens it to `ready` with your words, exactly as on any handled card today.
5. **The stamp round is unchanged.** When the words landed but the `data-lahe-id` stamp did not reach an HTML source, the check still reopens the card for the agent. That exchange is between the tool and the agent, not about your words, and it writes nothing new onto the page.
6. **Agents are told the new rule.** The contract and the skill no longer say the page check reopens handled edits whose words went missing. The four copies that travel together all change: the skill, `src/shared/review_format.js`, `docs/CONTRACTS.md`, and the restated copy in `test/unit/review_format.test.js`.

## Approach

There is one design call: this changes decision D7's practice of replaying every open card. The case for it is in [the diagnosis](00_diagnosis.md) under "Why does replay let the page differ from the file?" and option H. The architecture doc is history and is not rewritten. The living docs change instead.

- **Requirement 1 (refused cards not written).** Replay's gate in `applyRecord` uses `record.isOutstanding`, which counts `ready` and `not_handled`. Replay gets its own predicate that counts only `ready`. Other users of `isOutstanding` (the rail's open count, the start-of-container placement rule) are unchanged. A refused card is still open work for you; it's just not drawn into the page.
- **Requirements 2 and 3 (flag instead of reopen).** `runRevertCheck` in `src/layer/index.js` reopens through `done.reopen`. For every reason except the stamp round, it stores a flag on the record and sets a card badge instead. The flag is stored on the record the way `region.lost` is: a code, a reason and a time, persisted with `persistItem`. The badge is a new card-only failure code in `src/shared/failures.js`. When a later check finds the words back, it clears the flag and the badge. The flag is not projected into `review.json` for agents, because nothing about it is the agent's to act on.
- **Requirement 4 (push back from the card).** Already works: sending from a handled card's composer calls `continueItem`, which sets `ready`. No change.

## Tasks

| # | Task | Files | Owner |
| --- | --- | --- | --- |
| 1 | Replay skips `not_handled` (requirement 1), with a unit test red first | `src/shared/record.js` or `src/layer/replay.js`, `test/unit/` | builder |
| 2 | The page check flags instead of reopening (requirements 2, 3, 5): failure code, record flag, badge, clear on return | `src/layer/index.js`, `src/layer/replay.js`, `src/shared/failures.js`, `test/unit/`, one browser spec | builder |
| 3 | Contract and skill text (requirement 6), all four copies, then `npm run install-skills` | `skills/lahe/SKILL.md`, `src/shared/review_format.js`, `docs/CONTRACTS.md`, `test/unit/review_format.test.js` | builder |
| 4 | Living docs: [item lifecycle](../../diagrams/item_lifecycle.md), [replay branches](../../diagrams/replay_branches.md), free writing, fingerprinting, wherever a page-check reopen is described | `docs/diagrams/`, `docs/ongoing/` | builder |
| 5 | Screenshot of a flagged card, light and dark, from the browser test run | progress section of this page | builder |
| 6 | Code review of the integrated diff, then `npm run gate` locally, read "0 failed" | | reviewer, orchestrator |

Rules for the builder: no `rm`, no `git clean`, no deleting anything, including your own temp files. Write what you would delete under "To delete at cleanup" on this page. Don't commit `dist/`. Run `npm run gate:unit` and one named browser spec, never the whole browser suite. Report the `ps -axo command | grep -c "[l]ahe.js serve"` count before and after your test runs.

### Verification

| Behavior | Proof | What failure looks like |
| --- | --- | --- |
| A refused card is not written onto the page | unit test: `applyRecord` on a `not_handled` run record writes nothing | the old words reappear after a repaint |
| A reworded refused card is replayed again once committed | unit test: same record at `ready` is written | your new wording never shows on the page |
| A handled run whose blocks were restructured is flagged, not reopened | browser spec: place a run, rewrite the source into a table, reload; the card stays handled with the flag, the page shows only the table | the card reopens, or a stray line appears in the table |
| The flag survives a reload and clears when the words come back | browser spec, same file | the flag disappears on reload, or stays after the words return |
| The stamp round still reopens | existing stamp tests stay green | a stamp-missing card is flagged instead of reopened |
| Pushing back from a flagged card reopens it | browser spec: send from the composer; the card is `ready` | the card stays handled |
| Contract copies agree | `test/unit/review_format.test.js` | the unit test fails on a mismatched copy |

## Acceptance criteria

- Every row of the verification table passes. `npm run gate` locally reads 0 failed. `gate:all` runs once at the checkpoint.
- A screenshot of a flagged card, light and dark, is on this page.
- The hackathon case replayed by hand: a free-writing run, a comment asking for a table, the agent's restructure. The page shows only the table, and the old card is handled with a flag.
- **Analytics:** none. This is a local tool with no telemetry. The replay counters already in `replay.js` get one new counter for flags set, so tests can assert on it.
- **Rollout:** no flag. It ships to everyone on merge. `SERVICE_CONTRACT` goes up if the contract text changes. After merge: `lahe serve --restart` and `npm run install-skills`.

## Questions

- Open: the four items under "Needs your call".
- Resolved: A plus H, chosen on [the diagnosis](00_diagnosis.md). H and E are different: H needs nothing from the agent.

## Progress

Not started.

## To delete at cleanup

Nothing yet.
