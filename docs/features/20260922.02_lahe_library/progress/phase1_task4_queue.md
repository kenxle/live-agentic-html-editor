# Phase 1, Task 1.4: request queue, drain section, CLI

**Summary.** The Library's request queue, its drain section, `lahe library`, `lahe library answer`, and `lahe monitor` with repeated `--session` are built on `task/lib-queue`. `npm run gate:unit` is green: 1375 tests, 1373 pass, 0 fail, and 2 todo. Both todo tests are older anchor tests, not part of this task. Nothing in scope was punted. Two things for 2.1 to wire, listed under Follow-ups.

## What was built

- **`src/service/catalog_requests.js` (new).** The queue over `catalog-requests.jsonl`:
  - `append`: copies the six documented keys and drops the rest. It enforces one pending request per review (`PROTO_REQUEST_PENDING`) and `QUEUE_CAP` (`PROTO_QUEUE_FULL`).
  - `answer`: first answer wins. It refuses these cases, each with its own reason: an unknown id, the wrong session, an expired request, a second answer, text too long, and a bad status.
  - `pending(now)`, `pendingFor(session, now)`, `requestFor(review, now)`, `readAttached(now)`.
  - `writeAttach(dir, session, now)`, the only writer of `catalog-attach.json`.
  - Expiry is worked out on every read from `now`. A queue made with `writeExpired: true` (the helper's, for 2.1) records the expired line once. The CLI's queue computes the same answer and writes nothing.
  - A torn or unreadable line is skipped, with a helper log line. The next append starts a fresh line, so it never joins the torn fragment.
- **`src/service/state_dir.js`.** New paths:
  - `catalogRequestsPath`
  - `catalogAttachPath`
  - `catalogDeliveredPath` (per session: `agent-sessions/<id>/catalog-delivered.log`)
- **`src/cli/commands/status.js`.** The `catalog_requests` section in the `--json` summary line, beside `ended_reviews`.
  - The id fields are filled here. `kind`, `title`, `path`, `candidate` and `handoff` come from an injectable `describeRequest(request, {dir})`. It defaults to all null.
  - A pending request gets past `--quiet`. That includes a session with no reviews, which is the usual shape of the agent that opened the Library.
  - The monitor's drain (`markEndedDelivered`) reports only requests not yet recorded in `catalog-delivered.log` as `"<id> <handoff_rev>"`. So a request wakes the monitor once, and wakes it again after a takeover.
  - Every other drain lists every pending request until it is answered or expires.
  - The human output names each request, with its `lahe library answer` line.
- **`src/cli/commands/monitor.js`.** `--session` can be repeated.
  - Every watched session gets a heartbeat with its own `handoff_rev`, and `primary` names the first session still watched.
  - Work in any session exits 0. The output has one drain line per session that had work, and a relaunch that names every session still watched.
  - A session that closes or is taken over is dropped with a stderr line. Its work from that poll is never delivered.
  - The monitor exits with a dropped session's code only when no session is left.
  - A single session behaves exactly as before.
- **`src/cli/commands/library.js` (new).**
  - `lahe library [--session] [--json] [--port] [--state-dir]` starts the helper with `session.js`'s `startHelper`. It checks the session exists and is open before it starts anything. It writes the attach and prints the helper's own origin from `service.json` plus `/catalog`. It never opens a browser.
  - `lahe library answer <id> --session --status done|refused --text` answers a request, then stamps the session's activity.
- **`src/cli/index.js`.** `library` is routed and listed in the usage text.
- **`src/shared/protocol.js`.**
  - `MONITOR.HEARTBEAT_FIELD.PRIMARY = "primary"`.
  - `monitorCommand` accepts a list of sessions.
- **`src/service/agent_sessions.js`.** `writeMonitor` writes `primary` when it is given one.
- **`src/shared/manifest.js`.** The `planned` flag is off on the two 1.4 files.
- **`docs/CLI.md`.** Three rows. See Deviations.

## Tests

- `test/unit/catalog_requests.test.js` (24 tests): the key set, the single-request and cap limits, freed slots, expiry at 29:59 and 30:00, monitor-dead, attach change against same-id re-attach, the expired line written once, a torn last line, every `answer` refusal, the `ANSWER_TEXT_MAX` pair, `requestFor` and `readAttached`.
- `test/unit/status_catalog.test.js` (11 tests): getting past `--quiet`, the describe step, the section never leaking to another session, delivery once per rev and again after a takeover, listing until answered or expired, the activity stamp, the real monitor exiting 0 on a request alone, and the human output.
- `test/unit/monitor_sessions.test.js` (10 tests): repeated `--session`, heartbeats with `primary`, exit on work in either session, drop on close, fencing on takeover, the final exit code, a session closed at startup, an unknown session, the duplicate guard, and `monitorCommand` with a list.
- `test/unit/library_command.test.js` (11 tests): starting the helper on a free port in a temporary state dir (the readiness file appears and the printed port equals `--port`), attach and no-attach, `--json`, and every `answer` refusal.
- Each new file was run red first. It failed on the missing module or the missing behavior, then went green.

## Deviations

- **`docs/CLI.md` gained three rows**, although the plan gives that file to 3.1. `add_command.test.js` fails any routed command that no doc shows being run. The rows are minimal; 3.1 expands them. The coordinator approved this.
- **`primary` was added to `protocol.js` and to `agent_sessions.writeMonitor`**. Phase 0 did not spell it, and 1.1 reads it. The coordinator approved this and will keep one copy if 1.1 adds the same line.
- **`kind` is null on drain entries until 2.1.** The coordinator ruled out a second copy of the kind rule: the step is injectable, and defaults to null.
- **The heartbeat boundary test.** The test list says "expired at `HEARTBEAT_FRESH_MS`". The existing liveness function counts a heartbeat exactly `HEARTBEAT_FRESH_MS` old as fresh (`withinMs` uses `<=`). The architecture says to use that function, so the pair is one millisecond inside the limit (pending) and one millisecond past it (expired). I did not change the function.

## Surprises

- **The exit-on-work monitor would have expired its own request.** The monitor takes its heartbeat down when it exits on work, and the request is that work. A strict "heartbeat dead means expired" rule would expire the request in the gap before the agent drains, and the helper would record that permanently. Two things keep it alive:
  - Expiry uses the liveness function's full "listening" answer: a live heartbeat, or a lahe command in the last `RECENT_COMMAND_MS`. The wake-feed probe is passed as "no", so a queue read never starts a subprocess.
  - When the monitor's drain newly delivers a request, it stamps the session's activity. It does this only for a delivery, never on an idle poll.

  Both are tested.
- **A session with no reviews used to exit silently under `--quiet`.** The Library's agent often owns no reviews, so the empty-reviews branch of `status` now reports catalog requests too.

## Follow-ups (for 2.1)

- Point `status.run`'s `describeRequest` option at 1.1's `describeReview`. It fills `kind`, `title`, `path`, `candidate` and `handoff`. Without it the drain carries `kind: null`.
- The helper's routes should build their queue with `createQueue({dir, writeExpired: true, log: <helper log>})`. Only the helper records expired lines.
- The routes join `readAttached(now)` and `requestFor(review, now)` into `catalog.list`. `requestFor` returns `{id, action, at, state, by_name, text, answered_at}`, plus `reason` when the state is expired.
- `lahe status` builds the catalog entries through the exported `status.catalogEntries(dir, session, now, describe)`, which 2.1 can reuse.

## Cleanup needed

- None. No temporary files were left in the repo. Test state dirs live under the OS temp folder, and every helper a test starts is stopped in `t.after`.
