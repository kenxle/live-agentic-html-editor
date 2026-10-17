# Render Markdown with pandoc

Status: spec written, not yet reviewed. Sized past whetstone (see "Size" at the bottom), so it stops here for a decision on route.

## Needs Ken

Updated 2026-10-17 15:35. One question is still open: open question 4, at the bottom of the page. It asks where LAHE tells a reader that pandoc is missing: only in the log file, or also on the page. The recommendation is now to say it on the page too.

### Decided 2026-10-17

- **Route:** no full feature-forge doc set. This spec stays the only spec doc. The builder runs an architecture review, and any other review it judges worth it, before and after the code.
- **Open question 1 (bare `::: callout`):** maps to `.insight`, as recommended.
- **Open question 2 (`callout-warn`, `callout-note`):** as recommended. `callout-warn` maps to the caveat panel, and `callout-note` to `.insight` labelled "Note".
- **Open question 3 (report-only kinds):** standardize them. Each one that has no house component yet (card, cardgrid, rimage) becomes a house component, added to `vendor/stclair-doc-style` (document.css and COMPONENTS.md). The report's CSS is not copied into `lahe-markdown.css`. Kinds that already have a house twin map onto it.

## Problem, user, and context

When LAHE renders a Markdown file directly (`lahe review some.md`, or a link to a `.md`), pandoc fenced divs print as literal text. A doc that says `::: callout-nongoal` shows the colons and the word on the page instead of the house panel the feature-forge build draws. The choice-buttons brief (`docs/features/20261013.01_choice_buttons/01_brief_choice_buttons.md`, its Non-Goals section) is a live example.

Ken reads most of his feature docs and research reports this way. Across his repos the fenced-div kinds in use are, most common first: callout-req, xref, stat, card, callout-question, stat-row, callout-metric, pullquote, callout-nongoal, cardgrid, callout-warn, keytakeaway, callout, rimage, callout-flag, plus rare callout-suggest, callout-note, eyebrow, insight, beattable and reviews-banner. Outer fences use four and five colons; the brace form `::: {.insight .insight--caveat}` appears; one report writes `::: xref [link] :::` on a single line.

The fix: when pandoc is installed, LAHE renders Markdown with pandoc, the same tool the feature-forge and research-report builds use, so LAHE and the builds never disagree about syntax. LAHE then applies the same kind-to-component mapping the builds apply. When pandoc is missing, LAHE renders with marked as it does today and says once that pandoc is needed for fenced divs.

Ken decided this on 2026-10-17 and overrides the repo's zero-dependency rule for it. Pandoc is a system dependency, not an npm one: `dependencies` in `package.json` stays `{}`, and a clone with no pandoc still renders every page.

### Why not a marked extension

The first brief asked for a library on top of marked. Each candidate was run against the forms in use (scratch test, 2026-10-17):

| Library | `::: name` | `::: {.x}` | `::::` outer, `:::` inner | same-count nesting | `:::` in a code fence |
|---|---|---|---|---|---|
| marked-directive 1.0.7 | tag named after the kind, not a class | yes | breaks | breaks | breaks |
| markdown-it-container | yes | class is the literal `{.x}` | yes | breaks | breaks |
| micromark-extension-directive | prints as text | prints as text | prints as text | prints as text | prints as text |

None reads all five, and the last two are different parsers from marked. Pandoc reads all of them because it defines the syntax.

## Requirements

1. **Fenced divs render as house components.** With pandoc installed, every fenced-div kind above renders as the component the builds draw. An unknown kind becomes `<div class="kind">` with its inside rendered as Markdown. No page shows a literal `:::` fence line.
2. **One mapping, copied from the builds.** The kind-to-component mapping is ported from `build_feature_docs.py` (map_callouts, merge_callout_runs, unwrap_plain_callouts, callout_sections_to_divs) and the research report's header and authoring guide. Where the two sources disagree (the bare `callout` kind), the spec names the choice; see Open questions.
3. **Everything LAHE does today still works on pandoc's output.** That covers:
   - frontmatter and the `lahe-style:` line
   - the hero plus one `.sheet` per top-level H2
   - Mermaid blocks
   - link classification (translate, inert, external, with the new-tab rules in `links.classify`)
   - relative-URL rewriting
   - the file-title attribute and the read-only note
   - noFollow reads for a notes review
   - the handled check, which reads the same rendered page
