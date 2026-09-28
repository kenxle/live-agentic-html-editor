# Plan Reviews: LAHE Library

## Code Review Lead Review (Round 1)

**Summary:** Not reviewable yet. Four blockers leave a builder no choice but to invent the answer:

- the Library page cannot pass its own route checks
- Open's new tab cannot be pointed anywhere
- dropping stale origins has no mechanism
- the drain section that carries Pick this up has no contract

Twelve important findings are contracts the builder would also have to make up: the request lifecycle, the two CLI commands, the multi-session monitor, error codes, and the page's copy and default view. The page's copy and default view live only in a git-ignored wireframe.

Read against: the brief, the architecture and its reviews, the plan, and `src/` at `b58fced` (`protocol.js`, `static_servers.js`, `reviews.js`, `session.js`, `status.js`, `monitor.js`, `log.js`). The plan has no recon notes file, so codebase facts below come from the code directly.

---

### RF1. The Library page cannot pass its own route checks

- **Severity:** blocker
- **Kind:** defect
- **Where:** Architecture, Security & Privacy Notes ("Every catalog request needs the Host check, `Sec-Fetch-Site: same-origin`, the custom header, and the token"); Plan 1.2 spec and Test List ("Each catalog route refuses...").
- **What:** `catalog.page` is a top-level navigation. A navigation cannot carry `x-lahe-client` or `x-lahe-token`. Its `Sec-Fetch-Site` is `none` from a bookmark, a typed URL, or an agent's `open`, and `same-site` from a link on a LAHE document (a different port on the same host is same-site, not same-origin).
- **Why:** built as written, the page never loads. Built so the page loads, the builder has quietly chosen which checks the page route skips. That is the route security depends on, and the reviewer has nothing to check the choice against.
- **Fix:** give each of the six routes its own row in a check table. Suggested:
  - `catalog.page`: Host check only; `Sec-Fetch-Site` must be `none` or `same-origin`; no token, since this response is what delivers it.
  - `catalog.asset`: Host check, plus `Sec-Fetch-Site` of `same-origin`.
  - The four API routes: the full set.

  Also say where the token sits in the page. Under `script-src 'self'` it cannot be an inline script, so name it: a `<meta>` tag or a `data-` attribute. Add a test that loads the page through a navigation-shaped request.
- **Back-patches:** architecture (Security notes), plan (1.2 spec and Test List), `docs/CONTRACTS.md` amendment.

### RF2. Open's "blank tab with no opener" cannot be pointed at the URL later

- **Severity:** blocker
- **Kind:** defect
- **Where:** Architecture, Open sequence ("open a blank tab now (noopener)" then "point the tab at url"); Plan Test List, Page ("Open opens the document in a new tab with no opener").
- **What:** `window.open(..., "noopener")` returns `null`, so the page keeps no handle to navigate the tab once the POST returns.
- **Why:** the builder either drops `noopener`, which reopens security RF13, or drops the pre-opened tab, which gets the tab blocked as a popup after the await. Either way the code departs from the doc, and the test cannot tell which way it went.
- **Fix:** pin the sequence:
  1. `const w = window.open("about:blank", "_blank")`
  2. `w.opener = null` before any await
  3. after the response, check the URL is loopback `http:`, then `w.location.replace(url)`
  4. on failure, `w.close()` and show the reason on the row

  The test asserts that `window.opener` is null in the opened tab.
- **Back-patches:** architecture (Open flow and Security notes), plan (2.2 spec, Page tests).

### RF3. "Drop that review's stale loopback origins" has no mechanism and no rule

- **Severity:** blocker
- **Kind:** defect
- **Where:** Architecture, Components (static servers) and Open sequence; Plan 1.3.
- **What:** `reviews.js` only adds origins. `registerOrigin` appends `ORIGIN_REGISTERED` to the review's append-only log, and `recoverFromLog` rebuilds the origin set from those events, so an origin dropped in memory comes back after a restart. The docs also never say which loopback origins count as stale. A dev-server review legitimately holds `localhost:5173` and its `127.0.0.1` twin.
- **Why:** the builder has to invent a new log event and a rule for staleness. A loose rule removes a live dev server's origin and breaks the rail on that page with a 403.
- **Fix:**
  - Define stale: the loopback origins this review got from an earlier port of the same `ss_` server, and only those. That needs the `ss_` record to keep a list of its past ports.
  - Name the new event (for example `origin.removed`) in `protocol.js`.
  - Change `recoverFromLog` to apply it.
  - Update the event table in `docs/CONTRACTS.md`.
  - Test: restart onto a new port, restart the helper, and check that the old origin is still refused and a dev-server origin on the same review is untouched.
- **Back-patches:** architecture (Data / State Changes: a new event type), plan (1.3 files add `src/shared/protocol.js`, and its tests), CONTRACTS.

### RF4. The `catalog_requests` drain section has no contract

- **Severity:** blocker
- **Kind:** defect
- **Where:** Architecture, Data / State Changes ("the drain adds the title and path as data fields, fenced"); Plan 1.4 and 3.1.
- **What:** the docs leave five things open:
  - Which fields each drain entry has. The request id, action, review, session and title are clear. The worktree candidate path, the other reviews that would move, the name to give a launched session, and the host command are not.
  - Where the section goes. The summary line, like `ended_reviews`, or its own lines?
  - Whether it counts as work for `--quiet` and for `lahe monitor`'s wake. Today the monitor wakes on item lines only (`monitor.js`), and the `--quiet` guard checks only `toPrint` and `endedToReport` (`status.js`).
  - Whether a request is shown on every drain until answered (like items) or once (like `ended_reviews`, which keeps a delivered file).
  - How the fence is declared. Fencing today means a field class in `reviewFormat.PROJECTED_FIELD_CLASS`, printed on the first JSON line. That lives in `review_format.js`, the contract file that 1.4 is told not to touch (3.1 owns it).
- **Why:** if the monitor does not wake on a request, Pick this up sits unseen until Ken happens to leave a comment. That is the brief's central hand-over failing silently. Different answers in 1.4, 3.1 and the skill are also the "one fact spelled three ways" drift this repo's `src/shared/` rule exists to stop.
- **Fix:**
  - Write the entry shape into the architecture as JSON, with each field's class (id or page text).
  - Put the section in the summary line beside `ended_reviews`.
  - Re-list a request until it is answered or expires.
  - Make the monitor wake on a request that is new since its last wake, keyed by request id, so a request the agent is still working on does not loop the wake.
  - Move the field-class addition into 1.4 and allow it that one edit to `review_format.js`. 3.1 then adds only prose.
  - Tests: the monitor wakes on a request alone, and `--quiet` prints when only a request is pending.
- **Back-patches:** architecture (Data / State Changes, new "Drain section" subsection), plan (1.4 spec, "Don't touch" line and Test List; 3.1 scope).

### RF5. The request lifecycle the page draws has no data behind it

- **Severity:** important
- **Kind:** defect
- **Where:** Architecture, list response (`"pending_request": null`) and Data / State Changes (expiry); Plan 2.2 ("waiting, done, refused and expired states"); brief R12c.
- **What:** gaps in the list data and the request route:
  - `pending_request` has no non-null shape.
  - A done, refused or expired request has no field at all. The row needs "which agent took it, or why it failed" (R12c) and "not picked up".
  - Nobody writes the expiry. The file is append-only; is the helper meant to append an expiry line, or work it out on each read?
  - How long a done or refused answer stays on the row is not said.
  - The `catalog.request` body is not given, and nothing says whether the helper itself enforces the R12b confirmation (for example with a `confirmed: true` flag).
  - When the cap of five is full, Open's automatic pick-up has no rule: does Open still open the document, with no request?
- **Why:** each state is a string on screen with no source, so the builder invents the timing and the copy. The reviewer cannot tell a correct "expired" from a made-up one.
- **Fix:**
  - Rename the field to `request`, with this shape: `{id, action, at, state: "waiting"|"done"|"refused"|"expired", by_name, text, answered_at}`.
  - The helper appends an `expired` line when it detects expiry, so the file stays the single record.
  - An answered request shows until the next request on that review, or 24 hours, whichever comes first.
  - Request body: `{review, action, confirmed}`. The helper refuses an unconfirmed request on a watched session.
  - When the cap is full, Open still opens and the row says no agent was asked.
- **Back-patches:** architecture (list response, queue), plan (1.4, 2.1 and 2.2 tests).

### RF6. `lahe library answer` cannot fill in `by`, and its edges are unstated

