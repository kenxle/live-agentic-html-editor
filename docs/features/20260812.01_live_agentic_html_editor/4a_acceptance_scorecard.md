# 4A: Acceptance scorecard

Scored by an evaluator agent that did not build the code, on the running tool in a real browser,
against the fail line each criterion names. Nothing here is scored on a narrative: every row carries
the observed output.

**Two scoring rules, from the plan, kept:**

- An evaluator cannot score a comparison against a counterfactual they never observed. AC1 diffs the
  export against the prepared file on disk. AC2 runs the whole walk twice, the second time with the
  script line gone.
- An evaluator cannot score an automated suite artifact. The caret assertions are not re-scored here.
  They live in ranked tests 1 and 2, and their latest pass is cited.

**What was run.** `npm run gate:all` (lint, `check:layer`, unit, and all three browser lanes) three
times: **429 passed / 0 failed** before this phase's files landed, **430 passed / 2 failed** once, and
**432 passed / 0 failed** on the final run with everything in. The two failures were the same
intermittent test both times and are written up under "One amber finding" below; they are not in any
acceptance path. Three "expected failure" rows in each count are the one RED finding below, marked
with `test.fail()` so it is checked on every run rather than forgotten.

---

## The scorecard

| # | Criterion | Verdict | Where the evidence is |
| --- | --- | --- | --- |
| AC1 | The built-document case | **PASS** | `test/browser/ac1_walk.spec.js`, three lanes |
| AC2 | Ken's dev-server story | **PASS** | `test/browser/ac2_walk.spec.js`, three lanes |
| AC3 | Human and agent at the same time | **PASS on its fail line**, with one RED body claim | `test/browser/ac3_walk.spec.js`, three lanes |
| AC4 | Nothing is taken back | **PASS** | `test/browser/ac4_probe.spec.js` (evaluator probe, on the cleanup list) |
| AC5 | The agent talks back on the page | **PASS** | `agent_replies.spec.js`, `replay_branches.spec.js`, `ac3_walk.spec.js` |
| AC6 | A new user's install, mechanical half | **PASS** | `install_walk_3b.spec.js` + a hand walk in a temporary HOME |
| AC6 | A new user's install, honest half | **UNSCORED** | Nobody unprimed was available; this evaluator read the plan |
| AC7 | The end-of-session edit list | **PASS** | `edits_tab.spec.js` |
| AC8 | Outside cannot get in | **PASS** | `harness_second_origin.spec.js` + an evaluator probe against the helper's refusal log |
| — | The IME manual check from 2A | **NEEDS A HUMAN HAND** | Not drivable from Playwright. Sixty seconds of Ken's time; the script is below |

---

## AC1, the built-document case

**PASS.** Chromium, Firefox and WebKit.

*Fails if:* any item is missing, the diff against the prepared strings is non-empty, or the cropped
screenshot diff is non-zero. None of the three happened.

