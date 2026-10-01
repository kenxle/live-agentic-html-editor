# Service workstream: installed styles (pull request A)

Builder: Service builder, Tasks 1.1 to 1.3 of `03_plan_style_switcher.md`.
Branch: `worktree-agent-a38fe46bdbb87a877`, started from `feat/style-switcher` at `f2bdab5`.

## Summary

- Styles install, serve and render. `lahe style add <folder>` checks a style folder and copies only the files a page may use into `<state dir>/styles/<id>/`. Every page server answers `.lahe-styles/...` from there. A Markdown file with `lahe-style: <id>` in its frontmatter renders with that style.
- The stylesheet check is a tokenizer, written tests first. All six paid styles pass it, at install and at serve, read in place from the personal repo and never copied into this repo.
- `npm run gate:unit`: 2346 tests, 2344 pass, 0 fail, 2 todo. The baseline on `f2bdab5` was 2277, 2275, 0, 2. The 69 new tests are all this workstream's.
- `test/browser/markdown_style_file.spec.js` (V24): 2 passed, Chromium.
- Rows passing: V1, V2, V3, V4, V5, V6, V7, V22 (service half), V24, V25 (service half). V21 is the gate's lint.

## What was built, file by file

- **`src/service/styles.js`** owns installed styles:
  - the id rule and the reserved id `international`
  - the metadata rule: name, description, version, palette, and no control or bidi character in any string
  - the stylesheet tokenizer and rule
  - reading each file once without following a symlink
  - `readStyleFolder` (install side), `install` (per-id lock, rename aside, rename in, put back on failure), `list` and `index`
  - `answer` for the three served shapes, with checked bytes cached per file on size, time and inode
  - `copyBeside` for a written artifact
  - the `_hooks.betweenRenames` test seam
- **`src/service/state_dir.js`** names the styles folder: `stylesRoot` and `ensureStylesRoot`. The header's directory map gains the folder.
- **`src/cli/commands/style.js`** is `lahe style add <folder>...` and `lahe style list`. It parses and prints only; every rule is in `styles.js`, and everything printed from a folder goes through `styles.clean`.
- **`src/cli/index.js`** routes `style` and lists it in the usage text.
- **`src/service/static_servers.js`**:
  - Any path with a `.lahe-styles` segment is answered from `styles.js`, after the library route and before page mode and the disk lookup, so folder and one-page servers both answer it.
  - A refused style is a 404 plus one `helper.log` line per server per style, through `say()`.
  - A comment beside `hasHiddenSegment` says the reserved segments are answered first.
- **`src/service/markdown.js`**:
  - The inlined bundle is `<style data-lahe-doc-style>` (`DOC_STYLE_ATTR`).
  - `styleFromFrontmatter` reads the first line that is exactly `lahe-style:`, optional spaces, an id, optional spaces.
  - `renderPage` returns the HTML and the style id. The link goes directly after the bundle, outside the body's URL rewrite.
  - A frontmatter block holding only the style line (blank lines aside) is not shown as Document metadata.
  - `writeArtifact` copies the style's checked files beside the artifact. A missing or refused style is copied as nothing, and a failed copy never fails the render.
- **`test/fixtures/styles/sample/`** holds:
  - a `style.css` that resets tokens, with one `@font-face` on a renamed copy of the vendored JetBrains Mono (OFL)
  - both real-world shapes: a backslash-continued custom property string and a `data:` SVG naming an `http://` namespace
  - a `metadata.json` with a palette, a `DESIGN.md`, and the OFL `LICENSE`
- **`test/fixtures/styles/sample-dark/`** sets a dark page ground for the Rail builder's scheme test.
- **`test/fixtures/free_writing/empty_notes.html`** was re-rendered. **`md_render.html`** gained only the marker; see Deviations.
- **`docs/CLI.md`** gains a row for each command, and a paragraph on the one line a page carries and how it is served.

## Tests

| File | Tests | Rows |
| --- | --- | --- |
| `test/unit/styles.test.js` | 36 | V1, V2, V3, V22 (service half) |
| `test/unit/style_command.test.js` | 11 | V1, V2, V4 |
| `test/unit/static_styles.test.js` | 7 | V5 |
| `test/unit/markdown_style.test.js` | 15 | V6, V7, V25 (service half) |
| `test/browser/markdown_style_file.spec.js` | 2 | V24 |

