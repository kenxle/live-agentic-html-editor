## Testing Review (implemented tests)

**Summary.** The built tests close most of the round 1 findings, and several are strong:

- the seam spec types for real and reads every item back from `review.json`
- the scripted agent sees only the item and the source
- the rebuild-mid-sitting test proves a reload was pending and then happened

No blockers. Eleven findings are important. The worst four:

- the drop guard test cannot fail
- one seam test says "the page check did not reopen it" before the page check could have seen the reply
- the proofreading test uses a run short enough to hide a truncation the seams builder already flagged
- the typed-for-real specs have only run in Chromium

Nothing was run for this review except `npm run gate:unit`: 1712 tests, 1710 pass, 0 fail, 2 todo. No browser spec ran.

Read for this review:

- plan Test List and Acceptance Criteria (`03_plan_free_writing.md`)
- architecture Failure Modes, Rollout and old agents, Test Strategy, Build Back-patches
- the round 1 review (`reviews_tmp/testing.md`)
- all seven files under `progress/`
- repo `CLAUDE.md` "Running the gate"
- `git diff 97a8270..HEAD -- test/`, with the seam, host, capture, R14, types, repaint and agent_replies specs read in full, plus the support files, the new unit files, and the code paths the tests wait on (`sync.js` poll timing, `index.js` page check, `replies.js` fold)

---

### I1. The drop test cannot fail

```
severity   important
kind       defect
where      test/browser/free_writing_host.spec.js:116-129
what       The test dispatches a synthetic DragEvent("drop") on #p2 and checks that #p2 did not change.
why        A browser never runs the default action of an untrusted event. A synthetic drop inserts
           nothing, whether or not the guard exists, so the test is green with the guard deleted.
           Round 1 T2 (a blocker) named drop as one of the outside-the-session paths. That path is
           still unproven.
           There is also no test that a drop into a run block arrives as plain text. Test List:
           "Paste and drop arrive as plain text."
fix        - Make a trusted drop: select words in another element, then drag them onto #p2 with
             page.mouse down, move and up (or page.dragAndDrop). Assert #p2 is unchanged.
           - Also dispatch beforeinput insertFromDrop with a target range in #p2, and assert
             defaultPrevented. That reaches the guard at editing.js:1963 in every lane.
           - Add a positive case: drop rich text into a run block, and assert new_blocks holds plain p.
```

### I2. "The page check did not reopen it" is asserted before the check could see the reply

```
severity   important
kind       defect
where      test/browser/free_writing_seams.spec.js:351 (retag), :399 on the loop's first pass (undo a handled run)
what       expectQuietlyHandled and state(page, id) run straight after agentRound's reply, with no
           reload and no wait.
why        agentWrites settles the new load, so the page check (once per load, index.js:1699) has
           already run before `lahe reply` is even called. It had nothing handled to reopen, so the
           "did not reopen" half cannot fail. The state read is also a race: the page learns of the
           reply on its next poll (sync.js POLL_INTERVAL_MS, 1s), and nothing waits for it.
           The single-reload tests have a smaller version of the same race: placement, HTML,
           special characters, split, list, and both notes tests. There the page polls about 1s
           after boot and runs the check about 2.1s after boot. The test never checks that the
           browser had the handled state when the check ran.
fix        - In expectQuietlyHandled, first poll until window.__lahe.itemById(id).state === "handled".
             Then reviewerReloads. Then assert state, badges and counters.revertReopens === 0.
           - In the retag test, add a reviewerReloads before line 351.
           - Better: have the page check count the items it evaluated, and assert the id is among them.
```

### I3. The proofreading seam test is sized under the cut that breaks long runs