The walk, all of it real: a built HTML report (`test/fixtures/ac1-report.html`) copied into a
directory of its own with the bundle beside it and served over http; **one script line**
(`protocol.scriptTag`'s pinned form) appended to the built file; the helper minted the review and its
token and was then **killed with SIGKILL before the reviewer typed anything**. Three sentences fixed
by typing the prepared strings over them, a comment on the chart through element-pick, an untethered
note, all five ready. The review came out through a real click on the rail's own **Export** button
(read back off the downloaded file) and, on Chromium, a real click on **Copy** (read back off the
system clipboard); the two were byte-identical.

The prepared file is checked in at `test/fixtures/ac1-prepared-strings.txt`, byte-identical to the
file this evaluator was handed (`diff` clean). The spec reads it, types what it says, and diffs the
export against it. No prepared string is restated in JavaScript.

Observed:

```
✓ [chromium] ac1_walk.spec.js › five prepared strings typed into a built report come back
             out byte-identical, with nothing running (5.1s)
✓ [firefox]  (6.1s)
✓ [webkit]   (5.8s)
```

- Five records, all `ready`, three `edit` + one `comment` + one `note`.
- Every fix's `after` byte-compared against its prepared string: `Buffer.compare === 0`.
- Export non-empty, carrying `exporter.SLICE_LABEL` (nothing was running, and the export says so).
- The diff: the five reviewer-authored strings pulled back out of the exported text, sorted, against
  the five prepared strings, sorted — `Buffer.compare === 0`.
- The helper was then started on the same port and state directory: all five appear in
  `review.json`, and their text byte-compares clean against the prepared file again.
- **No agent ever ran**, asserted rather than assumed: no non-empty `replies*.jsonl` in the review's
  folder, and every projected item came back with `reply: null`.

**The layout half** is ranked test 18's, run and handed over as output rather than re-scored:

```
✓ comments_highlights.spec.js › the page renders identically with and without the library at 1280px, rail open      (366ms)
✓ comments_highlights.spec.js › the page renders identically with and without the library at 900px, rail open       (374ms)
✓ comments_highlights.spec.js › the page renders identically with and without the library at 1280px, rail collapsed (307ms)
✓ comments_highlights.spec.js › the page renders identically with and without the library at 900px, rail collapsed  (317ms)
```

Each of the four carries `expect(Buffer.compare(bareShot, layerShot), "zero diff outside the rail's
bounds").toBe(0)`, at the two stated widths, cropped to everything left of the rail. Cropped
screenshot diff: **zero**.

---

## AC2, Ken's dev-server story

**PASS.** Chromium, Firefox and WebKit.

*Fails if:* any recorded click differs between the two runs, the app stops responding, an open edit is
lost on navigation, or a morph loses the caret. None of the four happened.

Open question 3 is answered the way the plan records it: this runs against **0C's app fixture**.
Ken's own Rails dev server is the truer test and is his to run at the live review.

**The two runs.** Run one: the fixture's layout carries the one script line. Run two: the same
application with the line gone, which is what "commented out" means to a browser. Eight clicks,
identical in both runs, each recorded as `{label, from, to, state}` where `state` is everything about
the application a person could see afterwards: pathname, search, title, the current nav item, the
signed-in banner, the session counter, the login error, the saved-notes list, whether the app's own
JavaScript is alive, and whether the morph target is on the page.

The eight: nav to Clients, save a note (a form the app posts and redirects, which is the button that
navigates), nav to Dashboard, log a session (a button that does not navigate), nav to Reports (which
redirects to the login), sign in, nav to Dashboard **with an edit open**, nav back to Reports.

Observed: all eight compared with `toEqual`, click by click, after normalizing the ephemeral port.
**Zero differences.** `appAlive` is true on every screen that loads the app's scripts in both runs,
and the login screen is scriptless in both runs, which is the app's own behavior.

The library's half, in run one only:

- Comments on two screens (`/` and `/clients`) through the real gestures.
- The fix on the third screen (`/reports`), typed **inside the morph target** (`#feed-coach-note`)
  while the application polls and morphs four times a second. Positive control asserted in the same
  wait: at least two morph passes ran, the morph was told **no** about the edited element
  (`morphsSkipped` moved), and the rest of the feed changed under the reviewer's hands.
- **A morph did not lose the caret:** the region read exactly `base + typed`, and the caret was in the
  same text node **by identity**, advanced by exactly the number of characters typed
  (`compareCaret`, zero problems).
- **An open edit was not lost on navigation:** the edit was left open, the next recorded click
  navigated away, and after a full page load back the record was there, `state: ready`, its `after`
  byte-identical to `base + typed`.
- **One review naming all three pages:** `review.json` came back with `review.id = ac2-dev-server`,
  `pages = ["/", "/clients", "/reports"]`, three items, kinds `comment, comment, edit`.

---

## AC3, human and agent at the same time

**PASS on its fail line.** One RED finding on a claim in the criterion's body that is not in its fail
line. Chromium, Firefox and WebKit.

*Fails if:* anything is silently overwritten, or the collision is not surfaced. Neither happened.

The agent here is `fs.appendFileSync` on `replies-claude.jsonl` and nothing else. There is no
test-only route and no injected reply: the helper's own reader folds the line and the poll loop brings
it back to the card.

Observed, with the reviewer holding an unfinished edit open in `#feed-coach-note`:

- Three outstanding items before the edit was opened; the agent answered one at the rev it read.
- **The page updated itself**: no reload, no navigation, no gesture. The card went `handled`, moved to
  the Done pane, and carries `claude` as the agent.
- **The unfinished edit and its caret survived**: the region still read `base + typed`, the edit was
  still open, and `compareCaret` reported zero problems (same node by identity, same offset, same
  rect, still connected).
- **Every other outstanding item byte-identical and unchanged in state**: the full JSON of every other
  record, sorted and joined, compared with `toBe` against the snapshot taken before the agent wrote.

Then the source under the very region being edited moved. While the reviewer was inside it the morph
was told no (`morphsSkipped` moved) and their text stayed. On commit, protection lifted and the
application's own newer wording landed:

- **Nothing was silently overwritten, in either direction.** The page keeps its own text; the record
  keeps the reviewer's, in full, `state: ready`. `regionsWritten` moved by **0**.
- **The collision is surfaced**: the card carries the `ANCHOR_LOST` badge on its face, and
  `regionsLost` moved.

**A named deviation, not a failure.** AC3's body says the card is "flagged as changed underneath" and
"shows both versions in full". On 0C's application that treatment is not what the reviewer gets,
because the application changes a feed region's source by replacing the whole sentence, and D9's first
rule is that text places a write and nothing else does. A region whose text is gone entirely does not
resolve, so replay reports the record as **lost** (AC5's treatment: says so on the card, text intact)
rather than as changed underneath. The both-versions treatment needs a source change that keeps the
old wording and adds to it, which this application cannot produce. That shape is driven and green in:

```
✓ replay_branches.spec.js › branch four: the page changed underneath, so nothing is written
                            and the card shows both versions in full (129ms)
✓ replay_human_and_agent.spec.js › the page changes region A while the reviewer is in it:
                            on commit, one card is flagged and nothing is written (229ms)
✓ cp2_mid.spec.js › the page rewrites region A while the reviewer is in it: on commit,
                            one card is flagged and nothing is written (1.9s)
```

### RED 1: a handled item keeps its highlight

**File:** `src/layer/highlight.js` (the registry), `src/layer/tab_done.js` (the owner of retirement).

**Symptom.** AC3's body says "The handled item loses its highlight and moves to Done".
`src/layer/tab_done.js`'s own header repeats it: "A HANDLED ITEM IS KEPT AND REOPENABLE (R38). It
loses its highlight and ...". It does not. The only call to `highlights.clear` in the library is in
`comments.remove` (`src/layer/comments.js:728`), which is the reviewer deleting their own comment.
Nothing clears or repaints a highlight when an item retires, so a handled passage stays painted for
the rest of the session and the page accumulates marks on finished work.

**Observed**, on all three lanes:

```
✘ [chromium] ac3_walk.spec.js › the handled item loses its highlight (1.3s)
✘ [firefox]  (1.9s)
✘ [webkit]   (1.6s)

  expect(received).toBe(expected)   // a retired item is no longer painted
  Expected: -1
  Received: 0
```

The test carries a positive control in the same run (`CSS.highlights` holds a non-empty range before
the agent answers), so this is not "nothing was ever painted".

**What green looks like.** Retiring an item into Done clears its highlight, or repaints it into a
finished paint, so `highlights.paintedIds()` no longer holds the id and the CSS registry no longer
carries its range. The test is marked `test.fail()` rather than deleted: the suite stays green, the
defect is checked on every run, and the day it is fixed the test reports "expected to fail but
passed" and forces the marker off.

---

## AC4, nothing is taken back

**PASS.** Chromium. Driven by the evaluator in `test/browser/ac4_probe.spec.js` (a probe, not a
checked-in acceptance spec: ranked test 39 names AC1 through AC3 as the scripted walks, and this file
exists so the five stressors were driven in one session rather than cited from five specs).

*Fails if:* any of the three measures moves. None moved.

The three measures, over the five prepared records only, by id: item count, every item's text
byte-compared against `ac1-prepared-strings.txt`, and each item's state. The caret is deliberately not
scored (ranked tests 1 and 2).

Ten measurement points, every one of them `count: 5`, texts byte-identical to the prepared file,
states unchanged:

```
the reviewer's own five records                                    count 5
a browser reload                                                   count 5
a kill -9 of the helper                                            count 5
the helper coming back                                             count 5
a suspended helper (SIGSTOP)                                       count 5
the helper resumed (SIGCONT)                                       count 5
the page re-rendering the block being typed in                     count 5
committing that sixth record                                       count 5
a navigation with an edit open                                     count 5
backgrounding the page (visibilitychange, the stated stand-in)     count 5
```

The final `review.json` on disk holds the five prepared strings unchanged after every stressor
(`Buffer.compare === 0`).

**Honest note, kept as the plan states it rather than relabelled.** What stands in for browser
suspension is backgrounding the page and driving a `visibilitychange`. Suspending the helper is a
different failure and is covered separately (ranked test 22, and the SIGSTOP/SIGCONT rows above).

---

## AC5, the agent talks back on the page

**PASS.** All three parts, each with its own green test, spot-run by this evaluator.

*Fails if:* any of the three clears silently or shows a success state. None did.

1. **A not-handled line with a reason appears on that item's card.**
   `✓ agent_replies.spec.js › an untethered note, an element comment and a selection comment each
   round-trip to review.json and back to a card (1.3s)` — asserts
   `noteCard.agentMessage.reason === "the tone is a design decision, so I left it for you"` and
   `noteCard.pane === "active"`: a not-handled item is still in front of the reviewer.
2. **A record whose anchor replay cannot place says so on its card, text intact.**
   `✓ replay_branches.spec.js › an anchor that matches nothing is surfaced as lost, and writes nothing
   (171ms)` and `✓ ... an anchor that matches two places is surfaced as lost, and moves nothing
   (140ms)`. Confirmed independently on a real application in this evaluator's own AC3 walk: the card
   carried `ANCHOR_LOST` on its face while the record kept the reviewer's text in full.
3. **A reply naming an old revision leaves the item outstanding.**
   `✓ agent_replies.spec.js › a stale reply is refused and the reworded item stays outstanding (2.4s)`
   — the helper's fold line is `accepted: false` with a refusal naming `rev 1`, the card says "older
   version", and the item is still `ready` in the browser and in `review.json`.

---

## AC6, a new user's install

### Mechanical half: PASS

**3B's install-walk spec, run fresh:**

```
✓ install_walk_3b.spec.js › npm link once, then `lahe add`, and the page is ready to review (795ms)
✓ install_walk_3b.spec.js › the reviewer's comment on that page lands in events.jsonl (183ms)
```

**And by hand, in a shell, in a temporary HOME with a sandboxed npm prefix.** No state existed before
(`ls` on `$HOME/.local/state/lahe`: "No such file or directory"). `npm link --loglevel=error`, then
`command -v lahe` resolved to the sandboxed prefix's bin. Then **one command**:

```
$ lahe add .../notes.html --port 7911

lahe add: .../notes.html

  review    r61394917ebb5  (minted just now)
  library   .../dist/lahe-layer.js
  helper    http://127.0.0.1:7911  (started just now)
  origin    null (a page opened from disk sends no origin, on every browser)

  The script line is in notes.html, just before </body>.
  ...
  Open it:  file:///.../notes.html
```

No second command was needed and none was typed. The helper wrote its readiness file into the fresh
HOME with the minted review and token, and the script line landed in the page:

```html
<script src=".../dist/lahe-layer.js"
        data-lahe-review="r61394917ebb5"
        data-lahe-token="ed421af9...77cc"
        data-lahe-helper="http://127.0.0.1:7911"
        defer></script>
```

Then the page was opened at the URL `add` printed, in a real browser, and one gesture was made
(select the paragraph, Cmd-Shift-C, type, Cmd-Enter):

```json
{ "recordLanded": true,
  "record": { "note": "This promises a deload and never says which week.", "state": "ready" },
  "statusLine": "stored" }
```

**Every gesture in the architecture's gesture table appears as a hint line on the rail with its exact
keystroke, without opening a menu.** Read off the rail itself in that same hand walk, compared against
`src/shared/gestures.js`'s `TABLE`, all eight rows, keys and sentence both:

| Gesture | Keystroke | Keystroke on the rail | Hint on the rail |
| --- | --- | --- | --- |
| `comment_on_selection` | Cmd-Shift-C | yes | yes |
| `enter_element_pick` | Cmd-Shift-C | yes | yes |
| `pick_element` | click | yes | yes |
| `edit_block` | Cmd-Shift-E | yes | yes |
| `mark_ready` | Cmd-Enter | yes | yes |
| `commit_edit` | Esc, or a click outside | yes | yes |
| `cancel` | Esc | yes | yes |
| `page_default` | everything else | yes | yes |

`everyGestureOnRail: true`. Also asserted in the suite:
`✓ comments_highlights.spec.js › every gesture appears as a readable hint line on the rail (137ms)`.

### Honest half: UNSCORED

Whether a genuinely unprimed person works the gestures out from the page alone cannot be scored by
this evaluator, who read the plan and cannot un-know Cmd-Shift-C. No unprimed person was available.
Recorded as unscored rather than passed, exactly as the plan requires.

---

## AC7, the end-of-session edit list

**PASS.**

*Fails if:* an edit appears only in the comment thread, or the formatting-only change is missing.
Neither happened.

```
✓ edits_tab.spec.js › six hand edits become six before-and-after rows, apart from the thread,
                      and they export (1.7s)
✓ edits_tab.spec.js › a hand edit's card carries no comment-thread row (1D's tab_active.js) (524ms)
✓ edits_tab.spec.js › with the export namespace gone, the button says so instead of failing
                      quietly (570ms)
```

The session is real: four typed edits, one delete and one formatting-only change through the real
editing surface, plus a real comment so "kept apart from the comment thread" is measured against a
thread with something in it. The assertions that are AC7's fail line: `rowCount() === 6`, every row
carries a non-empty `before`, the formatting-only row's words are unchanged with `structure` naming
what changed, `rowsInPane("active")` is `[]` for edit rows, `countFor("active") === 1` (the comment
and nothing else), `countFor("edits") === 6`, and the comment's id is not among the Edits rows.

---

## AC8, outside cannot get in

**PASS.** Judged on the helper's own refusal log, one line per probe, each naming the check that
failed.

*Fails if:* any probe writes state, or any refusal line names the wrong check or no check. Neither
happened.

The suite's half, spot-run:

```
✓ harness_second_origin.spec.js › the positive control writes one line, then each omitted check
                                  leaves it at one (176ms)
✓ harness_second_origin.spec.js › a non-browser client is refused the same way, including the
                                  Host check (96ms)
✓ harness_second_origin.spec.js › a cross-origin page cannot write, asserted on the event log (165ms)
✓ harness_second_origin.spec.js › two origins on one review produce one log with every record
                                  exactly once (241ms)
```

And this evaluator's own probe, against a real helper from a non-browser client, reading the refusal
log after every request. The positive control first, then each check omitted one at a time:

| Probe | Status | Item events on disk | The helper's own line |
| --- | --- | --- | --- |
| the valid request (positive control) | 200 | 1 | *(no refusal line, correctly)* |
| omit the custom header | 400 | 1 | `refused events.append: check custom_header failed [request 6145bc0f…, POST /lahe/v1/events, origin http://127.0.0.1:65000]` |
| omit the JSON content type | 415 | 1 | `refused events.append: check content_type failed (none) [request 3e09e0ff…]` |
| omit the token | 401 | 1 | `refused events.append: check token failed [request 661ff062…]` |
| a guessed token | 401 | 1 | `refused events.append: check token failed [request de6aa4b2…]` |
| an unknown review id | 404 | 1 | `refused events.append: check review_known failed (unknown-review) [request 07ca47d3…]` |
| a second origin | 403 | 1 | `refused events.append: check origin failed (http://evil.example) [request 72cb6fbf…, origin http://evil.example]` |
| a lying Host (DNS rebinding) | 400 | 1 | `refused events.append: check host failed (attacker.example.com) [request cb111f3d…]` |

**Item events on disk at the end: 1.** The one the positive control wrote. Every probe left the count
where the control left it, every refusal produced exactly one line, and every line names the right
check. All six checks in `protocol.CHECKS` were exercised.

---

## The IME manual check from 2A: NEEDS A HUMAN HAND

2A's builder notes record it plainly: composition events are deferred to `compositionend` in the code
and there is no test driving them, because composition is not reliably drivable from Playwright. This
evaluator cannot type a composed string; a synthetic key event is not a composition, and asserting on
one would be theatre. Recorded honestly as needing a human hand rather than passed or failed.

**Ken, this is sixty seconds at the live review.**

1. Turn on a composing input method. On macOS: System Settings, Keyboard, Input Sources, add
   **Japanese (Romaji)** or **Pinyin (Simplified)**, then pick it from the menu bar.
2. Open any reviewed page (the dev server, or the AC1 report), put the caret in a paragraph, and press
   **Cmd-Shift-E** to edit that block.
3. Type a composed string. Japanese: type `nihongo` and press **space** to convert, then **Enter** to
   commit the composition. Pinyin: type `zhongwen`, press **space**, then **Enter**.
4. Press **Esc** to commit the edit.

**What to look for, in this order:**

- While composing, the underlined candidate text stays put and the candidate window does not close on
  its own. If the page is morphing under you, the composition still survives.
- After the composition commits, the paragraph reads the composed characters, once, not twice and not
  as raw romaji.
- The card in the rail shows the composed characters in its **after**, whole. Not the romaji, not a
  half-composed prefix, and not a record per keystroke: **one** record for the block.
- Export the review and check the same characters come out of the file unchanged.

If any of those is wrong, the symptom to report is which one, and whether the page was morphing at the
time.

---

## One amber finding: ranked test 24 is load-flaky

**File:** `test/browser/bfcache_restore.spec.js:182`, "the persisted pageshow branch remounts, merges
and replays". Not an acceptance criterion, and it does not change any verdict above. Recorded because
it makes `gate:all` intermittently red, which is how a gate stops being believed.

**Symptom.** Under a loaded `gate:all` it fails on `expect(after.remounts).toBe(before.remounts + 1)`
with `Expected: 2, Received: 3`. Once on Firefox and WebKit together, once on Chromium. The page is
served with `?morph=raw&poll=200`, so the application destroys the layer's root on its own 200ms
timer; under load a second remount lands between the two counter reads and the exact `+ 1` fails.

**Observed:** two `gate:all` runs failed it, five isolated runs of the file on all three lanes passed
it, and the final `gate:all` (432 passed) passed it.

**What green looks like.** The claim is "the remount ran", not "the remount ran exactly once while the
application was busy destroying the root". Either stop the application's timer for this test the way
the other specs do (`window.__app.morph.stop()`), or assert `toBeGreaterThan(before.remounts)`. The
first is better: it keeps the exact count meaningful. Fixing it is not this evaluator's remit.

## Cleanup needed

Nothing below was deleted. 4B executes them in one batch.

- `test/browser/ac4_probe.spec.js` — the AC4 evaluator probe. Keep it if the orchestrator wants AC4
  driven on every run; it is written as a throwaway and it is not one of ranked test 39's three.
- The scratchpad probes, outside the repo:
  `<scratchpad>/ac8_probe.js`, `<scratchpad>/ac6_gesture.js`, `<scratchpad>/gate_all.log`, and the
  hand-walk sandbox `<scratchpad>/ac6-hand/` (a temporary HOME, a sandboxed npm prefix with a `lahe`
  symlink in it, and `notes.html` with a script line and a token in it).
- OS temp directories the walks left behind, deliberately, per the no-deletions rule:
  `$TMPDIR/lahe-ac1-*` (one per AC1 run per lane) and `$TMPDIR/lahe-install-walk-*` (3B's).
- `test-results/` and `playwright-report/` under the repo, from the failing runs during authoring.
- Everything already on the plan's own Cleanup needed list (`src/shared/cli_contract.js`,
  `src/cli/commands/next.js`, `src/cli/commands/ack.js`, and the rest) is untouched and still stands.

## Files this phase added

- `test/browser/ac1_walk.spec.js`
- `test/browser/ac2_walk.spec.js`
- `test/browser/ac3_walk.spec.js`
- `test/browser/ac4_probe.spec.js` (evaluator probe, on the cleanup list)
- `test/fixtures/ac1-report.html` (the built document AC1 reviews)
- `test/fixtures/ac1-prepared-strings.txt` (the prepared file, byte-identical to the one handed over)
- `docs/features/20260812.01_live_agentic_html_editor/4a_acceptance_scorecard.md` (this file)

No product code was changed. The one RED finding is scored, not fixed.
