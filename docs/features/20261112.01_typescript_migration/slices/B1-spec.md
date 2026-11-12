---
read-when: Building or reviewing slice B1 of the TypeScript migration.
---

# B1 spec: the browser leaves, rebuilt as seven review-layer modules

This slice converts the six review-layer files that depend on nothing else in the layer. It is a rebuild to the behavior below, test first, not a translation. Behavior statements are numbered B1 to B80; "the slice" always means this slice, never statement B1.

Sources read: the architecture (Questions 2, 5, 6, 7, 8), the plan ("How each slice is built", the browser chain table, "Tests that read source text"), `parts/target_layout.md`, `research/codebase_recon.md` sections 1, 2, 6, 8 and 9, `docs/ongoing/code/README.md`, `docs/ongoing/code/domain.md`, `docs/ongoing/code/browser-review-layer-editing.md`, the C3 and C5 specs, the merged C1, C2 and C4 modules on main, the six files, every caller, and the tests named below.

## 1. Scope

### Old files

Counted by `scratchpad/specs/b1_counts.py` (physical lines; a comment line is one whose first non-space characters are `//`, `/*` or `*`).

| Old file | Lines | Comment lines | Registers as |
| --- | --- | --- | --- |
| `src/layer/listeners.js` | 159 | 44 | `listeners` |
| `src/layer/selection.js` | 173 | 67 | `selection` |
| `src/layer/blocks.js` | 368 | 90 | `blocks` |
| `src/layer/conflict_toast.js` | 340 | 93 | `conflictToast` |
| `src/layer/choices.js` | 501 | 110 | `choices` |
| `src/layer/export.js` | 648 | 199 | `exporter` and `export` (one object) |
| **total** | 2,189 | 603 | |

### New modules

| Module | One job | Registered as |
| --- | --- | --- |
| `src/browser/review-layer/listeners.ts` | The listener registry and its group names | `listeners` |
| `src/browser/review-layer/anchoring/selection.ts` | Reading the live page's caret and selection, and the one caret move | `selection` |
| `src/browser/review-layer/anchoring/blocks.ts` | Reading the page's blocks: the leaf walk, insert points, hosts, a record's run | `blocks` (with `block-build.ts`) |
| `src/browser/review-layer/anchoring/block-build.ts` | Building a block element from a record, and changing an element's tag | `blocks` (with `blocks.ts`) |
| `src/browser/review-layer/rail/conflict-toast.ts` | When a replay collision is news, what the toast says, where pressing it goes | `conflictToast` |
| `src/browser/review-layer/review/choices.ts` | Arming choice groups on a document page, the refusal chip, and minting a press | `choices` |
| `src/browser/review-layer/review/export.ts` | Copy and Export: scope, text, filename, clipboard and download | `exporter`, `export` |

`blocks.js` splits in two because reading the page and building elements need different narrow interfaces and have different callers (the builders are only `protect`, `editing` and `replay`). Both stay in `anchoring/`, the target layout's folder, and register as one name through the manifest's `modules` list.

### Bridges, tests and docs this slice adds or moves

- Forwarders at `src/layer/listeners.js`, `selection.js`, `blocks.js`, `conflict_toast.js` and `export.js`, each `module.exports = Object.assign({}, require("<new path>.ts"));` (`blocks.js` assigns both modules). **`src/layer/choices.js` gets no forwarder**: nothing requires it in Node (only the manifest names it), so it moves with `git mv` to `review/choices.ts`.
- New tests: `test/unit/browser/review-layer/listeners.test.ts`, `anchoring/blocks.test.ts`, `anchoring/block-build.test.ts`, `review/choices.test.ts`, `review/export.test.ts`; `test/unit/conflict_toast.test.js` moves with `git mv` to `test/unit/browser/review-layer/rail/conflict-toast.test.ts`; one shared fake at `test/unit/browser/review-layer/support/fake-page.ts`; one JavaScript bridge test, `test/unit/layer_leaves_bridge.test.js` (section 4, "Bridges").
- Folder docs: new `docs/ongoing/code/browser-review-layer.md`, `browser-review-layer-rail.md` and `browser-review-layer-review.md`; three new sections in `browser-review-layer-anchoring.md` (which C5 creates).

## 2. Behavior

Every statement is checkable by a test. "The test" column in section 5 and the test plan in section 4 say which file checks each. Statements B13 to B21 are checked in a browser (section 4, "selection.ts").

### `listeners.ts`

- **B1.** `GROUP` is exactly `{DOCUMENT: "document", OVERLAY: "overlay", NAVIGATION: "navigation", STORAGE: "storage", NETWORK: "network", COMMENTS: "comments", EDITING: "editing", INTERACTION: "interaction", PRESENT: "present", CHOICES: "choices"}`.
- **B2.** `createRegistry()` returns a registry holding nothing: `count()` is 0 and `groups()` is `{}`.
- **B3.** `registry.on(target, type, handler, options, group)` calls `target.addEventListener(type, handler, options)` once, with exactly those three values, and returns a handle. `count()` and `count(group)` each rise by one.
- **B4.** `on` throws `TypeError` and binds nothing (no `addEventListener` call, count unchanged) when the target has no `addEventListener` function, when `type` is not a non-empty string, or when `handler` is not a function.
- **B5.** `handle.off()` calls `target.removeEventListener(type, handler, options)` with the same three values and drops the entry. A second `off()` on the same handle does nothing: no second call, count unchanged.
- **B6.** When `removeEventListener` throws, `off`, `offGroup` and `offAll` still drop the entry and do not throw.
- **B7.** `offGroup(group)` removes every entry of that group (calling `removeEventListener` for each) and returns how many it removed. Other groups are untouched. A group with no entries returns 0.
- **B8.** `offAll()` removes every entry and returns how many it removed.
- **B9.** `count(group)` is the number of entries in that group; `count()` is the number of all entries.
- **B10.** `groups()` returns a new plain object mapping each group that has entries to its count. Changing the returned object changes nothing in the registry.
- **B11.** Each `on` call is its own entry, even for the same target, type and handler (two calls count 2). Two registries never share entries.
- **B12.** `shared` is the page's one registry. The module's own `on(...)` and `count(...)` act on it: a binding made through `on` is counted by `shared.count()` and the reverse.

### `anchoring/selection.ts`

- **B13.** `BLOCK_TAGS` is exactly `["P", "LI", "H1", "H2", "H3", "H4", "H5", "H6", "BLOCKQUOTE", "TD", "TH", "DD", "DT", "FIGCAPTION", "PRE", "DIV", "SECTION", "ARTICLE"]`.
- **B14.** With no page (no `window.getSelection`, as in Node), or a selection with no range: `currentRange()`, `caretNode()`, `caretContainer()` and `selectedRange()` are `null`; `hasSelection()` and `containsCaret(el)` are `false`; `blockFor(null)` is `null`; `placeCaretAtStart(el)` is `false`. None of them throws.
- **B15.** `currentRange()` is the page selection's first range itself. `selectedRange()` is a clone of it: changing the clone does not move the reviewer's selection.
- **B16.** `caretNode()` is the first range's `startContainer`, the text node itself when the caret is in text (identity kept).
- **B17.** `caretContainer()` is the caret node when it is an element, else its `parentElement`, else `null`.
- **B18.** `containsCaret(el)` is true when the caret node is `el` or inside it; false for a missing `el`.
- **B19.** `hasSelection()` is true only for a selection that is not collapsed.
- **B20.** `blockFor(el)` starts at `el` (or at `caretContainer()` when `el` is `null` or missing) and walks `parentElement` upward, returning the first element whose `tagName` is in `BLOCK_TAGS`, compared exactly; `null` when it reaches a non-element or the top.
- **B21.** `placeCaretAtStart(el)` replaces the selection with one collapsed range at the start of `el`'s contents and returns `true`; with no `el` or no page it returns `false` and changes nothing.

### `anchoring/blocks.ts`

