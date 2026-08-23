# Audit: the review document's tail, open findings

**Scope audited:** `docs/features/20260812.01_live_agentic_html_editor/02_architecture_live_agentic_html_editor_reviews.md`, lines 713 to 943. That is Suggestions S1 to S10, Cuts C1 and C2, Questions Q-A to Q-E, the R26 note in the requirement sweep, the four "Reuse claims" bullets, the two "Alternatives considered: honesty check" gaps, the six "Cross-check against the research" bullets, and the five-item `## Cleanup needed` list at line 930. **35 items.**

**Deliberately not audited:** the `Homed but broken or incomplete as written:` table at line 805 (a second auditor owns it), and the `## Cleanup needed` heading at line 409, which belongs to review-security Round 1 and reads "Nothing to delete."

**Repo state:** branch `main`, HEAD `d4f8ffa`. Read-only pass; no source file was changed.

---

## Summary table

| # | Item | Verdict |
| --- | --- | --- |
| S1 | Show the conflict on the page, not only in the record | PARTLY BUILT |
| S2 | Ack-before-replay ordering | PARTLY BUILT |
| S3 | State dir outside any checkout, owner-only | BUILT |
| S4 | One shared formatter for copy/export and `review.md` | NO LONGER APPLIES |
| S5 | Define what "a block" is for Cmd-Shift-E | PARTLY BUILT |
| S6 | Pick the formatting mechanism | BUILT |
| S7 | Edit regions disable autocorrect and spellcheck | BUILT |
| S8 | Reopening a handled item bumps the rev | BUILT |
| S9 | SQLite rejection reason and the Node floor | BUILT (doc), with a live number mismatch |
| S10 | Close the "does the helper start itself" question | BUILT |
| C1 | Retire the five v1 leftovers | 4 of 5 done; 1 clause moot |
| C2 | Second-window refusal, or cut it back | BUILT |
| Q-A | Do drafts reach the helper | BUILT; the stale-draft nudge NOT BUILT |
| Q-B | What starts and ends a review | PARTLY BUILT |
| Q-C | Multi-origin copy/export with the helper down | BUILT |
| Q-D | Library refuses a non-local origin | NOT BUILT (decided against) |
| Q-E | Replay cost per pass | NOT BUILT |
| R26 | Basic formatting: mechanism, vocabulary, paste rule | BUILT, except the paste rule |
| RC1 | "The harness already built survives" | BUILT |
| RC2 | Protected-region design survives | 2 of 3 BUILT; atomic group id NOT BUILT |
| RC3 | `test/helpers/contexts.js` contradicts D5 | PARTLY FIXED |
| RC4 | `CLAUDE.md` and `playwright.config.js` cite dead design | BUILT (both fixed) |
| A1 | Blocking CLI missing from the alternatives list | Mechanism BUILT; the doc list NOT updated |
| A2 | Verification deleted, not rejected | NOT BUILT (accepted cut, seam kept) |
| X1 | Two helpers at once: lock file and a refused second instance | PARTLY BUILT |
| X2 | Old feedback resurrecting: retention and pruning | NOT BUILT |
| X3 | Helper/library version skew | BUILT (2026-08-23) |
| X4 | How the agent is told where the review file lives | BUILT |
| X5 | The reply poll's interval and bound | BUILT |
| X6 | What happens when the agent's own turn ends | BUILT |
| CL1 | Remove `src/service/verification.js` | BUILT (removed) |
| CL2 | Remove the four v1 CLI commands and `cli_contract.js` | BUILT (removed) |
| CL3 | Drop the manifest's six-owner scheme | NO LONGER APPLIES |
| CL4 | Remove the three v1 routes | BUILT (removed) |
| CL5 | Remove `test/fixtures/servers/stub-service.js` | NOT BUILT |

**Counts:** BUILT 17, PARTLY BUILT 8, NOT BUILT 6, NO LONGER APPLIES 4.

---

## Ranked: what is not built, most likely to reach a reviewer first

1. **X2, old feedback resurrecting.** Fires the second time anyone reviews the same document.
2. **Q-B, no End review control.** Fires at the end of every review.
3. **Q-E, unbounded replay cost.** Fires on a long review of a page that repaints.
4. **S1 and S2 together, what the reviewer's eyes see during a conflict.** Fires whenever an agent lands a change under an outstanding edit.
5. **Q-A, no stale-draft nudge.** Fires the first time a new reviewer forgets Cmd-Enter.
6. **X1, two helpers on one state directory.** Needs a non-default `--port` first.
7. **R26 paste rule.** Fires when a reviewer pastes styled text into an edit region.
8. **Q-D, no library-side origin guard.** Fires if a dev-server snippet is committed without its conditional.
9. **RC2, atomic group id.** Fires when two edits made in one gesture replay independently.
10. **CL5, S5, S9, A1, RC3.** Housekeeping and doc drift; no reviewer sees any of them.

---

# The items

## X1. Two helpers running at once

> **Two helpers running at once**, each clearing the other's state. Human-review shipped a fix for exactly this (`2740913`). Q1 asks who starts the helper and never asks what happens when two do. Needs a lock file and a refuse-with-a-reason second instance (`src/service/state_dir.js` already reserves a `lock` path).

**Verdict: PARTLY BUILT.** The same-port case is handled well. The prescribed fix, a lock file plus a refused second instance, was not built, and the refusal message for it exists as dead code.

### Evidence

The same-port defense is real and good. `src/cli/commands/serve.js:114-137`:

```js
    if (err && err.code === "EADDRINUSE") {
      var already = await service.probeHealth(protocol.DEFAULT_HOST, port);
      if (already) {
        process.stdout.write(
          "lahe serve: a helper is already answering on " + ... + ". Nothing to do.\n"
```

There is no lock file. `src/service/state_dir.js` names `service.json`, `helper.log`, `events.jsonl`, `review.json`, `meta.json`, `replies*.jsonl`, and the `agent-sessions`, `static-servers` and `review-artifacts` directories. It reserves **no** `lock` path; the review's parenthetical is out of date. `grep -rn "lock" src/service/` returns nothing.

The refusal that would have been shown is defined and never emitted. `src/shared/failures.js:232-238`:

```js
    PROTO_SECOND_INSTANCE: def(
      SEVERITY.BLOCKING,
      false,
      SURFACE.CLI,
      "Another helper is already running for this data directory.",
      "Use the running one, or stop it first."
    ),
```

