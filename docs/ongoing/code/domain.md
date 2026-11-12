---
read-when: Changing a file in src/domain/, or working out why one of them does what it does.
not-for: How the TypeScript projects and the lint gate are set up; see README.md in this folder.
---

# `src/domain/`: logic the server and the browser both run

This folder holds the code that the server and the review layer both run and must agree on. Today it holds `elapsed.ts`, `gestures.ts` and the ten modules that replace the old normalizer (`text.ts`, `html-syntax.ts`, `formatting.ts`, `clean-markup.ts`, `embedded-value.ts`, `block-text.ts`, `comparison.ts`, `run-blocks.ts`, `run-match.ts` and `target-slug.ts`). The rest arrives with the contract wave of the [TypeScript migration](../../features/20261112.01_typescript_migration/parts/target_layout.md): `lifecycle`, `review-format` and the record rules.

A file here imports only `src/contract/`, and nothing that needs Node or a DOM. The compiler enforces it: this project has neither Node's types nor the DOM's.

Source files carry no comments except their `read-when` header. The why, the traps and the history live here.

## How a domain module reaches both sides

- **Node** imports the `.ts` file directly; Node strips the types. CommonJS callers that are still JavaScript reach it through a one-line forwarder at the module's old path under `src/shared/`, listed in the manifest's `FORWARDERS`. The forwarder copies the exports into an ordinary object.
- **The browser** gets it inside the review-layer bundle. Until the layer's own files convert, they read their dependencies off `window.LAHE` as they load. So the module's entry in the manifest's `LAYER_FILES` names the `.ts` path at the old file's place in the order, with `registers` set to the namespace name the old file used. `scripts/build-layer.js` then registers the module under that name at that place, before any later file loads.

