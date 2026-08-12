# Test review: the plan's Test List and Acceptance Criteria

Reviewed: `03_plan_live_agentic_html_editor.md` (Tests ranked, Acceptance criteria, per-task Done-when),
`02_architecture_live_agentic_html_editor.md` (D5, D7, D12, failure-modes table, Test strategy),
`01_brief_live_agentic_html_editor.md` (Success Metrics), and the harness in `test/`.

The harness is the strongest part of this repo and the plan is right to keep it. Everything below is
about the gap between what the plan's tests say and what would actually fail when the mechanism is
missing.

---

## Red flags

### 1. Ranked test #1's third protection layer cannot pass the caret assertion as written

```
severity   blocker
kind       defect
where      plan, Tests ranked #1 ("Run on all three protection layers separately, including the
           flavor with no veto hook"); test/helpers/assertions.js:47-129
what       The snapshot-plus-MutationObserver restore layer restores the text AFTER the repaint
           destroyed the text node, so the caret is necessarily in a NEW node; assertCaretSurvivesTyping
           requires the same text node compared by identity (assertions.js line 85, compareCaret).
why        A builder running this test on the no-veto flavor gets a failure that no correct
           implementation of layer three can fix. The plan forbids loosening an assertion, so the
           likely outcome is the shared assertion gets quietly weakened for every other test too, and
           the project loses its single best assertion.
fix        Define, in 0A or 0B, what "the caret survived" means for the restore-only layer, and give it
           its own named assertion: text reads exactly as expected, the caret sits at the same
           character offset inside the node now holding those characters, no characters were lost
           across N repaints, and restoreCount incremented. Keep the node-identity assertion as the bar
           for the veto and permanent layers, where it is achievable. Say in the plan which layer each
           of the three runs of #1 uses and which assertion each one gets.
```

### 2. The D12 classification flip is not in any test, and the existing test asserts the old rule

```
severity   blocker
kind       defect
where      plan test #19, #20 and the src/ table row for shared/review_format.js;
           test/unit/review_format.test.js:89-98 and :122-130
what       D12 redraws the line: the full `after` text of an edited region is DATA (fenced), and only
           the reviewer's typed notes and the specific changes they made are intent. The existing unit
           test asserts the OPPOSITE (`field_classes.after === CLASS_INSTRUCTION`, "the reviewer's
           exact wording is never truncated" applied to the whole `after`), and the plan's rework line
           for that file mentions only removing review.json and adding per-page grouping.
why        The laundering attack D12 exists to stop (a sender's hidden text inside the reviewed region
           riding the reviewer's edit into the instruction channel) ships undefended, and every test in
           the list passes, because #19 and #20 are written in the old vocabulary and the unit file
           already encodes the old classification as a green test.
fix        Add a ranked test: a fixture page whose region contains an injected instruction string; the
           reviewer edits that region; assert the injected string appears in review.md only inside a
           fenced data block and never in the intent section, and that the reviewer's typed note is
           outside every fence and byte-identical. Rewrite #19 to say "the reviewer's typed note and
           their diff are never truncated; the full before/after of the region is fenced and may be
           bounded". Add to the 0A rework line that field_classes changes and that its test must flip.
```

### 3. The plan's #5 drops the positive control that stops the security test being vacuous

```
severity   blocker
kind       defect
where      plan test #5 and 1A Done-when ("asserted on effect (the log on disk has no new lines)");
           test/helpers/service.js:236 readEventLog, test/browser/harness_second_origin.spec.js:54-87
what       readEventLog returns `[]` for a missing file, and the log path is about to move from
           `<stateDir>/events.log` to `reviews/<id>/events.jsonl`. The existing spec is safe only
           because a second test in the same file writes a real line through the allowed origin and
           asserts length 1. The plan reproduces only the negative half.
why        Point the helper at the wrong path, or forget to update readEventLog, and every refusal
           assertion passes forever against a helper with no authentication at all.
than       -
fix        Make the positive control mandatory in #5 and in 1A's Done-when: same test, same stateDir,
           same reader. Allowed origin plus valid token writes exactly one line, then each of the five
           checks is omitted one at a time and each probe leaves the count at one. Also state in the
           plan that helpers/service.js's readEventLog path changes with the new layout.
```