- **Severity:** important
- **Kind:** defect
- **Where:** Architecture, queue answer line (`"by": "s_<attached>"`); Plan 1.4 (`lahe library answer <request-id> --status done|refused --text "..."`).
- **What:** the command takes no `--session`, so nothing tells it who is answering. The docs also leave out:
  - what happens on an unknown, expired or already-answered id
  - exit codes
  - a length cap on `--text`, which is agent-written and shown on the page
- **Why:** the row cannot say "which agent took it" (R12c) without `by`. The builder picks the behavior for a double answer.
- **Fix:** add `--session <id>` (required) and check it equals the request's `for`. Then:
  - unknown id: `BAD_USAGE`
  - a second answer: refused, with the first answer printed
  - `--text`: capped (name the constant) and shown with `textContent`

  Document it in `docs/CLI.md`.
- **Back-patches:** architecture (queue), plan (1.4 spec and tests, 3.1).

### RF7. `lahe library` itself is under-specified, and the brief and architecture disagree on it

- **Severity:** important
- **Kind:** defect
- **Where:** Brief, Solution Outline 1 ("opens the Library in the browser") and R15; Architecture, Reaching the Library ("print http://127.0.0.1:7817/catalog"); Plan 1.4.
- **What:** open questions about the command:
  - Does it open a browser, or only print the URL?
  - What does it do with no `--session`: clear the attach, keep it, or refuse?
  - What does it print: one line, or JSON under `--json` like its siblings?
  - Which port does it print when the helper runs on `--port`? The fixed-port claim assumes 7817, and `currentHelperOrigin` reads the port from `service.json`.
- **Why:** R12a (name the agent before the click) depends on the attach. A no-session run that silently clears it leaves Ken with a Library that names nobody.
- **Fix:**
  - It prints the URL and does not open a browser; the skill tells the agent to run `open`. Or pick the reverse, and say so in the brief.
  - With no `--session`, it leaves the attach as it is and prints who is attached.
  - Add `--json` with `{url, attached, helper_started}`.
  - It prints the actual helper origin.
- **Back-patches:** brief (Solution Outline 1), architecture (Reaching the Library), plan (1.4), CLI.md.

### RF8. The multi-session monitor has no exit or heartbeat rules, and "which agent is watching" has no source

- **Severity:** important
- **Kind:** defect
- **Where:** Architecture, Components (CLI) and Analysis ("`lahe monitor` watches one session"); Plan 1.4; brief R3 ("whether an agent is watching it, and which one").
- **What:**
  - `monitor.js` has four exit codes, each about one session. With two sessions it is unclear what happens when one is closed or taken over and the other is not.
  - The duplicate-monitor refusal and `monitor.json` are per session. The docs do not say whether a two-session monitor writes a heartbeat into both, or which session it names.
  - After a pick-up, session B's `monitor.json` would come from agent A's monitor, but nothing records that A is the one watching. So "watched by <agent>" can only print B's own name, which is the old agent's name.
- **Why:** the brief promises the row shows who is watching. The data cannot say it, so the builder will print something plausible and wrong.
- **Fix:**
  - A closed or taken-over session is dropped from the watch set, with a printed line. The monitor exits with that session's code only when no session is left.
  - The heartbeat goes into every watched session's `monitor.json`, with a `primary` field naming the first `--session`.
  - The list's `watching` becomes `{session, name}` taken from `primary`.
  - Tests for each of these.
- **Back-patches:** architecture (Components, list response), plan (1.4 spec and tests, 1.1 reader rule).

### RF9. A helper restart kills an open Library page, and the page has no recovery

- **Severity:** important
- **Kind:** risk
- **Where:** Architecture, Security ("token is minted in memory at each helper start"); `session.js` `startHelper`.
- **What:**
  - `startHelper` restarts a stale helper whenever the source is newer. It spares only review windows (`readLiveHolders`), and the Library page is not one of them.
  - A new helper mints a new token, so every later poll from the open Library page gets a 401.
  - No doc says what the page does on a 401.
- **Why:** in this repo, source changes restart the helper often. The Library then goes quietly dead while it looks alive, which is the brief's core trust promise broken.
- **Fix:**
  - On `PROTO_UNAUTHORIZED` the page reloads itself once, since the page route re-issues the token (RF1). If the reload also fails, it shows a banner.
  - `startHelper` counts a Library poll in the last two minutes as a live holder.
  - One test for each.
- **Back-patches:** architecture (Helper lifetime, Security), plan (1.2 or 2.1, 2.2).

### RF10. The catalog routes' error codes, client value and exact Origin are unnamed

- **Severity:** important
- **Kind:** defect
- **Where:** Architecture, Security notes; Plan 1.2; `protocol.js` `CHECKS`, `CLIENTS`, `STATUS_FOR_CODE`.
- **What:**
  - `CLIENTS` is `["layer", "cli"]`, and the Library page's value is not named.
  - `Sec-Fetch-Site` needs a new `CHECK` entry and error code.
  - The refusals the page must show have no codes or statuses: not openable, missing, one pending already, queue full, attached agent gone, worktree candidate refused.
  - "Origin exactly equal to the helper's own" does not say which spellings count, `127.0.0.1` or `localhost`, or which port under `--port`.
- **Why:** the page's error copy keys off these codes. Without names, the builder spells the same code in the handler and in the page separately, which is what `src/shared/` exists to prevent.
- **Fix:**
  - Add to `protocol.js`:
    - client value `catalog`
    - `CHECK.SEC_FETCH_SITE` with `PROTO_CROSS_SITE` (403)
    - `PROTO_NOT_OPENABLE` (409)
    - `PROTO_REQUEST_PENDING` (409)
    - `PROTO_QUEUE_FULL` (429)
    - `PROTO_NO_AGENT` (409)
  - The allowed Origins are both loopback twins at the helper's actual port.
  - Each code gets a remedy line, and the page shows that remedy.
- **Back-patches:** architecture (Security notes), plan (1.2), CONTRACTS.

### RF11. The page's default view and copy live only in a git-ignored wireframe

- **Severity:** important
- **Kind:** risk
- **Where:** Plan 2.2 ("Wireframe B"); the feature folder's `.gitignore` (`wireframes/`); the progress page (the wireframes were rebuilt in `~/Documents/lahe-library-wireframes`); brief R4 ("settled in the wireframe").
- **What:** a builder worktree has no wireframes. None of the three docs writes down:
  - R4's default view: what is visible without a click, and what is collapsed or paged
  - the top section's title
  - button labels
  - the confirmation copy (R12b)
  - the missing-row reason (R7)
  - the waiting, done, refused and expired strings
  - the no-agent copy
  - the empty state
- **Why:** the builder writes all of that copy, and the reviewer has nothing to compare it against. The acceptance item "a week of reviews is findable without typing a search" cannot be checked either.
- **Fix:** add a "Page copy and default view" section to the architecture, or a plan appendix. It should hold the default view rule in numbers (for example, "this week expanded, older sessions collapsed by day") and a table of every string, keyed by state. Keep the real document names out, since the repo is public.
- **Back-patches:** architecture or plan (new section), plan (2.2 spec and acceptance).

### RF12. The list response leaves out fields the rows need, and leaves derived rules open

- **Severity:** important
- **Kind:** defect
- **Where:** Architecture, list response; Plan 1.1; brief R2, R3.
- **What:**
  - Reviews have no last-activity time. R3 asks for "when it was last worked on" per row; only sessions have `last`.
  - The R2 fallback name ("title missing or shared with another row") has no field, and the docs do not say whether the reader or the page computes it.
  - `projects` has no rule: the git top level's name, the main repository's name for a worktree, or something else?
  - `openable: yes` says "root contains the page", but `servesPath` also counts `mounts`.
  - `pages[].path` does not say what it is relative to, or whether a page row has its own Open.
- **Why:** each gap is a rule the builder invents, and the reviewer's unit tests would check that invention rather than a decision.
- **Fix:**
  - Add `last` and `display_name` to each review; the reader computes both.
  - Define a project as the base name of the git top level, using the owning repo for a worktree, and "no project" otherwise.
  - Define `openable` as `servesPath(...)`, which counts mounts.
  - `pages[].path` is a URL path on the review's server. Page rows are informational only.
- **Back-patches:** architecture (list response), plan (1.1 spec and tests).

### RF13. Open on an agent-only review with no agent attached, and on legacy or dev-server reviews, has no defined path

