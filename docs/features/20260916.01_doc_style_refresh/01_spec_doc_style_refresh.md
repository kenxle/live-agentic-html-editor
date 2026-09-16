# Spec: rendered Markdown gets the rebuilt document style, whole

Whetstone spec, 2026-09-16. Follows the style system rebuild that landed in the personal repo today (PR 4 there, `docs/features/20260915.01_style_systems/01_spec_style_system_rebuild.md`).

## Problem

A Markdown page LAHE renders looks narrower and plainer than the same content built by the personal repo's report builder. Ken compared the two on 2026-09-16 and prefers the report builder's page: the 1080px column, the numbered sections, the hanging rules.

The renderer already emits the hero and the numbered sections (the page-shape pass that merged this morning). What still differs is the stylesheet underneath:

- `vendor/stclair-doc-style/lahe-markdown.css` sets the page column itself, at 68 characters plus padding, on `body > main`. That overrides the document system's 1080px column. It also restyles the bare elements (lists, tables, headings, blockquote, images) with its own sizes, several at 16px, a size the rebuilt scale removed.
- The two vendored copies (`system-tokens.css`, `document.css`) were taken this morning, before the rebuild landed. The rebuilt `document.css` styles class-free HTML on its own, declares one column rule on the page, and has no `.wrap`, so most of what `lahe-markdown.css` does is now done, differently, by the base.

Two stylesheets each deciding the column and the element look is the drift the rebuild was meant to end.

## Requirements

1. **The vendored copies are refreshed whole.** `system-tokens.css` and `document.css` are copied from the personal repo at `main` (commit `3368cdc0` or later), header comments included, never edited here. The vendor README records the date and the commit.
2. **`lahe-markdown.css` keeps only what the base cannot do.** The `@font-face` rules, `color-scheme: light`, the Mermaid block, LAHE's own furniture (`.frontmatter`, `.lahe-readonly-note`, `.lahe-local-link`), ligatures off in code, and the GFM task-list opt-out (a `li` holding a checkbox gets no dot). Everything that sets a column, a font size, a margin on a heading, or the look of a bare element goes, because the base owns it now. Its header comment says so.
3. **The page column is the base's column.** `main` is a body child, so the base rule puts it in the 1080px column with the 28px gutter, and the hero and sections inside it inherit that. `lahe-markdown.css` sets no width on `main`. Prose inside a section takes the reading measure from the base.
4. **The renderer stops writing classes the base no longer needs.** `.wrap` comes off the hero (`<div class="hero">`). The `ul.dot` class is dropped, since a bare `ul` gets the dot look; `.scrollx` on tables stays, since a bare table is not wrapped for horizontal scroll by the base. Nothing else in `render()` changes.
5. **The agent-authored page path gets the same result.** `.lahe-doc-style.css` is the same three files concatenated, so it changes with them and needs no code change; the spec says so and the test list checks it.
6. **Tests pin the new state.** The unit test that pins the page shape updates its hero assertion. New assertions: the concatenated stylesheet contains exactly one `max-width:var(--maxw)`, no `font-size:16px`, and no `body > main` column rule; a rendered page has no `class="wrap` and no `class="dot"`. The browser test for Markdown rendering still passes.
7. **The playbook and contract text are checked, not assumed.** `AGENTS.md` and the contract in `src/shared/review_format.js` are grepped for anything describing the old layer (`ul.dot`, `.wrap`, the 68-character column). If nothing names them, nothing changes and the bundle is not rebuilt. If something does, that text changes and the orchestrator rebuilds `dist/` per the repo's rule.

## Approach

No design call. The base stylesheet decides the page; this repo stops second-guessing it. The one judgment: `main` stays as the container (the layer and the tests read `data-container="Markdown document"`), and the base's column rule handles it because `main` is a body child. That was checked against the rebuilt rule `:is(body, .band) > :not(.band, script, style, template, [data-lahe])`.

Not in this change: the folded section's remembered open state for rendered Markdown (a board row in the personal repo), and any change to how the helper serves the fonts.

## Tasks

1. Copy the two files from `~/Documents/workspace/personal/lib/templates/` over the vendored ones. Update `vendor/stclair-doc-style/README.md` (date, commit, and the paragraph describing what `lahe-markdown.css` still does).
2. Rewrite `lahe-markdown.css` to requirement 2.
3. `src/service/markdown.js`: the hero class and the list renderer, per requirement 4. Update the comment above the list renderer.
4. `test/unit/markdown_render.test.js`: update the hero assertion, remove the `ul.dot` expectation, add the assertions in requirement 6.
5. Grep `AGENTS.md`, `src/shared/review_format.js`, `docs/CONTRACTS.md`, and `test/unit/review_format.test.js` for `dot`, `wrap`, `68`. Change only what names the old layer.
6. Run `npm run gate:builder`. Then render a Markdown document through `lahe review` and measure in the browser: the hero and every section at 1080px wide with a 28px inset; the hanging rule under every section head; a paragraph at the reading measure; a bare list with a sage dot.

Test list:

- `markdown_render.test.js`: hero is `<div class="hero">`; no `class="dot"` in output; `.scrollx` still wraps a table; stylesheet bundle has one `max-width:var(--maxw)`, no `font-size:16px`, no `body > main`.
- `test/browser/markdown_render.spec.js`: passes unchanged.
- The served-page measurement in task 6, recorded in the final report.

## Acceptance criteria

- [ ] `diff` of each vendored copy against the personal repo's `main` is empty.
- [ ] `grep -c 'max-width' vendor/stclair-doc-style/lahe-markdown.css` is 1 or less (the Mermaid svg clamp), and `grep -c 'font-size' vendor/stclair-doc-style/lahe-markdown.css` is 0.
- [ ] `npm run gate:builder` is green.
- [ ] The rendered spec page for this change, opened through `lahe review`, measures the hero and every section at 1080px wide, and shows the hanging rule above every section head.
- [ ] `git status` shows no change under `dist/` unless task 5 changed the contract text.

## Review

_Filled in after the Step 3 review._
