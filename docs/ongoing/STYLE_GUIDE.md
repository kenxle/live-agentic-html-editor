# Style guide

## Charter

**What belongs:** How the product looks: color, type, spacing and the reusable components. Tokens and the rules for using them. Each component and when to use it.

**What does not:** Voice and word choice (BRAND.md). How a screen works.

**Level of detail:** Rules a builder can apply without asking, with the reason for each.

**Describes:** the stylesheet and component folders

**Sources:**

- [system-tokens.css](../../vendor/stclair-doc-style/system-tokens.css)
- [document.css](../../vendor/stclair-doc-style/document.css)
- [lahe-markdown.css](../../vendor/stclair-doc-style/lahe-markdown.css)
- [COMPONENTS.md](../../vendor/stclair-doc-style/COMPONENTS.md)
- [the style folder README](../../vendor/stclair-doc-style/README.md)
- [overlay.js](../../src/layer/overlay.js)
- [tab_done.js](../../src/layer/tab_done.js)
- [tab_edits.js](../../src/layer/tab_edits.js)
- [highlight.js](../../src/layer/highlight.js)
- [zoom.js](../../src/layer/zoom.js)
- [catalog_page.js](../../src/service/catalog_page.js)
- [STYLES.md](STYLES.md)
- [DOC_STYLE_BUILD.md](DOC_STYLE_BUILD.md)
- [CLAUDE.md](../../CLAUDE.md)
- the git history of `src/layer`

First draft by Seneschal.

## Summary

Lahe has two looks, and they do not share rules.

- **The rail and its pieces** (cards, toast, pill, menus, zoom viewer, page highlights). It is drawn by `src/layer/` inside a closed shadow root, in a system font, with its own tokens in `src/layer/overlay.js`. It follows the reviewed page's light or dark, not the operating system's.
- **Documents and the Library page.** Rendered Markdown, agent-written pages and the Library page use the house document style in `vendor/stclair-doc-style/`. The documents are light only. The Library page also follows the operating system's dark setting.

The rules that cross both: the border carries meaning on all four sides; a recommended option gets a badge, not a colored edge; no em dashes in any text the product draws; a visual change ships with a screenshot.

## Rules for every surface

- **A signal on a card or box is a full border, never one colored edge.** A stripe down one side bends round a rounded corner and looks like a mistake. Ken called the curved left stripe on unseen cards "slop" (commit `6f208b4b`). The box's own border turns the signal color on all four sides.
- **A recommended option gets a badge.** A colored edge on one card in a row reads as a bug in the layout. A "Recommended" badge says it in words.
- **Color is never the only signal.** Every dot, border and wash has a word or a shape beside it. Reason: some readers cannot tell the colors apart, and the page may be printed.
- **A visual change ships with a real screenshot** from the built page, light and dark when the change touches both. See "A visual change ships with a screenshot" in [CLAUDE.md](../../CLAUDE.md).
- **Never copy a paid style into this repo.** Tests and screenshots use the made-up styles in `test/fixtures/styles/`. Installing a style is covered in [STYLES.md](STYLES.md).
- **Motion only says something is in flight.** The toast slides in because arriving is the news. Nothing pulses to ask for attention. Reduced motion gets a plain fade (`prefers-reduced-motion` rules in `overlay.js`).

## Surface 1: the rail

### Where the tokens live

All rail tokens are custom properties on `:host` at the top of the `CSS` array in `src/layer/overlay.js`. The dark set sits under `:host([data-lahe-scheme='dark'])`. `highlight.js` samples the reviewed page's own background and stamps that attribute, so the rail follows the page, not the operating system. Reason: a dark-mode computer over a light page would otherwise give a black slab on someone else's page.

Rules for tokens:

- A rule in the rail reads `var(--token)`. It does not write a hex value.
- One exception is the text on an accent fill. It is `#fff` in light and `#12151a` in dark (the Send button, the "1 new" tag, the count jewel, the late and refusal buttons). Reason: the dark accent is a light blue, and white on it fails.
- A new color is added to both the light and dark sets in the same change. Dark is derived the way the others are: the same relationship to the card's paper, not the same numbers.
- `src/layer/zoom.js` copies a subset of these tokens by value, because it draws in its own shadow root. Change a shared token in both files in the same change.

### Color tokens

| Token | Light | Dark | Job |
| --- | --- | --- | --- |
| `--ink` | `#15171c` | `#e9ebf0` | Primary text |
| `--ink-soft` | `#565e6d` | `#a8b0be` | Secondary text, buttons at rest |
| `--ink-faint` | `#868f9f` | `#7b8496` | Captions, times, the quote bar |
| `--paper` | `#fff` | `#1c2028` | The rail and every card: the lit surface |
| `--surface` | `#f6f7f9` | `#14171c` | The pane behind the cards, hover grounds |
| `--sunken` | `#eef0f4` | `#0f1216` | Agent bubbles, key caps, pressed grounds |
| `--line` | `#e2e5eb` | `#2c313b` | Borders |
| `--line-soft` | `#eceef2` | `#242932` | Dividers inside the rail |
| `--accent` | `#3c56a5` | `#93a7ea` | The one accent: ready border, focus ring, primary buttons |
| `--accent-ink` | `#2c3f7d` | `#b7c4f2` | Accent used as text |
| `--accent-wash` | `rgba(60,86,165,.09)` | `rgba(147,167,234,.22)` | Ground for the accent: loud bubble, ready chip, selected row |
| `--warn` | `#8d5715` | `#dfae6a` | Late, not handled, refused |
| `--warn-wash` | `rgba(180,120,30,.12)` | `rgba(223,174,106,.14)` | Ground for warn |
| `--bad` | `#c4372c` | `#ef7a6f` | Failed to save, delete hover |
| `--good` | `#2c6f52` | `#7fc4a2` | Handled, stored |
| `--draft-wash` | `#fdf8ef` | `#26221b` | Ground of a draft card |
| `--draft-line` | `#ecdcbe` | `#3b3327` | Border of a draft card |
| `--you-wash` | `color-mix(in srgb,var(--accent) 9%,var(--paper))` | same, at 17% | The reviewer's own chat bubble |
| `--shadow` | `0 1px 2px rgba(18,20,26,.06),0 14px 34px rgba(18,20,26,.13)` | `0 1px 2px rgba(0,0,0,.4),0 16px 40px rgba(0,0,0,.45)` | The rail, toast, pill and menus |

Rules for using them:

- **One accent.** Indigo says "this is the reviewer's, or this needs the reviewer". Do not add a second brand color to the rail.
- **Cards and the rail are the lit surface; the pane behind them is the ground.** Dark keeps the same relationship. Reversing it makes a dark UI read as a stack of holes.
- **Washes are grounds, not fills.** The reviewer's own sentence stays the strongest thing on a card.
- **Green means handled and nothing else.** A card that is sent and waiting is not done, so it is not green.
- **Amber (`--warn`) means late, not handled or refused.** It is never decoration.
- **Red (`--bad`) is for failures** (the status dot when a save did not land, the delete hover). A page with no problem shows none.

### Page highlights

These are drawn on the reviewed page with the CSS Custom Highlight API, in `src/layer/highlight.js`. They are translucent washes, so the page's own text color and layout are untouched. They have no dark twin: the text keeps its own color, so the wash reads on a white page and a black one. They are wrapped in `@media not print`, so a printed page does not carry them.

| Highlight | Value | Meaning |
| --- | --- | --- |
| Comment | `rgba(60,86,165,.15)` | A passage the reviewer commented on |
| Active comment | `rgba(60,86,165,.26)` | The card the reviewer has open |
| Emphasis | `rgba(60,86,165,.38)` | The strongest, for "show me where" |
| Changed | `rgba(250,204,21,.55)`, fading to `.32` and `.14` | What the agent changed |
| Probable | `rgba(60,86,165,.06)` plus a dashed underline `rgba(60,86,165,.7)` | A guess, not a find |

