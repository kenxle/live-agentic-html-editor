# 1A builder notes: helper core, review creation, and token minting

Branch `task/1a`, worktree `../lahe-worktrees/1a`. Everything below was run with Node 20.19.0.

## What was built

The helper is real. `node bin/lahe.js serve` binds loopback, opens reviews, mints their tokens, checks
every request, and appends to `events.jsonl`.

| File | What it is now |
| --- | --- |
| `src/service/state_dir.js` | Rework. The `reviews/<id>/{events.jsonl, review.json, meta.json, replies*.jsonl}` layout, `service.json` and `helper.log` at the top, owner-only modes, the safe-id rule delegated to `protocol.isSafeId`, `resolveWithin` (containment plus a per-component symlink refusal), `writeAtomic` (beside then rename), and a refusal to sit inside a git checkout |
| `src/service/log.js` | Rework. The `events.jsonl` appender: whole-line appends, idempotence by `event_id`, helper-assigned monotonic `seq` per review, a torn-tail repair on load, `read`/`since`/`currentSeq`, and the helper log |
| `src/service/auth.js` | Rework. One call site for `protocol.checkRequest`, plus the named refusal line in `helper.log`. The checks themselves are not reimplemented here; they stay the one pure function on the wire |
| `src/service/routes.js` | Rework. One handler per protocol route, checked at load. `health`, `events.append`, `replies.poll`, `window.claim`, `review.end` and `wait` are built; `review.read` throws `NOT_IMPLEMENTED` naming 3A, which owns the projector |
| `src/service/index.js` | Rework. `serve`: the HTTP server, the preflight answer, the body cap, the one auth call site, the readiness file written after the listener binds, and `probeHealth` for the idempotent second serve |
| `src/service/reviews.js` | New. Review creation (idempotent), per-review token minting that persists across restarts, origin registration as a SET, the readiness file, and the one-session-per-review heartbeat with the 30-second stale takeover |
| `src/cli/commands/serve.js` | New. `--port`, `--state-dir`, `--review`, `--origin`, and the EADDRINUSE path that reports a helper already running and exits 0 |
| `src/cli/index.js` | Rework. Dispatcher for `serve`, `add`, `wait`. `add` and `wait` are stubs that name their owning task, say what to do instead, and exit 4 |
| `bin/lahe.js` | New. The entry point. No `bin` field in `package.json` yet; that is 3B's, as the plan says |
| `src/shared/manifest.js` | The one pre-authorized edit: `planned: true` flipped off for `src/service/reviews.js` and `src/cli/commands/serve.js`. Nothing else in the file changed |
| `test/browser/harness_second_origin.spec.js` | Retargeted from `STUB_SERVICE_ENTRY` to `SERVICE_ENTRY`, and grown to carry all of ranked test 5 plus ranked test 26 |
| `test/browser/file_origin.spec.js` | New. The `file://` spike, run on all three browsers |
| `test/unit/service_paths.test.js` | New. Ranked test 36 |
| `test/unit/service_helper.test.js` | New. `kill -9` durability, the second window, token persistence, idempotent serve, the readiness file shape |

## Decisions worth knowing about

**The port in tests is 0, not 7817.** The fixed port is the product's promise to a page that has it
baked into a script tag. A parallel Playwright run would collide on it, so every spec starts the helper
with `args: ["--port", "0"]` and reads the real port out of `service.json`. `--port` exists for exactly
this.

**The review id is read from the query string, then from the body; the origin never is.** The origin
comes from the request's own header, which a page cannot forge. The body is read (under a 1MB cap)
before the check block runs, because the token cannot be checked until the request has named a review,
and `events.append`'s contract puts the review in the body. One `checkRequest` call happens per
request, so one refusal line appears per refusal.

**Refusing at the preflight is a separate act from refusing the request.** A preflight carries no token
and names no review, so the only thing it can be judged on is whether ANY review registered the origin.
It gates the browser and nothing else; the request behind it is still checked in full. The helper log
distinguishes them (`refused preflight: origin ...` versus `refused events.append: check ... failed`).

**A cross-origin page never reaches the origin check.** This surprised the first version of the spec and
is worth writing down: the two CORS-simple shapes (a `text/plain` post, `sendBeacon`) die at
`custom_header`, which sits ahead of the origin check, because a simple request cannot carry a custom
header at all. The preflighted shape dies at the preflight. So the origin check proper is what refuses a
NON-browser client, and that is where the spec asserts it.

**`serve` is idempotent by reporting, not by silence.** A second serve on a port a lahe helper is
already answering reports it and exits 0. A port held by something that is not a lahe helper exits 1,
because pretending to have started would leave the reviewer waiting on a helper that never arrives.

