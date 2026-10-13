## Step 1: The summary (workstream summary, PR 1)

::: xref
Architecture: "Data / State Changes" (the `reply.seen` event, `summary.json`, what counts as waiting on you, the `summary.read` response, the `summary.open` request), "Key Flows" (the first two), "Failure Modes", "Security & Privacy Notes".
:::

### Task 1.1: The read mark's round trip

**Spec:** Move the unread rule (`needsToSeeReply`, `unseenReplyIds` and what they lean on) from `src/layer/tab_done.js` into `src/shared/record.js`, with `tab_done.js` calling it there; the rail's behaviour does not change. Add the `reply.seen` event to the closed vocabulary in `src/shared/protocol.js`, exactly as `docs/CONTRACTS.md` spells it. The projection folds it onto the item as `reply_seen` only when the stamp names the item's current reply, and drops and reports anything else. The page posts it through the outbox the way `item.closed` is posted, once per stamp, at the moment the rail writes its local mark; and a `reply_seen` on a polled record that matches the current reply is adopted into the local marks. `summary.js` owns `summary.json` with `seeded_at`, written on the first `summary.read`, and a fresh file on loss.
**Files:** `src/shared/record.js`, `src/shared/protocol.js`, `src/service/projection.js`, `src/layer/tab_done.js` (the rule's home and the post), `src/layer/sync.js` (the post and the adoption), `docs/CONTRACTS.md` (the event row and the field, written by Step 0; the builder corrects it if the code has to differ), tests.
**Acceptance:** V1, V3 to V7.
**Don't touch:** how the rail draws a card or its "1 new" tag, replay, anything else in `src/layer/`.

### Task 1.2: The one-review summary

**Spec:** The catalog reader exposes one review's summary on its own, and the Library's fold rule so the summary can count a folded document once, and the summary gains two things: open questions after the cutoff, and per-page newest agent reply times. Comment text still never leaves the reader. Titles lose control and Unicode format characters and are capped.
**Files:** `src/service/catalog_reader.js`, tests.
**Acceptance:** V2, V8, and the Library's own tests still pass unchanged.

### Task 1.3: The summary and its cache

**Spec:** `summary.js` builds the response from one-review summaries (cached per review on size, modified time and inode of `events.jsonl`, `review.json`, `meta.json` and the reviewed document, plus `catalog.json` once per request), folded with the Library's rule, plus the window holders and session liveness. Fields exactly as `docs/CONTRACTS.md`. Wire the summary in `src/service/index.js`.
**Files:** `src/service/summary.js`, `src/service/index.js`, the menubar fixtures, tests. A test compares nested key paths and value types with `test/fixtures/menubar/summary.json` in both directions.
**Acceptance:** V9 to V13, V17.

### Task 1.4: The routes

**Spec:** A new auth mode, `AUTH.CLI_PROOF`, exactly as the wire in `docs/CONTRACTS.md`: signed requests, a 30-second window on an injected clock, a nonce cache, constant-time comparison, and signed answers (errors included). It passes `test/fixtures/menubar/proof_vectors.json`. `summary.read` (GET) and `summary.open` (POST, JSON) use it, refuse any `Sec-Fetch-*` header, sit behind the Host check, are never catalog routes, and `summary.open` also refuses an `Origin` header. `summary.read` takes the app's `summary_version` and answers a mismatch with `409 SUMMARY_VERSION`. `summary.open` runs catalog Open with `handoff: false`.
**Files:** `src/shared/protocol.js`, `src/service/routes.js`, `src/service/auth.js`, tests.
**Acceptance:** V14 to V16, V19, V20, V34.

**Step test:** `npm run gate:unit` green, and V19's browser spec green alone. The orchestrator rebuilds `dist/` once and opens PR 1.