- **Severity:** important
- **Kind:** defect
- **Where:** Architecture, Open ("Everything else is `via-agent`... dev-server reviews, legacy `lahe add` script-line reviews"); Plan 3.1.
- **What:**
  - With no agent attached, the Open button on a `via-agent` row has nothing to queue, and nothing says what it does instead.
  - Legacy reviews recover with `agent_session_id: "legacy"` (`reviews.js`). Taking over "legacy" is not defined.
  - For a dev-server review, `lahe review` cannot restart the dev server, and the skill (3.1) has no instruction for that case.
- **Why:** the progress page counts many legacy and missing rows on real data. This is a common path, and the builder would write the agent's instructions from nothing.
- **Fix:**
  - With no agent, a `via-agent` Open button is disabled and shows the hand-off message (R14).
  - For legacy reviews, the agent runs `lahe review <path>` in its own session instead of a takeover.
  - For a dev-server review, the agent answers `refused` with the dev server's command, if one is recorded, or "start the dev server, then ask me again".
  - Write all three into the 3.1 scope.
- **Back-patches:** architecture (Open), plan (2.2, 3.1).

### RF14. The Launch contract is prose, not a spec

- **Severity:** important
- **Kind:** defect
- **Where:** Architecture, Launch a new agent; brief R13, UX Notes; repo `CLAUDE.md` (cross-platform).
- **What:** four things are unstated:
  - the exact command and prompt the agent launches
  - how "named after the document" happens (`lahe session takeover --name`?)
  - what to do on Linux and Windows, where there is no Terminal.app
  - whether the page-derived title may appear in a shell argument or in the new agent's prompt
- **Why:** this text lives in the skill, the contract and CONTRACTS (3.1), so three copies of an invented template ship. A title in a shell string is an injection path the security review never saw.
- **Fix:**
  - Write the prompt template in the architecture. It carries ids only; the new agent reads the title from `lahe status`.
  - The session name is set with `lahe session takeover <id> --name` from inside the new agent.
  - macOS uses Terminal through `osascript`, with arguments passed as an array.
  - Other platforms answer `refused` with the paste-in message.
- **Back-patches:** architecture (Launch), plan (3.1), and the security review.

### RF15. Reopen, restart-one and auto-close live in the CLI today; the helper-side versions are unassigned

- **Severity:** important
- **Kind:** risk
- **Where:** Plan 1.3 and 2.1; `session.js` (reopen calls `restartAll`, close calls `stopAll` then `stopVerifiedHelper`); `static_servers.js` (`start` spawns `listen(0)`).
- **What:**
  - Open needs "restart one server by id, old port first". But `start` takes no port, and the spawned server always listens on 0, so the old port has to be passed through the child's arguments.
  - The helper's reopen, restart-one and 30-minute auto-close need `store.reopen`, restart-one, `stopAll` and `store.close` called from inside the helper process, not from the CLI.
  - "No takeover" needs the `handoff_rev` at reopen time recorded somewhere.
- **Why:** 1.3 and 2.1 will each carve the shared part out of `session.js` their own way. That is a hidden coupling with a merge conflict built in.
- **Fix:**
  - 1.3 owns a service-level `reopenForCatalog(sessionId, serverId)` and `closeQuiet(sessionId)`, and 2.1 calls them.
  - The spawned server takes a preferred-port argument and falls back to 0.
  - `catalog.json`'s `reopened` entry stores `{at, handoff_rev}`.
- **Back-patches:** architecture (Data: `reopened` shape), plan (1.3 and 2.1 files and spec).

### RF16. The page is built against a state-dir fixture, not the list JSON

- **Severity:** important
- **Kind:** risk
- **Where:** Plan diagram ("list shape fixture"), 1.1 files ("a fixture state dir") and 2.2 ("develops against the 1.1 fixture").
- **What:** 2.2 needs a `catalog.list` JSON to render. 1.1 produces a state directory.
- **Why:** 2.2 will hand-write its own JSON, which drifts from what the reader returns. The drift only shows up in 3.2.
- **Fix:** 1.1 commits `test/fixtures/catalog_list.json`, generated from the fixture state dir, and a unit test asserts the reader's output equals it. 2.2 renders that file, and states cover every row kind.
- **Back-patches:** plan (1.1 files and acceptance, 2.2).

### RF17. Unnamed constants, and a date that disagrees across docs

- **Severity:** minor
- **Kind:** defect
- **Where:** Architecture throughout; brief R5.
- **What:**
  - These values have no constant names: the re-projection size limit (no value given at all), the 15-second poll, the 2-minute Library-alive window, the 30-minute expiry, the 30-minute auto-close, and the cap of 5.
  - "Liveness threshold" could mean `MONITOR.HEARTBEAT_FRESH_MS`, `AGENT_LIVENESS.STALE_MS` or the watchers TTL.
  - The brief says "before Sep 16"; the architecture says "before 2026-09-17".
- **Why:** the fold test sits right on that date boundary, and "liveness threshold" would be picked by feel.
- **Fix:**
  - Put the constants in one place, `protocol.CATALOG`, with values.
  - Name `MONITOR.HEARTBEAT_FRESH_MS` for the liveness threshold.
  - Pick one cutoff date and match the other doc to it.
- **Back-patches:** brief (R5) or architecture, plan (1.1 and 1.4).

### RF18. Expiry "when the attached session changes" does not match the test "on a new attach"

- **Severity:** minor
- **Kind:** defect
- **Where:** Architecture, queue expiry; Plan Test List (Queue).
- **What:** an agent that re-runs `lahe library --session <same id>` is a new attach but not a change of session.
- **Why:** under the test's wording, re-attaching the same agent silently kills its own pending requests.
- **Fix:** expire only when the attached session id differs, and test the same-id re-attach.
- **Back-patches:** plan (Test List).

### RF19. The analytics log line and the "older than" rule are not pinned

- **Severity:** minor
- **Kind:** defect
- **Where:** Brief, Success Metrics ("older than the default view"); Plan 3.3 ("older than a week"); `log.js` `helperLog` (free text).
- **What:**
  - The script parses free-text lines that have no fixed format.
  - "Older" is a week in the plan and "the default view" in the brief, and the default view is not defined (RF11).
  - Nothing says which gate runs a Python script.
- **Why:** a later rewording of the log line breaks the metric without anyone noticing.
- **Fix:**
  - Pin the line as `catalog <action> review=<id> age_days=<n>`, written by the helper at action time.
  - Make "older" match the default view in both docs.
  - Say that 3.3's acceptance is a manual run, recorded on the progress page.
- **Back-patches:** brief (metric), plan (3.3).

### RF20. 1.1's acceptance names the real state dir, which a reviewer cannot reproduce

- **Severity:** minor
- **Kind:** defect
- **Where:** Plan 1.1 Acceptance ("reading the real state dir (about 500 reviews) never folds a log over the size limit").
- **What:** the check depends on Ken's machine and on a limit that has no value.
- **Why:** it cannot be verified from code and tests.
- **Fix:** add a fixture review whose log is over the named limit, and a test that asserts that log is never read, using a spy on `log.read` or checking read counts.
- **Back-patches:** plan (1.1).

### RF21. Three Phase 1 tasks edit `protocol.js` in parallel, and the health response changes

- **Severity:** minor
- **Kind:** risk
- **Where:** Plan 1.2 (owns `protocol.js`), 1.3 (needs a new event, RF3), 1.4 (drain field names, RF4), 2.1 (health gains the last-poll time).
- **What:** only 1.2 lists `protocol.js`. The documented `health` response (`{ok, version, api, service_contract, started_at}`) grows a field in 2.1, and no task updates CONTRACTS for it.
- **Why:** there will be merge conflicts in the one file every route depends on, and the contract doc will be quietly out of date.
- **Fix:** list `protocol.js` in the files for 1.3 and 1.4, with the names each adds. Add the health field to 1.2's CONTRACTS edit.
- **Back-patches:** plan (1.3, 1.4 and 2.1 files).

### RF22. What `catalog.asset` serves, and how the page script gets header names, is open

- **Severity:** minor
- **Kind:** defect
- **Where:** Architecture, Components ("Header names come from `protocol.js`"); Plan 1.2 and 2.2.
- **What:** the docs do not say:
  - whether the page script is served raw from `src/layer/catalog/` or built into `dist/`
  - whether `protocol.js` is served as a second script
  - the name of the new manifest list
  - whether `check:layer` covers any of it