The tokenizer tests were written first and run red (36 of 36 failing) before `styles.js` existed. The serving and Markdown tests also ran red first (7 of 7, and 9 of 15). The style command tests were written before the command, but I did not run them red on their own before wiring it.

`leaf_blocks.test.js` and `markdown_render.test.js` still pass with the changed fixtures (42 of 42).

## The six paid styles

All six were checked by `readStyleFolder` in place: Field Guide, Folio, Ledger, Poster, Schematic and Textbook. All six pass.

All six were then installed into a scratch state directory under `/private/tmp`, outside any checkout. All six serve `style.css` with a 200 through `answer`. Ledger's `content:"\00A7\00A0"` (an escape inside a string) passes, as the rule intends. Textbook, Schematic and the others carry backslash-continued `--palette-families` strings, and Schematic carries `data:` SVGs naming `http://www.w3.org/2000/svg`; those pass too.

## Deviations

- **`md_render.html` got the marker only, not a full re-render.** Its inlined CSS predates the style refresh. A full re-render rewrites about 32 KB of CSS in a fixture that three browser specs read (`blocks_kernel`, `replay_run_check`, `free_writing_repaint`), and I may not run those. Outside the `<style>` element, a fresh render is byte-identical to the fixture plus the marker. To re-render it fully, run `markdown.render("test/fixtures/free_writing/doc.md")` into it at the checkpoint, before the browser suite. That is one command. `empty_notes.html` was re-rendered fully: it was already current.
- **The stylesheet rule is tighter than the architecture in six places.** None loosens it, and all six paid styles still pass:
  - a backslash inside a `url()` argument is refused, quoted or not
  - a base64 `data:` SVG is decoded and checked like a percent-encoded one
  - a decoded `data:` SVG may not hold `&` (an XML entity can spell `url(`) or a backslash (a CSS escape can)
  - a `data:` URL may carry only `base64` and `charset=` parameters
  - a vendor prefix does not hide a fetching function or `@import`
  - a served file with more than one hard link is refused
- **Install skips what is not part of a style instead of refusing it.** Real style folders carry `html/`, `screenshots/`, `scripts/` and `directions/`, and a downloaded folder often has `.DS_Store`. `fonts/LICENSE` is copied for the reader and never served.
- **`DESIGN.md` and licence files are capped at 1 MB.** They are read into memory, so they get a cap; the architecture names none.
- **A palette entry that is not hex refuses the folder.** The alternative was dropping the entry silently. The layer still re-checks colours.
- **A refused folder exits `1`.** `protocol.CLI_EXIT` has no refusal code and `protocol.js` is not mine to edit. `lahe add` already uses `1` for the same kind of answer.
- **`lahe style add` takes several folders.** One refused folder does not stop the others, and the exit is `1` if any was refused.

## Follow-ups

- Task 1.4 (orchestrator): `skills/lahe/SKILL.md`, `docs/ongoing/STYLES.md` and the vendor README paragraph. The exact lines for the skill are the link `<link rel="stylesheet" href="./.lahe-styles/<id>/style.css">` and the frontmatter line `lahe-style: <id>`, from `styles.linkTag` and `markdown.styleFromFrontmatter`.
- `test/fixtures/free_writing/README.md` says `md_render.html` is a fresh render, which it now is not. It is not in my Owns column, so I left it.
- `attr()` is not refused. CSS forbids an `attr()` value from becoming a URL, and no paid style uses it. If the security reviewer wants it refused anyway, it is one name in `FETCHING_FUNCTIONS`.
- Two folder names can make the same id ("Field Guide" and "field_guide"). The second install replaces the first, as a reinstall does.

## Fix round 1

The security and code reviews of pull request A came back. I started from `origin/feat/style-switcher` at `6e2cd2e`, which holds this work, the docs task and the `planned: true` manifest entry for `src/shared/style_rules.js`. Every fix has a test, and each test ran red before its fix.

### What changed

- **Encodings (the blocker).** `checkStylesheetBytes` is the one bytes-taking check that install and serve both call. It refuses:
  - a sheet starting with FE FF or FF FE
  - any NUL byte
  - bytes that `TextDecoder("utf-8", {fatal: true})` rejects
  - an `@charset` other than `"utf-8"`, in any case, quoted or not

  A UTF-8 byte-order mark is still allowed, since a browser reads it as UTF-8. A decoded `data:` SVG gets the same NUL, byte-order-mark and UTF-8 checks. The tests include a UTF-16LE sheet holding `@import url(https://evil.example/x.css);`, refused both at install and when copied into the store by hand.
