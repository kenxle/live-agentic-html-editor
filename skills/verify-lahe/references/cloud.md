# Cloud verification

The same headless Playwright harness is the intended cloud route. This is a
setup contract, not a claim that Claude Code cloud has been exercised.

## Runner setup

- Check out the intended branch into an isolated writable worktree.
- Use the Node version in `.nvmrc`; run `npm ci` for test dependencies.
- On Linux, run `npx playwright install --with-deps chromium` during setup.
  If system packages require elevated permissions, prepare them in the runner
  image. Report a setup blocker if that is unavailable.
- Allow local listeners, browser child processes and writable temporary storage.
  The harness uses free ports and `*.lahe.localhost` hostnames. Verify name
  resolution in the actual runner through the seed journey, not by assumption.
- Run the seed command in [the verification skill](../SKILL.md), using a fresh
  output directory. Upload its trace and command log before destroying the runner.
- Keep the browser suite serial across agents on a shared machine. Each cloud
  job should own its checkout, state and artifact directory.

No API keys or personal Lahe state are needed for the fixture journeys. Do not
copy a developer's state directory or install login items for browser tests.
The real CLI must come from the checkout, not a globally installed `lahe`.

## What remains outside this proof

| Surface | What the harness can prove | What needs another environment |
| --- | --- | --- |
| Browser, review service and CLI | Real fixture reviews, persistence, source changes and replies | Run the seed on the selected cloud provider before calling it ready |
| Agent host wake | Protocol behavior and stub-agent journeys | A real host, its queue/socket and a real feedback wake |
| Mac menu bar and login integration | Dedicated checks via `npm run check:menubar` on macOS | A Mac; Linux skips this check |
| Firefox and WebKit | Named Playwright projects after installing engines | An actual run in each engine |
| PDF and external exporters | The test's declared stub boundary | An installed real exporter for output fidelity |

The existing [GitHub workflow](../../../.github/workflows/gate.yml) intentionally
runs lint, bundle freshness and unit tests only. This change does not turn the
browser suite back on there. Scheduling cloud agents and automatic board claims
are separate work. The [bulletin board](../../../docs/BULLETIN.md) remains the
task source; a verification pass does not grant merge or task-selection authority.
