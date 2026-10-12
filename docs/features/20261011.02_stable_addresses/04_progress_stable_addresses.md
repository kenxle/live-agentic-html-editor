# Progress: Stable addresses

**Phase 7, Verify.** Every workstream and both review fix rounds are merged on `feat/stable-addresses`. The disk is cleared and the unit suite passes on the branch. In progress: the core builder is bringing old comments over to new addresses, and is writing a design note so every page carries its own comments. After that: the full test suite in all three browsers, the idle measurement on a preview of your real documents, and a browser walkthrough. Last updated 2026-10-11 20:24.

**Docs:** [Decisions page](../../ongoing/STABLE_ADDRESSES.md) · [Crucible](00_crucible_stable_addresses.html) · [Brief](01_brief_stable_addresses.html) · [Architecture](02_architecture_stable_addresses.html) · [Plan](03_plan_stable_addresses.html) · [Code survey](parts/architecture/recon.md)

## Needs your attention

- [ ] **Approve or reverse four changes from what the docs said.** Building turned up these. Each has my recommendation; say "all fine", or name the ones to change.
  - **A tab stays connected when a newer review takes over its page.** The helper accepts a page's requests from any review that could answer on that site, not only the newest, so a tab opened earlier keeps working. A page from another site is still refused. *Recommend: accept.*
  - **One click from a "no document by that name" page opens the Library.** The Library page now accepts a link from a `.lahe.localhost` page. The security review checked it: the linking page cannot read the Library, frame it, or press its buttons. *Recommend: accept.*
  - **Links into hidden folders no longer open.** A Markdown link to a file inside a hidden folder in your home folder (for example `~/.config/notes/x.md`) now shows as plain text. Before, Lahe would serve that whole hidden folder, which is how a document could reach `~/.ssh`. *Recommend: accept.*
  - **One pull request instead of five.** The plan split the work into five PRs with an on/off switch between them. The switch is already removed, so splitting now would mean rebuilding it just to tear it down. *Recommend: one PR, with the commits grouped by step.*
- [ ] **Approve retiring old tests.** 11 test files test behavior this feature removes: page servers that stop when idle, restarting page servers, remembering old ports, and the sweep that closes reopened sessions. 2 files go whole and 9 in part. 26 more get rewritten for the new behavior. Until you approve, the retired tests are moved to `test/retired/` (not deleted) so the suite stays green; they are deleted in one batch at cleanup only with your OK. Lists: "Task 3.0: test retirement list" and the Step 3 moved-test list in the [core progress](progress/phase6_workstream_core.md), and the "Task 4.3" section of the [library progress](progress/phase6_workstream_library.md) (18 Library tests).
- [ ] **Three checks only you can do on this Mac**, once the PR is ready: restart the Mac and see the helper come back on its own (V45, starts at login); open a page with no port in its address (V75, after `lahe install --port-80`); open a `.lahe` page (V73, after `lahe install --lahe-names`). Both install steps ask for your admin password. Steps: [install progress](progress/phase6_workstream_install.md).

## Decided

- **Every page carries its own comments.** You rejected "a linked document opens with the linking page's rail". Whatever page you are on, the rail shows that page's comments, whichever page you came from. This changes which review answers on a page, so the core builder is writing a design note first. It comes to this page for your OK before it is built.
- **Old comments at the new address:** you chose A. When a page opens at its new address, the rail fetches that page's earlier comments from the helper and shows them as cards. Old Markdown pages get a path alias too. The core builder is building it now.
- **Windows does not get `.lahe`:** accepted. Every system uses `.lahe.localhost`.
- **Disk:** the old test folders are deleted (details below).

## Why the progress page kept going dead

It was not a crash. The helper on main stopped this page's server three times in ten minutes (00:03, 00:05 and 00:12 UTC in `~/.local/state/lahe/helper.log`), each time logging "no browser window open on its pages for 120 seconds" while your tab was open and visible. Each time the page polled again, the helper restarted the server, and about two minutes later it stopped it again. When my edit made the page reload while the server was stopped, you saw ERR_CONNECTION_REFUSED. It happens to every session: in that same 16 minutes the log has 72 page-server stops and 74 restarts. This is the churn the idle baseline measured (51 page-server processes started in 5 minutes). This feature removes page servers and their idle stop, so the bug goes away rather than getting a fix on main.

