# 0B: harness rescope, instruments, and lanes

Branch `task/0b-harness`. This is the first pass: everything that does not read
0A-kernel's new vocabulary. The stub-vocabulary rescope (`test/helpers/stub.js`
and `test/fixtures/assets/harness-stub.js` renamed to the new gesture and
edit-state words) waits for 0A-kernel and is not done here.

## What was built

### 1. The service helper follows the per-review credential (`test/helpers/service.js`)

- **Readiness file shape.** `service.json` is now
  `{ port, pid, reviews: { "<id>": { token } } }`. The reviews map is part of the
  readiness signal, not an extra: a helper that is listening but has not written
  its credentials is not ready for anything a test does next.
- `handle.tokenFor(id)`, `handle.itemsUrlFor(id)`, `handle.reviewIds`.
  `handle.token` still works and means "the token when there is exactly one
  review"; with two open it **throws** rather than handing back whichever came
  first, because a test that authenticates against the wrong review passes for
  the wrong reason.
- **`readEventLog` moved to `reviews/<id>/events.jsonl`.** It also throws when the
  state directory holds several reviews and no id was named. Reading the wrong
  path returns an empty array, and an empty array is exactly what a passing
  refusal assertion looks like, so this reader must never guess.
  `readEventLogRaw` is there for a durability test that means to look at a torn
  last line.
- **`suspend()` / `resume()`** (SIGSTOP / SIGCONT), each waiting until the OS
  itself reports the state change (`ps -o state=`, `T` for stopped) rather than
  assuming the signal landed. A suspended helper accepts the socket and never
  answers, which is a different failure from a dead one, and a sync client
  written only against `kill9` blocks the reviewer on it.
- `test/fixtures/servers/stub-service.js` kept in step: per-review tokens, review
  ids constrained to a safe character set (they are path components), the route
  moved to `POST /reviews/<id>/items`, and per-review log files.

### 2. Assertions (`test/helpers/assertions.js`)

- **`minReplayPasses` is now REQUIRED on `assertNoSecondWrite`**, and the
  assertion itself throws when the counter did not move enough. It used to be one
  hand-written line in one self-test, which made the plan's own law a matter of
  builder discipline. A paused replay engine now cannot pass an idempotence
  assertion.
- **New: `assertCaretRestoredAcrossRepaints`**, protection layer three. Text reads
  exactly as expected **after every repaint** (not only at the end), the caret is
  at the same character offset inside the node now holding those characters, the
  caret's node is connected and in the region, and the restore counter
  incremented. `assertCaretSurvivesTyping` is untouched and stays the bar for the
  cooperative-skip and veto layers.
- The self-test proves the split empirically:
  `assertCaretSurvivesTyping` **fails** on the same page where layer three is
  working correctly, which is the whole reason the second assertion exists.

### 3. The repaint engine grew two flavors (`test/fixtures/assets/repaint-engine.js`)

- A cancelable `lahe:before-morph-element` on every element it is about to touch
  (standing in for `turbo:before-morph-element`), counted as `elementVetoes`.
- A cooperative-skip attribute `data-lahe-permanent` (standing in for
  `data-turbo-permanent`), honored by carrying the live element across a rebuild,
  counted as `elementsSkippedCooperative`. Separate from the veto on purpose:
  they are two different framework features and a builder can do one and believe
  they did both.
- A **no-hook flavor**: `innerHTML` replaced wholesale, no event, no attribute, no
  veto. Switchable with `?repaint=no-hook` in the URL (before any script runs) or
  `configureFixture(page, { hooks: "off" })`.

### 4. Lanes and gates

- `playwright.config.js` has `chromium`, `firefox`, `webkit`. A bare
  `playwright test` stays Chromium only; `--project=<name>` and
  `LAHE_ALL_BROWSERS=1` are the two ways out of the narrowing.
- `gate:builder` (lint, unit, Chromium; **no** `check:layer`), `gate:all` (all
  three lanes), `test:browser:all`.

### 5. `scripts/lint.js` has two real checks

- **No jsdom**: not in `package.json` (any dependency section), and no
  `require`/`import` of it anywhere under `test/`. Matched against the module
  specifier, so prose in a comment does not trip it.
- **Manifest completeness**: every file under `src/` appears exactly once across
  the lists `src/shared/manifest.js` exports. Read **generically** (every exported
  array, a path pulled from each entry) because 0A-kernel is rewriting that file
  in parallel and a check bound to `LAYER_FILES` and `NON_BUNDLE_FILES` would have
  to be rewritten with it.
- All three checks run before the script exits, so one failure does not hide the
  other two.

### 6. Docs

- `test/helpers/README.md`: swap-point list is five items now (the restore counter
  joins the counter contract, the protection markers table names all three
  renameable things, and the service entry carries the new readiness shape). Plus
  the hook flavors, the three hard assertions, and four new known gaps.
- `CLAUDE.md`: the gate section is now a table of all three gates including
  `check:layer` and the never-commit-`dist/` rule, and the browser-target section
  says three lanes rather than Chromium only.

## The demonstrated lint failure

TDD, as required: the check was written, then watched to fail.

**A deliberate jsdom require added to `test/unit/sanity.test.js`:**

```
> node scripts/lint.js

lint [no-jsdom] FAILED
jsdom is banned in this project, in package.json and anywhere under test/.
It has no layout, no caret rectangles, no CSP enforcement and no real key
events, so every assertion that catches the symptoms this tool exists to fix
is impossible in it. Write the test as a real browser test instead.

  test/unit/sanity.test.js:17  const { JSDOM } = require("jsdom");
```

**And the package.json half, with `jsdom: ^24.0.0` added to devDependencies:**

```
lint [no-jsdom] FAILED
...
  package.json devDependencies declares jsdom
```

