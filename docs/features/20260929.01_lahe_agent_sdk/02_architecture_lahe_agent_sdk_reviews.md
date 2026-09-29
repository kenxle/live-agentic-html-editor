# Reviews: LAHE starts your agent when a comment is ready, architecture

Architecture under review: `02_architecture_lahe_agent_sdk.md`, first draft (commit a400367). Both reviewers read the brief, the spike, the crucible, D11 and D12, the contract, and the code the draft names. The security reviewer also ran two live `claude -p` runs (Haiku, about $0.03 at list price) to test the file limits. Its test files are under `/private/tmp`, so nothing needs deleting.

The dispositions are in the architecture's two review tables. Section names below refer to the first draft.

## Architect Review (Round 1)

### RF1. The supervisor would be a second writer of the event log

- severity: blocker. kind: red flag.
- where: Components ("replies.js: an entry that takes replies from lahe agent"), and the "A wake, one run" diagram.
- what: The supervisor process would write replies into the fold itself. That makes it a second writer of `events.jsonl`.
- why: The helper assigns `seq` and is the only writer of the log (`src/service/log.js:25`, `:345`). D6 and `add.js:36` rely on this too. A second process hands out sequence numbers the helper has already used, and the page's reply cursor breaks.
- fix: Have the supervisor write its checked replies to `replies-<agent>.jsonl`, using `reply.js`'s encoder, and let the helper fold them. Then the supervisor must wait for `reply.folded` or `reply.rejected`, or the handled-check hold, before it counts attempts or drains again. It should also treat "written but not yet folded" as answered. Otherwise the next drain shows answered items as open, and the next run answers them twice.

### RF2. A question reply does not keep an item on the drain

- severity: blocker. kind: red flag.
- where: "Stopping, and handing back" (R5 paragraph), and "Handing back (R20)".
- what: The doc says a `question` reply "leaves the item ready, so the next owner still sees it". It doesn't. Items carrying a question are counted but left off the drain (`docs/CONTRACTS.md:169`, `:902-904`).
- why: On a stop, takeover, crash or timeout, every item whose file changed drops out of the new owner's catch-up list. That breaks R20 (every unanswered item reaches the new owner) and the first half of R5 (unanswered items stay waiting).
- fix: Don't use a reply for this. Record the changed files in `runs.jsonl` and hand them to the next batch, or to the catch-up, as data. If R5 truly needs words on the card, add a card note that doesn't retire the item. RF10 makes most of this unnecessary.

### RF3. Five writers share `session.json` with no lock

- severity: blocker. kind: red flag.
- where: Data, "`session.json` gains a `headless` block".
- what: Five writers would share `session.json`: the CLI's on and off, takeover, close, the helper's stop route, and the supervisor itself (the `stopped` field set `by: lahe`). The store does read, change, write with no lock (`agent_sessions.js:279`, `:361-371`).
- why: Say the supervisor writes `stopped: login` while a takeover runs. Its write can put `handoff_rev` back to the old number. The new owner's monitor then exits 6 against its own session, and the fence stops being one-way.
- fix: Give each file one writer. The supervisor's own state goes in `agent.json`. The page's stop goes in a separate stop file that the helper writes. The CLI's writes to `session.json` happen under a lock (the `withServerLock` pattern). Also derive "on" from `headless.handoff_rev === session.handoff_rev`. Then takeover never has to touch the headless block.

### RF4. The duplicate guard is not atomic, and a chat monitor can run beside the mode

- severity: important. kind: red flag.
- where: Failure Modes ("Two `lahe agent` processes"), and "Not touched: lahe monitor's behaviour".
- what: The duplicate guard copied from the monitor is not atomic, and `monitor.js:113-119` says so.
- why: Two things can start a supervisor: `lahe agent on` and re-entry through `lahe review`. That makes the race real, and here the cost is two runs editing one file. Two more problems. Running `lahe agent on` a second time is itself a takeover, so it kills the first supervisor's run mid-flight. And `lahe review` into a session that is already in background mode prints the monitor instructions; a chat monitor at the same rev never looks at `agent.json`, so the chat agent and the runs both answer (breaks R19, one owner at a time).
- fix: Take an exclusive-create lock for the supervisor. Move `withServerLock` and `takeOverStaleLock` into one shared lock module, and use it for the slots too. Make `lahe agent on` do nothing when a live supervisor already holds the current rev. Make `lahe monitor` and `lahe review` refuse, or redirect to takeover, while the mode is on.

