# 0C builder notes: the app fixture

Branch `task/0c-fixture`, worktree `../lahe-worktrees/0c`. Status: **done, gate green.**

## What was built

`test/fixtures/app/`, a zero-dependency Node app that behaves like the dev server a reviewer walks.
Nothing under `test/helpers/` and nothing in `test/fixtures/assets/repaint-engine.js` was touched, so
0B's work in its own worktree cannot collide with this.

| File | What it is |
| --- | --- |
| `test/fixtures/app/server.js` | `startAppServer()`. node:http only, ephemeral port, in-memory state (session, saved notes, feed cursor). Routes: `/`, `/clients`, `POST /clients/notes`, `/login` (GET and POST), `/reports`, `GET /api/feed`, `/assets/*` |
| `test/fixtures/app/pages.js` | Server-rendered HTML. Nav links carry the fixture's own query knobs (`morph`, `poll`) so a walk keeps its flavor |
| `test/fixtures/app/data.js` | The content: four clients, three reports, four rotating feed lines per region. Real coaching-app writing, never lorem ipsum, because 1C mints anchors off this text and filler has none of the accidental repetition that makes uniqueness hard |
| `test/fixtures/app/assets/app.js` | The page's own click handler (`#log-session`) plus the `window.__app` namespace and counters. Deliberately separate from the harness's `window.__lahe` |
| `test/fixtures/app/assets/morph-engine.js` | The poll-and-morph engine, two flavors |
| `test/fixtures/app/assets/app.css` | The app's own look, so D8 ("the library changes nothing about how the page looks") has something to be true about |
| `test/browser/app_fixture.spec.js` | The walking spec, six tests |

### The three pathnames, and the gate on the third

`/` (dashboard), `/clients`, `/reports`. Ordinary anchors between them, no intercepted clicks: browse is
fully native (D3). `/reports` with no session redirects to `/login?next=/reports`; a wrong password
re-renders the login screen with a visible reason; the right one sets a session cookie and lands on
`/reports`. The clients page carries a real form that POSTs, redirects, and renders the saved note back
out of server state, so it survives a reload.

### The two morph flavors, switched with `?morph=`

- **`hooked`** (default): a per-element morph. The element node survives and its contents are rewritten,
  which is what idiomorph, and therefore Turbo, actually does. Two ways to be told no, checked in this
  order: the cooperative-skip attribute `data-app-permanent` (standing in for `data-turbo-permanent`),
  then the cancelable, bubbling `app:before-morph-element` event (standing in for
  `turbo:before-morph-element`). `preventDefault()` skips that one element and the rest of the frame
  re-renders around it.
- **`raw`**: no hook at all. `container.innerHTML = html`, wholesale. The attribute means nothing, no
  event fires, and every node inside is destroyed including the text node a caret was living in. Ranked
  test 1 (typed text does not revert) needs both, and a fixture that only ever offered the polite path
  would let a library pass by being polite back.

Instruments: `window.__app.counters.{feedPolls, morphPasses, morphedElements, morphsSkipped,
sessionClicks}` and `window.__app.morph.{flavor, intervalMs, start, stop, pollNow, polling}`.
Poll period is `?poll=<ms>`, default 250.

The server's feed cursor advances on every poll, so consecutive renders genuinely differ. A morph that
quietly did nothing cannot pass as one that ran.

### No arbitrary sleeps

Every wait in the spec is `pollPage` (through `test/helpers/poll.js`) on the fixture's own
`morphPasses` counter, or Playwright auto-waiting. The one timer is the `setInterval` inside the fixture
page, which is the application's own behavior; `test/unit/no_arbitrary_sleeps.test.js` already skips
`test/fixtures` for exactly that reason, and the whole unit suite is green.

## The test written first, watched failing

The spec was committed before the fixture existed (commit `6e55466`) and run against nothing:

```
Error: Cannot find module '../fixtures/app/server'
Require stack:
- /Users/kennethstclair/Documents/workspace/lahe-worktrees/0c/test/browser/app_fixture.spec.js
   at app_fixture.spec.js:21

  19 | const { test: base, expect } = require("../helpers");
  20 | const { pollPage } = require("../helpers");
> 21 | const { startAppServer } = require("../fixtures/app/server");
     |                            ^
Error: No tests found.
```

