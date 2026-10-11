### Workstream: library (Step 4)

**Outcome:** the Library lists stable addresses, Open binds instead of restarting a process, and the Library answers at `library.lahe.localhost`.

**Reads first:** the architecture's "The Library" section and Security notes, `docs/ongoing/LIBRARY.md`, `docs/diagrams/session_ownership.md` (hand-over from the Library), the `sites.js` interface as merged in Step 1.

**Authority:** the architecture. Depends on core Step 3 being merged.

**Task 4.1: Kinds and Open.** Redefine `openable`, `worktree`, `via-agent`, `legacy` per the architecture's table in `catalog_reader.js`. Open binds through `sites.js`, stamps the row's review as re-served unless a newer review in an open session holds the file, and returns the stable address. Remove the restart, the session reopen, the rollback, and the reopened-session sweep. Acceptance: V39 to V42.

**Task 4.2: The Library's own address and copy.** Catalog routes accept `library.lahe.localhost:<port>` with today's same-origin and token checks. Rows link to stable addresses. The Library page's copy works without the clipboard API. Acceptance: V43, V44.

**Task 4.3: Docs.** `docs/ongoing/LIBRARY.md` and the Library parts of `docs/diagrams/system_overview.md` and `session_ownership.md`. Acceptance: V38 (Library part).

**Step test:** the browser walk opens the Library at `library.lahe.localhost`, opens an old review and a worktree row, and lands on stable addresses.

**Don't touch:** `src/service/page_routes.js` and `sites.js` beyond calling their exported functions; install files.
