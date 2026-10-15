# Batch reply, and no echo of the agent's own answers

A follow-up to `docs/features/20261014.02_lean_agent_output/` (PR #69). Two more
cuts to what a reviewed document costs the agent in tokens. Ken approved both on
2026-10-15.

## Problem and context

Ken wants LAHE cheap for people on the $20 Claude plan. The measurements are in
`~/Documents/token-audit/lahe_token_audit.md` (outside this repo).

1. **The drain hands the agent its own earlier answers.** When the reviewer
   follows up on a card, the drain prints the item's `thread`, and every agent
   entry in it carries the full text the agent wrote. On a real follow-up, 332
   of the item's 536 tokens were the agent's own earlier reply. The agent that
   wrote it already has it in its context. A second follow-up repeats both
   earlier answers, so the cost grows with every round on a card. The text is
   there for a new agent taking the session over, which reads it through the
   catch-up command (`lahe status --session <id> --json`, no `--quiet`).
2. **Every reply is its own command.** `lahe reply` answers one item per run.
   An agent answering ten comments makes up to ten tool calls, and each call
   re-reads the whole conversation. In Ken's document sessions the conversation
   was a median of 219,272 tokens at a wake's first call. Releasing Hold sends a
   batch at once, so batches are common, and the reply step is where the calls
   pile up.

## Requirements

1. **The drain leaves out the agent's own words.** On `lahe status --json
   --quiet` (the drain), each agent entry in an item's `thread` keeps its
   `status` and `agent` but leaves out `text` and `reason`, and any other
   free-text field the agent wrote. The reviewer's entries in the thread keep
   everything. If the item carries a current agent reply at top level (a
   `reply` field with the agent's text, for example a pending question), its
   text is left out the same way.
2. **The catch-up keeps everything.** `lahe status --json` without `--quiet`
   (the audit and the takeover catch-up) prints threads in full, unchanged.
   `review.json` is unchanged.
3. **The agent can always get its words back.** The contract and the skill say,
   once: the drain leaves out your own earlier answers; after a compaction, or
   whenever you need them, run the catch-up form (`lahe status --session <id>
   --json`) once.
4. **`lahe reply --batch` answers many items in one run.** `lahe reply --review
   <id> --batch [--agent <name>] [--session <id>] [--state-dir <p>]` reads a JSON
   array from stdin. Each entry has `item`, `rev`, `status`, and the same
   optional fields the single form takes (`text`, `reason`, `files`,
   `needs_see`, `proofread`, `suggest` as a list of `[block, from, to]`). Each
   entry is checked with the same rules as the single form.
5. **All or nothing.** If stdin is not valid JSON, is not an array, is empty, or
   any entry fails its checks, nothing is written. The error names the entry by
   its position and item id and says what is wrong. A raw line break inside a
   string fails JSON parsing, so it is refused, never split into two lines.
6. **One line out per item.** On success, `--batch` prints one
   `{"item":"...","status":"..."}` line per entry, in order, the same shape the
   single form prints. Any per-item warning the single form prints (the stale
   rev warning) prints for that entry.
7. **The skill tells the agent to batch.** With several items in one drain, the
   agent makes all edits to one file together, rebuilds once, and sends every
   reply in one `lahe reply --batch` run. The single form stays documented and
   working.

## Approach

Two design calls.

- **Which reads drop the agent's words.** The drain (`--quiet`) is what the
  monitor's wake line names and what an agent runs on every wake. The catch-up
  is the same command without `--quiet`, and the takeover output already names
  it. So `--quiet` is the switch. Rejected: remembering per session which reply
  texts it already printed. That needs a ledger and still loses the words after
  a compaction. The trade-off: an agent whose context was compacted no longer
  sees its earlier answers on a follow-up unless it runs the catch-up once.
  Requirement 3 covers that, and the reviewer's own words stay on every drain.
- **Batch input is one JSON array on stdin.** Not repeated flags (an item's text
  would still need quoting per flag) and not JSON lines (a pretty-printed entry
  would fail). One array allows pretty printing and still refuses a raw line
  break inside a string.

## Tasks

Read first: `skills/lahe/SKILL.md` (Step 5, Reply, and the drain sections),
`docs/CLI.md` (status and reply), `docs/CONTRACTS.md`, `docs/diagrams/agent_workflow.md`,
and this repo's `CLAUDE.md` ("Agent-facing docs: what is truth, and what
travels together", "Running the gate").

1. In `src/cli/commands/status.js`, `drainLine` gets told whether this is a
   drain (`args.quiet`). On a drain it strips the agent's free text from thread
   entries and from a top-level current reply. Unit tests: a drain item with a
   two-round thread prints no agent text and keeps the reviewer's notes; the
   same item without `--quiet` prints everything.
2. In `src/cli/commands/reply.js`, add `--batch`. Reuse the single form's
   validation per entry. Validate every entry before appending anything, then
   append all lines in one write. Unit tests: a good batch of three writes three
   lines and prints three result lines; a batch with one bad entry writes
   nothing and names the entry; bad JSON, a non-array, and an empty array are
   refused; `--batch` together with `--item` is refused.
3. Update the skill, the contract in `src/shared/review_format.js`, its restated
   copy in `test/unit/review_format.test.js`, `docs/CONTRACTS.md`, `docs/CLI.md`,
   and the reply usage text. Edit only the sentences that change, and add the
   batch example to Step 5.
4. Extend `docs/features/20261014.02_lean_agent_output/measure_one_comment.js`,
   or add a sibling script in this folder, to measure a follow-up item's drain
   line before and after requirement 1 (the drop of the agent's own words).

| Behavior | Proof | Failure it catches |
| --- | --- | --- |
| Drain drops agent text in threads (requirement 1) | unit test on `drainLine` and on a `--quiet` run | agent's own answers still echoed |
| Catch-up keeps full threads (requirement 2) | unit test, no `--quiet` | takeover agent loses the history |
| Batch writes all or nothing (requirement 5) | unit test with one bad entry | half a batch written |
| Batch output one line per item (requirement 6) | unit test | wordy output, or wrong order |
| Contract copies match (skill and contract travel together) | `review_format.test.js` | skill and contract drift |
| No leaked helpers | `ps -axo command \| grep -c "[l]ahe.js serve"` before and after | test helpers left running |

## Acceptance criteria

Every row of the table above passes. `npm run gate:unit` passes in the builder's
worktree. The measurement script prints the follow-up item's tokens before and
after. No analytics or flag: this is CLI output, and the catch-up form keeps the
full history for anyone who needs it.

## Questions

- Resolved: drop only on `--quiet`, not through a per-session ledger (see Approach).
- Resolved: batch input is one JSON array, not JSON lines.