and `src/shared/protocol.js:464` maps it to HTTP 409. `grep -rn "PROTO_SECOND_INSTANCE" src test` returns exactly those two definition sites and nothing else: no code raises it, no test names it. `git log -S` puts both in commit `440b950` (2026-08-12, the day the v2 docs were cut), so this string has been sitting there unused since day one. This is the "looks right and does nothing" shape the brief warned about.

I proved the gap empirically rather than by reading. Two `service.serve()` calls against one state directory, ports left to the OS:

```
helper A port 65122   port in service.json after A: 65122
helper B port 65123   port in service.json after B: 65123
A still answering: true
B still answering: true
```

Both bind, neither refuses, and `service.json` silently switches to the second one. `src/service/index.js:418` writes the readiness file unconditionally after binding:

```js
  reviews.writeReadyFile({ port: boundPort, started_at: startedAt });
```

That file is the machine's only pointer to the helper. `src/cli/commands/status.js:474`:

```js
  var helperOrigin = ready && ready.port ? "http://" + protocol.DEFAULT_HOST + ":" + ready.port : null;
```

One mitigation the review could not have known about: `src/service/reviews.js:146` `loadFromDisk()` rehydrates every review on disk at boot, so the second helper does not blank the first helper's tokens out of `service.json`. State is not cleared; the pointer is hijacked.

**Test coverage:** none for this case. `test/unit/service_helper.test.js:346` asserts EADDRINUSE, but it passes a **different** state directory (`stateDir: tempDir()`), so it tests port collision, not directory sharing. Deleting the EADDRINUSE branch from `serve.js` would fail that test; nothing at all guards the one-directory-two-ports case.

**How it is reached:** `docs/CLI.md:29` documents `lahe serve [--port N]`. Run a helper by hand on a non-default port for one project (because the default is taken), then let an agent run `lahe review` somewhere else, which starts a helper on `protocol.DEFAULT_PORT` (`src/cli/commands/add.js:885`). Both use the default state directory.

**User-visible consequence:** the reviewer's page keeps talking to helper A, which is the one that has their review's window session in memory. Every command the agent runs (`lahe status`, `lahe monitor`, `lahe session`) resolves helper B from `service.json`. Both helpers watch the same `replies*.jsonl` with their own in-memory byte offsets (`src/service/replies.js:197-200`), and both re-project `review.json` with a last-writer-wins atomic rename. The reviewer sees the rail say the agent is not connected while the agent sees a review that never updates, and neither can tell why.

**Fix sketch:** on bind, write an owner-only `lock` file in the state directory holding pid and port; if one exists and its pid is alive and its port answers `/health`, refuse with `PROTO_SECOND_INSTANCE` (the message is already written) instead of binding.

---

## X2. Old feedback resurrecting

> **Old feedback resurrecting.** Human-review re-opened targets and served feedback up to thirty days old. v2 has an append-only log with no retention, no pruning, and no statement of what a returning reviewer sees on a page they reviewed last month.

**Verdict: NOT BUILT.** No retention, no pruning, no age bound anywhere, and the reuse path actively brings an old review back.

### Evidence

Retention exists as a constant and nothing else. `src/service/state_dir.js:41-44`:

```js
// The append-only log grows for the life of a review and is bounded by
// retention, not rotation: finished reviews age out rather than silently losing
// history mid-review (Data and state).
var RETENTION_DAYS = 30;
```

It is exported at line 372 and read by **nobody**. `grep -rn "RETENTION" src test docs` returns only the definition and the export. `git log -S "RETENTION_DAYS"` puts it in `440b950` (2026-08-12): dead since the day it was written. Nothing under `src/` matches `prune`, `age out`, or `expire`.

Ending a review does not prune either, and says so. `src/service/reviews.js:903-904`:

```js
  /** The reviewer closed the review. Nothing is truncated; the log is archived. */
  function endReview(reviewId) {
```

It appends a `REVIEW_ARCHIVED` event. The only consumer of that event is `src/service/projection.js:193`, which sets `ended_at` on the projection. `grep -rn "ended_at" src/cli/` returns nothing: no CLI command consults it.

Now the part that makes this a live bug rather than a disk-space note. Coming back to a document reuses the old session and the old review, with no age check and no ended check.

`src/cli/commands/review.js:32-51`, `inferSession`, matches an existing agent session purely by target path:

```js
    if (targets.indexOf(resolved) === -1 && meta.source_path !== resolved) return;
    if (typeof meta.agent_session_id !== "string" || meta.agent_session_id === sessions.LEGACY_ID) return;
```

`src/cli/commands/add.js:463-489`, `reviewMatchingPath`, then reuses the review itself:

```js
    var at = meta.created_at || "";
    if (!best || at > best.at) best = { id: entry.name, at: at };
```

`created_at` is used only to pick the newest match. There is no comparison against now, no `RETENTION_DAYS`, and no look at whether the review was ended.

**Test coverage:** none for age. `test/unit/add_command.test.js` covers reuse-by-path (which is deliberate, and fixes a real earlier bug where a rebuild split one document across three reviews). No test asserts anything about an old or ended review.

**User-visible consequence:** a reviewer reviews `docs/plan.md` in July, leaves four comments unanswered, and stops. In September they run `lahe review docs/plan.md` again. `inferSession` finds July's agent session by path, `reviewMatchingPath` finds July's review, and the page comes up with July's four unanswered comments on the rail as live work. The agent's first drain prints them and starts making changes the reviewer forgot they ever asked for. That is human-review's scar reproduced exactly. Pressing "End review" would not have helped, because nothing on the reuse path reads `ended_at`, and there is no End review control anyway (see Q-B).

**Fix sketch:** in `reviewMatchingPath`, skip a review whose projection carries `ended_at`, and skip one older than `RETENTION_DAYS`; mint fresh instead, and say in `add`'s output that an older review for this path was left behind.

---

## X3. Helper/library version skew

> **Helper/library version skew.** Human-review's `8bb9ce4` scar ... v2 has a built file copied into a host app and a helper started separately, which is the same shape, with no version gate.

**Verdict: BUILT (2026-08-23).** This is the calibration item and it now has code, a rationale, and a test.

### Evidence

`src/service/source_stamp.js` compares the helper's own `started_at` against the newest mtime under `src/` and `vendor/`. Its header explains why it is deliberately not a version comparison (lines 20-27): `/health` already reports `version` and `service_contract`, and neither would have caught the 2026-08-23 incident because neither number moved.