**The state directory refuses to sit inside a git checkout.** `.git` as a directory or as a file (a
worktree) both count. A state directory inside a clone means an ordinary `git add -A` publishes a
review history, and that burns a user with no attacker in the story.

**A torn last line is repaired on load, not appended after.** Appending after the wreckage would splice
the next event onto half of the previous one and turn one lost event into two. The half-event is not
lost work: the library re-posts anything unacknowledged, idempotent by `event_id`.

## Contradictions between the plan and what landed

- The plan's `service/routes.js` row says "the verification call site goes away with verification", and
  it has. The old file also carried a `REQUEST_CHECKS` list citing D9 numbers from the dead
  architecture. It is gone rather than renumbered: the checks are `protocol.CHECKS` and restating them
  in the router was the DRY violation that lets a helper implement five and forget the sixth.
- The plan's ranked test 5 says "each of the five checks is omitted one at a time". There are six checks
  on the wire. Five of them (`custom_header`, `content_type`, `token`, `review_known`, `origin`) can be
  failed by a page; `host` cannot, because the browser sets that header. The spec omits the five from
  the page and exercises `host` from the non-browser client, which is the only client that can lie about
  it. That is the architecture's side, not a weakening: nothing goes unexercised.
- `protocol.checkRequest` compares the token with `!==` rather than a constant-time compare (the old
  stub service used `crypto.timingSafeEqual`). `protocol.js` is 0A-wire's and the rule is to import it
  and never retype it, so this was not forked. Flagging it for the orchestrator: a remote timing attack
  on a loopback socket against a 32-byte random token is not a realistic threat, but the change is one
  line inside `checkRequest` if the security review wants it.

## The `file://` spike: it works

**Verdict: a `file://` page reaches the helper on all three browsers.** No static-serve fallback is
needed, so none was built, and the plan's three pre-decided consequences are not taken. Written into the
architecture as a "Resolved (1A spike)" paragraph inside D11.

```
$ LAHE_ALL_BROWSERS=1 npx playwright test test/browser/file_origin.spec.js
Running 3 tests using 3 workers

file:// spike verdict: {"browser":"chromium","reached":true,"status":200,"error":null,
  "requestsTheServerSaw":["OPTIONS origin=null","POST origin=null"]}
  ✓  1 [chromium] › file_origin.spec.js:114:3 › the file:// spike › a page opened from disk tries to reach a loopback helper (363ms)
file:// spike verdict: {"browser":"webkit","reached":true,"status":200,"error":null,
  "requestsTheServerSaw":["OPTIONS origin=null","POST origin=null"]}
  ✓  3 [webkit] › file_origin.spec.js:114:3 › the file:// spike › a page opened from disk tries to reach a loopback helper (770ms)
file:// spike verdict: {"browser":"firefox","reached":true,"status":200,"error":null,
  "requestsTheServerSaw":["OPTIONS origin=null","POST origin=null"]}
  ✓  2 [firefox] › file_origin.spec.js:114:3 › the file:// spike › a page opened from disk tries to reach a loopback helper (683ms)

  3 passed (1.8s)
```

The spec is kept, not thrown away, and it runs on all three lanes. If a browser ever changes its mind,
the failure lands on the paragraph in D11 rather than on a memory of a spike nobody re-ran.

What the answer costs: `null` is a legitimate value in a review's registered origin set, and the helper
answers such a request with `Access-Control-Allow-Origin: null`. Any local file can present the same
null origin, so the origin check buys nothing in that case and the per-review token is the working
factor. D11 already said exactly that as a residual risk; the spike turns it from a prediction into a
measurement.

## The demonstrated failure

One line reverted in `src/service/auth.js`: let a failed origin check through.

```diff
--- a/src/service/auth.js
+++ b/src/service/auth.js
@@ -55,7 +55,7 @@ function createAuth(options) {
       reviews.config()
     );

-    if (result.ok) return result;
+    if (result.ok || result.check === protocol.CHECK.ORIGIN) return { ok: true, review: req.review, origin: null }; // DELIBERATE REVERT
```

Three of the four tests in the second-origin spec fail:

