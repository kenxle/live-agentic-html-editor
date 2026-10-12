### Workstream: install (Step 5)

**Outcome:** `lahe install` makes the helper start at login and restart if it stops, on macOS, Linux, and Windows. Installed, the helper does not stop itself, the CLI does not spawn a second copy, and a stale helper is replaced at a quiet moment.

**Reads first:** the architecture's "Always-on lifetime" and "Login item per system" sections and the install lines of Security notes; `scripts/install-cli.js`; `src/service/self_stop.js`; `startHelper` in `src/cli/commands/session.js` and the four calls to it in `add.js`; `docs/INSTALL.md`.

**Starts** when core Step 1 is merged into the integration branch. Lands as PR 3, after PR 2.

**Task 5.1: Spikes, one per system.**
- macOS, on this Mac: install, start, kill, restart, and uninstall, on a throwaway state folder and port. The spike's login item gets a unique label and is removed in the spike's own teardown. A login item that keeps restarting is stopped by `launchctl bootout` before the spike ends.
- Linux and Windows: the same steps, through the dispatch workflow from Task 0.1.

CI cannot log in, so "starts at login" is proven by the service manager's start command, plus Ken's reboot on this Mac (V45). A written verdict per system goes in `progress/phase6_workstream_install.md`.

**Task 5.2: `lahe install` and `lahe uninstall`.** `src/cli/commands/install.js`, `src/service/login_item.js`, and `install.json`, registered in `src/cli/index.js`. Acceptance: V45 to V48, V72.

**Task 5.3: Always-on behavior.** `--always-on` in `serve.js`, the state-folder id in `/health`, and `startHelper` asking the login item instead of spawning. A stale helper is replaced at a quiet moment. Install writes its state into `service.json` for core's status lines to print. Acceptance: V49 to V52.

**Task 5.4: Idle cost (brief requirement 11, light when idle).** The orchestrator measures the baseline before PR 2 lands: memory and wakeups per minute for today's helper plus page servers, with nothing open and with Ken's usual tab count overnight. This task writes the two limits first, then measures the always-on helper after PR 2 and PR 3 are on the integration branch. Raise `NumberOfFiles` in the plist only if the measurement calls for it. Acceptance: V53.

**Task 5.5: Docs.** `docs/INSTALL.md`, including the hand steps for `.lahe` and a port-free address on macOS, Linux, and Windows from the architecture's written-steps table, each confirmed in the Task 5.1 spikes, `README.md`, the install section of `docs/CLI.md`, and the always-on lines of `SESSION_OWNERSHIP.md`. Acceptance: V38 (install part).
