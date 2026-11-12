---
read-when: Building or reviewing slice C3 of the TypeScript migration.
---

# C3 spec: the record, rebuilt as five contract modules and seventeen domain modules

`src/shared/record.js` is the item record: the one spelling of every field, the closed lists of kinds and states, the rule for which fields are the reviewer's intent and which are page data (D12), and every rule both sides run on a record: minting it, revising it, threading the agent's answers, the page check's rounds, the unread rule, the change sentence an agent reads, take-backs, free-writing runs and choice presses. Thirteen layer files, seven server files, two CLI commands and most of the test suite read it. This slice rebuilds it test first, split by job. Shapes, constants and the parsers of untrusted record data go to `src/contract/`; every other rule goes to `src/domain/`.

Counts in this spec came from scripts in the session scratchpad: `specs/c3_usage.py` (which file reads which export, comments stripped), `specs/c3_cases.py` (every test case and the exports it reads), `specs/c3_map.py` (the section 5 tables), `specs/c3_callers.py` (the section 3 tables) and `specs/c3_names.py` (the export lists in section 4). Expected values marked "pinned" were read from the old code on purpose, by running it: other code, stored records or the agent-facing text already depend on them.

## 1. Scope

**Old file.** `src/shared/record.js`: 2,781 lines, of which 1,055 are comment lines, 191 blank and 1,535 code (first-non-space definition, matching the recon). 135 exports. Position 5 in the browser bundle (`LAHE.record`), and `require`d by the server, the CLI, two scripts and 82 unit test files.

**New modules.** All kebab-case, one job each.

| Module | Job |
| --- | --- |
| `src/contract/record.ts` | The record's shape: field names, kinds, states, placements, tool rounds, the stored sub-shapes (region, context, history entry, thread round, folded reply, run block), the empty constructors, and the predicates that read only the shape |
| `src/contract/field-class.ts` | D12: which field paths are the reviewer's instruction and which are page data |
| `src/contract/run-limits.ts` | How big a free-writing run may be: the ceilings both the record and the reply line use |
| `src/contract/utf8.ts` | The UTF-8 byte length of a string, for the contract and the domain, which have no `TextEncoder` |
| `src/contract/choice.ts` | Choice presses: the token grammar, the component's markup names, the choice states, the region reference, and the helper's check on a choice field |
| `src/contract/item-check.ts` | `validateItem`: the fail-loud check on a whole record before it is stored |
| `src/domain/mint.ts` | Fresh ids and timestamps |
| `src/domain/page-identity.ts` | Which page a record was made on, and whether it is the page in front of us |
| `src/domain/stamp-source.ts` | Whether a page's source can hold a `data-lahe-id` at all |
| `src/domain/item-revisions.ts` | Making a record, revising it, its applied-`after` history, and which fields it compares on |
| `src/domain/item-status.ts` | The questions every surface asks of a record's state: draft, waiting on the agent, outstanding, replayable, closed by the reviewer |
| `src/domain/tool-round.ts` | Rounds the tool opened for the agent that the reviewer is not part of, and what the reviewer is shown for them |
| `src/domain/thread.ts` | The reviewer and agent exchange: archiving an answered turn, follow-ups, reopening, and keeping earlier answers |
| `src/domain/page-check.ts` | The page check's sentence, its reopen, its stamp, and collapsing repeated sentences |
| `src/domain/reply-unread.ts` | The unread rule: which agent replies the reviewer still has to read |
| `src/domain/accepted-page-texts.ts` | What "Keep mine" remembers so a decided collision is not raised again |
| `src/domain/subject.ts` | The whole-element subject: its paint quote and its opening tag with an embedded source put back |
| `src/domain/change-text.ts` | The change sentence for a hand edit: what the reviewer did, in words, for the intent channel |
| `src/domain/revert.ts` | Taking a handled change back: the record that asks the agent to undo it, and which ids are taken back |
| `src/domain/run-record.ts` | A free-writing sitting: building its whole markup, the anchor view, which blocks a later record took over, its sizes and its change sentence |
| `src/domain/run-check.ts` | `validateRun`: the helper's check on an untrusted free-writing record |
| `src/domain/proofread.ts` | "Use the fixes": an agent's proofreading suggestions applied as the reviewer's own reword |
| `src/domain/choice-state.ts` | What a choice group shows, and which press is current for each group |

That is five contract modules (plus `utf8.ts`, which is shared with C4's `flush.ts` and is not part of the record's bridge) and seventeen domain modules.

**Edits outside the new modules,** each small:

