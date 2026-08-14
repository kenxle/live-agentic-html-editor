# The status-truth cluster: the status line and the failure chips never lie

Branch `task/fix-status`. Three walkers hit the same family of bugs on 2026-08-14:
a chip that said the helper was unreachable while it was up, a status line that
claimed an outage on any freshly loaded page, and a standing condition rendered
as a tally of how many times the page had asked.

They are one truth system, so they were designed together: the page learns
whether the helper is there, it says only what it knows, and a condition that
ends takes its chip with it.

---

## The four fixes

| # | Fix | Where |
| - | --- | ----- |
| 1 | A post the navigation aborted raises nothing. The record is already in browser storage and re-posts on the next load, so an abort is not a failure. | `src/layer/sync.js`: `unloading`, `abortedByTeardown`, the flush error path, the poll error path, `commitOnUnload` + a new `pageshow` reset |
| 2 | The helper is learnable WITHOUT a POST. Any acknowledged exchange (a reply poll, a granted claim, a heartbeat, a successful post) marks it reachable, feeds the status line, and clears the standing unreachable chip through a new `onRecovered` seam. | `src/layer/sync.js`: `helperReachable`, `markReachable`; wired in `src/layer/index.js` and `test/fixtures/assets/rail-harness.js` |
| 3 | `recomputeStatus` tells the truth with nothing queued: helper reachable reads **Stored.**, reachability not yet known reads the new neutral **Kept in this browser. It is stored the moment the helper confirms it.** which asserts no outage. | `src/layer/sync.js` `recomputeStatus`; new `STATUS.KEPT_UNCONFIRMED` in `src/layer/overlay.js` |
| 4 | `HELPER_UNREACHABLE` joins `STANDING`, so re-raising it means "still true" and its chip never counts. Recovery (fix 2) clears it. | `src/shared/failures.js` |

One extra defect found on the way, in the seam fix 2 needed: `overlay.js`'s
`failuresApi` defined `clear` **twice** in one object literal, so the
no-argument version silently won and `failures.clear("SECOND_WINDOW_REFUSED")`
(the takeover path, shipped yesterday) wiped every chip on the rail instead of
that one. It is now one `clear(code)` that clears all chips only when called
with no code, and a spec pins it.

### What the reviewer reads now

| Situation | Status line | Chip |
| --- | --- | --- |
| Fresh page, helper up, nothing typed | Stored. | none |
| Typing, helper has not confirmed yet | Kept in this browser. It is stored the moment the helper confirms it. | none |
| A request actually failed | Kept in this browser. Nothing is lost; it will be stored when the helper is back. | the local helper is not reachable (one, standing) |
| Helper comes back, nothing typed | Stored. | cleared |

The old kept-locally sentence is untouched and still used, but only where it is
TRUE: after a request has actually failed.

---

## Demonstrated failures, then green

### Unit (`node --test test/unit/sync_client.test.js`)

Before the fixes, with the new specs in place:

```
ok 5 - a CSP refusal is named distinctly from a helper that is down
not ok 6 - the status line never says stored before anything has been acknowledged
not ok 7 - a page with nothing queued and no helper answer yet does not claim the helper is away
not ok 8 - a successful poll is enough to read stored, with no post and no typing
not ok 9 - a post the navigation aborted is not a failure, and raises no chip
ok 10 - a genuine transport failure still raises the unreachable chip
not ok 11 - the unreachable helper is a standing state, so its chip never counts
not ok 12 - clearing one code leaves every other chip standing
# tests 17
# pass 11
# fail 6
```

Test 9's failure message was the walkers' finding in one line:

```
not ok 9 - a post the navigation aborted is not a failure, and raises no chip
  error: |-
    an aborted unload post raises nothing
```

Test 10 passing on the OLD code is the point of it being there: the true-failure
path was never broken, and it is what stops "stop reporting failures" from being
a way to pass the other five.

After:

```
# tests 368
# pass 368
# fail 0
```

### Browser (`npx playwright test test/browser/status_truth.spec.js`)

Before, all four red, each one a walker's reproduction:

```
1) a fresh page with a healthy helper reads stored, with nothing typed
   Error: Timed out after 10000ms waiting in the page for the status line to read
   stored on a page with nothing queued.

2) a helper that is really gone still gets its chip, and it never counts past one
   Error: Timed out after 10000ms waiting in the page for the status line to read
   stored before the helper is killed.

3) kill -9 then restart returns to stored, and clears the chip, with nothing typed
   Error: the standing chip goes when its condition ends
   Expected value: not "HELPER_UNREACHABLE"
   Received array:     ["HELPER_UNREACHABLE"]

4) an edit committed on the way out leaves no failure chip on the next page
   Error: Timed out after 15000ms waiting in the page for the status line on the
   second page to read stored.

4 failed
```

