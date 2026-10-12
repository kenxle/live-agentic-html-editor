# Plan review: Stable addresses

Reviewer: review-plan (orchestration and test plan). Reviewed: `03_plan_stable_addresses.md` and its four leaves, against the brief, the architecture, the combined architecture review file, CLAUDE.md, and the code on `feat/stable-addresses` at `1665e7f`.

## Summary

Two blockers, both about the app being broken on main between pull requests:

- PR 2 retires page-server spawning, but the Library's Open still restarts page servers until PR 4. Library Open is broken on main in between, and the V36 row (no code spawns a page server) cannot pass in PR 2.
- Task 2.1 rewires the page-to-file mappers to read sites in PR 1, while the switch is off. The default path still uses page servers, so the healer, reload, and handled checks lose their roots on main.

The rest is important but fixable in the plan text: shared files with no named owner, a test retirement step that collides with the no-delete rule, CI spikes that the CI rules do not allow as written, several accepted security findings with no verification row, and the printed-ending decision landing too late for PR 2's contract text.

| # | Severity | Area | One line |
|---|---|---|---|
| PR1 | blocker | orchestration | Library Open breaks between PR 2 and PR 4 |
| PR2 | blocker | orchestration | Step 2 mappers switch to sites while the switch is off |
| PR3 | important | orchestration | Shared files have no owner or merge plan; install's start point does not exist |
| PR4 | important | orchestration | 23 existing test files test removed behavior; no task retires them under the no-delete rule |
| PR5 | important | orchestration | Manifest lint fails PR 1 and PR 3 as written |
| PR6 | important | orchestration | "Behind a switch" does not say which PR 1 parts are live, or how CLI and helper agree on it |
| PR7 | important | orchestration | Printed-ending decision lands after PR 2 ships the contract |
| PR8 | important | test plan | Accepted security findings with no verification row |
| PR9 | important | test plan | Headline promises with no row: same file gives same address; clone mode keeps the address |
| PR10 | important | test plan | V46 and V47 cannot prove "starts at login" on Linux and Windows |
| PR11 | important | orchestration | CI spikes (Tasks 1.0 and 5.1) need workflows the CI rules do not allow as written |
| PR12 | important | test plan | Leak risks new to this feature: launchd respawn, always-on helpers, two listeners, stale-replace stub |
| PR13 | important | test plan | V35 can signal an unrelated process that reused a recorded pid |
| PR14 | important | test plan | `.lahe` verification is only ever proven against a stub |
| PR15 | important | test plan | R8a criterion maps to V13, which proves different behavior |
| PR16 | important | orchestration | Idle-cost baseline and limits are measured at the wrong time |
| PR17 | important | orchestration | Workstream leaves are not complete dispatch contracts |
| PR18 | minor | test plan | Test construction: positive controls, encoded paths, clocks, vague rows |
| PR19 | minor | test plan | Brief logging and rollout lines have no row |
| PR20 | minor | orchestration | Task 6.3 needs a stated way to get a non-secure origin in tests |
| PR21 | minor | orchestration | Step 3 step test has the builder running the full browser suite |
| PR22 | minor | orchestration | Leaves restate architecture detail that will drift |

## Findings

### PR1. Library Open breaks between PR 2 and PR 4

```
severity   blocker
kind       defect
area       orchestration
where      Workstreams and PRs table; core Task 3.1; library Task 4.1; V36
```

- **what** PR 2 removes page-server spawning, but `src/service/catalog_actions.js` still opens a row by calling `staticServers.createCatalogOps` and `ops.reopenForCatalog` (lines 45, 248 to 298) until the library workstream lands in PR 4.
- **why** Between PR 2 and PR 4, main either has a Library Open that fails on every row, or it still spawns page servers, which makes V36 (no code path spawns `static_servers.js --serve`) fail in PR 2. The unit tests `catalog_open_rollback`, `catalog_lifetime`, `catalog_open_owner`, and `library_session_autoclose` also exercise the old Open and will go red in PR 2. Core's "Don't touch" list forbids it from fixing them.
- **fix** Start library after PR 1, not PR 2. `site.bind` exists in PR 1, so the library builder can build "Open binds" behind the same switch, in parallel with core Step 3, and land before PR 2. PR 2 then flips both and removes the old Open together. This also shortens the critical path. If that is not wanted, merge Task 4.1 into PR 2 and say so.

