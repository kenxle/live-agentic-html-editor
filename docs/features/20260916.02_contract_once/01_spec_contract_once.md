# Stop repeating the agent contract on every drain

A whetstone-size change. Ken approved it on 2026-09-16 after seeing the numbers. Progress is at the bottom of this page; it updates as the work lands.

## The problem, in plain words

Every time an agent checks for new work, it runs one command: `lahe status --session <id> --json --quiet`. The first line that command prints is the full agent contract: the 40 or so instructions that tell an agent how to behave. That block is about 3,800 tokens. The rest of the output, when there is nothing waiting, is one short line.

An agent checks for work every time it is woken, which is every time a comment lands. Today one agent checked about thirty times. That is over 100,000 tokens of the same instructions, read thirty times, by an agent that already had them.

The contract is not wasted everywhere. It lives in every review's `review.json`, which is the one file an agent is guaranteed to read, and it belongs there. The waste is the copy on every drain.

## The change

- `lahe status --json --quiet` (the drain) stops printing the contract block. In its place it prints one short line saying where the contract is: the `contract` field in each review's `review.json`.
- `lahe status --json` without `--quiet`, and the plain text mode, keep the contract, because those are the modes an agent might run once when it is starting cold and has not opened a review file yet.
- `lahe monitor` prints the drain's output when work lands, so it inherits the change with no code of its own.
- The contract text itself does not change. `review.json` does not change. Nothing in the browser changes.

## What an agent sees after

Before, with nothing waiting: the contract block, then one summary line. After: one pointer line, then one summary line. With work waiting, the item lines are unchanged.

## Tests

Written first, watched fail, then made green:

- The quiet JSON drain's first line is the pointer, not the contract, and the contract text does not appear anywhere in its output.
- The non-quiet JSON mode still prints the contract first.
- The monitor's printed work carries no contract block.
- The pointer line names `review.json` and the field name `contract`.

## Files

`src/cli/commands/status.js` (the two places it prints the contract line), its unit tests in `test/unit/status_command.test.js` and `test/unit/monitor_command.test.js`, and one sentence each in `AGENTS.md` and `docs/CLI.md` where the drain is described, so an agent knows the drain no longer carries the contract. The contract text in `src/shared/review_format.js` is frozen and is not touched.

## Not in this change

- Trimming `AGENTS.md` (14,000 tokens at every session start). Separate pass.
- Making `review.json` smaller for large reviews. Separate.

## Progress

- 2026-09-16 17:40: spec written, builder dispatched. Unit tests only on the builder; the browser suite runs once on the merged result.
- 2026-09-16 17:45: the four tests are written and committed. Three of them fail, which is what they should do before the change: the drain still prints the contract, and there is no pointer for them to find. The fourth passes already, because it says the non-quiet mode keeps the contract, and that is what it does today. Starting on the change itself.
- 2026-09-16 17:52: the change is in and the unit gate is green: lint passed, 1095 tests pass, 0 fail. The drain's first line is now `{"contract_in":"review.json","contract_field":"contract", ...}`. `lahe monitor` needed no code of its own, as expected; the test that proves it runs the real status command rather than a stub. One judgment call worth naming: the drain's first line still carries `field_classes` and `intent_fields`, the short table that says which fields of the item lines below hold text copied off the page rather than the reviewer's words. That is the prompt-injection fencing from the architecture doc (D12), it is a fraction of a line, and dropping it was not what the spec asked for. The 3,800-token part, the contract itself, is gone.
- 2026-09-16 17:50: reviewed and merged to main. The drain's first line went from 15,161 characters to 801. Full test run on main green (unit and browser). Pushed. Agents pick it up on their next wake; no restart needed, the command reads the code on disk each time it runs.