`src/cli/commands/serve.js:130-135` reports a stale helper and changes nothing; `lahe review` and `lahe session reopen` replace it.

**Test:** `test/unit/helper_freshness.test.js`, including `"a current helper is left exactly where it is, and a stale one is restarted and said out loud"` (line 233) and `"a served review survives the restart: the session, its static server, and the page come back"` (line 298). Removing the check fails those.

---

## X4. How the agent is told where the review file lives

> **How the agent is told where `review.md` lives.** ... nothing covers writing and verifying the pointer that sends the agent to the right review folder. This is the other half of RF12.

**Verdict: BUILT.** The pointer is printed, tested, and duplicated in a second place so it survives losing the output.

### Evidence

`src/cli/commands/add.js:1268-1272`:

```js
  // The review folder, printed rather than described. Both docs promise `add`
  // names it, and an agent that only has this output has no other way to find
  // review.json: the state directory is derived from environment this command
  // resolved and the agent did not.
  say("  folder    " + stateDirModule.reviewDir(dir, review.id));
```

The installer-writes-a-wrong-invocation half is covered too: `src/service/state_dir.js:129-142` `flagFor()` prints `--state-dir` on a copied command only when it changes the answer, added because a command copied out of a review with a custom state directory used to resolve the default one and report no work.

**Tests:** `test/unit/add_command.test.js:871` `"add prints the review folder, because that is the only way an agent finds review.json"`; line 889 `"AGENTS.md says where the state directory is, so the folder can be found without add's output"`; line 973 `"every lahe command the docs tell a reader to run is a real command"`.

---

## X5. The reply poll's interval and bound

> **The library's reply poll has no stated interval or bound.** ... Human-review's standing cost was two polling loops; v2 replaces one and leaves the other unspecified.

**Verdict: BUILT.** Both intervals are named constants with a stated reason, the request has a deadline, the backoff is capped, and the cursor is a sequence number rather than a timestamp.

### Evidence

`src/layer/sync.js:75-84`:

```js
  // The library's own poll of the helper. A visible review stays responsive;
  // a hidden document needs only a low-frequency safety check ...
  var POLL_INTERVAL_MS = 1000;
  var HIDDEN_POLL_INTERVAL_MS = 10000;

  function pollIntervalFor(doc) {
    return doc && doc.hidden === true ? HIDDEN_POLL_INTERVAL_MS : POLL_INTERVAL_MS;
  }
```

`sync.js:67` caps the down-helper backoff (`[250, 500, 1000, 2000, 5000, 10000, 30000]`) and `sync.js:73` sets `REQUEST_TIMEOUT_MS = 2000`. The helper's own side is separate and also pinned: `src/shared/protocol.js:757-758` `REPLY_POLL.INTERVAL_MS: 5000`, with a per-file byte offset.

**Tests:** `test/unit/sync_client.test.js:372` `"hidden review pages use the background polling cadence"`, asserting `HIDDEN_POLL_INTERVAL_MS > POLL_INTERVAL_MS`, and line 369 asserting the library's cadence is deliberately not the helper's.

---

## X6. What happens when the agent's own turn ends

> **What happens when the agent's own turn ends.** D6 says the agent reads in a loop for as long as the review runs. Nothing re-establishes the loop when the agent's session ends mid-review.

**Verdict: BUILT.** This grew into a whole subsystem: a wake feed, a local monitor with four exit codes, and per-host instructions in the contract.

### Evidence

`src/cli/commands/monitor.js:1-21` states the design: idle polling is paid for by a Node process, not by model tokens, and it exits with `OK` / `SESSION_CLOSED` / `SESSION_TAKEN_OVER` / `BAD_USAGE` so the host's relaunch decision is a number rather than a parse.

The wake feed is an append-only file per agent session, never atomically replaced so a `tail -f` keeps its inode (`src/service/state_dir.js:247-256`).

The contract tells each host what to do, by name: Claude Code arms a persistent Monitor on the wake log; Codex runs `lahe monitor` as a foreground pending exec; Antigravity runs it as a background terminal task; anything else runs it in the foreground (`src/shared/review_format.js`, contract entries in the block at lines 83-89). The redelivery doctrine means a missed wake costs nothing: "Work stays listed until your reply lands, so a wake you miss costs you nothing."

**Tests:** `test/unit/wake_feed.test.js` (nine tests, including `"the feed is appended to, never replaced, so a tail keeps its inode"`) and `test/unit/monitor_command.test.js` (thirteen tests, including `"a closed session exits with SESSION_CLOSED off the real session record"` and `"takeover fences the old monitor before it can deliver another agent's work"`). The contract text is pinned byte for byte by `test/unit/review_format.test.js:106`.

---

## Q-A. Do drafts flow to the helper

**Verdict: BUILT for the flow and the exclusion. The stale-draft nudge is NOT BUILT.**

### Evidence

Drafts are posted, marked. `src/layer/sync.js:516-521`:

```js
        payload: {
          // Drafts flow to the helper marked draft, and never appear as
          // actionable in what the agent reads (D5, R7).
          draft: record.isDraft(item),
```

The agent never sees them. `src/service/projection.js:176-177`:

```js
/** The items an agent may act on: everything except the reviewer's drafts. */
function actionableItems(items) {
```

**Tests:** `test/unit/sync_client.test.js:60` (`assert.equal(queued[0].draft, true, ...)`); `test/browser/rail_durability.spec.js:74` (a reload mid-sentence keeps the draft and it reaches the helper marked draft); `test/unit/projection_review_json.test.js:276` (a draft never appears in `review.json`).

**What is missing.** The architecture promised a time-based nudge (`02_architecture_live_agentic_html_editor.md:158-161`): "A draft that sits unconfirmed for a while gets a **gentle nudge on its own card**." What ships is a static hint that is always on the open box, `src/layer/comments.js:112`:

```js
  var HINT_READY = "Cmd-Enter when done with this comment";
```

plus a static rail label, `src/layer/tab_active.js:627`: `if (state === record.STATE.DRAFT) return "Draft, not sent";`. There is no elapsed-time check on a draft record anywhere, and no test, because there is nothing to test.

**User-visible consequence:** a new reviewer types a comment, gets distracted, and never presses Cmd-Enter. The rail says "Draft, not sent" if they look at the rail; nothing ever comes and finds them. They wait for an agent that by design will never see it. Softer than the architecture intended, but the static hint and label carry most of the load.