## The tests fail without the behavior, demonstrated

Two one-line deliberate reverts, each run and then undone.

**Revert 1: the cooperative-skip attribute stops being honored.** `if (existing.hasAttribute(PERMANENT_ATTRIBUTE)) {`
became `if (false) {`.

```
    Timeout:  5000ms
    Call log:
      - Expect "toHaveText" with timeout 5000ms
      - waiting for locator('#feed-coach-note')
        4 x locator resolved to <article class="feed-item" id="feed-coach-note" data-app-permanent="">Tom goes quiet every spring. Send the short versi...</article>
          - unexpected value "Tom goes quiet every spring. Send the short version of the check-in, not the long one."

      132 |     const skippedBefore = await page.evaluate(() => window.__app.counters.morphsSkipped);
      133 |     await waitForMorphPasses(page, 2);
    > 134 |     await expect(page.locator("#feed-coach-note")).toHaveText("TYPED BY THE REVIEWER, must not be replaced");
          |                                                    ^

  1 failed
    [chromium] > test/browser/app_fixture.spec.js:113:3 > the hooked flavor morphs the feed, and honors both of its escape hatches
  5 passed (7.0s)
```

**Revert 2: the no-hook flavor stops being no-hook.** The flavor branch in `applyFeed` was replaced with
an unconditional `morphHooked(incoming);`, so `raw` became polite.

```
           - unexpected value "TYPED BY THE REVIEWER, and this flavor does not care"

      178 |     // Content replaced wholesale.
      179 |     await expect(page.locator("#feed-latest")).not.toHaveText(before);
    > 180 |     await expect(page.locator("#feed-coach-note")).not.toHaveText(
          |                                                        ^

  1 failed
    [chromium] > test/browser/app_fixture.spec.js:158:3 > the no-hook flavor replaces innerHTML and offers nothing to hold onto
  5 passed (6.1s)
```

Both reverts were undone from a copy taken before the edit, and the gate below was run afterward on the
restored file.

## Gate output

`npm run lint && npm run test:unit && npm run test:browser`, run in one turn on the restored tree.
`check:layer` is omitted per the plan's dist rule; `dist/` is untouched and uncommitted.

```
> node scripts/lint.js
lint passed (77 files checked)

1..117
# tests 117
# suites 0
# pass 117
# fail 0
# cancelled 0
# skipped 0
# todo 0
# duration_ms 395.7795

  39 passed (6.9s)
```

The six new browser tests, all green:

```
  ✓ walks three pathnames by clicking links, logging in on the way (743ms)
  ✓ the note form submits and the server renders what was saved (583ms)
  ✓ the page's own click handler runs, untouched (546ms)
  ✓ the hooked flavor morphs the feed, and honors both of its escape hatches (1.9s)
  ✓ the no-hook flavor replaces innerHTML and offers nothing to hold onto (667ms)
  ✓ no library is loaded anywhere in the app (497ms)
  6 passed (2.7s)
```

## Notes for whoever picks this up next

- **The app fixture is not wired into `test/helpers/`.** 0B owns that directory and is editing it in a
  parallel worktree, so the spec extends the harness `test` locally with a test-scoped `appServer`
  fixture. If the orchestrator wants `appServer` as a shared harness fixture, that is a one-block move
  into `test/helpers/test.js` after 0B lands, and `startAppServer` is already the seam.
- **The server is test-scoped on purpose.** It holds a session, saved notes, and a feed cursor, so a
  worker-shared instance would let one test's form submission show up in another's assertions.
- **`/reports` and `/` both carry the feed region**, which gives 3A's per-page grouping two pages with a
  morphing region on one review.
- **The fixture fails loud**: an unknown `?morph=` value throws rather than falling back to the polite
  flavor, and a server error returns 500 with the message rather than a blank page.

## Cleanup needed

Nothing in the repo was superseded or replaced by this task, and nothing was deleted. Two items only:

- `test-results/` in this worktree, written by the two deliberate-revert runs. Already gitignored, so it
  is disk hygiene at worktree teardown, not a repo change.
- `<scratchpad>/morph-engine.orig.js`, the pre-revert copy used to restore the engine. Outside the repo.