```
severity   important
kind       risk
where      test/browser/free_writing_seams.spec.js:671-728; support/scripted_agent.js:96-110; review_format.js boundHistory (BEFORE_MAX 2000)
what       The run is about 170 words, about 900 characters. The scripted agent finds the old sentence
           in after_history[].after_html, which the projection cuts at 2000 characters.
why        The seams builder flagged this (progress, Deviations, second bullet), and it is still open.
           On a sitting of more than about 330 words, which is the proofreading case, the old block
           falls past the cut. The agent cannot find it, inserts the fixed sentence beside the
           original, and the text shows twice. The test's size means it can only pass.
fix        Add a "use-fixes, long run" case: a sitting over 2000 characters, with the suggestion on a
           block past character 2000. Expect it to fail today. Its failure is a contract decision,
           not a test fix. Either:
           - after_history keeps new_blocks uncut for run records, or
           - the contract tells the agent to find the old words by the suggestion's `from`
           Then keep the case as the guard.
```

### I4. The typed-for-real specs have only run in Chromium

```
severity   important
kind       risk
where      progress/phase3_workstream_seams.md "Commands and results"; phase3_workstream_rail.md; phase3_workstream_fixes.md
what       free_writing_seams, free_writing_r14, edits_tab and agent_replies have been run in Chromium
           only. The first Firefox and WebKit run of real typing, rebuild and replay together is the
           checkpoint's gate:all.
why        These are the specs that most need all three engines: real Enter, real B clicks, and a
           real reload of a rebuilt page. 2A already met a WebKit-only click race on the bar
           (progress/phase2_workstream_editing.md, Surprises). A lane failure found at gate:all
           means a code change, which reruns the whole release tier (plan Task 3.6).
fix        Before Task 3.6, the orchestrator runs free_writing_seams and free_writing_r14 once each
           with --project=firefox and --project=webkit, by name. Record the counts on the progress page.
```

### I5. The Cmd-A and cut guard tests never check that the risky state happened

```
severity   important
kind       risk
where      test/browser/free_writing_host.spec.js:90-100 (Cmd-A), :131-146 (cut)
what       Each test acts, then asserts only that the outside blocks kept their outerHTML.
why        If Cmd-A never widens the selection past the session, or Cmd-X never cuts (keyboard
           editing commands differ by engine and platform in Playwright), nothing outside changes
           and the test is green without testing the guard. The Cmd-B and Cmd-Z case (:102-114)
           runs after the session has ended and the host is no longer editable. So it tests that
           the host was put back, not the guard, which T2 asked for.
fix        - After Cmd-A, assert getSelection() contains #p2 before typing.
           - After Cmd-X, assert the run block lost its selected characters, which shows the layer's
             spanning delete ran.
           - Add Cmd-B and Cmd-Z with the session still open and a selection spanning into #p2 (set
             by the Selection API, not by a click).
```

### I6. Page styling (brief R4) is measured only while writing, and only for new blocks

```
severity   important
kind       risk
where      test/browser/free_writing_types.spec.js:287-338; Acceptance R4
what       The computed-style test checks new p, h2 and ul blocks while the session is open.
why        R4 names three kinds of block, "new, split, and retyped", and says "while writing and after
           commit". Four things are never measured:
           - after commit, when the host's contenteditable and the frame come off
           - a split tail
           - an existing block retyped to a heading
           - h3 and h4
           Round 1 T11 also asked for the gap to the next block. The 53px to 31px regression the
           spike found was a gap.
fix        In the same loop:
           - measure again after Esc
           - add a split case and a retype case (p to h2, p to h3) against the page's own twin
           - compare nextElementSibling.getBoundingClientRect().top minus the block's bottom with
             the twin's
```

### I7. The layer half of the version check has no test, and no code

