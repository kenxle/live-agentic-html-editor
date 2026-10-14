# Reviews: LAHE starts your agent when a comment is ready, plan

Plan under review: `03_plan_lahe_agent_sdk.md`, first draft (commit b2c6473). Four reviewers read it in parallel, with the brief, the architecture, the spike and the code the plan names:

- the engineering manager
- the code lead, who also read the brief and architecture
- the testing reviewer
- the design reviewer (magic-mirror)

None edited a file. The dispositions are in the plan's four review tables. Where a fix changed the architecture, its section names the finding.

## Engineering Manager Review (Round 1)

### EM1. The rail task cannot be done in `overlay.js` alone (blocker)

- `src/layer/sync.js` (`livenessKey`) decides when the rail repaints. It watches nine fixed fields, and a new `auto_answer` object is not one of them, so a change like working to idle never reaches the rail.
- The switch has to post `want` to the new route. Posting lives in `sync.js`, and clicks are wired in `src/layer/index.js`, the way Hold is.
- The "Not handled" card words live in `tab_done.js`.
- Fix: add the three files to 2D, add the switch-to-route seam, and make Task 3.2's browser spec drive a real click on a real helper.

### EM2. The seam between the supervisor and the run engine is not pinned (blocker)

The architecture's `run_spec` and `result` shapes describe the supervisor calling the host adapter only. A run also needs the stage steps and the prompt module. The plan never said which side assembles a run, or who writes `result.json` and `runs.jsonl`. Fix: one engine entry owned by 2A, returning the `runs.jsonl` fields; 2A writes `result.json`, 2B writes `runs.jsonl` and `attempts.json`.

### EM3. Files the supervisor writes and the command line reads have no fixtures (should-fix)

2C reads `agent.json` for liveness, the monitor's exit 6 and the status counts, and `status --diffs` reads `runs.jsonl` and the run folders. Only the liveness output had fixtures. Fix: `agent.json` fixtures per state, paired with liveness fixtures, and a sample `runs.jsonl`; Task 3.2 tests `--diffs` on a real run.

### EM4. Phase 1 cannot have its own worktree on the feature branch (should-fix)

The branch is already checked out in the feature's worktree, and git will not check one branch out twice. The progress page lives there too, so a builder putting screenshots on it would conflict with the orchestrator. Fix: a kernel branch; builders put screenshots in their reports.

### EM5. Task 0.3 does not gate, and the base is behind main (should-fix)

The flowchart moved to Phase 1 on two facts only. The feature branch is 12 commits behind main, and those commits change `sync.js`. `feat/lahe_library` changes nearly every file this plan touches. Task 0.3's list left out `routes.js`, both `index.js` files, `projection.js`, `review.js`, `manifest.js`, `sync.js` and the docs. Fix: complete the list, make 0.3 a gate, merge main before Phase 1, and merge main first in Task 3.1.

### EM6. The terms question gates only the dogfood (should-fix, challenge)

The brief says the feature's premise depends on the terms. Building all four Phase 2 branches first means a "no" throws the build away. Tasks 0.2 and 4.1 spend runs on the owner's login before he answers. Task 0.1 says "read by a person" but gives it to the orchestrator. Fix: put OQ1 in front of the owner before Phase 2, and say who reads the pages.

### EM7. Most of Task 0.2's checks have no stop rule (should-fix)

Items on stdin, the prompt file hidden from `ps`, `--permission-prompts none`, distinct failure outputs and the budget flag had no rule for a failure, yet the fake `claude` and the adapter are built from what 0.2 records. Fix: any failed check changes the architecture before Phase 1; name the fallback if the budget flag does nothing on a subscription.

### EM8. Test timing will collide with the no-sleep rule (should-fix)

The waits are long (15 seconds, 2 seconds, 30 seconds, 10 minutes), and `test/unit/no_arbitrary_sleeps.test.js` bans timers in test files outside its allowlist. Fix: one pinned override for the timings, and the fake's timer marked `harness-allow-timer:`.

### EM9. Some acceptance criteria have no owning task (should-fix)

The browser story walks, the fresh-clone check (R3), the "supervisor names no `claude` flag" search (R4), and who retakes the checkpoint screenshots. Fix: 4.1 owns the walks and the clone, the search becomes a test, 3.4 retakes the screenshots.

