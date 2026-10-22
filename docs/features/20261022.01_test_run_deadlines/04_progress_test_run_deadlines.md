# Progress: Test run deadlines and checks

**Building.** Three board rows about the test tooling, shipped as one whetstone change, picked from the board for overnight work on 2026-10-22. Nothing is waiting on you.

## Needs your attention

Nothing is waiting on you.

## Spec

**Problem.** Three gaps in how the repo checks itself. A unit run with one stuck test never ends. Lint never looks at the pandoc filter. The link-safety render test only ever runs on marked, and fails under pandoc, which is the engine Ken's pages use.

| Row | Change | Test |
|---|---|---|
| LAHE-unit-run-timeout | The login item's start wait (`startThroughItem`) gives each health probe only what is left of its deadline plus a second, so a port that accepts and never answers cannot hold it. `probeHealth` takes an optional `timeoutMs`, and the two wait-for-start loops (`lahe add` and `session.startHelper`) pass `HEALTH_PROBE_TIMEOUT_MS` (5 s). Every other caller keeps a probe with no timeout, because there null means "no helper", and a helper that is only busy must not read as gone (`lahe add` writes the log itself when no helper holds the review). `scripts/no_stray_helpers.js --limit-minutes N` stops the command's whole process group after N minutes and fails the run, with a line naming how to find the stuck test; `test:unit` sets 30. The command runs in its own process group, so the wrapper passes Ctrl-C, SIGTERM and SIGHUP on to it. | `no_stray_helpers.test.js`: "stops a run that outlives its limit", "reads its limit", "package.json gives the unit run a limit", "probeHealth with a timeout gives up", "a start through the login item ends at its deadline" |
| LAHE-lint-non-js-files | Lint check 1c compiles every `.lua` file under `src/` with `luac -p`, or with `pandoc lua` and `loadfile` (pandoc's own Lua, which is what runs the filter), and never runs it. On a machine with neither, the summary line says the file was not checked. The manifest check now counts every file under `src/`, so `lahe_render.lua` has an entry. | `lint_lua.test.js` |
| LAHE-pandoc-link-safety-tests | "a refused link renders as plain text in every Markdown link form" runs once per engine. Both check every link's href as a browser would resolve it (only http, https, mailto, tel) and that no href starts with a script scheme. The tab-inside-the-scheme form must be a blocked span on marked; on pandoc it may instead be a link, but only to a path on the page's own site. | `markdown_links.test.js`, both engines; the pandoc one skips when pandoc 3 is absent |

**Also fixed: the cloud container's environment failures.** Run as a non-root user, one of the two root-only failures goes away. The other, `sites_dispatch` V10, expected `EADDRNOTAVAIL` for a documentation IPv6 address, and a kernel that refuses the address family says `EAFNOSUPPORT`. The helper already treats both codes as "no IPv6 loopback" (`NO_IPV6` in `src/service/index.js`), so the test now accepts either.

**Scope.** Test tooling and one helper probe timeout. No change to what a reviewer sees.

**Questions.** None open. Five seconds for a probe in a start wait is far above a local helper's answer time (milliseconds) and below the waits' own deadlines (10 to 20 seconds).

**Rollout.** Merge when the gate is green. Nothing to enable.

**Review owner.** One independent reviewer (whetstone size).

## Phases

| Step | Status | Changed |
|---|---|---|
| 0 Size it | done: three small rows, one PR | 2026-10-22 |
| 2 Spec | done, above | 2026-10-22 |
| 5 Build | done: each new test red on the old code, green on the new | 2026-10-22 |
| 6 Code review and verify | review round 1 done, fixes in; gate running | 2026-10-22 |
| 7 Ship and land | not started | |
| 8 Close out | not started | |

## The record

### Red before green

- The limit tests and the probe test hung on the old code (no limit, no probe timeout); the run was stopped by hand by pid.
- `npm run lint` failed with "NO OWNER: src/service/lahe_render.lua" once the manifest check counted every file, and passed after the entry was added.
- With pandoc 3.9 on PATH, the old render test failed exactly as the board row says; both engine runs pass with the new assertions.

### Review round 1

One independent reviewer. Findings and what changed:

- **Blocker, fixed.** The first version gave every `probeHealth` call a 5 s default. A helper that is up but busy for 5 s (a pandoc render, swapping) would then read as no helper, and `lahe add` would write the review's log beside the running helper. The default is gone: only the start waits pass a timeout, and `startThroughItem` bounds each probe by its own deadline. Test: "a start through the login item ends at its deadline", which hangs on the old code.
- Lint's manifest check skips dotfiles and editor or merge backups, so a `.DS_Store` in `src/` cannot fail lint.
- The wrapper forwards SIGHUP too, and `--limit-minutes` with no usable number is an error, not "no limit".
- The limit test has its own 20 s timeout, so a regression fails instead of hanging.
- The pandoc skip message says "missing, or too old".

## To delete at cleanup

- `/home/builder` and the `builder` user in the cloud container: a non-root user for running the unit suite, so root-only failures do not show. Container only, nothing in the repo.
