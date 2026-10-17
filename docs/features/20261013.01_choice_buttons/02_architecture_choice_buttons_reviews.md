## Architect Review (Round 1)

Reviewer: review-architect. Read against the brief (R1 to R19), `docs/ongoing/ARCHITECTURE.md`, `docs/CONTRACTS.md`, the diagrams named in the task, `docs/ongoing/OUTBOX_COALESCING.md`, and the code at the lines cited below. Nothing in the architecture or the brief was edited.

### Summary

The shape is right: a new kind, no new state, no new route, the agent writes the decision into its own source. Fourteen findings follow. The first one should be fixed before anything is built. It changes the attribute agents write into their pages, so fixing it later breaks every page already written.

- The group id attribute, `data-lahe-choice`, sits in the prefix the code strips as the tool's own markup. Edits and comments near a group lose the id.
- The press batch does not work the way the doc says. The helper writes one wake line per press, not one per flush. What actually wakes an agent is `lahe monitor`, which polls every 15 seconds. And the 3 second window, as described, would be bypassed by the poll loop's flush.
- A helper-served page whose file already carries this review's script tag is served with that tag as it is. That page never gets `data-lahe-document`, so its groups stay inert.
- A press's drain line would carry the region facts and the stamp. The contract then tells the agent to write a `data-lahe-id` into an HTML source.
- The `choice` field's class and its "cannot carry prose" claim need enforcing in more places than the doc lists.
- Replay, lost-marking and "show me where" are simpler with one new rung in the anchor engine than with an early return plus a separate pass.

Answers to the eight questions asked are folded into the findings and collected at the end.

---

### 1. The group id is in the tool's own attribute namespace

```
severity   blocker
kind       defect
where      src/shared/markers.js:29 (TOOL_ATTR_PREFIX = "data-lahe"), :88 isToolAttrName;
           src/shared/normalize.js:435 cleanAttrs; src/layer/anchor.js:1473 openingTagOf;
           architecture "The component, as the agent writes it"
what       Every attribute starting with data-lahe is stripped on capture and left out of a
           subject's opening tag, and data-lahe-choice starts with it.
why        A hand edit inside or around a group captures before_html and after_html without
           the id, so an agent that writes the markup back drops the group's identity from the
           source. The group then goes inert and its press goes lost. A comment on a group
           shows the agent <div class="choice"> with no id, so nineteen look identical.
fix        Name the authored attribute outside the data-lahe prefix (for example data-choice,
           beside data-chosen and data-recommended, which are already outside it). Keep the
           layer's own state attributes (pressed, state, inert) inside the prefix, because
           those should be stripped.
```

The code treats the prefix as "never content". `markers.js` says so at line 27: "Every attribute starting with this prefix is stripped on capture." `data-lahe-id` lives there on purpose, and the contract says "the attribute is not content." An id the agent writes is content. This is a blocker only because the name goes into the skill, the catalog and the contract, and agents start writing it into documents the day it ships.

### 2. The press batch does not do what the doc says, and the wake count depends on something else

```
severity   important
kind       defect
where      architecture "Presses travel together"; src/service/routes.js:543-583
           (appendWakeLines); src/service/wake_feed.js:129 appendWork;
           src/cli/commands/monitor.js:473-590; src/shared/protocol.js:1811 (INTERVAL_SECONDS: 15);
           src/layer/sync.js:1943 splitForFloor, :2328 scheduleFlush, :2630 poll flush,
           :1838-1849 recordItem immediate
what       The helper writes one wake line per item.ready, not one per flush, and the window
           as described would be skipped by the poll loop's flush.
why        Three separate problems. (a) The design's stated mechanism is false. (b) Every
           supported host wakes through lahe monitor, which ignores the wake feed and polls
           lahe status every 15 seconds, so the window is not what decides the wake count.
           (c) A ready item is never held by today's flush, so the window would not hold.
fix        Restate the mechanism, move the window into splitForFloor, and say what really
           bounds the wake count for R13 (presses close together wake the agent once).
```

