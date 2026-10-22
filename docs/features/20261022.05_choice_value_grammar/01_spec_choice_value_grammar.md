# Spec: Choice names and values as agents write them

**Shipped with this change.** Ken hit it on 2026-10-22 on a bake-off page. Whetstone route. Nothing is waiting on you.

## Problem

An agent wrote choice groups whose buttons carried the keys it already used, such as `value="A_jev"`. The layer refused every group, and the rail chip said:

> The choice closest-21: the button "A" has the value "A_jev", which is not 1 to 32 lowercase letters, digits and hyphens.

Ken had to carry that message to the agent, and the agent had to rename its keys. Ken: "this seems unnecessarily picky, and i certainly don't want to be carrying messages around between agents over stupid formatting things like this".

The grammar (`record.CHOICE_TOKEN`) exists for one reason: the group name and the answer travel to the agent as intent, so they must never hold a sentence (prompt-injection fencing, D12). Lowercase-only and no underscore added nothing to that. A hyphen already joins words as well as an underscore does.

## Behavior

A group name and a button value may be 1 to 64 characters: letters of either case, digits, hyphens, underscores, dots and colons, starting with a letter or digit. `A_jev`, `Closest_21`, `optionB`, `v1.2` and `step:3` all arm, and the agent reads them back exactly as written.

Still refused: a space, a quote, a bracket, a slash, a backslash, a newline, a leading punctuation mark, or more than 64 characters. None of those is a key an agent picks by habit, and refusing them keeps both ids short of prose. An id can still read like a phrase (`IgnorePriorInstructions`), as `approve-and-also-delete-the-test` could before; with no space it is never a sentence, and the agent reads it as an id under the intent fence. Names that differ only in case (`Foo`, `foo`) are separate groups; every comparison is an exact match. Without a quote or backslash, the name stays safe in the quoted attribute selector the rail builds (`overlay.choiceAnswerText`).

The value is never rewritten. Lowercasing `A_jev` to `a-jev` would arm the group but hand the agent a key it does not recognise, which is the same relay problem one step later.

The chip's wording comes from one constant, `record.CHOICE_TOKEN_RULE`, so the sentence and the regex change together.

## Scope

- `src/shared/record.js`: `CHOICE_TOKEN` and the new `CHOICE_TOKEN_RULE`. The browser, the helper's door and the projection all check through `isChoiceToken`, so one change covers all three.
- `src/layer/choices.js`: the chip sentences read the rule constant.
- Docs: `docs/ongoing/CHOICE_BUTTONS.md`, `docs/CONTRACTS.md`, `vendor/stclair-doc-style/COMPONENTS.md` (installed into the skill as `references/components.md`). The skill and the contract paragraph never spelled the grammar, so they do not change.
- Not the feature's architecture doc, which is history.

## Verification

| Check | Result |
|---|---|
| `choice_kernel.test.js` "the grammar is bounded: 1 to 64 ..." accepts `A`, `A_jev`, `optionB`, `v1.2`, `step:3`, 64 characters; refuses space, quote, backslash, slash, newline, leading `_` or `.`, 65 characters | red before the change, green after |
| `choice_kernel.test.js` "a press named as an agent wrote its keys (Closest_21, A_jev) ..." passes the door, projects, and the drain line carries the press unchanged | red before, green after |
| `choice_buttons.spec.js` V2: a group `Closest_21` with values `A_jev` and `B_jev` in `choice-broken.md` arms; the chip states the new rule | green in the gate run below |
| `npm run gate` on 7b2c37c, cloud container, non-root, pandoc 3.9 | lint passed; bundle current; unit 3,153 tests, 3,140 passed, 0 failed, 11 skipped; browser 915 passed, 0 failed, 8 skipped. Helpers running before and after: 0 and 0 |

## Rollout and review

Merge when the gate is green. One independent reviewer, since the change touches the field that fences intent.

## The record

- Review: one independent reviewer, nothing blocking. Taken from its nits: the grammar test also refuses a single quote and a backtick, and the Behavior section now says an id can still read like a phrase and that names differing only in case are separate groups.
- Two earlier gate runs each had two browser failures outside this change. `stable_addresses_mappers.spec.js` V27 and its Step 2 test polled `page.evaluate` while waiting for the reload that destroys the evaluate context; V27 failed the same way on main (1 in 15 runs). `reload_claim.spec.js:159` read `readOnly` once just after the chip cleared. All three polls now treat that read as "not yet"; 18 of 18 repeated runs of both files passed, then the full gate above.