### EM10. Test lists too thin for test-first on 2C and 2D (should-fix)

2C had no tests for `disallow`, terminal `on` and `off`, `status`, `status --diffs`, or `supervise` starting detached. The contract-equality line belonged to Task 1.1. 2D had no tests for the switch posting, the waiting words, or the narrow-rail wrap.

### EM11. The frozen manifest is not explained to builders (nit)

Lint fails on any unlisted `src/` file, and Phase 2 cannot edit the manifest. Fix: say the Files lists are complete, and name each builder's test files.

### EM12. The checkpoint push may not be a fast-forward (nit)

The orchestrator updates docs on the feature branch during Phase 2. Fix: merge the feature branch into integration before the push.

**What holds up:** the four builders do not collide on any `src/service` or `src/cli` file; the gate rules are stated correctly; breaking each seam by hand once is a good check.

## Code Review Lead Review (Round 1)

Verdict: not reviewable as written, with three blockers: the lock, sessions with several reviews, and the engine seam.

### CR1. The lock goes stale by age (blocker; architecture and plan)

`withServerLock` treats a lock as stale after 20 seconds and holds it only while a callback runs. A supervisor lock held for hours, or a slot held for 10 minutes, would be taken over. Task 1.3 said to move it "unchanged" while its tests wanted pid-based staleness. Fix: a second primitive, held for a process's life, stale only when pid and start time stop matching; `ps` run with `LC_ALL=C TZ=UTC`.

### CR2. A session can own several reviews (blocker; architecture)

The allowance named one source file per session, but `lahe status --session` drains every review's items, and event logs and reply files are per review. Fix: scope the allowance to one review, or refuse a session with more than one; name the event log and the reply folder.

### CR3. The parallel seam is never defined (blocker; plan)

`run_spec` is the adapter's input, not the supervisor's call. The stubs' functions were not listed, nor `supervise`'s arguments. Fix: list the signatures, the engine call and its result, and `supervise`'s argv.

### CR4. `session.json` is not single-writer (should-fix; architecture)

Create, takeover, close, name and `review.js` write it whole with no lock. `allow` could read rev 4, a takeover write rev 5, and `allow` write rev 4 back. Fix: a separate `auto_answer.json`.

### CR5. The page could skip the route (should-fix; architecture and plan)

The generic events append stores any known type, so the page could post `auto_answer.requested` directly. `from: "terminal"` contradicted "reads only `want`". The CLI's path to the helper was undefined. Fix: refuse the type on the generic route, set `from` on the helper side, name the CLI path.

### CR6. The wrong shell's environment reaches the run (should-fix; architecture)

The helper spawns the supervisor, so `PATH`, `CLAUDE_CONFIG_DIR` and `ANTHROPIC_API_KEY` come from the helper's shell. Fix: record the allowlisted values at allow time.

### CR7. The contract change is missing from some copies (should-fix; plan)

Five more test files treat `CONTRACT` as a list of strings; `projection_review_json.test.js` asserts `review.json` carries `CONTRACT`; `review_format.test.js` asserts 50 lines. The shape of a tagged line was unnamed. The exit-6 wording in the contract, the skill and `monitor.js` strands a chat agent. Fix: keep `CONTRACT` as the chat strings, add `CONTRACT_LINES`, list every test file, reword exit 6.

### CR8. `SERVICE_CONTRACT` is not bumped (should-fix; plan)

An older running helper would refuse the new event and route. Fix: 13 to 14.

### CR9. A quiet drain stamps activity (should-fix; plan)

A drain every 2 seconds would keep the rail saying "working", which the monitor avoids with `suppressActivityTouch`. Fix: say the drain runs in-process with that flag.

### CR10. A dead supervisor with "on" standing has no state and no restarter (should-fix; architecture)

The stale-code restart did not say how the lock passes on either. Fix: a state for it, the helper restarting on its liveness poll, and a named lock handover.

### CR11. A run can edit for an item it does not reply to (should-fix; architecture)

Writing back the whole file puts that change on disk with no reply, so R5 did not hold by construction. Fix: write back only when every item with an edit has a reply; test it.