After:

```
✓ 3 status_truth.spec.js:63 › a fresh page with a healthy helper reads stored, with nothing typed (240ms)
✓ 2 status_truth.spec.js:202 › an edit committed on the way out leaves no failure chip on the next page (912ms)
✓ 1 status_truth.spec.js:143 › kill -9 then restart returns to stored, and clears the chip, with nothing typed (2.2s)
✓ 4 status_truth.spec.js:96 › a helper that is really gone still gets its chip, and it never counts past one (5.2s)

4 passed
```

And 16/16 with `--repeat-each=4`, because a status line that is right three
times out of four is not fixed.

---

## The gate

`npm run gate:builder`, exit 0:

```
> npm run lint && npm run test:unit && npm run test:browser
lint passed (syntax: 148 files, no jsdom, manifest complete)
# tests 368
# pass 368
# fail 0
  159 passed (33.3s)
```

Three lanes, `LAHE_ALL_BROWSERS=1`, over `rail_status`, `csp_refusal`,
`rail_durability`, `status_truth` and `rail_chips`:

```
✓ 42 [webkit] rail_status.spec.js:57 › stored, then kept-locally on a kill -9, then stored only once the backlog is acknowledged (1.4s)
✓ 43 [webkit] rail_status.spec.js:132 › a suspended helper never blocks the reviewer, and every record arrives once on resume (3.2s)
✓ 46 [webkit] status_truth.spec.js:96 › a helper that is really gone still gets its chip, and it never counts past one (5.3s)

48 passed (19.0s)
```

16 specs per lane, chromium / firefox / webkit, zero failures. The CSP refusal
stays a distinct failure with its own remedy on all three: nothing in these
fixes touches `classify`'s ordering, and `csp_refusal.spec.js` proves it.

---

## My own click-through

Real Chromium (headed), the real helper (`src/service/index.js`), the real app
fixture with the layer arriving through one script tag, real clicks and real
keystrokes. Driver: a throwaway script in the scratchpad, screenshots below.

```
[walk] fresh page, helper up, nothing typed: status=stored
[walk] after commit-then-click-a-link: {"status":"stored","chips":[]}
[walk] helper killed: {"status":"kept_locally","chips":["HELPER_UNREACHABLE x1"]}
[walk] helper restarted, nothing typed: {"status":"stored","chips":[]}
```

Run five times end to end, identical every time: the commit-then-navigate case
is 5/5 with no chip, against the walkers' 4/4 with one.

| Shot | What it shows |
| --- | --- |
| `fix_status_shots/01_fresh_page_stored.png` | The dashboard on first load, helper up, nothing typed: green dot, **Stored** |
| `fix_status_shots/02_edit_open.png` | The edit open with the reviewer's sentence typed into the page |
| `fix_status_shots/03_after_navigation_no_chip.png` | The Clients page reached by clicking the nav link right after Esc: **Stored**, Edits 1, and no chip anywhere |
| `fix_status_shots/04_helper_killed_kept_locally.png` | After `kill -9`: one chip, "The local helper is not reachable", and **Kept in this browser** with the amber dot. True, and it is the only place that sentence appears now |
| `fix_status_shots/05_restart_back_to_stored.png` | The helper restarted, nothing typed: chip gone, back to **Stored** |

---

## Files changed

- `src/layer/sync.js` (fixes 1, 2, 3)
- `src/shared/failures.js` (fix 4: `HELPER_UNREACHABLE` in `STANDING`)
- `src/layer/overlay.js` (seam only: the new `KEPT_UNCONFIRMED` status state and
  its wording, `showLimit` extended to it, and the duplicate `clear` collapsed
  into one `clear(code)`)
- `src/layer/index.js` (seam only: the `onRecovered` callback, four lines,
  mirroring `onFailure` and calling `rail.failures.clear(code)`)
- `test/fixtures/assets/rail-harness.js` (the same `onRecovered` wiring, so the
  harness does not diverge from the real boot on the surface these specs judge)
- `test/unit/sync_client.test.js`, `test/browser/status_truth.spec.js` (new),
  `test/browser/rail_chips.spec.js`

`dist/lahe-layer.js` was rebuilt locally for the browser specs and is NOT
committed.

Nothing was touched in `replay.js`, `record.js`, `comments.js`, `editing.js`,
`cli/` or `service/`.

### One test changed rather than added

`rail_chips.spec.js`'s counting test used `HELPER_UNREACHABLE`, which is a
standing code as of fix 4. The counting behavior still matters, so that test now
uses `COPY_FAILED` (an occurrence), and a new test next to it pins both standing
codes at a count of one.

## Cleanup needed

- `test-results/` and `playwright-report/` (gitignored Playwright artifacts from
  these runs)
