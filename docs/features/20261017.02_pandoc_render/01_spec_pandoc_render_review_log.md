# Review log: r1d9eb1f2d31a

**Pages reviewed:** /01_spec_pandoc_render.html, /01_spec_pandoc_render.md

**Items:** 10 total, 9 handled, 0 not handled.

Exported from the LAHE state directory by `lib/scripts/lahe_review_log.py`. The reviewer's words are in the note and change fields; everything else is the document text the item pointed at.

## Hand edits

8. Changed "Install pandoc to draw the boxes on this page." to "Ask your agent to install pandoc to get the correct styles".

## Everything, in order

1. **comment** · whatever is happening sylistically here needs to be fixed. the Option A and Option B ne...
2. **comment** · you don't need the full feature forge doc set. it's too big for this. but you can still...
3. **comment** · approved
4. **comment** · sure
5. **comment** · we should standardize them. add them to our components
6. **comment** · no idea what this means
7. **comment** · why would it say markdown only? i mean i guess markdown can be read by other things, bu...
8. **edit** · yes
9. **comment** · approved
10. **comment** · ok, we completely rewrote the lahe skill so you might want to check the latest there

---

## 1. comment · div 4

`itm_3b2689553ec6a7b56e6c24a3` · 

**Ken wrote:**

> whatever is happening sylistically here needs to be fixed. the Option A and Option B need to be at the same height. the rRecommended tag can be on top of the border or on the right or whatever, but this layout doesn't look good. fix it in the core styles.

**Pointing at:**

> Recommended
> Option A
>
> Feature-forge, starting from this spec

**Reply (handled):**

> Fixed in the core style: the Recommended badge now sits on the card's top border at the right, so both cards start at the same height. The gap came from the eyebrow losing its first-line spacing reset when a badge came before it.

---

## 2. comment · div 5

`itm_6f1d32555f60b72ecd029853` · 

**Ken wrote:**

> you don't need the full feature forge doc set. it's too big for this. but you can still do arch review and other reviews as you judge necessary

**Pointing at:**

> Option B
>
> Push on under whetstone anyway
> One builder takes this spec as written and builds it, with a code review before the PR.
>
> Cheaper.
> About ten files and seven requirements is past whetstone's size, and the design calls get no review before code.

**Reply (handled):**

> Got it: no full feature-forge set. The builder works from this spec and runs an architecture review plus whatever else it judges worth it. Recorded under Decided.

---

## 3. comment · li 22

`itm_82287530251867e3bde4c5a0` · 

**Ken wrote:**

> approved

**Pointing at:**

> The bare callout kind. The research-report header treats ::: callout as the old name for the Key-insight panel (cobalt tint). The feature-forge build leaves the class alone, and the house style draws a bare .callout as the solid ink block. Recommendation: follow the report header, since every known bare ::: callout is in a research report, and map it to .insight.

**Reply (handled):**

> Recorded: bare ::: callout maps to .insight.

---

## 4. comment · li 23

`itm_ae588ea820996cb12036d697` · 

**Ken wrote:**

> sure

**Pointing at:**

> callout-warn and callout-note. The report header maps callout-warn to the caveat panel. callout-note has no mapping in either source. Recommendation: callout-warn to .insight .insight--caveat; callout-note to .insight with label "Note".

**Reply (handled):**

> Recorded: callout-warn to the caveat panel, callout-note to .insight labelled Note.

---

## 5. comment · li 24

`itm_54fe1590c4dbf7497adce031` · 

**Ken wrote:**

> we should standardize them. add them to our components

**Pointing at:**

> Report-only kinds (stat, stat-row, card, cardgrid, pullquote, keytakeaway, rimage, eyebrow). The report draws them with its own CSS, not house components. Two options: port that CSS into lahe-markdown.css, or restructure the markup onto house components (stat to .stat with .stat-value and .stat-meta, stat-row to .stats, pullquote to blockquote.pullquote with a footer, keytakeaway to .callout, eyebrow to p.eyebrow). Recommendation: house components where one exists, and port the report CSS only for card, cardgrid and rimage, which have no house twin.

**Reply (handled):**

