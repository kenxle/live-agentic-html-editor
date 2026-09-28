## Testing Review (Round 1)

**Summary.** The test list is thorough on shapes and allowlists. It is thin in three places:

- flows where two decisions meet (proofreading fixes against the always-on handled check)
- what the editable parent lets the reviewer do outside the session
- the seam between the fixtures 2B builds against and what 2A really captures

Several tests would pass against a wrong implementation, and are named below. Two findings are blockers.

Read for this review:

- the plan's Test List and every task's Acceptance
- brief R1 to R15 and its Decisions
- the architecture's Key Flows, Failure Modes and Test Strategy
- `CLAUDE.md` "Running the gate"
- `test/helpers/README.md`, `test/unit/no_arbitrary_sleeps.test.js`, `no_duplicate_text.spec.js`, `split_not_conflict.spec.js`, `protocol_wire.test.js`, `draft_flush_cadence.test.js`
- the R14 walk (`r14_repro/repro.js`, `probe_reload.js`, `out/results-all.json`)

---

### T1. Accepting the proofreading fixes is untested, and two decisions may collide there

```
severity   blocker
kind       risk
where      plan Task 3.3, Task 2.9 (AQ3), Task 2.7; Test List "Across the seams"
what       No test follows "Use the fixes" through to the agent rewording the run and replying handled.
why        After the reviewer says yes, the agent changes the words (brief R11). The always-on
           handled check (AQ3) then looks for the reviewer's original words and holds the item
           open. The browser page check looks for them too and reopens it as "undone". Replay may
           also treat the reworded blocks as missing and insert the originals beside the fixes.
           Task 3.3 only checks that the button posts a thread reply. So the most likely outcome of
           proofreading ships unseen.
fix        Add a seam spec to Task 3.4. Type a run over 150 words. The scripted agent places it and
           replies question. Click "Use the fixes". The agent rewords one sentence and replies
           handled. Assert: not held open, not reopened after two reloads, and the original
           sentence is not on the page. Add the "Keep my words" twin. If it fails, the fix is a
           design change (the check needs to know which words the reviewer approved), so it goes
           back to the architecture, not into the test.
```

### T2. The guard is tested at the session's edges, not against edits that start outside it

```
severity   blocker
kind       risk
where      plan Task 2.1 Acceptance; Test List "Writing (2A)"; architecture "The editing host"
what       The only outside-the-session tests are Backspace and Delete at the outer edges, and a click
           into another block.
why        The whole parent is contenteditable, so every page block beside the session can take
           input. What the plan does not test:
           - Cmd-A inside the host selects the whole parent. Typing or Backspace then spans page
             blocks outside the session.
           - Arrow keys move the caret into a sibling block without a click. The Test List says
             "caret moving" but Task 2.1 tests only a click.
           - In that sibling: Cmd-B, native undo (historyUndo), drop, and composition start.
           - A page whose anchor sits directly in body, which puts the Lahe overlay's host
             element inside the editable parent.
           A gap here changes page text outside any record. No record means the agent never hears
           of it.
fix        Add to free_writing_host.spec.js, in all three lanes. For each case, snapshot the
           outerHTML of every page block outside the session, act, and assert each is unchanged:
           - Cmd-A then type
           - Cmd-A then Backspace
           - ArrowDown out of the run then type
           - Cmd-B and Cmd-Z in that block
           - a drop onto it
           Add one fixture whose paragraph is a direct child of body, and assert the rail still
           works and takes no edits.
```

### T3. "Old-record specs pass unchanged" stops testing old records once 2A merges

```
severity   important
kind       defect
where      plan Task 2.5 Acceptance, Test List "Old-record specs ... pass unchanged"
what       no_duplicate_text.spec.js and split_not_conflict.spec.js make their edits by pressing Enter
           in a real edit.
why        After 2A, that Enter makes a sibling and the record is a run record. The specs keep
           passing, but now they exercise the new path. Today's replay path for records without
           new_blocks loses its only browser coverage without anyone noticing. The plan also does
           not say which existing specs 2A's Enter change is expected to alter. That list includes
           paragraph_break.spec.js and the append helpers in no_duplicate_text.spec.js. A builder
           facing a red spec at the checkpoint has no written expectation to hold it to.
fix        - Add an injected old-shape record variant to each of the three specs, built from
             record_fixtures.js with nested blocks and no new_blocks. That variant is the old-path
             guard.
           - In Task 2.1, list every existing spec whose expected result changes, with its new
             expected result.
           - List the rest as "must pass unchanged".
```