```
$ npx playwright test test/browser/harness_second_origin.spec.js
Running 4 tests using 4 workers

  ✘  3 › a non-browser client is refused the same way, including the Host check (104ms)
  ✓  1 › a cross-origin page cannot write, asserted on the event log (201ms)
  ✘  2 › two origins on one review produce one log with every record exactly once (219ms)
  ✘  4 › the positive control writes one line, then each omitted check leaves it at one (225ms)

  1) › the positive control writes one line, then each omitted check leaves it at one

    Error: expect(received).toBe(expected) // Object.is equality
    Expected: 200
    Received: null

      203 |       const ok = await post(null, { review: REVIEW, events: [anEvent("ev_control", ...)] });
    > 204 |       expect(ok.status).toBe(200);

  2) › a non-browser client is refused the same way, including the Host check

    Error: expect(received).toBe(expected) // Object.is equality
    Expected: 403
    Received: 200

    > 290 |       expect(noOrigin.status).toBe(protocol.statusFor("PROTO_FORBIDDEN_ORIGIN"));

  3 failed
  1 passed (686ms)
```

Two things worth reading in that output. The direct catch is failure 2: a curl-shaped client with a
valid token and no registered origin gets a 200 and its forged event lands. The indirect one is failure
1, and it is the more interesting: with the origin unverified there is no verified origin to echo, the
response carries no `Access-Control-Allow-Origin`, and the browser rejects the response of the honest
request too. Getting the origin check wrong breaks the reviewer before it helps the attacker.

The revert was then undone with `git checkout src/service/auth.js` and the spec is green again.

## Gate

`npm run gate:builder`, run synchronously, exit 0:

```
> live-agentic-html-editor@0.0.0 lint
> node scripts/lint.js
lint passed (syntax: 102 files, no jsdom, manifest complete)

> live-agentic-html-editor@0.0.0 test:unit
> node --test test/unit/
# tests 259
# pass 259
# fail 0

> live-agentic-html-editor@0.0.0 test:browser
> playwright test
  53 passed (16.0s)
```

`dist/` was not rebuilt and is not staged, per the dist rule.

The no-arbitrary-sleeps gate caught the first draft of `test/unit/service_helper.test.js`, which had four
`sleep(ms)` calls in it. All four became `pollUntil` conditions: "the helper wrote several lines of the
log" and "the helper process is gone" are both nameable conditions, and naming them made the kill -9
test sharper than the timing guess it replaced.

## The done bar, item by item

- **The second-origin spec passes against the real helper, with the positive control in the same spec
  and the same state directory.** Yes. `SERVICE_ENTRY`, not `STUB_SERVICE_ENTRY`. The control writes
  exactly one item event; each of the five page-omittable checks then leaves the count at one, each with
  its named refusal asserted in `helper.log`.
- **A non-browser client is refused the same way.** Yes, including the Host check, which needed a
  hand-built `http.request` with `setHost: false` because node's `fetch` will not let a caller set Host.
- **`kill -9` mid-write leaves at most a truncated last line and a readable history.** Yes, with 40
  posts in flight when the signal lands: at most one torn line, it is always the last one, no event is
  doubled, and `seq` is monotonic with no gaps.
- **Two origins on one review produce one log with every record exactly once.** Yes (ranked test 26),
  including a re-post of the first origin's event from the second origin, which idempotence by
  `event_id` absorbs.
- **Ranked test 36.** Yes: symlinked review directory, symlinked log file, unsafe review id, unsafe
  agent segment, and a write outside the data directory, each with a paired positive so the file cannot
  pass by refusing everything.
- **The `file://` question has a written answer with test output behind it.** Yes, above and in D11.

## Notes for the next builders

- **1B:** post to `protocol.route("events.append").path` with `{review, events: [...]}`. The response is
  `{accepted, stored, duplicates, rejected, seq}`; `accepted` includes duplicates on purpose, because
  the answer to a re-post is "it is on disk". The window claim is `POST /lahe/v1/window` with
  `{review, window_id}`; a refusal comes back 409 with `reason` naming the holder, and the holder
  re-posts the same `window_id` every 10 seconds (`heartbeat_seconds` in the response) to keep it.
- **3A:** `review.read` is wired and throws `NOT_IMPLEMENTED` until `src/service/projection.js` exports
  `project(reviewId, events)`. That is the only change needed in a file 1A owns. `wait`'s route is built
  and blocks correctly, so `src/cli/commands/wait.js` is a thin client of it.
- **3B:** `add` calls `reviews.create({id, origins})` and `reviews.registerOrigin`, both of which are
  real and idempotent, then starts `serve` if `probeHealth` says nothing is answering. The
  `package.json` `bin` field is still yours.

## Cleanup needed

Nothing was deleted. For the Phase 4B batch:

- `test-results/` in this worktree: Playwright traces from the failing runs above (the deliberate revert
  and the two spec drafts). Generated, gitignored, and safe to remove wholesale.
- `/tmp/lahe-1a-gate.txt`, `/tmp/lahe-1a-revert-diff.txt`, `/tmp/lahe-1a-revert-out.txt`: scratch
  captures of the gate and revert output, already transcribed into this file.