### 4. Branch three (an earlier revision's `after` landed) has no data to compare against

```
severity   important
kind       risk
where      plan 0A record shapes; plan test #11; architecture D7
what       The 0A field table lists `before` and `after` in text and HTML plus a monotonic `rev`. It
           does not say a record carries the `after` of every prior revision, and it does not say
           replay may read events.jsonl history. Branch three requires exactly that.
why        A builder implements branches one, two and four, writes a branch-three test against
           whatever they built (most likely a single reword, where the prior `after` happens to equal
           the current `before`), and the branch passes while the real case, two rewordings, silently
           falls into branch four and flags a collision that is not one.
fix        0A: state that a record carries the ordered history of its applied `after` values (or that
           replay resolves history from the log), and give the merge/lifecycle module a unit test for
           it. #11's branch-three case must use TWO rewordings, so the earlier `after` is neither the
           current `after` nor the `before`, with regionsWritten asserted to increment exactly once and
           the card message asserted.
```

### 5. The second-window refusal has no mechanism when the helper is down or the windows are storage-separate

```
severity   important
kind       defect
where      plan test #18 (mapped 1A, 1B); architecture D5 and the failure table row
what       #18 does not say which of the two window shapes it tests. test/helpers/contexts.js draws the
           distinction sharply: openTwoTabs shares storage (a client-side lock can refuse), while
           openTwoContexts does not (only the helper can refuse). With the helper down, which is a
           supported first-class case, two storage-separate windows cannot be refused by anything.
why        A test written with openTwoTabs passes while the architecture's flat claim is false in the
           case that loses drafts. Either the claim needs scoping or the design needs the helper.
fix        #18 runs both shapes explicitly: shared-context with no helper (client lock refuses), and
           separate-context with the helper running (helper refuses, naming the first). For
           separate-context with no helper, decide now: either the architecture scopes the claim and
           the status line says so, or the case is on the failure table as accepted loss. Add the
           positive control: the FIRST window keeps working and keeps accumulating after the refusal.
```

### 6. The localhost / 127.0.0.1 claim is stated but untested, and keying by review id does not deliver it

```
severity   important
kind       defect
where      architecture D5 ("keyed by review id ... so localhost versus 127.0.0.1 is not two buckets");
           plan 1B; nothing in the test list
what       Browser storage is partitioned by origin. Choosing the key inside a bucket does not merge
           two buckets. No test in the list exercises the same review opened on both origins.
why        The untested claim is the false one. A reviewer who follows a link from localhost to
           127.0.0.1 mid-review has two storage halves; the helper reconciles them only for records it
           already acknowledged, and drafts are lost.
fix        Either drop the claim from D5 and say the helper is what unifies origins (with a test: same
           review id from two origins produces one events.jsonl with every record once), or state the
           limit plainly. Whichever, add the test; it is a five-line browser test with the existing
           fixture servers.
```

### 7. Per-agent reply folding is asserted nowhere except through the stale-revision case

```
severity   important
kind       risk
where      plan tests #9 and 3A Done-when; architecture D6
what       The tested claims are: a stale-rev reply is refused (#9), and an appending-only agent can
           retire an item and put a failure on a card (3A). Untested: two reply files folded in arrival
           order, the rev-then-latest-wins conflict rule with both kept in the log, and a torn last
           line in a reply file (the same crash shape events.jsonl gets in 1A).
why        Reply folding without the revision check is on the plan's own do-not-half-ship list because
           it is silent loss of visible work. The half that IS tested is the one branch a builder is
           least likely to get wrong.
fix        Add a ranked test: two reply files answer the same id at the same rev with different
           statuses; the fold is deterministic (state the rule's expected winner) and both lines remain
           in events.jsonl. Add a torn-final-line case to the reply reader, asserted the way 1A asserts
           it for events.jsonl. If per-agent files slip to the cut list, say so in the test row.
```

### 8. Nothing tests what the status line says, which is the reviewer's only signal

