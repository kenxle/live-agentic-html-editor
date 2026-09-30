# Components in the St. Clair document style

A catalog for an agent writing a page for review. The page links
`./.lahe-doc-style.css`, which carries every class below. Use these instead of
bare paragraphs. Full rules live in `personal/docs/document-style-guide.md`, which
this repo does not carry; everything you need to write the markup is here.

Sample text below is placeholder. Replace it.

## Rules that apply to every component

- Put page blocks directly in `<body>`. The stylesheet gives each body child the
  page column. Do not wrap the page in your own container.
- Modifiers use a double dash on the block's class: `panel panel--cobalt`, never
  `panel cobalt`.
- Less is more. One tinted panel per page, one callout, one band at most, one
  pull quote. Two loud things cancel each other.
- Use a class-free `ul`, `ol`, `table`, `blockquote`, `img`, `code` and `pre` for
  the plain case. They are already styled.
- Icons in the source style use `<i data-lucide="...">`, which needs the Lucide
  script. A LAHE page does not load it. Leave icons out, or inline an SVG.
- Keep the markup to the classes listed here. A class not in this file is not in
  the stylesheet.

## Page skeleton

```html
<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>Document name</title>
  <link rel="stylesheet" href="./.lahe-doc-style.css">
</head>
<body>

<div class="hero">
  <h1>The title, as a sentence saying what this is</h1>
  <p class="lede">One or two sentences: what this is for and who it is for.</p>
</div>

<section class="sheet">
  <div class="sheet-head"><h2>First section</h2><span class="n">Section 1</span></div>
  <p>Body text.</p>
</section>

</body>
</html>
```

- `.hero`: the title block. Every document has one.
- `.sheet` with `.sheet-head`: a numbered section under a hanging rule. Every
  major section is one. The `<span class="n">` is the label on the right.
- `.masthead` (`<div class="masthead"><div class="meta">Report, March 2026</div></div>`)
  is an optional small line above the hero.
- `.read` on a paragraph caps it at reading width.

## Section heads inside a section

```html
<div class="sheet-head sheet-head--medium"><h3>Subsection</h3><span class="n">Label</span></div>
<div class="sheet-head sheet-head--small"><h4>Block heading</h4></div>
```

Medium: lighter rule, an h3, a short label on the right. Small: hairline and h4,
no label.

```html
<p class="eyebrow">Option B</p>
<h3>Heading with a small label above it</h3>
```

`.eyebrow`: a short faint label naming the kind of thing that follows.

## Text blocks

### Facts grid
Three short points side by side. Words first. Exactly three.

```html
<dl class="facts">
  <div><dt>Label</dt><dd>One or two sentences.</dd></div>
  <div><dt>Label</dt><dd>One or two sentences.</dd></div>
  <div><dt>Label</dt><dd>One or two sentences.</dd></div>
</dl>
```

### Stat tiles
Numbers that are the point. Number first. Up to four across.

```html
<div class="stats">
  <div class="stat"><p class="stat-label">Label</p><p class="stat-value">64%</p><p class="stat-meta">one line of context</p></div>
  <div class="stat"><p class="stat-label">Label</p><p class="stat-value">38</p><p class="stat-meta">one line of context</p></div>
</div>
```

`stat--tint` swaps the border for a tint. `<div class="stat stat--large">` (outside
`.stats`) is the one number a section is about.

### Tinted panel
An aside, caveat or scope note, one to three sentences. Sage by default.

```html
<div class="panel"><p><b>Lead.</b> The aside.</p></div>
```

Variants: `panel--cobalt` (a definition or constraint), `panel--purple` (the one thing
to pause on), `panel--danger` (a problem only: something failed or is missing).

### Insight panel
A labelled point that breaks into parts. The label and icon come from the CSS.

```html
<div class="insight">
  <p><b>The claim in one bold line.</b></p>
  <ol>
    <li><b>First part.</b> Detail.</li>
    <li><b>Second part.</b> Detail.</li>
  </ol>
</div>
```

`insight--caveat` labels it "Caveat". `data-label="What this means"` replaces the
label text.

### Callout
A solid block with white text and one short line, under about 20 words.

```html
<div class="callout"><p>One short line.</p></div>
```

Variants: `callout--cobalt`, `callout--purple`, `callout--sage`.

### Pull quote
One line lifted out of the body. Once per document.

