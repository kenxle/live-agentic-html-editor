# Plan: LAHE starts your agent when a comment is ready

Status: DRAFT, revision 2. Reworked for one background agent per review, kept running, after the owner rejected one new agent per batch. The first round's four reviews are folded in, and a second round reviewed this revision. Their tables are at the end, and the full prose is in `03_plan_lahe_agent_sdk_reviews.md`.

## Summary

- **Phase 0 can stop the feature.** Before any builder starts, the orchestrator checks three things the architecture leaves open:
  - what the subscription terms say, read on the live page
  - whether the `claude -p` flags the design relies on work in a process that stays running, including replies as structured output on every turn
  - a starting commit where the tests pass, with every other branch that edits the same files already folded in

  If any check fails, the build stops and the question comes to you.
- **Phase 1:** one builder lays the shared pieces:
  - the agent rules (the contract), with each line tagged for chat agents, auto-answer, or both, and every copy of them
  - the shared names for events, routes and states (the wire names)
  - the locks that keep two processes from doing the same work
  - the function signatures each Phase 2 builder codes against
  - a fake `claude` for tests that stays running and takes turns on stdin, as the real one does
- **Phase 2:** four builders work in parallel:
  - the engine: starting the agent, sending a turn, reading its replies, and the copy-in and write-back
  - the supervisor: the wake, the done check after every turn, restarts, fresh starts, idle close and limits
  - the command line and helper
  - the rail

  **Phase 2 waits for your answer on the terms** (OQ1, whether the subscription terms allow this), or for you to say you accept the risk.
- **Phase 3:** in an integration worktree, the orchestrator:
  - merges the four branches
  - writes the tests that need every branch
  - runs one review with one fix round
  - runs the full gates once