- **Why:** a builder who hard-codes `x-lahe-token` in the page breaks the one-spelling rule. A builder who adds a second bundle breaks the "builders never commit `dist/`" rule.
- **Fix:** `catalog.asset` serves a fixed allowlist: `protocol.js`, `catalog/page.js`, the style bundle and the fonts, all raw from `src/`, with no build step. Name the manifest list `CATALOG_PAGE`.
- **Back-patches:** architecture (Components), plan (1.2 and 2.2).

### RF23. Some acceptance items have no test in the Test List

- **Severity:** minor
- **Kind:** risk
- **Where:** Plan Acceptance Criteria against the Test List.
- **What:** these have no test:
  - search across every field (R6)
  - the project filter
  - the missing toggle, and Open's reason on a missing row (R7)
  - the agent named before the click (R12a)
  - the Library still working after the last close, in the browser (R10a)
- **Why:** the acceptance items have no automated proof. The testing reviewer owns the depth; this only notes the gap.
- **Fix:** add one page-level test for each.
- **Back-patches:** plan (Test List).

### RF24. Every 15-second poll probes live servers and agent watchers

- **Severity:** minor
- **Kind:** risk
- **Where:** Architecture, list response (`served_url`, `watching`), and Helper lifetime (the poll runs even when the tab is hidden); `watchers.js` (probe timeout 2 s); `static_servers.isExactServer` (HTTP probe, 500 ms).
- **What:** each poll runs one HTTP probe per unstopped `ss_` record plus watcher probes, forever, in a background tab.
- **Why:** a slow or dead probe holds up the list response, and the cost scales with history.
- **Fix:** cache the probe results for one poll interval, run the probes in parallel, and skip `ss_` records that have `stopped_at` set.
- **Back-patches:** architecture (list response notes), plan (1.1).

### RF25. The brief's PM table claims a non-goal the brief does not contain

- **Severity:** minor
- **Kind:** defect
- **Where:** Brief, PM Review RF8 ("added as a non-goal") against Non-Goals and Open Question 5.
- **What:** "The page never starts a program" is not in Non-Goals, and Open Question 5 explores exactly that.
- **Why:** a reviewer cannot tell whether direct launch is excluded.
- **Fix:** update the RF8 row to say it became Open Question 5, deferred by the architecture.
- **Back-patches:** brief.

### RF26. No task updates `docs/diagrams/`

- **Severity:** minor
- **Kind:** defect
- **Where:** Plan, all phases; `docs/diagrams/system_overview.md`, `session_ownership.md`, `module_map.md`.
- **What:** the helper gains a page, a queue, a new credential and a lifetime rule, and one monitor can now watch several sessions.
- **Why:** the next builder's brief points at diagrams that are out of date.
- **Fix:** add the diagram updates to 3.1.
- **Back-patches:** plan (3.1).

## Engineering Manager Review (Round 1)

**Summary.** The four Phase 1 tasks can run in parallel once three things are fixed:

- the branch is brought up to date with main
- the shared files (`manifest.js`, `protocol.js`) are landed once before dispatch, not edited by several builders
- the page-to-helper seam (1.2 serves the page, 2.2 writes it) gets one owner

As written, 2.2 cannot start because its wireframe is not in the repo. Phase 3 tasks list no files. Several page tests and two acceptance lines have no task that owns them.

Findings are ranked worst first. Reviewed at worktree HEAD `b58fced` on `feat/lahe_library`, plan file uncommitted.

### RF1: The feature branch is 73 commits behind main, and main changed the files Phase 1 edits

- **severity:** blocker
- **kind:** risk
- **where:** plan, Phase 1 (no setup step); `git rev-list --count HEAD..origin/main` reports 73
- **what:** Since this branch was cut, main changed `src/shared/protocol.js`, `src/shared/manifest.js`, `src/service/routes.js`, `src/service/static_servers.js`, `src/service/reviews.js` and `src/shared/review_format.js`, and the plan has no step to bring those in before builders fork.
- **why:** Every Phase 1 builder would branch from the stale base. Each one then carries the same conflicts against main, and the orchestrator resolves them four times at the checkpoint instead of once now. 1.3 in particular edits `static_servers.js`, which main changed by 42 lines (the linked-docs work).
- **fix:** Add a setup step before Phase 1, owned by the orchestrator: merge `origin/main` into `feat/lahe_library`, run `gate:unit`, and fork builders only from that commit.

### RF2: No one owns the seam between the page (2.2) and the routes that serve it (1.2)

- **severity:** blocker
- **kind:** defect
- **where:** Task 1.2 Spec; Task 2.2 Spec and Files
- **what:** 1.2 says all six catalog routes are stubbed to 501, then says `catalog.asset` serves the page script, a script that 2.2 creates later under a folder whose file names nobody has picked.
- **why:** Four decisions sit on this seam, and each task can reasonably assume the other one makes them:
  - which file `catalog.asset` reads
  - who writes the token into the served page
  - how the page script learns the custom header name, given that it is outside the rail bundle and cannot `require` `protocol.js`
  - whether 2.2 has to edit `routes.js` or `index.js` to connect its template, which would collide with 2.1 running beside it

  The 1.2 test "the page response carries the frame and script policies" also needs a page to exist before 2.2 has built one.
- **fix:** Make `catalog.page` and `catalog.asset` real in 1.2, not stubs. Have them serve a placeholder template and script at fixed paths the plan names (for example `src/service/catalog_page.js` and `src/layer/catalog/catalog.js`). Pin a written bootstrap contract: a JSON data block in the page holding the token, the header name, the route paths and the poll interval, all filled from `protocol.js`. 2.2 then only replaces the template body and the script, and touches no route file.

### RF3: Task 2.2 cannot read Wireframe B from its worktree

- **severity:** blocker
- **kind:** defect
- **where:** Task 2.2 xref ("Wireframe B"); `docs/features/20260922.02_lahe_library/.gitignore` ignores `wireframes/`
- **what:** The wireframes are gitignored, which is right because the repo is public and they show real document names. That also means a fresh worktree does not have them.
- **why:** The 2.2 builder would either invent the layout or stop and ask. The page states (confirm, done, handoff, launch, missing, no agent, waiting) are the spec for most of 2.2.
- **fix:** In 2.2, name the absolute path the builder reads from (`~/Documents/lahe-library-wireframes/b-nested/`, which has `index.html` plus one file per state), and list which file shows which state. The architecture's list response is the data shape. The wireframe is the layout.

### RF4: How `catalog_requests` wakes the monitor is undecided, and so is what a monitor watching two sessions does

- **severity:** blocker
- **kind:** defect
- **where:** Task 1.4 Spec, bullets on `lahe status` and `lahe monitor`; `src/cli/commands/monitor.js`, `src/cli/commands/status.js`
- **what:** `lahe monitor` exits when its internal drain (`status --json --quiet`) prints anything. `ended_reviews` avoids repeat wakes with a delivered-once file. The plan says nothing about whether a pending request is reported once or on every poll. For a monitor with more than one `--session`, it also leaves these open:
  - which session's heartbeat it writes
  - what happens when one session closes (exit, or keep watching the other)
  - what happens on a takeover of one of them
- **why:** Reported on every poll, one unanswered request wakes the agent over and over. That is the no-op token burn this repo has already paid for once. Not reported as work, the agent never sees the request until some other comment wakes it. For the two-session monitor, the 1.4 builder has to design exit semantics that the whole wake system depends on.
- **fix:** Put these decisions in 1.4:
  - A request is delivered to a session once, tracked the same way `ended_reviews` is.
  - A new request counts as work for the `for` session.
  - With several `--session` flags, the monitor keeps a heartbeat for each session. It exits on work in any of them. It exits closed or handed off only when every session it watches is closed or handed off.

  Add a test for each of these.

### RF5: The list fields `attached` and `pending_request` have no owner

- **severity:** important
- **kind:** defect
- **where:** Task 1.1 Spec (does not list them); Task 1.4 (owns the files they come from); Task 2.1 ("list (1.1)")
- **what:** The architecture's list response has a top-level `attached` block and a `pending_request` on each review. 1.1 builds the rest of the response and runs in parallel with 1.4, which owns both files these fields come from (`catalog-attach.json` and the queue).
- **why:** 2.1 wires `list` as "1.1's output" and ships without them, or 1.1 re-implements parts of 1.4. The page's "names the agent before you click" (R12a) and "waiting" states (R12c) then have no data.
- **fix:** In 2.1, say that the list handler joins 1.1's sessions with 1.4's `readAttached()` and `pendingFor(reviewId)`, name those two functions in 1.4's spec, and add a route test that checks both fields.