- `src/contract/replies.ts` (C4's): `SUGGESTIONS_MAX` and `SUGGESTION_TEXT_MAX` import their values from `run-limits.ts` instead of restating them (B14).
- `src/contract/flush.ts` (C4's): its private UTF-8 byte counter is replaced by an import of `utf8ByteLength` (B15).
- The call sites of the exports whose shape changes (section 4, "Exported names that change"): `src/shared/review_format.js`, `src/layer/editing.js`, `src/layer/replay.js`, `src/layer/choices.js`.
- `src/shared/manifest.js`: its own entry only (the forwarder in `FORWARDERS`, the bundle entry listing the twenty-two modules under the name `record`, as S0c's multi-module registration allows).
- The old unit test files named in section 5.
- New sections of `docs/ongoing/code/contract.md` and `docs/ongoing/code/domain.md` (section 9).
- The lines of `docs/CONTRACTS.md` that name `record.FIELD_CLASS`'s keys or a removed export. Paths that say `src/shared/record.js` stay for F1's sweep.

**Bridges (temporary, removed in F1).** `src/shared/record.js` becomes a forwarder that spreads the twenty-two modules into one plain, writable object (B124). The bundle's `LAHE.record` is the same combination at the old file's place in the order (B125).

**Depends on.** C1 (`FailureCode` from `src/contract/failures.ts`), C2 (the normalizer modules), and C4 (`replies.ts`, `flush.ts` and `json-object.ts`). The plan lists C2 only; section 10 asks for C4 to be added.

**New tests.** `test/unit/contract/<module>.test.ts` and `test/unit/domain/<module>.test.ts`, one per module that has behavior, mirroring the source. `test/unit/fix_round_f3_record.test.js` moves with `git mv` to `test/unit/record_bridge.test.js` and keeps only the bridge and source-text cases (section 8); its other cases move to the `.ts` files. A `.ts` test cannot import `src/shared/record_fixtures.js` (still JavaScript until C5), so every case that used the fixtures builds its records as literal data, following `docs/ongoing/code/README.md`.

## 2. Behavior

Each statement is something a caller, a person or an agent can observe, and each is checked by a new test. Strings are given exactly; where a statement says "pinned", the value was read from the old code and must not change. `item` means a record as `newItem` builds it. Statements about a `null` or a wrong-typed input describe what the still-JavaScript callers can send; they are tested through the forwarder (section 4, "Inputs").

### `contract/record.ts`

- **B1.** `FIELD` maps exactly these 34 names to these wire strings, pinned: `ID` id, `REV` rev, `KIND` kind, `STATE` state, `NOTE` note, `CHANGE` change, `BEFORE` before, `AFTER` after, `BEFORE_HTML` before_html, `AFTER_HTML` after_html, `AFTER_HISTORY` after_history, `REGION` region, `CONTEXT` context, `PAGE_ORIGIN` page_origin, `PAGE_PATH` page_path, `PAGE_TITLE` page_title, `PAGE_SEQ` page_seq, `SOURCE_HINT` source_hint, `REVERTS` reverts, `REPLY` reply, `HANDLED_NOT_ON_PAGE` handled_not_on_page, `CLOSED_BY` closed_by, `CLOSED_AT` closed_at, `RECEIVED_AT` received_at, `REPLY_SEEN` reply_seen, `THREAD` thread, `NEW_BLOCKS` new_blocks, `ANCHOR_AFTER_HTML` anchor_after_html, `ANCHOR_TAG_AFTER` anchor_tag_after, `PLACEMENT` placement, `REMOVE_BLOCKS` remove_blocks, `CHOICE` choice, `CREATED_AT` created_at, `UPDATED_AT` updated_at. Compared as a whole table.
- **B2.** `KIND` holds exactly `COMMENT` comment, `EDIT` edit, `DELETE` delete, `FORMAT_ONLY` format_only, `NOTE` note, `CHOICE` choice. `KINDS` is `["comment", "edit", "delete", "format_only", "note", "choice"]`, in that order (the order appears in error messages). `isKind` is true for exactly those six strings and false for `"moved"`, `"resized"`, `"toString"`, `""`, `null` and a number.
- **B3.** `STATE` holds exactly `DRAFT` draft, `READY` ready, `HANDLED` handled, `NOT_HANDLED` not_handled. `STATES` is `["draft", "ready", "handled", "not_handled"]`. `isItemState("question")` and `isItemState("reopened")` are false: a question is a reply status and reopening is a transition.
- **B4.** `REPLY_STATUS` and `REPLY_STATUSES` read through the record are the same objects `src/contract/replies.ts` exports (`===`), so there is one spelling of `handled`, `not_handled` and `question`.
- **B5.** Pinned constants: `FILE_ORIGIN` is `"file"`, `CLOSED_BY_REVIEWER` is `"reviewer"`, `SUBJECT_SRC_REF` is `"lahe:subject.src"`, `REPLY_STAMP_MAX` is `64`, `TOOL_ROUND.PAGE_CHECK_STAMP` is `"page_check_stamp"` and is the only tool round; `isToolRoundName` is true for it alone.
- **B6.** `emptyRegion()` returns a new object, keys in this order: `{ref: null, label: null, lost: null, accepted_page_texts: [], check_reopen: null}`. Two calls never share the object or its array.
- **B7.** `emptyContext()` returns a new `{quote: null, prefix: null, suffix: null, heading: null, element: null, subject: null}`. `emptySlideContext()` returns a new `{index: null, total: null, uncounted: false, id: null, heading: null, text: null}`.
- **B8.** `isHandEdit(item)` is true exactly when `kind` is edit, delete or format_only; false for comment, note, choice, and for `null` and `undefined`.
- **B9.** `isChoice(item)` is true exactly when `kind` is choice, and false for `null`. `isRevert(item)` is true exactly when `reverts` is a non-empty string, and false for `null`.
- **B10.** `PLACEMENT` is `{AFTER_ANCHOR: "after_anchor", START_OF_CONTAINER: "start_of_container"}`; `PLACEMENTS` is those two in that order; `isPlacement` is true for exactly them.
- **B11.** `RUN_FIELDS` is `["new_blocks", "anchor_after_html", "anchor_tag_after", "placement", "remove_blocks"]`. `isRunRecord(item)` is true exactly when `new_blocks` is a non-empty array (false for `null`). `hasRunFields(item)` is true when any run field is present and is not `null` and not an empty array: a tag-only change (`anchor_tag_after: "h2"`) and a bare `placement` both count; `new_blocks: []` alone does not.
- **B12.** Compile-time: the record type's keys are exactly the `FIELD` values, and `FIELD_CLASS` (B18) has a key for every one. A field added to one and not the others fails `tsc`.

### `contract/run-limits.ts`

- **B13.** Pinned: `NEW_BLOCKS_MAX` is 400, `NEW_BLOCKS_MAX_BYTES` is 200000, `RUN_RECORD_MAX_BYTES` is 4194304, `RUN_HISTORY_KEEP` is 3.
- **B14.** `replies.SUGGESTIONS_MAX === NEW_BLOCKS_MAX` and `replies.SUGGESTION_TEXT_MAX === NEW_BLOCKS_MAX_BYTES`, because `replies.ts` imports them. C4's tests of `parseReplyLine` at those bounds pass unchanged.

### `contract/utf8.ts`

- **B15.** `utf8ByteLength(text)` is the number of bytes `TextEncoder` writes for `text`: `""` 0, `"x"` 1, `"é"` 2, `"€"` 3, one emoji 4, a lone surrogate 3. A test compares it with Node's `TextEncoder` over a corpus that includes every boundary (U+007F, U+0080, U+07FF, U+0800, U+FFFF, U+10000) and both lone surrogates. C4's `fitsKeepalive` cases (C4 B51) pass unchanged.

### `contract/field-class.ts`

- **B16.** `CLASS_INSTRUCTION` is `"instruction"`, `CLASS_DATA` is `"data"`. `INTENT_FIELDS` is exactly `["note", "change"]`. `INSTRUCTION_PATHS` is exactly `["note", "change", "choice.group", "choice.answer"]`.
- **B17.** `fieldClass(path)` is `"instruction"` for the four instruction paths and `"data"` for every other string. Checked over every path the old table named (`before`, `after`, `before_html`, `after_html`, `after_history`, `context.quote`, `context.prefix`, `context.suffix`, `context.heading`, `context.element`, `context.subject`, `context.slide`, `region.label`, `region.accepted_page_texts`, `region.check_reopen`, `closed_by`, `closed_at`, `received_at`, `reply_seen`, `page_title`, `page_path`, `reply.reason`, `reply.text`, `thread[].reviewer.note`, `thread[].reviewer.change`, `thread[].agent.reason`, `thread[].agent.text`, `new_blocks`, `anchor_after_html`, `anchor_tag_after`, `placement`, `remove_blocks`), plus `choice`, `waiting_since`, `""`, `"toString"` and `"__proto__"`: all data. An earlier turn's note is data; only the current top-level note and change are intent.
- **B18.** `FIELD_CLASS` has exactly one entry per `FIELD` value; `note` and `change` are instruction and the other 32 are data; for each key, `FIELD_CLASS[key] === fieldClass(key)`.

### `contract/choice.ts`

- **B19.** `isChoiceToken` accepts 1 to 64 characters from `A-Z a-z 0-9 _ . : -` that start with a letter or digit: `"A_jev"`, `"optionB"`, `"v1.2"`, `"Closest_21"`, `"a"`, and 64 characters. It refuses `""`, 65 characters, a leading `-`, `_`, `.` or `:`, and any space, quote, bracket, slash or angle bracket, and every non-string. `CHOICE_TOKEN` is the regular expression `/^[A-Za-z0-9][A-Za-z0-9_.:-]{0,63}$/`.
- **B20.** `CHOICE_TOKEN_RULE` is `"1 to 64 letters, digits, hyphens, underscores, dots or colons"`, pinned (the rail's refusal chip prints it).
- **B21.** `CHOICE_MARKUP` is exactly `{GROUP_CLASS: "choice", NAME_ATTR: "data-choice", QUESTION_CLASS: "choice-q", CHOSEN_ATTR: "data-chosen", RECOMMENDED_ATTR: "data-recommended", PRESSED_ATTR: "data-lahe-pressed", STATE_ATTR: "data-lahe-choice-state", INERT_ATTR: "data-lahe-inert"}`.
- **B22.** `CHOICE_STATE` is exactly `{KEPT: "kept", OPEN: "open", QUESTION: "question", NOT_HANDLED: "not_handled", DONE: "done"}`.
- **B23.** `choiceRef(group)` returns `{kind: "choice", group}` with no other key.
- **B24.** `validateChoice(value)` returns `null` or `{code: "CHOICE_REFUSED", reason}`, never throws, and checks in this order, with these reasons:
  1. not a non-null object: `"not a record"`;
  2. `kind` is not choice: `null` when `choice` is `undefined` or `null`, otherwise `"choice is set only on a choice record, and this is a <kind>"` (`<kind>` as `String(kind)`);
  3. `choice` missing, `null`, not an object, or an array: `"a choice record must carry choice as {group, answer}"`;
  4. other keys: `"choice carries a key other than group and answer: <keys joined by ", ">"`;
  5. `"choice.group is missing or off the grammar"`, then `"choice.answer is missing or off the grammar"`;
  6. carried content: `"a choice record carries <list>"`, where the list joins with `", "`, in this order, whichever apply: `before`, `after`, `before_html`, `after_html` (each when not `undefined` and not `null`), `after_history` (when a non-empty array), `the free-writing fields` (when `hasRunFields`);
  7. `region.ref.stamp` a non-empty string: `"a choice record carries a stamp"`.
- **B25.** A choice record built by `newItem` with `kind: "choice"`, `choice: {group, answer}` of valid tokens, `region: {...emptyRegion(), ref: choiceRef(group)}` and nothing else passes (`null`), at revision 1 and after `bumpRev` and `followUp`.

### `contract/item-check.ts`

- **B26.** `validateItem(value)` returns normally for a valid record, including a draft comment with no note. It returns nothing.
- **B27.** For a value that is not an object, or is `null`, it throws a `TypeError` whose message is `"validateItem expects an object, got <typeof value>"` (`null` gives `"got object"`).
- **B28.** Otherwise it collects every problem and throws one `Error`: `"invalid item <String(id)>: "` followed by the problems joined with `"; "`, in this order:
  - `"id must be a non-empty string"`
  - `"rev must be a number >= 1"`
  - `"kind must be one of comment, edit, delete, format_only, note, choice"`
  - `"state must be one of draft, ready, handled, not_handled"`
  - `"page_origin must be a non-empty string"`, then `"page_path must be a non-empty string"`
  - `"after_history must be an array; replay's branch three reads it"`
  - the thread problems (B30)
  - the ready problems (B29)
  - `"reply.status must be one of handled, not_handled, question"` when `reply` is truthy and its status is not one of the three
  - the `validateChoice` reason, when there is one.
- **B29.** When `state` is not draft: a comment or a note whose `note` is falsy gives `"a ready comment must carry the reviewer's note"` (or `"a ready note ..."`); an edit whose `after` is not a string gives `"a ready edit must carry after text"`. Delete, format_only and choice have no such rule. A draft is never held to either.
- **B30.** A missing `thread` is accepted (legacy records). A `thread` that is present and not an array gives `"thread must be an array of completed exchanges"`. For each round `i`: not an object gives `"thread[i] must be an object"` and nothing more for it; otherwise `"thread[i].rev must be >= 1"` when `rev` is not a number of at least 1, `"thread[i].reviewer is required"` and `"thread[i].agent is required"` when either is missing or not an object, and `"thread[i].agent.status must be one of handled, not_handled, question"` when the agent is present with another status.
- **B31.** After `validateItem(value)` returns, the compiler treats `value` as a record (it is an assertion function).

### `domain/mint.ts`

- **B32.** `randomId(prefix)` is `prefix + "_" + 24 lowercase hex digits` (12 random bytes); with no prefix or `""`, just the 24 hex digits. 500 calls give 500 different ids.
- **B33.** When `globalThis.crypto.getRandomValues` is missing, `randomId` throws `Error("randomId: no CSPRNG available (globalThis.crypto.getRandomValues)")`. It never falls back to `Math.random`. (The test replaces `globalThis.crypto` for the call with `Object.defineProperty` and restores it in `finally`.)
- **B34.** `nowIso()` is the current time as `Date.prototype.toISOString` writes it, between two readings taken around the call.

### `domain/page-identity.ts`

- **B35.** `pageFrom(location, options)` for a served page returns, keys in this order, `{origin, path, title, seq, source_hint, aliases, path_aliases, spellings}`: `origin` the location's origin; `path` its `pathname` (so `/dashboard?tab=2#top` gives `/dashboard`), or `null` when it has none; `title` when it is a string, else `null`; `seq` when `options.seq` is a number, else `null`; `source_hint` when truthy, else `null`; `aliases` the strings of `options.aliases` (a new array; D9); `path_aliases` the strings of `options.path_aliases` that start with `/`; `spellings` the strings of `options.spellings` that hold a space after their first character. Missing lists give `[]`.
- **B36.** A page opened from disk, which is a location with no origin, an origin of `"null"`, or an `href` starting `file:` in any case, gets `origin: "file"` and as `path` the last two segments of `href` (or of `pathname` when there is no `href`), with the query and fragment dropped: `file:///Users/x/docs/brief.html?q#f` gives `docs/brief.html`. With nothing to name it, the path is `"document"`. `pageFrom(null)` is `{origin: "file", path: "document", ...}`.
- **B37.** `pageKey(item)` is `page_origin + "|" + page_path` and `pageKeyFor(page)` is `origin + "|" + path`, spelled the same way, so an item and its page give the same key; two servers serving `/dashboard` give two keys. Each throws a `TypeError` (`"pageKey expects an item"`, `"pageKeyFor expects a page"`) for a value that is not an object.
- **B38.** `identityOrigin(origin)` maps every spelling of a stable address to one name: `http://notes.lahe.localhost:7818`, `http://notes.lahe.localhost` and `http://notes.lahe` all give `"lahe-site:notes"`. Any other origin comes back as it was: `http://127.0.0.1:5000` stays itself. The site name is lowercase letters, digits, dots and hyphens, starting with a letter or digit.
- **B39.** `pageIdentityKey(item)` and `pageIdentityKeyFor(page)` are `identityOrigin(origin) + "|" + path`, with the same `TypeError`s as B37 (`"pageIdentityKey expects an item"`, `"pageIdentityKeyFor expects a page"`).
- **B40.** `samePage(item, page)` is true when the identity keys (B39) are equal. So every spelling of one stable address is one page, and a different name, a different path or a plain loopback port is a different page.
- **B41.** Otherwise it is true when one of `page.spellings` (`"origin path"`, split at the first space) has the item's identity origin and path.
- **B42.** Otherwise, when the item's origin is one of `page.aliases`: true when the item's path equals the page's path, or is one of `page.path_aliases`. A path alias never matches without an alias origin.
- **B43.** Otherwise, when neither side's origin is `"file"`, false. When either is, the two paths are compared by their last N segments, N being the shorter side's count, where segments drop the query, the fragment and empty parts, and a path that is empty or ends in `/` gains `index.html`. So `docs/report.html` from disk matches `/docs/report.html` served; `notes/index.html` and `deck/index.html` from disk stay apart; a one-segment record `report.html` matches on its name; `/` served matches `index.html` from disk; `/docs/` matches `docs/index.html`; and `/docs/report.html` does not match `index.html`.
- **B44.** `samePage` throws a `TypeError` (`"samePage expects an item"`, `"samePage expects a page"`) for a value that is not an object, rather than guessing.
- **B45.** `shortPath(path)` is the last two non-empty segments joined by `/`, query and fragment dropped: `/a/b/c.html?x` gives `b/c.html`. With no segments it returns the input as given (`"/"` gives `"/"`), and `""`, `null` and `undefined` give `""`.

### `domain/stamp-source.ts`

- **B46.** `STAMP_SOURCE_EXTENSIONS` is exactly `html, htm, xhtml, svg, vue, svelte, astro, jsx, tsx, erb, ejs, njk, hbs, liquid, php, mustache, twig, jinja, j2`, in that order.
- **B47.** `sourceCanCarryStamp(path)` is true when the path's extension, lowercased, is in that list. The extension is read from the last segment after the fragment and query are dropped, and only when the dot is neither the segment's first nor last character: `page.HTML` and `/a/b.erb?x#y` are true; `notes.md`, `README`, `.html`, `a.`, `dir.html/` and `null` are false.
- **B48.** `pageCanCarryStamp(page)` asks B47 of the page's source when the page knows one (`source_hint` as a non-empty string, or `source_hint.path` as one), and of `page.path` otherwise; `null` and a non-object give false.

### `domain/item-revisions.ts`

- **B49.** `newItem(input)` throws `Error("newItem: kind must be one of comment, edit, delete, format_only, note, choice, got <String(kind)>")` for any other kind, `Error("newItem: page_origin is required; review.json is grouped by origin plus path")` when neither `page_origin` nor `page.origin` is a non-empty string, and the same for `page_path` (`"newItem: page_path is required; review.json is grouped by origin plus path"`).
- **B50.** Otherwise it returns a new record with every field below present, keys in this order: `id` (input, else `randomId("itm")`), `rev` (input when a number, else 1), `kind`, `state` (input when truthy, else draft), `note`, `change`, `before`, `after`, `before_html`, `after_html` (each the input when a string, else `null`), `after_history` (a copy of the input array, else `[]`), `region` (input when truthy, else `emptyRegion()`), `context` (input when truthy, else `emptyContext()`), `page_origin`, `page_path`, `page_title` (input, else `page.title`, else `null`), `page_seq` (input when a number, else `page.seq` when a number, else `null`), `source_hint` (input, else `page.source_hint`, else `null`), `reverts` (input when a non-empty string, else `null`), `reply` (input, else `null`), `handled_not_on_page` (true only for input `true`), `thread` (a copy of the input array, else `[]`), `created_at` (input, else now), `updated_at` (input, else `created_at`). Then each run field the input carries (not `undefined`), in `RUN_FIELDS` order, and `choice` when the input carries it. Fields named "input" read `input.<field>` first; the page fields also read `input.page`. A record with neither run fields nor a choice has exactly the 24 common keys.
- **B51.** The record shares nothing mutable with its input: `after_history`, `thread`, each run-field array and each block object in it, and `choice` are copies. `received_at` is never copied from the input.
- **B52.** A record whose `after` is a string and whose history is empty starts its history with one entry for itself (B53, at `created_at`).
- **B53.** `historyEntry(item, at)` returns `{rev, after, after_html, at}` from the item (`after` and `after_html` as strings or `null`), and, when the item has run fields (B11), a copy of each of `new_blocks`, `anchor_after_html`, `anchor_tag_after` and `placement` it carries; never `remove_blocks`.
- **B54.** `bumpRev(item, changes)` returns a new record and leaves `item` untouched: the item with `changes` applied, `rev` one more than the item's, `updated_at` now, and no `closed_by` or `closed_at` key, even if `changes` set them.
- **B55.** `bumpRev` appends a history entry (B53, at the new `updated_at`) when the new `after` is a string and there is no entry yet or it differs from the last entry's, or the same holds for the new `after_html`, or there is a last entry, the record has run fields, and its `anchor_tag_after` differs from the last entry's (missing read as `null`). A rewording that lands on the same text and markup does not grow the history. Two format-only rewordings with the same text and different markup each add an entry.
- **B56.** On a run record (B11), after `bumpRev` every history entry before the last `RUN_HISTORY_KEEP` has no `new_blocks` key and `after_html: null`, and keeps its `after`. Records that are not run records keep their history whole.
- **B57.** `priorAfters(item, field)` lists, in history order and without repeats, each history entry's `after` (or `after_html` when `field` is `"after_html"`) that is a string and differs from the record's current value of that field. `field` defaults to `"after"`. It never lists the current value or the `before`.
- **B58.** `comparisonMode(item)` is `COMPARISON_MODE.STRUCTURE` (`"structure"`) for format_only and `COMPARISON_MODE.TEXT` (`"text"`) for every other kind.
- **B59.** `comparisonFields(item)` is `{before: "before_html", after: "after_html"}` for format_only and `{before: "before", after: "after"}` otherwise.

### `domain/item-status.ts`

- **B60.** `isDraft(item)` and `isReady(item)` are true exactly for those states.
- **B61.** `isUnansweredReady(item)` is true for a ready record with no reply, and for a ready record with `handled_not_on_page: true` whatever its reply; false for every other state, for a ready record with a reply, and for `null`.
- **B62.** `isOutstanding(item)` is true for ready and not_handled, false for draft and handled.
- **B63.** `isReplayable(item)` is true only for a ready record whose current revision is not a tool round (B66). A not_handled record, a handled one, a draft and `null` are false.
- **B64.** `isClosedByReviewer(item)` is true only for a handled record with `closed_by: "reviewer"`; a ready record carrying a stale mark is false, and so is `null`.

### `domain/tool-round.ts`

- **B65.** `pageCheckReopen(item)` is the record's `region.check_reopen` when it is an object, else `null` (also for a record with no region, and for `null`).
- **B66.** `toolRoundOf(item)` is the stamp's `tool` when the stamp's `rev` is a number equal to the record's `rev` and the tool is a tool round name (B5); otherwise `null`. A reopen that names no tool is not a tool round, and any later revision ends the round.
- **B67.** `isToolRound(round)` is true when `round.tool` is a tool round name; false for a round without `tool`, and for `null`.
- **B68.** `answeredPageCheckReopen(item)` is true when the stamp's `rev` is a number equal to the record's `rev`, whatever its tool; false with no stamp.
- **B69.** `displayState(item)` is handled while a tool round is open on the record, the record's own state otherwise, and `null` for `null`.

### `domain/thread.ts`

- **B70.** `threadOf(item)` is the record's `thread` when it is an array, else `[]` (missing, not an array, or `null` record).
- **B71.** `chronologicalThread(item)` returns a new array of the same rounds, ordered by each round's time (`reviewer.at`, else `agent.at`, read with `Date.parse`): rounds with a readable time come first in time order, then the rest; equal times and unreadable times keep their stored order. The stored array is not reordered.
- **B72.** `completedRound(item)` throws `Error("completedRound: an item needs an agent reply before it can be archived")` when the record has no reply. Otherwise it returns `{rev, reviewer: {note, change, at}, agent}`: `note` and `change` as strings or `null`, `at` the record's `updated_at`, else `created_at`, else `null`; `agent` is the archived reply: `{status, agent, reason, text, files, at}`, each falsy value as `null` and `files` a copy of the array (else `[]`), plus `proofread: true` and `suggestions` (each as `{block, from, to}`) when the reply was proofread, plus `previous` (each archived the same way) when the reply had it. The archived reply never carries `user_needs_to_see_reply`. The round has a `tool` key only when the current revision is a tool round.
- **B73.** `retainReplies(item, reply)` returns `reply` (as a new object) when the record has no reply. When the record's reply, archived without its `previous`, equals `reply` archived (B72's form, compared as JSON), it returns the record's own reply object unchanged. Otherwise it returns `reply` with `previous` set to the record's earlier `previous` followed by the record's reply, archived.
- **B74.** `continueThread(item, turn)` returns one revision past the record (B54): its thread is `chronologicalThread(item)` followed by `completedRound(item)`, its note and change are the turn's (strings, else `null`), its state is ready and its reply `null`.
- **B75.** `continueOnto(item, base, turn)`: when `base` is the record itself, it is `continueThread(item, {note: turn.note, change})`, where `change` is the turn's change if a string, else the record's. Otherwise it returns `base` (which is already one revision past the record) with the record's thread plus its completed round, the turn's note (or `null`), state ready, reply `null`, and `base`'s own change when that is a string, else the carried change. The revision is not bumped again.
- **B76.** `followUp(item, text)` returns the record itself, unchanged, when `text` is empty or whitespace. Otherwise it is `continueThread` with `text` as the note and the record's change carried, so every revision still says what the edit was.
- **B77.** `reopenIssue(item)` is `continueThread` with the record's own note and change carried.

### `domain/page-check.ts`

- **B78.** Pinned sentences: `PAGE_CHECK_STAMP_NOTE` is `"Reopened by the page check: the change landed but the data-lahe-id stamp did not reach the source. Write the stamp onto that element so the next build reproduces it, or reply not_handled saying why."` `LEGACY_PAGE_CHECK_NOTE` is `"Reopened by the page check: this handled change is no longer on the page and the original text is back. Reapply it, or reply not_handled saying why."` `PAGE_CHECK_NOTES` is `[PAGE_CHECK_STAMP_NOTE, LEGACY_PAGE_CHECK_NOTE]`, and nothing is exported under the old run-note names (`PAGE_CHECK_TAG_NOTE`, `PAGE_CHECK_RUN_NOTE`, `PAGE_CHECK_TAKEBACK_NOTE`).
- **B79.** `appendNoteOnce(carried, sentence)`: a blank sentence returns `carried` when it is a string, else `null`; a blank or missing note returns the sentence; a note that already holds the sentence comes back unchanged; otherwise the note, a blank line (`"\n\n"`) and the sentence.
- **B80.** `stampPageCheckReopen(item, stamp, at, tool)` sets the record's `region` to a new object (every other region key kept) whose `check_reopen` is `{rev: item.rev, at, stamp, tool}`: `at` defaults to now, `stamp` is `null` unless a string, and `tool` is `null` unless a tool round name. It returns that `check_reopen`. The region object the caller held before is not changed. `null` gives `null`.
- **B81.** `pageCheckReopenOf(item, note, at, tool)` returns `reopenIssue(item)` with `note` appended once (B79, when not blank) and stamped (B80) with the reply stamp the record had before the reopen (B84), `at` and `tool`. Called again on the agent's next handled answer and reopened again, the note still holds the sentence once. With the stamp tool, the result is a tool round (B66) that the agent's next handled reply ends.
- **B82.** `collapsePageCheckNote(value)` returns the value itself when it is not an object, when its note is not a string, or when no sentence in `PAGE_CHECK_NOTES` appears more than once. Otherwise it returns a shallow copy whose note keeps everything up to and including the first copy of each repeated sentence, drops the later copies and the blank lines they were joined on, keeps any other words written between them after one blank line, and folds runs of three or more newlines to two.
- **B83.** `reviewerNote(item)` is the record's note with every copy of `PAGE_CHECK_STAMP_NOTE` removed, runs of three or more newlines folded to two, and trimmed; `null` when nothing is left or the note is not a non-empty string. The legacy sentence is not removed.

### `domain/reply-unread.ts`

- **B84.** `replyStamp(item)` is `String(reply.at)` (or `""` when it has none) `+ "@" +` the record's `rev` (or `""` when missing), so `{rev: 2, reply: {at: "T"}}` gives `"T@2"` and a reply with no `at` gives `"@2"`; `null` when there is no reply or no record.
- **B85.** `hasWords(value)` is true for a string with a non-space character, false otherwise.
- **B86.** `needsToSeeReply(reply)` is true for a question and for not_handled, always. For handled it is true only when `user_needs_to_see_reply` is exactly `true` and `text` or `reason` has words (B85). `null` gives false.
- **B87.** `isUnreadReply(item, mark)` is false when the record has no reply, when its current revision is a tool round, when it is closed by the reviewer (B64), when the reply does not need to be seen (B86), when `reply_seen` equals the reply's stamp, or when `mark` equals it. Otherwise true. A mark or `reply_seen` naming an older reply's stamp does not clear a newer one.
- **B88.** `unseenReplyIds(items, marks)` lists, in item order, the ids of the items with an unread reply, reading each item's mark from `marks` only as an own property. Missing `items` gives `[]`; missing or non-object `marks` count as none.

### `domain/accepted-page-texts.ts`

- **B89.** `ACCEPTED_PAGE_TEXTS_MAX` is 8, pinned. `acceptedPageTexts(item)` is the record's `region.accepted_page_texts` when it is an array, else `[]`; a new record has accepted nothing.
- **B90.** `acceptPageText(item, text)` adds a non-empty string to the record's accepted list unless it is already there, keeps only the newest `ACCEPTED_PAGE_TEXTS_MAX`, sets `region` to a new object with the new list (every other region key kept; `emptyRegion()` when the record had none), and returns the list. The region object the caller held before is not changed. A blank or non-string text, or a `null` record, changes nothing and returns the current list. The record's `before` is never touched.

### `domain/subject.ts`

- **B91.** `paintQuoteOf(item)` is `context.quote` when it is a string and the record has no `context.subject`; `null` for a whole-element record, a record with no context, or a non-string quote.
- **B92.** `subjectHtmlOf(subject)` is `subject.html`, with every ` src="lahe:subject.src"` replaced by ` src="<subject.src, attribute-escaped>"` when `subject.src` is a string. `subject.html` comes back as it is when it holds no pointer or `src` is not a string, and `null` when `html` is not a string or there is no subject.

### `domain/change-text.ts`

- **B93.** `changedSpan(before, after)` returns `{removed, added}`: what is left of each after the longest shared prefix and suffix are taken off, widened so neither end falls inside a word. Word characters are ASCII letters and digits, `_`, U+00C0 to U+024F, U+0370 to U+1FFF, U+2C00 to U+D7FF, `'` and U+2019. Pinned: `("A friend asked me last week.", "Article drop! A friend asked me last week.")` gives `{removed: "", added: "Article drop! "}`; `("the cat sat", "the cats sat")` gives `{removed: "cat", added: "cats"}`; `("I like dogs", "I love dogs")` gives `{removed: "like", added: "love"}`. Non-strings read as `""`.
- **B94.** `paragraphAddition(before, after)` returns `{where: "after", text}` when the trimmed `after` starts with the whole trimmed `before`, followed by two or more newlines and non-blank words (`text`, trimmed); `{where: "before", text}` for the mirror case at the end; `null` otherwise, including equal texts, an empty side, and a split or an insertion in the middle.
- **B95.** In the paragraph sentence (B98), the existing paragraph is quoted by its lead: whitespace runs folded to one space and trimmed, then, if longer than 60 characters, cut to 60, cut back to the last space when that space is past the 20th character, and followed by `...`.
- **B96.** `formattingChangeText(beforeHtml, afterHtml)` compares the emphasis runs of the two markups (C2's `emphasisRuns`), counting identical runs separately, and returns sentences joined by one space, or `""` when nothing moved or `afterHtml` is empty: for each run only in the after, `Made "<text>" bold.` (strong), `Made "<text>" italic.` (em), `Removed bold from "<text>".` (not-bold), `Removed italic from "<text>".` (not-italic); then for each strong or em run only in the before, `Removed bold from "<text>".` or `Removed italic from "<text>".`, unless the after has the matching reset tag on the same words, which already said it. Pinned: `("a b c", "a <em>b</em> c")` gives `Made "b" italic.`; `("a <strong>b</strong> c", "a b c")` and `("a <strong>b</strong> c", "a <not-bold>b</not-bold> c")` both give `Removed bold from "b".`. A link, a span or a class is never reported.
- **B97.** `editChangeText(kind, before, after, beforeHtml, afterHtml)` is `"Deleted this block."` for delete and `"Changed the emphasis in this block; the words are the same."` for format_only.
- **B98.** For any other kind, when `paragraphAddition(before, after)` holds, it is `Added a paragraph <where> "<lead of before>": "<text>".`, followed by one space and the formatting sentences when there are any. Pinned: `("A friend asked me.", "New para here.\n\nA friend asked me.")` gives `Added a paragraph before "A friend asked me.": "New para here.".`
- **B99.** Otherwise, when the changed span (B93) adds a newline: `BREAK_ADDED_PARAGRAPH` (`"Added a paragraph break: this block becomes two paragraphs."`) if it adds a blank line, else `BREAK_ADDED_LINE` (`"Added a line break."`); when it only removes one, `BREAK_REMOVED` (`"Removed a break, joining the lines into one."`). With a break sentence, the span's words are whitespace-folded and trimmed before B100 quotes them, so splitting `"One two three"` into `"One two\n\nthree"` says only the break sentence.
- **B100.** The words: `Changed "<removed>" to "<added>".`, `Added "<added>".` or `Removed "<removed>".`, quoting the span as it is (`("ab", "ab cd")` gives `Added " cd".`). The sentence is the break sentence, the words and the formatting sentences, each present, joined by one space; with none of them, `"Edited this block."`

### `domain/revert.ts`

- **B101.** Pinned sentences: `REVERT_EDIT` `"Undo: the reviewer took this change back. Remove it from the source, so the passage reads as it did before."`, `REVERT_DELETE` `"Undo: the reviewer put this block back. Restore it in the source; it should not have been deleted."`, `REVERT_FORMAT` `"Undo: the reviewer took this formatting change back. Put the markup back the way the source had it."`. `revertOf(item, extra)` on a record with no run fields returns a new ready record (fresh id, rev 1) whose `reverts` is the item's id, whose page fields are the item's, whose region and context are `extra`'s (else empty, B6 and B7), whose `created_at` is `extra.created_at` (else now), and:
  - for an edit: kind edit, change `REVERT_EDIT`, `before` the item's `after` and `after` the item's `before` (each `""` when not a string), `before_html` the item's `after_html` and `after_html` the item's `before_html` (each `null` when not a string);
  - for a delete: kind edit, change `REVERT_DELETE`, `before` and `before_html` `""`, `after` and `after_html` the item's `before` and `before_html`;
  - for format_only: kind format_only, change `REVERT_FORMAT`, the same swap as an edit, so it compares on markup (B59).
- **B102.** On a record with run fields (B11), `revertOf` returns the run take-back: kind format_only for format_only and edit otherwise; the swap of B101 applied to `before`, `after`, `before_html` and `after_html`; `remove_blocks` a copy of the item's `new_blocks` (absent when it had none) and never `new_blocks`; `placement` the item's, else after_anchor; region and context `extra`'s, else the item's; and change text made of the revert sentence for the kind, then, for a run record, `RUN_TAKEBACK_LINE` (`"Remove the blocks in remove_blocks from after this {type}; the reviewer undid them."`) with `{type}` the anchor's type name (B106), then, when the item changed the anchor's tag to another tag and the anchor's old tag (B106) is a writable tag and differs from it, `RUN_TAKEBACK_TAG_LINE` (`"Change this {type} back to {tag}, the tag in anchor_tag_after; the reviewer undid the type change."`) with `{type}` the new tag's type name and `{tag}` the old tag, and `anchor_tag_after` set to the old tag. With no tag change, the take-back has no `anchor_tag_after`. The take-back passes `validateRun` (B117).
- **B103.** `takenBackIds(items)` is a `ReadonlySet` of the `reverts` id of every revert among `items`; empty for `[]`, `null` and `undefined` (D4).

### `domain/run-record.ts`

- **B104.** `buildRunAfter(anchorHtml, blocks)` returns `{after_html, after}`: `after_html` is the anchor's markup (`""` when not a string) followed by each block as `<tag>html</tag>`, and `after` is C2's `blockText(after_html)`. Pinned: `("Anchor", [{tag: "p", html: "New"}, {tag: "h2", html: "Head"}])` gives `{after_html: "Anchor<p>New</p><h2>Head</h2>", after: "Anchor\n\nNew\n\nHead"}`.
- **B105.** `anchorView(item)` returns, for a record whose `anchor_after_html` is a string, a copy with `after_html` set to it and `after` set to its `blockText`; any other record (and `null`) is returned as it is. The record passed in is never changed.
- **B106.** `anchorTagOf(item)` is `region.ref.fingerprint.tag` lowercased when it is a non-empty string, else `context.element` lowercased when it is one, else `null`. `anchorTypeName(item)` is `"paragraph"` for p, `"heading"` for h1 to h6, `"list"` for ul and ol, and `"block"` otherwise.
- **B107.** `recordBytes(record)` is the UTF-8 byte length (B15) of `JSON.stringify(record)`. `blocksBytes(blocks)` is the sum of the UTF-8 byte lengths of the blocks' `html` strings, skipping blocks whose `html` is not a string; `0` for a missing list.
- **B108.** `handedOverBlocks(item, items)` returns an object that maps a block index, or `"anchor"`, to `{id, tag, html}` of the first later record that took that block over. A record takes block `i` over when it is a hand edit (B8), not a revert, not the item itself (by object or id), not created before the item (`created_at` compared as strings, when both are strings), and its words before its sitting (C2's `blockWords` of its `before_html`, else its `before`) are non-empty and equal block `i`'s words. The anchor is taken over the same way, compared with the item's `anchor_after_html`, except when the item's placement is start_of_container. `tag` is the later record's `anchor_tag_after` when it is a non-empty string, else `null`; `html` is its `anchor_after_html` when a string, else its `after_html`, else `null`. An empty or missing list gives `{}`.
- **B109.** `runChangeText(item)` names structure and never quotes a block's words. With `{type}` from B106 and the sentences joined by one space:
  - when the placement is not start_of_container and `anchor_after_html` is a string, and the words or the emphasis runs of the anchor's markup plus every `from_anchor` block differ from the record's `before_html` (else `before`, else `""`): `Reworded this {type}; its new markup is in anchor_after_html.`
  - when the placement is not start_of_container and `anchor_tag_after` is a non-empty string: `Changed this {type} to <tag>.`
  - when a block is marked `from_anchor`: `Split this {type} in two after the anchor's new end. The second part is new_blocks[<first such index>], marked from_anchor.`
  - when blocks not marked `from_anchor` exist: `Added <n> block <where>: <tags>. Its words are in new_blocks.` for one, and `Added <n> blocks <where>: <tags>. Their words are in new_blocks.` for more, where `<where>` is `at the start of the page` or `after this {type}` and `<tags>` joins the tags with `", "`;
  - with none of these, `Edited this {type}.`
  Pinned: two blocks after a p anchor give `"Added 2 blocks after this paragraph: p, h2. Their words are in new_blocks."`.

### `domain/run-check.ts`

- **B110.** `validateRun(value)` takes untrusted data, returns `null` or `{code, reason}` naming the first refusal, and never throws. `code` is one of `RUN_BLOCK_REFUSED`, `RUN_OVER_CEILING`, `RUN_PLACEMENT_REFUSED`, `RUN_TAKEBACK_CARRIES_RUN`, each a code in C1's failure table.
- **B111.** A value that is not a non-null object gives `RUN_BLOCK_REFUSED`, `"not a record"`. An object with no run fields (B11) gives `null`.
- **B112.** Then, in order: `new_blocks` present, not `null` and not an array: `RUN_BLOCK_REFUSED`, `"new_blocks is not a list"`. Both `new_blocks` and `remove_blocks` non-empty: `RUN_TAKEBACK_CARRIES_RUN`, `"a take-back carries new_blocks"`. Either list non-empty, or `placement` present, and `placement` not one of `PLACEMENTS`: `RUN_PLACEMENT_REFUSED`, `"placement is " + JSON.stringify(placement)` (so `"placement is \"x\""`, and `"placement is undefined"` for a run with no placement). `anchor_tag_after` present, not `null` and not a writable tag (C2's `WRITABLE_BLOCK_TAGS`): `RUN_BLOCK_REFUSED`, `"anchor_tag_after <tag> is not writable"`.
- **B113.** Then the sizes, before any markup is parsed, on the run's list (`new_blocks` when non-empty, else `remove_blocks`): more than `NEW_BLOCKS_MAX` blocks gives `RUN_OVER_CEILING`, `"<n> blocks"`; block markup over `NEW_BLOCKS_MAX_BYTES` UTF-8 bytes (B107) gives `RUN_OVER_CEILING`, `"the run's markup is over the byte ceiling"`, so one block of three-byte characters just over the byte ceiling is refused although the block count is fine; the whole record over `RUN_RECORD_MAX_BYTES` as JSON gives `RUN_OVER_CEILING`, `"the record is over the size ceiling"`, even under both block ceilings. A block of 1 MiB of nested tags is refused on size, well within one second.
- **B114.** Then each block of that list, by index `i`, with `RUN_BLOCK_REFUSED`: `"block i is not an object"`; `"block i from_anchor is not a boolean"` when it is present and not a boolean; `"block i: <reason>"` when C2's `cleanBlock(tag, html)` refuses; `"block i is not clean"` when `cleanBlock`'s markup differs from `html`, or the tag is not lowercase. The helper refuses rather than cleans.
- **B115.** Then, when the run is non-empty or `anchor_after_html` is present and not `null`, the sitting, with `RUN_BLOCK_REFUSED`: `anchor_after_html` not a string gives `"anchor_after_html is not a string"`; over `NEW_BLOCKS_MAX_BYTES` gives `"anchor_after_html is over the byte ceiling"`; not equal to C2's `cleanMarkup` of itself gives `"anchor_after_html is not clean"` (an `onerror` attribute is refused this way); `after_html` not exactly `buildRunAfter(anchor_after_html, new_blocks).after_html` gives `"after_html is not anchor_after_html followed by new_blocks"` (so a `<script>` appended to `after_html` is refused); `after` not exactly its `after` gives `"after is not the words of after_html"`.
- **B116.** Then, when there was no sitting refusal and `remove_blocks` is non-empty, the take-back, with `RUN_BLOCK_REFUSED`: `"a take-back has no before_html"` when it is not a string; `"before_html does not end with the blocks in remove_blocks"` when it does not end with `buildRunAfter("", remove_blocks).after_html`; and the markup before that tail is held to B115's first three checks under the name `the take-back's anchor markup`.
- **B117.** A valid run, a valid take-back made by `revertOf` (B102), and a valid tag-only change all give `null`.

### `domain/proofread.ts`

- **B118.** `USE_FIXES_CHANGE` is `"The reviewer took your proofreading fixes, {n} in all. In the source, replace each fix's from words with its to words in the block you already placed, in place, so it matches new_blocks; do not add any block again. The fixes are listed as block, from and to under suggestions in the thread's last agent turn."`, pinned.
- **B119.** `applySuggestions(item, suggestions)` on a run record applies each suggestion, in order, to a copy of its block, then returns `bumpRev(item, changes)` where `changes` are `change` (`USE_FIXES_CHANGE` with `{n}` the number of suggestions), the new `new_blocks`, and `after_html` and `after` from `buildRunAfter(anchor_after_html, new_blocks)`. Each reworded block goes through C2's `cleanBlock`. The record passed in, and its blocks, are not changed. The result passes `validateRun`.
- **B120.** It returns `{code: "SUGGESTION_NOT_FOUND", reason}` instead, at the first failing suggestion `i`: `"not a run record"` when the record is not one; `"suggestion i does not name a block and a from"` when the suggestion is not an object, its `block` names no block, its `from` is not a non-empty string, or its `to` is not a string; `"suggestion i: block <b> is marked from_anchor, the page's own words"` for a block marked `from_anchor`; `"suggestion i: from is not in block <b> exactly once"` when the block's text holds `from` zero times or more than once; `"suggestion i leaves block <b> empty or unsafe"` when `cleanBlock` refuses the result. A missing list is treated as empty.
- **B121.** A fix changes words inside the block's text only: the text is read with `&lt;`, `&gt;` and `&amp;` resolved, `from` is found in the joined text of all the block's text pieces, only the part of `from` that differs from `to` (shared prefix and suffix kept) is replaced, and every tag stays where it was. So `"every time"` to `"each time"` over a bold `every` leaves the bold on the words it still covers, a fix that only inserts goes into the text piece that holds the point, and a block's bold survives a fix next to it. The text is written back with `&`, `<` and `>` escaped.

### `domain/choice-state.ts`

- **B122.** `choiceStateOf(item, kept)` is done for handled, not_handled for not_handled, kept when `kept` is true or the record is a draft, question when the reply's status is question, and open otherwise.
- **B123.** `latestChoiceByGroup(items)` returns a `ReadonlyMap` from each group name to the current press: among the choice records whose `choice.group` is a valid token (B19), the one with the latest `created_at`, compared as strings, a later item in the list winning a tie. Records of other kinds, and choice records off the grammar, are left out. A group named `constructor` or `toString` is an ordinary key (D4).

### The bridges (until F1)

- **B124.** `require("src/shared/record.js")` returns one plain, writable object holding every runtime export of the twenty-two modules under the names in section 4, and no others; no two modules export the same name. It holds none of the twelve removed names (D1).
- **B125.** In the built bundle, `window.LAHE.record` holds the same names before any file that reads it runs. The browser specs listed in section 7 read `pageFrom`, `newItem`, `emptyRegion`, `emptyContext`, `FIELD`, `KIND`, `STATE`, `randomId`, `applySuggestions`, `validateRun`, `NEW_BLOCKS_MAX_BYTES`, `samePage` and `bumpRev` there.

## 3. Callers

Found by `c3_usage.py`: every file under `src/`, `scripts/`, `test/` and `bin/` that loads `record.js` (by `require`, as a factory parameter, through `LAHE.record`, or through `contracts.record`), with the exports it reads outside comments. "Owner slice" is the slice that converts the caller, from the target layout. "Breaks" means the caller must change in this slice; everything else keeps working through the forwarder and the bundle registration, because every name it reads keeps its spelling and its behavior.

Four files load the record without naming an export in code, and are not in the tables: `src/shared/contracts.js` (re-exports it as `record`; C5 removes the barrel), `src/shared/manifest.js` (its bundle entry; C3 edits only that entry), `test/unit/sanity.test.js` (loads the barrel) and `test/browser/support/export_stub.js` (reads `record.js` as source text; dead, and on the cleanup list since C1). `scripts/compact_draft_history.js`, `src/cli/commands/install.js` and four Library test files (`catalog_auth`, `catalog_lifetime`, `catalog_routes`, `library_open_sites`) match the search only through other files named "record" and do not load this module.

Exports read only by the old tests: `KINDS`, `INTENT_FIELDS`, `fieldClass`, `pageKey`, `sourceCanCarryStamp`, `completedRound`, `ACCEPTED_PAGE_TEXTS_MAX`, `LEGACY_PAGE_CHECK_NOTE`, `RUN_HISTORY_KEEP`, `RUN_TAKEBACK_LINE`, `USE_FIXES_CHANGE`, `PAGE_CHECK_NOTES`, `stampPageCheckReopen`, `changedSpan`, `paragraphAddition`, `formattingChangeText`, `REVERT_DELETE`, `REVERT_FORMAT`, `BREAK_ADDED_PARAGRAPH`, `BREAK_ADDED_LINE`. Exports read by nothing outside the file, not even a test, that stay because a sibling module uses them, `docs/CONTRACTS.md` names them, or they are the table a union comes from: `CHOICE_TOKEN`, `CHOICE_STATE`, `FIELD_CLASS`, `STAMP_SOURCE_EXTENSIONS`, `RUN_FIELDS`, `RUN_TAKEBACK_TAG_LINE`, `BREAK_REMOVED`. Exports read by nothing at all that go (D1): `emptyPage`, `itemCanCarryStamp`, `basenameOf`, `RUN_CODE`, `utf8Bytes`, `trimRunHistory`, `TOOL_ROUNDS`, `revertChangeText`, `CHOICE_CODE`, `normalizedBefore`, `normalizedAfter`. `blockText` goes too, with its one caller edited (D2).

#### src

| Caller | Owner slice | Uses | Breaks? |
| --- | --- | --- | --- |
| `src/cli/commands/reply.js` | CLI | `FIELD`, `applySuggestions`, `isRunRecord` | no |
| `src/cli/commands/status.js` | CLI | `FILE_ORIGIN`, `STATE`, `STATES`, `isUnansweredReady` | no |
| `src/layer/anchor.js` | B3 | `CHOICE_MARKUP`, `KIND`, `PLACEMENT`, `SUBJECT_SRC_REF`, `isChoiceToken` | no |
| `src/layer/choices.js` | B1 | `CHOICE_MARKUP`, `CHOICE_TOKEN_RULE`, `FIELD`, `KIND`, `STATE`, `bumpRev`, `choiceRef`, `continueThread`, `emptyContext`, `isChoice`, `isChoiceToken`, `latestChoiceByGroup`, `newItem`, `validateItem` | **yes**: `latestChoiceByGroup(...)[name]` at 407 (D4) |
| `src/layer/comments.js` | B10 | `FIELD`, `KIND`, `STATE`, `bumpRev`, `emptyContext`, `emptyRegion`, `emptySlideContext`, `isDraft`, `isReady`, `newItem`, `nowIso`, `paintQuoteOf`, `validateItem` | no |
| `src/layer/editing.js` | B11 | `FIELD`, `KIND`, `NEW_BLOCKS_MAX`, `NEW_BLOCKS_MAX_BYTES`, `PLACEMENT`, `RUN_RECORD_MAX_BYTES`, `STATE`, `blocksBytes`, `buildRunAfter`, `bumpRev`, `editChangeText`, `emptyContext`, `emptyRegion`, `hasRunFields`, `historyEntry`, `isDraft`, `isReplayable`, `isRunRecord`, `newItem`, `nowIso`, `recordBytes`, `revertOf`, `runChangeText`, `takenBackIds`, `validateItem` | **yes**: `record.historyEntry` at 296 (D3); `record.takenBackIds(...)[itemId]` at 4044 (D4) |
| `src/layer/export.js` | B1 | `FIELD` | no |
| `src/layer/index.js` | B12 | `FIELD`, `KIND`, `STATE`, `TOOL_ROUND`, `isChoice`, `isReplayable`, `isRevert`, `pageFrom`, `pageKeyFor`, `paintQuoteOf`, `samePage` | no |
| `src/layer/overlay.js` | B6 | `CHOICE_MARKUP`, `CLOSED_BY_REVIEWER`, `FIELD`, `KIND`, `PLACEMENT`, `REPLY_STATUS`, `STATE`, `STATES`, `displayState`, `isChoiceToken`, `isClosedByReviewer`, `isOutstanding`, `isUnansweredReady`, `reviewerNote`, `toolRoundOf`, `validateItem` | no |
| `src/layer/replay.js` | B5 | `CHOICE_MARKUP`, `FIELD`, `KIND`, `PAGE_CHECK_STAMP_NOTE`, `PLACEMENT`, `STATE`, `acceptPageText`, `acceptedPageTexts`, `anchorTagOf`, `anchorTypeName`, `anchorView`, `answeredPageCheckReopen`, `buildRunAfter`, `bumpRev`, `choiceRef`, `choiceStateOf`, `comparisonFields`, `comparisonMode`, `emptyRegion`, `handedOverBlocks`, `hasRunFields`, `isChoice`, `isHandEdit`, `isOutstanding`, `isReplayable`, `isRevert`, `isRunRecord`, `latestChoiceByGroup`, `pageCheckReopen`, `paintQuoteOf`, `priorAfters`, `runChangeText`, `takenBackIds` | **yes**: `takenBackIds` at 1584 to 1587 and 3406 to 3407; `latestChoiceByGroup` at 3021 to 3023 (D4) |
| `src/layer/store.js` | B2 | `FIELD`, `bumpRev`, `collapsePageCheckNote`, `isDraft`, `randomId`, `shortPath`, `validateItem` | no |
| `src/layer/style_switch.js` | B2 | `FIELD`, `KIND`, `isUnansweredReady` | no |
| `src/layer/sync.js` | B9 | `FIELD`, `KIND`, `STATE`, `isChoice`, `isDraft`, `isRunRecord`, `randomId`, `replyStamp` | no |
| `src/layer/tab_active.js` | B7 | `FIELD`, `KIND`, `STATE`, `isChoice`, `isDraft`, `reviewerNote` | no |
| `src/layer/tab_done.js` | B8 | `FIELD`, `REPLY_STATUS`, `STATE`, `appendNoteOnce`, `applySuggestions`, `chronologicalThread`, `continueOnto`, `continueThread`, `displayState`, `followUp`, `hasWords`, `isChoice`, `isClosedByReviewer`, `isHandEdit`, `isRunRecord`, `isToolRound`, `isUnreadReply`, `needsToSeeReply`, `pageCheckReopenOf`, `randomId`, `reopenIssue`, `replyStamp`, `retainReplies`, `reviewerNote`, `threadOf`, `toolRoundOf`, `unseenReplyIds` | no |
| `src/layer/tab_edits.js` | B7 | `FIELD`, `KIND`, `isHandEdit` | no |
| `src/service/catalog_reader.js` | SV6 | `FIELD`, `REPLY_STATUS`, `STATE`, `isUnansweredReady`, `isUnreadReply` | no |
| `src/service/handled_check.js` | SV4 | `FIELD`, `KIND`, `PLACEMENT`, `anchorView`, `isRevert`, `isRunRecord`, `toolRoundOf` | no |
| `src/service/log.js` | SV2 | `REPLY_STAMP_MAX`, `validateChoice`, `validateRun` | no |
| `src/service/page_routes.js` | SV4 | `FIELD`, `identityOrigin`, `isDraft`, `pageFrom`, `samePage` | no |
| `src/service/projection.js` | SV4 | `FIELD`, `REPLY_STAMP_MAX`, `STATE`, `isDraft`, `isReady`, `replyStamp`, `retainReplies`, `threadOf`, `validateChoice`, `validateRun` | no |
| `src/service/replies.js` | SV4 | `FIELD`, `REPLY_STATUS`, `STATE`, `isClosedByReviewer`, `isDraft` | no |
| `src/service/routes.js` | SV5b | `FIELD`, `STATE`, `isUnansweredReady`, `pageCanCarryStamp` | no |
| `src/shared/lifecycle.js` | C5 | `CLOSED_BY_REVIEWER`, `FIELD`, `REPLY_STATUS`, `REPLY_STATUSES`, `STATE`, `STATES`, `isClosedByReviewer`, `isDraft`, `isOutstanding` | no |
| `src/shared/merge.js` | C5 | `FIELD`, `isClosedByReviewer` | no |
| `src/shared/record_fixtures.js` | C5 | `KIND`, `NEW_BLOCKS_MAX`, `PLACEMENT`, `REPLY_STATUS`, `REVERT_EDIT`, `STATE`, `buildRunAfter`, `bumpRev`, `emptyContext`, `newItem`, `revertOf`, `runChangeText` | no |
| `src/shared/review_format.js` | C5 | `CLASS_DATA`, `CLASS_INSTRUCTION`, `FIELD`, `FILE_ORIGIN`, `NEW_BLOCKS_MAX_BYTES`, `PLACEMENT`, `PLACEMENTS`, `STATE`, `STATES`, `TOOL_ROUND`, `blockText`, `chronologicalThread`, `emptySlideContext`, `hasRunFields`, `isChoice`, `isChoiceToken`, `isClosedByReviewer`, `isRunRecord`, `pageCanCarryStamp`, `pageIdentityKey`, `pageIdentityKeyFor`, `pageKeyFor`, `samePage`, `subjectHtmlOf`, `threadOf` | **yes**: `record.blockText` at 485, 1044, 1054 (D2) |

#### scripts

| Caller | Owner slice | Uses | Breaks? |
| --- | --- | --- | --- |
| `scripts/measure_draft_write_cost.js` | T3 | `KIND`, `STATE`, `newItem` | no |
| `scripts/measure_moved_lookup.js` | T3 | `KIND`, `STATE`, `newItem` | no |

#### test/unit

| Caller | Owner slice | Uses | Breaks? |
| --- | --- | --- | --- |
| `test/unit/active_filter.test.js` | T1 | `KIND`, `STATE`, `newItem` | no |
| `test/unit/adopt_old_records.test.js` | T1 | `FIELD`, `KIND`, `STATE`, `bumpRev`, `newItem`, `pageFrom`, `samePage` | no |
| `test/unit/agent_liveness.test.js` | T1 | `FIELD`, `KIND`, `STATE`, `newItem` | no |
| `test/unit/batch_reply_own_answers.test.js` | T1 | `FIELD`, `KIND`, `STATE`, `newItem` | no |
| `test/unit/card_collapse.test.js` | T1 | `FIELD`, `KIND`, `REPLY_STATUS`, `STATE`, `newItem` | no |
| `test/unit/catalog_reader.test.js` | T1 | `KIND`, `STATE`, `newItem` | no |
| `test/unit/choice_anchor_rung.test.js` | T1 | `PLACEMENT`, `choiceRef` | no |
| `test/unit/choice_kernel.test.js` | T1 | `CLASS_INSTRUCTION`, `FIELD`, `KIND`, `STATE`, `bumpRev`, `choiceRef`, `fieldClass`, `followUp`, `isChoiceToken`, `isDraft`, `isHandEdit`, `isOutstanding`, `isReplayable`, `isUnansweredReady`, `newItem`, `validateChoice`, `validateItem` | no |
| `test/unit/choice_press_hold.test.js` | T1 | `KIND`, `STATE`, `choiceRef`, `newItem` | no |
| `test/unit/codex_monitor.test.js` | T1 | `KIND`, `STATE`, `newItem` | no |
| `test/unit/comments_follow_move.test.js` | T1 | `KIND`, `STATE`, `newItem` | no |
| `test/unit/comments_surface.test.js` | T1 | `FIELD`, `KIND`, `STATE` | no |
| `test/unit/compact_draft_history.test.js` | T1 | `KIND`, `STATE`, `isDraft`, `newItem` | no |
| `test/unit/done_tab_replies.test.js` | T1 | `FIELD`, `KIND`, `PAGE_CHECK_STAMP_NOTE`, `STATE`, `TOOL_ROUND`, `displayState`, `isToolRound`, `newItem`, `randomId`, `threadOf`, `toolRoundOf` | no |
| `test/unit/draft_flush_cadence.test.js` | T1 | `KIND`, `STATE`, `buildRunAfter`, `newItem` | no |
| `test/unit/each_page_comments.test.js` | T1 | `KIND`, `STATE`, `newItem` | no |
| `test/unit/editing_surface.test.js` | T1 | `BREAK_ADDED_LINE`, `BREAK_ADDED_PARAGRAPH`, `FIELD`, `KIND`, `STATE`, `comparisonFields`, `editChangeText`, `newItem`, `revertOf` | no |
| `test/unit/end_review.test.js` | T1 | `FIELD`, `KIND`, `STATE`, `isDraft`, `newItem` | no |
| `test/unit/fix_round_f3_projection.test.js` | T1 | `REPLY_STATUS`, `STATE`, `USE_FIXES_CHANGE`, `applySuggestions`, `chronologicalThread`, `completedRound`, `followUp` | no |
| `test/unit/fix_round_f3_record.test.js` | T1 | `STATE`, `USE_FIXES_CHANGE`, `applySuggestions`, `completedRound`, `continueOnto`, `continueThread`, `hasRunFields`, `revertOf`, `validateRun` | **yes**: moved and rewritten (section 5, section 8) |
| `test/unit/fix_round_f3_service.test.js` | T1 | `NEW_BLOCKS_MAX`, `NEW_BLOCKS_MAX_BYTES` | no |
| `test/unit/fix_round_f3_sync.test.js` | T1 | `STATE`, `bumpRev` | no |
| `test/unit/flow_fix_g2.test.js` | T1 | `KIND`, `STATE`, `handedOverBlocks` | no |
| `test/unit/free_writing_f1_fixes.test.js` | T1 | `blocksBytes`, `buildRunAfter`, `bumpRev`, `recordBytes`, `runChangeText` | no |
| `test/unit/handled_check_run.test.js` | T1 | `STATE`, `revertOf` | no |
| `test/unit/harness_stub_vocabulary.test.js` | T1 | `FIELD`, `KIND`, `STATE` | no |
| `test/unit/held_release_clock.test.js` | T1 | `CLASS_DATA`, `FIELD`, `KIND`, `STATE`, `fieldClass`, `newItem` | no |
| `test/unit/helper_reads_only_the_tail.test.js` | T1 | `FIELD`, `KIND`, `STATE`, `isDraft`, `newItem` | no |
| `test/unit/hold_toggle.test.js` | T1 | `KIND`, `STATE`, `newItem` | no |
| `test/unit/holder_tie.test.js` | T1 | `KIND`, `STATE`, `newItem` | no |
| `test/unit/launch_folder.test.js` | T1 | `CLASS_DATA` | no |
| `test/unit/lean_agent_output.test.js` | T1 | `FIELD`, `KIND`, `STATE`, `newItem` | no |
| `test/unit/linked_docs_mappers.test.js` | T1 | `KIND`, `STATE`, `newItem` | no |
| `test/unit/log_run.test.js` | T1 | `FIELD`, `NEW_BLOCKS_MAX`, `NEW_BLOCKS_MAX_BYTES`, `RUN_HISTORY_KEEP`, `RUN_RECORD_MAX_BYTES`, `blocksBytes`, `buildRunAfter`, `bumpRev`, `recordBytes`, `validateRun` | no |
| `test/unit/mark_done.test.js` | T1 | `FIELD`, `KIND`, `STATE`, `bumpRev`, `isClosedByReviewer`, `isDraft`, `isOutstanding`, `isReplayable`, `isUnansweredReady`, `newItem` | no |
| `test/unit/menubar_summary.test.js` | T1 | `KIND`, `STATE`, `newItem`, `unseenReplyIds` | no |
| `test/unit/merge_run.test.js` | T1 | `bumpRev` | no |
| `test/unit/monitor_command.test.js` | T1 | `FIELD`, `KIND`, `STATE`, `newItem` | no |
| `test/unit/no_stale_excuse.test.js` | T1 | `FIELD`, `FILE_ORIGIN`, `KIND`, `STATE`, `newItem` | no |
| `test/unit/one_review_per_file.test.js` | T1 | `KIND`, `STATE`, `newItem` | no |
| `test/unit/outbox_coalescing.test.js` | T1 | `FIELD`, `KIND`, `STATE`, `isDraft`, `newItem` | no |
| `test/unit/oversized_records.test.js` | T1 | `FIELD`, `KIND`, `STATE`, `emptyContext`, `emptyRegion`, `newItem` | no |
| `test/unit/page_identity_forms.test.js` | T1 | `samePage` | **yes**: its two record cases move (section 5) |
| `test/unit/page_scope.test.js` | T1 | `FILE_ORIGIN`, `KIND`, `STATE`, `newItem`, `pageFrom`, `pageKey`, `pageKeyFor`, `samePage` | **yes**: its record cases move (section 5) |
| `test/unit/projection_incremental.test.js` | T1 | `FIELD`, `KIND`, `STATE`, `newItem` | no |
| `test/unit/projection_review_json.test.js` | T1 | `CLASS_DATA`, `FIELD`, `FILE_ORIGIN`, `KIND`, `STATE`, `buildRunAfter`, `bumpRev`, `isDraft`, `newItem` | no |
| `test/unit/quiet_tab_polling.test.js` | T1 | `KIND`, `STATE`, `newItem` | no |
| `test/unit/rail_run_cards.test.js` | T1 | `REPLY_STATUS`, `STATE` | no |
| `test/unit/rebuild_not_the_agents_job.test.js` | T1 | `FIELD`, `KIND`, `PAGE_CHECK_STAMP_NOTE`, `STATE`, `TOOL_ROUND`, `isRevert`, `isUnansweredReady`, `newItem`, `pageCheckReopenOf`, `revertOf`, `toolRoundOf` | no |
| `test/unit/record_lifecycle.test.js` | T1 | `ACCEPTED_PAGE_TEXTS_MAX`, `BREAK_ADDED_PARAGRAPH`, `CLASS_DATA`, `CLASS_INSTRUCTION`, `FIELD`, `FILE_ORIGIN`, `INTENT_FIELDS`, `KIND`, `KINDS`, `REPLY_STATUS`, `REPLY_STATUSES`, `REVERT_DELETE`, `REVERT_EDIT`, `REVERT_FORMAT`, `STATE`, `STATES`, `acceptPageText`, `acceptedPageTexts`, `bumpRev`, `changedSpan`, `chronologicalThread`, `comparisonFields`, `comparisonMode`, `editChangeText`, `fieldClass`, `followUp`, `formattingChangeText`, `isDraft`, `isOutstanding`, `isRevert`, `newItem`, `pageFrom`, `pageKey`, `paragraphAddition`, `priorAfters`, `randomId`, `reopenIssue`, `revertOf`, `takenBackIds`, `threadOf`, `validateItem` | **yes**: its record cases move (section 5); `takenBackIds` case rewritten |
| `test/unit/refused_not_replayed.test.js` | T1 | `FIELD`, `PAGE_CHECK_STAMP_NOTE`, `STATE`, `TOOL_ROUND`, `acceptedPageTexts`, `isOutstanding`, `isReplayable`, `pageCheckReopenOf`, `reopenIssue` | no |
| `test/unit/reopened_edit.test.js` | T1 | `STATE`, `isDraft`, `isOutstanding`, `runChangeText` | no |
| `test/unit/replay_pass.test.js` | T1 | `FIELD`, `STATE`, `acceptedPageTexts`, `bumpRev`, `priorAfters` | no |
| `test/unit/replay_run.test.js` | T1 | `KIND`, `STATE`, `buildRunAfter`, `bumpRev`, `priorAfters`, `revertOf`, `runChangeText` | no |
| `test/unit/reply_command.test.js` | T1 | `FIELD`, `FILE_ORIGIN`, `KIND`, `STATE`, `newItem` | no |
| `test/unit/reply_folding.test.js` | T1 | `FIELD`, `KIND`, `STATE`, `bumpRev`, `followUp`, `isDraft`, `newItem` | no |
| `test/unit/reply_seen.test.js` | T1 | `CLOSED_BY_REVIEWER`, `FIELD`, `KIND`, `REPLY_STAMP_MAX`, `STATE`, `TOOL_ROUND`, `isDraft`, `needsToSeeReply`, `newItem`, `randomId`, `replyStamp`, `stampPageCheckReopen`, `toolRoundOf`, `unseenReplyIds` | no |
| `test/unit/reply_toast.test.js` | T1 | `FIELD`, `KIND`, `STATE`, `newItem` | no |
| `test/unit/reverted_edit.test.js` | T1 | `FIELD`, `LEGACY_PAGE_CHECK_NOTE`, `PAGE_CHECK_STAMP_NOTE`, `STATE`, `TOOL_ROUND`, `bumpRev`, `collapsePageCheckNote`, `displayState`, `followUp`, `isReplayable`, `isToolRound`, `pageCheckReopenOf`, `revertOf`, `reviewerNote`, `sourceCanCarryStamp`, `threadOf`, `toolRoundOf` | no |
| `test/unit/review_binds_used_review.test.js` | T1 | `KIND`, `STATE`, `newItem` | no |
| `test/unit/review_command.test.js` | T1 | `FIELD`, `KIND`, `STATE`, `newItem` | no |
| `test/unit/review_follows_document.test.js` | T1 | `KIND`, `STATE`, `newItem` | no |
| `test/unit/review_format.test.js` | T1 | `CLASS_DATA`, `CLASS_INSTRUCTION`, `FIELD`, `FILE_ORIGIN`, `KIND`, `PAGE_CHECK_STAMP_NOTE`, `STATE`, `STATES`, `TOOL_ROUND`, `bumpRev`, `fieldClass`, `followUp`, `newItem`, `pageKey` | no |
| `test/unit/review_json_skip.test.js` | T1 | `FIELD`, `KIND`, `STATE`, `newItem` | no |
| `test/unit/review_retire.test.js` | T1 | `KIND`, `STATE`, `newItem` | no |
| `test/unit/reword_not_handled_floor.test.js` | T1 | `KIND`, `STATE`, `isDraft`, `newItem` | no |
| `test/unit/run_record.test.js` | T1 | `CLASS_DATA`, `LEGACY_PAGE_CHECK_NOTE`, `NEW_BLOCKS_MAX`, `NEW_BLOCKS_MAX_BYTES`, `PAGE_CHECK_NOTES`, `PAGE_CHECK_STAMP_NOTE`, `PLACEMENTS`, `REVERT_EDIT`, `RUN_HISTORY_KEEP`, `RUN_RECORD_MAX_BYTES`, `RUN_TAKEBACK_LINE`, `STATE`, `anchorView`, `applySuggestions`, `buildRunAfter`, `bumpRev`, `fieldClass`, `isRunRecord`, `recordBytes`, `revertOf`, `validateItem`, `validateRun` | **yes**: its record cases move (section 5) |
| `test/unit/run_refusal_real_route.test.js` | T1 | `NEW_BLOCKS_MAX`, `STATE`, `buildRunAfter` | no |
| `test/unit/session_list.test.js` | T1 | `FIELD`, `KIND`, `STATE`, `newItem` | no |
| `test/unit/session_names.test.js` | T1 | `FIELD`, `KIND`, `STATE`, `newItem` | no |
| `test/unit/sites_cli.test.js` | T1 | `FIELD`, `KIND`, `STATE`, `newItem` | no |
| `test/unit/sites_mappers.test.js` | T1 | `FIELD`, `KIND`, `STATE`, `newItem`, `pageFrom`, `samePage` | no |
| `test/unit/status_command.test.js` | T1 | `FIELD`, `FILE_ORIGIN`, `KIND`, `STATE`, `isDraft`, `isUnansweredReady`, `newItem` | no |
| `test/unit/storage_quota_typing.test.js` | T1 | `KIND`, `STATE`, `newItem`, `validateItem` | no |
| `test/unit/store_item_cache.test.js` | T1 | `KIND`, `PAGE_CHECK_NOTES`, `STATE`, `newItem` | no |
| `test/unit/store_per_item.test.js` | T1 | `KIND`, `STATE`, `newItem` | no |
| `test/unit/style_switch.test.js` | T1 | `KIND`, `STATE`, `newItem` | no |
| `test/unit/summary_routes.test.js` | T1 | `KIND`, `STATE`, `newItem` | no |
| `test/unit/sync_client.test.js` | T1 | `KIND`, `STATE`, `newItem` | no |
| `test/unit/tab_edits_rows.test.js` | T1 | `FIELD`, `isHandEdit` | no |
| `test/unit/unanswered_prominence.test.js` | T1 | `FIELD`, `KIND`, `REPLY_STATUS`, `STATE`, `newItem` | no |
| `test/unit/withdraw_from_ready_flush.test.js` | T1 | `KIND`, `STATE`, `newItem` | no |

#### test/browser and test/fixtures

| Caller | Owner slice | Uses | Breaks? |
| --- | --- | --- | --- |
| `test/browser/active_filter.spec.js` | T2 | `randomId` | no |
| `test/browser/agent_replies.spec.js` | T2 | `applySuggestions` | no |
| `test/browser/comments_follow_move.spec.js` | T2 | `STATE` | no |
| `test/browser/comments_highlights.spec.js` | T2 | `pageFrom` | no |
| `test/browser/each_page_comments.spec.js` | T2 | `KIND`, `STATE`, `newItem` | no |
| `test/browser/edits_tab.spec.js` | T2 | `randomId` | no |
| `test/browser/element_subject.spec.js` | T2 | `pageFrom` | no |
| `test/browser/end_review.spec.js` | T2 | `newItem` | no |
| `test/browser/free_writing_host.spec.js` | T2 | `newItem` | no |
| `test/browser/free_writing_types.spec.js` | T2 | `NEW_BLOCKS_MAX_BYTES`, `validateRun` | no |
| `test/browser/heading_context.spec.js` | T2 | `pageFrom` | no |
| `test/browser/oversized_records.spec.js` | T2 | `FIELD`, `KIND`, `STATE`, `emptyContext`, `emptyRegion`, `newItem`, `pageFrom` | no |
| `test/browser/paragraph_break.spec.js` | T2 | `BREAK_ADDED_LINE` | no |
| `test/browser/print.spec.js` | T2 | `pageFrom` | no |
| `test/browser/replay_old_records.spec.js` | T2 | `hasRunFields` | no |
| `test/browser/replay_run_check.spec.js` | T2 | `STATE` | no |
| `test/browser/replay_run_fix_round.spec.js` | T2 | `KIND`, `STATE`, `buildRunAfter`, `bumpRev`, `revertOf`, `runChangeText` | no |
| `test/browser/replay_run_insert.spec.js` | T2 | `STATE`, `buildRunAfter`, `bumpRev`, `revertOf` | no |
| `test/browser/review_follows_document.spec.js` | T2 | `STATE` | no |
| `test/browser/selection_pill_drag.spec.js` | T2 | `pageFrom` | no |
| `test/browser/selection_popover.spec.js` | T2 | `pageFrom` | no |
| `test/browser/stable_addresses_mappers.spec.js` | T2 | `FIELD`, `KIND`, `STATE`, `newItem` | no |
| `test/fixtures/assets/cp2-mid-boot.js` | T2 | `FIELD`, `REPLY_STATUS`, `STATE`, `pageFrom` | no |
| `test/fixtures/assets/editing-boot.js` | T2 | `pageFrom` | no |
| `test/fixtures/assets/rail-harness.js` | T2 | `KIND`, `pageFrom` | no |
| `test/fixtures/assets/replay-boot.js` | T2 | `FIELD`, `bumpRev` | no |
| `test/fixtures/catalog_state_build.js` | T2 | `FIELD`, `KIND`, `STATE`, `newItem` | no |
| `test/fixtures/menubar/state.js` | T2 | `KIND`, `STATE`, `newItem`, `replyStamp` | no |

## 4. Module design

### Rules every module follows

- **Erasable syntax, named exports.** No `enum`, no `namespace`, no parameter properties, no default export, no top-level `await`, no `as` other than `as const`, no `!`, no `any`. Each file opens with only its `read-when` header (drafted in section 9).
- **Tables are `as const`, with the union derived from the table** (`(typeof KIND)[keyof typeof KIND]`) and a guard beside it taking `unknown`, so no caller checks membership with `indexOf` or `hasOwnProperty`. Under `isolatedDeclarations`, a constant computed from another (`KINDS`, `STATES`, `SUGGESTIONS_MAX`) states its type.
- **`contract/` imports only `contract/`.** C1's `failures.ts` (for `FailureCode`), C4's `replies.ts`, `json-object.ts` and `flush.ts`, and the C3 contract modules. **`domain/` imports `contract/` and its siblings**, including C2's normalizer modules.
- **Parsers of untrusted data take `unknown` and never throw:** `validateRun` and `validateChoice` are called by the helper on an event's record from the network and on lines folded from the log. They narrow with C4's `isJsonObject`, `typeof`, `Array.isArray` and `Object.hasOwn`, and return a typed refusal or `null`. They keep the old "null or refusal" shape because the server and the layer read `refusal.code` and `refusal.reason`.
- **Inputs.** The domain functions take the record types below. Where the old function guarded against a missing record (`if (!item) return ...`), the parameter stays `Item | null | undefined` and the answer for `null` stays the same, because still-JavaScript callers pass `null` today; no new `null` handling is added anywhere else (D10). Where a check must stay for those callers but the parameter is typed (the kind check in `newItem`, the object checks in `samePage` and `pageKey`), it is written through a guard that takes `unknown` (`isKind`, `isJsonObject`), so typed callers cannot reach the refusal and the lint's unnecessary-condition rule does not fire.
- **Records are plain objects, not deeply readonly.** The layer and the server assign fields on records they own, so the top-level fields of `Item` are writable. Every function that returns a new revision (`bumpRev`, `continueThread`, `continueOnto`, `revertOf`, `applySuggestions`, `anchorView`, `collapsePageCheckNote`) leaves its input untouched. Two functions write to the record they are given, as the old ones did, and say so in their names' doc section: `acceptPageText` and `stampPageCheckReopen` replace `item.region` with a new object. Their callers in `replay.js` and `tab_done.js` depend on that.

### Imports between modules

`run-limits`, `utf8` and `mint` import nothing. `record` imports `replies` (C4, for the reply statuses it re-exports) and, for types only, `choice`. `field-class` imports `record` for types only. `choice` imports `record`, `json-object` and C1's `failures` (type only). `item-check` imports `record`, `choice` and `json-object`. C4's `replies` imports `run-limits`; C4's `flush` imports `utf8`.

In `domain/`: `page-identity` imports `record`; `stamp-source` imports `record` (types); `item-revisions` imports `record`, `run-limits`, `mint` and C2's `comparison`; `tool-round` imports `record`; `item-status` imports `record` and `tool-round`; `thread` imports `record`, `item-revisions` and `tool-round`; `reply-unread` imports `record`, `tool-round` and `item-status`; `page-check` imports `record`, `mint`, `thread`, `reply-unread` and `json-object`; `accepted-page-texts` imports `record`; `subject` imports `record` and C2's `html-syntax`; `change-text` imports `record`, C2's `comparison` and `formatting`; `run-record` imports `record`, `utf8` and C2's `block-text`, `text`, `comparison` and `run-blocks`; `revert` imports `record`, `item-revisions`, `run-record` and C2's `run-blocks`; `run-check` imports `record`, `run-limits`, `utf8`, `json-object`, `run-record`, C2's `run-blocks` and `clean-markup`; `proofread` imports `record`, `item-revisions`, `run-record` and C2's `run-blocks`; `choice-state` imports `record` and `choice`. There are no cycles. `run-limits` is its own module for that reason: `record` imports `replies` at run time, so the ceilings cannot live in `record` without `replies` importing it back.

### `src/contract/record.ts`

```ts
export { REPLY_STATUS, REPLY_STATUSES } from "./replies.ts";
export type { ReplyStatus } from "./replies.ts";

export const FIELD: {
  readonly ID: "id"; readonly REV: "rev"; readonly KIND: "kind"; readonly STATE: "state";
  readonly NOTE: "note"; readonly CHANGE: "change";
  readonly BEFORE: "before"; readonly AFTER: "after"; readonly BEFORE_HTML: "before_html"; readonly AFTER_HTML: "after_html";
  readonly AFTER_HISTORY: "after_history"; readonly REGION: "region"; readonly CONTEXT: "context";
  readonly PAGE_ORIGIN: "page_origin"; readonly PAGE_PATH: "page_path"; readonly PAGE_TITLE: "page_title";
  readonly PAGE_SEQ: "page_seq"; readonly SOURCE_HINT: "source_hint"; readonly REVERTS: "reverts"; readonly REPLY: "reply";
  readonly HANDLED_NOT_ON_PAGE: "handled_not_on_page"; readonly CLOSED_BY: "closed_by"; readonly CLOSED_AT: "closed_at";
  readonly RECEIVED_AT: "received_at"; readonly REPLY_SEEN: "reply_seen"; readonly THREAD: "thread";
  readonly NEW_BLOCKS: "new_blocks"; readonly ANCHOR_AFTER_HTML: "anchor_after_html"; readonly ANCHOR_TAG_AFTER: "anchor_tag_after";
  readonly PLACEMENT: "placement"; readonly REMOVE_BLOCKS: "remove_blocks"; readonly CHOICE: "choice";
  readonly CREATED_AT: "created_at"; readonly UPDATED_AT: "updated_at";
};
export type FieldName = (typeof FIELD)[keyof typeof FIELD];

export const KIND: { readonly COMMENT: "comment"; readonly EDIT: "edit"; readonly DELETE: "delete"; readonly FORMAT_ONLY: "format_only"; readonly NOTE: "note"; readonly CHOICE: "choice" };
export type Kind = (typeof KIND)[keyof typeof KIND];
export const KINDS: readonly Kind[];
export function isKind(value: unknown): value is Kind;

export const STATE: { readonly DRAFT: "draft"; readonly READY: "ready"; readonly HANDLED: "handled"; readonly NOT_HANDLED: "not_handled" };
export type ItemState = (typeof STATE)[keyof typeof STATE];
export const STATES: readonly ItemState[];
export function isItemState(value: unknown): value is ItemState;

export const FILE_ORIGIN = "file";
export const CLOSED_BY_REVIEWER = "reviewer";
export const SUBJECT_SRC_REF = "lahe:subject.src";
export const REPLY_STAMP_MAX = 64;

export const TOOL_ROUND: { readonly PAGE_CHECK_STAMP: "page_check_stamp" };
export type ToolRoundName = (typeof TOOL_ROUND)[keyof typeof TOOL_ROUND];
export function isToolRoundName(value: unknown): value is ToolRoundName;

export const PLACEMENT: { readonly AFTER_ANCHOR: "after_anchor"; readonly START_OF_CONTAINER: "start_of_container" };
export type Placement = (typeof PLACEMENT)[keyof typeof PLACEMENT];
export const PLACEMENTS: readonly [typeof PLACEMENT.AFTER_ANCHOR, typeof PLACEMENT.START_OF_CONTAINER];
export function isPlacement(value: unknown): value is Placement;

export const RUN_FIELDS: readonly ["new_blocks", "anchor_after_html", "anchor_tag_after", "placement", "remove_blocks"];
export type RunField = (typeof RUN_FIELDS)[number];

export interface RunBlock { readonly tag: string; readonly html: string; readonly from_anchor?: boolean }

export interface RegionRef {
  readonly stamp?: string | null;
  readonly fingerprint?: { readonly tag?: string | null } | null;
  readonly kind?: string;
  readonly group?: string;
}
export interface LostAnchor { readonly code: string; readonly reason: string; readonly at: string }
export interface CheckReopen { readonly rev: number; readonly at: string; readonly stamp: string | null; readonly tool: ToolRoundName | null }
export interface Region {
  readonly ref: RegionRef | null;
  readonly label: string | null;
  readonly lost: LostAnchor | null;
  readonly accepted_page_texts: readonly string[];
  readonly check_reopen: CheckReopen | null;
}

export interface Subject {
  readonly tag?: string | null; readonly src?: string | null; readonly alt?: string | null;
  readonly html?: string | null; readonly near?: string | null;
}
export interface SlideContext {
  readonly index: number | null; readonly total: number | null; readonly uncounted: boolean;
  readonly id: string | null; readonly heading: string | null; readonly text: string | null;
}
export interface Context {
  readonly quote: string | null; readonly prefix: string | null; readonly suffix: string | null;
  readonly heading: string | null; readonly element: string | null; readonly subject: Subject | null;
  readonly slide?: SlideContext | null;
}

export type SourceHint = string | { readonly path?: string | null; readonly known?: boolean };

export interface HistoryEntry {
  readonly rev: number; readonly after: string | null; readonly after_html: string | null; readonly at: string;
  readonly new_blocks?: readonly RunBlock[]; readonly anchor_after_html?: string | null;
  readonly anchor_tag_after?: string | null; readonly placement?: Placement;
}

export interface ArchivedReply {
  readonly status: ReplyStatus | null; readonly agent: string | null; readonly reason: string | null;
  readonly text: string | null; readonly files: readonly unknown[]; readonly at: string | null;
  readonly proofread?: true; readonly suggestions?: readonly Suggestion[]; readonly previous?: readonly ArchivedReply[];
}
export interface FoldedReply {
  readonly status: ReplyStatus; readonly agent: string | null; readonly reason: string | null;
  readonly text: string | null; readonly files: readonly unknown[]; readonly at: string | null;
  readonly user_needs_to_see_reply?: boolean;
  readonly proofread?: true; readonly suggestions?: readonly Suggestion[]; readonly previous?: readonly ArchivedReply[];
}
export interface ThreadRound {
  readonly rev: number;
  readonly reviewer: { readonly note: string | null; readonly change: string | null; readonly at: string | null };
  readonly agent: ArchivedReply;
  readonly tool?: ToolRoundName;
}

export interface Item {
  id: string; rev: number; kind: Kind; state: ItemState;
  note: string | null; change: string | null;
  before: string | null; after: string | null; before_html: string | null; after_html: string | null;
  after_history: HistoryEntry[];
  region: Region; context: Context;
  page_origin: string; page_path: string; page_title: string | null; page_seq: number | null; source_hint: SourceHint | null;
  reverts: string | null; reply: FoldedReply | null; handled_not_on_page: boolean; thread: ThreadRound[];
  created_at: string; updated_at: string;
  closed_by?: typeof CLOSED_BY_REVIEWER; closed_at?: string; received_at?: string | null; reply_seen?: string;
  new_blocks?: RunBlock[]; anchor_after_html?: string | null; anchor_tag_after?: string | null;
  placement?: Placement; remove_blocks?: RunBlock[];
  choice?: ChoicePress;
}

export function emptyRegion(): Region;
export function emptyContext(): Context;
export function emptySlideContext(): SlideContext;

export function isHandEdit(item: Pick<Item, "kind"> | null | undefined): boolean;
export function isChoice(item: Pick<Item, "kind"> | null | undefined): boolean;
export function isRevert(item: Pick<Item, "reverts"> | null | undefined): boolean;
export function isRunRecord(item: Pick<Item, "new_blocks"> | null | undefined): boolean;
export function hasRunFields(item: object | null | undefined): boolean;
```

`Suggestion` is C4's (`replies.ts`); `ChoicePress` is `choice.ts`'s (type-only import, so no runtime cycle).

- **The record is one interface, not a union per kind.** A union (`ChoiceItem | ContentItem`) was weighed: it would make "a choice only on a choice record" a type. But `newItem` builds a choice record without a `choice` today, and the helper's door (`validateChoice`) is what refuses it; making the union honest would mean `newItem` refusing input it accepts now, which the plan sends back to Ken. The rule stays a parser (B24), and the folder doc says so. The unions the slice does add are the vocabularies: `Kind`, `ItemState`, `Placement`, `ToolRoundName`, `ChoiceState`, the refusal codes, `ComparisonFields`, `AnchorTypeName`, and `ParagraphAddition`'s `where`.
- **`RegionRef` names only what the record reads.** The anchor engine (B3) owns the reference and adds its own fields; any of its refs fits this interface structurally. `Subject` is the same: the anchor engine writes it, the record reads `html` and `src`.
- **`HAND_EDIT_KINDS`** (edit, delete, format_only) is a private `as const` tuple behind `isHandEdit`.
- `hasRunFields` takes `object`, because `validateChoice` and `validateRun` ask it of untrusted objects as well as of records.
- `REPLY_STATUS` and `REPLY_STATUSES` are re-exported, not redefined (B4). New `.ts` code imports them from `replies.ts`; the re-export exists so `record.REPLY_STATUS` keeps working for the still-JavaScript callers in six source files, five unit tests and one browser fixture, and F1 removes it when it rewrites those reads.

### `src/contract/field-class.ts`

```ts
export const CLASS_INSTRUCTION = "instruction";
export const CLASS_DATA = "data";
export type FieldClass = typeof CLASS_INSTRUCTION | typeof CLASS_DATA;

export const INTENT_FIELDS: readonly ["note", "change"];
export type IntentField = (typeof INTENT_FIELDS)[number];
export const INSTRUCTION_PATHS: readonly ["note", "change", "choice.group", "choice.answer"];
export type InstructionPath = (typeof INSTRUCTION_PATHS)[number];

export const FIELD_CLASS: { readonly [Field in FieldName]: Field extends IntentField ? typeof CLASS_INSTRUCTION : typeof CLASS_DATA };
export function fieldClass(path: string): FieldClass;
```

- **D12 is explicit in the types, three ways.** `INTENT_FIELDS` is the whole intent channel in one tuple. `FIELD_CLASS` is a mapped type over every field name whose value type is computed from `IntentField`, so its object literal must classify every field, a new field in `FIELD` fails to compile until someone classifies it, and an intent value on any field but `note` or `change` fails to compile too. `fieldClass` answers instruction only for the four `INSTRUCTION_PATHS` and data for every other string, so an unknown path fails safe.
- A brand for the reviewer's own words (`IntentText` on `note` and `change`) was weighed and left out: every record read from storage, the log or the network is plain JSON, so a brand would need minting at every read, in the server and browser slices that do not exist yet, and the laundering it guards against happens in the projection (`review_format`), which classifies with `fieldClass`. Record it in the folder doc as a follow-up for the review-format slice.

### `src/contract/run-limits.ts`

```ts
export const NEW_BLOCKS_MAX = 400;
export const NEW_BLOCKS_MAX_BYTES = 200000;
export const RUN_RECORD_MAX_BYTES = 4194304;
export const RUN_HISTORY_KEEP = 3;
```

And in C4's `replies.ts`, replacing the two restated literals:

```ts
import { NEW_BLOCKS_MAX, NEW_BLOCKS_MAX_BYTES } from "./run-limits.ts";
export const SUGGESTIONS_MAX: typeof NEW_BLOCKS_MAX = NEW_BLOCKS_MAX;
export const SUGGESTION_TEXT_MAX: typeof NEW_BLOCKS_MAX_BYTES = NEW_BLOCKS_MAX_BYTES;
```

This is the one source C4 asked for. The names stay distinct because they say different things (a fix count, a fix's length); the values cannot drift. `fix_round_f3_service.test.js`'s "the suggestion bounds restate the run ceilings" keeps passing and now cannot fail; it stays, since it is not C3's file.

### `src/contract/utf8.ts`

```ts
export function utf8ByteLength(text: string): number;
```

Counts by code point: 1 byte below U+0080, 2 below U+0800, 3 below U+10000 (a lone surrogate included, as `TextEncoder` writes it as U+FFFD), 4 above. C4's `flush.ts` keeps its private counter today; C3 replaces it with this import so the two byte rules are one.

### `src/contract/choice.ts`

```ts
declare const choiceTokenBrand: unique symbol;
export type ChoiceToken = string & { readonly [choiceTokenBrand]: true };
export const CHOICE_TOKEN: RegExp;
export const CHOICE_TOKEN_RULE = "1 to 64 letters, digits, hyphens, underscores, dots or colons";
export function isChoiceToken(value: unknown): value is ChoiceToken;

export interface ChoicePress { readonly group: ChoiceToken; readonly answer: ChoiceToken }

export const CHOICE_MARKUP: {
  readonly GROUP_CLASS: "choice"; readonly NAME_ATTR: "data-choice"; readonly QUESTION_CLASS: "choice-q";
  readonly CHOSEN_ATTR: "data-chosen"; readonly RECOMMENDED_ATTR: "data-recommended";
  readonly PRESSED_ATTR: "data-lahe-pressed"; readonly STATE_ATTR: "data-lahe-choice-state"; readonly INERT_ATTR: "data-lahe-inert";
};
export const CHOICE_STATE: { readonly KEPT: "kept"; readonly OPEN: "open"; readonly QUESTION: "question"; readonly NOT_HANDLED: "not_handled"; readonly DONE: "done" };
export type ChoiceState = (typeof CHOICE_STATE)[keyof typeof CHOICE_STATE];

export interface ChoiceRef { readonly kind: typeof KIND.CHOICE; readonly group: string }
export function choiceRef(group: string): ChoiceRef;

export interface ChoiceRefusal { readonly code: Extract<FailureCode, "CHOICE_REFUSED">; readonly reason: string }
export function validateChoice(value: unknown): ChoiceRefusal | null;
```

- **`ChoiceToken` is branded** because a group name and an answer land inside a quoted attribute selector and inside the intent channel; the grammar is what keeps prose and quotes out. Only `isChoiceToken` mints it. `choiceRef` takes a plain string because its callers carry a name they already checked, or one read back from a record; the reference is data, not a selector.
- The refusal code is `Extract<FailureCode, ...>`, so it stops compiling if C1's table loses the code. `CHOICE_CODE` goes (D1).

### `src/contract/item-check.ts`

```ts
export function validateItem(value: unknown): asserts value is Item;
```

- An assertion function: it checks what B26 to B30 list and throws, and once it returns the compiler treats the value as a record. It does not check every field of `Item` (a note's type, a region's shape): those are trusted because only `newItem`, `bumpRev` and the functions here build records, and the stricter check would refuse records the layer stores today. The folder doc says so.
- It returns nothing (D8). No caller reads its return value.

### `src/domain/mint.ts`

```ts
export function randomId(prefix?: string): string;
export function nowIso(): string;
```

`randomId` reads `globalThis.crypto` through a private type predicate whose body checks for a `getRandomValues` function, since `domain` has no DOM or Node types. No fallback (D7).

### `src/domain/page-identity.ts`

```ts
export interface PageLocation {
  readonly origin?: string | null; readonly pathname?: string | null;
  readonly href?: string | null; readonly title?: unknown;
}
export interface PageOptions {
  readonly seq?: unknown; readonly source_hint?: SourceHint | null;
  readonly aliases?: unknown; readonly path_aliases?: unknown; readonly spellings?: unknown;
}
export interface PageView {
  readonly origin: string; readonly path: string | null; readonly title: string | null; readonly seq: number | null;
  readonly source_hint: SourceHint | null; readonly aliases: readonly string[];
  readonly path_aliases: readonly string[]; readonly spellings: readonly string[];
}
export interface PageAddress { readonly origin: string | null; readonly path: string | null }
export interface PageTarget extends PageAddress {
  readonly aliases?: readonly string[]; readonly path_aliases?: readonly string[]; readonly spellings?: readonly string[];
}
export type ItemAddress = Pick<Item, "page_origin" | "page_path">;

export function pageFrom(location: PageLocation | null | undefined, options?: PageOptions): PageView;
export function pageKey(item: ItemAddress): string;
export function pageKeyFor(page: PageAddress): string;
export function identityOrigin(origin: string | null): string;
export function pageIdentityKey(item: ItemAddress): string;
export function pageIdentityKeyFor(page: PageAddress): string;
export function samePage(item: ItemAddress, page: PageTarget): boolean;
export function shortPath(path: string | null | undefined): string;
```

`pageFrom` is a boundary for its options: they come from the script tag the helper wrote, read by the layer, so the lists are `unknown` and filtered (B35). The location is whatever object the caller hands over (`window.location`, a parsed URL, a test's literal). The segment reader that turns a path into its tail, with the index-document rule, is private.

### `src/domain/stamp-source.ts`

```ts
export const STAMP_SOURCE_EXTENSIONS: readonly ["html", "htm", "xhtml", "svg", "vue", "svelte", "astro", "jsx", "tsx", "erb", "ejs", "njk", "hbs", "liquid", "php", "mustache", "twig", "jinja", "j2"];
export type StampSourceExtension = (typeof STAMP_SOURCE_EXTENSIONS)[number];
export interface StampPage { readonly path?: string | null; readonly source_hint?: SourceHint | null }
export function sourceCanCarryStamp(path: string | null | undefined): boolean;
export function pageCanCarryStamp(page: StampPage | null | undefined): boolean;
```

### `src/domain/item-revisions.ts`

```ts
export interface NewItemInput {
  readonly kind: Kind;
  readonly id?: string; readonly rev?: number; readonly state?: ItemState;
  readonly note?: string | null; readonly change?: string | null;
  readonly before?: string | null; readonly after?: string | null;
  readonly before_html?: string | null; readonly after_html?: string | null;
  readonly after_history?: readonly HistoryEntry[];
  readonly region?: Region | null; readonly context?: Context | null;
  readonly page?: Partial<Pick<PageView, "origin" | "path" | "title" | "seq" | "source_hint">>;
  readonly page_origin?: string; readonly page_path?: string; readonly page_title?: string | null;
  readonly page_seq?: number | null; readonly source_hint?: SourceHint | null;
  readonly reverts?: string | null; readonly reply?: FoldedReply | null;
  readonly handled_not_on_page?: boolean; readonly thread?: readonly ThreadRound[];
  readonly created_at?: string; readonly updated_at?: string;
  readonly new_blocks?: readonly RunBlock[]; readonly anchor_after_html?: string | null;
  readonly anchor_tag_after?: string | null; readonly placement?: Placement; readonly remove_blocks?: readonly RunBlock[];
  readonly choice?: ChoicePress;
}
export function newItem(input: NewItemInput): Item;

export function historyEntry(item: Item, at: string): HistoryEntry;

export type ItemChanges = Partial<Omit<Item, "rev" | "updated_at">>;
export function bumpRev(item: Item, changes?: ItemChanges): Item;

export type ComparedField = typeof FIELD.AFTER | typeof FIELD.AFTER_HTML;
export function priorAfters(item: Item, field?: ComparedField): readonly string[];

export type ComparisonFields =
  | { readonly before: typeof FIELD.BEFORE; readonly after: typeof FIELD.AFTER }
  | { readonly before: typeof FIELD.BEFORE_HTML; readonly after: typeof FIELD.AFTER_HTML };
export function comparisonFields(item: Pick<Item, "kind">): ComparisonFields;
export function comparisonMode(item: Pick<Item, "kind">): ComparisonMode;
```

- `historyEntry` takes the record whose entry it is, and the time (D3). All three old call sites passed one record's own `rev`, `after`, `after_html` and run fields as five separate arguments, two of them strings that could be swapped without an error.
- Trimming a run record's history is private to `bumpRev` (`trimRunHistory` goes, D1).
- `ComparisonFields` is a union, so `priorAfters(item, comparisonFields(item).after)` type-checks and a caller cannot pair `before` with `after_html`.
- `comparisonMode` passes the kind to C2's `modeFor`, which takes a string; narrowing `modeFor` to `Kind` is C2's to decide and not needed here.

### `src/domain/item-status.ts`

```ts
export function isDraft(item: Pick<Item, "state">): boolean;
export function isReady(item: Pick<Item, "state">): boolean;
export function isOutstanding(item: Pick<Item, "state">): boolean;
export function isUnansweredReady(item: Item | null | undefined): boolean;
export function isReplayable(item: Item | null | undefined): boolean;
export function isClosedByReviewer(item: Pick<Item, "state" | "closed_by"> | null | undefined): boolean;
```

### `src/domain/tool-round.ts`

```ts
export function pageCheckReopen(item: Pick<Item, "region"> | null | undefined): CheckReopen | null;
export function toolRoundOf(item: Item | null | undefined): ToolRoundName | null;
export function isToolRound(round: Pick<ThreadRound, "tool"> | null | undefined): boolean;
export function answeredPageCheckReopen(item: Item | null | undefined): boolean;
export function displayState(item: Item | null | undefined): ItemState | null;
```

### `src/domain/thread.ts`

```ts
export function threadOf(item: { readonly thread?: readonly ThreadRound[] | undefined } | null | undefined): readonly ThreadRound[];
export function chronologicalThread(item: { readonly thread?: readonly ThreadRound[] | undefined } | null | undefined): ThreadRound[];
export function retainReplies(item: Pick<Item, "reply">, reply: FoldedReply): FoldedReply;
export function completedRound(item: Item): ThreadRound;
export interface NextTurn { readonly note?: string | null; readonly change?: string | null }
export function continueThread(item: Item, nextTurn?: NextTurn): Item;
export function continueOnto(item: Item, base: Item, nextTurn?: NextTurn): Item;
export function followUp(item: Item, text: string): Item;
export function reopenIssue(item: Item): Item;
```

The reply archiver (`copyReply`) is private; `completedRound` and `retainReplies` are its two users.

### `src/domain/page-check.ts`

```ts
export const PAGE_CHECK_STAMP_NOTE: "Reopened by the page check: ...";
export const LEGACY_PAGE_CHECK_NOTE: "Reopened by the page check: ...";
export const PAGE_CHECK_NOTES: readonly [typeof PAGE_CHECK_STAMP_NOTE, typeof LEGACY_PAGE_CHECK_NOTE];
export function appendNoteOnce(carried: string | null | undefined, sentence: string): string | null;
export function stampPageCheckReopen(item: Item | null | undefined, stamp: string | null, at?: string | null, tool?: ToolRoundName | null): CheckReopen | null;
export function pageCheckReopenOf(item: Item, note: string, at?: string | null, tool?: ToolRoundName | null): Item;
export function collapsePageCheckNote<T>(value: T): T;
export function reviewerNote(item: Pick<Item, "note"> | null | undefined): string | null;
```

- The two sentences are literal-typed constants (the `...` above stands for B78's full text).
- `collapsePageCheckNote` is generic because the store calls it on raw values read back from browser storage, which may be anything; it narrows with `isJsonObject` and returns either the value itself or `{ ...value, note }`, which is a `T` without a cast.
- `stampPageCheckReopen` keeps its runtime check on `tool` (through `isToolRoundName`), because `tab_done.js` passes `opts.tool || null` from its own callers.

### `src/domain/reply-unread.ts`

```ts
export function replyStamp(item: Pick<Item, "reply" | "rev"> | null | undefined): string | null;
export function hasWords(value: unknown): value is string;
export function needsToSeeReply(reply: FoldedReply | null | undefined): boolean;
export function isUnreadReply(item: Item | null | undefined, mark?: string): boolean;
export type ReadMarks = Readonly<Partial<Record<string, string>>>;
export function unseenReplyIds(items: readonly Item[] | null | undefined, marks?: ReadMarks | null): string[];
```

### `src/domain/accepted-page-texts.ts`

```ts
export const ACCEPTED_PAGE_TEXTS_MAX = 8;
export function acceptedPageTexts(item: Pick<Item, "region"> | null | undefined): readonly string[];
export function acceptPageText(item: Item | null | undefined, text: string): readonly string[];
```

### `src/domain/subject.ts`

```ts
export function paintQuoteOf(item: Pick<Item, "context"> | null | undefined): string | null;
export function subjectHtmlOf(subject: Subject | null | undefined): string | null;
```

### `src/domain/change-text.ts`

```ts
export interface ChangedSpan { readonly removed: string; readonly added: string }
export function changedSpan(before: string | null | undefined, after: string | null | undefined): ChangedSpan;
export interface ParagraphAddition { readonly where: "before" | "after"; readonly text: string }
export function paragraphAddition(before: string | null | undefined, after: string | null | undefined): ParagraphAddition | null;
export function formattingChangeText(beforeHtml: string | null | undefined, afterHtml: string | null | undefined): string;
export const BREAK_ADDED_PARAGRAPH = "Added a paragraph break: this block becomes two paragraphs.";
export const BREAK_ADDED_LINE = "Added a line break.";
export const BREAK_REMOVED = "Removed a break, joining the lines into one.";
export function editChangeText(kind: Kind, before: string | null | undefined, after: string | null | undefined, beforeHtml?: string | null, afterHtml?: string | null): string;
```

- `editChangeText` keeps its five positional parameters: `editing.js` calls it with three and with five, and `editing_surface.test.js` (not C3's) calls it the same way.
- Run counting keys runs by tag and then by text in nested maps, so no separator character is needed (the old key joined them with a literal U+0000, which is what section 8's source test was about).
- The tables that turn a structural tag into a word (strong to bold, em to italic, and the two resets) are private `as const` objects keyed by C2's `StructuralTag`, so a missing tag fails to compile.

### `src/domain/revert.ts`

```ts
export const REVERT_EDIT: "Undo: the reviewer took this change back. ...";
export const REVERT_DELETE: "Undo: the reviewer put this block back. ...";
export const REVERT_FORMAT: "Undo: the reviewer took this formatting change back. ...";
export const RUN_TAKEBACK_LINE: "Remove the blocks in remove_blocks from after this {type}; the reviewer undid them.";
export const RUN_TAKEBACK_TAG_LINE: "Change this {type} back to {tag}, the tag in anchor_tag_after; the reviewer undid the type change.";
export interface RevertPlacement { readonly region?: Region | null; readonly context?: Context | null; readonly created_at?: string }
export function revertOf(item: Item, extra?: RevertPlacement): Item;
export function takenBackIds(items: readonly Item[] | null | undefined): ReadonlySet<string>;
```

The sentence for a kind (`revertChangeText`) is a private lookup keyed by `Kind` (D1).

### `src/domain/run-record.ts`

```ts
export interface RunAfter { readonly after_html: string; readonly after: string }
export function buildRunAfter(anchorHtml: string | null | undefined, blocks: readonly RunBlock[] | null | undefined): RunAfter;
export function anchorView(item: Item): Item;
export function anchorTagOf(item: Item | null | undefined): string | null;
export type AnchorTypeName = "paragraph" | "heading" | "list" | "block";
export function anchorTypeName(item: Item | null | undefined): AnchorTypeName;
export function recordBytes(record: object): number;
export function blocksBytes(blocks: readonly unknown[] | null | undefined): number;
export interface HandedBlock { readonly id: string; readonly tag: string | null; readonly html: string | null }
export interface HandedOver { readonly [index: number]: HandedBlock | undefined; readonly anchor?: HandedBlock }
export function handedOverBlocks(item: Item, items: readonly Item[] | null | undefined): HandedOver;
export function runChangeText(item: Item): string;
```

- `HandedOver` keeps the old shape, an index-keyed object plus `anchor`, because `replay.js` reads `handed[index]` and `handed.anchor`; the type now says what the keys are.
- `blocksBytes` takes `unknown[]` because `validateRun` sizes the run before it knows the blocks are objects (B113 runs before B114).

### `src/domain/run-check.ts`

```ts
export type RunRefusalCode = Extract<FailureCode, "RUN_BLOCK_REFUSED" | "RUN_OVER_CEILING" | "RUN_PLACEMENT_REFUSED" | "RUN_TAKEBACK_CARRIES_RUN">;
export interface RunRefusal { readonly code: RunRefusalCode; readonly reason: string }
export function validateRun(value: unknown): RunRefusal | null;
```

The boundary parser of this slice: the helper calls it on an event's record at the door (`log.js`) and on every record it folds from the log (`projection.js`). The sitting and take-back checks are private steps of it. `RUN_CODE` goes (D1).

### `src/domain/proofread.ts`

```ts
export const USE_FIXES_CHANGE: "The reviewer took your proofreading fixes, {n} in all. ...";
export interface SuggestionRefusal { readonly code: Extract<FailureCode, "SUGGESTION_NOT_FOUND">; readonly reason: string }
export function applySuggestions(item: Item, suggestions: readonly unknown[] | null | undefined): Item | SuggestionRefusal;
```

- The suggestions are `unknown[]` because they come off a reply the rail holds in browser storage and the CLI reads from a reply line, and B120's checks on each one are the boundary. C4's `Suggestion` type describes what passes.
- The result is told apart with `"code" in result`; a record never has a `code` field. The old shape stays because `tab_done.js` and `cli/commands/reply.js` test `.code`.
- The text rewording (the old `rewordBlock`, `markupSegments`, `decodeBasic`, `encodeBasic`) is private.

### `src/domain/choice-state.ts`

```ts
export function choiceStateOf(item: Item | null | undefined, kept: boolean): ChoiceState;
export function latestChoiceByGroup(items: readonly Item[] | null | undefined): ReadonlyMap<ChoiceToken, Item>;
```

### Bridges

- `src/shared/record.js` holds one statement: `module.exports = { ...require("../contract/record.ts"), ...require("../contract/field-class.ts"), ... };` over the twenty-two modules in section 1's table (not `utf8.ts`). The spread makes a plain, writable object (B124).
- The bundle sets `LAHE.record` to the same combination at the old file's place in the bundle order (B125), through S0c's multi-module manifest entry.

### Exported names that change, and what each caller does

The bridge carries 128 names: 123 of the old 135 with their spelling, and 5 new ones. Counted by `c3_names.py`.

| Old | New | Why | Callers to edit |
| --- | --- | --- | --- |
| `blockText` | removed; use C2's `blockText` | A one-caller wrapper that shadowed the normalizer's function of the same name (D2) | `review_format.js` 485, 1044, 1054: `record.blockText(x)` becomes `normalize.blockText(typeof x === "string" ? x : "")` |
| `historyEntry(rev, after, afterHtml, at, runSource)` | `historyEntry(item, at)` | Five positional values that all came from one record (D3) | `editing.js` 296: `record.historyEntry(committed, committed[record.FIELD.UPDATED_AT])` |
| `takenBackIds` returning an object of `id: true` | returns a `ReadonlySet<string>` | A set is what it is (D4) | `editing.js` 4044: `.has(itemId)`; `replay.js` 1587: `takenBack.has(list[i][record.FIELD.ID])`; 3407: `taken.has(id)` |
| `latestChoiceByGroup` returning a null-prototype object | returns a `ReadonlyMap` | A map is what it is (D4) | `choices.js` 407: `record.latestChoiceByGroup(...).get(name)`, falling back to `null` as before; `replay.js` 3021 to 3023: `latest.forEach(function (item, name) { ... })` |
| `FIELD_CLASS` keyed by dotted paths | keyed by every field name (B18) | Total over the fields, so a new field must be classified (D5) | none; no reader |
| `validateItem` returning the record | returns nothing (assertion) | Assertion functions narrow; no caller read the return (D8) | none |
| `REPLY_STATUS`, `REPLY_STATUSES` | re-exported from `replies.ts` | One spelling (D6) | none |
| `NEW_BLOCKS_MAX`, `NEW_BLOCKS_MAX_BYTES`, `RUN_RECORD_MAX_BYTES`, `RUN_HISTORY_KEEP` | from `run-limits.ts` | One source with the reply caps (D6) | none |
| `emptyPage`, `itemCanCarryStamp`, `basenameOf`, `RUN_CODE`, `utf8Bytes`, `trimRunHistory`, `TOOL_ROUNDS`, `revertChangeText`, `CHOICE_CODE`, `normalizedBefore`, `normalizedAfter` | removed or private | No reader (D1) | none |

New names: `isKind`, `isItemState`, `isPlacement`, `isToolRoundName` and `INSTRUCTION_PATHS` on the bridge, plus `utf8ByteLength` in `contract/utf8.ts` and every type above.

**Watch for silent failure.** After the edits, `grep -rn "takenBackIds([^)]*)\[\|latestChoiceByGroup([^)]*)\[\|record\.blockText\|record\.historyEntry(.*,.*,.*," src` must find nothing: indexing a `Set` or a `Map` with brackets returns `undefined` without an error, so a missed call site would silently replay a taken-back run.

### Tests

New tests live in `test/unit/contract/` and `test/unit/domain/`, one file per module with behavior, named after the module (`test/unit/domain/run-check.test.ts`). Records are built with `newItem` from the module under test or as literals; nothing imports `record_fixtures.js`. The forwarder and source-text checks stay JavaScript in `test/unit/record_bridge.test.js` (section 8), because a `.ts` test cannot import the `.js` forwarder; F1 removes that file with the forwarder.

## 5. Old tests, accounted for

`c3_cases.py` split every unit test file that loads `record.js` into its test cases and listed the record exports each case reads, comments stripped; `c3_map.py` wrote the tables below. That is 1,554 cases in 86 files, of which 77 cases in the four Library files named in section 3 do not load the record at all. The other 1,477 are here:

- **94 cases are this slice's.** 93 move into the new `.ts` tests, each rewritten against the behavior statement named; the 94th, the source-text check, stays in `fix_round_f3_record.test.js`'s successor (section 8). They come from `record_lifecycle.test.js` (its record cases), `run_record.test.js` (its record cases), `fix_round_f3_record.test.js` (all of it), `page_scope.test.js` (its `samePage` and `pageKey` cases) and `page_identity_forms.test.js` (its two `samePage` cases). Each was reading `record.js` as its subject. Cases that used `record_fixtures.js` build their records as literals instead.
- **174 cases stay where they are.** 36 are in those same files but test something else: the lifecycle and merge cases of `record_lifecycle.test.js` (C5 owns `lifecycle.js` and `merge.js`), the fixture-integrity cases of `run_record.test.js` (C5 moves the fixtures), the `elapsed` and store cases of `page_scope.test.js`, and the `review_format` cases of `page_identity_forms.test.js`. The other 138 are in other slices' test files and call a record export as part of what they check (the projection, the store, replay, the Done tab). They keep running unchanged through the forwarder, and each is mapped to the statement it also exercises, so the testing reviewer can see the overlap.
- **1,209 cases in 77 files use the record only to build their inputs** (`newItem`, `FIELD`, `KIND`, `STATE`, `REPLY_STATUS`, or their file's own helpers built on them). They stay unchanged; none reads a name this slice removes or reshapes.

No case is dropped. `record_lifecycle.test.js`, `run_record.test.js`, `page_scope.test.js` and `page_identity_forms.test.js` are not moved with `git mv`: they keep their other slices' cases, and the builder deletes only the record cases it has carried, listing each in the progress detail with the new test that holds it. `fix_round_f3_record.test.js` moves with `git mv` to `test/unit/record_bridge.test.js` (section 8).

**New cases with no old counterpart:** B1, B5, B7, B21 and B22 as whole tables; B2's and B3's guards; B4's identity; B12's compile-time check; B14 and B15; B17's full path list and B18; B19's refusals in full; B24 and B30 reason by reason; B27; B33; B35's filters and key order; B36's `pageFrom(null)`; B38; B41 and B42 (only exercised through other slices' tests today); B45 to B48 in full; B50's key order and B51; B53; B55's tag case; B65 to B69 in isolation; B72's archived shape; B73; B79; B80's untouched old region; B82's spacing; B84 and B85; B92; B95; B99's `BREAK_REMOVED`; B102's format-only take-back; B104 to B106; B108's anchor and start-of-container cases; B109 sentence by sentence; B112 to B116 reason by reason; B120 reason by reason; B121; B122; B123's tie and token cases; B124.

#### The 94 cases that are this slice's

| File | Line | Test | Covered by | What happens |
| --- | --- | --- | --- | --- |
| `fix_round_f3_record.test.js` | 26 | the take-back of a tag-only change goes back to the old tag | B102, B117 | moves to `test/unit/domain/revert.test.ts` |
| `fix_round_f3_record.test.js` | 37 | the take-back of a run that also retagged the anchor restores the tag and removes the blocks | B102, B117 | moves to `test/unit/domain/revert.test.ts` |
| `fix_round_f3_record.test.js` | 56 | the take-back of a run with no tag change carries no tag | B102 | moves to `test/unit/domain/revert.test.ts` |
| `fix_round_f3_record.test.js` | 62 | the helper refuses a run whose after_html carries markup its blocks do not | B115 | moves to `test/unit/domain/run-check.test.ts` |
| `fix_round_f3_record.test.js` | 70 | the helper refuses a run whose after is not the words of its after_html | B115 | moves to `test/unit/domain/run-check.test.ts` |
| `fix_round_f3_record.test.js` | 76 | the helper refuses a run whose anchor_after_html carries an event handler | B115 | moves to `test/unit/domain/run-check.test.ts` |
| `fix_round_f3_record.test.js` | 82 | the helper refuses a take-back whose before_html is not the anchor plus the removed blocks | B116 | moves to `test/unit/domain/run-check.test.ts` |
| `fix_round_f3_record.test.js` | 91 | every run fixture still passes the stricter check | B117 | moves to `test/unit/domain/run-check.test.ts,` over the literal run records that replace the fixtures |
| `fix_round_f3_record.test.js` | 95 | a 1 MiB nested block is refused on size, fast, before it is parsed | B113 | moves to `test/unit/domain/run-check.test.ts` |
| `fix_round_f3_record.test.js` | 107 | applySuggestions refuses a fix to a from_anchor block, which holds the page's own words | B120 | moves to `test/unit/domain/proofread.test.ts` |
| `fix_round_f3_record.test.js` | 117 | the revision Use the fixes makes says to replace the old words in place | B118, B119 | moves to `test/unit/domain/proofread.test.ts` |
| `fix_round_f3_record.test.js` | 127 | an archived proofread turn keeps its fixes, so review.json can carry them | B72 | moves to `test/unit/domain/thread.test.ts` |
| `fix_round_f3_record.test.js` | 139 | record.js holds no literal NUL byte, so grep reads it as text | source text, section 8 | stays in `test/unit/record_bridge.test.js` (the `git mv` successor), retargeted (section 8) |
| `fix_round_f3_record.test.js` | 147 | continueOnto archives the answered turn onto a revision that already carries new words | B75 | moves to `test/unit/domain/thread.test.ts` |
| `fix_round_f3_record.test.js` | 163 | continueOnto with the item itself as the base is continueThread | B75 | moves to `test/unit/domain/thread.test.ts` |
| `page_identity_forms.test.js` | 21 | every spelling of one stable address is the same page | B40 | moves to `test/unit/domain/page-identity.test.ts` |
| `page_identity_forms.test.js` | 29 | a different name, path or plain loopback port is still a different page | B40 | moves to `test/unit/domain/page-identity.test.ts` |
| `page_scope.test.js` | 34 | an item made on this page is this page's | B40, B43 | moves to `test/unit/domain/page-identity.test.ts` |
| `page_scope.test.js` | 41 | two different documents on one origin never see each other's items | B40, B43 | moves to `test/unit/domain/page-identity.test.ts` |
| `page_scope.test.js` | 46 | two dev servers both serving /dashboard are two pages, as pageKey says | B40, B43 | moves to `test/unit/domain/page-identity.test.ts` |
| `page_scope.test.js` | 51 | pageKeyFor and pageKey spell the same key | B37 | moves to `test/unit/domain/page-identity.test.ts` |
| `page_scope.test.js` | 56 | a document opened from disk and served over http is one page | B40, B43 | moves to `test/unit/domain/page-identity.test.ts` |
| `page_scope.test.js` | 69 | and the same holds the other way round | B40, B43 | moves to `test/unit/domain/page-identity.test.ts` |
| `page_scope.test.js` | 74 | two different documents from disk stay apart | B40, B43 | moves to `test/unit/domain/page-identity.test.ts` |
| `page_scope.test.js` | 79 | a file item and a differently named served document stay apart | B40, B43 | moves to `test/unit/domain/page-identity.test.ts` |
| `page_scope.test.js` | 84 | pageFrom builds a file page the rule can match | B40, B43, B36 | moves to `test/unit/domain/page-identity.test.ts` |
| `page_scope.test.js` | 91 | two index.html files in two folders are two pages, both off disk | B40, B43, B36 | moves to `test/unit/domain/page-identity.test.ts` |
| `page_scope.test.js` | 108 | one index.html visited twice off disk is one page | B40, B43, B36 | moves to `test/unit/domain/page-identity.test.ts` |
| `page_scope.test.js` | 113 | the mixed case: one document off disk and served, folder and all | B40, B43, B36 | moves to `test/unit/domain/page-identity.test.ts` |
| `page_scope.test.js` | 120 | a record written before the folder rule still matches on its name alone | B40, B43 | moves to `test/unit/domain/page-identity.test.ts` |
| `page_scope.test.js` | 125 | a document served at the origin root is the index document, both directions | B43 | moves to `test/unit/domain/page-identity.test.ts` |
| `page_scope.test.js` | 139 | a directory path deeper in is that directory's index document | B43 | moves to `test/unit/domain/page-identity.test.ts` |
| `page_scope.test.js` | 144 | the root is not every document: a named page there stays its own page | B43 | moves to `test/unit/domain/page-identity.test.ts` |
| `page_scope.test.js` | 149 | samePage refuses to guess at a missing item or page | B44 | moves to `test/unit/domain/page-identity.test.ts` |
| `record_lifecycle.test.js` | 35 | every field architecture D4 names is present on a new item | B50 | moves to `test/unit/domain/item-revisions.test.ts` |
| `record_lifecycle.test.js` | 69 | legacy records read as an empty thread | B70, B30 | moves to `test/unit/domain/thread.test.ts` |
| `record_lifecycle.test.js` | 76 | follow-up archives the exact completed exchange and advances once | B76, B74 | moves to `test/unit/domain/thread.test.ts` |
| `record_lifecycle.test.js` | 104 | empty follow-up is a no-op and reopen issue resubmits unchanged | B76, B77 | moves to `test/unit/domain/thread.test.ts` |
| `record_lifecycle.test.js` | 119 | a second follow-up appends a second completed round in chronological order | B76, B71 | moves to `test/unit/domain/thread.test.ts` |
| `record_lifecycle.test.js` | 136 | historical exchanges are presented by timestamp with stable legacy ties | B71 | moves to `test/unit/domain/thread.test.ts` |
| `record_lifecycle.test.js` | 160 | the dead send model's fields are gone | B2, B50 | moves to `test/unit/contract/record.test.ts` |
| `record_lifecycle.test.js` | 169 | the kinds are exactly D4's closed list | B2 | moves to `test/unit/contract/record.test.ts` |
| `record_lifecycle.test.js` | 175 | the region reference carries its lost-anchor state as a named field (R20) | B6, B50 | moves to `test/unit/contract/record.test.ts` |
| `record_lifecycle.test.js` | 186 | an accepted page state is remembered, add-only, deduped and bounded | B89, B90 | moves to `test/unit/domain/accepted-page-texts.test.ts` |
| `record_lifecycle.test.js` | 212 | ids are unique and minted in the browser | B32 | moves to `test/unit/domain/mint.test.ts` |
| `record_lifecycle.test.js` | 218 | newItem refuses an unknown kind and a missing page | B49 | moves to `test/unit/domain/item-revisions.test.ts` |
| `record_lifecycle.test.js` | 224 | a record starts as a draft unless it is told otherwise (R7) | B50, B60, B26 | moves to `test/unit/domain/item-revisions.test.ts` |
| `record_lifecycle.test.js` | 232 | a ready comment must carry the reviewer's words, a draft need not | B29 | moves to `test/unit/contract/item-check.test.ts` |
| `record_lifecycle.test.js` | 239 | validateItem reports every problem at once rather than the first | B28 | moves to `test/unit/contract/item-check.test.ts` |
| `record_lifecycle.test.js` | 249 | the group key is origin plus pathname, so two dev servers do not collapse | B37 | moves to `test/unit/domain/page-identity.test.ts` |
| `record_lifecycle.test.js` | 259 | pageFrom collapses the query string and the fragment away | B35 | moves to `test/unit/domain/page-identity.test.ts` |
| `record_lifecycle.test.js` | 271 | a file review carries the file's name and its folder as its page path | B36 | moves to `test/unit/domain/page-identity.test.ts` |
| `record_lifecycle.test.js` | 279 | the first-visit order rides on the record, because the projection groups by it | B50 | moves to `test/unit/domain/item-revisions.test.ts` |
| `record_lifecycle.test.js` | 285 | bumpRev increments rev, which is what stops a stale reply swallowing a rewording | B54 | moves to `test/unit/domain/item-revisions.test.ts` |
| `record_lifecycle.test.js` | 296 | a record keeps every after it has had, in order | B52, B55 | moves to `test/unit/domain/item-revisions.test.ts` |
| `record_lifecycle.test.js` | 310 | priorAfters is what branch three compares against: not the current after, not the before | B57 | moves to `test/unit/domain/item-revisions.test.ts` |
| `record_lifecycle.test.js` | 321 | a rewording that lands on the same text does not grow the history | B55 | moves to `test/unit/domain/item-revisions.test.ts` |
| `record_lifecycle.test.js` | 327 | the intent channel is exactly note and change; page text is data (D12) | B16, B17 | moves to `test/unit/contract/field-class.test.ts` |
| `record_lifecycle.test.js` | 347 | a format-only record compares on structure and everything else on text | B58 | moves to `test/unit/domain/item-revisions.test.ts` |
| `record_lifecycle.test.js` | 355 | there are exactly four states, and question and reopened are not among them | B3, B4 | moves to `test/unit/contract/record.test.ts` |
| `record_lifecycle.test.js` | 403 | a handled item cannot be deleted, because it is the record that a fix landed | B62 | moves to `test/unit/domain/item-status.test.ts` (the lifecycle half stays, C5) |
| `record_lifecycle.test.js` | 419 | a take-back is an ordinary outstanding edit pointing the other way | B101, B9 | moves to `test/unit/domain/revert.test.ts` |
| `record_lifecycle.test.js` | 443 | a reverted delete asks for the block back, and a reverted format change compares on markup | B101, B59 | moves to `test/unit/domain/revert.test.ts` |
| `record_lifecycle.test.js` | 471 | takenBackIds is the one definition of what a review has already withdrawn | B103 | moves to `test/unit/domain/revert.test.ts,` rewritten for the Set (D4) |
| `record_lifecycle.test.js` | 606 | italic the reviewer added is named in the change sentence | B96, B97 | moves to `test/unit/domain/change-text.test.ts` |
| `record_lifecycle.test.js` | 619 | bold the reviewer added is named in the change sentence | B96, B97 | moves to `test/unit/domain/change-text.test.ts` |
| `record_lifecycle.test.js` | 624 | bold the reviewer removed is named, once, however the browser said it | B96 | moves to `test/unit/domain/change-text.test.ts` |
| `record_lifecycle.test.js` | 647 | a reworded edit that also changes emphasis says both, wording first | B96, B100 | moves to `test/unit/domain/change-text.test.ts` |
| `record_lifecycle.test.js` | 662 | an edit that changes no emphasis says nothing about emphasis | B96 | moves to `test/unit/domain/change-text.test.ts` |
| `record_lifecycle.test.js` | 674 | markup that is not bold or italic is never reported as a formatting change | B96 | moves to `test/unit/domain/change-text.test.ts` |
| `record_lifecycle.test.js` | 682 | a follow-up carries the change sentence, so every revision still says what the edit was | B76 | moves to `test/unit/domain/thread.test.ts` |
| `record_lifecycle.test.js` | 707 | a paragraph pasted above another is said as that, naming the one it sits against | B94, B98 | moves to `test/unit/domain/change-text.test.ts` |
| `record_lifecycle.test.js` | 715 | a paragraph added below is said the same way | B94, B98 | moves to `test/unit/domain/change-text.test.ts` |
| `record_lifecycle.test.js` | 721 | the paragraph it sits against is named, not repeated in full | B95, B98 | moves to `test/unit/domain/change-text.test.ts` |
| `record_lifecycle.test.js` | 730 | splitting one paragraph in two is still a break, not a paragraph added | B94, B99 | moves to `test/unit/domain/change-text.test.ts` |
| `record_lifecycle.test.js` | 740 | a shared letter at the front no longer splits a word | B93 | moves to `test/unit/domain/change-text.test.ts` |
| `record_lifecycle.test.js` | 748 | a word the two strings share the END of is reported whole | B93 | moves to `test/unit/domain/change-text.test.ts` |
| `record_lifecycle.test.js` | 754 | an insertion mid-sentence is still reported at word boundaries | B93, B100 | moves to `test/unit/domain/change-text.test.ts` |
| `record_lifecycle.test.js` | 766 | a paragraph added above with emphasis in it still says the emphasis | B98, B96 | moves to `test/unit/domain/change-text.test.ts` |
| `run_record.test.js` | 16 | the ceilings are the plan's numbers | B13, B10 | moves to `test/unit/contract/run-limits.test.ts` |
| `run_record.test.js` | 37 | the page check writes no sentence about a run: its only round is the stamp | B78 | moves to `test/unit/domain/page-check.test.ts` |
| `run_record.test.js` | 46 | the new fields are data | B17 | moves to `test/unit/contract/field-class.test.ts` |
| `run_record.test.js` | 59 | every forged run fixture is refused with its code | B112, B113, B114 | moves to `test/unit/domain/run-check.test.ts,` over literal forged records |
| `run_record.test.js` | 103 | over the block count ceiling is refused | B113 | moves to `test/unit/domain/run-check.test.ts` |
| `run_record.test.js` | 111 | a run of three-byte characters under the block count and over the byte count is refused | B113 | moves to `test/unit/domain/run-check.test.ts` |
| `run_record.test.js` | 121 | a run record over RUN_RECORD_MAX_BYTES is refused even under both block ceilings | B113, B107 | moves to `test/unit/domain/run-check.test.ts` |
| `run_record.test.js` | 130 | recordBytes counts UTF-8 bytes of the record as JSON | B107 | moves to `test/unit/domain/run-record.test.ts` |
| `run_record.test.js` | 135 | a record with no run fields is not judged by validateRun | B111 | moves to `test/unit/domain/run-check.test.ts` |
| `run_record.test.js` | 139 | a take-back of a handled run lists the blocks in remove_blocks and has no new_blocks | B102, B117 | moves to `test/unit/domain/revert.test.ts` |
| `run_record.test.js` | 157 | the anchor view of a run record carries anchor_after_html as its after_html | B105 | moves to `test/unit/domain/run-record.test.ts` |
| `run_record.test.js` | 175 | history entries older than RUN_HISTORY_KEEP drop new_blocks and after_html and keep after | B56 | moves to `test/unit/domain/item-revisions.test.ts` |
| `run_record.test.js` | 197 | an ordinary record keeps today's history | B56 | moves to `test/unit/domain/item-revisions.test.ts` |
| `run_record.test.js` | 203 | applySuggestions changes the words, keeps a block's bold, and bumps the revision | B119, B121 | moves to `test/unit/domain/proofread.test.ts` |
| `run_record.test.js` | 215 | applySuggestions refuses a from found twice or not at all | B120 | moves to `test/unit/domain/proofread.test.ts` |

#### The 174 cases that stay where they are

| File | Line | Test | Covered by | What happens |
| --- | --- | --- | --- | --- |
| `adopt_old_records.test.js` | 204 | samePage reads an old path alias only together with an old origin | B35, B40 | stays, unchanged |
| `adopt_old_records.test.js` | 245 | store.adopt writes what this browser does not hold, as acknowledged, and queues nothing | B54 | stays, unchanged |
| `choice_anchor_rung.test.js` | 155 | a ref with a name off the grammar binds nothing, even if a group carries it | B23 | stays, unchanged |
| `choice_anchor_rung.test.js` | 161 | the empty-container rung is unchanged: a start_of_container ref still binds the page's one main | B10 | stays, unchanged |
| `choice_kernel.test.js` | 117 | newItem keeps a choice on a choice record, and every other record has no choice key | B24, B28 | stays, unchanged |
| `choice_kernel.test.js` | 128 | validateItem and validateChoice refuse every forgery, each with the CHOICE_REFUSED code | B24, B28 | stays, unchanged |
| `choice_kernel.test.js` | 139 | the grammar is bounded: 1 to 64 letters, digits, hyphens, underscores, dots or colons, starting with a letter or digit | B19 | stays, unchanged |
| `choice_kernel.test.js` | 178 | a press named as an agent wrote its keys (Closest_21, A_jev) passes the door, projects and drains unchanged | B23, B24 | stays, unchanged |
| `choice_kernel.test.js` | 206 | isHandEdit, isReplayable and isOutstanding need no change for a choice | B8, B61, B62, B63 | stays, unchanged |
| `choice_kernel.test.js` | 220 | a reword keeps the choice record valid at the next revision, and a follow-up keeps the press | B24, B54, B76 | stays, unchanged |
| `choice_kernel.test.js` | 234 | the field classes name choice.group and choice.answer as intent, and only on a choice does the key appear | B16, B17 | stays, unchanged |
| `choice_kernel.test.js` | 321 | a handled reply retires a choice in the projection, with no page read | B61 | stays, unchanged |
| `choice_kernel.test.js` | 349 | an offline re-press (rev 2 in the browser, rev 1 handled in the store) merges to rev 2 ready | B54 | stays, unchanged |
| `done_tab_replies.test.js` | 1024 | releaseCard refuses a tab name that is not a tab | B65, B78 | stays, unchanged |
| `done_tab_replies.test.js` | 1051 | the page check's stamp reopen is marked a tool round, on the record | B65, B66 | stays, unchanged |
| `done_tab_replies.test.js` | 1061 | a reopen that names no tool is the reviewer's business, so it is not a tool round | B66 | stays, unchanged |
| `done_tab_replies.test.js` | 1075 | a tool round leaves the card exactly where the reviewer left it | B69 | stays, unchanged |
| `done_tab_replies.test.js` | 1135 | the archived tool round travels marked, so history draws nothing for it either | B65, B67, B70 | stays, unchanged |
| `draft_flush_cadence.test.js` | 361 | closing a comment box tells the host the reviewer left it | B104 | stays, unchanged |
| `draft_flush_cadence.test.js` | 455 | reopening a ready run and typing posts the withdrawal at once; later drafts wait the run floor | B104 | stays, unchanged |
| `editing_surface.test.js` | 54 | a typed break is a change; a rewrapped line is not | B97, B99 | stays, unchanged |
| `editing_surface.test.js` | 83 | a change in markup alone is a change, and it is its own kind (R31) | B59 | stays, unchanged |
| `editing_surface.test.js` | 306 | undoing the same handled edit twice does not ask for the change to be removed twice | B101 | stays, unchanged |
| `editing_surface.test.js` | 418 | each break is a change, and the change line names the one the reviewer typed | B97, B99 | stays, unchanged |
| `end_review.test.js` | 108 | the door says the same sentence on hover and to a screen reader | B60 | stays, unchanged |
| `fix_round_f3_projection.test.js` | 64 | a proofread fix quoting the words as text shows them applies | B119 | stays, unchanged |
| `fix_round_f3_projection.test.js` | 89 | the revision Use the fixes makes is not proofread again | B118 | stays, unchanged |
| `fix_round_f3_projection.test.js` | 106 | a plain question in the thread carries no proofread fields | B76 | stays, unchanged |
| `fix_round_f3_projection.test.js` | 115 | Keep mine also ends proofreading | B76 | stays, unchanged |
| `fix_round_f3_service.test.js` | 57 | a reply line whose from or to is over the run's byte ceiling is refused | B13 | stays, unchanged |
| `fix_round_f3_service.test.js` | 63 | the suggestion bounds restate the run ceilings | B13 | stays, unchanged |
| `fix_round_f3_sync.test.js` | 143 | a refused run still carries RUN_EVENT_REFUSED after a reload, until an accepted post clears it | B54 | stays, unchanged |
| `flow_fix_g2.test.js` | 74 | a later record whose anchor is a placed block takes that block over | B108 | stays, unchanged |
| `flow_fix_g2.test.js` | 84 | a take-back, an older record and a comment take nothing over | B108 | stays, unchanged |
| `flow_fix_g2.test.js` | 123 | a later record that rewords the run's own reworded anchor takes the anchor over | B108 | stays, unchanged |
| `free_writing_f1_fixes.test.js` | 41 | undo on a handled item takes back; a not_handled one drops, as before | B54, B104, B107, B109 | stays, unchanged |
| `free_writing_f1_fixes.test.js` | 72 | the run record estimate is never below what the commit writes, at rev 13 | B54, B107, B109 | stays, unchanged |
| `free_writing_f1_fixes.test.js` | 92 | between measurements, RUN_BYTES_FACTOR covers each byte typed | B104 | stays, unchanged |
| `handled_check_run.test.js` | 152 | a comment and a delete are still not checked | B101 | stays, unchanged |
| `handled_check_run.test.js` | 186 | an ordinary take-back is still not checked | B101 | stays, unchanged |
| `held_release_clock.test.js` | 145 | waiting_since is a data field, never an instruction | B16, B17 | stays, unchanged |
| `launch_folder.test.js` | 62 | the drain names the document's project folder: the repository that holds it | B16 | stays, unchanged |
| `log_run.test.js` | 88 | a valid run is stored and projected whole | B13, B54, B104 | stays, unchanged |
| `log_run.test.js` | 132 | a record at both block ceilings with RUN_HISTORY_KEEP full entries fits the body limit | B13, B107, B110 | stays, unchanged |
| `log_run.test.js` | 142 | older history entries push the record over RUN_RECORD_MAX_BYTES, and it is refused | B13, B54, B104, B107, B110 | stays, unchanged |
| `mark_done.test.js` | 164 | closeItem keeps the revision and the reply, names the reviewer, and clears a held claim | B61, B62, B63, B64 | stays, unchanged |
| `mark_done.test.js` | 202 | a new revision drops the close mark | B54 | stays, unchanged |
| `mark_done.test.js` | 225 | merge: a close survives a reload when both sides hold it | B64 | stays, unchanged |
| `mark_done.test.js` | 231 | merge: a store ahead of the close wins, because the close named an older wording | B54, B64 | stays, unchanged |
| `mark_done.test.js` | 240 | projection: item.closed at the current revision moves a not_handled comment to handled | B61 | stays, unchanged |
| `mark_done.test.js` | 263 | projection: a held hand edit closes, and handled_not_on_page clears | B61 | stays, unchanged |
| `mark_done.test.js` | 283 | projection: a close naming an older revision is dropped and reported | B54 | stays, unchanged |
| `mark_done.test.js` | 310 | projection: a same-revision re-post after the close keeps it closed; a reword reopens it | B54, B64 | stays, unchanged |
| `mark_done.test.js` | 346 | folding: a handled reply after the close is refused, and the page check never runs | B64 | stays, unchanged |
| `mark_done.test.js` | 374 | folding: a question after the close is refused too | B64 | stays, unchanged |
| `mark_done.test.js` | 385 | folding: an accepted fold written before the close was folded cannot reopen it | B64 | stays, unchanged |
| `menubar_summary.test.js` | 594 | the reader's unread fold reads only a log's new lines once it has folded it | B88 | stays, unchanged |
| `merge_run.test.js` | 61 | a later helper revision wins over an acknowledged browser copy | B54 | stays, unchanged |
| `oversized_records.test.js` | 147 | 1: a region that is not unique anywhere stores the same bounded neighbourhood | B7 | stays, unchanged |
| `oversized_records.test.js` | 250 | 2: review.json still hands the agent the opening tag with the real source in it | B6 | stays, unchanged |
| `page_identity_forms.test.js` | 37 | review.json groups every spelling of one page into one group | none (review_format.js) | stays; C5 owns review_format |
| `page_identity_forms.test.js` | 44 | an old port origin aliased to one spelling joins items made at another | none (review_format.js) | stays; C5 owns review_format |
| `page_scope.test.js` | 154 | recent times read as a span, older ones as a date, and it never prints an ISO string | none (elapsed.js or store.js) | stays in `page_scope.test.js` |
| `page_scope.test.js` | 168 | an unreadable value is echoed rather than guessed at | none (elapsed.js or store.js) | stays in `page_scope.test.js` |
| `page_scope.test.js` | 172 | the helper's refusal and the rail's chip say the same words | none (elapsed.js or store.js) | stays in `page_scope.test.js` |
| `page_scope.test.js` | 179 | the refusal still names the window when the holder is served at the root | none (elapsed.js or store.js) | stays in `page_scope.test.js` |
| `projection_review_json.test.js` | 299 | a rewording drops the answer that named the old revision | B54 | stays, unchanged |
| `projection_review_json.test.js` | 432 | a page.visited event's source_hint reaches review.json as a known source, review-wide | B5 | stays, unchanged |
| `projection_review_json.test.js` | 456 | the last page.visited event wins, matching the last-write-wins rule recordPaths already uses | B5 | stays, unchanged |
| `projection_review_json.test.js` | 614 | the new fields are classed as data, and a projected history entry has no new_blocks | B16, B54, B104 | stays, unchanged |
| `rebuild_not_the_agents_job.test.js` | 282 | a handled edit whose words are on the page retires | B61 | stays, unchanged |
| `rebuild_not_the_agents_job.test.js` | 294 | a handled edit the page does not show stays open, and says why | B61 | stays, unchanged |
| `rebuild_not_the_agents_job.test.js` | 342 | a revert is never checked: it asks for text to be taken OUT | B9, B101 | stays, unchanged |
| `rebuild_not_the_agents_job.test.js` | 364 | a page-check reopen is never checked: two checks arguing means the item never closes | B65, B66, B78, B81 | stays, unchanged |
| `rebuild_not_the_agents_job.test.js` | 512 | a card the handled check held open never goes late, however long it sits | B61 | stays, unchanged |
| `rebuild_not_the_agents_job.test.js` | 629 | five edits, one fixed, five handled replies: the four untouched stay open and the fixed one retires | B61 | stays, unchanged |
| `record_lifecycle.test.js` | 365 | the agent may only move a READY item, and never a draft | none (lifecycle.js or merge.js) | stays in `record_lifecycle.test.js` for C5, which owns lifecycle and merge |
| `record_lifecycle.test.js` | 377 | the helper makes no lifecycle transition on its own initiative | none (lifecycle.js or merge.js) | stays in `record_lifecycle.test.js` for C5, which owns lifecycle and merge |
| `record_lifecycle.test.js` | 383 | reopening is a transition from handled back to ready, and it is the reviewer's (R38) | none (lifecycle.js or merge.js) | stays in `record_lifecycle.test.js` for C5, which owns lifecycle and merge |
| `record_lifecycle.test.js` | 390 | rewording takes a ready or not_handled item back to draft, and only the reviewer does it | none (lifecycle.js or merge.js) | stays in `record_lifecycle.test.js` for C5, which owns lifecycle and merge |
| `record_lifecycle.test.js` | 481 | an illegal transition throws rather than being ignored | none (lifecycle.js or merge.js) | stays in `record_lifecycle.test.js` for C5, which owns lifecycle and merge |
| `record_lifecycle.test.js` | 488 | only ready items are actionable, so a draft never reaches an agent (R7) | none (lifecycle.js or merge.js) | stays in `record_lifecycle.test.js` for C5, which owns lifecycle and merge |
| `record_lifecycle.test.js` | 492 | a reply applies only for the revision it names (R9, R21) | none (lifecycle.js or merge.js) | stays in `record_lifecycle.test.js` for C5, which owns lifecycle and merge |
| `record_lifecycle.test.js` | 503 | a reply naming an old revision is refused and the item stays outstanding | none (lifecycle.js or merge.js) | stays in `record_lifecycle.test.js` for C5, which owns lifecycle and merge |
| `record_lifecycle.test.js` | 511 | a question leaves the item ready, because the work is still outstanding | none (lifecycle.js or merge.js) | stays in `record_lifecycle.test.js` for C5, which owns lifecycle and merge |
| `record_lifecycle.test.js` | 518 | a handled reply naming the current rev retires the item; not_handled keeps it visible | none (lifecycle.js or merge.js) | stays in `record_lifecycle.test.js` for C5, which owns lifecycle and merge |
| `record_lifecycle.test.js` | 524 | a reply cannot move a draft, whatever revision it names | none (lifecycle.js or merge.js) | stays in `record_lifecycle.test.js` for C5, which owns lifecycle and merge |
| `record_lifecycle.test.js` | 532 | the browser wins on content for anything the helper has not acknowledged | none (lifecycle.js or merge.js) | stays in `record_lifecycle.test.js` for C5, which owns lifecycle and merge |
| `record_lifecycle.test.js` | 544 | the store wins on lifecycle at the same revision | none (lifecycle.js or merge.js) | stays in `record_lifecycle.test.js` for C5, which owns lifecycle and merge |
| `record_lifecycle.test.js` | 552 | a stale revision cannot retire a current one: the reword-offline case | none (lifecycle.js or merge.js) | stays in `record_lifecycle.test.js` for C5, which owns lifecycle and merge |
| `record_lifecycle.test.js` | 569 | an acknowledged browser copy does not overwrite the store's content | none (lifecycle.js or merge.js) | stays in `record_lifecycle.test.js` for C5, which owns lifecycle and merge |
| `record_lifecycle.test.js` | 577 | a store revision ahead of the browser wins outright | none (lifecycle.js or merge.js) | stays in `record_lifecycle.test.js` for C5, which owns lifecycle and merge |
| `record_lifecycle.test.js` | 585 | an item only one side has survives the merge | none (lifecycle.js or merge.js) | stays in `record_lifecycle.test.js` for C5, which owns lifecycle and merge |
| `record_lifecycle.test.js` | 592 | merging two lists keeps the browser's order, so the rail does not reshuffle | none (lifecycle.js or merge.js) | stays in `record_lifecycle.test.js` for C5, which owns lifecycle and merge |
| `record_lifecycle.test.js` | 602 | merging two different items is a loud error, never a silent pick | none (lifecycle.js or merge.js) | stays in `record_lifecycle.test.js` for C5, which owns lifecycle and merge |
| `refused_not_replayed.test.js` | 146 | record.isReplayable counts only a ready item the reviewer is waiting on | B62, B63 | stays, unchanged |
| `refused_not_replayed.test.js` | 155 | a stamp round is not replayed: the reviewer's card still reads handled | B63, B65, B77, B78, B81 | stays, unchanged |
| `refused_not_replayed.test.js` | 243 | Keep mine on a refused card's conflict sends it back to the agent instead of writing once | B89 | stays, unchanged |
| `reopened_edit.test.js` | 178 | a first commit of a new edit still stays at revision one | B60 | stays, unchanged |
| `reopened_edit.test.js` | 219 | a crash while withdrawn does not drop the edit from the page or review.json | B62 | stays, unchanged |
| `reopened_edit.test.js` | 277 | a run draft the page never committed is committed by the next holder, whole | B109 | stays, unchanged |
| `replay_pass.test.js` | 180 | branch three: an earlier revision landed, so the current one is re-applied and the card says so | B57 | stays, unchanged |
| `replay_pass.test.js` | 262 | keep mine: the answered page state is branch two from then on, and nothing re-raises | B89 | stays, unchanged |
| `replay_pass.test.js` | 318 | finding 11: two successive format-only rewordings resolve as branch three, not a false conflict | B54, B57 | stays, unchanged |
| `replay_pass.test.js` | 1566 | duplicate: Keep mine writes only the piece the page is missing | B89 | stays, unchanged |
| `replay_run.test.js` | 46 | the anchor view's history gives each revision's anchor, so branch three never matches a whole sitting | B57 | stays, unchanged |
| `replay_run.test.js` | 70 | the source record is never changed by the view | B54, B101, B104, B109 | stays, unchanged |
| `reply_command.test.js` | 223 | a rev the projection disagrees with warns on stderr and still writes the line | B5 | stays, unchanged |
| `reply_folding.test.js` | 99 | a reply naming a stale revision is refused and the reworded item stays outstanding | B54 | stays, unchanged |
| `reply_folding.test.js` | 216 | a continuation archives the helper's same-revision winning reply | B76 | stays, unchanged |
| `reply_folding.test.js` | 243 | a higher revision beats a later arrival | B54 | stays, unchanged |
| `reply_seen.test.js` | 122 | V3: the rail and the helper call one unread rule, and it lives in record.js | B86, B88 | stays, unchanged |
| `reply_seen.test.js` | 132 | V3: a question counts until a reply.seen naming its stamp is projected, and then it does not | B84, B88 | stays, unchanged |
| `reply_seen.test.js` | 148 | V3: a routine handled reply, a tool round and a card the reviewer closed never count | B5, B65, B66, B80, B88 | stays, unchanged |
| `reply_seen.test.js` | 164 | V3: a mark for an older reply does not clear a newer one | B84, B88 | stays, unchanged |
| `reply_seen.test.js` | 178 | V4: a review with no reply.seen events counts every reply the rule names | B88 | stays, unchanged |
| `reply_seen.test.js` | 192 | V7: a reply.seen for an unknown item, an over-long stamp, another reply's stamp or a non-string is dropped and reported | B5, B84 | stays, unchanged |
| `reply_seen.test.js` | 229 | the browser's carried record cannot claim a read mark, and a new revision drops the helper's | B84 | stays, unchanged |
| `reply_seen.test.js` | 247 | a reviewer reading a reply is not work on the document: the Library's last skips it | B32, B84 | stays, unchanged |
| `reply_seen.test.js` | 285 | opening the card's tab posts one reply.seen per stamp, not one per paint | B84 | stays, unchanged |
| `reply_seen.test.js` | 314 | a polled reply.seen for the current reply is adopted into this browser's marks, with nothing posted back | B84 | stays, unchanged |
| `reply_seen.test.js` | 369 | reply.seen carries only its item and stamp: no page fields, no rev | B84 | stays, unchanged |
| `reply_seen.test.js` | 379 | review.json does not carry reply_seen, and records.read's items still do | B84 | stays, unchanged |
| `reverted_edit.test.js` | 206 | S7: lost italic does not stop the round, and the round writes nothing | B63, B65, B81 | stays, unchanged |
| `reverted_edit.test.js` | 228 | S7: a take-back is not asked about: the reviewer's undo asks for the opposite | B101 | stays, unchanged |
| `reverted_edit.test.js` | 236 | S7: the sentence names the check, asks for the id, and carries no page text | B78 | stays, unchanged |
| `reverted_edit.test.js` | 247 | the check opens a round once, and the agent's next handled reply ends it | B65, B81 | stays, unchanged |
| `reverted_edit.test.js` | 269 | the sentence lands in the note exactly once, however many cycles run | B65, B81 | stays, unchanged |
| `reverted_edit.test.js` | 280 | a stored note carrying an old sentence many times collapses to one copy when it is read | B78, B82 | stays, unchanged |
| `reverted_edit.test.js` | 294 | the cooldown holds a second round back even when the rev has moved on | B54, B65, B81 | stays, unchanged |
| `reverted_edit.test.js` | 342 | which sources can hold a stamp, said once and read by everyone who asks | B47 | stays, unchanged |
| `reverted_edit.test.js` | 373 | the reviewer's note is their own words, with the stamp sentence taken back out | B65, B66, B78, B81, B83 | stays, unchanged |
| `reverted_edit.test.js` | 391 | a stored card carrying an older check's sentence about the reviewer's words still shows it | B78, B83 | stays, unchanged |
| `reverted_edit.test.js` | 396 | a tool round reads as handled to the reviewer and as ready to everyone else | B65, B66, B67, B69, B70, B76, B78, B81 | stays, unchanged |
| `review_format.test.js` | 64 | a deck note carries bounded slide context as page data | B16, B17 | stays, unchanged |
| `review_format.test.js` | 122 | a region's full after is DATA, and only note and change are intent (D12) | B16 | stays, unchanged |
| `review_format.test.js` | 137 | completed thread rounds project and export in order as historical data | B16, B76 | stays, unchanged |
| `review_format.test.js` | 172 | the agent's needs-to-see flag is projected on the reply and classified as data | B16 | stays, unchanged |
| `review_format.test.js` | 222 | field_classes names the fields the projection emits, and no stale ones | B16 | stays, unchanged |
| `review_format.test.js` | 242 | a reworded item carries every wording it has had, with the rev it was committed at | B54 | stays, unchanged |
| `review_format.test.js` | 267 | a wording in the history is bounded, and the bound is visible in the value | B54 | stays, unchanged |
| `review_format.test.js` | 371 | a reply file line's text is projected as data, never as an instruction | B16 | stays, unchanged |
| `review_format.test.js` | 420 | two dev servers serving the same pathname never collapse into one group | B37 | stays, unchanged |
| `review_format.test.js` | 431 | a file review is one group named by the file's basename | B5 | stays, unchanged |
| `review_format.test.js` | 454 | a file visit and a served visit of the same document merge into one page group | B5 | stays, unchanged |
| `review_format.test.js` | 486 | the merge works whichever visit arrived first | B5 | stays, unchanged |
| `review_format.test.js` | 499 | a merge never loses a known source hint to an unknown one | B5 | stays, unchanged |
| `review_format.test.js` | 509 | a page with no item-level hint falls back to the review-wide source hint | B5 | stays, unchanged |
| `review_format.test.js` | 521 | an item-level hint still wins over the review-wide fallback | B5 | stays, unchanged |
| `review_format.test.js` | 567 | counts cover every lifecycle state | B3 | stays, unchanged |
| `review_format.test.js` | 602 | projectReview fails loud on a review it cannot group | B5 | stays, unchanged |
| `review_format.test.js` | 642 | subject is registered in field_classes as DATA, like quote and before | B16 | stays, unchanged |
| `review_format.test.js` | 689 | every item carries the stamp, the chain, the ordinal and text_unique | B16 | stays, unchanged |
| `review_format.test.js` | 723 | stamp_missing records that a page check asked for the id and did not get it | B65, B78 | stays, unchanged |
| `review_format.test.js` | 768 | the tool round still reaches the agent, because the agent is who it is for | B65, B78 | stays, unchanged |
| `reword_not_handled_floor.test.js` | 291 | a draft post at the same revision as a handled reply leaves it handled | B60 | stays, unchanged |
| `run_record.test.js` | 24 | the four refusal codes and the three card codes are failure codes | see note | tests failures.js (C1's table); stays in run_record.test.js for C5 |
| `run_record.test.js` | 52 | every run fixture passes validation | see note | fixture integrity (every run fixture passes validateItem and validateRun); stays for C5, which moves the fixtures. B117 covers the rule |
| `run_record.test.js` | 70 | after equals the literal string written in each fixture | see note | fixture integrity; stays for C5 |
| `run_record.test.js` | 74 | change equals the exact sentence in each fixture and never quotes the run | see note | fixture integrity (the fixtures' change sentences); stays for C5. B109 covers the rule |
| `run_record.test.js` | 81 | every run fixture's words hold the canary | see note | fixture integrity; stays for C5 |
| `run_record.test.js` | 88 | a split with no typing has no Added sentence | see note | fixture integrity; stays for C5. B109 covers the rule |
| `run_record.test.js` | 94 | the worked example's after_html is the anchor then each block as its own element | see note | fixture integrity; stays for C5. B104 covers the rule |
| `run_record.test.js` | 151 | the take-back fixture carries remove_blocks and never new_blocks | see note | fixture integrity; stays for C5. B102 covers the rule |
| `run_record.test.js` | 168 | history entries carry the run fields | see note | fixture integrity; stays for C5. B53 covers the rule |
| `run_record.test.js` | 222 | the proofread question fixture carries suggestions on a question reply | see note | fixture integrity; stays for C5 |
| `run_record.test.js` | 229 | the old-shape fixture has nested blocks in after_html and no new_blocks | see note | fixture integrity (the old-shape fixture is not a run record); stays for C5. B11 covers the rule |
| `sites_mappers.test.js` | 428 | V31 (unit half): samePage matches an item made on an alias origin, at the same path only | B35, B40 | stays, unchanged |
| `status_command.test.js` | 85 | unanswered ready is the one definition: ready, with no reply on it | B61 | stays, unchanged |
| `status_command.test.js` | 117 | status says when a page connected over file:// rather than a served origin | B5 | stays, unchanged |
| `status_command.test.js` | 134 | status names a file:// visit even once a served visit becomes the page's canonical origin | B5 | stays, unchanged |
| `storage_quota_typing.test.js` | 458 | the comment records this drives are real records | B28 | stays, unchanged |
| `store_item_cache.test.js` | 248 | a record repaired on the way out of storage is repaired on the way in too | B78 | stays, unchanged |
| `tab_edits_rows.test.js` | 18 | the Edits tab holds hand edits and nothing else | B8 | stays, unchanged |

#### Files whose cases use the record only to build test data

| File | Cases | Record exports used | What happens |
| --- | --- | --- | --- |
| `active_filter.test.js` | 10 | KIND, STATE | stays, unchanged |
| `adopt_old_records.test.js` | 6 | STATE | stays, unchanged |
| `agent_liveness.test.js` | 35 | FIELD, KIND, STATE, newItem | stays, unchanged |
| `batch_reply_own_answers.test.js` | 24 | (through the file's own helpers) | stays, unchanged |
| `card_collapse.test.js` | 12 | FIELD, KIND, REPLY_STATUS, STATE | stays, unchanged |
| `catalog_reader.test.js` | 64 | KIND, STATE, newItem | stays, unchanged |
| `choice_anchor_rung.test.js` | 8 | (through the file's own helpers) | stays, unchanged |
| `choice_kernel.test.js` | 20 | STATE, newItem | stays, unchanged |
| `choice_press_hold.test.js` | 7 | KIND, STATE, newItem | stays, unchanged |
| `codex_monitor.test.js` | 15 | KIND, STATE, newItem | stays, unchanged |
| `comments_follow_move.test.js` | 23 | (through the file's own helpers) | stays, unchanged |
| `comments_surface.test.js` | 36 | FIELD, KIND, STATE | stays, unchanged |
| `compact_draft_history.test.js` | 19 | STATE | stays, unchanged |
| `done_tab_replies.test.js` | 54 | KIND, STATE | stays, unchanged |
| `draft_flush_cadence.test.js` | 15 | STATE | stays, unchanged |
| `each_page_comments.test.js` | 10 | KIND, STATE, newItem | stays, unchanged |
| `editing_surface.test.js` | 22 | KIND, STATE, newItem | stays, unchanged |
| `end_review.test.js` | 15 | FIELD, KIND, STATE, newItem | stays, unchanged |
| `fix_round_f3_projection.test.js` | 7 | (through the file's own helpers) | stays, unchanged |
| `fix_round_f3_service.test.js` | 3 | (through the file's own helpers) | stays, unchanged |
| `fix_round_f3_sync.test.js` | 5 | (through the file's own helpers) | stays, unchanged |
| `flow_fix_g2.test.js` | 4 | KIND, STATE | stays, unchanged |
| `free_writing_f1_fixes.test.js` | 2 | (through the file's own helpers) | stays, unchanged |
| `handled_check_run.test.js` | 15 | (through the file's own helpers) | stays, unchanged |
| `harness_stub_vocabulary.test.js` | 6 | FIELD, KIND, STATE | stays, unchanged |
| `held_release_clock.test.js` | 6 | FIELD | stays, unchanged |
| `helper_reads_only_the_tail.test.js` | 15 | FIELD, STATE | stays, unchanged |
| `hold_toggle.test.js` | 19 | KIND, STATE, newItem | stays, unchanged |
| `holder_tie.test.js` | 1 | (through the file's own helpers) | stays, unchanged |
| `launch_folder.test.js` | 5 | (through the file's own helpers) | stays, unchanged |
| `lean_agent_output.test.js` | 18 | FIELD | stays, unchanged |
| `linked_docs_mappers.test.js` | 4 | KIND, STATE, newItem | stays, unchanged |
| `log_run.test.js` | 2 | (through the file's own helpers) | stays, unchanged |
| `mark_done.test.js` | 8 | STATE | stays, unchanged |
| `menubar_summary.test.js` | 32 | KIND, STATE, newItem | stays, unchanged |
| `merge_run.test.js` | 5 | (through the file's own helpers) | stays, unchanged |
| `monitor_command.test.js` | 19 | FIELD, KIND, STATE, newItem | stays, unchanged |
| `no_stale_excuse.test.js` | 12 | FIELD | stays, unchanged |
| `one_review_per_file.test.js` | 9 | (through the file's own helpers) | stays, unchanged |
| `outbox_coalescing.test.js` | 12 | STATE | stays, unchanged |
| `oversized_records.test.js` | 8 | (through the file's own helpers) | stays, unchanged |
| `projection_incremental.test.js` | 14 | FIELD, KIND, STATE, newItem | stays, unchanged |
| `projection_review_json.test.js` | 22 | FIELD, KIND, STATE | stays, unchanged |
| `quiet_tab_polling.test.js` | 41 | (through the file's own helpers) | stays, unchanged |
| `rail_run_cards.test.js` | 16 | REPLY_STATUS, STATE | stays, unchanged |
| `rebuild_not_the_agents_job.test.js` | 26 | FIELD, KIND, STATE, newItem | stays, unchanged |
| `refused_not_replayed.test.js` | 5 | FIELD | stays, unchanged |
| `reopened_edit.test.js` | 6 | STATE | stays, unchanged |
| `replay_pass.test.js` | 61 | FIELD, STATE | stays, unchanged |
| `replay_run.test.js` | 9 | (through the file's own helpers) | stays, unchanged |
| `reply_command.test.js` | 11 | (through the file's own helpers) | stays, unchanged |
| `reply_folding.test.js` | 11 | STATE | stays, unchanged |
| `reply_seen.test.js` | 3 | STATE | stays, unchanged |
| `reply_toast.test.js` | 34 | FIELD, KIND, STATE, newItem | stays, unchanged |
| `reverted_edit.test.js` | 18 | FIELD, STATE | stays, unchanged |
| `review_binds_used_review.test.js` | 1 | KIND, STATE, newItem | stays, unchanged |
| `review_command.test.js` | 3 | (through the file's own helpers) | stays, unchanged |
| `review_follows_document.test.js` | 31 | (through the file's own helpers) | stays, unchanged |
| `review_format.test.js` | 35 | FIELD, KIND, STATE | stays, unchanged |
| `review_json_skip.test.js` | 5 | STATE | stays, unchanged |
| `review_retire.test.js` | 2 | KIND, STATE, newItem | stays, unchanged |
| `reword_not_handled_floor.test.js` | 5 | STATE | stays, unchanged |
| `run_refusal_real_route.test.js` | 2 | (through the file's own helpers) | stays, unchanged |
| `session_list.test.js` | 7 | STATE | stays, unchanged |
| `session_names.test.js` | 12 | FIELD, KIND, STATE, newItem | stays, unchanged |
| `sites_cli.test.js` | 7 | FIELD, KIND, STATE, newItem | stays, unchanged |
| `sites_mappers.test.js` | 23 | FIELD, KIND, STATE, newItem | stays, unchanged |
| `status_command.test.js` | 44 | KIND, STATE, newItem | stays, unchanged |
| `storage_quota_typing.test.js` | 11 | KIND, STATE, newItem | stays, unchanged |
| `store_item_cache.test.js` | 9 | STATE | stays, unchanged |
| `store_per_item.test.js` | 15 | STATE | stays, unchanged |
| `style_switch.test.js` | 24 | KIND, STATE, newItem | stays, unchanged |
| `summary_routes.test.js` | 20 | KIND, STATE, newItem | stays, unchanged |
| `sync_client.test.js` | 28 | KIND, STATE, newItem | stays, unchanged |
| `tab_edits_rows.test.js` | 7 | FIELD | stays, unchanged |
| `unanswered_prominence.test.js` | 27 | FIELD, REPLY_STATUS, STATE | stays, unchanged |
| `withdraw_from_ready_flush.test.js` | 2 | KIND, STATE, newItem | stays, unchanged |

## 6. Deliberate differences

None of these is something a reviewer or an agent would notice: no record field, no stored byte, no sentence an agent reads, no rail word and no CLI line changes. So none goes on the progress page as a departure. Each has a test.

- **D1. Eleven exports nothing reads go:** `emptyPage`, `itemCanCarryStamp`, `basenameOf`, `RUN_CODE`, `utf8Bytes`, `trimRunHistory`, `TOOL_ROUNDS`, `revertChangeText`, `CHOICE_CODE`, `normalizedBefore`, `normalizedAfter`. Where their behavior matters it stays reachable: `pageCanCarryStamp` (B48) for `itemCanCarryStamp`, `bumpRev`'s trimming (B56), `revertOf`'s sentences (B101), `utf8ByteLength` (B15); the rest had no reader. Test: B124's exact name list; `tsc` refuses an import of any of them.
- **D2. `record.blockText` goes.** It was `normalize.blockText` with a non-string read as `""`, under the same name as the function it wrapped, and `review_format.js` was its only caller. Its three call sites now call C2's `blockText` with that guard written in place, so a malformed block still reads as no words. Test: `review_format.test.js` and `export_text.test.js` unchanged (section 7).
- **D3. `historyEntry(item, at)`** replaces five positional arguments that every caller took from one record. Same entry. Test: B53.
- **D4. `takenBackIds` returns a `ReadonlySet` and `latestChoiceByGroup` a `ReadonlyMap`.** The old lookups were a plain object (inherited names such as `constructor` answered truthy) and a null-prototype object. Neither difference was reachable with real ids, so nothing a person sees changes; the types now say what the values are. Four call sites change (section 4). Test: B103, B123 (a group named `constructor`).
- **D5. `FIELD_CLASS` is keyed by every field name** instead of by dotted paths, and its type forces a class for each. `fieldClass` gives the same answer as before for every path. Test: B17 over every old path, B18.
- **D6. One source for three things spelled twice:** the reply statuses (`replies.ts`, re-exported by the record), the suggestion caps (from `run-limits.ts`), and the UTF-8 byte count (`utf8.ts`, shared with C4's `flush.ts`). Values unchanged. Test: B4, B14, B15.
- **D7. `randomId` no longer falls back to `require("node:crypto")`.** Node 24, the new floor, always has `globalThis.crypto`, and so does every supported browser; the fallback could not run, and `domain` cannot name `require`. The error when there is no generator is unchanged. Test: B32, B33.
- **D8. `validateItem` returns nothing.** It is an assertion function now; no caller used the record it returned. Test: B26, B31.
- **D9. `pageFrom` keeps only strings in `aliases`.** The old code copied the list as given; a non-string alias could never match in `samePage`, so the only difference is in the returned array. Test: B35.
- **D10. Inputs are typed, and only the absences callers send are accepted.** Every function that guarded against a missing record still answers `null`, `false` or `[]` for it (section 4, "Inputs"). Functions that did not guard (`isDraft(null)` threw a `TypeError`) take a record. Functions that coerced their input (`utf8Bytes(5)`, `followUp(item, 5)`) take the type their callers already pass. Test: the `null` cases in B8, B9, B11, B61, B63 to B65, B69, B70, B84, B86, B88, B91 and B92.

Known edges kept as they are, and recorded in the folder doc rather than changed: `pageKey` spells a missing origin as `"undefined"`; `pageFrom({href: "file:///"})` names the page `file:`; `validateItem` checks some fields and trusts the rest; `latestChoiceByGroup` and `handedOverBlocks` compare `created_at` as strings, which orders ISO times correctly and nothing else.

## 7. Fixed behavior tests touched

These must pass with what they assert unchanged:

- **Skill-wording tests** (`test/support/skill.js` users): `no_stale_excuse`, `add_command`, `mark_done`, `session_fixes`, `stable_addresses_docs`, `status_command`, `review_format`, `reply_command`. Five of them build records with `newItem`, `FIELD`, `KIND`, `STATE` and `FILE_ORIGIN`, and `mark_done` and `status_command` also call `isClosedByReviewer`, `isOutstanding`, `isReplayable`, `isUnansweredReady` and `isDraft`. None reads a removed or reshaped name.
- **`test/unit/review_format.test.js`**: the projection and the Copy text read `FIELD`, `STATE`, `STATES`, `FILE_ORIGIN`, `PLACEMENT`, `PLACEMENTS`, `TOOL_ROUND`, `NEW_BLOCKS_MAX_BYTES`, `CLASS_INSTRUCTION`, `CLASS_DATA`, `samePage`, `pageKeyFor`, `pageIdentityKey`, `pageIdentityKeyFor`, `pageCanCarryStamp`, `subjectHtmlOf`, `emptySlideContext`, `chronologicalThread`, `threadOf`, `isRunRecord`, `hasRunFields`, `isChoice`, `isChoiceToken`, `isClosedByReviewer` and, through D2's edit, C2's `blockText`. D2 is the only change on this path, and it gives the same text for every string.
- **`test/unit/export_text.test.js`**: the same paths through `review_format.js`.
- **CLI output:** `status_command.test.js`, `lean_agent_output.test.js`, `reply_command.test.js`, `monitor_command.test.js`, `session_list.test.js` and `session_names.test.js` build records with the forwarder; `status.js` reads `STATES`, `FILE_ORIGIN` and `isUnansweredReady`, and `reply.js` reads `applySuggestions` and `isRunRecord`, all unchanged.
- **Browser specs**, run at checkpoint 1:
  - those that read `LAHE.record` in the page: `active_filter`, `agent_replies`, `comments_highlights`, `edits_tab`, `element_subject`, `end_review`, `free_writing_host`, `free_writing_types`, `heading_context`, `oversized_records`, `print`, `selection_pill_drag`, `selection_popover`, and the page fixtures `test/fixtures/assets/cp2-mid-boot.js`, `editing-boot.js`, `rail-harness.js` and `replay-boot.js` (B125);
  - those that `require` the record in Node inside Playwright: `paragraph_break`, `each_page_comments`, `comments_follow_move`, `stable_addresses_mappers`, `replay_run_check`, `review_follows_document`, `replay_run_fix_round`, `replay_old_records`, `replay_run_insert`. These load the forwarder, which loads `.ts` files; C1's decision on `rail_menu.spec.js` (run it by name; move it to the bundle helper if Playwright will not load the forwarder) applies to them the same way;
  - the choice-button, replay, Done tab and free-writing specs, which drive these rules through the layer.
  Every other spec loads the bundle, so the full suite at the checkpoint is the real proof.

## 8. Source-text tests

- **`test/unit/fix_round_f3_record.test.js:150-153`** reads `src/shared/record.js` and asserts it holds no NUL byte (the old run key joined a tag and a text with a literal U+0000). After C3, `record.js` is a one-line forwarder, so the check would pass vacuously. The file moves with `git mv` to `test/unit/record_bridge.test.js`; this case stays in it, retargeted to read each of the twenty-two module files of section 1 plus `src/contract/utf8.ts`, and asserts none holds a NUL byte. Nothing else in the case changes. The same file gains B124's bridge cases. F1 removes it with the forwarder, after moving the NUL check to wherever F1 keeps source checks.
- **`test/browser/support/export_stub.js:35`** reads `record.js` as text to inject into a page. It is dead (nothing calls `installExportStub`) and already on C1's cleanup list; C3 does not change it.
- **Manifest readers:** lint's completeness check and `test/unit/lint_lua.test.js:46-50` read the manifest's lists. C3 changes only its own entry, the way S0c's `elapsed` pilot did.
- Nothing reads `record.js`'s comments, so moving them to the docs breaks no test.

## 9. Comments to move

The old file's comments hold the why of nearly every rule. What follows is drafted as the sections of `docs/ongoing/code/contract.md` and `docs/ongoing/code/domain.md`, one per new file, under the frontmatter and opening those docs already have (C1 creates `contract.md`; S0c creates `domain.md`). Each section opens with the file's `read-when` header, which the file carries too. `docs/ongoing/FREE_WRITING.md`, `CHOICE_BUTTONS.md` and similar subsystem docs only gain a link if they name a moved rule.

### For `docs/ongoing/code/contract.md`

#### `record.ts`: the record's shape

`read-when: Adding or renaming a record field, kind or state, or reading what a stored record holds.`

- **The one spelling.** Every field name in the tool is spelled here. Code imports `FIELD`; it never types the string.
- **Every field is present on every record** `newItem` builds, `null` when empty, so the merge never has to tell "absent" from "null" and an agent reading `review.json` sees a stable shape. The exceptions ride only when the input carries them, so every other record stays byte for byte what it was: the five free-writing fields and `choice`. `closed_by`, `closed_at`, `received_at` and `reply_seen` are lifecycle facts the helper sets from events (`item.closed`, the event's own receipt stamp, `reply.seen`); it never takes them from a record the browser posts, and `newItem` never copies `received_at`.
- **The kinds are closed.** `format_only` is its own kind because a formatting change is still a change and compares on structure, not on normalized text, whose job is to ignore formatting. `delete` is its own kind so a deleted block reads as a deletion, not an empty edit. A `choice` record's intent is its `choice` field, never words.
- **Exactly four states.** `question` is a reply status that leaves the item ready; `reopened` is a transition from handled back to ready. The transitions live in `domain/lifecycle.ts`.
- **The page fields group `review.json`.** The group key is origin plus path, never path alone: two dev servers serving `/dashboard` are two pages.
- **`handled_not_on_page`** is true when the agent replied handled and the built page does not show the edit's words: the claim was checked and failed, so the item is still the reviewer's work and still on the agent's drain list. False or absent everywhere else, including on items whose claim cannot be checked.
- **The region.** `ref` is the anchor engine's reference, opaque here (`RegionRef` names only the fields the record reads). `label` is display only, pinned at first touch. `lost` is `{code, reason, at}` once the subject cannot be found. `accepted_page_texts` and `check_reopen` belong to `domain/accepted-page-texts.ts` and `domain/page-check.ts`.
- **`context.subject`** is what the region is when the record was made on a whole element: `{tag, src, alt, html, near}`, or `null` for a passage of text. Every field is page text, so it is data.
- **An embedded source is stored once.** An image written into a page as a `data:` URL is the picture itself as text; storing it in `subject.src`, inside `subject.html` and inside the region's signature made one comment 516 KB, written again on every save. So `subject.src` keeps the value, the signature keeps a fixed-size name for it (C2's `embeddedName`), and `subject.html` carries `SUBJECT_SRC_REF` where the value was. `domain/subject.ts` puts it back for any reader. A record from before this carries the whole tag and no pointer, and reads unchanged.
- **`REPLY_STAMP_MAX`** bounds the stamp a `reply.seen` event may carry. A real stamp is an ISO time, `@` and a revision, far shorter.
- **A tool round** is an exchange the tool opened for the agent that the reviewer is not part of. The page check's stamp round is the only one.
- **The record is one interface, not a union per kind.** "A choice only on a choice record" is enforced by `validateChoice` at the helper's door and in the fold, because `newItem` builds a choice record without a `choice` and the door is what refuses it. A union would make `newItem` refuse that input.
- **`REPLY_STATUS` and `REPLY_STATUSES` are re-exported from `replies.ts`** so `record.REPLY_STATUS` keeps working for still-JavaScript callers. New code imports them from `replies.ts`. F1 removes the re-export.
- The event envelope, the `events.jsonl` line and the reply line are not here: they belong to `events.ts` and `replies.ts`, because things outside this repo read and write them.

#### `field-class.ts`: which fields are the reviewer's instruction (D12)

`read-when: Adding a field that carries text, or deciding whether an agent may act on a field's words.`

- "Instruction" means the reviewer wrote it and an agent should act on it. "Data" means it came off the reviewed page, or the tool wrote it; it is there so the agent can find the right place in the source, and it is never an instruction, whatever it says.
- **The intent channel is two fields, `note` and `change`, and that is the point.** A region's full `before` and `after` are the page's own words with the reviewer's change mixed in; carrying them as intent would let a document someone else sent ride a hidden instruction into the instruction channel on the back of the reviewer's edit. `change` names only what the reviewer did (`domain/change-text.ts`).
- **A choice's `group` and `answer` are instruction,** and bounded by the token grammar, so neither can carry prose. The group's question and heading ride in `context`, as data.
- **Earlier turns are data.** Only the current top-level note and change are intent; a round in `thread` is history, not an instruction to run again.
- The free-writing fields are data: the reviewer's new words are text to place, never an instruction. The page check's bookkeeping (`region.check_reopen`) and the accepted page states are data and are not projected at all.
- **Unknown paths are data.** Failing to data is the safe direction: a field a later change adds is page content until someone decides otherwise. `FIELD_CLASS` makes that decision explicit for every top-level field, and its type will not compile until a new field has a class.
- A brand for the reviewer's words on `note` and `change` was considered and left for the review-format slice: every record arrives as plain JSON, so the brand would need minting at every read, and the projection is where page text could be laundered.

#### `run-limits.ts`: how big a run may be

`read-when: Changing a free-writing ceiling, or a reply's proofreading bounds.`

- The ceilings come from the free-writing plan. The helper refuses an event over any of them, and the bar warns at 90 percent.
- `RUN_RECORD_MAX_BYTES` is half the helper's request body limit, leaving room for the event around the record.
- `RUN_HISTORY_KEEP`: history entries of a run record keep their run and markup only for the last three; older ones keep their words.
- **The reply caps are these numbers.** A hand-written reply line skips `lahe reply`'s check, and the rail applies a proofread's list on every paint, so `replies.ts` caps the count at one fix per block at the block ceiling and each `from` and `to` at the run's byte ceiling, which no real fix comes near. It imports them from here so they cannot drift. This module stands alone because `record.ts` imports `replies.ts`, and `replies.ts` importing the ceilings back from `record.ts` would be a cycle.

#### `utf8.ts`: UTF-8 byte length

`read-when: Measuring a string in bytes in contract or domain code.`

- `contract` and `domain` have neither `TextEncoder` nor `Buffer`, so this counts by code point, as `TextEncoder` would. A lone surrogate counts 3 bytes, because a browser's encoder writes it as U+FFFD. `flush.ts` and the run checks share it, so the keepalive limit and the run ceilings measure the same way.

#### `choice.ts`: choice presses

`read-when: Changing the choice-button grammar, its markup names or its states, or when a choice record is refused.`

- **The token grammar:** letters of either case, digits, hyphens, underscores, dots and colons, 1 to 64, starting with a letter or digit. Agents name answers after keys they already hold (`A_jev`, `optionB`, `v1.2`); refusing case or an underscore only sent the reviewer back to relay a formatting error. Still bounded so the intent field can never carry prose: no space, quote, bracket or slash, which also keeps the name safe inside a quoted attribute selector. It is checked in the browser, at the helper's door and in the projection. `CHOICE_TOKEN_RULE` is the grammar in words, for the rail's refusal chip.
- **The markup is spelled once** for the anchor engine's choice rung, replay's paint and the choices module. The group's name is not under the `data-lahe-` prefix on purpose: the tool strips that prefix from captured markup and from the element descriptions agents get, and the name has to survive both. The three attributes the layer writes (`data-lahe-pressed`, `data-lahe-choice-state`, `data-lahe-inert`) are the tool's own and live only in the DOM.
- **A choice record carries no `before`, `after`, markup, history, run fields or stamp:** there is nothing on the page for the agent to rewrite, and no stamp round should ever ask for a `data-lahe-id` on a button group. Its region reference is the choice rung's, `{kind, group}`.
- `CHOICE_STATE` is the rail's own words for a group, written to `data-lahe-choice-state`.

#### `item-check.ts`: the fail-loud check before a record is stored

`read-when: A record is refused before it is stored, or adding a rule every stored record must meet.`

- **Fail loud, and report every problem at once** rather than the first.
- **A draft is held to a lighter bar on purpose.** A draft is the reviewer mid-sentence, and refusing to store a half-written thought is the work-losing behavior this tool exists to remove.
- A missing `thread` is accepted for records made before threads existed; `threadOf` reads them as an empty thread.
- It checks the fields the rules name and trusts the rest, because only `newItem` and the revision functions build records. A full parse would refuse records the layer stores today.

### For `docs/ongoing/code/domain.md`

#### `mint.ts`: ids and timestamps

`read-when: Minting an id for a record or an event, or when two records share an id.`

- Ids are minted by the client, so a re-post after a dropped connection cannot double-count.
- A cryptographic generator is required. Missing entropy is an error, never a `Math.random` fallback: two items sharing an id is silent, permanent loss of the reviewer's work.

#### `page-identity.ts`: which page a record belongs to

`read-when: Records show up on the wrong page or vanish from the right one, or changing how a page is named.`

- **Query strings and fragments collapse away:** `/dashboard?tab=2` and `/dashboard#top` are one page.
- **A page opened from disk** carries origin `file` and its last two path segments: enough that two `index.html` files in two folders are two pages, and not so much that the reviewer's whole disk leaks into a group heading.
- **A review may span pages, and the layer only acts on the one it is loaded into.** Without `samePage`, a second page attached to a review inherited every record the first made: the layer re-anchored them, the rail listed them, the count pill counted them (78 foreign items on a one-pager). Foreign records are filtered, never deleted.
- **The rule is three rules.** Origin plus path, compared through `identityOrigin` so every spelling of a stable address (`<name>.lahe.localhost:<port>`, the port-80 forward, `<name>.lahe`) is one page; a path naming a directory is its index document, or a page served at the origin root had an empty name and the reviewer's items vanished on the next visit; and when either side is `file`, the last N segments, N being the shorter side's count, because one document is legitimately visited both from disk and served.
- **The residual case is accepted on purpose:** two documents whose last two segments agree, one opened from disk, match. A deeper tail would leak more of the disk into a heading, and hiding the reviewer's items on the document in front of them is the worse failure.
- **Aliases, path aliases and spellings come only from the script tag the helper wrote:** old origins of a stable address (a page once served on a random port), an old Markdown review's rendered-file path (read only with an old origin), and the page's other addresses in its review. `pageKey` keeps the origin as recorded, for display and `review.json`; every identity comparison goes through `identityOrigin`.
- `pageFrom` is pure so it can be tested with no browser: the layer passes `window.location`, the helper a parsed URL, a test a literal.

#### `stamp-source.ts`: can this source hold a stamp

`read-when: The page check asks for a data-lahe-id on a source that cannot carry one, or adding a template language.`

- An agent on a Markdown review answered that its source has no place for an attribute, and it was right: the contract had asked every agent for something impossible on a `.md` review, and the page check would have reopened every handled edit of every Markdown review once. So the stamp is expected only where the source is markup with attributes.
- The rule is a list of extensions rather than a guess about content, because a path is the only thing both the page check and the projection reliably have. The caller passes the source's path when the review knows one and the page's own path when it does not.

#### `item-revisions.ts`: making and revising a record

`read-when: Changing what a new record holds, how a rewording bumps the revision, or what replay's history compares against.`

- **Every rewording bumps `rev`, and replies name `(id, rev)`.** Lifecycle wins only for the revision a reply names, so a revision that does not move is how a stale "handled" swallows a rewording.
- **A reviewer's close names the revision it closed;** a new revision is new work, so `bumpRev` drops the mark.
- **The applied-`after` history** is what replay's third branch compares against: an earlier revision's text landed somewhere, so the current one is re-applied and the card says so. Without it, a record reworded twice falls into the fourth branch and flags a collision that is not one. A record built with an `after` starts its history with it.
- **The history dedupes on the field the record compares on.** A format-only record's text never moves, so deduping on text alone dropped every formatting revision and replay then flagged a false conflict on the reviewer's own change. A tag-only change of a run moves neither words nor markup, so the tag is checked too.
- **A run record's history is bounded:** only the last `RUN_HISTORY_KEEP` entries keep their run and markup.
- **`comparisonFields`:** a format-only record's `after` text is identical to its `before` by construction, so comparing it on text would make the branch a silent no-op. `priorAfters` takes the same field, so one history serves both modes. Every caller asks these rather than testing the kind, so no second rule can grow.

#### `item-status.ts`: what state a record is in, for every surface

`read-when: A count, a list or a badge disagrees with another about which items are waiting.`

- **`isUnansweredReady` is the one definition of work an agent should act on:** ready and carrying no reply. The rail's "no agent watching, 3 waiting" and the drain command's list must count the same items, and they stopped agreeing the moment a route spelled the rule a second time. A handled claim the page does not bear out is not an answer: it is the one reply that leaves the work where it was, so the agent hears its change did not arrive.
- **Outstanding and replayable are different questions.** Outstanding is still in front of the reviewer (ready or not_handled; a handled item is kept and reopenable). Replayable is only ready: a not_handled card keeps the reviewer's words on the card, and writing them back after every repaint is how a refused card kept old lines inside a table the agent built on request. A tool round is not replayed either, because the reviewer's card still reads handled.
- **Closed by the reviewer** counts only at the current revision; a reworded or reopened item dropped the mark.

#### `tool-round.ts`: rounds the reviewer is not part of

`read-when: The rail shows, or hides, a page-check exchange, or a card sits in the wrong tab.`

- The page check asking an agent for a `data-lahe-id` is right for the agent and wrong for the reviewer: it is plumbing the reviewer never typed and cannot act on. So a revision the tool opened says so, and the rail draws nothing for it: no round in the thread, no notice, no unseen mark, no toast, and the card stays in the tab the reviewer last saw it in. `review.json` still carries the round and its note, because the agent is who it is for.
- The round stays a tool round once the agent answers, because the answer belongs to the round that asked. Any later revision (a rewording, the reviewer's own reopen, another check) moves the revision past the stamp and ends it.
- **`displayState`** is the one rule the rail's pane placement and its state chip both read: while a tool round is open the reviewer's card says handled, because their decision has not changed.

#### `thread.ts`: the reviewer and agent exchange

`read-when: Changing follow-up, reopen, or how an answered turn becomes history.`

- The current exchange stays in `note`, `change` and `reply` until the reviewer continues it; completed exchanges are archived in `thread`, oldest first.
- **One helper archives and continues,** so Follow up and Reopen issue cannot drift. `continueOnto` is the same for a revision that already carries new words ("Use the fixes"): exactly one revision past the item either way.
- **A follow-up carries the change sentence.** It describes the edit the reviewer made, and a follow-up does not undo the edit; dropping it left the one revision where it mattered saying nothing about what the reviewer did.
- **The thread is read in time order** wherever it leaves the record. The stored array is normally append-only already; sorting at the boundary gives imported and legacy records one order, and equal or missing times keep their stored order.
- **A proofread question keeps its fixes when it becomes history,** so the revision "Use the fixes" makes still says, in `review.json`, which words changed to which.
- **Earlier answers stay on the current turn** (`previous`), and a replayed fold does not add the answer the browser already holds a second time.

#### `page-check.ts`: the page check's sentence and its stamp

`read-when: The page check reopens an item, its sentence repeats in a note, or a reviewer sees tool text on their card.`

- **The incident:** a reviewer split a list item and added a sentence; the agent applied it as a new item, a legitimate reading. The check then read the record's `after` as missing and its `before` as still there, called it a revert and reopened. The agent replied handled; the check reopened again. Thirteen revisions in thirty-six minutes, each waking the agent and appending another copy of the same sentence.
- **The fix is one fact on the record:** which revision the check itself created. When the agent answers that revision handled and the page still reads the same, the check is looking at its own reopen coming back, and stays quiet. Any later revision moves past the stamp, so a genuine revert months later is still caught. `stamp` records which reply the check acted on, for a person reading storage.
- **The sentence says it is tool-generated in its own first words,** because the record has no field for "this text is not the reviewer's", and it names no page content: repeating page text into the note would push it into the intent channel.
- The stamp round is the check's only reopen. The legacy sentence is no longer written, but stored records may carry many copies of it, so `collapsePageCheckNote` still reads it, on the way out of storage, so those cards recover on the next reload.
- `appendNoteOnce`: the loop appended the same sentence thirteen times because the append asked nothing about what was there.
- **`reviewerNote`** takes the stamp sentence back out for the card. A sentence an older check wrote about the reviewer's own words is kept: those rounds were the reviewer's business.
- `stampPageCheckReopen` writes a new region object rather than changing the old one, like every region stamp, so a caller holding the previous region sees what it read.

#### `reply-unread.ts`: the unread rule

`read-when: The "1 new" tag, the menu bar's "waiting on you" or a toast counts a reply it should not, or misses one.`

- **One rule, because two surfaces count with it:** the rail's "1 new" tag and the menu bar's "waiting on you". A second copy in the helper would be a count that disagrees with the rail the first time either changes.
- **Two things count.** The agent said so (`user_needs_to_see_reply`, which the skill asks for on an answer, a caveat or a change made differently than asked) and there are words to read; or the status says so: a question and a not_handled always count, flag or no flag.
- **The flag needs words behind it.** A flagged reply with neither text nor reason sends the reviewer to a card to learn nothing, and agents that flag one wordless confirmation flag twelve, so the badge stops meaning anything. The ask is refused here; the reply is not hidden, only already read. Questions and refusals are not held to this: the status alone is the signal, and swallowing a wordless refusal would leave the reviewer thinking their item was done.
- An answer to a tool round is routine by definition. A card the reviewer closed is read: closing it is acting on it.
- **The stamp is the reply's time and the revision it answered,** because an item answered, reopened and answered again must read as a different reply the second time; a boolean cannot carry that. A mark for an older reply never clears a newer one. The helper's `reply_seen` comes from `reply.seen` events any browser posted; a browser's own marks come from its storage.

#### `accepted-page-texts.ts`: what Keep mine remembers

`read-when: A collision the reviewer already answered with Keep mine comes back.`

- The reviewer's decision has to survive the next repaint. Writing their version once is not enough: the page's source still says the agent's sentence, so the next morph renders it again and replay raises the same collision forever. So the record remembers which page states the reviewer already answered, and replay treats them like the `before` and re-applies the current `after`.
- **Add-only,** because a decision the reviewer made is not something a later pass un-makes. **Bounded,** because a page whose source churns (a feed, a clock) would otherwise grow the record on every pass. The newest states are kept; an old one falling off means it may ask once more, which is honest.
- `before` is never touched: it is the agent's diff base.

#### `subject.ts`: the whole-element subject

`read-when: A comment on a whole element is weighed against the wrong text, or an agent gets an image tag without its source.`

- **Only a comment on a passage is weighed** against its quote. A comment on a whole element saved the element's whole text as its quote; the element is the region however much it grows, and weighing the agent's expanded version against the old text refused a correct find.
- `subjectHtmlOf` hands every reader the same opening tag it always got, with the embedded source put back in place of the pointer.

#### `change-text.ts`: the change sentence for a hand edit

`read-when: The sentence an agent reads about a hand edit is wrong, misleading or missing emphasis.`

- **Why it exists:** an edit commits with no note typed, so without this its only intent field is empty and the agent is left reading the data-class `before` and `after` it is told never to treat as instructions. The whole `after` is not the answer either, since it is mostly the page's words. So `change` names only what the reviewer did, in one short line, carried verbatim and never truncated.
- **The span is widened to whole words.** A reviewer pasted a paragraph above one that began "A friend asked"; both start with "A", so the sentence reported an addition beginning mid-word and ending on a stray letter. Retreating each boundary to the nearest non-word character costs a few characters of precision and buys a sentence that says what happened.
- **A whole paragraph added above or below is said as that,** naming the paragraph it sits against by its first words, so the agent knows where to put it. It fires only when the block's whole previous text is still there, in one piece, with a paragraph break between; a split or a reword falls through to the span.
- **A typed break is said in words,** because quoting it would print a newline inside quotes, where nobody can see it.
- **Formatting is said too.** A reviewer made one word italic and one clause bold inside a rewrite; the sentence quoted only the wording, the agent applied the text alone, and the emphasis was gone from page and source with nothing saying so. The vocabulary is the normalizer's closed list, read through its emphasis runs, so a link, a span or a class a renderer added can never be reported. Taking bold off words a stylesheet made bold writes a reset and loses the tag at once; one gesture, so one sentence.

#### `revert.ts`: taking a handled change back

`read-when: An undo of a handled edit, delete, format change or run asks the agent for the wrong thing.`

- **An undo of a handled edit mints work.** The reviewer's page goes back to the original wording, which leaves the source holding a change nobody wants; the next rebuild would put it back, and the agent would never hear it was taken back. The record it makes is an ordinary outstanding hand edit pointing the other way, so everything already built reads it without a special case.
- **Not a new kind:** kind decides how a record compares and how a row reads, and a revert compares exactly like the edit it undoes (a format-only revert must compare on structure). `reverts` carries which handled item it takes back, as an id the agent can find in the same file.
- **The handled record is kept:** it is the record that a fix landed and the only place the applied wording is written down, and replay's page check skips an item another record reverts.
- **A reverted delete is an edit:** it puts words back, and comparing it as a delete would make it idempotent by absence.
- **A run's take-back** names the placed blocks in `remove_blocks` and never carries `new_blocks`, so replay can never put the run back. A retag is undone by the old tag riding back as the take-back's own `anchor_tag_after`, so the existing skill line and replay's tag step both act on it; the old tag is the one the anchor engine minted.

#### `run-record.ts`: a free-writing sitting

`read-when: Changing how a free-writing run is recorded, viewed by replay, sized, or described to the agent.`

- One sitting is one edit record: an existing anchor block plus a run of new sibling blocks after it. `before`, `after` and `after_html` keep their meaning for the whole sitting; the record adds the anchor's own markup, its new tag, the run, and where the run goes.
- **Replay's anchor view** reads `anchor_after_html` in place of `after_html`, so the anchor compare never writes the run into the anchor.
- **Handed-over blocks.** Once the agent placed a run, its blocks are the page's own, and a new sitting on one of them is a record of its own whose anchor is that block; from then on the block's words are that record's to change. Without this, the placed run read the block's new words as its own going missing, told the agent to reapply, and raised a "Which version stands?" card between the reviewer's two versions.
- **The change text names structure only** and never quotes a block's words. No rule is restated in it; those are skill lines, read once.

#### `run-check.ts`: the helper's check on a free-writing record

`read-when: The helper refuses a free-writing event, or changing what a run record may hold.`

- **The helper refuses rather than cleans,** so a forgery shows up: stored markup is exactly what `cleanBlock` writes, and anything else is not something the layer sent. It runs at the door (`log.append`) and again on every line the fold reads, because a line already in the log, from an older helper or written into the file by hand, never passed the door.
- **Sizes before the parse:** measuring is linear, parsing nested tags is not, so the byte ceiling bounds `cleanBlock`'s work.
- **The whole sitting is checked:** `after_html` and `after` must be exactly the anchor's markup plus the run, and the anchor's markup must be clean, so every markup field an agent may apply has passed the same allowlist as the run.
- A take-back's `before_html` is the sitting it undoes: clean anchor markup followed by exactly the blocks it removes.

#### `proofread.ts`: Use the fixes

`read-when: The reviewer's "Use the fixes" changes the wrong words, loses formatting, or is refused.`

- The agent's proofreading suggestions become the reviewer's own reword of the same record, at a new revision. Words change inside text only, so each block keeps its bold and italic; a fix that spans a tag leaves the tag on the words it still covers.
- **A `from_anchor` block is never rewritten:** it is the anchor's own tail, the page's words, not the reviewer's.
- The change text says what to do in the source and where the fixes are listed; it quotes no words.

#### `choice-state.ts`: what a choice group shows

`read-when: A choice group on the page shows the wrong state or the wrong press.`

- The current press for a group is the record with the latest `created_at`, not the highest revision: a newer press after a handled one is a new item.
- A press still in the outbox shows as kept until the helper has stored it.

### Dropped as dead history

- Owner and task codes: `0A-kernel`, `0A-wire`, `1A` to `3A`, `1B`, `1C`, `1D`, `2A`, `2C`, code lead 21, CR 3, CL 2, CL 16, SR 1 to 3, ADV 4, AQ4, design calls 4 and 6, security reviews 1 to 4 and 8, finding 11, flow walk Fail 2.
- Review ids, dates and names attached to incidents (`rbbe2de599404`, `rec7752d7cefe`, `r9d5cbe5ebc64`, the 2026 dates, "Ken, live"). The incidents themselves are kept above, as reasons.
- The note that the module is dual-environment and how its wrapper loads; the "dead send model" fields; the comment that the page check once wrote tag, run and take-back sentences (B78 pins that they are gone).
- JSDoc parameter and return comments: the signatures say it now.

## 10. Open questions

Decided here, unless the orchestrator says otherwise:

- **The record's logic is seventeen domain modules, not one `record-rules.ts`,** because it is seventeen jobs with their own callers, and two of them must be separate to avoid an import cycle (`tool-round` and `page-check`).
- **The record stays one interface** (section 4).
- **No brand for item ids or for the reviewer's words;** `ChoiceToken` is the one brand, because only the choice grammar carries a security meaning these modules can check.

For the orchestrator:

1. **C3 also depends on C4.** It edits C4's `replies.ts` (two constants) and `flush.ts` (one import), re-exports `REPLY_STATUS` from `replies.ts`, and imports `isJsonObject` and `Suggestion`. Please add C4 to C3's "Waits on" in the plan. If C3 must start first, the fallback is to create `run-limits.ts` and `utf8.ts`, define nothing reply-related, and leave the two C4 edits as a follow-up commit once C4 lands.
2. **Four call sites in other slices' files change** (section 4: `review_format.js`, `editing.js`, `replay.js`, `choices.js`). Each is a one-line edit at a renamed or reshaped export, which the plan allows; listed so the orchestrator can resolve line conflicts at merge.
3. **The nine Playwright specs that `require` the record in Node** follow C1's decision on `rail_menu.spec.js`. If C1 found that Playwright will not load the forwarder, the C3 builder moves these to the bundle helper, and C3 owns that change.
4. **`record_bridge.test.js` stays JavaScript until F1,** because a `.ts` test cannot import the forwarder. F1 removes it with the forwarder and keeps its NUL check somewhere that reads the final files.

## Cleanup needed

Nothing new. `test/browser/support/export_stub.js` is already on C1's list.

## Orchestrator decisions (2026-11-12)

1. **C3 waits on C4 as well as C2.** It edits C4's `replies.ts` and `flush.ts` to import the run limits from `contract/run-limits.ts`. The plan's slice table now says so.
2. **The nine Playwright specs that load the record from Node** follow the C1 decision for `rail_menu.spec.js`: the builder runs each by name, and points any that cannot load through the forwarder at S0c's bundle helper. C3 owns those changes.
3. **The four one-line edits in other slices' files** (the `historyEntry`, `takenBackIds`, `latestChoiceByGroup` and `FIELD_CLASS` callers) are C3's, in the same pull request. The orchestrator resolves any line conflict when it merges.
4. **A lost anchor's reason may be `null`.** The region rules write it (found by the C5 spec), so the type allows `null`.
