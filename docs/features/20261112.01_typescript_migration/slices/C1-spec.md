---
read-when: Building or reviewing slice C1 of the TypeScript migration.
---

# C1 spec: the constants, rebuilt as typed modules

Slice C1 converts five small files from `src/shared/` that hold vocabulary: the names that mark what Lahe added to a page, the failure codes and their words, the style id and name rules, the gesture table and its intent functions, and the write epoch. Every file is in the browser bundle today, and three are also read by the server. A builder works test first from this page and does not need the old files' comments to know what to build.

Counts on this page come from scripts in the session scratchpad, `specs/c1/`: `callers.py` (who imports what), `test_cases.py` (every old unit test case that reads these modules), and `mapping.py` (the old-test table below and its counts).

## 1. Scope

| Old file | Lines | Comment lines | New module | Project |
| --- | --- | --- | --- | --- |
| `src/shared/markers.js` | 172 | 66 | `src/contract/markers.ts` | contract |
| `src/shared/failures.js` | 690 | 176 | `src/contract/failures.ts` | contract |
| `src/shared/style_rules.js` | 77 | 25 | `src/contract/style-rules.ts` | contract |
| `src/shared/gestures.js` | 869 | 359 | `src/domain/gestures.ts` | domain |
| `src/shared/epoch.js` | 196 | 80 | `src/browser/review-layer/editing/write-epoch.ts` | browser/review-layer |

Total: 2,004 lines, 706 of them comment lines (a line whose first non-space characters are `//`, `/*` or `*`).

Each old path becomes a one-line CommonJS forwarder listed in `FORWARDERS` in `src/shared/manifest.js`. Each `LAYER_FILES` entry for these five changes to the new `.ts` path, so the bundle build generates a registration under the name the old file registered: `markers`, `failures`, `styleRules`, `gestures` and `epoch`. Follow the S0c pilot (`src/domain/elapsed.ts`) for the exact manifest fields.

New tests:

- `test/unit/contract/markers.test.ts`
- `test/unit/contract/failures.test.ts`
- `test/unit/contract/style-rules.test.ts`
- `test/unit/domain/gestures.test.ts`, the successor of `test/unit/rail_hotkey.test.js` by `git mv`
- `test/unit/browser/review-layer/editing/write-epoch.test.ts`, the successor of `test/unit/epoch.test.js` by `git mv`

Each new test folder needs a `package.json` holding `{"type": "module"}` (see `docs/ongoing/code/README.md`), unless S0c already made it.

Folder docs: `docs/ongoing/code/contract.md` (new, with sections for the three contract files), a `gestures.ts` section in `docs/ongoing/code/domain.md` (which S0c creates), and `docs/ongoing/code/browser-review-layer-editing.md` (new). Section 9 drafts all five sections.

Nothing in C1 imports another module, so the slice has no dependency inside `src/`.

## 2. Behavior

Each statement is something a caller, a reviewer looking at the page, or an agent reading a page or a record can observe. The new tests check these and nothing internal. Strings in quotes are exact.

### `contract/markers.ts`

**B1. The names are exact.** These values reach pages, records and the skill (the skill tells agents to keep `data-lahe-id` in their source), so each is pinned:

| Export | Value |
| --- | --- |
| `TOOL_ATTR` | `data-lahe` |
| `ROLE_CHROME` | `chrome` |
| `ROLE_WRAP` | `wrap` |
| `OVERLAY_ROOT_ID` | `lahe-surface-root` |
| `PROTECTED_ATTR` | `data-lahe-protected` |
| `TURBO_PERMANENT_ATTR` | `data-turbo-permanent` |
| `AUTHOR_REGION_ATTR` | `data-review-region` |
| `STAMP_ATTR` | `data-lahe-id` |
| `FILE_TITLE_ATTR` | `data-lahe-file-title` |
| `FILE_TITLE_VALUE` | `file-name` |
| `RENDER_NOTE_NAME` | `lahe-render-note` |
| `EDIT_HOST_ATTR` | `data-lahe-edit-host` |

**B2. What the tool writes is stripped, and what an author writes is not.** `isToolAttrName` is true for `TOOL_ATTR`, `STAMP_ATTR`, `PROTECTED_ATTR`, `FILE_TITLE_ATTR` and `EDIT_HOST_ATTR`, and false for `AUTHOR_REGION_ATTR` and `TURBO_PERMANENT_ATTR`.

**B3. `isToolAttrName(name)`** is true when the name, lowercased, starts with `data-lahe`: `"data-lahe-id"` and `"DATA-LAHE-ID"` are true; `"data-review-region"`, `"data-lah"` and `""` are false.

**B4. `isToolClassToken(token)`** is true when the token starts with `lahe-`, with case mattering: `"lahe-chip"` is true; `"Lahe-chip"`, `"lahe"` and `"x-lahe-chip"` are false.

**B5. `roleOf(node)`** returns `"chrome"` or `"wrap"` when the node's `data-lahe` attribute is exactly that value. It returns `null` for any other value, for a node without the attribute, for a node with no `getAttribute` (a text node), and for `null`.

**B6. `isToolNode(node)`** is true exactly when `roleOf(node)` is not `null`.

**B7. `isInsideOverlay(node)`** walks from the node up its `parentNode` chain while each node is an element (`nodeType` 1). It is true at the first node whose `id` is `lahe-surface-root` or that has a tool role, and false when the chain ends or reaches a node that is not an element. It is false for `null`, and false when it starts at a text node even inside the overlay (a known edge, kept).

**B8. `markChrome(el)`** sets `data-lahe="chrome"` on the element and returns the same element.

**B9. `isFileTitle(node)`** is true when the node's `data-lahe-file-title` is exactly `file-name`. It is false for another value, a missing attribute, a node with no `getAttribute`, and `null`.

### `contract/failures.ts`

**B10. The code list is exactly these 49 codes, in this order:** `HELPER_UNREACHABLE`, `CSP_REFUSED`, `SYNC_UNAUTHORIZED`, `SYNC_ORIGIN_NOT_ALLOWED`, `STORAGE_QUOTA`, `SECOND_WINDOW_REFUSED`, `ANCHOR_NO_TEXT_MATCH`, `ANCHOR_AMBIGUOUS`, `ANCHOR_STRUCTURE_ONLY`, `ANCHOR_LOST`, `REPLAY_NEITHER_MATCHES`, `RUN_BLOCK_REFUSED`, `RUN_OVER_CEILING`, `RUN_PLACEMENT_REFUSED`, `RUN_TAKEBACK_CARRIES_RUN`, `REPLAY_RUN_WRONG_TAG`, `REPLAY_RUN_PLACED_ELSEWHERE`, `HELPER_CONTRACT_OLDER`, `RUN_EVENT_REFUSED`, `SUGGESTION_NOT_FOUND`, `CHOICE_REFUSED`, `CHOICE_GROUP_INERT`, `CHOICE_GROUP_GONE`, `CHOICE_GROUP_TWICE`, `REPLY_LINE_MALFORMED`, `PROTO_BAD_REQUEST`, `PROTO_BAD_HOST`, `PROTO_UNAUTHORIZED`, `PROTO_FORBIDDEN_ORIGIN`, `PROTO_UNKNOWN_REVIEW`, `PROTO_UNSUPPORTED_MEDIA_TYPE`, `PROTO_MISSING_CUSTOM_HEADER`, `PROTO_STALE_REV`, `PROTO_UNKNOWN_ITEM`, `PROTO_REVIEW_RETIRED`, `PROTO_NOT_OWNER`, `PROTO_SECOND_WINDOW`, `PROTO_SECOND_INSTANCE`, `PROTO_CROSS_SITE`, `PROTO_NOT_OPENABLE`, `PROTO_REQUEST_PENDING`, `PROTO_QUEUE_FULL`, `PROTO_NO_AGENT`, `PROTO_CONFIRM_NEEDED`, `PROTO_NO_LAUNCH`, `PROTO_CATALOG_UNREADABLE`, `CLI_PATH_REFUSED`, `COPY_FAILED`, `EXPORT_FAILED`. `CODE_NAMES` returns them. Six codes nothing raises are gone (D1), and the send-era codes stay gone: `VERIFY_NOT_FOUND`, `VERIFY_NOT_VERIFIABLE`, `PROTO_NOT_DELIVERED` and `PROTO_TARGET_MISMATCH` are not in the list.

**B11. Every code's words are the old words, byte for byte.** For each of the 49 codes, `describe(code)` has the same `severity`, `persistent`, `surface`, `message` and `remedy` as the old `failures.describe(code)`. People read these in the rail, on cards, in the Library page and in CLI output. The test pins all 49 as literals. Make them once, before the old file becomes a forwarder, with a script that prints the old table as JSON, and name the script in the progress detail. Spot pins the test also states on their own:
  - `CSP_REFUSED`'s message contains "This is not the helper being down." and differs from `HELPER_UNREACHABLE`'s;
  - `REPLAY_RUN_WRONG_TAG`'s message is "The agent placed '{first words}' as a {type}. You wrote a {type}, so Lahe sent it back.";
  - `REPLAY_RUN_PLACED_ELSEWHERE`'s message is "'{first words}' is already further down the page, so Lahe did not add it again.";
  - `RUN_EVENT_REFUSED`'s message is "The helper refused this edit, so the agent has not seen it. Your words are still on this page.";
  - `COPY_FAILED` is persistent and shows in the failures list;
  - `REPLY_LINE_MALFORMED` is persistent.

**B12. The two small vocabularies.** `SEVERITY` is `{ BLOCKING: "blocking", WARNING: "warning", INFO: "info" }` and `SURFACE` is `{ FAILURES_LIST: "failures_list", CARD: "card", CLI: "cli" }`. Every definition's `severity` and `surface` is one of these values, and its `remedy` is a string or `null`.

**B13. Old spellings resolve.** `ALIASES` maps `SYNC_SERVICE_DOWN` and `CLI_NO_SERVICE` to `HELPER_UNREACHABLE`, `SYNC_POLICY_REFUSED` to `CSP_REFUSED`, `SECOND_TAB_REFUSED` to `SECOND_WINDOW_REFUSED`, and `ANCHOR_SUBJECT_GONE` and `ANCHOR_NOT_FOUND` to `ANCHOR_LOST`. `canonical(alias)` returns the target, and `canonical(code)` returns the code itself.

**B14. `isFailureName(value)`** is true for every code and every alias, and false for any other value, including `"toString"`, `"__proto__"`, `""`, `42` and `null`.

**B15. `describe(name)`** returns the definition of the name's canonical code, so an alias gets its target's words. For a name that is neither a code nor an alias, which only an untyped caller can pass, it throws an `Error` whose message names the value and `src/contract/failures.ts`.

**B16. `failure(name, detail)`** returns an object with exactly these fields: `code` (the name as given, so an alias keeps its own spelling), `canonical_code`, `severity`, `persistent`, `standing`, `surface`, `message`, `remedy`, `detail` (`null` when none is given) and `at` (the current time as an ISO 8601 string, between a clock reading taken before the call and one taken after). An unknown name throws as in B15.

**B17. Standing codes.** `standing` is true for `HELPER_UNREACHABLE`, `SECOND_WINDOW_REFUSED` and `CHOICE_GROUP_INERT`, and for an alias of any of them, and false for every other code. The rail updates a standing chip in place and never counts it.

**B18. `chipAction(code)`** returns `{ label: "Review here", action: "takeover" }` for `SECOND_WINDOW_REFUSED` and its alias `SECOND_TAB_REFUSED`, and `null` for every other code and for any other string.

**B19. `isCopyable(code)`** is true for `SYNC_ORIGIN_NOT_ALLOWED`, `CSP_REFUSED`, `REPLY_LINE_MALFORMED`, `SYNC_UNAUTHORIZED` and `CHOICE_GROUP_INERT`, and for an alias of any of them (`SYNC_POLICY_REFUSED`). It is false for every other code and for any other string. No code is both copyable and has a chip action.

**B20. `ANCHOR_FAILURE_CODES`** is `ANCHOR_NO_TEXT_MATCH`, `ANCHOR_AMBIGUOUS`, `ANCHOR_STRUCTURE_ONLY`, `ANCHOR_LOST`, `CHOICE_GROUP_GONE`, `CHOICE_GROUP_TWICE`, in that order.

**B21. `isStorageQuota(err)`** is true when `err` is an object whose `failure` is an object with `code` `"STORAGE_QUOTA"`. It is false for `null`, `undefined`, a plain `Error`, a string, and an error carrying a failure with another code.

**B22. `tolerateStorageQuota(run, report)`:**
  - when `run` returns, the result is `null` and `report` is not called;
  - when `run` throws a storage-quota error (B21), `report` is called once with that error's `failure`, and the result is that failure;
  - when `run` throws anything else, the same value is rethrown and `report` is not called;
  - when `report` itself throws a storage-quota error, it is swallowed and the result is still the failure;
  - when `report` throws anything else, that is rethrown;
  - with no `report`, a quota error still returns its failure.

### `contract/style-rules.ts`

**B23. `isStyleId(value)`** is true for a string of 1 to 40 characters made of lowercase letters, digits and hyphens, whose first character is a letter or digit. True: `"sample-dark"`, `"a"`, `"0x"`, and 40 `a`s. False: `"Sample"`, `"-x"`, `""`, 41 `a`s, `"a_b"`, `"../x"`, `42`, `null`.

**B24. The house style.** `RESERVED_ID` is `"international"` and `RESERVED_NAME` is `"International Style"`. `isStyleId(RESERVED_ID)` and `isStyleName(RESERVED_NAME)` are both true.

**B25. `isHexColour(value)`** is true for `#` followed by 3, 4, 6 or 8 hex digits in either case: `"#1f6b3a"`, `"#ABC"`, `"#abcd"`, `"#11223344"`. False: `"#12345"`, `"1f6b3a"`, `"#ggg"`, `"#1234567"`, `42`.

**B26. `isStyleName(value)`** is true for a non-empty string of at most 40 UTF-16 units, with no space at either end, made only of letters and digits of any script, spaces, apostrophes, ampersands and hyphens. True: `"Rock & Roll"`, `"Textbook"`, `"Café Noir"`, `"O'Brien"`. False: `""`, `" "`, `" Textbook"`, `"Textbook "`, `"Use it. Now!"`, `"Ignore previous instructions."`, `"a\nb"`, `"a‮b"`, 41 `x`s, `"(x)"`, `"a:b"`, `42`.

