# Installed styles

Read this before touching `src/service/styles.js`, `src/cli/commands/style.js`, the `.lahe-styles` route in `src/service/static_servers.js`, or the style line in `src/service/markdown.js`. The feature folder (`docs/features/20260930.01_style_switcher/`) is the history of why; this page is how it works now. Where the two differ, this page and the code win.

This page covers the installed half of the style switcher: installing a style, serving it, and carrying it on a page. The rail's switcher is not covered here.

## Summary

- A style is a folder of CSS, fonts and metadata that a reviewer installs once per machine with `lahe style add <folder>`.
- Installed styles live in the state folder, not in any repo or reviewed folder.
- A page uses a style through one line: a stylesheet link in HTML, or `lahe-style: <id>` in Markdown frontmatter.
- A style is third-party CSS on a page that carries a review token. So the stylesheet may reach only its own fonts and inline images, and nothing else. That one rule is the security boundary.
- The rule runs at install and again every time a page server serves the file.

## What a style folder is

The folder's name is the style's id. The folder holds:

- `style.css`, at most 1 MB
- `metadata.json`, at most 64 KB
- `fonts/*.woff2`, optional, at most 16 files of at most 2 MB each
- `DESIGN.md` and licence files, optional, copied for the reader and never served

The id is the folder's name, lowercased, with spaces and underscores turned into hyphens. It is lowercase letters, digits and hyphens, starts with a letter or digit, and is at most 40 characters. `international` is the house style's id and cannot be installed.

`metadata.json` has these keys:

- `name`, required: letters, digits, spaces, hyphens, apostrophes and ampersands, at most 40 characters. It is written into a note to the agent, so it stays plain.
- `description`, optional, at most 300 characters.
- `version`, optional, at most 20 characters of letters, digits, dots, plus and hyphen.
- `palette`, optional, a list of `{value}` hex colours. The first six are used. A value that is not hex refuses the folder.

No string in the metadata may hold a control character or a bidirectional override. Other keys stay on disk and are never read.

Real style folders also carry `html/`, `screenshots/`, `scripts/` and `directions/`. Install skips anything that is not on the list above instead of refusing it.

## How `lahe style add` installs

The command parses and prints. Every rule is in `src/service/styles.js`.

- It takes one or more folders. A refused folder does not stop the others. The exit code is `1` if any folder was refused.
- It reads each file once. A file must not be a symlink, is opened without following one, and is checked as a regular file on that same handle. The bytes that were checked are the bytes written.
- It checks the metadata, the font names and sizes, and the stylesheet rule below.
- It copies the files into `<state dir>/styles/<id>/`. The state folder is owner-only.
- Installing the same id again replaces it. A per-id lock and a rename-aside keep the old install in place if the new one fails.
- Two folder names can make the same id ("Field Guide" and "field_guide"). The second replaces the first, as a reinstall does.
- `lahe style list` prints each installed style's id, name and version. It also prints any hand-copied folder that breaks the rules, with the reason. There is no remove command: delete the folder under `<state dir>/styles/`.

Flags and exit codes are in `docs/CLI.md`.

## The stylesheet rule

A tokenizer reads the sheet left to right the way a browser does. It follows CSS Syntax Level 3 for comments, strings and `url()`. A string ends at an unescaped newline. A backslash-newline inside a string continues it. Names match ignoring case. It is a tokenizer and not a text scan because every place a scan and a browser disagree is a way past the check.

Outside comments and strings, the sheet is refused if it has:

- any `@import`, with or without a vendor prefix
- any backslash
- any function that fetches by string: `image-set`, `image`, `cross-fade`, `src`, `element`, with or without a vendor prefix
- any `url()` that is not `./fonts/<file>.woff2` or `fonts/<file>.woff2` naming a file in the folder, and is not an allowed `data:` value

An allowed `data:` value is `data:image/svg+xml`, `data:image/png` or `data:font/woff2`. It may carry only `base64` and `charset=` parameters. A `data:` SVG is decoded first (percent or base64) and refused if it holds `href`, `url(`, `@import`, `&` or a backslash, because an SVG used behind `mask` or `filter` loads as a document of its own.

A backslash inside a string is allowed, so `content: "\00A7"` and a custom property string continued over lines both pass. A backslash outside a string is refused.

