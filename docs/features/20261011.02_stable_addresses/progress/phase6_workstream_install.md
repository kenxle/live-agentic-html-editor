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

# Workstream lahe-names: progress

## Summary

Tasks 6.0, 6.1 and 6.2 are built, green, and committed on `unit/sa-install`. On macOS, `lahe install --port-80` sets up a loopback forward from port 80 to 1483, and `lahe install --lahe-names` sends `.lahe` lookups to the helper's own name server. Each is one `sudo` call. The helper uses neither until it has proved it works, at start and every five minutes. `lahe uninstall` removes only files that carry Lahe's marker.

What a person sees depends on four small changes in core's and the library's files, listed under Needs action. Until they land, the helper proves both options and records the result, but `lahe review` still prints `:1483` and `.lahe` Hosts are still refused. That is the safe side of both rules.

- `npm run gate:unit`: 2651 tests, 2649 pass, 0 fail, 2 todo (both were already there). One more test was added after that run (the `--port-80` rerun case); its file passes 19 of 19.
- Leak check: `lahe.js serve` 2 before, 2 after (both Ken's own). Helpers from this worktree: 0 before, 0 after. `launchctl list | grep -c lahe`: 0 before, 0 after.
- No test or check ran `sudo`, wrote `/etc/resolver`, loaded a pf rule, or touched Ken's helper or state folder. `pfctl -n` (parse only, no root) accepts the forward rules on this Mac.

## Needs action

**Changes in other workstreams' files.** I did not make these:

1. **`protocol.classifyHost` (core).** Accept `<name>.lahe` and `<name>.lahe:<pages port>` as a page Host only when `options.laheNames === true`. Never accept `library.lahe`. `index.js` already passes `laheNames: addresses.laheNamesVerified()` in that call, so this is the only change needed for V57's "answered once proved" half.
2. **`protocol.siteNameFromOrigin` (core).** Take a third argument, `{laheNames}`:
   - Always accept `http://<name>.lahe.localhost` with no port. That is the port-free origin, and a `.localhost` name cannot be rebound.
   - Accept `http://<name>.lahe` and `http://<name>.lahe:<pages port>` only when `laheNames` is true. Without that gate, a website that answers its own `x.lahe` could pass the Origin check.

   The callers are `siteOriginAllowed` and `siteOriginKnown` in `index.js`, and `fileForPage` in `page_routes.js`. They pass `deps.laheNamesVerified()`.
3. **`routes.js` `site.bind` (core).** Build the printed `origin` and `url` with `deps.printedPort()` instead of `deps.pagesPort()`. `printedPort()` is 80 once the forward is proved, otherwise the pages port. `addresses.printedOrigin(name, pagesPort, report)` is the same rule as a pure function. This is what makes V76 visible in `lahe review`.
4. **`library.js` line 179 (library).** Print the Library address with `pages.printed_port` from `service.json` instead of `pages.port`.

`lahe status` (core's Task 3.2) can print `pages.port_free` and `pages.lahe_names` from `service.json`. Each carries `on`, `verified`, and a `reason`, for example "port 80 is held by httpd (pid 412)", or "another program answers .lahe lookups on this computer, not Lahe's name server".

## What was built

- **The name server** ([name_server.js](../../../../src/service/name_server.js)).
  - A name under `.lahe` gets an authoritative `A 127.0.0.1` or `AAAA ::1`. Any other record type for such a name gets no error and no answer.
  - Everything else gets `REFUSED`, the bare `lahe` and other record classes included.
  - A packet that is not one well-formed standard query gets no reply at all.
  - It listens on UDP `127.0.0.1` only, and reports each name it is asked.
- **The proofs** ([addresses.js](../../../../src/service/addresses.js)).
  - **The forward:** the helper sends itself a request with a fresh random path through port 80, and counts it only when that request arrives on its own pages listener.
  - **`.lahe`:** the helper asks the system resolver for a fresh random `check-<hex>.lahe`, and counts it only when its own name server saw that exact name.
  - **Results:** `service.json` `pages.port_free`, `pages.lahe_names` and the new `pages.printed_port`, rewritten whenever a proof changes, plus one helper log line per change.
  - **In the helper:** `index.js` starts the proofs once the pages listener is bound, and starts the name server only when `install.json` records the resolver. `deps.printedPort` and `deps.laheNamesVerified` are there for core's routes.
- **The admin steps** ([login_item.js](../../../../src/service/login_item.js), [install.js](../../../../src/cli/commands/install.js)).
  - `--lahe-names` writes `/etc/resolver/lahe`: the marker, `nameserver 127.0.0.1`, `port 7853`.
  - `--port-80` writes the pf anchor `/etc/pf.anchors/lahe`, which forwards loopback port 80 to 1483 for `127.0.0.1` and `::1`. It also writes a boot item, `/Library/LaunchDaemons/lahe-port80.plist`, that turns pf on and loads the anchor at every start. macOS's own `/etc/pf.conf` already has `rdr-anchor "com.apple/*"`, so no system file is edited.
  - Install writes the files as the user into a fresh private temp folder. The root step is one `sudo /bin/sh -c <constant script> lahe <folder>`. Nothing is spliced into the script.
  - Both the install and the removal scripts leave alone a file without the marker.
  - `--port-80` is skipped, naming the holder, when something already listens on port 80.
  - The options are macOS only. Elsewhere, install points to `docs/INSTALL.md` and changes nothing.
  - A refused `sudo` leaves the option off and says so; the login item still installs.
  - A later plain `lahe install` keeps whatever is already set up, with no new `sudo` call.
- **The Library at its port-free address** ([auth.js](../../../../src/service/auth.js) `catalogHostAllowed`): `library.lahe.localhost` with no port, as the forward delivers it. `library.lahe` stays refused.

## Rows and the tests that prove them

| Row | Test |
|---|---|
| V54 name server | [name_server.test.js](../../../../test/unit/name_server.test.js): loopback A and AAAA under `.lahe`, case-insensitive; other names, the bare ending and other classes refused; ten kinds of malformed packet get no reply; a real UDP server survives garbage |
| V55 name server start | [addresses.test.js](../../../../test/unit/addresses.test.js): no resolver recorded, no server; recorded, it answers on the recorded port, also inside a real helper |
| V56 resolver write | [login_item.test.js](../../../../test/unit/login_item.test.js): fixed text, marker, integer port only. [install_command.test.js](../../../../test/unit/install_command.test.js): one `sudo` call, the script is the constant, the file handed over is exactly that text |
| V57 verification | addresses.test.js: off until the stand-in resolver's query reaches our name server; each proof asks a fresh name; a query for another name does not count; `service.json` says so in a real helper |
| V58 squatter | addresses.test.js: an answer that never reached our name server fails, with the reason; a name server port another program holds turns `.lahe` off, with the reason |
| V59 uninstall | install_command.test.js: only the marked resolver is removed, and the output says `.lahe.localhost` keeps working. login_item.test.js: the removal script deletes only a marked file |
| V74 port forward | login_item.test.js: fixed text with the marker, only loopback port 80, the boot item; install_command.test.js: one `sudo` call, skipped and the holder named when port 80 is held, rerunning is not mistaken for a holder, and uninstall leaves an unmarked rule alone |
| V76 port-free check | addresses.test.js: the pages port until the request arrives through the stand-in forward, 80 once it does, and the pages port again once it is gone; another server on port 80 is not the forward; `service.json` `printed_port` follows it in a real helper |
| V73, V75 | Ken, by hand on this Mac: steps below |

Every test above was watched failing first, either before the module existed or with the wiring stashed. Two mutations were also run against `addresses.js`: trusting the resolver's answer, and treating the forward as always working. Each made 4 tests fail.

## Manual checks for Ken (V73, V75)

V75 and the browser half of V73 need core changes 1 to 3 merged first. Run these in your own terminal, in the clone that `lahe install` points at.

**V75, port-free addresses**

1. `lsof -nP -iTCP:80 -sTCP:LISTEN`. If anything is listed, `lahe install --port-80` should print "port-free addresses skipped: port 80 is held by ...", and it stops there.
2. `lahe install --port-80`, then type your password once. It should print "port 80 forwards to 1483 on this computer, reloaded at boot."
3. `sudo pfctl -a com.apple/lahe -s nat` should show two `rdr` lines, port 80 to 1483 for `127.0.0.1` and for `::1`.
4. `grep -A4 port_free ~/.local/state/lahe/service.json` should show `"verified": true`, and `printed_port` should be `80`.
5. `lahe review <some file>.md` should print `http://<name>.lahe.localhost/<file>` with no port. That address loads in Chrome, Firefox and Safari, and the same address with `:1483` loads too.
6. Restart the Mac and log in. Repeat steps 3 and 5. Both should still work with no command run.
7. `lahe uninstall`. Step 3 should show nothing, and `ls /etc/pf.anchors/lahe /Library/LaunchDaemons/lahe-port80.plist` should report no such file. After `lahe review`, the `:1483` address loads.

**V73, `.lahe` names**

1. `lahe install --lahe-names`, then type your password once.
2. `cat /etc/resolver/lahe` should show the `# lahe-managed` line, `nameserver 127.0.0.1` and `port 7853`. `scutil --dns | grep -B1 -A4 'domain   : lahe'` should list it.
3. `dscacheutil -q host -a name anything.lahe` should answer `127.0.0.1`.
4. `grep -A4 lahe_names ~/.local/state/lahe/service.json` should show `"verified": true`.
5. Open `http://<name>.lahe:1483/<file>` in Chrome, Firefox and Safari. It should load with the rail. A browser with secure DNS turned on may not ask the system and so fail; that is a known limit, and `.lahe.localhost` still works there.
6. Name server stopped:
   - Run `nc -u -l 127.0.0.1 7853` in another terminal, then `lahe serve --restart`.
   - `service.json` should show `lahe_names.verified: false` with "the name server could not answer on port 7853". A `.lahe` address should now be refused.
   - Stop `nc`, then `lahe serve --restart` again. `.lahe` should be verified again.
7. `lahe uninstall`. `ls /etc/resolver/lahe` should report no such file, and `.lahe.localhost` addresses still load after `lahe review`.

## Deviations

- **New file `src/service/addresses.js`.** The proofs and the printed-port rule are neither the name server nor the login item, so they have their own file. It is in the manifest.
- **The forward boot item runs `pfctl -E`**, which turns pf on and is not undone at uninstall. That leaves Apple's own rules running as they would with any pf user. No Lahe rule is left behind.
- **Only the IPv4 path through the forward is proved.** The `::1` rule is installed, but not checked separately.
- **Edits in `index.js` outside `/health`:** the proofs started after the pages listener binds, `pagesReport` reads them, `readyDetails()` so a changed proof rewrites `service.json`, `laheNames` passed to `classifyHost`, two `deps` functions, and `addresses()` on the helper handle for tests.
- **Linux and Windows written steps** in `docs/INSTALL.md` are not written yet. They belong with Task 5.5 (docs), after the core changes land.

## Cleanup needed (lahe-names)

- Nothing new in the repo. The scratch files from the hand checks are under `/tmp` and stay there.
