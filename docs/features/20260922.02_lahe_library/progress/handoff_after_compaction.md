# Handoff: where the Library stands (2026-09-29, before a context compaction)

## State

- **Phase 8, Ship.** PR #19 is open (branch `feat/lahe_library`, worktree `.claude/worktrees/lahe-library`). Ken will not approve until he has seen the real UI.
- **Release run** on the branch with main merged at 32fe22b: 1886 unit, 1326 browser passed; 2 Firefox failures, both tests from main (board rows LAHE-oversized-image-firefox, LAHE-window-goodbye-firefox-flake).
- **Preview fixes merged** (task/lib-watch, ten items from Ken's preview comments plus one fix round). gate:all run 4: 1938 unit pass, 0 fail; browser 1335 passed, 2 failed, both Firefox: oversized_records (red on main too) and quiet_tab_polling:276 (passed 3 of 3 alone, boarded under LAHE-window-goodbye-firefox-flake). Pushed at 6528221. Preview helper on 7917 restarted on this code. Waiting on Ken's second look. **Open comment** itm_ef0e77b0aa8d6818d6e9b8e9: show each row's path from the project root, not shortened in the middle (task/lib-watch builder af8740467f0b16881 has the context). Session monitor is NOT armed; re-arm it first.
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