4. **Fallback without pandoc.** With no pandoc on PATH, LAHE renders with marked exactly as today. It writes one helper-log line per state directory saying pandoc is needed to render fenced divs. If the rail has a place for render notices, it says so there too (see Open questions).
5. **Safe call.** LAHE runs pandoc with an argument array (no shell), a timeout, and the Markdown on stdin. A pandoc failure or timeout falls back to marked for that render and logs it once.
6. **The dependency rule names pandoc.** CLAUDE.md, AGENTS.md, README.md and the vendor README that states the rule say pandoc is an allowed system dependency and why. The README's install section says how to install it.
7. **A page with no fenced divs looks the same.** Byte-identical output no longer applies once pandoc renders. A no-div page is screenshotted before and after and must look the same. Existing unit and browser specs pass; an expected string changes only where pandoc's markup legitimately differs, and each change is listed in the PR.

That is seven requirements, past whetstone's guide of about five.

## Approach

This change carries real design calls, which is part of why it outgrew whetstone.

**Where each job happens.** A pandoc Lua filter for structure, JavaScript on the HTML for anything that needs LAHE's state.

| Job | Where | Why |
|---|---|---|
| Hero and `.sheet` split | Lua filter over top-level blocks | Pandoc's AST knows which H2 is top level. A `## ` inside a code block or a fenced div cannot open a section, same as marked's token split today. |
| Mermaid blocks | Lua filter: a `mermaid` CodeBlock becomes `<pre class="mermaid">` | Matches today's markup exactly; the page script is unchanged. |
| Other code blocks | Lua filter: `<pre><code class="language-x">` | Keeps marked's shape so the house CSS and the handled check see the same thing. Highlighting off, as the builds do. |
| Tables in `.scrollx` | Lua filter | Same as today's renderer hook. |
| Task lists | Lua filter or HTML pass (port of `task_lists`) | The house rule is written for marked's shape. |
| Fenced-div mapping | JavaScript on the HTML, ported from the Python | The Python works on pandoc's HTML with regexes. Porting it on the same input keeps the two builds in step and makes a diff between them readable. |
| Link classification | Lua filter tags each Markdown link with `data-lahe-link`; JavaScript rewrites only tagged links | `links.classify` needs the per-render registry, which a filter cannot reach. Tagging stops LAHE rewriting raw-HTML anchors, which marked's renderer never touched either. |
| Relative-URL rewrite, frontmatter, style line, title, notes | JavaScript, unchanged | Already work on strings before or after rendering. |

**Input format.** `gfm+fenced_divs-gfm_auto_identifiers`. The feature-forge build reads `gfm+fenced_divs`. LAHE already strips frontmatter before rendering, so the YAML extension is not needed. Heading ids are off so headings match marked's output and the layer's anchors do not move.

**Engine choice.** `src/service/pandoc.js` finds pandoc once per process (`pandoc --version` via `spawnSync`, cached) and exposes `render(markdown) -> html | null`. `LAHE_MARKDOWN_ENGINE=marked` forces the fallback, so the unit suite is deterministic on a machine with pandoc and on GitHub's runner, which may not have it. Pandoc-only tests skip with a message when pandoc is missing.

**Speed.** `renderPage` is synchronous and stays synchronous: `spawnSync` with a 10-second timeout. A pandoc start costs a fraction of a second per render; a rebuild renders on each save. Measured during build and reported.

## Tasks

