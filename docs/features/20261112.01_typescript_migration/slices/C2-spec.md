---
read-when: Building or reviewing slice C2 of the TypeScript migration.
---

# C2 spec: the normalizer, rebuilt as ten modules in `src/domain/`

The normalizer is the one place Lahe decides when two pieces of text, or two pieces of markup, are the same. Replay, the anchor engine, the edit recorder, the helper's handled check, the review projection and the CLI all ask it, and they must all get one answer. If two of them disagree, no region ever compares equal to its record, replay rewrites the page on every pass, and the reviewer's caret gets fought twice a second. This slice rebuilds it test first, split by job.

Counts in this spec came from scripts under the session scratchpad (`specs/c2/usage.py`, `tests.py`, `probe.js`, `probe2.js`). Expected values marked "pinned" were read from the old code on purpose: they are values other code or stored records already depend on.

## 1. Scope

**Old file:** `src/shared/normalize.js`, 1,968 lines (505 comment lines and 142 blank lines; comment count from the recon's section 8). It is position 2 in the browser bundle and is also `require`d by the server, the CLI and one script.

**New modules**, all in `src/domain/` (kebab-case, one job each):

| Module | Job | Rough size |
| --- | --- | --- |
| `text.ts` | The plain-text comparison keys: `normalizeText`, `normalizeBlockText`, `foldTypography`, `firstWords`, the two break strings | 80 |
| `html-syntax.ts` | The shared lexer: reading one tag, resolving and escaping character references, and the element category tables | 170 |
| `formatting.ts` | The closed formatting vocabulary: the two minted reset tags, the four structural tags, and reading "not bold" or "not italic" off a style value | 60 |
| `clean-markup.ts` | `cleanMarkup`: the canonical, safe markup a record stores and an agent reads | 220 |
| `embedded-value.ts` | `data:` URL values and their fixed-size names | 50 |
| `block-text.ts` | Break-aware text from markup, from plain text, and from a live node; cutting markup into top-level paragraphs | 200 |
| `comparison.ts` | The two comparison modes, the structural view, and emphasis runs | 110 |
| `run-blocks.ts` | Free writing's block allowlist (`cleanBlock`) and a run's words | 250 |
| `run-match.ts` | Free writing's string page reader (`leafBlocks`) and the run matcher (`matchRun`, `runClash`) | 260 |
| `target-slug.ts` | The readable, filesystem-safe fragment of a review's file name | 25 |

**Bridges (temporary, removed in F1):** `src/shared/normalize.js` becomes a forwarder that combines all ten modules into one plain object (B78). The bundle's slot for `LAHE.normalize` becomes the same combination (B79). Section 10 says what this needs from S0c.

**Other files the slice edits:** the call sites of renamed exports (section 4, "Renames"), the three old unit test files (moved with `git mv`), `src/shared/manifest.js` (its own entry only), the new sections of `docs/ongoing/code/domain.md`, and the lines of `docs/CONTRACTS.md` and `docs/ongoing/FREE_WRITING.md` that name `normalize.js` or a renamed export.

**Depends on C1.** The domain modules import these from `src/contract/markers.ts`: `TOOL_ATTR`, `ROLE_CHROME`, `ROLE_WRAP`, `OVERLAY_ROOT_ID`, `FILE_TITLE_ATTR`, `FILE_TITLE_VALUE`, `isToolAttrName`, `isToolClassToken`, `isToolNode`. From `src/contract/failures.ts`: the union type of failure codes (whatever C1 names it; this spec calls it `FailureCode`). If C1 renames any of these, use C1's names. `isToolNode` must accept a value whose `getAttribute` is optional (`{ readonly getAttribute?: (name: string) => string | null }`), because `blockTextFromNode` hands it nodes typed that way (section 10).

## 2. Behavior

Each statement is observable by a caller, a person or an agent, and each is checked by a new test. "Ex" lines are inputs and exact outputs. Code points are written as `U+XXXX`; strings in JSON form.

### `text.ts`

- **B1.** `normalizeText` turns every run of whitespace (space, tab, LF, CR) and every one of these Unicode spaces into a single space, and removes them at both ends: U+00A0, U+1680, U+2000 to U+200A (the hair space U+200A included), U+2028, U+2029, U+202F, U+205F, U+3000. Ex: `"  The trainer\n\twrites   the plan.  "` gives `"The trainer writes the plan."`; `"a\u00A0b"`, `"a\u200Ab"`, `"a\u2009b"`, `"a\u3000b"` and `"a\u2028b"` each give `"a b"`. A rewrapped and reindented paragraph gives the same result as the one-line original.
- **B2.** `normalizeText` removes U+200B (zero width space), U+FEFF (byte order mark) and U+00AD (soft hyphen), and keeps U+200C and U+200D (zero width non-joiner and joiner). Ex: `"a\u200Bb"` gives `"ab"`; `"\uFEFFabc"` gives `"abc"`; `"a\u200Db"` is unchanged.
- **B3.** `normalizeText` removes the control characters U+0000 to U+0008, U+000B, U+000C, U+000E to U+001F and U+007F to U+009F. They vanish; they do not become spaces. Ex: `"a\u0007bc"` gives `"abc"`; `"a\u000Bb"` gives `"ab"`; `"a\tb\nc"` gives `"a b c"`.
- **B4.** `normalizeText` composes to NFC. Ex: `"caf\u00E9"` and `"cafe\u0301"` give the same string.
- **B5.** `normalizeText` keeps letter case and typography. Ex: `"Fix"` and `"fix"` differ; `"don\u2019t"` and `"don't"` differ.
- **B6.** `normalizeText(normalizeText(x)) === normalizeText(x)` for `"  a  b  "`, `"a\n\nb"`, `"caf\u00E9"`, `"one two"`.
- **B7.** `normalizeText` given `undefined`, `null` or `42` throws a `TypeError`. No message is promised.
- **B8.** `normalizeBlockText` does what B2 to B4 do, then: CRLF and a lone CR become LF; LF survives; every other whitespace character and Unicode space (U+2028 and U+2029 included) folds as in B1, but to a space, never to a break; a space or tab beside an LF goes; three or more LF in a row become two; the result is trimmed. Ex: `"  Hello   world.  "` gives `"Hello world."`; `"Hello \n\n\n\n world."` gives `"Hello\n\nworld."`; `"Hello\r\nworld."` gives `"Hello\nworld."`; `"a\t\n\tb"` gives `"a\nb"`; `"a\u2028b\u2029c"` gives `"a b c"`. It is idempotent. `normalizeText("Hello\n\nworld.")` is still `"Hello world."`.
- **B9.** `foldTypography(x)` is `normalizeText(x)` followed by: U+2018, U+2019, U+201A, U+201B, U+2032 become `'`; U+201C, U+201D, U+201E, U+201F, U+2033 become `"`; U+2010 to U+2015 and U+2212 become `-`; then every run of two or more `-` becomes one; then U+2026 becomes `...`. Ex: `"don\u2019t \u201Cstop\u201D \u2014 now\u2026"` gives `"don't \"stop\" - now..."`; `"then -- left"` gives `"then - left"`; `"then---left"` gives `"then-left"`; `"then -- left"` and `"then \u2014 left"` give the same string; `"re-asking"` is unchanged; `"  a   b "` gives `"a b"`.
- **B10.** `firstWords(text, max, more)` returns the words of `normalizeText(text)`. When there are more than `max`, it returns the first `max` joined by single spaces, followed by `more` (default `""`); otherwise all of them. `null`, `undefined` and `""` give `""`. Ex: `("  one   two three four  ", 3)` gives `"one two three"`; `("one two three four", 3, "...")` gives `"one two three..."`; `("one two", 3, "...")` gives `"one two"`; `(null, 3, "...")` gives `""`.
- **B11.** `LINE_BREAK` is `"\n"` and `PARAGRAPH_BREAK` is `"\n\n"`.

### `html-syntax.ts`

- **B12.** `readTag(html, at)` reads the tag that starts with the `<` at `at`. A start tag is `<` followed by an ASCII letter; an end tag is `</` followed by an ASCII letter. Anything else is not a tag and gives `null` (deliberate difference D5). Ex: `readTag("a < b", 2)`, `readTag("<2 and", 0)`, `readTag("<!-- x -->", 0)` and `readTag("<?x?>", 0)` are all `null`.
- **B13.** The tag name is the longest run of `[A-Za-z0-9:_-]` after the `<` or `</`, lowercased. `end` is the index just past the tag's closing `>`, or the input's length when no `>` follows.
- **B14.** A start tag's attributes come back in source order, duplicates included. A name is lowercased and ends at whitespace, `=`, `/` or `>`. A value is double-quoted, single-quoted, unquoted (ending at whitespace or `>`), or absent (the empty string). A quoted value missing its closing quote runs to the end of the input. Character references in a value are resolved as in B16 (deliberate difference D8). A start tag ending `/>` reports `selfClosing: true`.
- **B15.** An end tag reports its name and `end` only; anything between its name and `>` is ignored.
- **B16.** `decodeEntities(text)` resolves `&amp;`, `&lt;`, `&gt;`, `&quot;`, `&apos;` and `&nbsp;` (name in any letter case) to `&`, `<`, `>`, `"`, `'` and U+00A0, and decimal (`&#65;`) and hex (`&#x41;`, `x` in either case) references from 1 to 0x10FFFF to their character. The `;` is required. Unknown names, `&#0;`, and numbers above 0x10FFFF stay as written. Ex: `"&amp;&LT;&nbsp;&#65;&#x41;&#0;&#x110000;&bogus;&apos;&quot;&gt;&AMP;"` gives `"&<\u00A0AA&#0;&#x110000;&bogus;'\">&"`.
- **B17.** `escapeAttrValue(value)` replaces `&`, `"`, `<` and `>` with `&amp;`, `&quot;`, `&lt;` and `&gt;`, and leaves `'` alone. Ex: `"a&\"<>'b"` gives `"a&amp;&quot;&lt;&gt;'b"`.
- **B18.** `BLOCK_TAGS` is exactly, in this order: `address article aside blockquote dd details div dl dt fieldset figcaption figure footer form h1 h2 h3 h4 h5 h6 header hgroup hr li main nav ol p pre section summary table tbody td tfoot th thead tr ul` (39 names). `isBlockTag(name)` is true for exactly those lowercase names.
- **B19.** `DROP_SUBTREE_TAGS` is exactly `script style template noscript iframe object embed applet frame frameset`, and `isDroppedSubtreeTag` is true for exactly those. `isVoidTag` is true for exactly `area base br col embed hr img input link meta param source track wbr`. `isWhitespacePreservingTag` is true for exactly `pre` and `textarea`.

### `formatting.ts`

- **B20.** `NOT_BOLD_TAG` is `"not-bold"`, `NOT_ITALIC_TAG` is `"not-italic"`, `RESET_TAGS` is `{ bold: "not-bold", italic: "not-italic" }`, and `STRUCTURAL_TAGS` is `["em", "strong", "not-bold", "not-italic"]` in that order. Records an agent reads carry these tag names, so they are pinned.
- **B21.** `isNotBoldWeight(value)` is true when the value, trimmed and lowercased, is `normal`, `lighter`, `100`, `200`, `300`, `400` or `500`, and false otherwise. Ex: `"Normal"` and `" 300 "` are true; `"600"`, `"bold"`, `"bolder"` and `""` are false.
- **B22.** `isNotItalicStyle(value)` is true only when the value, trimmed and lowercased, is `normal`. Ex: `" NORMAL "` is true; `"italic"` and `""` are false.

### `clean-markup.ts`

`cleanMarkup(html, options)` takes serialized markup (in the browser, an element's `innerHTML`) and returns the canonical form a record stores and an agent reads.

- **B23.** An element with `data-lahe="chrome"` is dropped with everything inside it. An element with `data-lahe="wrap"` is replaced by its contents. Ex: `'<p>Hi <span data-lahe="chrome">chip text</span><span data-lahe="wrap">kept</span> there</p>'` gives `"<p>Hi kept there</p>"`.
- **B24.** Every attribute whose lowercased name starts with `data-lahe` is dropped, the stamp `data-lahe-id` included. Every class token starting `lahe-` is dropped, the remaining tokens are joined by single spaces, and a class left empty is dropped. Ex: `'<p class="prose lahe-highlight" data-lahe-item="itm_1" id="x">text</p>'` gives `'<p class="prose" id="x">text</p>'`; `'<p class="prose" data-lahe-id="e7f2a91c">text</p>'` gives `'<p class="prose">text</p>'`; `'<p class="lahe-a lahe-b">t</p>'` gives `"<p>t</p>"`; `'<p class="  a   b ">t</p>'` gives `'<p class="a b">t</p>'`.
- **B25.** `style`, `contenteditable`, `spellcheck`, `autocorrect`, `autocapitalize`, `data-turbo-permanent` and `srcdoc` are dropped, and so is every attribute whose lowercased name starts with `on` (so `onclick`, and also an attribute named `one`). Ex: `'<p style="color:red">t</p>'` gives `"<p>t</p>"`; `'<a href="/x" onclick="steal()">t</a>'` gives `'<a href="/x">t</a>'`.
- **B26.** In `href`, `src`, `srcset`, `action`, `formaction`, `poster`, `xlink:href`, `data`, `cite` and `background`, a value is kept only when it has no scheme, or its scheme is `http`, `https`, `mailto` or `tel` in any letter case; otherwise the attribute is dropped. The scheme is read after numeric references (with or without `;`), `&colon;`, `&tab;`, `&newline;` and `&amp;` are resolved and every control character and whitespace character is removed. The text before the first `:` is a scheme only when it holds no `/`, `?` or `#` and is a letter followed by letters, digits, `+`, `.` or `-`. Dropped: `javascript:alert(1)`, `java&#09;script:alert(1)`, `JaVaScRiPt:x`, `&#x6A;avascript:x`, `&#106avascript:x`, `" java\nscript:x"`, `javascript&colon;x`, `vbscript:x`, `ftp://x`, `data:text/html,<script>x</script>` (in `src`). Kept: `https://example.com`, `/relative#frag`, `mailto:a@b.c`, `tel:1`, `/a:b`, `?a:b`, `1a:b`.
- **B27.** `script`, `style`, `template`, `noscript`, `iframe`, `object`, `embed`, `applet`, `frame` and `frameset` are dropped with their contents. One that is never closed drops everything to the end. Ex: `"<p>a<script>bad()</script>b</p>"` gives `"<p>ab</p>"`; `"<p>a<script>b"` gives `"<p>a</p>"`.
- **B28.** Comments, `<!...>` declarations and `<?...>` instructions are dropped. A comment that is never closed drops everything to the end. Ex: `"<p>a<!-- secret -->b</p>"` gives `"<p>ab</p>"`; `"<!DOCTYPE html><p>x</p>"` gives `"<p>x</p>"`.
- **B29.** Tag and attribute names are lowercased, `b` becomes `strong` and `i` becomes `em`, attributes are sorted by name, and each is written `name="value"` with the value escaped as in B17. An attribute with no value is written `=""`. Ex: `"<P>a <B>b</B> <I>c</I></P>"` gives `"<p>a <strong>b</strong> <em>c</em></p>"`; `'<a href="/x" id="y" title="z">t</a>'` and `'<a title="z" href="/x" id="y">t</a>'` give the same string; `"<input disabled>"` gives `'<input disabled="">'`; `"<p title='a\"b&c'>t</p>"` gives `'<p title="a&quot;b&amp;c">t</p>'`.
- **B30.** The void elements of B19 are written with no end tag, and `/>` on one is written as `>`. Ex: `"<p>a<br/>b<img src=x.png alt='z'/></p>"` gives `'<p>a<br>b<img alt="z" src="x.png"></p>'`.
- **B31.** `/>` on an element that is not void opens it, as a browser does, so the output stays balanced (deliberate difference D6). Ex: `"<p>a<span/>b</p>"` gives `"<p>a<span>b</span></p>"`.
- **B32.** The output is balanced. Elements left open are closed at the end, innermost first. An end tag closes every element opened inside the one it matches. An end tag that matches no open element is ignored. Ex: `"<p>a<em>b"` gives `"<p>a<em>b</em></p>"`; `"<p><em>a</p>b"` gives `"<p><em>a</em></p>b"`; `"<p>a</em>b</p>"` gives `"<p>ab</p>"`.
- **B33.** An element whose `style` states a not-bold weight (B21) is wrapped in `<not-bold>`, and one whose `style` states `font-style: normal` is wrapped in `<not-italic>`; with both, `not-bold` is outside `not-italic`. The last declaration of a property in the style wins. A `span` left with no attributes after cleaning becomes the marker alone; any other element, or a `span` that keeps an attribute, stays inside the marker. A style saying the opposite (`font-weight: bold`, `700`) is simply dropped. Ex: `'Runners come back <span style="font-weight: normal;">too fast</span> after a layoff.'` gives `"Runners come back <not-bold>too fast</not-bold> after a layoff."`; `'<span style="font-style: normal;">x</span>'` gives `"<not-italic>x</not-italic>"`; `'<span style="font-weight:normal;font-style:normal">x</span>'` gives `"<not-bold><not-italic>x</not-italic></not-bold>"`; `'<span style="font-weight:400">x</span>'` gives `"<not-bold>x</not-bold>"`; `'<span style="font-weight:700">x</span>'` and `'<span style="font-weight: bold;">x</span>'` give `"<span>x</span>"`; `'<span style="font-weight:bold;font-weight:normal">x</span>'` gives `"<not-bold>x</not-bold>"`; `'<span class="k" style="font-weight:normal">x</span>'` gives `'<not-bold><span class="k">x</span></not-bold>'`; `'<em style="font-weight:normal">x</em>'` gives `"<not-bold><em>x</em></not-bold>"`; `'<b style="font-weight:normal">x</b>'` gives `"<not-bold><strong>x</strong></not-bold>"`; `'<span style="font-weight:normal">a<b>b</b>c</span>'` gives `"<not-bold>a<strong>b</strong>c</not-bold>"`. No output ever holds `style=`.
- **B34.** Text is composed to NFC, loses the characters of B2, and loses the controls of B3. Outside `pre` and `textarea`: `&nbsp;` (any case), `&#160;`, `&#xa0;` (hex in any case, deliberate difference D7) and U+00A0 become a space, and every run of whitespace or Unicode space becomes one space. Inside `pre` and `textarea` text is kept as written. Other character references are kept as written, and a `<` that does not start a tag (B12) is kept as text. The result is trimmed. Ex: `"<p>a    b</p>"` gives `"<p>a b</p>"`; `"<pre>a    b</pre>"` is unchanged; `"<pre>a  <b>b   c</b>\n d</pre>"` gives `"<pre>a  <strong>b   c</strong>\n d</pre>"`; `"<p>a&nbsp;b&#160;c&#xA0;d\u00A0e</p>"` gives `"<p>a b c d e</p>"`; `"<p>Fish &amp; chips &lt;3</p>"` is unchanged; `"<p>a < b</p>"` is unchanged; `"1 <2 and <3"` is unchanged (D5); `"  <p> a </p>  "` gives `"<p> a </p>"`; `""` gives `""`.
- **B35.** With `{ keepWhitespace: true }`, no whitespace is folded, no nbsp spelling is changed, and nothing is trimmed; everything else above still holds. Ex: `"Text him "` and `" Devon"` are unchanged; `"a&nbsp;&nbsp;b&nbsp;"` is unchanged; `'Text <b onclick="x()">him</b> <script>bad()</script>'` gives `"Text <strong>him</strong> "`. Without the option, `"Text him "` gives `"Text him"` and `"a&nbsp;&nbsp;b"` gives `"a b"`.
- **B36.** `cleanMarkup(cleanMarkup(x)) === cleanMarkup(x)`, including for attribute values that hold `&`, `"`, `<` or `>` (deliberate difference D8). Ex: `'<P CLASS="x lahe-h" style="color:red">Hi <B>b</B><span data-lahe="chrome">c</span></P>'`; `'<a href="/a?x=1&amp;y=2">t</a>'` gives itself; `'<a title="a&quot;b">t</a>'` gives itself.
- **B37.** Two markups that differ only in attribute order, tag letter case, `b`/`strong` or `i`/`em` spelling, or incidental whitespace clean to the same string; markup that adds bold does not. Ex: `"<p>the <b>word</b></p>"` and `"<p>the <strong>word</strong></p>"` clean equal; `"<p>the word</p>"` and `"<p>the <strong>word</strong></p>"` do not.

### `embedded-value.ts`

- **B38.** `isEmbeddedValue(value)` is true when the value, after any leading whitespace, starts with `data:` in any letter case. Ex: `" DATA:x"` is true; `"https://x/y.png"` is false.
- **B39.** `embeddedName(value)` returns a value that is not embedded unchanged. For an embedded value it returns `embedded:<media>:<length>:<digest>`, where leading whitespace is removed first, `<media>` is the text between `data:` and the first comma (empty when there is no comma), `<length>` is the value's length in UTF-16 code units, and `<digest>` is 16 lowercase hex characters. Element signatures stored in records hold these names, so the values are pinned: `"data:image/png;base64,AAAA"` and `"  data:image/png;base64,AAAA"` give `"embedded:image/png;base64:26:21d9003773dfa10b"`; `"data:abc"` gives `"embedded::8:a0ce84f82dbf3642"`; `"data:,x"` gives `"embedded::7:03e93c54159aab40"`; `"data:image/svg+xml,<svg/>"` gives `"embedded:image/svg+xml:25:4c06c0ac12134308"`.

### `block-text.ts`

- **B40.** `blockText(html)` cleans the markup (B23 to B34), then reads its text: a `br` is one LF, the start and the end of a `BLOCK_TAGS` element are each a blank line, and every other tag contributes nothing. The result is normalized as in B8, with whitespace inside `pre` and `textarea` kept as written. Ex: `"Hello<p>&nbsp;world.</p>"` gives `"Hello\n\nworld."`; `"Hello<br>&nbsp;world."` gives `"Hello\nworld."`; `"Hello world.<p>Second para.</p>"` gives `"Hello world.\n\nSecond para."`; `"<p>a</p><p>b</p>"` gives `"a\n\nb"`; `"<ul><li>one</li><li>two</li></ul>"` gives `"one\n\ntwo"`; `"<table><tr><td>a</td><td>b</td></tr></table>"` gives `"a\n\nb"`; `"a<hr>b"` gives `"a\n\nb"`; `"a<br><br><br>b"` gives `"a\n\nb"`.
- **B41.** In `blockText`, whitespace the source carries is incidental and folds; a break the markup states does not. Ex: `"<p>Hello\n   world.</p>"`, `"<p>Hello    world.</p>"` and `"<p>Hello\nworld.</p>"` all give `"Hello world."`; `"<p>Hello<br>world.</p>"` differs from `"<p>Hello world.</p>"`; plain `"a\nb"` gives `"a b"`.
- **B42.** `blockText("<pre>line one\n   indented</pre>")` gives `"line one\n   indented"`.
- **B43.** In `blockText`, tool chrome, dropped elements and comments contribute nothing, and the reset markers contribute no words and no break. Character references other than the nbsp spellings stay as written. Ex: `"a <not-bold>b</not-bold> c"` gives `"a b c"`; `'a<span data-lahe="chrome">x</span>b'` gives `"ab"`; `"a<script>x</script>b"` gives `"ab"`; `"a<!-- x -->b"` gives `"ab"`; `"Fish &amp; chips"` gives `"Fish &amp; chips"`.
- **B44.** `textOf(value)` reads text that may be plain text or markup, without cleaning it first: an LF already in the string is a break and survives; each tag contributes the break B40 gives it; the contents of `DROP_SUBTREE_TAGS` elements are removed (tool chrome is not); the nbsp spellings become a space; other character references stay as written; whitespace inside `pre` and `textarea` is kept; the result is normalized as in B8. Ex: `"a\nb"` gives `"a\nb"`; `"<p>a\nb</p>"` gives `"a\nb"`; `"a <not-bold>b</not-bold> c"` gives `"a b c"`; `"a<script>x</script>b"` gives `"ab"`; `"a&nbsp;&nbsp;b"` gives `"a b"`; `"a &amp; b"` gives `"a &amp; b"`; `"<pre>a   b\n  c</pre>"` gives `"a   b\n  c"`; `'a<span data-lahe="chrome">x</span>b'` gives `"axb"`.
- **B45.** `blockTextFromNode(node, { skip })` reads a live node the way `blockText` reads markup. A text or CDATA node (`nodeType` 3 or 4) contributes its `data`, or its `nodeValue` when it has no `data`; outside `pre` and `textarea` its whitespace folds to single spaces. An element (`nodeType` 1) for which `skip` returns true contributes nothing; `skip` defaults to the markers' tool-node test (chrome or wrap). A `DROP_SUBTREE_TAGS` element contributes nothing, a `br` is one LF, a `BLOCK_TAGS` element is a blank line before and after its children, and the tag name is read case-insensitively from `tagName`. A document or fragment node (9 or 11) contributes its children; any other node contributes nothing. The result is normalized as in B8, with `pre` and `textarea` whitespace kept. Ex (fake nodes): `p["Hello", p[" world."]]` gives `"Hello\n\nworld."`; `p["Hello\n   world."]` gives `"Hello world."`; `div[p["Hello"], p["world."]]` gives `"Hello\n\nworld."`; a `p` holding a chrome `span["x"]` then text `"y"` gives `"y"`; `pre["a  b\n c"]` gives `"a  b\n c"`; `div[script["x"], "y"]` gives `"y"`; a fragment holding `"a  b"` gives `"a b"`; a comment node gives `""`; with `skip` true for every `SPAN`, `p[span["x"], "y"]` gives `"y"`.
- **B46.** For markup whose text holds no `&`, `<` or `>`, `blockTextFromNode` of the parsed node equals `blockText` of the markup. Ex: `p["Hello", p[" world."]]` equals `blockText("Hello<p>&nbsp;world.</p>")`; `p["Hello", br, " world."]` equals `blockText("Hello<br>&nbsp;world.")`.
- **B47.** `topLevelBlocks(html)` cleans the markup, then cuts it at its top level only: a `BLOCK_TAGS` element that is not void is one piece, and its inner markup is what comes back; a `br` or `hr` ends the loose inline run before it; loose inline content between those is one piece. Pieces are trimmed and whitespace-only pieces are dropped. Nothing nested is cut. It returns `null` when any piece holds markup but no words, and `[]` for empty input. Ex: `'One <b>bold</b>.<p>Two.</p><p>Three <a href="https://e.com">x</a>.</p>'` gives `["One <strong>bold</strong>.", "Two.", 'Three <a href="https://e.com">x</a>.']`; `"One.<br><br>Two <em>it</em>."` gives `["One.", "Two <em>it</em>."]`; `"<p>One.</p>\n  <p>Two.</p>"` gives `["One.", "Two."]`; `"<strong>One.<p>Two.</p></strong>"` gives `["<strong>One.<p>Two.</p></strong>"]`; `"<div><p>a</p><p>b</p></div>"` gives `["<p>a</p><p>b</p>"]`; `'One.<p><img src="a.png"></p>'` gives `null`; `"a<hr>b"` gives `["a", "b"]`; `"<br><br>"` gives `[]`.

### `comparison.ts`

- **B48.** `COMPARISON_MODE` is `{ TEXT: "text", STRUCTURE: "structure" }`. `modeFor("format_only")` is `"structure"`; `modeFor` of any other string (`"edit"`, `"comment"`) is `"text"`.
- **B49.** `structureOf(html)` cleans the markup and keeps only the four structural tags, written bare (`<strong>`, `</strong>`) around the words they cover. Every other tag is removed, and one that carries a break leaves a space so the words beside it stay apart. All whitespace, `pre` included, folds as in `normalizeText`. Ex: `"<p>a <b>b</b> <span>c</span><br>d</p><p>e <i>f</i></p>"` gives `"a <strong>b</strong> c d e <em>f</em>"`; the unbolded sentence of B33 gives `"Runners come back <not-bold>too fast</not-bold> after a layoff."`; `"<pre>a   <b>b</b></pre>"` gives `"a <strong>b</strong>"`.
- **B50.** `equalsInMode("text", a, b)` is `textOf(a) === textOf(b)`. Ex: `"Hello world."` and `"Hello\n\nworld."` differ; `"<p>Hello world.</p>"` and `"Hello world."` are equal; `"<p>Hello <strong>world.</strong></p>"` and `"Hello world."` are equal.
- **B51.** `equalsInMode("structure", a, b)` is `structureOf(a) === structureOf(b)`. Ex: `"<p>a <span class=x>b</span> c</p>"` and `"<p>a b c</p>"` are equal; `"<p>a <b>b</b> c</p>"` and `"<p>a <strong>b</strong> c</p>"` are equal; `"<p>a <b>b</b> c</p>"` and `"<p>a <em>b</em> c</p>"` differ; `"<p><strong>a</strong> b</p>"` and `"<p>a <strong>b</strong></p>"` differ.
- **B52.** The modes disagree on a text-equal, structure-different pair and agree on a pair equal both ways. Ex: `"<p>The plan is ready now</p>"` and `"<p>The plan is <strong>ready</strong> now</p>"` are equal in text and different in structure; `"<p>The plan is <em>ready</em> now</p>"` and `"<p>The   plan is <i>ready</i> now</p>"` are equal in both. A plain sentence and its unbolded form (B33) are equal in text after `blockText` and different in structure.
- **B53.** `emphasisRuns(html)` lists the runs of the four structural tags in `structureOf(html)`, as `{ tag, text }` with `text` normalized as in B1. A run is listed when it closes, so the list is in order of closing. A run inside another is listed once per tag, the inner first. A run with no words is left out. Runs still open at the end are listed after the rest, innermost first. Ex: `"a <em>b</em> c"` gives `[{tag:"em",text:"b"}]`; `"a <b>b c</b> d"` gives `[{tag:"strong",text:"b c"}]`; `"<strong><em>x</em></strong>"` gives `[{tag:"em",text:"x"},{tag:"strong",text:"x"}]`; `"a <not-bold>b</not-bold> c"` gives `[{tag:"not-bold",text:"b"}]`; `'<p class="lead"><a href="https://example.com">a</a> <code>b</code></p>'` gives `[]`; `"a <em> </em>b"` gives `[]`; `"<em>a <em>b</em> c</em>"` gives `[{tag:"em",text:"b"},{tag:"em",text:"a b c"}]`; `"<em>a <strong>b"` gives `[{tag:"strong",text:"b"},{tag:"em",text:"a b"}]`.

### `run-blocks.ts`

- **B54.** `WRITABLE_BLOCK_TAGS` is `["p", "h2", "h3", "h4", "ul", "ol"]`; `isWritableBlockTag` is true for exactly those.
- **B55.** `inlineTagFor(name)` gives `"strong"` for `strong` and `b`, `"em"` for `em` and `i`, `"not-bold"` and `"not-italic"` for themselves, and `null` for every other name.
- **B56.** `MAX_BLOCK_NESTING` is 32.
- **B57.** `cleanBlock(tag, html)` takes untrusted input. It returns either `{ html }` or a refusal `{ code: "RUN_BLOCK_REFUSED", reason }`. A refusal has no `html`, and its code is one of the contract's failure codes.
- **B58.** The tag matches in any letter case. A tag that is not one of the six is refused with `"tag " + String(tag) + " is not writable"` (Ex: `"script"`, `"iframe"`, `"div"`, `"h1"`, and `5` giving `"tag 5 is not writable"`). An `html` that is not a string is refused with `"html must be a string"`.
- **B59.** These are refused with exactly these reasons:
  - any element other than `strong`, `b`, `em`, `i`, `not-bold`, `not-italic`, `br` and `li`: `"element <name> is not allowed in a block"` (Ex: `script`, `iframe`, `svg`, `img`, `a`, `span`, `strongx`, and `p` or a nested `ul` inside a list block);
  - an `li` in a `p` or heading block: `"li inside a <tag> block"` (Ex: `"li inside a h2 block"`);
  - an `li` inside an `li`: `"a nested item"`;
  - words directly in a list block: `"words outside an item in a list block"`;
  - a `br` directly in a list block: `"a break outside an item in a list block"`;
  - formatting directly in a list block: `"formatting outside an item in a list block"`;
  - a comment, `<!...>` or `<?...>`: `"a comment or declaration in a block"`;
  - more than 32 levels of nesting, `li` included: `"nesting deeper than 32"`;
  - a block with no words (`""`, `"   <br>"`): `"a block with no words"`;
  - a list block whose items hold no words (`"<li></li><li> </li>"`): `"a list block with no words"`.
- **B60.** An accepted block is rebuilt from constants: only `strong`, `em`, `not-bold`, `not-italic`, `br`, and (in a list block, as its direct children) `li`, with names written as `inlineTagFor` gives them and every attribute dropped. Ex: `("p", 'A <strong class="x" onclick="alert(1)" data-lahe-id="s1">bold</strong> <em style="color:red">word</em>')` gives `"A <strong>bold</strong> <em>word</em>"`; `("p", "<b>x</b> <i>y</i>")` gives `"<strong>x</strong> <em>y</em>"`; `("p", "<not-bold>x</not-bold> y")` is unchanged; `("P", "<STRONG>x</STRONG> <Em>y</Em>")` gives `"<strong>x</strong> <em>y</em>"`; `("H2", "x")` gives `"x"`.
- **B61.** Text is decoded (B16), composed to NFC, loses the characters of B2 and the controls of B3, has tab, LF and CR turned into spaces (deliberate difference D9), has every Unicode space turned into a space and every run of spaces into one, and is escaped again on output (`&`, `<`, `>`). A reference `decodeEntities` leaves alone comes out as literal text. Ex: `"Fish &amp; chips &lt;3"` is unchanged; `"a < b and c > d"` gives `"a &lt; b and c &gt; d"`; `"&lt;script&gt;alert(1)&lt;/script&gt;"` is unchanged; `"Two&nbsp;words  and\n a space&nbsp;"` gives `"Two words and a space"`; `"x\ny"` gives `"x y"`; `"a &bogus; b"` gives `"a &amp;bogus; b"`.
- **B62.** Tidying: space at the start and end of the block (or of each item) goes, reaching into the first and last element; breaks at the start go; trailing breaks go and a middle one stays; an element with no words goes, and the text either side of it joins with single spaces; an item with no words goes; an end tag closes the nearest open element of its written name (`</b>` closes `<strong>`); a stray end tag is ignored; anything left open is closed. Ex: `"Line one<br>Line two<br>"` gives `"Line one<br>Line two"`; `("ul", "<li>One</li>\n<li></li><li>Two <b>b</b></li>")` gives `"<li>One</li><li>Two <strong>b</strong></li>"`; `"<em> a</em>"` gives `"<em>a</em>"`; `"a <em></em> b"` gives `"a b"`; `"<strong>a</b>c"` gives `"<strong>a</strong>c"`; `"a</em>b"` gives `"ab"`; `"a<em>b"` gives `"a<em>b</em>"`; `"<br>a"` gives `"a"`.
- **B63.** Over the engine corpus (section 5 note), every sample cleans, cleaning the output again returns it unchanged, and `blockWords` of the output equals `blockWords` of the sample.
- **B64.** Hostile input costs linear time: a 1 MiB block of `<em>` repeated, then a word, then `</b>` repeated, is refused in under 500 ms; 50,000 repeats of `a<em></em>` clean to 50,000 `a` in under 500 ms. 33 levels of `<em>` in a `p`, and 33 of `<strong>` inside an `li`, are refused, not thrown; 31 levels of `<em>` inside an `li` clean, and `blockWords` of the result is `"deep words"`.
- **B65.** `blockWords(html)` is `foldTypography(decodeEntities(textOf(html)))`, and `""` for `null` or `undefined`. Ex: `"It\u2019s \u201Cdone\u201D \u2014 now"` gives `"It's \"done\" - now"`; `"Fish &amp; chips &quot;x&quot;"` gives `"Fish & chips \"x\""`; `"She said no -- then left"` and `"She said no &#8212; then left"` give the same words; `"<p>a \u2014 b</p>"` gives `"a - b"`; `"<p>A <b>x</b></p><p>y</p>"` gives `"A x y"`.
- **B66.** `runWords(blocks)` counts the words of `normalizeText(decodeEntities(textOf(block.html)))` over every block whose `from_anchor` is not `true`. `undefined` and `[]` give 0. Ex: a run of a `from_anchor` block `"moved tail words here"`, `"A <strong>new</strong> heading"` and `"<li>one two</li><li>three</li>"` gives 6; `[{ html: "a &amp; b" }]` gives 3.

### `run-match.ts`

- **B67.** `SHORT_BLOCK_WORDS` is 5 and `RUN_WALK_SLACK` is 2.
- **B68.** `leafBlocks(html)` builds a tree from the markup the way a browser repairs it, for these cases: comments and `<!...>` or `<?...>` are skipped (an unclosed comment runs to the end); an end tag closes the nearest open element of that name and is ignored when there is none; the start of any of `address article aside blockquote details div dl fieldset figcaption figure footer form h1 h2 h3 h4 h5 h6 header hgroup hr main nav ol p pre section table ul li dd dt summary` closes an open `p`; an `li` closes the nearest open `li` unless a `ul` or `ol` is nearer; void and self-closed elements take no children; the contents of `script`, `style`, `textarea`, `title`, `xmp` and `noscript` are text up to the next `</name` in any case, or to the end. Ex (the malformed corpus): `"<p>First words here<div>Then a div block</div>"` gives `p: First words here` then `div: Then a div block`; `"<ul><li>One item<li>Two item</ul><p>After the list</p>"` gives `ul: One item Two item` then `p: After the list`; a `script` holding `"<p>not a block</p>"` between two paragraphs gives only the two paragraphs; `template` contents give nothing; comments, including one holding a `<p>`, give nothing; `"<p>a<p>b"` gives two `p` leaves.
- **B69.** The leaves come back in document order. A leaf is a `BLOCK_TAGS` element that is a `ul` or `ol`, or has no `BLOCK_TAGS` element inside it. These elements, with everything inside them, are skipped and never decide whether their parent is a leaf: `DROP_SUBTREE_TAGS` elements, `head`, tool chrome, and the element whose `id` is `lahe-surface-root`. The file-name title (`data-lahe-file-title="file-name"`) is skipped too, but still counts as a block inside its parent, so a hero holding only the title is not a leaf. Loose text in a block that holds blocks is never a leaf. A leaf with no words is left out. Ex: the Markdown render fixture `md_render.html` gives exactly `h1: Spike doc`, `p: A short lede that sits in the hero.`, `h2: What changed`, `p: We stopped measuring motion and started measuring outcomes.`, `p: A second paragraph in the first section.`, `h2: What comes next`, `ul: Fewer meetings Longer blocks`; `empty_notes.html` gives `[]`; `"<p></p><div><p> </p></div><p>Words</p><h2><br></h2>"` gives only `p: Words`; `'<p>Page words</p><div data-lahe="chrome"><p>Rail words</p></div>'` gives only `p: Page words`; `'<div id="lahe-surface-root"><p>rail</p></div><p>x</p>'` gives only `p: x`; `"<blockquote><p>a</p>loose</blockquote>"` gives only `p: a`.
- **B70.** Each leaf is `{ tag, html, words }`: the lowercase tag, `cleanMarkup` of the leaf's inner markup, and `blockWords` of that. Attribute values are not escaped twice (D8). Ex: `"<ul><li>One</li><li>Two <strong>b</strong></li></ul>"` gives one leaf `{ tag: "ul", html: "<li>One</li><li>Two <strong>b</strong></li>", words: "One Two b" }`; `'<p class="x">A <b>bold</b> word</p>'` gives html `"A <strong>bold</strong> word"`; `'<p><a href="/x" title="a&quot;b">l</a></p>'` gives html `'<a href="/x" title="a&quot;b">l</a>'`.
- **B71.** `matchRun(blocks, leaves)` compares words only: an entry's `words` when it has them, otherwise `blockWords(entry.html)`. Tag and markup never decide presence. It returns one result per block, in block order, `{ index, status, leaves }`. A block is `"whole"` when a leaf's words equal its words; `"joined"` when a leaf's words equal it and the next one or more blocks joined by spaces (each of those blocks gets the same one-leaf result); `"split"` when it equals two or more consecutive leaves joined by spaces (it lists them all); otherwise `"missing"` with `leaves: []`. A block with no words is always missing.
- **B72.** The walk starts at the first leaf and the first block. At each leaf it tries the remaining blocks in order, and the first that matches wins; blocks it passed over are missing. Leaves that match no remaining block are skipped only until the first match; after a match, the first such leaf ends the walk. The walk reads at most `blocks.length + RUN_WALK_SLACK` leaves, and a split never reaches past that limit.
- **B73.** Ex: `["Hello there friend"]` against `<p>Hello there friend</p>` gives `[{index:0,status:"whole",leaves:[0]}]`; two blocks in one leaf give `joined, [0]` for both; one block over two leaves gives `split, [0,1]`; blocks Alpha, Beta, Gamma against leaves Alpha, Gamma give `whole [0]`, `missing []`, `whole [1]`; an `h2` of `<strong>What it cost me</strong>` and a `ul` of `scrolling` and `re-asking` against two `p` leaves of the same words are both whole; `"Target words"` after an unrelated leaf is `whole [1]`; `"Notes"` against one leaf `"These Notes are about something else entirely"` is missing; blocks Alpha, Beta against leaves Beta, Alpha give `missing`, `whole`; `"The first words"` against `"The first words and then a lot more"` is missing; Alpha, Beta against Alpha, Unrelated, Beta give `whole`, `missing`; `"Target words"` as the fourth leaf, after three unrelated ones, is missing; `"She said no -- then left"` against `"She said no \u2014 then left"` is `whole [0]`; `{words}`-only entries match the same way.
- **B74.** `runClash(blocks, leaves)` finds the first run of missing blocks (by B71 to B72) whose words sit inside the one leaf where they would go, together with other words. That leaf is the one right after the last leaf the previous found block used, or the first leaf when no block before them was found. It must be inside the walk limit and not used by a found block. "Inside" means the block's words appear in the leaf's words as whole words (no letter or digit, in any script, directly before or after) and the leaf has more words than that. When the leaf is the first leaf, a block of fewer than `SHORT_BLOCK_WORDS` words is not a clash. Consecutive missing blocks that sit inside that leaf together, joined by spaces, make one clash. It returns `{ index, blocks, leaf }` for the first clash, or `null`.
- **B75.** Ex: Alpha, Beta against `"Alpha words here"`, `"Beta words here. The agent added this."` gives `{index:1,blocks:1,leaf:1}`; `"Alpha words here and there"` against `"Before it, Alpha words here and there"` gives `{index:0,blocks:1,leaf:0}`; `h3 "Next"` then a long block against `"Next, we tested the build on Windows."` gives `null`; `"Yes"` against `"Yes, that is the plan we agreed."` gives `null`; Alpha, `"Yes"` against Alpha, `"Yes, and the agent added this."` gives `{index:1,blocks:1,leaf:1}`; Alpha, Beta, Gamma against Alpha, `"Beta words here Gamma words here and more"` gives `{index:1,blocks:2,leaf:1}`; an exact join, a split and a whole block each give `null`; Alpha, Beta against Alpha, `"Something else entirely"` gives `null`; Alpha, `"Beta"` against Alpha, `"Betamax tapes"` gives `null`; `"Notes"` against `"Unrelated first"`, `"These Notes are about something else"` gives `null`.

### `target-slug.ts`

- **B76.** `targetSlug(canonical)` takes the last non-empty `/` segment of the text before the first `?` (or `"target"` when there is none), lowercases it, turns every run of characters outside `[a-z0-9]` into `-`, trims `-` from both ends, cuts it to `SLUG_MAX` characters, trims `-` again, and gives `"target"` when nothing is left. Review file names are built from it, so these are pinned: `"/Users/x/docs/02_architecture.html"` gives `"02-architecture-html"`; `"http://localhost:3000/a/b?x=1"` gives `"b"`; `"/"` and `""` give `"target"`; `"/\u00C9.html"` gives `"html"`; a 60-character segment gives its first 40. For `"http://localhost:3000/a/../../etc/passwd"`, `"/tmp/../../../etc/passwd"`, `"http://localhost:3000/%2e%2e%2f%2e%2e"` and `"/a/b/..%2f..%2fCLAUDE.md"` the result matches `^[a-z0-9-]+$`, holds no `/`, is not `.` or `..`, and is at most 40 long.
- **B77.** `SLUG_MAX` is 40.

### The bridges (until F1)

- **B78.** `require("src/shared/normalize.js")` returns one plain, writable object holding every export of the ten modules under the names in section 4. A test may replace one of its functions and a still-JavaScript caller that `require`d the same path sees the replacement (`replay_pass.test.js`, "split review 4", depends on this).
- **B79.** In the built bundle, `window.LAHE.normalize` holds the same names before any file that reads it runs. The browser specs read `blockTextFromNode`, `blockWords` and `cleanMarkup` there.

## 3. Callers

Found with `usage.py` over `src/`, `scripts/` and `test/`. "Breaks" means the caller must change in this slice.

| Caller | Owner slice | Uses | Breaks? |
| --- | --- | --- | --- |
| `src/layer/anchor.js` | B3 | `normalizeText`, `blockTextFromNode`, `embeddedName`, `isEmbeddedValue`, `escapeAttrValue`, `BLOCK_TAGS` | **yes**: `BLOCK_TAGS` lookup at 2118 |
| `src/layer/blocks.js` | B1 | `cleanBlock`, `cleanMarkup`, `blockWords`, `leafBlocks`, `matchRun`, `runClash`, `WRITABLE_BLOCK_TAGS`, `BLOCK_TAGS`, `DROP_SUBTREE_TAGS`, `NOT_BOLD_TAG`, `NOT_ITALIC_TAG` | **yes**: `BLOCK_TAGS` at 37, 79, 86, 142, 181; `DROP_SUBTREE_TAGS` at 67 |
| `src/layer/comments.js` | B10 | `normalizeText`, `blockTextFromNode`, `BLOCK_TAGS` | **yes**: 409 |
| `src/layer/editing.js` | B11 | `normalizeText`, `blockText`, `blockTextFromNode`, `cleanMarkup`, `cleanBlock`, `equalsInMode`, `MODE`, `firstWords`, `BLOCK_TAGS`, `INLINE_ALLOWED`, `LINE_BREAK`, `PARAGRAPH_BREAK`, `RESET_TAGS`, `isNotBoldWeight`, `isNotItalicStyle` | **yes**: `MODE` at 630, 632, 1333, 1335; `BLOCK_TAGS` at 1460, 3028; `INLINE_ALLOWED` at 1237 and 1238 |
| `src/layer/replay.js` | B5 | `normalizeText`, `normalizeBlockText`, `foldTypography`, `blockText`, `blockTextFromNode`, `textOf`, `topLevelBlocks`, `cleanMarkup`, `cleanBlock`, `blockWords`, `decodeEntities`, `emphasisRuns`, `equalsInMode`, `MODE`, `firstWords`, `BLOCK_TAGS`, `WRITABLE_BLOCK_TAGS`, `SHORT_BLOCK_WORDS`, `NOT_BOLD_TAG`, `NOT_ITALIC_TAG` | **yes**: `MODE` at 1009, 1186; `BLOCK_TAGS` at 1163 |
| `src/layer/overlay.js` | B6 | `normalizeText`, `textOf`, `emphasisRuns`, `firstWords` | no |
| `src/layer/tab_edits.js` | B7 | `normalizeText`, `blockText`, `structureOf`, `NOT_BOLD_TAG`, `NOT_ITALIC_TAG` | no |
| `src/layer/highlight.js` | B4 | `normalizeText`, `NOT_BOLD_TAG`, `NOT_ITALIC_TAG` | no |
| `src/layer/protect.js` | B5 | `cleanMarkup` (with `keepWhitespace`) | no |
| `src/layer/pointing.js`, `selection.js`, `sync.js` | B4, B1, B9 | `normalizeText` | no |
| `src/layer/index.js` | B12 | through `src/shared/contracts.js` (Node branch only) | no |
| `src/shared/record.js` | C3 | `normalizeText`, `cleanMarkup`, `cleanBlock`, `blockText`, `blockWords`, `textOf`, `emphasisRuns`, `embeddedName`, `escapeAttrValue`, `modeFor`, `WRITABLE_BLOCK_TAGS`, `NOT_BOLD_TAG`, `NOT_ITALIC_TAG` | no |
| `src/shared/review_format.js` | C5 | `runWords`, `decodeEntities` | no |
| `src/shared/regions.js`, `uniqueness.js` | C5 | `normalizeText` | no |
| `src/shared/contracts.js` | C5 | re-exports the whole module as `normalize` | no |
| `src/shared/manifest.js` | F1 | lists the file at bundle position 2 | **yes**: its own entry (section 10) |
| `src/service/handled_check.js` | SV4 | `foldTypography`, `textOf`, `blockWords`, `leafBlocks`, `matchRun`, `emphasisRuns`, `PARAGRAPH_BREAK`, `SHORT_BLOCK_WORDS`, `RUN_WALK_SLACK` | no |
| `src/service/review_writer.js` | SV2 | `targetSlug` | no |
| `src/cli/commands/status.js` | CLI | `normalizeText` | no |
| `scripts/measure_clean_block_cost.js` | T3 | `cleanBlock` | no |
| `test/unit/normalize.test.js`, `clean_block.test.js`, `leaf_blocks.test.js` | C2 | most exports, `canonicalTarget`, `markupEquals` | **yes**: moved and rewritten (section 5) |
| `test/unit/replay_pass.test.js` | T1 | replaces `blockTextFromNode` on the required object | **yes, unless** the forwarder is a plain object (B78) |
| `test/unit/replay_run.test.js` | T1 | `firstWords` | no |
| `test/unit/editing_surface.test.js` | T1 | `blockText`, `cleanMarkup`, `NOT_BOLD_TAG`, `NOT_ITALIC_TAG`, `STRUCTURAL_TAGS` | no |
| `test/unit/comments_surface.test.js` | T1 | `NOT_BOLD_TAG`, `NOT_ITALIC_TAG` | no |
| `test/unit/sanity.test.js` | C5 | loads `contracts.js` | no |
| `test/browser/support/export_stub.js` | none listed | reads `normalize.js` **source text** into the page | **yes** (section 8) |
| `test/browser/blocks_kernel.spec.js`, `anchor_engine.spec.js`, `best_guess_speed.spec.js`, `support/protect_page.js` | S0c | load `src/shared/normalize.js` by path into the page | yes, unless S0c has moved them to the bundle helper |
| `test/browser/blocks_kernel.spec.js`, `paragraph_break.spec.js` | none | `window.LAHE.normalize.cleanMarkup`, `.blockWords`, `.blockTextFromNode` | no, through B79 |
| `test/browser/support/scripted_agent.js` | T2 | `foldTypography` (Node `require`) | no |

Exports no caller uses outside the old tests: `canonicalTarget`, `isLoopbackHost`, `markupEquals`, `stripControls`, `stripAllControls`, `textEquals`, `breakForTag`, `blockTextEquals`, `MODES`, `structureEquals`, `isSafeUrlValue`, `digestOf`, `SAFE_SCHEMES`, `RUN_BLOCK_REFUSED`. `canonicalTarget` and `markupEquals` appear only in `normalize.test.js`; the rest appear nowhere.

## 4. Module design

Every module is in `src/domain/`, imports only `src/contract/` and its siblings, uses named exports only, and has no `enum`, `namespace`, parameter property, default export or top-level `await`. Literal tables are `as const`, with the union derived from the table and a type guard beside it, so no caller checks membership with a string comparison or `hasOwnProperty`. Under `isolatedDeclarations` an exported constant that refers to another constant needs its type spelled out; the compiler says which.

Names marked "domain-internal" exist for sibling modules. Nothing outside `src/domain/` should import them; the forwarder carries them, harmlessly.

### `text.ts`

```ts
export const LINE_BREAK = "\n";
export const PARAGRAPH_BREAK = "\n\n";
export type TextBreak = typeof LINE_BREAK | typeof PARAGRAPH_BREAK;

export function normalizeText(input: string): string;
export function normalizeBlockText(input: string): string;
export function foldTypography(input: string): string;
export function firstWords(text: string | null | undefined, max: number, more?: string): string;

export function cleanCharacters(input: string): string;
export function collapseSpaces(input: string): string;
```

`cleanCharacters` (domain-internal): NFC, then B2's and B3's removals. `collapseSpaces` (domain-internal): every Unicode space and whitespace run to one space, no trim. Both are what `clean-markup`, `block-text` and `run-blocks` share instead of re-spelling the character classes.

### `html-syntax.ts`

```ts
export interface TagAttribute { readonly name: string; readonly value: string }

export type TagToken =
  | { readonly kind: "start"; readonly name: string; readonly attributes: readonly TagAttribute[]; readonly selfClosing: boolean; readonly end: number }
  | { readonly kind: "end"; readonly name: string; readonly end: number };

export function readTag(html: string, at: number): TagToken | null;
export function decodeEntities(text: string): string;
export function escapeAttrValue(value: string): string;

export const BLOCK_TAGS: readonly [/* the 39 names of B18 */];
export type BlockTag = (typeof BLOCK_TAGS)[number];
export function isBlockTag(name: string): name is BlockTag;

export const DROP_SUBTREE_TAGS: readonly ["script", "style", "template", "noscript", "iframe", "object", "embed", "applet", "frame", "frameset"];
export type DroppedSubtreeTag = (typeof DROP_SUBTREE_TAGS)[number];
export function isDroppedSubtreeTag(name: string): name is DroppedSubtreeTag;

export function isVoidTag(name: string): boolean;
export function isWhitespacePreservingTag(name: string): boolean;
```

`readTag` is domain-internal and replaces the old private `parseTag`; it is the one tokenizer every reader in this slice uses. A start and an end tag are a union on `kind`, so no reader can read attributes off an end tag. `isVoidTag` and `isWhitespacePreservingTag` are domain-internal.

### `formatting.ts`

```ts
export const NOT_BOLD_TAG = "not-bold";
export const NOT_ITALIC_TAG = "not-italic";
export const RESET_TAGS: { readonly bold: "not-bold"; readonly italic: "not-italic" };
export type ResetTag = (typeof RESET_TAGS)[keyof typeof RESET_TAGS];
export const STRUCTURAL_TAGS: readonly ["em", "strong", "not-bold", "not-italic"];
export type StructuralTag = (typeof STRUCTURAL_TAGS)[number];
export function isStructuralTag(name: string): name is StructuralTag;
export function isNotBoldWeight(value: string): boolean;
export function isNotItalicStyle(value: string): boolean;
export function resetTagsForStyle(style: string): readonly ResetTag[];
```

`resetTagsForStyle` (domain-internal) gives the markers a style attribute states, outermost first, for `cleanMarkup`.

### `clean-markup.ts`

```ts
export interface CleanMarkupOptions { readonly keepWhitespace?: boolean }
export function cleanMarkup(html: string, options?: CleanMarkupOptions): string;
```

The URL check and the attribute drop list are private. The element stack is a local array of `{ name; emitNames; action: "keep" | "drop" | "unwrap"; preservesWhitespace }`, with `action` a union, not three booleans.

A brand for clean markup (`CleanHtml`) was considered and left out: every caller stores or compares the result as a string, the only check that it is clean is `record.validateRun`'s equality test (C3's), and minting a brand without a cast costs more than it guards here.

### `embedded-value.ts`

```ts
export function isEmbeddedValue(value: string): boolean;
export function embeddedName(value: string): string;
```

The digest is private. Its arithmetic is fixed by B39's pinned values.

### `block-text.ts`

```ts
export interface TextSourceNode {
  readonly nodeType: number;
  readonly firstChild?: TextSourceNode | null;
  readonly nextSibling?: TextSourceNode | null;
  readonly tagName?: string;
  readonly data?: string;
  readonly nodeValue?: string | null;
  readonly getAttribute?: (name: string) => string | null;
}
export interface BlockTextOptions { readonly skip?: (node: TextSourceNode) => boolean }

export function blockText(html: string): string;
export function blockTextFromNode(node: TextSourceNode, options?: BlockTextOptions): string;
export function textOf(value: string): string;
export function topLevelBlocks(html: string): readonly string[] | null;
```

`TextSourceNode` lists only what the reader touches, so a real DOM `Node` and the hand-built fakes in the layer's unit tests both fit without a cast (the architecture's rule for fake DOM objects). Node types are a private `as const` table (`ELEMENT: 1`, `TEXT: 3`, `CDATA: 4`, `DOCUMENT: 9`, `FRAGMENT: 11`). The private-use stand-ins that carry `pre` whitespace across the folding (U+E000 to U+E002) stay private.