Both were removed immediately after (the deliberate require was a line this task
added; nothing pre-existing was touched).

## Gate output

### `npm run gate:builder`: lint FAILS, on the manifest check, by design

```
> npm run lint && npm run test:unit && npm run test:browser
> node scripts/lint.js

lint [manifest] FAILED
Every file under src/ must appear exactly once across the manifest's lists (LAYER_FILES, NON_BUNDLE_FILES).

  NO OWNER (on disk, not in the manifest):
    src/service/state_dir.js
    src/shared/contracts.js

  EXPECTED TO PASS AFTER 0A-kernel. The manifest in the repo today was written
  against the archived draft and is being rewritten against the plan's ownership
  table by 0A-kernel, who owns this file. Until that lands this check fails, and
  it fails loudly on purpose: skipping it is how a file with no owner ships.

lint failed: manifest
```

**This is the instructed behavior, and it is worth being explicit about the
tension.** The plan's done bar for 0B says `gate:builder` is green. The
manifest-completeness check it also asks for fails against today's
`shared/manifest.js`, which is missing `src/shared/contracts.js` and
`src/service/state_dir.js`. `shared/manifest.js` is 0A-kernel's file, being
rewritten in a parallel worktree right now, so 0B does not edit it: a two-line
patch here would be a guaranteed conflict on a file that is about to be replaced
wholesale. The check fails loudly rather than skipping, because a skipped
completeness check is how a file with no owner ships. **It goes green when
0A-kernel's rewritten manifest lands**, which is before any Phase 1 builder
starts.

Everything else in the gate is green, run separately:

### `npm run test:unit`

```
1..120
# tests 120
# suites 0
# pass 120
# fail 0
# cancelled 0
# skipped 0
# todo 0
# duration_ms 1095.240708
```

### `npx playwright test` (Chromium, the default lane)

```
  ✓  32 [chromium] › harness_selftest.spec.js:781 › assertCaretRestoredAcrossRepaints › throws when nothing restores, and names the keystroke the text was lost at (12.5s)

  43 passed (15.3s)
```

### `npm run test:browser:all` (all three lanes)

```
  ✓  118 [webkit] › harness_selftest.spec.js:781 › assertCaretRestoredAcrossRepaints › throws when nothing restores, and names the keystroke the text was lost at (12.7s)

  129 passed (29.1s)
```

## Lane status: no deferral needed

**All three lanes are green.** The timebox was not spent. One failure appeared on
the first three-lane run, and it was a harness bug rather than a product
difference, so it was fixed rather than skipped:

```
1) [firefox] › CSP fixtures › a real script-src header stops the layer from loading at all
   Expected pattern: /Content Security Policy|Refused to (load|execute)/i
   Received string:  "Content-Security-Policy: The page's settings blocked an inline script..."
```

Three browsers, three wordings for the same refusal. The pattern now covers all
three. The load-bearing assertions in that test are the two above it (the page's
own script and the layer both failed to run at all), and neither was touched.

## Two things worth knowing, found the hard way

**1. The stub's blur-commit was hiding protection layer three completely.** A
repaint that destroys the focused region fires `blur`. The stub committed a
record there, and replay then wrote that record straight back into the page. The
text looked repaired, the restore never ran, `caretRestores` stayed at zero, and
the region came back without its editing surface so every keystroke after the
first one went nowhere. The layer under test was scoring full marks for someone
else's work. Fixed two ways: `commitOnBlur` is now a stub config knob the
layer-three tests switch off, and `onBlur` ignores a blur on a disconnected
element. **The real layer has the same trap:** a commit is the reviewer leaving a
region, not the framework yanking the node out from under them. 2A should be told.

**2. Layer three cannot hold a node reference or attach an observer to the
region.** The no-hook repaint replaces the whole frame's `innerHTML`, so the
region element itself is destroyed, not just its children. The first version of
the stub kept snapshots in a `WeakMap` keyed by element and observed each region:
both died on the first repaint and silently stopped restoring. It is now keyed by
region name with one document-level observer, and the restore re-establishes the
editing surface (the stub's version of the remount contract). 2B will hit this
exactly.

## Files changed

```
CLAUDE.md
package.json
playwright.config.js
scripts/lint.js
test/browser/harness_second_origin.spec.js
test/browser/harness_selftest.spec.js
test/fixtures/assets/harness-stub.js
test/fixtures/assets/repaint-engine.js
test/fixtures/servers/stub-service.js
test/helpers/README.md
test/helpers/assertions.js
test/helpers/repaint.js
test/helpers/service.js
test/unit/harness_service.test.js
```

`test/browser/harness_second_origin.spec.js` is 1A's file and was touched only to
follow the stub service's new route: `service.url + "/items"` became
`service.itemsUrl`. Nothing about what it asserts changed.

## Still to do (waits on 0A-kernel)

- Rescope `test/helpers/stub.js` and `test/fixtures/assets/harness-stub.js` to the
  new vocabulary: enter edit state on a block, protect, release, commit, mark
  ready. Both halves of every self-test, including the negative halves, come with
  it.
- `test/unit/harness_service.test.js` may need a second pass if 0A-wire pins a
  different route or header spelling than the stub currently uses.

## Cleanup needed

Nothing was deleted. These are for the Phase 4B batch:

- `debug_layer3.tmp.js` (repo root) - throwaway probe for the layer-three
  investigation. Untracked, never committed.
- `probe.tmp.js` (repo root) - same.
- `test-results/` and `playwright-report/` - Playwright output, already ignored.

The plan's own Cleanup needed list (`test/fixtures/sample.html`,
`test/browser/sample.spec.js`, the six cut `src/` files) is unchanged by this
task. Note that `test/browser/sample.spec.js` still runs and still passes on all
three lanes; it is a cut, not a break.