## Disk space, cleared

The Lahe test folders were deleted at your go-ahead, and the disk went from 953 MB free to 43 GB free. One unit run, measured after the cleanup, left 618 MB behind. Most of it (465 MB) is the Library test fixture, which writes a 5 MB event log on each of its 74 setups. The wrapper that runs the tests also never removes its own folder. Both are on the board as LAHE-test-runs-fill-disk, outside this feature. The same run passed: 2,639 unit tests, 0 failed, no helpers left running.

## Currently working on

| Agent or task | Doing | Started | Branch |
|---|---|---|---|
| Core builder | Old comments at the new address (A), then the design note for every page carrying its own comments | 2026-10-11 | `unit/sa-core` |
| Orchestrator | Waiting on the core builder, then dist rebuild and the full gate | 2026-10-11 20:24 | `feat/stable-addresses` |

## Phases

| Phase | Status | Changed |
|---|---|---|
| 0 Setup | done | 2026-10-11 |
| 1 Crucible | done | 2026-10-11 |
| 2 Brief | done | 2026-10-11 |
| 3 Architecture | done | 2026-10-11 |
| 4 Plan | done | 2026-10-11 |
| 5 Human review | done | 2026-10-11 |
| 6 Implement | in progress | 2026-10-11 |
| 7 Verify | in progress | 2026-10-11 |
| 8 Ship and land | not started | 2026-10-11 |
| 9 Cleanup | not started | 2026-10-11 |

## The record

### Task index

| Workstream | Tasks | Result | Detail |
|---|---|---|---|
| library | 4.3 | Merged. The Library's old path, the reopened-session sweep, and their store fields are gone; `lahe library` prints the proved port; `LIBRARY.md`, both diagrams, and the Library part of `CONTRACTS.md` updated. The 54 failing tests are rewritten or moved to `test/retired/` (18 tests). | [library progress](progress/phase6_workstream_library.md) |
| core | Step 3 (3.1 to 3.3) | Merged. Sites are the default; per-session page servers, the idle sweep, port history, origin swaps, and the `SIGHUP` reload are gone. `lahe status` shows the port, ending, install state, and both options. Skill, contract, CLI, serving docs, and four diagrams updated. Rows V33 to V38, V63, V67, V71 pass. 54 Library tests still test removed behavior; the library builder is on them. | [core progress](progress/phase6_workstream_core.md) |
| install | 5.5 docs | Merged. `docs/INSTALL.md` (install, uninstall, both options, written Linux and Windows steps marked untested), README, CLI install rows, one always-on line in `SESSION_OWNERSHIP.md`, and your [manual checks](progress/phase6_workstream_install.md). Found a core defect (session close stops an always-on helper), sent to the core builder. Unit gate 2,654 tests, 0 failed. | [install progress](progress/phase6_workstream_install.md) |
| lahe-names | 6.0 to 6.2 | Merged. `lahe install --port-80` and `--lahe-names` (macOS), the name server, and both self-checks. Rows V54 to V56, V58, V59, V74 pass; V57 and V76 wait on three core changes (sent to the core builder) that make them visible; V73 and V75 are your manual checks. No test ran `sudo` or touched system files. Unit gate 2,652 tests, 0 failed. | [install progress](progress/phase6_workstream_install.md) |
| install | 5.1 to 5.3 | Merged. Rows V45 to V52 and V72 pass, except two parts: V45's real login after a reboot needs you at this Mac, and V72's status line is core's (sent to it). macOS spike: install, restart after a kill (launchd waits 10 seconds), start on request, and uninstall all work; no login item left behind. Unit gate 2,618 tests, 0 failed. | [install progress](progress/phase6_workstream_install.md) |
| library | 4.1, 4.2 | Merged. Rows V39 to V44 pass. Unit gate 2,578 tests, 0 failed. Browser spec 5 of 5 across three browsers; the three new specs pass together on the merged branch (14 passed). Screenshots: [light](progress/screenshots/library_stable_addresses_light.png), [dark](progress/screenshots/library_stable_addresses_dark.png). | [library progress](progress/phase6_workstream_library.md) |
| core | Step 2 (2.1, 2.2) | Merged. Rows V26 to V30, V32, V70 pass. V31 (old comments in the rail) is half done and waits on your decision. Unit gate 2,540 tests, 0 failed. Browser spec 9 of 9 across three browsers. Also fixed an existing rail bug in `sync.js` (the "no agent" line could stay stale). | [core progress](progress/phase6_workstream_core.md) |
| core | Step 1 (1.0 to 1.4) | Merged into `feat/stable-addresses`. Rows V1 to V25, V65, V66, V68, V69 pass. Unit gate 2,517 tests, 0 failed. Browser spec 18 of 18 across three browsers. | [core progress](progress/phase6_workstream_core.md) |