### `comparison.ts`

```ts
export const COMPARISON_MODE: { readonly TEXT: "text"; readonly STRUCTURE: "structure" };
export type ComparisonMode = (typeof COMPARISON_MODE)[keyof typeof COMPARISON_MODE];
export function modeFor(kind: string): ComparisonMode;
export function structureOf(html: string): string;
export function equalsInMode(mode: ComparisonMode, a: string, b: string): boolean;

export interface EmphasisRun { readonly tag: StructuralTag; readonly text: string }
export function emphasisRuns(html: string): readonly EmphasisRun[];
```

`equalsInMode` switches over `ComparisonMode` with a case per member and no `default`, so a third mode fails the build where it is unhandled. `modeFor` takes a `string` because the record kinds belong to `contract/record.ts`, which C3 writes after this slice; C3 may narrow it to the record-kind union.

### `run-blocks.ts`

```ts
export const WRITABLE_BLOCK_TAGS: readonly ["p", "h2", "h3", "h4", "ul", "ol"];
export type WritableBlockTag = (typeof WRITABLE_BLOCK_TAGS)[number];
export function isWritableBlockTag(name: string): name is WritableBlockTag;

export type InlineTag = "strong" | "em" | ResetTag;
export function inlineTagFor(name: string): InlineTag | null;

export const MAX_BLOCK_NESTING = 32;

export interface CleanedBlock { readonly html: string }
export interface BlockRefusal { readonly code: Extract<FailureCode, "RUN_BLOCK_REFUSED">; readonly reason: string }
export function cleanBlock(tag: unknown, html: unknown): CleanedBlock | BlockRefusal;

declare const blockWordsBrand: unique symbol;
export type BlockWords = string & { readonly [blockWordsBrand]: true };
export function blockWords(html: string | null | undefined): BlockWords;

export interface RunWordsBlock { readonly html: string; readonly from_anchor?: boolean }
export function runWords(blocks: readonly RunWordsBlock[] | undefined): number;
```

