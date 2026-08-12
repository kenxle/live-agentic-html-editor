# CLAUDE.md: live-agentic-html-editor

A zero-runtime-dependency Node service plus a vanilla JS review layer that
gets injected into an HTML page. A reviewer comments on and directly edits
the page; everything goes to their coding agent. See
`docs/features/20260812.01_live_agentic_html_editor/` for the brief,
architecture, and plan. Read the architecture doc before touching `src/`;
it pins the design decisions (D1-D16) that every component below has to
honor.

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
  cli/       The agent surface: `open`, `next`, `ack`, `setup`
test/
  unit/      node:test unit tests
  browser/   Playwright tests (Chromium only)
  fixtures/  Static HTML pages used as review targets in tests
```

Put new code in the directory that matches its job in the architecture doc,
not wherever is convenient. If nothing fits, that's a sign the architecture
needs an update, not that `src/` needs a new top-level folder.

## Running the gate

```
npm run gate
```

Runs lint, unit tests, and browser tests, in that order, and exits non-zero
on any failure. Run it before every commit that touches `src/` or `test/`.
`npm run lint`, `npm run test:unit`, and `npm run test:browser` also run
individually.

Browser tests need Chromium installed once: `npx playwright install
chromium`.

## Platform and browser target

v1 targets macOS and Chromium only. Don't add cross-browser code paths or
Windows/Linux-specific handling until the architecture doc says v1 is
expanding scope. A second browser or OS is a scope decision, not a
drive-by addition.

## Commit conventions

- No em dashes anywhere: not in commit messages, not in code comments, not
  in docs. Use a comma, period, colon, or semicolon instead.
- Commit messages describe why, not just what changed.
- Don't touch `docs/features/20260812.01_live_agentic_html_editor/` without
  reason; those files are the source of truth for the design and may be
  under active edit by someone else.

## Where the design lives

`docs/features/20260812.01_live_agentic_html_editor/` has the brief,
architecture, and plan. The architecture doc's Key Decisions (D1-D16) are
binding: they resolved specific blockers found in review (replay's three
laws, the authentication model, path-safety rules, prompt-injection
fencing). Don't re-litigate a decision in code without updating the doc
first.