### PR2. Step 2 mappers switch to sites while the switch is off

```
severity   blocker
kind       defect
area       orchestration
where      core Task 2.1 and 2.2; PR 1 ("Steps 1 and 2, switch off by default")
```

- **what** Task 2.1 says each mapper (`servesPath`, healing stand-down, `pageUnderFolder`, `targetForPage`, `heal.js`, `rebuild.js`, `handled_check.js`, `projection.js`, `markdown*.js`) "reads sites instead of page-server records", and that ships in PR 1 with the switch off.
- **why** With the switch off, pages are still served by page servers, so a mapper that only reads sites finds no root. The architecture's AR5 names the result: the healer writes tokens into served files. Reload, handled checks, and linked documents also stop matching. Main is broken after PR 1 for every user.
- **fix** In Task 2.1, say the mappers ask both, chosen by the switch, until Task 3.1 removes the page-server branch. Give PR 1 a row that runs V26 to V30 with the switch off as well as on. Or move Step 2 into PR 2, where the switch flips, and keep PR 1 to Step 1.

### PR3. Shared files have no owner or merge plan; install's start point does not exist

```
severity   important
kind       defect
area       orchestration
where      Workstreams and PRs table, "Owns" and "Depends on"; Token plan bullet
```

- **what** The token plan says core and install "share no files except two separate functions in `session.js`". The table and the code show more overlap, and some files have no owner.
- **why** Two builders edit the same file with no named canonical version, and the orchestrator finds out at merge. Specifically:
  - `add.js`: core owns `--served-by-helper` inside `run()`; install owns `startHelper`, which `run()` calls at four places (lines 1158, 1284, 1328, 1342).
  - `src/service/index.js`: core owns it, but install's Task 5.3 adds the state-folder id to `/health` and `always_on` to `service.json`.
  - `src/cli/commands/serve.js`: needs `--always-on`; no workstream owns it.
  - `status.js`: core owns it; the architecture says status reports install state and the state folder, which is install's work.
  - `docs/CLI.md` and `docs/ongoing/SESSION_OWNERSHIP.md`: edited by core 3.3 and install 5.5.
  - `src/shared/manifest.js`: see PR5.
  - `src/layer/index.js` (reads aliases, Task 2.2) and `src/cli/commands/library.js` (named in the architecture): no owner.
  - lahe-names Task 6.2 changes Host dispatch in `page_routes.js` and `protocol.js`, which core owns; it is sequential, so safe, but the table should say lahe-names may edit them.
  - Install "depends on core Step 1 merged", but Step 1 has no PR of its own; PR 1 is Steps 1 and 2. And nothing in install needs sites, so the dependency is not real.
- **fix** Give each shared file one owner and name the other workstream's edit as a named function or section it adds. Start install at once, in parallel with core from the beginning, since it needs nothing from Step 1. State the merge order: PR 2 before PR 3, with install rebased on PR 2, so V51 (stale helper replaced with a window open) runs against the real serving model. Give `serve.js` to install, `library.js` and `src/layer/index.js` to core.

### PR4. 23 existing test files test removed behavior; no task retires them

```
severity   important
kind       risk
area       orchestration
where      core Task 3.1; CLAUDE.md "Never remove files while work is running"
```

