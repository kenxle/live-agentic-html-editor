# Choices

An agent can put answer buttons in a document (a `.choice` group with a
`data-choice` name). The reviewer clicks one, and the agent receives the
group name and the answer. Clicking a different answer before the agent
replies changes the same item.

## Sub-features

- `choice-press`: clicking a button sends `{group, answer}` to the agent.
- `choice-revise`: a second press before the agent answers changes the same item.
- `choice-keyboard`: Enter on a focused button presses it.

## How to get to it (user POV)

- Open a helper-served document with a choice group and click a button in it.
- Tab to a button and press Enter or Space.

## Driving it with lahe-verify

Preconditions:

- A fresh run on the sample document, which has the group `bed-size` with buttons `small` and `large`.

- **Press.** Run `lv page click '[data-choice="bed-size"] button[value="large"]'`. Then `lv agent wait '"answer":"large"'`. The drain line has `"kind":"choice"` and `"choice":{"group":"bed-size","answer":"large"}`.
- **Revise.** Run `lv page click '[data-choice="bed-size"] button[value="small"]'` and `lv agent wait '"answer":"small"'`. The line has the same `id` at `"rev":2`, and `lv agent drain | grep -c '"kind":"choice"'` prints `1`.
- **Keyboard.** With focus on the Small button after the click, run `lv page key Tab` (focus moves to Large), then `lv page key Enter`. `lv agent wait '"answer":"large"'` shows the same `id` at `"rev":3`.
- **Proof.** `lv page rail choice` saves the item with `state: ready`, and the drain line is in `commands.jsonl`.

## Gotchas

- The press reaches the agent a moment after the click. `page wait` on the page's own items passes before the helper has it; use `agent wait`.
- Choice groups only work on pages the helper serves. Buttons in a dev-server app are left alone on purpose.
- Regression spec: `choice_buttons.spec.js`.