**Fix sketch:** on the rail's existing refresh, if a draft's last keystroke is older than a minute, swap the card's hint to the promised "still a draft, Cmd-Enter when done with this comment."

---

## Q-B. What starts a review, and what ends one

**Verdict: PARTLY BUILT.** The server side is complete and unreachable. There is no End review control in the product, and a test would fail if someone added one.

### Evidence

The route exists and does real work. `src/shared/protocol.js:261-269`:

```js
      name: "review.end",
      method: "POST",
      path: BASE + "/end",
      auth: AUTH.REVIEW_TOKEN,
      mutating: true,
      why: "the reviewer chooses End review on the rail; the review is archived, never truncated",
```

Handler at `src/service/routes.js:344-350`, archiving at `src/service/reviews.js:904-919`.

Nothing calls it. `src/layer/overlay.js:541-547`:

```js
  // The review-level actions, in the head's menu.
  var MENU_ITEMS = [
    { action: "copy", label: "Copy review" },
    { action: "export", label: "Export review to file" }
  ];
```

`src/layer/index.js:461-462` wires only `copy` and `export`. No file under `src/layer/` passes `"review.end"` to `protocol.route()`. The CLI has no end command either: `lahe session close` closes an **agent session**, not a review.

R39's payoff moment is gone with it. `src/layer/tab_edits.js:7-9` claims R39, but the hand-edit list is a permanently visible tab, not something surfaced as the closing step.

**Test coverage: negative.** `test/browser/rail_menu.spec.js:188`:

```js
      expect(info.items.map((one) => one.label)).toEqual(["Copy review", "Export review to file"]);
```

That is an exact-equality assertion, so adding End review to the rail fails the suite until someone updates the test. Deleting `review.end` from the helper would fail nothing but the route enum.

**User-visible consequence:** a reviewer finishes a document, looks in the rail menu for a way to say "done", and finds Copy and Export. The review never ends. Combined with X2 above, there is no way to draw a line under a review: the items stay outstanding forever, and the next `lahe review` on that file brings them all back.

**Fix sketch:** add `{ action: "end", label: "End review" }` to `MENU_ITEMS`, wire it in `index.js` to POST `review.end`, show the Edits tab as the confirmation step, and update the exact-match assertion in `rail_menu.spec.js`.

---

## Q-C. Multi-origin copy/export with the helper down

**Verdict: BUILT.** The offline export is honestly scoped and honestly labeled, including in the filename.

### Evidence

Scope is decided at click time, never from a cached status. `src/layer/export.js:373-386`:

```js
        if (!answer.reachable) {
          return { scope: SCOPE.SLICE, records: mine, probe: answer };
        }
```

The label names the exact limitation, `src/layer/export.js:87-93`:

```js
  var SLICE_LABEL =
    "This is this page's slice of the review: the items this browser is holding. " +
    "The local helper was not reachable, so anything recorded on another origin, in another browser, " +
    "or in another profile is not in this file.";
```

The scope is also in the filename (`SLICE_FILE_MARK = "-this-page-slice"`), and `export.js:122-128` fails loud rather than defaulting a scope. Export deliberately gets the unscoped store (`src/layer/index.js:236-238`) so it is the whole review for this origin, not this page's items.

**Test:** `test/browser/copy_export.spec.js:278-289` reads a real download through a real menu click and asserts `toContain(exporter.SLICE_LABEL)` plus byte-identity with the full export minus the label; line 295 asserts `scope === "slice"`.

**One wording wart, not a gap:** the label says "this page's slice" while the contents are the whole origin's bucket for the review, so it under-claims. And no test exercises the two-origins-helper-down case specifically; the origin sentence in the label is asserted as text, not as behavior.

---

## Q-D. Does the library refuse a non-local origin

**Verdict: NOT BUILT, and decided against on the record.**

### Evidence

`src/layer/index.js:28-37`:

```js
// This file used to refuse to initialize on a non-loopback origin. That refusal
// is removed: a built document opened from disk has a `file://` URL and an
// opaque origin, that case is a supported primary one (1A's spike proved it
// works), and the refusal broke it. The local-only controls that remain are the
// real ones: the helper serves loopback only, it checks the per-review token on
// every request, and it registers the origins a review accepts.
```

No hostname test survives in `index.js`, `inject.js`, or `script_line.js`. The helper-side check is real and unconditional (`src/service/auth.js:60-64` calling `protocol.checkRequest`, with the origin allowlist at `src/shared/protocol.js:436-439`), which is D11 doing its job.

**User-visible consequence:** a dev-server script line committed into a layout without its development-only conditional reaches production, and the layer boots in a visitor's browser: they see the LAHE rail on a page they do not own. Nothing flows anywhere, because the helper is not there and its origin allowlist would refuse it, so this is a visible embarrassment rather than a data path. The only defense is the instruction `lahe add --origin` prints (`docs/CLI.md:18`, "a commented snippet that you must wrap in your framework's development-only conditional").

**Fix sketch:** if a guard is wanted back without breaking `file://`, refuse on a non-loopback **http(s)** origin specifically, leaving opaque and `file://` origins alone.

---

## Q-E. How many outstanding records does replay re-apply per pass

**Verdict: NOT BUILT.** No bound, no batch limit, no dirty check, no memoization, no perf test. The doc still treats replay as free and so does the code.

### Evidence

Every pass iterates every item. `src/layer/replay.js:459-464`:

```js
      if (step === "apply_records") {
        var items = itemsIn(ctx);
        for (var j = 0; j < items.length; j += 1) {
          var outcome = applyRecord(items[j], ctx);
```

The only filter is `if (!record.isOutstanding(item))` at `replay.js:1390`, so handled items are cheap and every outstanding one is fully re-resolved. Re-resolution is intentional (`replay.js:126`, "identity is re-resolved every pass; a repaint destroys anything on the node"), and there is no memo: `lastElement[id]` is consulted only **after** a failed resolve (`replay.js:1455-1462`), never as a short circuit.

Each record can pay for several full resolves. `probesFor` (`replay.js:1214-1235`) builds a probe list from the current `after`, `AFTER`, `before`, `BEFORE`, every prior applied `after`, and every accepted page text from a "Keep mine". `resolveRegion` (`replay.js:1252-1256`) runs one complete `anchor.resolve` per probe until one binds, so the **lost or ambiguous** anchor, the case a long review accumulates, is the case that pays the most.