```
severity   important
kind       defect
where      test/unit/protocol_wire.test.js:451-456; Test List "A CLI and layer on contract version 14 refuse a helper on version 13"; architecture "Rollout and old agents"
what       Only the pure helperContractVerdict is tested. Nothing tests that `lahe add` or `lahe session`
           acts on OLDER. The layer makes no contract check at all (progress/phase1_workstream_kernel.md,
           Follow-ups).
why        The architecture says a new layer refuses an old helper, because an old helper stores run
           records with no allowlist and never projects new_blocks. The Test List line reads as
           covered. A layer served against a 13 helper would send runs the helper cannot check,
           and every test stays green.
fix        - Add a CLI test: a fake helper answering service_contract 13 is replaced or refused by
             `lahe add`, and the output says so.
           - Take the layer half back to the architecture as a decision. Either the layer checks,
             with a test, or the Rollout line is changed to say only the CLI checks.
           - Write the literals as SERVICE_CONTRACT - 1 and SERVICE_CONTRACT, so the test still
             tests the bump at 15.
```

### I8. A notes file with front matter is never tested (brief R13)

```
severity   important
kind       risk
where      test/browser/free_writing_seams.spec.js:623-669; brief R13 "at the top below any front matter"; markdown.js splitFrontmatter
what       Both notes-page seam tests start from an empty file. The scripted agent handles front
           matter, but no test gives it any.
why        The render turns front matter into page metadata (markdown.js:322). That metadata block
           can become the first leaf the reader sees, and the file title may no longer be the
           marked file-name title. Three things could then go wrong, and all of them pass today:
           - the "no content blocks" test that opens the page ready to type
           - where startPointIn lands
           - the handled check's first-block match
fix        Add a notes seam case: a file holding only front matter (title and date), lahe write,
           type two blocks, place, rebuild. Assert:
           - the page opened ready to type
           - the blocks sit below the metadata, once
           - the handled check passes
           - the source keeps its front matter byte for byte
```

### I9. The crash test crashes the renderer only, and reads the result only from review.json

```
severity   important
kind       risk
where      test/browser/free_writing_seams.spec.js:518-575
what       Page.crash kills the renderer, then Browser.close shuts the browser down cleanly. The test
           checks the item in review.json and nothing on the page.
why        A clean Browser.close flushes browser storage. A real browser crash (the process killed)
           does not, so a run typed in the last moments can be lost, and this test cannot see that.
           R5 also says the reviewer "can reopen it and keep writing". After the relaunch nothing
           checks that the run is on the page once, or that Cmd-Shift-E on it reopens the record.
fix        - Add a variant that kills the browser process with SIGKILL, using the pid from the
             launch, after the draft shows three blocks. If it loses the last keystrokes, say how
             many on the progress page. That is a product question for Ken, not a test fix.
           - After the relaunch, assert each block shows once, and that Cmd-Shift-E on the last
             block reopens ref.id.
```

### I10. The refusal card is proven only against stand-in helpers

```
severity   important
kind       risk
where      test/browser/support/refusing_helper.js; test/unit/draft_flush_cadence.test.js (the refuse stub); edits_tab.spec.js:555
what       Both tests build the helper's `rejected` answer by hand. No test feeds the real
           log.append / events.append answer to sync's refuseRunEvents.
why        CL9 and T13 (a refused run is never shown as sent) depend on the fields the real route
           returns. The stand-ins differ from the real route already:
           - no `stored` or `duplicates`
           - a reason with no code prefix
           If the route's shape drifts, both stand-ins stay green and the reviewer's words silently
           stop reaching the agent. The layer's byte-size estimate, which is meant to stop input
           before the helper refuses, is also never checked against validateRun at the byte ceiling
           in a browser. Only the 400-block ceiling is.
fix        - One unit test: run the real routes["events.append"] on a forged run event. Hand its
             body to sync's refusal path through a fetch stub that returns exactly that body.
             Assert RUN_EVENT_REFUSED carries the helper's code.
           - Add a byte-ceiling case to the types spec: paste multibyte text to about 200000
             bytes, and assert the bar refuses before validateRun would.
```

### I11. Special characters: the record and the source are never checked end to end (brief R6)

