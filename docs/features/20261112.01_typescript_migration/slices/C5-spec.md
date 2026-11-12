---
read-when: Building or reviewing slice C5 of the TypeScript migration.
---

# C5 spec: the lifecycle, the review format, the browser-only rules and the test fixtures

C5 finishes the contract wave. It rebuilds the item lifecycle and the review format as domain modules both sides run, moves the three rules only the browser runs (the merge, region labels, the uniqueness predicate) into the review layer, takes the record fixtures out of the shipped bundle and into `test/support/`, and removes the `contracts.js` barrel. Every dependency comes from C1 to C4 and is used with the names and signatures their specs give.

Counts in this spec came from scripts in the session scratchpad (`specs/`): `c5_counts.py` (line counts), `c5_usage.py` (which file reads which export, comments stripped), `c5_fixtures.py` (fixture users), `c5_cases.py` (every test case and the exports it reads) and `c5_map.py` (section 5's tables). Exact strings and key orders marked "pinned" were read by running the old code (`c5_probe.js`, `c5_probe2.js`) before the orchestrator stopped all node runs for the checkpoint suite; nothing was run after that.

## 1. Scope

**Old files.** First-non-space comment definition, as in the recon.

| File | Lines | Comment | Blank | Code | Exports |
| --- | --- | --- | --- | --- | --- |
| `src/shared/lifecycle.js` | 407 | 136 | 22 | 249 | 18 |
| `src/shared/review_format.js` | 1,112 | 385 | 63 | 664 | 27 |
| `src/shared/merge.js` | 235 | 84 | 18 | 133 | 5 |
| `src/shared/regions.js` | 236 | 92 | 11 | 133 | 10 |
| `src/shared/uniqueness.js` | 234 | 95 | 17 | 122 | 7 |
| `src/shared/record_fixtures.js` | 536 | 65 | 41 | 430 | 3 (17 more on the object `createFixtures` returns) |
| `src/shared/contracts.js` | 40 | 19 | 3 | 18 | 15 (re-exports) |

**New modules.**

| Module | Job |
| --- | --- |
| `src/domain/lifecycle.ts` | The four item states, who may move an item between them, and what one reply does to one item |
| `src/domain/review-bounds.ts` | How page text and agent text are bounded before anyone reads them, with the bound visible in the value |
| `src/domain/review-pages.ts` | Which page group each item belongs to, and which source file each group tells the agent to edit |
| `src/domain/review-json.ts` | The `review.json` projection an agent reads, and its bytes |
| `src/domain/review-text.ts` | The human-readable Copy and Export text |
| `src/browser/review-layer/storage/merge.ts` | Browser storage against the server's store for one item: browser wins on content, store wins on lifecycle per revision |
| `src/browser/review-layer/anchoring/regions.ts` | A region's display label, pinned at first touch, and the lost state a failed mint leaves |
| `src/browser/review-layer/anchoring/uniqueness.ts` | Whether an anchor match is safe to write to: a unique text candidate, never a score |
| `test/support/data/record-fixtures.ts` | Realistic, deterministic records for tests |
| `test/support/data/uniqueness-corpus.ts` | The fixture corpus the predicate and the anchor engine are both judged against, and its reference candidate builder |

`review_format.js` splits in four by job; the other four source files each become one module. `test/fixtures/uniqueness_corpus.js` moves with `git mv` to `test/support/data/uniqueness-corpus.ts` and takes `buildCandidates` out of `src/` with it (D8).

**Why `test/support/data/` and not `test/support/` (target layout row).** A `.ts` file with `import` syntax needs a `{"type": "module"}` `package.json` in its folder (`docs/ongoing/code/README.md`). `test/support/skill.js` is CommonJS and has eight users, so `test/support/` itself cannot take that `package.json`. A subfolder can, the same way `test/unit/server/` and `test/unit/domain/` do. Open question 3 asks the orchestrator to confirm.

**Bridges until F1.** Forwarders at the six old paths (B107), bundle registrations for the five browser-loaded names (B108), `LAHE.record_fixtures` removed from the bundle.

**New TypeScript project.** `test/support/tsconfig.json` (lib `es2024`, types none, outDir `../../.tsbuild/test/support`, `"files": []`, `"include": ["**/*.ts"]`, references `src/contract` and `src/domain`), added to the root `tsconfig.json` and to `test/unit/tsconfig.json`'s references, with an ESLint `no-restricted-imports` block forbidding `server`, `cli` and `browser`, and a row in the projects table of `docs/ongoing/code/README.md`. New `{"type": "module"}` files: `test/support/data/package.json`, `test/unit/browser/package.json`, `test/unit/support/package.json`. `src/browser/review-layer/` gets its first `.ts` files and needs no config change (its project already exists with `"files": []`).

**Docs the slice edits.** Its own sections of `docs/ongoing/code/domain.md`; new `docs/ongoing/code/browser-review-layer-storage.md`, `browser-review-layer-anchoring.md` and `test-support.md` (section 9); in `docs/CONTRACTS.md`, the sections "The lifecycle" and "The merge rule" (rewritten to B2 to B19 and B76 to B84, which also fixes their stale transition table) and the path mentions at lines 64, 134, 367, 372, 390, 536 and 1379; the README projects table and its "Tests in TypeScript" sentence that says a `.ts` test must build records as literals (it can now import `test/support/data/record-fixtures.ts`).

## 2. Behavior

Statements cite C1 to C4 by their own numbers ("C3 B64"). "Throws X" means an `Error` (or `TypeError` where named) whose message is exactly X. A key order is part of the behavior wherever it reaches JSON bytes.

### `src/domain/lifecycle.ts`

- **B1.** `ACTOR` is `{REVIEWER: "reviewer", AGENT: "agent", HELPER: "helper"}`.
- **B2.** The reviewer's moves, and `canTransition(from, to, "reviewer")` is true for exactly these: draft to draft, ready, not_handled; ready to ready, draft, handled; not_handled to draft, ready, handled; handled to ready.
- **B3.** The agent's moves, and `canTransition(from, to, "agent")` is true for exactly these: ready to handled, ready to not_handled.
- **B4.** The helper has no move: `canTransition(from, to, "helper")` is false for all sixteen state pairs. Every pair not in B2 or B3 is false for its actor (for example handled to draft by the reviewer, draft to handled by the agent, not_handled to handled by the agent).
- **B5.** `assertTransition(from, to, actor)` returns `to` when B2 or B3 allows the move; otherwise it throws `illegal lifecycle transition: <from> -> <to> by <actor>. Legal transitions are listed in src/domain/lifecycle.ts`.
- **B6.** `canDelete(state, actor)` is true only for the reviewer and the states draft, ready and not_handled. Handled is false, and every state is false for the agent and the helper.
- **B7.** `canClose(item)` is true when the reviewer may move `item.state` to handled (ready, not_handled) and false for draft, handled, `null` and `undefined`.
- **B8.** `closeItem(item, at)` returns a new record and leaves `item` untouched: every field as it was (`rev`, `reply`, `thread` included), then `state: "handled"`, `closed_by: "reviewer"`, `closed_at` set to `at`, or to the current ISO time when `at` is missing, `null` or `""`, and `handled_not_on_page: false`. Keys the input had keep their place; `closed_by` and `closed_at` are added at the end when absent.
- **B9.** `closeItem` on a draft or a handled item throws B5's message for that state to handled by the reviewer.
- **B10.** `undoTakesBack(item)`: handled is true; not_handled is false; draft and ready are true when the item carries a non-null `reply` or its thread (C3's `threadOf`) has at least one round, else false; `null` and `undefined` are false.
- **B11.** `replyApplies(item, rev)` is true exactly when `rev === item.rev`. A non-number `rev` from a JavaScript caller is false (D4).
- **B12.** `applyReply(item, reply)` decides in this order and returns at the first rule that applies. A `status` that is not handled, not_handled or question gives `{accepted: false, state: item.state, refusal: "unknown reply status <String(status)>"}`.
- **B13.** An item the reviewer closed (C3 B64) gives `{accepted: false, state, refusal: "the reviewer marked this item done; it takes no reply"}`, whatever `rev` and `status` say.
- **B14.** `reply.rev !== item.rev` gives `{accepted: false, state, refusal: "reply names rev <rev> but the item is at rev <item.rev>; the reviewer reworded it, so it stays outstanding"}`.
- **B15.** A draft gives `{accepted: false, state, refusal: "the item is a draft (the reviewer is still writing or rewording it); only a ready item is actionable"}`.
- **B16.** A question gives `{accepted: true, state: item.state, refusal: null}`, from any state B12 to B15 let through, ready, handled or not_handled.
- **B17.** Handled with `page_shows_change` exactly `false` gives `{accepted: true, state: item.state, refusal: null, not_on_page: true}`. Any other value of `page_shows_change` (absent, `null`, `true`) is the ordinary rule.
- **B18.** Otherwise the target is handled for a handled reply and not_handled for a not_handled one. When B3 allows the agent that move from `item.state`, the result is `{accepted: true, state: target, refusal: null}`; when not, `{accepted: false, state, refusal: "an agent may not move an item from <item.state> to <target>; only a ready item is actionable"}`.
- **B19.** The result keys are `accepted`, `state`, `refusal` in that order, and `not_on_page` last only in B17. The reply's other fields (`agent`, `reason`, `text`, `files`) never change the decision.

### `src/domain/review-bounds.ts`

- **B20.** `BEFORE_MAX` 2000, `CONTEXT_MAX` 400, `REPLY_TEXT_MAX` 20000, `REPLY_FILES_MAX` 100, `AFTER_HISTORY_MAX` 50, `TRUNCATION_MARKER` `"[... bounded here. {n} more characters of page text.]"` (pinned).
- **B21.** `truncationMarker(n)` is the marker with `{n}` replaced by `String(n)`.
- **B22.** `boundData(value, max)`: `null` and `undefined` give `null`; any other value becomes `String(value)`; text no longer than `max` (default `BEFORE_MAX`, lengths in UTF-16 code units) comes back unchanged; longer text is its first `max` characters, a space, and `truncationMarker(length - max)`. `Infinity` never bounds. Ex: `boundData("abcdef", 3)` is `"abc [... bounded here. 3 more characters of page text.]"`; `boundData(5, 3)` is `"5"`; `boundData("")` is `""`.
- **B23.** `boundFiles(files)`: a non-array gives `[]`; otherwise the string entries in order, non-strings skipped, stopping once 100 are kept, each bounded at `CONTEXT_MAX`.
- **B24.** `boundHistory(history)`: a non-array gives `[]`; otherwise the last 50 entries (the cap applies before anything is skipped), skipping entries that are not objects, each as `{rev, after, after_html, at}`: `rev` when a number else `null`, `after` and `after_html` bounded at `BEFORE_MAX`, `at` when truthy else `null`.

### `src/domain/review-pages.ts`

- **B25.** `requireReview(review)`, which `projectReview` and `renderText` both call first: a value that is not an object, or is `null`, throws `TypeError` `expected a review object`; an `id` that is not a non-empty string throws `review.id is required`; `items` that is not an array throws `review.items must be an array; the projection groups items by page itself`.
- **B26.** `isLinkedPage(path)` is true when `path` is a string starting with `/.lahe-source/`, or whose `decodeURIComponent` starts with it; a string that does not decode, and any non-string, is false.
- **B27.** `pageGroups(items, aliases)` puts each item in a group keyed by C3's identity key: `pageIdentityKeyFor({origin: alias, path: item.page_path})` when `aliases` has an own, non-empty entry for the item's origin, else `pageIdentityKey(item)`. Every spelling of one stable address is one group; two served origins with one pathname are two. `aliases` that is missing or not an object reads as empty.
- **B28.** An item whose key matches no group joins the first existing group, in creation order, that C3's `samePage(item, group)` calls the same page (the file:// rule); only when none does is a new group made.
- **B29.** A new group starts as `{key, origin: alias or item origin, path: item.page_path, title: item.page_title or null, first_seq: page_seq when a number else null, arrival: the item's index, hint: item.source_hint or null, file_origin_seen: item origin is "file", items: []}`, in that key order.
- **B30.** When an item served over a non-file origin joins a group whose displayed origin is `"file"`, the group's displayed origin becomes the item's alias or origin and its path the item's path. Any file:// item sets `file_origin_seen` true.
- **B31.** Across a group's items: `title` is the first non-empty title; `hint` is replaced by an item's non-null hint only while the group's hint is not known (`known === true` with a truthy `path`), so a known hint never loses; `first_seq` is the smallest numeric `page_seq`.
- **B32.** Groups sort by `first_seq` ascending; groups with no `first_seq` come after the rest, by arrival; equal `first_seq` by arrival. After sorting each group's `key` is C3's `pageKeyFor({origin, path})` of what it displays.
- **B33.** `movedHint(review, hint)` returns `hint` unchanged unless `review.moved_hints` is an object with an own entry for the hint's path (the hint itself when it is a string, else `hint.path`); then a string hint becomes the mapped path and an object hint becomes a copy with `path` replaced.
- **B34.** `pageSourceFor(review, group)`: for a linked page (B26) it is `{linked: true, hint}` where `hint` is `{known: true, path}` when `review.linked_files` has an own non-empty string for the group's path, else `null`; the page's own claim and the review-wide hint are never used. Otherwise it is `{linked: false, hint}` where `hint` is the moved group hint, else the moved `review.source_hint`, else `null`.

### `src/domain/review-json.ts`

- **B35.** Pinned constants: `SCHEMA` `"lahe.review/5"`; `FILE_NAMES` `{json: "review.json", events: "events.jsonl", replies: "replies.jsonl"}`; `TEMP_SUFFIX` `".tmp"`; `PROOFREAD_MIN_WORDS` 150; `INTENT_FIELDS` `["note", "change"]` (C3's, re-exported); `PROJECTED` maps `NOTE`, `CHANGE`, `QUOTE`, `BEFORE`, `AFTER_FULL`, `CONTEXT`, `BEFORE_HTML`, `AFTER_HTML`, `REGION_LABEL`, `REGION`, `SUBJECT`, `AFTER_HISTORY`, `THREAD`, `NEW_BLOCKS`, `ANCHOR_AFTER_HTML`, `REMOVE_BLOCKS`, `ANCHOR_TAG_AFTER`, `PLACEMENT`, `RUN_WORDS`, `PROOFREAD`, `CHOICE` to their snake_case strings; `DATA_FIELDS` is `quote, before, after_full, context, before_html, after_html, region_label, region, subject, after_history, new_blocks, anchor_after_html, remove_blocks` in that order.
- **B36.** `PROJECTED_FIELD_CLASS` is these 48 keys in this order, `"instruction"` for the first four and `"data"` for the rest (pinned): `note, change, choice.group, choice.answer, quote, before, after_full, context, before_html, after_html, region_label, region, subject, after_history, new_blocks, anchor_after_html, remove_blocks, anchor_tag_after, placement, run_words, proofread, title, origin, path, reply.agent, reply.reason, reply.text, reply.at, reply.user_needs_to_see_reply, handled_not_on_page, closed_by_reviewer, thread[].rev, thread[].reviewer.note, thread[].reviewer.change, thread[].reviewer.at, thread[].agent.status, thread[].agent.agent, thread[].agent.reason, thread[].agent.text, thread[].agent.files, thread[].agent.at, catalog_requests[].title, catalog_requests[].path, catalog_requests[].candidate, catalog_requests[].folder, catalog_requests[].handoff, thread[].agent.proofread, thread[].agent.suggestions`.
- **B37.** `projectReview(review)` returns keys `schema, generated_at, review, field_classes, intent_fields, counts, pages`. `generated_at` is `review.generated_at` when truthy, else the current ISO time. `review` is `{id, agent_session_id: value or "legacy", started_at: value or null, ended_at: value or null, notes: notes === true}`. Nothing else is in the projection: no contract text, no command.
- **B38.** `field_classes` and `intent_fields` are fresh copies; changing them changes no later projection.
- **B39.** `counts` is `{total, draft, ready, handled, not_handled}` in that order: the item count and the count per state; an item in no known state counts only in `total`. `countItems(review)` returns the same object.
- **B40.** `pages` has one entry per group (B27 to B32) with keys `key, origin, path, title, source_hint, linked_file, file_origin_seen, items`: `title` bounded at `CONTEXT_MAX`; `source_hint` is `{known, path}` from B34's hint, `known` true only for an object hint with `known === true` and a truthy `path` (a string hint reads as unknown), `path` the object's path bounded at `CONTEXT_MAX` or `null`; `linked_file` is the hint's path for a linked page with a mapping, else `null`; `file_origin_seen` a boolean.
- **B41.** Each page's items are `projectItem(item, pageSourceFor(review, group), {notes: review.notes === true})`, in the group's order.
- **B42.** A projected item's keys, in order: `id, rev, kind, state, reverts, note, change, thread, quote, before, after_full, context, subject, before_html, after_html, new_blocks, anchor_after_html, remove_blocks, anchor_tag_after, placement, run_words, proofread, region_label, region, after_history`, then `choice` on a choice item only, then `lost, reply, handled_not_on_page, closed_by_reviewer, reviewer_last_changed_at, card_first_created_at, waiting_since` (pinned).
- **B43.** `id`, `rev`, `kind` and `state` are the record's; `reverts` is the record's or `null`.
- **B44.** `note` and `change` are carried verbatim, never bounded: a string as is, `undefined` as `null`, any other value as it is.
- **B45.** `thread` is C3's `chronologicalThread(item)`, each round as `{rev, reviewer: {note, change, at}, agent: {status, agent, reason, text, files, at}}`: reviewer `note` and `change` verbatim (B44), `at` or `null`; agent `status` or `null`, `agent` bounded at `CONTEXT_MAX`, `reason` and `text` at `REPLY_TEXT_MAX`, `files` through B23, `at` or `null`. A round whose agent part has `proofread: true` adds `proofread: true` and `suggestions`, each `{block: number or null, from, to}` with `from` and `to` strings bounded at C3's `NEW_BLOCKS_MAX_BYTES` or `null`.
- **B46.** `quote` is the context's quote bounded at `BEFORE_MAX`; `before` and `before_html` likewise; `after_full` and `after_html` are bounded at `BEFORE_MAX`, except on a run record (C3 B11), where they are whole.
- **B47.** `context` is `{prefix, suffix, heading, element}`, each bounded at `CONTEXT_MAX`, plus `slide` last when B48 gives one.
- **B48.** `slideContext(slide)` is `null` unless `slide.total` is an integer of at least 0 and either `uncounted === true` with `index === null`, or `index` is an integer from 1 to `total`. Then it is `{index, total, uncounted, id, heading, text}`, `uncounted` a boolean and each of the last three bounded at `CONTEXT_MAX` when a string, else `null`.
- **B49.** `subject` is `null` when the context has no subject; otherwise `{tag, src, alt, html, near}`, all bounded at `CONTEXT_MAX` except `html`, which is C3's `subjectHtmlOf(subject)` bounded at `BEFORE_MAX`.
- **B50.** `new_blocks` and `remove_blocks` are `null` unless a non-empty array; then each block is `{tag, html, text}` plus `from_anchor: true` last when the block's `from_anchor` is `true`; `text` is C2's `decodeEntities(blockText(html))`. Never bounded.
- **B51.** `anchor_after_html` is the string, bounded at `BEFORE_MAX` unless the record has any run field (C3 `hasRunFields`), else `null`; `anchor_tag_after` the string or `null`; `placement` the value when it is one of C3's placements, else `null`.
- **B52.** `run_words` is C2's `runWords(new_blocks)` on a run record, else `null`. `proofread` is true only for a run record, in a review whose `notes` option is not true, whose thread has no round with `agent.proofread === true`, and whose `run_words` is more than 150.
- **B53.** `region_label` is `region.label` bounded at `CONTEXT_MAX`, or `null`. `region` is `{stamp, where, ordinal, text_unique, stamp_carriable, stamp_missing}`: `stamp` the reference's non-empty string or `null`; `where` bounded at `CONTEXT_MAX` or `null`; `ordinal` `{index, of}` from the reference, each defaulting to 1 when not a number; `text_unique` false only when the reference says `text_unique: false`; `stamp_carriable` is C3's `pageCanCarryStamp({path: page_path, source_hint})`, where `source_hint` is the linked hint for a linked page and otherwise the item's own hint, else the page's hint, else `null`.
- **B54.** `stamp_missing` is true when the region's `check_reopen` or any thread round names the tool `page_check_stamp`; nothing clears it.
- **B55.** `after_history` is B24 over the record's history.
- **B56.** On a choice item `choice` is `{group, answer}`, each kept only when C3's `isChoiceToken` passes, else `null`; and `before`, `after_full`, `before_html`, `after_html`, `region_label`, `subject` and `region` are `null` and `after_history` is `[]`, keeping their places.
- **B57.** `lost` is `{code, reason, at}` (each value or `null`) from `region.lost`, and `null` when the item is handled or has no lost state.
- **B58.** `reply` is `null` with no reply; otherwise `{status, agent, reason, text, files, at, user_needs_to_see_reply}`: `status` or `null`, `agent` bounded at `CONTEXT_MAX`, `reason` and `text` at `BEFORE_MAX` (open question 2), `files` through B23, `at` or `null`, and the flag true only for the literal `true`.
- **B59.** `handled_not_on_page` is true only for the literal `true`; `closed_by_reviewer` is C3 B64.
- **B60.** `reviewer_last_changed_at` is `updated_at`, else `created_at`, else `null`; `card_first_created_at` is `created_at` or `null`; `waiting_since` is the later, by string comparison, of `reviewer_last_changed_at` and `received_at`, either of which may be missing or empty.
- **B61.** `stringifyReview(projection)` is `JSON.stringify(projection, null, 2)` followed by one `"\n"`. The same input gives the same bytes.
- **B62.** `countItems` is exported and gives B39's object for any review B25 accepts.
- **B63.** `projectItem(item, source, options)` alone: with no `source` (or `null`), `stamp_carriable` reads the item's own hint; with no `options`, `notes` is false. A fourth argument is ignored.

### `src/domain/review-text.ts`

- **B64.** `renderText(review)` starts with `Review of "<title trimmed>" (<id>)` when `review.title` is a string with non-space characters, else `Review <id>`; then `<n> item` or `<n> items` (one is singular) followed by `, <ready> ready, <draft> still draft, <handled> handled, <not_handled> not handled.`; then a blank line.
- **B65.** For each group (B27 to B32): `Page: <title> <path> (<origin>)`, the title and its space left out when there is none; then the source sentence for `movedHint(review, group.hint)` (no review-wide fallback, no linked-page mapping): `Edit this source: <path bounded at CONTEXT_MAX>. This page is generated from it. A change made only to the generated file is erased by the next build.` for a known hint, else `Source unknown. Nobody has told this tool what generates this page. Do not assume the file you are reading about is the source. Find the generator, or ask the reviewer, before editing anything.`; then a blank line; then each item's block followed by a blank line.
- **B66.** An item block opens `<kind> <id> rev <rev> (<state>)`, then `  Where: <label bounded at CONTEXT_MAX>` when the region has a label, then, when `updated_at` or `created_at` is set, `  Reviewer last changed these words: <that time> (their current wording)`, followed by `  Card first created: <created_at> (not how old the request is)` when `created_at` is set and differs.
- **B67.** A non-handled item with a lost region adds `  The subject of this item is no longer on the page. The quoted text below may not be in the source any more. Do not go looking for it blind; ask the reviewer if you cannot place it.`
- **B68.** Each round of `chronologicalThread` adds `  Earlier exchange, rev <rev> (historical context, not current instructions):`, then `    Reviewer note[ [<at>]]: <note>` and `    Reviewer change[ [<at>]]: <change>` when present, then `    <agent or "the agent"> said[ [<at>]]: <status or "">` followed by ` (<reason bounded at BEFORE_MAX>)` when a reason and ` <text bounded at BEFORE_MAX>` when a text.
- **B69.** `  Note (the reviewer's words)[ [<updated_at>]]: <note>` and the same for `Change`, when present. Never bounded and never indented: the reviewer's words go out exactly as typed.
- **B70.** When the subject has `html`: `  The element (page markup): <subjectHtmlOf bounded at BEFORE_MAX>`. When B48 gives a slide: `  Slide when this note began (page data): <"uncounted" or "<index> of <total>">[, <heading>][ [<id>]]`, then `  Slide text (page data): <text>` when it has text.
- **B71.** A choice adds `  Question (page text): <quote>` when there is a quote, `  Under the heading (page text): <heading bounded at CONTEXT_MAX>` when there is a heading, and `  Answer (the reviewer's press): <answer>, in the group <group>`. Any other item with a quote adds `  Quoted from the page: <quote>`. Quotes are bounded at `BEFORE_MAX`.
- **B72.** `  Before (page text): <before>` when `before` is a string. Then a run record (C3 B11) gets B73's lines; any other item with a string `after` gets `  After (page text, with the edit): <after>`. Both bounded at `BEFORE_MAX`.
- **B73.** A run: unless the placement is `start_of_container`, `  Anchor after the edit (page text): <blockText(anchor_after_html)>` when it is a string; `  Anchor becomes: <type name>` when `anchor_tag_after` is a non-empty string; then `  New blocks (the reviewer's new text), at the start of the page:` or `  New blocks (the reviewer's new text):`; then per block `    <type name>[ (moved from the anchor)]: <words>`, where the type name is C1's `blockTypeLabel(tag)` or the tag itself, and the words are C2's `blockText(html)`, with list blocks' paragraphs joined by `"; "`.
- **B74.** A reply adds `  <agent or "the agent"> said[ [<at>]]: <status or "">[ (<reason>)][ <text>]`, reason and text bounded at `BEFORE_MAX`.
- **B75.** Page text (quotes, before, after, anchor text, block words) keeps its line breaks with continuation lines indented four spaces and blank lines left blank. The whole text then has every run of three or more newlines cut to two, trailing whitespace removed, and one `"\n"` added.

### `src/browser/review-layer/storage/merge.ts`

- **B76.** `REASON` is `{ONLY_BROWSER: "only_browser", ONLY_STORE: "only_store", BROWSER_NEWER_REV: "browser_newer_rev", STORE_NEWER_REV: "store_newer_rev", SAME_REV_ACKED: "same_rev_acknowledged", SAME_REV_UNACKED: "same_rev_unacknowledged"}`. `CONTENT_FIELDS` is `kind, note, change, before, after, before_html, after_html, after_history, region, context, page_origin, page_path, page_title, page_seq, source_hint, thread, updated_at, new_blocks, anchor_after_html, anchor_tag_after, placement, choice`.
- **B77.** `mergeItem(browserItem, storeItem, acknowledged)` with only one side returns that side's item untouched, with `only_browser` or `only_store`.
- **B78.** A browser revision above the store's returns the browser item untouched, `browser_newer_rev`: the reviewer's offline rewording survives a handled that named an older revision.
- **B79.** A store revision above the browser's returns the store item untouched, `store_newer_rev`, acknowledged or not, closed or not.
- **B80.** At the same revision the result starts from a copy of the store item. When the browser item is closed by the reviewer (C3 B64) and the store item is not, the copy takes the browser's `state`, `closed_by` and `closed_at`, and `handled_not_on_page: false`.
- **B81.** At the same revision, not acknowledged, every content field is the browser's; an optional content field (`new_blocks`, `anchor_after_html`, `anchor_tag_after`, `placement`, `choice`) the browser item does not have is absent from the result even when the store has it. Reason `same_rev_unacknowledged`.
- **B82.** At the same revision, acknowledged, the content is the store's (B80 still applies). Reason `same_rev_acknowledged`.
- **B83.** `mergeItem(null, null)` throws `TypeError` `mergeItem: at least one side must be an item`; two items with different ids throw `mergeItem: two different items (<browser id> and <store id>)`.
- **B84.** `mergeLists(browserItems, storeItems, isAcknowledged)` pairs items by id and returns `{items, reasons}`: the browser list's order first, then ids only the store has in its order; `reasons` maps each id to its reason. A pair is acknowledged when `isAcknowledged(browserItem)` is true. No returned item carries an `acknowledged` key that its input did not.

### `src/browser/review-layer/anchoring/regions.ts`

- **B85.** `labelFor(descriptor)` tries, in order, and takes the first that gives a string with non-space characters: `authorName` (source `author_attribute`); `id` (`id`); `ariaLabel` (`aria_label`); `name`, as `<tag> <name>` or `<name>` with no tag (`element_name`); `heading`, as `<heading>, <tag or "block"> <ordinal or 1>` (`heading_ordinal`); `tag`, as `<tag> <ordinal or 1>` (`tag_ordinal`); the first 40 characters of C2's `normalizeText(text)` (`text_snippet`). It returns `{label, source}`. Two descriptors under one heading with one ordinal get one label.
- **B86.** The label is C2's `normalizeText` of the value; over `LABEL_MAX` (80) characters it is the first 79 and `"…"` (U+2026).
- **B87.** A descriptor no source can label throws `labelFor: no label source produced a label for <JSON of the descriptor>`.
- **B88.** `pinLabel(region, descriptor)` returns `region`. When the region already has a non-empty string label it changes nothing; otherwise it sets `region.label` and `region.label_source` from B85. A second call never recomputes.
- **B89.** `lostFromMint(ref)` returns `{code, reason, at}` with `at` the current ISO time, or `null`: no ref gives code `ANCHOR_NO_TEXT_MATCH`, reason `null`; `ref.ok !== true` gives the failure's `failureCode` (default `ANCHOR_NO_TEXT_MATCH`) and `reason` (default `null`); a minted ref with `text_unique === false` and no `stamp` gives `ANCHOR_AMBIGUOUS` when `not_unique_reason` is `"not_unique_in_containing_block"`, else `ANCHOR_NO_TEXT_MATCH`, with the `not_unique_reason` or `null` as reason; anything else is `null`.

### `src/browser/review-layer/anchoring/uniqueness.ts`

- **B90.** `MATCH` is `{EXACT: "exact", CONTAINS: "contains", STRUCTURE: "structure"}`; `REASON` is `{UNIQUE: "unique", CONTEXT_ELIMINATED_RIVALS: "context_eliminated_rivals", NO_TEXT_MATCH: "no_text_match", AMBIGUOUS: "ambiguous", STRUCTURE_ONLY: "structure_only"}`; `REASON_FAILURE_CODE` maps the three non-binding reasons to `ANCHOR_NO_TEXT_MATCH`, `ANCHOR_AMBIGUOUS`, `ANCHOR_STRUCTURE_ONLY`.
- **B91.** `selectUnique(candidates, reference)`: only `exact` and `contains` candidates are eligible. With none eligible, the verdict is unbound with `structure_only` when there was any candidate, else `no_text_match`, and 0 considered and 0 survivors.
- **B92.** Exactly one eligible candidate binds with `unique`, whatever its context, 1 considered and 1 survivor.
- **B93.** With several, a candidate survives when both its prefix and suffix match the reference's. A stored context that is `null`, `undefined`, `""` or normalizes to `""` matches anything; a non-empty stored context does not match a missing or empty found one; otherwise the two normalized texts (C2 `normalizeText`) match when equal or when either contains the other. Exactly one survivor binds with `context_eliminated_rivals`.
- **B94.** Zero or two or more survivors are unbound with `ambiguous`; no rule picks a best one.
- **B95.** The verdict is `{bound, key, reason, failureCode, considered, survivors, corroboration}`: `key` is the winner's key untouched, else `null`; `failureCode` is `null` when bound, else B90's code; `considered` the eligible count; `corroboration` is `{structure, heading}` of the winner (each true only for literal `true`), else both false. Corroboration never changes the verdict.
- **B96.** `selectUnique`'s source text holds none of `threshold`, `confidence`, `score` or a decimal literal.

### `test/support/data/record-fixtures.ts`

- **B97.** `FIXED_AT` is `"2026-08-12T00:00:00.000Z"`; `DEFAULT_PAGE` is `{origin: "http://localhost:7817", path: "/fixture", title: "Fixture page", seq: 1, source_hint: null}`. `createFixtures({seed, page})` returns the generators below and `page`, the default page with the given fields over it. Ids are `itm_<seed, default "fx">_<kind>_<n>`, `n` counting every generator call on that object from 1; two objects made with one seed give identical records.
- **B98.** Every fixture is built by C3's `newItem` with state ready, `created_at` and `updated_at` `FIXED_AT`, the page fields from `page`, and the region `{ref: {id: "ref_<kind>", probe: null}, label: "Fixture region", lost: null}` with C3's empty-region fields filled in (D11); caller overrides win.
- **B99.** The single fixtures keep the old file's field values exactly: `edit`, `editRewordedTwice` (an edit bumped twice to "The trainer writes a plan each week." then "The trainer writes one plan a week."), `formatOnly`, `deletion`, `comment`, `note`, `draftComment` (a comment at draft with note "half a th"), `lostAnchor` (an edit whose region is lost with code `ANCHOR_NOT_FOUND`).
- **B100.** `oneOfEach()` is those eight in that order; `manyEdits(n)` is `n` edits on regions `ref_p1` to `ref_p<n>`; `acrossPages()` is three comments on `/`, `/clients` and `/plans` with seq 1 to 3.
- **B101.** `runItem(overrides)` builds an edit run record: unless overridden, `after_html` and `after` come from C3's `buildRunAfter(anchor_after_html, new_blocks)` and `change` from C3's `runChangeText`; `new_blocks: null` gives a record with no `new_blocks` key.
- **B102.** `runFixtures()` returns these eleven `{name, item, after, change}` entries in this order, each item's `after` and `change` equal to the entry's, and every item's words holding `zqxcanary` while no `change` does: worked example; split tail, no typing; split tail, with typing; tag-only change; tag change with new words; paragraph turned into a list; item added to an existing list; start of container; with an earlier run in history (its first history entry carries one block and placement `after_anchor`); take-back (`remove_blocks` and no `new_blocks`); special characters. The inputs, `after` and `change` strings are the old file's, unchanged.
- **B103.** `forgedRuns()` returns four `{name, code, item}`: a script block (`RUN_BLOCK_REFUSED`), one block over `NEW_BLOCKS_MAX` (`RUN_OVER_CEILING`), placement `"sideways"` (`RUN_PLACEMENT_REFUSED`), a take-back carrying a run (`RUN_TAKEBACK_CARRIES_RUN`). Their items are plain objects, not typed records.
- **B104.** `oldShapeNested()` is an edit with nested `<p>` in `after_html` and no `new_blocks` (not a run record); `proofreadQuestion()` is the worked example with a question reply carrying `proofread: true` and two suggestions.
- **B105.** Every run fixture passes C3's `validateRun` and `validateItem`; every forged run is refused by `validateRun` with its code.

### `test/support/data/uniqueness-corpus.ts`

- **B106.** `ORIGINAL`, `REFERENCE` and the seven `CASES` hold the old corpus's text unchanged, and `selectUnique(candidatesFromBlocks(blocks, REFERENCE), REFERENCE)` lands every case on its expected `bound` and `reason`. `candidatesFromBlocks` makes one candidate per block whose normalized text equals the probe (`exact`) or contains or is contained by it (`contains`), keyed by index, with the neighbouring blocks as prefix and suffix, `structure` true when the index is `reference.path`, and `heading` true when the reference has a heading. It never makes a structure-only candidate.

### Bridges and the barrel

- **B107.** `require("src/shared/<old>.js")` from Node gives a plain, writable object holding every export of the new module or modules: `lifecycle.js`, `merge.js`, `regions.js`, `uniqueness.js`, `review_format.js` (all four review modules) and `record_fixtures.js` (the test fixtures).
- **B108.** In both bundles' page, `LAHE.lifecycle`, `LAHE.merge`, `LAHE.regions`, `LAHE.uniqueness` and `LAHE.review_format` are plain writable objects with the same exports, registered at the old files' places in the order; `LAHE.record_fixtures` is `undefined`, and `dist/lahe-layer.js` holds no fixture code.
- **B109.** `src/shared/contracts.js` no longer exists. `src/layer/index.js` loaded in Node still exports its pure helpers, its namespace built from `markers`, `failures`, `gestures`, `lifecycle`, `protocol` and `record`.

## 3. Callers

"Breaks" marks a caller this slice must edit. Everything else keeps working through B107 and B108.

### src

| File | Owner slice | Reads | Breaks |
| --- | --- | --- | --- |
| `src/layer/tab_done.js` | B8 | lifecycle `ACTOR`, `assertTransition`, `replyApplies`; review_format `REPLY_TEXT_MAX`, `CONTEXT_MAX`, `boundData` | no |
| `src/layer/editing.js` | B11 | lifecycle `ACTOR`, `canDelete`, `undoTakesBack`; regions `pinLabel`, `lostFromMint` | no |
| `src/layer/comments.js` | B10 | regions `pinLabel`, `lostFromMint` | no |
| `src/layer/anchor.js` | B3 | uniqueness `MATCH`, `selectUnique`; regions `AUTHOR_ATTR` | **yes**: lines 1258, 1565, 1897, 2067, 2176 read `markers.AUTHOR_REGION_ATTR` instead (D7) |
| `src/layer/replay.js` | B5 | uniqueness `REASON`, `REASON_FAILURE_CODE` | no |
| `src/layer/store.js` | B2 | merge `mergeLists` | **yes**: `mergeWithHelper` (903 to 924) passes `function (item) { return acked[item[record.FIELD.ID]] === item[record.FIELD.REV]; }` as the third argument and drops the decorate and strip steps; `adopt` (960) passes `function () { return false; }` (D6) |
| `src/layer/export.js` | B1 | review_format `renderText` | no |
| `src/layer/index.js` | B12 | lifecycle `canClose`, `closeItem` (through its namespace); the barrel in its Node branch | **yes**: line 58 becomes `Object.assign({ markers: require("../shared/markers.js"), failures: require("../shared/failures.js"), gestures: require("../shared/gestures.js"), lifecycle: require("../shared/lifecycle.js"), protocol: require("../shared/protocol.js"), record: require("../shared/record.js") }, { ...the existing layer modules })` (B109) |
| `src/service/projection.js` | SV4 | lifecycle `canClose`, `closeItem`; review_format `isLinkedPage`, `projectReview`, `stringifyReview` | no |
| `src/service/replies.js` | SV4 | lifecycle `applyReply` | no |
| `src/service/handled_check.js` | SV4 | review_format `isLinkedPage` | no |
| `src/service/reviews.js` | SV5 | review_format `isLinkedPage` | no |
| `src/service/review_writer.js` | SV2 | review_format `FILE_NAMES`, `stringifyReview` | no |
| `src/cli/commands/status.js` | CLI | review_format `PROJECTED`, `DATA_FIELDS` | no |
| `src/shared/manifest.js` | F1 | the bundle entries | **yes**: C5's own entries (B108, section 4) |

No script under `scripts/` or `bin/` loads these modules (`scripts/scrub-log-fixtures.js` names them only in comments).

### test/unit

| File | Reads | Breaks |
| --- | --- | --- |
| `record_lifecycle.test.js` | lifecycle `ACTOR`, `TRANSITIONS`, `ACTIONABLE_STATES`, `canTransition`, `assertTransition`, `canDelete`, `replyApplies`, `applyReply`; merge `REASON`, `mergeItem`, `mergeLists` | **yes**: this slice's cases (section 5) |
| `mark_done.test.js` | lifecycle `ACTOR`, `canTransition`, `findTransition`, `canClose`, `closeItem`, `applyReply`; merge `REASON`, `mergeItem` | **yes**: its lifecycle and merge cases move (section 5) |
| `merge_run.test.js` | merge `CONTENT_FIELDS`, `REASON`, `mergeItem`; fixtures | **yes**: moves |
| `regions_gestures.test.js` | regions `LABEL_MAX`, `labelFor`, `pinLabel`, `sameRegion`, two constants | **yes**: moves |
| `uniqueness.test.js` | uniqueness `MATCH`, `REASON`, `contextMatches`, `selectUnique`, `resolveInBlocks`; the corpus | **yes**: moves |
| `run_record.test.js` | fixtures (cases left by C3) | **yes**: moves |
| `page_identity_forms.test.js` | review_format `pageGroups` | **yes**: moves |
| `sanity.test.js` | the barrel | **yes**: case and require removed |
| `anchor_engine.test.js` | regions `labelFor`, `lostFromMint`; uniqueness `REASON`; `../fixtures/uniqueness_corpus.js` | **yes**: line 30 requires `../support/data/uniqueness-corpus.ts` |
| `stable_addresses_docs.test.js` | `src/shared/review_format.js` as text | **yes**: section 8 |
| `review_format.test.js`, `export_text.test.js` | fixed pins (section 7) | no |
| `editing_surface`, `free_writing_f1_fixes`, `rebuild_not_the_agents_job`, `reopened_edit`, `reword_not_handled_floor` | lifecycle `ACTOR`, `canDelete`, `undoTakesBack`, `applyReply` (the last loads it unused) | no |
| `batch_reply_own_answers`, `choice_kernel`, `fix_round_f3_projection`, `held_release_clock`, `hook_stop`, `launch_folder`, `mark_done`, `monitor_command`, `no_stale_excuse`, `oversized_records`, `projection_review_json`, `sites_mappers`, `status_catalog`, `status_command` | review_format `projectItem`, `projectReview`, `stringifyReview`, `renderText`, `PROJECTED_FIELD_CLASS`, `DATA_FIELDS`, `INTENT_FIELDS`, `SCHEMA`, `BEFORE_MAX`, `FILE_NAMES` | no. `choice_kernel` calls `mergeItem(browser, store)` with `acknowledged: false` on the item; the missing third argument reads as unacknowledged, the same answer |
| `sync_client.test.js` | merge `REASON`, through the store's result | no |
| 27 files that require `record_fixtures.js` (`block_changes`, `draft_flush_cadence`, `export_text`, `fix_round_f3_projection`, `fix_round_f3_record`, `fix_round_f3_service`, `fix_round_f3_sync`, `flow_fix_g2`, `free_writing_f1_fixes`, `handled_check_run`, `log_run`, `merge_run`, `projection_review_json`, `rail_run_cards`, `refused_not_replayed`, `reopened_edit`, `replay_pass`, `replay_run`, `reply_proofread`, `reverted_edit`, `review_follows_document`, `review_format`, `run_record`, `run_refusal_real_route`, `sites_mappers`, `status_command`, `tab_edits_rows`) | `createFixtures` and its generators | no, through the forwarder (except the files that move) |

### test/browser and test/fixtures

| File | Reads | Breaks |
| --- | --- | --- |
| `living_in_the_page.spec.js:90` | `window.LAHE.record_fixtures` in the page | **yes**: reads `window.__lahe.page()`, builds the edit in Node with `createFixtures({ page }).edit({})` from `src/shared/record_fixtures.js`, and passes the record into `page.evaluate` |
| `csp_refusal.spec.js:113` | `window.LAHE.record_fixtures` in the page | **yes**: the same, with `.comment({})` |
| `test/fixtures/assets/replay-boot.js:82` (loaded by `replay-doc.html`, which `replay_branches.spec.js` and `replay_human_and_agent.spec.js` serve straight from the repo with `dist/lahe-layer.js`) | `LAHE.record_fixtures` | **yes**: a local builder over `LAHE.record.newItem` and `LAHE.record.bumpRev` makes the same six records with the same ids (`itm_2c-browser_<kind>_<n>`, one counter in call order), fields, `FIXED_AT` times and page, and the same two rewordings for region B |
| `free_writing_capture`, `free_writing_undo`, `replay_old_records`, `replay_run_anchor`, `replay_run_check`, `replay_run_fix_round`, `replay_run_flow_fix`, `replay_run_insert` | `record_fixtures.js` in Node | no, through the forwarder (open question 4) |
| `element_subject`, `heading_context`, `oversized_records` | `LAHE.review_format.projectReview` in the page | no (B108) |
| `editing_change_intent.spec.js` | review_format `INTENT_FIELDS`, `TRUNCATION_MARKER`, `projectReview` in Node | no |
| `test/browser/support/export_stub.js` | `LAHE.review_format.renderText` in the page, `review_format.js` as source text | no; dead and on C1's cleanup list (section 8) |
| `test/fixtures/catalog_state_build.js` | review_format `stringifyReview` | no |

## 4. Module design

### Rules every module follows

Erasable syntax, named exports only, no default export, no top-level `await`, no `as` but `as const`, no `!`, no `any`, no comment but the `read-when` header (section 9 has each). Tables are typed objects with derived unions. A function that must keep a check for still-JavaScript callers takes `unknown` there (the C3 convention); everything else trusts its types. Exports are functions, constants and types, never a `let`.

### Imports

`lifecycle` imports C3's `contract/record.ts` (`STATE`, `ItemState`, `Item`, `CLOSED_BY_REVIEWER`), C4's `contract/replies.ts` (`REPLY_STATUS`, `REPLY_STATUSES`, `ReplyStatus`), C3's `domain/item-status.ts`, `domain/thread.ts` and `domain/mint.ts`. `review-bounds` imports nothing. `review-pages` imports C3's `record` and `page-identity`, and `review-bounds`. `review-json` imports C3's `record`, `field-class`, `choice`, `run-limits`, `thread`, `subject`, `stamp-source`, `mint`, `item-status`, `tool-round`; C2's `block-text`, `html-syntax`, `run-blocks`; and `review-bounds`, `review-pages`. `review-text` imports C3's `record`, `thread`, `subject`; C2's `block-text`; C1's `gestures`; and `review-bounds`, `review-pages`, `review-json`. `merge` imports C3's `record` and `item-status`. `regions` imports C2's `text` and C3's `record` (types) and `mint`. `uniqueness` imports C2's `text` and C1's `failures` (type only). The fixtures import C3's `record`, `run-limits`, `item-revisions`, `run-record`, `revert` and C4's `json-object` (type only); the corpus imports `uniqueness` from the review layer. No cycles.

### `src/domain/lifecycle.ts`

```ts
export const ACTOR: { readonly REVIEWER: "reviewer"; readonly AGENT: "agent"; readonly HELPER: "helper" };
export type Actor = (typeof ACTOR)[keyof typeof ACTOR];

export function canTransition(from: ItemState, to: ItemState, actor: Actor): boolean;
export function assertTransition(from: ItemState, to: ItemState, actor: Actor): ItemState;
export function canDelete(state: ItemState, actor: Actor): boolean;
export function canClose(item: Pick<Item, "state"> | null | undefined): boolean;
export function closeItem(item: Item, at?: string | null): Item;
export function undoTakesBack(item: Pick<Item, "state" | "reply" | "thread"> | null | undefined): boolean;
export function replyApplies(item: Pick<Item, "rev">, rev: number): boolean;

export interface ReplyInput { readonly rev: number; readonly status: string; readonly page_shows_change?: boolean | null }
export type ReplyDecision =
  | { readonly accepted: false; readonly state: ItemState; readonly refusal: string }
  | { readonly accepted: true; readonly state: ItemState; readonly refusal: null }
  | { readonly accepted: true; readonly state: ItemState; readonly refusal: null; readonly not_on_page: true };
export function applyReply(item: Item, reply: ReplyInput): ReplyDecision;
```

- **The rules are one private table, total over the states.** `type Mover = typeof ACTOR.REVIEWER | typeof ACTOR.AGENT` and `const RULES: { readonly [S in ItemState]: { readonly moves: { readonly [M in Mover]: readonly ItemState[] }; readonly deletable: boolean } }`. Adding a state to C3's `STATE` fails the build here until someone says where it may go, who may move it, and whether it may be deleted. The helper has no column, so it can never be given a move by accident; `canTransition` answers false for it before reading the table.
- **Every branch on a state or a reply status is a `switch` with every case** (`undoTakesBack` over `ItemState`, `applyReply` over `ReplyStatus`), so the lint's exhaustiveness rule refuses a new member some branch ignores. `applyReply` narrows `reply.status` with a private `isReplyStatus(value: unknown): value is ReplyStatus` before the switch (C4 exports no guard).
- **The decision is a union**, so a caller cannot read `not_on_page` without having the case that carries it. Its keys stay what `replies.js` writes into the fold event.
- Removed (D1, D3): `ACTORS`, `TRANSITIONS`, `findTransition`, `DELETABLE_FROM`, `DONE_STATES`, `ACTIONABLE_STATES`, `agentReplied` (private), `countByState`, `countOutstanding`. No source file reads any of them.

### `src/domain/review-bounds.ts`

```ts
export const BEFORE_MAX = 2000;
export const CONTEXT_MAX = 400;
export const REPLY_TEXT_MAX = 20000;
export const REPLY_FILES_MAX = 100;
export const AFTER_HISTORY_MAX = 50;
export const TRUNCATION_MARKER = "[... bounded here. {n} more characters of page text.]";
export function truncationMarker(n: number): string;
export function boundData(value: unknown, max?: number): string | null;
export function boundFiles(files: unknown): string[];
export interface BoundHistoryEntry { readonly rev: number | null; readonly after: string | null; readonly after_html: string | null; readonly at: string | null }
export function boundHistory(history: unknown): BoundHistoryEntry[];
```

`boundData`, `boundFiles` and `boundHistory` take `unknown` on purpose: they are the last boundary before an agent reads text that came from browser storage, the event log or an agent's reply line, and the old code coerced rather than crashed. `boundData` keeps `String(value)` for non-strings so a stored number never stops `review.json` being written. `boundFiles` is newly exported for `review-json`.

### `src/domain/review-pages.ts`

```ts
export type OriginAliases = Readonly<Partial<Record<string, string>>>;
export interface ReviewSources {
  readonly origin_aliases?: OriginAliases | null;
  readonly source_hint?: SourceHint | null;
  readonly linked_files?: Readonly<Partial<Record<string, string | null>>> | null;
  readonly moved_hints?: Readonly<Partial<Record<string, string>>> | null;
}
export interface ReviewInput extends ReviewSources {
  readonly id: string; readonly items: readonly Item[];
  readonly generated_at?: string | null; readonly agent_session_id?: string | null;
  readonly started_at?: string | null; readonly ended_at?: string | null;
  readonly notes?: boolean; readonly title?: string | null;
}
export function requireReview(review: unknown): void;

export interface PageGroup {
  readonly key: string; readonly origin: string; readonly path: string; readonly title: string | null;
  readonly first_seq: number | null; readonly arrival: number; readonly hint: SourceHint | null;
  readonly file_origin_seen: boolean; readonly items: readonly Item[];
}
export function pageGroups(items: readonly Item[], aliases?: OriginAliases | null): PageGroup[];

export const LINKED_PAGE_PREFIX = "/.lahe-source/";
export function isLinkedPage(path: unknown): boolean;
export function movedHint(review: Pick<ReviewSources, "moved_hints">, hint: SourceHint | null): SourceHint | null;

export interface KnownSourceHint { readonly known: true; readonly path: string }
export type PageSource =
  | { readonly linked: true; readonly hint: KnownSourceHint | null }
  | { readonly linked: false; readonly hint: SourceHint | null };
export function pageSourceFor(review: ReviewSources, group: Pick<PageGroup, "path" | "hint">): PageSource;
```

- **`PageSource` replaces two parameters that meant one thing.** The old `projectItem(it, pageHint, linkedHint)` told a linked page from an ordinary one by whether `linkedHint` was `undefined` or `null`. The union says it, and `review-json` and `projectItem` both switch on `linked`.
- The group is built in a private mutable record and returned as `PageGroup`. The alias table is read with `Object.hasOwn`.
- `requireReview` takes `unknown` because the fixed pin calls `projectReview(null)` and `projectReview({id, items: "nope"})` and expects B25's errors.

### `src/domain/review-json.ts`

```ts
export const SCHEMA = "lahe.review/5";
export const PROJECTED: { readonly NOTE: "note"; /* the 21 of B35 */ };
export { INTENT_FIELDS } from "../contract/field-class.ts";
export type DataField = "quote" | "before" | "after_full" | "context" | "before_html" | "after_html" | "region_label" | "region" | "subject" | "after_history" | "new_blocks" | "anchor_after_html" | "remove_blocks";
export const DATA_FIELDS: readonly DataField[];
export type ProjectedPath = /* the 48 paths of B36 */;
export const PROJECTED_FIELD_CLASS: { readonly [P in ProjectedPath]: P extends InstructionPath ? typeof CLASS_INSTRUCTION : typeof CLASS_DATA };
export const PROOFREAD_MIN_WORDS = 150;
export const FILE_NAMES: { readonly json: "review.json"; readonly events: "events.jsonl"; readonly replies: "replies.jsonl" };
export const TEMP_SUFFIX = ".tmp";

export function slideContext(slide: unknown): SlideContext | null;
export interface ItemCounts { readonly total: number; readonly draft: number; readonly ready: number; readonly handled: number; readonly not_handled: number }
export function countItems(review: Pick<ReviewInput, "items">): ItemCounts;
export interface ProjectOptions { readonly notes?: boolean }
export function projectItem(item: Item, source?: PageSource | null, options?: ProjectOptions): ProjectedItem;
export function projectReview(review: ReviewInput): ReviewJson;
export function stringifyReview(projection: ReviewJson): string;
```

with `ReviewJson`, `ProjectedPage`, `ProjectedItem`, `ProjectedThreadRound`, `ProjectedReply`, `ProjectedRegion`, `ProjectedSubject`, `ProjectedBlock` and `ProjectedSuggestion` as exported interfaces naming B37 to B60's keys. `InstructionPath`, `CLASS_INSTRUCTION` and `CLASS_DATA` are C3's.

- **D12 is a type here as it is in C3.** `PROJECTED_FIELD_CLASS` is a mapped type over every projected path whose value type is computed from C3's `InstructionPath`, so a new projected field fails to compile until it is classified, and only the four instruction paths can be intent. A brand for the reviewer's words (C3's suggested follow-up) was weighed and left out: the projection only copies strings into JSON, and a brand would need minting at every read in slices that do not exist yet. The type above is where the laundering it guards against would be caught.
- **Key order is written as object literals in B42's order.** `ProjectedItem` is one interface with `choice?` optional; the choice overrides (B56) are a second literal spread after the first, so their keys keep their places, and `choice` is placed between `after_history` and `lost` by building the item as three spreads (head through `after_history`, `choice` when a choice, tail).
- `projectItem` and `countItems` stay exported because other slices' tests read them; `slideContext` is exported for `review-text`. `sourceHint` and `sourceHintSentence` become private (D1).
- `generated_at` falls back to C3's `nowIso()`.

### `src/domain/review-text.ts`

```ts
export type TextReviewInput = Pick<ReviewInput, "id" | "items" | "title" | "origin_aliases" | "moved_hints">;
export function renderText(review: TextReviewInput): string;
```

`LOST_NOTE`, the source sentence, the line wrapper and the run lines are private. The run lines call C2's `blockText(typeof html === "string" ? html : "")`, as C3 D2 already did in the old file.

### `src/browser/review-layer/storage/merge.ts`

```ts
export const REASON: { readonly ONLY_BROWSER: "only_browser"; /* the six of B76 */ };
export type MergeReason = (typeof REASON)[keyof typeof REASON];
export type ContentField = "kind" | "note" | /* the 22 of B76 */ "choice";
export const CONTENT_FIELDS: readonly ContentField[];
export interface MergedItem { readonly item: Item; readonly reason: MergeReason }
export function mergeItem(browserItem: Item | null, storeItem: Item | null, acknowledged: boolean): MergedItem;
export interface MergedList { readonly items: Item[]; readonly reasons: Readonly<Record<string, MergeReason>> }
export function mergeLists(browserItems: readonly Item[], storeItems: readonly Item[], isAcknowledged: (item: Item) => boolean): MergedList;
```

- **Acknowledgement is an argument, not a field on the record** (D6). The store keeps it in a side table; it used to copy it onto each record as `acknowledged: true` for the merge to read and strip it again afterwards. C3's `Item` has no such field, and a type that existed only to smuggle a side table through a record is the thing to delete.
- Copying content fields uses a generic helper `function copyField<K extends ContentField>(onto: Item, from: Item, key: K): void { onto[key] = from[key]; }`, which compiles without a cast, and `delete onto[key]` over the optional content fields, which are optional on `Item`.
- `reasons` stays a plain object keyed by id, because `store.js` returns it and `sync_client.test.js` reads `reasons[id]`.
- `isAcknowledged` is removed (D1): no caller.

### `src/browser/review-layer/anchoring/regions.ts`

```ts
export const LABEL_MAX = 80;
export interface RegionDescriptor {
  readonly authorName?: string | null; readonly id?: string | null; readonly ariaLabel?: string | null;
  readonly name?: string | null; readonly heading?: string | null; readonly ordinal?: number | null;
  readonly tag?: string | null; readonly text?: string | null;
}
export type LabelSource = "author_attribute" | "id" | "aria_label" | "element_name" | "heading_ordinal" | "tag_ordinal" | "text_snippet";
export interface RegionLabel { readonly label: string; readonly source: LabelSource }
export function labelFor(descriptor: RegionDescriptor): RegionLabel;
export interface LabelSlot { label?: string | null; label_source?: string }
export function pinLabel<T extends LabelSlot>(region: T, descriptor: RegionDescriptor): T;
export interface MintOutcome {
  readonly ok?: boolean; readonly failure?: { readonly failureCode?: string; readonly reason?: string | null } | null;
  readonly text_unique?: boolean; readonly stamp?: string | null; readonly not_unique_reason?: string | null;
}
export function lostFromMint(ref: MintOutcome | null | undefined): LostAnchor | null;
```

- The label sources are a private `as const` list of `{source, get}` in B85's order; the `why` sentences move to the doc.
- `pinLabel` writes onto the region it is given, as `comments.js` and `editing.js` expect. `LabelSlot` is mutable; C3's readonly `Region` is still assignable to it.
- `MintOutcome` names only what the function reads; the anchor engine (B3) owns the mint result and any of its results fits.
- `LostAnchor` is C3's; it needs `reason: string | null` (open question 1).
- Removed (D7): `AUTHOR_ATTR`, `LABEL_SOURCES`, `sameRegion`, `lostState` (private), `IDENTITY_IS_THE_REFERENCE_NOT_THE_LABEL`, `LABELS_MAY_COLLIDE`.

### `src/browser/review-layer/anchoring/uniqueness.ts`

```ts
export const MATCH: { readonly EXACT: "exact"; readonly CONTAINS: "contains"; readonly STRUCTURE: "structure" };
export type MatchKind = (typeof MATCH)[keyof typeof MATCH];
export const REASON: { readonly UNIQUE: "unique"; /* the five of B90 */ };
export type BindReason = typeof REASON.UNIQUE | typeof REASON.CONTEXT_ELIMINATED_RIVALS;
export type RefuseReason = typeof REASON.NO_TEXT_MATCH | typeof REASON.AMBIGUOUS | typeof REASON.STRUCTURE_ONLY;
export const REASON_FAILURE_CODE: { readonly [R in RefuseReason]: Extract<FailureCode, "ANCHOR_NO_TEXT_MATCH" | "ANCHOR_AMBIGUOUS" | "ANCHOR_STRUCTURE_ONLY"> };
export interface Candidate<Key> {
  readonly key: Key; readonly match: MatchKind; readonly prefix: string | null; readonly suffix: string | null;
  readonly structure?: boolean; readonly heading?: boolean;
}
export interface ContextReference { readonly prefix?: string | null; readonly suffix?: string | null }
export interface Corroboration { readonly structure: boolean; readonly heading: boolean }
export type Verdict<Key> =
  | { readonly bound: true; readonly key: Key; readonly reason: BindReason; readonly failureCode: null; readonly considered: number; readonly survivors: number; readonly corroboration: Corroboration }
  | { readonly bound: false; readonly key: null; readonly reason: RefuseReason; readonly failureCode: (typeof REASON_FAILURE_CODE)[RefuseReason]; readonly considered: number; readonly survivors: number; readonly corroboration: Corroboration };
export function selectUnique<Key>(candidates: readonly Candidate<Key>[], reference: ContextReference): Verdict<Key>;
```

- The verdict is a union on `bound`, so a bound verdict always has a key and no failure code, and a refused one the reverse. `REASON_FAILURE_CODE` is total over the refusing reasons, so the old `|| "ANCHOR_NO_TEXT_MATCH"` fallback has nothing left to catch (D8).
- Eligibility is a `switch` over `MatchKind`. `contextMatches` is private (D8).

### `test/support/data/record-fixtures.ts`

```ts
export const FIXED_AT = "2026-08-12T00:00:00.000Z";
export interface FixturePage { readonly origin: string; readonly path: string; readonly title: string | null; readonly seq: number | null; readonly source_hint: SourceHint | null }
export const DEFAULT_PAGE: FixturePage;
export interface FixtureOptions { readonly seed?: string; readonly page?: Partial<FixturePage> | null }
export type ItemOverrides = Partial<NewItemInput>;
export type RunOverrides = Omit<ItemOverrides, "new_blocks"> & { readonly new_blocks?: readonly RunBlock[] | null };
export interface RunFixture { readonly name: string; readonly item: Item; readonly after: string; readonly change: string }
export interface ForgedRun { readonly name: string; readonly code: RunRefusalCode; readonly item: JsonObject }
export interface Fixtures {
  readonly FIXED_AT: string; readonly page: FixturePage;
  edit(overrides?: ItemOverrides): Item; editRewordedTwice(overrides?: ItemOverrides): Item;
  formatOnly(overrides?: ItemOverrides): Item; deletion(overrides?: ItemOverrides): Item;
  comment(overrides?: ItemOverrides): Item; note(overrides?: ItemOverrides): Item;
  draftComment(overrides?: ItemOverrides): Item; lostAnchor(overrides?: ItemOverrides): Item;
  oneOfEach(): Item[]; manyEdits(n: number): Item[]; acrossPages(): Item[];
  runItem(overrides?: RunOverrides): Item; runFixtures(): RunFixture[]; forgedRuns(): ForgedRun[];
  oldShapeNested(): Item; proofreadQuestion(): Item;
}
export function createFixtures(options?: FixtureOptions): Fixtures;
```

- Fixture regions are built as `{ ...emptyRegion(), ref, label, lost }` and fixture refs through a local `interface FixtureRef extends RegionRef { readonly id: string; readonly probe: null; readonly fingerprint?: { readonly tag: string } }` assigned to a typed constant first, so C3's narrow `RegionRef` takes them without an excess-property error or a cast.
- The forged "unknown placement" item cannot be an `Item`, so every forged item is typed `JsonObject` (C4), which is what `validateRun(value: unknown)` takes.
- The id counter is a closure over the `Fixtures` object, never module state.

### `test/support/data/uniqueness-corpus.ts`

```ts
export const ORIGINAL: readonly string[];
export interface CorpusReference extends ContextReference { readonly probe: string; readonly path: number; readonly heading?: string | null }
export const REFERENCE: CorpusReference;
export interface CorpusCase { readonly name: string; readonly expect: { readonly bound: boolean; readonly reason: BindReason | RefuseReason }; readonly why: string; readonly blocks: readonly string[] }
export const CASES: readonly CorpusCase[];
export function candidatesFromBlocks(blocks: readonly string[], reference: CorpusReference): Candidate<number>[];
```

### Bridges

- `src/shared/lifecycle.js`: `module.exports = Object.assign({}, require("../domain/lifecycle.ts"));`. The same form for `merge.js` (`../browser/review-layer/storage/merge.ts`), `regions.js` and `uniqueness.js` (`../browser/review-layer/anchoring/...`). `review_format.js` assigns all four review modules. `record_fixtures.js` is Node-only: `module.exports = require("../../test/support/data/record-fixtures.ts");`. All six are listed in the manifest's `FORWARDERS`.
- Manifest `LAYER_FILES`: the lifecycle, merge, regions and uniqueness entries name their `.ts` path with `registers` set to their old names; the review_format entry names `src/domain/review-json.ts` with `modules` listing the four review modules and `registers: ["review_format"]`; the `record_fixtures` entry is removed; the `contracts.js` entry in the Node-only list is removed. Update each entry's `why` to say what the module is.

### Exported names that change, and what each caller does

| Old | New | Why | Callers to edit |
| --- | --- | --- | --- |
| `merge.mergeItem(b, s)` reading `b.acknowledged` | `mergeItem(b, s, acknowledged)` | D6 | none in src; the moved tests |
| `merge.mergeLists(b, s)` | `mergeLists(b, s, isAcknowledged)` | D6 | `store.js` 914 and 960, as in section 3 |
| `regions.AUTHOR_ATTR` | removed; `markers.AUTHOR_REGION_ATTR` | Two names for one constant (D7) | `anchor.js` 1258, 1565, 1897, 2067, 2176 |
| `review_format.projectItem(it, pageHint, linkedHint, options)` | `projectItem(it, source, options)` | `PageSource` (D12) | none: every outside call passes no hint |
| `contracts.js` | removed | D9 | `layer/index.js` 58, `sanity.test.js` 8 |
| `uniqueness.buildCandidates`, `resolveInBlocks` | `candidatesFromBlocks` in the corpus module | Test scaffolding out of `src` (D8) | the moved uniqueness test |
| The removals listed under each module | private or gone | No caller (D1) | none |

New exported names: `requireReview`, `pageSourceFor`, `movedHint`, `LINKED_PAGE_PREFIX`, `boundFiles`, `slideContext`, and the types. All six old namespace names keep every name a caller reads. **Watch for silent failure:** after the edits, `grep -rn "regions\.AUTHOR_ATTR\|\.acknowledged\b\|mergeLists([^,]*,[^,]*)\|contracts\.js\|LAHE\.record_fixtures" src test/browser test/fixtures` must find nothing: an undefined attribute name makes `attrOf` read nothing without an error, and a `mergeLists` call missing its predicate reads every item as unacknowledged and lets stale browser content win.

### Tests

New tests, one per module that has behavior, written red first from section 2: `test/unit/domain/lifecycle.test.ts`, `review-bounds.test.ts`, `review-pages.test.ts`, `review-json.test.ts`, `review-text.test.ts`; `test/unit/browser/review-layer/storage/merge.test.ts`; `test/unit/browser/review-layer/anchoring/regions.test.ts` and `uniqueness.test.ts`; `test/unit/support/data/record-fixtures.test.ts`; and one case in each of B107, B108 (in the unit suite's existing bundle-registration test pattern from S0c) and B109. They import `test/support/data/record-fixtures.ts` directly for realistic records. The `git mv` moves are in section 5's fates.

## 5. Old tests, accounted for

The test files whose subject is one of these modules hold 135 cases. 62 move into the new `.ts` tests, 71 stay unchanged (the two fixed pins and one sanity case that is not this slice's), and 2 are dropped. Four carried cases lose one assertion each, named in their row. Line numbers are on main at `8d73e81e`; C3 will move `record_lifecycle.test.js`'s and `run_record.test.js`'s record cases first, so the builder finds these by name.

Files moved with `git mv`: `record_lifecycle.test.js` to `test/unit/domain/lifecycle.test.ts` (only this slice's cases are left in it after C3); `merge_run.test.js` to `test/unit/browser/review-layer/storage/merge.test.ts`; `regions_gestures.test.js` to `test/unit/browser/review-layer/anchoring/regions.test.ts` (C1 takes its gesture half first); `uniqueness.test.js` to `test/unit/browser/review-layer/anchoring/uniqueness.test.ts`; `run_record.test.js` to `test/unit/support/data/record-fixtures.test.ts`; `page_identity_forms.test.js` to `test/unit/domain/review-pages.test.ts`. `mark_done.test.js` keeps its projection, folding and skill cases and loses only the rows below.

| File | Line | Case | Statement | Fate |
| --- | --- | --- | --- | --- |
| `record_lifecycle.test.js` | 365 | the agent may only move a READY item, and never a draft | B2, B3 | moves to lifecycle.test.ts |
| `record_lifecycle.test.js` | 377 | the helper makes no lifecycle transition on its own initiative | B4 | moves; asks `canTransition` for every pair with the helper instead of reading the dropped `TRANSITIONS` list |
| `record_lifecycle.test.js` | 383 | reopening is a transition from handled back to ready, and it is the reviewer's (R38) | B2 | moves |
| `record_lifecycle.test.js` | 390 | rewording takes a ready or not_handled item back to draft, and only the reviewer does it | B2, B3 | moves |
| `record_lifecycle.test.js` | 403 | a handled item cannot be deleted, because it is the record that a fix landed | B6; C3 B62 | moves |
| `record_lifecycle.test.js` | 481 | an illegal transition throws rather than being ignored | B5 | moves; asserts the full message |
| `record_lifecycle.test.js` | 488 | only ready items are actionable, so a draft never reaches an agent (R7) | B3, B15, B18 | moves; `ACTIONABLE_STATES` is gone (D3), so it asserts only ready has agent moves and a draft is refused |
| `record_lifecycle.test.js` | 492 | a reply applies only for the revision it names (R9, R21) | B11 | moves |
| `record_lifecycle.test.js` | 503 | a reply naming an old revision is refused and the item stays outstanding | B14 | moves |
| `record_lifecycle.test.js` | 511 | a question leaves the item ready, because the work is still outstanding | B16 | moves |
| `record_lifecycle.test.js` | 518 | a handled reply naming the current rev retires the item; not_handled keeps it visible | B18 | moves |
| `record_lifecycle.test.js` | 524 | a reply cannot move a draft, whatever revision it names | B15 | moves |
| `record_lifecycle.test.js` | 532 | the browser wins on content for anything the helper has not acknowledged | B81 | moves to merge.test.ts |
| `record_lifecycle.test.js` | 544 | the store wins on lifecycle at the same revision | B80, B81 | moves to merge.test.ts |
| `record_lifecycle.test.js` | 552 | a stale revision cannot retire a current one: the reword-offline case | B78 | moves to merge.test.ts |
| `record_lifecycle.test.js` | 569 | an acknowledged browser copy does not overwrite the store's content | B82 | moves to merge.test.ts; acknowledgement passed as the argument |
| `record_lifecycle.test.js` | 577 | a store revision ahead of the browser wins outright | B79 | moves to merge.test.ts |
| `record_lifecycle.test.js` | 585 | an item only one side has survives the merge | B77, B83 | moves to merge.test.ts |
| `record_lifecycle.test.js` | 592 | merging two lists keeps the browser's order, so the rail does not reshuffle | B84 | moves to merge.test.ts |
| `record_lifecycle.test.js` | 602 | merging two different items is a loud error, never a silent pick | B83 | moves to merge.test.ts |
| `mark_done.test.js` | 150 | the reviewer may move ready and not_handled to handled, and the table says so | B2, B3 | moves to lifecycle.test.ts; the `findTransition(...).why` match is dropped with `findTransition` (D3); the sentence moves to the doc |
| `mark_done.test.js` | 164 | closeItem keeps the revision and the reply, names the reviewer, and clears a held claim | B7, B8; C3 B62, B63, B64 | moves to lifecycle.test.ts |
| `mark_done.test.js` | 184 | closing a draft or a handled item throws | B7, B9 | moves to lifecycle.test.ts |
| `mark_done.test.js` | 192 | no reply moves a closed item, whatever it says | B13 | moves to lifecycle.test.ts |
| `mark_done.test.js` | 202 | a new revision drops the close mark | B8; C3 B54 | moves to lifecycle.test.ts |
| `mark_done.test.js` | 210 | merge: a close at the same revision beats the store's older not_handled | B80 | moves to merge.test.ts |
| `mark_done.test.js` | 225 | merge: a close survives a reload when both sides hold it | B80, B82 | moves to merge.test.ts |
| `mark_done.test.js` | 231 | merge: a store ahead of the close wins, because the close named an older wording | B79 | moves to merge.test.ts |
| `merge_run.test.js` | 24 | the four run fields are content fields | B76 | moves |
| `merge_run.test.js` | 28 | at the same revision, unacknowledged, the browser's longer run wins | B81 | moves |
| `merge_run.test.js` | 36 | at the same revision, unacknowledged, the browser's shorter run also wins | B81 | moves |
| `merge_run.test.js` | 43 | the browser's tag change and anchor markup win too | B81 | moves |
| `merge_run.test.js` | 54 | a browser copy with no run fields leaves none behind from the store | B81 | moves |
| `merge_run.test.js` | 61 | a later helper revision wins over an acknowledged browser copy | B79 | moves |
| `regions_gestures.test.js` | 26 | the author-supplied attribute wins the label | B85 | moves |
| `regions_gestures.test.js` | 32 | the fallback chain runs id, then aria-label, then heading, then tag | B85 | moves |
| `regions_gestures.test.js` | 42 | a label is pinned at first touch and never recomputed | B88 | moves |
| `regions_gestures.test.js` | 51 | two regions under one heading get the same label and are still two records | B85 | moves; the `sameRegion` assertion and the two `true` constants are dropped with them (D7) |
| `regions_gestures.test.js` | 61 | two unresolved regions are never the same region | none | **dropped**: `sameRegion` has no caller (D7) |
| `regions_gestures.test.js` | 66 | a label is bounded so the rail cannot be blown out by a long paragraph | B86 | moves; asserts the exact cut |
| `regions_gestures.test.js` | 72 | a descriptor that produces no label at all fails loud | B87 | moves |
| `uniqueness.test.js` | 12 | the fixture corpus: every case lands where architecture D3 Law 1 says | B91 to B94, B106 | moves, over `test/support/data/uniqueness-corpus.ts` |
| `uniqueness.test.js` | 20 | a non-binding verdict carries the failure code the card will show | B90, B95 | moves |
| `uniqueness.test.js` | 31 | a candidate found only by structure can never place a write | B91 | moves |
| `uniqueness.test.js` | 41 | structure and heading corroborate and never change the verdict | B94, B95 | moves |
| `uniqueness.test.js` | 54 | a single candidate binds even when its context has changed entirely | B92 | moves |
| `uniqueness.test.js` | 67 | zero survivors and two survivors are the same verdict: fail closed | B94 | moves |
| `uniqueness.test.js` | 79 | context matching is whitespace tolerant, because rewrapping is not a move | B93 | moves, through `selectUnique`: two rivals, the one whose neighbour differs only in whitespace binds with `context_eliminated_rivals` |
| `uniqueness.test.js` | 83 | an empty stored context can never be what eliminates a rival | B93 | moves, through `selectUnique` |
| `uniqueness.test.js` | 92 | the predicate exposes no tunable number | B96 | moves (section 8) |
| `run_record.test.js` | 24 | the four refusal codes and the three card codes are failure codes | C1 B10, B11 | moves to `test/unit/contract/failures.test.ts`: its subject is C1's table, and the rest of this file leaves |
| `run_record.test.js` | 52 | every run fixture passes validation | B105 | moves to record-fixtures.test.ts |
| `run_record.test.js` | 70 | after equals the literal string written in each fixture | B102 | moves |
| `run_record.test.js` | 74 | change equals the exact sentence in each fixture and never quotes the run | B102 | moves |
| `run_record.test.js` | 81 | every run fixture's words hold the canary | B102 | moves |
| `run_record.test.js` | 88 | a split with no typing has no Added sentence | B102 | moves |
| `run_record.test.js` | 94 | the worked example's after_html is the anchor then each block as its own element | B102; C3 B104 | moves |
| `run_record.test.js` | 151 | the take-back fixture carries remove_blocks and never new_blocks | B102 | moves |
| `run_record.test.js` | 168 | history entries carry the run fields | B102; C3 B53 | moves |
| `run_record.test.js` | 222 | the proofread question fixture carries suggestions on a question reply | B104 | moves |
| `run_record.test.js` | 229 | the old-shape fixture has nested blocks in after_html and no new_blocks | B104 | moves |
| `page_identity_forms.test.js` | 37 | review.json groups every spelling of one page into one group | B27 | moves to review-pages.test.ts |
| `page_identity_forms.test.js` | 44 | an old port origin aliased to one spelling joins items made at another | B27 | moves to review-pages.test.ts |
| `sanity.test.js` | 8 | the shared contracts module loads and exports an object | none | **dropped**: the barrel is removed (D9); B109's test covers what replaces it |
| `sanity.test.js` | 12 | sanity: arithmetic works | none | stays; not this slice's |

**The fixed pins: 70 cases that stay unchanged.** Each is mapped to what it also proves, so the testing reviewer can see the new statements are pinned twice where it matters.

| File | Line | Case | Statement |
| --- | --- | --- | --- |
| `review_format.test.js` | 64 | a deck note carries bounded slide context as page data | B47, B48, B70 |
| `review_format.test.js` | 79 | invalid slide positions are omitted and old page notes keep their context shape | B47, B48 |
| `review_format.test.js` | 87 | an uncounted slide keeps its identity without claiming a numbered position | B48, B70 |
| `review_format.test.js` | 94 | the projection contains no embedded instructions | B37, B61 |
| `review_format.test.js` | 105 | review.json names no acknowledge command, because there is none | B37, B61 |
| `review_format.test.js` | 115 | the skill says how to apply a style request, and only from the marker (V17) | none (skill wording) |
| `review_format.test.js` | 122 | a region's full after is DATA, and only note and change are intent (D12) | B35, B36, B44 |
| `review_format.test.js` | 137 | completed thread rounds project and export in order as historical data | B45, B68 |
| `review_format.test.js` | 162 | the current agent reply keeps its timestamp in JSON and text export | B58, B74 |
| `review_format.test.js` | 172 | the agent's needs-to-see flag is projected on the reply and classified as data | B36, B58 |
| `review_format.test.js` | 196 | the projected item spells the page's text into data-named fields | B42, B46 |
| `review_format.test.js` | 209 | a long page title is bounded at the group header, with the marker visible | B22, B40 |
| `review_format.test.js` | 222 | field_classes names the fields the projection emits, and no stale ones | B36 |
| `review_format.test.js` | 242 | a reworded item carries every wording it has had, with the rev it was committed at | B55 |
| `review_format.test.js` | 267 | a wording in the history is bounded, and the bound is visible in the value | B24, B55 |
| `review_format.test.js` | 279 | a runaway history is capped at the newest entries, which are the ones that read | B24 |
| `review_format.test.js` | 293 | an instruction hidden in page text lands only in a data field | B44, B46 |
| `review_format.test.js` | 310 | a very large edit never truncates note or change, and bounds before and after_full with the marker visible | B22, B44, B46 |
| `review_format.test.js` | 337 | the human-readable copy text never truncates the reviewer's words either | B69 |
| `review_format.test.js` | 344 | page text and agent reply text with quotes, newlines, backslashes and control characters survive as JSON string values | B61 |
| `review_format.test.js` | 371 | a reply file line's text is projected as data, never as an instruction | B36, B58 |
| `review_format.test.js` | 381 | reply.files keeps only strings, caps the count, and bounds each entry | B23, B58 |
| `review_format.test.js` | 405 | items group one per origin plus pathname, in first-visit order | B27, B32 |
| `review_format.test.js` | 420 | two dev servers serving the same pathname never collapse into one group | B27 |
| `review_format.test.js` | 431 | a file review is one group named by the file's basename | B27, B29 |
| `review_format.test.js` | 438 | the group header carries the title and the source hint | B31, B40 |
| `review_format.test.js` | 448 | an unknown source hint says so plainly rather than letting an agent edit the artifact | B40 |
| `review_format.test.js` | 454 | a file visit and a served visit of the same document merge into one page group | B28, B30 |
| `review_format.test.js` | 486 | the merge works whichever visit arrived first | B28, B30 |
| `review_format.test.js` | 494 | a page never visited over file:// carries file_origin_seen false | B31, B40 |
| `review_format.test.js` | 499 | a merge never loses a known source hint to an unknown one | B31 |
| `review_format.test.js` | 509 | a page with no item-level hint falls back to the review-wide source hint | B34 |
| `review_format.test.js` | 521 | an item-level hint still wins over the review-wide fallback | B34 |
| `review_format.test.js` | 530 | a lost anchor travels in the projection, so the agent is told rather than sent looking | B57 |
| `review_format.test.js` | 548 | a handled item's lost stamp is not projected: the fix was expected to change that passage | B57, B67 |
| `review_format.test.js` | 559 | drafts are projected with their state so an agent can leave them alone | B39, B43 |
| `review_format.test.js` | 567 | counts cover every lifecycle state | B39 |
| `review_format.test.js` | 577 | the file names and the atomic write posture are named constants | B35 |
| `review_format.test.js` | 585 | the projection is pretty-printed and byte-stable for fixed input | B61 |
| `review_format.test.js` | 594 | the human-readable text is what copy and export produce, with no helper running | B64, B65, B69 |
| `review_format.test.js` | 602 | projectReview fails loud on a review it cannot group | B25 |
| `review_format.test.js` | 642 | subject is registered in field_classes as DATA, like quote and before | B36 |
| `review_format.test.js` | 651 | the agent is told which image it was: the src, the alt, and the opening tag | B49 |
| `review_format.test.js` | 664 | an item made on a passage of text has no subject, and says so | B49 |
| `review_format.test.js` | 669 | subject text is bounded like every other data field | B49 |
| `review_format.test.js` | 682 | the text export names the element too, because it reaches an agent with no review.json | B70 |
| `review_format.test.js` | 689 | every item carries the stamp, the chain, the ordinal and text_unique | B53 |
| `review_format.test.js` | 723 | stamp_missing records that a page check asked for the id and did not get it | B54 |
| `review_format.test.js` | 768 | the tool round still reaches the agent, because the agent is who it is for | B45, B54 |
| `review_format.test.js` | 785 | stamp_carriable is read off the SOURCE, not off the rendered page | B34, B53 |
| `review_format.test.js` | 807 | an item with none of it still carries the same shape, defaulted honestly | B53 |
| `review_format.test.js` | 818 | the chain is bounded like every other locating hint | B53 |
| `review_format.test.js` | 825 | the text formatter shows a run as the anchor change, then the new blocks by type | B73 |
| `review_format.test.js` | 840 | the text formatter names a split tail as moved text | B73 |
| `review_format.test.js` | 847 | PROOFREAD_MIN_WORDS is the plan's threshold | B35 |
| `review_format.test.js` | 851 | the skill carries the free-writing rules the contract carries | none (skill wording) |
| `export_text.test.js` | 30, 42, 50, 59, 70, 84, 104, 115, 127, 135, 154, 160, 168 | export.js's scope rule, label, filename, failure codes and manifest owner (13 cases) | none; they test `export.js` (B1's) and render through B64 to B75 |
| `export_text.test.js` | 187 | the text header names the document when the title is known | B64 |

**Cases in other slices' files that call these modules as part of what they check: 48, all unchanged** through the forwarders. Listed so the testing reviewer can see the overlap.

| File | Line | Case | Also exercises |
| --- | --- | --- | --- |
| `anchor_engine.test.js` | 352 | widening happens by whole sibling elements, outward from the region | B90 |
| `anchor_engine.test.js` | 382 | widening runs out, and the reference is kept anyway | B89 |
| `anchor_engine.test.js` | 412 | a region with no text at all is captured, and says text will not find it | B89 |
| `anchor_engine.test.js` | 435 | a structure-only match corroborates and can never place a write | B90 |
| `anchor_engine.test.js` | 455 | resolve survives a caller with no document at all | B85 to B87 |
| `anchor_engine.test.js` | 489 | an image mints from its src, because the src is what the image IS | B89 |
| `anchor_engine.test.js` | 545 | two images sharing one src are ambiguous, exactly like two identical list items | B89 |
| `anchor_engine.test.js` | 563 | a failed mint is stamped lost, so no item can read as healthy with a dead anchor | B89 |
| `batch_reply_own_answers.test.js` | 139, 152, 162, 174, 195, 251, 284, 293 | the drain line and review.json over `projectItem` (8 cases) | B42 to B60, B63 |
| `choice_kernel.test.js` | 178 | a press named as an agent wrote its keys (Closest_21, A_jev) passes the door, projects and drains unchanged | B42 to B60, B63 |
| `choice_kernel.test.js` | 234 | the field classes name choice.group and choice.answer as intent, and only on a choice does the key appear | B36, B56 |
| `choice_kernel.test.js` | 243 | projectItem leaves before, after_full, html, region_label, subject and the region null for a choice | B56 |
| `choice_kernel.test.js` | 254 | the drain line for a choice: choice at the top, only path, quote and context.heading under page | B42 to B60 |
| `choice_kernel.test.js` | 294 | the human status line prints the press bare and the question as page text | B42 to B60 |
| `choice_kernel.test.js` | 299 | the copy-and-export text prints a choice as its question and its answer | B71 |
| `choice_kernel.test.js` | 349 | an offline re-press (rev 2 in the browser, rev 1 handled in the store) merges to rev 2 ready | B78 |
| `choice_kernel.test.js` | 362 | choice is a browser-owned content field: an unacknowledged press wins at the same revision | B76, B81 |
| `editing_surface.test.js` | 294 | which states an undo drops the record for, and the one it does not | B1, B6 |
| `fix_round_f3_projection.test.js` | 73 | a run's anchor_after_html over 2000 characters is projected whole | B51 |
| `fix_round_f3_projection.test.js` | 121 | the export names block types with the menu's labels from gestures | B73 |
| `free_writing_f1_fixes.test.js` | 22 | undo takes back a ready item the agent already replied to (a question, a proofread) | B10 |
| `free_writing_f1_fixes.test.js` | 41 | undo on a handled item takes back; a not_handled one drops, as before | B10 |
| `held_release_clock.test.js` | 145 | waiting_since is a data field, never an instruction | B35, B60 |
| `hook_stop.test.js` | 200 | a session whose every review the reviewer ended is not blocked | B37, B61 |
| `mark_done.test.js` | 310 | projection: a same-revision re-post after the close keeps it closed; a reword reopens it | B8 |
| `mark_done.test.js` | 403 | a closed card never counts as an unread reply | B8 |
| `no_stale_excuse.test.js` | 73 | a projected item names when the reviewer last changed it, not just when the card was made | B60 |
| `no_stale_excuse.test.js` | 89 | an item never touched since it was made still carries a last-changed time | B60 |
| `no_stale_excuse.test.js` | 95 | the human-readable text says the words are the reviewer's current wording | B66 |
| `oversized_records.test.js` | 250 | 2: review.json still hands the agent the opening tag with the real source in it | B49 |
| `projection_review_json.test.js` | 88 | the real review.json projection contains review data but no instructions | B35, B37 |
| `projection_review_json.test.js` | 475 | the writer is atomic, owner-only, and refuses a symlinked destination | B35 |
| `projection_review_json.test.js` | 521 | the projector folds a reply file it finds, and the file says the item is handled | B37 to B60; fixtures B97 to B104 |
| `projection_review_json.test.js` | 600 | a run over 2000 characters is projected whole in new_blocks, after_full and after_html | B46, B50 |
| `projection_review_json.test.js` | 614 | the new fields are classed as data, and a projected history entry has no new_blocks | B35, B24 |
| `rebuild_not_the_agents_job.test.js` | 429 | the lifecycle call is what decides, and only an explicit false changes it | B17, B18 |
| `reopened_edit.test.js` | 161 | committing a withdrawn edit bumps the revision and a reply to the old one is refused | B14 |
| `sites_mappers.test.js` | 407 | V32: review.json groups old-origin and new-origin items of one page together | B27 |
| `status_command.test.js` | 229 | on a drain line, page text sits under page and no rule text is repeated | B35 |
| `status_command.test.js` | 278 | an item line still carries everything that locates it | B35 |
| `sync_client.test.js` | 459 | finding 10: a flush the helper acknowledges stamps the item acknowledged, and clears it on the next write | B76, B84 |

**Cases that use the fixtures only to build their records.** 61 cases detected by scan in eleven files (`replay_pass` 33, `rail_run_cards` 8, `refused_not_replayed` 7, `tab_edits_rows` 4, `block_changes` 2, `reverted_edit` 2, and one each in `draft_flush_cadence`, `reopened_edit`, `review_follows_document`, `sites_mappers`, `status_command`), plus every case in the other fixture-requiring files of section 3 that reaches the generator through a helper the scan does not attribute per case. All stay unchanged and run on B97 to B104 through the forwarder.

No case is dropped silently: two cases and four assertions are dropped, each with its reason above.

## 6. Deliberate differences

None of these is noticed by a person or an agent. Nothing a reviewer sees, nothing in `review.json`, nothing in the Copy and Export text and no CLI output changes.

- **D1. Exports nobody reads are removed or made private.** Listed under each module in section 4. Test: the forwarder cases of B107 list exactly the kept names.
- **D2. `canTransition` no longer answers the creation row.** The old table had `null -> draft by reviewer`. Creation is `newItem`'s default state (C3 B50), not a move; nothing called `canTransition(null, ...)`. A JavaScript caller passing `null` now gets false. Test: B4's full table.
- **D3. The transition table loses its `why` sentences and its list form.** `findTransition`, `TRANSITIONS` and `ACTIONABLE_STATES` go; the sentences move to the folder doc; the table becomes the total per-state rule table, so a new state fails the build. Test: B2 to B4 and a compile-time check in `lifecycle.test.ts` that the table type is total (a `satisfies` line over `Record<ItemState, unknown>`).
- **D4. A non-number revision is "does not apply", not a crash.** `replyApplies` threw `TypeError` and `applyReply` with it. Only a malformed fold event in the browser could reach it (C4's reply parser guarantees a number on the server); the Done tab now shows its stale-reply notice instead of throwing out of the fold loop. `applyReply` refuses it with B14's sentence. `assertTransition`'s message names the new file (B5). Test: B11, B14 with `rev: "1"` from a plain object.
- **D5. Typed inputs drop guards no caller needed**: `labelFor` and `pinLabel` on a non-object, `selectUnique` on a non-array, `mergeLists` on `null` lists, `applyReply` with no reply object. Every caller traced in section 3 passes the right shape. Test: none needed beyond the types; listed so a reviewer does not look for them.
- **D6. Merge acknowledgement is an argument.** `store.js` passes its side-table check instead of decorating each record with `acknowledged: true` and stripping it afterwards. The merged records and the stored records are byte-identical to before. Test: B84 (no `acknowledged` key appears), and `sync_client.test.js:459` unchanged.
- **D7. `regions` loses `AUTHOR_ATTR`, `sameRegion` and its two `true` constants.** `anchor.js` reads the one spelling, `markers.AUTHOR_REGION_ATTR`. `sameRegion` had no caller; record identity is the record id. Test: B85 to B89; `anchor_engine.test.js` unchanged.
- **D8. The uniqueness reference builder leaves `src/`.** `buildCandidates` and `resolveInBlocks` existed to run the corpus before the anchor engine did; they become `candidatesFromBlocks` beside the corpus in `test/support/data/`. `contextMatches` is private and tested through `selectUnique`. The dead `|| "ANCHOR_NO_TEXT_MATCH"` fallback goes. Test: B91 to B96, B106.
- **D9. The `contracts.js` barrel is removed.** Its two importers name what they use. Test: B109.
- **D10. The record fixtures leave the shipped bundle.** Every reviewed page loaded about 500 lines of test data under `LAHE.record_fixtures`. Two specs now build their record in Node and hand it to the page; `replay-boot.js` builds its six records over `LAHE.record`. Test: B108, and the three specs at the checkpoint.
- **D11. Fixture regions are complete.** They gain `accepted_page_texts: []` and `check_reopen: null`, the fields C3's `emptyRegion` gives every real record, because C3's `Region` type requires them. No test found compares a fixture's region to a literal (`grep "deepEqual([^,]*region[^,]*, {"` over `test/` finds only ordinal checks). Test: B98. If a test turns out to depend on the missing keys, the builder raises it rather than casting.
- **D12. `projectItem`'s two hint parameters become one `PageSource`.** Every outside caller passes `null, undefined, {}` or nothing, which reads the same under the new signature. Test: B63.
- **D13. `undoTakesBack` counts any thread round as an agent answer.** Every round the code writes holds the agent's archived reply (C3's `completedRound`), so this is the old rule without a check C3's `ThreadRound` type makes unnecessary. Test: B10.
- **D14. `stable_addresses_docs.test.js` reads the domain doc instead of the review_format file** (section 8).

## 7. Fixed behavior tests touched

These must pass with what they assert unchanged.

- **`test/unit/review_format.test.js`** (56 cases) runs entirely through the `review_format.js` forwarder and `record_fixtures.js` forwarder; the builder does not edit it. Every byte it pins comes from B35 to B75.
- **`test/unit/export_text.test.js`** (14 cases) runs `export.js` over the `review_format` forwarder and the fixtures forwarder; unedited.
- **Skill-wording tests** (`test/support/skill.js` users): `mark_done` (its lifecycle and merge cases move out; its skill case 416 and its projection and folding cases stay and must pass: they read B13's refusal sentence through `lahe reply` and the projection), `review_format` (above), `no_stale_excuse` (B60, B66 through the forwarder), `status_command` (`INTENT_FIELDS`, `DATA_FIELDS`), `reply_command` (the fold's refusal sentences, B12 to B18, through `replies.js`), `stable_addresses_docs` (one path changes, section 8), `add_command` and `session_fixes` (do not reach this slice's code).
- **CLI output:** `status_command`, `lean_agent_output`, `monitor_command`, `hook_stop` and `reply_folding.test.js:401` (matches B18's "only a ready item is actionable") read the projection and the fold through the forwarders.
- **Browser specs**, run once at checkpoint 1 by the orchestrator:
  - in-page `LAHE.review_format`: `element_subject`, `heading_context`, `oversized_records` (B108);
  - changed in this slice: `living_in_the_page`, `csp_refusal`, and through `replay-boot.js` `replay_branches` and `replay_human_and_agent`;
  - fixtures in Node through the forwarder: `free_writing_capture`, `free_writing_undo`, `replay_old_records`, `replay_run_anchor`, `replay_run_check`, `replay_run_fix_round`, `replay_run_flow_fix`, `replay_run_insert` (open question 4);
  - `mark_done.spec.js:403` (B13's sentence), `copy_export.spec.js` (B64 to B75), and the anchor, replay, Done-tab and store specs that drive B76 to B96 through the layer.

Checks the builder runs, and that this spec writer could not run here because the checkpoint suite was running: `npm run gate:unit`; the leftover-helper count before and after; the named specs above that this slice edits (`living_in_the_page`, `csp_refusal`, `replay_branches`, `replay_human_and_agent`) and one of the Node-fixture specs to prove Playwright loads the forwarder.

## 8. Source-text tests

- **`test/unit/uniqueness.test.js:92`** reads `selectUnique.toString()` and refuses `threshold`, `confidence`, `score` and a decimal. It moves into `uniqueness.test.ts` unchanged in what it asserts. Node's type stripping replaces the annotations with spaces, so the text still holds the body.
- **`test/unit/stable_addresses_docs.test.js:24`** reads `src/shared/review_format.js` for retired serving words. After this slice that file is one line, so the check would pass vacuously. Replace that list entry with `docs/ongoing/code/domain.md`, where the file's comments now live. Change nothing else in the test.
- **`test/unit/anchor_engine.test.js:437-444`** reads `src/layer/anchor.js` for `uniqueness.selectUnique` and the absence of score words. This slice edits five other lines of `anchor.js` (D7); the call stays, so the case is untouched.
- **`test/browser/support/export_stub.js:34`** reads `review_format.js`, `record.js`, `normalize.js` and `markers.js` as source text. It is dead (only a comment in `edits_tab.spec.js` names it) and on C1's cleanup list; C5 does not change it.
- **Manifest readers** (lint's completeness check, `lint_lua.test.js`, `export_text.test.js:160`) see only C5's own entries change, the way S0c's pilot did.

## 9. Comments to move

Drafted as the sections for each folder doc, under the frontmatter and opening those docs already have (S0c created `domain.md`). The three new docs get frontmatter in the form of `server-sites.md`.

### For `docs/ongoing/code/domain.md`

#### `lifecycle.ts`: item states and who may move them

Header: `read-when: Changing the item states, who may move an item between them, or what one reply does to one item.`

There are four states. `draft` is the reviewer still thinking: durable, never actionable. `ready` is the reviewer saying an agent may act (sending a comment, or an edit committing). `handled` is an agent saying it made the change, or the reviewer closing the card themselves (`closed_by` says which). `not_handled` is an agent saying it did not, with a reason the reviewer reads. Two things people keep turning into a fifth state are not states: `question` is a reply status that leaves the item ready, because the work is still outstanding and the card is where the question is answered; and reopening is the move from handled back to ready, after which the item is simply ready.

Every move names who may make it. The agent may only move an item out of ready, and only for the revision it named. Everything else is the reviewer's, including "Mark as done" (ready or not_handled to handled). The server makes no move of its own; it records the ones it is told about. Without the actor, a reply handler could move a draft straight to handled, which is silent loss of the reviewer's work. A move outside the table throws, because a silently ignored move is a rail that stops matching the log. The table is total over the states, so a new state fails the build until its moves are written down.

The moves and why each exists: draft to draft, the reviewer keeps typing (every keystroke is durable; the revision does not move for a draft). Draft to ready, sending or committing: the reviewer decides when it is ready. Ready to ready, rewording: it bumps the revision, so a reply naming the old one is refused. Ready to draft and not_handled to draft, the first changing keystroke of a rewording takes the item off the agent's desk until it is committed. Draft to not_handled, the reviewer typed a withdrawn not_handled edit back to its old wording, so the agent's answer still stands. Ready to handled and ready to not_handled by the agent, a reply naming the current revision. Not_handled to ready, the reviewer answers or rewords and puts it back in front of the agent. Handled to ready, reopening a fix that did not land. Ready and not_handled to handled by the reviewer, "Mark as done".

Deletion is reachable from every state except handled. A handled item is the record that a fix landed, and the agent has already changed the source, so dropping the record would leave that change in the file with nothing saying it is there. Undo on a handled item mints a take-back record instead (`revertOf`), and the handled record stays as history. Not_handled is deletable: the reviewer deletes their own outstanding work, never history, and an agent that said not_handled changed nothing.

Undo takes the change back out of the source, rather than dropping the record, for a handled item and for a ready or draft item an agent has already answered: the proofread flow has the agent place the words, rebuild, and then ask, so ready no longer means nothing is in the source. Not_handled never needs a take-back.

The revision rule: an agent may only move an item that names its current revision. A reply naming rev 2 cannot retire rev 3; the reviewer reworded after the agent read it, so the rewording stays outstanding. `applyReply` is the whole decision in one pure function so the server and the browser cannot disagree. Its order matters. A card the reviewer closed takes no reply at all, whatever revision it names, because a late answer must not reopen or hold it. An agent never answers a draft, not even with a question: a draft at a revision an agent has seen is the reviewer rewording, and a late or rival reply must not move it or put half-typed words in front of anyone. `page_shows_change: false` is the server's built-page check saying the words of a handled claim are not on the page: not a refusal, since the reply is real and belongs on the card, but a handled that does not retire, and every surface says so through `not_on_page`. Only the server can supply it.

Closing keeps the revision, so a close names exactly the wording it closed, and keeps the agent's last reply as history. It clears a held handled claim, because nothing is outstanding any more.

Known edge, kept: a question on a handled or not_handled item that the reviewer did not close is accepted with the state unchanged. The server's rival-reply rule only ever presents such an item as ready, so it is not reached in practice.

#### `review-bounds.ts`: bounding page text and agent text

Header: `read-when: Changing how long a piece of page text or agent text may be in review.json, the Copy text or the rail, or how a cut shows.`

Page text is data and may be bounded; the reviewer's own words are intent and never are. The bound is visible in the value: an agent that reads a cut field has to be able to tell, or it will treat a cut passage as the whole passage and edit the wrong thing. The limits are named constants because one number typed in two files is how two formatters come to disagree. `BEFORE_MAX` is for passages, `CONTEXT_MAX` for locating hints. `REPLY_TEXT_MAX` is for the agent's own words: bounded because an agent controls them and they reach the rail's DOM, but far above the page-text bound, because the reply is the reading; at 2000 a 2156-character answer lost its last sentence, which was the one instruction the reviewer had to act on. Reply files are agent-controlled too, so the list is capped and each entry bounded. The applied-wording history grows one entry per rewording, so a long session on one sentence is legitimately long; the cap keeps the newest entries, and each keeps its own revision, so a history starting at rev 40 on an item at rev 61 says on its face that older ones were dropped. Every function here takes `unknown` and coerces rather than throws, because it is the last step before an agent reads data from storage, the log or a reply line, and a malformed old record must never stop `review.json` being written.

#### `review-pages.ts`: page groups and the source each names

Header: `read-when: Changing how review.json or the Copy text groups items by page, or which source file a page tells the agent to edit.`

One group per origin plus pathname, ordered by first visit, with one exception: the record's file:// rule (`samePage`). The browser layer has always read records through that rule, so a file:// visit and a served visit of the same document never split on the reviewer's page; `review.json` once grouped by the raw key alone and split them, so `lahe status` showed two half-pages for one document. Now the exact key is tried first, then `samePage` against existing groups. The served origin is the canonical display: a group made from a file:// visit switches to the first served address that joins it, which is the real, reachable address, and a later file:// visit still matches it. `file_origin_seen` keeps the fact that part of the traffic came over file://, which `lahe status` reports. Two dev servers both serving `/dashboard` stay two groups; `samePage` never merges two served origins. Query strings and fragments already collapsed in `pageFrom`.

Stable addresses: the server computes `origin_aliases` (an old origin to the page's site origin) from its own records. An aliased item groups with the new origin and the group shows the new one, the address that works; the item keeps its own origin. Grouping uses the identity key, so every spelling of one stable address (with the pages port, without it, `.lahe`) is one group. Without aliases nothing changes.

A known hint never loses to an unknown one. A page with no hint of its own falls back to the review-wide hint `add --source` recorded, so a known source is not reported unknown just because no item on that page carried it.

A page under `/.lahe-source/` is a document a reviewed page links to. Its source file comes from the server's mount table, handed in as `linked_files`; whatever the page claimed is never used, and an unmapped linked page reads as unknown rather than falling back to the linking page's source, which is the wrong file. Any spelling that decodes under the prefix counts as linked, so an encoded one never falls back either; the server maps only the literal spelling. A hint naming a file in a removed worktree reads as its main copy through `moved_hints`, which the server computes.

The Copy and Export text uses only the group's own hint, moved; it never had the review-wide fallback or the linked mapping, because the browser that renders it does not know them.

#### `review-json.ts`: the review.json projection

Header: `read-when: Changing what review.json says, its field classes or its bytes.`
`not-for: Where review.json is written; see src/service/review_writer.js.`

Review data is one JSON file. The separation between page text and reviewer intent is structural: page text sits in data-named fields, and the intent channel is exactly `note` and `change`, carried verbatim and never cut. A region's full `after` is not intent: it is mostly the page's own words with the reviewer's change mixed in, so carrying it as intent would let a document someone else wrote ride a hidden instruction into the instruction channel on the back of the reviewer's edit. It travels as `after_full`, the name an agent reads. The classification travels with the file as `field_classes`, so an agent sees the rule as structure; it names only fields the projection actually emits, never the record's internal names. A choice's group and answer are intent by key: two ids checked against the choice-token grammar at the door and again here, so neither can hold a sentence. The agent's own reply text is plain data, so one agent cannot instruct another through a reply the server re-projects. `lahe status` nests the data fields under `page` on a drain line, the same fence as structure rather than words.

Per item: `reverts` is structural, like `id`. `subject` says what element the reviewer pointed at; an alt attribute is a place someone can write a sentence, so it is data and bounded. The subject's markup gets the longer bound because a data URI is a legitimate src and cutting it at 400 would hand the agent a tag that matches nothing. A run record's whole sitting is never cut (the server's run ceiling bounds it), and a block's `text` is its words as typed, entities resolved, matching what the page shows and what a proofread's `from` quotes. `proofread` asks for one proofread round on a long run (over 150 words, the page's own moved words aside), never in a notes review and never again once asked, which would loop. A proofread round's fixes stay readable in the thread after the reviewer answers.

`region` is what the agent needs to edit the source rather than read the page: `stamp` is the id the reviewer's page wrote onto the element, and carrying it into the source is what makes the next build reproduce it; `where` and `ordinal` place the first edit of one of several identical elements before any stamp exists, and never place a write in the browser; `text_unique` absent reads as true, which is what an old reference was; `stamp_carriable` is read off the source, not the page, because a Markdown file has nowhere to put an attribute. `stamp_missing` records that a page check asked for the id and did not get it; the check asks once, so without this a later agent would have no sign of it, and nothing clears it.

A choice carries its press and nothing about a region to rewrite, so no stamp round ever asks for an id on a button group; the key appears only on a choice, so every other item keeps its shape. A handled item has no lost anchor: its fix was expected to rewrite the passage. The lost sentence itself is said once in the skill, not per item, because a page restructure can lose many items at once; the code is the per-item signal. `handled_not_on_page` and `closed_by_reviewer` sit beside the reply, not in it, because neither is something the agent said.

`reviewer_last_changed_at` is named for what it means. The pair used to be `created_at` and `updated_at`; an agent read the creation time of two reworded cards, called them a leftover from yesterday, and answered not_handled twice while the reviewer retyped the same change three times. Rewording bumps the revision and reopens the item, so every item in the file is current work. `waiting_since` is when an agent could first have seen the wording: the later of the reviewer's change and the server receiving it, so a comment held in the browser does not set the rail's "nothing has come back" clock off the moment it is released.

The file is pretty-printed, because a person opens it too, with a trailing newline. The server writes it beside the target and renames; `TEMP_SUFFIX` names the beside-file here so the projection and the writer cannot disagree. The projection is pure: given the same review it returns the same bytes, apart from the default `generated_at`.

#### `review-text.ts`: the Copy and Export text

Header: `read-when: Changing the human-readable text Copy and Export produce.`

This is for a person pasting feedback into a chat or saving it, with no server running. It carries no contract and no fences, but the same bounds, for the same reason: the reviewer's words are whole and page text is quoted for locating. The document's name leads when the caller knows it, because an exported file gets forwarded or found weeks later with none of the page's context. The last-changed line comes before the words because it says what the words are: the reviewer's current wording, not a request dated by its card. A record made on a whole element names the element, because the text reaches agents with no `review.json`, and "the image" is no answer when there are three. A bare newline in page text would start a line that reads like a new field, so continuation lines are indented under their field. A run shows the anchor's change, then each new block by the menu's own type names (from the one table in `gestures`). Known gap, recorded on the board (open question 2): the current reply's text and reason are cut at the page-text bound here and in `review.json`, not at `REPLY_TEXT_MAX`.

### For `docs/ongoing/code/browser-review-layer-storage.md`

#### `merge.ts`: browser storage against the store, for one item

Header: `read-when: Changing how browser storage and the server's store are reconciled for one item, or when a comment reverts after a reconnect.`

The rule, stated once because two people who each invent half of it produce a tool where an agent's stale "handled" retires a comment the reviewer just reworded: the browser wins on content for anything the server has not acknowledged; the store wins on lifecycle, per revision; except the reviewer's own close at that same revision. The per-revision half is the point. The case it protects: the reviewer marks a comment ready (rev 1); an agent replies handled naming rev 1; the server goes down; the reviewer rewords (rev 2, ready in the browser); the server returns and the page reloads. The merged item is rev 2, ready, with the new words.

A store revision ahead of the browser's wins outright: another window moved the item on, or this browser's copy is stale after a restore, and the browser has nothing newer to protect. At the same revision the lifecycle is the store's, because a reply naming that revision is what the store knows and the browser does not; but the reviewer's close is a lifecycle fact the browser knows first (its close event may still be in the outbox), and nothing at the same revision can undo a close, so it stands. Content fields are the reviewer's typing and the region it is tied to, everything only the browser can know; a choice press is content like a note. Optional content fields the browser copy lacks are absent from the result rather than present as undefined.

Acknowledged means the server has confirmed the event carrying this revision. The store keeps that in a side table and hands the merge a predicate. The list merge keeps the browser's order, then anything only the store has, so the rail never reorders under a focused card. The reasons on the result say which half of the rule decided, so a failing test names it.

### For `docs/ongoing/code/browser-review-layer-anchoring.md`

#### `regions.ts`: region labels, and the lost state a failed mint leaves

Header: `read-when: Changing how a region is labeled for display, or when an item with a dead anchor reads as healthy.`

Record identity is the record's reference, never its display label. Two paragraphs under one heading get the same label; if identity were the label, the second edit would overwrite the first. Labels may collide; references may not. A label is pinned at first touch and never recomputed: the page repaints, a heading changes, a sibling is inserted, and a recomputed label would rename a row in the rail under the reviewer.

The label sources, in order and why: the author's own `data-review-region` (they named it); the element's id (stable and meaningful to the author); its accessible name (a human-written name); a name the element carries in its own content, such as an image's file name or an svg's title (what a person says out loud, and it does not collide the way a position does); the nearest preceding heading and a position (how a person describes it); a tag and a position (always available); a text snippet (only with no tag, which should not happen). Every source reads a descriptor, not a DOM node, so the rules test without a browser. The ordinal is counted through the heading's section, not among siblings, because a row of images is usually written one per wrapper and counted among siblings all three would be "img 1". A region with no label at all throws: a blank row in the rail is worse than a loud failure.

A failed mint is stamped lost at the moment it fails, here rather than in each caller, because the comment surface and the edit recorder both stamp it and a caller that forgot was the original silent bug. A minted reference whose text cannot identify it (one of 73 identical buttons) is lost too: "ok" means the click was captured, "lost" means nothing in `review.json` will let an agent place it, and both can be true. A stamped element is never lost, because the id plus the path and the ordinal among identical siblings is enough to pick the right twin in the source.

#### `uniqueness.ts`: whether a match is safe to write to

Header: `read-when: Changing the rule that decides whether an anchor match is safe to write to.`

A write needs a unique candidate, not a high score. A confidence that replay thresholds gets tuned into meaninglessness, and fails on the case that matters: two identical list items that swapped places match exactly, have symmetric context and score high on any scalar, so each record binds confidently to the other's node. The dangerous errors are high-confidence ambiguous. So this is a predicate with no number in it: candidates found only by structure are not eligible; none eligible, no bind; exactly one, bind; more than one, keep those whose prefix and suffix both match and bind only if exactly one survives. A tie of two perfect matches fails closed. Corroboration is recorded and never changes the verdict; a caller reading it to decide whether to write has reintroduced the score. Context is compared normalized and one-sided-tolerant, because a repaint can shorten the text either side of a region without the region moving; an empty stored context (the region was first or last) matches anything, so it can never be what eliminates a rival. The anchor engine and replay both call this one predicate and map a refusal to the same failure code, so they cannot disagree about what the reviewer is told.

### For `docs/ongoing/code/test-support.md`

#### `data/record-fixtures.ts`: realistic records for tests

Header: `read-when: Writing a test that needs a realistic record, or when a fixture's shape stops matching what the recorder makes.`

Every fixture is a real record: it goes through `newItem`, carries the page fields, and passes `validateItem`. A generator of plausible object literals would let code ship against a shape the real recorder never emits. Fixtures are deterministic for a seed, ids included, so a failing replay test reproduces; ids never come from the random source. The twice-reworded edit exists because a single rewording lets a broken replay pass by accident (the earlier `after` happens to equal `before`). The format-only fixture is text-equal and structure-different, so a comparator that fell back to text would call it a no-op. Every run fixture's words hold the token `zqxcanary`, so a test can prove the change sentence never quotes the run. The forged runs are what a script holding the token could post, one per refusal code. These used to ship inside the review layer so in-page tests could reach them; a spec now builds records in Node and hands them to the page.

#### `data/uniqueness-corpus.ts`: the corpus the predicate and the engine share

Header: `read-when: Changing the uniqueness corpus, or when the predicate or the anchor engine disagrees with it.`

One corpus judges both the predicate and the anchor engine, so the two cannot drift. Its candidate builder works over an array of block texts. It never emits a structure-only candidate, because a document where every miss also produced one would report "structure only" for every miss, which tells the reviewer nothing; the real engine emits one only when an author's region attribute matched and the text did not.

### Dropped as dead history

Owner codes and task ids (0A-kernel, 0A-wire, 1B, 1C, 1D, 2A to 2D, 3A, 3C, Task 0a), "FROZEN at CP0", "the fencing machinery below the projection is DEAD ... Phase 4B cleanup batch" (no fencing code remains), review finding and lead numbers (NEW-4, NEW-6, finding 24, code leads 7, 17 and 20, adversary review 4, design call 6), dated attributions, "CP2-mid", the `contracts.js` file's whole comment, and the "Dual-environment module" wrapper notes.

## 10. Open questions

1. **C3's `LostAnchor.reason` must be `string | null`.** `lostFromMint` writes a `null` reason in three of its four lost cases, and the anchor engine's failures may have none. C3 is not built yet; its builder should widen the field. If C3 lands first as written, C5 widens it with one line in `contract/record.ts`. Recommendation: tell the C3 builder now.
2. **The current reply is cut at 2000, not 20000.** Commit `a974b926` set out to bound the agent's own words at `REPLY_TEXT_MAX` everywhere, "the projection into review.json" included, but changed only the thread rounds. `review.json`'s `reply.text` and `reply.reason`, and the Copy text's reply and thread lines, still cut at 2000. An agent would notice the fix. Recommendation: keep C5 byte-identical (B58, B68, B74) and add a board row for a separate fix with its own test, as the architecture's Question 8 says.
3. **Fixture location.** `test/support/data/` instead of the target layout's `test/support/`, for the CommonJS reason in section 1. Decided here; the orchestrator confirms or picks another subfolder name.
4. **Playwright and the `.ts` forwarder.** Eight browser specs `require` the fixtures in Node, which now loads a `.ts` file. C3 meets the same question first (C1's decision on `rail_menu.spec.js`); C5 follows whatever that resolution was.
5. **Edits in other slices' files.** `store.js` (B2, two call sites), `anchor.js` (B3, five reads), `layer/index.js` (B12, the Node branch), `anchor_engine.test.js` (one require), `stable_addresses_docs.test.js` (one path), C1's `failures.test.ts` (one carried case), `living_in_the_page.spec.js`, `csp_refusal.spec.js` and `replay-boot.js`. The orchestrator resolves line conflicts at merge.

## Orchestrator decisions (2026-11-12)

1. **C3's lost-anchor reason may be `null`.** Added to the C3 spec's decisions so the C3 builder types it that way.
2. **The 2,000-character cut on the agent's reply** (`reason` and `text` bounded at `BEFORE_MAX`, not `REPLY_TEXT_MAX`, in `review.json` and the Copy text) stays out of C5. It is a board row of its own (LAHE-reply-cut-at-2000), because it changes what agents read and the fixed pins must change with it.
3. **Fixtures in `test/support/data/`:** accepted, with its own `package.json` (`{"type": "module"}`), because `test/support/skill.js` is CommonJS.
4. **Playwright loading the `.ts` fixtures:** follows C3's decision (run by name; use the bundle helper or a JSON copy if the forwarder cannot load in Playwright).
5. **Edits in other slices' files** (`store.js`, `anchor.js`, `layer/index.js`, two specs, `replay-boot.js`) are C5's, in the same pull request. The orchestrator resolves line conflicts.
