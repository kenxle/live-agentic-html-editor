## Step 1: The summary (workstream summary, PR 1)

::: xref
Architecture: "Data / State Changes" (`seen.json`, what counts as waiting on you, the `summary.read` response, the `summary.open` request), "Key Flows" (the first two), "Failure Modes", "Security & Privacy Notes".
:::

### Task 1.1: Seen marks

**Spec:** `seen_store.js` owns `seen.json`: `seeded_at` on first run, per-review per-page marks in prototype-free objects, writes only when a write would change a count, a fresh file on loss. A `page` over 1024 characters, or one that is not a page of that review carrying an agent reply, marks nothing. `seeded_at` is written on the first `summary.read`. `reviews.js` calls the store on every claim and heartbeat that carries a valid review token and `focused: true`, whether or not the window gets the rail. `src/layer/sync.js` adds two fields to its claim and heartbeat bodies: `focused` (the page's attention is focused, computed at send time) and `page` (the same page path the layer stamps on its records, from the same function). Nothing else in the layer changes.
**Files:** `src/service/seen_store.js`, `src/service/reviews.js` (claim and heartbeat handlers only), `src/layer/sync.js` (claim body only), `src/shared/protocol.js` (the claim's request description), tests.
**Acceptance:** V1, V3 to V7.
**Don't touch:** the rail, replay, anything in `src/layer/` but the claim body.

### Task 1.2: The one-review summary

**Spec:** The catalog reader exposes one review's summary on its own, and the Library's fold rule so the summary can count a folded document once, and the summary gains two things: open questions after the cutoff, and per-page newest agent reply times. Comment text still never leaves the reader. Titles lose control and Unicode format characters and are capped.
**Files:** `src/service/catalog_reader.js`, tests.
**Acceptance:** V2, V8, and the Library's own tests still pass unchanged.

### Task 1.3: The summary and its cache

**Spec:** `summary.js` builds the response from one-review summaries (cached per review on size, modified time and inode of `events.jsonl`, `review.json`, `meta.json` and the reviewed document, plus `catalog.json` once per request), folded with the Library's rule, plus the window holders, the seen marks, and session liveness. Fields exactly as `docs/CONTRACTS.md`. Wire the seen store and the summary in `src/service/index.js`.
**Files:** `src/service/summary.js`, `src/service/index.js`, the menubar fixtures, tests. A test compares nested key paths and value types with `test/fixtures/menubar/summary.json` in both directions.
**Acceptance:** V9 to V13, V17.

### Task 1.4: The routes

**Spec:** A new auth mode, `AUTH.CLI_PROOF`, exactly as the wire in `docs/CONTRACTS.md`: signed requests, a 30-second window on an injected clock, a nonce cache, constant-time comparison, and signed answers (errors included). It passes `test/fixtures/menubar/proof_vectors.json`. `summary.read` (GET) and `summary.open` (POST, JSON) use it, refuse any `Sec-Fetch-*` header, sit behind the Host check, are never catalog routes, and `summary.open` also refuses an `Origin` header. `summary.read` takes the app's `summary_version` and answers a mismatch with `409 SUMMARY_VERSION`. `summary.open` runs catalog Open with `handoff: false`.
**Files:** `src/shared/protocol.js`, `src/service/routes.js`, `src/service/auth.js`, tests.
**Acceptance:** V14 to V16, V19, V20, V34.

**Step test:** `npm run gate:unit` green, and V19's browser spec green alone. The orchestrator rebuilds `dist/` once and opens PR 1.
