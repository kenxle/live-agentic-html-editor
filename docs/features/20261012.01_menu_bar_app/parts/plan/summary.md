## Step 1: The summary (workstream summary, PR 1)

::: xref
Architecture: "Data / State Changes" (`seen.json`, what counts as waiting on you, the `summary.read` response, the `summary.open` request), "Key Flows" (the first two), "Failure Modes", "Security & Privacy Notes".
:::

### Task 1.1: Seen marks

**Spec:** `seen_store.js` owns `seen.json`: `seeded_at` on first run, per-review per-page marks, writes only when a write would change a count, a fresh file on loss. `reviews.js` calls it on every claim and heartbeat that carries a valid review token and `quiet: false`, whether or not the window gets the rail. `src/layer/sync.js` adds the page's path as `page` to its claim and heartbeat bodies; nothing else in the layer changes.
**Files:** `src/service/seen_store.js`, `src/service/reviews.js` (claim and heartbeat handlers only), `src/layer/sync.js` (claim body only), `src/shared/protocol.js` (the claim's request description), tests.
**Acceptance:** V1, V3 to V7.
**Don't touch:** the rail, replay, anything in `src/layer/` but the claim body.

### Task 1.2: The one-review summary

**Spec:** The catalog reader exposes one review's summary on its own, and the summary gains two things: open questions after the cutoff, and per-page newest agent reply times. Comment text still never leaves the reader.
**Files:** `src/service/catalog_reader.js`, tests.
**Acceptance:** V2, V8, and the Library's own tests still pass unchanged.

### Task 1.3: The summary and its cache

**Spec:** `summary.js` builds the response from one-review summaries (cached per review on the stat of `events.jsonl`, `review.json` and `meta.json`), the window holders, the seen marks, and session liveness. Caps and names as in the architecture.
**Files:** `src/service/summary.js`, tests. Its output keys match `test/fixtures/menubar/summary.json`.
**Acceptance:** V9 to V13, V17.

### Task 1.4: The routes

**Spec:** `summary.read` (GET) and `summary.open` (POST) in `protocol.js` and `routes.js`, both `AUTH.CLI_SECRET`, both refusing any `Origin` header, both behind the Host check. `summary.read` takes the app's `summary_version` and answers a mismatch with `409 SUMMARY_VERSION`. `summary.open` runs catalog Open with `handoff: false`.
**Files:** `src/shared/protocol.js`, `src/service/routes.js`, tests.
**Acceptance:** V14 to V16, V19, V20.

**Step test:** `npm run gate:unit` green, and V19's browser spec green alone. The orchestrator rebuilds `dist/` once and opens PR 1.
