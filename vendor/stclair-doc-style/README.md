# vendor/stclair-doc-style

The St. Clair AI document style, and the three font families it asks for. This
is the default look for every new document LAHE puts in front of a reviewer:
rendered Markdown, and any HTML page an agent writes for review. A page that
already carries its own styles is never touched.

## What is here

| File | Where it came from |
| --- | --- |
| `system-tokens.css` | `~/Documents/workspace/personal/lib/templates/system-tokens.css`, copied whole on 2026-09-16 (post-rebuild version) |
| `document.css` | `~/Documents/workspace/personal/lib/templates/document.css`, copied whole on 2026-09-16 (post-rebuild version) |
| `lahe-markdown.css` | written in this repo, not a copy |
| `fonts/*.woff2` | Google Fonts, latin subset, fetched 2026-09-16 |

Both copies above are the post-rebuild version: PR #4 in the personal repo, landed
2026-09-16. That rebuild put one column rule on the direct children of `body`
(and `.band`), made every value in both files a token, and dropped `.wrap` from
the vocabulary. A copy taken before that PR used `.wrap` for the column instead.
| `LICENSE` | SIL Open Font License 1.1, with all three font copyright lines |

The spec for the style is `personal/docs/document-style-guide.md`. The two
copied files are taken whole, header comments included, and are never edited
here. If one of them needs to change, change it in the personal repo and copy
the new version over, the same way the other vendor folders work. Nothing
imports across repos, by rule.

`lahe-markdown.css` is LAHE's own layer. `document.css` styles classed
components (`ul.dot`, `table.boxed`, `.panel`) and marked emits bare elements
with no classes, so this layer maps the bare elements onto the same components
and carries the `@font-face` rules.

The renderer supplies the other half. `render()` in `src/service/markdown.js`
reproduces the page shape that `personal/lib/scripts/build_styled_doc.py`
builds: the first H1 becomes a `.wrap.hero` title, everything up to the first
H2 is the lede inside it, and every H2 opens a numbered `section.sheet`. It
also writes the `ul.dot` and `.scrollx` classes that `document.css` is waiting
for. That is why this layer sets no page column of its own: the hero and the
sections carry it. Mermaid gets the same palette through a theme object in
that file, since its theme variables are read by JavaScript before any
stylesheet exists and cannot be `var(--token)`; each hex there is a token from
`system-tokens.css`, named in a comment beside it.

## The fonts

Three variable woff2 files, latin subset, all under the SIL Open Font License.
Google's `css2` endpoint returns the same file for every weight of a family,
because each family ships as one variable font covering the range, so there are
three files rather than eight. Each `@font-face` declares the weight range.

| File | Family | Weights covered | Google Fonts version |
| --- | --- | --- | --- |
| `schibsted-grotesk-variable.woff2` | Schibsted Grotesk | 500 to 700 | v7 |
| `hanken-grotesk-variable.woff2` | Hanken Grotesk | 400 to 600 | v12 |
| `jetbrains-mono-variable.woff2` | JetBrains Mono | 400 to 500 | v24 |

The system fallback stacks in `system-tokens.css` stay in place, so a page that
cannot reach the files still gets a sane face rather than Times.

To update, fetch the `css2` URL in
`personal/lib/templates/document-skeleton.html` with a modern browser
User-Agent header so Google returns woff2 blocks, then fetch the `url(...)` out
of each latin block and copy the files over these. Update the versions above.

## Three decisions this folder records

1. **The fonts are vendored.** No network at runtime, which is the same rule
   that puts marked and mermaid here. They are not in `dependencies` and never
   will be.
2. **Light only.** The guide is a light system, so the Markdown renderer's old
   `prefers-color-scheme: dark` palette is gone and `color-scheme: light` is
   declared instead, which keeps the browser's own scrollbars and form controls
   on a light ground.
3. **One copy, two ways to reach it.** Rendered Markdown inlines the
   concatenated CSS, so a page saved to disk stays self-contained. An
   agent-authored HTML page links `./.lahe-doc-style.css`, which the static
   server resolves to these files from any served directory, the same basename
   fallback it already has for the Mermaid script. Fonts resolve the same way
   at `.lahe-fonts/<file>.woff2`.

`src/service/markdown.js` builds the bundle and names the served basenames;
`src/service/static_servers.js` holds the fallback.
