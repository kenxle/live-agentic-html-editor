# 3A builder notes: the agent loop

Branch `task/3a`, worktree `../lahe-worktrees/3a`. Owns `src/service/projection.js`,
`src/service/review_writer.js`, `src/service/replies.js`, `src/layer/tab_done.js`,
`src/cli/commands/wait.js`, and `review.read` in `src/service/routes.js`. Ranked tests 10, 20, 27, 28,
32, 35.

## What this task is

The whole agent-facing API of this tool is one sentence: **append one JSON line to a file**. Everything
here serves that. The helper writes `review.json` from its log, watches `replies*.jsonl`, folds what it
finds, and the library puts the answer on the item's own card.

## What landed

### `src/service/replies.js` (new): the reader

Reply file discovery (`replies.jsonl` or `replies-<agent>.jsonl`, the agent segment filtered through
`protocol.agentFromFilename` plus the safe-id rule before anything is joined to a path), byte-offset
reading per file, a held torn final line, a reset-and-refold on a file that shrank, and the fold itself.

Five things worth knowing:

- **Folding is idempotent by a derived event id.** `foldEventId` is a hash of the review, the filename
  and the line's own bytes, so a helper restart, a truncation, or an agent that rewrites its file
  instead of appending appends nothing the log already holds. The log's own idempotence is by
  `event_id`, so this needed no new mechanism.
- **Both outcomes go in the log.** A refused reply is a `reply.folded` event with `accepted: false` and
  the refusal text, not a dropped line. The reviewer has to be able to see that an agent answered and
  was refused; an item that silently stays outstanding while the agent believes it is done is the exact
  stall this tool exists to remove.
- **The conflict rule has a second half nobody wrote down.** "By revision first, then latest wins"
  cannot be implemented by calling `lifecycle.applyReply` twice, because the first answer moves the item
  out of `ready` and the second one is then refused for a reason that is not the real one. Two lines
  naming the SAME revision are rivals, not a sequence, so the rival is judged against the state the item
  was in before the first answer. A reply naming any other revision still goes through the ordinary path
  and is still refused as stale. This is the one place I added a rule rather than calling one.
- **Arrival order inside one pass is by filename**, so two machines fold the same two files the same way.
- **A malformed line is skipped and never fatal** (`reply.rejected` naming the file, the 1-based line
  number and the reason). A helper that exits on one agent's typo takes the reviewer's session with it.

### `src/service/projection.js` (rework): the log read back

`itemsFrom(events)` replays the log into current items; `project(review, events)` builds the
`review.json` body through `review_format.projectReview` (frozen, called and never edited);
`regenerate()` writes it; `createProjector()` keeps it fresh.

Three rules live here:

1. **The record rides in the event.** `sync.js` posts the whole record inside each event, so replaying
   the log is taking the newest record per item. There is no field-level event vocabulary to keep in
   step with the record shape.
2. **Lifecycle is per revision** (D5's merge rule, on the helper's side). A record arriving at a HIGHER
   revision drops the agent's answer, because that is the reviewer rewording after the agent read it. A
   record arriving at the SAME revision keeps the folded lifecycle, because it is the ordinary re-post
   and must not resurrect `ready` over `handled`.
3. **Drafts are not in the file at all** (R7). See the open question below; this is the one place I read
   the plan against the pinned contract text and had to choose.

### `src/service/review_writer.js` (rework): the single writer

It called `renderMarkdown` and `buildJson`, both of which 0A-wire removed. It is now
`writeReviewJson(projection, {dir, review})` or `{reviewRoot}`, on `projectReview` plus
`stringifyReview`. **One file, not a pair**: the markdown half belonged to the archived send model, and
the human-readable text is the library's own Copy and Export with no helper running (R10). Path safety,
symlink refusal, exclusive-create temp name and rename all stay exactly as they were.

### `src/layer/tab_done.js` (new): the Done tab, and what an answer does to a card

Handled items with their agent replies, each reopenable; the folded replies and rejected lines from 1B's
poll loop applied to the store and the cards; and the question treatment. It reads no reply file and
never edits `sync.js`: the helper is the single reader, and the library sees only what was folded.

Two decisions:

- **Reopening posts its own `item.reopened` event**, queued through the store's outbox so it survives a
  helper that is down. A re-post of the record would arrive at the same revision and be merged UNDER the
  agent's answer, putting the item straight back to handled.