```
severity   important
kind       defect
where      plan 1B ("a persistent one-line status ... kept locally, stored, or agent connected", R12);
           test list has #17 (CSP versus helper-down) and nothing else
what       #17 tests that two failure states are named distinctly. No test asserts the status line is
           TRUE: that it flips to kept-locally when the helper dies and back to stored when it returns
           and the backlog is acknowledged.
why        A status line stuck on "stored" while the helper is dead is exactly the false success R11
           forbids, and the reviewer's whole trust model rests on it. It would pass every test here.
fix        Add a ranked test: helper up and a record acknowledged, status reads stored; kill -9, status
           reads kept-locally within a poll; restart, status returns to stored only after the backlog is
           re-posted and acknowledged. Assert the transition, not the string's presence.
```

---

## Tests as written that a no-op or absent implementation would pass

```
severity   important
kind       risk
where      plan tests #3, #8, #12, #15, #16, #21, #22
what       Each is an absence assertion with no paired positive control or counter.
why        Absence is satisfied by doing nothing at all, including by the library failing to load.
fix        Per test:
           #3  "a static assertion that no control anywhere gates a record on the helper being
               reachable" is a grep with no stated pattern; it cannot fail meaningfully. Replace with
               the behavioral version: with the helper never started, all ten records complete, appear
               on the rail, and export carries all ten.
           #8  assertNoSecondWrite does NOT assert counters (assertions.js:152-194); only the harness
               self-test adds them by hand (harness_selftest.spec.js:452-454). A paused replay engine
               passes #8. Bake a required minReplayPasses option into assertNoSecondWrite in 0B so the
               plan's own law is enforced by the helper rather than by builder discipline.
           #12 "neither writes" needs replayPasses to have incremented and regionsWritten to be flat,
               plus the card and review.md assertions it already names.
           #15 "zero host elements carrying a library class or style attribute" passes with the library
               absent. Pair it in the same test with: the rail exists, a highlight is painted, a record
               exists.
           #16 "drafts never appear as actionable" is unfalsifiable until "actionable" is defined. Pair
               with the positive control: the same record after Cmd-Enter appears in the items section,
               same fixture, same test.
           #21 "chips stay dismissed" passes if no chip ever appears. Assert a chip appears first,
               survives the remount, then stays gone after dismissal.
           #22 "same bytes as the helper's projection" passes if both are empty. Assert non-empty and
               assert the slice label is present in the no-helper case and absent in the full case.
```

---

## Failure-modes table coverage

