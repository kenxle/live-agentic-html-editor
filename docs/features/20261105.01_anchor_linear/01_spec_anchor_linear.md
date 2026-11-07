---
read-when: The best guess for a lost comment is slow, or you are reviewing the pass index in anchor.js.
---

# Make the best guess for a lost comment fast

Built on `task/anchor-linear`, not yet merged. The best guess now takes about a tenth of a second where it took tens of seconds, and it picks the same element. The unit gate passed. The full browser gate and an independent review are still to run.

## Problem

One lost comment froze Seneschal's knowledge tree preview (4,209 elements, 24 deep) for about 26 seconds on every load. When a comment's words are gone, replay asks `pointing.bestGuess` where it probably is, and that scores every element on the page. Each score read the element's heading, its neighbours' text and its path from scratch:

- `headingOf` rebuilt the whole text of every ancestor, then scanned up to 2,000 elements backwards;
- the context read joined the text of every sibling;
- `pathOf` and the ordinal filtered every sibling list.

That is roughly n² × d work for one pass.

## Intended behavior

- The best guess on a 4,000-element, 24-deep page takes well under a second.
- It picks the same element, with the same score, runner-up and reason, as before. No anchoring answer changes anywhere.

## Scope and approach

`anchor.withPassIndex(scope, run)` wraps the scoring loop in `bestGuess`. Inside it, the readers that loop calls answer from facts read once per pass:

- per parent: its listed children, each child's place among them, and each child's ordinal among its tag;
- per element: the unlimited "last heading inside" walk, with its answer and its step count. The backward heading scan becomes running totals and a binary search. When the 2,000-step budget runs out, the index follows one path down to the same answer the budgeted walk gives, including the odd case where the walk returns a heading it was inside when the budget ran out;
- per parent: where an empty icon's look-ahead stops, and the siblings' texts joined once, so each context is a slice of one string;
- per element: its path, built from its parent's;
- the existing text memo, kept for the whole pass.

Outside a pass, the original walk runs unchanged and stays the definition. Mint, resolve and the rest of the engine do not use the index.

The cost goes from about n² × d to about n × d + T × d, where T is the page's text length, because each element's text is still built once from its own subtree.

### Choices made

- **Text is not composed from children's text.** `textOf` normalizes the joined text of a whole subtree: block breaks, `<pre>` handling, NFC and whitespace folding. A child inside a `<pre>` collects differently from the same child read on its own. Composing would also save only the walk, not the string work, because every element's full string is still needed. So `textOf` is unchanged and the pass relies on the memo.
- **No early skip below FLOOR.** A candidate below FLOOR can still be the runner-up that blocks a winner through MARGIN (60 against 45 has no winner today). Skipping it would change winners. An exact skip needs a bound that moves with the leader, and once every signal is cheap, that bound costs more than it saves.
- **The heading budget is kept.** The index answers within the same budget, so the heading for an element 2,000 steps from its heading is still null, as before.

## Questions

- `bindProbable` runs `bestGuess` on every pass for a comment that stays lost: at boot, again at the settle recheck about two seconds later, and on every mutation, reply, commit or undo pass. Lost verdicts are held back during the settling window, but the guess still runs then. This change leaves it as is. Caching the guess safely needs a signal that the page has not changed since the last pass. Replay does not have one: passes run for reasons other than DOM changes, and pages can change without a pass. Each guess now costs about 0.1 s, so the repeats matter much less.

## Verification

| Check | Owner | Status and evidence |
| --- | --- | --- |
| Speed test fails before the fix | Builder | Failed at about 7 s on the first generated page, budget 1.5 s ([best_guess_speed.test.js](../../../test/unit/best_guess_speed.test.js)) |
| Same readings, walk against index | Builder | Passes ([pass_index.test.js](../../../test/unit/pass_index.test.js)). It compares heading, path, fingerprint, context and score for every element on hand-built corner cases (budget running out in a long list, inside a heading, and on the forward look; skipped, tool, nested and wordless headings), the 4,000-element page, and eight seeded random pages. |
| Real DOM speed and sameness | Builder | Passes in Chromium ([best_guess_speed.spec.js](../../../test/browser/best_guess_speed.spec.js)) |
| `npm run gate:unit` | Builder | Passed: 3,170 pass, 0 fail, 5 skipped, 2 todo |
| Full gate, all browsers | Orchestrator | Not run |
| Independent review | Orchestrator | Not run |

Measured times for one best-guess pass:

| Page | Before | After | Same answer |
| --- | --- | --- | --- |
| Generated page, simulated DOM (Node) | about 10.1 s | about 0.14 s | yes |
| Generated page, Chromium | about 11.9 s | about 0.12 s | yes |
| Copy of the real knowledge tree page, Chromium, comment on an element under "As an outline" | about 29 s | about 0.11 s | yes |

The live preview no longer has a lost comment, so loading it shows no long task with either bundle. The copy of the page above reproduces the freeze.

## Rollout

The change merges with the next checkpoint. The orchestrator rebuilds `dist/` and runs the full gate. Nothing for an agent or a reviewer changes.

No cleanup removals are requested.
