# 0A-kernel builder notes

Task: the contract half of Phase 0. Branch `feat/live_agentic_html_editor`, main checkout.

## What landed

**Record shapes** (`src/shared/record.js`, rewritten). Four states, five kinds, the page fields
(`page_origin`, `page_path`, `page_title`, `page_seq`, `source_hint`) and the applied-`after` history
(`after_history`, read through `priorAfters`). The dead send-model fields are gone: `moved`,
`resized`, `delivered`, `ack`, `verification`, and `feedback` (which became the two intent fields,
`note` and `change`). The D12 classification is flipped: `note` and `change` are the whole intent
channel, everything else is data, and an unknown field defaults to data.

**Lifecycle** (`src/shared/lifecycle.js`, rewritten). Exactly four states, with the actor column
kept. `question` is a reply status that leaves the item ready; `reopened` is a transition from
handled back to ready. `applyReply(item, reply)` is the whole decision about what one reply line does
to one item, in one pure function, so 3A and 1B cannot disagree about it.

**The merge rule** (`src/shared/merge.js`, new). D5 as a tested function: the browser wins on content
for anything unacknowledged, the store wins on lifecycle per revision. `mergeItem` returns a reason,
so a failing test says which half broke. `mergeLists` keeps the browser's order so the rail never
reshuffles under a focused card.

**The normalizer's two modes** (`src/shared/normalize.js`, extended). `MODE.TEXT` and
`MODE.STRUCTURE`, one entry point `equalsInMode`, which throws on an unknown mode rather than falling
back to text. The structural comparator is defined against exactly bold and italic
(`STRUCTURAL_TAGS`), which `cleanMarkup` has already normalized to `strong` and `em`.

**The gesture table** (`src/shared/gestures.js`, rewritten to D3). Cmd-Shift-C, Cmd-Shift-E,
Cmd-Enter, Esc, and one click rule for element-pick mode. Alt-click, place-caret, follow-link, the
editing toggle, and Send are dead. `hintLines()` is what the rail renders, since AC6 scores that every
gesture appears with its exact keystroke.

**The stubs**, all with real signatures and real state: `layer/replay.js` (live counters plus the
implemented four-branch compare), `layer/anchor.js`, `layer/overlay.js` (rail chrome, card API,
dismissible chips, status-line states), `layer/protect.js` (new; mark, veto, snapshot, restore,
release, with the counters layer three's assertion reads).

**Real, not stubbed**: `layer/store.js` (synchronous writes keyed by review id, drafts, revisions,
merge) and `layer/comments.js` (a minimal focused comment box that stores a draft on every keystroke
and marks ready on Cmd-Enter), so 1B and 1D each have a scoreable done bar in their own worktree.

**`layer/selection.js`** is now a real caret accessor rather than a stub, and it is frozen. The
snapshot and restore moved out to `layer/protect.js`, which 2B owns, so the frozen file has one
writer.

**`src/shared/record_fixtures.js`** (new, in the bundle because 2B's and 2C's tests run in a real
browser): deterministic realistic records including `editRewordedTwice`, which is the only fixture
branch three can be honestly tested against.

**`src/shared/manifest.js`**, rewritten against the plan's ownership table, with `planned: true` for
files a later task creates and `cut: true` for the Phase 4B batch. `scripts/build-layer.js` follows
it through `builtFiles()` / `plannedFiles()`.

**`docs/CONTRACTS.md`**, written fresh. It carries the dual-environment module wrapper verbatim, the
ownership map's three entry kinds, the record table, the lifecycle table, the merge rule, the two
comparison modes, the gestures, the stub inventory, and a pointer list of the sections 0A-wire owns.

## Demonstrated failures

The plan requires a test that fails against a one-line deliberate revert, demonstrated rather than
asserted. Three, pasted with their output.

### 1. The merge rule (ranked test 11)

Revert:

```diff
diff --git a/src/shared/merge.js b/src/shared/merge.js
@@ -125,3 +125,3 @@
     // store's status names an older revision.
-    if (bRev > sRev) {
+    if (false && bRev > sRev) {
       return { item: browserItem, reason: REASON.BROWSER_NEWER_REV };
```

Failure:

```
not ok 34 - a stale revision cannot retire a current one: the reword-offline case
  ---
  duration_ms: 0.753958
  location: '.../test/unit/record_lifecycle.test.js:349:1'
  failureType: 'testCodeFailure'
  error: |-
    Expected values to be strictly equal:

    1 !== 2

  code: 'ERR_ASSERTION'
  name: 'AssertionError'
  expected: 2
  actual: 1
  operator: 'strictEqual'
```

Without that one line, the reviewer's rev-2 rewording is thrown away and the agent's rev-1 "handled"
wins. That is exactly the failure the rule exists to prevent.

### 2. The lifecycle actor rule

Revert:

```diff
diff --git a/src/shared/lifecycle.js b/src/shared/lifecycle.js
@@ -199,3 +199,3 @@
     var to = r.status === record.REPLY_STATUS.HANDLED ? STATE.HANDLED : STATE.NOT_HANDLED;
-    if (!canTransition(item[FIELD.STATE], to, ACTOR.AGENT)) {
+    if (false && !canTransition(item[FIELD.STATE], to, ACTOR.AGENT)) {
       return {
```

Failure:

```
not ok 31 - a reply cannot move a draft, whatever revision it names
  ---
  duration_ms: 0.824417
  location: '.../test/unit/record_lifecycle.test.js:320:1'
  failureType: 'testCodeFailure'
  error: |-
    Expected values to be strictly equal:

    true !== false

  code: 'ERR_ASSERTION'
  name: 'AssertionError'
  expected: false
  actual: true
  operator: 'strictEqual'
```

Without the actor check, an agent's reply retires a draft the reviewer is still writing.

### 3. The two normalizer modes (ranked test 31)

These were written first, against a normalizer that had only one mode. The output before
`equalsInMode` existed:

```
# Subtest: the two comparison modes disagree on a text-equal structure-different pair
not ok 36 - the two comparison modes disagree on a text-equal structure-different pair
  error: |-
    the text mode sees no change

    false !== true

# tests 41
# pass 35
# fail 6
```

After implementation, 41 pass. A later regression that made the two modes identical fails the
disagreement case rather than silently turning the format-only branch into a no-op.

## Gate

`npm run lint && npm run test:unit && npm run test:browser`, run in full:

```
lint passed (88 files checked)

# tests 203
# suites 0
# pass 203
# fail 0
# duration_ms 568.283375

  33 passed (5.8s)   [chromium]
```

`dist/` was rebuilt locally to check the concatenation order and left unstaged, per the dist rule.

## Decisions, and one departure recorded honestly

- **`page_origin` was added to the record.** The plan's bullet lists `page_path`, `page_title`,
  `page_seq`, and `source_hint`, but the same bullet says the section key is **origin plus pathname**,
  which is unreachable without the origin on the record. Took the architecture's side (D6's Q2) and
  added the field. `record.pageKey(item)` is the key.