### CR12. How the supervisor learns a fold result is unnamed (should-fix; plan)

Fix: read the review's `events.jsonl` for matching `reply.folded` or `reply.rejected`; pin the 30-second timeout.

### CR13. Strings and a reason are missing (should-fix; plan)

The terminal warning, the panel, the re-entry and exit-6 messages, the retrying and daily-limit chips. The "file gone" chip had no reason of its own. Fix: pin every string, add `source_missing`.

### CR14. No test or rule for "no item answered by both" (should-fix; plan)

A chat agent at the same rev can still drain and reply. Fix: fence replies by owner, or write down the leftover risk.

### CR15. `--diffs` promises every edit (nit; plan)

Only 20 folders are kept and `runs.jsonl` holds hashes. Fix: keep a diff per run, or narrow the promise.

### CR16. The stdin payload has no field list (nit; architecture)

"No other path appears" cannot be tested; drain lines also carry `linked_file` and the summary's liveness. Fix: an allowed-field list.

### CR17. Several rules left open (nit; plan)

An injectable clock, which usage fields `tokens_today` adds, whether an over-long reply is dropped or cut, and the gave-up words when the six-attempt limit fires.

## Testing Review (Round 1)

### TR1. No way to control time in tests (blocker)

Each timer is one constant with no test override; sleeps are banned; `node:test` fake timers need Node 20.4 and the unit suite runs on 18. Fix: `opts.now`, `opts.sleep`, `opts.limits`. Tests: items at 0 to 40 seconds start one run and 0 and 16 start two; a day boundary in `America/New_York`, including a daylight-saving day; a clock jump past 10 minutes ends a run as `timed_out`.

### TR2. The argument test checks only what is missing (blocker)

"Never `--bare` or `Bash`" passes with `--restricted` dropped. Fix: assert each required flag, and that the working folder holds exactly one regular file.

### TR3. The group-kill test cannot fail, and can leak (blocker)

A fake with no child passes a pid-only kill; nothing covers ignoring SIGTERM; detached supervisors outlive a failed test. Fix: a grandchild that ignores SIGTERM, a short grace, `process.kill(-pgid, 0)` reaching ESRCH, and a teardown helper.

### TR4. Failure states never cross the real seam (should-fix)

2C and 2D both build on the same fixtures, so they only prove they agree. Fix: Task 3.2 compares live liveness to the fixtures for signed out, usage limit and waiting; page "off" mid-run end to end.

### TR5. Race tests run inside one process (should-fix)

Fix: two child processes released together, 20 times; concurrency measured from the fake's own times.

### TR6. The fake `claude` agrees with itself (should-fix)

Fix: build scenarios from Task 0.2's raw bytes; exit non-zero on unknown flags; unrecognized output is `crashed`; the usage-limit test says its output is guessed.

### TR7. Raw HTML refusal tested with three strings (should-fix)

Fix: uppercase script, `img onerror`, `svg onload`, `iframe`, a Markdown `javascript:` link, mixed case, an entity-encoded scheme and an autolink; a moved existing tag is not an addition, a second copy is.

### TR8. Security failure modes with no test (should-fix)

The review token in no channel; environment canaries (`NODE_OPTIONS`, `ANTHROPIC_BASE_URL`, `CLAUDE_CODE_USE_BEDROCK`, `LAHE_*`); a source symlinked to `CLAUDE.md`; a parent folder swapped for a symlink; the prompt file after crash, timeout and kill; route bodies leaving state files byte-identical; a page `source_hint` pointing elsewhere.

### TR9. Requirements with no gate test (should-fix)

R8 (idle is free) with an open question and an unfolded reply; R23's per-review limit; R24's status; `--diffs`; R19 with a chat reply folded first; R4 as a unit test.

### TR10. Loops that never end (should-fix)

A conflict is neither an attempt nor a failure, so an owner typing in the file keeps producing runs. One item every 10 seconds never reaches 15 seconds of quiet. No test for a fold result that never arrives. The design names neither limit, so this went to the architecture.

### TR11. No way to crash on cue (should-fix)

Fix: `opts.hooks.afterWriteBack` and `opts.hooks.beforeRename`.

