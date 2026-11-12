---
read-when: Changing a file in src/domain/, or working out why one of them does what it does.
not-for: How the TypeScript projects and the lint gate are set up; see README.md in this folder.
---

# `src/domain/`: logic the server and the browser both run

This folder holds the code that the server and the review layer both run and must agree on. Today it holds `elapsed.ts` and `gestures.ts`. The rest arrives with the contract wave of the [TypeScript migration](../../features/20261112.01_typescript_migration/parts/target_layout.md): `normalize`, `lifecycle`, `review-format` and the record rules.

A file here imports only `src/contract/`, and nothing that needs Node or a DOM. The compiler enforces it: this project has neither Node's types nor the DOM's.

Source files carry no comments except their `read-when` header. The why, the traps and the history live here.

## How a domain module reaches both sides

- **Node** imports the `.ts` file directly; Node strips the types. CommonJS callers that are still JavaScript reach it through a one-line forwarder at the module's old path under `src/shared/`, listed in the manifest's `FORWARDERS`. The forwarder copies the exports into an ordinary object.
- **The browser** gets it inside the review-layer bundle. Until the layer's own files convert, they read their dependencies off `window.LAHE` as they load. So the module's entry in the manifest's `LAYER_FILES` names the `.ts` path at the old file's place in the order, with `registers` set to the namespace name the old file used. `scripts/build-layer.js` then registers the module under that name at that place, before any later file loads.

Both sides hand callers an ordinary, writable copy of the module's exports, not the read-only module namespace, because old code and tests replace functions on these objects. A copy taken once is why a module here exports functions and constants only, never a `let` it reassigns ([README.md](README.md#moving-a-file)).

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
