# CLAUDE.md: live-agentic-html-editor

A zero-runtime-dependency Node service plus a vanilla JS review layer that
gets injected into an HTML page. A reviewer comments on and directly edits
the page; everything goes to their coding agent. See
`docs/features/20260812.01_live_agentic_html_editor/` for the brief,
architecture, and plan. Read the architecture doc before touching `src/`;
it pins the design decisions (D1-D12) that every component below has to
honor. Some code in `src/` predates the current architecture (it was built
against an archived draft with different decision numbering); where code
and the architecture doc disagree, the doc wins and the code is what
changes.

## Zero runtime dependencies (hard rule)

The tool must run from a `git clone` with no install step: no npm install,
no lockfile resolution, nothing fetched at runtime. `dependencies` in
`package.json` stays `{}`, always. This is why the audience (someone
running a coding agent) can point their agent at this repo and have it
work immediately, and why a stray dependency can't break on a machine with
no network access or a locked-down npm registry.

`devDependencies` are fine and expected: they are the test harness
(Playwright), not something the shipped tool needs at runtime.

## Node version

`engines.node` is `>=20.0.0`. Node's built-in test runner (`node:test`) is
what unit tests use; it's stable from Node 20. Playwright 1.62 also
requires Node >=20, which is what pins the floor here. A `.nvmrc` (20.19.0)
is checked in; run `nvm use` if you have nvm.

## Directory layout

```
src/
  service/   Local Node service: auth, event log, projection, HTTP endpoints
  layer/     Vanilla JS review layer (browser-side): overlay, anchor engine,
             item store, edit recorder, replay engine, sync client, in-page
             injection/remount
  shared/    The one place a wire-protocol field name or item-record shape
             is spelled. Both service and layer import from here. If you
             find yourself defining the same shape twice, it belongs here
             instead.
  cli/       The helper's commands (serve, add, the blocking wait)
test/
  unit/      node:test unit tests
  browser/   Playwright tests (Chromium by default, three lanes on gate:all)
  fixtures/  Static HTML pages used as review targets in tests
```

Put new code in the directory that matches its job in the architecture doc,
not wherever is convenient. If nothing fits, that's a sign the architecture
needs an update, not that `src/` needs a new top-level folder.

## Running the gate

**A builder runs `npm run gate:builder`.** Three gates exist and they are not
interchangeable:

| Command | lint | `check:layer` | unit | browsers |
| --- | --- | --- | --- | --- |
| `npm run gate:builder` | yes | **no** | yes | Chromium |
| `npm run gate` | yes | yes | yes | Chromium |
| `npm run gate:all` | yes | yes | yes | Chromium, Firefox, WebKit |

`check:layer` fails when the committed bundle `dist/lahe-layer.js` is stale.
**Builders never commit `dist/`**: it is generated, and four parallel branches
rebuilding it means a machine-generated conflict at every checkpoint. Rebuild it
locally if you need it for a browser test, but do not stage it. The orchestrator
rebuilds and commits it once per checkpoint, then runs `gate` and `gate:all`.

`lint` is three checks, not just syntax: `node --check` over every tracked `.js`
file, **no jsdom** (not in `package.json`, not imported anywhere under `test/`),
and **manifest completeness** (every file under `src/` appears exactly once
across `src/shared/manifest.js`'s lists). `npm run test:unit` and
`npm run test:browser` also run individually.

Browsers install once: `npx playwright install chromium`, plus
`npx playwright install firefox webkit` for the lanes. A bare `playwright test`
is Chromium only, so the inner loop stays one browser wide; `--project=webkit`
runs a single lane by name.

## Platform and browser target

Cross-platform: macOS, Linux, and Windows all run the helper (standard
Node), and the layer is standard DOM APIs that current Chrome, Edge,
Safari, and Firefox all support. The one capability floor is the CSS
Custom Highlight API, stated with its reason in the architecture doc. The
Playwright suite has all three lanes (Chromium, Firefox, WebKit) and runs them
on `npm run gate:all` at every checkpoint; a builder's default run is Chromium,
which is a loop-speed choice rather than a support statement.

## Commit conventions

- No em dashes anywhere: not in commit messages, not in code comments, not
  in docs. Use a comma, period, colon, or semicolon instead.
- Commit messages describe why, not just what changed.
- Don't touch `docs/features/20260812.01_live_agentic_html_editor/` without
  reason; those files are the source of truth for the design and may be
  under active edit by someone else.

## Where the design lives

`docs/features/20260812.01_live_agentic_html_editor/` has the brief,
architecture, and plan. The architecture doc's Key Decisions (D1-D12) are
binding: they resolved specific blockers found in review (protected
regions and replay, the per-review token model, path-safety rules,
prompt-injection fencing). Don't re-litigate a decision in code without
updating the doc first. Files prefixed `archive_` in the feature folder
are historical drafts, never current design.
