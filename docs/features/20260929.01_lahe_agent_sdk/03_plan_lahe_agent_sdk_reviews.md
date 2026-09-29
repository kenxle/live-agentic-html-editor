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