### RF6: The worktree candidate path contradicts "ids only", and nobody computes it

- **severity:** important
- **kind:** defect
- **where:** Task 1.4 ("append a request (ids only)"); Task 2.1 ("including the worktree candidate path check"); architecture, Key Flows, Worktree fallback
- **what:** The architecture says the pick-up request carries the candidate main-repo path. The record shape and 1.4 say requests hold ids only. No task says who works out the candidate from the recorded root.
- **why:** 1.4 and 2.1 will pick different answers in parallel worktrees. The drain would then print no path for R9 (open the main-repo copy when a worktree is gone), or 2.1 adds a field that 1.4's reader drops.
- **fix:** Decide in the plan. One option: the helper checks the candidate in 2.1 and stores it as a `candidate` field. That is not page text, so the ids-only rule still holds for everything a page can set. The other option: `status` recomputes it at drain time from 1.1's worktree rule. Name the function and its owner.

### RF7: Three tasks edit `manifest.js`, which is marked frozen

- **severity:** important
- **kind:** risk
- **where:** Tasks 1.1 and 1.4 ("manifest entries"), 2.2 ("its own manifest list"); `src/shared/manifest.js` header ("A change to this file goes through the orchestrator")
- **what:** 1.1 and 1.4 each append to `NON_BUNDLE_FILES` in parallel. 2.2 adds a new exported list.
- **why:** Two appends at the end of the same array conflict at every merge. The lint completeness check means neither builder can skip the entry. The new list also needs its owner and `why` fields settled before 2.2 starts.
- **fix:** The orchestrator lands every new entry once, before Phase 1, with `planned: true`: `catalog_reader.js`, `catalog_requests.js`, `commands/library.js`, `catalog_page.js`, and a `CATALOG_FILES` list for `src/layer/catalog/`. Lint already accepts planned entries. Builders then flip `planned` off only on their own line.

### RF8: `protocol.js` has one owner in Phase 1, but other Phase 1 tasks need its new constants

- **severity:** important
- **kind:** risk
- **where:** Task 1.2 Files; Tasks 1.4 and 2.1 (use constants 1.2 adds)
- **what:** 1.4's `lahe library` prints the `/catalog` URL, which 1.2 defines in `protocol.js` at the same time. 2.1 adds a field to the `health` response. 3.3 needs log event names. `protocol.js` is also in the rail bundle.
- **why:** 1.4 will hard-code `/catalog`. That breaks the rule that route paths are spelled once, and it drifts if 1.2 spells it differently. Every `protocol.js` change also makes `dist/` stale, and `check:layer` fails at the checkpoint until the orchestrator rebuilds.
- **fix:** Land the catalog route names, paths, auth class and header name in `protocol.js` in the same pre-dispatch commit as RF7. 1.2 then implements against them rather than defining them. Note in the plan that the orchestrator rebuilds `dist/` after merging 1.2.

### RF9: Phase 3 tasks have no file lists, and "the helper log" is not a named file

- **severity:** important
- **kind:** defect
- **where:** Tasks 3.1, 3.2, 3.3
- **what:** None of the three names its Files or Don't touch. 3.3 runs in parallel with 3.1 and 3.2 and has to edit 2.1's route handlers in `routes.js`. The helper has per-review `events.jsonl` logs, and the plan does not say which log gets the Open, Star, Pick up and Launch lines, or what shape they take. 3.2 does not name its spec file or the "stub agent" it uses.
- **why:** 3.3's builder picks a log file and a line shape that the count script then depends on. 3.2's builder invents the stub agent. And nothing stops 3.1 and 3.3 from both touching `routes.js` or `CONTRACTS.md`.
- **fix:** Give each task Files and Don't touch. For 3.3, name the log file, the line shape and the script path (`scripts/<name>.py`). For 3.2, name the spec file (for example `test/browser/catalog_library.spec.js`) and say the stub agent answers by running `lahe library answer`. Or move the log lines into 2.1, which already owns those handlers.

### RF10: Page tests and two page requirements have no owner

- **severity:** important
- **kind:** defect
- **where:** Test List, "Page (2.2 and 3.2)"; Task 2.2 Spec and Acceptance; Task 3.2 Spec
- **what:** 3.2's spec covers Open, pick-up and confirm. These have no owner:
  - four of the five page tests: row HTML renders as text, the tab opens with no opener, the no-agent hand-off, the second click
  - R7 (missing documents hidden by default, with a way to show them and an Open that says why)
  - R9's message (the page says it is the main repo's copy, which may differ)

  2.2's acceptance is a design pass only.
- **why:** Unit tests cannot render the page, because jsdom is banned by lint. So these checks only happen if a browser spec runs them, and no spec is assigned. The repo rule that a visual change ships with light and dark screenshots from its own test run also has no owner in 2.2.
- **fix:** Give 2.2 its own named browser spec covering those four tests plus the missing toggle and the worktree row. Add R7 and R9's row copy to 2.2's spec. Require 2.2's screenshots on the progress page. 3.2 stays the end-to-end spec.

### RF11: Acceptance lines with no task, and no Phase 3 phase test

- **severity:** important
- **kind:** defect
- **where:** Acceptance Criteria, "This feature" (R10a) and "Standard" (every user story walked end to end); Task 3.3
- **what:** Three gaps:
  - **R10a** (documents opened from the Library keep working after the last session closes). 2.1 only tests that the helper stays up. `session close` still runs `staticServers.stopAll` for that session. No test shows an opened document surviving the close.
  - **User stories.** "Every user story walked end to end" has no owner, and Phase 3 has no phase test.
  - **Metric mismatch.** 3.3 counts Opens "older than a week". The brief's metric is Opens "older than the default view".
- **why:** The checkpoint has no written smoke check, so the release gate depends on whoever runs it remembering the list. R10a can pass its unit tests and still fail in use.
- **fix:**
  - Add a 2.1 test: close the last session, and the opened document still answers and still accepts a comment.
  - Add a Phase 3 phase test, owned by the orchestrator, that walks each user story as numbered steps. Include the restart story: stop LAHE, `lahe library`, then Open.
  - Change 3.3 to match the brief's metric, or change the brief.

### RF12: The Phase 2 test and 1.1's acceptance run against Ken's live state and port

- **severity:** important
- **kind:** risk
- **where:** Phase 2 Phase test ("on a real state dir"); Task 1.1 Acceptance ("reading the real state dir (about 500 reviews)")
- **what:** The Library's address is the fixed port 7817, the same one Ken's running helper uses. On the real state dir, Open reopens sessions, restarts static servers, re-registers origins on real reviews, and starts the 30-minute auto-close. 1.1's check is not runnable under `gate:unit`, and the repo is public.
- **why:** A builder or the orchestrator running the phase test replaces or collides with Ken's helper. It can also close sessions he is using. 1.1's acceptance line cannot be checked by the gate a builder runs.
- **fix:** Run the Phase 2 test on a copy of the state dir, using `--state-dir` and a different `--port`, and name the orchestrator as the one who runs it. For 1.1, test the size limit in a unit test with a synthetic large log in the fixture. Keep the fixture's names synthetic.

### RF13: No merge order, and no seam test across the Phase 1 branches

- **severity:** important
- **kind:** risk
- **where:** Phase 1 Phase test (only `gate:unit` on the integrated branch)
- **what:** Two rules are built twice in parallel, and nothing checks that they agree after the merge:
  - 1.1 decides "openable: yes" when a recorded server's root contains the page.
  - 1.3 restarts that same server.
  - 1.4's queue expiry reads liveness through `agent_sessions.js`.
  - 1.1's `watching` reads that same liveness.
- **why:** Each branch passes its own tests while disagreeing on the rule. The disagreement surfaces in 2.1 as a row that says Open works and an Open that refuses.
- **fix:** State the merge order: 1.1, 1.3, 1.4, then 1.2, with the orchestrator rebuilding `dist/` after 1.2. Add one seam test to the Phase 1 phase test: every fixture row that 1.1 marks `openable: yes` restarts under 1.3's function. Say that 1.1 and 1.4 both call the existing liveness function in `agent_sessions.js` rather than writing their own.

### RF14: The static server Host check does not say whether `localhost` is allowed

- **severity:** minor
- **kind:** defect
- **where:** Task 1.3 Spec ("its own loopback address and port")
- **what:** It does not say whether `localhost:<port>` is accepted beside `127.0.0.1:<port>`.
- **why:** Refusing `localhost` breaks anyone who typed it, and a builder running only `gate:unit` will not see a browser-level regression until the checkpoint.
- **fix:** State the accepted Host set. Let 1.3 run the one existing static-server browser spec by name, as the repo rules allow for browser-only behavior.

