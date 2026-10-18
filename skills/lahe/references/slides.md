# Create and review a slide deck

Keep an existing deck's framework, theme, component library and build process.
Its content source may be Markdown, HTML, or generated output. Find that source
before editing. When starting a Reveal.js deck with no project template, use
the defaults below. Use a deck's own components for slides; the
[document catalog](components.md) and [document skeleton](documents.md) are for
document pages.

## Set up a portable Reveal.js deck

- Keep the editable slides, theme, assets and Reveal.js files together. Bundle
  fonts, icons, plugins and other dependencies locally when the deck needs to
  work offline. Leave bundled third-party files untouched.
- Put slide content in one source file, such as `slides.md`, including the title
  and closing slides. Keep `index.html` for Reveal.js setup and local asset
  links. If the project compiles a standalone HTML file, treat that file as
  output and rebuild it from the slide source.
- Keep layout rules separate from theme values when the deck supports themes.
  Reuse the project's layout classes. Put reusable styling in the theme or
  layout stylesheet rather than repeating inline styles across slides.
- Preview a Markdown-loaded deck through a local server or `lahe review`.
  Reveal.js fetches the Markdown file, so opening its development `index.html`
  from disk may leave the slides blank. A compiled standalone file can open
  from disk when its build inlines the needed assets.

For a new deck, wire the local Markdown and Notes plugins to one slide source.
Add the deck's own stylesheets to the page head:

```html
<div class="reveal"><div class="slides">
  <section data-markdown="slides.md"
           data-separator="^---$"
           data-separator-vertical="^--$"
           data-separator-notes="^Notes:"></section>
</div></div>
<script src="vendor/reveal.js/dist/reveal.js"></script>
<script src="vendor/reveal.js/plugin/markdown/markdown.js"></script>
<script src="vendor/reveal.js/plugin/notes/notes.js"></script>
<script>Reveal.initialize({ hash: true, slideNumber: true,
  plugins: [RevealMarkdown, RevealNotes] });</script>
```

The Startup Studio decks keep `index.html`, `slides.md`, `theme/` or `themes/`,
`assets/`, local Reveal.js files, a compile script and a PDF export script in
one deck folder. Their spring template uses slide-type classes; the newer fall
deck system separates layout CSS from theme CSS and documents each layout's
capacity. Follow whichever contract the deck you are editing uses.

## Write slides from the outline

- Give each slide one job. Split dense content across slides instead of
  shrinking the type. Slide count is a result of the material, not a limit.
- Use the deck's layout or component guide to choose a slide type. Keep titles
  in sentence case and the on-screen words readable from the back of a room.
  Use high contrast and generous spacing; test on a projector when possible.
- Put material the audience must follow during an exercise on screen. Put
  instructor dialogue, timing details and explanations in speaker notes.
  Add notes to title, section and closing slides too when they guide delivery.
- Use local images and icons, with a free SVG library such as Lucide when icons
  help. Keep assets with the deck so preview and export can find them.
- Link a primary source immediately after every direct quote attributed to a
  real person. If the exact wording cannot be verified, paraphrase without
  quotation marks.

For a deck using Reveal.js's Markdown plugin, inspect its configured
separators. The Startup Studio decks use `---` alone between horizontal slides,
`--` alone for vertical slides, `Notes:` for speaker notes, and a slide comment
for layout classes:

```markdown
<!-- .slide: class="layout-bullets" -->
## Ask about the last time

- What happened?
- What did you try?

Notes:
Ask for a specific story before discussing solutions.

---
```

Keep HTML inside a Markdown slide as one uninterrupted block when the deck's
Markdown parser requires it. A blank line inside that block can turn the
remaining markup into a code block. Use the deck's established syntax for
fragments, diagrams and theme variants; do not invent classes in one slide.
Reveal.js uses `class="fragment"` to show an element on the next click. Press
`S` to check speaker notes and `Esc` to scan the slide overview.

## Review the deck with Lahe

Review a source HTML deck with `lahe review deck/index.html`. If the reviewed
HTML is generated, pass `--source <build-entrypoint>`, edit the real source and
rerun its build; follow [webapps and builds](webapps.md). For a deck whose
`index.html` loads `slides.md`, edit `slides.md` for slide text and notes, and
edit the deck's stylesheet for layout or theme changes. Check the visible
slide after each change before replying `handled`.

Follow [review](review.md) for the URL and monitor, and
[feedback](feedback.md) for incoming items. A framed page gets no rail unless
the script tag has `data-lahe-frames="allow"`. Keep framing refused for a
Reveal.js speaker-notes window: it embeds the same deck and can compete with
the presentation for review.

## Verify every slide and export

Walk the whole deck in the browser, including title, section, exercise and
closing slides. Compare the number visited with `Reveal.getTotalSlides()` so
none are skipped. Check content clipping on every edge, images, fonts,
fragments, speaker notes and slide numbers. Use the project's fit script when
it has one; inspect screenshots as well as measurements. If content overflows,
split the slide or choose a layout meant for that content. Check each supported
theme when the deck can switch themes.

Build the standalone version from the canonical source and open it offline to
check its assets. Export the PDF through the deck's own script, using Decktape
when that is its workflow. Inspect the exported pages: browser print mode can
lay out grids differently from the presentation. Before export or sharing,
follow [finish](finish.md) to remove any pasted Lahe rail.
