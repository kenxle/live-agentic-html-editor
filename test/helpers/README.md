# The browser test harness

Every browser test in this project is written against this module. Import it once:

```js
const { test, expect, typeInto, assertCaretSurvivesTyping } = require("../helpers");
```

That gives you Playwright's `test` and `expect` with the fixture servers already
running, plus everything below.

The tool this project replaces has **no browser-level test at all**, and every
symptom it produced lives in the part that has none. This harness is the thing
that stops us repeating that, so two rules are enforced rather than suggested:

- **No jsdom.** It has no layout, no caret rects, no CSP enforcement, and no real
  key events, so every assertion that would catch the three symptoms is
  impossible in it. A real browser through this harness, or it does not count.
  `scripts/lint.js` enforces this: no jsdom in `package.json`, and no require or
  import of it anywhere under `test/`.
- **No arbitrary sleeps.** Every wait is a condition poll or a counter read.
  `test/unit/no_arbitrary_sleeps.test.js` scans every JS file under `test/` and
  fails the gate on a sleep. A flaky browser test gets its determinism fixed,
  never its assertion loosened.

## Which browsers, and which gate

Three Playwright projects: `chromium`, `firefox`, `webkit`. A bare
`playwright test` runs **Chromium only**, so a builder's loop stays one browser
wide; `--project=webkit` runs one lane by name when you are debugging it.

**`--project` needs `LAHE_ALL_BROWSERS=1` alongside it.** On its own it fails with
`Project "<name>" not found in the worker process`: the config reads `process.argv` to
decide which projects exist, and the worker process does not carry the flag. So
`LAHE_ALL_BROWSERS=1 npx playwright test --project=webkit <file>`.

| Command | What it runs |
| --- | --- |
| `npm run gate:builder` | lint, unit, Chromium. **This is the one a builder runs.** No `check:layer`, because builders never commit `dist/`. |
| `npm run gate` | lint, `check:layer`, unit, Chromium. |
| `npm run gate:all` | lint, `check:layer`, unit, all three browsers. The orchestrator's checkpoint gate. |

Firefox and WebKit need their own download once:
`npx playwright install firefox webkit`.

---

## Fixture pages

Served over loopback rather than opened as `file://`, because a `file://` page
has an opaque origin and storage behaves nothing like the case the tool ships
into, and because a real CSP is a response header.

| Page | What it is for |
| --- | --- |
| `built-doc.html` | A static page shaped like a built brief or report: headings, paragraphs, a list, an image, a diagram block. Contains three byte-identical list items and two identical paragraphs in different containers under one heading, which are the anchoring cases Law 1 has to fail closed on. |
| `repainting.html` | A page that re-renders itself on a knob the test controls. Two independent repaint targets, so a test can point the engine at one subtree and assert the other is untouched. |
| `css-reset.html` | An aggressive reset that hides list markers and strips link styling. The D12 case: the tool does not fix the page's appearance, and the artifact keeps looking like the artifact. |
| `csp-probe.html` | Served with a real `Content-Security-Policy` header. Two variants: `block-connect` and `block-script`. |
| `attacker.html` | A page on a second origin, offering the three shapes an attacker actually has. |

Every element a test may target carries `data-region`. The repaint targets carry
`data-repaint-target`.

### The repainting fixture's knobs

```js
await configureFixture(page, {
  target: '[data-repaint-target="live"]',  // which subtree re-renders
  flavor: "turbo-frame",                    // or "react-text", or "morph"
  intervalMs: 200,                          // for startRepaints
  protection: "veto",                       // or "permanent", or "off"
  hooks: "on"                               // or "off", the no-hook flavor
});
```

**Three flavors, because frameworks fail differently.**

| Flavor | What it does | Why it is here |
| --- | --- | --- |
| `turbo-frame` | Replaces the target's children wholesale. | Text nodes are destroyed and the caret dies with them. |
| `react-text` | Writes `nodeValue` in place on every text node. | Node identity survives and the reviewer's text is wiped anyway. A caret assertion that only checks node identity passes here while the edit is gone, which is why the behavioral assertion checks the text too. |
| `morph` | A per-element morph, which is what idiomorph and therefore Turbo actually does. | The strongest one for a caret test: the frame genuinely re-renders around the protected region rather than being skipped wholesale. |