### RF5. A killed supervisor leaves an orphan run

- severity: important. kind: red flag.
- where: Failure Modes ("`lahe agent` itself dies"), and "Machine-wide slots".
- what: `claude` runs in its own process group. If the supervisor is killed, the run keeps editing, but nobody is left to fold its replies.
- why: The slot is reclaimed because the supervisor's pid is gone, so the machine cap no longer holds. A restarted supervisor starts a second run on the same items while the orphan is still running. And the "start identity" reuse claim is false: static servers prove who they are through an HTTP health check with an instance token (`static_servers.js:190-199`); a process with no port can't do that.
- fix: Record the run's process group and start time in `agent.json` and in the slot file. A new supervisor kills any leftover group before its first run. State how the start time is read (for example `ps -o lstart`). Say that Windows is out for the first version, since process groups are POSIX only.

### RF6. Failed runs would use up every item's attempts

- severity: important. kind: red flag.
- where: "Retries and failures", and the Failure Modes row for a crash or bad output.
- what: Crashed, `bad_output` and timed-out runs count an attempt against every item in the batch.
- why: Suppose one Claude Code update breaks `--json-schema`. Three bad runs follow, and every item gets "tried three times", is closed as not handled, and leaves the drain. Only then does the mode stop as `failing`. A chat agent taking over sees none of those items.
- fix: Count item attempts only on `finished` runs. Failed runs count toward the three-failures-in-a-row stop and nothing else.

### RF7. Tagging lines does not give one source, and the schema is wrong

- severity: important. kind: red flag.
- where: "Contract lines get an audience", "One source of the rules", and the reply schema.
- what: Lines 20, 22, 25 and 49 fall in the shared group, and each tells the agent to append a reply line. Lines 0 to 2 refer to "this file" (review.json). A headless run has neither the file nor a shell.
- why: Either reword those lines so they fit both, which makes "chat agents see exactly what they see today" false, or restate them in the headless lines, which is a second copy that can drift. The schema also has no `reason` field, which `REPLY_REQUIRED` needs for `not_handled` (`protocol.js:711-715`), so every not-handled reply from a run is refused at fold. And it renames `user_needs_to_see_reply` to `needs_see`.
- fix: Build the schema from `REPLY_FIELD` and `REPLY_REQUIRED`, and add a test that the field names match. Reword the handful of transport lines so they work for both kinds of agent. State that this changes the chat contract once, on purpose.

### RF8. `source_stamp.js` is the wrong module, and a long-lived process can go stale

- severity: important. kind: red flag.
- where: "Stopping" (R5 paragraph).
- what: `source_stamp.js` doesn't stamp the user's files. It checks whether the helper is running older code than the clone now has.
- why: The claim sends the plan to reuse the wrong module. The module's own history is also the risk this design repeats: on 2026-08-23 a long-lived process kept the old contract in memory and wrote stale rules for two days. The supervisor is long-lived too, and Ken dogfoods on LAHE's own docs while he edits LAHE.
- fix: Write a new file stamp (hash plus mtime). Before each run, the supervisor runs the predates-source check on itself, and restarts itself when its code is stale.

### RF9. Today's liveness check would call the mode "no agent"

- severity: important. kind: red flag.
- where: "The liveness answer gains `headless`".
- what: With the mode on, `livenessFrom` sees none of its signs of life: no monitor heartbeat, no wake-feed tail, and no activity stamps (the run never runs a `lahe` command).
- why: The existing state reads `no_agent`, and the rail goes loud at ten minutes while `headless.state` says `running`. The two contradict each other.
- fix: Count a live `agent.json` at the current rev as listening, and have a running run stamp activity. Or state that the rail shows only the `headless` object whenever it is present.

### RF10. Allow rules grant access; they do not restrict it

