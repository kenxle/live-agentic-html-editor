# Write a document

Read this before writing or substantially reshaping a page. For an existing
page, keep its author's format, icon and styles. HTML is the default for new
pages; use Markdown for simpler documents. Keep files in the project's docs
folder or beside what they discuss, never in a temporary folder.

## Give the reader a useful starting point

- Use a descriptive and declarative title, with detail in the lede.
- The lede says what the page is for and what you need from the reader.
- Based on the document, put the answer, decision or open questions first, with
  background in subsequent sections. Link to subsequent information liberally.
- Keep the top section constantly updated on agent-authored plans, briefs and
  progress pages. This is the first area the user goes to see what they need to
  do and what information they need to respond to. Move settled items into
  Decisions or Progress in the same change. When none remain, say so in one
  line. Preserve a template's structure and anything the reviewer wrote.

## Choose components before writing sections

Use Lahe's styles and components, as they greatly enhance the user's experience
of working with you. Read the relevant sections of [the component catalog](components.md)
**before writing markup**. It is the source of truth for classes, variants and
examples. It is what allows the style switcher to work. If you do not use our
predefined components the style switcher cannot swap between styles.
In the clone the catalog is `vendor/stclair-doc-style/COMPONENTS.md`; the
installer provides it as `references/components.md` beside this skill.

| Content | Component to look up |
| --- | --- |
| Alternatives | Option cards; mark your pick Recommended |
| A question with answers you will act on | Choice group; also read [choices](choices.md) |
| Numbers that matter | Stat tiles |
| Exactly three short points | Facts grid |
| Caveat, scope note, aside | Tinted panel |
| A point with parts | Insight panel |
| One line that must stand out | Callout |
| Named stages | Step sequence |
| Status per row | Badges or status dots |
| Figures in rows | Data table with numeric cells |
| Images, folded sections, links or calendars | Their catalog sections |

- Use only catalog classes for house components. Add CSS only for needs the
  catalog does not cover, such as a chart.
- In Markdown documents, follow Markdown conventions. Lahe styles ordinary
  headings, lists and tables. Give each catalog component its own HTML block,
  with blank lines before and after. Write the block's contents as HTML;
  Markdown syntax is not parsed inside an HTML block.

## HTML structure

Copy the catalog's Page skeleton. Include a document-specific `<title>`, an
icon, and `<link rel="stylesheet" href="./.lahe-doc-style.css">`.
The helper serves that stylesheet from every served directory. Use an SVG from
a free icon library such as Lucide for the page icon. Save it beside the page:

```html
<link rel="icon" href="./icon.svg" type="image/svg+xml">
```

Use one `.hero` with the title and `.lede`, then a `section.sheet` with a
`.sheet-head` for each major section, directly inside `<body>`. An extra
wrapper breaks the page grid. Prose needs one of these containers (or a folded
section) for its reading width. Components go inside sections.

For Markdown, the first `#` becomes the hero, its following paragraph the
lede, and each `##` a numbered section. Lahe renders the source directly;
do not make a separate HTML copy of a single Markdown document.

For another installed style, use `lahe style list` and put
`<link rel="stylesheet" href="./.lahe-styles/<id>/style.css">` immediately
after the base stylesheet, or `lahe-style: <id>` in Markdown frontmatter.
`lahe style add <folder>` installs one. For style requests received during
review, follow [feedback](feedback.md#document-styles).

## Details that apply across documents

- Get every time-of-day stamp from the clock immediately before writing it.
  Use the system reading and do not assume time has passed. Use the host clock
  or `date "+%Y-%m-%d %H:%M"`; message timestamps and earlier clock readings
  are not the current time.
- Link other documents with their full relative paths so the reader can open
  them with the rail. Code identifiers and implementation paths can stay code.
- Mermaid diagrams get unreadable when drawn horizontally. Draw Mermaid flows
  top to bottom (`flowchart TD`). A single row of at most three boxes can go
  across; split larger flows to keep labels readable.

## Before serving

Check the title, lede and first section; match each section to its component;
check the HTML skeleton. Then follow
[the review runbook](review.md).