### T4. The fixtures are the 2A to 2B contract, but only one is checked against real capture

```
severity   important
kind       risk
where      plan "Who owns what at each seam"; Task 2.1 Acceptance (capture test); Task 3.4
what       Task 2.1 deep-equals only the architecture's worked example. 2B builds every other path
           against hand-written fixtures.
why        Those other paths are:
           - split tail, with and without typing
           - tag-only change
           - tag change with new words
           - paragraph turned into a list
           - list append
           - start_of_container
           Each engine writes its own markup: trailing br, nbsp, b against strong, nesting order. If
           a fixture differs from what typing produces, 2B's replay passes on the fixture and fails
           on real records. The first time this shows is Task 3.4, after the merge. Task 3.4 also
           never types a mid-block split (from_anchor) through to a rebuild.
fix        - Make free_writing_capture.spec.js type every fixture that typing can produce, deep-equal
             each one, and run in all three lanes.
           - Add a from_anchor seam case to Task 3.4: Enter mid-paragraph, type, commit, the agent
             splits the source, rebuild. Assert the text shows once and there is no conflict card.
```

### T5. Words with special characters are never typed end to end (brief R6)

```
severity   important
kind       risk
where      Test List (no line for R6); Acceptance "R6"; Task 2.9; architecture "Literal text" contract line
what       No test types words that the source format reads as syntax, and checks that the page
           shows them as typed.
why        Characters to cover:
           - < and &
           - * and _
           - backticks
           - a # or "1." mid-line
           - straight quotes and --
           Possible failures:
           - cleanBlock escaping twice (&amp;lt;)
           - the scripted agent's escaping
           - the typography fold in the handled check
           Each changes the reviewer's words or holds a correct item open forever. Under AQ3 a
           false hold happens on every run that contains a dash or a quote.
fix        - Add a Task 3.4 seam case: a run containing each character above, placed by the
             scripted agent, then a rebuild. Assert the page's text equals the typed text with
             typography folded. Assert the handled check passes and the page check does not reopen.
           - Add unit cases to handled_check_run.test.js: "a < b & c", correctly escaped, passes.
             Straight quotes rendered curly, and -- rendered as a dash, pass.
           - Add a negative Markdown shortcut test: "# " typed mid-paragraph is not a header.
```

### T6. cleanBlock is never shown to accept its own output or real captured markup

```
severity   important
kind       risk
where      Task 1.2 Acceptance; Task 2.8 Acceptance
what       The cleanBlock tests are all refusals. Nothing checks that valid input comes through
           unchanged.
why        The layer cleans at capture and the helper refuses anything that fails. If
           cleanBlock(cleanBlock(x)) is not x, or Firefox or WebKit capture produces markup the
           helper reads as a failure, every real record from that browser is refused. The reviewer
           sees nothing, because the browser keeps the draft. Task 2.8's "a valid run is stored"
           uses hand-written fixtures only.
fix        - Unit test: cleanBlock is a fixed point on its own output for a corpus of engine
             markup. The corpus covers b, i, nbsp, trailing br, nested strong and em, entities,
             and uppercase tags.
           - In Task 3.4, read the item back from review.json at the committed revision in every
             lane. Do not read window.__lahe.items(). That proves the helper accepted real capture.
```

### T7. The "contract-only" scripted agent cannot prove R9 as written

```
severity   important
kind       risk
where      Task 3.4 "The contract" bullet; Acceptance R9
what       The scripted agent is written by someone who read the architecture. It places only
           Markdown, and the plan does not say where it reads the item from.
why        R9 says an agent reading only review.json places runs in HTML and Markdown. A script
           that reads the browser store, or that writes a Markdown-only placement, passes while an
           HTML review fails. The repro walk reads window.__lahe.items(), and seeding from it
           invites the same shortcut.
fix        - Build the scripted agent as a function whose only inputs are the parsed review.json
             item and the source text.
           - Add an HTML source case: lahe review page.html, blocks placed as elements after the
             anchor, rebuild, both checks pass.
           - In Task 3.5, give the real-agent walk a named checklist: HTML and Markdown, a header,
             a list, a split, start_of_container.
```