Both sides hand callers an ordinary, writable copy of the module's exports, not the read-only module namespace, because old code and tests replace functions on these objects. One old file can be several modules: the normalizer's manifest entry lists all ten, and `src/shared/normalize.js` copies all ten into one object, so a caller still reads `normalize.cleanMarkup` and `normalize.COMPARISON_MODE` off one name. A copy taken once is why a module here exports functions and constants only, never a `let` it reassigns ([README.md](README.md#moving-a-file)).

## `elapsed.ts`: how long something has been going on, in words

One phrase, two callers. The server says it in the refusal it sends a second window that tries to take a review another window holds (`heldForPhrase` in `src/service/reviews.js`). The rail says it again on the chip it draws from that refusal (`describeHolder` in `src/layer/store.js`). Both used to spell it themselves, so a reviewer could read "for the last 4 minutes" from one and "since 2026-08-18T04:35:45.006Z" from the other about the same window. A raw ISO timestamp is machine output in a sentence written for a person. The wording now lives only here.

The rule is the whole module:

| Elapsed | Phrase |
| --- | --- |
| under a minute, or a start in the future | "for less than a minute" |
| under 90 minutes | "for the last 12 minutes" ("1 minute" when it is one) |
| 90 minutes or more | "since " and a local date and time |

The phrase follows a verb: "open for the last 4 minutes", "holding it since ...".

A start that is not a readable time is echoed as "since " and the value as given, never guessed at. A wrong duration is worse than an honest echo.

`options.now` sets the clock, so a test can pin it instead of sleeping. The server passes its own clock, so its tests can move time; the rail uses the real one.

The local date and time come from the runtime's `toLocaleString()`, so the server's wording follows the machine's locale and the rail's follows the browser's. The two can differ only for a holder older than 90 minutes.

## `gestures.ts`: what a key, a click or an input means

The rule that keeps this table small: browsing is the page untouched. No intercepted clicks, no `contentEditable`, and no captured keys beyond the library's own shortcuts. Links navigate, buttons act, forms submit, and the page's JavaScript sees every event it would see without Lahe. The page keeps working, and that outranks editing convenience (D3 and R13 in [the original architecture](../../features/20260812.01_live_agentic_html_editor/)).

So the table is almost all keystrokes. The click rules that remain: a click inside the library's overlay is the overlay's; a click in pick mode picks; a click outside an open edit commits it and still reaches the page, so following a link is never a losing move; and a press on an armed choice button is the reviewer's answer. That last is the one click in browse the library takes, and only because the agent marked the button as a question. It has no hint row: every row is a line on every page's rail, and a page with no choices must look exactly as before.

Gone, on purpose: Alt-click (nobody found it), a plain click placing the caret (it fought the page for every click), Cmd-click following a link (browse is native, so a plain click already does), and an editing toggle (editing is per block now, entered with Cmd-Shift-E).

Every function here is pure over a plain description of the event, not a DOM event, so the whole table is unit-tested with no browser and the browser tests check only the wiring. The description keeps the old field names, because four layer files build it. A decision is one of three dispositions (taken: the library handles it and the page does not see its default; the page's: it passes through untouched; neither: only a click inside the overlay), and the type makes "passed to the page and prevented" unrepresentable. The module stays one file: the browser registers it under the one name `LAHE.gestures`, and splitting the block-type table or the editing intents out would need a re-export to keep that object whole. Once `editing.js` and `overlay.js` are converted, a split can be done without one.

**Chords.**

- Present is Cmd-Shift-X. P and H were the obvious letters, and both are taken by something a presenter cannot afford mid-talk: Cmd/Ctrl-Shift-P opens a private window in Firefox and Edge, and Cmd/Ctrl-Shift-H is Home in Safari (which navigates the deck away) and the history library in Firefox. X is unbound in Chrome, Safari, Firefox and Edge on both platforms, and reveal.js uses only unmodified letters.
- The rail is Cmd-Shift-1. It had to be a left-hand chord, and every left-hand letter that reads as a mnemonic is already a browser's with Cmd/Ctrl-Shift (A tab search, B bookmarks bar, D bookmark all tabs, F fullscreen or find, G find previous, Q log out, R hard reload, S save, T reopen a tab, V paste and match style, W close the window, Z redo). Among the left-hand digits, 3, 4 and 5 are macOS screenshots and the backtick cycles windows. Digit 1 is free in the four browsers on macOS and Windows.
- The rail chord matches on `code` as well as `key`, because Shift changes what `key` reports for a digit, and how depends on the layout ("!" on US).
- The present chord is decided first, with no conditions: present mode hides the whole library and this chord is how the reviewer gets it back. The rail chord is second, so it works from anywhere, including the rail's own fields. While presenting, the caller refuses the rail chord, so Cmd-Shift-X is the only way back.

**Leaving an edit.** A pointer going down anywhere outside the edited block commits it, the rail included. The click rule alone could not: a click on the rail is retargeted to the overlay host, hits the overlay rule, and the edit sat in draft forever, never offered to an agent. Pointerdown is the honest moment the reviewer left; it fires before focus moves, and the event still reaches the rail and the page. Two presses are not leaving: a scrollbar drag (pointerdown with no click after it, which stripped editing mid-scroll) and a secondary button (a context menu). Both broke when the rule widened from click to pointerdown. A caller that cannot tell which button means a primary press. `isScrollbarPress` is the geometry half: the caller measures, this decides. An element's `clientWidth` stops at its content box while its border box includes the scrollbar gutter, and the root's scrollbar sits outside the document element with the viewport as the outer edge; either way the press is past the content and inside the box. A box with no gutter is an overlay scrollbar, which takes no layout space and receives no press.

**The send key.** Enter sends a comment and Shift-Enter starts a new line, like a chat box. A reviewer who writes long comments can switch to Cmd-Enter in the Keyboard shortcuts panel, and then a bare Enter is a new line. Cmd-Enter sends under both settings, so the old habit keeps working. Only boxes the reviewer writes to the agent follow this; an edit on the page is writing on the page, where Enter is a paragraph. An Enter that picks an input-method candidate (Japanese, Chinese) is never a send; Safari reports such a key as `keyCode` 229. The `sendKey` field is typed, but the code compares it with `"mod_enter"` rather than switching on it, so a stored value that is not a send key still gets the Enter behavior; `normalizeSendKey` is the parser for the store's value. The default words are spelled once, in the Enter send-key words, and the `MARK_READY` row takes them from there.

**Breaks.** Enter while editing is typing, not a shortcut, so it has no hint row. But the record must say which break the reviewer typed, and the engines disagree (measured in all three engines in a bare `<p contenteditable>`): Enter writes a nested block in Chromium and WebKit and a `<br>` in Firefox; Shift-Enter writes a `<br>` in Chromium and Firefox and a nested block in WebKit. So the layer decides the break from the key and writes it itself. `inputType` alone is not enough, because WebKit reports Shift-Enter as `insertParagraph`, the same as Enter; the Shift state of the keydown breaks the tie, and the caller supplies it because a `beforeinput` event does not carry one.

**Bold and italic.** One button does two opposite things, decided by what the reviewer sees: words not yet bold ask for bold, and words that look bold, whether from a `<strong>` or a stylesheet, ask for it to come off. Left to the engine, taking bold off stylesheet-bold text wrote a style attribute the tool cannot keep, and taking italic off stylesheet-italic text did nothing at all in Firefox. Bold and italic are the only two commands; anything else is not a gesture this tool has.

**Block types.** The chords match on `code`, so the character Option or Shift makes never matters. None uses Ctrl-Alt, because AltGr sends Ctrl-Alt on Windows and Linux and types a character with a digit on German and Polish layouts; nothing matches while AltGraph is held. Digit 1 is skipped because Cmd-Shift-1 opens the rail, and a heading's digit is its level on the page. Each block type lists its Markdown shortcuts in its own row, so the menu's rows and the shortcuts are one table. The shortcuts use Markdown's own levels, so `## ` makes the h2 it means in the source (the flow walk once found them one level off), and `# ` also makes an h2 because the page title is the page's only h1. A contenteditable often turns the typed space into a no-break space, which counts as a space. The menu shows a row's first shortcut.

**Inside a writing session**, Enter, Backspace and Delete at a block's edge, and undo are decided here too, so the editing code reads one answer. The layer cancels a native merge and writes its own, because a native merge adds style spans. Backspace or Delete at the session's own first or last block is refused, so no page block outside the session changes. Cmd-Z inside a session walks the session's own history; outside one, Lahe's per-record undo is unchanged.

## The normalizer: ten modules, one answer to "are these the same"

The normalizer is the one place Lahe decides when two pieces of text, or two pieces of markup, are the same. Replay, the anchor engine, the edit recorder, the helper's handled check, the review projection and the CLI all ask it, and they must all get one answer. The old `src/shared/normalize.js` is split by job into the ten modules below. Its path is a forwarder that copies all ten into one object, and the bundle registers the same copy as `LAHE.normalize`, so no caller changed how it reads them. Both bridges go when the layer's own files convert.

Some exports exist only for the sibling modules, and nothing outside this folder should import them: `readTag`, `tokenizeMarkup`, `skipDeclaration`, `nbspToSpace`, `breakOfTag`, `isVoidTag` and `isWhitespacePreservingTag` in `html-syntax.ts`, `cleanCharacters` and `collapseSpaces` in `text.ts`, and `resetTagsForStyle` and `isStructuralTag` in `formatting.ts`. The forwarder carries them, harmlessly.

## `text.ts`

This is the one text normalizer. No other module defines its own normalization. If any two readers fold text differently, no region ever compares equal to its record, replay rewrites every region on every pass, and the reviewer's caret gets fought twice a second, which is the bug the tool exists to remove.

`normalizeText` is a comparison key, and each guarantee has a caller that relies on it:

- Whitespace-insensitive, so rewrapping or reindenting a paragraph does not change its key, and a comment survives a reformat.
- Case-sensitive and typography-preserving. "Fix" and "fix" are different words, and a curly quote is a real difference in a document about wording. Folding typography here would make a reviewer's punctuation fix invisible to replay; `foldTypography` is the separate, named fallback.
- It throws on a non-string. A silent `String(undefined)` would make the literal text "undefined" a comparison key, which matches nothing forever and looks like an anchoring bug. The throw is not written out: the first string method it calls does it.

The hair space U+200A is in the space list on purpose: in a sibling project it hid in a test fixture where it looked exactly like a space. U+200D and U+200C are kept on purpose: they carry meaning in emoji sequences and in Persian, Hindi and other scripts, and removing them changes the reviewer's text. Control characters vanish rather than becoming spaces, so a stray byte never splits a word.

`normalizeBlockText` exists because one run of whitespace is not incidental: a break the reviewer typed. Folded away, the commit compares equal to the text it started as, the edit is thrown out as a no-op, and the break vanishes the next time the page is rebuilt. That happened. So a break is read off the markup, never off a whitespace character (a `<br>` is one newline, a block boundary is a blank line), and every other run still folds, including the newlines a source carries because its author wrapped a line.

`foldTypography` decides only where a block is, never whether its words are right. Replay and the page check compare a found block with each revision without it, so a reviewer's punctuation fix (well--known to well-known) is still written and still checked. Hyphen runs fold after the dashes because a Markdown source spells a dash `--` or `---` and a smart renderer draws one, and every reader (the run walk, the page check, the handled check, the split search) must see them as the same.

`firstWords` is the one copy of "the first N words" that editing, replay and the rail read.

`cleanCharacters` (composing, then dropping invisibles and controls) and `collapseSpaces` (every Unicode space or whitespace run to one space, no trim) are what `clean-markup.ts`, `block-text.ts` and `run-blocks.ts` share, so the character classes are spelled once.

## `html-syntax.ts`

The one tokenizer every reader in this folder uses. It is a string scanner, not an HTML parser, and that is deliberate: the markup rules stay unit-testable in `node:test` with no DOM, which keeps them outside the ban on jsdom. The browser side serializes first and hands over a string.

A tag starts with `<` and an ASCII letter, as in HTML; anything else is text, so `1 <2 and <3` is prose and the word "and" is not an attribute. A start tag and an end tag are a union on `kind`, so no reader can read attributes off an end tag. An end tag ignores everything between its name and its first `>`.

Attribute values are decoded on the way in and escaped once on the way out. Keeping them as written and escaping again turned every `&amp;` in a recorded link into `&amp;amp;`. Markup already stored with a doubled escape reads back unchanged, because decoding once and escaping once gives the stored string back.

`tokenizeMarkup` splits a string into text and tags for the readers that only need the sequence (`blockText`, `textOf`, `structureOf`, `emphasisRuns`, `topLevelBlocks`). A `<` that starts no tag is its own text token. `skipDeclaration` finds the end of a comment, a `<!...>` declaration or a `<?...>` instruction, which `cleanMarkup` drops, `cleanBlock` refuses and `leafBlocks` skips; a comment never closed runs to the end. The three readers that need positions (`cleanMarkup`, `cleanBlock`, `leafBlocks`) loop on `readTag` themselves.

`BLOCK_TAGS` includes table cells for the same reason it includes list items: two cells read as two things, and running their words together is how "Helloworld" got into a record. It is the text readers' list; `run-blocks.ts` has its own, shorter list of what a record may write. The tables are typed lists with a guard beside each (`isBlockTag`, `isDroppedSubtreeTag`), so a caller never checks membership with a string comparison or `hasOwnProperty`; `hasOwnProperty` on an array answers false for every name without an error.

## `formatting.ts`

HTML has no element that means "not bold". A reviewer who selects a phrase that is bold through the page's own stylesheet and presses B is asking for exactly that, and every engine answers the same way: `<span style="font-weight: normal">`, byte for byte identical in Chromium, Firefox and WebKit with `styleWithCSS` off. Lahe drops every style attribute on the way into a record, so the span came back bare, the structural view dropped it too, and the un-bold compared equal to no change. It was thrown away in silence, and a reviewed report is full of stylesheet bold, so this was the common case.

So the reset gets a tag of its own, and the style attribute still never survives. The names are hyphenated because a hyphen makes a custom element name, which the HTML spec promises will never get a meaning of its own, and because they read plainly in the markup an agent is handed: "Runners come back `<not-bold>`too fast`</not-bold>` after a layoff." The trade: a page that ships its own `<not-bold>` element gets the layer's one rule for it (`font-weight: normal`), which is what its name claims anyway. Namespacing the tags would remove that risk and put Lahe branding in front of every agent that reads a record.

`lighter` counts as not bold. It is relative and can in principle land on 600 under a 900 parent, but a reviewer never types it and an engine only emits it meaning lighter. In a style the last declaration of a property wins, as in CSS.

The layer reads `RESET_TAGS` rather than spelling the tag names again. Two rules in the layer's one page stylesheet (`highlight`) are what make the tags render.

## `clean-markup.ts`

`cleanMarkup` is the markup key: what a record stores in `before_html` and `after_html`, and what an agent reads. It guarantees that no tool markup survives (chrome goes with its subtree, wrappers unwrap, every `data-lahe*` attribute and `lahe-` class goes), that no style attribute survives (the tool never writes one and never reports one), that no executable URL scheme survives (checked after references and control characters are resolved, since those are how `java\tscript:` gets past a naive prefix check, and checked on the decoded value, then decoded again), that no event handler survives, and that the output is balanced and stable when a browser reserializes it.

Sorting attributes is a trade. It loses the author's attribute order in the markup an agent reads, and buys a `before_html`/`after_html` comparison that does not report a change because Chromium wrote two attributes in a different order.

One element can become several: a span whose only job was to say "not bold" becomes `<not-bold>`, and one that says something else too keeps its own tag inside the marker. Only the innermost name carries attributes; a marker never has any. A `/>` on an element that is not void opens it, as a browser does, so the output stays balanced; a script written `<script/>` drops everything after it.

`keepWhitespace` exists for protection's restore, which puts the reviewer's own block back after a repaint destroyed it. The spaces in it are characters the reviewer typed. A trailing space folded away means their next word runs into the last one; a leading one trimmed shifts the caret one character right.

Edges kept as they are: a duplicate attribute (`id="a" id="b"`) is kept, where a browser keeps the first. Two spaces on either side of a dropped element or a comment stay two spaces (each text run folds by itself), and cleaning the result again folds them. A no-break space spelled as a reference is a space even inside `pre`.

A brand for clean markup was considered and left out: every caller stores or compares the result as a string, the only check that it is clean is `record.validateRun`'s equality test, and minting a brand without a cast costs more than it guards here.

## `embedded-value.ts`

A `data:` URL carries the picture itself as text, often hundreds of kilobytes. A record stores such a value once, whole, and refers to it by name everywhere else (see the oversized-records feature folder). These two functions are the whole vocabulary: what counts as embedded, and the fixed-size name a comparison uses instead of the value. The media type and length in the name are readable on their own; the digest tells two pictures of one size apart.

The digest is cyrb53's mixing (by bryc, public domain) over both 32-bit lanes, kept whole at 64 bits. It is pure arithmetic on UTF-16 code units, so the browser and Node agree on every value. Element signatures stored in records hold these names, so the arithmetic must never change. It is a name for a value, never a check that two values are safe to treat as one for a write: the uniqueness rule still decides that, over candidates found on the page.

## `block-text.ts`

Two front ends produce break-aware text because two kinds of caller hold two different things: `blockText` takes markup (a record's own html, a test fixture) and `blockTextFromNode` takes a live element (the anchor engine, replay). They share the break vocabulary and the folding, so they cannot drift. In `blockTextFromNode`, a text node's own whitespace outside `pre` is incidental (the source wrapped a line) and folds before the breaks are added, so every newline left in the joined string came from a break tag.

The two agree on text without `&`, `<` or `>`. `blockText` keeps character references as written (`&amp;`), while a live node's text is already decoded (`&`). Callers that compare across the two decode first (`blockWords` does).

`textOf` is the text mode's view, and it does not clean first, on purpose. It takes a record's plain `after` (which states the reviewer's breaks with real newlines) as well as markup (a format-only record's `after_html`). Cleaning would fold the newlines in a text run, which is right for markup and would erase the breaks a record's text holds. The rule that makes both safe: a newline already in the string is a break, and a tag gives the break its name says. Markup reaches a record through `blockText`, which folds a source's line wraps first, so nothing is recorded with an incidental newline. `textOf` does not recognize comments (its inputs never hold them).

Whitespace inside `pre` is content, so it is carried across the folding on three private-use characters (U+E000 to U+E002) and put back after. A reviewer editing a code block keeps their indentation.

`topLevelBlocks` exists for replay writing one paragraph of a multi-paragraph edit when the page already carries the others. The paragraph's bold, italic and links live in the record's `after_html`, and this finds that paragraph's share. It cuts only at the top level, so a block nested in an inline element, or a list inside a paragraph, stays whole and reads to replay as more than one paragraph, which replay then refuses. A piece with markup and no words (an image alone) cannot be matched to a paragraph of text, so the answer is null.

`TextSourceNode` lists only what the reader touches, so a real DOM `Node` and the hand-built fakes in the layer's unit tests both fit without a cast. The fakes spell a text node's string `data` or `nodeValue`; the reader accepts either.

## `comparison.ts`

Ordinary records compare on text. A format-only record cannot: its whole point is a change the text key is built to ignore, so comparing it on text makes replay's format-only branch a silent no-op that looks like a working feature. `modeFor` picks the mode from the record kind, and `equalsInMode` is the only comparison a caller makes. Its mode is the two-member union and its `switch` has no `default`, so a third mode fails the build where it is unhandled instead of throwing at runtime. `modeFor` takes a string because the record kinds belong to the record contract.

Formatting is a closed list, bold and italic. `cleanMarkup` has already renamed `b` and `i`, so the structural view only ever sees four names, two formats each with an on and an off. Everything else in the markup is dropped, which keeps the comparison one of formatting, not of the page's markup: a framework that reserializes a span or adds a wrapper class must not read as a format change. Both modes take markup, and the only difference between them is whether emphasis counts.

The text mode keeps breaks: that is the difference between "the reviewer split this paragraph" and "nothing changed". The structure mode does not, because its question is only which words are emphasized; it still leaves a space where a break was so the words either side do not run together into one made-up word.

`emphasisRuns` reports a run nested inside another once per tag, because `<strong><em>x</em></strong>` is both. A marker around no words is not a formatting change anyone can be told about in words, so it is left out.

## `run-blocks.ts`

A free-writing run record carries new blocks as `{tag, html}`, and `cleanBlock` is the one allowlist for them. It runs three times: at capture in the layer, at the helper on append, and before every page write. At the helper, `record.validateRun` refuses a block that is not exactly `cleanBlock`'s output rather than cleaning it, so a forged or runaway record shows up instead of being quietly repaired. Nothing in a record ever names an element: every output tag is written from the constants here.

`cleanBlock` is the boundary parser of this folder. It takes `unknown` and returns a typed result or a typed refusal whose code is checked against the failure table at compile time. Callers tell them apart with `"html" in result`; still-JavaScript callers test `typeof cleaned.html === "string"` and read `cleaned.reason`.

The output is a fixed point (cleaning it again gives it back unchanged), which is what lets the helper compare stored markup with `cleanBlock`'s output byte for byte. Text has tab, line feed and carriage return turned into spaces, like every other space: a page source wrapped at a point becomes a space, so the words keep the gap the page's own leaves have.

The nesting cap bounds the closing-tag scan and every recursive pass, so hostile markup costs linear time and never overflows the stack. Before it, N `<em>` then N `</b>` cost N times N. A real block is a few levels deep. Empty elements are pruned with the text either side joined once per run of text, not once per piece; joining per piece rescanned the whole string each time, which was N times N on a block of many empty elements. Leading and trailing breaks are removed in one pass for the same reason.

`blockWords` is how every reader of a run compares words: references resolved, whitespace folded, typography folded. Tags and markup never decide presence. Its result is a branded string, because the matcher compares words with `===` and words in any other form give a silent "missing"; only `blockWords` makes the brand. `runWords` skips `from_anchor` blocks because those are the page's own words moved, not words the reviewer wrote; the helper sets `proofread` from it.

## `run-match.ts`

`leafBlocks` reads a page's leaf blocks from a string, in document order, for the helper's handled check. `src/layer/blocks.js` walks the live DOM by the same rule, and the two must agree. The tree builder is small: enough to agree with a browser's parse on the cases the free-writing corpus names (a `p` closed by a block start, an `li` closed by the next `li`, raw-text elements, inert template contents, comments). A page nested tens of thousands of levels deep can overflow the stack here (the handled check already catches that).

The file-name title is skipped by the walk but still counts as a block for the leaf test, so the hero that holds only the title is not read as a leaf.

`matchRun` decides which of a run's blocks the page already shows. A block is present whole, joined with the blocks after it in one leaf, or split over consecutive leaves; tag and markup never decide. Leaves that match nothing are skipped only before the first match, because after one the run should continue right there. The walk reads at most the run's length plus two leaves. Its result type cannot hold a missing block with leaves or a found block with none, so `runClash` reads a found block's leaves with no check.

`runClash` finds a block whose words the page shows inside a leaf that also holds words the reviewer never typed (the agent added a sentence). "Joined" is exact, so this is not presence; it is not missing either, since inserting the block would show the reviewer's words twice. Replay writes nothing until the reviewer answers. Only the leaf where the missing block would sit is read, so a short block ("Notes") never clashes with a paragraph further down that uses the word. With nothing matched yet, that leaf is usually the page's own next paragraph, and a block under five words ("Next", "Yes") sits inside such a paragraph for other reasons, so it clashes only after an earlier block matched. Words match as whole words in any script: "Beta" is not inside "Betamax".

## `target-slug.ts`

A readable, filesystem-safe fragment of a review's file name. It is never a path component on its own: the review file writer pairs it with a hash of the canonical target, because a path component is never derived from untrusted text. Only the server uses it, so it moves into the server's folder with the review file writer.