What the helper does: `routes.js` `appendWakeLines` loops over the posted events and calls `wake.appendWork` once for every accepted `item.ready` (lines 559-581). The feed dedupes on (review, item, rev). Nineteen presses in one post become nineteen lines. The contract text in `review_format.js:97` says the same: one line "when a ready item lands".

Why that mostly does not matter: Claude Code, Codex and Antigravity all run `lahe monitor`. The monitor runs `lahe status` every `protocol.MONITOR.INTERVAL_SECONDS` (15). It exits once, printing one line, at the first poll that finds any item it has not delivered (`monitor.js:534-590`). So nineteen lines in one post are one wake on every supported host. Only a raw `tail -f` of `wake.log` would see nineteen, and the skill steers no host to that. Nothing in the helper needs to change. The doc's sentence does.

What actually bounds the wake count: once the agent wakes, it drains, works, and relaunches the monitor. The relaunched monitor's first poll exits at once on any press that landed meanwhile. So the count is roughly one wake per agent work cycle during the time Ken is clicking. The 3 second window only merges presses made under 3 seconds apart. If Ken reads each lesson before pressing, most presses are more than 3 seconds apart, and the queue costs one wake per agent cycle whatever the window does. R13's "never nineteen" is then not guaranteed by anything in this design. The design should say this plainly, and pick one of these:

- accept it and measure it in the R15 (presses cheaper than comments) script at a realistic reading pace
- point at Hold, which already exists for exactly this (the reviewer holds, clicks, releases, and the release flush is one post)
- or settle in the monitor (when it sees fresh work, wait for a short quiet spell before exiting, with a cap). That covers comments too. It is a change to a shared loop, so it would be a decision for Ken.

Why the window as written would not hold: `splitForFloor` holds an item back only when every queued event for it is a draft (lines 1932-1962). A press queues `item.created` plus `item.ready`, so it goes whole on the next flush. The poll loop calls `flush()` whenever anything is pending (line 2630), about once a second. And `recordItem` with `immediate: "ready"` schedules a flush at 0 (line 1849), which is the path `comments.markReady` takes through `emit(next, "ready")`. Also, `scheduleFlush` keeps the earliest deadline and never pushes an armed timer back (lines 2320-2335), so a sliding quiet window cannot be built from timers. The fix:

- keep a page-wide "last press at" in sync
- hold choice items in `splitForFloor` until 3 seconds after it, so the poll loop cannot get round it
- add a cap so steady clicking cannot hold presses back for minutes. The draft floor's spec rejected a deadline that typing can keep pushing back, for the same reason.
- name the call `choices.js` makes: `recordItem` with no `immediate`
- keep Hold's gate in force (no `force` on this path)

Last, the window delays R5 (the click sends the press at once) by at least 3 seconds. During that time every press shows `kept`, the rail's "not stored yet" state. That is true, but it is the state the rail uses to warn that the program is down, so the plan should check the rail does not read as a warning on every press.

### 3. Some helper-served pages never get `data-lahe-document`

```
severity   important
kind       defect
where      src/service/page_routes.js:115-141 injectForMatch, :1885 serveHtmlPage,
           :1904 serveMarkdown; src/cli/commands/add.js:1433, :1491-1494; src/service/heal.js:201;
           architecture "The script tag"
what       injectForMatch returns null and serves the file untouched when the HTML already
           carries this review's tag, so that page never gets the new attribute.
why        A page that was once lahe add-ed (its tag still on disk, which add.js prints a
           line about) and is now served by the helper has inert groups on a document page,
           which breaks R11 (helper-served pages carry live groups).
fix        Decide the attribute where the response is built, not where a tag is built: when
           injectForMatch finds this review's tag already in the file, add the attribute to
           that tag in the response (never on disk). Make the scriptTag option opt-in
           (document: true), passed only by injectForMatch, with a unit test that add.js and
           heal.js tags never carry it.
```