- **`cleanBlock` is the boundary parser of this slice.** It runs on untrusted input at capture, at the helper on append (where `record.validateRun` refuses rather than cleans), and before every page write, so it takes `unknown` and returns a typed result or a typed refusal. Callers tell them apart with `"html" in result`; the result keeps its old shape because still-JavaScript callers test `typeof cleaned.html === "string"` and read `cleaned.reason`.
- **The block tree** is a private union: `{ kind: "text"; text } | { kind: "break" } | { kind: "element"; name: InlineTag | "li"; children }`, replacing the old nodes told apart by which property happened to be defined.
- **`BlockWords` is branded.** These are words in one exact form: decoded, folded for typography, normalized. The matcher compares them with `===`, and a caller that hands it words in any other form gets a silent "missing". Only `blockWords` mints the brand. Mint it without a cast through a private assertion function (`function asBlockWords(value: string): asserts value is BlockWords {}`); if the lint gate refuses that form, raise it with the orchestrator rather than adding a cast. `declare const` is erasable.
- **The refusal code comes from the contract.** `Extract<FailureCode, "RUN_BLOCK_REFUSED">` stops compiling if C1's failure table loses or renames the code.

### `run-match.ts`

```ts
export const SHORT_BLOCK_WORDS = 5;
export const RUN_WALK_SLACK = 2;

export interface LeafBlock { readonly tag: BlockTag; readonly html: string; readonly words: BlockWords }
export function leafBlocks(html: string): readonly LeafBlock[];

export type MatchEntry = { readonly words: BlockWords } | { readonly html: string };

export const MATCH_STATUS: { readonly WHOLE: "whole"; readonly JOINED: "joined"; readonly SPLIT: "split"; readonly MISSING: "missing" };
export type MatchStatus = (typeof MATCH_STATUS)[keyof typeof MATCH_STATUS];
export type BlockMatch =
  | { readonly index: number; readonly status: "missing"; readonly leaves: readonly [] }
  | { readonly index: number; readonly status: "whole" | "joined" | "split"; readonly leaves: readonly [number, ...number[]] };
export function matchRun(blocks: readonly MatchEntry[], leaves: readonly MatchEntry[]): readonly BlockMatch[];

export interface RunClash { readonly index: number; readonly blocks: number; readonly leaf: number }
export function runClash(blocks: readonly MatchEntry[], leaves: readonly MatchEntry[]): RunClash | null;
```