- **what** 20 unit files and 3 browser specs name `static_servers`, `idle_servers`, or the Library restart functions (a grep for those names under `test/`) (for example `static_servers.test.js`, `static_restart.test.js`, `stop_idle_servers.test.js` and `.spec.js`, `catalog_open_rollback.test.js`, `serve_time_inject.spec.js`). No task says what happens to them.
- **why** PR 2 cannot read "0 failed" while they assert retired behavior. Builders may not delete files, and emptying a test out breaks "no stubbed tests". The likely outcome is a builder stalled on a deletion prompt, which is the incident the CLAUDE.md rule exists for.
- **fix** Add a task to Step 3: list each affected test file and decide, per file, rewrite against sites or retire. Retired files go on the progress page's cleanup queue, and the plan names that Ken approves those deletions as one batch before PR 2 runs its gate. Until then, the orchestrator excludes them from the run by an explicit list in the test command, written on the progress page, not by editing them.

### PR5. Manifest lint fails PR 1 and PR 3 as written

```
severity   important
kind       defect
area       orchestration
where      core Task 3.3 (`src/shared/manifest.js`); install Task 5.2; lahe-names Task 6.1
```

- **what** The manifest update is listed only in Task 3.3. `npm run lint` fails when any file under `src/` is missing from `src/shared/manifest.js`.
- **why** PR 1 adds `sites.js` and `page_routes.js`, PR 3 adds `install.js` and `login_item.js`, PR 5 adds `name_server.js`. Each fails lint at its own gate.
- **fix** Each task that adds a file adds its manifest line in the same commit. Make `manifest.js` an orchestrator-merged file, like `dist/`.

### PR6. "Behind a switch" does not say which PR 1 parts are live

```
severity   important
kind       risk
area       orchestration
where      core Step 1, Tasks 1.2 and 1.4; PR 1
```

- **what** The plan says PR 1 is "off by default", but Host dispatch, the `::1` listener, `Cross-Origin-Resource-Policy`, and the refusal of unknown Hosts with 400 all sit in `index.js` and are not described as conditional. `LAHE_PAGES` is also an environment variable read by separate processes.
- **why** If Host dispatch is live in PR 1, it changes behavior for everyone (a Host the API accepted yesterday may be refused). If it is conditional, the CLI and an already running helper can disagree: a CLI with `LAHE_PAGES=sites` calls `site.bind` on a helper started without it.
- **fix** List what is live in PR 1 and what waits for the switch. Have the helper always answer `site.bind` and Host dispatch (harmless when nothing is bound), and let the switch change only what the CLI does. Then the helper never needs the variable, and a mismatch cannot happen. Add a row: with the switch off, the existing suite passes unchanged.

### PR7. The printed-ending decision lands after PR 2 ships the contract

```
severity   important
kind       risk
area       orchestration
where      lahe-names Task 6.3; core Tasks 3.2 and 3.3; brief Q1
```

- **what** Ken's answer on the printed ending is taken "at the review gate", and only lahe-names reads it. Core 3.2 (status prints the ending and why) and 3.3 (skill, contract, and copies) ship in PR 2 without referring to it.
- **why** If Ken picks `.lahe`, PR 5 changes what `lahe review` prints and why, so the skill, the contract in `review_format.js`, `test/unit/review_format.test.js`, and `docs/CONTRACTS.md` all change again. PR 5's leaf lists none of them, which breaks the skill-and-contract travel rule.
- **fix** Make Q1 a precondition of dispatch, answered at the plan gate. If the answer is `.lahe`, add the contract copies, `docs/CLI.md`, and a dist rebuild to Task 6.3, and a V38 part for PR 5.

### PR8. Accepted security findings with no verification row

```
severity   important
kind       defect
area       test plan
where      Test List; architecture Security Review SR1, SR2, SR5, SR11, SR12, SR13
```

