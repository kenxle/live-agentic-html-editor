# Workstream install: progress

## Summary

Tasks 5.1, 5.2 and 5.3 are built, green, and committed on `unit/sa-install`. `lahe install` writes a login item that starts the helper at login and restarts it if it stops. `lahe uninstall` removes it. Installed, the helper runs with `--always-on` and does not stop itself when quiet. The CLI asks the login item for a helper and never spawns one beside it. A stale helper is replaced at a quiet moment, even with a page open. Without `lahe install`, nothing changes for a clone.

- `npm run gate:unit`: 2557 tests, 2555 pass, 0 fail, 2 todo (both were already there).
- Browser spec [always_on_stale_replace.spec.js](../../../../test/browser/always_on_stale_replace.spec.js): 1 test, green in Chromium.
- Spikes: pass on macOS, Linux and Windows.
- Leak check (`ps -axo command | grep -c "[l]ahe.js serve"`): 2 before my first test, 2 after my last spec run. Both are Ken's own helpers from the main checkout. The count read 4 to 5 at moments in between because the core and library builders were running their suites; none of those processes named this worktree. Helpers from this worktree: 0 before, 0 after.
- `launchctl list | grep -c lahe`: 0 before the macOS spike, 0 after.

## Needs action

- The Linux and Windows spike ran (dispatch run 38172224261) and passed. The command, for a rerun:

  ```
  gh workflow run spike.yml -f ref=unit/sa-install -f command="node scripts/spike_login_item.js --ci" -f browsers=none
  ```
- **One line in `lahe status`, which is core's file** (V72, "status says to reinstall when the recorded Node is gone"). The check is built and tested: `loginItem.reinstallReason(loginItem.readInstall(dir))` returns the sentence, or null. It reads `install.json`, not `service.json`, because a helper whose Node is gone cannot run to write anything. Core's Task 3.2 prints it. I did not edit `status.js`.
- **Two small edits in core's files**, flagged for the merge:
  - `src/service/reviews.js` `writeReadyFile`: carries `always_on` and `install` into `service.json` (pass-through only).
  - `src/service/index.js` outside `/health`: `alwaysOn` passed to self-stop, the install facts passed to `writeReadyFile`, and one start-up log line. The `/health` fields are added in `handle()`, because the health handler's body lives in `routes.js`.

## Task 5.1: spikes

| System | Verdict |
|---|---|
| macOS (this Mac) | **Pass.** Install (bootstrap) to first answer: 0.3s. Killed with SIGKILL, launchd started it again in 10.3s. Stopped and asked to start (`launchctl kickstart`): 10.6s, because launchd waits 10 seconds between starts of one job. Uninstall (`bootout`) stopped the helper, and launchd no longer knew the label. |
| Linux | **Pass** (dispatch run 38172224261). Start 0.3s, restart after a kill 2.5s, start on request 0.3s, uninstall ok. |
| Windows | **Pass** (same run). Start 0.3s, restart after a kill 61.0s, start on request 0.3s, uninstall ok. The once-a-minute trigger did the restart, so restart-on-failure alone would not have held. |

What the hand runs on this Mac also showed:

- `launchctl kickstart` right after a stop starts the helper in 0.15s when the last start was over 10 seconds ago. Inside that window it waits out the 10 seconds. So the CLI waits up to 20 seconds for the login item.
- launchd makes the log file's folder when it is missing. A removed state folder does not stop the login item from starting.
- Not checked by script: whether the "Background Items Added" notice names `node`, and a real login after a reboot (V45). Both need Ken at this Mac.

The script is [spike_login_item.js](../../../../scripts/spike_login_item.js). It uses a unique label (`lahe-spike-<random>`), a temp state folder and a free port, and removes its login item in a `finally` block. With `--ci` on Linux it turns on lingering for the runner account, because a CI job has no login session and so no user systemd.

## What was built

- **The login item** ([login_item.js](../../../../src/service/login_item.js)). One file per system:
  - macOS: `~/Library/LaunchAgents/lahe-helper.plist`, `RunAtLoad` and `KeepAlive`, loaded with `launchctl bootstrap gui/<uid>`.
  - Linux: `~/.config/systemd/user/lahe-helper.service`, `Restart=always`, enabled with `systemctl --user enable --now`.
  - Windows: a Task Scheduler task imported from UTF-16 XML. It starts at logon, and a once-a-minute trigger starts it again if it stopped (a running task ignores it). `conhost.exe --headless` runs `node.exe` with no window.

  The item names the Node that ran the install, the clone's `bin/lahe.js`, the port and the resolved state folder. Each argument is quoted by its own format's rules. A Windows path with a quote character is refused. Commands run as argument arrays, never through a shell.
