# vendor/marked

Vendored copy of [marked](https://github.com/markedjs/marked) 15.0.12, MIT
licensed (see `LICENSE.md`). The file is `lib/marked.cjs` from the published
package, copied byte for byte.

It lives here because this tool has zero runtime dependencies: a `git clone` has
to run with no install step. To update, copy a newer `lib/marked.cjs` and its
`LICENSE.md` over these files and change the version above. Never add marked to
`dependencies` in `package.json`.
