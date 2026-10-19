# Testing

## Charter

**What belongs:** How testing works: what runs, how to run it and what counts as green. The commands for each test layer. What the CI gate runs. Setup a new builder needs.

**What does not:** Why a feature was built a certain way. Test cases for one feature.

**Level of detail:** Commands and short notes. Enough to run every suite.

**Describes:** the test folders and CI config

**Sources:**

- [the CI workflow](../../.github/workflows/gate.yml)
- [package.json](../../package.json)
- [the Playwright config](../../playwright.config.js)
- [the test folders](../../test/)
- [the browser harness README](../../test/helpers/README.md)
- [the lint script](../../scripts/lint.js)
- [the leak-check wrapper](../../scripts/no_stray_helpers.js)
- [the menu bar check](../../scripts/check_menubar.js)
- [.nvmrc](../../.nvmrc)
- [CLAUDE.md](../../CLAUDE.md)

## Short version

Run `npm run gate:unit` while you work. Green means it prints no failures and exits 0. The browser suite runs once per checkpoint, by the orchestrator. The rules for who runs what live in [CLAUDE.md](../../CLAUDE.md); this page is the reference for the commands.

## The gates

Each gate is a chain of the layers below it.

| Command | lint | `check:layer` | `check:menubar` | unit | browsers |
| --- | --- | --- | --- | --- | --- |
| `npm run gate:unit` | yes | no | no | yes | none |
| `npm run gate:builder` | yes | no | no | yes | Chromium |
| `npm run gate` | yes | yes | yes | yes | Chromium |
| `npm run gate:all` | yes | yes | yes | yes | Chromium, Firefox, WebKit |

- A builder runs `npm run gate:unit`.
- The orchestrator runs `npm run gate` and `npm run gate:all` at a checkpoint, with no other build or browser run going at the same time.
- Before a pull request, run `npm run gate` on that exact commit and read "0 failed". After a merge, pull main and run it again.

## Each layer

| Layer | Command | What it checks |
| --- | --- | --- |
| Lint | `npm run lint` | Syntax of every tracked `.js` file, no jsdom anywhere, and every file under `src/` listed once in `src/shared/manifest.js`. |
| Bundle | `npm run check:layer` | The committed `dist/lahe-layer.js` matches a fresh build. |
| Menu bar app | `npm run check:menubar` | Builds the Mac menu bar app, runs its self-test and its tests against a fake helper. Skips with one line off macOS. |
| Unit | `npm run test:unit` | `node --test test/unit/`, wrapped to fail if a helper is left running. |
| Browser, Chromium | `npm run test:browser` | The Playwright suite in `test/browser/`, Chromium only. |
| Browser, three engines | `npm run test:browser:all` | The same suite on Chromium, Firefox and WebKit. |

Other commands you may need:

- `npm run build:layer` rebuilds `dist/lahe-layer.js`. Do not commit it as a builder; the orchestrator does that once per checkpoint. Put it back with `git checkout -- dist/lahe-layer.js`.
- `npm run docs:tests` regenerates the [test index page](../tests/index.html), which lists every test and what it claims. Every number on it comes from the script.

## Run one spec

A builder whose change is browser-only may run one named spec file, never the whole suite:

```
npx playwright test test/browser/<file>.spec.js
```

Run a single engine by name:

```
LAHE_ALL_BROWSERS=1 npx playwright test --project=webkit test/browser/<file>.spec.js
```

Run one unit file:

```
LAHE_DIRECT_LAUNCH=off node --test test/unit/<file>.test.js
```

Notes on the browser run:

- The default is Chromium only. This keeps the inner loop one browser wide.
- The config uses 4 workers. `LAHE_WORKERS=<n>` overrides it on a machine with room to spare.
- Each test has a 90 second limit. That is headroom for specs that start a real helper, a fixture server and a browser. Waits inside a test are condition polls, not sleeps.
- `LAHE_DIRECT_LAUNCH=off` keeps a helper under test from opening a real Terminal window. The npm scripts and the config set it for you.
- `LAHE_PAGES_PORT` defaults to `0` in the config, so each helper under test serves pages on a free port.
- `npm run test:unit` sets `LAHE_MARKDOWN_ENGINE=marked`, so Markdown expected strings do not depend on whether the machine has pandoc. `test/unit/pandoc_render.test.js` and `test/browser/markdown_pandoc.spec.js` ask for pandoc by name and skip, saying why, without it. `LAHE_PANDOC=none` makes a machine with pandoc act as one without it, which is how the missing-pandoc notice is tested. CI has no pandoc on purpose: it proves a clean clone works, which is the fallback path; the pandoc tests run in the local `npm run gate`.
- A failure seen while another build or browser run was going is rerun alone before anyone calls it real or a flake.

## What CI runs

[The workflow](../../.github/workflows/gate.yml) is named `gate`. It runs on Node 20 on `ubuntu-latest`, with no install step, and runs three commands:

- `npm run lint`
- `npm run check:layer`
- `npm run test:unit`

It runs on pushes to `main` and on pull requests. A push that changes only `docs/**`, `**/*.md` or `.claude-commit*` files does not trigger it.

These run only on your machine:

- the browser suite, on one engine or three
- `npm run check:menubar`
- the idle and cost measurements in `scripts/` (`measure_*.js`)

The reasons are in [CLAUDE.md](../../CLAUDE.md), under "CI runs mail Ken". In short, the browser suite took too long on the GitHub runner, and each failed run emails Ken.

## Setup for a new builder

- Node 20 or newer. `.nvmrc` says `20.19.0`; run `nvm use`. The tool itself runs on Node 18.2 or newer (`engines.node` is `>=18.2.0`), but Playwright 1.62 needs Node 20 for the browser suite.
- `npm install` in a fresh clone or worktree, then `git checkout -- package-lock.json`. A worktree under the clone finds the clone's `node_modules`, but `install_walk_3b.spec.js` fails on its precondition without its own install.
- `npx playwright install chromium` once.
- `npx playwright install firefox webkit` once, if you will run `gate:all` or a named lane.
- `npm run install-cli` to put `lahe` on your PATH. Use this, not `npm link`.

## Leak check

A test stops every process it starts. Two checks enforce this:

- The unit suite runs under `scripts/no_stray_helpers.js`, and the browser suite has a Playwright global teardown. Each run gets its own temp folder, and the run fails if a helper or page server naming that folder is still running.
- A builder also counts helpers by hand, before and after its test runs, and reports both numbers:

```
ps -axo command | grep -c "[l]ahe.js serve"
```

Anything above the starting count is a leak to fix before pushing. Never kill by name or port, and never touch the real helper on port 7817. Details are in [CLAUDE.md](../../CLAUDE.md) under "Tests leave nothing running".

## Test folders

- `test/unit/` holds `node:test` unit tests, named `*.test.js`.
- `test/browser/` holds Playwright specs, named `*.spec.js`. `test/browser/support/` holds the global teardown and page helpers.
- `test/helpers/` is the shared browser harness. Specs import it once: `require("../helpers")`. Its [README](../../test/helpers/README.md) explains the two enforced rules: no jsdom, and no arbitrary sleeps.
- `test/fixtures/` holds the static pages, servers and sample data the tests review. Fixtures use made-up styles; the paid Lahe Styles never enter the repo.

## Reading the result

Run the suite as its own command, read the pass and fail counts, then push as a separate step. Never chain a push behind a test run. Put the counts in a pull request body, for example "npm run gate: N passed, 0 failed", with the numbers the run printed.

## Never remove files while work is running

Tests and builders do not run `rm`, `git clean` or similar. Note what you would remove under "To delete at cleanup" and leave it. Test code may remove its own temp files. See [CLAUDE.md](../../CLAUDE.md) for the full rule.
