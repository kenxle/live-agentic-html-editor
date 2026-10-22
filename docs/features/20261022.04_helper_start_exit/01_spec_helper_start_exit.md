# Helper start: report an early exit, and wait as long as add.js

Route: whetstone. Found on PR #92's CI run 39725490547.

## What happened

`test/unit/library_command_sites.test.js:36` failed on GitHub CI with "the
helper did not start within 10 seconds" (duration 10073 ms). The PR changed
only print CSS. Main was green before and after, and the test passed 5 of 5
here. So the helper either came up slowly on a loaded runner or exited, and
the error could not say which: `startHelper` in `src/cli/commands/session.js`
spawned it with `stdio: "ignore"` and only polled health.

## Change

- `startHelper` watches the spawned child. If it exits before it answers,
  the error says so at once, with its exit status and the command to run to
  see why. This is the same pattern `lahe serve --restart` uses.
- An exit is a failure only when nothing answers health. A child that exits
  0 because another command's helper won the port ("already answering") is a
  start, as it was before. Review finding; no unit test, since the race needs
  a real helper to bind between the first probe and the spawn.
- The wait is 15 seconds (`HELPER_START_WAIT_MS`), the same as `add.js`
  already uses. A busy machine is no longer told a start failed while the
  helper is still coming up; a helper that cannot start is reported sooner
  than before.

## Tests

`test/unit/session_start_exit.test.js`, red on the old code:

1. A helper whose port is held by another server exits on EADDRINUSE, and
   `startHelper` rejects with "the helper exited (N) before it answered",
   in under 10 seconds.
2. `HELPER_START_WAIT_MS` is 15000.

If the CI failure comes back, its message now tells an exit from a slow start.