### RF15: `catalog.json` is read in 1.1 and written in 2.1, with no shared module

- **severity:** minor
- **kind:** risk
- **where:** Task 1.1 ("stars read from `catalog.json`"); Task 2.1 (star, and the `reopened` map used by auto-close)
- **what:** The file's schema is split across two tasks. The `reopened` map is never named in 2.1's spec.
- **why:** Two readers of one file drift. 2.1's builder may also miss that auto-close depends on writing `reopened`.
- **fix:** Put the read and the write in one module (for example `src/service/catalog_store.js`, owned by 1.1, with 2.1 adding the write). Name `reopened` in 2.1's spec.

### RF16: What the page does when the helper restarts is unowned

- **severity:** minor
- **kind:** defect
- **where:** Task 2.2 Spec; `src/cli/commands/session.js` `startHelper` (replaces a stale helper)
- **what:** A new token is minted at every helper start, and `lahe review` replaces a stale helper. After that, every call from an open Library tab is refused.
- **why:** Ken sees an unexplained broken page, and the page has no honest failure message.
- **fix:** In 2.2, say that a refused poll shows a "LAHE restarted, reload this page" state. Add that to 2.2's browser spec.

### RF17: Open on a `via-agent` row with no agent attached is undefined

- **severity:** minor
- **kind:** defect
- **where:** Task 2.1 Spec (open); architecture, "What Open can restart itself"
- **what:** `via-agent` rows queue a pick-up when clicked. No task says what Open does when nobody is attached.
- **why:** 2.1 and 2.2 each pick a behavior, and they may pick different ones.
- **fix:** Say it shows the R14 hand-off message (the paste-in message for any agent), and add it to the page tests.

### RF18: The drain rebuilds titles and paths that 1.1 already owns

- **severity:** minor
- **kind:** risk
- **where:** Task 1.4 ("title and path as fenced data fields")
- **what:** The drain needs the same fallback title and fold rules as the list.
- **why:** Written twice in parallel, the agent and the page name the same document differently.
- **fix:** After 1.1 merges, the drain calls the reader's title function. Or move the drain's title fields into 2.1.

### RF19: The board row this plan closes is unclaimed, and main's gate is red

- **severity:** minor
- **kind:** risk
- **where:** Task 1.3 ("closes board row LAHE-static-server-host-check"); main's `docs/BULLETIN.md` (the host-check row and LAHE-main-gate-red-rail-hold, both `@anyone`)
- **what:** Nobody claims the host-check row at dispatch. Main's browser gate has been red on `rail_hold.spec.js` since 2026-09-23.
- **why:** Another session can pick up the same host check. The acceptance line "full test suite green" cannot be met at the checkpoint for reasons outside this feature.
- **fix:** Claim the row on main's bulletin when 1.3 is dispatched. Say in the plan how the checkpoint treats the known `rail_hold` failure: wait for its fix, or list it as known-red with the row id.

## Testing Review (Round 1)

**Summary.** The test list names the right areas, but several lines would pass while the feature is broken.

- Four lines depend on 30-minute and 2-minute clocks, and the plan never says how a test controls time.
- The auth list tests the wrong attacker. The likeliest one is a reviewed page on another loopback port, and nothing tests it from a real browser.
- Nothing proves that a queued request reaches the attached agent. That is the path Pick this up and Launch exist for.
- Most of the page's states have no test that owns them.

Four blockers, fifteen important, three minor.

Reviewed against: the brief, the architecture, the plan, the repo `CLAUDE.md`, and the existing tests in `test/unit/` and `test/browser/`. Specific tests I checked: `monitor_command`, `status_command`, `static_servers`, `service_helper`, `no_arbitrary_sleeps`, and `harness_second_origin`.

---

### RF1. The time-based tests have no controlled clock

- **severity:** blocker
- **kind:** risk
- **where:** Test List: "expires ... after 30 minutes", "closes after 30 minutes", "recent Library poll ... stale one", "dead monitor"
- **what:** Four tests depend on wall-clock windows (30 minutes, 30 minutes, 2 minutes, the monitor heartbeat), and the plan does not say they take an injected clock.
- **why:** A builder has three bad options:
  - wait for real time, which cannot run in a gate
  - add a sleep, which `no_arbitrary_sleeps.test.js` fails
  - shrink the constant through an env var, which then tests a different number than ships

  The likely result is a test that passes because it never reaches the boundary.
- **fix:**
  - State in the plan that every expiry and window check takes `now` as a parameter. This follows the pattern `agent_sessions.js` already uses (`nowMs`, `pidAlive`).
  - Say whether expiry runs when someone reads the queue or on a timer. On read is deterministic.
  - Each time rule gets a boundary pair: just inside the window stays pending (or up), and at the limit it expires (or stops). Examples: 29:59 and 30:00, 1:59 and 2:00.
  - Dead monitor: inject `pidAlive` and the heartbeat time. Do not kill a real process.

### RF2. The auth list cannot be built as written, and it misses the real attacker

- **severity:** blocker
- **kind:** defect
- **where:** Test List, Auth and serving (1.2): "Each catalog route refuses: wrong Host, missing custom header, cross-site `Sec-Fetch-Site`, wrong token"
- **what:** Two problems:
  - `catalog.page` is loaded by a bookmark, and `catalog.asset` by `<script src>`. Neither can send a custom header or a token, so "each catalog route" cannot hold for them.
  - The list names only `cross-site`. A document under review, served from another `127.0.0.1` port, sends `Sec-Fetch-Site: same-site`. It is the page most likely to run a script Ken did not write.
- **why:** Either a builder loosens the rule so it fits the page route, or the bookmark breaks. A check that refuses `cross-site` but allows `same-site` passes every line as written and still lets any reviewed page star, open, and queue requests.
- **fix:** Replace the line with a matrix, one test per cell:
  - **`catalog.page` and `catalog.asset`:**
    - accept a navigation with `Sec-Fetch-Site: none` and no custom header
    - refuse a wrong Host, because the page carries the token and a DNS-rebinding page must not read it
  - **`list`, `open`, `star`, `request`:**
    - refuse `cross-site`, `same-site`, and a missing `Sec-Fetch-Site`
    - refuse a missing custom header, and a wrong or empty token
  - **POSTs:**
    - refuse `text/plain`, a missing Origin, `Origin: null`, and `http://127.0.0.1:<other port>`
    - refuse `http://localhost:7817` when the page is at `127.0.0.1`, or pin the rule the other way
  - **Preflight:** an `OPTIONS` on every catalog route gets no approval headers, including from `http://127.0.0.1:<other port>`.

### RF3. Nothing tests from a real second website

- **severity:** blocker
- **kind:** defect
- **where:** Test List, Auth; Acceptance Criteria "refused from another website (R18)"; Task 3.2
- **what:** The brief says "Tests send each action from another website and check that LAHE refuses it" (R18). The plan only has unit tests that forge headers.
- **why:** A forged-header test proves the check works on the headers it was given. It does not prove what a browser actually sends:
  - A real browser might send a `text/plain` form POST with no Origin, and the check might accept it.
  - The Library's own `fetch` might not send `Sec-Fetch-Site: same-origin` in one of the three browsers. The Library would then refuse every request for that browser, and every unit test would still pass.
- **fix:**
  - Add a browser spec that runs on all three lanes (`gate:all`). It uses the existing `attacker.html` and second-origin harness, plus a page on a second loopback port. From each page, try:
    - `fetch` with and without `no-cors`
    - an auto-submitted form POST
    - an `<img>` GET on `catalog.list`
    - an iframe of `/catalog`
  - Assert a refusal status or a blocked frame, and that `catalog.json` and `catalog-requests.jsonl` did not change.
  - Assert that the Library's own list call succeeds in each lane.

### RF4. Nothing proves a request reaches the attached agent

- **severity:** blocker
- **kind:** defect
- **where:** Test List, Queue, drain, CLI (1.4); Task 3.2 "a stub agent's answer on the row"
- **what:** The whole reason for the queue is that the attached agent's monitor wakes on a request and its drain shows it. No test says a pending `catalog_request` counts as work for `lahe monitor` or `lahe status --quiet`. The stub agent in 3.2 could write its answer straight to the JSONL.
- **why:** The existing drain filters on `--quiet` and `--seen-file`. `ended_reviews` needed its own tests for both (`status_command.test.js`: "an ended review gets past --quiet", "reported once per seen file"). Without the same for requests:
  - a request can sit unseen until it expires, which is the failure Pick this up exists to avoid
  - or the agent is woken on every poll forever

  Both would pass today's list.