- `BlockMatch` makes "missing with leaves" and "found with no leaves" unrepresentable, so `runClash` reads the last leaf of a found block with no check.
- `MatchEntry` takes either precomputed words or markup, which is what the callers hold: the handled check passes `{ words }`, the layer passes record blocks `{ tag, html }` and leaves `{ tag, html, words }`. A `LeafBlock` is both.
- The page tree is a private union of text and element nodes; the raw-text flag is a field of the text node.

### `target-slug.ts`

```ts
export const SLUG_MAX = 40;
export function targetSlug(canonical: string): string;
```

### Bridges

- `src/shared/normalize.js` holds one line: `module.exports = { ...require("../domain/text.ts"), ...require("../domain/html-syntax.ts"), ... };` with all ten modules. The spread makes a plain, writable object (B78); a bare `require` of one module would return a frozen module namespace.
- The bundle sets `LAHE.normalize` to the same combination at the old file's place in the bundle order (B79). How depends on S0c (section 10).

### Renames, and what each caller changes

No export name collides across the ten modules. Names that change:

| Old | New | Why | Callers to edit |
| --- | --- | --- | --- |
| `MODE` | `COMPARISON_MODE` | Imported by name, `MODE` says nothing | `editing.js` 630, 632, 1333, 1335; `replay.js` 1009, 1186 |
| `BLOCK_TAGS` (object of `name: 1`) | `BLOCK_TAGS` (readonly array) and `isBlockTag(name)` | A table with a derived union and a guard, instead of `hasOwnProperty` on an object | `hasOwnProperty.call(normalize.BLOCK_TAGS, x)` becomes `normalize.isBlockTag(x)` at `anchor.js` 2118, `comments.js` 409, `editing.js` 3028, `replay.js` 1163; `blocks.js` drops its alias at 37 and calls `normalize.isBlockTag` at 79, 86, 142, 181; `Object.keys(normalize.BLOCK_TAGS)` at `editing.js` 1460 becomes `normalize.BLOCK_TAGS` |
| `DROP_SUBTREE_TAGS` (object) | readonly array and `isDroppedSubtreeTag(name)` | Same | `blocks.js` 67 |
| `INLINE_ALLOWED` (object) | `inlineTagFor(name)` | One call answers "is it allowed" and "how is it written" | `editing.js` 1237 and 1238: `var inline = normalize.inlineTagFor(tag); ... else if (inline) out += "<" + inline + ">" + inlineMarkup(child) + "</" + inline + ">";` |