### TR12. `ps` start-time output differs by platform (nit)

Fix: round-trip real `ps` output for the test's own pid, and an injected reader for the reused-pid case.

### TR13. Prompt tests can restate the code (nit)

Fix: hand-picked lines; stdin deep-equals the drain with only `source_hint` changed.

### TR14. Attempt tests read the code's own record (nit)

Fix: count what the fake engine received, then check the pinned reply folded.

## Design Review, magic-mirror (Round 1)

Verdict: 2 blockers, 7 should-fix, 2 nits. The main risk was Task 2D saying "follow wireframe direction B" where parts of that wireframe contradict the architecture.

### DR1. The warning panel contradicts the plan (blocker)

Screen 02 has an optional note field, but only the terminal sets the note and the route reads only `want`. Its bullets say it "may edit files in this document's folder and run lahe" and "stops after 20 runs", against one copy of one file, no commands, and 40 runs. Fix: pin the panel text; no note field; the plan wins.

### DR2. The wireframe has buttons the design cannot back (blocker)

"Raise the limit" and "Change the limit" (the page can only ask on or off); "Try again" and "Turn off" beside a chip that says "turn it off and on". Fix: one "Try again" that sends `want: on`, cut the limit buttons, the daily-limit chips offer hand-off.

### DR3. About half the rail's words are missing (should-fix)

Pill labels, run counts, the popup rows, the stop confirm, the daily-limit and retrying chips. The review's 40 and the computer's 120 need different words. One time format and one capitalization.

### DR4. The gave-up words become false (should-fix)

After rewording, an item can be tried six times, so "tried three times" is wrong, and the card gives no next step.

### DR5. Not everything overdue stands down (should-fix)

The banner, the late ring and `raiseOverdueToast` all use the overdue rule. A late ring during a long healthy run would look like a gave-up card.

### DR6. The wireframe draws screens the architecture rules out (should-fix)

Screen b7 and b3's per-card note need per-item facts the liveness answer does not carry. List them as not built.

### DR7. Accessibility is not specified (should-fix)

A real switch with `aria-pressed`; a focusable not-allowed pill opening a panel with a Copy button; panels that take focus, close on Esc and return focus; the chip as `role="status"`; no announcement on every tick of the age.

### DR8. Nothing shows between the click and the helper's answer (should-fix)

Fix: "Turning on" until liveness confirms, back to off with the allow panel if nothing starts, and a fixture for it.

### DR9. The stopped state says one thing three times (should-fix)

The status line truncates at rail width. Fix: the status line says "stopped"; the reason and remedy appear once, in the chip.

### DR10. The screenshot list is too short (should-fix)

Add gathering, retrying, usage limit, both daily limits, the stop confirm, the run count opened, the not-allowed panel, the too-long and raw-HTML cards, the narrowest rail, and a short window with the warning panel open.

### DR11. Motion is not mentioned (nit)

State that there is no new motion and the dot does not pulse.

### DR12. "Waiting its turn" does not say why (nit)

"Waiting for another review's run" says what it waits behind.

**Reuse:** the Hold pill (`.holdbtn`), End review's confirm panel, `CARD_LATE_ATTR` and the late ring, the `role="status"` status line, `fillAge`, the hand-off button, and `--warn`.

## Code Review Lead Review (Round 2)

Revision 2 of the architecture and plan (commit 494cd28), reviewed before implementation.

Verdict: not reviewable as written. There are two blockers. First, the supervisor builder cannot build or test alone. Second, the `agent.json` layout loses the facts the kept-agent rules depend on. The round-one fixes (CR1 to CR17) mostly still hold. CR14 (one owner per item) has a new hole, covered in CR22.

### CR18. The supervisor (2B) calls engine functions it cannot fake (blocker; plan)

- **What:** 2B can inject only `opts.engine` and `opts.host`. The supervisor still needs four 2A functions, and each one throws "not built yet" for all of Phase 2:
  - `buildPrompt`: for `prompt_sha256` and the "new prompt hash means fresh start" test.
  - `buildSchema`: for `agentSpec.reply_schema`.
  - `cutBatches`: the supervisor decides the batch and counts what the fake engine received.
  - `prepare`: someone has to create the stage before `host.start`.