- **`data:` URLs are read the way a browser's URL parser reads them.**
  - Tab, CR and LF are dropped from the whole `url()` value, and leading and trailing spaces and control characters are trimmed.
  - The payload is base64 only when the header ends in `;base64`. A `base64` anywhere else is refused as an unknown parameter.
  - The payload is percent-decoded first, then base64-decoded.
  - A decoded SVG is also refused for `src=`, `<foreignobject`, `<style`, `image-set`, `image(` and `src(`. I added one more: an XML `encoding=` declaration other than UTF-8.
- **The install lock.**
  - The lock holds a random 16-byte value.
  - A stale lock is renamed aside and removed only if it still holds what was read. If it changed, it goes back and the add stands down.
  - An add releases the lock only while it still holds its own value.
  - The first rename is inside the `try`, and every failure inside `install()` is a `refuse()` with a reason, including a non-EEXIST error from taking the lock, and a thrown non-Error.
  - A failure removes the `.new-` folder and puts the `.old-` one back, so neither is left behind.
- **The serve cache key** now holds `ctimeMs` too. The test rewrites the sheet keeping its size, inode and (whole-second) modification time, and the next serve refuses it.
- **The path race** is recorded in `docs/ongoing/STYLES.md` under Known limits as accepted. There is no code change.
- **`src/shared/style_rules.js`** holds:
  - the id pattern and `isStyleId`
  - the reserved id and name
  - the hex rule and `isHexColour`
  - the name rule and `isStyleName`
  - `NAME_MAX`, `DESCRIPTION_MAX` and `PALETTE_MAX`

  It uses the `markers.js` registration pattern, so it loads in Node and registers as `LAHE.styleRules` in the layer. `styles.js` takes all of these from it.
- **Smaller fixes.**
  - The RESERVED SEGMENTS comment now sits above the `hasHiddenSegment` JSDoc.
  - `sendStyle`'s catch logs once through `say()`, as "could not answer ...".
  - `writeArtifact`'s `copyBeside` catch logs once to `helper.log`, as "could not copy style ...". `markdown.js` has no `say()`, so it uses its own once-per-message latch through `log.js`.
  - `BAD_CHARS` is built from a string of `\u` escapes, and a test checks that no literal bidi character is left in `styles.js` or `style_rules.js`.
  - A `.woff2` file is a font before the licence-name check, so `ofl-sans.woff2` counts as a font.
  - The refusal log latch is keyed on id plus reason.

### Tests

- `npm run gate:unit`: lint passed (403 files, no jsdom, manifest complete). 2370 tests: 2368 pass, 0 fail, 2 todo. The 24 new tests are 21 in `styles.test.js`, 2 in `static_styles.test.js` and 1 in `markdown_style.test.js`.
- `test/browser/markdown_style_file.spec.js`: 2 passed, Chromium.
- Three tests changed to match the new rules:
  - The V5 symlink test now expects two log lines: the font and the sheet are refused for different reasons, and the latch is now per reason.
  - The tab-stripping test splits `href` with tabs only. A CR or LF inside a CSS string ends the string before the URL parser sees it.
  - The unwritable-folder test puts a file where the styles folder goes. `ensureDir` re-applies 0700 to a folder, so a `chmod` cannot make it unwritable.

### The six paid styles, again

All six read, install and serve with a 200 under the new rules: Field Guide, Folio, Ledger, Poster, Schematic and Textbook. Schematic's two `data:` SVGs pass the wider SVG check. I installed them into a scratch state folder under `/private/tmp`, outside any checkout.

### For the orchestrator

- `src/shared/style_rules.js` now exists while its manifest entry still says `planned: true`. Removing the mark and rebuilding `dist/` at the checkpoint is yours.
- The `sendStyle` catch test makes an installed `fonts/` folder unreadable (`chmod 000`). The test restores it in `t.after`.

## To delete at cleanup

Nothing in the repo. Scratch under `/private/tmp/claude-501/.../scratchpad/` stays where it is, since `/tmp` is never cleaned by hand:

- `paid-state/` and `paid-state-fix1/`, with the six paid styles installed
- `smoke-state/`
- `edit_markdown.py`, `fix1_styles.py` and `fix1_static.py`
- gate output
