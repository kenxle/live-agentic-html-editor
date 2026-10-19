---
title: npm run test:unit has no timeout, so one stuck test hangs the whole run until someone kills it
category: testing
symptoms: [npm run test:unit never finishes, unit run hung for hours, node --test test/unit sits there, test output stopped growing, "did not start the helper within 20 seconds", login item test hangs, always_on test failed after 444 seconds, no_stray_helpers waits forever, lahe serve left running from a test run]
applies_to: [package.json, scripts/no_stray_helpers.js, test/unit/always_on.test.js, test/unit/helper_freshness.test.js, test/unit/helper_not_replaced.test.js, test/helpers/temp_helpers.js]
first_seen: 2026-10-19
confirmed: 2026-10-19
status: live
---

## What happens

`npm run test:unit` runs fine for most of the suite, then the output stops. The command does not fail and does not return. One run stayed up for more than a day.

In that run the log had one failure, and it came from the always-on login item test in `test/unit/always_on.test.js` ("stale: a busy always-on helper is left for a later command, and the caller is told why"):

```
the login item lahe-test-<pid> did not start the helper on 127.0.0.1:<port> within 20 seconds.
Its log is <run folder>/lahe-always-on-<id>/state/login-item.log.
`lahe uninstall` goes back to starting the helper on demand.
```

That test reported a duration of about 444 seconds for a wait that should end after 20. After that the log reached the last unit test and stopped. `ps` still showed the run's wrapper, its `node --test` runner, and two helpers started by `test/unit/helper_freshness.test.js` and `test/unit/helper_not_replaced.test.js`. Re-running the same tree later passed: 3072 passing, 0 failing.

I could not reproduce the hang, so its root cause is not known. Two things are known from the code:

- `startThroughItem` in `src/service/login_item.js` checks its 20 second deadline only between health probes. `probeHealth` in `src/service/index.js` calls `fetch` with no timeout. A probe that gets no answer holds the loop past the deadline.
- Nothing around the run stops it. `package.json` runs `node scripts/no_stray_helpers.js node --test test/unit/` with no `--test-timeout`, and the wrapper waits for the runner's exit with no limit of its own. The browser suite has a 90 second per-test timeout in `playwright.config.js`. The unit suite has none.

## Why

The suite is a long `node --test` run that starts real helper processes. When one test waits on something that never answers, the runner waits on that test, the wrapper waits on the runner, and the helpers the test started stay up. Nothing in the chain has a deadline, so the run ends only when a person ends it.

## What to do instead

Run the unit suite in the background with a deadline, and look at the log's modified time instead of waiting on the command:

```
npm run test:unit > run.log 2>&1   # in the background, with the tool's timeout set
ls -l run.log                       # a log that has not grown in minutes is stuck
grep '^not ok' run.log              # which test failed first
```

If a run is stuck, kill only that run's processes. Do not match on `lahe.js serve`: the developer's real helper (`serve --always-on --port 7817`, started by the login item) has the same command shape.

1. List processes with `ps -axo pid,ppid,etime,command`.
2. Take the wrapper (`node scripts/no_stray_helpers.js node --test test/unit/`) and its child `node --test test/unit/`. Match them by parent pid and by `etime`, since their command lines do not name the repo.
3. Take every `lahe.js serve` whose `--state-dir` sits under the run's temp folder. The wrapper makes that folder (named `lahe-run-<id>`) and sets it as `TMPDIR`, so only this run's helpers name it.
4. Kill those pids by number, then run `ps` again and confirm none are left. The wrapper was killed before it could clean up, so the run's temp folder stays on disk.

To find a stuck test, read the last `# Subtest:` line in the log that has no `ok` or `not ok` after it.