**Watch for silent failure.** `hasOwnProperty.call` on an array returns false for every tag name without an error. After the change, `grep -rn "hasOwnProperty.call(normalize\.\|hasOwn(BLOCK_TAGS\|hasOwn(normalize\." src` must find nothing.

Removed, with no caller to change (D1, D2): `canonicalTarget`, `isLoopbackHost`, `markupEquals`, `stripControls`, `stripAllControls`, `textEquals`, `breakForTag`, `blockTextEquals`, `MODES`, `structureEquals`, `isSafeUrlValue`, `digestOf`, `SAFE_SCHEMES`, `RUN_BLOCK_REFUSED`.

New names: `readTag`, `isBlockTag`, `isDroppedSubtreeTag`, `isVoidTag`, `isWhitespacePreservingTag`, `isStructuralTag`, `resetTagsForStyle`, `isWritableBlockTag`, `inlineTagFor`, `cleanCharacters`, `collapseSpaces`, `MATCH_STATUS`, and the types above.

Every other name keeps its spelling, so the forwarder and the bundle registration hand old callers what they read today.

### Tests

New tests live in `test/unit/domain/`, one file per module, mirroring the source (`test/unit/domain/text.test.ts` and so on), with a `package.json` holding `{"type": "module"}` if S0c has not added one. A `.ts` test cannot import `.js`, so the free-writing corpus (`test/fixtures/free_writing/corpus.js`, still JavaScript and also injected into browser pages) is copied as literal data into the two tests that use it, following the folder README's rule. The HTML fixtures `md_render.html` and `empty_notes.html` are read with `fs` as today. When the corpus becomes `.ts` in wave T2, the copies go.

