# Contracts

Twenty-one files under `src/` cite this document. It is the one place the shapes every
builder shares are written down.

**The rule this document exists to enforce:** a builder imports a name from here. They never type
the string. Five builders given a noun phrase invent five schemas, and the merge finds out.

Two halves, with two owners:

- **0A-kernel** owns the shapes in the browser and in the store: the module wrapper, the record, the
  lifecycle, the merge rule, the comparison modes, the gestures, and the ownership map.
- **0A-wire** owns the bytes that leave this repo: the `events.jsonl` line schema, the reply line
  schema, `review.json`'s contract field, the script tag's attributes, the wire checks, and
  `lahe wait`. Those sections are marked and are 0A-wire's to write.

Everything here is frozen at CP0. A change goes through the orchestrator.

---

## How a shared module loads

Every module under `src/shared/` and `src/layer/` runs in two environments: concatenated into one
built file in a browser, and `require`d in Node by the helper, the CLI, and the unit tests. There is
no module loader in the browser here, so each file registers itself on one global namespace during
concatenation and exports itself in Node.

The wrapper, verbatim. Copy it; do not invent a variant:

```js
(function (root, factory) {
  "use strict";
  var browser = typeof window !== "undefined" && !!window.document;
  if (browser) {
    root.LAHE = root.LAHE || {};
    root.LAHE.<name> = factory(root.LAHE.<dependency>, ...);
  } else {
    module.exports = factory(require("./<dependency>.js"), ...);
  }
})(typeof globalThis !== "undefined" ? globalThis : this, function (<dependency>, ...) {
  "use strict";
  // ...
  return { /* the module's API */ };
});
```

Four rules that come with it:

1. **The namespace name matches the filename.** `src/shared/record.js` is `LAHE.record`;
   `src/layer/tab_active.js` is `LAHE.tab_active`. The build script does not rewrite names, so a
   mismatch is a runtime `undefined` in the browser and a passing unit test in Node, which is the
   worst possible pairing.
2. **Dependencies are resolved by the wrapper, never inside the factory.** The factory takes them as
   arguments. A `require` inside the factory body runs in Node and throws in the browser.
3. **A file may only use a namespace entry a file above it in the manifest already registered.**
   Order is dependency order, and `src/shared/manifest.js` is that order.
4. **A module with no dependencies may use the short form** (`(function (root) { ... })`), which
   `gestures.js` and `markers.js` do. Everything else uses the factory form.

`src/shared/contracts.js` is a Node-side barrel re-export for the helper and the CLI. Nothing is
defined in it, and the browser never loads it.

---

## The ownership map

`src/shared/manifest.js` is the plan's ownership table as code, and it is frozen at CP0.
`scripts/lint.js` checks that every file under `src/` appears in it exactly once.

Three kinds of entry:

| Field | Meaning |
| --- | --- |
| (plain) | The file exists and, if it is a layer file, it is concatenated into the bundle |
| `planned: true` | A later task creates this file. The ownership question has an answer before the file exists, which is what stopped two tasks implicitly claiming the same work. The build script skips it |
| `cut: true` | Dead code, on the Phase 4B cleanup batch. Nothing is deleted during the build |

`manifest.builtFiles()` is what the build concatenates. `manifest.plannedFiles()` and
`manifest.cutFiles()` are what the gate reports, so "nobody built it" is visible rather than
discovered at a checkpoint.

**Builders never commit `dist/`.** A builder may rebuild it locally to run a browser test and must
not stage it. The orchestrator rebuilds and commits it once at each checkpoint.

---

## The record

`src/shared/record.js`. Import `record.FIELD` for every field name.

| Field | Class | What it is |
| --- | --- | --- |
| `id` | — | Client-minted, from a CSPRNG. Never reused |
| `rev` | — | Starts at 1, bumped on every rewording. A reply names `(id, rev)` |
| `kind` | — | `comment`, `edit`, `delete`, `format_only`, `note`. Closed |
| `state` | — | `draft`, `ready`, `handled`, `not_handled`. Closed, and exactly four |
| `note` | **intent** | The reviewer's own words. Verbatim, never truncated, never cleaned up |
| `change` | **intent** | The specific change the reviewer made, in their words |
| `before` | data | The region's wording when the reviewer first touched it (R29) |
| `after` | data | The region's wording now. Never truncated, never cleaned up (R3) |
| `before_html`, `after_html` | data | The same pair as markup, so an agent sees structure |
| `after_history` | data | Every `after` this record has had, in order. Replay's branch three reads it |
| `region` | data | `{ref, label, lost}`. The anchor reference (1C mints it), the pinned display label, and the lost-anchor state |
| `context` | data | `{quote, prefix, suffix, heading, element}` |
| `page_origin` | — | The origin the record was made on |
| `page_path` | data | The pathname, with the query string and fragment collapsed away |
| `page_title` | data | The page's title at first visit |
| `page_seq` | — | First-visit order, which is how `review.json` orders its groups |
| `source_hint` | — | The template the page came from, when the add step was given one |
| `reply` | data | The folded agent reply, or null |
| `created_at`, `updated_at` | — | ISO 8601 |