- Smaller gaps where 2A and 2B meet:
  - `agentSpec` carries a `prompt_file` path, which suggests the caller writes it. But 2A's host spec removes it "however the process ends". Nobody is named as the writer.
  - `cutBatches(items)` has no return shape for the items over 8,000 characters. The supervisor is the only reply writer, so it must learn which items those are.
  - `runTurn` mints `turn_id`, but `agent.json` shows the `turn_id` while the turn is still running.
  - `runTurn` returns no `model_turns`, which `turns.jsonl` records.
  - The architecture's handle ("Other hosts later") has a `session_id` property and no `started` field. The plan has `sessionId()` and `started`.
- **Why:** 2B's tests fail on the stubs until the Task 3.1 merge. Or 2B works around them with local copies, and those copies drift.
- **Fix:**
  - Build `headless_prompt.js` in full in Phase 1. It is pure and small, and it sits next to the contract work in Task 1.1. Or add `opts.prompt` and `opts.stage` injections.
  - Pin that `host.start` takes the prompt text and owns writing and removing the file.
  - Pin `cutBatches` as returning `{ batches, too_long }`, with the supervisor writing the too-long replies.
  - The supervisor mints `turn_id` and passes it in.
  - `runTurn` returns `model_turns`.
  - Update the architecture's handle block to match the plan.

### CR19. `agent.json` puts session-lifetime facts in the per-process object that goes null (blocker; architecture and plan)

- **What:** `claude_session`, `prompt_sha256`, `first_context` and `restarts` all live inside `agent`. The architecture says `agent` is `null` "while no agent process is alive (before the first turn, or after an idle close)". Three rules break:
  - **Resume after idle close.** The architecture says "the supervisor keeps the session id", but the schema has no place to keep it. The stale-code restart has the same problem ("the next supervisor resumes the same session id").
  - **The restart limit.** `restarts` is wiped with each dead process, so "3 restarts in 10 minutes" never counts to 3.
  - **The 80,000-token fresh-start rule.** A resumed process's first request already carries the whole history. If `first_context` resets per process, the rule measures only growth since the last resume. A review commented on less often than hourly (so idle close runs, then a resume) grows until Claude Code compacts on its own. That is the expensive path the rule exists to avoid.
- **Also unpinned:**
  - Which starts count toward the restart limit: a fresh start after a crashed turn, or a failed resume.
  - Whether a death while idle is resumed "at once" (architecture) or "before the next turn" (plan test). Resuming at once also holds an agent slot for no turn.
- **Fix:**
  - Split the record. Put `claude_session: { id, prompt_sha256, fresh_first_context, restarts[] }` at the top level. It survives process death and idle close, and only a fresh start or a stop drops it. `agent` keeps only pid, pgid, started and turns.
  - Pin "resume lazily, at the next turn" and say which starts count toward the limit.
  - Update the Task 1.2 fixtures.
  - Tests:
    - idle close, then resume, keeps the id
    - the 80,000 rule fires across two idle-close resumes
    - three deaths across three processes stop with `failing`

### CR20. Crash recovery after write-back looks for a record that does not exist yet (should-fix; plan)

- **What:** The recovery rule reads "`turns.jsonl` shows `applied` with `replies_written: 0`". But the supervisor (2B) writes `turns.jsonl` only after `runTurn` returns, and the `afterWriteBack` hook fires inside `runTurn` (2A). So a kill there leaves no `turns.jsonl` line at all.
- The order of `result.json` against the rename is also not pinned. A crash between the rename and `result.json` leaves a change in the real file with no reply beside it. That breaks R5 (no change reaches the source without a reply that explains it).
- **Why:** Each side will assume the other writes the durable marker.
- **Fix:**
  - `runTurn` writes `result.json`, with the checked replies and `"stage": "applying"`, and flushes it to disk before the rename.
  - On start, the next supervisor scans `turns/` for a `result.json` that has no finished `turns.jsonl` line, and writes those replies first.
  - Test a kill at each step:
    - between `result.json` and the rename: the original is intact and no reply is written
    - between the rename and the return: the replies are written by the next supervisor