**Three protection modes.** `veto` skips a target containing a protected element,
which is Turbo's `turbo:before-morph-element` veto and the architecture's answer
in D3. Under the `morph` flavor the veto is per element, so only the protected
region and its subtree are left alone. `permanent` carries the protected element
into the new subtree by id, which is `data-turbo-permanent` without the veto.
`off` ignores protection, which is the pre-fix behavior and what the negative
self-tests use.

**Two hook flavors, and ranked test 1 needs both.** Protection ships as three
layers, and the third one exists only because some frameworks offer nothing to
cooperate with. A fixture that always offers a hook cannot tell a three-layer
implementation from a one-layer one.

| Flavor | What the page offers | What it scores |
| --- | --- | --- |
| `hooks: "on"` (default) | A cancelable `lahe:before-morph-element` on every element it is about to touch, and the `data-lahe-permanent` cooperative-skip attribute honored by carrying the live element across. | Layers one and two. |
| `hooks: "off"` | Nothing. `innerHTML` replaced wholesale, no event, no attribute, no veto. | Layer three, and only layer three. |

Pick the no-hook flavor before any script runs with
`fixtureServer.urlFor("repainting.html") + "?repaint=no-hook"`, or switch it at
runtime with `configureFixture(page, { hooks: "off" })`.