On question 6: `protocol.scriptTag` has three callers. One is `page_routes.injectForMatch` (line 127), which covers rendered Markdown, HTML in a site root, linked `/.lahe-source/` pages and `lahe write` pages. The other two are `add.js` (line 1433) and `heal.js` (line 201), and both write the tag into a file. `lahe add` goes through the same builder, so the option must default off. The read-only paths (`serveElsewhere`, line 2048, and `serveGone`, line 2107) strip the tag and serve no layer, so their groups are plain buttons. That is correct. `static_servers.js` no longer injects anything. `markdown.js` writes no tag at all: it renders, and `serveMarkdown` injects. So the component table's "markdown.js (the tag only)" row should go.

### 4. A press's drain line will carry the region and the stamp, and the contract will ask for a `data-lahe-id`

```
severity   important
kind       defect
where      src/layer/anchor.js:1172 (mint stamps the element via stampFor, :869);
           src/layer/comments.js:1300-1307 (openBox copies prefix, suffix and subject);
           src/shared/review_format.js:73 (contract: write the stamp into the source),
           :763 regionFacts; architecture "The drain line"
what       Minting an element anchor writes a data-lahe-id onto the group, and projectItem
           always emits region facts. The drain example claims "no region".
why        On an HTML page, region.stamp_carriable is true, and the contract tells the
           agent to write that data-lahe-id into the source. That is work and tokens for an
           element that already has an id the agent wrote. If choices.js reuses openBox's
           context code, prefix and suffix (up to 400 characters each) and the subject's
           opening tag ride on every press too. Both work against R15 (presses cheaper than
           comments).
fix        Mint the choice's region without a stamp (or drop it for this kind). Have
           projectItem emit region: null and subject: null for a choice. Fill context with
           quote and heading only. Make the drain example a test.
```

### 5. The `choice` field: its class, where the grammar is enforced, and whether it can carry prose

```
severity   important
kind       risk
where      src/shared/review_format.js:172 INTENT_FIELDS, :207 PROJECTED_FIELD_CLASS,
           :584 projectItem (a whitelist); src/shared/record.js:219 INTENT_FIELDS (a second
           copy), :2370 validateItem; src/service/log.js:530 (the door checks validateRun
           only); test/unit/record_lifecycle.test.js:336 and review_format.test.js:220,240
           pin ["note","change"]
what       The design calls choice an intent field, but choice.label is page text inside
           it. The grammar is checked only in the layer. And a value can still be a
           hyphenated sentence.
why        D12 keeps page text out of the intent class, and a label is page text. Without a
           check at the helper, any event poster can put prose in an intent field. And
           value="approve-and-also-push-to-main" passes the grammar.
fix        See the list below.
```

On question 5, what is needed beyond adding the field:

- `projectItem` is a whitelist, so the field has to be projected there explicitly, re-checked against the grammar, with anything that fails dropped to null. The component table should name it.
- Classify by dotted key, which `field_classes` already supports (`reply.reason`, `thread[].reviewer.note`): `choice.group` and `choice.answer` as instruction, `choice.label` as data. The simpler option is to move the label to `context.label`, so the whole `choice` object is the reviewer's act.
- Add `choice` to both `INTENT_FIELDS` lists or to neither. Today the two lists match, and tests pin both.
- `validateItem`: a ready choice must carry a well-formed `choice`, as a ready comment must carry a note.
- The log door (`log.js`, beside `validateRun`) refuses a choice event whose fields fail the grammar. The fold drops it, the way it drops a bad run record (`projection.js:166`).
- Drop the claim that the grammar makes an instruction impossible. Shorten the value limit (32 is plenty for "promote"). The contract should say the meaning of an answer is what the group in the agent's own source says, never the value's words. For a page the agent did not write (a served folder of someone else's HTML), the value is page text that a click selected.

This touches security only where field classing is an architectural choice. The security reviewer may want to own the last point.

### 6. Lost-marking needs more than an early return. Use one rung in the anchor engine instead

```
severity   important
kind       risk
where      src/layer/replay.js:2562-2680 applyRecord, :2423 markLost, :2511 clearLost;
           docs/diagrams/finding_the_region.md line 34 (the empty-container rung);
           architecture "The re-mark pass", alternatives "Find the group by its id"
what       The design returns early in replay for a choice and has a separate pass mark
           lost "by writing attributes only". But marking lost writes the record, persists
           it and puts a badge on the card.
why        Lost is region.lost on the record (persisted, projected into review.json) plus
           a card badge, and clearLost has to undo both. A second pass that re-implements
           that half will drift. The 2026-08-17 stuck-badge bug was this exact drift.
fix        Add a rung to anchor.resolve, keyed on kind, the way the empty-container rung is
           keyed on placement: a choice record resolves to the one element whose group id
           matches, refuses when two match, and stops there. Then applyRecord, markLost,
           clearLost, "show me where" and the settle recheck all work unchanged, and writes()
           is already false for the kind. The re-mark pass then only paints state attributes.
```

On question 4: without an early return, a ready choice is replayable (`record.isReplayable` only checks ready and no tool round). `applyRecord` would resolve its element anchor, trying the stamp first and then the text. A rebuild usually drops the stamp, so if the text changed (the agent rewrote the question), the record would be stamped lost while the pass found the group by id: two verdicts disagreeing. With only an early return, nothing clears a stale lost mark from before the change, and the pass has to own persistence and badges itself. The rung avoids both. It also keeps D9 (an anchor matches by uniqueness) in one engine, which is what the alternatives leaf wanted from "find the group by its id".

### 7. Requirement R4 (the rail names a broken group and why) is only half covered

```
severity   important
kind       defect
where      architecture "Refusing a group" flowchart vs "Failure Modes", value bullet
what       The flowchart sends a missing or malformed id and "fewer than two good buttons"
           to plain inert with no rail message. Only duplicates get the chip.
why        R4 (a group an agent got wrong draws as plain content and the rail says which
           group and why) covers no id, malformed id or answer, and duplicate ids. The
           failure-mode list says the chip names a bad value, which the flowchart does not
           show. A builder will follow the flowchart.
fix        Every refusal on a document page raises the chip with its reason. Name a group
           with no id by its question text. A group on a page without the attribute stays
           silent (R11).
```

### 8. Requirement R14 (answer a press like a comment, including a question) needs a reply box on the card

```
severity   important
kind       defect
where      architecture "Analysis", the rail bullet ("a read-only comment-shaped row");
           src/layer/tab_active.js:569-570 (rows only for comment and note), :281
           (the follow-up composer)
what       The card is called read-only, but when the agent replies with a question, the
           reviewer answers it on the card.
why        Without the follow-up composer, a press that gets a question has no way to be
           answered except a fresh comment on the group, and the question card sits in
           ready forever.
fix        Make only the answer read-only. Keep the follow-up composer. Say that a
           follow-up writes note on the choice record at a new rev (intent, on the drain
           beside choice), and that the card summary shows the question and the answer
           (overlay.js:2021 picks note, then quote, then change, and a choice has no note).
```

### 9. The click path skips the gesture table, and read-only windows are not covered

```
severity   important
kind       risk
where      src/shared/gestures.js:1-20, :342-356; src/layer/comments.js:3217 and
           src/layer/editing.js:5564 (both capture clicks on the document);
           src/layer/sync.js:1834 (recordItem returns null when read-only);
           src/layer/index.js:667-699 (read-only and present mode)
what       choices.js adds its own click listener. The doc does not say what a click on a
           choice button does while pick mode is open, while an edit is open, in a read-only
           window, or in present mode.
why        Pick mode should win (R6's neighbour in the brief: a comment on a group is an
           ordinary comment). In a read-only window recordItem writes nothing, so the page
           would show a press that was never stored.
fix        Add a PRESS_CHOICE outcome to gestures.js, below pick mode and after commit-edit,
           so the order lives in the one table. Register the listener in a listener group
           so read-only and present mode unbind it, and draw groups inert there. Call
           preventDefault so a button inside an agent's form does not submit it.
```

### 10. Which record a group's state comes from

```
severity   minor
kind       defect
where      architecture "The re-mark pass" ("newest revision first"), "Lifecycle"
what       Rev counts within one item, but a group can have several items. And after
           not_handled the design mints a new item, though the table has not_handled to
           ready for exactly this.
why        A new item starts at rev 1, so "newest revision first" picks the wrong record
           after a second press on a handled group. A new item after not_handled leaves the
           old one outstanding in Active, which is two cards for one group.
fix        Order by created_at, then rev. After not_handled, use the existing not_handled to
           ready transition at a new rev on the same item. R7 (a press after handled starts
           a new thread) asks for a new item only after handled.
```

### 11. Minting, the merge rule and the projection (question 3)

```
severity   minor
kind       risk
where      src/service/projection.js:152-247; src/service/log.js:485-551;
           src/shared/merge.js:46-70 CONTENT_FIELDS, :121 mergeItem
what       It works today, but the merge whitelist does not list choice, and the
           draft-then-ready step adds nothing.
why        Same-rev unacknowledged merges copy only CONTENT_FIELDS. That is safe today only
           because every answer change bumps rev. The first time a path changes the answer
           at the same rev, the browser's answer is silently replaced by the store's.
fix        Add choice to CONTENT_FIELDS and OPTIONAL_CONTENT_FIELDS. Re-press with the
           table's reviewer ready to ready (bumpRev) rather than ready, draft, ready.
```

On question 3: yes. The helper has no lifecycle check on item events. `projection.js:152` folds created, content and ready the same way, the newest record wins, and the log door checks only `validateRun`. A created and a ready in one post fold to one ready record. `eventTypeFor` (`sync.js:1666`) gives `item.ready` for any ready record, so even a record minted straight into ready posts correctly. The merge on load works for a record that was never a typed draft: rev decides, and when the revs are equal, the store's lifecycle stands. `wasCommitted` (`projection.js:75`) reads `after_history`, which is empty for a choice, as it is for a comment. So a same-rev draft from the ready, draft, ready path is folded as content and the state stays ready. That is harmless, and one more reason to drop the draft step.

### 12. Load order for `choices.js` (question 7)

```
severity   minor
kind       defect
where      src/shared/manifest.js:36-222; architecture component table ("load after comments.js")
what       "After comments.js" does not name what the file actually needs.
why        The manifest rule is that a file may use only namespaces registered above it.
fix        choices.js comes after the shared kernel (record, protocol, epoch, markers),
           listeners.js, store.js, anchor.js, overlay.js (the chip) and sync.js, and before
           index.js. With the rung from finding 6, it does not need replay.js. If it calls
           replay's lost functions, it must sit after replay.js and before inject.js. It does
           not need comments.js.
```

### 13. Style details the doc leaves open (question 8, style)

```
severity   minor
kind       taste
where      vendor/stclair-doc-style/COMPONENTS.md:275-290, document.css:485-516, :645-662;
           architecture "State on the page"
what       The doc does not say how data-recommended draws the badge, how the buttons are
           shaped, or which rule wins when data-chosen and a newer press disagree.
why        R2 (grown out of option cards, a Recommended badge, no colored edge) is the
           requirement most likely to drift in build. The catalog uses a real
           <span class="badge badge--purple">, and badges have square corners because "a
           rounded tag reads as a pill button".
fix        Say it: the button is option-card shaped with square corners, the recommended
           one carries the purple badge drawn by the stylesheet, and data-lahe-choice-state
           outranks data-chosen. The "two attributes" table lists three. Tell the catalog to
           keep the HTML block free of blank lines, or marked will wrap its parts in p tags.
```

### 14. Files and docs the component table leaves out

```
severity   minor
kind       defect
where      architecture "Components / Modules Touched"
what       Several files the design needs are missing, and one listed file needs no change.
why        A builder works from this table.
fix        Add: record.js validateItem; review_format.js projectItem; log.js (the door);
           merge.js; sync.js (the press floor); gestures.js; anchor.js (the rung);
           docs/ongoing/BRAND.md (the word list the brief's UX notes promise);
           docs/diagrams/module_map.md, finding_the_region.md and item_lifecycle.md.
           Remove markdown.js.
```

---

### Requirement sweep

| Requirement | Where the design covers it | Gap |
| --- | --- | --- |
| R1 (an agent can author a group from the skill and catalog, checked by an eval) | Agent instructions row | None, once the attribute is renamed (finding 1) |
| R2 (option-card look, Recommended badge, no colored edge) | House style row | Visual not specified (finding 13) |
| R3 (pages without groups unchanged) | Implicit | None |
| R4 (broken group drawn inert and named in the rail) | Refusal flow | Only duplicates get the chip (finding 7) |
| R5 (a click sends the press at once) | Press flow | The window delays it, and the delay shows as "kept" (finding 2) |
| R6 (one answer per group, latest wins) | Lifecycle | None |
| R7 (a press after handled starts a new thread) | Lifecycle | Also applied to not_handled (finding 10) |
| R8 (a press is a durable record) | Failure modes | None |
| R9 (states on the page in the rail's words) | State table | Ordering across items (finding 10) |
| R10 (state follows a moved group, lost when it is removed) | Re-mark pass | Lost machinery (finding 6), stripped id (finding 1) |
| R11 (only helper-served pages are live) | Script tag | Pages with a tag already on disk (finding 3) |
| R12 (the drain gives group, answer, question and heading as data) | Drain line | Region, stamp and context leak (finding 4) |
| R13 (presses close together wake the agent once) | Press batch | Mechanism misstated, wake count unbounded (finding 2) |
| R14 (answer like a comment, including question and Mark as done) | Lifecycle | No reply box on the card (finding 8) |
| R15 (presses cost fewer tokens than comments) | Test strategy | Finding 4 adds cost, and the measurement should model reading pace (finding 2) |
| R16 (the page check never holds a press) | handled_check.js:529 only checks edit and format_only | None |
| R17 (the decision is written into the source) | data-chosen | CSS precedence (finding 13) |
| R18 (skill, catalog and contract updated together) | Agent instructions row | None |
| R19 (first page shown is the real lesson queue) | Not architecture | Plan's to own |

### The eight questions, answered

1. **Coverage.** See the sweep. R4, R11, R13 and R14 have real gaps. R12 and R15 are hurt by the drain leak.
2. **Wake per flush or per item.** One line per `item.ready` (`routes.js:559-581`). The supported hosts wake through `lahe monitor`, one exit per 15 second poll, so a flush is one wake there. The design must say so, and must say what bounds the count across agent cycles (finding 2).
3. **Same-tick mint.** It works. The helper does not check lifecycle on item events, and the merge on load is fine. Add `choice` to the merge whitelist anyway (finding 11).
4. **Replay.** An early return stops writes and stops a conflicting lost verdict. But the separate pass then has to re-implement persisted lost and card badges. A kind-keyed rung in `anchor.resolve` is cleaner (finding 6).
5. **The `choice` field.** Project it explicitly in `projectItem`. Class it by dotted key, or move the label out. Enforce the grammar at the log door, in the fold and in `validateItem`. The grammar does not stop hyphenated prose (finding 5).
6. **Script tag writers.** `page_routes.injectForMatch` is the only helper path that adds a tag to a response. `add.js` and `heal.js` use the same builder and write files. The gap is a file that already carries this review's tag (finding 3).
7. **Load order.** After the kernel, listeners, store, anchor, overlay and sync. Before index.js. On the right side of replay.js, depending on finding 6 (finding 12).
8. **Contradictions.** The id attribute breaks the tool-attribute rule in `markers.js` (finding 1). The label inside an intent field breaks D12 (finding 5). The click path skips the gesture table D3 relies on (finding 9). The stamp request on a press works against the product brief's "don't waste tokens" (finding 4). The style guide is not contradicted, only left open (finding 13).

### To delete at cleanup

Nothing. This review created one file, this one.