**The page fields are not optional.** Without them `review.json` cannot be grouped by page. The
group key is `record.pageKey(item)`, which is **origin plus pathname**, never pathname alone: two dev
servers both serving `/dashboard` must not collapse into one section. A `file://` review carries
`file` as its origin and the file's basename as its path.

**The applied-`after` history.** `record.priorAfters(item)` returns every `after` this record has had
that is not its current one. That is exactly what replay's branch three compares against. A record
built with an `after` starts its history with it, and `record.bumpRev` appends on every rewording
that changes the text.

**The intent channel is exactly two fields**, `note` and `change` (`record.INTENT_FIELDS`).
Everything else is data, and an unknown field defaults to data. This is D12, and it is the reverse of
what the archived draft did: a region's full `after` is mostly the page's own words, so carrying it
as intent would let a document someone else sent ride a hidden instruction into the instruction
channel on the back of the reviewer's edit.

---

## The lifecycle

`src/shared/lifecycle.js`. Four states, and two things that are not states:

- **`question` is a reply status.** An agent asking a question leaves the item in `ready`, because
  the work is still outstanding and the card is where the question is answered.
- **`reopened` is a transition**, `handled` back to `ready`. An item that has been reopened is simply
  ready again.

Every transition names the actor allowed to make it:

| From | To | Actor |
| --- | --- | --- |
| (none) | `draft` | reviewer |
| `draft` | `draft` | reviewer (typing; `rev` does not move for a draft) |
| `draft` | `ready` | reviewer (Cmd-Enter, or an edit committing) |
| `ready` | `ready` | reviewer (rewording; bumps `rev`) |
| `ready` | `handled` | **agent**, and only naming the current `rev` |
| `ready` | `not_handled` | **agent**, with a reason |
| `not_handled` | `ready` | reviewer |
| `handled` | `ready` | reviewer (reopen, R38) |

Anything not in that table throws. `lifecycle.canDelete(state, actor)` is separate: deletion is
reachable from `draft` and `ready` only, by the reviewer only. A handled item is the record that a
fix landed, so the only way out of it is reopening it.

**The revision rule.** `lifecycle.replyApplies(item, rev)` is true only when the reply names the
item's current revision. `lifecycle.applyReply(item, reply)` is the whole decision in one function,
returning `{accepted, state, refusal}`, so the helper and the library cannot disagree about it. A
reply naming rev 2 cannot retire rev 3: the reviewer reworded after the agent read it, and their
rewording stays outstanding (R9, R21).

---

## The merge rule

`src/shared/merge.js`. D5, as code rather than as prose:

> **The browser wins on content** for anything the helper has not acknowledged.
> **The store wins on lifecycle, per revision.**

The per-revision half is the whole point. A `handled` that names rev 1 retires rev 1. A reviewer who
reworded to rev 2 while the helper was down still has rev 2 outstanding after the merge, because the
reply named a revision that no longer exists.

`merge.mergeItem(browserItem, storeItem)` returns `{item, reason}`, and the reason is one of
`only_browser`, `only_store`, `browser_newer_rev`, `store_newer_rev`, `same_rev_acknowledged`,
`same_rev_unacknowledged`, so a failing test says which half of the rule broke.
`merge.mergeLists` keeps the browser's order, so the rail never reshuffles under a focused card.

The library marks an item `acknowledged: true` when the helper has confirmed the event carrying that
revision. 1B sets it; the merge rule reads it.

---

## The two comparison modes

`src/shared/normalize.js` is the one normalizer, and no other module may define its own text
normalization. Two normalizers that disagree is how a replay engine ends up fighting the reviewer's
cursor.

| Mode | Used by | What it compares |
| --- | --- | --- |
| `normalize.MODE.TEXT` | every record except format-only | The words, with whitespace, invisibles, and every tag folded away |
| `normalize.MODE.STRUCTURE` | `format_only` records | The words **and** which of them carry emphasis |

`normalize.modeFor(kind)` picks; `record.comparisonMode(item)` is the same call from an item.
`normalize.equalsInMode(mode, a, b)` is the only comparison a caller makes, and it throws on an
unknown mode rather than falling back to text: a silent fallback makes the whole format-only branch a
no-op that looks like a working feature.

`record.comparisonFields(item)` says **which pair of fields** to compare: `before`/`after` for an
ordinary record, and `before_html`/`after_html` for a format-only one, whose `after` text is identical
to its `before` by construction. Comparing a format-only record on its text fields is a silent no-op
that looks like a working branch. `record.priorAfters(item, field)` takes the same field, so one
history serves both modes.