Rules:

- **Indigo is the reviewer's language; yellow is the agent's.** The changed mark is the only yellow, so it can never be confused with a comment an inch away.
- **A guess must not look like a find.** The probable mark is the comment wash at less than half strength with a dashed underline. It uses only `background-color` and `text-decoration`, because those are the two properties Chromium, Firefox and WebKit all paint on a highlight.
- Nothing on the page may move. A highlight never adds a border, outline or animation.

### Type

The rail uses the system font stack, not the document fonts: `-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,'Helvetica Neue',Arial,sans-serif`. Reason: the rail is a guest on someone else's page and should look like a quiet native object. Code and paths in the rail use `ui-monospace,SFMono-Regular,Menlo,monospace`.

The rail root is 13px with line-height 1.45. The sizes in use:

| Role | Size and weight | Where |
| --- | --- | --- |
| Toast text | 15px | Toast answer (read from farther away, so a step larger than the rail) |
| Question text | 14.5px, line-height 1.45 | The agent's question bubble |
| Bubble and card body | 13.5px, line-height 1.5 | Chat bubbles, the reviewer's words |
| Title | 13px, 600 | Rail head |
| Menu item, small body | 12.5px | Menu items, empty-state lines, toast "about" line |
| Tab, quote, notice | 12px (tab 500, 600 when selected) | Tabs, card quote, chips |
| Button | 11.5px, 550 | Card actions, filter, search |
| Caption | 11px | Turn captions, counts, key caps |
| Label | 10px, 600, uppercase, tracking `.06em` to `.08em` | Card kind, state chip, time |

Rules:

- **Numbers that change use tabular figures** (`font-variant-numeric:tabular-nums`): counts, times, the wait.
- **Small uppercase labels are for the rail's state words only** (card kind, state chip, toast label). Do not set a sentence in capitals.
- **A toast is read from farther away, so it is set one step larger** than card text. Ken read toasts from a laptop on his lap and had to pull the screen to his face.

### Spacing, radius and elevation

| Token or value | Use |
| --- | --- |
| `--radius: 14px` | The rail |
| `--radius-sm: 10px` | Cards, the toast, the late banner |
| `12px` | Chat bubbles; the corner nearest the speaker is `4px`, the way chat bubbles point |
| `8px` | Primary buttons |
| `7px` | Card actions, menu items, small controls |
| `5px` | Key caps (`kbd`) |
| `999px` | The state chip, the count jewel, the collapsed pill, the "earlier" fold |
| 16px | Rail and pill inset from the window edge (`RAIL_EDGE_GAP`) |
| 12px | Pane padding; card padding is `11px 12px 12px` |
| 10px | Gap between cards |
| 8px | Gap between a card's parts and between chat turns |

- Rail width is `clamp(320px,26vw,392px)` by default. The reviewer can drag it wider.
- **Elevation is `--shadow` and only on things that float** (the rail, toast, pill, menus, zoom viewer). Cards use a border and `0 1px 1px rgba(18,20,26,.03)`.
- **A tap target is 44px even when the drawn box is smaller.** The card's fold chevron draws at 13px and pulls a 44px hit area out over the card's own padding.
- **The focus ring is `2px solid var(--accent)`, offset `2px`.** Every control gets one on `:focus-visible`.

### Components and when to use them