Each resolve is a recursive DOM walk that renormalizes text per node, with no cache: `src/layer/anchor.js:710` calls `uniqueness.selectUnique(candidatesFor(...))`, and `findMatches` calls `textOf(node)` (which is `normalize.normalizeText(normalize.blockTextFromNode(...))`) on every element visited.

Shape: per pass, O(outstanding records x probes per record x elements in body x text length). Eighty outstanding records on a few hundred elements is tens of thousands of normalize calls per pass.

One correction to the question's framing: passes are **not** poll-driven. `REASON` (`replay.js:107-116`) has no poll reason; the schedulers are mutation, boot, manual, remount, commit, and settle. The 1s figure in `sync.js` drives reply folding. The practical ceiling is set by coalescing (`replay.js:334-350`, rAF raced against a 50ms timer), so on a page an agent is morphing repeatedly it is roughly one full-cost pass per frame.

**Test coverage:** none of cost. `test/unit/replay_pass.test.js` runs one to four items; `test/unit/replay_scheduler.test.js` uses `items: []` throughout and tests coalescing. No `performance.now` assertion exists in either.

**User-visible consequence:** a long review on a page that repaints, forty or eighty outstanding items, and the tab janks. Typing in a comment box stutters, because the same main thread is re-walking the whole document for every outstanding anchor on every mutation batch. Nothing in the product degrades gracefully or tells the reviewer why.

**Fix sketch:** cache the normalized block text per element per pass (a `Map` built once at the top of `apply_records` and thrown away at the end), which removes the biggest multiplier without changing the re-resolve-every-pass guarantee.

---

## R26. Basic formatting

> Requirement with no mechanism at all: **R26** (basic formatting) is named once as a record kind and never given an implementation, a vocabulary, or a paste rule.

**Verdict: BUILT for the mechanism and the vocabulary. The paste rule is NOT BUILT, and the hole is closed elsewhere.**

### Evidence

Mechanism chosen and written down: `src/layer/editing.js:161` `var FORMATTING_MECHANISM = "execCommand";`, with the reasoning at lines 74-76. Closed vocabulary at `editing.js:168-171` (`bold`, `italic`) and an applier that refuses anything outside it (`editing.js:1075-1078`). Real buttons at `editing.js:1357-1359`. Boot normalization at `editing.js:178` (`styleWithCSS` false, "emit tags, never style attributes").

R31 got the HTML-level comparison rule the review asked for: `normalize.equalsInMode(mode, a, b)` at `src/shared/normalize.js:762`, with `modeFor(kind)` at `:637-639` picking structure mode for `format_only` and text mode otherwise, and `structureOf` reducing markup to `["em", "strong"]` plus normalized text so a framework reserializing a span is not mistaken for a format change.

**Tests:** `test/unit/editing_surface.test.js:91` and `:122`; `test/browser/editing_undo.spec.js:200` (clicks the real italic button); `test/unit/normalize.test.js:241` ("the two comparison modes disagree on a text-equal structure-different pair").

**What is missing:** there is no `paste` listener in `src/layer/editing.js`, and the edit block is plain `contenteditable: "true"` (line 184), not `plaintext-only` (which the **comment** surface does use, `src/layer/comments.js:142`). Sanitization happens at capture instead: `editing.js:351` runs `normalize.cleanMarkup(regionEl.innerHTML)`, and the structure comparison drops every tag outside em and strong.

**User-visible consequence:** a reviewer pastes a paragraph from Word or a web page into an edit region. Full foreign markup lands in the live DOM and the reviewer sees the page briefly wearing someone else's fonts and colors. Nothing is corrupted, because the record only ever stores cleaned markup, and the next replay pass writes the normalized version back. No test covers it.

**Fix sketch:** add a `paste` handler on the region that inserts `event.clipboardData.getData("text/plain")`, matching what the comment surface already does with `plaintext-only`.

---

## RC1. "The harness already built survives"

**Verdict: BUILT, intact, nothing moved.** This is the one reuse claim the review said was true, and it still is.

`test/fixtures/repainting.html` and `test/fixtures/assets/repaint-engine.js` are both at their named paths. `test/helpers/caret.js:85-93` still compares caret position by node identity, not offset. `test/helpers/assertions.js:502-505` still exports `assertCaretSurvivesTyping`, `assertNoSecondWrite`, `assertCaretRestoredAcrossRepaints`. `src/layer/replay.js:131-142` still exposes the pass counters ("The counters the tests read. Public and stable from Phase 0") and has grown more of them.

`test/browser/harness_selftest.spec.js` (44 KB) still tests the assertions in both directions: line 394 `"throws when replay never runs, so a no-op implementation cannot pass"`, line 481 `"throws when replay rewrites the same content, which final-DOM equality would miss"`, line 535 `"it refuses to run at all without minReplayPasses"`.

The doc now does name the harness as a keep, in the Test strategy section, which was the ask.

---

## RC2. The protected-region design

> The protected-region design does not survive intact: the morph veto and the selection snapshot are gone (RF6), and the atomic group id is gone (RF10).

**Verdict: two of three BUILT since the review; the atomic group id is still NOT BUILT.**

**Morph veto: BUILT.** `src/layer/protect.js:385-390`:

```js
    function veto(el, event) {
      if (!touches(el)) return false;
      counters.vetoes += 1;
      if (event && typeof event.preventDefault === "function") event.preventDefault();
      return true;
    }
```

with the framework event table at `protect.js:114-135` and, importantly, `touches()` rather than `isProtected` as the predicate, because a frame-level morph fires its cancelable event on an element that **contains** the protected block (`protect.js:356-364`). Tests: `test/unit/protect_vocabulary.test.js:57`, `test/browser/protection_layers.spec.js:151` and `:182`.

**Selection snapshot: BUILT.** Layer three at `protect.js:16-17`, installed on mark at `:343`, keyed region-relative rather than node-relative (`:53`), with its own counter. Tests: `test/browser/protection_layers.spec.js:209`, `:245`, `:307` ("the block is destroyed and comes back with the reviewer's words").

**Atomic group id: NOT BUILT.** The `FIELD` table at `src/shared/record.js:54-89` has no group, gesture, or atomic field. A repo-wide grep for `atomic|group_id|groupId|gesture_id` returns only `writeAtomic` (file writes) and the projection's page grouping. What shipped instead is the other half of R30, per-region decomposition, covered by `test/browser/editing_two_regions.spec.js:86` (`two records, two regions, neither merged`).