- **fix:** Add tests:
  - A pending request for the attached session wakes `lahe monitor` and gets past `lahe status --quiet` with nothing else ready.
  - It is printed once per `--seen-file` and not again. After a takeover it is printed again, following the existing "takeover recovers seen-but-unfinished work" test.
  - A request for session A never shows in session B's drain.
  - In 3.2, the stub agent reads the request id from the real `lahe status` output and answers with the real `lahe library answer` command. It never writes the file directly.

### RF5. The queue's edge cases are untested: freed slots, late answers, torn lines

- **severity:** important
- **kind:** risk
- **where:** Test List, Queue (1.4)
- **what:** The list covers the cap and expiry. It does not cover what happens after either.
- **why:**
  - If an expired or answered request still counts toward "one per review" or "five in total", a dead agent blocks the row for good (architecture review RF9) and every test still passes.
  - Two writers append to one file: the helper, and `lahe library answer`. A half-written last line could crash the list.
- **fix:** Add tests:
  - An expired request, and an answered one, frees its review's slot and its share of the cap. A new request is then accepted.
  - An answer to an expired, unknown, or already-answered id is refused and does not change the row.
  - A truncated last line in `catalog-requests.jsonl` is skipped with a log line. The list and the drain still work. Follow the kill -9 test in `service_helper.test.js`.
  - "Ids only": assert the stored line's key set exactly. Send a POST body with extra `title`, `text`, `path` and `url` fields, and assert none of them are stored.
  - Resolve a conflict before writing the test: the architecture says the pick-up request "carries the candidate path" for the worktree case, which breaks "ids only". Pick one and test that.

### RF6. The helper-lifetime tests miss the cases that hurt

- **severity:** important
- **kind:** risk
- **where:** Test List, Routes and lifetime (2.1): the last two lines
- **what:** The tests cover the poll case only. Missing:
  - the held-window case
  - which sessions the 30-minute auto-close must leave alone
  - whether a refused request counts as a Library poll
- **why:** The auto-close is the helper closing sessions by itself. A rule that closes too much passes a test that only checks the one session that should close. Such a rule would close a session Ken reopened by hand, or one an agent took over after 25 minutes. If a refused request refreshed the poll time, any page could keep the helper up forever.
- **fix:** Add tests:
  - The last `session close` with a stale poll but a held document window leaves the helper up.
  - The auto-close leaves each of these alone:
    - a session reopened with `lahe session reopen`, not by the Library
    - a session taken over within the window
    - a session whose monitor is live
  - After an auto-close, the session's `reopened` entry is cleared.
  - Only an authenticated `catalog.list` updates the last-poll time. A refused one does not.
  - Name the thing that triggers the auto-close, and drive it directly in the test.

### RF7. R19 (Open never serves a path it did not serve before) has no test that tries to break it

- **severity:** important
- **kind:** defect
- **where:** Test List, 2.1 "never serves a path outside a recorded root"; Acceptance "Open never serves a file that was not already served (R19)"
- **what:** The line does not say how to try. `catalog.open` takes a review id, so the obvious test never offers a bad path at all.
- **why:** The architecture's own security finding (RF3) is that any review-token holder can write `target_path`. A test that only sends a clean id passes whether or not the helper trusts a tampered record.
- **fix:** Add tests:
  - Send `catalog.open` with extra `path`, `root` and `url` fields. They are ignored.
  - Rewrite a review's `target_path` to a file outside its `ss_*.json` root. Open refuses, or serves only the recorded root, and the outside file's bytes never appear in any response.
  - A recorded file not owned by the current user is refused. Skip this one where you cannot `chown`.
  - The confirm step's "just open it to read" leaves the queue empty.

### RF8. The reader tests will flake on file times and time zones

- **severity:** important
- **kind:** risk
- **where:** Test List, Reader (1.1): "log is newer than `review.json`", "Pre-2026-09-17 ... fold"; Task 1.1 "mtime cache"
- **what:** Three risks:
  - "Newer than" and the cache depend on file modified times. Two writes in the same millisecond, or on a filesystem with one-second resolution, tie.
  - The Sep 17 cutoff has no time zone. The CI runs in UTC and Ken is on US Eastern.
- **why:**
  - The re-projection and cache-invalidation tests pass or fail depending on how fast the machine is.
  - A review created at 21:00 Eastern on Sep 16 is Sep 17 in UTC. It folds on one machine and not the other.
- **fix:**
  - Set every modified time in the fixture with `fs.utimesSync`. Never rely on write order.
  - Key the cache on modified time plus size.
  - Test the cache with a read counter: a second list with no changes reads zero `review.json` files.
  - Pin the cutoff as a UTC instant. Add fixture reviews one minute either side of it, and run that test under `TZ=America/New_York` and `TZ=UTC`.
  - Add fold negatives:
    - two sessions, same folder
    - same session, two folders
    - after the cutoff
    - a current folder review
  - Pin how a fold sums `waiting` and `total`, and that a star on an older folded review still shows.

### RF9. One corrupt file should not take down the whole Library

- **severity:** important
- **kind:** risk
- **where:** Test List, Reader; Task 1.1
- **what:** No test gives the reader a corrupt `review.json`, `meta.json`, `session.json`, `ss_*.json` or `catalog.json`.
- **why:** The reader reads about 500 reviews' files every 15 seconds, and a crash mid-write leaves a torn file. If one bad file throws, the Library goes blank, and nothing in the list catches that. A corrupt `catalog.json` followed by a star could also rewrite the file with only that one star, silently dropping the rest.
- **fix:**
  - For each file type, one corrupt file degrades only its own row, which gets a visible marker. The rest of the list returns.
  - With a corrupt `catalog.json`, a star is refused loudly and the file is left as it is, following the existing "corrupt meta.json fails loud" test.

### RF10. Most of the page's states have no test that owns them

- **severity:** important
- **kind:** defect
- **where:** Test List, Page (2.2 and 3.2); Task 2.2 acceptance "a staff-level design pass ... and the browser spec in 3.2"
- **what:** The page has five test lines, and 3.2 is one walk-through spec. None of these are tested:
  - the waiting, done, refused and expired row states
  - naming the agent before the click (R12a)
  - search matching every field, including the session name (R6)
  - the project filter
  - what goes in the top section (R4a)
  - missing rows hidden, and shown on request (R7)
  - Open disabled on a missing row with the reason, while Star still works (R7)
  - the via-agent and worktree row wording (R9)
  - the helper being down
- **why:** Each of these could be wrong while every listed test passes. The worst one: a Library tab left open across a helper restart holds the old token, because the token changes on every restart. Every click then gets refused, and nothing says what Ken sees.
- **fix:**
  - Split the page script into a pure view-model module that turns the list response into rows, sections and button states. Unit test it with `node:test`. The repo bans jsdom, and this needs no DOM.
  - Write one test per state above against fixture list responses.
  - Keep the browser spec for the DOM itself: `textContent`, the new tab, the confirm dialog.
  - Add a browser test: restart the helper under an open Library, and assert the page says it needs a reload (or reloads itself) rather than showing silent failures.

### RF11. The browser spec would wait on a 15-second poll

- **severity:** important
- **kind:** risk
- **where:** Task 3.2 "see a stub agent's answer on the row"; Architecture, Helper lifetime "polls every 15 seconds"
- **what:** The answer shows on the row only at the next poll. Playwright's default wait for a condition to come true is 5 seconds.
- **why:** The spec fails about two times in three, or someone raises the timeout and it takes up to 15 seconds per state across three lanes. The last flake hunt cost Ken seven CI emails.
- **fix:**
  - Give the page a way to poll immediately: after its own action, and on a `?poll=<ms>` query read only on loopback. Or give the test a hook it can call.
  - Wait with `expect.poll` on the row's text. Never with a timeout.

### RF12. Two sessions on one monitor: the heartbeat and close behaviour are untested

- **severity:** important
- **kind:** risk
- **where:** Test List, "`lahe monitor --session a --session b` wakes on work in either"
- **what:** Waking is one of four behaviours the existing single-session monitor has tests for. The other three are:
  - the heartbeat
  - the closed-session exit
  - the takeover fence