`git mv` targets: `normalize.test.js` to `test/unit/domain/clean-markup.test.ts`, `clean_block.test.js` to `test/unit/domain/run-blocks.test.ts`, `leaf_blocks.test.js` to `test/unit/domain/run-match.test.ts`. The other seven test files are new.

## 5. Old tests, accounted for

114 old cases: all 113 in the three files that test this module, and the one case in `replay_run.test.js` that tests only `firstWords`. Carried: 103. Dropped: 11. Counted by `tests.py`.

| File | Old test | Covered by | |
| --- | --- | --- | --- |
| normalize | normalizeText is idempotent | B6 | carried |
| normalize | normalizeText collapses every whitespace run to one space and trims | B1 | carried |
| normalize | normalizeText makes rewrapping invisible, which is what R16 needs | B1 | carried |
| normalize | normalizeText folds a non-breaking space and a hair space into a plain space | B1 | carried |
| normalize | normalizeText removes a zero width space and a BOM but keeps a zero width joiner | B2 | carried |
| normalize | normalizeText composes to NFC so two spellings of one accented word match | B4 | carried |
| normalize | normalizeText strips control characters but keeps tab and newline as spaces | B3 | carried |
| normalize | normalizeText is case sensitive and typography preserving | B5 | carried |
| normalize | normalizeText throws on a non-string rather than stringifying it | B7 | carried; asserts `TypeError`, not the message |
| normalize | foldTypography sits on top of normalizeText and is not a second normalizer | B9 | carried |
| normalize | cleanMarkup drops tool chrome with its subtree and unwraps tool wrappers | B23 | carried |
| normalize | cleanMarkup strips every data-lahe attribute and lahe- class token | B24 | carried |
| normalize | cleanMarkup strips the stamp, so an id never rides in as content | B24 | carried; the stamp name is written as the literal `data-lahe-id`. That the stamp is a tool attribute is a markers fact, for C1's tests |
| normalize | cleanMarkup drops a class attribute that was only tool classes | B24 | carried |
| normalize | cleanMarkup never lets a style attribute through | B25 | carried |
| normalize | cleanMarkup drops event handler attributes | B25 | carried |
| normalize | cleanMarkup drops a script with its contents | B27 | carried |
| normalize | cleanMarkup refuses an executable scheme, including one hidden behind an entity | B26 | carried |
| normalize | cleanMarkup canonicalizes tags so a formatting comparison is stable | B29 | carried |
| normalize | cleanMarkup sorts attributes so a reserialization is not a formatting change | B29 | carried |
| normalize | cleanMarkup collapses whitespace outside pre and preserves it inside | B34 | carried |
| normalize | cleanMarkup closes tags the source left open | B32 | carried |
| normalize | cleanMarkup drops comments | B28 | carried |
| normalize | cleanMarkup is idempotent | B36 | carried |
| normalize | markupEquals reports a formatting-only change as a change (R30) | B37 | carried as a `cleanMarkup` equality; `markupEquals` is gone (D2) |
| normalize | canonicalTarget converges both loopback spellings, the trailing slash, and the fragment (R11) | none | dropped: `canonicalTarget` has no caller (D1) |
| normalize | canonicalTarget keeps the root slash | none | dropped (D1) |
| normalize | canonicalTarget drops a default port and keeps a query | none | dropped (D1) |
| normalize | canonicalTarget resolves dot segments in a route path | none | dropped (D1) |
| normalize | canonicalTarget does NOT percent-decode a route path, because that is the traversal primitive | none | dropped (D1) |
| normalize | canonicalTarget marks a remote host as not local | none | dropped (D1) |
| normalize | canonicalTarget normalizes a file path and reports whether symlinks were resolved | none | dropped (D1) |
| normalize | canonicalTarget handles a file URL | none | dropped (D1) |
| normalize | canonicalTarget refuses a relative path rather than guessing a base | none | dropped (D1) |
| normalize | targetSlug can never contribute a path separator or a dot segment | B76 | carried; the inputs go straight to `targetSlug`, without `canonicalTarget` first |
| normalize | targetSlug is readable for the ordinary case | B76 | carried |
| normalize | the two comparison modes disagree on a text-equal structure-different pair | B52 | carried |
| normalize | the two comparison modes agree on a both-equal pair | B52 | carried |
| normalize | the structure mode is defined against bold and italic and nothing else in v1 | B20, B51 | carried |
| normalize | the reset a stylesheet-bold word needs is a tag, because a style attribute cannot survive | B33, B49, B52 | carried |
| normalize | italic has the same reset, and both resets can sit on one element | B33 | carried |
| normalize | a reset on an element that says something else keeps that element, inside the marker | B33, B36 | carried |
| normalize | a reset marker reads as no words of its own | B43, B44 | carried |
| normalize | the structure mode tells apart which words carry the emphasis | B51 | carried |
| normalize | modeFor picks structure for a format-only record and text for everything else | B48 | carried |
| normalize | equalsInMode refuses an unknown mode rather than guessing one | none | dropped: the mode is a two-member union and every caller passes a member (D3) |
| normalize | blockText reads a break off the markup, in each shape a browser writes it | B40 | carried |
| normalize | blockText folds the whitespace a source carries, and only that | B41 | carried |
| normalize | blockText keeps the whitespace inside a pre, where it is content | B42 | carried |
| normalize | the text mode is break-aware, so a typed break is a change and a rewrap is not | B50, B41 | carried |
| normalize | normalizeBlockText folds like normalizeText except that a break survives | B8 | carried |
| normalize | the two readers agree: markup in and a live node in give the same text | B45, B46 | carried |
| normalize | emphasisRuns reads which words are bold and italic, and nothing else | B53 | carried |
| normalize | topLevelBlocks: cuts markup at its top-level paragraphs, and refuses what does not cut cleanly | B47 | carried, except `topLevelBlocks(null)`, which is now a compile error (D4) |
| normalize | foldTypography folds a run of hyphens to one, so a typed -- matches a rendered dash | B9 | carried |
| normalize | blockWords agrees: a block typed with -- has the words of the rendered dash | B65 | carried |
| normalize | cleanMarkup with keepWhitespace keeps the reviewer's spaces and still cleans | B35 | carried |
| clean_block | the writable tags are the six a record may carry | B54 | carried |
| clean_block | the refusal code is a real failure code | B57 | carried as a type-level link (`Extract<FailureCode, ...>`) plus a runtime check that the refusal's code is `"RUN_BLOCK_REFUSED"`; C1's own tests prove the code is in the failure table |
| clean_block | a script or iframe tag is refused | B58 | carried |
| clean_block | a script or iframe inside a block is refused, not cleaned | B59 | carried |
| clean_block | the SVG animate href case is refused | B59 | carried |
| clean_block | a remote image is refused | B59 | carried |
| clean_block | a link is refused | B59 | carried |
| clean_block | an li inside a p block is refused | B59 | carried |
| clean_block | a list block holds only li children, and no nested list | B59 | carried |
| clean_block | a comment or a processing instruction is refused | B59 | carried |
| clean_block | an empty block is refused | B59 | carried |
| clean_block | every attribute is dropped | B60 | carried |
| clean_block | text is escaped again on output | B61 | carried |
| clean_block | b and i become strong and em, and the reset tags are kept | B60 | carried |
| clean_block | elements come only from the allowlist's constants | B59, B60 | carried |
| clean_block | a list keeps its items and drops an empty one | B62 | carried |
| clean_block | a trailing break is dropped and a middle one kept | B62 | carried |
| clean_block | nbsp folds to a space and whitespace collapses | B61 | carried |
| clean_block | cleanBlock is a fixed point on its own output over the engine corpus | B63 | carried |
| clean_block | cleanBlock keeps the words of the engine corpus | B63 | carried |
| clean_block | a 1 MiB block of nested tags is refused in well under a second | B64 | carried |
| clean_block | a block nested deeper than the cap is refused, not thrown | B64 | carried |
| clean_block | a block nested up to the cap still cleans, words kept | B64 | carried |
| clean_block | many empty elements between words clean in linear time | B64 | carried |
| leaf_blocks | the walk's numbers are the plan's | B67 | carried |
| leaf_blocks | the file-name title marker has one spelling | none here | dropped from this slice: it tests `markers` (`FILE_TITLE_ATTR`, `EDIT_HOST_ATTR`, `isFileTitle`), which C1 owns. C1's markers test must carry it; the orchestrator checks C1's mapping before C2 merges |
| leaf_blocks | on the Markdown render the reader skips the Section N label | B69 | carried |
| leaf_blocks | the reader skips the marked file-name title, so an empty notes page has no blocks | B69 | carried |
| leaf_blocks | the reader skips elements with no text | B69 | carried |
| leaf_blocks | a list is one block whose lines are its items | B70 | carried |
| leaf_blocks | a leaf keeps its inner markup, cleaned | B70 | carried |
| leaf_blocks | the reader follows the browser's repair of malformed markup | B68 | carried |
| leaf_blocks | tool chrome is not a block | B69 | carried |
| leaf_blocks | words are folded for typography | B65 | carried |
| leaf_blocks | a block found as a whole leaf is whole | B71, B73 | carried |
| leaf_blocks | two blocks in one leaf are joined | B71, B73 | carried |
| leaf_blocks | one block spread over two leaves is split | B71, B73 | carried |
| leaf_blocks | a block not in the walk is missing, and the walk goes on to the next block | B72, B73 | carried |
| leaf_blocks | tag and markup never decide presence | B71, B73 | carried |
| leaf_blocks | leading leaves that match nothing are skipped before the first match | B72, B73 | carried |
| leaf_blocks | a short block inside a later unrelated block is missing | B71, B73 | carried |
| leaf_blocks | blocks out of run order: the one out of order is missing | B72, B73 | carried |
| leaf_blocks | a block that is only a prefix of a longer leaf is missing | B71, B73 | carried |
| leaf_blocks | a block past a leaf that matches nothing, after a match, is missing | B72, B73 | carried |
| leaf_blocks | a block past the run's length plus the slack is missing | B72, B73 | carried |
| leaf_blocks | runWords counts the run and skips from_anchor blocks | B66 | carried |
| leaf_blocks | the matcher reads a typed -- and a rendered dash as the same block | B73 | carried |
| leaf_blocks | a leaf holding a block's words plus a sentence the agent added is a clash on that block | B74, B75 | carried |
| leaf_blocks | the clash can be the run's first block, at the first leaf after the anchor | B74, B75 | carried |
| leaf_blocks | with nothing matched, a short first block inside the page's next paragraph is not a clash | B74, B75 | carried |
| leaf_blocks | after an earlier block matched, a short block inside the next leaf is still a clash | B74, B75 | carried |
| leaf_blocks | two blocks joined in one leaf with extra words are one clash over both | B74, B75 | carried |
| leaf_blocks | an exact join, a split, or a whole block is never a clash | B75 | carried |
| leaf_blocks | a missing block that is not inside the next leaf is missing, not a clash | B75 | carried |
| leaf_blocks | words must be whole words: a block's words inside a longer word are not a clash | B74, B75 | carried |
| leaf_blocks | with nothing matched, only the first leaf after the anchor can clash | B74, B75 | carried |
| replay_run | normalize.firstWords cuts to the word limit and adds the suffix only when it cut | B10 | carried into `text.test.ts`; the old case stays in `replay_run.test.js` until T1 and keeps passing through the forwarder |