```
severity   important
kind       risk
where      test/browser/free_writing_seams.spec.js:283-306
what       The test compares only the page's text with the typed text.
why        R6 says the words match "on the page, in the record, and in the source". Real capture on
           a real review is checked only in the capture spec, against a fixture on a static page.
           If the helper, the projection or the drain line mangles a character (double escaping,
           an unescaped `<` in text), the scripted agent turns it back, because it decodes and then
           escapes everything. The page still matches.
fix        Also assert:
           - the item read back from review.json: new_blocks[0].text equals the typed text
           - agent.mdWords of the placed source block equals the typed text, folded
```

### I12. The proofreading seam test reads the new revision without waiting for it

```
severity   minor
kind       risk
where      test/browser/free_writing_seams.spec.js:711-712
what       After the button's click(), committed(page) returns the first ready edit at once, and the
           test expects rev + 1.
why        If the item was already ready (a question keeps it outstanding) and the bump lands a tick
           later, committed() returns the old rev and the test fails for timing, not behavior.
           agent_replies.spec.js polls for rev + 1 at the same step.
fix        Poll itemById(id).rev === ref.rev + 1 before calling committed(), as agent_replies does.
```

### I13. Rebuild mid-sitting checks that the caret is in the run, not that it stayed put

```
severity   minor
kind       risk
where      test/browser/free_writing_seams.spec.js:496-507
what       caretInRun is true for any caret position inside a session block.
why        R7 promises the caret stays for Lahe's own rebuild. A caret that jumped to the start of
           the anchor or the run would pass.
fix        Record the block index and offset before the source write (use caretSpot from the repaint
           spec), and assert both are equal while the reload is pending.
```

### I14. The old-agent tests allow a block to vanish

```
severity   minor
kind       risk
where      test/browser/free_writing_seams.spec.js:751
what       Each block's count is asserted to be at most 1.
why        In Markdown the test also needs the item to reopen, so a lost block is at least flagged.
           But nothing checks the architecture's claim that an old agent "places every word". An
           old agent that dropped the list would still pass.
fix        In the Markdown case, assert that every block's words appear once, with any tag (count
           equals 1). Keep the reopen assertion.
```

### I15. The engine corpus is hand-written, not captured

```
severity   minor
kind       risk
where      test/fixtures/free_writing/corpus.js ENGINE; test/unit/clean_block.test.js:111-125
what       The fixed-point test runs over nine samples someone wrote down, not markup a browser produced.
why        What WebKit and Firefox really leave in a block is absent from the corpus:
           - `<span style="font-weight: bold">`
           - `<div>` wrappers
           - `<br type="_moz">`
           cleanBlock refuses those. The capture spec covers what Lahe's own bar produces, but not
           what the native engine leaves after a native merge or IME.
fix        In each lane, save each captured block's innerHTML from the capture and host specs to
           testInfo.outputPath before cleaning. Add any sample that differs from the corpus to
           corpus.js.
```

### I16. The R14 spec keeps its own copy of the world helpers

```
severity   minor
kind       taste
where      test/browser/free_writing_r14.spec.js:53-299 against test/browser/support/lahe_world.js
what       makeWorld, settled, agentWrites, helperHas and reply are copied rather than imported.
why        The copies have already drifted:
           - the R14 reply does not wait for a new reply.at
           - the R14 agentWrites uses a fixed mtime offset
           The next fix to one copy will miss the other.
fix        Import lahe_world.js in the R14 spec, and delete the local copies once the spec passes.
```

---

### Round 1 findings, against what was built