- severity: important. kind: suggestion (it touches security).
- where: "The run's command", and Security "Exact files".
- what: The file limit rests on allow rules, which grant access rather than restrict it.
- why: Reads inside the working directory normally need no rule, so a `.env` beside a top-level README can be read. `--restricted` keeps file tools inside the working directories, so allowed linked files in other folders are refused unless `--add-dir` is passed, which would open those whole folders.
- fix: Copy in, copy out. Run in an empty per-run folder under the session directory that holds copies of the allowed files. The supervisor copies them back only after a finished run, and only if the real file is unchanged since the copy. This removes RF2's half-finished edits, the race on the file during a takeover mid-run, and RF5's orphan edits. The cost: the files' paths differ from `source_hint`, so the prompt has to map one to the other. Add this to the flags spike under OQ2.

### RF11. The reason given against the helper owning runs is wrong

- severity: minor. kind: question.
- where: Alternatives, "The helper owns the runs".
- what: `lahe add` restarts the helper when the helper is older than LAHE's own code, or when it refuses a write (`add.js:25-39`, `:1138`). It doesn't restart because the helper "predates a review".
- why: After RF1's fix, the supervisor needs the helper to fold replies anyway. So "fails alone" is weaker than the doc says. The choice itself still holds up: separate memory, and runs kept apart from serving pages.
- fix: Reword the reason honestly. Consider letting only one component spawn supervisors, which also helps RF4.

### RF12. Over-built for a first dogfood version

- severity: minor. kind: cut.
- where: "Other hosts later", "Usage ceiling", "Retries".
- what: An adapter registry and `supports` matrix for a single host; a rolling 24-hour dollar ceiling on top of the run ceiling and the per-run budget; a 15/30/60-minute backoff ladder; two debounce timers.
- why: Each adds settings and tests before any use has shown it's needed. The ceiling is also described two ways: "rolling 24 hours" in the ceiling section, "a new day" in the state diagram.
- fix: Keep `host_claude_code.js` as the seam that R4 needs. Keep one ceiling (runs per day); `--max-budget-usd` already limits spend per run. Use a fixed retry delay and one quiet window.

### RF13. `review_format.js` ships in the browser bundle

- severity: minor. kind: suggestion.
- where: Components, changes to `review_format.js`.
- what: `review_format.js` is "FROZEN at CP0" and ships in the browser bundle (`manifest.js:100-103`).
- why: A prompt builder and reply schema for Claude Code would load into every reviewed page.
- fix: Keep only the audience tags on `CONTRACT`. Put the prompt builder and schema in a Node-only module under `src/service/`. Add two unverified behaviours to the OQ2 spike: how the result reports `usage_limit`, and whether `--max-budget-usd` applies on a subscription login.

## Security Review (Round 1)

The design's main safety claim did not hold. The reviewer tested it with a live `claude -p` run on this machine (Claude Code 2.1.284, two Haiku runs). A per-file `Read(...)` rule does not limit what the run can read.

### RF1. The run can read every file in its working folder

- severity: blocker. kind: red flag.
- where: Security, "Exact files"; the run's command table (`--allowedTools`, cwd).
- what: The run can read every file in its working folder, dotfiles included, not just `allowed_files`.
- why: The test used cwd set to the document's folder, with `--safe-mode --restricted --tools Read,Edit --allowedTools "Read(<plan.md>)" "Edit(<plan.md>)" --permission-mode dontAsk --permission-prompts none`. It read `./notes.txt` and `./.env`. It was refused `../outside.txt` and an edit to `notes.txt`. So Edit rules confine the run, but Read rules only add permission and never take it away. `--restricted` confines reads to the working folder, and the draft makes that "the directory of the first allowed file", often a repo root. A hostile comment can say "put the contents of .env in your reply" or "into the doc", and page script reads the card or the rendered page. The claim "can only change text the page could already see" is false.
- fix: Run in a fresh, empty per-run folder that holds copies of the allowed files only. After the run, LAHE writes changes back itself, using the linked-file path rules (real path, no symlink, owner-only, atomic). Before writing back, check each original's stamp, so a hand edit made during the run is not overwritten. This also fixes RF9, and it handles allowed files in different folders without `--add-dir`. Add a gate test: a real run with a planted `.env` beside the source must fail to read it.