**B27. The limits.** `NAME_MAX` is 40, `DESCRIPTION_MAX` is 300 and `PALETTE_MAX` is 6. `ID_PATTERN` is a `RegExp` that matches exactly what `isStyleId` accepts (the server re-exports it).

### `domain/gestures.ts`

A *decision* is what `gestureFor` returns: `{ gesture, passThrough, preventDefault, reason }`. Below, *taken* means `passThrough: false, preventDefault: true` (the library handles it and the page does not see its default), and *the page's* means `passThrough: true, preventDefault: false`. "Cmd" means `metaKey` or `ctrlKey`; they are one modifier.

**B28. The vocabulary.** `GESTURE` maps these 14 names to these values, and holds nothing else: `COMMENT_ON_SELECTION` `comment_on_selection`, `ENTER_ELEMENT_PICK` `enter_element_pick`, `PICK_ELEMENT` `pick_element`, `EDIT_BLOCK` `edit_block`, `ENTER_EDIT_STATE` `enter_edit_state`, `CLOSE_MENU` `close_menu`, `MARK_READY` `mark_ready`, `COMMIT_EDIT` `commit_edit`, `CANCEL` `cancel`, `TOGGLE_PRESENT` `toggle_present`, `TOGGLE_RAIL` `toggle_rail`, `PAGE_DEFAULT` `page_default`, `PRESS_CHOICE` `press_choice`, `NONE` `none`.

**B29. Every decision is one of three dispositions:** taken, the page's, or neither (`passThrough: false, preventDefault: false`, only for a click inside the overlay). Every decision carries a non-empty `reason` string. Its wording is for a person debugging, and no test pins it.

**B30. The present chord** is Cmd, Shift and the X key (key `"x"` or `"X"`). It decides `TOGGLE_PRESENT`, taken, in every state: on the page, with a selection, with a comment box focused, while a block is edited, in pick mode. X alone, Shift-X and Cmd-X are `NONE`, the page's.

**B31. The rail chord** is Cmd, Shift and the digit-1 key, recognized by `code` `"Digit1"`, or by `key` `"1"` or `"!"`. It decides `TOGGLE_RAIL`, taken, in every state listed in B30. These are `NONE`, the page's: Cmd-1, Shift-1 (`key` `"!"`), a bare 1, Cmd-Shift-2 by key, and Cmd-Shift-2 by code (`key` `"@"`, `code` `"Digit2"`). The present chord with `code` `"KeyX"` is still `TOGGLE_PRESENT`. Both chords are decided before every other keydown rule, so they hold inside comment boxes and while editing.

**B32. Escape:** with the block-type menu open, `CLOSE_MENU`, taken; otherwise while a block is edited or edit state is on, `COMMIT_EDIT`, taken; otherwise in pick mode or with a comment box focused, `CANCEL`, taken; otherwise `NONE`, the page's.