### T8. The rollout claim about old agents has no test

```
severity   important
kind       risk
where      architecture "Rollout and old agents"; Test List (none)
what       "An old agent still acts through after_html, and nothing is dropped silently" is
           asserted but never exercised.
why        An old agent writes the whole after_html into the anchor. The new blocks then sit inside
           the anchor, before the insert point. Blocks of five or more words are "found elsewhere",
           so they are not written. Blocks under five words are missing from the walk, so they are
           inserted again, which shows them twice. The anchor compare may land in branch four and
           hold everything. None of these outcomes is pinned.
fix        Add two seam cases with an old-contract scripted agent:
           - HTML: after_html applied as the anchor's inner markup.
           - Markdown: `after` pasted as paragraphs.
           Assert that no block shows twice and that the item is reopened or flagged, not quietly
           handled.
```

### T9. The empty-container rung is tested only for success

```
severity   important
kind       risk
where      Task 2.3 Acceptance (anchor_engine.test.js); architecture Failure Modes "anchor block itself is gone"
what       The rung is only tested for resolving on an empty page. Nothing tests that it stays out
           of the way otherwise.
why        If the rung is checked too early, a record whose anchor is gone resolves to main.
           Its run is then placed at the top of the page by guess, not marked LOST. The same
           happens to an after_anchor record on a page the agent emptied. The positive test
           passes either way.
fix        Add to anchor_engine.test.js and replay_run_insert.spec.js:
           - an after_anchor record whose anchor is gone, on a non-empty page, is LOST and inserts
             nothing
           - the same record on an emptied page is also LOST
```

### T10. The merge test would pass a "longer run wins" rule

```
severity   important
kind       defect
where      Task 1.4 (merge_run.test.js); Test List "Merge on load keeps the browser's longer run"
what       The only case is browser longer than store.
why        The rule is "the browser wins on these fields while its work is unacknowledged". A wrong
           implementation that keeps the longer new_blocks passes. It would bring back blocks the
           reviewer deleted in the browser after the helper's last draft.
fix        Add the reverse: at the same revision, the browser's run is shorter, and the browser
           still wins. Add a third case: a later helper revision wins over an acknowledged
           browser copy.
```

### T11. Page styling (brief R4) has screenshots and no assertion

```
severity   important
kind       risk
where      Acceptance R4; Tasks 2.1, 2.2, 2.6 screenshots
what       Nothing fails the gate if a new block stops matching the page's spacing or type.
why        The spike caught exactly this with numbers: spacing went from 53px to 31px, and the
           font from 21px to 16px. A screenshot on a progress page is not read by the gate, so
           a CSS or host regression passes every run.
fix        Add computed-style assertions in free_writing_types.spec.js, in all three lanes, on
           blog.html and md_render.html. Compare against the page's own block of the same tag:
           - margin-top and margin-bottom
           - font-size, line-height and font-weight
           - the gap to the next block
           The only allowed difference is the new h2's section rule. Reuse the spike's measuring
           code.
```

### T12. "The reload waits" can pass without a reload ever being pending

```
severity   important
kind       risk
where      Task 3.4 "agent's rebuild lands mid-sitting"; Test List "Agent rebuild mid-sitting"
what       The test as written checks that the caret stays. It does not prove a reload was pending,
           or that one happens after commit.
why        The repro walk shows the timing traps:
           - a write before the page has its mtime baseline never reloads
           - agentWrites falls back to "reloaded by hand" after 30 seconds
           Seeded from that, the test passes if detection simply has not fired yet. It also passes
           if reloads are suppressed forever.
fix        - Poll sync.status().reloadPending === true while the sitting is open. Then assert the
             caret and the text.
           - Commit, then assert that a main-frame navigation happened and the rebuilt content is
             on the page.
           - Drop the hand-reload fallback from every ported helper. A missing self-reload must
             fail the test.
```

