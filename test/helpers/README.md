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
  impossible in it. Chromium through this harness, or it does not count.
- **No arbitrary sleeps.** Every wait is a condition poll or a counter read.
  `test/unit/no_arbitrary_sleeps.test.js` scans every JS file under `test/` and
  fails the gate on a sleep. A flaky browser test gets its determinism fixed,
  never its assertion loosened.

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
  flavor: "turbo-frame",                    // or "react-text"
  intervalMs: 200,                          // for startRepaints
  protection: "veto"                        // or "permanent", or "off"
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

The fixture holds a "server" snapshot of every candidate target, taken at load,
and writes it back on every repaint. That is deliberate: a repaint engine that
does not actively try to revert what the reviewer typed makes every caret test
theatre. Pointing the engine at a different subtree does not re-snapshot, so a
test cannot accidentally bless whatever it just changed there. Call
`resnapshot(page)` when a change you made really is meant to be what the server
now believes.

---

## The two hard assertions

These are the reason this is a module and not a pile of inline `expect`s. If
either is subtly wrong, every test that leans on it is theatre. Each has a
self-test in `test/browser/harness_selftest.spec.js` with a **negative half**
that switches the behavior off and asserts the assertion throws. Do not delete
the negative halves.

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
await enableEditing(page);
const result = await assertCaretSurvivesTyping(page, {
  selector: "#live-note",
  text: "0123456789",
  keystrokeDelayMs: 50,
  repaintIntervalMs: 200,
  minReplayPasses: 5
});
```

### `assertNoSecondWrite(page, { selector, action })`

Plan test #13. Idempotence stated the only way that catches the bug: **the
absence of a second write, observed through a MutationObserver**, not final-DOM
equality.

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
| `startService({ entry, stateDir, allowedOrigins })` | Waits for readiness, twice over. See below. |
| `handle.kill9()` | SIGKILL, and waits until the process is reaped **and** the port stops answering. |
| `handle.stop()` | SIGTERM. Only for tests that are about graceful shutdown. |
| `readEventLog(stateDir)` | The parsed append-only log, for effect assertions. |

`kill -9` is the interesting half. A graceful shutdown proves nothing about
durability, because the service gets to flush. SIGKILL is what AC3 means.

### Contexts (`contexts.js`)

| Function | Notes |
| --- | --- |
| `openTwoContexts(browser, url)` | Two contexts, so separate storage. |
| `openTwoTabs(browser, url)` | Two pages in one context, so **shared** storage. This is the second-tab case D6 says must be refused with a reason. |

A test that means the second and writes the first will pass while the bug it was
written for is still there.

---

## What a builder has to change when the real layer lands

Four things, and only four. Everything else in `test/helpers/` is
harness-owned and does not move.

### 1. The counter contract (`counters.js`)

The real layer must publish, behind whatever test-hooks flag it wants:

```js
window.__lahe.counters.replayPasses    // ++ once per replay pass, written or not
window.__lahe.counters.regionsWritten  // ++ once per region replay wrote to the DOM
```

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

### 3. The protection marker (`test/fixtures/assets/repaint-engine.js`)

The repaint engine honors `[data-lahe-protected]` and `[data-turbo-permanent]`.
If the real layer marks a protected region with a different attribute, change the
two selectors in that file. This is the one fixture change on the list, and it
exists because the fixture has to know what the app-side veto looks for.

### 4. The whole of `stub.js`

`enableEditing`, `commitRegion`, `replayNow`, `layerRecords` are shims over
`window.__lahe.stub`. Point them at the real layer's equivalents. `configureStub`
is stub-only by design: it switches off the behaviors under test so the negative
self-tests can watch the assertions fail. When the real layer lands, the negative
tests either keep using a fixture page that loads the stub, or get rewritten as
the one-line deliberate revert the plan requires of every builder.

### A note on the normalizer

The stub layer carries its **own** small normalizer, deliberately, so the harness
does not take a dependency on `src/shared/normalize.js` while another builder is
still changing it. It is not the contract and no test should assert against it.
It disappears with the stub. The real layer uses the one normalizer, as
everything else does.

### And the service entry

`test/helpers/service.js` exports `SERVICE_ENTRY` (the real one) and
`STUB_SERVICE_ENTRY` (the stand-in). Tests currently pass the stub. Once
`src/service/index.js` is a real server, switch them.

**The readiness contract it depends on:** the service writes
`<stateDir>/service.json`, mode `0600`, containing `{ port, pid, token }`, and the
helper waits for that file **and** for a TCP connection to the port to succeed.
Both, because a file written before the listener is up is a lie, and a port that
answers before state is on disk means the durability tests race. The architecture
already requires the run token and port in an owner-only file (D9), so this is
that file. A different filename or shape means changing `SERVICE_READY_FILE` and
`readReadyFile`, and nothing else in the harness moves.

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
- **No `turbo:morph` or `popstate` events.** The remount contract is Task 2C, and
  the fixture will need those events added when it lands.