- **The client refuses a stale fold too.** A fold can be honestly accepted by the helper and stale by the
  time it reaches this browser, which is exactly what an offline rewording produces. The same sentence is
  shown either way (`tabDone.STALE_NOTICE`).

### `src/cli/commands/wait.js` (new), wired through `src/cli/index.js`

Whole, to `protocol.WAIT`: the `seq` watermark, JSON-lines output (one line per item in the same shape
`review.json` uses, then a line holding the next cursor), the 300s default timeout, the five exit codes,
and it consumes nothing. Two waiters on one review both wake, and the same cursor twice prints the same
thing.

**One thing the wire did not answer and I had to decide:** D11's origin check allows only origins the add
step registered, and a command-line process has no origin. `wait` presents an origin the review already
registered, read out of the same owner-only readiness file the token comes from. Nothing is widened by
it: reaching that file already means holding the review's credential. If 0A-wire or 1A would rather the
CLI client be exempted from the origin check explicitly, that is a `protocol.checkRequest` change and it
is theirs, not mine.

## The one cross-task edit, and why

**`src/service/index.js` (1A's) gained exactly one line**, right before the server is created:

```js
projection.startWatching(deps);
```

Without a start hook, 3A is dormant: nothing folds reply files and `review.json` is never written, so
"an agent appends a line" does nothing at all. The projector discovers reviews by reading the reviews
directory on each tick, so this one line covers reviews that exist at boot AND every review `add` mints
later. `review.read` also starts the watch lazily, which is belt and braces for the same thing.

1A: this is yours to keep, move, or rename at CP3. It is additive and changes nothing else in `serve`.

## Tests, and what each one would catch

| Ranked test | File | The bug it catches |
| --- | --- | --- |
| 10 | `test/browser/agent_replies.spec.js` (two tests) | A stale "handled" swallowing a rewording, online and across a real `kill -9` with the rewording living only in browser storage |
| 20 | `test/unit/projection_review_json.test.js` | A draft reaching an agent, with the positive control on the same record after Cmd-Enter |
| 27 | `test/unit/projection_review_json.test.js` | The contract field drifting on the way through the log and the writer, and any acknowledge command reappearing in the file |
| 28 | `test/unit/projection_review_json.test.js` | An injected instruction reaching `note` or `change`, or breaking the file's own parse |
| 32 | `test/unit/reply_folding.test.js` + `test/browser/agent_replies.spec.js` | A non-deterministic winner, a dropped losing line, a half-parsed torn line, a malformed line taking the helper down |
| 35 | `test/browser/agent_replies.spec.js` | A note, an element comment or a selection comment that does not survive the round trip |

Plus `test/unit/cli_wait.test.js` (the five exit codes against the real helper, and that waiting consumes
nothing) and `test/unit/done_tab_replies.test.js` (the decision layer, headless).

**Two traps for whoever writes the next reply spec.**

1. **Two identical reply lines are one fold, on purpose.** A test that appends the same line twice and
   expects two folds is asserting against the idempotence rule. Vary the payload.
2. **The absence assertions need a positive control in the same wait.** "The torn line folded nothing"
   is also satisfied by the reader never running, so the spec writes a whole line to another file after
   the torn one and waits for THAT to fold. (The gate's own `no_arbitrary_sleeps` test caught the lazy
   version of this, correctly.)

## The demonstrated failure

Ranked test 10's stale case was written first and watched fail with no module behind it. The
demonstration the plan asks for is the one-line revert: skip the revision check in the fold.

```diff
--- a/src/service/replies.js
+++ b/src/service/replies.js
     var decision = lifecycle.applyReply(against, {
-      rev: reply[protocol.REPLY_FIELD.REV],
+      rev: against[record.FIELD.REV], // DELIBERATE REVERT: skip the revision check
```

```
not ok 1 - a reply naming a stale revision is refused and the reworded item stays outstanding
  error: |-
    the stale line is refused

    0 !== 1
  expected: 1
  actual: 0
  operator: 'strictEqual'
```

The failure reads exactly like the bug: the agent's answer to an old wording retires the reviewer's new
one, and nothing anywhere says so. Reverted, the same file is eleven passes.

## The question treatment

Ken's call at the wireframe: an agent's question is the loudest thing on a card, a distinct treatment and
not a tinted label, because a question the reviewer scrolls past is a stalled agent.

It borrows nothing new. One accent, the rail's own tokens, the rail's own type scale. What makes it loud
is placement, size and a demand:

- **Placement.** The card carrying a question is pulled to the top of its pane (`order: -1`) and marked
  `data-lahe-asking`, so a question cannot sit under three finished items. The card also takes the accent
  border, so the block and the card read as one object.
- **A rule of its own.** A 3px accent rule down the whole block, full bleed to the card's padding. It is
  the only element in the rail with one.
- **A name.** An eyebrow reading "claude is asking" in the accent ink. "An agent" is not who the reviewer
  is answering; the name comes from the reply itself, and absent one the card says "agent".
- **Size.** The question is 15px, one step above the reviewer's own words at 13.5px, which are otherwise
  the largest text in the rail.
- **A demand.** An Answer button that opens the box on this card. A question with nothing to press is a
  notification, and notifications get scrolled past.

**And it is said once.** The first build had the rail's own agent-message carrier AND this block on the
same card, which looked exactly as bad as it sounds: the same sentence twice, the loud one reading as a
repeat. A question no longer sets the rail's agent message at all; `handled` and `not_handled` still do,
because the quiet carrier is right for those. Verified in a real browser in light and dark.

Agent text is plain text everywhere: written with `textContent`, bounded by `review_format.boundData`
with the marker visible, never markup. The browser spec asserts that an agent sending `<b>page</b>` puts
zero elements inside the block.

## Open question for the orchestrator (CP3)

**Drafts are withheld from `review.json` entirely, rather than carried with `state: "draft"`.** The plan
says "only records the reviewer marked ready appear as actionable; drafts never do", and ranked test 20's
positive control ("the same record after Cmd-Enter **does appear among the items**") only means anything
if the draft did not appear at all. So they are withheld.

The pinned contract field says the other thing: *"Items with state draft are the reviewer still thinking,
so leave them alone."* That sentence is now belt and braces rather than a description of the file. It is
frozen text and I did not touch it. Either reading is defensible; the safer one is shipped, and the
contract sentence should probably lose its second half at the next contract revision.

## Renumbering done in the same commits

- `review_writer.js` said "Owner: Task 1D" and described a `review.md` / `review.json` pair from the
  archived send model, and cited "D10" for the fence delimiter. Now 3A, one file, D6 and D12, with the
  path-safety rules still cited to D11 where they belong.
- `projection.js` was a one-line stub citing "architecture D6" for a vocabulary (outstanding, delivered,
  applied, declined) that no longer exists. Now D5, D6 and D12 with the current state names.

## Cleanup needed

Nothing was deleted. For the Phase 4B batch:

- **`src/shared/review_format.js`'s fencing block** (`DELIMITER_PREFIX`, `makeDelimiter`, `fenceOpen`,
  `fenceClose`, `escapeDataLine` and their exports). **Confirmed fully orphaned:** `review_writer.js` was
  its last caller anywhere in `src/`, `test/` and `scripts/`, and this task moved it onto `projectReview`
  plus `stringifyReview`. `grep -rn "makeDelimiter\|fenceOpen\|fenceClose\|escapeDataLine\|DELIMITER_PREFIX"`
  now finds hits only inside `review_format.js` itself.
- `test/unit/consumer_3a_agent.test.js` — 0A-kernel's throwaway stub consumer for this task. It still
  passes; it is on the plan's cleanup list now that 3A has landed.
- `test/results` artifacts: `test-results/` (Playwright traces from this session, untracked and
  gitignored).
- Already on the plan's list and untouched here: `src/shared/cli_contract.js`,
  `src/service/verification.js`, `src/cli/commands/{next,ack,open,setup}.js`.

## Gate

`npm run gate:builder`, from this worktree, on Node 20:

```
lint passed (syntax: 148 files, no jsdom, manifest complete)
# tests 374
# pass 374
# fail 0
  1 skipped
  133 passed (21.5s)
```

The reply specs also run on all three lanes:

```
LAHE_ALL_BROWSERS=1 npx playwright test test/browser/agent_replies.spec.js
  18 passed (9.7s)
```

`dist/` was rebuilt locally for the browser tests and is **not** committed, per the plan's dist rule.

## Manifest

The one pre-authorized edit: `src/layer/tab_done.js`, `src/service/replies.js` and
`src/cli/commands/wait.js` lost their `planned: true` in the same commits that created them.