### T13. What happens at the ceiling is untested, only the warning before it

```
severity   important
kind       risk
where      Task 2.2 Acceptance ("a run near the ceiling shows the warning"); Task 2.8
what       No test covers the reviewer typing past NEW_BLOCKS_MAX or NEW_BLOCKS_MAX_CHARS.
why        The helper refuses the event. Nothing tells the reviewer or the card that their post
           no longer reaches the agent. The next drafts and the commit are refused too, while the
           browser still shows the text.
fix        Inject a run at the ceiling, add one block, commit. Assert one of two outcomes, and
           have the plan say which is intended:
           - the layer stops the extra block
           - the card shows the refusal
           Either way, assert the item is not shown as sent.
```

### T14. Undo (brief R15) stops before the agent acts on the take-back

```
severity   important
kind       risk
where      Task 2.4 and Task 3.4 "paragraph to header ... undo"; Acceptance R15
what       The tests end at "a take-back item is raised". Two other paths are missing:
           - an unplaced run is undone and the page reloads
           - the agent removes the placed blocks after the take-back
why        Replay inserts the missing blocks of a run record. If an undone record is still
           replayed, the removed run comes back on the next load. Once the agent removes the
           blocks, the original record's page check may reopen it as "undone", because its
           blocks are gone.
fix        Add two seam cases:
           - Undo a ready run, reload twice. Assert the run is gone.
           - Undo a handled run. The scripted agent removes the blocks and replies handled on
             the take-back. Rebuild. Assert nothing is reinserted and neither item reopens.
```

### T15. A browser crash mid-sitting (brief R5) is untested for run records

```
severity   important
kind       risk
where      Acceptance R5 ("a crash, a reload, and a repaint"); Test List (reload and repaint only)
what       No test covers a crash, where no unload runs.
why        Run drafts now reach the helper only every 30 seconds. After a crash, only the
           browser-storage copy holds the run. A large run in browser storage is also where quota
           trouble would show up (see storage_quota_typing.test.js).
fix        Add a Chromium spec that uses a persistent context:
           - type a multi-block run
           - kill the page without unload (the Page.crash call in Chromium's DevTools protocol, or
             close the context)
           - relaunch
           Assert the next load commits the whole run. If a crash test already exists in the
           repo, reuse its approach.
```

### T16. The matcher is tested only for finding blocks, not for finding them wrongly

```
severity   important
kind       risk
where      Task 1.2 Acceptance (matcher); Task 2.6 presence table tests
what       Tests cover whole, joined, split and missing. None covers a block wrongly counted as
           present.
why        The "joined" rule lets a short block's words match inside a later unrelated
           paragraph. For example, "Notes" matches a paragraph that contains the word "notes".
           The block is then never inserted. A wrong "present" is the silent-loss direction, and
           a matcher that says "present" too often passes every test in the list.
fix        Add negative matcher cases:
           - a short block whose words appear inside a later unrelated block is missing
           - blocks out of run order are not present
           - a block that is a prefix of a longer block is not present
           Also state where the walk stops, and test that limit.
```

### T17. Engine-specific editing is first run in Firefox and WebKit at the checkpoint

```
severity   important
kind       risk
where      "Rules every builder follows"; Task 2.1 to 2.4; Test List "in any browser"
what       2A builds the host, types, undo and paste in Chromium only. The first Firefox and WebKit
           run is Task 3.5, after the merge.
why        Everything AQ1 rests on differs by engine:
           - Enter and Shift-Enter already disagreed across engines (paragraph_break.spec.js)
           - beforeinput for historyUndo
           - native merge spans
           - paste
           A 2A engine bug found at 3.5 costs a fix round on the integrated branch. Paste has a
           second problem: a dispatched paste event does not produce beforeinput
           insertFromPaste, and Playwright grants clipboard only in Chromium (ac1_walk.spec.js).
           So the paste test either tests a different path or skips two lanes without saying so.
fix        - Before handoff, 2A runs its own four spec files in all three lanes by name:
             LAHE_ALL_BROWSERS=1 npx playwright test --project=firefox <file>. This is one named
             file at a time, which the gate rules allow.
           - For paste, name the path each lane tests. Use a real Meta+V in Chromium, and say what
             stands in elsewhere.
```