- **Status dot (`.mark`).** One dot in the rail head says whether the helper has stored the work and whether an agent is on it. Shapes differ as well as colors: a ring means no agent, a filled dot means working, a small square means kept but not confirmed. The collapsed pill carries the same dot.
- **Icon button (`.iconbtn`, 26px).** For the head's tools: the style swatch, PDF, the "..." menu. Use an icon when the tool has a standard one. The icons are drawn inline from the vendored Heroicons paths; see [CLAUDE.md](../../CLAUDE.md).
- **Tabs with a count.** Each tab shows a quiet count. A tab can also show the unseen badge (`.newmark`): accent fill, 10px bold, only when something is worth reading, and nothing when the count is zero.
- **Card (`.card`).** One per comment. Its state is a border and a word, set by `data-state`:
  - **Draft:** warm wash (`--draft-wash`, `--draft-line`). Unsent, visible only to the reviewer.
  - **Ready:** plain card with an `--accent` border. Sent and not done yet.
  - **Handled:** plain card, plain border. The green HANDLED chip says done. There is no green wash, because it fought the grey captions and grey agent bubbles.
  - **Held:** `--surface` ground and a dashed `--line` border. Neutral on purpose; dashed is the whole signal.
  - **Late:** `--warn` border plus a 1px `--warn` ring, so it reads as 2px and nothing moves. A "waiting 12m" label takes the timestamp's place. It is a border and not a wash, because a warm wash is what a draft wears.
  - **Unseen or asking:** the `--accent` border on all four sides. It stays for the visit that brought the reviewer to the card, so a badge that says four has four marked cards behind it.
  - **Focus within:** `--accent` border and a 3px `--accent-wash` ring.
- **State chip (`.card__state`).** A pill with a word: ready is `--accent-wash` on `--accent-ink`; handled is `--good` with a 1px outline; not handled and refused are `--warn` on `--warn-wash`. On an outstanding card the chip is a button that opens "Mark as done".
- **Card action (`.cardact`).** The one small outlined button for anything on a card: 11.5px, 1px `--line`, 7px radius. Every file that puts a control on a card uses it, so the rail has one button voice. Use `.cardact--quiet` for a secondary action. Send sits at the right end.
- **Primary button.** `--accent` fill, `#fff` text (dark: `#12151a`), 8px radius, 12px bold. For the single action a banner or panel exists to offer (hand off, refusal remedy).
- **Quote (`.card__quote`).** The page's words, in `--ink-soft`, clamped to two lines, with a 3px `--ink-faint` bar on the left. The bar is a quote mark, not a signal; it never means new or unread. A quote longer than two lines opens when clicked.
- **Chat bubble (`.bubble`).** The reviewer's side is `--you-wash`, aligned right. The agent's is `--sunken`, aligned left, grey and not white. Reason: a white bubble reads as a box to type into, and the follow-up box right below it is white.
- **Loud agent message and question.** The bubble takes `--accent-wash` and a 2px `--accent` border all the way round, and the question's text is a step larger. It does not animate. The card carrying it also moves to the top of its pane.
- **Straight inner bars.** A 2px or 3px vertical bar inside a card, never on the card's edge. The neutral one marks quoted page text. The Edits tab and the conflict panel use `--accent` for the reviewer's own text and `--line` for text that is not theirs. Use one only to say which text is whose.
- **Late banner (`.late`).** At the top of the rail. `--warn-wash` ground, full 1px `--warn` border, one primary button.
- **Chips (`.chip`).** The footer's problem lines: `--warn-wash` ground, 8px radius, the remedy under the sentence, an optional action. Text wraps with `overflow-wrap:anywhere`, because one long path used to push a chip wider than the rail.
- **Toast (`.toast`).** Top right, the card's own paper and border plus `--shadow`. A small uppercase label in `--accent-ink`, the answer at 15px, and an optional "about" line with the quote bar. It has no accent edge. Reason: it slides in, which is already the loudest signal the layer has. Stack at most three; the rest collapse to a count.
- **Collapsed pill (`.pill`).** What stays on screen once the rail is put away. Late turns its border amber and shows the wait; held keeps a neutral border. It carries a count jewel in the same accent.
- **Menu and dropdown (`.menu`, `.stylepanel`, `.filter`).** `--paper` ground, `--line` border, `--shadow`, 7px item radius.
- **Key cap (`kbd`).** `--sunken` ground, `--line` border with a 2px bottom border, 5px radius.
- **Zoom viewer (`src/layer/zoom.js`).** A 30px button over a diagram and a full-window view over a `--dim` backdrop (`rgba(18,20,26,.74)`, dark `rgba(0,0,0,.8)`). Its toolbar is `--paper`, 10px radius.
- **Hover tip.** `data-lahe-tip` draws a small dark tip: `#15171c` ground, white 11.5px text, 7px radius.

