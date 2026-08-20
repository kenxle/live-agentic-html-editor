# vendor/mermaid

Vendored copy of [@mermaid-js/tiny](https://github.com/mermaid-js/mermaid)
11.16.1, MIT licensed (see `LICENSE`). The file is `dist/mermaid.tiny.js` from
the published package, copied byte for byte. The service serves it to the
browser as `.lahe-mermaid-11.16.1.js` when a rendered Markdown page contains a
mermaid block.

It lives here because this tool has zero runtime dependencies: a `git clone` has
to run with no install step. To update, copy a newer `dist/mermaid.tiny.js` and
its `LICENSE` over these files, change the version above, and change
`MERMAID_ASSET` in `src/service/markdown.js` to match the new version. Never add
the package to `dependencies` in `package.json`.