**User-visible consequence of the gap:** two edits the reviewer made in one gesture replay independently, so a page repaint can restore one and lose the other, leaving a half-applied change on screen with no card saying so. Low frequency, since most gestures touch one region.

---

## RC3. `test/helpers/contexts.js` contradicts D5

**Verdict: PARTLY FIXED.** The comment's behavior claim is right; its decision letter is dead.

`test/helpers/contexts.js:10-13` still says `openTwoTabs` is "the case D6 says must be refused with a reason". D6 is now the agent contract; the second-window rule lives in D5. The substance is correct: D5 still refuses a second window and offers a takeover button, and the code does exactly that (`test/browser/rail_second_window.spec.js:60`, `:77`, `:98`). The review's own premise ("D5 now says two windows are supported") was the thing that was out of date. What remains is one wrong letter in a test-helper comment. No user consequence.

---

## RC4. `CLAUDE.md` and `playwright.config.js`

**Verdict: BUILT, both fixed.** `CLAUDE.md:8` now says D1-D12, matching the doc's actual range, and lines 105-116 state the cross-platform position with the Chromium default called out as a loop-speed choice rather than a support statement. The only remaining macOS mention is honest and scoped (the `install-cli` POSIX wrapper, with the WSL workaround named). `playwright.config.js:3-5` cites the live D1 and R42. Neither is guarded by a test; they are prose.

---

## A1. The blocking CLI missing from the alternatives list

**Verdict: the mechanism is BUILT and became the primary path; the doc's alternatives list was NOT updated.**

`lahe monitor` exists and is the answer to "how does an agent know there is work" (`src/cli/commands/monitor.js:1-21`), and the contract spells out the wake feed, the drain command, and per-host instructions (`src/shared/review_format.js`, contract entries in the block at lines 83-89). The review's premise that this is "already specified in `src/shared/cli_contract.js`" no longer holds: that file was deleted, with a tombstone at `src/shared/contracts.js:15`.

The doc gap is unresolved. `02_architecture_live_agentic_html_editor.md:620-639` lists send/batch, whole-page contentEditable, wrapper highlights, MCP, SQLite, writing the reviewed file, and Chromium-only. The blocking CLI is still absent, even though it won.

**Tests on the mechanism:** `test/unit/cli_dispatch.test.js:44`, `:71`, `:95`; `test/unit/review_format.test.js:106` pins the contract byte for byte and `:130` pins its length at 32 entries, so deleting any wake or monitor sentence fails the gate.

---

## A2. Verification deleted, not rejected

**Verdict: NOT BUILT, and that is the accepted trade. The seam D6 promised is real.**

The optional files-touched list exists on the reply line: `src/shared/protocol.js:659` `FILES: "files"`, parsed leniently at `:743`, and advertised to agents in the contract's example line (`review_format.js:72`). It reaches the reviewer's card (`src/layer/overlay.js:1347-1349`, `src/layer/tab_done.js:756`).

Nothing verifies. `src/service/replies.js` contains no `existsSync` and no `readFileSync`; no named path is ever opened, which is also why a hostile path in `files` is not a filesystem read. `src/service/verification.js` is deleted rather than dead (see CL1). R9's second half rests on agent self-report, enforced only by rev fencing and the redelivery doctrine, neither of which checks that a change happened.

**Loose thread:** `src/shared/normalize.js:69` and `:94` still name "Verification (3B)" as a future consumer of the fuzzy pass. That is a stale forward reference to a component that does not exist.

---

## C1. Retire the five v1 leftovers

**Verdict: 4 of 5 done; the `review.json` clause is moot.**

- `review.json` as a second authoritative file: **MOOT and inverted.** It is now THE agent contract file (`src/service/review_writer.js:1`, "the ONE owner of writing review.json"). The warning should be struck from the doc, not tracked as debt.
- `served.document` mode: retired (CL4).
- Session minting: retired in the v1 sense; what exists now is D5's per-window `session_secret` (`src/service/reviews.js:869`), a different mechanism.
- Manifest six-owner scheme: kept deliberately (CL3).
- `service/verification.js`: removed (CL1).

---

## C2. Second-window support: specify it or cut it back

**Verdict: BUILT end to end, and then some. Two branches are untested.**

Wire: `src/shared/protocol.js:250-260` (`window.claim`, with `takeover?` in the request). Server honors an explicit takeover over a live holder, `src/service/reviews.js:828-830`:

```js
    var wantsTakeover = req.takeover === true;

    if (holder && !holderIsStale(holder) && !wantsTakeover) {
```

and mints a fresh secret on every grant so "a deposed holder's old secret can never re-assert possession" (`reviews.js:866-869`). Button: `src/shared/failures.js:356` `SECOND_WINDOW_REFUSED: { label: "Review here", action: "takeover" }`, rendered at `src/layer/overlay.js:809-812`, handled at `src/layer/index.js:408-447`. The deposed window really deactivates: its next heartbeat comes back refused and it calls `enterReadOnly()` (`src/layer/sync.js:1383-1408`), which is a real teardown (`index.js:314-336`: `comments.closeAll(); comments.unbind(); editing.teardown(); done.setReadOnly(); rail.showRefusal(info);`), not a banner. There is also a 30s auto-takeover when a holder goes stale (`sync.js:1417-1435`).

**Test gaps worth filing:** `grep -rn "takeover: true" test/` finds nothing outside the client-side fetch stub in `test/unit/sync_client.test.js:506`. No test calls `claimWindow` with `takeover: true` against a live, non-stale holder, so deleting `&& !wantsTakeover` from `reviews.js:830` would silently break the button with a green suite. And no test asserts the deposed window goes read-only. Those two behaviors are exactly what makes this a takeover rather than a refusal.

---

## S1. Show the conflict on the page, not only in the record

**Verdict: PARTLY BUILT.** The card half shipped in full. The "keep the reviewer's text painted in a conflict state" half did not.

The `content_changed` branch exists (`src/layer/replay.js:509`) and paints a real decision UI: `replay.js:717-722` defines "Which version stands?", "Your version", "On the page now", "Keep mine", "Take the page's", and `flagConflict` (`replay.js:1555-1574`) attaches it. The badge says what happened in plain words, `src/shared/failures.js:157`: "This region is neither what you edited nor what you changed it to, so nothing was written. Your text is kept."

What did not ship: `flagConflict` never touches the region element. `test/browser/replay_human_and_agent.spec.js:194-196` states the shipped behavior:

```js
    // R5. Neither version was overwritten: the page keeps its text, the record
    // keeps the reviewer's.
    expect(await page.evaluate(() => window.__laheReplay.text("#region-a"))).toBe(theirs);
```

**User-visible consequence:** the reviewer's typing does still visibly vanish from the page body. They get it back on the card with both versions and two buttons, which is a real answer, but the moment of "my words disappeared" is exactly the old tool's symptom one, and it still happens on screen.

**Tests:** `test/browser/replay_branches.spec.js:150,162-164`; `test/browser/keep_mine_live_page.spec.js:206-244` asserts both versions and the visible Keep mine button.

---

## S2. Ack-before-replay ordering

**Verdict: PARTLY BUILT.** The rule is declared in the pass table and is a deliberate no-op in the shipped layer.

`src/layer/replay.js:122-124` declares it:

```js
  var PASS_ORDER = [
    { step: "fold_replies", why: "D7: replies are folded before replay, so a handled item is retired first" },
```

but production supplies no hooks for the first three steps, on purpose. `src/layer/index.js:635-640`:

```js
    // Finding 30: replay is configured with no fold/merge/retire/rail hooks on
    // purpose. Those four steps run on their own schedules (replies on the sync
    // poll, merge on remount, rail on onChange), so a replay pass may raise a
    // provisional collision that a later fold clears. That is the intended
    // trade, documented at replay.js configure(); see its "Honest note for 3A".
```

and `replay.js:59-62` says the same thing from the other side: "in a host page the agent's source write arrives as a morph seconds before the reply does, so a provisional collision may show and then clear when the reply explains it."

**User-visible consequence:** exactly the one S2 named. Every landed agent change can flash a conflict on the card that clears a moment later, which teaches the reviewer to ignore conflicts. Since S1's real conflicts are the mechanism the tool leans on, training the reviewer to dismiss them is expensive.

**Test coverage: none.** `fold_replies` and `PASS_ORDER` appear nowhere in `test/`. `runPass` records `{ step: "fold_replies", ran: false, why: "no hook supplied" }` (`replay.js:479`) and nothing checks it.

**Fix sketch:** before scheduling a pass from a mutation, drain any reply already in the sync client's buffer, so a change whose reply has arrived retires before the repaint it caused is examined.

---

## S3. State directory outside any checkout, owner-only

**Verdict: BUILT in code and tested. The doc half of the ask is still open.**

`src/service/state_dir.js:37-38` sets `DIR_MODE = 0o700` and `FILE_MODE = 0o600`, and `stateDir()` **refuses** rather than warns when the resolved directory sits under a git checkout (lines 97-109), with the reason stated at lines 9-12: a `git add -A` publishing a review history "burns a user with no attacker involved." `checkoutAbove()` handles worktrees (`.git` as a file) as well as clones.

**Tests:** `test/unit/service_paths.test.js:99` `"the state directory refuses to sit inside a checkout"` and `:146` `"the data directory and its files are owner-only"`.

**Doc gap:** the architecture's Data and state section says only "readable by the owner only" and never says **where** the directory is. `AGENTS.md` does, and `test/unit/add_command.test.js:889` pins that, so the operational half is covered even though the architecture doc's is not.

---

## S4. One shared formatter for copy/export and `review.md`

**Verdict: NO LONGER APPLIES.** There is no `review.md` in this design. The helper writes `review.json` for the agent (`src/shared/review_format.js:673`), and the browser's copy/export is the only producer of the human-readable document, rendered by `renderText` in the same shared module (`src/layer/export.js:135`). The drift risk S4 named needs two producers of one document, and there is one.

`src/layer/export.js:17-21` states the no-second-formatter rule and claims parity with "the helper's output", which is now slightly wrong: the helper emits JSON, so there is nothing to be in parity with. No test asserts parity, because there is nothing to compare.

---

## S5. What "a block" is for Cmd-Shift-E

**Verdict: PARTLY BUILT.** There is one definition for the gesture, it is not where the review expected it, it is untested, and a second block vocabulary lives next to it.

The gesture's definition is in `src/layer/selection.js:120-137`, not `src/shared/regions.js` (which is entirely about display labels):

```js
  // The block-level element a gesture applies to: the nearest ancestor that is
  // a block the reviewer would recognize as "this paragraph". Cmd-Shift-E makes
  // exactly this element editable, and nothing else.
  var BLOCK_TAGS = [
    "P", "LI", "H1", "H2", "H3", "H4", "H5", "H6", "BLOCKQUOTE", "TD", "TH",
    "DD", "DT", "FIGCAPTION", "PRE", "DIV", "SECTION", "ARTICLE"
  ];
```

It picked the first of S5's two readings, nearest block-level ancestor. A different, larger `BLOCK_TAGS` map lives in `src/shared/normalize.js:470-476` (38 tags including `table`, `tr`, `ul`, `figure`, `hr`) and is used for paragraph-break surgery inside a region (`src/layer/editing.js:799`). So the layer runs two block vocabularies for two purposes.

**Test coverage: none.** `blockFor` and `BLOCK_TAGS` appear nowhere in `test/`. `test/unit/regions_gestures.test.js:131` only asserts the keystroke maps to the gesture. Changing that tag list would change what Cmd-Shift-E makes editable on every page with nothing turning red.

---

## S6. Pick the formatting mechanism

**Verdict: BUILT.** `src/layer/editing.js:74-76` records the decision ("DECIDED: document.execCommand, with normalization on capture"), `:161` pins it as a constant, `:168-181` gives the closed command set and the two boot commands. Tests: `test/unit/editing_surface.test.js:119`; `test/browser/editing_undo.spec.js:200-211`; `test/browser/edits_tab.spec.js:80,152`.

---

## S7. Edit regions disable autocorrect and spellcheck

**Verdict: BUILT.** `src/layer/editing.js:183-192`:

```js
  // Set on the block in edit state. The platform must not be able to rewrite a
  // word and have it recorded as the reviewer's intent (D4).
  var EDITABLE_ATTRS = {
    contenteditable: "true",
    spellcheck: "false",
    autocorrect: "off",
    autocapitalize: "off",
    "data-gramm": "false"
  };
```

Protection carries the same attributes in its restore vocabulary (`src/layer/protect.js:185-187`) and the normalizer strips them on capture (`src/shared/normalize.js:163-165`). Tests: `test/unit/editing_surface.test.js:137-139`; `test/browser/harness_selftest.spec.js:890-914`; `test/browser/editing_two_regions.spec.js:167`, whose own message is "the platform must not rewrite a word and have it recorded as intent". This directly closes R3's named failure, a comma coming back as an em dash.