Dropped: nine `canonicalTarget` cases (D1), the unknown-mode case (D3) and the markers case (moves to C1), 11 in all; 103 carried. `markupEquals` and `topLevelBlocks(null)` are narrowed within carried cases, not dropped.

## 6. Deliberate differences

Each has a test in the new suite. "Noticed" means a person or an agent could see the difference; those go on the progress page as departures.

- **D1. `canonicalTarget` and `isLoopbackHost` are removed.** No file in `src/`, `scripts/` or the browser tests calls either; only `normalize.test.js` does. `review_writer.js` uses only `targetSlug`, on a string it already holds. Test: none needed; `tsc` fails any import of them, and B78's export list does not hold them. Not noticed.
- **D2. Fourteen unused exports go.** `markupEquals`, `stripControls`, `stripAllControls`, `textEquals`, `breakForTag`, `blockTextEquals`, `MODES`, `structureEquals`, `isSafeUrlValue`, `digestOf`, `SAFE_SCHEMES` and `RUN_BLOCK_REFUSED` as an export, plus D1's two. Their behavior stays reachable through `cleanMarkup` (URL safety, B26), `embeddedName` (the digest, B39) and `cleanBlock` (the code, B57). Not noticed.
- **D3. `equalsInMode` no longer throws on an unknown mode.** Its mode parameter is the two-member union, and the switch has no `default`. Every caller passes `record.comparisonMode(item)` (which is `modeFor`) or one of the two constants, so no caller can produce a third value. `docs/CONTRACTS.md`'s sentence about the throw changes to say the type admits only the two modes. Test: B50 and B51 cover both members. Not noticed.
- **D4. Inputs are typed, and only the absences callers really send are accepted.** `firstWords` and `blockWords` still accept `null` and `undefined` (`handled_check.js` passes `entry && entry.html`), and `runWords` still accepts `undefined`. Everything else takes the type its callers already pass. The functions that used to answer any input (`topLevelBlocks`, `leafBlocks`, `matchRun`, `runClash`, `blockTextFromNode`, `targetSlug`) have JavaScript callers that already pass the right type: they guard with `typeof`, wrap in `String(...)`, pass a DOM node they checked, or pass arrays they built (`blocks.js` `runWalk` falls back to `[]`). So `topLevelBlocks(null)`, `leafBlocks(5)`, `matchRun(null, null)` and `blockTextFromNode(null)` become compile errors instead of answering `null`, `[]` or `""`. `normalizeText` still throws `TypeError` on `undefined`, `null` and numbers (B7), because it has to call a string method; `cleanMarkup` and `textOf` no longer promise a `TypeError` message. Test: B7, B10, B65, B66. Not noticed.
- **D5. A tag must start with an ASCII letter.** The old reader took `<2` as a tag named `2`, so `cleanMarkup("1 <2 and <3")` gave `'1 <2 <3="" and=""></2>'`: the word "and" became an attribute. HTML reads `<` before a digit as text. Now every reader in the slice keeps it as text, and `cleanBlock("p", "a <2 b")` escapes it instead of refusing `"element 2 is not allowed in a block"`. Browsers serialize a text `<` as `&lt;`, so markup from a page never hits this; markup an agent writes can. Test: B12, B34. Barely noticed: an agent's record keeps its words.
- **D6. In `cleanMarkup`, `/>` on a non-void element opens it.** The old code treated `<span/>` as void, wrote `<span>` and never closed it, which broke the "output is balanced" guarantee. Browsers ignore the slash on a non-void element. The other readers keep their old handling: they only ever see cleaned markup or captured `innerHTML`, which never holds `/>`. Test: B31. Not noticed.
- **D7. `&#xA0;` folds to a space like `&#xa0;`.** The old pattern matched only lowercase hex digits. Applies to `cleanMarkup` and `textOf`. Test: B34. Not noticed.
- **D8. Attribute values are decoded when read and escaped once when written.** The old tokenizer kept a value's references as written and then escaped it again, so `cleanMarkup('<a href="/a?x=1&amp;y=2">t</a>')` gave `href="/a?x=1&amp;amp;y=2"`, and `cleanMarkup` was not idempotent on such values. Browsers serialize `&` in an attribute as `&amp;`, so **every record of an element holding a link with a query string or a title with a quote carries a broken value today**, and `leafBlocks` doubles it again. Records already stored keep their bytes: decoding once and escaping once gives the stored string back, so `record.validateRun`'s check that stored markup equals `cleanMarkup`'s output still passes on old records. The URL safety check (B26) runs on the decoded value and decodes again, so it is no weaker. Test: B36, B70. **Noticed by agents:** links and titles in `before_html`, `after_html` and `anchor_after_html` stop showing `&amp;amp;`.
- **D9. In `cleanBlock`, tab, LF and CR in text become spaces.** The old code removed them with the other controls, so a text node holding `"x\ny"` (a page source wrapped at that point) became `"xy"`, and words ran together. This reaches records: `editing.js` builds a run block's markup from live text nodes, and a moved anchor tail carries the page's own source line breaks. The joined words then fail to match the page's leaves, whose words keep the space (`blockWords` folds the newline), so replay reads the block as missing. Stored blocks never hold a tab or newline (the old code removed them), so they stay fixed points. Test: B61. **Noticed by a reviewer and an agent:** words no longer run together in a free-written block taken from a wrapped source.
- **D10. Tag tables are typed lists with guards, and three names change** (`MODE`, `INLINE_ALLOWED`, and the shapes of `BLOCK_TAGS` and `DROP_SUBTREE_TAGS`), with every caller edited in this slice. Test: B18, B19, B48, B55, and the `grep` check in section 4. Not noticed.

Known edges kept as they are, and recorded in the folder doc rather than fixed: `cleanMarkup` keeps a duplicate attribute (`id="a" id="b"`), where a browser keeps the first; `blockText` keeps `&amp;` as written while `blockTextFromNode` reads `&`, so the two readers agree only on text without `&`, `<` or `>`; `textOf` does not recognize comments (its inputs never hold them); `leafBlocks` recurses once per nesting level, so a page nested tens of thousands deep can overflow the stack (the handled check already catches that); `decodeEntities` keeps `&#0;` as written, where a browser gives U+FFFD.

## 7. Fixed behavior tests touched

These must pass with what they assert unchanged:

- **Skill-wording tests** (`test/support/skill.js` users): `no_stale_excuse`, `add_command`, `mark_done`, `session_fixes`, `stable_addresses_docs`, `status_command`, `review_format`, `reply_command`. None reads this module's output directly; `review_format` and `status_command` run code that calls it (below).
- **`test/unit/review_format.test.js`**: the projection and Copy text call `runWords`, `decodeEntities`, and, through `record.js`, `blockText`, `blockWords`, `emphasisRuns`, `textOf` and `cleanMarkup`. D8 does not change bytes here unless a fixture record has an attribute value holding `&`, `"`, `<` or `>`; `grep "amp;amp;"` over `test/` finds none.
- **`test/unit/export_text.test.js`**: the same paths through `review_format.js`.
- **CLI output:** `test/unit/lean_agent_output.test.js` ("context the quote already holds is left out, and a partial overlap is kept whole") runs `status.js`'s use of `normalizeText`.
- **Browser specs**, run at checkpoint 1: those that read `LAHE.normalize` or load it directly (`blocks_kernel`, `paragraph_break`, `anchor_engine`, `best_guess_speed`, and through `protect_page.js` and `export_stub.js`: `protection_layers`, `replay_old_records`, `replay_run_check`, `replay_run_anchor`, `replay_run_flow_fix`, `replay_run_insert`, `replay_run_fix_round`, `edits_tab`); the free-writing specs, which drive `cleanBlock`, `leafBlocks` and the matcher through `blocks.js` (`free_writing_*`); and the formatting specs (`formatting_survives`, `formatting_toggle`). Every other spec loads the bundle, so the full suite at the checkpoint is the real proof.

## 8. Source-text tests

The plan's "Tests that read source text" table lists nothing for `normalize.js`. Found by grep:

- **`test/browser/support/export_stub.js:36,87-88`** reads `src/shared/normalize.js` (and `markers.js`, `record.js`, `review_format.js`) as text and injects it into the page with `addInitScript`. Once `normalize.js` is a Node forwarder, that text throws in the browser (`module` is not defined), and `record.js`'s factory receives `undefined`. It is not in S0c's list of 13 specs and 2 support files, because it reads text rather than loading a path. C1 breaks it first (`markers.js`). It must get the layer from S0c's bundle helper instead, as `edits_tab.spec.js` needs `LAHE.review_format`, `record`, `normalize` and `markers`. See section 10.
- **Path loaders** (`blocks_kernel.spec.js:24`, `anchor_engine.spec.js:34`, `best_guess_speed.spec.js:24`, `support/protect_page.js:44`): S0c moves them to the bundle helper. If any still names `src/shared/normalize.js` when C2 starts, C2 cannot merge until it does not.
- **Manifest readers:** lint's completeness check and `test/unit/lint_lua.test.js:46-50` read the manifest's lists. C2 changes only its own entry, the way S0c's `elapsed` pilot did.

Nothing reads `normalize.js`'s comments, so moving them to the doc breaks no test.

## 9. Comments to move

Drafted as the sections C2 adds to `docs/ongoing/code/domain.md` (S0c creates the file). In the doc each heading is `## \`<file>\``. Each file's `read-when` header routes; these sections hold the why.

#### `text.ts`

This is the one text normalizer. No other module defines its own normalization. If any two readers fold text differently, no region ever compares equal to its record, replay rewrites every region on every pass, and the reviewer's caret gets fought twice a second, which is the bug the tool exists to remove.

`normalizeText` is a comparison key, and each guarantee has a caller that relies on it:

- Whitespace-insensitive, so rewrapping or reindenting a paragraph does not change its key, and a comment survives a reformat.
- Case-sensitive and typography-preserving. "Fix" and "fix" are different words, and a curly quote is a real difference in a document about wording. Folding typography here would make a reviewer's punctuation fix invisible to replay; `foldTypography` is the separate, named fallback.
- It throws on a non-string. A silent `String(undefined)` would make the literal text "undefined" a comparison key, which matches nothing forever and looks like an anchoring bug.

The hair space U+200A is in the space list on purpose: in a sibling project it hid in a test fixture where it looked exactly like a space. U+200D and U+200C are kept on purpose: they carry meaning in emoji sequences and in Persian, Hindi and other scripts, and removing them changes the reviewer's text.

`normalizeBlockText` exists because one run of whitespace is not incidental: a break the reviewer typed. Folded away, the commit compares equal to the text it started as, the edit is thrown out as a no-op, and the break vanishes the next time the page is rebuilt. That happened. So a break is read off the markup, never off a whitespace character (a `<br>` is one newline, a block boundary is a blank line), and every other run still folds, including the newlines a source carries because its author wrapped a line.

`foldTypography` decides only where a block is, never whether its words are right. Replay and the page check compare a found block with each revision without it, so a reviewer's punctuation fix (well--known to well-known) is still written and still checked. Hyphen runs fold after the dashes because a Markdown source spells a dash `--` or `---` and a smart renderer draws one, and every reader (the run walk, the page check, the handled check, the split search) must see them as the same.

`firstWords` is the one copy of "the first N words" that editing, replay and the rail read.

#### `html-syntax.ts`

The one tokenizer every reader in `src/domain/` uses. It is a string scanner, not an HTML parser, and that is deliberate: the markup rules stay unit-testable in `node:test` with no DOM, which keeps them outside the ban on jsdom. The browser side serializes first and hands over a string.

