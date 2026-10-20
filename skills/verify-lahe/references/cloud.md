# Cloud verification

The same headless Chromium that `lahe-verify` drives locally is the cloud route. The seed journey
below passed on a Claude Code cloud runner (Linux, Node 22) on 2026-10-20.

## Runner setup

- Check out the intended branch into an isolated writable worktree.
- Use the Node version in `.nvmrc`; run `npm ci` for test dependencies.
- On Linux, run `npx playwright install --with-deps chromium` during setup.
  If system packages require elevated permissions, prepare them in the runner
  image. Report a setup blocker if that is unavailable.
- The runner's network must allow `cdn.playwright.dev`, where Playwright
  downloads Chromium. A Claude Code cloud environment blocks it until the host
  is added to the environment's allowed hosts. Without it the install fails
  with a 403 naming that host, and `up` fails because the browser is missing.
- Allow local listeners, browser child processes and writable temporary storage.
  The harness uses free ports and `*.lahe.localhost` hostnames. Verify name
  resolution in the actual runner through the seed journey, not by assumption.
  On the cloud runner `getent` does not resolve them, but Chromium does, so a
  `getent` or `curl` check gives a false alarm.
- Run one journey with `lahe-verify` as the first proof: `up`, `doctor`, the
  comment recipe in [the feature map](../features/reviews-and-comments.md), and
  `down`. Pass `--evidence <artifact dir>` to `up`, and upload that folder before
  destroying the runner. `down` must print `left running: nothing`.
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
