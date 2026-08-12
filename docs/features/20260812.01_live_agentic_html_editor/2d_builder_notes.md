# 2D: living in the page

Branch `task/2d`, worktree `../lahe-worktrees/2d`. Ranked tests 4, 23 and 24.

## What landed

**`src/layer/index.js` (rework): a real boot.** It reads its config from the one
script tag (`document.currentScript`, then `protocol.SCRIPT_SELECTOR` for the
deferred case), then does what `test/fixtures/assets/cp1-boot.js` used to do by
hand: store, rail, page record, comment surface, the Active tab inside the
rail's Active pane, sync, the load-merge from browser storage, the remount
contract, and the first replay pass. It auto-boots when a config tag is present
and boots nothing (quietly) when there is none. Explicit options beat the tag,
which is how the CP1 fixture passes an ephemeral helper port.

Two things went out of that file. The refusal to initialize on a non-loopback
origin is gone: it broke the `file://` case, which 1A's spike proved works and
which the plan names as a supported primary case. `test/unit/remount_contract.test.js`
has a guard against it coming back. The version stamp stayed.

It publishes `window.__lahe`: the harness's counter contract (`replayPasses`,
`regionsWritten`, plus 2B's `restores` and friends when protect is loaded), the
remount counters, and the handful of readings a test needs about a rail that
lives in a closed shadow root.

**`src/layer/inject.js` (rework): the remount contract.** `install()` takes the
work it does not own as callbacks (`ensureRoot`, `rebind`, `merge`) and owns the
ORDER: de-register every group through the registry, put the root back if it is
gone, re-register, merge, `replay.schedule(REMOUNT)`. Five paths:
`turbo:morph`, `turbo:load`, `popstate`, `pageshow` (persisted told apart from a
fresh load by name, `pageshow-persisted`), and a MutationObserver on
`documentElement` that fires only when the root is actually missing. The history
shim (`pushState`/`replaceState`) is applied ONCE and remembered; re-applying it
per remount is the same leak in another shape.

**The one design decision worth arguing with: the remount RE-ATTACHES the same
host node rather than building a new one.** Removing an element from the
document does not destroy it, and every module caches something inside that
closed shadow root: the rail's DOM, `comments.js`'s `surfaceRoot`, the Active
tab's pane node, the box stylesheets. Building a fresh host leaves all of those
pointing into a detached root, which looks like the library working (records are
still written, the registry count is flat) while nothing the reviewer types is
on screen. I hit exactly that: after ten root deletions the gesture still minted
an empty draft and the box was invisible. Re-attaching keeps the reviewer's open
box open and costs one DOM insertion. The rebuild path is still there for the
case where there is no node to re-attach.

## The demonstrated failure (the one-line deliberate revert)

Revert applied to `src/layer/inject.js`, skipping step one of the order:

```diff
       var cleared = 0;
-      groups.forEach(function (group) {
-        cleared += registry.offGroup(group);
-      });
+      // DELIBERATE REVERT: skip the de-registration.
+      // groups.forEach(function (group) {
+      //   cleared += registry.offGroup(group);
+      // });
```

Output (`npx playwright test living_in_the_page`):

```
  1) [chromium] › living_in_the_page.spec.js:203:3 › the mutation fallback re-creates the root with no framework event at all

    Error: expect(received).toBe(expected) // Object.is equality
    Expected: 12
    Received: 16
    > 232 |     expect(after.listeners).toBe(before.listeners);

  2) [chromium] › living_in_the_page.spec.js:135:3 › one hundred morphs: registry flat, one overlay root, one gesture one item
    Test timeout of 30000ms exceeded.   (handlers compounding; the walk never finishes)

  2 failed, 2 passed
```

Restored, and the four tests pass again. The revert also reproduces the shipped
symptom the registry exists for: handlers pile up until the page crawls.

## Ranked test 4, and where the halves live

`test/browser/living_in_the_page.spec.js`, on 0C's app fixture with the library
arriving as one script tag:

- a link navigates, the button fires the page's own handler (`__app.counters.sessionClicks`),
  and the form does its real round trip, with a comment AND an edit outstanding.
  **The edit comes from `record_fixtures`**, per the plan's own allowance, because
  2A has not merged. When it does, that line can become a real edit.
- one hundred morphs (the fixture's raw flavor, every node under the target
  destroyed), each followed by a `turbo:morph` the spec dispatches because the
  fixture fires none, and every tenth pass deletes the overlay root. After:
  registry count and group map identical, one root, **and one gesture still makes
  exactly one item** (the load-bearing half, kept).
- the mutation fallback with no framework event at all.
- browse mode: nothing `contenteditable` anywhere, an ordinary key reaching the
  page's own textarea, no item minted.

## Ranked test 24, and the honest part

`test/browser/bfcache_restore.spec.js`.

**No engine under Playwright will bfcache a page, so `persisted` was never true
on any of the three browsers.** That is a measured result, not an assumption.
Probes run (minimal two-page server, no library, no interception):