`attr()` is not refused. CSS does not let an `attr()` value become a URL, and no paid style uses it. If that changes, it is one name in `FETCHING_FUNCTIONS`.

## How the `.lahe-styles` path is served

Both kinds of page server (the folder server and the one-page server) answer any path that has a `.lahe-styles` segment from `styles.js`. They never answer it from the disk under the served root. So a copy of a style in a reviewed folder, or beside an artifact, is never served.

What follows the last `.lahe-styles` segment must be exactly one of:

- `index.json`: the installed list, `{styles: [{id, name, description, palette}]}`, built from the checked metadata
- `<id>/style.css`, which passes the stylesheet rule
- `<id>/fonts/<file>.woff2`

Anything else under that segment is a 404. So is a style that breaks a rule: a sheet that fails the check, a symlink, a size cap, or a file with more than one hard link. A refused style also writes one line to `helper.log` per server per style, naming the style and the reason.

The id and file name are checked by pattern before any file system call. The server keeps the checked bytes per file, keyed on size, modification time and inode, so a changed file is checked again.

Only `style.css`, fonts and the list are readable. `metadata.json`, `DESIGN.md` and licences are never served.

## How a page carries a style

- HTML: `<link rel="stylesheet" href="./.lahe-styles/<id>/style.css">` on the line right after the `./.lahe-doc-style.css` link. A link written before the house style loses the cascade and the page looks wrong. The layer does not police that.
- Markdown: the frontmatter line `lahe-style: <id>`. The renderer reads the first line that is exactly `lahe-style:`, optional spaces, an id, and optional trailing spaces. No quotes, lower case only. Anything else is no style.

For Markdown, the renderer puts the same link right after the inlined house style, in the head, outside the body's relative-URL rewrite. The inlined house style carries the attribute `data-lahe-doc-style` so the layer can find it on either kind of page. A frontmatter block that holds only the style line is not shown as "Document metadata".

A style that is not installed falls back to the house style.

When Lahe writes a rendered Markdown file to disk, it copies the style's checked `style.css` and fonts beside it at `.lahe-styles/<id>/`, so the saved file opened from disk still shows the style. The page server never serves that copy. It answers the reserved segment from the installed styles, so a removed or reinstalled style shows as it is now. A missing or refused style is copied as nothing, and a failed copy never fails the render. The copy goes stale after a reinstall until the next render.

## What is refused and why

- A stylesheet with any reach beyond its own fonts and inline images. CSS can read attribute values with selectors and report them through any fetch: a `url()`, an `@import`, or a remote font's `unicode-range`. The page has a review token on its script line, so none of that may leave the machine.
- A symlink anywhere in the folder, or a served file with more than one hard link. This stops a style from reading a file outside its folder.
- A name or description that carries control or bidirectional characters. Metadata is printed in a terminal and the name is written into a note to the agent.
- A name outside plain characters. The note to the agent is Lahe's fixed sentence plus a checked id and the name, so a name cannot carry an instruction.
- The id `international`, which belongs to the house style.
- An id that fails the pattern, wherever it arrives from: install, a served path, Markdown frontmatter, a note, or the list. A failing id is treated as no style.

## Known limits

These are recorded, not defended against.

- A style can hide the rail or change what the page shows. The rail sits in a closed shadow root, but its host element is in the page. A style could hide the rail, or hide or add visible text so the reviewer reads something other than the source. The reviewer chose to install it and can delete its folder.
- Another website can probe the loopback page server for a style's stylesheet and learn which styles are installed. It cannot read the list, because the server sends no CORS header. The list names styles to scripts on pages the server already serves, and it is not secret.
- A page flashes in the document's style for a moment on reload during a preview, because the library loads at the end of the body.
- Mermaid diagrams keep the house palette under every style.
- A page on a server that is not a Lahe page server (a dev server, `file://`) cannot fetch the list. The panel then shows the house style alone.

## Tests

- `test/unit/styles.test.js`: the id, metadata and stylesheet rules, install and its lock.
- `test/unit/style_command.test.js`: `lahe style add` and `lahe style list`.
- `test/unit/static_styles.test.js`: the served shapes and the 404s.
- `test/unit/markdown_style.test.js`: the frontmatter line, the link, and the copy beside a written file.
- `test/browser/markdown_style_file.spec.js`: a saved Markdown file shows its style over `file://`.
- `test/fixtures/styles/sample/` is a small real style for tests.