**B33. Enter:**
  - in a comment box, a send press (B41, using the descriptor's `sendKey`) is `MARK_READY`, taken; any other Enter there (Shift-Enter, Alt-Enter, a bare Enter under the Cmd-Enter setting, an Enter that ends an input-method composition) is `NONE`, the page's;
  - outside a comment box, Cmd-Enter while a block is edited is `COMMIT_EDIT`, taken, and Cmd-Enter otherwise is `NONE`, the page's;
  - a bare Enter outside a comment box is `NONE`, the page's, even while a block is edited.

**B34. Cmd-Shift-C,** in either letter case: with a selection, `COMMENT_ON_SELECTION`; without one, `ENTER_ELEMENT_PICK`; both taken. Cmd-C without Shift is `NONE`, the page's.

**B35. Cmd-Shift-E:** when `inBlock` is exactly `false`, `ENTER_EDIT_STATE`; when it is `true` or not given, `EDIT_BLOCK`; both taken. A `code` of `"KeyE"` does not change this.

**B36. Any other keydown,** ordinary typing included, is `NONE`, the page's.

**B37. A pointer going down** (`pointerdown` or `mousedown`) while a block is edited and outside the edited block is `COMMIT_EDIT`, the page's, including a press on the overlay. Two exceptions are `PAGE_DEFAULT`, the page's: a press on a scrollbar (`onScrollbar`), and a press whose `button` is given and is not 0. A press with no `button` counts as primary. A press inside the edited block, or with no edit open, is `PAGE_DEFAULT`, the page's.

**B38. A click:**
  - inside the overlay is `NONE`, neither, whatever else is true;
  - in pick mode is `PICK_ELEMENT`, taken;
  - while a block is edited and outside it is `COMMIT_EDIT`, the page's (a clicked link is still followed);
  - that is a choice press (B39) is `PRESS_CHOICE`, taken;
  - anything else is `PAGE_DEFAULT`, the page's, including an Alt-click and a click inside the edited block.

**B39. A choice press** is a click where `inArmedChoice`, `documentPage` and `mayWrite` are each exactly `true`, and none of `pickMode`, `editing`, `editState` and `presenting` is true. A missing `mayWrite` is not a press. A keydown or a pointer going down on an armed button is never a press.

**B40. The send-key setting.** `SEND_KEY` is `{ ENTER: "enter", MOD_ENTER: "mod_enter" }`. `normalizeSendKey(value)` returns `"mod_enter"` for `"mod_enter"` and `"enter"` for anything else (`undefined`, `"nonsense"`, `1`). `sendKeyLabel` returns `"Cmd-Enter"` for `"mod_enter"` and `"Enter"` otherwise.

**B41. `isSendPress(input)`** is false unless `key` is `"Enter"` and `isComposing` is not true. Then it is true with Cmd under either setting; under the Enter setting it is true unless Shift or Alt is held; under the Cmd-Enter setting it is false. Cases: `{key: "Enter"}` true; with Shift false; composing false; `{key: "a"}` false; `sendKey: "mod_enter"` false; `sendKey: "mod_enter"` with Cmd true; Cmd under the Enter setting true.

**B42. `isSendEvent(event, sendKey)`** is `isSendPress` over the event's key and modifiers, where a press counts as composing when `event.isComposing` is true or `event.keyCode` is 229. `{key: "Enter"}` true; `keyCode: 229` false; `isComposing` false; Shift false; under `"mod_enter"` false, and with Ctrl true.

**B43. The rail's hint lines.** `hintLines(sendKey)` returns these 11 lines, in this order, under the Enter setting. Under the Cmd-Enter setting the sixth line is `{ keys: "Cmd-Enter", hint: "Cmd-Enter when done with this comment." }` and the rest are the same. `TABLE` has one row per line, and the `ENTER_EDIT_STATE` row's `keys` is `"Cmd-Shift-E"` and its `when` is `"the cursor is in no block"`. No line mentions choices.

| # | keys | hint |
| --- | --- | --- |
| 1 | Cmd-Shift-C | Select text and press Cmd-Shift-C to comment on it. |
| 2 | Cmd-Shift-C | Press Cmd-Shift-C with nothing selected, then click any element to comment on the whole thing. |
| 3 | click | Click the outlined element to comment on it. Esc cancels. |
| 4 | Cmd-Shift-E | Press Cmd-Shift-E to edit the block you are in. Just that block. |
| 5 | Cmd-Shift-E | Click + Write here to add text. Esc to finish. |
| 6 | Enter | Enter when done with this comment. Shift-Enter for a new line. |
| 7 | Cmd-Enter, Esc, or a click outside | Cmd-Enter, Esc, or click outside to finish the edit and give the page back. |
| 8 | Esc | Esc closes the comment box or cancels picking. Your draft is kept. |
| 9 | Cmd-Shift-X | Press Cmd-Shift-X to hide the review while you present, and again to bring it back. |
| 10 | Cmd-Shift-1 | Press Cmd-Shift-1 to open or close the review panel. |
| 11 | everything else | Everything else is the page. Links, buttons, and forms work exactly as they do without this. |

**B44. The Keyboard shortcuts panel.** `panelLines(sendKey)` returns these 10 lines, in this order, under the Enter setting. Picking the outlined element is a step inside another gesture and is not in the panel. Under the Cmd-Enter setting the fifth line is `{ keys: "Cmd-Enter", hint: "Send your comment. Enter for a new line." }`.

| # | keys | hint |
| --- | --- | --- |
| 1 | Cmd-Shift-C | Select text and press Cmd-Shift-C to comment on it. |
| 2 | Cmd-Shift-C (no selection) | As you hover over elements, they will be outlined. Click an element to comment on the element. Useful for images and other hard to highlight elements. |
| 3 | Cmd-Shift-E | Select text and press Cmd-Shift-E to edit it by hand. |
| 4 | Cmd-Shift-E (no selection) | As you hover, editable areas will be outlined. Click an area to hand edit it. Esc to finish. |
| 5 | Enter | Send your comment. Shift-Enter for a new line. |
| 6 | Cmd-Enter or Esc | Finish your edit. |
| 7 | Esc | Esc closes the comment box or cancels picking. Half-written drafts are kept in the chat bar. |
| 8 | Cmd-Shift-X | Presentation mode. Toggle hiding the chat bar and the pill. |
| 9 | Cmd-Shift-1 | Toggle the chat bar. |
| 10 | page hotkeys | Other page hotkeys should work as normal. |

**B45. `hintFor(gesture, sendKey)`** returns the hint of that gesture's row in B43, under the given setting, and `null` for a gesture with no row (`PRESS_CHOICE`, `CLOSE_MENU`, `NONE`). `hintFor(MARK_READY)` is "Enter when done with this comment. Shift-Enter for a new line."; `hintFor(MARK_READY, "mod_enter")` is "Cmd-Enter when done with this comment."; `hintFor(ENTER_EDIT_STATE)` is "Click + Write here to add text. Esc to finish."

**B46. `breakIntentFor(input)`** returns `"line"` for `inputType` `insertLineBreak`, with or without Shift; for `insertParagraph`, `"paragraph"`, or `"line"` when Shift is held (WebKit reports Shift-Enter this way); and `null` for anything else (`insertText`, `deleteContentBackward`, `insertFromPaste`, `insertCompositionText`, no `inputType`). `BREAK` is `{ PARAGRAPH: "paragraph", LINE: "line" }`.

**B47. Formatting.** `FORMAT_COMMANDS` is `["bold", "italic"]` and `FORMAT` is `{ APPLY: "apply", REMOVE: "remove" }`. `formatIntentFor({ command, active })` is `null` when the command is not one of the two or is missing; `"remove"` when `active` is true; otherwise `"apply"`.

**B48. Block types.** `BLOCK_TYPES` is these six rows, in this order. `OTHER_BLOCK_LABEL` is `"Other block"`. `blockTypeLabel(tag)` returns the row's label, and `null` for any other tag (`"blockquote"`, `"h1"`).

| tag | label | code | Mac chord | other chord | Markdown shortcuts |
| --- | --- | --- | --- | --- | --- |
| p | Paragraph | Digit0 | Cmd-Option-0 | Ctrl-Shift-0 | none |
| h2 | Heading | Digit2 | Cmd-Option-2 | Ctrl-Shift-2 | `## `, `# ` |
| h3 | Subheading | Digit3 | Cmd-Option-3 | Ctrl-Shift-3 | `### ` |
| h4 | Small heading | Digit4 | Cmd-Option-4 | Ctrl-Shift-4 | `#### ` |
| ul | Bulleted list | Digit8 | Cmd-Shift-8 | Ctrl-Shift-8 | `- `, `* ` |
| ol | Numbered list | Digit7 | Cmd-Shift-7 | Ctrl-Shift-7 | `1. ` |

**B49. `blockTypeChord(input)`** returns a tag, or `null`. It matches on `code`, so the character the key types never matters (Cmd-Option-2 types "™" on a US Mac and still matches).
  - On `platform: "mac"`: Cmd without Ctrl, plus Option without Shift, for `p`, `h2`, `h3`, `h4`; Cmd without Ctrl, plus Shift without Option, for `ul` and `ol`.
  - On any other platform: Ctrl with Shift, without Cmd and without Alt.
  - Always `null`: AltGraph held; Ctrl-Alt with a digit; the other system's modifier; Cmd-2 alone; `Digit1`; a code no row has (`KeyE`, `KeyC`, `KeyX`, `Digit5`); Cmd-Shift with `Digit3` or `Digit4` on a Mac. No Mac chord in the table is Cmd-Shift-E, C, X, 1, 3, 4 or 5.

**B50. `chordLabelFor(tag, platform)`** returns the row's Mac chord for `"mac"` and its other chord for `"other"`, and `null` for a tag with no row.

**B51. `markdownShortcutFor(textBeforeCaret)`** returns the tag whose shortcuts (B48) include the text exactly: `"# "` and `"## "` give `h2`, `"### "` `h3`, `"#### "` `h4`, `"- "` and `"* "` `ul`, `"1. "` `ol`. A no-break space counts as a space: `"## "` gives `h2`. `"#"`, `"##### "`, `"a # "` and `"2. "` give `null`.

**B52. `enterIntentFor(input)`:** Shift held is `"line"`; else `runAllowed` exactly `false` is `"break_rule"`; else in a list item, an empty last item is `"end_list"` and any other item `"new_item"`; else at the end of the block `"sibling"`, otherwise `"split"`. `ENTER` maps `SIBLING`, `SPLIT`, `NEW_ITEM`, `END_LIST`, `LINE`, `BREAK_RULE` to those values.

**B53. `edgeDeleteFor(input)`:** a key other than Backspace or Delete is `null`. A selection that is not collapsed (`collapsed` exactly `false`) is `"delete_selection"` when it spans blocks and `null` otherwise. Backspace at a block's start is `"refuse"` in the session's first block and `"merge_previous"` otherwise; Backspace elsewhere is `null`. Delete at a block's end is `"refuse"` in the session's last block and `"merge_next"` otherwise; Delete elsewhere is `null`. `EDGE` maps `MERGE_PREVIOUS`, `MERGE_NEXT`, `DELETE_SELECTION`, `REFUSE` to those values.

**B54. `historyIntentFor(input)`:** `null` unless `editing` is true. Then `inputType` `historyUndo` is `"undo"` and `historyRedo` is `"redo"`. Otherwise it needs Cmd and no Alt: Z (`code` `KeyZ` or `key` `z`) is `"undo"`, or `"redo"` with Shift; off a Mac, Ctrl-Y (`code` `KeyY` or `key` `y`) is `"redo"`; anything else is `null`. `HISTORY` is `{ UNDO: "undo", REDO: "redo" }`.

**B55. `isScrollbarPress(geometry)`** is true when `contentWidth` is above 0 and `x` is at least `contentWidth` and at most `boxWidth`, or the same holds for `y` against the heights. Cases: a 200-wide box with 185 of content is true at x 192 and false at x 184 and x 260; a horizontal gutter is true at y 92 with content height 85 and box height 100; the root's scrollbar is true at x 1272 with content 1265 and box 1280; a box with no gutter (content equals box) is false at its last pixel.

### `browser/review-layer/editing/write-epoch.ts`

**B56. A new epoch** is not writing, and `epoch()` is 0.

**B57. `write(reason, fn)`** runs `fn` once, synchronously, and returns what `fn` returns. Inside `fn`, `isWriting()` is true.

**B58. The epoch closes on a microtask, not when `write` returns.** Right after `write` returns, `isWriting()` is still true. A microtask queued inside `fn` (the way a MutationObserver's callback is queued by a mutation) sees `isWriting()` true. By the next task, `isWriting()` is false, and a microtask queued after that sees false.

**B59. Nested writes** keep the epoch open until the outermost one has closed.

**B60. When `fn` throws,** the same error propagates, the epoch still closes by the next task, and `epoch()` still advances.

**B61. `epoch()`** advances by exactly one per `write`.

**B62. An owed pass is remembered once.** After `noteExternalMutation()`, `takePendingExternal()` returns true, and the next call returns false.

**B63. `onIdle(listener)`.** When a write closes the epoch (the depth returns to zero) while a mutation is owed, every listener is called once, with no arguments, whichever caller opened the epoch. No listener is called when nothing is owed, nor while the epoch is still open. The owed flag stays set until `takePendingExternal` takes it. `onIdle` returns a function that removes the listener; calling it twice is harmless.

**B64. A write must name its caller.** `write("", fn)` throws a `TypeError` whose message matches `/reason must be/`, without running `fn` and without opening the epoch.

**B65. One epoch per page.** The module's own `write`, `isWriting`, `epoch`, `noteExternalMutation`, `takePendingExternal` and `onIdle` act on one epoch that every importer shares, so a write through one import is seen through another. `createEpoch()` makes an independent epoch: writing in it leaves the page's epoch closed.

## 3. Callers

Every file that imports these modules today, from `callers.py`. In the browser, the layer files receive each module as a factory argument from `window.LAHE`; the column lists the exports each reads. "Breaks" marks a file this spec forces to change.

| File | Module | Exports it reads | Effect of this spec |
| --- | --- | --- | --- |
| `src/layer/anchor.js` | markers | `STAMP_ATTR`, `isToolAttrName`, `isToolNode` | none |
| `src/layer/blocks.js` | markers | `OVERLAY_ROOT_ID`, `ROLE_CHROME`, `isFileTitle`, `roleOf` | none |
| `src/layer/choices.js` | epoch | `write` | none |
| `src/layer/choices.js` | failures | `failure` | none |
| `src/layer/choices.js` | gestures | `GESTURE`, `gestureFor` | none |
| `src/layer/comments.js` | failures | `tolerateStorageQuota` | none |
| `src/layer/comments.js` | gestures | `GESTURE`, `gestureFor`, `hintFor` | none |
| `src/layer/comments.js` | markers | `isInsideOverlay`, `isToolNode`, `markChrome` | none |
| `src/layer/editing.js` | epoch | `write` | none |
| `src/layer/editing.js` | failures | `tolerateStorageQuota` | none |
| `src/layer/editing.js` | gestures | `BLOCK_TYPES`, `BREAK`, `EDGE`, `ENTER`, `FORMAT`, `GESTURE`, `HISTORY`, `OTHER_BLOCK_LABEL`, `blockTypeChord`, `breakIntentFor`, `chordLabelFor`, `edgeDeleteFor`, `enterIntentFor`, `formatIntentFor`, `gestureFor`, `historyIntentFor`, `isScrollbarPress`, `markdownShortcutFor` | none: it reads `tag`, `label` and `chords` of `BLOCK_TYPES` rows, never `markdown` |
| `src/layer/editing.js` | markers | `EDIT_HOST_ATTR`, `TOOL_ATTR`, `isInsideOverlay`, `markChrome` | none |
| `src/layer/export.js` | failures | `failure` | none |
| `src/layer/highlight.js` | markers | `EDIT_HOST_ATTR`, `OVERLAY_ROOT_ID`, `markChrome` | none |
| `src/layer/index.js` | failures | `failure`, `tolerateStorageQuota` | none |
| `src/layer/index.js` | gestures | `GESTURE`, `gestureFor` | none |
| `src/layer/index.js` | markers | `OVERLAY_ROOT_ID`, `isInsideOverlay` | none |
| `src/layer/inject.js` | failures | `failure` | none |
| `src/layer/inject.js` | markers | `OVERLAY_ROOT_ID` | none |
| `src/layer/overlay.js` | failures | `chipAction`, `failure`, `isCopyable`, `tolerateStorageQuota` | none |
| `src/layer/overlay.js` | gestures | `BLOCK_TYPES`, `OTHER_BLOCK_LABEL`, `SEND_KEY`, `normalizeSendKey`, `panelLines`, `sendKeyLabel` | none |
| `src/layer/overlay.js` | markers | `FILE_TITLE_ATTR`, `FILE_TITLE_VALUE`, `OVERLAY_ROOT_ID`, `RENDER_NOTE_NAME`, `isInsideOverlay`, `markChrome` | none |
| `src/layer/protect.js` | epoch | `isWriting`, `write` | none |
| `src/layer/protect.js` | markers | `AUTHOR_REGION_ATTR`, `PROTECTED_ATTR`, `TURBO_PERMANENT_ATTR` | none |
| `src/layer/replay.js` | epoch | `epoch`, `isWriting`, `shared`, `write` | **breaks**: `epoch.shared.noteExternalMutation()` (line 372), the guard and call at 450-451, and `epoch.shared.onIdle` and `takePendingExternal` at 472-474 become `epoch.noteExternalMutation()`, `epoch.takePendingExternal()` and `epoch.onIdle(...)`; the `typeof` guards around them go |
| `src/layer/replay.js` | failures | `ANCHOR_FAILURE_CODES`, `failure` | none |
| `src/layer/replay.js` | markers | `STAMP_ATTR`, `isToolNode` | none |
| `src/layer/store.js` | failures | `failure` | none: it builds the quota error that B21 recognizes |
| `src/layer/style_switch.js` | markers | `isInsideOverlay`, `markChrome` | none |
| `src/layer/style_switch.js` | style_rules | `DESCRIPTION_MAX`, `PALETTE_MAX`, `RESERVED_ID`, `RESERVED_NAME`, `isHexColour`, `isStyleId`, `isStyleName` | none |
| `src/layer/sync.js` | failures | `canonical`, `describe`, `failure`, `tolerateStorageQuota` | none |
| `src/layer/sync.js` | markers | `isInsideOverlay` | none |
| `src/layer/tab_active.js` | gestures | `hintLines`, `isSendEvent`, `sendKeyLabel` | none |
| `src/layer/tab_active.js` | markers | `markChrome` | none |
| `src/layer/tab_done.js` | failures | `ANCHOR_FAILURE_CODES`, `failure` | none |
| `src/layer/tab_done.js` | gestures | `isSendEvent` | none |
| `src/layer/tab_done.js` | markers | `markChrome` | none |
| `src/layer/tab_edits.js` | markers | `markChrome` | none |
| `src/layer/zoom.js` | markers | `isInsideOverlay`, `markChrome` | none |
| `src/service/markdown.js` | markers | `FILE_TITLE_ATTR`, `FILE_TITLE_VALUE`, `RENDER_NOTE_NAME` | none |
| `src/service/review_writer.js` | failures | `failure` | none |
| `src/service/styles.js` | style_rules | `DESCRIPTION_MAX`, `ID_PATTERN`, `NAME_MAX`, `PALETTE_MAX`, `RESERVED_ID`, `RESERVED_NAME`, `isHexColour`, `isStyleId`, `isStyleName` | none |
| `src/shared/normalize.js` | markers | `FILE_TITLE_ATTR`, `FILE_TITLE_VALUE`, `OVERLAY_ROOT_ID`, `ROLE_CHROME`, `ROLE_WRAP`, `TOOL_ATTR`, `isToolAttrName`, `isToolClassToken`, `isToolNode` | none |
| `src/shared/protocol.js` | failures | `failure` | none |
| `src/shared/regions.js` | markers | `AUTHOR_REGION_ATTR` | none |
| `src/shared/review_format.js` | gestures | `blockTypeLabel` | none |
| `src/shared/contracts.js` | all five | the module objects, re-exported | none: the forwarders carry it until C5 removes it |
| `src/shared/manifest.js` | all five | their paths | **changes**: five `LAYER_FILES` paths and five `FORWARDERS` entries |
| `test/browser/comments_highlights.spec.js` | gestures | `hintLines`, read in the page from `window.LAHE.gestures` | none: the registration keeps the name |
| `test/browser/rail_menu.spec.js` | gestures | `panelLines`, by `require` of the old path inside the spec | none expected; see Open questions |
| `test/fixtures/assets/cp1-boot.js` | markers | `OVERLAY_ROOT_ID`, read from `window.LAHE.markers` | none |
| `test/fixtures/assets/rail-harness.js` | failures | `failure`, read from `window.LAHE.failures` | none |
| `test/unit/choice_kernel.test.js` | failures | `CODES` (or `CHOICE_REFUSED`), as a truth check | none |
| `test/unit/choice_kernel.test.js` | gestures | `GESTURE`, `TABLE`, `gestureFor`, `hintFor`, `hintLines`, `panelLines` | four cases move out |
| `test/unit/clean_block.test.js` | failures | `describe` | none |
| `test/unit/comments_surface.test.js` | gestures | `GESTURE`, `SEND_KEY`, `hintFor` | none |
| `test/unit/done_tab_replies.test.js` | failures | `ANCHOR_FAILURE_CODES`, `failure` | none |
| `test/unit/editing_run.test.js` | gestures | `GESTURE`, `TABLE` | none |
| `test/unit/editing_run.test.js` | markers | `EDIT_HOST_ATTR` | none |
| `test/unit/editing_surface.test.js` | gestures | `BREAK`, `FORMAT`, `FORMAT_COMMANDS`, `GESTURE`, `breakIntentFor`, `formatIntentFor`, `gestureFor` | four cases move out |
| `test/unit/epoch.test.js` | epoch | `createEpoch`, `isWriting`, `shared` | **moves** with `git mv` and is rewritten |
| `test/unit/export_text.test.js` | failures | `CODE_NAMES`, `SURFACE`, `describe` | none; a fixed behavior test, so these three names stay |
| `test/unit/fix_round_f3_projection.test.js` | gestures | `BLOCK_TYPES`, `blockTypeLabel` | none |
| `test/unit/harness_stub_vocabulary.test.js` | gestures | `GESTURE` | none |
| `test/unit/launch_by_kind.test.js` | failures | `CODES`, as a truth check | none |
| `test/unit/leaf_blocks.test.js` | markers | `EDIT_HOST_ATTR`, `FILE_TITLE_ATTR`, `FILE_TITLE_VALUE`, `isFileTitle` | one case moves out |
| `test/unit/markdown_render.test.js` | markers | `FILE_TITLE_ATTR`, `FILE_TITLE_VALUE` | none |
| `test/unit/normalize.test.js` | markers | `STAMP_ATTR`, `isToolAttrName` | none |
| `test/unit/pandoc_render.test.js` | markers | `FILE_TITLE_ATTR`, `FILE_TITLE_VALUE`, `RENDER_NOTE_NAME` | none |
| `test/unit/present_mode.test.js` | gestures | `GESTURE`, `TABLE`, `gestureFor`, `hintLines` | three cases move out |
| `test/unit/protect_vocabulary.test.js` | markers | `AUTHOR_REGION_ATTR`, `TURBO_PERMANENT_ATTR` | none |
| `test/unit/protocol_wire.test.js` | failures | `CODE_NAMES`, `canonical`, `describe`, `failure` | three cases move out |
| `test/unit/rail_hotkey.test.js` | gestures | `GESTURE`, `TABLE`, `gestureFor`, `hintFor`, `hintLines` | **moves** with `git mv` to `test/unit/domain/gestures.test.ts` |
| `test/unit/regions_gestures.test.js` | gestures | most of the module, and `BLOCK_TYPES[].markdown` | **breaks**: the gesture half moves out; the regions half stays for C5 |
| `test/unit/remount_contract.test.js` | failures | `failure` | none |
| `test/unit/remount_contract.test.js` | markers | `OVERLAY_ROOT_ID` | none |
| `test/unit/replay_pass.test.js` | epoch | `isWriting`, `write` | none |
| `test/unit/replay_scheduler.test.js` | epoch | `shared` | **breaks**: `epoch.shared.X` becomes `epoch.X` at each use |
| `test/unit/reverted_edit.test.js` | markers | `markChrome` | none: its fake node has `setAttribute` |
| `test/unit/run_record.test.js` | failures | `describe` | none |
| `test/unit/session_fixes.test.js` | failures | `CHIP_ACTIONS`, `COPYABLE`, `chipAction`, `describe`, `isCopyable` | **breaks**: the one case that reads `CHIP_ACTIONS` and `COPYABLE` is dropped; three failure cases and three gesture cases move out |
| `test/unit/storage_quota_typing.test.js` | failures | `SURFACE`, `failure`, `isStorageQuota`, `tolerateStorageQuota` | three cases move out |
| `test/unit/style_switch.test.js` | style_rules | `RESERVED_ID`, `RESERVED_NAME`, `isHexColour`, `isStyleId`, `isStyleName` | none |
| `test/unit/styles.test.js` | style_rules | `DESCRIPTION_MAX`, `NAME_MAX`, `PALETTE_MAX`, `RESERVED_ID`, `isHexColour`, `isStyleId`, `isStyleName` | **breaks**: line 712 reads the old file's text (section 8) |
| `test/unit/sync_client.test.js` | failures | `failure` | none |

Two identity checks rely on the forwarders returning the same module object the callers got: `styles.test.js` asserts `styles.isStyleId === rules.isStyleId`, and `style_switch.test.js` asserts the switch's functions are the shared ones. A forwarder that `require`s the `.ts` file keeps that true, because Node caches the module.

No caller writes to any of these modules' exports, so ES module namespace objects, which are read-only, stand in for the old objects (checked with a grep for assignments to their members).

## 4. Module design

All five modules: named exports only, erasable syntax only (no `enum`, no `namespace`, no parameter properties), no top-level `await`, no `as` casts other than `as const`, no `!`, no `any`. Each starts with the `read-when` header drafted here. Exported functions state their return types (`isolatedDeclarations`). Where `isolatedDeclarations` refuses an inferred constant (a spread or a call in an initializer), annotate it with the type named here.

### `src/contract/markers.ts`

One job: the names that say a node is Lahe's, and the questions asked with them.

Header: `read-when: Changing an attribute, class or id that marks what Lahe added to a page, or checking whether a node is Lahe's.`

```ts
export type ToolAttribute = `data-lahe${string}`;

export const TOOL_ATTR = "data-lahe";                          // satisfies ToolAttribute
export const STAMP_ATTR = "data-lahe-id";                      // satisfies ToolAttribute
export const PROTECTED_ATTR = "data-lahe-protected";           // satisfies ToolAttribute
export const FILE_TITLE_ATTR = "data-lahe-file-title";         // satisfies ToolAttribute
export const EDIT_HOST_ATTR = "data-lahe-edit-host";           // satisfies ToolAttribute
export const FILE_TITLE_VALUE = "file-name";
export const ROLE_CHROME = "chrome";
export const ROLE_WRAP = "wrap";
export const OVERLAY_ROOT_ID = "lahe-surface-root";
export const TURBO_PERMANENT_ATTR = "data-turbo-permanent";
export const AUTHOR_REGION_ATTR = "data-review-region";
export const RENDER_NOTE_NAME = "lahe-render-note";

export type ToolRole = typeof ROLE_CHROME | typeof ROLE_WRAP;

export interface MarkedNode {
  readonly nodeType?: number;
  readonly id?: string;
  readonly parentNode?: MarkedNode | null;
  getAttribute?(name: string): string | null;
}
export interface AttributeWriter {
  setAttribute(name: string, value: string): void;
}

export function isToolAttrName(name: string): boolean;
export function isToolClassToken(token: string): boolean;
export function roleOf(node: MarkedNode | null): ToolRole | null;
export function isToolNode(node: MarkedNode | null): boolean;
export function isInsideOverlay(node: MarkedNode | null): boolean;
export function isFileTitle(node: MarkedNode | null): boolean;
export function markChrome<T extends AttributeWriter>(el: T): T;
```

The comments above are notes for this page; the source carries no comments. Use `satisfies ToolAttribute` on the five tool attributes, so a tool attribute that would not be stripped on capture fails to compile.

- `MarkedNode` is structural because `contract` has no DOM types. A DOM `Element`, `Text` and `ParentNode` all fit it with no cast, and so do the fake nodes the unit tests build. The optional `getAttribute` is how a text node is told apart (`node?.getAttribute?.(...)`), which replaces the old `typeof el.getAttribute === "function"` checks.
- `null` stays allowed in the node questions because callers pass `event.target` and walk results. A browser caller holding an `EventTarget` narrows it to a `Node` first, at its own boundary.
- `TOOL_ATTR_PREFIX` and `TOOL_CLASS_PREFIX` stay as module constants with no export; no caller reads them. `markWrap` is not carried (D4).
- Nothing in this module parses untrusted input.

### `src/contract/failures.ts`

One job: the closed list of things that can fail, each with its words, its place and what its chip may offer, and the failure object built from them.

Header: `read-when: Adding or changing a failure code, its words or its chip, or finding what a failure in the rail, on a card or in the CLI means.`

```ts
export const SEVERITY = { BLOCKING: "blocking", WARNING: "warning", INFO: "info" } as const;
export type Severity = (typeof SEVERITY)[keyof typeof SEVERITY];

export const SURFACE = { FAILURES_LIST: "failures_list", CARD: "card", CLI: "cli" } as const;
export type Surface = (typeof SURFACE)[keyof typeof SURFACE];

export const CODE_NAMES = ["HELPER_UNREACHABLE", /* the 49, in B10's order */] as const;
export type FailureCode = (typeof CODE_NAMES)[number];

export const ALIASES = {
  SYNC_SERVICE_DOWN: "HELPER_UNREACHABLE",
  CLI_NO_SERVICE: "HELPER_UNREACHABLE",
  SYNC_POLICY_REFUSED: "CSP_REFUSED",
  SECOND_TAB_REFUSED: "SECOND_WINDOW_REFUSED",
  ANCHOR_SUBJECT_GONE: "ANCHOR_LOST",
  ANCHOR_NOT_FOUND: "ANCHOR_LOST"
} as const satisfies Readonly<Record<string, FailureCode>>;
export type FailureAlias = keyof typeof ALIASES;
export type FailureName = FailureCode | FailureAlias;

export type ChipActionName = "takeover";
export interface ChipAction { readonly label: string; readonly action: ChipActionName; }
export type ChipOffer =
  | { readonly kind: "none" }
  | { readonly kind: "copy" }
  | ({ readonly kind: "action" } & ChipAction);

export interface FailureDefinition {
  readonly severity: Severity;
  readonly persistent: boolean;
  readonly surface: Surface;
  readonly message: string;
  readonly remedy: string | null;
  readonly standing: boolean;
  readonly offer: ChipOffer;
}

export const CODES: { readonly [Code in FailureCode]: FailureDefinition };

export type FailureDetail =
  | string | number | boolean | null
  | readonly FailureDetail[]
  | { readonly [key: string]: FailureDetail };

export interface Failure {
  readonly code: FailureName;
  readonly canonical_code: FailureCode;
  readonly severity: Severity;
  readonly persistent: boolean;
  readonly standing: boolean;
  readonly surface: Surface;
  readonly message: string;
  readonly remedy: string | null;
  readonly detail: FailureDetail;
  readonly at: string;
}

export interface StorageQuotaError { readonly failure: Failure; }

export const ANCHOR_FAILURE_CODES: readonly FailureCode[];

export function isFailureName(value: unknown): value is FailureName;
export function canonical(name: FailureName): FailureCode;
export function describe(name: FailureName): FailureDefinition;
export function failure(name: FailureName, detail?: FailureDetail): Failure;
export function chipAction(code: string): ChipAction | null;
export function isCopyable(code: string): boolean;
export function isStorageQuota(err: unknown): err is StorageQuotaError;
export function tolerateStorageQuota(run: () => void, report?: (failure: Failure) => void): Failure | null;
```

- **The code list is the source of the type, and the table is checked against it.** `CODE_NAMES` is a literal tuple, `FailureCode` derives from it, and `CODES` is annotated with the mapped type, so a code in the list with no row, or a row with no code, fails to compile. This reverses the old derivation (`Object.keys(CODES)`), which cannot give a typed list without a cast.
- **What a chip may offer and whether a code is standing live in the code's own row** (`standing`, `offer`), not in three side tables. `ChipOffer` is a union, so a code cannot be both copyable and carry an action: the old comment's rule ("never on a chip that has its own action") becomes a type. Rows may be written through a small helper that fills `standing: false` and `offer: { kind: "none" }`, so the 49 rows stay readable.
- `chipAction` and `isCopyable` take `string`, because the rail asks them about chip codes it read back from browser storage, which may be an old spelling or a code that no longer exists. They return `null` and `false` for anything `isFailureName` refuses.
- `canonical`, `describe` and `failure` take `FailureName`. A typed caller cannot pass anything else, so the throw in B15 is reachable only from the JavaScript callers of the mixed period; keep it, since those callers and data read from storage still exist.
- `isFailureName` is the boundary guard: it checks own properties of the code table and the alias table, so `"toString"` and `"__proto__"` are refused.
- `FailureDetail` is a JSON value, because a failure's detail travels into helper error bodies and browser storage. Callers pass strings, `null`, and small objects such as `{ verdict, candidates, survivors }` and `{ item, helper_code, reason }`; all fit.
- `isStorageQuota` checks that `err` is an object with a `failure` object whose `code` is `"STORAGE_QUOTA"`. It trusts the rest of the failure, because only `failure()` makes these objects (the store wraps `failure("STORAGE_QUOTA", ...)` in its own error). Say so in the folder doc.
- `isPersistent` and `ALIAS_NAMES` are not carried (D4), and neither are `CHIP_ACTIONS` and `COPYABLE` (D2).
- `failure()` reads the clock. No clock is injected; tests check `at` lies between two readings.

### `src/contract/style-rules.ts`

One job: what counts as a style id, a palette colour and a style name.

Header: `read-when: Changing what counts as a valid style id, palette colour or style name.`

```ts
declare const styleIdBrand: unique symbol;
declare const hexColourBrand: unique symbol;
declare const styleNameBrand: unique symbol;
export type StyleId = string & { readonly [styleIdBrand]: true };
export type HexColour = string & { readonly [hexColourBrand]: true };
export type StyleName = string & { readonly [styleNameBrand]: true };

export const ID_PATTERN: RegExp;            // /^[a-z0-9][a-z0-9-]{0,39}$/
export const RESERVED_ID = "international";
export const RESERVED_NAME = "International Style";
export const NAME_MAX = 40;
export const DESCRIPTION_MAX = 300;
export const PALETTE_MAX = 6;

export function isStyleId(value: unknown): value is StyleId;
export function isHexColour(value: unknown): value is HexColour;
export function isStyleName(value: unknown): value is StyleName;
```

- The three checks are the parsers for a boundary: an id arrives from five places outside Lahe's own code, and a palette value and a name arrive from a style folder's `metadata.json`. They take `unknown` and narrow to a branded type, so later typed code can require a checked id rather than any string. The brand form is the builder's choice, as long as it needs no cast; a type predicate narrows without one.
- The hex and name patterns stay module constants with no export (D4). The name pattern is `/^[\p{L}\p{N} '&-]+$/u`.
- The source spells no raw bidi control character (section 8).

### `src/domain/gestures.ts`

One job: what a reviewer's key, click or input means, decided as a pure function of a plain description of it, plus the hint words that teach the keys.

Header: `read-when: Changing a keyboard shortcut, a click rule, a hint line, or what Enter, Backspace, B, I or undo mean while writing on the page.`

It stays one module. The browser registers it under the one name `LAHE.gestures`, and its old callers read everything through that one object. Splitting the block-type table or the editing intents into a second file would need a re-export to keep that object whole, which is a layer with no job. Once `editing.js` and `overlay.js` are converted (slices B6 and B11), a split can be done without one; that is noted for those slices, not done here.

```ts
export const GESTURE = { COMMENT_ON_SELECTION: "comment_on_selection", /* the 14 of B28 */ } as const;
export type Gesture = (typeof GESTURE)[keyof typeof GESTURE];

export type Disposition =
  | { readonly passThrough: false; readonly preventDefault: true }
  | { readonly passThrough: true; readonly preventDefault: false }
  | { readonly passThrough: false; readonly preventDefault: false };
export type GestureDecision = { readonly gesture: Gesture; readonly reason: string } & Disposition;

export const SEND_KEY = { ENTER: "enter", MOD_ENTER: "mod_enter" } as const;
export type SendKey = (typeof SEND_KEY)[keyof typeof SEND_KEY];

export interface Modifiers { readonly metaKey?: boolean; readonly ctrlKey?: boolean; readonly shiftKey?: boolean; readonly altKey?: boolean; }
export interface ReviewState {
  readonly hasSelection?: boolean; readonly inOverlay?: boolean; readonly pickMode?: boolean;
  readonly editing?: boolean; readonly editState?: boolean; readonly inEditedBlock?: boolean;
  readonly inCommentBox?: boolean; readonly blockMenuOpen?: boolean; readonly inBlock?: boolean;
  readonly sendKey?: SendKey; readonly presenting?: boolean; readonly mayWrite?: boolean;
  readonly documentPage?: boolean; readonly inArmedChoice?: boolean;
}
export type GestureInput =
  | ({ readonly type: "keydown"; readonly key?: string; readonly code?: string; readonly isComposing?: boolean } & Modifiers & ReviewState)
  | ({ readonly type: "pointerdown" | "mousedown"; readonly button?: number | null; readonly onScrollbar?: boolean } & Modifiers & ReviewState)
  | ({ readonly type: "click" } & Modifiers & ReviewState);

export interface HintRow {
  readonly gesture: Gesture; readonly keys: string; readonly when: string; readonly hint: string;
  readonly panelKeys?: string; readonly panelHint?: string; readonly inPanel?: false;
}
export interface HintLine { readonly keys: string; readonly hint: string; }
export const TABLE: readonly HintRow[];

export const BREAK = { PARAGRAPH: "paragraph", LINE: "line" } as const;          export type BreakIntent = ...;
export const FORMAT = { APPLY: "apply", REMOVE: "remove" } as const;             export type FormatIntent = ...;
export const FORMAT_COMMANDS = ["bold", "italic"] as const;                      export type FormatCommand = ...;
export const ENTER = { SIBLING: "sibling", SPLIT: "split", NEW_ITEM: "new_item", END_LIST: "end_list", LINE: "line", BREAK_RULE: "break_rule" } as const; export type EnterIntent = ...;
export const EDGE = { MERGE_PREVIOUS: "merge_previous", MERGE_NEXT: "merge_next", DELETE_SELECTION: "delete_selection", REFUSE: "refuse" } as const; export type EdgeIntent = ...;
export const HISTORY = { UNDO: "undo", REDO: "redo" } as const;                  export type HistoryIntent = ...;

export type Platform = "mac" | "other";
export interface BlockTypeRow {
  readonly tag: string; readonly label: string; readonly code: string;
  readonly chords: { readonly mac: string; readonly other: string };
  readonly shortcuts: readonly string[];
}
export const BLOCK_TYPES: readonly [ /* the six rows of B48, as const */ ];
export type BlockTag = (typeof BLOCK_TYPES)[number]["tag"];
export const OTHER_BLOCK_LABEL = "Other block";

export function gestureFor(input: GestureInput): GestureDecision;
export function hintFor(gesture: Gesture, sendKey?: SendKey): string | null;
export function hintLines(sendKey?: SendKey): readonly HintLine[];
export function panelLines(sendKey?: SendKey): readonly HintLine[];
export function normalizeSendKey(value: unknown): SendKey;
export function sendKeyLabel(sendKey?: SendKey): string;
export function isSendPress(input: { readonly key?: string; readonly isComposing?: boolean; readonly sendKey?: SendKey } & Modifiers): boolean;
export function isSendEvent(event: KeyEventLike, sendKey?: SendKey): boolean;
export function breakIntentFor(input: { readonly inputType?: string; readonly shiftKey?: boolean }): BreakIntent | null;
export function formatIntentFor(input: { readonly command?: string; readonly active?: boolean }): FormatIntent | null;
export function blockTypeLabel(tag: string): string | null;
export function blockTypeChord(input: ChordInput): BlockTag | null;
export function chordLabelFor(tag: string, platform: Platform): string | null;
export function markdownShortcutFor(textBeforeCaret: string): BlockTag | null;
export function enterIntentFor(input: EnterInput): EnterIntent;
export function edgeDeleteFor(input: EdgeInput): EdgeIntent | null;
export function historyIntentFor(input: HistoryInput): HistoryIntent | null;
export function isScrollbarPress(geometry: ScrollbarGeometry): boolean;
```

`KeyEventLike` is `{ key?, metaKey?, ctrlKey?, shiftKey?, altKey?, isComposing?, keyCode? }`, which a DOM `KeyboardEvent` fits. `ChordInput` is `{ code?, key?, altGraph?, platform? }` with `Modifiers`. `EnterInput`, `EdgeInput`, `HistoryInput` and `ScrollbarGeometry` list the fields B52 to B55 name, each optional except the geometry's six numbers. Export the input types too, so typed callers can build them.

- **`gestureFor` takes a union keyed on `type`,** and its body is a `switch` on `type` that the exhaustiveness rule checks. The old fall-through for any other `type` ("not a click or a keydown") cannot be reached and is not carried (D7).
- **The descriptor keeps the old field names.** Four layer files build these descriptors, and renaming them would edit every call for no gain. The one tri-state is kept as it was: only `inBlock: false` means the caret is in no block.
- **`Disposition` makes the fourth combination unrepresentable:** nothing is both passed to the page and prevented.
- **`sendKey` is typed `SendKey`, but the code compares it with `"mod_enter"` rather than switching on it,** so a JavaScript caller that passes a stored value that is not a send key still gets the Enter behavior, as before. `normalizeSendKey` is the parser for the store's value.
- **The `MARK_READY` row takes its keys and words from the send-key words for Enter,** so the default words are spelled once. `rowFor` (the row as a given setting spells it) is internal.
- **Each block type lists its Markdown shortcuts,** and `markdownShortcutFor` reads them, so the menu's rows and the shortcuts are one table (D6). The no-break space is spelled ` ` in the source.
- **`TABLE` rows drop `passThrough`, `preventDefault` and `requirement`** (D5).
- `isPrimaryModifier` and `isKey` stay internal (D4).

### `src/browser/review-layer/editing/write-epoch.ts`

One job: the depth counter that tells the page's mutation observer when a mutation is Lahe's own, and the wake-up when one that was not got refused.

Header: `read-when: Changing how Lahe's own page writes are kept from retriggering replay, or when replay loops or a repaint never gets its pass.`

```ts
export interface WriteEpoch {
  write<T>(reason: string, fn: () => T): T;
  isWriting(): boolean;
  epoch(): number;
  noteExternalMutation(): void;
  takePendingExternal(): boolean;
  onIdle(listener: () => void): () => void;
}
export function createEpoch(): WriteEpoch;

export function write<T>(reason: string, fn: () => T): T;
export function isWriting(): boolean;
export function epoch(): number;
export function noteExternalMutation(): void;
export function takePendingExternal(): boolean;
export function onIdle(listener: () => void): () => void;
```

- The page's epoch is one `createEpoch()` made when the module loads, and the six module functions delegate to it. That replaces the old pair of surfaces (`epoch.shared.X` and the four delegates), which let replay reach the same epoch two ways (D3).
- The close is queued with `queueMicrotask`. The old `defer` option, which no test used, and the `Promise` fallback for engines without `queueMicrotask` are not carried (D3).
- `reason` is checked at run time, because the type `string` admits `""`. The reasons are not recorded any more: `currentReasons()` had no caller (D3). `fn` and `listener` are not checked at run time; the types guarantee them.
- The counter state lives inside `createEpoch`'s closure. Nothing at module level is mutable except the one page epoch it makes.

### Exported names that change, and what each caller does

| Old | New | Why | Callers to change |
| --- | --- | --- | --- |
| `epoch.shared.noteExternalMutation`, `.takePendingExternal`, `.onIdle` | `epoch.noteExternalMutation`, `epoch.takePendingExternal`, `epoch.onIdle` | one way to reach the page's epoch | `src/layer/replay.js` (three places, and drop its `typeof` guards), `test/unit/replay_scheduler.test.js` |
| `epoch.shared` | gone | as above | the same two files, and the old epoch test |
| `epoch.createEpoch(options)` | `createEpoch()` | `defer` was never passed | none |
| `epoch.shared.currentReasons` | gone | no caller | none |
| `failures.CHIP_ACTIONS`, `failures.COPYABLE` | gone; each code's row has `offer` | one place per code | `test/unit/session_fixes.test.js` (its case is dropped) |
| `failures.ALIAS_NAMES`, `failures.isPersistent` | gone | no caller | none |
| `failures.CODES` rows | gain `standing` and `offer` | as above | none: callers only test a row is present |
| `gestures.TABLE` rows | lose `passThrough`, `preventDefault`, `requirement` | never read, and duplicated `gestureFor` | none |
| `gestures.BLOCK_TYPES[].markdown` | `shortcuts` (a list) | one table for menu and shortcuts | `test/unit/regions_gestures.test.js` (that case moves) |
| `gestures.isPrimaryModifier` | not exported | no caller | none |
| `markers.markWrap`, `markers.TOOL_ATTR_PREFIX`, `markers.TOOL_CLASS_PREFIX` | not exported | no caller | none |
| `styleRules.HEX`, `styleRules.NAME_CHARS` | not exported | no caller | none |

Every other export keeps its name, including the three `export_text.test.js` reads (`CODE_NAMES`, `SURFACE`, `describe`).

## 5. Old tests, accounted for

Every unit test case that reads one of these modules directly or through a helper in its own file, found by `test_cases.py` over `test/unit/` and checked by hand. 126 cases: 83 are carried into the new tests, 1 is dropped, and 42 stay where they are because their subject is another module that only uses one of these values. A case that stays still passes through the forwarders and keeps what it asserts.

Three hits of the scan were not uses and are left out: `present_mode.test.js:131`, `export_text.test.js:136` and `replay_scheduler.test.js:133` only contain the word in a string or a comment. The scan also flagged 21 cases in `run_record.test.js` through a fixture helper that does not touch `failures`; only `run_record.test.js:25` reads it. The seven region-label cases in `regions_gestures.test.js` are not C1's and stay for slice C5.

Moving cases: the builder cuts each carried case out of its old file and writes it into the new `.ts` test against the behavior it names. Two old files move whole with `git mv` (`epoch.test.js`, `rail_hotkey.test.js`); nothing is deleted. Update the `read-when` header of `regions_gestures.test.js` to name only the region rules.

| Old test | Name | Behavior | Disposition |
| --- | --- | --- | --- |
| `test/unit/choice_kernel.test.js:130` | validateItem and validateChoice refuse every forgery, each with the CHOICE_REFUSED code | B10 | stays: its subject is `record.validateChoice` |
| `test/unit/choice_kernel.test.js:387` | a click on an armed button on a document page, in browse, is a press, and it prevents the default | B39 | moves to `test/unit/domain/gestures.test.ts` |
| `test/unit/choice_kernel.test.js:394` | V8: pick mode, an open edit, edit state, a read-only window and present mode each refuse the press | B38, B39 | moves to `test/unit/domain/gestures.test.ts` |
| `test/unit/choice_kernel.test.js:410` | V1: off a document page, or on a button outside an armed group, the click is the page's own | B39 | moves to `test/unit/domain/gestures.test.ts` |
| `test/unit/choice_kernel.test.js:423` | V1: PRESS_CHOICE has no hint row, so a page with no groups shows the same rail hints as before | B43, B44, B45 | moves to `test/unit/domain/gestures.test.ts`; the line counts become the exact lines |
| `test/unit/clean_block.test.js:27` | the refusal code is a real failure code | B10 | stays: its subject is `normalize.cleanBlock`'s refusal code |
| `test/unit/comments_surface.test.js:30` | the on-card hint is spelled once, and follows the send key | B45 | stays: its subject is `comments.hintReady` agreeing with the table |
| `test/unit/done_tab_replies.test.js:292` | a handled fold clears the lost-anchor badge and the stamp behind it | B20 | stays: its subject is the Done tab clearing badges |
| `test/unit/done_tab_replies.test.js:303` | a not_handled fold keeps the lost-anchor badge: the work is still open | B20 | stays: its subject is the Done tab clearing badges |
| `test/unit/done_tab_replies.test.js:313` | a question fold keeps the lost-anchor badge too | B20 | stays: its subject is the Done tab clearing badges |
| `test/unit/done_tab_replies.test.js:323` | reopening a handled item leaves the anchor to be judged again from scratch | B20 | stays: its subject is the Done tab clearing badges |
| `test/unit/editing_run.test.js:42` | the edit-state hint is the gesture table's own line, not a second spelling | B45 | stays: its subject is `editing.HINT_EDIT_STATE` agreeing with the table |
| `test/unit/editing_run.test.js:53` | the focus-ring rule matches only the attribute the layer sets on the host | B1 | stays: its subject is `highlight.EDIT_HOST_RULE` |
| `test/unit/editing_surface.test.js:120` | the formatting commands are closed to the two R24 allows for v1 | B47 | stays: its subject is `editing.COMMANDS` agreeing with `FORMAT_COMMANDS` |
| `test/unit/editing_surface.test.js:146` | which way the button is going is decided by what the reviewer is looking at | B47 | moves to `test/unit/domain/gestures.test.ts` |
| `test/unit/editing_surface.test.js:156` | what each formatting gesture writes, so all three engines record one thing | B47 | stays: its subject is `editing.formatShapeFor` |
| `test/unit/editing_surface.test.js:203` | entry and exit come from the one gesture table, not from this file | B32, B33, B35, B38 | moves to `test/unit/domain/gestures.test.ts` |
| `test/unit/editing_surface.test.js:383` | Enter is a paragraph break and Shift-Enter is a line break, in every engine | B46 | moves to `test/unit/domain/gestures.test.ts` |
| `test/unit/editing_surface.test.js:399` | nothing but a break is intercepted: ordinary typing stays the engine's | B46 | moves to `test/unit/domain/gestures.test.ts`; the `null` input assertion is dropped, because the type refuses it |
| `test/unit/editing_surface.test.js:408` | the markup each break writes reads back through the normalizer as that break | B46 | stays: its subject is `editing.breakMarkup` |
| `test/unit/editing_surface.test.js:431` | each break is a change, and the change line names the one the reviewer typed | B46 | stays: its subject is `editing.kindFor` and `record.editChangeText` |
| `test/unit/epoch.test.js:16` | the epoch is open for the duration of a tool write | B57 | moves with the file to `test/unit/browser/review-layer/editing/write-epoch.test.ts` |
| `test/unit/epoch.test.js:24` | the depth drops in a MICROTASK, not synchronously | B58 | moves with the file to `test/unit/browser/review-layer/editing/write-epoch.test.ts` |
| `test/unit/epoch.test.js:46` | a mutation after the epoch closes is NOT suppressed | B58 | moves with the file to `test/unit/browser/review-layer/editing/write-epoch.test.ts` |
| `test/unit/epoch.test.js:58` | nested writes keep the epoch open until the outermost one closes | B59 | moves with the file to `test/unit/browser/review-layer/editing/write-epoch.test.ts` |
| `test/unit/epoch.test.js:71` | an exception inside a write does not pin the epoch open forever | B60 | moves with the file to `test/unit/browser/review-layer/editing/write-epoch.test.ts` |
| `test/unit/epoch.test.js:82` | the epoch number is monotonic, so replay can no-op when nothing moved | B61 | moves with the file to `test/unit/browser/review-layer/editing/write-epoch.test.ts` |
| `test/unit/epoch.test.js:90` | an external mutation seen during a tool write is remembered, not dropped | B62 | moves with the file to `test/unit/browser/review-layer/editing/write-epoch.test.ts` |
| `test/unit/epoch.test.js:99` | write demands a reason, because the first question every replay bug asks is who scheduled this | B64 | moves with the file to `test/unit/browser/review-layer/editing/write-epoch.test.ts`; the `fn` of `null` assertion is dropped, because the type refuses it |
| `test/unit/epoch.test.js:105` | the layer shares one epoch | B65 | moves with the file to `test/unit/browser/review-layer/editing/write-epoch.test.ts` |
| `test/unit/export_text.test.js:155` | the copy and export failure codes are in the one code list | B10, B11, B12 | stays: its subject is Copy and Export; a fixed behavior test, unchanged |
| `test/unit/fix_round_f3_projection.test.js:128` | the export names block types with the menu's labels from gestures | B48 | stays: its subject is `review_format.renderText` |
| `test/unit/harness_stub_vocabulary.test.js:83` | every gesture the stub names is a gesture the table defines | B28 | stays: its subject is the harness stub fixture |
| `test/unit/launch_by_kind.test.js:133` | PROTO_NO_LAUNCH is a known failure with a remedy the page can show | B10 | stays: its subject is `protocol.statusFor` |
| `test/unit/leaf_blocks.test.js:37` | the file-name title marker has one spelling | B1, B9 | moves to `test/unit/contract/markers.test.ts` |
| `test/unit/markdown_render.test.js:237` | a Markdown file with a # heading does not carry the marker | B1 | stays: its subject is the Markdown render |
| `test/unit/normalize.test.js:100` | cleanMarkup strips the stamp, so an id never rides in as content | B1, B3 | stays: its subject is `normalize.cleanMarkup` |
| `test/unit/pandoc_render.test.js:350` | no # heading: the file name is the title, marked as chrome; an empty file still has its hero | B1 | stays: its subject is the pandoc render |
| `test/unit/pandoc_render.test.js:436` | without pandoc a page with fenced divs renders with marked and carries the rail's notice | B1 | stays: its subject is the pandoc render |
| `test/unit/pandoc_render.test.js:448` | without pandoc a page with no fenced div is today's page: no notice, no log line | B1 | stays: its subject is the pandoc render |
| `test/unit/pandoc_render.test.js:459` | a forced marked never carries the notice | B1 | stays: its subject is the pandoc render |
| `test/unit/present_mode.test.js:36` | Cmd-Shift-X is the show/hide chord, in both directions and in any state | B30 | moves to `test/unit/domain/gestures.test.ts` |
| `test/unit/present_mode.test.js:59` | the chord takes nothing away from the gestures that were already there | B30, B32, B33, B34, B35, B36 | moves to `test/unit/domain/gestures.test.ts` |
| `test/unit/present_mode.test.js:76` | the chord is taught on the rail, like every other gesture | B43 | moves to `test/unit/domain/gestures.test.ts` |
| `test/unit/protect_vocabulary.test.js:96` | region identity prefers an attribute the page's own markup carries | B1 | stays: its subject is `protect` |
| `test/unit/protect_vocabulary.test.js:151` | the vocabulary covers both fixture engines and Turbo, from one table | B1 | stays: its subject is `protect` |
| `test/unit/protocol_wire.test.js:138` | a malformed line is skipped with a reason, never thrown | B11 | stays: its subject is `protocol.parseReplyLine` |
| `test/unit/protocol_wire.test.js:404` | the new failure codes exist and the pruned ones are gone | B10, B11 | moves to `test/unit/contract/failures.test.ts` |
| `test/unit/protocol_wire.test.js:423` | an old spelling resolves to its canonical code and keeps its own name | B13, B16 | moves to `test/unit/contract/failures.test.ts` |
| `test/unit/protocol_wire.test.js:431` | telling a CSP refusal from a helper that is down is two codes, not one | B11 | moves to `test/unit/contract/failures.test.ts` |
| `test/unit/rail_hotkey.test.js:21` | Cmd-Shift-1 toggles the rail, whichever way the layout reports the key | B31 | moves with the file to `test/unit/domain/gestures.test.ts` |
| `test/unit/rail_hotkey.test.js:40` | the chord holds in every state, including inside the rail's own fields | B31 | moves with the file to `test/unit/domain/gestures.test.ts` |
| `test/unit/rail_hotkey.test.js:54` | the near misses are the page's: no Shift, no modifier, and the wrong digit | B31 | moves with the file to `test/unit/domain/gestures.test.ts` |
| `test/unit/rail_hotkey.test.js:71` | the present chord is untouched by the new one | B30 | moves with the file to `test/unit/domain/gestures.test.ts` |
| `test/unit/rail_hotkey.test.js:76` | the rail chord is taught on the rail, with its exact keystroke | B43, B45 | moves with the file to `test/unit/domain/gestures.test.ts` |
| `test/unit/regions_gestures.test.js:93` | browse is the page untouched: an ordinary click is the page's (R13) | B38 | moves to `test/unit/domain/gestures.test.ts` |
| `test/unit/regions_gestures.test.js:100` | the dead gestures are gone: no Alt-click, no place-caret, no editing toggle | B28, B38 | moves to `test/unit/domain/gestures.test.ts` |
| `test/unit/regions_gestures.test.js:109` | Cmd-Shift-C with a selection comments on the passage | B34 | moves to `test/unit/domain/gestures.test.ts` |
| `test/unit/regions_gestures.test.js:115` | Cmd-Shift-C with nothing selected enters element-pick mode (R17) | B34 | moves to `test/unit/domain/gestures.test.ts` |
| `test/unit/regions_gestures.test.js:122` | Ctrl is the same modifier as Cmd, and the letter case does not matter | B34 | moves to `test/unit/domain/gestures.test.ts` |
| `test/unit/regions_gestures.test.js:126` | Cmd-Shift-C without Shift is not a gesture, so the page keeps Cmd-C | B34 | moves to `test/unit/domain/gestures.test.ts` |
| `test/unit/regions_gestures.test.js:132` | Cmd-Shift-E edits the block under the cursor | B35 | moves to `test/unit/domain/gestures.test.ts` |
| `test/unit/regions_gestures.test.js:136` | Cmd-Enter marks a comment ready, and only inside a comment box (R7) | B33 | moves to `test/unit/domain/gestures.test.ts` |
| `test/unit/regions_gestures.test.js:143` | Enter sends a comment by default, and Shift-Enter is a new line | B33, B41 | moves to `test/unit/domain/gestures.test.ts` |
| `test/unit/regions_gestures.test.js:154` | with the Cmd-Enter setting, a bare Enter is a new line and Cmd-Enter sends | B33 | moves to `test/unit/domain/gestures.test.ts` |
| `test/unit/regions_gestures.test.js:163` | Cmd-Enter still sends with the Enter setting, so old habits keep working | B33 | moves to `test/unit/domain/gestures.test.ts` |
| `test/unit/regions_gestures.test.js:167` | Enter that finishes an input-method composition never sends | B33, B41 | moves to `test/unit/domain/gestures.test.ts` |
| `test/unit/regions_gestures.test.js:172` | a bare Enter outside a comment box is never the library's, whatever the setting | B33 | moves to `test/unit/domain/gestures.test.ts` |
| `test/unit/regions_gestures.test.js:179` | isSendPress is the same rule for the rail's own message boxes | B41 | moves to `test/unit/domain/gestures.test.ts` |
| `test/unit/regions_gestures.test.js:189` | isSendEvent reads a real keydown, including Safari's input-method code | B42 | moves to `test/unit/domain/gestures.test.ts` |
| `test/unit/regions_gestures.test.js:198` | the send key's words follow the setting | B40, B43, B44, B45 | moves to `test/unit/domain/gestures.test.ts` |
| `test/unit/regions_gestures.test.js:214` | Esc commits an open edit, cancels a pick, and is otherwise the page's | B32 | moves to `test/unit/domain/gestures.test.ts` |
| `test/unit/regions_gestures.test.js:223` | a click while element-pick mode is open comments on that element | B38 | moves to `test/unit/domain/gestures.test.ts` |
| `test/unit/regions_gestures.test.js:229` | a click outside an open edit commits it AND still reaches the page | B38 | moves to `test/unit/domain/gestures.test.ts` |
| `test/unit/regions_gestures.test.js:238` | a click inside the block being edited is not a commit | B38 | moves to `test/unit/domain/gestures.test.ts` |
| `test/unit/regions_gestures.test.js:242` | the library's own overlay is never subject to the page's gesture rules | B38 | moves to `test/unit/domain/gestures.test.ts` |
| `test/unit/regions_gestures.test.js:246` | ordinary typing is never a library gesture, so the page keeps every key | B36 | moves to `test/unit/domain/gestures.test.ts` |
| `test/unit/regions_gestures.test.js:253` | every gesture has a hint line with its exact keystroke, because AC6 scores that | B43 | moves to `test/unit/domain/gestures.test.ts` |
| `test/unit/regions_gestures.test.js:264` | the on-card hint is Ken's copy, word for word | B45 | moves to `test/unit/domain/gestures.test.ts` |
| `test/unit/regions_gestures.test.js:279` | the block types, their menu labels and Markdown shortcuts are the plan's | B48 | moves to `test/unit/domain/gestures.test.ts`; `markdown` becomes the `shortcuts` list |
| `test/unit/regions_gestures.test.js:294` | each chord maps to its tag by event.code on macOS | B49 | moves to `test/unit/domain/gestures.test.ts` |
| `test/unit/regions_gestures.test.js:303` | each chord maps to its tag by event.code on Windows and Linux | B49 | moves to `test/unit/domain/gestures.test.ts` |
| `test/unit/regions_gestures.test.js:312` | a macOS event with code Digit2 and key ™ matches | B49 | moves to `test/unit/domain/gestures.test.ts` |
| `test/unit/regions_gestures.test.js:316` | an event with AltGraph on never matches, nor does Ctrl-Alt with a digit on Windows | B49 | moves to `test/unit/domain/gestures.test.ts` |
| `test/unit/regions_gestures.test.js:323` | the wrong modifier on a system is not a chord | B49 | moves to `test/unit/domain/gestures.test.ts` |
| `test/unit/regions_gestures.test.js:331` | no chord collides with Cmd-Shift-E, C, X, 1, or the macOS screenshot keys | B35, B49 | moves to `test/unit/domain/gestures.test.ts` |
| `test/unit/regions_gestures.test.js:343` | each menu row names its chord for the reviewer's system | B48, B50 | moves to `test/unit/domain/gestures.test.ts` |
| `test/unit/regions_gestures.test.js:351` | a Markdown shortcut at the start of a block names its type | B51 | moves to `test/unit/domain/gestures.test.ts` |
| `test/unit/regions_gestures.test.js:368` | Enter at the end of a block makes a sibling; Enter mid-block splits | B52 | moves to `test/unit/domain/gestures.test.ts` |
| `test/unit/regions_gestures.test.js:373` | Shift-Enter stays a line break | B52 | moves to `test/unit/domain/gestures.test.ts` |
| `test/unit/regions_gestures.test.js:378` | Enter in an empty last item ends the list; elsewhere in a list it adds an item | B52 | moves to `test/unit/domain/gestures.test.ts` |
| `test/unit/regions_gestures.test.js:384` | Enter where a run cannot go keeps today's break rule | B52 | moves to `test/unit/domain/gestures.test.ts` |
| `test/unit/regions_gestures.test.js:388` | Backspace at a block start merges into the block before, inside the session | B53 | moves to `test/unit/domain/gestures.test.ts` |
| `test/unit/regions_gestures.test.js:393` | Delete at a block end merges the next block in | B53 | moves to `test/unit/domain/gestures.test.ts` |
| `test/unit/regions_gestures.test.js:397` | Backspace or Delete at the session's own edge is refused, so no page block outside it changes | B53 | moves to `test/unit/domain/gestures.test.ts` |
| `test/unit/regions_gestures.test.js:402` | a selection across blocks is deleted by the layer, with either key | B53 | moves to `test/unit/domain/gestures.test.ts` |
| `test/unit/regions_gestures.test.js:408` | Cmd-Z and Shift-Cmd-Z walk the session's own history | B54 | moves to `test/unit/domain/gestures.test.ts` |
| `test/unit/regions_gestures.test.js:418` | Cmd-Shift-E with the caret in no block enters edit state with no block open | B35 | moves to `test/unit/domain/gestures.test.ts` |
| `test/unit/regions_gestures.test.js:425` | Esc with the block menu open closes only the menu | B32 | moves to `test/unit/domain/gestures.test.ts` |
| `test/unit/regions_gestures.test.js:431` | otherwise Esc commits any open session and leaves edit state | B32 | moves to `test/unit/domain/gestures.test.ts` |
| `test/unit/regions_gestures.test.js:436` | the hint for edit state with no block open is the pinned text | B43, B45 | moves to `test/unit/domain/gestures.test.ts` |
| `test/unit/remount_contract.test.js:111` | a remount de-registers BEFORE it re-registers, and the count comes back flat | B1 | stays: its subject is remount in `layer/index.js` |
| `test/unit/remount_contract.test.js:151` | the root is only re-created when it is actually gone | B1 | stays: its subject is remount in `layer/index.js` |
| `test/unit/remount_contract.test.js:177` | fresh-load pageshow is ignored, while persisted pageshow remounts once | B1 | stays: its subject is remount in `layer/index.js` |
| `test/unit/remount_contract.test.js:204` | a policy refusal is a different failure from a helper that is down | B11, B16 | stays: its subject is `inject.cspFailure` |
| `test/unit/replay_pass.test.js:578` | every DOM write happens inside the write epoch, so replay does not retrigger replay | B57 | stays: its subject is replay writing inside the epoch |
| `test/unit/replay_scheduler.test.js:27` | finding 9: a repaint that owed a pass during replay's own write actually gets that pass | B62, B63 | stays: its subject is replay's owed pass; `epoch.shared.*` becomes `epoch.*` |
| `test/unit/replay_scheduler.test.js:193` | a repaint refused during someone else's write epoch still gets its pass | B63 | stays: its subject is replay's owed pass; `epoch.shared.*` becomes `epoch.*` |
| `test/unit/reverted_edit.test.js:158` | the page text leaves the library's own chrome out | B8 | stays: its subject is `replay.pageTextOf` |
| `test/unit/run_record.test.js:25` | the four refusal codes and the three card codes are failure codes | B10, B11 | stays: its subject is the run record's codes |
| `test/unit/session_fixes.test.js:49` | the pointer going down outside the edited block commits it, rail included | B37 | moves to `test/unit/domain/gestures.test.ts` |
| `test/unit/session_fixes.test.js:68` | a scrollbar drag and a right-click are not the reviewer leaving the block (review, 2026-08-17) | B37 | moves to `test/unit/domain/gestures.test.ts` |
| `test/unit/session_fixes.test.js:89` | the scrollbar geometry: past the content box and inside the border box | B55 | moves to `test/unit/domain/gestures.test.ts` |
| `test/unit/session_fixes.test.js:466` | the codes whose remedy IS an agent handoff can hand the line over | B19 | moves to `test/unit/contract/failures.test.ts` |
| `test/unit/session_fixes.test.js:473` | a chip with its own button never also gets a Copy button | B18, B19 | moves to `test/unit/contract/failures.test.ts` |
| `test/unit/session_fixes.test.js:480` | every code a table names is a code that exists | B10, B18, B19 | dropped: the chip action and the copy offer now live in each code's own row, so a table naming a code that does not exist cannot be written; the compiler refuses it |
| `test/unit/storage_quota_typing.test.js:70` | a store write refused for want of room is recognisable as exactly that | B21 | moves to `test/unit/contract/failures.test.ts`; the quota error is built literally instead of through the store |
| `test/unit/storage_quota_typing.test.js:83` | a quota failure is reported and not rethrown; anything else is still loud | B22 | moves to `test/unit/contract/failures.test.ts` |
| `test/unit/storage_quota_typing.test.js:125` | reporting a full storage into a full storage does not take the keystroke down | B22 | moves to `test/unit/contract/failures.test.ts` |
| `test/unit/storage_quota_typing.test.js:159` | typing into a comment when storage is full keeps the words and raises one failure | B22 | stays: its subject is the comment box when storage is full |
| `test/unit/storage_quota_typing.test.js:459` | the rail can still paint a chip when the storage it remembers chips in is full | B22 | stays: its subject is the rail's chip list when storage is full |
| `test/unit/style_switch.test.js:90` | the layer checks with the shared rules, not a copy of its own | B23, B24, B25, B26 | stays: its subject is the style switch using the shared rules |
| `test/unit/styles.test.js:721` | the id, colour and name rules are spelled once, in src/shared/style_rules.js | B23, B25, B26, B27 | stays: its subject is `styles.js` using the shared rules |
| `test/unit/sync_client.test.js:406` | the unreachable helper is a standing state, so its chip never counts | B17 | stays: its subject is the rail's chips |
| `test/unit/sync_client.test.js:418` | clearing one code leaves every other chip standing | B16 | stays: its subject is the rail's chips |
| `test/unit/sync_client.test.js:615` | clearing a code with no chip on it writes nothing and rebuilds nothing | B16 | stays: its subject is the rail's chips |

Behaviors no old case covered, which the new tests add: B2 to B7 (the marker questions), B12, B14, B15 and B16's `at`, B18 for an alias and an unknown string, B23 to B27's edges, B44 under the Cmd-Enter setting, B51's no-break space, B56, and B63 (`onIdle` on its own; before, only the replay scheduler test reached it, through replay).

## 6. Deliberate differences

None of these is something a reviewer or an agent would notice: no code that anything raises, no word on screen, no record field and no CLI line changes. Each has a test.

- **D1. Six failure codes nothing raises are removed:** `STORAGE_UNAVAILABLE`, `REPLAY_CONTENT_CHANGED`, `REPLAY_GROUP_INCOMPLETE`, `CLI_NO_REVIEW`, `CLI_REVIEW_ENDED` and `CLI_RUNTIME_MISSING`. A search of `src`, `scripts`, `test`, the skill and the docs outside `docs/features/` found no producer, no test and no doc naming any of them; `bin/lahe.js` prints its own old-Node message rather than this code's. The only other match is the built `dist/lahe-layer.js`, which the orchestrator rebuilds. Test: B10's exact list. Risk: a chip with one of these codes in an old browser's storage still renders from its stored words; `chipAction` and `isCopyable` return `null` and `false` for it, which is what they returned before.
- **D2. A code's chip offer and its standing move into the code's row.** `CHIP_ACTIONS`, `COPYABLE` and the internal `STANDING` table go. The answers of `chipAction`, `isCopyable` and `failure(...).standing` do not change for any code or alias. Tests: B17, B18, B19, each over all 49 codes and all six aliases.
- **D3. The write epoch has one surface.** `shared` goes; the module's own functions are the page's epoch and now include `noteExternalMutation` and `takePendingExternal`. `createEpoch` takes no options, and `currentReasons` goes. `replay.js` changes three call sites. Tests: B62, B63 and B65; the replay scheduler tests, edited only for the new names, still pass.
- **D4. Exports no caller reads are not exported:** `markWrap`, `TOOL_ATTR_PREFIX`, `TOOL_CLASS_PREFIX`, `ALIAS_NAMES`, `isPersistent`, `HEX`, `NAME_CHARS`, `isPrimaryModifier`. Nothing in the repo writes `data-lahe="wrap"` any more; the role is still read, so `ROLE_WRAP` stays and `cleanMarkup` still unwraps old markup. Test: tsc refuses an import of any of them; no runtime test needed.
- **D5. Hint rows lose three fields no caller reads** (`passThrough`, `preventDefault`, `requirement`), which repeated what `gestureFor` decides. The `MARK_READY` row's words come from the Enter send-key words. Test: B43 and B44's exact lines.
- **D6. Each block type lists its Markdown shortcuts,** replacing the row's `markdown` field and the separate shortcut map, which spelled `## `, `### `, `#### `, `- ` and `1. ` twice. `markdownShortcutFor` answers the same for every input. Test: B48's table and B51, including the two shortcuts that are not first in their row (`# ` and `* `).
- **D7. Inputs the types refuse are not handled at run time:**
  - `gestureFor` with a `type` other than the four (it was `NONE`, the page's);
  - `breakIntentFor(null)`;
  - `isScrollbarPress` with a non-number `x`;
  - `isToolAttrName` and `isToolClassToken` with a non-string;
  - `markChrome(null)` and `markChrome` on an object with no `setAttribute`;
  - `write` and `onIdle` without a function.
  Every caller in `src` passes the right shape (checked: each `markChrome` call in `src/layer/` is on an element made with `createElement` or held by the rail; the unit-test fakes I read that reach it, such as `reverted_edit.test.js`'s, have `setAttribute`, but I did not read every fake). Test: tsc. The builder's `gate:unit` run is the check that no old JavaScript caller relied on the tolerance; if one fails, raise it rather than restoring the guard.
- **D8. `describe` and `failure` name `src/contract/failures.ts`** in the error for an unknown name, where the old message named `src/shared/failures.js`. Only a developer sees it. Test: B15.

## 7. Fixed behavior tests touched

These must pass with what they assert unchanged.

- **`test/unit/review_format.test.js`.** Its run lines (lines 860 to 870: "Heading:", "Paragraph:", "Bulleted list:", "Paragraph (moved from the anchor):") come from `blockTypeLabel` through `review_format.js`. B48 keeps the labels.
- **`test/unit/export_text.test.js`.** Line 155 reads `failures.CODE_NAMES`, `failures.SURFACE.FAILURES_LIST` and `failures.describe("COPY_FAILED").surface`; line 136 expects the `COPY_FAILED` chip to be persistent. All four names and values stay.
- **Skill-wording tests** (`test/support/skill.js` users: `add_command`, `mark_done`, `no_stale_excuse`, `reply_command`, `review_format`, `session_fixes`, `stable_addresses_docs`, `status_command`). None reads these modules or quotes a failure message or hint line; a scan of the skill and the user docs for every failure message found none. The skill does name `data-lahe-id`, which B1 pins.
- **CLI output tests.** No CLI command imports these modules. `lahe style add`'s refusals (`test/unit/style_command.test.js`) print `NAME_MAX` and `DESCRIPTION_MAX` through `styles.js`, and B27 keeps both. Helper error bodies the CLI prints carry failure messages, which B11 keeps.
- **Browser specs.** Nearly every spec exercises these modules through the rail, so the full suite at checkpoint 1 is the real check. Run these by name in the slice, on Chromium: `rail_hotkey`, `present_mode`, `send_key`, `paragraph_break`, `formatting_toggle`, `free_writing_types`, `choice_buttons`, `rail_chips`, `csp_refusal`, `rail_second_window`, `comments_highlights` (reads `window.LAHE.gestures.hintLines()`), `rail_menu` (requires the old gestures path from Node inside the spec), `style_switcher`, `protection_layers`, `harness_selftest`, `editing_commit_outside`, `lost_anchor_settles`, `typing_caret_vs_repaint` and `free_writing_repaint` (both lean on the epoch). Two fixtures read the registered names in the page: `test/fixtures/assets/cp1-boot.js` (`LAHE.markers.OVERLAY_ROOT_ID`) and `rail-harness.js` (`LAHE.failures.failure`).
- **Specs and support files that load these sources by path** (`anchor_engine.spec.js`, `best_guess_speed.spec.js`, `blocks_kernel.spec.js`, `support/protect_page.js`): S0c moves them to the in-memory bundle. If any still reads a path under `src/shared/` for these five files when C1 starts, C1 changes it to the bundle helper. `support/export_stub.js` names `src/shared/markers.js` too, but nothing calls its `installExportStub`; it is dead and is listed for cleanup rather than changed.

## 8. Source-text tests

| Test | Reads | Change |
| --- | --- | --- |
| `test/unit/styles.test.js:711-715` | the text of `src/service/styles.js` and `src/shared/style_rules.js`, asserting no raw bidi control character | the second path becomes `src/contract/style-rules.ts`; what it asserts does not change. The plan's table lists this row for C1 and SV2 |

No other test reads the text of these five files. Tests that read the manifest (`lint_lua.test.js`, `export_text.test.js`'s owner check, lint's completeness check) are unaffected by five changed `LAYER_FILES` paths and five new `FORWARDERS` entries; `gate:unit` confirms it.

## 9. Comments to move

Drafts of the folder-doc sections, one per new file. Each heading is the file name. The builder may tighten the wording but keeps the substance.

### For `docs/ongoing/code/contract.md` (new)

Start the file with the frontmatter `read-when: Changing a file in src/contract/, or working out why one of them does what it does.` and `not-for: How the TypeScript projects and the lint gate are set up; see README.md in this folder.`, then one paragraph: `src/contract/` holds the contract between the server and the browser: shapes, constant tables, and the parsers that turn untrusted input into those shapes. It imports nothing, and both the server and the bundle load it.

#### `markers.ts`: what Lahe added to a page

Nothing the tool adds to a page may end up in the reviewer's feedback. That is only enforceable with exactly one spelling of "this node is ours", so it is spelled here, and the normalizer's `cleanMarkup` strips by these names.

The one attribute that says a node is the tool's is `data-lahe`, and its value is the node's role:

- `chrome` is tool furniture: a chip, a handle, the rail. Capture drops it with its whole subtree.
- `wrap` is a wrapper the tool put around reviewed content. Capture unwraps it: the tag goes and the children stay. Nothing writes it today, since highlights moved to the CSS Custom Highlight API, but old markup may still carry it.

Every attribute starting with `data-lahe` is stripped on capture, matched without regard to case because HTML attribute names have none. Every class token starting with `lahe-` is stripped, matched with case because class tokens have it. The five attributes the tool writes are typed `data-lahe...`, so one that would survive capture does not compile.

`lahe-surface-root` is the id of the one element the library puts in the page: a chrome-marked `div` holding a closed shadow root, inside which everything the library draws lives (the rail, comment boxes, the pick outline). Highlight's surface code creates it. Anything under it is tool DOM by construction.

The attributes, and why each exists:

- `data-lahe-protected` is set on a region while the reviewer edits it. Turbo reads `data-turbo-permanent` natively, but that alone does not say who put it there, so the veto handler and replay check the tool's own attribute.
- `data-review-region` is an author's, not the tool's: a page author may put it on their markup to give a region a stable label. The tool never writes it and never strips it.
- `data-lahe-id` is identity Lahe assigns rather than infers. It is written onto the live element the moment the reviewer touches it. Everything else in the anchor engine recognizes an element again from what it looks like; this is the one signal true by construction. It is stripped from `before_html` and `after_html` like every tool attribute, because it is not the reviewer's content. It reaches an agent as its own field instead, which is what the agent needs to write it into the source. The skill tells agents to keep it, so its value is part of what agents see.
- `data-lahe-file-title`, always with the value `file-name`, marks the hero title a Markdown render takes from the file name when the file has no `#` heading. The title is not in the file, so it is page chrome: the block reader skips it, a run starts after it, and no agent is asked to write it. Only the server's Markdown render sets it.
- The `<meta name="lahe-render-note">` is on a rendered Markdown page that pandoc did not render and whose source has a fenced div, so its `:::` blocks show as text. The rail shows its own fixed line when it finds it. Only the server's Markdown render writes it.
- `data-lahe-edit-host` is set by the layer on the editing host (the nearest ancestor holding the anchor and its run) while a writing session is open, and removed at commit. One highlight rule hides that element's focus ring by matching this attribute and nothing of the page's own.

The node questions take a structural `MarkedNode`, because this folder has no DOM types. A text node is the one with no `getAttribute`.

Known edges, unchanged: `isInsideOverlay` started at a text node is false even inside the overlay, because the walk stops at the first node that is not an element. An element inside the closed shadow root walks up to the shadow root and stops there; events from inside it are retargeted to the host element, whose id matches, so event targets still answer true.

#### `failures.ts`: what can fail, and what the reviewer is told

Failures are loud and they persist, and that is only checkable with one vocabulary for what failed. Each code's sentence is written once here, so two places cannot word one failure two ways.

Each code carries:

- `severity`: blocking, warning or info;
- `persistent`: whether it stays in the rail's failures list until the reviewer dismisses it, or is a passing message;
- `surface`: where it shows, the failures list, a card, or the CLI;
- `message` and `remedy`: what the reviewer reads, and what to do (or `null` when there is nothing to do);
- `standing` and `offer`, below.

Codes worth knowing the reason for:

- `CSP_REFUSED` and `HELPER_UNREACHABLE` are two codes on purpose. They look the same to a `fetch` and need opposite fixes: one is "start the helper", the other is "this page's own policy refuses the connection".
- `SECOND_WINDOW_REFUSED`: two windows sharing one draft bucket means the last keystroke wins and the other window's work disappears without a word. Refusing costs the reviewer nothing, and the takeover is one button.
- `ANCHOR_LOST` is kept for records written before the uniqueness verdicts got their own codes. A failed safe match is not proof that content was deleted, so even this old wording stays neutral.
- `REPLAY_NEITHER_MATCHES`: neither the before nor the after matches the page (two people, or a rebuild, changed the region), and writing either would clobber a change nobody asked to lose.
- The four `RUN_*` refusals are the server's answers to a run event. The server refuses rather than cleans, so a forged or runaway record shows up instead of being quietly repaired. `normalize.cleanBlock` returns `RUN_BLOCK_REFUSED` itself.
- `REPLAY_RUN_WRONG_TAG` and `REPLAY_RUN_PLACED_ELSEWHERE` are card notes whose `{first words}` and `{type}` the layer fills in. The second is for the reviewer only and never reaches `review.json`.
- `HELPER_CONTRACT_OLDER`: the layer read the server's health and it reports an older service contract, so nothing is posted to it.
- `CHOICE_REFUSED`: the layer never sends a choice record the server would refuse, so this code appears only for a forgery. `CHOICE_GROUP_INERT` is a group the agent wrote wrong; it is drawn as plain content, and its detail names each group and why, ready to hand to the agent.
- `REPLY_LINE_MALFORMED`: the server skips a bad reply line and never dies. Exiting on one agent's typo would take the reviewer's session with it, a worse failure than the one it reports.
- The `PROTO_*` refusals are each logged by the server naming the check that failed, which is what makes "outside cannot get in" observable. The ordered list of checks and each code's HTTP status are in `protocol`.
- The Library's refusals are shown with their remedy line, so each says what the reviewer can do next.
- `COPY_FAILED` and `EXPORT_FAILED`: Copy and Export are always meant to work, so the code is for when they did not. A control that looked like it worked and did not is the failure this tool exists to remove, and the reviewer would find out only when they paste.

**Old spellings.** Six aliases resolve to their canonical code and keep their own spelling in the failure they return, so a rail chip and its dismissal still match. No source code types them now; they stay because browser storage and old records may still hold them.

**Standing codes** describe a state rather than an occurrence. Raising one again means "still true", so its chip must not grow a ×N counter. A reviewer whose window was refused across four Turbo navigations read "×4" as four other windows, and an unreachable server's "×7" counted the page's own retries. `CHOICE_GROUP_INERT` is re-raised on every arming pass while a broken group is on the page.

**What a chip may offer** lives in the code's own row, so adding a code is the same edit as deciding its controls. These choices used to live in the rail, three files away, and a new failure could quietly get neither.

- An *action*: the reviewer fixes it right there, with a button. The click goes through the rail's `runAction`, so boot still owns what the button does. Only `SECOND_WINDOW_REFUSED` has one ("Review here").
- *Copy*: the failure is fixed somewhere the reviewer is not, and the chip's detail is a sentence to hand to their agent as is. The codes whose remedy is agent work have it: the reply line an agent wrote, the add step that mints a token, the origin and CSP setup, and a broken choice group.
- Never both. A copy button once displaced the one button that actually fixed the failure; the offer type makes that unrepresentable.

**Anchor badges.** Two places clear the badges an unbound anchor leaves on a card: replay, when the anchor binds again, and the Done tab, when a reply folds as handled. They share `ANCHOR_FAILURE_CODES`, so a badge cannot outlive its state because one copy of a list gained a code. `ANCHOR_LOST` is in it so a card drawn by an older build still clears.

**A full browser storage while typing.** The store writes synchronously on every keystroke and throws when storage is full, with the failure attached to the error. Left alone, that throw comes straight out of the input handler, so a full storage stops the block or comment box taking keystrokes and shows nothing. `tolerateStorageQuota` reports a quota failure and swallows it, so the reviewer keeps typing and the rail says what could not be saved. Every other error is rethrown, because a silently dropped bug in the write path is the failure this tool exists to remove. The report is guarded only against the same failure, because the rail remembers its chips in the same storage that just refused the write. `isStorageQuota` checks only the code, trusting the rest because only `failure()` builds these objects.

#### `style-rules.ts`: style ids, colours and names

An id arrives from outside Lahe's own code in five places (install, a served path, Markdown frontmatter, a note, the list the rail fetches), and all five check it with this one rule. A value that fails is no style at all. The checks narrow to branded types, so code past the check can ask for a checked id.

- `international` is the house style: always there, never installed.
- A palette value reaches an inline style only after the hex check.
- A style name is written into the note to the agent, so it allows only letters, digits, spaces, hyphens, apostrophes and ampersands, and cannot carry an instruction's punctuation.
- Only the first six palette colours are shown.

The source must spell any bidi control character as an escape; `styles.test.js` reads the file to check.

### For `docs/ongoing/code/domain.md` (a section added beside S0c's)

#### `gestures.ts`: what a key, a click or an input means

The rule that keeps this table small: browsing is the page untouched. No intercepted clicks, no `contentEditable`, and no captured keys beyond the library's own shortcuts. Links navigate, buttons act, forms submit, and the page's JavaScript sees every event it would see without Lahe. The page keeps working, and that outranks editing convenience (D3 and R13 in [the original architecture](../../features/20260812.01_live_agentic_html_editor/)).

So the table is almost all keystrokes. The click rules that remain: a click inside the library's overlay is the overlay's; a click in pick mode picks; a click outside an open edit commits it and still reaches the page, so following a link is never a losing move; and a press on an armed choice button is the reviewer's answer. That last is the one click in browse the library takes, and only because the agent marked the button as a question. It has no hint row: every row is a line on every page's rail, and a page with no choices must look exactly as before.

Gone, on purpose: Alt-click (nobody found it), a plain click placing the caret (it fought the page for every click), Cmd-click following a link (browse is native, so a plain click already does), and an editing toggle (editing is per block now, entered with Cmd-Shift-E).

Every function here is pure over a plain description of the event, not a DOM event, so the whole table is unit-tested with no browser and the browser tests check only the wiring.

**Chords.**

- Present is Cmd-Shift-X. P and H were the obvious letters, and both are taken by something a presenter cannot afford mid-talk: Cmd/Ctrl-Shift-P opens a private window in Firefox and Edge, and Cmd/Ctrl-Shift-H is Home in Safari (which navigates the deck away) and the history library in Firefox. X is unbound in Chrome, Safari, Firefox and Edge on both platforms, and reveal.js uses only unmodified letters.
- The rail is Cmd-Shift-1. It had to be a left-hand chord, and every left-hand letter that reads as a mnemonic is already a browser's with Cmd/Ctrl-Shift (A tab search, B bookmarks bar, D bookmark all tabs, F fullscreen or find, G find previous, Q log out, R hard reload, S save, T reopen a tab, V paste and match style, W close the window, Z redo). Among the left-hand digits, 3, 4 and 5 are macOS screenshots and the backtick cycles windows. Digit 1 is free in the four browsers on macOS and Windows.
- The rail chord matches on `code` as well as `key`, because Shift changes what `key` reports for a digit, and how depends on the layout ("!" on US).
- The present chord is decided first, with no conditions: present mode hides the whole library and this chord is how the reviewer gets it back. The rail chord is second, so it works from anywhere, including the rail's own fields. While presenting, the caller refuses the rail chord, so Cmd-Shift-X is the only way back.

**Leaving an edit.** A pointer going down anywhere outside the edited block commits it, the rail included. The click rule alone could not: a click on the rail is retargeted to the overlay host, hits the overlay rule, and the edit sat in draft forever, never offered to an agent. Pointerdown is the honest moment the reviewer left; it fires before focus moves, and the event still reaches the rail and the page. Two presses are not leaving: a scrollbar drag (pointerdown with no click after it, which stripped editing mid-scroll) and a secondary button (a context menu). Both broke when the rule widened from click to pointerdown. A caller that cannot tell which button means a primary press.

**The send key.** Enter sends a comment and Shift-Enter starts a new line, like a chat box. A reviewer who writes long comments can switch to Cmd-Enter in the Keyboard shortcuts panel, and then a bare Enter is a new line. Cmd-Enter sends under both settings, so the old habit keeps working. Only boxes the reviewer writes to the agent follow this; an edit on the page is writing on the page, where Enter is a paragraph. An Enter that picks an input-method candidate (Japanese, Chinese) is never a send; Safari reports such a key as `keyCode` 229.

**Breaks.** Enter while editing is typing, not a shortcut, so it has no hint row. But the record must say which break the reviewer typed, and the engines disagree (measured in all three engines in a bare `<p contenteditable>`): Enter writes a nested block in Chromium and WebKit and a `<br>` in Firefox; Shift-Enter writes a `<br>` in Chromium and Firefox and a nested block in WebKit. So the layer decides the break from the key and writes it itself. `inputType` alone is not enough, because WebKit reports Shift-Enter as `insertParagraph`, the same as Enter; the Shift state of the keydown breaks the tie, and the caller supplies it because a `beforeinput` event does not carry one.

**Bold and italic.** One button does two opposite things, decided by what the reviewer sees: words not yet bold ask for bold, and words that look bold, whether from a `<strong>` or a stylesheet, ask for it to come off. Left to the engine, taking bold off stylesheet-bold text wrote a style attribute the tool cannot keep, and taking italic off stylesheet-italic text did nothing at all in Firefox. Bold and italic are the only two commands; anything else is not a gesture this tool has.

**Block types.** The chords match on `code`, so the character Option or Shift makes never matters. None uses Ctrl-Alt, because AltGr sends Ctrl-Alt on Windows and Linux and types a character with a digit on German and Polish layouts; nothing matches while AltGraph is held. Digit 1 is skipped because Cmd-Shift-1 opens the rail, and a heading's digit is its level on the page. The Markdown shortcuts use Markdown's own levels, so `## ` makes the h2 it means in the source (the flow walk once found them one level off), and `# ` also makes an h2 because the page title is the page's only h1. A contenteditable often turns the typed space into a no-break space, which counts as a space.

**Inside a writing session**, Enter, Backspace and Delete at a block's edge, and undo are decided here too, so the editing code reads one answer. The layer cancels a native merge and writes its own, because a native merge adds style spans. Backspace or Delete at the session's own first or last block is refused, so no page block outside the session changes. Cmd-Z inside a session walks the session's own history; outside one, Lahe's per-record undo is unchanged.

### For `docs/ongoing/code/browser-review-layer-editing.md` (new)

Frontmatter `read-when: Changing a file in src/browser/review-layer/editing/, or working out why one of them does what it does.` and the same `not-for` as the other folder docs. The folder holds the review layer's editing code; today only `write-epoch.ts`, with `editing.ts` arriving in slice B11.

#### `write-epoch.ts`: keeping Lahe's own writes from waking replay

The problem: replay writes a region; the MutationObserver watching the page sees that write and schedules another replay pass; that pass writes again, or at best compares and skips, and the observer sees it, and the loop runs until something else stops it. On a page that also repaints on a timer, the two interleave, with the reviewer's caret inside.

The rule has three parts, and all three are needed. The first two alone lose mutations, and the third alone is a race.

1. Every mutation the tool makes to the reviewed page happens inside `write(reason, fn)`. No exceptions, including a one-line `textContent` assignment and the rail attaching a highlight.
2. `write` raises the depth synchronously, runs `fn`, and lowers the depth in a microtask, not when `fn` returns. This is the part that is easy to get wrong. A MutationObserver's callback is a microtask queued at the moment of the first mutation, which happens inside `fn`, so a microtask queued after `fn` runs after the observer. The observer sees the epoch open for exactly the batch holding the tool's own writes, and for nothing after.
3. The observer asks `isWriting()` first and returns without scheduling when it is true. It still notes that something happened (`noteExternalMutation`), because a page repaint can land in the same batch as a tool write, and dropping it silently is how a real repaint goes unnoticed.

The owed pass must be run, not just remembered. When the depth unwinds to zero with a mutation owed, the epoch calls its `onIdle` listeners, whoever opened it. Replay used to consume the flag only at the end of its own passes, so a repaint that collided with any other write (an edit session opening, a format command, an undo, protect restoring a snapshot) was remembered and never run, and the page kept whatever the repaint put there until something unrelated happened. The epoch is the only place that knows every one of its openings, so the wake-up belongs to it. A listener calls `takePendingExternal` and decides for itself.

The epoch number advances once per write. Replay stamps the number it last ran at, so a pass that wakes with no new write and no outside mutation can finish without touching the page.

An exception inside `fn` still closes the epoch. Otherwise the depth would stay above zero and mute the observer for the rest of the session.

There is one epoch per page, made when the module loads; tests make their own with `createEpoch`.

### Dropped as dead history

- Owner and task codes: "Owner: Task 0a", "0A-wire", "0A-kernel", "Style switcher 1.1", and the lists of importers by task id (1B, 1C, 2A, 2B, 2C, 3A, 3C).
- "REWORKED for the current architecture" and its list of codes removed with the archived send model.
- Every "Phase 4B cleanup batch" note, about the aliases and the alias map.
- Every "Dual-environment module. See docs/CONTRACTS.md, How a shared module loads" line, and the wrapper comments; the wrapper is gone.
- "Task 2B fills in the classification" and other seams described as future work for tasks long finished.
- "Injectable so tests can drive the deferral", with the option it described.
- Requirement and acceptance ids on code (R7, R16, R17, R24, R43, AC6) and the hint table's `requirement` field. The folder doc keeps D3 and R13 once, with a link, because that rule still explains the design.
- "Task 2C asserts exactly one after 100 morphs", "first-real-use finding", and the dated attributions ("Ken, live, 2026-08-18", "review, 2026-08-17", "measured on 2026-08-23", "the 2026-09-16 memory audit"); the substance stays where it explains a rule, and the dates live in git history.

## 10. Open questions

1. **`rail_menu.spec.js` requires `src/shared/gestures.js` from Node inside a Playwright spec,** and the forwarder `require`s a `.ts` file. Playwright installs its own TypeScript transform for files it loads, and whether it hands an ES module `.ts` file under `src/domain/` to Node or transforms it is not verified here. The builder runs `rail_menu.spec.js` by name. If it fails, the smallest fix is in the spec: read the panel line count from the page (`window.LAHE.gestures.panelLines()`), as `comments_highlights.spec.js` already does for hint lines. That edit is outside C1's files, so raise it with the orchestrator first.
2. **`docs/CONTRACTS.md` names `src/shared/failures.js` and `failures.ALIASES`** in its failure-table section. The plan gives CONTRACTS.md to F1. This spec keeps `ALIASES` exported so the doc stays true apart from the path; F1 updates the path.
3. **Removing the six dead codes (D1)** is decided here, on the evidence that nothing raises them. If the orchestrator would rather keep every code until a cleanup slice, keeping them changes only B10's list and D1.

## Cleanup needed

- `test/browser/support/export_stub.js`: nothing calls `installExportStub`; it reads `src/shared/markers.js` and three other shared files by path, and would load a forwarder into a page if anyone did call it.

## Orchestrator decisions (2026-11-12)

1. **`rail_menu.spec.js`:** the C1 builder runs it by name. If it cannot load the gestures module through the forwarder inside Playwright, the builder points it at S0c's bundle helper, and C1 owns that change.
2. **`CONTRACTS.md` naming the old failures path:** left for F1's doc sweep, as the plan says.
3. **The six failure codes nothing raises:** remove them. This is the cleanup Ken asked for.
4. **`export_stub.js` is dead:** confirmed. Only a comment in `edits_tab.spec.js` names it. It goes on the cleanup list; C1 does not change it. This replaces decision 3 in the C2 spec.
5. **The three failure-table cases from `protocol_wire.test.js`:** C1 carries them into `test/unit/contract/failures.test.ts`, as mapped above, and C4 drops them.