- **what** These accepted fixes asked for a test and have no row:
  - SR1: a walk in real Safari, Chrome, and Firefox on macOS showing `x.lahe.localhost` reaches loopback with no network DNS query. Playwright's WebKit is not Safari.
  - SR2: `site.bind` checks the target on the helper side (real path, regular file, owned by this user, no hidden segment, not inside the state folder); a `review.write` with `target_path` cannot widen what may be bound. V22 covers only the secret and `Origin`.
  - SR5: the Library refuses a request without `Sec-Fetch-Site` on every Host, and is never served on `library.lahe`.
  - SR11: the 404 and 410 pages HTML-escape the name and path; the helper listens on exactly `127.0.0.1` and `::1`, never `::` or `0.0.0.0`.
  - SR12: the Windows task command uses a tested quoting helper, and clone paths with quotes are refused.
  - SR13: `data-lahe-aliases` is JSON-escaped and capped at 16.
- **why** Each is a security property a refactor can quietly drop. Without a row, nothing fails when it does.
- **fix** Add a U row for each of SR2, SR5, SR11, SR12, SR13, and an M row for SR1 on this Mac, run by the orchestrator with the evidence on the progress page.

### PR9. Headline promises with no row

```
severity   important
kind       defect
area       test plan
where      Test List; acceptance criteria for R3, R7, R1
```

- **what** Missing rows for:
  - R3 (same file, same address): serving the same file again, in a second review and through a second path spelling (a symlink, `/var` against `/private/var`, a different letter case on macOS), gives the same name. V1 to V3 test the name rule, not reuse.
  - R7 (a clone without install): `lahe review` starts the helper, the helper stops, the next `lahe review` starts it again, and the first address loads again. PR 3's claim "without `lahe install`, nothing changes for a clone" rests on this.
  - R1 (works after the server restarts): V63 restarts the helper only for drafts; no row checks the page itself after a restart in clone mode.
  - R5 (a taken port): V37 covers `lahe status`; the brief also names `lahe review` and the log.
  - R8 (Library rows link to stable addresses) and R14 (the gone-file page links to the Library): stated in tasks, not in rows.
- **fix** Add these rows, and point the acceptance criteria for R3, R7, and R1 at them.

### PR10. V46 and V47 cannot prove "starts at login" on Linux and Windows

```
severity   important
kind       challenge
area       test plan
where      V46, V47; acceptance "Starts at login on three systems"
```

- **what** A GitHub runner has no interactive login, and `systemctl --user` usually has no user session there. The rows also "never fail the run", so their verdict lives in a log.
- **why** The acceptance criterion for R7 says three systems start at login. The planned evidence can show "registers, starts on request, restarts after a kill, unregisters" at best. Implement has no evaluator to renegotiate this, so it will be reported done on weaker proof.
- **fix** Reword V46 and V47 to what CI can prove, name who reads the log and records the verdict on the progress page, and either name a Linux and a Windows machine for a login check or put "login start unverified on Linux and Windows" in front of Ken as a decision at the plan gate.

### PR11. CI spikes need workflows the CI rules do not allow as written

```
severity   important
kind       risk
area       orchestration
where      core Task 1.0 ("locally on macOS and in CI (Linux)"); install Task 5.1; V46, V47
```

- **what** `gate.yml` runs only on pull requests and pushes to main, on Ubuntu, with Chromium only. A `workflow_dispatch` workflow must exist on the default branch before it can be dispatched, and CLAUDE.md forbids pushing a branch just to trigger a run.
- **why** As written, a builder will either push a branch to get a run, add a push-triggered workflow, or skip the CI half. Each of the first two can email Ken on red.
- **fix** Name the mechanism: one temporary `workflow_dispatch` workflow landed on main by the orchestrator, with `continue-on-error: true`, a ref input, all three Playwright lanes for Task 1.0, and Ubuntu and Windows jobs for Task 5.1. Name who removes it, and when, under the cleanup queue.

### PR12. Leak risks new to this feature

```
severity   important
kind       risk
area       test plan
where      Test List callout; Tasks 5.1, 5.3; V10, V48, V49, V51, V54
```

