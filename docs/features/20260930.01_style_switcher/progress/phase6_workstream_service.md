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

## To delete at cleanup

Nothing in the repo. Scratch under `/private/tmp/claude-501/.../scratchpad/` (`paid-state/` with the six paid styles installed, `smoke-state/`, `edit_markdown.py`, gate output) stays where it is, since `/tmp` is never cleaned by hand.