- **`install.json`** in the state folder: system, label, login item path, Node, clone, entry, port, state folder, and `lahe_names`, `resolver`, `port_80`, `forward_rule` (off for now).
- **`lahe install` and `lahe uninstall`** ([install.js](../../../../src/cli/commands/install.js)). Both refuse without a terminal (the message tells an agent to ask for `! lahe install`) and refuse as root. Install warns when more than one account is on the computer, and goes on. On Linux with no user systemd it says so and installs nothing. Installing again replaces the item. Install stops a helper the CLI started on demand, so the login item can take the port. If the login item does not bring the helper up, install takes everything back out and says so.
- **Always on** ([self_stop.js](../../../../src/service/self_stop.js), [serve.js](../../../../src/cli/commands/serve.js)). `lahe serve --always-on` turns off the stop-when-quiet rule. A removed state folder still stops it, and the login item starts it again into a fresh folder. `/health` reports `always_on` and `state_id`. `service.json` carries `always_on`, and `install` (system, label, login item) when a login item runs it. The helper log says once per start whether a login item runs it.
- **The CLI asks the login item** (`startHelper` in [session.js](../../../../src/cli/commands/session.js) and in [add.js](../../../../src/cli/commands/add.js)). With `install.json` for its port, it runs the item's start command and waits. It never spawns. If the helper does not come up, it says what the service manager said, whether the Node or clone is gone, and where the log is.
- **Stale replacement** (`staleDecision` in session.js, now used by `lahe add` too). Installed, staleness is judged by the clone the login item runs, not the CLI's own clone. An open window does not hold the helper back. It waits for a moment when no review's log has been written for 2 seconds, for at most 10 seconds. If that moment never comes, the helper is left and the caller is told; the next command tries again.
- **A different state folder** (V52). A CLI pointed at another state folder than the running helper's says so, naming its folder and `--state-dir` / `LAHE_STATE_DIR`, in `lahe session`, `lahe library` (through `startHelper`) and `lahe add`.
- **`lahe serve` by hand, when installed**, refuses and points to `--restart` and `lahe uninstall`. `lahe serve --restart` stops the helper and asks the login item to start it.
- `docs/CLI.md`: two rows for `install` and `uninstall`. A unit test requires every routed command to appear in the docs. The full install docs are Task 5.5.

## Rows and the tests that prove them

| Row | Test |
|---|---|
| V45 install macOS | macOS spike above (pass). Login after reboot: Ken, by hand |
| V46 install Linux | `scripts/spike_login_item.js --ci` in the dispatch workflow, run 38172224261: pass |
| V47 install Windows | same run: pass |
| V48 install hygiene | [install_command.test.js](../../../../test/unit/install_command.test.js): no terminal refused; root refused; more than one user warned; the plist carries the port and the state folder |
| V49 always-on | [always_on.test.js](../../../../test/unit/always_on.test.js): no self-stop when quiet with an injected clock; still stops when the state folder is removed; `--always-on` parsed; `/health` and `service.json` say so |
| V50 no double spawn | always_on.test.js: `startHelper` (session and add) asks the login item and spawns nothing; a failed login item spawns nothing and says why |
| V51 stale replace | [always_on_stale_replace.spec.js](../../../../test/browser/always_on_stale_replace.spec.js): with a page open, a clone keeps the stale helper; installed, it is replaced through the login item; the page's heartbeat is granted and a new comment lands in the new helper's log |
| V52 state folder | always_on.test.js: `lahe session` and `lahe add` against a helper with another state folder say so |
| V72 install details | [login_item.test.js](../../../../test/unit/login_item.test.js): paths with spaces quoted in the plist, the systemd unit and the Windows task; `reinstallReason` when the Node or the clone is gone. install_command.test.js: reinstall replaces the item; uninstall removes it and `install.json`. The status line itself is core's (see Needs action) |

The unit tests for V49, V50, V52, stale replacement and the serve-by-hand rules were each watched failing before the code that passes them. The install and login item tests failed first on the missing module.

## Deviations

- **`NumberOfFiles` is not raised in the plist.** The architecture's table says raised; the plan's Task 5.4 says raise it only if the idle measurement calls for it. I followed the plan.
- **Windows gets a once-a-minute trigger beside restart-on-failure.** Restart-on-failure may not fire for a process that was killed, and the trigger makes "restart if it stops" hold either way. The spike will show which one does the work.
- **The quiet moment is read from the review logs on disk** (no `events.jsonl` written for 2 seconds), not from the page's outbox, which the CLI cannot see. A comment sent during a restart is still delivered from the outbox when the page reconnects.
- **`lahe uninstall` has the same guards as install** (terminal, not root).
- **The login item's own output** goes to `<state folder>/login-item.log`.
- **Edits outside the four `startHelper` calls in add.js**: the state-folder check after the health probe, and the stale branch now calls the shared `staleDecision`.
- The label is `lahe-helper` on every system.

## Follow-ups

- Ken: reboot this Mac with the helper installed, and check the "Background Items Added" notice (V45).
- Windows: confirm by hand on a desktop that no console window opens at logon. CI cannot see windows.
- Task 5.4 (idle cost) and Task 5.5 (docs) come after the other work lands.
- When `lahe session reopen` leaves a busy stale helper, it prints "left running for an open review page" before the busy sentence. The wording is core's line in session.js; it reads slightly off for the busy case.

## Cleanup needed

- `scripts/spike_login_item.js`: remove at the feature's cleanup, with `.github/workflows/spike.yml`.
- `test-results/` in the worktree root, from the Playwright run (ignored by git).
- `.claude-commit202610111607-install` in the worktree root (ignored by git).