```html
<blockquote class="pullquote">
  <p>The line.</p>
  <footer>Who said it, in a few words</footer>
</blockquote>
```

`pullquote--ruled` adds a line above and below. A plain `<blockquote>` stays the
quiet aside.

### Two columns of prose
Two short related ideas. Collapses to one column on a phone.

```html
<div class="cols">
  <div><h4>First</h4><p>Text.</p></div>
  <div><h4>Second</h4><p>Text.</p></div>
</div>
```

### Band
A full-width ink block for the closing statement. One per document. A direct child
of `<body>`; its inner `<div>` holds the content.

```html
<div class="band">
  <div>
    <div class="sheet-head"><h2>Next step</h2><span class="n">Section 6</span></div>
    <p class="read">The call to action.</p>
  </div>
</div>
```

Variants: `band--purple`, `band--cobalt` (white text only on cobalt).

### Folded section
A native disclosure for a section readers often skip. Closed by default; add
`open` to start open.

```html
<details class="fold">
  <summary class="fold-head"><span class="fold-arrow" aria-hidden="true"></span><h2>Long list</h2><span class="n">Section 5</span></summary>
  <div class="fold-body"><p>Content.</p></div>
</details>
```

### Check-in block
An unnumbered section stamped with a time.

```html
<div class="checkin">
  <div class="checkin-head"><h2>Note title</h2><span class="time">9:29 AM</span></div>
  <p>The note.</p>
</div>
```

## Lists

```html
<ul>   <li><b>Lead.</b> Item.</li> </ul>          <!-- sage dot, no class needed -->
<ol>   <li><b>Lead.</b> Step.</li> </ol>          <!-- drawn numerals, no class needed -->
<ul class="checklist"><li>What is included.</li></ul>
```

- `ul` gets the dot. `dot--cobalt` recolours it. Use `class="dot"` only when the list
  needs a class for another reason.
- `ol` gets the numerals. `steps--two-col` runs short steps in two columns;
  `steps--accent` colours the numerals.
- `checklist`: a check mark per item, for what is included, not for steps.

### Step sequence, boxed
Stages that each have a name and a line.

```html
<ol class="sequence">
  <li><h4>Brief</h4><p>One line.</p></li>
  <li><h4>Build</h4><p>One line.</p></li>
</ol>
```

Four steps or fewer, side by side. For more, or longer steps, use
`class="sequence sequence--rows"` and wrap each step's h4 and p in a `<div>`.

### Option cards
For a page that asks the reader to choose. Mark the recommended one with a badge,
never a coloured edge.

```html
<div class="options">
  <div class="option">
    <p class="eyebrow">Option A</p>
    <h4>Name</h4>
    <p>A line or two.</p>
    <ul><li>What it costs.</li></ul>
  </div>
  <div class="option">
    <span class="badge badge--purple">Recommended</span>
    <h4>Name</h4>
    <p>A line or two.</p>
    <ul><li>What it costs.</li></ul>
  </div>
</div>
```

## Badges

A small square tag for a status or category. One or two words.

```html
<div class="badges">
  <span class="badge">Done</span>
  <span class="badge badge--outline">In progress</span>
  <span class="badge badge--cobalt">Structural</span>
  <span class="badge badge--purple">Decision</span>
  <span class="badge badge--sage"><span class="badge-dot" aria-hidden="true"></span>Live</span>
</div>
```

## Tables

```html
<table>                         <!-- the default: ruled rows, no box -->
  <thead><tr><th>Name</th><th>Status</th></tr></thead>
  <tbody><tr><td>Item</td><td>Open</td></tr></tbody>
</table>
```

- `class="boxed"`: a full border and a tinted header, for dense reference tables.
- `class="data"` (on either style) plus `class="num"` on number cells and heads:
  tabular figures, right aligned. Put the total in a `<tfoot>` row.
- Wrap a wide table in `<div class="scrollx">...</div>` so it scrolls instead of
  widening the page.

```html
<div class="scrollx"><table class="boxed data">
  <thead><tr><th>Item</th><th class="num">Days</th><th class="num">Fee</th></tr></thead>
  <tbody><tr><td>Workshop</td><td class="num">1.0</td><td class="num">$4,200</td></tr></tbody>
  <tfoot><tr><td>Total</td><td class="num">1.0</td><td class="num">$4,200</td></tr></tfoot>
</table></div>
```

## Images

Every image treatment draws the same hairline frame. Give each `img` an `alt`,
`width` and `height`. Image files go beside the page.

