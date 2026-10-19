# Markdown heading ids

Board row: LAHE-markdown-heading-ids (2026-09-30). Asked for by Ken on
2026-10-19. A whetstone change.

## Problem

The Markdown renderer (`src/service/markdown.js`, `renderPage`) writes every
heading as a bare `<h1>` to `<h6>`. An in-page link such as
`[the review step](#6-sub-agents-reviews-and-personas)` renders as a working
`<a href="#...">`, but nothing on the page carries that id, so the click does
nothing. Ken hit this reviewing a skill file whose table of contents links to
its own sections.

## Requirements

1. Every heading the renderer writes carries an `id`: the hero's H1, each
   section's H2 in its sheet head, and every other heading at any depth,
   including one inside a blockquote or a list item. A `#` line inside a fenced
   code block is code, not a heading, and gets nothing.
2. The id is the one GitHub gives the same heading (github-slugger): the
   heading's visible text, lowercased, with every character that is not a
   letter, mark, number, connector punctuation, space or hyphen dropped, and
   each space turned into a hyphen. Inline markup counts by its text (a code
   span's code, a link's words); an image or raw HTML adds nothing.
3. Repeats follow github-slugger: the second `Repeat` is `repeat-1`, and a
   later heading whose own slug is already taken moves on to the next free
   number (a literal `Repeat-1` after two `Repeat`s becomes `repeat-1-1`).
4. Ids are numbered in document order, the order a reader meets the headings,
   even though the page is rendered out of order (the lede before the H1).
5. The file-name title of a page with no `#` heading gets no id: GitHub shows
   no heading there, so no link can name it.
6. One departure from GitHub: a slug starting with `lahe-` gains a `section-`
   prefix. The review layer finds its mount point (`lahe-surface-root`) and its
   stylesheet (`lahe-highlight-styles`) by id, and a heading that took one
   would stop the rail mounting or unstyle every highlight. Added after the
   code review.
7. Entities count as their character (`&amp;` is `&`, `&#233;` is `é`); a code
   span counts as written; a no-break space is dropped, as GitHub drops it.
8. Both engines. Main gained a pandoc renderer (PR #80) while this was in
   review. Pandoc's own `gfm_auto_identifiers` stays off; `markdown.js` reads
   the headings off pandoc's HTML and gives them the same ids, so a link lands
   whichever engine drew the page. A card's name (the bold first line the
   filter turns into an `<h4>`) gets an id too, which GitHub would not give.
9. Nothing else in the rendered HTML changes. Anchor links already stay in the
   same tab (`links.classify` returns `anchor`).

## Out of scope

- The Markdown link-scheme allow list, which another thread is discussing.
- Ids on HTML pages a reviewer opens. Those are the author's markup.

## Test

`test/unit/markdown_render.test.js`, "every Markdown heading gets the
GitHub-style id an in-page link names": one document covering punctuation and
numbers, inline code, emphasis and a link, three repeats, a blockquote, a list
item, accented letters and a fenced code block, with the expected ids taken
from github-slugger's rules. A second test, "a heading id keeps GitHub's edge
cases and stays out of the layer's ids", covers the review's findings: a
leading empty anchor tag, a trailing image, an entity in a code span, numeric
and no-break-space entities, and the `lahe-` prefix. `test/unit/pandoc_render.test.js`, "pandoc's
headings get the same ids as marked's", checks the two engines agree.