| # | Finding | Built | Holds? |
|---|---|---|---|
| T1 | "Use the fixes" through to handled | Seam test, both answers, two reloads | Yes, for short runs. Long runs: I3 |
| T2 | Guard against outside edits | Seven cases in the host spec, body-level page | Partly. Drop cannot fail (I1). Cmd-A and cut do not check the precondition (I5) |
| T3 | Old-record specs | `replay_old_records.spec.js`, 23 injected cases; 2A's Enter list | Yes |
| T4 | Fixtures against real capture | Capture spec types all 10 and deep-equals them, three lanes | Yes |
| T5 | Special characters | Seam case, handled_check_run cases, "# " mid-line | Page only (I11) |
| T6 | cleanBlock fixed point, real capture accepted | Unit fixed point; seams read review.json | Yes, Chromium only (I4, I15) |
| T7 | Contract-only agent, HTML case | Agent takes item and source only; HTML case from a drain line | Yes |
| T8 | Old agents | Both sources | Yes, with the HTML deviation the seams builder raised. I14 |
| T9 | Empty-container rung negatives | Two unit cases | Yes |
| T10 | Merge both directions | Shorter-run and later-revision cases | Yes |
| T11 | Page styling asserted | Computed styles while writing | Partly (I6) |
| T12 | Reload pending during a rebuild | reloadPending, reloadChecks, navigation count, no hand fallback | Yes. Caret offset: I13 |
| T13 | At the ceiling | 400-block refusal at the bar; refusal card via a stand-in | Partly (I10) |
| T14 | Undo through the agent | Both seam cases | Yes. Undo is `editing.undo(id)`, not the row button |
| T15 | Crash | Renderer crash, persistent context | Partly (I9) |
| T16 | Matcher false presence | Four negative cases plus the walk limit | Yes |
| T17 | 2A in all three lanes | 2A ran its six specs in each lane | Yes for 2A. Not for the seams (I4) |
| T18 | Readers on a malformed corpus | Every fixture page and five traps, DOM against string | Yes. The corpus is small |
| T19 | `lahe write` day two | Exit 0, bytes unchanged; directory refused; real path | Yes |
| T20 | Tests that restate the code | Literal after and change strings, canary | Yes |
| T21 | R14 lines name what the agent does | Spelled out in the spec header and each case | Yes |
| T22 | R14 seed | Reference file only; spec on test/helpers | Yes. Copy drift: I16 |
| T23 | Version bump | Pure verdict only | No (I7) |
| T24 | Hotkeys by code | Digit2 with key "™", AltGraph refused | Yes |
| T25 | Smaller editing gaps | Arrows, Delete, 101st step, IME, handled then new record, notes after_anchor | Yes |
| T26 | Proofread boundary | 150, 151, from_anchor, notes | Yes |
| T27 | R7 wording | Reworded under PQ4 | Yes |
| T28 | Lanes for injected specs | Rejected | n/a |

### Which tests need which browsers

- **Unit is enough:** everything under `test/unit/`, including the handled check on real renders and the refusal round trip I10 asks for.
- **Chromium is enough:**
  - `replay_run_insert`, `replay_run_check`, `replay_run_anchor`, `replay_old_records`: injected records, a stand-in rail, no typing
  - `blocks_kernel`, apart from the reader comparison
  - the crash test and both IME tests: they need Chromium's DevTools protocol
- **All three lanes:**
  - `free_writing_host`, `free_writing_capture`, `free_writing_types`, `free_writing_undo`, `free_writing_repaint`, `free_writing_empty`: native editing differs by engine
  - `free_writing_seams` and `free_writing_r14`: real typing, a real B click and a real reload of a rebuilt page. Not yet run outside Chromium (I4)
  - the reader comparison in `blocks_kernel`: the DOM side is each engine's own parser
  - the drop and paste cases (I1): each engine has its own path, as `fw.pasteText` already shows

### Flaky by construction

- I2: the page state is read with no wait for the reply to reach the browser.
- I12: the new revision is read with no wait.
- `lahe_world.writeSource` adds a random 0 to 999 ms to a future mtime. The layer compares mtimes with `===`, so this only matters if two writes collide. A counter that adds one second per write would be deterministic.
- `freePort` closes the port before the CLI binds it. Another worker can take it in between. This is rare, and the same pattern exists in older specs.

No arbitrary sleeps were found in the new specs. Every wait polls a named condition.

### Cleanup needed

- None from this review. `test/browser/tmp_image_pick.spec.js` is untracked on main. It is not part of this diff and was not read.