### CR21. Three turn behaviours have no owner: stop against crash, timeout, and "file changed" (should-fix; plan)

- **Stop against crash.** On "off" mid-turn, the supervisor kills the group while `runTurn` waits on `sendTurn`. `runTurn` sees a dead process and reports `failed`/`crashed`, not `stopped`. Then `turns.jsonl` and the dogfood numbers are wrong. Fix: `runTurn` takes `opts.signal` from the supervisor, and a kill it asked for is `stopped`.
- **Timeout.** Two gaps:
  - `sendTurn` takes `timeout_ms`, but its `failure` list has no timed-out value.
  - Node's timers run on a clock that does not count machine sleep on macOS or Linux. So the host's own timer does not end a turn after a sleep. The "clock jump past 10 minutes ends the turn" test only works if the supervisor's look checks wall time.

  Fix: the supervisor's look owns the 10-minute limit through `opts.now`. The host's timer stays only as a backstop. Name the failure `timed_out`. Run the test with a fake host that never answers.
- **`file_changed_since_last_turn`.** After a conflict, `runTurn` resets the copy at the end of that turn. At the next turn's copy-in the copy already matches, so the flag is lost. Conflict is not a fresh-start reason, so the same agent never hears the file changed. Fix: the supervisor passes `opts.fileChanged` from the previous `file_reset`.
- **The 15-second quiet wait.** It is on the Engine test list, but it is a timed step. Waiting inside `runTurn` would also hold a turn slot for 15 seconds. Fix: the supervisor owns it, before it takes a slot. Move the test to the Supervisor list.

### CR22. "While auto-answer holds a review" is undefined, and the likely reading breaks "off" (should-fix; architecture and plan)

- **What:** Task 1.2 gives `allowanceHolds(session)`, which stays true after "off", because only a takeover or `disallow` ends the allowance. The pieces use different tests:
  - The fold rejects other agents' replies "while auto-answer holds".
  - `lahe monitor` exits 6 while "a live supervisor holds the rev".
- **Why:** If the fold uses `allowanceHolds`, then after "off" a chat agent's replies in that session are rejected with `auto_answer_owns`, while the rail promises "today's rules exactly". The two tests can also disagree while a supervisor is restarting.
- **Fix:**
  - One named predicate in `agent_sessions.js`: the allowance holds and the latest request is "on". The fold, the monitor, `review` re-entry and liveness all use it.
  - Tests:
    - after "off", a chat reply folds and the monitor runs
    - with "on" standing and the supervisor dead, a chat reply is still rejected

### CR23. The helper's "three starts, then `failing`" has no file to write (should-fix; architecture)

- **What:** Only the supervisor writes `agent.json`. A supervisor that dies at start writes nothing. If the helper keeps its start count in memory, it resets every time the helper restarts on stale code, and that is the normal case while dogfooding LAHE on LAHE.
- **Fix:**
  - Give the helper its own file, for example `supervisor_starts.json` in the session folder, with the helper as sole writer. Add it to the one-writer table.
  - Liveness reads stopped with reason `failing` from that file.
  - Add a Task 1.2 fixture, and a Task 3.2 test with a supervisor that exits at once.

### CR24. Task 0.2 is missing rows the fake and the restart rules depend on (should-fix; plan)

Add these rows, each saving its raw bytes:

- **A resume that fails:** `--resume` with a missing session id and with a corrupt one.
  - Record whether it fails at spawn or at the first message. The spike saw `init` only with the first message.
  - Without this row, the rule "a failed resume gets one fresh start that is not a restart" cannot be told apart from a crash, and Task 1.4's "resume that fails" scenario has no real bytes.
  - Add a `resume_failed` failure value.
  - Stop rule: if a failed resume looks the same as a crash, drop that exception from the architecture.
- **Running totals after `--resume`:** do they start at zero or carry over? `sendTurn`'s usage difference depends on it.
- **Structured output on the first turn after a resume.** Today's row covers three turns in one process only.
- **Resume from a different working folder,** to confirm that history is looked up by the folder (see CR26).
- **`--verbose` left out, and a malformed stdin line:** record the real error text.
- **What `work/` holds after several turns.** Does Claude Code write anything into its working folder? The "exactly one regular file" test and the diff depend on the answer.
- **Failures in kept mode:** run the Failures row in the kept-running mode, at the first turn, not as one-shot runs.