### T18. The handled check reads HTML with a string reader that is only compared on well-formed pages

```
severity   important
kind       risk
where      Task 1.3 Acceptance ("DOM walk and string reader agree on every Task 1.1 fixture")
what       The two readers are compared on three or four clean pages.
why        The helper's handled check reads built pages with the string reader. That includes
           hand-written HTML reviews. The browser closes a p before a div on its own, and the
           same goes for an unclosed li. Other traps: a script body containing "<p>", template
           contents, comments. Where the readers disagree, the helper holds a correct item open,
           or passes a missing one.
fix        Run the same comparison over every page under test/fixtures, plus a small malformed
           corpus covering each trap above. Where the readers disagree, fix the reader, not the
           fixture.
```

### T19. The `lahe write` overwrite test can pass against a command that refuses existing notes

```
severity   important
kind       defect
where      Task 2.10 Acceptance "it refuses to overwrite"; architecture flow "exists? yes: regular .md file: use it as is"
what       The test line does not say what happens when the file already exists.
why        The architecture says an existing regular .md is served as is. That is how notes are
           reopened the next day. A test that expects an error on an existing file passes for a
           command that breaks the second day.
fix        Split the test in two:
           - An existing regular .md: exit 0, served, contents byte-identical afterwards.
           - A directory named x.md is refused.
           Add a test that the printed folder is the real path when the parent is reached
           through a symlinked folder.
```

### T20. Two tests restate the code and cannot fail

```
severity   minor
kind       defect
where      Task 1.4 ("after read from after_html equals the builder's after"; "change text contains none of the run's words")
what       The first compares the shared reader's output with itself. The second passes on an empty
           or generic change string.
why        Both stay green when the reader or the change text is wrong.
fix        - Assert `after` against literal strings written in each fixture. The worked example's
             `after` is given in the architecture.
           - Assert the exact change sentence per fixture.
           - Put a unique token (for example "zqxcanary") in each run's words and assert it is
             absent from change.
```

### T21. The R14 test lines do not say what the agent does

```
severity   minor
kind       risk
where      Task 3.4 free_writing_r14.spec.js; Test List "R14 lone paragraph: the bold survives"
what       The lone-paragraph case fails only when the agent leaves out the bold paragraph. That is
           what the repro does, in two variants. The test line does not say it.
why        With a correct agent the bold is in the source, and the test passes against today's
           code. The header case doubled with both ways of leaving the editor (click and Esc).
           The line names neither.
fix        Spell out each case:
           - Lone paragraph: bold in the first and in the second paragraph. The agent omits the
             bold one. Assert the item reopens and the bold paragraph shows once, with its bold.
           - Header case: run with click and with Esc. Assert the h2's innerText is exactly the
             header, not the header plus the line.
```

### T22. The R14 walk is not ready to live under test/fixtures as a seed

```
severity   minor
kind       risk
where      Task 1.1
what       repro.js has several problems as a seed:
           - it hard-codes /Users/kennethstclair/... and requires node_modules/playwright directly
           - it writes worlds/ into its own folder
           - it sleeps (3000 ms, 500 ms)
           - it asserts nothing
why        test/fixtures is skipped by the no-sleep scanner, so the sleeps escape the rule. A spec
           that imports its helpers inherits them. Its worlds pile up in the repo, and removing
           them needs Ken's approval. "Reproduces as results-all.json recorded" has no pass or
           fail.
fix        Port the walk's steps onto test/helpers (service.js, poll.js). Put the worlds under
           testInfo.outputPath(). Keep repro.js as a reference file only. Otherwise write the
           three pre-fix outcomes as assertions that are expected to fail today.
```

### T23. The version bump test does not test the bump

```
severity   minor
kind       defect
where      Task 1.5 ("the existing refusal of an older helper passes at 14")
what       protocol_wire.test.js asserts only that SERVICE_CONTRACT is an integer of at least 1.
why        It stays green at any number. Nothing shows that a 14 layer or CLI refuses a 13 helper.
fix        Assert that a 13 helper is refused by the CLI and by the layer, and that a 14 helper
           is accepted.
```