- **what** The table's callout says every process is stopped, but four new ways to leak are not addressed:
  - The macOS spike in Task 5.1 loads a real `launchd` agent with `KeepAlive` on Ken's Mac. If uninstall is skipped or fails, `launchd` restarts the helper forever, and once the temp state folder is gone, self-stop rule 2 plus `KeepAlive` is a restart loop.
  - `--always-on` turns off self-stop rule 1, so any test helper started with it never stops on its own.
  - The helper now has two listeners. If shutdown closes only the `127.0.0.1` one, the process stays alive.
  - V51 restarts a stale helper "through the login item". In a test there is none, so something stands in and spawns a helper the test does not own by pid.
  - V54 and V55: a name-server test on a fixed port collides across parallel workers (AR18).
- **why** The 2026-10-07 incident (1,892 leaked helpers) came from exactly this kind of "the process outlives the test" gap.
- **fix** Add to the rows: V48 renders the plist, unit, and task XML and never loads them. Task 5.1 runs uninstall in a `finally` and checks `launchctl list` for the label before and after, with both outputs on the progress page. Add a U row: stopping a helper closes both listeners and the process exits. V51 names its stand-in login item and stops what it spawns by the pid in `service.json`. V54 uses a port from `free_port.js`.

### PR13. V35 can signal an unrelated process

```
severity   important
kind       defect
area       test plan
where      V35; core Task 3.1 ("stops leftover page-server processes named in old records")
```

- **what** Old records hold pids from days ago. Pids are reused.
- **why** On Ken's real helper, "every start stops processes named in old records" can kill whatever process now has that pid.
- **fix** Extend V35: a recorded pid whose command line is not `static_servers.js --serve` for that state folder is not signalled. The test spawns a harmless process, writes its pid into an old record, and checks it is still alive after a helper start, then stops it in teardown.

### PR14. `.lahe` verification is only proven against a stub

```
severity   important
kind       risk
area       test plan
where      V56 to V59; lahe-names Task 6.2
```

- **what** V57 and V58 are unit tests. A unit test cannot write `/etc/resolver/lahe`, so the system resolver is stubbed, which is the seam under test.
- **why** The real chain (macOS resolver, our name server, a browser loading `name.lahe`) is never run before PR 5 merges.
- **fix** Add an M row on this Mac: run `--lahe-names`, load `name.lahe` in Safari and Chrome, stop the name server, wait for the next check (or trigger it), and see `.lahe` refused and `.lahe.localhost` printed. Then uninstall and see the resolver file removed.

### PR15. R8a criterion maps to V13, which proves different behavior

```
severity   important
kind       challenge
area       test plan
where      V13; acceptance "Existing documents get addresses, and links keep working"
```

- **what** R8a says a link to another file Lahe serves "opens that file at its own stable address". The architecture serves a link outside the folder through the linking site's `/.lahe-source/<hash>/` mount, and V13 tests that.
- **why** The criterion as worded cannot be met by the planned work, and Implement does not stop to renegotiate. A flow walker reading R8a will fail it, or a builder will try to add redirects the architecture removed.
- **fix** Settle it at the plan gate: either reword the R8a criterion to "opens through the linking page's site" or add the work. This review does not take a side on the design.

### PR16. Idle-cost baseline and limits are measured at the wrong time

```
severity   important
kind       defect
area       orchestration
where      install Task 5.4; V53; brief R11
```

- **what** R11 says limits are set before building, and the baseline is "today's helper plus page servers". Task 5.4 sits in the install workstream, which starts after core work begins. It measures "the always-on helper" without saying the helper must already serve pages.
- **why** Once PR 2 lands, today's baseline no longer exists on main. Measured before PR 2, the always-on helper is not doing the work R11 is about.
- **fix** Move the limits and the baseline measurement to the first orchestrator step, at the current main commit, recorded by commit hash. Measure the after state once PR 2 and PR 3 are both merged. Ask Ken for his usual tab count rather than reading his browser.

### PR17. Workstream leaves are not complete dispatch contracts