### RF2. The agent can plant live script on a page that carries the review token

- severity: blocker. kind: red flag.
- where: Review kinds allowed (A6); Security, "Who can make it act".
- what: The agent can plant live script on a page that carries the review token.
- why: `src/service/markdown.js` overrides `link`, `code` and `table` but not `html`, so marked passes raw `<script>` and `<img onerror>` through. No CSP is set. Static HTML reviews are in scope too. One comment ("add this snippet") becomes stored script. On the next re-render it reads the token, posts new items forever (up to the ceiling), and reads anything under the served root. A hostile Markdown file someone sent can also drive the agent with nobody commenting at all.
- fix: After each run, diff the change. Refuse and roll back any added raw HTML tag, `on*` attribute or `javascript:` URL, and reply `not_handled` saying why. For v1, drop HTML reviews, or apply the same added-script check to them. Separately, escape raw HTML (or add a CSP) on rendered Markdown.

### RF3. The edited files are often instructions for later agents that have a shell

- severity: blocker. kind: red flag.
- where: Data, `allowed_files`; Security, "Page text is data".
- what: The edited files are often instructions for later agents that have a shell.
- why: The dogfood is LAHE's own docs: briefs and `docs/ongoing/` pages that builder agents obey, plus files like `skills/lahe/SKILL.md`, CLAUDE.md and AGENTS.md if linked. An unwatched edit can plant instructions that the owner's full-permission chat later runs, so "no shell" ends at the next session. The linked list is also shaped by the page: `recordLinks` runs when the static server renders a linked document that carries a rail, so page script can GET each linked doc in turn and grow `linked_files` to the whole Markdown link closure. "Never from anything a page posted" is true only in the narrowest sense. The source file's own text is an injection channel that D12 does not cover.
- fix: In v1, allow only the review's own source and no linked files. Refuse turn-on for instruction files: CLAUDE.md, AGENTS.md, GEMINI.md, SKILL.md, anything under `skills/`, `.claude/` or `.github/`. Show each agent edit as a diff on the card and in `lahe agent status`. Say this risk in the turn-on warning.

### RF4. The run's input still carries a page-set `source_hint`

- severity: important. kind: red flag.
- where: A wake, one run ("drain lines exactly as a chat agent gets them"); the headless preamble.
- what: The run's input still carries `source_hint`, and the page sets it through `page.visited` (`projection.js`, around line 279).
- why: The spike's prompt said "edit the source file named in its source_hint". A hint of `./.env` steers the model toward reading it (see RF1), and a wrong hint burns attempts.
- fix: The supervisor replaces `source_hint` in the input with the path LAHE resolved itself. The headless lines name the allowed files as the only files. Test: a page-posted hint pointing elsewhere never appears in the input.

### RF5. The stop route is the first page-reachable writer of `session.json`

- severity: important. kind: suggestion.
- where: Stopping, `POST /lahe/v1/agent/stop`; Data, "written by the stop route".
- what: The stop route is the first page-reachable route that writes `session.json`.
- why: It adds a new write path from the page into owner state. A read-modify-write from a stale copy can erase a concurrent takeover's `handoff_rev` or `on` flag. `by: "reviewer"` records a claim the helper cannot check. Any review token in the session stops the whole session.
- fix: Have the route append an event to the review's own `events.jsonl`, through the existing D11-checked path. The supervisor then sets `stopped`. The route ignores every body field. Label it "stopped from the page". Tests: extra body fields change nothing, and a stop during a takeover keeps the new rev.

### RF6. The child's environment is a blocklist