### T24. Hotkey tests cannot see the macOS problem they were designed around

```
severity   minor
kind       risk
where      Task 1.5; Task 2.2
what       Playwright's key events do not produce Option-digit characters. Nor can Playwright see
           shortcuts the browser itself reserves.
why        The browser spec passes whether or not matching uses event.code.
fix        - In the unit test, build events with code "Digit1" and key "¡", and assert they match.
           - Add a reserved-chord check per browser to the Task 3.5 walk.
```

### T25. Smaller editing gaps

```
severity   minor
kind       risk
where      Task 2.1, 2.3, 2.4; Acceptance AQ1
what       Cases with no test:
           - arrow-key and Shift-arrow crossing between the anchor and the run (AQ1's own acceptance)
           - Delete at the anchor's end merging the first run block
           - cut across blocks
           - drop
           - IME composition inside a session block
           - the 101st session history step
           - a new sitting on a run block after the record is handled (it must start a new record)
           - a notes page after the agent places the first record: the next sitting is
             after_anchor on the last block, not start_of_container
why        Each is a named rule in the architecture with nothing that fails if it breaks.
fix        One test each, in the spec that owns the rule.
```

### T26. The proofreading threshold has no boundary test

```
severity   minor
kind       risk
where      Task 1.6 (PROOFREAD_MIN_WORDS); Acceptance R11
what       Only a real agent counting words applies the threshold. Nothing pins 150 against 151,
           or the skipping of from_anchor blocks.
why        The plan says "150 words", while the architecture says "more than". No automated test
           can fail on either.
fix        Have the projection carry the derived word count, or a proofread flag. Then:
           - unit test 150, 151, and a run whose words over the line are all from_anchor
           - have the scripted agent use the field
```

### T27. R7's "the caret stays" is only possible for some reloads

```
severity   minor
kind       challenge
where      Brief R7; Acceptance R7
what       The acceptance claims the caret stays on a reload mid-writing.
why        The tests cover a Lahe rebuild (the reload waits) and a repaint. A dev server's own
           full reload, or the reviewer pressing reload, commits on unload and loses the caret.
           No test can pass that case as written.
fix        Reword the acceptance to name the reloads that keep the caret. For the others, say the
           run is back and reopens where the reviewer clicks. That is what Task 3.4 tests.
```

### T28. Engine-neutral specs pay for three lanes

```
severity   minor
kind       taste
where      Tasks 2.5 to 2.7, 3.2, 3.3
what       replay_run_*, edits_tab and agent_replies inject fixtures and do no typing. They still
           run in all three lanes on gate:all.
why        This triples their cost at the checkpoint for little cross-engine signal. Battery was
           the stated reason for the gate rules.
fix        Optional: keep the full cross-engine budget for the typing specs (2A and 3.4), and
           tag the injected-fixture specs Chromium plus one other lane.
```

---

### Unit or browser, and which need all three engines

- **Unit (node:test, no jsdom):**
  - cleanBlock and its fixed point
  - the string reader and the matcher
  - record validation, change text, merge
  - projection and contract copies
  - hotkey matching by event.code
  - draft cadence, with the mock timers already in use
  - the handled check against rendered pages
  - `lahe write`
  - presence-table decisions (pure)
- **Browser, Chromium is enough:**
  - replay inserts and the page check from injected fixtures
  - edits tab and card
  - the proofreading card
  - the crash spec (it needs Chromium's DevTools protocol)
- **Browser, all three engines, run by 2A before handoff:**
  - free_writing_host, capture, types and undo
  - the T2 guard cases
  - the T11 style assertions
- **Browser, all three engines at the checkpoint:**
  - free_writing_seams and free_writing_r14, since they type for real
  - the reader comparison in blocks_kernel

### Cleanup needed

- Task 1.1 as written copies the R14 walk into `test/fixtures/free_writing/`. The walk writes a `worlds/` folder beside itself. If it is ported as planned, list that folder under "To delete at cleanup".