### CR25. The fake `claude` and the argument test still let real mistakes through (should-fix; plan)

- **What:**
  - The required-argument test leaves out:
    - `-p`
    - `--verbose`
    - `--model`
    - `--json-schema` (when Task 0.2 chooses it)

    As far as I know, current Claude Code refuses `--output-format stream-json` under `-p` without `--verbose`. The CR24 row should confirm it.
  - The fake checks only flag names against `--help`. It does not check flag combinations or the shape of the stdin user message (`type`, `message.role`, `content`, `session_id`).
- **Why:** A builder who drops `--verbose` or builds the message envelope wrong passes every gate test. The error then shows only in Task 4.1, or as a hang.
- **Fix:**
  - Add those flags to the test.
  - The fake reproduces the errors Task 0.2 records and checks the envelope.
  - One engine test sends a malformed envelope and expects a named failure within the timeout, not a hang.

### CR26. The stage path has to stay fixed for resume, and the docs disagree on how long it lives (should-fix; architecture)

- **What:** The architecture's Privacy section says Claude files the history "in a folder named after the stage path", so `--resume` depends on the working folder staying the same. The docs give three lifetimes for the stage:
  - "one per agent" (Components)
  - "lives as long as the agent" (the copy between turns)
  - "lives as long as the allowance" (Turn records)
- **Why:** A builder who reads "one per agent" makes a new folder per start. Every resume then fails and quietly becomes a paid fresh start.
- **Fix:**
  - One fixed path, `agent/work/`, for the life of the allowance.
  - `prepare` can run twice with the same result.
  - The fake refuses a resume from a different working folder, as the CR24 row records.
  - Add an engine test: resume after `prepare` runs again uses the same working folder.

### CR27. Missing and false rail words (nit; plan)

- `applying` is a pinned state that can last up to 30 seconds per turn (the fold wait). It has no status-line words.
- "Last run failed. Trying again." also shows when an idle agent died and was resumed. No run failed, and the resume is silent and free.
- `queued` covers two waits: for a turn slot, and for an agent slot. The agent-slot wait can last up to 60 minutes while four idle agents hold all slots. In that case "waiting for another review's run" is false, because no run exists.
- **Fix:**
  - Pin `applying` words (the running words will do).
  - Show no chip for an idle resume.
  - Either pin words for the agent-slot wait, or close the longest-idle agent early. The architecture already names that for the Library phase.

### CR28. `tokens_today` understates use, and its example contradicts its definition (nit; architecture)

- **What:**
  - In the spike, kept-agent lean turns reported 8 to 14 input tokens and 489 to 1,247 output tokens, while reading 37,436 to 83,933 tokens from cache.
  - "Input plus output" leaves out nearly everything a turn processed. At the spike's largest per-turn figures, 6 turns give 7,566 tokens (computed with Python), so the example's `58210` for 6 turns cannot come from that definition.
  - A crashed, timed-out or stopped turn has no `result` line, so its tokens are never counted.
- **Why:** This works against R24 (usage is visible) and the "honest feedback" acceptance line.
- **Fix:**
  - Pick the definition, and fix the example to match.
  - A turn with no result is shown as "not reported" in `lahe agent status`, not as zero.

### CR29. The fold wait matches `reply.rejected` by item and rev, which it does not carry (nit; architecture)

- **What:** `reject()` in `src/service/replies.js` writes `reply.rejected` with the file and line number only. It has no item and no rev.
- **Why:** Without a fix, a malformed line the supervisor wrote always takes the full 30-second timeout.
- **Fix:** Match `reply.folded` by item and rev. Match `reply.rejected` by the file and line number the supervisor just appended.

**What holds up from round one:**

- The write-back rule "no change without a reply" (CR11).
- `suppressActivityTouch` on the drain (CR9). `status.js`'s `run(argv, options)` supports being called in-process.
- The process-life lock (CR1).
- Keeping `CONTRACT` as the chat strings (CR7).
- The route and `from` rules (CR5).
- Replaying a byte-identical reply line is safe, because `foldEventId` hashes the line.
