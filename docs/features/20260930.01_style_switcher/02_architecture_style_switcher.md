# Architecture: Style switcher

## Summary

A style is a folder installed once per machine into Lahe's state directory by a new `lahe style add` command, which checks it and copies only the files a page may use. The session's page servers serve installed styles under one reserved path segment, `.lahe-styles/`, from any directory they serve, the same way they already serve `.lahe-doc-style.css`. On a page that uses the house style, the rail gets a Document style panel. A click on a style adds one stylesheet link to the page, right after the house style, so the whole page restyles at once with no reload. The choice is kept in browser storage for that page. "Use this style" sends an ordinary note whose words carry a fixed marker, `lahe-style: <id>`. The agent turns it into one line of source: a stylesheet link in an HTML page, or a frontmatter line in a Markdown file, which the renderer turns into the same link. No record shape, route or review file field changes. The agent contract gains one instruction.

## Analysis of Existing Structure

- **The house style has two routes into a page.** Rendered Markdown inlines the bundle (tokens, `document.css`, `lahe-markdown.css`) in a `<style>` element. A page an agent writes links `./.lahe-doc-style.css`. When a request names a file that is not on disk, the page server's fallback (`static_servers.js`, the `catch` after `statSync`) resolves three packaged basenames, including that stylesheet and `.lahe-fonts/<file>`. One-page servers (`servePage`) answer the same assets from an explicit allowlist. This feature adds a fourth packaged path to both, and it changes neither route.
- **A paid style is built to load after the base.** Its `style.css` resets tokens, declares its fonts with `url("./fonts/<file>.woff2")`, and adds layout rules. The fonts resolve relative to the stylesheet, so a style served as a folder needs no URL rewriting.
- **Rendered Markdown is a file in the session's artifact folder**, written by `markdown.writeArtifact`, which copies the house fonts beside it (`copyFonts`). The folder server serves that artifact, and `rebuild.js` re-renders it when the source changes. The source's frontmatter is shown in a "Document metadata" block and is not otherwise read.
- **The rail** (`overlay.js`) has a head menu (`MENU_ITEMS`: Copy, Export, fold all, Present) and panels built once and shown on demand (the end-review panel, the overdue banner). Boot (`index.js`) wires menu actions through `rail.onAction`.
- **Notes** (R18 of the original brief) are minted in `comments.js` and flow through the store, the outbox and the projection like any item. The contract says intent lives in `note` and `change` only.
- **Stays the same:** the record shape, `review.json`'s schema, every helper route, D2 (the library never writes the reviewed file), D11's token model, and the helper process. The helper is not involved in serving or listing styles at all.

## Components / Modules Touched

| Where | Change |
| --- | --- |
| `src/service/styles.js` (new) | The one owner of installed styles: where they live, the folder rules, the stylesheet check, listing, resolving a served path to a file, and copying a style's served files beside a Markdown artifact |
| `src/service/state_dir.js` | Names the styles folder inside the state directory |
| `src/cli/commands/style.js` (new), `src/cli/index.js` | `lahe style add <folder>...` and `lahe style list` |
| `src/service/static_servers.js` | The `.lahe-styles/` fallback in the folder server and the same route in the one-page server, both answered by `styles.js` |
| `src/service/markdown.js` | Reads `lahe-style` from frontmatter, links the style after the house bundle, marks the inlined bundle, and copies the style's files beside a written artifact |
| `src/layer/style_switch.js` (new) | The page side: detects the house style and the document's own style, applies and clears a preview, keeps the preview in browser storage, fetches the style list |
| `src/layer/overlay.js` | The head menu item and the Document style panel |
| `src/layer/comments.js` | One function that mints a ready note with given words for the current page, without a box |
| `src/layer/index.js` | Boot wiring: restore a preview, connect the panel to the switch and to the note |
| `src/shared/manifest.js` (frozen) | Lists the three new files; the layer file loads after `store.js` and before `overlay.js` |
| `src/shared/review_format.js` (frozen) | One new contract instruction |
| `skills/lahe/SKILL.md`, `docs/CONTRACTS.md`, `test/unit/review_format.test.js` | The same instruction, restated as the repo requires; the skill's "one stylesheet" rule gains the optional style line |
| `docs/CLI.md`, `docs/ongoing/STYLES.md` (new), `vendor/stclair-doc-style/README.md` | How styles work now, for the next builder |