### Rules a builder can apply

- **Build from the existing component first.** A new control inside a card is a `.cardact`. A new problem line is a `.chip`. Reason: one voice per kind of thing.
- **The state of a card is a border or a ground, never a stripe.** See "Rules for every surface".
- **Do not add a wash to say "done".** Green is the chip's word, not the card's ground.
- **No gradients.** The rail has none.
- **Text on a wash uses `--ink`, or `--accent-ink` on the accent wash.** Check any new text color on the dark ground too.
- **Keep the reset.** `:host{all:initial}` stops the host page's font, color and spacing from reaching the rail. Do not remove it to "inherit" something.

## Surface 2: documents and the Library page

### Where the tokens live

- `vendor/stclair-doc-style/system-tokens.css` holds every color, font, weight, size and spacing value. Surface files read them with `var()`.
- `document.css` styles the bare elements and the classed components.
- `lahe-markdown.css` is Lahe's thin layer: the font files, `color-scheme: light`, the Mermaid block and Lahe's own furniture. It sets no column and restates nothing.
- The style folder's [README](../../vendor/stclair-doc-style/README.md) says where each file came from. This repo's copy is the official one. See [DOC_STYLE_BUILD.md](DOC_STYLE_BUILD.md) for how the pieces reach a page.

Rules for tokens:

- **A surface stylesheet never redefines a shared token.** If it needs a value the file lacks, add it to `system-tokens.css`. Reason: a second style is a new token file, not a rewrite of `document.css`.
- **Reach for the role, not the raw name.** Write `--on-surface`, `--accent`, `--mark`, `--danger`; do not write `--ink`, `--cobalt`, `--sage`. A role survives a restyle and a raw name does not.
- **Token names are stable.** A rename breaks the surfaces that vendor a copy.
- **A pixel value appears only on a border, outline, stroke width, media query, or a line marked with the geometry it comes from.**

### Color

The raw palette:

| Token | Value | Job |
| --- | --- | --- |
| `--white` | `#ffffff` | Page ground |
| `--paper` | `#f7f7f5` | A quiet ground inside the page |
| `--ink` | `#1f1e1a` | Body text, headings, heavy rules |
| `--ink-soft` | `#55534b` | Secondary copy |
| `--ink-faint` | `#6b6860` | Meta, captions, section numbers |
| `--rule` | `#dcdad6` | Hairlines |
| `--cobalt` | `#0760c7` | The structural accent |
| `--cobalt-tint` | `#e6effc` | Structural panel, insight panel, code |
| `--purple` | `#46188c` | The one thing worth pausing on |
| `--purple-tint` | `#f1ebfa` | Emphasis panel |
| `--link` | `#6d28d9` | Links and the focus ring |
| `--sage` | `#637a63` | Bullet dots and marks on white |
| `--sage-fill` | `#8fb5a0` | Brand sage: fills, and anything on ink |
| `--sage-tint` | `#e7f1ed` | The default quiet panel |
| `--red` | `#a8231c` | A problem: failed, missing, not saved |
| `--red-tint` | `#fbeceb` | The red notice's ground |
| `--amber` | `#8a5100` | May be off, will likely fix itself |
| `--amber-tint` | `#fcf2e0` | The amber line's ground |

Rules:

- **One jab of color per element, never a gradient.**
- **Pick sage by ground.** `--sage` is for marks on white; `--sage-fill` is for fills and for anything on ink. Each fails where the other passes (the file's header has the contrast numbers).
- **Red and amber mean a problem and nothing else.** A page with no problem shows neither. They differ by shape as well as hue: a filled dot against a ring.
- **Body text on an ink ground is full white.** The two softer greys (`--ink-soft-ondark`, `--ink-faint-ondark`) are for secondary and meta text only.
- **Status is by job:** `--danger`, `--warning`, `--muted` and their tints.
- **Documents are light only.** `color-scheme: light` keeps the browser's own scrollbars and form controls on a light ground.

### Type

- Display and headings: **Schibsted Grotesk** (`--font-display`, `--font-heading`). Body: **Hanken Grotesk** (`--font-body`). Code: **JetBrains Mono** (`--font-mono`). The three variable woff2 files are vendored and served beside the page, so nothing loads from the network.
- Weights: `--w-body` 400, `--w-medium` 500, `--w-display` 600, `--w-bold` 700.
- Body line-height is 1.65. Heading line-height is `--lh-heading` (1.12), tracking `--tracking-heading` (`-.012em`).

| Token | Value |
| --- | --- |
| `--text-h1` | `clamp(34px,4.6vw,52px)` |
| `--text-h2` | `clamp(25px,3vw,34px)` |
| `--text-h3` | `clamp(19px,2vw,23px)` |
| `--text-h4` | `18px` |
| `--text-lede` | `20px` |
| `--text-body` | `17px` |
| `--text-small` | `15px` |
| `--text-meta` | `14px` |
| `--text-micro` | `12px` |
| `--text-figure` | `23px` |
| `--text-stat` | `clamp(30px,3.4vw,38px)` |
| `--text-stat-large` | `clamp(44px,6vw,64px)` |
| `--text-quote` | `clamp(22px,2.4vw,28px)` |

Rules:

- **Headings are sentence case. Never set a heading in all caps.**
- **There is no 16px.** Lists, tables and the facts explanations sit at body size like everything else.
- **Prose gets its reading width (`--read`, 68ch) only inside a hero, a section, a folded section or a check-in block.** A paragraph loose in `<body>` runs the full column.

### Spacing, radius, layout

| Token | Value |
| --- | --- |
| `--s1` to `--s8` | `4px`, `8px`, `12px`, `18px`, `28px`, `44px`, `72px`, `104px` |
| `--gutter` | `--s5` |
| `--section-gap` | `--s7` |
| `--section-gap-narrow` | `--s6` |
| `--block-gap` | `--s4` |
| `--r` | `4px` |
| `--r-lg` | `6px` |
| `--r-code` | `3px` |
| `--r-pill` | `999px` |
| `--maxw` | `1080px` |
| `--line` | `1px solid var(--rule)` |
| `--divider` | `2px solid var(--ink)` |

Rules:

- **The column is declared once, as a rule about the page.** Every direct child of `<body>` sits in it. A component never sets its own max-width or side padding, so a new component cannot be off the grid. Put page blocks straight in `<body>`; do not wrap the page.
- **Section heads hang from a full-width `--divider`**, never a short stub.
- **Use spacing by purpose** (`--gutter`, `--section-gap`, `--block-gap`) before the numeric scale.
- **No pills, no gradients, no shadows, no all caps, no single-side colored borders.** These are the house rules the stylesheets state in their own headers. The one pill is the calendar's today marker, on purpose.

### Choosing a component

Every class, its markup and its variants are in [COMPONENTS.md](../../vendor/stclair-doc-style/COMPONENTS.md). Do not copy that catalog. These are the rules for choosing.

- **Start bare.** A class-free `ul`, `ol`, `table`, `blockquote`, `img`, `code` and `pre` are already styled. Reach for a class only when the bare element cannot say it.
- **Less is more: one tinted panel per page, one callout, one band, one pull quote.** Two loud things cancel each other.
- **Every document has one `.hero`. Every major section is a `section.sheet` with a `.sheet-head`.**
- **Counts are part of the component.** The facts grid is exactly three points. Stat tiles are up to four across, number first. Step sequence in boxes is four steps or fewer.
- **Use a table for data and a facts grid or panel for words.** Use `table.data` with `num` cells for figures, and wrap a wide table in `.scrollx`.
- **Panels:** sage is the default aside, cobalt is a definition or constraint, purple is the one thing to pause on, danger is a problem only. Callouts are one short line, under about 20 words.
- **A choice for the reader is option cards, and the recommended card gets a "Recommended" badge.** Never a colored edge.
- **Badges** are one or two words for a status or category. Use a **status dot** for a verdict word (accepted, rejected, deferred) in a table cell or line.
- **Modifiers use a double dash on the block's class:** `panel panel--cobalt`, never `panel cobalt`.
- **Keep to the classes in COMPONENTS.md.** A class that is not listed is not in the stylesheet.
- **Images:** give every `img` an `alt`, `width` and `height`, and put the file beside the page. A screenshot of a white page needs the hairline frame; the image treatments draw it from `--image-frame`.
- **Icons are optional.** The page does not load Lucide. Inline an SVG or leave the icon out.
- **Mermaid keeps the house palette under every style.** Its colors are hex values in `src/service/markdown.js`, each named for the token it copies, because the library reads them before any stylesheet exists.

### The Library page

The Library page (`src/service/catalog_page.js`) is the house style plus one inline `<style>` (`PAGE_STYLE`). It follows the operating system's light and dark setting.

- **Its colors are `--lib-*` names that point at the shared tokens.** The shared tokens are never redefined, and dark is the same names pointed elsewhere.
- **Two status colors only: attention (`--lib-attn`, refused, needs an agent, waiting on you) and quiet.** Every dot has a word beside it.
- **Open uses the rail's accent** (`--lib-primary` is `#3c56a5` in light and `#93a7ea` in dark), so the primary button is recognizably the same product's button in both places.
- **A session card has a filled cobalt header band** (`--lib-head`, white text) and its reviews sit inside it as ruled rows.
- **Components:** `.lib-card` (a session), `.lib-row` (a review), `.lib-btn` (outlined; `data-primary` filled, `data-quiet` borderless), `.lib-banner-box` (tinted by `data-tone`), `.lib-note` (a dot and a sentence), `.lib-panel` (an inline reveal), and the confirm dialog.
- **Type is the document type tokens.** Names are `--font-display` at `--w-display`; paths and addresses are `--font-mono` at `--text-micro`.
- **The one shadow is the confirm dialog's,** because it floats over the page. The backdrop is `rgba(20,19,16,.55)`.
- **The page renders row text only as text.** Never write a title or path as HTML.

## Installed styles

An installed style loads after the house style and overrides its tokens. It does not replace the base. The rules for installing and serving one are in [STYLES.md](STYLES.md); the rail's style button is described there too. Tests and screenshots use `test/fixtures/styles/`.

- **A style restyles documents, not the rail.** The rail sits in its own closed shadow root and keeps its own tokens. A style should not try to hide or change it.
- **A style may reach only its own fonts and inline images.** That is a security rule, not a taste rule.
- **A page links the house style first and the installed style on the line after.** A link written before the house style loses the cascade.

## Gaps and drift

These are places where the code does not follow the rules above. They are recorded, not fixed.

- `src/layer/tab_active.js` has a standalone panel stylesheet (`PANEL_STYLE`) with literal colors (`#ffffff`, `#111111`, an amber quote bar `rgba(255,178,26,.9)`) instead of rail tokens. It draws only when the tab is used outside the rail.
- `src/layer/comments.js` draws the comment box on the page with its own literal indigo (`rgba(60,86,165,.75)` bar, `rgba(147,167,234,.8)` in dark) rather than rail tokens.
- `src/layer/zoom.js` and `src/service/catalog_page.js` copy the rail's accent by value. A change to `--accent` has to touch all three.
- `README.md` in the style folder says the renderer's dark palette is gone. That is true of documents. The Library page does keep a dark palette.
