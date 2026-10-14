# Lean agent output

Cut what one reviewer comment costs the agent in tokens, without losing anything
the agent needs to find the passage or to keep the loop going.

## Problem and context

Ken makes about a hundred comments on some documents, and he wants LAHE to be
cheap for people on the $20 Claude plan. Today one plain comment puts about
1,333 tokens into the agent's context. The reviewer's own words are about 65 of
those. The measurement is in `~/Documents/token-audit/lahe_token_audit.md`,
section "What one comment costs".

The waste, per comment:

- The monitor prints the item, and then the drain prints the same item again.
- The monitor prints its "LAHE ACTION REQUIRED" banner twice: once on stdout and
  once on stderr. A host that merges the two streams shows both copies.
- Each item carries about 23 fields that are empty on a plain comment.
- `page.context` can repeat the quote word for word.
- The drain ends with a status summary line on every run, even when nothing in it
  needs the agent.
- The monitor ends with a NEXT footer naming commands the agent already has.
- `lahe reply` echoes back the whole reply the agent just wrote.
- Six per-item fields are the same on every comment, or are not needed.

Ken approved every cut below. The skill is not restructured: only the sentences
that describe output that changed are edited.

## Requirements

1. **The monitor prints one line, not the work.** When work is waiting, the
   monitor prints one line that says what is waiting (counts), names the drain
   command and the relaunch command, and exits 0. Only the drain prints items.
   Exit codes, dropped-session lines, the delivered-keys logic, and the rule that
   ended reviews and Library requests are work all stay as they are.
2. **The banner prints once.** When stdout and stderr go to the same place, the
   monitor's line goes to stdout only. When they go to different places, it goes
   to both, so a host that captures one stream still gets it.
3. **Empty fields are left out of each item line.** `lahe status --json` (and so
   the drain) leaves out `null`, `[]`, `{}`, `false` and `""` at every depth. An
   object that is empty after that is left out too. Array entries are never
   dropped, so block indexes in `new_blocks` stay right. `review.json`, the
   store, the browser library and the rail are unchanged.
4. **The contract and the skill say what a missing field means.** A missing field
   means empty. A missing true/false field means false. Every rule that names a
   false or null value still reads correctly when the field is absent.
5. **Context that repeats the quote is left out.** When `page.context.prefix` or
   `page.context.suffix`, after `normalize.normalizeText`, is fully inside
   `page.quote`, it is left off the drain line. A partial overlap is kept whole.
6. **The drain's summary line prints only when it carries something the agent
   needs.** On a drain (`--quiet`), the `{"reviews":...}` line prints only when
   `ended_reviews` or `catalog_requests` is not empty, or when a review's page
   is not connected (the helper is down, or no page has been seen). A drain with
   nothing to print still prints nothing. An audit (`--json` without `--quiet`)
   prints it every time, as before.
7. **No NEXT footer.** The monitor's one line already names the commands.
8. **`lahe reply` prints only the item and the status**, for example
   `{"item":"itm_x","status":"handled"}`. Errors, warnings and exit codes stay
   as they are.
9. **Five per-item fields are dropped from the drain line**: `agent_session_id`,
   `page.origin` and `page.title` (the page address and title, one cut),
   `page.region_label`, and `card_first_created_at`. `reviewer_last_changed_at`
   stays (see "The timestamp decision" below). `page.path` stays.
10. **One line in chat after replies.** The skill (Step 5) and the contract tell
    the agent that after a batch of replies it says one line in chat, because the
    detail is on the cards. A question to the reviewer or a blocker still gets
    full sentences.

## Approach

### The single banner: compare the two streams' files

`lahe monitor` calls `fs.fstatSync(1)` and `fs.fstatSync(2)`. When both succeed
and have the same `dev` and `ino`, the two streams are one destination (a
terminal, one pipe, or one output file, which is how Claude Code captures a
background command), so the line goes to stdout only. When they differ, or
either call throws, it goes to both: the split-stream protection the old comment
describes is kept, and an error fails toward the old behavior. A test passes
`sameStream` to pick either case without touching real descriptors.

Comparing `dev` and `ino` is the direct test of "same place". An environment
variable or a host check would have to guess, and `isTTY` says nothing about two
pipes or files.

### What the monitor's line says

One line, on exit 0:

```
LAHE ACTION REQUIRED: 1 item waiting. Do not end this turn. Drain: lahe status --session s_x --json --quiet. Handle every item it prints, rebuild and verify, reply, and drain again until it prints nothing. Then relaunch: lahe monitor --session s_x
```

The counts come from parsing what the monitor's own drain printed: item lines,
ended reviews and Library requests. A line the monitor cannot read still counts
as work, and then the line says "work waiting" with no count. With several
sessions it names one drain per session that had work, and one relaunch naming
every session still watched. The banner prefix `LAHE ACTION REQUIRED` stays,
because the contract and skill tell agents what it means.

The agent always ran the drain after a wake, so the monitor printing the items
was a copy. The monitor's own drain marks an ended review "woke" and a Library
request delivered, and the agent's drain still lists both (that is how the
ledgers already work), so nothing is lost by not printing them in the monitor.

### Which summary signals stay

The contract and the skill tell agents to read three things off the summary
line: `ended_reviews`, `catalog_requests`, and whether each review's page is
connected (`liveness`). So the line prints on a drain when:

- `ended_reviews` is not empty, or
- `catalog_requests` is not empty, or
- a review with an item on this drain has `helper_up` not true, or no
  `page_last_seen_at`.

When it prints, it keeps its present shape, so every reader of it (the monitor's
`parseDrain`, tests, hand drains) keeps working. Item counts, the helper address
and the state folder ride along only then.

### The timestamp decision

`test/unit/no_stale_excuse.test.js` and its spec
(`docs/features/20260923.02_no_stale_excuse/01_spec_no_stale_excuse.md`, R1)
require that every item the drain prints names when the reviewer last changed
it. That fix exists because an agent refused two reworded cards as "a leftover
comment card from yesterday". So `reviewer_last_changed_at` stays on the drain
line. `card_first_created_at` is dropped from the drain line: R1 only asks that
it never reads as the request's age, and leaving it off the drain is the
strongest form of that. `review.json` keeps both, so the contract sentence that
names both still describes that file. The skill bullet "Every item you are
shown is current" is reworded so it holds when the drain carries only the one.

### Where the stripping happens

All of it is in `status.drainLine` (and a small `leanValue` helper beside it),
the one function that shapes a drain item line. The projection, `review.json`,
and the browser library are not touched.

## Tasks

1. Write this spec and commit it.
2. Tests first (red), then code, per output change:
   - monitor: one line with counts and both commands, no item text, no NEXT
     footer; the line once when streams match, twice when they differ.
   - status: empty fields gone at every depth (a nested false dropped, a true
     kept, array entries kept); context inside the quote dropped and a partial
     overlap kept; the six fields gone and `reviewer_last_changed_at` kept; the
     summary line only when needed; an empty drain prints nothing.
   - reply: prints only item and status.
3. Update the existing tests that asserted the old output.
4. Update the contract text (`src/shared/review_format.js`), its restated copy
   (`test/unit/review_format.test.js`), `docs/CONTRACTS.md`, the skill
   (`skills/lahe/SKILL.md`, then `npm run install-skills`), `docs/CLI.md`,
   `docs/diagrams/agent_workflow.md`, and any other doc that describes the
   changed output.
5. Measure one comment before and after with
   [measure_one_comment.js](measure_one_comment.js).
6. Run `npm run gate:unit`, then `npm run gate` alone.

## Verification

| Behavior | Proof | What failure looks like |
| --- | --- | --- |
| Monitor prints one line, no items, no NEXT footer | `test/unit/lean_agent_output.test.js`, monitor tests; `test/unit/monitor_command.test.js` | The note text or "NEXT:" appears in monitor stdout |
| Monitor line names counts, drain and relaunch | `lean_agent_output.test.js` | The line lacks "1 item", the drain command, or the monitor command |
| Banner once when both streams match, twice when split | `lean_agent_output.test.js` (`sameStream` true and false) | Two copies with `sameStream: true`, or none on stderr with `false` |
| Empty fields left out at every depth, true kept, array entries kept | `lean_agent_output.test.js`, `leanValue` and drain tests | `"proofread":false`, `"lost":null` or `"stamp_carriable":false` on a drain line; `text_unique:true` missing |
| Context that the quote holds is dropped, partial overlap kept | `lean_agent_output.test.js` | `suffix` printed when inside the quote, or a partial suffix cut |
| Six fields dropped, `reviewer_last_changed_at` kept | `lean_agent_output.test.js`; `no_stale_excuse.test.js` still green | `page.origin`, `page.title`, `page.region_label`, `agent_session_id` or `card_first_created_at` on a drain line |
| Summary line only when needed; audit unchanged | `lean_agent_output.test.js` | Summary on a healthy drain, or missing with an ended review, a Library request, or the helper down |
| Empty drain prints nothing | `lean_agent_output.test.js` | Any output from a drain with no work |
| Reply prints only item and status | `lean_agent_output.test.js` | The reply text or `files` in stdout |
| Contract and its copies agree | `test/unit/review_format.test.js` | A sentence differs |
| One comment's cost | `node docs/features/20261014.02_lean_agent_output/measure_one_comment.js` | Before: 5,281 characters, 1,320 tokens. After: 1,305 characters, 326 tokens. Failure is the after number not dropping |
| Whole suite | `npm run gate:unit`, then `npm run gate` | Any failure |

### The measured cost of one comment

The script builds the comment from the token audit (a comment on a list item
in a Markdown page, the helper up and the page seen) and runs the monitor, the
drain and the reply in process. Tokens are characters divided by 4.

| What the agent receives | Before | After |
| --- | ---: | ---: |
| The wake (`lahe monitor`) | 683 | 110 |
| The drain | 479 | 202 |
| The reply (`lahe reply`) | 159 | 15 |
| **Total** | **1,320** | **326** |

That is a 75.3% drop. Both runs use a temporary state folder, so both carry a
`--state-dir` flag on each printed command; with the default folder both
numbers are a little smaller. What is left is mostly the reviewer's note and
the fields the agent uses to find the passage: the quote, the context, and the
region.

## Acceptance criteria

- Every row in the verification table passes.
- The measured per-comment cost drops, and both numbers are recorded here.
- `npm run gate:unit` and `npm run gate` both read 0 failed.
- No helper is left running after the test runs.