### Passes

| Pass | What merged | Checks on the merge |
|---|---|---|
| 9 | library 4.3 | `npm run gate:unit`: 2,575 tests, 1 failed (an install test that fails only under load; passes alone; assigned). Helpers before and after: 2 and 2 |
| 8 | install leak fix | Tests now stop every helper they start, even one still starting at teardown |
| 7 | core Step 3 | `npm run gate:unit`: 2,590 tests, 54 failed (all Library tests of removed behavior, assigned). One leaked always-on test helper from `install_command.test.js` found and stopped by pid; fix assigned |
| 6 | install 5.5 docs | `npm run gate:unit`: 2,654 tests, 0 failed |
| 5 | lahe-names 6.0 to 6.2 | `npm run gate:unit`: 2,652 tests, 0 failed; helpers before and after: 2 and 2 |
| 4 | install 5.1 to 5.3 | `npm run gate:unit`: 2,618 tests, 0 failed; three new browser specs in Chromium: 12 passed, 1 skipped (screenshot-only); helpers before and after: 2 and 2 |
| 3 | library 4.1, 4.2 | `npm run gate:unit`: 2,578 tests, 0 failed; the three new browser specs in Chromium: 14 passed, 1 skipped (screenshot-only); helpers before and after: 2 and 2 |
| 2 | core Step 2 | `npm run gate:unit`: 2,540 tests, 0 failed; helpers before and after: 2 and 2 |
| 1 | core Step 1 | `npm run gate:unit` on the merged branch: 2,517 tests, 0 failed; helpers running before and after: 2 and 2 |

### Changes from plan

From core Step 3:

- A linked document opens on the hub page's address with the hub's rail, even when it has its own review, because there are no redirects between sites.
- The helper-down tests of `serve_time_inject` are retired, not rewritten: with no page server, nothing serves a page while the helper is down.
- The contract gains one sentence about the stable address.

From install 5.5:

- Port-free on Linux uses an `iptables` redirect, and on Windows a `netsh portproxy` forward, rather than the helper listening on port 80 itself.
- `.lahe` is not offered on Windows: Windows sends a name ending only to a name server on port 53, and Lahe's listens on 7853.
- On Linux and Windows, `--port-80` and `--lahe-names` record the option as a hand step and the helper checks it, so the written steps take effect.

From install 5.1 to 5.3 (details in the [install progress](progress/phase6_workstream_install.md)):

- The plist's open-file limit is not raised yet; Task 5.4's measurement decides.
- On Windows the scheduled task also starts once a minute, because restart-on-failure may not fire for a killed process.
- A "quiet moment" for replacing a stale helper is 2 seconds with no review log written, waiting at most 10 seconds; if it never goes quiet, the old helper is left running and the command says so.
- When installed, a hand-run `lahe serve` refuses, and `lahe serve --restart` restarts through the login item.
- The install builder made small edits in core files (`reviews.js`, `index.js`, `add.js`) where the architecture placed things the code keeps elsewhere.

From library 4.1 and 4.2 (details in the [library progress](progress/phase6_workstream_library.md)):

- Open binds a site only for a root that something a page cannot write has already served: a registered site, an old page server's record, or the Markdown copy the CLI wrote. A review's own recorded paths are page-writable, so they are never used to bind. Other rows stay "ask an agent".
- The Library answers at `library.lahe.localhost` on the pages port only.
- The shared copy function is `src/layer/copy_text.js`, served raw to the Library page.

From core Step 1 (details in the [core progress](progress/phase6_workstream_core.md)):

- `add --served-by-helper` registers the origin `"null"` for the review, because the CLI's own requests carry no Origin. To be checked in the Phase 7 security review.
- With the switch off, no pages listener opens unless a pages port is named, so the off path stays unchanged and parallel tests do not fight over 1483.
- The Origin check accepts any review that could answer on the site, not only the one that wins the page now, so a tab opened before a newer review keeps working. Another site's origin is still refused.
- A clash number goes on the last label (`two.repo.docs.ongoing-2`); a notes page is named for its folder.