**Formatting is a closed list: bold and italic, nothing else in v1** (`normalize.STRUCTURAL_TAGS`).
`cleanMarkup` renames `b` to `strong` and `i` to `em` first, so the comparator only ever sees two tag
names, and a framework reserializing a span or adding a wrapper class is not a format change.

---

## The gestures

`src/shared/gestures.js`. D3's vocabulary, and D3's rule that makes it small: **browse is the page
untouched.** Links navigate, buttons act, forms submit, and the app's own JavaScript sees every event
it would see without the library (R13, which outranks editing convenience).

| Keys | When | Gesture |
| --- | --- | --- |
| Cmd-Shift-C | text selected | Comment on the selection |
| Cmd-Shift-C | nothing selected | Element-pick mode; click an element, Esc cancels |
| Cmd-Shift-E | cursor or selection in a block | Edit that block, and nothing else |
| Cmd-Enter | in a comment box | Mark ready for the agent |
| Esc, or a click outside | a block is in edit state | Commit the edit |
| Esc | picking, or in a comment box | Cancel; the draft is kept |
| everything else | always | The page's |

Ctrl is the same modifier as Cmd, so one rule covers macOS, Linux, and Windows.
`gestures.gestureFor(descriptor)` is a pure function over a plain descriptor, never over a DOM event,
so the whole table is unit-testable with no browser and the browser tests check the wiring rather
than the rules. `gestures.hintLines()` is what the rail renders: every gesture appears with its exact
keystroke, without opening a menu, which is what AC6 is scored on.

Dead and deliberately so: Alt-click (undiscoverable), plain-click-places-caret (it fought the page
for every click), Cmd-click-follows-link (browse is native, so a plain click already does), the
editing toggle, and Send.

---

## The stub signatures

0A-kernel committed a working stub for every later task, so five callers do not each invent a policy.
Each is real in signature and in state; the DOM work belongs to the owner.

| Module | Owner | What is real now |
| --- | --- | --- |
| `layer/replay.js` | 2C | The reason enum, `PASS_ORDER`, the **counters**, and the four-branch `compare(item, domText)`. `applyRecord` writes nothing |
| `layer/anchor.js` | 1C | `mint` and `resolve` signatures; `resolve` defers to `shared/uniqueness.js`, which is where the decision already lives |
| `layer/overlay.js` | 1B | The rail chrome: tabs, the status line states, the dismissible chips, and the card API (`upsertCard`, `setCardState`, `setCardBadge`, `setAgentMessage`, `setCardNotice`) |
| `layer/protect.js` | 2B | `mark`, `veto`, `snapshot`, `restore`, `release`, and the **counters** including `restores`, which layer three's assertion reads |
| `layer/store.js` | 1B | **Real**: synchronous writes keyed by review id, drafts, revisions, deletion, and the merge. `acquireWindowLock` is 1B's |
| `layer/comments.js` | 1D | **Real**: a minimal focused comment box that writes a draft on every keystroke and marks ready on Cmd-Enter |
| `shared/record_fixtures.js` | 0A-kernel | Realistic records for 2B and 2C, including the **twice-reworded** edit branch three needs |

**The counters are real from Phase 0** on purpose. Ranked test 1 asserts the replay pass counter
incremented at least five times and ranked test 8 asserts idempotence as the absence of a second
write, so a counter that only appeared in Phase 2 would mean those tests could not be written first.
A test that does not assert replay ran is passed by a do-nothing engine.

**The throwaway consumers.** `test/unit/consumer_*.test.js` is one smoke test per downstream task,
calling every stub signature that task will need. They exist to prove the stubs are sufficient, which
is the single reason 0A-kernel exists as a task, and they are on the Phase 4B cleanup batch.

---

## The wire (0A-wire)

These sections are 0A-wire's to write, and they are named here so a builder knows where to look
rather than inventing one:

- **The `events.jsonl` line schema** and its closed event-type vocabulary.
- **Idempotence is by `event_id`, never by `(item, rev)`.** Drafts do not bump `rev` and drafts flow
  to the helper, so the log legitimately holds many events sharing an item and revision with
  different content. `(item, rev)` is reserved for lifecycle.
- **The draft flush policy**: synchronous to browser storage on every keystroke, debounced to the
  helper at 750ms of typing idle, plus an immediate flush on blur, on Cmd-Enter, and on unload.
- **The unload post uses `fetch(..., {keepalive: true})`, never `sendBeacon`**, which cannot set the
  custom header or the JSON content type the helper requires.
- **The reply line schema**, its required fields per status, and the malformed-line behavior.
- **`review.json`'s `contract` field**, verbatim, byte for byte.
- **The script tag's attributes** and the fixed default port.
- **`lahe wait`**: the watermark, what counts as new, the output, the five exit codes, and the fact
  that it consumes nothing.
- **The per-request checks** the helper makes, and the named refusal reason it logs on each.
