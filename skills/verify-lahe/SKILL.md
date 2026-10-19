---
name: verify-lahe
description: Verify Lahe browser, CLI and review-service behavior using isolated real reviews, the existing Playwright harness and a user-facing feature map. Use for proving a repo change, reproducing a bulletin-board issue or preparing evidence for an agent PR.
---

# Verify Lahe

Read the relevant entry in [the feature map](features/README.md), then drive the
changed user path. A passing unit test alone does not prove the browser workflow.
This skill supplements [the repo gates](../../CLAUDE.md), not replaces them.
For running a human review, use [the Lahe skill](../lahe/SKILL.md).

## Launch

Run commands from this checkout's root, in an isolated worktree. Use Node from
`.nvmrc`. A fresh checkout needs `npm ci` for the development harness and
`npx playwright install chromium`. On a fresh Linux runner use
`npx playwright install --with-deps chromium`; this requires package-install
permission and network during setup. Lahe itself has no runtime dependencies.
See [cloud prerequisites and limits](references/cloud.md).

Run `npm run check:layer` before driving. If stale, run `npm run build:layer`
and follow the repo's generated-bundle rules. Do not test an old bundle as if it
were the current source. Do not restore somebody else's lockfile or changes.

The existing harness is the control tool. Each named spec starts its own helper,
fixture and browser, then stops them. There is no shared dev server to find or
global CLI to install. For the seed journey, run:

```sh
npm exec -- playwright test test/browser/free_writing_seams.spec.js --grep 'placement: a header' --workers 1 --trace on --reporter list --output /tmp/lahe-verification-seed-proof
```

Use a fresh output directory for each later run; Playwright clears its output
directory at startup. Save the command's output alongside, not inside, that
directory. The seed command launches `node <checkout>/bin/lahe.js review` through
`test/browser/support/lahe_world.js`, with a newly written Markdown document,
its own state directory and free helper port. The Playwright config sets free
page ports and disables actual Terminal launches. No credentials are required.

Ready means the generated page loaded, the review layer booted and the expected
fixture is present. The spec calls `booted(page)` before typing. The seed is
usable from empty state; it needs no account, database or existing human review.

## Doctor

Before a run, `npm run check:layer` is the read-only build check. Confirm that no
other browser suite is running before starting a checkpoint run.

For a live world created with `makeWorld`, this read-only check confirms the
expected document, booted layer and service-owned review. Run it before a custom
drive and again after surprising behavior:

```js
const { expect } = require('@playwright/test');
const fs = require('node:fs');
const path = require('node:path');
const record = JSON.parse(fs.readFileSync(path.join(world.stateDir, 'service.json'), 'utf8'));
process.kill(record.pid, 0);
expect(page.url()).toBe(world.open);
await expect(page.locator('h1')).toHaveText('Spike doc');
expect(await page.evaluate(() => !!(window.__lahe && window.__lahe.booted))).toBe(true);
expect(fs.existsSync(path.join(world.reviewDir, 'meta.json'))).toBe(true);
expect((await fetch('http://127.0.0.1:' + record.port + '/lahe/v1/health')).ok).toBe(true);
```

An empty review may not have `review.json` until its first item is projected;
check its registration (`meta.json`) here. Use the actual fixture heading for
other journeys. Ownership comes from the
new state directory and the CLI launched from this checkout, not a response
from the human's helper. A healthy process is insufficient when the page is
wedged: close that world and relaunch the same journey in fresh state. Preserve
the failed run's evidence before retrying. Never silently mark it passed.

## Drive

Use the map's exact spec and user action. Read that spec before changing it.
For the seed journey, the reviewer enters edit mode with
`ControlOrMeta+Shift+KeyE`, types new blocks after
`main > section:first-of-type > p:first-of-type`, applies bold with the real
toolbar button and commits with Escape. The scripted agent reads the real
`review.json`, writes the source and answers with `lahe reply`. The page must
reload itself and show the new blocks once, with their formatting, including
after a reviewer reload. The handled check must agree.

Lahe's rail uses a closed shadow root. Existing helpers read geometry through
`window.__lahe` and click the real button with `page.mouse`; normal page controls
use locators. Reading state or locating a button through a hook is fine.
Calling internal setters to create the outcome is not user-path proof.
Selection/caret helpers are acceptable setup, but the actual typing, commit,
press and navigation must use browser input. A stub agent proves the protocol,
not an actual Claude or Codex host wake.

When fixing a bulletin-board item, record the expected user-visible result,
reproduce it, change the code, and rerun the relevant journey. Preserve a failing
assertion instead of weakening it to fit a regression. Follow the existing
gate policy before PR or merge; this focused run is not the full gate.

## Evidence

Keep the command, checkout SHA, dirty diff, runtime/platform, actual result and
coverage limits together. `--trace on` retains browser actions and snapshots
even on success. Open a saved trace with `npm exec -- playwright show-trace`
and its trace path. Screenshots alone cannot prove an edit reached the agent.
The seed's assertions also check `review.json`, the drain, source placement,
the rebuilt page and the handled reply. Preserve logs that identify any failed
assertion. Capture screenshots when visual behavior changes.

Record each mapped entry point as passed, failed, blocked by a named prerequisite,
or not run. A seed passing does not certify the whole feature map. Keep output
outside the harness's disposable run root. Verify the trace still exists after
the command returns. Do not commit real review tokens or personal documents.

## Cleanup

`closeWorld(world)` closes the session and awaits `stopTempHelpers(world.stateDir)`
in `afterEach`. Browser fixtures close their contexts. The Playwright global
teardown detects and stops remaining helpers owned by this run, then fails the
run if it found a leak. Inspect that failure even when assertions passed.
Use `try/finally` for custom drives and stop only processes owned by their state
directory. Never kill by name or touch the shared human helper.

Count helper processes before and after with the repo's documented command:
`ps -axo command | grep -c '[l]ahe.js serve'`. Investigate an increase; use the
run-owned guard to distinguish another agent's process. On Windows that guard
does not establish process cleanup, so do not claim that platform proved.
Leave proof artifacts intact. Do not run removal commands during agent work.

## Maintenance and origin

Use [maintain-verification-skill](../maintain-verification-skill/SKILL.md) to
refresh the map against source and live journeys. Add a feature when a new
user path lands; update its commands when the harness changes.

Created using Lauren Tan's pstack
[create-verification-skill](https://github.com/cursor/plugins/blob/main/pstack/skills/create-verification-skill/SKILL.md)
and its feature-map shape. This repo uses `skills/` as the canonical source,
with project-local host discovery links, rather than a Cursor-only location.