```
severity   important
kind       defect
area       orchestration
where      parts/plan/core.md, install.md, library.md, lahe_names.md
```

- **what** Each leaf has an outcome, reads, authority, and "don't touch". None has the quality bar, completion, or escalation lines the feature-forge packet asks for.
- **why** Builders will not know to return what the orchestrator needs, and CLAUDE.md rules that bit before will be missed again.
- **fix** Add to each leaf:
  - the no-deletion rule near the top;
  - `gate:unit` plus one named spec, never the full suite;
  - the before and after `ps -axo command | grep -c "[l]ahe.js serve"` counts;
  - no `dist/` commits;
  - screenshots in light and dark for the unknown-name page, the gone-file page, the read-only worktree note, and the Library rows;
  - what to hand back: branch, commits, rows proven, leak counts, open questions;
  - when to stop and ask: for example, a spike that changes a mechanism, or any change outside the owned files.

### PR18. Test construction

```
severity   minor
kind       risk
area       test plan
where      V6, V14, V16, V21, V34, V38, V49
```

- V16: a cross-origin fetch that fails also passes when the host does not resolve. Add a positive control: the same fetch from a same-site page succeeds.
- V14: browsers normalize `..` before sending, so a browser cannot test this. The unit test sends raw and percent-encoded dot segments (`%2e%2e`, `%2f`).
- V21 and V40: "newest" ties within one millisecond. Inject the clock.
- V34 and V49: the idle grace is minutes long. Inject the clock instead of waiting.
- V6: "not possible through any export" restates the code. Test the behavior: run `review`, `write`, and `status` against a temp state folder with the helper stopped, and assert `sites.json` and `sites.log` are unchanged.
- V38: the grep for "random port" can be a scripted unit test rather than M.

### PR19. Brief logging and rollout lines have no row

```
severity   minor
kind       defect
area       test plan
where      brief "Analytics / Logging" and "Rollout / Flags"
```

- The log records the port, the ending and why, install state, each new name, and each refused Host without page content. No row.
- "Removing that Node means running install again, and `lahe status` says so." No row and no owner.
- **fix** One U row each, owned by core (log) and install (status).

### PR20. Task 6.3 needs a stated way to get a non-secure origin in tests

```
severity   minor
kind       risk
area       test plan
where      V60, V61, V62
```

- **what** The browser rows need `http://name.lahe` to resolve in Playwright, with no resolver on CI.
- **fix** Name the method AR8 suggested (a Chromium host-resolver rule), and say V60 and V61 run in Chromium only, or how Firefox and WebKit get the same. Have the copy fallback in Task 4.2 and Task 6.3 share one function so it is written once.

### PR21. Step 3 step test has the builder running the full browser suite

```
severity   minor
kind       defect
area       orchestration
where      core Step 3 "Step test"
```

- CLAUDE.md gives the full browser suite to the orchestrator once per checkpoint. Say the orchestrator runs it on the integrated branch.

### PR22. Leaves restate architecture detail

```
severity   minor
kind       taste
area       orchestration
where      Tasks 1.1, 1.3, 4.1, 6.1, 6.2
```

- Lists such as "Answers `A 127.0.0.1` and `AAAA ::1`... every 5 minutes" and the full contents of page serving repeat the architecture. If the architecture changes in a fix round, the leaf carries the old version. Point to the section and keep only the acceptance rows.
- The architecture links `02_architecture_stable_addresses_reviews_architect.md` and `..._security.md`, which no longer exist in the folder; the combined file is `02_architecture_stable_addresses_reviews.md`. Builders following "Reads first" will hit dead links.

## What holds up

- The verification table is concrete enough to become failing tests for most rows, and the failure modes in the architecture are mostly covered.
- The single core builder across Steps 1 to 3 is the right call; the serving model is one coupled change.
- Docs travel with the behavior they describe in each PR, and `dist/` is the orchestrator's.
