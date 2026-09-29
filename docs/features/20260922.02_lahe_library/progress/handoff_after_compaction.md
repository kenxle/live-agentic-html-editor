# Handoff: where the Library stands (2026-09-29, before a context compaction)

## State

- **Phase 8, Ship.** PR #19 is open (branch `feat/lahe_library`, worktree `.claude/worktrees/lahe-library`). Ken will not approve until he has seen the real UI.
- **Release run** on the branch with main merged at 32fe22b: 1886 unit, 1326 browser passed; 2 Firefox failures, both tests from main (board rows LAHE-oversized-image-firefox, LAHE-window-goodbye-firefox-flake).
- **In flight:** an agent on `task/lib-watch` (worktree `.claude/worktrees/lib-watch`) makes the "watching" label honest: listening (monitor live), working (lahe command in the last 2 minutes), or last active at a time; the confirm step only for listening or working. Ken approved it. It also got two items from Ken's preview review: split the lumped "Reviews from before sessions" card into one card per project, stop labelling files under a `.claude/` folder as project ".claude", and date each document by its newest real event instead of the log file's modified time (main's log compaction rewrote many logs today, so old documents read "today"). Ken also rejected fresh reviews for pre-session documents: a pickup adopts the ownerless legacy review with its old comments; and a group-wide note goes once on the card, never on every row. Rename a document from its row (new route `catalog.rename`, stored in catalog.json, original name shown small underneath, search covers both). Collapse long page lists and big cards. Session card headers on a solid blue background. Row layout: name alone on line one, the real file path (no added spaces) on line two in a smaller mono style, wider text column. Merging it is a code change, so the full suite runs again after.
- **Unpushed commits** on `feat/lahe_library`: progress-page edits only (held to avoid extra CI runs). Push with the next batch.
- **LAHE session** `s_5939bc103a1e623e` ("lahe file index"), taken back with Ken's OK. Monitor armed.

## Preview Ken is reviewing

- **Working page with the editor:** http://127.0.0.1:7918/catalog. A relay (`~/Documents/lahe-library-wireframes/_build/preview_relay.js`, started with nohup) serves the preview helper's page and injects the rail for review `r7eaaa61ef0e6` in session `s_5939bc103a1e623e`, so his comments arrive in the normal drain. It strips the page's content policy; preview only.
- **Preview helper:** the feature branch's code, `node bin/lahe.js serve --port 7917 --state-dir <scratchpad>/lahe-preview`, started with nohup. The state dir is a COPY of `~/.local/state/lahe` with every `ss_*.json` pid removed and marked stopped, and every `monitor.json` blanked, so the new idle-server and reopen sweeps cannot touch Ken's real page servers or agents.
- **Preview agent session** in the copy: `s_88e913262bb2bf5c` ("Library preview"); its monitor runs with `--state-dir` pointing at the copy. Pick this up and Launch in the preview arrive there.
- **Dead-button snapshot** at http://127.0.0.1:55501/index.html: superseded by the relay; Ken found it useless.

## After Ken's feedback

1. Merge `task/lib-watch` and any fixes from his comments, rebuild dist, run `npm run gate:all` once, read the counts, then push.
2. Merge PR #19 only after his approval and a green PR check.
3. Then: pull main into the main checkout (another agent's unpushed commits may still be there; do not touch them), `npm run install-skills`, and `lahe serve --restart` only when Ken says.
4. Phase 9: `lesson`, then `forge-cleanup`. Cleanup list: builder worktrees `lib-*`, `main-check`, `agent-a9501c5f25e13e72e`, `linked-docs-rail`; the preview processes on 7917 and 7918; the `node_modules` symlinks in worktrees.