## Data / State Changes

::: xref
Grounds [R9 and R10 (installing, and refusing a bad folder)](01_brief_style_switcher.html#installing-styles) and [R13 (a style reaches only its own files)](01_brief_style_switcher.html#safety).
:::

**The style id.** Lowercase letters, digits and hyphens, starting with a letter or digit, at most 40 characters. Taken from the folder's name at install (lowercased, spaces and underscores become hyphens). `international` is reserved for the house style and cannot be installed.

**The styles folder.** `<state dir>/styles/<id>/`, owner-only like the rest of the state directory. An installed style holds only:

- `style.css`, at most 1 MB
- `metadata.json`, at most 64 KB: `name` (required, 1 to 60 printable characters), `description` (optional, at most 300), `palette` (optional, a list of `{value}` hex colours; the first six are used)
- `fonts/*.woff2`, at most 16 files of at most 2 MB each, names of lowercase letters, digits, dots, hyphens and underscores
- `DESIGN.md` and any `LICENSE` file, copied for the reader and never served

**The stylesheet rule.** Checked at install and again whenever a page server serves the file. The check reads the sheet the way CSS does: comments, then quoted strings (including a backslash-newline continuation inside one), then `url()` tokens. The sheet is refused if, outside comments and strings, it has:

- any `@import`
- any backslash, since an escape can spell `url(` in a way a plain scan misses
- any other function that fetches by string: `image-set`, `-webkit-image-set`, `image`, `cross-fade`, `src`, `element`
- any `url()` whose value is not `data:` and is not `./fonts/<file>.woff2` or `fonts/<file>.woff2` naming a file in the folder

So a style can reach its own fonts and inline data, and nothing else. A prototype of this rule was run against all six paid styles on 2026-09-30 and all six pass. Two shapes in them a naive check would wrongly refuse: a custom property string continued over lines with a backslash (Textbook, Schematic), and a `data:` SVG whose quoted markup contains an `http://` namespace (Schematic).

**Served paths.** From any directory a page server serves, when the file is not on disk, the last `.lahe-styles` segment of the path and what follows it must be exactly one of:

- `.lahe-styles/index.json`: the installed list, `{styles: [{id, name, description, palette: [hex]}]}`, built on each request, with only validated values (hex matches `#` plus 3, 4, 6 or 8 hex digits)
- `.lahe-styles/<id>/style.css`
- `.lahe-styles/<id>/fonts/<file>.woff2`

Anything else under that segment is a 404.

**What the document carries.** The only two forms the agent writes:

- HTML: `<link rel="stylesheet" href="./.lahe-styles/<id>/style.css">` directly after the `./.lahe-doc-style.css` link
- Markdown: the frontmatter line `lahe-style: <id>`, which the renderer turns into that same link directly after the inlined house bundle

The inlined bundle gains the attribute `data-lahe-doc-style`, so the layer finds the house style the same way on both kinds of page. A written artifact gets the style's `style.css` and fonts copied beside it at `.lahe-styles/<id>/`, so a saved file still shows the style from disk (R8, a kept style stays with the document). A missing style is copied as nothing, and the link falls through to the page server.

**The request to the agent.** An ordinary note, state ready, for the current page, whose words are exactly: `Use the <name> style for this page (lahe-style: <id>).` For the house style the words name the International Style and `lahe-style: international`. The marker is the machine-readable part; the contract names it.

**The preview.** One browser storage key per page of a review: `lahe.style.v1:<review id>:<page path>`, holding a style id. The preview link carries the library's chrome marker so anchoring, replay and the handled check never see it.

## Key Flows

::: xref
Grounds [R3 (one click restyles the page)](01_brief_style_switcher.html#trying-a-style), [R4 and R5 (a preview survives a reload, and the rail says so)](01_brief_style_switcher.html#trying-a-style) and [R6 (keeping is one deliberate action)](01_brief_style_switcher.html#keeping-a-style).
:::

**Boot.** The layer looks for the house style: a stylesheet link whose file name is `.lahe-doc-style.css`, or a `<style data-lahe-doc-style>`. None means no menu item and nothing else from this feature (R1). If found, it reads the document's own style: the last stylesheet link whose path has a `.lahe-styles/<id>/style.css` tail, else `international`. It then reads the stored preview. If the preview equals the document's own style, the key is removed (the agent has applied it). Otherwise the preview is applied. Boot does not fetch the style list.

**Applying a preview.** Every page link to `.lahe-styles/` is disabled (a property, so the page's markup is not changed). For any style but International, one chrome-marked link to `./.lahe-styles/<id>/style.css` is inserted directly after the house style element. The page restyles in one pass and fonts load from the style's folder. Nothing in the body changes, so an open edit, comment boxes and highlights stay where they are, repositioning as they do on a window resize. If the preview link fails to load (the style was removed), the preview is cleared and the panel says why.

**Back to the document's style.** Removes the preview link, re-enables the document's own links, and clears the key.

```mermaid
sequenceDiagram
    participant R as Reviewer
    participant P as Rail panel
    participant S as style_switch
    participant PS as Page server
    participant A as Agent
    R->>P: Menu, Document style
    P->>PS: GET .lahe-styles/index.json
    PS-->>P: installed styles
    R->>P: click Textbook
    P->>S: preview textbook
    S->>PS: GET .lahe-styles/textbook/style.css, then fonts
    Note over S: page restyles, key saved
    R->>P: Use this style
    P->>A: ready note "... (lahe-style: textbook)" via the outbox
    A->>A: writes the link, or the frontmatter line
    A-->>P: reply handled
    Note over S: page reloads on the rebuild; document style equals preview, key cleared
```

**The panel.** The head menu gains "Document style". It opens a panel under the head, built once like the end-review panel, and fetches the list each time it opens. It holds:

- a radio group: International first, then installed styles by name, each with a strip of its palette; the document's own style is labelled "in the document"; arrow keys move and preview, as native radios do
- a status line while previewing: "Previewing Textbook. The document uses International." with a "Back to the document's style" button, and "Use Textbook for this page" as the one primary button
- a waiting line once the note is sent, while a ready note on this page carries that same marker and has no reply; the primary button is disabled for that style meanwhile (R6)
- when the document names a style not in the list: "This document asks for `<id>`, which is not installed here." (R12)
- when nothing is installed: International alone and "Add a style with `lahe style add <folder>`." (R11)
- Close, and Esc

When the panel is closed and a preview is active, the panel collapses to its status line, so the rail always says the page is not showing the document's own style (R5). The panel uses the rail's own tokens and type, the menu's item styles and the end-review panel's button styles. Only the palette strips draw colour from the style, through validated hex values.

**Install.** `lahe style add <folder>...` checks each folder against the rules above, copies the allowed files into a new folder beside the target, then renames it into place, replacing any earlier install of the same id. It prints each installed id and name, or the first reason for refusal and what a style folder needs (R10). `lahe style list` prints id, name and version from `metadata.json`. Removing a style is deleting its folder, as the brief says.

**Markdown with a style.** `rebuild.js` re-renders when the source changes. The render reads `lahe-style`, emits the link, and copies the style's files beside the artifact. The page reloads on the new mtime as it does for any rebuild.

## Alternatives Considered

- **Keep a style in the browser only.** Smallest, and chosen as the first half. Rejected as the whole answer: the document never changes, so R8 (a kept style stays with the document) fails.
- **The helper applies a remembered style as it serves the page.** No agent step. Rejected: the file on disk never carries the style, so any copy outside Lahe differs, and a second place decides how a page looks. That drift is what the house style rebuild ended.
- **A new record kind, or a structured `style` field on a note.** Easier to detect. Rejected: a new kind touches the store, the projection, the tabs and the comparison modes, and the contract's rule is that intent lives in `note` and `change` only. A fixed marker in the note's words is readable by the agent and the rail alike.
- **Serve styles from the helper's port.** One server for every page kind. Rejected: a kept link would bake a port into the document, fonts across origins need CORS, and the helper would serve files to every page on the machine. The page server already serves the house style by the same fallback, so styles ride that.
- **Inline the paid CSS into rendered Markdown, as the house style is.** Rejected: its fonts are relative to the stylesheet and would need rewriting, and a link in both page kinds lets the layer read the document's style one way.
- **Point Lahe at style folders where they are (a config list of paths).** No copy. Rejected: a folder in Downloads can change or vanish, a path list widens what the page server can reach, and each serve would validate a moving target. A checked copy is validated once and owned by Lahe.
- **Drop-in folder with no command.** The state directory is hard to find, so the command stays. A hand-copied folder still works and is still checked when served (R13).
- **Keep the preview only until reload.** Rejected: every agent rebuild reloads the page and would throw the preview away while the reviewer looks at it.
- **`rel="alternate stylesheet"`.** Rejected: every alternative would have to be in the page's source, and only Firefox exposes a menu.
- **A standing control in the rail head.** Rejected to keep the rail quiet. Copy and Export moved into the menu for the same reason. The collapsed status line keeps a preview visible.

## Failure Modes / Edge Cases

- **Paint flash on reload during a preview.** The library loads at the end of the body, so the page paints in the document's style for a moment before the preview applies. Accepted. It ends when the style is kept.
- **A stale copy beside an artifact.** A folder server serves files that exist before the fallback, so after a reinstall a Markdown page can show the older copy until its next render. The render always recopies.
- **Two style links in the source.** The last one is the document's style. A preview disables all of them. The contract says to replace, not add.
- **A link written before the house style.** The paid style loses the cascade and the page looks wrong. The contract says where the line goes. The layer does not police it.
- **A page with the house style that a Lahe page server does not serve** (a dev server, `file://`). The list fetch fails, so the panel shows International alone and the add line. Preview links would fail and clear themselves.
- **Keep while the helper is down.** The note waits in the outbox like any note.
- **Mermaid** keeps the house palette under every style, as the brief's non-goals say.

## Security & Privacy Notes

::: xref
Grounds [R13 (a style cannot expose or load anything beyond its own stylesheet and fonts)](01_brief_style_switcher.html#safety).
:::

- **The trust boundary.** A style is third-party CSS applied to a page that carries a review token on its script line. CSS can read attribute values through selectors and report them through a `url()` fetch. So the stylesheet rule forbids every network reach, not just `@import`, and runs at serve time as well as at install, so a hand-edited or hand-copied folder cannot skip it. The backslash rule closes CSS escapes that would spell `url(` in a way a plain scan misses.
- **Path safety.** The served path is matched against three exact shapes, never joined from free text. The id and file name are checked by pattern before any file system call. Every level under the styles folder is checked to be a real folder or a regular file, not a symlink, and the resolved real path must sit inside the styles folder. Install copies with the same checks and never follows a symlink.
- **What becomes readable.** Only `style.css`, fonts and the built list. `metadata.json`, `DESIGN.md` and licences are never served. The page server's Host check already refuses DNS-rebound requests. The list names installed styles to scripts on pages that server already serves; they are not secret.
- **Display.** Names and descriptions reach the rail as text, never as markup. Palette values reach inline styles only after the hex check.
- **The agent channel.** The note's words are Lahe's fixed sentence plus a checked id and name. The contract tells the agent that only an id matching the pattern is a style request, so a note a reviewer typed with a strange marker is not an instruction to write arbitrary markup.

## Test Strategy

The plan owns the one verification table: [03_plan_style_switcher.md](03_plan_style_switcher.md). The failure modes above each have a row there. Tests use a made-up style under `test/fixtures/styles/`, whose font is a copy of a vendored OFL face. No paid style enters the repo.

## Open Questions

None open. Decisions and their history are in the brief's [Questions and Decisions](01_brief_style_switcher.md#questions-and-decisions).

## Architect Review

| # | Finding | Disposition | Rationale |
|---|---------|-------------|-----------|

## Security Review

| # | Finding | Disposition | Rationale |
|---|---------|-------------|-----------|