A tag starts with `<` and an ASCII letter, as in HTML; anything else is text. Attribute values are decoded on the way in and escaped once on the way out. Keeping them as written and escaping again once turned every `&amp;` in a recorded link into `&amp;amp;`.

`BLOCK_TAGS` includes table cells for the same reason it includes list items: two cells read as two things, and running their words together is how "Helloworld" got into a record. It is the text readers' list; `run-blocks.ts` has its own, shorter list of what a record may write.

#### `formatting.ts`

HTML has no element that means "not bold". A reviewer who selects a phrase that is bold through the page's own stylesheet and presses B is asking for exactly that, and every engine answers the same way: `<span style="font-weight: normal">`, byte for byte identical in Chromium, Firefox and WebKit with `styleWithCSS` off. Lahe drops every style attribute on the way into a record, so the span came back bare, the structural view dropped it too, and the un-bold compared equal to no change. It was thrown away in silence, and a reviewed report is full of stylesheet bold, so this was the common case.

So the reset gets a tag of its own, and the style attribute still never survives. The names are hyphenated because a hyphen makes a custom element name, which the HTML spec promises will never get a meaning of its own, and because they read plainly in the markup an agent is handed: "Runners come back `<not-bold>`too fast`</not-bold>` after a layoff." The trade: a page that ships its own `<not-bold>` element gets the layer's one rule for it (`font-weight: normal`), which is what its name claims anyway. Namespacing the tags would remove that risk and put Lahe branding in front of every agent that reads a record.

`lighter` counts as not bold. It is relative and can in principle land on 600 under a 900 parent, but a reviewer never types it and an engine only emits it meaning lighter.

The layer reads `RESET_TAGS` rather than spelling the tag names again. Two rules in the layer's one page stylesheet (`highlight`) are what make the tags render.

#### `clean-markup.ts`

`cleanMarkup` is the markup key: what a record stores in `before_html` and `after_html`, and what an agent reads. It guarantees that no tool markup survives (chrome goes with its subtree, wrappers unwrap, every `data-lahe*` attribute and `lahe-` class goes), that no style attribute survives (the tool never writes one and never reports one), that no executable URL scheme survives (checked after references and control characters are resolved, since those are how `java\tscript:` gets past a naive prefix check), that no event handler survives, and that the output is stable when a browser reserializes it.

Sorting attributes is a trade. It loses the author's attribute order in the markup an agent reads, and buys a `before_html`/`after_html` comparison that does not report a change because Chromium wrote two attributes in a different order.

One element can become several: a span whose only job was to say "not bold" becomes `<not-bold>`, and one that says something else too keeps its own tag inside the marker. Only the innermost name carries attributes; a marker never has any.

`keepWhitespace` exists for protection's restore, which puts the reviewer's own block back after a repaint destroyed it. The spaces in it are characters the reviewer typed. A trailing space folded away means their next word runs into the last one; a leading one trimmed shifts the caret one character right.

#### `embedded-value.ts`

A `data:` URL carries the picture itself as text, often hundreds of kilobytes. A record stores such a value once, whole, and refers to it by name everywhere else (see the oversized-records feature folder). These two functions are the whole vocabulary: what counts as embedded, and the fixed-size name a comparison uses instead of the value. The media type and length in the name are readable on their own; the digest tells two pictures of one size apart.

The digest is cyrb53's mixing (by bryc, public domain) over both 32-bit lanes, kept whole at 64 bits. It is pure arithmetic on UTF-16 code units, so the browser and Node agree on every value. Element signatures stored in records hold these names, so the arithmetic must never change. It is a name for a value, never a check that two values are safe to treat as one for a write: the uniqueness rule still decides that, over candidates found on the page.

#### `block-text.ts`

Two front ends produce break-aware text because two kinds of caller hold two different things: `blockText` takes markup (a record's own html, a test fixture) and `blockTextFromNode` takes a live element (the anchor engine, replay). They share the break vocabulary and the folding, so they cannot drift. In `blockTextFromNode`, a text node's own whitespace outside `pre` is incidental (the source wrapped a line) and folds before the breaks are added, so every newline left in the joined string came from a break tag.

The two agree on text without `&`, `<` or `>`. `blockText` keeps character references as written (`&amp;`), while a live node's text is already decoded (`&`). Callers that compare across the two decode first (`blockWords` does).

`textOf` is the text mode's view, and it does not clean first, on purpose. It takes a record's plain `after` (which states the reviewer's breaks with real newlines) as well as markup (a format-only record's `after_html`). Cleaning would fold the newlines in a text run, which is right for markup and would erase the breaks a record's text holds. The rule that makes both safe: a newline already in the string is a break, and a tag gives the break its name says. Markup reaches a record through `blockText`, which folds a source's line wraps first, so nothing is recorded with an incidental newline.

Whitespace inside `pre` is content, so it is carried across the folding on three private-use characters (U+E000 to U+E002) and put back after. A reviewer editing a code block keeps their indentation.

`topLevelBlocks` exists for replay writing one paragraph of a multi-paragraph edit when the page already carries the others. The paragraph's bold, italic and links live in the record's `after_html`, and this finds that paragraph's share. It cuts only at the top level, so a block nested in an inline element, or a list inside a paragraph, stays whole and reads to replay as more than one paragraph, which replay then refuses. A piece with markup and no words (an image alone) cannot be matched to a paragraph of text, so the answer is null.

The layer's unit tests pass hand-built nodes that spell a text node's string `data` or `nodeValue`; the reader accepts either.

#### `comparison.ts`

Ordinary records compare on text. A format-only record cannot: its whole point is a change the text key is built to ignore, so comparing it on text makes replay's format-only branch a silent no-op that looks like a working feature. `modeFor` picks the mode from the record kind, and `equalsInMode` is the only comparison a caller makes.

Formatting is a closed list, bold and italic. `cleanMarkup` has already renamed `b` and `i`, so the structural view only ever sees four names, two formats each with an on and an off. Everything else in the markup is dropped, which keeps the comparison one of formatting, not of the page's markup: a framework that reserializes a span or adds a wrapper class must not read as a format change. Both modes take markup, and the only difference between them is whether emphasis counts.

The text mode keeps breaks: that is the difference between "the reviewer split this paragraph" and "nothing changed". The structure mode does not, because its question is only which words are emphasized; it still leaves a space where a break was so the words either side do not run together into one made-up word.

`emphasisRuns` reports a run nested inside another once per tag, because `<strong><em>x</em></strong>` is both. A marker around no words is not a formatting change anyone can be told about in words, so it is left out.

#### `run-blocks.ts`

A free-writing run record carries new blocks as `{tag, html}`, and `cleanBlock` is the one allowlist for them. It runs three times: at capture in the layer, at the helper on append, and before every page write. At the helper, `record.validateRun` refuses a block that is not exactly `cleanBlock`'s output rather than cleaning it, so a forged or runaway record shows up instead of being quietly repaired. Nothing in a record ever names an element: every output tag is written from the constants here.

The output is a fixed point (cleaning it again gives it back unchanged), which is what lets the helper compare stored markup with `cleanBlock`'s output byte for byte.

The nesting cap bounds the closing-tag scan and every recursive pass, so hostile markup costs linear time and never overflows the stack. Before it, N `<em>` then N `</b>` cost N times N. A real block is a few levels deep. Empty elements are pruned with the text either side joined once per run of text, not once per piece; joining per piece rescanned the whole string each time, which was N times N on a block of many empty elements.

`blockWords` is how every reader of a run compares words: references resolved, whitespace folded, typography folded. Tags and markup never decide presence. `runWords` skips `from_anchor` blocks because those are the page's own words moved, not words the reviewer wrote; the helper sets `proofread` from it.

#### `run-match.ts`

`leafBlocks` reads a page's leaf blocks from a string, in document order, for the helper's handled check. `src/layer/blocks.js` walks the live DOM by the same rule, and the two must agree. The tree builder is small: enough to agree with a browser's parse on the cases the free-writing corpus names (a `p` closed by a block start, an `li` closed by the next `li`, raw-text elements, inert template contents, comments).

The file-name title is skipped by the walk but still counts as a block for the leaf test, so the hero that holds only the title is not read as a leaf.

`matchRun` decides which of a run's blocks the page already shows. A block is present whole, joined with the blocks after it in one leaf, or split over consecutive leaves; tag and markup never decide. Leaves that match nothing are skipped only before the first match, because after one the run should continue right there. The walk reads at most the run's length plus two leaves.

`runClash` finds a block whose words the page shows inside a leaf that also holds words the reviewer never typed (the agent added a sentence). "Joined" is exact, so this is not presence; it is not missing either, since inserting the block would show the reviewer's words twice. Replay writes nothing until the reviewer answers. Only the leaf where the missing block would sit is read, so a short block ("Notes") never clashes with a paragraph further down that uses the word. With nothing matched yet, that leaf is usually the page's own next paragraph, and a block under five words ("Next", "Yes") sits inside such a paragraph for other reasons, so it clashes only after an earlier block matched. Words match as whole words in any script: "Beta" is not inside "Betamax".

#### `target-slug.ts`

A readable, filesystem-safe fragment of a review's file name. It is never a path component on its own: the review file writer pairs it with a hash of the canonical target, because a path component is never derived from untrusted text. Only the server uses it; see open question 4.

**Dropped as dead history:** the owner code (`0A-kernel`) and the task ids of the importers (`2A`, `2C`, `1C`, `3A`, `3B`); decision and requirement numbers (`D4`, `D7`, `D9`, `D11`, `R11`, `R16`, `R23`, `R30`, `R33` to `R35`, `R66`, `AC6`) and "ranked test 31", which point at an archived numbering; the dates and attributions on the two bug reports (the facts are kept); the review labels "security review, finding 2" and "code lead finding 3" (the reasons are kept); every comment on `canonicalTarget` (the code is gone); the comment saying `normalize` sits at the bottom of the dependency order (the project references say it now); the comment that `escapeAttrValue` is exported for the anchor engine (the import says it).

## 10. Open questions

1. **One name from ten modules, in the bundle and in Node.** C2 needs `LAHE.normalize` and `src/shared/normalize.js` to each be one plain object combining all ten modules (B78, B79). The Node side is the one-line spread above. For the bundle, if S0c's generated registration takes one module per name, C2 extends the generator and the manifest entry to take a list, in its own lines. Recommendation: allow that. The alternative, a `normalize.ts` barrel in `src/domain/`, would outlive F1 as an extra layer every caller would import.
2. **C1's signatures.** This spec assumes C1 keeps the markers names listed in section 1, exports a union type of failure codes, and types `isToolNode` to accept a value with an optional `getAttribute`. If C1 lands otherwise, the orchestrator tells the C2 builder before it starts.
3. **`export_stub.js` has no owner.** It reads `markers.js` and `normalize.js` as source text and breaks when C1 lands. Recommendation: C1 moves it to S0c's bundle helper, since C1 breaks it first; C2 then needs nothing there.
4. **`targetSlug` is server-only.** It lands in `src/domain/` because C2 may not write into `src/server/`. Recommendation: SV2 moves it into `server/store/review-writer.ts` and removes `target-slug.ts`.
5. **D8 and D9 change what agents and reviewers see.** The plan has a spec list such fixes with a test and record them as departures; the architecture sends bugs the types do not reveal to the board. Recommendation: keep both in C2. Both are in code this slice rewrites, each has one test, and both leave stored records valid. Splitting them out would mean rebuilding the tokenizer and the text cleaning twice.
6. **Docs that name `normalize`.** `docs/CONTRACTS.md` (lines 117, 255 to 275, 573, 602, 1390) and `docs/ongoing/FREE_WRITING.md` (lines 49, 86, 121) name `src/shared/normalize.js`, `normalize.MODE` and the unknown-mode throw. Decided: C2 edits only those lines to name the new modules and `COMPARISON_MODE`, and the orchestrator resolves any line conflict with C4.

## Orchestrator decisions (2026-11-12)

1. **One name from several modules:** accepted. S0c builds this into the generated registration and the forwarder: a manifest entry may list several `.ts` paths for one namespace name, and both sides hand callers one plain, writable object. Converted modules export functions and constants only, never a reassigned `let`. C2 does not extend the generator.
2. **C1's signatures:** the orchestrator compares this spec with the C1 spec and tells the C2 builder about any mismatch before it starts.
3. **`export_stub.js`:** it is dead (nothing calls it), so it goes on the cleanup list and neither slice changes it. See the C1 spec's decisions.
4. **`targetSlug`:** stays in `src/domain/target-slug.ts` for now. SV2 moves it into the server and removes the domain file.
5. **D8 and D9 stay in C2,** each with its own test. They go on the progress page as departures that agents and reviewers will notice.
6. **Docs that name `normalize`:** as decided in the spec. The orchestrator resolves line conflicts with C4.