| Configuration | Restored? |
| --- | --- |
| chromium, default | no |
| chromium, `ignoreDefaultArgs: ["--disable-back-forward-cache"]` | no |
| chromium, same plus `--enable-features=BackForwardCache` | no |
| firefox, default and with `browser.sessionhistory.max_total_viewers` / `fission.bfcacheInParent` | no (and `goBack()` never resolves, which is its own tell) |
| webkit, default | no |
| all three, with and without route interception, with and without `Cache-Control: no-store` | no |

Playwright launches Chromium with `--disable-back-forward-cache`, and removing
it does not help because a page with a CDP client attached is not eligible
either.

So the spec has two tests, and both are honest:

1. **The real thing.** Comment, click a link, `goBack()`. It reads `persisted`
   out of the pageshow the library recorded and compares a stamp that cannot
   survive a fresh load. When the engine refused, it **skips with a loud
   console message** naming the browser. It currently skips on all three. The
   day an engine allows it, this test starts proving the real path with no new
   code.
2. **The same handler, driven deterministically.** A real `PageTransitionEvent`
   with `persisted: true`, dispatched on a page whose root has just been eaten.
   Asserts the remount ran (a counter, not the rail's presence), the reason is
   `pageshow-persisted`, `bfcacheRestores` went up, the records merged, replay
   ran, one root came back, the cards hold the outstanding work, no handler
   group doubled, and a gesture on the woken page still makes one item.

This does not prove the browser froze and thawed the page, and the file says so
where a reader will see it.

## Ranked test 23

`test/browser/csp_refusal.spec.js`, four cases, all driven by a real response
header from the harness's CSP server:

- `connect-src 'none'`: the chip is `CSP_REFUSED` with the connect-src remedy,
  and `HELPER_UNREACHABLE` is absent. Then it forces several more blocked
  requests and re-checks, so "not the other message" is a claim about the
  settled state rather than about which of two things happened first.
- no policy, dead port: `HELPER_UNREACHABLE`, no `CSP_REFUSED`, and the two
  messages read side by side.
- `script-src 'none'`: the page's own script tag never executes, so `window.__lahe`
  and `window.LAHE` are undefined, and the page is otherwise untouched.
- the same page with no policy at all: the library boots from its own tag. This
  is the pair that stops the case above passing because the fixture is broken.

## CP1

`test/fixtures/assets/cp1-boot.js` is now a shim: it calls `LAHE.layer.boot()`
and keeps only `window.__laheCp1`, the reading surface the walk needs into a
closed shadow root. `cp1_walk.spec.js` is unchanged and green on all three
browsers.

## Gate

`npm run gate:builder`: lint passed (124 files), unit **302 pass / 0 fail**,
browser **92 passed, 1 skipped** (the bfcache skip). `npm run gate:all` (three
lanes): **276 passed, 3 skipped**, exit 0.

`dist/lahe-layer.js` is rebuilt in this worktree and NOT committed, per the dist
rule. The orchestrator rebuilds it at the checkpoint.

## Cross-task asks

1. **1D, `src/layer/highlight.js`:** `surfaceStyles` is cached forever, keyed by
   name, and holds `<style>` nodes that belong to a shadow root that may have
   been thrown away. Same shape in `comments.js`: `surfaceRoot` is memoized and
   never re-read. Today the remount re-attaches the same host so neither cache
   goes stale, but the rebuild path is one root loss away from unstyled comment
   boxes. One line each: drop the cache when the host is not connected.
2. **1D, `src/layer/comments.js`:** its listener group is the string `"comments"`
   rather than `listeners.GROUP.DOCUMENT`, so `inject.CLEARED_GROUPS` carries a
   literal. Either is fine; it should be a named constant somewhere both files
   can see.
3. **0B, `test/helpers/servers.js`:** `close()` waits on keep-alive sockets, so a
   test-scoped server closing while its page is open hangs until the test times
   out. Found on WebKit under load. One line: `server.closeAllConnections()`
   before `server.close()`. My CSP spec works around it with worker-scoped
   servers.
4. **0C, `test/fixtures/app/`:** the fixture fires no `turbo:morph`, `turbo:load`
   or `popstate`, and its `/clients` page loads no scripts at all (so
   `window.__app` is undefined there). My specs dispatch the morph event
   themselves. If 0C adds them, the specs get simpler and closer to a real
   framework.
5. **2C (replay):** replay is still the Phase 0 no-op, so "replay ran" is a
   counter assertion here. When the real engine lands, the remount path should
   also re-paint the comment highlights: a root loss today drops nothing (paints
   live in `CSS.highlights`, not the host), but a morph that destroys the
   anchored text nodes needs the resolve-anchors step to put the paint back.

## Cleanup needed

Nothing was deleted. For the Phase 4B batch:

- `.dbg-2d.js` (repo root) — my scratch bfcache/boot probe. Untracked.
- `.gate-2d.log`, `.gate-all-2d.log` (repo root) — gate output kept for this
  write-up. Untracked.
- `test/unit/consumer_2d_page.test.js` — the throwaway 0A consumer for this
  task, already on the plan's cleanup list. 2D has landed, so it can go.