- **A format-only record compares on its markup fields.** `comparisonFields(item)` returns
  `before_html`/`after_html` for `format_only` and `before`/`after` otherwise. A format-only record's
  `after` text is identical to its `before` by construction, so comparing on text would make the whole
  branch a no-op that looks like it works. The stub consumer for 2C catches this.

- **"The failures list" in 0A-kernel's bullet list is the rail's chip list, not
  `src/shared/failures.js`.** The ownership table gives `failures.js` to 0A-wire, and this task was
  told not to touch it. The chip list API (`rail.failures.add/dismiss/list`) is in `layer/overlay.js`,
  which is a stub 0A-kernel owns the shape of. Recorded because the two readings of that bullet point
  at two different files.

- **"The store" appears in both the stub list and the "real, not stubbed" list.** Resolved by making
  the durable half real (synchronous writes, drafts, revisions, merge) and stubbing only what 1B owns
  (`acquireWindowLock`). Both halves of the plan are satisfied.

- **Minimal-compile edits to two 0A-wire files.** `src/shared/review_format.js` and
  `test/unit/review_format.test.js` are 0A-wire's to rework, but the new record shapes broke them and
  the gate has to be green. Changed only what would not compile or run: the kind and state names, the
  required page fields on the test's item builder, and the one `field_classes.after` assertion that
  D12 reverses (it asserted `CLASS_INSTRUCTION`, which is D12 backwards; left alone it would have
  shipped a green test on top of the laundering attack). Everything else, the fencing assertions and
  the per-page grouping, is untouched and left for 0A-wire.

- **`src/service/routes.js` still references the dead `record.STATE.DELIVERED` and `record.ACTOR`.**
  It parses, nothing loads it in the unit suite, and it is 1A's to rework. Not touched.

## For CP0's contract freeze read

Specific points to check against the architecture, in the order the plan lists them:

- Record field names, including `page_origin`/`page_path`/`page_title`/`page_seq`/`source_hint` and
  `after_history` (`src/shared/record.js`, `FIELD`).
- The four lifecycle states with the actor column (`src/shared/lifecycle.js`, `TRANSITIONS`), and that
  `question` and `reopened` are not among the states.
- The gesture keystrokes (`src/shared/gestures.js`, `TABLE`), including that the on-card hint is Ken's
  copy word for word.
- The event type enum, the reply schema's required fields per status, the `contract` field's exact
  text, the script tag's attribute names, and the wait command's exit codes are **0A-wire's** and are
  not in this task's output. `docs/CONTRACTS.md` names each of them as 0A-wire's to write.

Frozen at CP0 and changed only through the orchestrator from here: `src/shared/manifest.js`,
`src/layer/selection.js`, and (0A-wire's) `src/shared/review_format.js`.

## Cleanup needed

Nothing was deleted. For the Phase 4B batch:

- The thirteen throwaway stub-consumer smoke tests, one per downstream task:
  - `test/unit/consumer_0a_wire.test.js`
  - `test/unit/consumer_1a_helper.test.js`
  - `test/unit/consumer_1b_shell.test.js`
  - `test/unit/consumer_1c_anchor.test.js`
  - `test/unit/consumer_1d_comments.test.js`
  - `test/unit/consumer_2a_editing.test.js`
  - `test/unit/consumer_2b_protect.test.js`
  - `test/unit/consumer_2c_replay.test.js`
  - `test/unit/consumer_2d_page.test.js`
  - `test/unit/consumer_3a_agent.test.js`
  - `test/unit/consumer_3b_install.test.js`
  - `test/unit/consumer_3c_export.test.js`
  - `test/unit/consumer_3d_edits_tab.test.js`
- `src/shared/record_fixtures.js` is a **judgement call for 4B**: it is test support that ships in the
  bundle, because 2B's and 2C's tests run in a real browser and need the fixtures on the page. If a
  later task finds a way to load fixtures into a page without bundling them, it comes out. Otherwise
  it stays and the bundle carries roughly 6KB of fixtures.
- Everything already on the plan's own Cleanup needed list is unchanged and still in place:
  `src/shared/cli_contract.js`, the four cut CLI commands, `src/service/verification.js`,
  `test/fixtures/sample.html`, `test/browser/sample.spec.js`, and the fencing delimiter machinery in
  `src/shared/review_format.js`. The manifest marks each of them `cut: true`, so
  `manifest.cutFiles()` prints the list.
