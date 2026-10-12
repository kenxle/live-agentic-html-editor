### Workstream: library (Step 4)

**Outcome:** the Library lists stable addresses, Open binds instead of restarting a process, and the Library answers at `library.lahe.localhost`.

**Reads first:** the architecture's "The Library" section and Security notes; `docs/ongoing/LIBRARY.md`; `docs/diagrams/session_ownership.md` (hand-over from the Library); the exported functions of `sites.js` on the integration branch.

**Starts** when core Step 1 is merged into the integration branch. Lands inside PR 1 (Tasks 4.1 and 4.2, behind the switch) and PR 2 (Task 4.3 and the off branch removed), so Open is never broken on main.

**Task 4.1: Kinds and Open.** With the switch on, the kinds follow the architecture's table, and Open binds through `sites.js`. Open returns the stable address, and does not move a rail that a newer open review holds. With the switch off, Open restarts page servers, as today. Acceptance: V39 to V42, each with the switch on.

**Task 4.2: The Library's address and copy.** Catalog routes accept `library.lahe.localhost:<port>`, with today's checks. Rows link to stable addresses. Copy works without the clipboard API. Acceptance: V43, V44.

**Task 4.3: Docs, in PR 2.** `docs/ongoing/LIBRARY.md`, and the Library parts of the two diagrams. Remove the Library's off branch and the reopened-session sweep. Acceptance: V38 (Library part).