### Follow-ups

- Two small leftovers for the fix round: `CATALOG.REOPENED_AUTOCLOSE_MS` in `protocol.js` is no longer read, and `launchRoot` in `status.js` still checks a field that no longer exists.
- Since Step 3 a helper defaults to pages port 1483. `npm run gate:unit` sets `LAHE_PAGES_PORT=0`; a single test file run with plain `node --test` needs it too.
- The `::1` half of the port-80 forward is installed but not checked separately; only the IPv4 path is verified.
- Turning pf on at boot (`pfctl -E`) is not undone by uninstall. Apple's own rules keep running as for any pf user; no Lahe rule is left behind.
- Existing bug found by the core builder: when something holds the helper's port and drops every connection, `lahe review` exits 0 and prints nothing.
- Two browser tests flaked on CI for PR #41 with unchanged code: `install_walk_3b.spec.js` AC6 and `graceful_failure.spec.js` S7.
- Mac menu-bar companion app with a Library link (settled as its own follow-up).
- HTTPS for `.lahe`, so a `.lahe` page counts as secure and `.lahe` could be printed. Lahe would make its own certificate, limited to `.lahe` names, and the computer would trust it once.
- Test leak: 60 page servers left running from the idle-server tests (state folders named `lahe-idle-state-*`), found 2026-10-11.

### Cleanup queue

- `../lahe-worktrees/sa-spike` worktree, local branch `spike/localhost-names`, and the same branch on GitHub: the browser check is done.
- `../lahe-worktrees/sa-ci-dispatch` now holds the local branch `fix/spike-workflow-yaml`; PR #41 is merged.
- `../lahe-worktrees/sa-ci-dispatch` worktree and its local branch `chore/spike-dispatch-workflow`: PR #40 is merged.
- `.github/workflows/spike.yml` on main: temporary, remove before this feature's last PR merges.
- `docs/features/20261011.02_stable_addresses/02_architecture_stable_addresses_reviews_security.html`: stale build output from before the review files were combined.
- `docs/features/20261011.02_stable_addresses/parts/reviews/`: the two original review files, now copied into `02_architecture_stable_addresses_reviews.md`.

### Test results

**PR 0 local gate** (`npm run gate`, run alone, on `chore/spike-dispatch-workflow`): 844 passed, 0 failed, 6 skipped, 8.8 minutes. Helpers running before and after: 2 and 2.

**Idle-cost baseline (Task 0.2), today's design, on this Mac, 2026-10-11 15:21.** Five minutes of sampling every 10 seconds by [measure_idle_baseline.py](progress/measure_idle_baseline.py); raw samples in [baseline_idle_cost.json](progress/baseline_idle_cost.json). Nothing was done to the processes measured.

| Measure | Value |
|---|---|
| Page servers running at once | 16 to 27, average 21.4 |
| Separate page server processes seen in 5 minutes | 51 |
| Memory of page servers | average 611 MB, peak 866.5 MB |
| Memory of page servers plus helper processes | average 739.9 MB |
| Helper idle wakeups (`top`, one 60-second interval) | 107 |

The page servers belong to about 13 agent sessions. They keep restarting: each lives about two minutes, stops, and a new one starts. Task 5.4 compares the always-on helper against these numbers.

**Task 1.0 browser check, all systems.** A page at `live-agentic-html-editor.docs.ongoing.lahe.localhost:<port>` loads with no setup and counts as a secure page in every case:

| System | Chromium | Firefox | WebKit |
|---|---|---|---|
| macOS (this Mac) | loads, secure | loads, secure | loads, secure |
| Linux (GitHub `ubuntu-latest`) | loads, secure | loads, secure | loads, secure |
| Windows (GitHub `windows-latest`) | loads, secure | loads, secure | loads, secure |