> Recorded: card, cardgrid and rimage become house components in the core style and the catalog; the rest map onto the house twins they already have.

---

## 6. comment · li 25

`itm_1f17369515ce3a16a5112ec0` · 

**Ken wrote:**

> no idea what this means

**Pointing at:**

> Rail notice. The style switcher already shows a line for a missing style. Adding a pandoc line there touches the layer and the bundle. Recommendation: helper log only for now, rail line as a follow-up.

**Reply (question):**

> Rewrote it in plain words. On a machine without pandoc, the ::: boxes print as raw text. Should LAHE explain that only in its log file, or also with one line in the rail? I recommend the rail line, since a reader has no other way to find out why. Which do you want?

---

## 7. comment · h2 7

`itm_ff8fe2fb2f3c9555ef15162b` · 

**Ken wrote:**

> why would it say markdown only? i mean i guess markdown can be read by other things, but what's wrong with html? forge docs go to html?

**Pointing at:**

> Open questions

**Reply (handled):**

> Nothing is wrong with HTML. 'Markdown only' was meant to keep whetstone light by skipping the forge's build, and the side effect was raw Markdown pages. Whetstone now builds its spec with the same forge build and serves the built page, with the style bundled in. I opened this spec's built version in a new tab: the .html at the same address. Close this .md tab.

---

## 8. edit · p 24

`itm_5051187b0398d4467319007e` · 

**Ken wrote:**

> yes

**Hand edit:** Changed "Install pandoc to draw the boxes on this page." to "Ask your agent to install pandoc to get the correct styles".

**Before:**

> Telling the reader when pandoc is missing. On a computer without pandoc, a Markdown page still opens, but its ::: boxes print as raw text, the way they did for Ken today. Where should LAHE say why? (a) Only in LAHE's log file, which only agents and developers read. (b) Also as one line in the comment rail on the page, such as "Install pandoc to draw the boxes on this page." Option (b) means changing the rail's code too, so it is a little more work. On Ken's machine neither ever shows, because pandoc is installed. Recommendation: (b). A reader who sees raw ::: text has no other way to learn why.

**After:**

> Telling the reader when pandoc is missing. On a computer without pandoc, a Markdown page still opens, but its ::: boxes print as raw text, the way they did for Ken today. Where should LAHE say why? (a) Only in LAHE's log file, which only agents and developers read. (b) Also as one line in the comment rail on the page, such as "Ask your agent to install pandoc to get the correct styles" Option (b) means changing the rail's code too, so it is a little more work. On Ken's machine neither ever shows, because pandoc is installed. Recommendation: (b). A reader who sees raw ::: text has no other way to learn why.

**Reply (handled):**

> Thanks, recorded as decided.

---

## 9. comment · p 24

`itm_968c8669b883342686e97bca` · 

**Ken wrote:**

> approved

**Pointing at:**

> Telling the reader when pandoc is missing. On a computer without pandoc, a Markdown page still opens, but its ::: boxes print as raw text, the way they did for Ken today. Where should LAHE say why? (a) Only in LAHE's log file, which only agents and developers read. (b) Also as one line in the comment rail on the page, such as "Ask your agent to install pandoc to get the correct styles" Option (b) means changing the rail's code too, so it is a little more work. On Ken's machine neither ever shows, because pandoc is installed. Recommendation: (b). A reader who sees raw ::: text has no other way to learn why.

**Reply (handled):**

> Recorded: the rail line goes in, with your wording. Nothing is left open on this page.

---

## 10. comment · needs-ken

`itm_ca1b2011360405817c43f0f1` · 

**Ken wrote:**

> ok, we completely rewrote the lahe skill so you might want to check the latest there

**Pointing at:**

> Needs Ken
> Section 1
> Updated 2026-10-17 15:40. Nothing is open. All four questions are decided; the builder is building.

**Reply (handled):**

> Read the new skill. The status at the top of this page was stale, so I've updated it with where the build stands. One conflict to know about: the new skill says to serve a single Markdown doc directly rather than build an HTML copy. Yesterday I switched whetstone to build and serve the HTML, the forge way. Once the pandoc change lands, both give the same look. Your call which rule wins; I'd follow the new skill and switch whetstone back after the PR.

---
