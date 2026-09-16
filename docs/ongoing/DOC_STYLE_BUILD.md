# Default document style build

Board row: `LAHE-default-doc-style` in `docs/BULLETIN.md` (Ken, 2026-09-11).
Kicked off 2026-09-16. This file is the spec the builder works from and the
progress record. The board row keeps the "why"; this file keeps the "how".

## What changes

Every new document LAHE puts in front of Ken gets the St. Clair AI document
style instead of the system-font default. Two surfaces:

1. Rendered Markdown (`src/service/markdown.js`). The inline stylesheet is
   replaced with the vendored style.
2. Agent-authored HTML review pages. The lahe skill and AGENTS.md tell an agent
   to link one stylesheet that the helper serves beside any page.

Pages that already carry their own styles are never touched.

## Decisions (made 2026-09-16, the board row left these open)

- **Fonts are vendored.** Schibsted Grotesk (500, 600, 700), Hanken Grotesk
  (400, 500, 600), JetBrains Mono (400, 500), latin subset, woff2. All three are
  SIL Open Font License. No network at runtime. The `@font-face` rules point at
  the same served basenames as the stylesheet. System faces stay as fallbacks.
- **Light only.** The style guide is light only. The renderer drops its
  `prefers-color-scheme: dark` palette. `color-scheme: light` is declared so the
  browser's form controls and scrollbars match.
- **One vendored copy, two ways to reach it.** The CSS lives under
  `vendor/stclair-doc-style/`. Rendered Markdown inlines it, so a page saved to
  disk stays self-contained. For agent-authored pages the static servers also
  serve it at the fixed basename `.lahe-doc-style.css` from any directory,
  using the same basename fallback `static_servers.js` already has for the
  Mermaid script (around line 525). Fonts are served the same way at
  `.lahe-fonts/<file>.woff2`.

## Source of truth for the style

`~/Documents/workspace/personal/lib/templates/system-tokens.css` (tokens) and
`document.css` (components), spec in `personal/docs/document-style-guide.md`.
Copy, do not import across repos. Record the source path and copy date in
`vendor/stclair-doc-style/README.md`, same as the other vendor folders.

## The Markdown adaptation

marked emits bare elements with no classes. `document.css` styles classed
components (`ul.dot`, `table.boxed`, `.sheet`, `.wrap`). So the vendored copy is
three files:

- `system-tokens.css`: taken whole, header included, never edited locally.
- `document.css`: taken whole.
- `lahe-markdown.css`: LAHE's own layer, written for this build. Maps bare
  elements onto the guide's components:
  - `body > main`: one reading column, `max-width: var(--read)` (68ch),
    centred, declared in exactly one place. Ken's rule from the style review:
    the column was once declared in five places and drifted.
  - `table`: the boxed look. Full borders, cobalt-tint header row, no zebra.
  - `ul`: sage dot bullets. `ol`: the guide's numbered list.
  - `blockquote`: the tinted panel (sage tint), not a single-side border.
  - `pre`, `code`: JetBrains Mono on cobalt tint.
  - `h1` to `h4`: Schibsted Grotesk 600, sentence case is the author's job.
  - `a`: `--link`, underline 1px, offset 3px.
  - `.frontmatter`, `.lahe-readonly-note`, `.lahe-local-link`: restyled with
    tokens (ink-faint text, rule-coloured lines). Keep the class names; tests
    and the layer look for them.
  - `.mermaid`: transparent background, centred, `svg` max-width 100%. Mermaid
    must keep rendering.
- No em dashes, pills, gradients, shadows, all caps, or single-side coloured
  borders anywhere in the new CSS.

## Files to touch

- `vendor/stclair-doc-style/` (new): the three CSS files, `fonts/` with the
  woff2 files, `LICENSE` (OFL text for the fonts; the CSS is Ken's own), and
  `README.md` naming the source path, copy date, font versions, and the
  light-only decision.
- `src/service/markdown.js`: replace the inline `<style>` block with the
  concatenated vendored CSS plus `@font-face` rules; export the asset
  basenames the way `MERMAID_ASSET` is exported; copy fonts beside the artifact
  in `writeArtifact` the way the Mermaid script is copied.
- `src/service/static_servers.js`: extend the basename fallback so
  `.lahe-doc-style.css` and `.lahe-fonts/*` resolve to the vendored files from
  any served directory.
- `test/unit/markdown_render.test.js`: the `max-width:52rem` assertion goes;
  assert the tokens are present (`--ink:#1f1e1a`, `--purple:#46188c`) and that
  no `prefers-color-scheme` rule remains.
- `test/browser/markdown_render.spec.js`: a Mermaid fixture still renders an
  `svg`; the served `.lahe-doc-style.css` returns `text/css`; a heading's
  computed font-family starts with Schibsted Grotesk (proves the woff2 loaded).
- `AGENTS.md` and `~/.claude/skills/lahe/SKILL.md`: a short "authoring a page
  for review" rule: a new HTML page written to be looked at links
  `./.lahe-doc-style.css` and nothing else for base styling; an existing styled
  page is left alone. Not the contract text; this is authoring guidance, not
  reply workflow.
- `CLAUDE.md` vendor list: add the new folder and the fonts.
- `docs/BULLETIN.md`: tick the row when done, with the three decisions noted.

Not touched: `src/shared/manifest.js` (nothing new under `src/`),
`src/shared/review_format.js`, `dist/` (the orchestrator rebuilds it).

## Gate

`npm run gate:builder`. The builder does not commit `dist/`.

## Progress

- 2026-09-16: spec written, builder dispatched in a worktree.
- 2026-09-16: built on branch `worktree-agent-a8224ae010a3fc21b`. Everything in
  "Files to touch" is done, including the fonts: the network was reachable, so
  three latin-subset woff2 files are vendored for real. One thing worth knowing
  that the spec did not anticipate. Google's `css2` endpoint returns the SAME
  file for every weight of a family, because each of the three ships as one
  variable font covering the range, so `fonts/` holds three files rather than
  eight and each `@font-face` declares a weight range. The other departure:
  `document.css` opens with an `@import` of `system-tokens.css`, which is wrong
  once the files are concatenated, since an `@import` has to come before every
  other rule. `markdown.js` drops that line as it reads, so the vendored copies
  stay byte-identical to the personal repo's. `npm run gate:builder` is green.