Script: `scripts/spike_localhost_names.js` on branch `spike/localhost-names`. Linux and Windows run: [run 38170515824](https://github.com/kenxle/live-agentic-html-editor/actions/runs/38170515824).

**Task 5.1 login item check, all systems.** Script `scripts/spike_login_item.js`. macOS by the install builder on this Mac; Linux and Windows in [run 38172224261](https://github.com/kenxle/live-agentic-html-editor/actions/runs/38172224261).

| System | Install starts the helper | Restart after a kill | Start on request | Uninstall |
|---|---|---|---|---|
| macOS (launchd) | 0.3 s | 10.3 s | 10.6 s | clean |
| Linux (systemd user) | 0.3 s | 2.5 s | 0.3 s | clean |
| Windows (Task Scheduler) | 0.3 s | 61.0 s | 0.3 s | clean |

Windows restarts through the once-a-minute trigger, so a crashed helper there can be down for up to about a minute. "Starts at login" itself is proven on this Mac by your reboot (row V45).

**Real `lahe install` and `lahe uninstall`, Linux and Windows** (rows V46, V47), on the merged branch: [run 38180638262](https://github.com/kenxle/live-agentic-html-editor/actions/runs/38180638262).

| System | `lahe install`, helper up | Restart after a kill | `lahe uninstall` |
|---|---|---|---|
| Linux | 0.4 s, exit 0 | 2.5 s | exit 0, clean |
| Windows | 0.4 s, exit 0 | 61.0 s | exit 0, clean |

### Ship

Not shipped yet.

## Log

- 2026-10-11 18:37: Library fix merged (Open gives one address per file). Free disk fell to 887 MB, so all test runs and previews are on hold. What is left after the disk is cleared: full `gate` and `gate:all`, the idle measurement against the limits (at most 100 MB and 120 wakeups a minute with nothing open; at most 250 MB and 400 with about 20 pages open), a preview on your real documents, and a browser walkthrough.
- 2026-10-11 18:35: Core fix round 2 merged: hidden folders cannot be mounted, the helper refuses to start if another program holds its IPv6 address, the worktree fallback checks git's own link, one address per file for `lahe review`, docs and skill current. The Library's Open gets the same one-address rule next.
- 2026-10-11 18:31: Install fix round 2 merged. The real `lahe install` and `lahe uninstall` commands pass on Linux and Windows on the merged branch.
- 2026-10-11 18:23: Security review: no blocker; six findings (a website could read a permanent machine id from `/health`; a Markdown link could mount a hidden folder like `~/.ssh`; another program could take the IPv6 half of the pages port; the stated risk for other local accounts was too mild; a folder's `.git` file could pick the worktree fallback; test settings worked in normal use). Independent spec check: most requirements met; light-when-idle not yet measured; one file could get two addresses; stale docs; some tests weaker than their rows; five changes from the docs need your OK. All sent to the core and install builders as fix round 2.
- 2026-10-11 18:14: Code review fixes merged from both builders, each with a test that failed first (single test files only, because of the disk). One Library change to note: a link on a `.lahe.localhost` page can now open the Library page; the Library still cannot be framed, and its other routes are unchanged. Security review and an independent spec check started (read only). The full suite waits on disk space.
- 2026-10-11 17:55: Phase 7 code review (whole merged diff, read only) found 10 important issues and a set of smaller ones; none is a design change. Most serious: a failed `lahe review` can stop the always-on helper; the `--port-80`/`--lahe-names` root step reads files another program of yours could swap first; any web page can grow the helper's memory and log. All sent to the core and install builders as one fix round. They run single test files only, and stop if free disk drops under 1 GB.
- 2026-10-11 17:41: First full gate on the merged branch: unit 2,577 passed, 0 failed; browser 861 passed, 2 failed, 7 skipped. One failure is a log-wording change in Host refusals (to fix); the other hit "no space left on device". Disk is full from test temp folders; all test runs paused until it is cleared.
- 2026-10-11 17:17: Library 4.3 merged. Every workstream is now merged. Unit gate: 2,575 tests, 1 failed, an install test that only fails under load, sent to the install builder. Full browser suite next, once that is fixed.
- 2026-10-11 17:00: Core Step 3 merged: stable addresses are now the default. 54 Library tests of removed behavior went to the library builder (Task 4.3). A test leak in `install_command.test.js` went to the install builder.
- 2026-10-11 16:48: Install docs merged. Install builder found that closing the last session stops an always-on helper; fix sent to the core builder.
- 2026-10-11 16:41: Port-free addresses and the `.lahe` name server merged (macOS options, each behind its own self-check). Three small core changes to make them visible sent to the core builder. Install builder on docs (5.5).
- 2026-10-11 16:28: Login item check passed on Linux and Windows (install, restart after a kill, start on request, uninstall). Windows restart takes up to a minute. Install builder moved on to port-free addresses and the `.lahe` name server (6.0 to 6.2).
- 2026-10-11 16:27: Install 5.1 to 5.3 merged cleanly. `lahe install` and `lahe uninstall` work on this Mac in a throwaway test. Linux and Windows login item check started on GitHub.
- 2026-10-11 16:22: Library 4.1 and 4.2 merged cleanly. The Library shows stable addresses and Open binds a site, behind the switch.
- 2026-10-11 16:21: Task 3.0 done: 11 test files to retire (2 whole, 9 in part), 26 to rewrite. Core builder moved on to Step 3.
- 2026-10-11 16:17: Core Step 2 merged. One row is blocked: old comments made at a random-port address do not show in the rail at the new address, because the rail only reads this browser's storage, which is kept per address. The comments are safe in `review.json`. Options are being written up for you.
- 2026-10-11 16:07: PR #41 merged (workflow file fixed, gate green on rerun). Task 1.0 browser check passed on Linux and Windows too: all three browsers load dotted `.lahe.localhost` names as secure pages.
- 2026-10-11 15:58: Core Step 1 merged (unit gate 0 failed). Core continues to Step 2; library (4.1, 4.2) and install (5.1 to 5.3) builders dispatched. PR #41 gate had two flaky browser failures on unchanged code; rerunning the failed job.
- 2026-10-11 15:31: The spike workflow from #40 had a YAML error, so GitHub recorded a failed run on each of three branch pushes (you may have three failure emails; sorry). Fix is [PR #41](https://github.com/kenxle/live-agentic-html-editor/pull/41). Task 1.0 browser check on macOS: Chromium, Firefox, and WebKit all load `live-agentic-html-editor.docs.ongoing.lahe.localhost` and treat it as secure. Linux and Windows run once #41 merges.
- 2026-10-11 15:29: PR #40 merged (hand-run spike workflow, CI gate passed). Step 0 done. Main merged into `feat/stable-addresses`.
- 2026-10-11 15:21: Idle-cost baseline measured: 51 separate page server processes in 5 minutes, about 21 running at once, about 740 MB with the helpers. PR 0 (hand-run CI workflow) open as #40; local gate 0 failed.
- 2026-10-11 15:02: Ken approved the doc set: the login gap accepted, and the hand-run CI workflow approved on condition it costs nothing (standard GitHub machines are free for this public repo). Phase 5 done.
- 2026-10-11 14:52: Ken finished the brief. Settled in review: names are the folder plus two parents joined by dots (`live-agentic-html-editor.docs.ongoing`), one name per folder; pages on port 1483 with the API staying on 7817; `lahe review` prints `.lahe.localhost`; `lahe install --port-80` drops the port on macOS; `.lahe` is an option on all three systems, by command on macOS and written steps elsewhere; no npm package. Architecture and plan updated to match. HTTPS for `.lahe` added as a follow-up.
- 2026-10-11 12:56: Plan review returned 22 findings (2 blockers: main would have been broken between pull requests). All accepted: the Library's new Open ships with the first PR behind the switch, the page lookups ask both old and new until the switch flips, and nine verification rows were added. Doc set served for your review.
- 2026-10-11 12:48: Plan written: four workstreams, five PRs, 64 verification rows. Plan review dispatched.
- 2026-10-11 12:48: Architecture and security reviews returned 5 blockers between them. Architecture reworked: a name per folder (today's isolation unit) so paths, Markdown links, and rail rules keep working; binding is CLI-only; `.lahe` becomes a guarded Mac option with `.lahe.localhost` recommended as the printed ending, which reverses your earlier choice and is queued for your decision.
- 2026-10-11 12:35: Architecture written. Security and architecture reviews dispatched.
- 2026-10-11 12:35: PM review returned 12 findings (1 blocker: switching between `.lahe` and `.lahe.localhost` would kill addresses). All accepted into the brief. Recon found four blockers the architecture handles, including one worth your eye: a plain `.lahe` address is "Not secure" to the browser (see the architecture's failure modes).
- 2026-10-11 12:27: Crucible and brief written from the decisions page. PM review dispatched.
- 2026-10-11 12:24: Feature started. Ken settled all four questions on the decisions page and asked for the full doc set without stopping.