- severity: important. kind: red flag.
- where: The run's command, "Environment"; Preflight.
- what: The child's environment is the parent's minus a blocklist.
- why: `lahe agent on` is often run from a chat agent's shell, so the detached process inherits that shell's environment. `ANTHROPIC_BASE_URL`, `ANTHROPIC_CUSTOM_HEADERS`, proxy variables, `NODE_OPTIONS`, `AWS_*` and `CLAUDE_CODE_OAUTH_TOKEN` pass through (the last removed only by the CLAUDE* rule). Removing every CLAUDE* variable also drops `CLAUDE_CONFIG_DIR`, which can switch the run to a different login. Preflight's `claude auth status` runs with a different environment than the run, so it can report "subscription" while the run bills an API key. `claude` is looked up on PATH at every run.
- fix: Build the child's environment from an allowlist: `HOME`, `PATH`, `USER`, `LANG`, `TMPDIR`, plus `CLAUDE_CONFIG_DIR` if set, and the API key only with `--allow-api-key`. Run preflight with that exact environment and flags. Record the absolute path to `claude` at turn-on.

### RF7. Caps count items and runs, not bytes

- severity: important. kind: red flag.
- where: Security, "Denial of usage"; A4, A2.
- what: The caps count items and runs, not bytes. The per-run budget is checked only after money is spent.
- why: Reviewer text is never truncated (D12), and a request may be 8 MB (`MAX_BODY_BYTES`). So 25 items can make one huge first request that goes far past $0.50 before `--max-budget-usd` stops anything. Rewording resets the attempt count. Ceilings are per session, so each open session adds another $3.00. On a subscription, this drains the window the owner's own interactive work depends on.
- fix: Cap the input by bytes per item and per run; oversized items go back as `not_handled`. Add a machine-wide daily ceiling. Count attempts per item id across revisions.

### RF8. The model's `files` list and reply text are trusted too much

- severity: important. kind: suggestion.
- where: Reply schema; "Replies are checked against the batch".
- what: The model's `files` list and reply text are trusted too much.
- why: Reply text is the easiest exfiltration channel to the page (up to `REPLY_TEXT_MAX`, 20,000 characters). A model-reported `files` list can claim edits that never happened.
- fix: LAHE fills `files` from its own before and after stamps, not from the model. Cap headless reply text far lower, for example 500 characters. Keep structured output and never fall back to `Bash(lahe *)`. If structured output fails OQ2, stop and redesign rather than grant a shell.

### RF9. A file swapped for a symlink mid-run is followed

- severity: important. kind: red flag.
- where: Data, "refreshed before each run"; Security tests.
- what: Real paths are checked when the list is refreshed, but Claude Code's Edit follows whatever sits at that path when it writes.
- why: A file swapped for a symlink between the refresh and the edit is followed: a branch switch, another agent, a hostile repo. The design names no check at write time.
- fix: The staged copy from RF1, with LAHE's own no-symlink atomic write-back. Test: a swap made mid-run is refused.

### RF10. Stored run streams keep every Read result

- severity: minor. kind: suggestion.
- where: Privacy.
- what: `runs/<id>.jsonl` from stream-json with `--verbose` stores the full contents of every Read result.
- why: Given RF1, that can include secrets. The prompt file with the owner's note also stays in the session folder. Session folders outlive the session.
- fix: Keep only tool names, paths, sizes, usage and replies, and drop tool results. Delete the prompt file when the run exits. Say how long the folders are kept after close.

### RF11. The terms risk lives only in Security

- severity: minor. kind: suggestion.
- where: Subscription terms; Summary; the turn-on warning.
- what: The OQ1 statement is honest, but it lives only in Security.
- why: The Summary says "on the login the user already has" with no caveat. The warning covers billing but not the terms. The route the terms name explicitly (an API key) is the one the design makes opt-in. The quote is marked "via a fetch; check the page", so no person has confirmed it yet.
- fix: Have a person verify the quote against the page. Add one line to the Summary and to the warning. Record the dogfood-on-subscription choice as Ken's decision.

### RF12. `--safe-mode` and `--restricted` together were never measured

- severity: minor. kind: question.
- where: OQ2; command table.
- what: `--safe-mode` plus `--restricted` together were never measured.
- why: Per `claude --help`, `--restricted` still applies managed settings and `--settings`. It relies on `--strict-mcp-config` to skip MCP. Safe mode covers that today, but nothing asserts it.
- fix: Add `--strict-mcp-config` and `--setting-sources ""` as belt and braces. Have OQ2's repeat run include RF1's `.env` test and RF2's added-script test against real `claude`.
