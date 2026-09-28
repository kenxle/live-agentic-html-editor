# No stale excuse

An agent may not refuse a reviewer's item because the card it sits on is old.

## The problem

In review `raa43efbab8d1` the reviewer reworded two cards that had been created
the day before. Rewording bumps the item's rev and makes it outstanding again,
so both were current work. The agent replied `not_handled` twice and wrote
nothing:

> "Nothing's actually wrong with the article. This is a leftover comment card
> from yesterday (created 9/22, before you'd even asked to remove [et al] the
> first time)."

> "Another stale card from 9/22. You explicitly deleted 'Will we be saved?' a
> minute ago (handled)."

The reviewer retyped his change three times and it never landed. His words about
a different failure in the same session apply here: "we cannot rely on the llm
to remember."

The cause is in the record, not the agent. `review.json` handed an agent
`created_at` and `updated_at` side by side, equally plain. The one that mattered,
when the reviewer last changed those words, was not the obvious field, and the
one that invited the judgment was.

## Requirements

- **R1. The current revision is unmissable.** Every item the drain prints, in
  `review.json` and in `lahe status`, names when the reviewer last changed it,
  and the card's first-created time cannot read as "how old this request is".
- **R2. The contract forbids the excuse.** An item that appears in the drain is
  outstanding and current by definition, said in plain words in the contract that
  ships with every review.
- **R3. A refusal carries words.** `not_handled` and `question` cannot be filed
  with a blank reason or text, from the command or by hand.

## What was built

### R1: two timestamps, named for what they mean

`src/shared/review_format.js` (`projectItem`) replaces the projected `created_at`
and `updated_at` with:

- `reviewer_last_changed_at`: when the reviewer last changed these words. Falls
  back to the created time for an item never reworded, so it is always present.
- `card_first_created_at`: when the card was first opened, and nothing more.

Renaming was chosen over adding a third field. Adding one would have left
`created_at` sitting beside it reading exactly as it did on 2026-09-23, and the
brief's own condition was that `created_at` must not read as the age of the
request. The projection is agent-facing only: the browser layer keeps the record's
`created_at` and `updated_at` and was not touched.

Three readers of the projected names moved with it:

- `src/cli/commands/status.js` (`lastItemAt`)
- `src/cli/commands/session.js` (oldest unanswered)
- `src/service/routes.js` (`unansweredWork`, which feeds the rail's "oldest item"
  line)

The human-readable surfaces say it out loud:

- `renderText` prints `Reviewer last changed these words: <iso> (their current
  wording)` on every item, and `Card first created: <iso> (not how old the
  request is)` when the two differ.
- `lahe status`'s item line ends with `[last changed 2m ago]`.

### R2: one contract sentence

New, third in the contract array in `src/shared/review_format.js`:

> Every item in this file is outstanding and current, whatever its card's age.
> reviewer_last_changed_at is when the reviewer last changed those words.
> card_first_created_at is only when the card was first opened, and it never
> means the request is old: a reworded item keeps its card and gets a new rev.
> Refusing an item as stale, leftover, or superseded is never right. If you think
> it is already done, open the page or the source, check, and say what you found
> there.

It travels to the restated copy in `test/unit/review_format.test.js`, to
`docs/CONTRACTS.md`, and to `skills/lahe/SKILL.md` (Step 4 checklist and the
reply checklist), per CLAUDE.md.

### R3: a blank reason is not a reason

Two paths, because an agent can take either:

- `lahe reply` (`validateBody`): `not_handled` needs a `--reason` with
  non-whitespace in it, and `question` needs a non-blank `--text`. `--reason` does
  not stand in for it: `protocol.REPLY_REQUIRED.question` is `[item, rev, status,
  text]`, so a line without text is one the command would exit 0 on and the fold
  would then reject, leaving the agent believing it asked and the reviewer holding
  a malformed-line chip. The command
  fails with exit `BAD_USAGE` and writes nothing. The `not_handled` message names
  what to write: "naming what you checked and what you found. An item on the drain
  is the reviewer's current request whatever its card's age, so 'this card is old'
  is not a reason."
- The fold (`protocol.parseReplyLine`): a required field that is empty **or all
  whitespace** counts as missing, so a hand-appended line is reported as a
  malformed line (the reviewer's existing dismissible chip naming the file and the
  line) rather than shown as a refusal with nothing in it.

`""` was already caught on both paths; whitespace was the hole, and the CLI's
question path accepted a blank `--text` the same way.

## Rollout

- **A `review.json` already on disk keeps the old field names** until the next
  event rewrites it, so an agent polling a quiet review can read a file with
  `created_at` and `updated_at` for a while. Nothing else is affected: the rail
  (`routes.js`), `lahe status` and `lahe session` all project fresh from the log
  on every read.
- **The contract ships in the layer bundle**, so the checkpoint owes a `dist/`
  rebuild. Builders do not commit `dist/`; the orchestrator rebuilds and commits
  it once per checkpoint.

## Tests

`test/unit/no_stale_excuse.test.js`, written red first:

- a projected item carries `reviewer_last_changed_at` and
  `card_first_created_at`, and no longer carries `created_at` or `updated_at`
- an item never reworded still has a last-changed time
- `renderText` says "reviewer last changed these words" and "current wording"
- `lahe status` prints `last changed` on the item line, and `--json` carries
  `reviewer_last_changed_at`
- `status.lastItemAt` reads the new names
- the contract carries the rule, with both field names and the check-the-page
  instruction
- `not_handled` with `""`, `"   "` and `"\n"` fails, says what to write, and
  leaves no reply file
- `not_handled` with a real reason still works
- `question` with a blank `--text` fails, and `question` with only a `--reason`
  fails too: the fold requires `text`, so accepting a reason in its place wrote a
  line the command exited 0 on and the fold then rejected
- `lahe session` dates the oldest unanswered item by the rework, not the card
- a hand-appended `not_handled` with a whitespace reason is rejected by
  `parseReplyLine`

`test/unit/review_format.test.js` carries the new contract sentence in its
independent restatement and expects 45 sentences.

`npm run gate:unit` is green (1294 passing, 2 todo). One named browser spec,
`test/browser/agent_replies.spec.js`, ran green as well: no rail wording changed,
so no new browser test was needed.