| # | Task | Files | Proof |
|---|---|---|---|
| 1 | Pandoc runner: find, call with array args, stdin, timeout, cache, env override, fall back on error | `src/service/pandoc.js` (new), `src/shared/manifest.js` | unit: found, missing, timeout, nonzero exit, env override |
| 2 | Lua filter: hero/sheet split, mermaid, code, tables, link tags, task lists | `src/service/lahe_render.lua` (new) | unit: H2 in a code fence or div does not split; mermaid markup; tagged links |
| 3 | Fenced-div mapping ported from the builds | `src/service/callouts.js` (new) | unit per kind, run merging, req/nongoal unwrap, unknown kind, nesting, `:::` in a fence stays literal |
| 4 | Wire into `renderPage`; link pass over tagged anchors; one-time fallback log | `src/service/markdown.js` | existing markdown unit tests green under both engines |
| 5 | Rail notice for the fallback, if chosen | `src/layer/style_switch.js`, `dist/` rebuild | browser spec |
| 6 | Dependency rule and install docs | `CLAUDE.md`, `AGENTS.md`, `README.md`, `vendor/marked/README.md`, `docs/ongoing/TESTING.md` | read-through |
| 7 | Evidence | none | screenshots: choice-buttons brief, one older research report with stat/card/pullquote, a no-div page before and after; `npm run gate` counts |

Every builder brief carries the no-delete rule: no `rm`, `rmdir`, `unlink` or `git clean`; list files for cleanup instead.

## Acceptance criteria

- Each Proof cell in the Tasks table passes.
- The choice-buttons brief and one older research report render through `lahe review` with zero literal `:::` lines, checked by a Playwright text search, with screenshots.
- A no-div page looks the same before and after, by screenshot.
- `npm run gate` reads 0 failed, counts in the PR body, with every changed expected string listed.
- With `LAHE_MARKDOWN_ENGINE=marked`, output is byte-identical to today's.
- Analytics: none; LAHE has no analytics. Rollout: no flag beyond the env override, because a missing pandoc already falls back.

## Open questions

1. **The bare `callout` kind.** The research-report header treats `::: callout` as the old name for the Key-insight panel (cobalt tint). The feature-forge build leaves the class alone, and the house style draws a bare `.callout` as the solid ink block. Recommendation: follow the report header, since every known bare `::: callout` is in a research report, and map it to `.insight`.
2. **`callout-warn` and `callout-note`.** The report header maps `callout-warn` to the caveat panel. `callout-note` has no mapping in either source. Recommendation: `callout-warn` to `.insight .insight--caveat`; `callout-note` to `.insight` with label "Note".
3. **Report-only kinds** (stat, stat-row, card, cardgrid, pullquote, keytakeaway, rimage, eyebrow). The report draws them with its own CSS, not house components. Two options: port that CSS into `lahe-markdown.css`, or restructure the markup onto house components (stat to `.stat` with `.stat-value` and `.stat-meta`, stat-row to `.stats`, pullquote to `blockquote.pullquote` with a footer, keytakeaway to `.callout`, eyebrow to `p.eyebrow`). Recommendation: house components where one exists, and port the report CSS only for card, cardgrid and rimage, which have no house twin.
4. **Telling the reader when pandoc is missing.** On a computer without pandoc, a Markdown page still opens, but its `:::` boxes print as raw text, the way they did for Ken today. Where should LAHE say why? (a) Only in LAHE's log file, which only agents and developers read. (b) Also as one line in the comment rail on the page, such as "Install pandoc to draw the boxes on this page." Option (b) means changing the rail's code too, so it is a little more work. On Ken's machine neither ever shows, because pandoc is installed. Recommendation: (b). A reader who sees raw `:::` text has no other way to learn why.

## Size

This is past whetstone: seven requirements, about ten files (three new source files, `markdown.js`, the manifest, four docs, tests, optionally the layer), and an Approach section with real alternatives. Per the escalation rule it should move to feature-forge, which adopts this worktree and branch. The spec has had no agent review yet and has not been in front of Ken.