Rows with a test that would genuinely fail if the mechanism were missing: helper not running (#3),
helper dies mid-review (#3), page repaints during typing (#1, given red flag 1 resolved), agent lands a
change under an outstanding edit (#2), anchor lost or doubled (#12, given the counter fix), stale agent
reply (#9), browser crash mid-keystroke (#6), CSP blocked (#17), hostile page probes the helper (#5 and
#24, given red flag 3), dismissed error stays dismissed (#21, given the positive control).

Rows whose test does not bite:

```
severity   important
kind       risk
where      failure table, "Link clicked while an edit is open"; plan test #6, AC2
what       #6 asserts nothing is LOST across a navigation with an edit open, which browser storage
           alone satisfies. The row also claims the edit "is re-posted on the next page load". Delivery
           through unload is the notoriously unreliable part of the browser: a plain fetch in a
           beforeunload or pagehide handler is cancelled, and only sendBeacon or fetch keepalive
           survives. Nothing tests that the record reaches events.jsonl.
fix        Extend #6: navigate with an edit open, then on the next page load poll events.jsonl for that
           record exactly once, with the final keystroke included. Run it on all three browsers, since
           this is precisely where they differ. Add the bfcache case: navigate away and press Back; the
           page is restored without a fresh load (pageshow persisted), so the remount, the merge and
           replay must run on that path too. Neither the harness nor the plan mentions bfcache and it
           only breaks in a real browser.
```

```
severity   important
kind       risk
where      failure table, "An agent applied an outdated rev"; AC4's "machine sleep simulated by
           suspending the helper process"
what       AC4 names a suspended helper; no ranked test covers it, and test/helpers/service.js offers
           stop() and kill9() only. A suspended helper is different in kind from a dead one: the socket
           accepts and never answers, so the sync client's in-flight request hangs rather than failing.
why        This is where "retries forever, never blocks the reviewer" actually breaks, and where the
           status line most likely lies.
fix        Add suspend()/resume() (SIGSTOP/SIGCONT) to helpers/service.js in 0B, and a ranked test:
           suspend mid-post, keep typing, assert the reviewer is never blocked and the status line says
           kept-locally; resume and assert every record arrives exactly once.
```

---

## Unit-level where only a real browser breaks

```
severity   important
kind       risk
where      plan tests #9, #13, #22, #25; brief success metric "the interactive parts are tested against
           a real browser"
what       #9's offline-rewording half, #13's two-neighbouring-regions case, #22's export path, and
           #25's file drop are all satisfiable at unit level against a simulated store or a pure
           function.
fix        Say in the row which half is a browser test. #9: the offline rewording must be a real killed
           helper plus real browser storage plus reconnect, not a simulated merge (the pure merge
           function gets its own 0A unit test, and both are needed). #13: the two records must come
           from two real Cmd-Shift-E sessions in the browser, since the merge bug lives in edit-state
           boundaries, not in the anchor predicate. #22: name how the export is read (clipboard read
           needs a Playwright permission grant; a download needs a download path) or the test will get
           written against the formatter and never touch the button. #25: name the drop mechanism, or
           it becomes an assertion about a handler that was never exercised.
```

```
severity   minor
kind       risk
where      plan 2A (composition events deferred to composition end, spellcheck and autocorrect off)
what       Composition/IME behavior has no test and is hard to drive from Playwright. Spellcheck-off is
           already covered by the harness (harness_selftest.spec.js:571).
fix        Either add a CompositionEvent-driven browser test or state plainly in 2A that IME is a
           manual check on the acceptance walk. Do not leave it implied.
```

---

## Missing tests the requirements name

```
severity   important
kind       defect
where      plan 2A (R29, `before` is the wording when the reviewer FIRST touched the region); no test
           in the list
what       Nothing asserts `before` stays pinned across repeated retypes of the same region.
why        If `before` drifts to the last committed state, replay's branch two never matches and the
           agent receives a diff that is a no-op against the source. It is silent and it looks fine on
           screen.
fix        Ranked test: enter edit state, type, commit, re-enter, type again, commit; one record, one
           id, rev bumped, `before` equal to the original page wording both times.
```

```
severity   important
kind       defect
where      plan 0A (the normalizer's two comparison modes); plan test #11's format-only half
what       The format-only branch depends on a structural comparison mode that disagrees with the text
           mode. No unit test in the plan pins that they disagree.
why        Two modes that are accidentally identical make the format-only branch a no-op that passes a
           browser test written by the same builder.
fix        0A unit test: one pair of DOM fragments that is text-equal and structure-different, one pair
           that is both-equal; the two modes must split on the first pair. This is the format-only
           mechanism's only cheap falsifier.
```

```
severity   minor
kind       risk
where      plan test #11's delete-idempotent-by-absence half; 2A per-record undo
what       "The block gone is applied, the block back is re-applied" and "undo reverts the record"
           interact: undoing a delete must not be re-deleted by the next replay pass.
fix        Add the interaction to #14: undo a delete, run five replay passes, assert the block stays
           and regionsWritten does not increment.
```

```
severity   minor
kind       taste
where      plan test #4 (listener registry count unchanged after 100 morphs)
what       The registry count is the library's own self-report; a handler registered outside the
           registry is invisible to it.
why        The independent check is already in the same row ("one gesture still makes exactly one
           item"), which is the assertion that actually bites. Keep both, and note in the row that the
           behavioral half is the load-bearing one so nobody drops it as redundant.
```

---

## Testing laws versus what the harness enforces

The plan's five laws, checked against `test/`:

- Replay tests assert replay ran via counters. Enforced by assertCaretSurvivesTyping (assertions.js:100)
  and by the counters contract (counters.js:9-19). NOT enforced by assertNoSecondWrite; see the no-op
  section above.
- No arbitrary sleeps. Genuinely enforced (unit/no_arbitrary_sleeps.test.js), including a self-test that
  the scanner catches a sleep and a pin on the single exempt file. Two notes: the exemption is
  file-level (`if (exempt) continue`), so poll.js is unscanned wholesale, and the scanner covers `test/`
  only, not `src/`. Both acceptable; worth knowing.
- Caret by node identity, never by path. Enforced (caret.js, and the negative self-test at
  harness_selftest.spec.js:235). Collides with layer three; see red flag 1.
- Idempotence as the absence of a second write. Enforced (assertions.js:152) with its negative half at
  :457 and the caret-damage demonstration at :489. This is the best-built thing in the repo.
- Real browser, never jsdom. NOT enforced by anything; there is no jsdom in package.json today and no
  gate check. The plan states the rule in the same shape as the "never rewrite the document" prompt it
  mocks. A three-line check in scripts/lint.js (no jsdom in dependencies, no require of it under test/)
  makes it real for the cost of writing it once.

Two mechanical mismatches:

```
severity   minor
kind       defect
where      plan 0B (Firefox and WebKit projects, "Chromium remaining the default fast lane");
           package.json "gate": "... && playwright test"
what       Adding projects to playwright.config.js makes `npm run gate` run all three by default, which
           contradicts the fast-lane claim and slows every builder's loop.
fix        0B: gate runs `playwright test --project=chromium`; add a `gate:all` script the checkpoints
           run. Say which one CP1, CP2 and Phase 4 use.
```

```
severity   minor
kind       defect
where      plan test/ table row for helpers/service.js ("the readiness file's shape changes with the
           per-review token"); test/helpers/service.js:236
what       The rework line does not mention that readEventLog's path changes from
           <stateDir>/events.log to reviews/<id>/events.jsonl.
fix        Name it in the row. It is the reader every durability and security assertion runs through
           (see red flag 3).
```

---

## Acceptance criteria: falsifiable by an evaluator who did not build the code?

AC3 and AC5 are good as written: concrete steps, an observable outcome, and a fail line an outsider can
apply. The rest need work.

```
severity   important
kind       defect
where      AC1 ("the page's layout differs by a pixel"), AC2 ("any click behaves differently than it
           does without the library")
what       Both are comparisons against a counterfactual the evaluator never observes. AC1 is also
           impossible as stated, since the rail is visible; test #15 already says the real bar is zero
           diff outside the rail's bounds.
fix        AC1: hand the evaluator the scripted screenshot diff from #15 with the crop stated, and the
           two widths. AC2: make the A/B explicit, the walk is run twice, once with the script line
           commented out, with what each click did recorded both times.
```

```
severity   important
kind       defect
where      AC1 and AC4 ("byte-identical", "the caret assertion held")
what       "Byte-identical" has no source of truth when the evaluator typed the text by hand, and "the
           caret assertion held" is an automated suite artifact, not something an evaluator observes on
           the running tool.
fix        AC1: give the evaluator the five strings in a file to paste, then diff the export against
           that file. AC4: split it. The evaluator-observable measures are item count, item text, and
           item state across the five interruptions; the caret assertion belongs in the ranked tests
           where it already is.
```

```
severity   important
kind       defect
where      AC8 ("Fails if: any request reaches a handler without all five server-side checks passing")
what       Not observable from outside the process.
fix        Have the helper append a refusal line naming the check that failed, and judge AC8 on that
           log: five probes, each omitting exactly one check, each producing its own named refusal and
           no state change, plus one fully valid request that succeeds.
```

```
severity   minor
kind       challenge
where      AC6 ("working out the gestures from the page itself without opening the README")
what       An evaluator who read the plan cannot un-know Cmd-Shift-C. The criterion is not falsifiable
           by the person scoring it.
fix        Split into a mechanical half the evaluator can score (every gesture in the D3 table appears
           as a hint line on the rail, with the exact keystroke, without opening a menu) and an honest
           half that needs a genuinely unprimed person. If nobody unprimed is available, say so rather
           than scoring it.
```

```
severity   minor
kind       taste
where      AC7 ("exports as a list that reads as style-guide input")
what       No fail line for the readability half; the rest of AC7 is falsifiable.
fix        Reduce it to what can fail: six rows, each a before and an after, in the Edits tab and not in
           the comment thread, including the formatting-only change.
```

---

## Cleanup needed

Nothing new. The plan's own Cleanup list stands; note that `test/browser/sample.spec.js` and
`test/fixtures/sample.html` are on it and should not be deleted mid-build.
