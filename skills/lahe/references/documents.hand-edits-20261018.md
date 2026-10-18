# Hand edits from the document guidance review

Source: [documents.md](documents.md). The entries below record the reviewer’s wording before and after each hand edit.

## Starting point and general writing guidance

Before:

```text
Use a short sentence for the title, with detail in the lede.

The lede says what the page is for and what you need from the reader.

Put the answer, decision or open questions first; background goes below.

Keep the top current on agent-authored plans, briefs and progress pages. Move settled items into Decisions or Progress in the same change. When none remain, say so in one line. Preserve a template's structure and anything the reviewer wrote.

Get every time-of-day stamp from the clock immediately before writing it. Use the host clock or date "+%Y-%m-%d %H:%M"; message timestamps and earlier clock readings are not the current time.

Link other documents with their full relative paths so the reader can open them with the rail. Code identifiers and implementation paths can stay code.

Draw Mermaid flows top to bottom (flowchart TD). A single row of at most three boxes can go across; split larger flows to keep labels readable.
```

After:

```text
Use a descriptive and declarative title, with detail in the lede.

The lede says what the page is for and what you need from the reader.

Based on the document, put the answer, decision or open questions first, with background in subsequent sections. Link to subsequent information liberally.

Keep the top section constantly updated on agent-authored plans, briefs and progress pages. This is the first area the user goes to see what they need to do and what information they need to respond to. Move settled items into Decisions or Progress in the same change. When none remain, say so in one line. Preserve a template's structure and anything the reviewer wrote.

Get every time-of-day stamp from the clock immediately before writing it. Use the system reading and do not assume time has passed. Use the host clock or date "+%Y-%m-%d %H:%M"; message timestamps and earlier clock readings are not the current time.

Link other documents with their full relative paths so the reader can open them with the rail. Code identifiers and implementation paths can stay code.

Mermaid diagrams get unreadable when drawn horizontally. Draw Mermaid flows top to bottom (flowchart TD). A single row of at most three boxes can go across; split larger flows to keep labels readable.
```

## Why catalog components matter

Before:

```text
Use Lahe's styles and components for new documents. Read the relevant sections of the component catalog before writing markup. It is the source of truth for classes, variants and examples; do not invent equivalents. In the clone the catalog is vendor/stclair-doc-style/COMPONENTS.md; the installer provides it as references/components.md beside this skill.
```

After:

```text
Use Lahe's styles and components, as they greatly enhance the user's experience of working with you. Read the relevant sections of the component catalog before writing markup. It is the source of truth for classes, variants and examples. It is what allows the style switcher to work. If you do not use our predefined components the style switcher cannot swap between styles. In the clone the catalog is vendor/stclair-doc-style/COMPONENTS.md; the installer provides it as references/components.md beside this skill.
```

## Component count limit

Before:

```text
Use only catalog classes for house components. Add CSS only for needs the catalog does not cover, such as a chart.

At most one of each loud component: tinted panel, callout, band, pull quote.

In Markdown, make each component its own HTML block with blank lines before and after. Write its contents as HTML; Markdown is not parsed inside it. Plain Markdown lists and tables are already styled.
```

After:

```text
Use only catalog classes for house components. Add CSS only for needs the catalog does not cover, such as a chart.

In Markdown, make each component its own HTML block with blank lines before and after. Write its contents as HTML; Markdown is not parsed inside it. Plain Markdown lists and tables are already styled.
```

## Before-serving checklist

Before:

```text
Check the title, lede and first section; match each section to its component; check the HTML skeleton and avoid repeated loud components. Then follow the review runbook, give the printed link and start the monitor. The page is the answer: chat gets one line and the link.
```

After:

```text
Check the title, lede and first section; match each section to its component; check the HTML skeleton. Then follow the review runbook.
```
