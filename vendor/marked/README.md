# vendor/marked

Vendored copy of [marked](https://github.com/markedjs/marked) 15.0.12, MIT
licensed (see `LICENSE.md`). The file is `lib/marked.cjs` from the published
package, copied byte for byte.

It lives here because this tool has zero runtime dependencies: a `git clone` has
to run with no install step. Since 2026-10-17 it is the fallback renderer: when
pandoc 3 is installed (an optional system tool, see CLAUDE.md), Markdown renders
through `src/service/pandoc.js` instead, and marked renders it otherwise or when
`LAHE_MARKDOWN_ENGINE=marked` is set. To update, copy a newer `lib/marked.cjs` and its
`LICENSE.md` over these files and change the version above. Never add marked to
`dependencies` in `package.json`.