---

## S8. Reopening a handled item bumps the rev

**Verdict: BUILT.** `src/shared/record.js:589-594` (`bumpRev`, with the reason spelled out: "a rev that does not move is how a stale 'handled' swallows a rewording"), `reopenIssue` at `:698-703` going through `continueThread`, which archives the answered round, bumps the rev, sets state back to ready, and clears the reply. Called for real from the Done tab (`src/layer/tab_done.js:978`). Tests: `test/unit/record_lifecycle.test.js:112-116` (`assert.equal(reopened.rev, answered.rev + 1)`) and `:384`.

---

## S9. The SQLite rejection reason, and the Node floor

**Verdict: BUILT as the doc change asked for, with a live number mismatch nobody checks.**

The doc now gives the stronger reason (`02_architecture_live_agentic_html_editor.md:591-594`: "Node's built-in SQLite arrives in Node 22 and our floor is Node 20"), and no "still experimental" wording remains.

The two floors disagree. The doc says Node 20 twice (line 66 and line 592). `package.json:28-30` declares `"node": ">=18.2.0"`, and `CLAUDE.md` explains why 18.2 rather than 18.0 (`server.closeAllConnections()`). The SQLite argument survives the mismatch, since 18.2 is also below 22, but the numbers are not the same and nothing ties them together: no test or script reads `engines`.

---

## S10. Does the helper start itself

**Verdict: BUILT.** The doc closes Q1 (`02_architecture_live_agentic_html_editor.md:712-716`: "the add command starts the helper when it is not already running"), and the code matches: `src/cli/commands/add.js:631-636` spawns a detached child and polls health. No launch agent, no launchd, no plist anywhere in the repo, which was the specific consequence S10 said the answer decided. `add.js:25-28` also states the restart discipline that came with it: nothing ever restarts a live helper, because that disconnects every open review page.

**Tests:** `test/unit/add_command.test.js:390` `"add starts the helper when none is running, which is what makes the install one command"`; `:475`, `:494` `"and it is the SAME helper process: nothing was bounced"`; `test/unit/service_helper.test.js:333`.

---

## CL1. Remove `src/service/verification.js`

**Verdict: BUILT (removed)**, in commit `07381fb`. The file does not exist, no import references it, and it is absent from `src/shared/manifest.js`. `test/unit/record_lifecycle.test.js:163` iterates a field denylist that includes `"verification"`, so a resurrected field fails a test; a resurrected file with no manifest entry fails `scripts/lint.js` (`checkManifest`, lines 236-272), which is part of `npm run gate`.

---

## CL2. Remove the four v1 CLI commands and `cli_contract.js`

**Verdict: BUILT (removed)**, also in `07381fb`. `src/cli/commands/` holds only `add`, `monitor`, `review`, `serve`, `session`, `status`. `src/shared/contracts.js:15` carries the tombstone.

Note that D6's promised **wait** command is also gone, and deliberately: `src/cli/index.js:10-19` says it "blocked, which meant agents ran it in the foreground and stopped working while a reviewer typed", and "Two subtly different blocking commands would be a trap, so monitor is the only public waiting surface." That is a design change from the architecture, decided on the record.

**Tests:** `test/unit/cli_dispatch.test.js:35` asserts each of the six commands appears in help **and** at line 44 asserts `wait` does not; `test/unit/add_command.test.js:973` cross-checks every command the docs tell a reader to run against the real command list.

---

## CL3. Drop the manifest's six-owner scheme

**Verdict: NO LONGER APPLIES.** The cleanup was conditional on the build dropping per-file ownership, and the build did not. `src/shared/manifest.js` is read by `scripts/build-layer.js` for concatenation order and by `scripts/lint.js` for completeness, and it is enforced on every `npm run lint`: every file under `src/` must appear exactly once, with `NO OWNER`, `TWO OWNERS`, and `IN THE MANIFEST, NOT ON DISK` all failing the gate.

One doc correction: it is not a six-owner scheme any more. There are roughly fourteen distinct owner strings (`0A-kernel`, `0A-wire`, `1A` through `3D`, plus two frozen variants). The line should be struck from the cleanup list rather than tracked.

---

## CL4. Remove the `served.document`, `session.mint`, `review.send` routes

**Verdict: BUILT (removed).** Zero hits across `src/` and `test/` for any of the three names or their constant spellings. `src/shared/protocol.js:176-268` defines exactly eight routes: `health`, `events.append`, `library.get`, `review.write`, `review.read`, `replies.poll`, `window.claim`, `review.end`. `protocol.route(name)` throws for anything else.

**Test gap:** there is no assertion pinning the exact route-name set the way `test/unit/protocol_wire.test.js:20` pins `EVENT_TYPES` with a `deepEqual`. The auth sweep at `protocol_wire.test.js:301-312` would catch a re-added route that skipped the token, but a token-guarded `review.send` could come back with a green suite.

---

## CL5. Remove `test/fixtures/servers/stub-service.js`

**Verdict: NOT BUILT.** This is the one item on the cleanup list still outstanding.

The file is still there (7.5 KB), still speaking the v1 send protocol. Its route is `/reviews/<id>/items` (line 120), while the current append route is `BASE + "/events"`. Its own header still describes it as pre-real-helper scaffolding.

It is never started. `test/helpers/service.js:51` defines `STUB_SERVICE_ENTRY` and line 529 exports it, but `startService` defaults to the real `SERVICE_ENTRY` and no caller overrides it. The only test touching it is a self-admitted non-test, `test/unit/harness_service.test.js:299-306`, which asserts the path string exists and whose own comment describes a swap that already happened.

**User-visible consequence:** none. This is repo hygiene: a stale fixture, a stale constant, and a stale assertion, all three removable together.

---

## Loose threads found along the way

These are not items in the audited section, but they came out of reading the code and would otherwise get lost:

- `src/shared/normalize.js:69` and `:94` name "Verification (3B)" as a future consumer of the fuzzy pass. That component was cut and deleted.
- The architecture's failure table (`02_architecture_live_agentic_html_editor.md:653`) describes the second-window case without mentioning the "Review here instead" takeover that D5 and the code both have.
- `src/layer/export.js:87-93` labels an offline export "this page's slice" when its contents are the whole origin's bucket for the review. It under-claims, which is the safe direction, but the wording is wrong.