The veto event and the cooperative-skip attribute are **two different framework
features** (Turbo's `turbo:before-morph-element` and `data-turbo-permanent`). A
builder can implement one and believe they did both, so the fixture counts them
separately: `elementVetoes` and `elementsSkippedCooperative`.

The fixture holds a "server" snapshot of every candidate target, taken at load,
and writes it back on every repaint. That is deliberate: a repaint engine that
does not actively try to revert what the reviewer typed makes every caret test
theatre. Pointing the engine at a different subtree does not re-snapshot, so a
test cannot accidentally bless whatever it just changed there. Call
`resnapshot(page)` when a change you made really is meant to be what the server
now believes.

---

## The three hard assertions

These are the reason this is a module and not a pile of inline `expect`s. If any
is subtly wrong, every test that leans on it is theatre. Each has a self-test in
`test/browser/harness_selftest.spec.js` with a **negative half** that switches
the behavior off and asserts the assertion throws. Do not delete the negative
halves.

**Why there are two caret assertions.** Protection ships as three layers. The
cooperative-skip attribute and the pre-morph veto both keep the reviewer's text
node alive, so node identity is the right bar and
`assertCaretSurvivesTyping` is it. The snapshot-and-restore layer cannot meet
that bar: it restores text after the repaint destroyed the node it lived in, so
the caret is in a **new node by construction**. Running the node-identity
assertion there produces a failure no correct code can fix, and the likely next
move is that the project's best assertion gets quietly weakened for every other
test too. So layer three has its own assertion, and the node-identity one is left
exactly as it is.

### `assertCaretSurvivesTyping(page, options)`

Plan test #1. Types into the middle of a paragraph while the page repaints under
it, then asserts four things:

1. The paragraph reads exactly `before.slice(0, k) + typed + before.slice(k)`.
   Exactly, not normalized: a repaint that collapsed the reviewer's spacing is a
   failure, and normalizing here would hide it.
2. The caret is in the **same text node, compared by identity**. A turbo-frame
   repaint builds a fresh node holding the same characters at the same path
   inside an element with the same id, so an id or path comparison passes while
   the caret is dead.
3. The caret's offset advanced by exactly the number of characters typed. This is
   what catches the react-text repaint, which keeps the node and wipes it.
4. The replay-pass counter went up by at least `minReplayPasses`. Without this an
   implementation that does nothing at all passes: no replay, no repaint, no
   damage, perfect text.

```js
await configureFixture(page, { protection: "veto", flavor: "turbo-frame" });
await editBlock(page, "live-note");
const result = await assertCaretSurvivesTyping(page, {
  selector: "#live-note",
  text: "0123456789",
  keystrokeDelayMs: 50,
  repaintIntervalMs: 200,
  minReplayPasses: 5
});
```

### `assertCaretRestoredAcrossRepaints(page, options)`

Plan test #1, protection **layer three**. Types into a region on a page with no
hook at all, forcing a repaint after every keystroke, and asserts the
snapshot-and-restore layer put the reviewer's work back every time:

1. The region reads exactly the original text with the typed characters inserted
   at the caret's offset, checked **after every repaint**, not only at the end.
   "No characters were lost" is a claim about the whole run: a restore that drops
   a character and a later keystroke that happens to add one leaves a
   correct-looking final string.
2. The caret is at the same **character offset** inside the region, in whatever
   node now holds those characters. Not the same node.
3. The caret's node is connected and inside the region. A caret restored into a
   detached node reads correctly and is dead.
4. The **restore counter** went up. Text that survived because nothing ever
   damaged it is not layer three working.

```js
await page.goto(fixtureServer.urlFor("repainting.html") + "?repaint=no-hook");
const result = await assertCaretRestoredAcrossRepaints(page, {
  selector: "#live-note",
  text: "0123456789",
  caretOffset: 10,
  minRestores: 10        // default 1
});
```

`restoreCounter` names the counter to read, and defaults to `restores`, which is
what `src/layer/protect.js` calls it.

### `assertNoSecondWrite(page, { selector, action, minReplayPasses })`

Plan test #13. Idempotence stated the only way that catches the bug: **the
absence of a second write, observed through a MutationObserver**, not final-DOM
equality.

**`minReplayPasses` is required**, and there is no default. The absence of a
write proves idempotence only if replay actually ran: a paused engine, a
scheduler that never fired, or an action that quietly did nothing all write
nothing and would otherwise pass. The right number depends on what the action
did, so the caller states it.

Final-DOM equality passes when replay rewrites a region with byte-identical text
on every pass, and that rewrite destroys the caret every time. The observable
difference between "did nothing" and "did the same thing twice" is the mutation
record. The failure message says explicitly whether the final text was unchanged,
because that sentence is the explanation of why the weaker assertion would have
passed.

```js
await assertNoSecondWrite(page, {
  selector: "#live-note",
  message: "replay is idempotent by comparison",
  minReplayPasses: 5,
  action: () => replayTimes(page, 5)
});
```

`allow` filters records a test knowingly expects. Use it sparingly; every allowed
record is a hole.

---

## The API

### Waiting (`poll.js`)

| Function | Notes |
| --- | --- |
| `pollUntil(check, { timeoutMs, intervalMs, message, describe })` | Node-side condition poll. `describe` is called on timeout to add context, which is the difference between a useful failure and a rerun. |
| `pollPage(page, fn, arg, { message })` | Playwright's `waitForFunction` with a readable message. |

This file carries the only `harness-allow-timer:` marker in the harness. If you
are about to add a second, the answer is almost certainly a counter.

### Counters (`counters.js`)

| Function | Notes |
| --- | --- |
| `readCounters(page)` | Every counter the page publishes. |
| `readCounter(page, name)` | One counter, with a useful error listing what does exist. |
| `waitForCounter(page, name, atLeast)` | Poll until it reaches a number. |
| `waitForCounterIncrease(page, name, by)` | Poll until it has gone up by `by` from now. |
| `countersAround(page, action)` | `{ before, after, delta, result }`. |

### Typing (`typing.js`)

| Function | Notes |
| --- | --- |
| `typeInto(page, { selector, text, caretOffset, delayMs })` | Real key events. Focuses without clicking, because a click would place the caret wherever the pointer landed. |
| `focusRegion(page, selector)` | Focus, and fail loudly if the element did not take it. |
| `pressKey(page, key)` | For the gesture table. |

### Caret (`caret.js`)

| Function | Notes |
| --- | --- |
| `placeCaret(page, { selector, offset, textNodeIndex })` | Focus first, then set the selection: the other order silently loses the offset. |
| `captureCaret(page)` | Returns a handle. Node references stay in the page; only a descriptor crosses the wire. |
| `compareCaret(page, handle, { expectedOffsetDelta, rectTolerance })` | Returns a report rather than throwing. |
| `assertCaretUnmoved(page, handle)` | Same node by identity, same offset, same rect within 1px, still connected. |

### Repaint (`repaint.js`)

| Function | Notes |
| --- | --- |
| `configureFixture(page, patch)` | The knobs above. |
| `resnapshot(page)` | The server now believes what the page currently shows. |
| `startRepaints(page, intervalMs)` / `stopRepaints(page)` | The interval. |
| `forceRepaint(page, { flavor, target, protection })` | One repaint, waited for by counter. Throws if the counter did not move, because a vetoed repaint still counts. |
| `forceRepaints(page, n)` | N of them. |
| `waitForRepaints(page, n)` | Wait for the interval-driven engine. |

### Mutations (`mutations.js`)

| Function | Notes |
| --- | --- |
| `observeMutations(page, { selector, options })` | Returns `{ records(), count(), stop() }`. Flushes pending records with `takeRecords()` before reading, which is the difference between a reliable assertion and a race. |
| `recordMutationsDuring(page, { selector, action })` | The common case. |
| `formatRecords(records)` | For failure messages. |

Default observer options are `childList`, `characterData` with old values, and
`subtree`. Turn `attributes` on for the host-stays-clean assertions (AC6) and
pass an `attributeFilter` to keep the noise down.

### Servers (`servers.js`)

| Function | Notes |
| --- | --- |
| `startFixtureServer()` | Static, no CSP. Available as the `fixtureServer` test fixture. |
| `startCspServer("block-connect" \| "block-script")` | A real CSP response header. Available as the `cspServer(variant)` test fixture. |
| `startAttackerServer()` | A second origin, on its own port. Available as the `attackerServer` test fixture. |

All zero-dependency `node:http`, all on ephemeral ports.

**A note for whoever writes the CSP tests.** Playwright's `page.evaluate` is
injected through the debugger, so it runs even under `script-src 'none'`. That
does not weaken the test: assert on whether the *page's own* script ran
(`window.__lahe`), and use `page.evaluate` to drive the fetch probe, whose
`connect-src` enforcement is real either way.

### Service (`service.js`)

| Function | Notes |
| --- | --- |
| `makeStateDir()` | A throwaway state directory. |
| `startService({ entry, stateDir, allowedOrigins, reviews })` | Waits for readiness, twice over. `reviews` names the review ids to open; default one. |
| `handle.tokenFor(id)` | That review's token. `handle.token` is the same thing when there is exactly one review, and throws when there are several. |
| `handle.itemsUrlFor(id)` | `/reviews/<id>/items`. `handle.itemsUrl` for the single-review case. |
| `handle.kill9()` | SIGKILL, and waits until the process is reaped **and** the port stops answering. |
| `handle.suspend()` / `handle.resume()` | SIGSTOP and SIGCONT, each waiting until the OS agrees the process really changed state. |
| `handle.stop()` | SIGTERM. Only for tests that are about graceful shutdown. |
| `readEventLog(stateDir, reviewId)` | One review's parsed log, for effect assertions. |
| `readEventLogRaw(stateDir, reviewId)` | The raw lines, for a test that means to look at a torn one. |

`kill -9` is the interesting half. A graceful shutdown proves nothing about
durability, because the service gets to flush. SIGKILL is what AC3 means.

**Suspend is a different failure from kill, and the library has to tell them
apart.** A killed helper refuses the connection immediately, so the status line
can say kept-locally within one poll. A suspended one accepts the socket and
never answers, which is what a laptop coming back from sleep and a paused
container both look like. A sync client written only against `kill9` blocks the
reviewer here, and nothing in the test suite would notice.

**The token is per review**, so there is no such thing as "the token" when two
reviews are open: `tokenFor` throws rather than handing back whichever came
first, because a test that authenticates against the wrong review passes for the
wrong reason. `readEventLog` throws the same way when the state directory holds
several reviews, because reading the wrong path returns an empty array, and an
empty array is exactly what a passing refusal assertion looks like.

### Contexts (`contexts.js`)

| Function | Notes |
| --- | --- |
| `openTwoContexts(browser, url)` | Two contexts, so separate storage. |
| `openTwoTabs(browser, url)` | Two pages in one context, so **shared** storage. This is the second-tab case D6 says must be refused with a reason. |

A test that means the second and writes the first will pass while the bug it was
written for is still there.

---

## What a builder has to change when the real layer lands

Five things, and only five. Everything else in `test/helpers/` is
harness-owned and does not move.

### 1. The counter contract (`counters.js`)

The real layer must publish, behind whatever test-hooks flag it wants:

```js
window.__lahe.counters.replayPasses    // ++ once per replay pass, written or not
window.__lahe.counters.regionsWritten  // ++ once per region replay wrote to the DOM
window.__lahe.counters.restores        // ++ once per protection-layer-three restore
```

`restores` is 2B's, and it is what `src/layer/protect.js` already calls it. The
same module publishes `marked`, `vetoes`, `snapshots` and `restoreFailures`, and
the stub carries all five under those names so a test reads the same counter
whichever is loaded. `assertCaretRestoredAcrossRepaints` takes `restoreCounter`
if you must call it something else.

`replayPasses` must increment on a pass that wrote nothing. That is what makes it
possible to assert "replay ran five times and wrote nothing", which is the
idempotence test, and what stops a no-op implementation passing the caret test.

The stub publishes several more (`regionsSkippedIdentical`,
`regionsSkippedProtected`, `regionsSkippedCaret`, `regionsBlockedChanged`,
`repaints`, `repaintsVetoed`). Those are diagnostics. Publish them if it is easy;
tests should not fail on their exact values unless that value is the point.

### 2. The replay hook (`stub.js`)

`replayNow(page)` calls `window.__lahe.replayNow()` and expects one synchronous
pass. The real layer schedules replay from a MutationObserver behind a write
epoch, so either expose a synchronous test hook for the same entry point, or
rewrite `replayNow` as "trigger a repaint, then wait on the `replayPasses`
counter". The second is more honest and slower; either is fine.

### 3. The protection markers (`test/fixtures/assets/repaint-engine.js`)

The repaint engine honors three things a builder can rename:

| What | Spelled here as | Standing in for |
| --- | --- | --- |
| The layer's protected-region marker | `data-lahe-protected` | the library's own mark |
| The cooperative-skip attribute | `data-lahe-permanent` | `data-turbo-permanent` |
| The cancelable pre-morph event | `lahe:before-morph-element` | `turbo:before-morph-element` |

If the real layer uses different names, change them in that file, which is the
one fixture on this list. It is here because the fixture has to know what the
app-side veto looks for.

### 4. The whole of `stub.js`

Every function is a shim over `window.__lahe.stub`, and **every name in it is the
kernel's name**, not the harness's. Point each one at the real library's
equivalent:

| Helper | Stands in for |
| --- | --- |
| `editBlock(page, region)` | `GESTURE.EDIT_BLOCK`, Cmd-Shift-E on one block |
| `commitEdit(page, region)` | `GESTURE.COMMIT_EDIT`, Esc or a click outside |
| `markReadyItem(page, region)` | `GESTURE.MARK_READY`, Cmd-Enter on a comment box |
| `protectBlock` / `releaseBlock` / `isBlockProtected` | `protect.mark` / `protect.release` / `protect.isProtected` |
| `layerItems(page)` / `itemFor(page, region)` | the store, returning items in `record.js` shape |
| `replayNow(page)` / `replayTimes(page, n)` | replay's entry point |

**There is no page-wide "make everything editable" any more.** Edit state is per
block and entered deliberately (D3), so a test names the block it means, and a
test that only pokes the DOM gets a page in browse mode. That is not a harness
detail: browse being the page untouched is R13, and a fixture that quietly turned
on `contenteditable` everywhere would let a library that captures every click
pass.

**Order matters in a negative half.** Entering edit state marks the block, so a
test that means "nothing protects this region" calls `configureStub` first and
`editBlock` after.

`configureStub` is stub-only by design. Its knobs are one per protection layer
plus the replay behaviors, so a test can switch off exactly one thing:
`cooperativeSkip`, `veto`, `snapshotRestore`, `idempotent`, `respectCaret`,
`commitOnBlur`. An unknown knob name throws rather than being ignored, because a
typo that silently leaves a behavior on makes a negative half pass for no reason.
When the real library lands, the negative tests either keep using a fixture page
that loads the stub, or get rewritten as the one-line deliberate revert the plan
requires of every builder.

### How the stub stays honest about the vocabulary

The stub does **not** require or bundle the real modules: the fixture server's
root is `test/fixtures`, the built bundle is `dist/lahe-layer.js`, and builders
are forbidden from rebuilding `dist/`, so a harness that loaded the bundle would
make every browser self-test depend on an artifact no builder may refresh.

The cost of that is that the stub holds copies of the kernel's names, and a copy
drifts. The guard is `test/unit/harness_stub_vocabulary.test.js`, which reads the
names out of the stub source and compares them against `src/shared/record.js`,
`src/shared/gestures.js` and `src/layer/protect.js`. Rename a state, a kind, a
gesture, a protection counter, or a record field, and it fails in the unit suite
with both spellings side by side, rather than in a browser test three phases later
with a symptom that looks like a broken assertion.

### A note on the normalizer

The stub layer carries its **own** small normalizer, deliberately, so the harness
does not take a dependency on `src/shared/normalize.js` while another builder is
still changing it. It is not the contract and no test should assert against it.
It disappears with the stub. The real layer uses the one normalizer, as
everything else does.

### 5. The service entry (`service.js`)

`test/helpers/service.js` exports `SERVICE_ENTRY` (the real one) and
`STUB_SERVICE_ENTRY` (the stand-in). Tests currently pass the stub. Once
`src/service/index.js` is a real helper, switch them: that is 1A's one-constant
change, and nothing else in the harness moves.

**The readiness contract it depends on:** the helper writes
`<stateDir>/service.json`, mode `0600`, and the harness waits for that file
**and** for a TCP connection to the port to succeed. Both, because a file written
before the listener is up is a lie, and a port that answers before state is on
disk means the durability tests race.

```json
{ "port": 7817, "pid": 4211,
  "reviews": { "rev-abc": { "token": "..." } } }
```

The token is **per review** (D11: loopback is not a boundary, so the page proves
itself), so `reviews` is a map and not one string, and the map is part of the
readiness signal: a helper that is listening but has not written its credentials
yet is not ready for anything a test wants to do next.

**The log lives at `reviews/<id>/events.jsonl`.** A different filename or shape
means changing `SERVICE_READY_FILE`, `readReadyFile`, `REVIEWS_DIR` and
`EVENT_LOG_FILE`, and nothing else.

---

## Known gaps

Named rather than left to be discovered:

- **The `permanent` protection mode is implemented but not self-tested.** `veto`
  is what the architecture chose, so that is the one under test. A builder who
  tests `data-turbo-permanent` without the veto should expect to find out there
  what Chromium does to a selection when a node is moved between parents; that is
  an open question, not a known-good path.
- **The morph is index-paired, not keyed.** It matches live children to server
  children by position, which the fixtures' stable markup makes correct. A test
  that needs reordering, insertion in the middle, or keyed matching has to extend
  `morphNode` in `repaint-engine.js` first.
- **No storage helper.** Browser storage is per origin and per target (D6), and
  the key layout belongs to Task 1B-ii. Write it there and add it here.
- **No screenshot-diff helper for AC6.** The non-interference assertions
  (`scrollHeight`, host block rects, style attributes) are cheap with
  `page.evaluate` and the mutation observer's `attributes` mode; the two-width
  screenshot diff needs Playwright's snapshot support configured, which is a
  decision for whoever writes test #24.
- **No `turbo:morph` or `popstate` events.** The remount contract is 2D (living
  in the page), and the fixture will need those events added when it lands. The
  bfcache path (`pageshow` with `persisted`) is not driven here either.
- **The repainting fixture is one page.** Navigation, forms, a login, and the
  multi-page morphing app are 0C's `test/fixtures/app/`, not this file.
- **The stub's protection layer three is a stand-in, not a design.** It snapshots
  on `input` and restores from a document-level MutationObserver, keyed by region
  name rather than by node reference, because the no-hook repaint destroys the
  region element itself. 2B owns the real one in `src/layer/protect.js`.
- **`commitOnBlur` exists for a reason worth reading.** A repaint that destroys
  the focused region fires blur; the stub used to commit a record there, and
  replay then wrote that record straight back. The page looked repaired, the
  restore never ran, and layer three scored full marks for someone else's work.
  The layer-three tests switch it off, and the real layer has the same trap: a
  commit is the reviewer leaving a region, not the framework yanking the node.