### Image beside text
A screenshot and the paragraph that explains it. The picture takes two fifths.

```html
<div class="media">
  <img src="shot.png" alt="What it shows" width="1100" height="800">
  <div class="media-body"><h4>Heading</h4><p>Explanation.</p></div>
</div>
```

`media--right` puts the picture on the right. Alternate sides down a page.

### Figure with a caption plate
A picture on a framed plate with a numbered caption.

```html
<figure class="plate">
  <img src="chart.png" alt="What it shows" width="1100" height="800">
  <figcaption><b>Figure 1.</b> One sentence.</figcaption>
</figure>
```

`plate--tint` puts a tinted ground behind a picture that has its own white one. A
plain `<figure>` stays frameless.

### Image cards
A picture on top, then a name and a line. Two across; `image-cards--3` for three.

```html
<div class="image-cards">
  <div class="image-card">
    <img src="a.png" alt="" width="1100" height="800">
    <div class="image-card-body"><h4>Name</h4><p>One line.</p></div>
  </div>
</div>
```

### Image gallery
Thumbnails with a caption each. Two-up; `gallery--3` for three-up.

```html
<div class="gallery">
  <figure><img src="a.png" alt="" width="1100" height="800"><figcaption>Caption</figcaption></figure>
  <figure><img src="b.png" alt="" width="1100" height="800"><figcaption>Caption</figcaption></figure>
</div>
```

### Full-width image
A hero shot or wide chart that runs edge to edge. It must be a direct child of
`<body>`, between sections, like a band. Inside a section it stays in the column.

```html
<figure class="bleed">
  <img src="wide.png" alt="What it shows" width="1600" height="700">
  <figcaption>The caption sits back in the column.</figcaption>
</figure>
```

### Peek pair
A page and one detail from it. Give it a grid cell or the picture side of `.media`,
never the whole column.

```html
<div class="media">
  <div class="peek-pair">
    <img src="page.png" alt="" width="1100" height="800">
    <img src="detail.png" alt="" width="1100" height="800">
  </div>
  <div class="media-body"><h4>Heading</h4><p>Explanation.</p></div>
</div>
```

## Code

```html
<p>Inline <code>code</code> sits in prose.</p>
<pre><code>a block worth reading on its own</code></pre>
```

## Calendars

A week grid when the reader needs times; a month grid when they need shape.

```html
<div class="cal-week">
  <div class="cal-day cal-day--today">
    <div class="cal-day-head"><span class="cal-wd">Wed</span><span class="cal-dn">16</span></div>
    <ul class="cal-events">
      <li class="cal-event cal-event--allday"><span class="cal-time">All day</span><span class="cal-title">Focus day</span></li>
      <li class="cal-event"><span class="cal-time">11:00</span><span class="cal-title">Check-in</span><span class="cal-account">Team</span></li>
    </ul>
  </div>
  <div class="cal-day">
    <div class="cal-day-head"><span class="cal-wd">Thu</span><span class="cal-dn">17</span></div>
    <p class="cal-open">Open</p>
  </div>
</div>
```

Seven `.cal-day` blocks, today first. The month grid (`.cal-month` with
`.cal-month-weekdays` and `.cal-month-grid` of `.cal-month-cell`, wrapped in
`.scrollx`) is rarely needed. Copy its markup from
`lib/templates/document-every-component.html` in the personal repo if you do.

## Icons

Optional, and a page with none is fine. The forms are `<div class="icon-line">`
(an icon leading a line) and `<span class="icon-circle icon-circle--cobalt">` (a
filled circle; also `--purple`, `--sage`). Both expect an inline `<svg>` or a Lucide
`<i data-lucide>`. Skip them unless you have an inline SVG.

## Status colours

Red and amber mean a problem and nothing else. The red panel is
`<div class="panel panel--danger"><p><b>Not saved.</b> What went wrong.</p></div>`.
A page with no problem shows neither colour.

## Picking a component

- Three short points: facts grid. Numbers that are the point: stat tiles.
- A side note: panel. A labelled point with parts: insight panel. One loud line: callout.
- A choice for the reader: option cards, with a "Recommended" badge.
- Stages with names: step sequence. Sentences in order: `ol`.
- A screenshot with its explanation: image beside text. A framed figure with a
  number: plate. Several thumbnails: gallery or image cards.
- Status words in a table or list: badges.