Terms used below. An element is **not content** when its lowercase tag is a dropped-subtree tag (C2's `isDroppedSubtreeTag`) or `head`, or its role is chrome (C1's `roleOf(el) === ROLE_CHROME`), or its `id` is C1's `OVERLAY_ROOT_ID`. It is **skipped** when it is not content or is the file title (C1's `isFileTitle`). An element **has a block inside** when some element child that is not content has a block tag (C2's `isBlockTag`) or has a block inside. An element is a **leaf** when its lowercase tag is a block tag and it is `ul` or `ol`, or has no block inside. Its **words** are C2's `blockWords(cleanMarkup(el.innerHTML))`.

- **B22.** `leafWalk(root)` lists the leaves under `root` in document order. It descends into every element that is not a leaf, never into a skipped element, and never treats `root` itself as a candidate. A `ul` or `ol` is one leaf, its items not listed. `leafWalk(null)` is `[]`.
- **B23.** A leaf whose words are empty is left out.
- **B24.** `leafWalk(root, point)` with a point `{parent, before}` lists only the leaves that start after it. `before: null`, or a `before` that is not a child of `parent`, means the end of `parent`. A point whose `parent` is `null` reads as no point.
- **B25.** `insertPointAfter(anchor)` is `{parent: anchor.parentNode, before: anchor.nextSibling}`, except that it first climbs while the current node's parent is a **chrome wrapper**: an element other than `body`, `main` or `html` whose other children are only comments, whitespace text and at least one piece of inline chrome. Inline chrome is a not-content element, or an element with no block tag and no block inside (the "Section N" label beside an `h2` in a sheet-head). Any other sibling (text with words, a block, an element holding a block) means it is not a wrapper.
- **B26.** `startPointIn(container)` is `{parent: container, before}`, where `before` is the first child that is not leading chrome, or `null`. Leading chrome is a comment, whitespace text, a not-content element, the file title, or a block-tag element whose children are only comments, whitespace text, not-content elements and wordless elements, with at least one file title among them (the hero of an empty notes page).
- **B27.** `CONTAINER_TAGS` is `["main", "body"]`. `isContainerAnchor(el)` is true when `el`'s lowercase tag is one of them.
- **B28.** `hostFor(anchor, placement)` is `anchor` when `placement` is `start_of_container` or `anchor` is a container; otherwise `insertPointAfter(anchor).parent`.
- **B29.** `canHoldRun(anchor, placement)` is false when `anchor` is not an element, when its tag is `td`, `th`, `dt`, `dd` or `figcaption`, when its host (B28) is not an element, or when the host's tag is one of those five or `tr`, `tbody`, `thead`, `tfoot`, `table`, `dl`, `ul`, `ol`. Otherwise true. `placement` may be left out.
- **B30.** `runElementsFor(record, doc, anchor)` reads the record's list (`remove_blocks` when it is a non-empty array, else `new_blocks` when it is an array, else `[]`; a `null` record reads as `[]` after an anchor insert point), its start (`startPointIn(anchor)` for `start_of_container`, else `insertPointAfter(anchor)`), and the leaves after the start under `doc.body` (or `anchor.ownerDocument.body` when `doc` is `null`). It returns `{start, blocks}`, one entry per C2 `matchRun(list, leaves)` result: `{index, status, elements}`, where `elements` are the leaves the match names, in its order. A missing block has `elements: []`. Each leaf goes to the matcher as `{tag, html: cleanMarkup(innerHTML), words}`.
- **B31.** `runClashFor(record, doc, anchor)` is `null` for a take-back (non-empty `remove_blocks`) and when C2's `runClash` over the same walk finds nothing; otherwise `{index, blocks, element}`, where `element` is the clashing leaf.

### `anchoring/block-build.ts`

- **B32.** `writeBlock(tag, html, doc)` is `null` unless `tag`, lowercased, is one of C2's `WRITABLE_BLOCK_TAGS` (`p`, `h2`, `h3`, `h4`, `ul`, `ol`) and C2's `cleanBlock(tag, html)` accepts `html`. Otherwise it returns a new element of that tag holding the cleaned content.
- **B33.** The block is built only with `doc.createElement` called with a constant from the inline set (`strong`, `em`, `br`, `li`, C2's `NOT_BOLD_TAG`, `NOT_ITALIC_TAG`) and `doc.createTextNode`, appended in order. No attribute is set and no markup string is assigned. Text has `&lt;`, `&gt;` and `&amp;` decoded. `br` gets no children; a closing tag never closes the block itself. A cleaned tag outside the inline set makes the whole result `null`. Examples, with a real document: `writeBlock("p", 'Fish &amp; <b onclick="x()">chips</b> &lt;3<br>', document)` is `<p>Fish &amp; <strong>chips</strong> &lt;3</p>`; `writeBlock("ul", "<li>One</li><li>Two</li>", document)` is `<ul><li>One</li><li>Two</li></ul>`; `"script"` and `"<img src=x onerror=alert(1)>"` give `null`.
- **B34.** `swapTag(el, tag)` is `null`, with nothing changed, when `tag` is not one of the six writable tags, when `el` is not an element, or when `el` has no parent. When `el` already has that tag (case-insensitive) it returns `el` unchanged. Otherwise it creates the new element from `el.ownerDocument`, copies every attribute by name and value (the `data-lahe-id` stamp included), moves every child in order, replaces `el` in its parent, and returns the new element.

### `rail/conflict-toast.ts`

A conflict is a record id that replay flags now (`conflictIds()`) and whose record `itemById(id)` returns; its **key** is `"<id>:<rev>"` with the record's current `rev`.

- **B35.** `titleFor(n)` is `"Your edit clashed with a change to the page"` for `n` of 1 or less, else `"<n> of your edits clashed with changes to the page"`. `bodyFor(n)` is `"Nothing is lost. Both versions are on the thread. Click to choose which to keep."` for 1 or less, else `"Nothing is lost. Both versions are on each thread. Click to choose which to keep."`.
- **B36.** A raised toast is one `rail.showToast` call with `label: "Conflict"`, `text: titleFor(count)`, `about: bodyFor(count)`, `sticky: true`, an `onOpen` and an `onGone`, where `count` is the number of record ids it names. Its `key` starts with `conflict:` and differs on every raise, so the rail never refuses it as already seen.
- **B37.** `sync()` with no conflicts raises nothing and returns `null`. A flagged id whose record is gone is not a conflict.
- **B38.** `sync()` raises one toast naming every conflict that is neither dealt with nor already named by the standing toast, and returns the id `showToast` returned. When `showToast` returns `null`, nothing stands and `sync()` returns `null`.
- **B39.** A `sync()` that finds nothing new (every conflict is dealt with or already on the standing toast) raises nothing and returns `null`: a repaint that re-finds a standing conflict is not news.
- **B40.** When a new conflict appears while a toast stands, the standing toast is dismissed with reason `"replaced"` and one new toast names all of them, with the new count.
- **B41.** When the rail reports the toast gone with reason `"user"` (the reviewer pressed it or swiped it away), every key it named is dealt with. A dealt-with key is never raised again while its conflict stays open: not by later syncs, and not by a new instance on the same storage and review (a reload).
- **B42.** Gone for any other reason (`"replaced"`, `"timeout"`) deals with nothing. A new instance on the same storage and review, with nothing standing, raises every open conflict that was raised and not dealt with, as one toast with the count.
- **B43.** The same record conflicting at a new `rev` is a new conflict, raised even when the old `rev` was dealt with.
- **B44.** A record id open at the previous `sync()` and not open now (resolved here, cleared by replay, resolved in another tab) has every key forgotten, raised and dealt with alike. If it is flagged again later, at the same `rev`, it is raised again. Only that record's keys are forgotten, matched by exact id.
- **B45.** The standing toast then names only its ids still open. When none are left it is dismissed with reason `"replaced"` and nothing stands.
- **B46.** While `isHidden()` is true (presenting, or a read-only window), `sync()` raises nothing and records nothing as raised; forgetting closed conflicts and narrowing the standing toast still happen. The first `sync()` after it turns false raises.
- **B47.** `resolved(id)` marks the record's current key dealt with when `itemById(id)` returns it, then runs `sync()`. So a conflict replay still flags for a moment is not raised again.
- **B48.** Pressing the toast (`onOpen`) calls `rail.collapse(false)`, then picks the first of the toast's ids that replay still flags, else its first id. With a record for it, it calls `rail.selectTab(rail.paneForItem(record))`; then `rail.revealCard(id)` and `rail.setCardCollapsed(id, false)`. When `rail.cardNode(id)` gives a node, the node's `[data-lahe-conflict]` descendant (or the node itself) gets `scrollIntoView({block: "nearest"})`, and the node gets `tabIndex = -1` and `focus()`.
- **B49.** State is kept under the storage key `"lahe:conflict-notices:<reviewId>"` as JSON `{"raised": [...], "dealt": [...]}`, each list holding only its newest 50 keys. With `storage: null` every rule above holds within the instance. A storage whose read throws, or that holds text that is not JSON or not an object with those lists, reads as nothing stored; a write that throws is ignored; either way the instance's own memory still stops repeats.
- **B50.** `info()` returns `{standing: {toastId, ids} | null, raised, dealt}` as copies.

### `review/choices.ts`

The markup names are C3's `CHOICE_MARKUP`: group class `choice`, name attribute `data-choice`, question class `choice-q`, chosen attribute `data-chosen`, inert attribute `data-lahe-inert`. A button's text is its `textContent` with whitespace runs collapsed to one space and trimmed. `clip(text, n)` is the text when it is at most `n` characters, else its first `n - 1` characters followed by `…`.

- **B51.** `REFUSAL` is exactly `{NO_NAME: "no-name", BAD_NAME: "bad-name", DUPLICATE: "duplicate", TOO_FEW: "too-few-buttons", NESTED: "nested-buttons", BAD_VALUE: "bad-value", SAME_VALUE: "same-value", TWO_CHOSEN: "two-chosen"}`.
- **B52.** `judge(group, counts)` applies these checks in order; the first that fails is the verdict, with this `detail`:
  1. no name, or an empty one: `no-name`, `it has no data-choice name`;
  2. a name that is not a choice token (C3 `isChoiceToken`): `bad-name`, `its name "<clip(name, 40)>" is not <CHOICE_TOKEN_RULE>`;
  3. `counts` says more than one group has this name: `duplicate`, `<n> groups on this page are named <name>`;
  4. any `button` descendant that is not a direct child: `nested-buttons`, `its buttons must sit directly inside the group, not wrapped in a paragraph or another element`;
  5. fewer than two direct buttons: `too-few-buttons`, `it has only one button` or `it has no buttons`;
  6. per button in order, a `value` that is not a choice token: `bad-value`, `the button "<clip(text, 40)>" has no value` (missing or empty) or `the button "<clip(text, 40)>" has the value "<clip(value, 40)>", which is not <CHOICE_TOKEN_RULE>`;
  7. a value seen earlier in the group: `same-value`, `two buttons have the value <value>`;
  8. more than one button carrying `data-chosen`: `two-chosen`, `more than one button carries data-chosen`.
  A group that passes all eight is armed: its name is its token, refusal and detail `null`.
- **B53.** `chipDetail(refused)` is one line per refused verdict, in order, `<label>: <detail>.`, joined by `"\n"`, each distinct line once. The label is `The choice <name>` when the name is a choice token, else `The choice asking "<clip(question, 60)>"` when the group has a `.choice-q` with text, else `A choice with no name or question`.
- **B54.** `arm()` on a page that is not a document page (`isDocument` not `true`) writes nothing to the page, raises and clears no chip, empties the armed and refused lists, and returns `{armed: [], refused: []}`.
- **B55.** `arm()` on a document page judges every element matching `.choice`, with `counts` built from the names that are choice tokens. A refused group gets `data-lahe-inert="<refusal>"`; an armed group loses `data-lahe-inert`; an attribute already right is not written again. All writes happen inside one write-epoch write named `choices` (C1's `write`), so replay does not wake for them. With refused groups it calls `rail.failures.add(failure("CHOICE_GROUP_INERT", chipDetail(refused)))`; with none, `rail.failures.clear("CHOICE_GROUP_INERT")`. It returns copies of the armed and refused verdict lists.
- **B56.** `counters.arms` rises by one on every `arm()`, document page or not. `armedNames()` lists the armed names in page order; `refused()` lists `{name, refusal, detail}` per refused group; `isDocument()` says which kind of page this is.
- **B57.** `bind()` registers, through the given registry and group, a capture `pointerdown` handler on the window when one is given (else on the document) and a capture `click` handler on the document. It does nothing without a document or a listeners option, and a second `bind()` does nothing. `unbind()` removes both; `bind()` after `unbind()` binds again.
- **B58.** Off a document page, `pointerdown` and `click` do nothing at all: no press, no counter.
- **B59.** A click whose event is already `defaultPrevented` (the page, or pick mode, took it first) is never a press. It adds one to `counters.refusedPresses` when its target is inside a `button` inside a `.choice` group.
- **B60.** A click's button is the target element's (or, for a text node, its parent element's) nearest `button`, and its group that button's nearest `.choice`. It counts only when that group is armed. When the group is not in the armed list, `arm()` runs once more and the click is judged again against the new list (a group a repaint replaced).
- **B61.** The press is decided by C1's `gestureFor({type: "click", inOverlay: false, inArmedChoice, documentPage: true, pickMode, editing, editState, mayWrite, presenting})`, with the gate read at click time. When the pointer went down on the same button within 2000 ms before the click, the gate is combined with the one read then: `pickMode`, `editing`, `editState` and `presenting` are true when either says true, and `mayWrite` only when both do. That pointer-down reading is used once. When the decision is not `PRESS_CHOICE`, nothing is stored, and `counters.refusedPresses` rises when the click hit an armed group. When the decision says `preventDefault`, the click's `preventDefault()` is called.
- **B62.** A press on a group with no choice record for it, or whose latest record (C3 `latestChoiceByGroup` over the choice records `store.read(reviewId)` holds for that group) is handled, mints a new record with C3's `newItem`: kind `choice`, state `draft`, `choice: {group, answer}`, `context` C3's `emptyContext()` with `quote` the group's question (or `null`) and `heading` from `headingFor(group)` (or `null`), `region: {ref: choiceRef(group), label: "choice", lost: null, accepted_page_texts: [], check_reopen: null}`, and the page fields from `page()`. It is validated (C3 `validateItem`), written with `store.write(reviewId, record)` and posted with `sync.recordItem(record, {press: true})`; then the same record with state `ready` is validated, written and posted the same way. Nothing is flushed at once.
- **B63.** A press on a group whose latest record is `not_handled` stores C3's `continueThread(latest)` with `choice` set to the new answer, even when the answer is the same. When the latest is `ready` with a reply (a question), the same answer stores nothing and a different one continues the thread the same way. When the latest is `ready` without a reply, or a `draft`, the same answer stores nothing and a different one stores C3's `bumpRev(latest, {choice})` with state `ready`. Each of these is one validated write and one post.
- **B64.** After a press that stored something, `counters.presses` rises by one and `onPress(stored)` is called with the last record written. A press whose group name or button value is no longer a choice token (the page changed it after arming) stores nothing.

### `review/export.ts`

- **B65.** `SCOPE` is `{FULL: "full", SLICE: "slice"}`. `SLICE_LABEL` is exactly `"This is this page's slice of the review: the items this browser is holding. The local helper was not reachable, so anything recorded on another origin, in another browser, or in another profile is not in this file."`
- **B66.** `renderReviewText({records, scope, review, title})` with scope `full` is exactly C5's `renderText({id: review, items: records, title})`; with scope `slice` it is `SLICE_LABEL + "\n\n"` followed by that same text. A missing or blank title renders the same as `null`.
- **B67.** `renderReviewText` throws, checking in this order: `TypeError("renderReviewText: records must be an array")` when `records` is not an array; `Error("renderReviewText: scope must be full or slice, got <String(scope)>")` for any other scope, a missing one included; `TypeError("renderReviewText: a review id is required; the text names the review it came from")` when `review` is missing or empty.
- **B68.** `filenameFor({review, scope, label, title, at})` is `"lahe-review-"`, then the title part, then the id, then `-<label>` when a label is given, then `-yyyymmdd-hhmm` in local time (of `at`, else now), then `-this-page-slice` when the scope is `slice`, then `.txt`. The id is `review` (or `review` itself, the word, when none is given) and the label are each made safe by turning every run of characters outside `A-Za-z0-9._-` into one `-`. The title part, when the title has non-space characters, is the trimmed title made safe the same way, stripped of leading and trailing `-`, cut to 40 characters, stripped of trailing `-` again, then followed by `-`; a title whose safe form is empty adds nothing.
- **B69.** `recordsFromBody(body)` takes the body's `records` when it is an array, else its `items` when it is an array. It is `null` when the body is not an object, when there is no such list, when the list is empty, or when any element is not a record C3's `validateItem` accepts; otherwise the list.
- **B70.** `unionById(local, remote)` keeps `local` in its order; appends, in `remote`'s order, each remote record whose id is not local; and replaces a local record in place with the remote one of the same id only when the remote `rev` is greater.
- **B71.** Scope is decided live at every action, never remembered. When `sync.status()` says `cspRefused: true`, the scope is `slice` and nothing is fetched (probe `{reachable: false, via: "sync", reason: "csp_refused", status: null, body: null}`). With no fetch available, `slice` (`via: "no_fetch"`, `reason: "no fetch here"`). Otherwise one `GET` to `<helperOrigin><review.read path>?review=<encodeURIComponent(review)>` with headers `x-lahe-client: layer` and `x-lahe-token: <token, or "">`: status 200 or 501 is `full` (`reachable: true, via: "helper", reason: null`); any other status is `slice` with reason `helper answered <status> for this review`; a rejected request is `slice` with the error's message as reason, or `the helper did not answer in time` when the 2000 ms deadline aborted it. The deadline is armed with the window's `setTimeout` when a window is given, and cleared when an answer comes. A body that is not JSON reads as `null`. A `sync.status()` that throws reads as no status. The helper origin defaults to C4's `DEFAULT_HELPER_ORIGIN`.
- **B72.** The records rendered are this browser's (the `records` option's result, else `store.read(review)`, else none). In `full` scope, records that `recordsFromBody` finds in the probe's body are folded in with `unionById(local, found)`.
- **B73.** `copyReview()` renders with the live scope, the review id and the document's title (trimmed, or `null` when empty or absent), and writes the text to the clipboard: the `clipboard` option, else the window's `navigator.clipboard`, else the global one. It resolves `{ok: true, action: "copy", scope, text, characters: text.length}`. On any failure (no clipboard, which reads `this browser gave the page no clipboard to write to`; a refused write; a render that throws) it adds `failure("COPY_FAILED", <message>)` to `rail.failures` and resolves `{ok: false, action: "copy", scope, text, code: "COPY_FAILED", error: <message>}`, with `scope` and `text` `null` when it failed before reaching them.
- **B74.** `exportReview()` renders the same way, names the file `filenameFor({review, scope, title})` and saves it: it needs a document and a window (else `export: there is no page here to download from`), and the window's `URL.createObjectURL` (else the global `URL`) and `Blob` (else the global one), else `this browser gave the page no way to save a file`. It makes one blob of the text with type `text/plain;charset=utf-8`, an `a` element with that object URL as `href`, the filename as `download`, `rel` `noopener` and `display: none`, appends it to the body (else the root element), clicks it, takes it out again, and revokes the object URL in a 0 ms timer when the window has one. It resolves `{ok: true, action: "export", scope, text, filename}`, or on failure adds `EXPORT_FAILED` and resolves `{ok: false, action: "export", scope, text, filename, code: "EXPORT_FAILED", error}`.
- **B75.** `exportRecords(records, {scope, download, filename, label})` renders the caller's records with the given scope (or the live one when none is given), names the file with the given filename or `filenameFor({review, scope, label, title})`, and saves it unless `download` is `false`. It resolves `{ok: true, action: "export_records", scope, text, filename}` (`filename: null` when nothing was saved), or on failure adds `EXPORT_FAILED` and resolves `{ok: false, action: "export_records", scope: <the given scope, or null>, text: null, filename: null, code: "EXPORT_FAILED", error}`.
- **B76.** `last()` is the result of the most recent of the three actions, or `null` before any. `scopeNow()` resolves `{scope, records: <how many>, probe}`.
- **B77.** No action throws or rejects: every failure, a missing review id included, becomes a failure result and a chip.
- **B78.** `configure(instance)` makes `instance` the page's exporter; the module's own `exportRecords(records, options)` hands the call to it and returns its promise. With nothing configured it returns a promise rejected with `Error("LAHE.exporter is not configured yet. The layer's boot configures it; a caller outside boot builds its own with createExport().")`.
- **B79.** The copy text and the export text of the same records in the same scope are the same bytes: both carry the page title.
- **B80.** In the bundle, `window.LAHE.exporter` and `window.LAHE.export` are one object, so the exporter `index.js` configures through `exporter` is the one `tab_edits.js` reaches through `export`.

## 3. Callers

"Breaks?" says whether a caller depends on something this spec changes. Every "no" keeps working through the forwarder or the registration with no edit.

### `listeners`

| Caller | Uses | Breaks? |
| --- | --- | --- |
| `src/layer/index.js` (Node branch requires `./listeners.js`; browser reads `ns.listeners`) | `shared.on`, `shared.groups`, `count`, `GROUP.INTERACTION`, `GROUP.PRESENT`, `GROUP.CHOICES`; passes `shared` to choices | no |
| `src/layer/comments.js` | `on` (10 calls, group always passed), `GROUP.COMMENTS` | no |
| `src/layer/editing.js` | `on` (27 calls, group always passed), `GROUP.EDITING` | no |
| `src/layer/inject.js` | `shared` (default registry), `GROUP.DOCUMENT`, `NAVIGATION`, `COMMENTS`, `EDITING`, `NETWORK`; `registry.on`, `registry.offGroup` | no |
| `src/layer/zoom.js` | `shared` (default registry), `GROUP.OVERLAY`; `registry.on` | no |
| `test/unit/remount_contract.test.js` | `createRegistry`, `GROUP.*`, `registry.on` (options `true`), `count`, `groups` | no |
| `test/browser/living_in_the_page.spec.js`, `bfcache_restore.spec.js`, `selection_popover.spec.js` | `__lahe.listenerCount`, `__lahe.listenerGroups` (index.js over `count` and `shared.groups`) | no |

### `selection`

| Caller | Uses | Breaks? |
| --- | --- | --- |
| `src/layer/protect.js` | `currentRange` (3), `caretNode`, `hasSelection` (2) | no |
| `src/layer/editing.js` | `blockFor` (5, once with `null`), `caretContainer`, `hasSelection`, `placeCaretAtStart` (2), `selectedRange` (2) | no |
| `src/layer/sync.js` (Node branch requires `./selection.js`) | `BLOCK_TAGS.join(",")` | no |
| `test/fixtures/assets/editing-boot.js` | `LAHE.selection.containsCaret` | no |

### `blocks`

| Caller | Uses | Breaks? |
| --- | --- | --- |
| `src/layer/anchor.js` | `CONTAINER_TAGS.indexOf` | no |
| `src/layer/overlay.js` | `leafWalk` | no |
| `src/layer/protect.js` | `writeBlock` (3, doc passed), `startPointIn`, `insertPointAfter`, `swapTag` | no |
| `src/layer/editing.js` | `startPointIn`, `insertPointAfter`, `runElementsFor`, `isContainerAnchor`, `hostFor`, `swapTag`, `canHoldRun` (one argument), `leafWalk`, `writeBlock` (doc passed) | no |
| `src/layer/replay.js` | `writeBlock` (6, doc passed), `swapTag`, `runClashFor`, `runElementsFor`, `leafWalk`, `insertPointAfter` | no |
| `src/layer/tab_edits.js` | `ns.blocks.runElementsFor` (through `washModules` or `root.LAHE`) | no |
| `src/layer/index.js` | passes `ns.blocks` in `washModules` | no |
| `test/browser/blocks_kernel.spec.js` | `leafWalk`, `insertPointAfter`, `startPointIn`, `hostFor`, `canHoldRun`, `runElementsFor`, `swapTag`, `writeBlock` **called with no document** (4 calls) | **yes**: each `writeBlock` call gains `document` as its third argument (deliberate difference D3). What it asserts does not change |
| `test/browser/replay_run_fix_round.spec.js` | replaces `LAHE.blocks.leafWalk` and counts replay's calls | no: replay still reads the registered object, which stays writable |

### `conflictToast`

| Caller | Uses | Breaks? |
| --- | --- | --- |
| `src/layer/index.js` | Node branch requires `./conflict_toast.js`; `createConflictToasts({rail, reviewId, storage, conflictIds, itemById, isHidden})`, `sync()`, `resolved(id)` (return ignored) | no |
| `test/unit/conflict_toast.test.js` | `createConflictToasts`, `titleFor`, `sync`, `resolved`, `info`; the real overlay as rail | **yes**: it is this slice's file, moved and rewritten (section 5) |

### `choices`

| Caller | Uses | Breaks? |
| --- | --- | --- |
| `src/layer/index.js` | `createChoices({document, window, isDocument, store, reviewId, page, sync, rail, gate, headingFor, listeners: {registry, group}, onPress})`; `arm`, `bind`, `unbind`, `armedNames`, `refused`, `isDocument`, `counters` (copied with `Object.assign`) | no |
| `test/browser/choice_buttons.spec.js`, `choice_style.spec.js` | through `__lahe.choices` and the page | no |

`press` and `labelFor` on the instance have no reader anywhere.

### `exporter` / `export`

| Caller | Uses | Breaks? |
| --- | --- | --- |
| `src/layer/index.js` | Node branch requires `./export.js`; `createExport({review, token, helperOrigin, store, sync, rail, document, window})`, `configure(instance)` (return ignored); instance `copyReview`, `exportReview` passed as bare functions to `rail.onAction`; the instance is published as `__lahe.exporter` | no |
| `src/layer/tab_edits.js` | `root.LAHE.export.exportRecords(items, {scope: SCOPE.SLICE, label: "hand-edits"})` and `SCOPE` | no |
| `test/unit/export_text.test.js` (fixed) | `renderReviewText`, `SLICE_LABEL`, `filenameFor`, `createExport({review, records, fetch, window: null, clipboard, rail})`, instance `exportRecords`, `last`, `scopeNow`, `copyReview`, `unionById`, `recordsFromBody`; `manifest.ownerOf("src/layer/export.js")` | no (section 7) |
| `test/browser/copy_export.spec.js`, `ac1_walk.spec.js` | Node `require("../../src/layer/export.js").SLICE_LABEL`; `__lahe.exporter.last()` | no |
| `test/browser/rail_menu.spec.js` | `__lahe.exporter.last()` | no |
| `test/browser/edits_tab.spec.js` | deletes `LAHE.exporter` and `LAHE.export`, expects the hand-edit export to fail honestly; exports through `tab_edits` | no |

### Not callers

`scripts/` reads none of these. `src/shared/manifest.js` names their paths (section 4, "Bridges"). `test/browser/support/export_stub.js` seeds its own `LAHE.export` and is dead (on C1's cleanup list).

## 4. Module design

### Rules every module follows

- Erasable syntax only (no `enum`, no `namespace`, no parameter properties), named exports only, no default export, no top-level `await`, no `as` other than `as const`, no `!`, no `any`. A module exports functions and constants, never a `let`. Each file opens with only its `read-when` header (section 9).
- Tables are `as const` with the union derived from them; membership is a `ReadonlySet<string>` built from the table, never `indexOf` on a cast.
- **No DOM global type appears in an exported signature of a unit-tested module.** `test/unit` has `lib: es2024` and Node's types, no DOM, and it reads the review-layer project's declaration output, so a declaration naming `Element`, `Range` or `Document` fails to compile there. Every module below except `selection.ts` therefore takes narrow structural interfaces. `AbortSignal` is allowed: Node's types declare it too. Bodies may still use `window`, `document`, `navigator` and `fetch` as ambient defaults.
- **The page's own objects flow through.** Where a function hands back a node it was given or found, the interface is generic over the caller's node type (F-bounded, as `interface X<E extends X<E>>`), so the real DOM gets back `Element` and a test fake gets back its own type, both without a cast. The real DOM types must satisfy each interface with `N = Node`, `E = Element` (or `HTMLElement`); members below are written to that end, and the builder may adjust a member's type for assignability. A member that cannot be shaped so goes to the orchestrator, not into a cast.
- Imports: `listeners.ts` and `conflict-toast.ts` import nothing. `selection.ts` imports nothing. `blocks.ts` imports C1's `markers.ts`, C2's `html-syntax.ts`, `clean-markup.ts`, `run-blocks.ts`, `run-match.ts`, and C3's `record.ts` (types `RunBlock`, `Placement`, constant `PLACEMENT`). `block-build.ts` imports C2's `run-blocks.ts` and `formatting.ts`. `choices.ts` imports C3's `record.ts`, `choice.ts`, `item-check.ts`, `item-revisions.ts`, `thread.ts`, `choice-state.ts`, `page-identity.ts` (type `PageView`), C1's `gestures.ts`, `failures.ts`, `write-epoch.ts`, and `listeners.ts` (types). `export.ts` imports C5's `review-text.ts`, C3's `record.ts` and `item-check.ts`, C4's `routes.ts`, `headers.ts`, `helper-address.ts`, and C1's `failures.ts`. All are `.ts` on main by checkpoint 1; no cycles.

### `listeners.ts`

```ts
export const GROUP: {
  readonly DOCUMENT: "document"; readonly OVERLAY: "overlay"; readonly NAVIGATION: "navigation";
  readonly STORAGE: "storage"; readonly NETWORK: "network"; readonly COMMENTS: "comments";
  readonly EDITING: "editing"; readonly INTERACTION: "interaction"; readonly PRESENT: "present";
  readonly CHOICES: "choices";
};
export type ListenerGroup = (typeof GROUP)[keyof typeof GROUP];

export type ListenerOptions = boolean | { readonly capture?: boolean; readonly passive?: boolean; readonly once?: boolean };
export interface ListenerTarget<Ev> {
  addEventListener(type: string, handler: (event: Ev) => void, options?: ListenerOptions): void;
  removeEventListener(type: string, handler: (event: Ev) => void, options?: ListenerOptions): void;
}
export interface ListenerHandle { off(): void }
export interface ListenerRegistry {
  on<Ev>(target: ListenerTarget<Ev>, type: string, handler: (event: Ev) => void, options: ListenerOptions | undefined, group: ListenerGroup): ListenerHandle;
  offGroup(group: ListenerGroup): number;
  offAll(): number;
  count(group?: ListenerGroup): number;
  groups(): Partial<Record<ListenerGroup, number>>;
}

export function createRegistry(): ListenerRegistry;
export const shared: ListenerRegistry;
export function on<Ev>(target: ListenerTarget<Ev>, type: string, handler: (event: Ev) => void, options: ListenerOptions | undefined, group: ListenerGroup): ListenerHandle;
export function count(group?: ListenerGroup): number;
```

- `group` is required. Every caller passes one; the old `"default"` fallback had no user (D1).
- Each entry stores its own `off` closure, so entries of different event types need no shared event type.
- B4's checks stay for the JavaScript callers, written as guards over `unknown` (`canListen(value: unknown): boolean`, a non-empty string check, `typeof handler === "function"` through an `unknown` parameter), the C3 pattern, so typed callers cannot reach them and the unnecessary-condition rule stays quiet.
- Like `write-epoch.ts`, one instance per page is made when the module loads and the module's functions act on it; tests make their own with `createRegistry`.

### `anchoring/selection.ts`: the one module tested in the browser only

```ts
export const BLOCK_TAGS: readonly ["P", "LI", "H1", "H2", "H3", "H4", "H5", "H6", "BLOCKQUOTE", "TD", "TH", "DD", "DT", "FIGCAPTION", "PRE", "DIV", "SECTION", "ARTICLE"];
export type BlockTagName = (typeof BLOCK_TAGS)[number];

export function currentRange(): Range | null;
export function selectedRange(): Range | null;
export function caretNode(): Node | null;
export function caretContainer(): Element | null;
export function containsCaret(el: Element | null | undefined): boolean;
export function hasSelection(): boolean;
export function blockFor(el?: Element | null): Element | null;
export function placeCaretAtStart(el: Element | null | undefined): boolean;
```

This module reads the live page's selection, which no argument carries: every caller asks "where is the caret now" with no arguments, and it must return real `Range`, `Node` and `Element`, because `protect` reads `endContainer` and `editing` reads `commonAncestorContainer` and passes the elements to DOM calls. A narrow return type would push casts into those callers when they convert; a generic cannot bind to an ambient read. So the signatures use DOM types, `test/unit` cannot import it, and B13 to B21 are proven by:

- `test/unit/layer_leaves_bridge.test.js` (JavaScript, through the forwarder, in Node): B13 and B14;
- the browser specs in section 7 that drive the caret: `editing_undo.spec.js` (the fixture's `caretIn` reads `containsCaret`; undo calls `placeCaretAtStart`), `protection_layers.spec.js` and `typing_caret_vs_repaint.spec.js` (protection's snapshot reads `currentRange`, `caretNode`, `hasSelection`), and the editing specs on `editing-doc.html` and `formatting-doc.html` (`blockFor`, `caretContainer`, `selectedRange`).

The ambient reads are written so Node gets B14's answers without a `ReferenceError` (test for the global with `in`, or a guard over `unknown`; if the lint's unnecessary-condition rule fires on a `typeof window` test, use the `in` form). Membership in `BLOCK_TAGS` goes through a `ReadonlySet<string>`. Open question 1 asks the orchestrator to accept this exception.

### `anchoring/blocks.ts`

```ts
export interface BlockNode<N extends BlockNode<N>> {
  readonly nodeType: number;
  readonly textContent: string | null;
  readonly parentNode: N | null;
  readonly firstChild: N | null;
  readonly nextSibling: N | null;
}
export interface BlockElement<N extends BlockNode<N>, E extends BlockElement<N, E>> extends BlockNode<N> {
  readonly tagName: string;
  readonly id: string;
  readonly innerHTML: string;
  readonly firstElementChild: E | null;
  readonly nextElementSibling: E | null;
  readonly ownerDocument: BlockDocument<N, E>;
  getAttribute(name: string): string | null;
}
export interface BlockDocument<N extends BlockNode<N>, E extends BlockElement<N, E>> {
  readonly body: E | null;
  createRange(): PointRange<N>;
}
export interface PointRange<N> {
  setStart(node: N, offset: number): void;
  collapse(toStart: boolean): void;
  comparePoint(node: N, offset: number): number;
}
export interface InsertPoint<N> { readonly parent: N | null; readonly before: N | null }

export type RunSource = Pick<Item, "new_blocks" | "remove_blocks" | "placement">;
export interface RunBlockElements<E> { readonly index: number; readonly status: MatchStatus; readonly elements: readonly E[] }
export interface RunElements<N, E> { readonly start: InsertPoint<N>; readonly blocks: readonly RunBlockElements<E>[] }
export interface RunClashElement<E> { readonly index: number; readonly blocks: number; readonly element: E }

export const CONTAINER_TAGS: readonly ["main", "body"];
export function isContainerAnchor(anchor: { readonly tagName?: string } | null): boolean;
export function leafWalk<N extends BlockNode<N>, E extends N & BlockElement<N, E>>(root: E | null, from?: InsertPoint<N> | null): E[];
export function insertPointAfter<N extends BlockNode<N>, E extends N & BlockElement<N, E>>(anchor: E): InsertPoint<N>;
export function startPointIn<N extends BlockNode<N>, E extends N & BlockElement<N, E>>(container: E): InsertPoint<N>;
export function hostFor<N extends BlockNode<N>, E extends N & BlockElement<N, E>>(anchor: E, placement?: Placement): N | null;
export function canHoldRun<N extends BlockNode<N>, E extends N & BlockElement<N, E>>(anchor: E | null, placement?: Placement): boolean;
export function runElementsFor<N extends BlockNode<N>, E extends N & BlockElement<N, E>>(record: RunSource | null, doc: BlockDocument<N, E> | null, anchor: E): RunElements<N, E>;
export function runClashFor<N extends BlockNode<N>, E extends N & BlockElement<N, E>>(record: RunSource | null, doc: BlockDocument<N, E> | null, anchor: E): RunClashElement<E> | null;
```

- `Item`, `Placement`, `RunBlock` and `PLACEMENT` are C3's; `MatchStatus`, `matchRun` and `runClash` are C2's. The `start_of_container` test reads `PLACEMENT.START_OF_CONTAINER`.
- An element is told from a node by a private type predicate on `nodeType === 1`; a text node's whitespace test reads `textContent` (the old code read `data`; for a text node they are the same value).
- B24's position of `before` is found by walking `firstChild` and `nextSibling`, not `childNodes`, so the interface stays small.
- `RunBlockElements.elements` is a plain array. C2's `BlockMatch` is a union with a non-empty tuple; mirroring it would add a lookup that cannot fail for no caller's benefit, since every caller already tests `elements[0]`.
- `NO_RUN_TAGS`, the no-run host table, `isLeaf` and the chrome tests are private.

### `anchoring/block-build.ts`

```ts
export interface BuildDocument<E, T> {
  createElement(tagName: string): E;
  createTextNode(data: string): T;
}
export interface BuildElement<E, T> { appendChild(child: E | T): unknown }
export function writeBlock<E extends BuildElement<E, T>, T>(tag: string, html: string, doc: BuildDocument<E, T>): E | null;

export interface SwapElement<E extends SwapElement<E, C>, C> {
  readonly nodeType: number;
  readonly tagName: string;
  readonly attributes: ArrayLike<{ readonly name: string; readonly value: string }>;
  readonly firstChild: C | null;
  readonly parentNode: { replaceChild(next: E, old: E): unknown } | null;
  readonly ownerDocument: { createElement(tagName: string): E };
  setAttribute(name: string, value: string): void;
  appendChild(child: C): unknown;
}
export function swapTag<E extends SwapElement<E, C>, C>(el: E | null, tag: string): E | null;
```

- `doc` is required (D3). The tag check is C2's `isWritableBlockTag` on the lowercased tag; the inline set is a private `as const` map from tag to the constant it is created with. `cleanBlock`'s answer is told apart by its `code` key.

### `rail/conflict-toast.ts`

```ts
export const SEEN_PREFIX = "lahe:conflict-notices:";
export function titleFor(count: number): string;
export function bodyFor(count: number): string;

export type ToastGoneReason = "user" | "timeout" | "replaced";
export interface ConflictToastSpec {
  readonly key: string; readonly label: string; readonly text: string; readonly about: string;
  readonly sticky: true;
  onOpen(): void;
  onGone(reason: ToastGoneReason): void;
}
export interface ConflictScrollTarget { scrollIntoView(options: { readonly block: "nearest" }): void }
export interface ConflictCardNode extends ConflictScrollTarget {
  tabIndex: number;
  focus(): void;
  querySelector(selector: string): ConflictScrollTarget | null;
}
export interface ConflictRail<I> {
  showToast(spec: ConflictToastSpec): string | null;
  dismissToast(id: string, reason: ToastGoneReason): unknown;
  collapse(collapsed: boolean): unknown;
  selectTab(tab: string): unknown;
  paneForItem(item: I): string;
  revealCard(id: string): unknown;
  setCardCollapsed(id: string, collapsed: boolean): unknown;
  cardNode(id: string): ConflictCardNode | null;
}
export interface ConflictStorage { getItem(key: string): string | null; setItem(key: string, value: string): void }
export interface ConflictRecord { readonly rev: number }
export interface ConflictToastOptions<I extends ConflictRecord> {
  readonly rail: ConflictRail<I>;
  readonly reviewId: string;
  readonly storage: ConflictStorage | null;
  conflictIds(): readonly string[];
  itemById(id: string): I | null;
  isHidden?(): boolean;
}
export interface ConflictToastInfo {
  readonly standing: { readonly toastId: string; readonly ids: readonly string[] } | null;
  readonly raised: readonly string[];
  readonly dealt: readonly string[];
}
export interface ConflictToasts {
  sync(): string | null;
  resolved(id: string): void;
  info(): ConflictToastInfo;
}
export function createConflictToasts<I extends ConflictRecord>(options: ConflictToastOptions<I>): ConflictToasts;
```

- Generic over the record type, so the rail's `paneForItem` gets the caller's own record back and a test passes `{rev: 1}` literals.
- The stored state is parsed at the boundary by a private `parseNotices(text: string | null): NoticeState`, from `unknown`, keeping only string entries. The one-list shape is not read (D6).
- A key's record id is everything before its last `:`; forgetting compares ids exactly (D5).
- The rail's members are required. The real rail has all of them; the old `typeof` guards go (D7).
- `ToastGoneReason` is the rail's vocabulary, spelled here as what this module needs until the rail converts (B6 of the plan's browser chain), which then owns it and this module imports it.

### `review/choices.ts`

```ts
export const REFUSAL: {
  readonly NO_NAME: "no-name"; readonly BAD_NAME: "bad-name"; readonly DUPLICATE: "duplicate";
  readonly TOO_FEW: "too-few-buttons"; readonly NESTED: "nested-buttons"; readonly BAD_VALUE: "bad-value";
  readonly SAME_VALUE: "same-value"; readonly TWO_CHOSEN: "two-chosen";
};
export type ChoiceRefusalReason = (typeof REFUSAL)[keyof typeof REFUSAL];

export interface ChoiceElement<E extends ChoiceElement<E>> {
  readonly nodeType: number;
  readonly textContent: string | null;
  readonly parentElement: E | null;
  getAttribute(name: string): string | null;
  hasAttribute(name: string): boolean;
  setAttribute(name: string, value: string): void;
  removeAttribute(name: string): void;
  closest(selector: string): E | null;
  querySelector(selector: string): E | null;
  querySelectorAll(selector: string): ArrayLike<E>;
}
export type ChoiceVerdict<E> =
  | { readonly group: E; readonly name: ChoiceToken; readonly refusal: null; readonly detail: null }
  | { readonly group: E; readonly name: string | null; readonly refusal: ChoiceRefusalReason; readonly detail: string };

export function judge<E extends ChoiceElement<E>>(group: E, counts: ReadonlyMap<string, number>): ChoiceVerdict<E>;
export function chipDetail<E extends ChoiceElement<E>>(refused: readonly ChoiceVerdict<E>[]): string;

export interface ChoiceEvent { readonly target: unknown; readonly defaultPrevented: boolean; preventDefault(): void }
export interface ChoiceGate {
  readonly pickMode: boolean; readonly editing: boolean; readonly editState: boolean;
  readonly mayWrite: boolean; readonly presenting: boolean;
}
export interface ChoiceDocument<E> extends ListenerTarget<ChoiceEvent> { querySelectorAll(selector: string): ArrayLike<E> }
export type ChoicePage = Partial<Pick<PageView, "origin" | "path" | "title" | "seq" | "source_hint">>;
export interface ChoicesOptions<E extends ChoiceElement<E>> {
  readonly document: ChoiceDocument<E> | null;
  readonly window?: ListenerTarget<ChoiceEvent> | null;
  readonly isDocument: boolean;
  readonly store: { read(reviewId: string): readonly Item[]; write(reviewId: string, item: Item): unknown };
  readonly reviewId: string;
  page(): ChoicePage;
  readonly sync?: { recordItem(item: Item, options: { readonly press: true }): unknown } | null;
  readonly rail?: { readonly failures: { add(failure: Failure): unknown; clear(code: FailureCode): unknown } } | null;
  gate(): ChoiceGate;
  headingFor(group: E): string | null;
  readonly listeners?: { readonly registry: Pick<ListenerRegistry, "on">; readonly group: ListenerGroup } | null;
  onPress?(item: Item): void;
}
export interface ChoiceCounters { readonly arms: number; readonly presses: number; readonly refusedPresses: number }
export interface RefusedGroup { readonly name: string | null; readonly refusal: ChoiceRefusalReason; readonly detail: string }
export interface Choices<E> {
  arm(): { readonly armed: readonly ChoiceVerdict<E>[]; readonly refused: readonly ChoiceVerdict<E>[] };
  bind(): void;
  unbind(): void;
  armedNames(): ChoiceToken[];
  refused(): RefusedGroup[];
  isDocument(): boolean;
  readonly counters: ChoiceCounters;
}
export function createChoices<E extends ChoiceElement<E>>(options: ChoicesOptions<E>): Choices<E>;
```

- `ChoiceToken`, `CHOICE_MARKUP`, `CHOICE_TOKEN_RULE`, `isChoiceToken`, `choiceRef` are C3's `choice.ts`; `Item`, `STATE`, `KIND`, `isChoice`, `emptyContext` its `record.ts`; `newItem`, `bumpRev`, `continueThread`, `latestChoiceByGroup` (a `ReadonlyMap`), `validateItem` and `PageView` as C3 names them; `gestureFor`, `GESTURE` C1's; `failure`, `Failure`, `FailureCode` C1's; `write` C1's write epoch.
- The verdict is a union on `refusal`, so an armed verdict always has a token name and a refused one always has a detail.
- An event target becomes an element through a private type predicate over `unknown` (`nodeType === 1` and a `closest` function); a text node goes to its `parentElement` the same way.
- `page` is a function (index passes one; the old object fallback had no caller). The record's page fields go through `newItem`'s `page` input, which C3 reads when the flat fields are absent.
- `counters` is a read-only view of the instance's own counts, so `index.js`'s `Object.assign({}, choices.counters)` keeps working.
- The 2000 ms window is a private constant; tests move the clock with `node:test`'s mock timers (`mock.timers.enable({apis: ["Date"]})`), not a new option.

### `review/export.ts`

```ts
export const SCOPE: { readonly FULL: "full"; readonly SLICE: "slice" };
export type ExportScope = (typeof SCOPE)[keyof typeof SCOPE];
export const SLICE_LABEL: string;

export interface RenderInput { readonly records: readonly Item[]; readonly scope: ExportScope; readonly review: string; readonly title?: string | null }
export function renderReviewText(input: RenderInput): string;
export interface FilenameInput {
  readonly review?: string | null; readonly scope?: ExportScope | null; readonly label?: string | null;
  readonly title?: string | null; readonly at?: Date;
}
export function filenameFor(input: FilenameInput): string;
export function recordsFromBody(body: unknown): Item[] | null;
export function unionById(local: readonly Item[], remote: readonly Item[]): Item[];

export interface ProbeRequest { readonly method: "GET"; readonly headers: Readonly<Record<string, string>>; readonly signal?: AbortSignal }
export interface ProbeResponse { readonly status: number; json(): Promise<unknown> }
export type ProbeFetch = (url: string, request: ProbeRequest) => Promise<ProbeResponse>;
export type ProbeAnswer =
  | { readonly reachable: false; readonly via: "sync"; readonly reason: "csp_refused"; readonly status: null; readonly body: null }
  | { readonly reachable: false; readonly via: "no_fetch"; readonly reason: "no fetch here"; readonly status: null; readonly body: null }
  | { readonly reachable: true; readonly via: "helper"; readonly reason: null; readonly status: number; readonly body: unknown }
  | { readonly reachable: false; readonly via: "helper"; readonly reason: string; readonly status: number | null; readonly body: unknown };

export interface ExportClipboard { writeText(text: string): Promise<void> }
export interface SavedFile { readonly size: number }
export interface ExportWindow {
  setTimeout(handler: () => void, ms: number): number;
  clearTimeout(id: number): void;
  readonly URL?: { createObjectURL(file: SavedFile): string; revokeObjectURL(url: string): void };
  readonly Blob?: new (parts: string[], options: { type: string }) => SavedFile;
  readonly navigator?: { readonly clipboard?: ExportClipboard };
}
export interface DownloadAnchor<A extends DownloadAnchor<A>> {
  href: string; download: string; rel: string;
  readonly style: { display: string };
  readonly parentNode: { removeChild(child: A): unknown } | null;
  click(): void;
}
export interface ExportDocument<A extends DownloadAnchor<A>> {
  readonly title: string;
  readonly body: { appendChild(child: A): unknown } | null;
  readonly documentElement: { appendChild(child: A): unknown };
  createElement(tagName: "a"): A;
}
export interface ExportOptions<A extends DownloadAnchor<A>> {
  readonly review: string;
  readonly token?: string;
  readonly helperOrigin?: string;
  readonly store?: { read(reviewId: string): readonly Item[] } | null;
  readonly sync?: { status(): { readonly cspRefused?: boolean } | null } | null;
  readonly rail?: { readonly failures: { add(failure: Failure): unknown } } | null;
  readonly document?: ExportDocument<A> | null;
  readonly window?: ExportWindow | null;
  readonly fetch?: ProbeFetch | null;
  readonly clipboard?: ExportClipboard | null;
  readonly records?: (() => readonly Item[]) | null;
}

export type CopyResult =
  | { readonly ok: true; readonly action: "copy"; readonly scope: ExportScope; readonly text: string; readonly characters: number }
  | { readonly ok: false; readonly action: "copy"; readonly scope: ExportScope | null; readonly text: string | null; readonly code: "COPY_FAILED"; readonly error: string };
export type ReviewFileResult =
  | { readonly ok: true; readonly action: "export"; readonly scope: ExportScope; readonly text: string; readonly filename: string }
  | { readonly ok: false; readonly action: "export"; readonly scope: ExportScope | null; readonly text: string | null; readonly filename: string | null; readonly code: "EXPORT_FAILED"; readonly error: string };
export type RecordsResult =
  | { readonly ok: true; readonly action: "export_records"; readonly scope: ExportScope; readonly text: string; readonly filename: string | null }
  | { readonly ok: false; readonly action: "export_records"; readonly scope: ExportScope | null; readonly text: null; readonly filename: null; readonly code: "EXPORT_FAILED"; readonly error: string };
export type ExportResult = CopyResult | ReviewFileResult | RecordsResult;
export interface RecordsOptions { readonly scope?: ExportScope; readonly download?: boolean; readonly filename?: string; readonly label?: string }

export interface Exporter {
  copyReview(): Promise<CopyResult>;
  exportReview(): Promise<ReviewFileResult>;
  exportRecords(records: readonly Item[], options?: RecordsOptions): Promise<RecordsResult>;
  scopeNow(): Promise<{ readonly scope: ExportScope; readonly records: number; readonly probe: ProbeAnswer }>;
  last(): ExportResult | null;
}
export function createExport<A extends DownloadAnchor<A>>(options: ExportOptions<A>): Exporter;

export function configure(instance: Pick<Exporter, "exportRecords"> | null): void;
export function exportRecords(records: readonly Item[], options?: RecordsOptions): Promise<RecordsResult>;
```

- `copyReview` and `exportReview` are closures (no `this`), because `index.js` hands them to the rail as bare functions.
- B67's checks stay for the JavaScript callers (the fixed test calls with a missing scope and missing records) through guards over `unknown`: `isExportScope(value: unknown): value is ExportScope`, `Array.isArray`, a non-empty string check.
- `recordsFromBody` is the one boundary parser: `unknown` in, each element checked with C3's `validateItem` inside `try`, `null` on the first refusal.
- The configured exporter is module-private state set by `configure`; the module exports only functions and constants, so the forwarder's and the bundle's copies of the exports see the same configured instance.
- The default fetch is the global `fetch`, called with the module's request object; ambient `document`, `window` and `navigator` are the defaults when the options do not give them, read through guards so Node gets none.
- The real `HTMLAnchorElement`, `Document`, `Window & typeof globalThis` and `Clipboard` are meant to satisfy these interfaces (`A = HTMLAnchorElement`).

### Bridges

**Manifest `LAYER_FILES`**, each at the old file's place, `owner: "TypeScript B1"`, `why` rewritten to say what the module is:

| Old entry | New `path` | `modules` | `registers` |
| --- | --- | --- | --- |
| `src/layer/listeners.js` | `src/browser/review-layer/listeners.ts` | | `["listeners"]` |
| `src/layer/selection.js` | `src/browser/review-layer/anchoring/selection.ts` | | `["selection"]` |
| `src/layer/blocks.js` | `src/browser/review-layer/anchoring/blocks.ts` | `blocks.ts`, `block-build.ts` | `["blocks"]` |
| `src/layer/conflict_toast.js` | `src/browser/review-layer/rail/conflict-toast.ts` | | `["conflictToast"]` |
| `src/layer/export.js` | `src/browser/review-layer/review/export.ts` | | `["exporter", "export"]` |
| `src/layer/choices.js` | `src/browser/review-layer/review/choices.ts` | | `["choices"]` |

The build assigns one object to every name in `registers`, which is B80.

**Manifest `FORWARDERS`**: the five forwarders, `owner: "TypeScript B1"`, except `src/layer/export.js`, whose owner stays `"3C"` until F1, because `export_text.test.js` (fixed, and assigned to F1 in the plan's source-text table) asserts it (open question 2).

**`test/unit/layer_leaves_bridge.test.js`** (JavaScript, because a `.ts` test cannot import a `.js` forwarder; F1 removes it with the forwarders), proving:

- each forwarder returns a plain, writable object holding exactly the names its old callers read (section 3) plus the module's other exports, and none of the removed names (D1, D2, D4, D7, D9, D13);
- selection's B13 and B14, in Node.

### Exported names that change, and what each caller does

| Old | New | Why | Callers to edit |
| --- | --- | --- | --- |
| `listeners.offGroup`, `listeners.offAll` (module level); a handle's `entry` | removed | No reader; the registry's own `offGroup` and `offAll` stay (D1) | none |
| `registry.on(..., group)` with `group` optional, defaulting to `"default"` | `group` required | Every caller passes one (D1) | none |
| `selection.currentSelection`, `caretOffset`, `selectedText` | removed | No reader (D2) | none |
| `blocks.writeBlock(tag, html, doc?)` | `doc` required | No global fallback in a module that takes narrow interfaces (D3) | `test/browser/blocks_kernel.spec.js`: the four `b.writeBlock(...)` calls pass `document` |
| `blocks.NO_RUN_TAGS`, `blocks.isLeaf` | private | No reader (D4) | none |
| `conflictToast.LABEL`, `TITLE_ONE`, `BODY_ONE`, `BODY_MANY`, `conflictKey`; instance `openCard` | private | No reader (D7) | none |
| instance `resolved(id)` returning `true` | returns nothing | No reader of the value (D7) | none |
| `choices.INERT_CODE`; instance `press`, `labelFor` | private or removed | No reader (D9) | none |
| `exporter.copyReview`, `exportReview`, `configured`, `PROBE_TIMEOUT_MS` (module level); instance `review`, `SCOPE`, `SLICE_LABEL`, `renderReviewText`, `filenameFor`, `records`; the `reviewId` alias in `renderReviewText` and `filenameFor` | removed | No reader (D13) | none |
| `exporter.configure` returning the instance | returns nothing | No reader of the value | none |

### Test plan

| Test file | Statements | Notes |
| --- | --- | --- |
| `test/unit/browser/review-layer/listeners.test.ts` | B1 to B12 | Fake targets that record calls; one that throws on remove |
| `test/unit/browser/review-layer/anchoring/blocks.test.ts` | B22 to B31 | Over `support/fake-page.ts`; expected leaves written by hand from the requirement, not from a run |
| `test/unit/browser/review-layer/anchoring/block-build.test.ts` | B32 to B34 | A fake document that records every `createElement`, `createTextNode`, `setAttribute` and `appendChild`, so B33's "built only from constants" is checked at the port |
| `test/unit/browser/review-layer/rail/conflict-toast.test.ts` (moved) | B35 to B50 | A fake rail that behaves as the real one does toward this module: `showToast` returns a new id, or `null` for a key it has seen; `dismissToast(id, reason)` calls the toast's `onGone(reason)`; pressing calls `onGone("user")` and then `onOpen()`. Records are `{rev}` literals |
| `test/unit/browser/review-layer/review/choices.test.ts` | B51 to B64 | Fake groups and buttons; a fake registry that hands back the handlers so the test clicks through them; C3's real record functions; B55's epoch checked by recording `isWriting()` inside the fake `setAttribute` |
| `test/unit/browser/review-layer/review/export.test.ts` | B65 to B79 | Fake fetch, clipboard, window (its `setTimeout` captured and fired by hand) and document; records from C5's `test/support/data/record-fixtures.ts` |
| `test/unit/layer_leaves_bridge.test.js` | B13, B14; the forwarders | JavaScript |
| browser specs (section 7) | B15 to B21, B80, and the integration of all seven | Run by name by the builder; the whole suite at the checkpoint |

`support/fake-page.ts` builds a small tree (tag, attributes, children, text) with `innerHTML` serialized from it, sibling links, `ownerDocument`, `closest` and `querySelectorAll` for the two selectors used (`.choice`, `button`, `.choice-q`), and a range whose `comparePoint` uses document order. It implements only what the interfaces above list.

## 5. Old tests, accounted for

Listed by `scratchpad/specs/b1_cases.py`: 47 cases in the three unit files that load these modules. 40 touch this slice's files and are below; the other seven are `remount_contract.test.js` cases that never call a B1 module (lines 66, 76, 88, 205, 214, 256, 263), which stay as they are and belong to B11 and B12. No case is dropped.

- **22 cases** in `conflict_toast.test.js` move with the file to `rail/conflict-toast.test.ts`: 21 are rewritten against the fake rail, and 1 (the source-text check) is carried as it is.
- **14 cases** in `export_text.test.js` stay where they are, unedited: it is a fixed pin and stays JavaScript (section 7). `export.test.ts` covers the same statements anew.
- **4 cases** in `remount_contract.test.js` exercise the registry through `inject` and stay there.

| File | Line | Test | Covered by | What happens |
| --- | --- | --- | --- | --- |
| `conflict_toast.test.js` | 68 | one new conflict raises one sticky toast with the agreed words | B35, B36, B38 | rewritten; the old `armed: false` check read the real rail's own timer field and is replaced by `sticky: true` on the spec the rail receives |
| `conflict_toast.test.js` | 79 | no conflicts, no toast | B37 | rewritten |
| `conflict_toast.test.js` | 84 | a repaint that re-finds the same conflict does not raise a second toast | B39 | rewritten |
| `conflict_toast.test.js` | 92 | swiping it away is final for that conflict, however many passes follow | B41 | rewritten |
| `conflict_toast.test.js` | 100 | a reload with the conflict open and the toast untouched raises it again, once | B42, B49 | rewritten |
| `conflict_toast.test.js` | 115 | a reload after the toast was swiped raises nothing | B41, B49 | rewritten |
| `conflict_toast.test.js` | 124 | a reload after the toast was pressed raises nothing | B41, B49 | rewritten |
| `conflict_toast.test.js` | 133 | after a reload, two open conflicts not dealt with come back as one count toast | B42, B35 | rewritten |
| `conflict_toast.test.js` | 143 | a count toast replaced by a newer count is not dealt with: a reload still shows it | B40, B42 | rewritten |
| `conflict_toast.test.js` | 153 | the same record conflicting at a NEW rev is a new conflict | B43 | rewritten |
| `conflict_toast.test.js` | 162 | two conflicts at once are one toast that names the count | B38, B35 | rewritten |
| `conflict_toast.test.js` | 170 | a second conflict arriving while the first stands becomes one count toast | B40 | rewritten |
| `conflict_toast.test.js` | 180 | the count wording | B35 | rewritten |
| `conflict_toast.test.js` | 185 | resolving the conflict takes the toast away | B47, B45 | rewritten |
| `conflict_toast.test.js` | 193 | with two standing, resolving one keeps the toast; resolving both removes it | B45, B47 | rewritten |
| `conflict_toast.test.js` | 204 | a conflict that was resolved and comes back at the same rev is told again | B44, B47 | rewritten |
| `conflict_toast.test.js` | 215 | hidden for presenting: held, not spent, and shown on return | B46 | rewritten |
| `conflict_toast.test.js` | 224 | pressing it opens the rail on Active, where the hand edit's card is | B48 | rewritten: asserts the calls the rail receives (`collapse(false)`, `selectTab(paneForItem(record))`, `revealCard`, `setCardCollapsed`). Which tab the real rail picks is the rail's rule, proven in the browser by `conflict_toast.spec.js` "pressing the toast opens the rail on the conflict card" |
| `conflict_toast.test.js` | 234 | no storage still stops repeats within the page | B49, B41 | rewritten |
| `conflict_toast.test.js` | 242 | a standing conflict that replay clears by itself is forgotten, so the same clash is told again | B44 | rewritten |
| `conflict_toast.test.js` | 255 | a swiped conflict that another tab resolves is forgotten too | B44, B50 | rewritten |
| `conflict_toast.test.js` | 268 | leaving read-only syncs the conflict toast, so a clash found while refused is told | none of this slice's; it reads `src/layer/index.js` | carried as it is (section 8); B12 of the browser chain updates it |
| `export_text.test.js` | 32 | the full and slice renders differ by the slice label and nothing else | B65, B66 | stays, unedited |
| `export_text.test.js` | 44 | a missing or invented scope fails loud rather than guessing | B67 | stays, unedited |
| `export_text.test.js` | 52 | the filename carries the scope, so a forwarded file still says what it is | B68 | stays, unedited |
| `export_text.test.js` | 61 | 3D's list export renders through 3C's path, with the scope it names | B75, B76 | stays, unedited |
| `export_text.test.js` | 72 | with no helper answering, the scope is the slice and the records are this browser's | B71, B72, B76 | stays, unedited |
| `export_text.test.js` | 86 | a helper that answers for this review puts the export in full scope | B71 | stays, unedited |
| `export_text.test.js` | 106 | a helper that refuses this page's credentials is not the whole review | B71 | stays, unedited |
| `export_text.test.js` | 117 | records the helper is holding are folded in, and the browser wins its own content | B70 | stays, unedited |
| `export_text.test.js` | 129 | a projection is not mistaken for records | B69 | stays, unedited; its valid case passes C3's `validateItem` (fixture records) |
| `export_text.test.js` | 137 | a copy that did not reach the clipboard says so, and never reports success | B73, B77 | stays, unedited |
| `export_text.test.js` | 156 | the copy and export failure codes are in the one code list | C1's failure table (B73 and B74 use the codes) | stays, unedited |
| `export_text.test.js` | 162 | export.js is 3C's, and it is no longer a planned file | none: manifest bookkeeping | stays, unedited; passes because the forwarder keeps owner `"3C"` (open question 2). F1 updates it |
| `export_text.test.js` | 175 | the filename leads with the page title, slugged and capped, id kept exact | B68 | stays, unedited |
| `export_text.test.js` | 190 | the text header names the document when the title is known | B66 (C5's B64 owns the wording) | stays, unedited |
| `remount_contract.test.js` | 93 | the cleared groups include the comment surface's own group | B1 | stays (B11's file) |
| `remount_contract.test.js` | 112 | a remount de-registers BEFORE it re-registers, and the count comes back flat | B3, B7, B9, B10 | stays (B11's file) |
| `remount_contract.test.js` | 152 | the root is only re-created when it is actually gone | B2 (a fresh registry as input) | stays (B11's file) |
| `remount_contract.test.js` | 178 | fresh-load pageshow is ignored, while persisted pageshow remounts once | B2 (a fresh registry as input) | stays (B11's file) |

**New cases with no old counterpart:** B1 to B12 as a whole (the registry had no unit test of its own); B22 to B34 (blocks had only the browser spec); B36's unique keys; B44's exact-id match (D5); B49's unreadable storage and the 50-key cap; B48 call by call; B51 to B64 (choices had only browser specs); B59's narrower count (D8); B67's order; B68's empty title slug (D10); B69's stricter parse (D11); B71's CSP, no-fetch and timeout paths; B74's download steps; B77 and B78 (D12).

## 6. Deliberate differences

| # | Old | New | Why | Test | Noticed by a person or agent? |
| --- | --- | --- | --- | --- | --- |
| D1 | Module-level `offGroup` and `offAll`; a handle's `entry` and its `boundAt`; a `"default"` group when none was passed | Removed; `group` required | No reader and no caller that omits the group | bridge test (names); `listeners.test.ts` | no |
| D2 | `currentSelection`, `caretOffset`, `selectedText` exported | Removed, so `selection.ts` no longer imports the normalizer | No reader | bridge test (names) | no |
| D3 | `writeBlock` fell back to the global `document` | `doc` is required; `blocks_kernel.spec.js` passes `document` in its four calls | A module over narrow interfaces cannot conjure the page's document; every source caller already passes one | `block-build.test.ts` (fake document); `blocks_kernel.spec.js` unchanged in what it asserts | no |
| D4 | `NO_RUN_TAGS` and `isLeaf` exported; the point's position found through `childNodes` | Private; position found by walking siblings | No reader; the same answer from a smaller interface | `blocks.test.ts` (B24) | no |
| D5 | Forgetting matched keys by the prefix `"<id>:"`, so forgetting `a` also forgot a record whose id is `a:b` | Keys are matched by exact record id (the part before the last `:`) | A prefix match is the wrong rule; ids have no colon today, so it never fired | `conflict-toast.test.ts`: forgetting `a` keeps `a:b:1` | no |
| D6 | A stored plain list of keys read as "dealt with" | Read as nothing stored | That shape existed only between two commits on 2026-09-22 | `conflict-toast.test.ts`: storage holding `["a:1"]` raises `a` | no |
| D7 | `resolved` returned `true`; `openCard` and the word constants exported; each rail method guarded with `typeof` | `resolved` returns nothing; the rest private; the rail's members required | No reader; the real rail has every member | `conflict-toast.test.ts` | no |
| D8 | Any click already `defaultPrevented`, anywhere on the page, added to `refusedPresses` | Only one whose target is in a button inside a `.choice` group | The counter claims refused presses; a click on a link the page took is not one | `choices.test.ts` (B59); `choice_buttons.spec.js` V8 still sees a count above 0 | no (visible only in `__lahe.choices.counters()`) |
| D9 | Instance `press` and `labelFor`; `INERT_CODE` exported; groups re-checked for their class after `querySelectorAll(".choice")`; `page` as a function or an object | Removed or private; no re-check; `page` a function | No reader; the selector already guarantees the class; index passes a function | `choices.test.ts` | no |
| D10 | A title whose safe form is empty (for example, all non-Latin characters) gave `lahe-review--<id>-...`, a double hyphen | No title part: `lahe-review-<id>-...` | The empty slug still added its separator | `export.test.ts` (B68): a title of `日本語` | **yes**: a person who exports from such a page sees the cleaner filename. Goes on the progress page as a departure |
| D11 | `recordsFromBody` accepted a list whose elements had a string `id` and a truthy `kind` | Every element must pass C3's `validateItem` | A boundary parser that returns `Item[]` must check records, not two fields. The helper answers `review.read` with the projection, never records, so this path finds nothing today either way | `export.test.ts` (B69): `{records: [{id: "x", kind: "edit"}]}` is `null` | no |
| D12 | With no review id an action threw synchronously; the module-level `exportRecords` threw synchronously when unconfigured | Every action resolves with a failure and a chip; the module-level call rejects | A promise-returning call that throws escapes its caller's `.catch` (`tab_edits.exportList` has only a `.catch`) | `export.test.ts` (B77, B78) | no |
| D13 | Module-level `copyReview`, `exportReview`, `configured`, `PROBE_TIMEOUT_MS`; instance `review`, `SCOPE`, `SLICE_LABEL`, `renderReviewText`, `filenameFor`, `records`; the `reviewId` alias; the `webkitURL` fallback; the `AbortController` presence check | Removed | No reader; every supported browser and Node 24 have `URL` and `AbortController` | bridge test (names) | only a developer typing `LAHE.exporter.copyReview()` in a console; no reviewer or agent |

None of these needs a type to force it; they are the sloppiness the rebuild clears.

## 7. Fixed behavior tests touched

- **`test/unit/export_text.test.js`**: all 14 cases run against the forwarder, unedited. It stays JavaScript because it reads `manifest.js` and the fixtures forwarder, which a `.ts` test cannot import. It passes because the names it reads stay (section 3), the error messages of B67 stay word for word, and the forwarder keeps owner `"3C"`.
- **`test/unit/review_format.test.js`**: not touched. This slice renders through C5's `renderText` and changes none of its bytes.
- **Skill-wording tests** (users of `test/support/skill.js`): none reads text from these modules. The skill's `references/choices.md` names `data-lahe-inert`, which B55 keeps.
- **CLI output tests**: none touches these modules.
- **Browser specs**, which must pass unchanged in what they assert. The builder runs them by name; the orchestrator runs the whole suite at the checkpoint.
  - listeners: `living_in_the_page.spec.js`, `bfcache_restore.spec.js`, `selection_popover.spec.js` (and every spec that boots the layer);
  - selection: `editing_undo.spec.js`, `protection_layers.spec.js`, `typing_caret_vs_repaint.spec.js`, `editing_two_regions.spec.js`, `editing_before_pinned.spec.js`, `editing_commit_outside.spec.js`, `editing_change_intent.spec.js`, `editing_navigation.spec.js`, `formatting_toggle.spec.js`;
  - blocks: `blocks_kernel.spec.js` (its four `writeBlock` calls gain `document`, D3), `replay_run_fix_round.spec.js`, `replay_run_insert.spec.js`, `replay_run_anchor.spec.js`, `replay_run_check.spec.js`, `replay_run_flow_fix.spec.js`, `restructured_run_stays.spec.js`, `free_writing_host.spec.js`, `free_writing_undo.spec.js`, `free_writing_types.spec.js`, `free_writing_empty.spec.js`, `free_writing_repaint.spec.js`;
  - conflict toast: `conflict_toast.spec.js`, `split_not_conflict.spec.js`;
  - choices: `choice_buttons.spec.js`, `choice_style.spec.js`;
  - export: `copy_export.spec.js`, `ac1_walk.spec.js`, `rail_menu.spec.js`, `edits_tab.spec.js` (B80).

## 8. Source-text tests

| Test | Reads | What changes |
| --- | --- | --- |
| `test/unit/conflict_toast.test.js:268-275` | `src/layer/index.js` (`exitReadOnly` ends with `conflictToasts.sync();`) | Moves with its file to `rail/conflict-toast.test.ts`, reading the same path through `node:fs`, asserting the same thing. B12 of the browser chain updates the path when `index.js` moves (the plan's table) |
| `test/unit/export_text.test.js:162-168` | the manifest's owner for `src/layer/export.js` | Nothing; the forwarder entry keeps owner `"3C"`. F1 updates it (the plan's table) |
| `test/browser/blocks_kernel.spec.js` header | names `src/layer/blocks.js` in its `read-when` | The header names `src/browser/review-layer/anchoring/blocks.ts` and `block-build.ts`; its tests are unchanged in what they assert |
| Lint's manifest completeness check | every file under `src/` once | Satisfied by the six `LAYER_FILES` entries and five `FORWARDERS`; `.ts` files are skipped by the check |
| `test/unit/build_layer.test.js:149` | the Library page's file list | Not touched: none of these modules is on the Library page |

No other test reads the text of these six files. `test/unit/no_arbitrary_sleeps.test.js` walks only `test/`; the `harness-allow-timer:` markers in `export.js` are not read by anything and go to the folder doc.

## 9. Comments to move

Each section below is the text for its folder doc. Every new doc opens with frontmatter in the existing form: `read-when: Changing a file in src/browser/review-layer/<folder>/, or working out why one of them does what it does.` and `not-for: How the TypeScript projects and the lint gate are set up; see README.md in this folder.` (for the root doc, `src/browser/review-layer/` and its top-level files).

### File headers

| File | `read-when` |
| --- | --- |
| `listeners.ts` | Binding or clearing an event listener in the review layer, or when handlers pile up after the page re-renders. |
| `anchoring/selection.ts` | Reading the caret or the selection in the reviewed page, or moving the caret for an undo. |
| `anchoring/blocks.ts` | Finding the leaf blocks, an insert point, an editing host or a record's run on the live page, or when the DOM walk and the string reader disagree. |
| `anchoring/block-build.ts` | Building a block element from a record's tag and markup, or changing an element's tag in place. |
| `rail/conflict-toast.ts` | Changing when the conflict toast shows, what it says or where pressing it goes, or when a clash goes unannounced. |
| `review/choices.ts` | Changing how choice groups on a document page are armed or pressed, or when a press is refused or a group shows as inert. |
| `review/export.ts` | Changing the rail's Copy and Export, the export filename or scope label, or when exported text is wrong or a copy fails. |

### `docs/ongoing/code/browser-review-layer.md` (new): `listeners.ts`

> **The listener registry.** Pages that re-render (a Turbo morph, a framework repaint) run their setup again, and a handler bound without being unbound piles up for the life of the page. The Steady Thread dev layer did exactly that: after a hundred morphs, one gesture produced a hundred items. So every handler the review layer binds goes through this registry, which lets a remount clear what it is about to bind again, and `count()` makes the leak measurable: `living_in_the_page.spec.js` remounts a hundred times and checks the count is flat. A raw `addEventListener` in layer code is a bug a reviewer can find by searching.
>
> Groups are spelled once, in `GROUP`. A group written as a literal in two files is a leak the count cannot see: the handlers pile up under a name the remount never clears. `inject` clears `document`, `navigation`, `comments` and `editing` on every remount. Three groups are bound once for the life of the page and a remount must never clear them:
>
> - `interaction`: "has the reviewer touched anything lately", which the reload guard asks. A page that forgets the reviewer is reading reloads under them.
> - `present`: the show and hide chord. While the review is hidden this is the only listener of ours the reviewer can reach; dropping it would leave no way back.
> - `choices`: the choice-button press, judged at click time against the groups on the page now, so it has nothing to bind again.
>
> `overlay` is the rail's own UI, `storage` the second-tab lock, `network` the online and offline events and the lifecycle stream.
>
> Removing a listener from a detached node can throw. The registry swallows that: the entry is gone either way, and a remount should not fail over it.
>
> There is one registry per page, `shared`, made when the module loads; the module's own `on` and `count` act on it. Tests make their own with `createRegistry`.

### `docs/ongoing/code/browser-review-layer-anchoring.md` (C5's; three new sections)

> **`selection.ts`: where the caret is.** One accessor, because editing and protection both ask "where is the caret", and two implementations give two answers on the same page. Protection has to know whether the caret is inside a region before anything writes there, so the check is cheap and exact. Editing and protection both read it and neither owns it; check both when changing it.
>
> `caretNode()` returns the text node itself, not its parent, because protection's check that the caret survives typing compares that node by identity. `selectedRange()` returns a clone so a caller cannot move the reviewer's selection by accident; `currentRange()` is the live range, for the offsets protection reads. `placeCaretAtStart` is the one place the layer moves the caret for the reviewer, and only the per-record undo calls it.
>
> The selection snapshot and restore are not here. They are protection's third layer and live in `protection/protect.ts`.
>
> With no page (Node, where the unconverted callers' unit tests run) every read gives its empty answer instead of throwing.
>
> `blockFor` is "this paragraph", the element Cmd-Shift-E makes editable. `BLOCK_TAGS` is uppercase because it compares `tagName` in HTML documents; the sync client builds its block selector from the same list, so the layer has one notion of a block.
>
> This module has no unit test. It reads the live page's selection, and its signatures name DOM types, which the unit-test project cannot see. Its Node answers are checked by `test/unit/layer_leaves_bridge.test.js`; everything else by the editing, protection and undo browser specs.
>
> **`blocks.ts`: the page's blocks, read live.** Each function is the live-DOM twin of a string rule in `src/domain/`, and the two must agree: `leafWalk` reads leaves the way `run-match.ts` reads them from a string, `runElementsFor` uses `matchRun`, `runClashFor` uses `runClash`. `blocks_kernel.spec.js` runs both readers over every page under `test/fixtures` and the malformed corpus and requires the same answer.
>
> It loads before the anchor engine, so a caller resolves a record's anchor itself and passes the element in.
>
> A chrome wrapper is the sheet-head shape: an `h2` beside a "Section N" label in one wrapper. A new block after that `h2` goes after the wrapper, not inside it. `body`, `main` and `html` are never wrappers. Leading chrome at a container's start is the marked file title, or a wrapper holding only it (the hero of an empty notes page); a run placed at the start of the container goes after it.
>
> A run is never offered in a table cell, a caption or a definition term, or under a table, list or definition-list host; Enter keeps its plain break there.
>
> A take-back never clashes: it only removes blocks it found one to one.
>
> Replay counts its own direct page walks, and `replay_run_fix_round.spec.js` holds a 250-block run to two per pass by replacing `leafWalk` on the registered object. `runElementsFor` walks the page inside this module, so that count does not see it.
>
> The interfaces are generic over the node and element types, so the real DOM gets its own `Node` and `Element` back and a test passes a small fake, with no cast either way.
>
> **`block-build.ts`: building a block.** Nothing from a record ever names an element. The markup goes through `cleanBlock` first, then the element is built piece by piece from constants (`strong`, `em`, `br`, `li` and the two formatting resets) and text nodes. Any other tag refuses the whole block. No markup string is assigned and no attribute is set.
>
> `swapTag` changes an element's tag in place: every attribute, the `data-lahe-id` stamp included, and every child move to the new element. Only the six writable tags are allowed.
>
> The caller passes the document; there is no global fallback.

### `docs/ongoing/code/browser-review-layer-rail.md` (new): `conflict-toast.ts`

> **Why it exists.** Ken asked his agent to add a module to an article and kept writing in the same spot while it worked. When he committed, the page reloaded onto the agent's version, replay's fourth branch ("matches none of these") flagged a conflict and wrote nothing, and his paragraphs vanished from the page. They were safe on the conflict card, but nothing told him, and he thought his writing was lost. He asked for a toast that says there was a conflict and it only needs resolving.
>
> The toast itself is the rail's, and the collision is replay's. This module is only the decision between them: when a collision is news, what the toast says, and where pressing it goes. `index` calls `sync()` after every replay pass, after a resolution, and when the reviewer stops presenting or leaves a read-only window.
>
> The rules:
>
> - **Until dealt with.** A conflict is a record id plus the revision that conflicted. Each has two states, raised and dealt with, kept in session storage (the same place the rail keeps its overdue notices, so they last as long as the browser tab). Dealt with means the reviewer pressed or swiped the toast, or resolved the conflict. A repaint that finds a standing conflict raises nothing. A reload raises again every open conflict not yet dealt with: the agent may still be writing, so a reload with the toast up is likely, and it must not take the toast away for good while the conflict stays. A conflict that closes, however it closes, is forgotten, so the same record clashing again later is told again.
> - **One toast.** Several collisions share one toast that names the count. A new one while a toast stands replaces it with the new count.
> - **It waits.** Sticky, with no timer. It goes when pressed, swiped or closed, or when every conflict it named is resolved. A toast replaced by a newer count, or taken down because its conflicts closed, was not dealt with.
> - **Held while hidden.** While the review is hidden for presenting, or the window is read-only, nothing is raised and nothing is spent. The next sync after the reviewer comes back raises it.
>
> The dedupe is this module's own. Every raise gets a new key, because the rail refuses a key it has seen for the life of the rail, and a conflict that closed and came back must be told again.
>
> The module keeps its own copy of the state, so a storage that is missing, unreadable or full still stops repeats within the page. Each list keeps its newest 50 keys: a tab told fifty collisions and resolving none is not helped by the fifty-first.
>
> Pressing opens the rail on the first conflict card still standing, the way a reply toast opens its card: it reveals the card first, because the Active filter may be hiding it and a jump to a hidden card is a jump to nothing, then scrolls to the conflict choice and focuses the card.
>
> [replay_branches.md](../../diagrams/replay_branches.md) shows where branch four raises it.

### `docs/ongoing/code/browser-review-layer-review.md` (new): `choices.ts` and `export.ts`

> **`choices.ts`: choice buttons on a document page.** A choice group is a house component an agent writes as plain HTML:
>
> ```html
> <div class="choice" data-choice="lesson-css-counter">
>   <p class="choice-q">Promote this lesson?</p>
>   <button type="button" value="promote" data-recommended>Promote</button>
>   <button type="button" value="discard">Discard</button>
> </div>
> ```
>
> Groups arm only on a document page, one whose script tag carries `data-lahe-document`, which the helper writes only onto pages it serves itself. On any other page (a `lahe add` dev server) this module touches nothing, claims no click and raises no chip: browse is the page untouched.
>
> A refused group gets `data-lahe-inert`, so the stylesheet draws it as plain content, and one chip names every refused group and why. Buttons must be the group's own children because the stylesheet draws `.choice > button` only: a Markdown block with a blank line inside wraps each button in a `<p>`, which would arm and then never show its decision.
>
> A press is decided by the gesture table (`PRESS_CHOICE`). It mints the record in draft and marks it ready in the same tick, with no immediate flush: the sync client holds a choice item's events until the page has been quiet for a few seconds, so presses close together travel together.
>
> Leaving an open edit commits it when the pointer goes down, so by the click that follows no edit is open and the gate would read browse. The window's capture phase runs before every document listener, so the gate is read on pointer-down and the click on the same button within two seconds uses it.
>
> A click the layer already took is not a press. The pick handler listens on the same target in the same phase, closes pick mode and calls `preventDefault`, so by the time this runs the gate would read "not picking"; the event's own mark is the honest answer.
>
> A group the page replaced since the last arming (a morph) is judged again at click time.
>
> [CHOICE_BUTTONS.md](../CHOICE_BUTTONS.md) is how the feature works end to end.
>
> **`export.ts`: Copy and Export.** There is always a way to take the work elsewhere, with nothing running, and no false success: a copy that did not reach the clipboard says so on a chip. Both controls stay visible at all times, because when something is wrong is exactly when the reviewer cannot tell.
>
> What comes out is human-readable text, not `review.json`: what a person pastes into a chat or hands to a colleague. Every byte comes from `renderText` in `src/domain/review-text.ts`, so the same records read the same way from the helper and from the browser. Never format a record here. Copy and Export are one review rendered twice and must be the same bytes; the page title once reached only one of them.
>
> Two scopes. Full: the helper is reachable, so the whole review is in play. Slice: nothing is running, so the text is what this browser holds, and its first line says so. Browser storage is partitioned by origin, so with no helper there is no way to see a page served from another origin; an export that quietly left that out would tell the reviewer they have everything when they do not. The label is the only difference between the two texts.
>
> Reachability is decided live at the click, never remembered: a cached "stored" from thirty seconds ago is exactly the reading that would label a dead helper's export as the whole review. The sync client's CSP refusal is read first, because a fetch would only repeat it noisily. Then `review.read` is asked: 200 (and 501, which an old helper answered before the projection route existed) means reachable; 401, 403 and 404 mean the helper is up but this page cannot see this review, which is not the whole review; no answer means a slice. The request has a two-second deadline, because a suspended helper accepts the socket and never answers while the reviewer waits on the click.
>
> The helper answers `review.read` with the projection, not records, so today the full scope renders this browser's records. A body that does carry records is folded in, the browser winning a record's content unless the helper holds a later revision.
>
> The file name carries the scope as well as the text, because a file gets forwarded without its first line being read. The page title leads, slugged and cut to forty characters: the id is exact and meaningless, the title is what a person tells three downloads apart by, and the id after it keeps the name exact.
>
> The download link is added to the document, not the rail's shadow root, because a download click has to come from a connected node. The object URL is revoked a tick later: revoking it in the same task cancels the download in some browsers.
>
> The module registers as both `exporter` and `export`, one object. `index` builds the page's exporter at boot and configures it here; the hand-edit list export (`tab_edits`) reaches it through `export.exportRecords`, with the slice scope, since a list of hand edits is never the whole review.

### Other docs this slice edits

- `docs/ongoing/CHOICE_BUTTONS.md` line 82 and `docs/ongoing/FREE_WRITING.md` line 117: the file named in the table row becomes the new path (`src/browser/review-layer/review/choices.ts`; `src/browser/review-layer/anchoring/blocks.ts` and `block-build.ts`). `choices.js` has no forwarder, so its row would otherwise name a missing file.
- `docs/ongoing/BRAND.md` line 24: the `conflict_toast.js` link becomes `conflict-toast.ts`, since the strings now live there.

### Dropped as dead history

Owner and task codes (Task 2C, 0A-kernel, 2A, 2B, 1B, 1C, 1D, 3A, 3C, 3D, "free-writing kernel, plan Task 1.3", "conflict-toast (2026-09-22)"); "Phase 0 ships it working"; "FROZEN AT CP0" and the second-writer argument (kept only as "check both readers"); decision and requirement numbers from the archived draft (D3, D5, D7, D10, R4, R10, R11) and plan test numbers ("plan test 20", "ranked test 34"); the "THE SEAM: when 3A lands" note; the one-list storage shape; the `harness-allow-timer:` markers, which nothing reads under `src/`; the export stub's history; the date attribution on the title rule; "Dual-environment module" lines and the wrapper comments; the JSDoc type tags, which the types replace.

## 10. Open questions

1. **`selection.ts` has no `.ts` unit test.** It reads the ambient page and must return DOM types to its callers, and the unit project cannot see DOM types. Recommended: accept. Its Node answers are pinned by the JavaScript bridge test, the rest by the named browser specs. The builder first checks the premise with a one-line probe (a `.ts` test importing a review-layer module whose declaration names `Element`); if it compiles, `selection.ts` gets an ordinary unit test instead.
2. **Decided:** the `src/layer/export.js` forwarder keeps owner `"3C"` so the fixed `export_text.test.js` passes unedited until F1, as the plan's source-text table assigns. The alternative is editing that one assertion now.
3. **Decided:** `choices.js` gets no forwarder and moves with `git mv`, because nothing requires it in Node.
4. **Decided:** `blocks_kernel.spec.js` passes `document` to its four `writeBlock` calls. This edits a fixed spec's harness, not what it asserts. The orchestrator confirms that is acceptable.
5. **Known gap:** nothing compiles the real DOM types against the new interfaces until a caller converts (B3, B5, B11, B12 of the browser chain). A misfit surfaces there and is fixed in this folder's interface.

## Orchestrator decisions (2026-11-12)

1. **Browser-side unit tests get their own TypeScript project, not a JavaScript bridge test.** B1 adds a project for `test/unit/browser/**/*.test.ts` with `lib` including `dom` and `types` including `node` (for `node:test`). It may import the contract, domain and review-layer projects. `selection.ts` and the other DOM-reading modules then get typed `.ts` unit tests. Code still takes narrow interfaces where a fake is enough; the DOM types are for code that really needs the browser. B1 adds the project to the expected table in `test/unit/strictness_gate.test.js`, in the open, and to `docs/ongoing/code/README.md`. Every later browser slice uses it.
2. **`blocks_kernel.spec.js` may pass `document` in its four `writeBlock` calls.** What it asserts does not change.
3. **The three decisions the spec made itself stand:** the export forwarder keeps owner `"3C"` until F1, `choices.js` gets no forwarder, and the DOM-type check against the new interfaces waits until callers convert.
4. **The export filename departure** (a title with no ASCII letters or digits no longer gives a double-hyphen name) goes on the progress page when B1 merges.