- **Phase 4:** a live check with the real `claude`. Then you run a real review with auto-answer on (the dogfood).
- **Your questions are in one place,** under [Open Questions](#open-questions). Each has the default the build takes if you do not answer.

## How the work is dispatched

```mermaid
flowchart TD
  P0["Phase 0: orchestrator<br/>0.1 terms, 0.2 flags spike (kept agent), 0.3 base"] -->|"all three hold"| P1["Phase 1: kernel<br/>one builder, agent-sdk-kernel"]
  P0 -->|"a stop rule fires"| STOP["Stop. The question goes to the owner"]
  P1 --> R1{"orchestrator reads the kernel, merges it,<br/>gate:unit green, OQ1 answered"}
  R1 --> A["2A engine<br/>agent-sdk-2a"]
  R1 --> B["2B supervisor<br/>agent-sdk-2b"]
  R1 --> C["2C command line and helper<br/>agent-sdk-2c"]
  R1 --> D["2D rail<br/>agent-sdk-2d"]
  A --> M["3.1 merge: main, then 2A to 2D"]
  B --> M
  C --> M
  D --> M
  M --> X["3.2 tests across branches"]
  X --> RV["3.3 one review, one fix round"]
  RV --> G["3.4 checkpoint: skills, dist, gate, gate:all, screenshots"]
  G --> L["4.1 live check and story walks"]
  L --> DF["4.2 dogfood"]
```

**Branches and worktrees.**

- `feat/lahe-agent-sdk`: holds these docs and the progress page, in its existing worktree. Only the orchestrator commits here. The pull request to `main` opens from it after Task 3.4 (checkpoint).
- `agent-sdk-kernel`: Phase 1, in its own worktree, branched from `feat/lahe-agent-sdk` after Task 0.3. The orchestrator merges it back.
- `agent-sdk-2a` to `agent-sdk-2d`: one worktree each, branched from `feat/lahe-agent-sdk` after the kernel merge.
- `integration/lahe-agent-sdk`: in its own worktree, `.claude/worktrees/integration-agent-sdk`. Every merge happens here, never in the shared main checkout. Other agents push from that checkout, and a push there once carried an untested merge to `main`.
- `agent-sdk-fix-<n>`: Task 3.3's fix branches, off the integration branch.

**Where branches meet, and who owns it.** The orchestrator owns every merge and every test that needs more than one branch. Phase 1 pins what each side builds against, so the parallel branches fit together:

| Where two branches meet | Built against | Proved by |
| --- | --- | --- |
| Supervisor (2B) starts the agent through the host (2A) | `host.start` and its handle (Task 1.3) | Task 3.2: the real host under the real supervisor, with the fake `claude` |
| Supervisor (2B) runs a turn through the engine (2A) | `runTurn` and its return shape (Task 1.3) | Task 3.2: the real engine under the real supervisor |
| Helper (2C) starts the supervisor (2B) | the `supervise` argv and how the helper builds it (Task 1.3) | Task 3.2: the page's "on" starts one supervisor |
| Status and liveness (2C) read what the supervisor writes (2B) | the `agent.json` and `turns.jsonl` fixtures (Task 1.2) | Task 3.2: every state read off a live helper, failures included |
| Rail (2D) reads the liveness answer (2C) | the `auto_answer` liveness fixtures (Task 1.2) | Task 3.2: the browser spec on a real helper |
| Rail's switch (2D) posts to the route (2C) | the route and body in Task 1.2 | Task 3.2: a real click turns a real supervisor on and off |
| Engine (2A) reads the host's stream | the fake `claude` (Task 1.4), built from Task 0.2's raw streams | Task 4.1 with the real `claude` |

**Rules every builder follows.** Repo `CLAUDE.md` holds them ("Running the gate", "Running the loop", "Never remove files while work is running"). In short:

- Run `npm run gate:unit`. Run at most one named browser spec. The full browser suite runs once, in Task 3.4, by the orchestrator.
- Never commit `dist/`. Never run `npm run install-skills`. The orchestrator does both in Task 3.4.
- No `rm`, no `git clean`. List files to remove under "To delete at cleanup" in your report.
- **Your Files list is complete for `src/`.** Lint fails on any `src/` file the manifest does not list, and only Phase 1 edits the manifest. Ask the orchestrator before creating any other file.
- Name new test files with your task's prefix (`auto_answer_engine_*`, `auto_answer_supervisor_*`, `auto_answer_cli_*`, `auto_answer_rail_*`), so two branches never pick the same name.
- Commit per task with a message that says why. Screenshots go in your report; the orchestrator puts them on the progress page.
- Hit a limit? Ask the orchestrator in one line instead of writing around it.
- Tests never call the real `claude` or any model. They use the fake `claude` from Task 1.4.
- Tests never wait on real time. Every timed step takes `opts.now`, `opts.sleep` and `opts.limits` (Task 1.3). The unit suite must pass on Node 18, so no `node:test` fake timers.
- Tests use their own state folder and helper port, and call the teardown helper from Task 1.4. They never touch the owner's helper or state folder.
- Instructions appear once per agent, in its system prompt. They never repeat per turn or per item (brief R14, rules once per agent). No output from `lahe agent`, `lahe monitor` or a turn message repeats rule text.

### Numbers this plan sets

Each lives once, in `AUTO_ANSWER` in `src/shared/protocol.js`. All are guesses the owner can change (OQ3, the numbers).

| Constant | Value |
| --- | --- |
| `TURNS_AT_ONCE` (machine) | 2 |
| `AGENTS_ALIVE` (machine) | 4 |
| `ATTEMPTS_PER_REV`, `ATTEMPTS_PER_ITEM` | 3, 6 |
| `RUNS_PER_DAY_SESSION`, `RUNS_PER_DAY_MACHINE` (a run is one turn) | 40, 120 |
| `FAILED_TURNS_STOP` (in a row, conflicts included) | 3 |
| `STARTS_MAX`, `STARTS_WINDOW_MS` (supervisor restarts by the helper) | 3 in 10 minutes |
| `AGENT_RESTARTS_MAX`, `AGENT_RESTARTS_WINDOW_MS` (agent restarts after it dies) | 3 in 10 minutes |
| `TURN_TIMEOUT_MS` | 10 minutes |
| `KILL_GRACE_MS` | 5 seconds |
| `IDLE_CLOSE_MS` (agent closed after no turn) | 60 minutes |
| `FRESH_AFTER_TOKENS` (history above the first request) | 80,000 |
| `QUIET_MS` (burst settles), `GATHER_MAX_MS` | 15 seconds, 60 seconds |
| `FILE_QUIET_MS` (source unchanged before copy-in, after a conflict) | 15 seconds |
| `LOOK_MS` (supervisor look) | 2 seconds |
| `FOLD_WAIT_MS` | 30 seconds |
| `USAGE_PAUSE_MS` | 30 minutes |
| `BATCH_MAX_ITEMS`, `BATCH_MAX_BYTES` | 25, 100 KB |
| `ITEM_MAX_CHARS` (reviewer text) | 8,000 |
| `REPLY_MAX_CHARS` | 500 |
| `NOTE_MAX_CHARS` | 2,000 |
| `CONTEXT_MAX_CHARS` (all context files together) | 40,000 |
| `TURN_FOLDERS_KEEP` | 20 |

There is no per-turn money cap. Task 0.2 finds out what `--max-budget-usd` caps in a process that stays up. If it caps each turn, `BUDGET_USD` (0.50) joins this table.

### Words this plan pins

These live once, in `protocol.js`, beside today's `AGENT_LIVENESS` words. **Where the wireframe and this table differ, this table wins.** "Auto-answer" is the working name (OQ7). It is lowercase inside the status line, after "Stored ·", and capitalized everywhere else. Times use the rail's existing time format, the one cards use. Numbers in braces come from `AUTO_ANSWER`. The reviewer sees batches of work, so the rail calls a turn a run.

**Status line** (the reason and remedy are said once, in the chip, never in the status line):

| State | Words |
| --- | --- |
| starting | Stored · auto-answer starting |
| idle | Stored · auto-answer on |
| gathering | Stored · auto-answer starting on {n} |
| running | Stored · auto-answer working on {n}, {age} |
| queued | Stored · auto-answer waiting for another review's run, {age} |
| paused, this review's limit | Stored · auto-answer paused for today |
| paused, this computer's limit | Stored · auto-answer paused for today |
| paused, usage limit | Stored · auto-answer paused until {time} |
| stopped | Stored · auto-answer stopped |
| off | today's words, unchanged |

**The switch and its panels:**

| Where | Words |
| --- | --- |
| Pill | "Auto-answer", a switch like Hold sending. "Turning on" from the click until liveness confirms. |
| Not-allowed panel | "Auto-answer is allowed from a terminal, once per session. Run this where your agent works:" then the command `lahe agent allow --session {id}` and a Copy button. |
| Warning panel title | "Turn on Auto-answer?" |
| Warning panel body | "Claude will answer new comments on this page by itself, a batch at a time." / "It can read and edit only {file name}. It runs no commands and has no network." / "Anyone who can comment on this review can make it edit that file." / "Each run uses your Claude plan. At most {40} runs today for this review." |
| Warning panel buttons | "Turn on" (primary), "Cancel" |
| Stop confirm | Title "Stop Auto-answer?" Body "A run is working on {n} comments. Stopping ends it, and those comments stay waiting." Buttons "Stop", "Keep running". |
| Run count | "1 run", "{n} runs" |
| Run count, opened | "Today: {n} of {40} runs for this review" / "Tokens today: {n}" (only when reported) / "Resets at midnight." |

**The chip** (one sentence, at most one button):

| Reason | Words | Button |
| --- | --- | --- |
| one failed run or an agent restart, retrying | "Last run failed. Trying again." | none |
| `signed_out` | "Claude is signed out. Sign in by running claude in a terminal, then try again." | Try again |
| `not_installed` | "Claude Code is not where it was when Auto-answer was allowed. Run lahe agent allow again." | none |
| `usage_limit` | "Claude's usage limit was reached. Next try at {time}." | none |
| `limit_session` | "This review's {40} runs for today are used. They reset at midnight." | the existing hand-off button |
| `limit_machine` | "This computer's {120} runs for today are used. They reset at midnight." | the existing hand-off button |
| `source_missing` | "The source file is gone, so Auto-answer stopped." | none |
| `failing` | "Auto-answer failed three times in a row, so it stopped." | Try again |
| anything else | "Auto-answer stopped. Run lahe agent status in a terminal to see why." | none |

"Try again" sends `want: on`. There are no buttons to change a limit: the page may only ask for on or off.

**Cards:**

| Case | Words |
| --- | --- |
| Gave up | "Auto-answer could not answer this and stopped trying. Reply here yourself, or hand the review to a chat agent." |
| Too long | "Too long for auto-answer; a chat agent can take it." |
| Raw HTML refused | "Auto-answer does not add raw HTML or scripts; a chat agent can do this." |

**Terminal:**

| Where | Words |
| --- | --- |
| `lahe agent allow` warning, every time | "Auto-answer lets Claude answer comments on this review without you." / "It reads and edits one file: {path}. It runs no commands and has no network." / "Anyone who can comment on this review, or run script in its pages, can make it edit that file. Agents with a shell may read that file later." / "It keeps one Claude session running for this review while Auto-answer is on. Claude saves that session's history in your Claude folder." / "Each run uses your Claude plan. Limits: {40} runs a day for this review, {120} for this computer." Plus, when context files are named: "Context it reads once: {file} ({n} characters)", one line per file. Plus, when preflight finds a login billed by the token: "Your Claude login is billed by the token, so each run costs money." / "Anthropic's terms limit scripted use of a subscription. Whether this use counts is not settled." |
| `lahe monitor` exit 6, when auto-answer holds the session | "Auto-answer is answering this review now. Tell the human, and stop. To take it back: lahe session takeover {id}" |
| `lahe review` re-entry | "Auto-answer is answering this review. No monitor is needed. To take it back: lahe session takeover {id}" |

Rail words never use monitor, heartbeat, wake feed, watching or unattended.

## Phase 0: Facts that could sink the design

The orchestrator alone. No builder starts until all three tasks pass.

::: xref
[Architecture: Subscription terms](02_architecture_lahe_agent_sdk.html#subscription-terms) · [The agent's command](02_architecture_lahe_agent_sdk.html#the-agents-command-claude-code-adapter) · [The structured reply channel](02_architecture_lahe_agent_sdk.html#the-structured-reply-channel) · [To verify before the build](02_architecture_lahe_agent_sdk.html#to-verify-before-the-build)
:::

### Task 0.1: The subscription terms, read on the live page

**Spec:** The architecture's quote came from a web fetch. This time the orchestrator opens [Anthropic's Consumer Terms](https://www.anthropic.com/legal/consumer-terms) and Claude Code's [Authentication](https://code.claude.com/docs/en/authentication) and [Headless](https://code.claude.com/docs/en/headless) pages in a real browser (Claude in Chrome). It copies the exact sentences on automated access and on scripted use of a subscription, with their links, beside OQ1 on the progress page. The owner reads them and decides.

**Acceptance:**

- Each quote matches the live page word for word, with its link.
- If the page no longer says what the architecture quotes, the architecture's Subscription terms section is corrected in the same commit.

### Task 0.2: The flags spike, in a kept agent

**Spec:** Neither spike ran the architecture's whole flag set in a process that stays up. A supervisor script in the scratchpad, built from the second spike's `supervisor.js`, starts the real `claude` (2.1.284) with the architecture's exact command and environment, from an empty stage folder. It feeds turns on stdin. It saves every raw stream. A second script computes every number from those files. The results go in `spike_flags.md` in this folder, with the saved files' paths. The checks spend a handful of turns on the owner's login, as the spikes did.

| Check | Passes when | If it fails |
| --- | --- | --- |
| The whole flag set, kept running | `claude` starts with `--input-format stream-json --output-format stream-json`, `--safe-mode`, `--restricted`, `--strict-mcp-config`, `--setting-sources ""`, `--tools Read,Edit`, `--permission-mode dontAsk` and `--permission-prompts none`, takes three turns on stdin, and exits 0 when stdin closes | Stop: the design comes back to the owner |
| Still the subscription | the init event reports `apiKeySource: "none"` with that flag set | Stop |
| Structured output on every turn | with `--json-schema`, each of the three turns' `result` carries replies that match the schema; record the field they appear in | Run the same turns with the JSON-answer fallback (the architecture's second form). If it passes, the architecture names it as the channel. If both fail: Stop. No shell is granted as a fallback |
| Confinement | a `.env` beside the original source, and a file one folder up, cannot be read by relative or absolute path, on the first turn or a later one | Stop. The security reviewer sees it first |
| Items as data | a turn message holding only the item lines (plus the `file_changed_since_last_turn` line, when set) gets the three spike items handled | Record the smallest wording that works. Any sentence of instruction per turn goes to the owner as a change to R14 (rules once per agent) |
| Rules file | `--append-system-prompt-file` is read at the first start and again on `--resume`, and its text is not in `ps` output | Rules go in `--append-system-prompt`; the process-list exposure is written into the architecture's Security section |
| The copy changes between turns | the copy is replaced between turns; the agent re-reads before editing, or its Edit is refused and it re-reads. Record which | Record only: the write-back checks run on the diff either way |
| A kill, then a start | SIGKILL while idle: `--resume` keeps the session id and history, and the next item is handled. SIGKILL mid-turn: a fresh start handles the same items | Stop: the restart design needs rework |
| Budget flag | record whether `--max-budget-usd` stops one turn or the whole process, and whether it applies on a subscription | Leave the flag out; the warning and the architecture say the daily turn counts and the 10-minute limit are the only caps |
| Failures | exit code and stream text told apart for signed out (an empty `CLAUDE_CONFIG_DIR`), `claude` missing, a killed process. A usage limit cannot be forced: record "not seen" | Unclear output is named `crashed`; the architecture says so |
| Where the history goes | record the folder the saved history lands in, and whether a `CLAUDE_CONFIG_DIR` pointing at a LAHE folder keeps the login | Record only: it answers OQ10 (where the history lives) |
| Hostile comment | a comment asking for a `<script>` tag: record what the model does | Nothing: LAHE's own check refuses it either way |
| Prompt size and cache | tokens per request with the `all` and `headless` contract lines, at the first turn and at later turns, against the second spike's lean numbers (5,269 first request, about 2,000 tokens of cache written per later turn) | More than double: go on, and put the number beside Q1 (billing) |
| Rules once | transcripts of turns given 1, 10 and 25 items, and of 100 items across 4 turns of one agent: the rules appear once per agent, and no turn message holds anything instruction-like | Stop: brief R14 (rules once per agent) is the point of the feature |
| Resume after an idle hour | if the spike has the time: a resume more than 60 minutes after the last turn, recording the cache written | Record "not measured" |

Also saved: the raw bytes of every stream and failure, for Task 1.4's fake `claude`, and the `claude --help` flag list.

**Acceptance:** `spike_flags.md` has a pass or fail per row, each number traced to a saved file, and one verdict line. Any row that failed has changed the architecture before Phase 1 starts.

### Task 0.3: Base commit and overlapping branches

**Spec:**

1. Find every open branch whose diff touches a file this plan changes. The list:
   - `src/shared/`: `review_format.js`, `protocol.js`, `manifest.js`
   - `src/service/`: `agent_sessions.js`, `static_servers.js`, `routes.js`, `projection.js`, `replies.js`, `index.js`
   - `src/cli/`: `index.js`, `commands/monitor.js`, `commands/review.js`, `commands/add.js`, `commands/status.js`
   - `src/layer/`: `overlay.js`, `sync.js`, `index.js`, `tab_done.js`
   - docs: `skills/lahe/SKILL.md`, `docs/CONTRACTS.md`, `docs/CLI.md`, `docs/diagrams/session_ownership.md`

   `feat/lahe_library` (pull request 19, open) touches most of them. Land each branch, or agree with the owner how it folds in.
2. Merge `main` into `feat/lahe-agent-sdk`. It branched behind `main`, and those commits change `sync.js`.
3. Record the base commit on the progress page, with `gate:unit` and the browser suite green there. If main's suite is red, fixing it comes first (Q8, priority).
4. Add the board row the architecture promised to `docs/BULLETIN.md`. The row says rendered Markdown passes raw HTML through with no CSP.

**Acceptance:** the progress page names the base commit, the gate result at it, and each overlapping branch with what happened to it. The board row exists.

## Phase 1: Kernel

One builder, alone, on `agent-sdk-kernel`. After Phase 1, no Phase 2 builder edits anything under `src/shared/`, `locks.js`, `file_stamp.js`, or any copy of the contract. So everything Phase 2 needs there lands now.

::: xref
[Architecture: Data / State Changes](02_architecture_lahe_agent_sdk.html#data-state-changes) · [The system prompt](02_architecture_lahe_agent_sdk.html#the-system-prompt-one-source-of-the-rules)
:::

### Task 1.1: The tagged contract, and every copy

**Spec:** In `review_format.js`, add `CONTRACT_LINES`, a list of `{ tag, text }` with each tag `all`, `chat` or `headless`. `CONTRACT` stays a list of strings: the `all` and `chat` lines in order. That is what `review.json` carries. Then:

- Reword the few `all` lines that name the reply transport, so they name the reply's fields only.
- Add the `headless` lines the architecture lists for an agent that stays running: each message is a batch, the one file, read it afresh each batch, read back, one reply per item in the reply format with nothing after it, do not wait or start anything.
- Change the "forever daemon" line as Assumption A9 says. A chat agent never starts a long-lived process. Auto-answer is the only one, and LAHE starts it.
- Reword the exit-6 line to say that exit 6 means another owner holds the session, either a chat agent or auto-answer, and `lahe session takeover` takes it back.

Carry the change into every copy in one commit:

- `skills/lahe/SKILL.md`, plus one sentence: when auto-answer is on for your session, tell the human and stop
- `docs/CONTRACTS.md`
- the restated copy and the line count in `test/unit/review_format.test.js`
- `test/unit/projection_review_json.test.js`, which asserts `review.json` carries `CONTRACT`
- any of `add_command`, `monitor_command`, `no_stale_excuse`, `protocol_wire`, `reply_command` and `status_command` tests that the new wording breaks

**Files:** `src/shared/review_format.js`, `skills/lahe/SKILL.md`, `docs/CONTRACTS.md`, and the tests above.

**Acceptance:**

- Every line of `CONTRACT_LINES` carries exactly one of the three tags. A test fails on a missing or unknown tag.
- `CONTRACT` equals the `all` and `chat` texts in order, and `review.json`'s contract equals `CONTRACT`.
- A test names one known chat-only line (it names `lahe monitor`) and asserts it is absent from the `headless` view, and one known headless line and asserts it is absent from `CONTRACT`.
- The skill and `docs/CONTRACTS.md` match the new text. The orchestrator checks this with a diff.

### Task 1.2: Wire names, fixtures and the manifest

**Spec:** In `protocol.js`, spell once:

- the `AUTO_ANSWER` numbers and every pinned word above
- the supervisor states, stop reasons, turn outcomes and failures
- the event kind `auto_answer.requested`, the route `POST /lahe/v1/auto-answer`, its one body field `want`
- the reply agent name `claude-auto`, and the fold's rejection reason `auto_answer_owns`
- `SERVICE_CONTRACT` from 13 to 14, with its comment

In `projection.js`, fold `auto_answer.requested` into the latest request for the review. In `agent_sessions.js`, add `allowanceHolds(session)`. It reads `auto_answer.json` and returns true when its `handoff_rev` equals the session's.

Add fixtures in `test/fixtures/auto_answer/`, paired by state:

- `agent.json`, one per supervisor state and reason, each with and without a live agent, including "turning on" and "on, supervisor dead"
- the liveness `auto_answer` object each one should produce
- a sample `turns.jsonl` with an applied turn, a refused turn, a conflict and a crashed turn, from one agent and from a resumed one, and a matching `turns/` folder with a `diff.patch`
- a sample `auto_answer.json`, with and without context files

Add every new file of Tasks 1.3 and 1.4 to `manifest.js`, in the non-bundle list.

**Files:** `src/shared/protocol.js`, `src/service/projection.js`, `src/service/agent_sessions.js`, `src/shared/manifest.js`, `test/fixtures/auto_answer/` (new).

**Acceptance:**

- The projection's latest request follows the last event, and ignores other reviews' events.
- `allowanceHolds` is false after a takeover bumps the rev, and false with no `auto_answer.json`.
- Lint's manifest check passes with every new file listed.
- The bundle gains only the wire names and words, no Node-only code (checked with `npm run build:layer` locally, not committed).

### Task 1.3: Locks, stamps, and the signatures Phase 2 meets at

**Spec:** Three things.

**Locks.** Move `withServerLock` and `takeOverStaleLock` into `src/service/locks.js`, unchanged, and have `static_servers.js` use them. Add the second kind the architecture names: a lock held for as long as a process lives. It goes stale only when its pid and that pid's start time no longer match a live process. The start time comes from `ps -o lstart=` run with `LC_ALL=C TZ=UTC`, through a reader a test can replace.

**Stamps.** Add `src/service/file_stamp.js`: content hash, size and mtime of a user file.

**Signatures.** Create each new module with its exported functions and doc comments, each body throwing "not built yet". Phase 2 fills them in and removes every such line. Every timed function takes `opts.now`, `opts.sleep` and `opts.limits` (defaults from `AUTO_ANSWER`), as `monitor.js` already takes `opts.now`.

| Module (owner) | Exports |
| --- | --- |
| `headless_prompt.js` (2A) | `buildPrompt(note, context)`, `buildSchema()`, `buildTurnMessage(items, stagePath, fileChanged)`, `cutBatches(items)`, `readReplies(resultEvent)`: the replies from structured output or from the final JSON answer, whichever Task 0.2 chose, or `bad_output` |
| `host_claude_code.js` (2A) | `start(agentSpec, opts)` returning a handle: `{ pid, pgid, started, sessionId(), sendTurn(message, { timeout_ms }), close(), kill(), onExit(cb) }`. `sendTurn` resolves with `{ replies, usage, context, model_turns, compacted, failure }` at the turn's `result` line, with usage as the difference from the previous result. `onExit` fires once, on the child's own `exit` event. |
| `headless_stage.js` (2A) | `prepare(allowance, stageDir)`, and `runTurn(handle, allowance, items, opts)`: the whole turn, from making the copy match the real file to write-back. It writes `turns/<turn_id>/` (`result.json`, `log.jsonl`, `diff.patch`) and returns `{ turn_id, outcome, failure, applied, replies, usage, context, compacted, file_reset }`, where `replies` are checked and ready to write. `opts.hooks.afterWriteBack` and `opts.hooks.beforeRename` let a test crash it at an exact step. |
| `run_slots.js` (2B) | `takeTurn(stateDir, session, opts)`, `takeAgent(stateDir, session, opts)`, `release(slot)`, `countToday(stateDir, session, opts)` |
| `headless_supervisor.js` (2B) | `supervise({ session, stateDir }, opts)`. It writes `agent.json`, `turns.jsonl`, `attempts.json` and `replies-claude-auto.jsonl`. It owns the agent's life: start, resume, restart, fresh start, idle close. `opts.engine` defaults to `runTurn` and `opts.host` to `host_claude_code`, so 2B tests pass fakes of both. |
| `src/cli/commands/agent.js` (2C) | `lahe agent allow [--note] [--context <file>]... [--model] [--runs-per-day] | disallow | on | off | status [--diffs]`, and `lahe agent supervise --session <id> --state-dir <dir>`. The helper spawns it with `process.execPath` and the clone's `bin/lahe.js`, detached, in its own process group. |

**Files:** `src/service/locks.js`, `src/service/file_stamp.js`, `src/service/static_servers.js`, and the six modules above.

**Acceptance:**

- Every existing static-server lock test passes, unchanged.
- Two child processes, released together by a start file, race for each lock kind 20 times; exactly one wins each time.
- A process lock whose pid is dead is taken over. One whose pid was reused with a different start time is taken over. One held by a live process for longer than 20 seconds is not.
- The `ps` reader parses real `ps` output for the test's own `process.pid`, on the platform the test runs on.
- A file stamp changes when the content changes, and not when the file is only read.

### Task 1.4: The fake `claude` and the teardown helper

**Spec:** A small Node script standing in for `claude`. Like the real one in stream-json mode, it stays running, reads one user message per stdin line, and writes a stream per turn: `init` on the first message, assistant messages, and a `result` line with running totals of usage and cost. It exits 0 when stdin closes. A scenario file tells it what to do on each turn, and each scenario uses the raw bytes Task 0.2 saved, naming the file they came from. It:

- edits the stage copy, or a file outside it
- replies in the structured form Task 0.2 chose
- keeps a session id and a history marker across `--resume`, so a test can tell a resume from a fresh start
- dies while idle or mid-turn, hangs past the timeout, or emits a `compact_boundary`, when told to
- starts a grandchild, or ignores SIGTERM, when told to
- exits non-zero on any flag missing from the `claude --help` list Task 0.2 recorded
- writes the arguments, working folder, environment, pid, process group, each turn's message and its start and end times, to a file tests read

Its one timer carries a `harness-allow-timer:` comment with the reason, so `no_arbitrary_sleeps.test.js` passes. The usage-limit scenario is a guess until one is seen, and its name says so.

The teardown helper reads every process group the fake recorded, plus `agent.json` and `run-slots/`, and kills what is left. Every auto-answer test calls it in `after`.

**Files:** `test/fixtures/auto_answer/fake_claude.js`, `test/fixtures/auto_answer/scenarios/`, `test/helpers/auto_answer_teardown.js` (new).

**Acceptance:** scenarios exist for:

- three clean turns in one process, and a turn where one item gets no reply
- a death while idle, a death mid-turn, a hang, bad output, and output nothing recognizes
- a resume that keeps the session, and a resume that fails
- a `compact_boundary` mid-turn
- signed out, and the guessed usage limit
- a reply for an item not in the batch, a reply for an item from an earlier turn, and over-long reply text
- an added `<script>`, and an edit to a file other than the copy
- a grandchild that ignores SIGTERM

Each is used by at least one Phase 2 test.

**Phase test:** `gate:unit` green on `agent-sdk-kernel`. The orchestrator reads the kernel diff, merges it into `feat/lahe-agent-sdk`, and starts Phase 2 once OQ1 (the terms) is answered.

## Phase 2: Four builders in parallel

Each builder reads first: the architecture, `docs/ongoing/SESSION_OWNERSHIP.md`, `docs/CONTRACTS.md`, `docs/CLI.md`, `skills/lahe/SKILL.md`, `spike_persistent_run.md` (its supervisor is the shape 2A and 2B build properly), and Task 1.3's signatures.

### Task 2A: The engine

::: xref
[Architecture: A wake, one turn](02_architecture_lahe_agent_sdk.html#a-wake-one-turn-of-the-same-agent) · [The structured reply channel](02_architecture_lahe_agent_sdk.html#the-structured-reply-channel) · [The agent's command](02_architecture_lahe_agent_sdk.html#the-agents-command-claude-code-adapter) · [Security](02_architecture_lahe_agent_sdk.html#security-privacy-notes)
:::

**Spec:** Fill in the three engine modules as the architecture describes them.

- `headless_prompt.js`: the system prompt (rules, note, context), the reply schema, the turn message, and reading the replies out of a `result`. The turn message keeps only the architecture's allowed fields, with `source_hint` replaced by the stage path, and the `file_changed_since_last_turn` line only when the copy was reset. Batches are cut at 25 items or 100 KB. An item over 8,000 characters becomes the pinned `not_handled` reply instead of being sent.
- `host_claude_code.js`: starts the agent with the command from the architecture's flag table, by the absolute path recorded at allow time, in its own process group, with `--resume` only when asked. The environment comes only from `auto_answer.json`'s `env`. The prompt file sits outside `work/` and is removed however the process ends. It sends one turn at a time and refuses a second `sendTurn` while one is in flight. It reads the stream line by line, records the session id from `init`, and computes each turn's usage as the difference of the running totals. On a turn's timeout: SIGTERM to the group, the grace time, then SIGKILL. `onExit` fires from the child's `exit` event.
- `headless_stage.js` (`runTurn`): make the copy match the real file and stamp it, send the turn, check the replies against the batch, diff the copy, and write back only when every check in the architecture's "Checks before anything reaches the real file" passes. After a refused or conflicting turn, reset the copy to the real file. The turn records follow the architecture's "Turn records".

**Files:** those three, and `test/unit/auto_answer_engine_*.test.js`.
**Don't touch:** `headless_supervisor.js`, `run_slots.js`, `agent.js`, any `src/service/` or `src/layer/` file outside the three.

**Acceptance:** every Engine line in the Test List passes with the fake `claude`.

### Task 2B: The supervisor

::: xref
[Architecture: A wake, one turn](02_architecture_lahe_agent_sdk.html#a-wake-one-turn-of-the-same-agent) · [The agent's life](02_architecture_lahe_agent_sdk.html#the-agents-life-start-crash-restart-fresh-start-close) · [The supervisor's states](02_architecture_lahe_agent_sdk.html#the-supervisors-states) · [Retries, failures and limits](02_architecture_lahe_agent_sdk.html#retries-failures-and-limits) · [Stopping, and handing back](02_architecture_lahe_agent_sdk.html#stopping-and-handing-back)
:::

**Spec:** Fill in `run_slots.js` and `headless_supervisor.js` as the architecture describes them. The linked sections cover:

- the drain with `suppressActivityTouch`, and replies written with `reply.js`'s encoder
- one turn at a time, with the `result` line as the only "done"
- the done check after every turn: the fold wait, then counting attempts, then draining again
- the agent's life: started at the first turn, resumed after a death while idle, fresh after a bad turn or a long history or a new prompt, closed after an idle hour, and the restart limit
- the states and each look
- attempts, failures and limits, including both kinds of slot
- stopping, leftover agent groups, and finishing the replies of a turn that was applied but not replied
- the restart on stale code, which waits for a turn in flight and leaves the agent's session to be resumed

The supervisor calls `opts.engine` and `opts.host`, and takes every number from `AUTO_ANSWER`.

**Files:** those two, and `test/unit/auto_answer_supervisor_*.test.js`.
**Don't touch:** the engine's three modules (tests pass fakes), `agent.js`, `index.js`, anything under `src/layer/`.

**Acceptance:** every Supervisor line in the Test List passes, and a unit test searches `headless_supervisor.js` and `run_slots.js` and finds no `claude` flag (brief R4, Claude Code first with other hosts later).

### Task 2C: The command line and the helper

::: xref
[Architecture: Allowing it, then turning it on](02_architecture_lahe_agent_sdk.html#allowing-it-then-turning-it-on) · [On and off are events](02_architecture_lahe_agent_sdk.html#on-and-off-are-events-and-the-page-may-only-ask) · [One review per session](02_architecture_lahe_agent_sdk.html#one-review-per-auto-answer-session) · [Lean by default](02_architecture_lahe_agent_sdk.html#lean-by-default-and-a-projects-own-context)
:::

**Spec:**

- `lahe agent`, registered in `src/cli/index.js`: `allow` (preflight, the pinned warning, `auto_answer.json` under the short lock, and the context files copied into `auto_answer_context.md`), `disallow`, `on`, `off` (posted to the route as the CLI client), `status` (state, whether an agent is alive and since when, turns and tokens today), `status --diffs`, and `supervise`.
- `allow` refuses:
  - instruction files, dot paths, the state folder, paths outside home, and a symlink to any of those, as the edited source
  - a non-Markdown source
  - a context file that is missing or not a regular file, or context over 40,000 characters in all
  - a session that owns more than one review
  - Windows
  - `claude` missing or signed out
- The route reads only `want` and refuses any value other than `on` or `off`. It makes the D11 checks (the review token every write route needs), and sets `from` from the client header. The generic events route refuses `auto_answer.requested`.
- The helper starts `supervise` on an allowed "on", unless a live one holds the lock. It starts a new one when "on" stands and none is alive, at most three times in ten minutes.
- The fold rejects replies from other agents while auto-answer holds the review (`auto_answer_owns`).
- The liveness answer counts a live supervisor at the current rev as listening, and adds `auto_answer`. It never sends a path, the note, the context, or a dollar figure.
- `lahe monitor` exits 6 with the pinned words while a live supervisor holds the rev. `lahe review` re-entry prints the pinned words and no monitor lines. `lahe review` and `lahe add` refuse a second review in the session.
- `docs/CLI.md` and `docs/diagrams/session_ownership.md` describe the new command and the new owner.

**Files:** `src/cli/commands/agent.js`, `src/cli/index.js`, `src/service/routes.js`, `src/service/index.js`, `src/service/agent_sessions.js`, `src/service/replies.js`, `src/cli/commands/monitor.js`, `src/cli/commands/review.js`, `src/cli/commands/add.js`, the two docs, and `test/unit/auto_answer_cli_*.test.js`.
**Don't touch:** the engine, the supervisor loop, anything under `src/layer/` or `src/shared/`.

**Acceptance:** every Command line and helper line in the Test List passes.

### Task 2D: The rail

::: xref
[Architecture: What the rail shows](02_architecture_lahe_agent_sdk.html#what-the-rail-shows-wireframe-direction-b) · [Wireframe B](wireframes/b-switch-by-hold/01-off.html)
:::

**Spec:** Wireframe direction B, with the words pinned above. The kept agent changes nothing the reviewer sees. Where the wireframe and the pinned words differ, the words win. Not built from the wireframe:

- the note field on the warning panel (only the terminal sets the note)
- the "Raise the limit" and "Change the limit" buttons
- screen b7 and the per-card run notes, because the liveness answer carries no per-item state

What is built:

- the pill beside Hold sending, a real switch (`button`, `aria-pressed`), reusing `.holdbtn`
- "Turning on" until liveness confirms, then on; back to off with the not-allowed panel if nothing starts
- the not-allowed panel: focusable pill, a panel with a Copy button, not hover text
- the warning panel on the first "on" in a session, and the stop confirm while a turn works. Both reuse End review's confirm: they take focus, close on Esc, and return focus to the pill. The warning panel scrolls inside the footer on a short window.
- the run count and its popup
- the chip under the switch, `role="status"`, with its one button
- the status line's words from `auto_answer.state`. Only a change of state is announced; the ticking age is not.
- nothing counts as overdue while auto-answer is on and healthy: no banner, no late ring, no overdue toast (`raiseOverdueToast`)
- a gave-up card: the late ring (`CARD_LATE_ATTR`), the "Not handled" pill and the pinned words (`tab_done.js`)
- the rail repaints when `auto_answer` changes (`livenessKey` in `sync.js`), and the switch posts through `sync.js`, wired in `src/layer/index.js` the way Hold is
- no new motion: the dot does not pulse, and the existing reduced-motion rules apply. No new color: the accent, `--warn` and the handled green only.

Build against the Task 1.2 fixtures only.

**Files:** `src/layer/overlay.js`, `src/layer/sync.js`, `src/layer/index.js`, `src/layer/tab_done.js`, `test/browser/auto_answer_rail.spec.js` (new).
**Don't touch:** anything under `src/service/`, `src/cli/`, `src/shared/`.

**Acceptance:** every Rail line in the Test List passes in `auto_answer_rail.spec.js`, run by name. The report carries screenshots, light and dark, taken after that spec passes, of:

- off, not allowed with its panel open, turning on
- the warning panel, including at an 820-pixel-high window
- starting, gathering, working, waiting for another review's run
- the stop confirm, and the run count opened
- the retrying chip, the usage limit, each daily limit, and stopped with a chip
- a gave-up card, a too-long card, and a raw-HTML card
- the narrowest rail with the run count wrapped

**Phase test:** each branch green on `gate:unit`, and 2D's spec green by name.

## Phase 3: Merge, review and checkpoint

### Task 3.1: Merge

**Spec:** In the integration worktree, merge `main` first, then 2A, 2B, 2C and 2D, running `gate:unit` after each. The orchestrator resolves conflicts; a builder never merges another's branch.

**Acceptance:** the integration branch holds all four on current `main`, `gate:unit` is green, and a search finds no "not built yet" under `src/`.

### Task 3.2: Tests across branches

**Spec:** The orchestrator writes the tests no single branch could. Each runs the real helper, the real `lahe agent` and the fake `claude`, in its own state folder, and calls the teardown helper. The list is the "Across branches" section of the Test List.

**Files:** `test/unit/auto_answer_seams.test.js`, `test/browser/auto_answer_seams.spec.js`.

**Acceptance:** each case passes, and each was seen to fail once when its seam was broken by hand.

### Task 3.3: One review, one fix round

**Spec:** One review set on the integrated diff:

- `review-code-lead`
- `review-security`, since the diff spawns long-lived processes, writes user files, adds a route and handles paths
- `review-testing`

Each finding names the test that would catch it. Builders fix on `agent-sdk-fix-<n>` branches, writing the named test red, then green. The orchestrator checks each test exists and passes. A second review happens only for a fix that is itself risky.

**Acceptance:** every finding is fixed with its test, or written under Changes from plan on the progress page with the reason.

### Task 3.4: Checkpoint

**Spec:** In the integration worktree:

1. merge `feat/lahe-agent-sdk` in, for the docs the orchestrator changed meanwhile
2. `npm run install-skills`
3. rebuild and commit `dist/`
4. run `npm run gate`, then `npm run gate:all`, each as its own command
5. read the pass and fail counts
6. retake 2D's screenshots from `auto_answer_rail.spec.js` on this branch, after it passes
7. only then push, as a separate command, to `feat/lahe-agent-sdk`

**Acceptance:** both gates read "0 failed" in their output. The counts and the screenshots are on the progress page, and the push came after.

## Phase 4: Live check and dogfood

### Task 4.1: Live check, story walks, fresh clone

**Spec:** On a throwaway review in the scratchpad, use the built `lahe agent` (not the spike scripts) to check each "Live" line in the Test List. Then:

- walk every user story in the brief in the browser, on a real review, with the real `claude`
- clone the repo fresh into the scratchpad and run `lahe agent allow` from it with no install step (brief R3, nothing to install)

**Acceptance:** each line checked, with the saved file that shows it, on the progress page. Any output that differs from the fake `claude` updates its scenario and gets a test.

### Task 4.2: Dogfood

**Spec:** The owner runs a review of at least five comments with auto-answer on. The document is one no agent reads as instructions (the default for OQ6, instruction files). A script reads `turns.jsonl`, `attempts.json`, `agent.json`'s history and the event log. It writes the numbers the brief asks for, one row per item:

- turns and failures
- items that hit the limit
- double answers
- the time from ready to reply

It also writes one row per agent start, with why it started (first turn, crash, idle close, fresh start).

**Acceptance:** each brief success metric marked pass or fail on the progress page, from the script's output. The owner judges each comment reply.

## Test List

::: callout-req
**Engine (2A)**

- [ ] The system prompt is the `all` and `headless` lines in order, then the note, then the context. Checked against hand-picked lines, not the code's own filter.
- [ ] The system prompt is passed only when the agent starts, and is the same whether it was given 1 or 25 items; no turn message holds a `CONTRACT` line.
- [ ] One handle takes three turns: the fake records one pid, and each turn's usage is the difference of the running totals.
- [ ] A second `sendTurn` while one is in flight is refused.
- [ ] The turn message deep-equals the drain's item lines cut to the allowed fields, with only `source_hint` changed. No path, origin, linked file or summary line. The `file_changed_since_last_turn` line appears only when the copy was reset.
- [ ] A page-posted `source_hint` pointing elsewhere does not change which file is copied in.
- [ ] Before each turn the copy matches the real file: after an outside edit, after a refused turn, and after a conflict.
- [ ] The schema's field names equal `REPLY_FIELD` and `REPLY_REQUIRED`.
- [ ] Replies read from the chosen structured form parse to the expected list. A result with no replies, or replies that do not fit the schema, is `bad_output`.
- [ ] 30 ready items become turns of 25 and 5. A batch over 100 KB is cut at the item that crosses it.
- [ ] An item over 8,000 characters gets the pinned `not_handled` reply and is not sent.
- [ ] A reply over 500 characters is dropped and logged, and its item counts as unanswered.
- [ ] The recorded arguments include `--input-format stream-json`, `--output-format stream-json`, `--safe-mode`, `--restricted`, `--strict-mcp-config`, `--setting-sources ""`, `--tools Read,Edit`, `--permission-mode dontAsk`, `--permission-prompts none` and `--append-system-prompt-file`. They include `--resume <id>` only when resuming. They never include `--bare`, `Bash` or `--no-session-persistence`.
- [ ] The recorded working folder is the stage `work/` folder, holding exactly one regular file.
- [ ] `claude` runs by the absolute path recorded at allow time, not from `PATH`.
- [ ] The child environment is exactly `auto_answer.json`'s `env`. `ANTHROPIC_API_KEY`, `NODE_OPTIONS`, `ANTHROPIC_BASE_URL`, `CLAUDE_CODE_USE_BEDROCK`, any `CLAUDE_CODE_*` and any `LAHE_*` variable set in the parent are absent.
- [ ] The review token appears in none of the prompt, turn messages, environment or arguments.
- [ ] Clean, death mid-turn, timeout, bad output, signed out and usage limit are each named correctly. Output nothing recognizes is `crashed`, never `finished`. The usage-limit test's title says its output is a guess.
- [ ] `onExit` fires once when the fake dies while idle, with its code and signal.
- [ ] A turn's timeout reaches a grandchild that ignores SIGTERM: with a 200 ms grace, `process.kill(-pgid, 0)` reaches ESRCH.
- [ ] A reply for an item or rev not in the batch, including one from an earlier turn, is dropped and logged. A `files` value from the agent is ignored; `files` comes from the stamps.
- [ ] A turn that edited the file but left an item without a reply is `refused`, and nothing is written.
- [ ] Each of these additions is refused: `<SCRIPT>`, `<img src=x onerror=...>`, `<svg onload=...>`, `<iframe>`, `[a](javascript:alert(1))`, `JaVaScRiPt:`, `&#106;avascript:`, and the autolink `<javascript:...>`.
- [ ] Raw HTML already in the file, left in place or moved, is not an addition. A second copy of it is.
- [ ] The real file changed mid-turn: `conflict`, nothing written. The next copy-in waits for 15 seconds of quiet.
- [ ] A symlink swapped in for the file, or for a parent folder, mid-turn: refused, nothing written.
- [ ] A crash at `beforeRename` leaves the original whole. A crash at `afterWriteBack` leaves `result.json` for the next supervisor.
- [ ] The turn log holds no tool result text. The prompt file is gone after a clean close, a death, a timeout and a kill. Only 20 turn folders remain, and each applied turn has a `diff.patch`.

**Supervisor (2B)** (every timed case uses the injected clock)

- [ ] "On" starts no agent. The first ready item starts it, and the fake records the start.
- [ ] Three bursts minutes apart go to one agent: the fake records one start and three turns.
- [ ] Items at 0, 10, 20, 30 and 40 seconds make one turn. Items at 0 and 16 seconds make two.
- [ ] One item every 10 seconds makes a turn at 60 seconds.
- [ ] An item arriving mid-turn goes into the next turn, and nothing is sent while a turn is in flight.
- [ ] After every result, the supervisor waits for each fold, then drains again, whatever the agent's own text said.
- [ ] The fake engine receives an item exactly three times at one rev, then the pinned gave-up reply folds. Rewording makes it ready again, until six in all.
- [ ] Three failed turns in a row, conflicts included, stop with `failing`, and no item's attempts are used.
- [ ] The agent dies while idle: it is resumed with the same session id before the next turn, and the next item is answered.
- [ ] The agent dies mid-turn: the turn is `crashed`, every item is back on the drain, and the next start is fresh.
- [ ] Three agent restarts within ten minutes stop with `failing`.
- [ ] A resume that fails is followed by one fresh start, which does not count as a restart.
- [ ] A fresh start follows: history above 80,000 tokens; a new prompt hash after `allow` runs again; a `refused`, `timed_out`, `crashed` or `bad_output` turn; a `compact_boundary`. In each case the fake records a start without `--resume`.
- [ ] After 60 idle minutes the agent's stdin is closed, its agent slot released and its session id kept. The next item resumes it.
- [ ] One simulated hour with nothing ready, with an open question, or with a written unfolded reply, sends zero turns.
- [ ] Turn 40 at 23:59:59 local time pauses; at 00:00:00 the next turn starts. The same on a daylight-saving change day. Run in a child process with `TZ=America/New_York`.
- [ ] The machine's 120 behaves the same way across two sessions.
- [ ] A usage limit pauses for 30 minutes, sets `retry_at`, and closes the agent.
- [ ] A clock jump past 10 minutes mid-turn (machine sleep) ends the turn as `timed_out`, and the next start is fresh.
- [ ] Off, stop from the page, takeover, close and disallow: while idle, the agent's stdin is closed; mid-turn, its group is killed. Nothing is written to the source or the reply file.
- [ ] Two supervisors started as two child processes at once leave one.
- [ ] Never more than two turns at once, measured from the start and end times the fake records.
- [ ] Never more than four agents alive; a fifth review waits as `queued` and starts when an idle close frees a slot.
- [ ] A dead slot of either kind is reclaimed; a live one with a reused pid is not.
- [ ] A written, unfolded reply keeps its item out of the next batch.
- [ ] A chat reply to an item, folded before the first drain, keeps that item out of the batch.
- [ ] A stale-rev rejection counts as no reply. No fold result in 30 seconds counts nothing and is logged.
- [ ] Killed after `afterWriteBack`: the next supervisor writes the replies first.
- [ ] A leftover agent group from a killed supervisor is killed on start.
- [ ] Stale code: the supervisor waits for the turn in flight, closes the agent, releases the lock and exits with `restarting`. The next supervisor resumes the same session id.
- [ ] The source file deleted: stops with `source_missing`.
- [ ] Held items start no turn; release starts one turn for all of them.
- [ ] `--runs-per-day 3` at allow time pauses after three turns.

**Command line and helper (2C)**

- [ ] `allow` refuses each listed kind of source path, a symlink to one, a non-Markdown source, a session with two reviews, and Windows, each with a plain message.
- [ ] `allow` refuses when `claude` is missing or signed out, and names a login billed by the token.
- [ ] `allow` prints the whole pinned warning every time, including the history line and one line per context file, and records the environment allowlist.
- [ ] `allow --context` copies each file's text into `auto_answer_context.md` and records its hash and size. It refuses a missing file and a total over 40,000 characters. Editing a context file afterwards changes nothing until `allow` runs again.
- [ ] `allow` run again while a supervisor runs updates the file; the next turn starts a fresh agent with the new note, context and model.
- [ ] `disallow` ends the allowance; a running supervisor stops on its next look.
- [ ] `on` and `off` from the terminal record `from: "terminal"`; from the page, `from: "page"`.
- [ ] `status` shows the state, whether an agent is alive and since when, and turns and tokens today. `status --diffs` shows the kept turns' diffs.
- [ ] The route ignores extra fields, refuses a `want` other than `on` or `off`, and fails every D11 check a write route fails. `session.json` and `auto_answer.json` stay byte-identical after any page request.
- [ ] The generic events route refuses `auto_answer.requested`.
- [ ] "On" for a session never allowed records the event and starts nothing.
- [ ] A takeover ends the allowance: after it, "on" starts nothing until `allow` runs again.
- [ ] An allowed "on" starts `supervise` detached, in its own process group, with the helper's Node and the clone's `bin/lahe.js`, and starts nothing while a live one holds the lock.
- [ ] "On" standing with no live supervisor: the helper starts one on the next liveness request, at most three times in ten minutes, then `failing`.
- [ ] While auto-answer holds a review, a reply from another agent is rejected with `auto_answer_owns`.
- [ ] The liveness answer deep-equals the Task 1.2 fixture for each `agent.json` fixture, and never holds a path, the note, the context or a dollar figure.
- [ ] `lahe monitor` exits 6 with the pinned words while a live supervisor holds the rev.
- [ ] `lahe review` re-entry prints the pinned words and no monitor lines. `lahe review` and `lahe add` refuse a second review in the session.
- [ ] A helper on `SERVICE_CONTRACT` 13 is restarted by the new CLI.

**Rail (2D)**

- [ ] Each state shows its pinned status words, with "auto-answer" lowercase in the status line.
- [ ] Not allowed: the pill is focusable and opens the panel with the command and a Copy button.
- [ ] A click posts `want: on`; the pill says "Turning on" until liveness confirms; if nothing starts it returns to off.
- [ ] The warning panel shows on the first "on" in a session only. It takes focus, closes on Esc, and returns focus to the pill.
- [ ] Off while idle is one click. Off while working opens the stop confirm.
- [ ] Each chip shows its pinned words and button. "Try again" posts `want: on`.
- [ ] The status line is announced on a change of state, not on each tick of the age.
- [ ] While on and healthy, a ready card older than the overdue wait shows no banner, no late ring and no overdue toast.
- [ ] Paused or stopped: the status line is loud, and the hand-off button stays.
- [ ] A gave-up card wears the late ring, "Not handled" and the pinned words.
- [ ] After off or a takeover, the rail follows today's rules exactly.
- [ ] No forbidden word appears in any state.
- [ ] At the narrowest rail the run count wraps to its own line and nothing overlaps.

**Across branches (3.2)** (real helper, real `lahe agent`, fake `claude`)

- [ ] A real click on the switch starts one supervisor; a comment starts one agent and one turn; the source file changes; the reply folds; the rail shows "on" again.
- [ ] Two more comments a minute apart go to the same agent: the fake records one start.
- [ ] The fake agent is killed between comments: the next comment is answered, the fake records a resume with the same session id, and nobody touched a terminal.
- [ ] The page asks "off" mid-turn: the group is killed, the source is byte-identical, and every item is back on the drain.
- [ ] A takeover mid-turn: the source is untouched, and every item is on the new owner's drain.
- [ ] A chat agent's `lahe monitor` exits 6 once the page turns auto-answer on.
- [ ] Fake `claude` signed out: the live liveness answer deep-equals the stopped `signed_out` fixture. The same for a usage limit and for waiting for another review's run.
- [ ] A hand edit's `handled` reply passes the handled check after write-back.
- [ ] Two reviews each with a burst: never more than two turns at once, and a third shows "waiting for another review's run".
- [ ] `lahe agent status --diffs` shows the diff of a real turn.

**Live (4.1)** (real `claude`)

- [ ] The three spike items are answered correctly, and a reply containing "$220" reaches its card.
- [ ] One agent answers three bursts. Its later turns write a small fraction of the first turn's cache, as in the second spike.
- [ ] The agent killed between bursts: the next comment is answered by a resumed agent with the same session id.
- [ ] A `.env` beside the source never appears in any turn log.
- [ ] A comment asking for a `<script>` ends refused, with the pinned card words, and the next turn starts fresh.
- [ ] An empty `CLAUDE_CONFIG_DIR` at allow time: `allow` refuses. The login broken after allow: the rail says signed out, and every item stays waiting.
- [ ] An idle hour makes zero model calls: the agent's running totals do not move, and the agent is closed at 60 minutes.
- [ ] The rules appear once per agent in transcripts of 1, 10 and 25 items, and of 100 items across turns of one agent.
:::

## Acceptance Criteria

::: callout-metric
**Standard (every feature inherits these; keep them verbatim):**

- [ ] Full test suite green, not just the new tests.
- [ ] Design and lint gates green (the project's gate command).
- [ ] Every user story in the brief walked end to end in the browser, on the running app.
- [ ] Nothing punted: no TODOs, no stubbed tests, no "out of scope" that was in scope.
- [ ] Implementation matches brief and architecture; any deviation is deliberate and written down under Changes from plan on the progress page.
- [ ] **It looks like a staff designer built it.** Keep the seniority level: "staff" is what sets the quality bar the evaluator judges against. Judge the whole surface at that level, then check that it includes at least:
  - Clear visual hierarchy and information architecture. You know where to look, and the page's organization makes sense.
  - Consistency with the rest of the app. Buttons look like our other buttons, hover states follow the same convention, primary and secondary carry the same color meaning they carry elsewhere.
  - Honest feedback. Toasts and status messages report what actually happened. Never an optimistic "done" for something still in flight, or something that failed.
  - Micro-animations that mean something. Motion signals state or direction; it isn't decoration.
  - Copy in the brand voice (the project's brand or voice doc).
  - Existing components reused and the style guide followed. Nothing reads as a stock framework default.
- [ ] It reads as one feature, not several agents' work stitched together: consistent components, spacing, and interaction patterns across every surface it touches.

**This feature** (each line names the brief requirement it checks):

- [ ] With auto-answer never allowed, a review behaves as today, and the existing suite passes unchanged (R1, off by default).
- [ ] Nothing asks for or stores an API key, none passes to the agent, and a login billed by the token is named in the warning (R2, no key of LAHE's own).
- [ ] `dependencies` in `package.json` is still `{}`, and a fresh clone runs `lahe agent allow` with no install (R3, nothing to install).
- [ ] The supervisor and slots name no `claude` flag, checked by a unit test (R4, Claude Code first).
- [ ] Stopping leaves every unanswered item ready, and the source untouched by the stopped turn (R5, stopping is clean).
- [ ] The terminal warning and the warning panel say what it may do, who can make it act, and what it uses (R6, say what it may do).
- [ ] No chat agent starts, keeps or restarts anything for auto-answer to work (R7, LAHE does the listening).
- [ ] An idle hour makes zero model calls (R8, idle is free).
- [ ] A burst becomes one turn, and held items start none until released (R9, one batch at a time).
- [ ] Hand-edit replies pass the handled check (R10, same standard as today).
- [ ] Items arriving mid-turn are answered in the next turn, and one turn at most works a review (R11, nothing is lost).
- [ ] Never more than two turns and four agents across the machine, and a waiting review says so (R12, a cap on runs at once).
- [ ] An item stops after three attempts per rev, six in all, with the pinned card words (R13, retries stop).
- [ ] The rules appear once per agent in every transcript checked, and nothing instruction-like repeats per turn or per item (R14, rules once per agent).
- [ ] The agent's rules come from the one tagged contract, and `review.json` still carries the chat lines (R15, one source of rules).
- [ ] The reviewer sees only cards and the rail, and the agent's reply reads like a chat agent's (R16, cards and rail only).
- [ ] Signed out, not installed, the usage limit, a missing file and a crash each show in plain words on the rail (R17, failures are visible).
- [ ] Auto-answer turns off from the page in one click while idle (R18, stop from the page).
- [ ] While auto-answer holds a review, a reply from any other agent is rejected (R19, one owner).
- [ ] A takeover hands every unanswered item to the new owner, and nothing answered shows again (R20, hand it back).
- [ ] Page text reaches the agent only as data under `page`, and the page's `source_hint` never reaches it (R21, page text is data).
- [ ] The agent can read and edit only its copy, and nothing outside it changes (R22, stays in scope).
- [ ] Daily run limits stop new turns, and the rail says why (R23, a usage ceiling).
- [ ] The run count and tokens show on the rail and in `lahe agent status` (R24, usage is visible).
- [ ] The allow note and the named context reach the agent's prompt, and only the terminal can set them (R25, a handoff note).
- [ ] In the dogfood, the agent starts once plus once per recorded crash, idle close or fresh start, never once per batch (R26, one agent per review, kept running).
- [ ] With the agent killed between comments, the next comment is still answered with no one at a terminal, and a blocked or missing reply shows on the rail or the card (R27, nothing depends on the model remembering).
- [ ] The rail screenshots, light and dark, are on the progress page from the checkpoint run.
- [ ] Human has reviewed and approved (single consolidated gate after Plan)
:::

## Open Questions

These are the open questions from the brief, the architecture and this plan. Each has the default the build takes if you do not answer.

### Before the build

::: callout-question
**OQ1 (subscription terms, architecture OQ1).** Anthropic's terms allow scripted access only by API key, or "where we otherwise explicitly permit it". Auto-answer keeps `claude -p` running on your subscription and feeds it each batch of comments. Is that allowed? Task 0.1 puts the exact words from the live page beside this question. **Default: Phases 0 and 1 go ahead. They spend a handful of turns on your login, as the spikes did. Phase 2 waits for your answer, or for you to say you accept the risk.**
:::

::: callout-question
**Q6 (order, brief).** Should we ship a small chat fix first, then count how often chat agents forget comments, before building this? The fix is a hook that stops a chat agent from ending its turn while comments are still open. **Default: build this now. The small fix stays its own board row.**
:::

::: callout-question
**Q8 (priority, brief).** Does this go ahead of the open security items and the npm package? **Default: yes. Main's suite was green on 2026-09-29 (commit 32fe22b: 417 passed, 0 failed), so there are no failing tests to fix first. The security items and the npm package are not held for this.**
:::

### What it may do and what it costs

::: callout-question
**Q1 (billing, brief).** Each turn uses your Claude subscription, so busy reviews use up the same limit as your own Claude work. Is that acceptable with run limits in place? In the second spike, a lean agent's later turns cost $0.020 to $0.030 each at list price, and its first turn $0.057. **Default: yes, with 40 runs per review and 120 per computer each day, and a 10-minute limit per turn. Task 0.2 measures the prompt size with LAHE's full rules, and that number goes beside this question.**
:::

::: callout-question
**Q4 (permissions, brief).** What may the agent do without asking? **Default: read and edit a copy of the one source file under review. It cannot run commands, build, commit, push or use the network. Its replies come back as structured output, not shell commands.**
:::

::: callout-question
**OQ9 (full setup, architecture).** Should a project be able to run its agent with its full Claude Code setup (its CLAUDE.md, skills, MCP servers and hooks)? In the second spike, your full setup made every later turn cost 4.3 to 5.1 times a lean one, and it brings back hooks and MCP servers, which can run commands. **Default: no. The agent starts lean, and a project adds its own rules with `lahe agent allow --context <file>`, up to 40,000 characters in all.**
:::

::: callout-question
**OQ10 (where the history lives, architecture).** Claude saves the agent's history in your Claude folder (`~/.claude/projects/`) so LAHE can resume it after a crash or an idle close. It holds the document's text and the comments. **Default: accept it, and say so in the warning. If Task 0.2 shows LAHE can keep it in its own folder without losing your login, do that instead.**
:::

::: callout-question
**OQ3 (the numbers, architecture).** Are the limits and timings in "Numbers this plan sets" right? They are guesses, such as 2 turns at once, 4 agents alive, closing an agent after 60 idle minutes, and a fresh start at 80,000 tokens of history. **Default: use them as listed.**
:::

::: callout-question
**OQ6 (instruction files, architecture).** Should the first dogfood run on LAHE's own feature docs? Later agents read those docs as instructions. **Default: no. The first dogfood uses a document no agent acts on, such as a blog draft.**
:::

### How it works

::: callout-question
**Q2 (context, brief).** How much of your chat with the agent does it see? **Default: only the note written when you allow auto-answer in the terminal, plus any context files you name there.**
:::

::: callout-question
**OQ4 (beyond Markdown, architecture).** Should the first version also work on static HTML, linked files and build-output pages? **Default: no, Markdown only.**
:::

::: callout-question
**OQ5 (who may switch it on, architecture).** Someone must first run `lahe agent allow` in a terminal. Only then can the switch on the page turn auto-answer on. Is that acceptable? **Default: yes.**
:::

::: callout-question
**OQ7 (the name, this plan).** Is "Auto-answer" the right name for the switch and the status words? **Default: yes.**
:::

::: callout-question
**OQ8 (one review per session, this plan).** Auto-answer holds one review per session. A session with two reviews cannot allow it. Is that acceptable for the first version? **Default: yes.**
:::

::: callout-question
**OQ11 (the Library, later, architecture).** Later, the Library could open documents with their background agents already running. Is a one-time terminal allowance per project folder the right permission for that? **Default: yes, as a later phase. Nothing for the Library is built now.**
:::

### Separate from this build

::: callout-question
**Q5 (the kill setting, brief).** Should you turn on the Claude Code setting that stops the memory kills? **Default: not part of this build. It is your own setting.**
:::

::: callout-question
**Q7 (the SDK, brief).** Should we drop the Agent SDK approach, or keep it documented for people who use an API key? **Default: record it as a rejected alternative and build nothing for it.**
:::

Two earlier questions are closed. Q3 (telling the chat agent) is settled in the architecture. Turning auto-answer on stops the chat agent's monitor, and the monitor tells the agent to tell you and stop. OQ2 (the flags spike) is now Task 0.2. It comes to you only if one of its checks stops the build.

## To delete at cleanup

Nothing yet.

## Engineering Manager Review

Full prose in `03_plan_lahe_agent_sdk_reviews.md`.

| # | Finding | Disposition | Rationale |
|---|---------|-------------|-----------|
| EM1 | The rail needs `sync.js`, `layer/index.js` and `tab_done.js`, which no task owned | Accepted | Added to 2D's files; two new rows in the seam table; Task 3.2's browser spec drives a real click |
| EM2 | The seam between supervisor and engine was not pinned | Accepted | Task 1.3 names `runBatch` and its return shape, and who writes which record |
| EM3 | Files the supervisor writes and the command line reads had no fixtures | Accepted | Task 1.2 adds `agent.json`, `runs.jsonl` and `auto_answer.json` fixtures |
| EM4 | Phase 1 cannot share the checked-out feature branch | Accepted | Kernel builds on `agent-sdk-kernel`; screenshots go in reports |
| EM5 | Task 0.3 did not gate, its file list was short, and the base is behind main | Accepted | 0.3 gates, its list is complete, main merges in before Phase 1 and first in 3.1 |
| EM6 | The terms gated only the dogfood | Accepted | Phase 2 waits for OQ1; Task 0.1 names who reads the page |
| EM7 | Most spike checks had no rule for a failure | Accepted | Every row of Task 0.2 now has one |
| EM8 | Test timing would collide with the no-sleep rule | Accepted | Injected `opts.now`, `opts.sleep`, `opts.limits`; the fake's timer is marked |
| EM9 | Some acceptance lines had no owning task | Accepted | Story walks and the fresh clone in 4.1; the R4 search is a 2B unit test; 3.4 retakes screenshots |
| EM10 | Test lists too thin for 2C and 2D | Accepted | Test List grew for both |
| EM11 | Builders were not told the manifest is frozen | Accepted | Rule added: Files lists are complete; test file prefixes per builder |
| EM12 | The checkpoint push may not be a fast-forward | Accepted | 3.4 merges the feature branch in first |

## Code Review Lead Review

Full prose in `03_plan_lahe_agent_sdk_reviews.md`. Most findings changed the architecture; its sections are named.

| # | Finding | Disposition | Rationale |
|---|---------|-------------|-----------|
| CR1 | The existing lock goes stale after 20 seconds, so it cannot guard a long-lived process | Accepted | Architecture Components: a second lock kind, held for a process's life; Task 1.3 tests it |
| CR2 | A session can own several reviews | Accepted | Architecture Data: one review per auto-answer session; OQ8 asks the owner |
| CR3 | The parallel seam was never defined | Accepted | Task 1.3 lists every signature and the `supervise` argv |
| CR4 | `session.json` has several unlocked writers | Accepted | The allowance moves to its own `auto_answer.json` |
| CR5 | The page could post the new event around the route; `from` was body-set | Accepted | The generic route refuses the type; the helper sets `from` from the client header; the CLI's path is named |
| CR6 | The helper's environment, not the allow shell's, would reach the run | Accepted | The allowlisted environment is recorded at allow time; no API key is ever recorded or passed |
| CR7 | The contract change missed several copies, and the exit-6 wording | Accepted | `CONTRACT_LINES` added and `CONTRACT` kept; Task 1.1 lists every test file; exit-6 words reworded |
| CR8 | `SERVICE_CONTRACT` not bumped | Accepted | 13 to 14 in Task 1.2 |
| CR9 | A drain every 2 seconds would keep the rail saying "working" | Accepted | The supervisor drains with `suppressActivityTouch` |
| CR10 | No state or owner for "on, supervisor dead" | Accepted | The helper restarts it on liveness, at most three times in ten minutes; stale code exits and is restarted the same way |
| CR11 | A run could write back an edit with no reply beside it | Accepted | Write-back needs a reply for every item; the leftover case is written down |
| CR12 | How the supervisor learns a fold result was unnamed | Accepted | Reads the review's `events.jsonl`; 30-second timeout counts nothing |
| CR13 | Several strings and a reason were missing | Accepted | Words tables complete; reason `source_missing` added |
| CR14 | Nothing enforced one owner per item | Accepted | The fold rejects other agents' replies while auto-answer holds the review |
| CR15 | `--diffs` promised every edit | Accepted | Diffs kept for the last 20 runs, hashes for older ones |
| CR16 | The stdin payload had no field list | Accepted | Architecture names the allowed fields |
| CR17 | Clock seam, token sum, reply cap and gave-up words were open | Accepted | Injected clock; tokens are input plus output; over-cap replies are dropped; new gave-up words |

## Testing Review

Full prose in `03_plan_lahe_agent_sdk_reviews.md`.

| # | Finding | Disposition | Rationale |
|---|---------|-------------|-----------|
| TR1 | No way to control time in tests | Accepted | Injected clock and limits; burst, day-boundary and clock-jump tests added |
| TR2 | The argument test checked only what was missing | Accepted | Every required flag asserted, plus the working folder |
| TR3 | The group-kill test could not fail, and could leak processes | Accepted | Grandchild ignoring SIGTERM; teardown helper |
| TR4 | Failure states never crossed the real seam | Accepted | Task 3.2 compares live liveness to fixtures; off mid-run end to end |
| TR5 | Race tests ran in one process | Accepted | Two child processes, 20 times; concurrency measured from the fake's own times |
| TR6 | The fake `claude` agreed with itself | Accepted | Built from Task 0.2's raw bytes; fails on unknown flags; unknown output is `crashed` |
| TR7 | The raw HTML check was tested with three strings | Accepted | Eight forms, plus moved and copied existing HTML |
| TR8 | Security failure modes had no tests | Accepted | Token, environment canaries, symlinked source and parent, prompt file, route body, page hint |
| TR9 | Requirements with no test | Accepted | Idle hour, per-review limit, status, `--diffs`, R19, R4 |
| TR10 | Loops that never end | Accepted | Architecture: 60-second gather ceiling; conflicts wait for quiet and count toward the stop |
| TR11 | No way to crash at an exact step | Accepted | `opts.hooks.afterWriteBack` and `beforeRename` |
| TR12 | `ps` start-time output differs by platform | Accepted | `LC_ALL=C TZ=UTC`, a real round trip, an injected reader |
| TR13 | Prompt tests could restate the code | Accepted | Hand-picked lines; stdin deep-equal |
| TR14 | Attempt tests read the code's own record | Accepted | Count what the fake engine received |

## Design Review

Full prose in `03_plan_lahe_agent_sdk_reviews.md`.

| # | Finding | Disposition | Rationale |
|---|---------|-------------|-----------|
| DR1 | The wireframe's warning panel contradicts the plan | Accepted | Panel text pinned; no note field; the plan's words win over the wireframe |
| DR2 | The wireframe has buttons the design cannot back | Accepted | Limit buttons cut; "Try again" sends `want: on`; the daily-limit chips offer hand-off |
| DR3 | About half the rail's words were unpinned | Accepted | Words tables complete; the two daily limits worded apart; one time format and capitalization |
| DR4 | The gave-up words become false after rewording | Accepted | New words with a next step |
| DR5 | Not everything overdue stood down | Accepted | Banner, late ring and overdue toast all stand down while healthy |
| DR6 | The wireframe draws screens the architecture rules out | Accepted | b7 and per-card run notes listed as not built |
| DR7 | Accessibility unspecified | Accepted | Switch semantics, focus, Esc, `role="status"`, no announcement per tick |
| DR8 | Nothing shown between the click and the helper's answer | Accepted | "Turning on", with a fixture |
| DR9 | The stopped state said one thing three times | Accepted | The status line says "stopped"; reason and remedy once, in the chip |
| DR10 | Screenshot list too short | Accepted | 2D's list covers every state |
| DR11 | Motion not mentioned | Accepted | No new motion stated |
| DR12 | "Waiting its turn" did not say why | Accepted | "Waiting for another review's run" |
