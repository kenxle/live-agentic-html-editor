### Workstream: install (Step 5)

**Outcome:** `lahe install` makes the helper start at login and restart if it stops, on macOS, Linux, and Windows. Installed, the helper never stops itself, the CLI never spawns a second copy, and a stale helper is replaced at a quiet moment.

**Reads first:** the architecture's "Always-on lifetime" and "Login item per system" sections, Security notes (install hygiene), `scripts/install-cli.js`, `src/service/self_stop.js`, `startHelper` in `src/cli/commands/session.js` and its copy in `add.js`, `docs/INSTALL.md`.

**Authority:** the architecture. The spikes in Task 5.1 may change a mechanism; report before building on a changed one.

**Task 5.1: Spikes, one per system.** For macOS (`launchd` agent with `KeepAlive`, the Background Items notice), Linux (`systemd --user` unit), and Windows (Task Scheduler XML with restart on failure and a hidden window), prove install, start at login, restart after a kill, and uninstall on a throwaway state folder and port. macOS is run on this Mac. Linux and Windows run in CI jobs that never fail the run (`continue-on-error`, verdict in the log), per CLAUDE.md's CI rule. Acceptance: a written verdict per system in `progress/phase6_workstream_install.md`.

**Task 5.2: `lahe install` and `lahe uninstall`.** `src/cli/commands/install.js`, `src/service/login_item.js`, `install.json` with the resolved state folder and port, the login item passing `--always-on --port --state-dir`. Refuses without a terminal and when run as root. Warns on a computer with more than one interactive user. Registered in `src/cli/index.js`. Acceptance: V45 to V48.

**Task 5.3: Always-on behavior.** `--always-on` turns self-stop rule 1 off and keeps rule 2. `/health` reports a state-folder id. When `install.json` exists, both `startHelper` copies ask the login item instead of spawning, and compare source stamps against the clone the login item names. A stale helper is replaced at a quiet outbox moment with windows open. Acceptance: V49 to V52.

**Task 5.4: Idle cost (brief requirement 11, light when idle).** Before building, write the two limits in `progress/phase6_workstream_install.md`: memory and wakeups per minute with nothing open, and with Ken's usual tab count (read from his browser) overnight. Measure today's helper plus page servers, then the always-on helper, with the existing `scripts/measure_idle_requests.js` style. Raise `NumberOfFiles` in the plist only if the measurement calls for it. Acceptance: V53.

**Task 5.5: Docs.** `docs/INSTALL.md`, `README.md`, `docs/CLI.md` (install, uninstall), and the always-on lines in `SESSION_OWNERSHIP.md`. Acceptance: V38 (install part).

**Don't touch:** `page_routes.js`, `sites.js`, catalog files. `session.js` only in `startHelper`; core owns session close.