- **why:** If the heartbeat is written only for the first `--session`, the session the agent picked up reads as not watched. The Library then shows no agent and re-queues on the next Open, while every listed test passes.
- **fix:** Add tests:
  - A heartbeat is written for each session, and `watching` reads true for both.
  - When one of the two sessions closes, the monitor keeps watching the other. Or pin the exit code it uses instead.
  - A takeover of either session fences the old monitor.

### RF13. The restart and Host tests miss the negative cases

- **severity:** important
- **kind:** risk
- **where:** Test List, Restart and Host (1.3)
- **what:** Four gaps:
  - "Reuses the old port" does not force the other branch.
  - "Stale origins dropped" does not check what must stay.
  - The Host test has one foreign value.
  - It does not say which paths are checked.
- **why:**
  - A test that never takes the old port only covers the new-port branch by luck.
  - Dropping every origin, including a dev-server one, passes.
  - A check applied only to pages leaves the static server's reserved library route open.
- **fix:** Add tests:
  - Bind the old port with a listener, then restart. It gets a new port, the new origin is registered, and a POST from the old origin is refused.
  - A non-loopback origin on the same review survives the restart.
  - A static server accepts its own `127.0.0.1:<port>`. It refuses:
    - `127.0.0.1:<other port>`
    - `evil.test`
    - a missing Host
    - `localhost:<port>`, unless you decide to allow it, and then say so in the test

    Check the page, the reserved library route, and a 404 path.

### RF14. The acceptance lines an evaluator cannot call red with a reason

- **severity:** important
- **kind:** defect
- **where:** Acceptance Criteria, This feature and Standard; Task 1.1 acceptance
- **what:** Each line below has no threshold, or depends on data only Ken's laptop has:
  - **Task 1.1, "reading the real state dir (about 500 reviews) never folds a log over the size limit."** It runs on Ken's data and cannot run in CI. Replace it with a fixture test: a log over the limit, and a counter that proves the re-projection was never called.
  - **"Lists every review on disk (R1)."** Add a check: the count of review ids in the response, including `folded_from`, equals the count of review folders in the state dir.
  - **"A week of reviews is findable without typing a search (R4)."** Name the rule from the wireframe. For example: with a 7-day fixture of 120 reviews, every one is reachable by scrolling or expanding a group, with no search.
  - **"An attached agent then watches it (R8)" and "Pick this up and Launch reach the attached agent, which acts" (R12, R13).** A stub cannot show a real agent following the skill. Name a manual walk-through with a real Claude Code session, and what counts as done: the drain shows the request, `lahe session list` shows the document's session owned by that agent, and the row shows the answer. Say that R13 (the launched session is named after the document) is checked by hand.
  - **"Star and unstar are instant" (R11).** This conflicts with the standard line "never an optimistic done". Define it: the row changes when the POST returns. A failed star puts the row back and says why. Add that failure test.
  - **"Full test suite green."** The last commit on main says main's gate has been red on `rail_hold` since Sep 23. Name the baseline: green except the tests already failing on main at the branch point, listed by name. (The EM review raises the same point from the scheduling side.)

### RF15. The log lines and the count script are tested against a hand-made log

- **severity:** important
- **kind:** risk
- **where:** Task 3.3
- **what:** Three problems:
  - The script is checked against a hand-built fixture log, and no test checks that the helper writes that same format.
  - The Python script is not in any gate.
  - Two documents define the count differently: the plan says "older than a week", and the brief says "older than the default view".
- **why:** The helper's lines and the script's parser can drift apart, and both tests stay green while the success metric reads zero. That is the number that decides whether the Library worked.
- **fix:**
  - A unit test drives Open, Star, Pick up and Launch through the real routes. It asserts one line each, in a format spelled once in `src/shared/`.
  - Build the script's fixture from that captured output.
  - Run the script from a `node:test` wrapper, so `gate:unit` covers it.
  - Pick one definition of "older", and pin the time zone for "working day".

### RF16. The new tab must prove "no opener" and "landed on the URL" in one test

- **severity:** important
- **kind:** risk
- **where:** Test List, "Open opens the document in a new tab with no opener"; Architecture, Open flow "open a blank tab now (noopener), point the tab at url"
- **what:** A tab opened with `noopener` gives back no handle, so the page cannot point it at a URL afterwards.
- **why:** Two separate tests could each pass: one on a flow that keeps the opener, and another on a flow that never navigates.
- **fix:**
  - In one browser test, catch the new page. Assert that `window.opener` is `null` in it and that its URL equals the one the helper returned. Then assert the rail booted there.
  - Add a unit test: the page refuses a non-loopback or non-`http:` URL from the helper (architecture security note).

### RF17. `catalog.asset` has no test for paths outside its file list

- **severity:** important
- **kind:** defect
- **where:** Task 1.2 "`catalog.asset` serves the page script, the style bundle and the fonts"; Test List, Auth
- **what:** This is a new route that serves files from disk. No test checks that it refuses anything outside its list.
- **why:** A route that takes a name, joins it to a folder and serves the result is the classic way to leak files. None of the listed tests would catch it.
- **fix:** Test that `catalog.asset` refuses:
  - `../`
  - `%2e%2e%2f`
  - an absolute path
  - a name outside the list, such as `package.json`

  Each gets a 404 with no file bytes, and each file on the list has the right content type.

### RF18. Unit tests must never touch port 7817

- **severity:** important
- **kind:** risk
- **where:** Test List, "`lahe library` with no helper running starts it and prints the URL"; Acceptance "prints `http://127.0.0.1:7817/catalog`"
- **what:** The Library's address uses the fixed default port.
- **why:** Ken's real helper runs on 7817 all day, and `node:test` runs test files in parallel. A test that starts or checks a helper on the default port either finds Ken's live helper and passes for the wrong reason, or writes to his real state.
- **fix:**
  - Every CLI test passes `--port` and a temporary `--state-dir`, like `add_command.test.js`.
  - Assert the printed URL's port equals the `--port` given.
  - Assert the "no helper running" case by showing the new helper's readiness file in the temporary state dir.

### RF19. The attached-agent state has no test

- **severity:** important
- **kind:** risk
- **where:** Architecture Failure Modes, "Two agents ran `lahe library`" and "Attached agent goes away"; Test List
- **what:** No test covers:
  - the last attach winning
  - `attached.watching` being false once its monitor is dead
  - Open queuing nothing for a dead attached agent
- **why:** R12a says the page names the receiving agent before Ken clicks. If a dead agent still reads as attached, the page names someone who will never answer, and each request waits the full 30 minutes.
- **fix:** Add reader and route tests:
  - With two attaches, the later one is `attached`.
  - An attached session with a stale heartbeat has `watching: false`, and Open and request return the no-agent result.
  - An attach with nothing on disk behind it is treated as no agent.

### RF20. The list must not carry comment text or the token

- **severity:** minor
- **kind:** risk
- **where:** Architecture Security, "cannot ... read comment text"; Test List, "never on disk"
- **what:** Two claims have no test:
  - the Library token cannot read comment text
  - the token appears nowhere except the page
- **why:** A later field added to the list response (for example a "last comment" preview) would leak comment text to the Library token without failing anything.
- **fix:**
  - Put a marker string in a fixture comment, and assert it is absent from `catalog.list`.
  - After a full run, search every file under the state dir and the helper log for the token.
  - Assert the token is absent from `health` and `catalog.list`.

### RF21. Hidden-tab polling cannot be proven by the suite

- **severity:** minor
- **kind:** risk
- **where:** Architecture, Helper lifetime "polls every 15 seconds whether or not its tab is visible"; Acceptance "keeps working after the last session closes (R10a)"
- **what:** Browsers slow down or suspend timers in background tabs. Chrome drops chained timers to about once a minute after a few minutes, and Safari may suspend them entirely. Headless Playwright does not reproduce either.
- **why:** The 2-minute rule can fail on Ken's real browser with a green suite. The acceptance line reads as covered when it is not.
- **fix:**
  - Add a manual check to the acceptance: leave the Library in a background tab for 10 minutes in Chrome and Safari, close the last session, and confirm the helper stays up.
  - Or record that this is not proven, under Changes from plan.

### RF22. The drain fence needs a title that tries to break out

- **severity:** minor
- **kind:** taste
- **where:** Test List, "a title with instructions in it appears in the drain only as a fenced data field"
- **what:** A title that only contains instructions tests the easy case.
- **why:** A title that contains the fence's own closing marker, or a newline followed by a fake `catalog_requests:` header, is the one that escapes.
- **fix:** Use a title that contains the closing marker and a newline. Assert the drain still parses as one request, following `log_injection.test.js`.
