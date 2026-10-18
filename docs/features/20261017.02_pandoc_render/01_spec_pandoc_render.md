# Render Markdown with pandoc

Status: PR open (#80). Built and reviewed (architecture and security before code, 2026-10-17; code review and requirements check after, 2026-10-18; dispositions at the bottom).

## Needs Ken

Updated 2026-10-18 19:26. **Needs Ken: approve or comment on [PR #80](https://github.com/kenxle/live-agentic-html-editor/pull/80).** Everything else is done: code, tests, both review rounds fixed, and the full local gate run (5 browser failures in Firefox and WebKit, each reproduced on a clean origin/main, so not from this branch).

### Decided 2026-10-17

- **Route:** no full feature-forge doc set. This spec stays the only spec doc. The builder runs an architecture review, and any other review it judges worth it, before and after the code.
- **Open question 1 (bare `::: callout`):** maps to `.insight`, as recommended.
- **Open question 2 (`callout-warn`, `callout-note`):** as recommended. `callout-warn` maps to the caveat panel, and `callout-note` to `.insight` labelled "Note".
- **Open question 3 (report-only kinds):** standardize them. Each one that has no house component yet (card, cardgrid, rimage) becomes a house component, added to `vendor/stclair-doc-style` (document.css and COMPONENTS.md). The report's CSS is not copied into `lahe-markdown.css`. Kinds that already have a house twin map onto it.
- **Open question 4 (telling the reader pandoc is missing):** both. The helper log gets a line, and the rail shows "Ask your agent to install pandoc to get the correct styles".

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

**Where each job happens.** The pandoc Lua filter does everything that reads the document's structure, including the fenced-div mapping. JavaScript on pandoc's HTML does only what needs LAHE's state: link classification, the file-name title, URL rewriting.

| Job | Where | Why |
|---|---|---|
| Hero and `.sheet` split | Lua filter over top-level blocks | Pandoc's AST knows which H2 is top level. A `## ` inside a code block or a fenced div cannot open a section, same as marked's token split today. |
| Mermaid blocks | Lua filter: a `mermaid` CodeBlock becomes `<pre class="mermaid">` | Matches today's markup exactly; the page script is unchanged. |
| Other code blocks | Lua filter: `<pre><code class="language-x">` | Keeps marked's shape so the house CSS and the handled check see the same thing. Highlighting off, as the builds do. |
| Tables in `.scrollx` | Lua filter | Same as today's renderer hook. |
| Task lists | Lua filter | The house rule is written for marked's shape: a bare checkbox in a class-free list. |
| Fenced-div mapping | Lua filter, on the syntax tree | Ten of the kinds restructure their content (stat, pullquote, rimage, card and more), which regexes on HTML do badly. Pandoc also writes a div that opens with a heading as a `<section>`, and raw HTML in a document breaks regex depth counting; the filter sees neither problem. The mapping table below is the contract both builds follow. One cost: a raw-HTML `<div class="callout-req">` written by hand is no longer mapped. |
| Link classification | Lua filter tags each Markdown link `data-lahe-link="<nonce>:<n>"` and writes a matching `<!--/lahe-link <nonce>:<n>-->` after its `</a>`; JavaScript rewrites each tagged pair exactly | `links.classify` needs the per-render registry, which a filter cannot reach. The nonce is random per helper process and passed on the command line, so raw HTML in a document cannot fake a tag. The closing marker makes the inert-link swap exact even when the link text holds raw HTML. |
| Relative-URL rewrite, frontmatter, style line, title, notes | JavaScript, unchanged | Already work on strings before or after rendering. |

**Input format.** `gfm+fenced_divs-gfm_auto_identifiers-yaml_metadata_block-tex_math_dollars-tex_math_gfm`. The feature-forge build reads `gfm+fenced_divs`. Each extension turned off would change the words on the page from what marked shows today, which strands comment anchors and changes what the handled check reads:

- heading ids would move the layer's anchors
- a later `---` block would be swallowed as metadata (LAHE already strips the real frontmatter)
- `$HOME/$PATH` would render as italic math

Emoji, alerts and footnotes stay on, as in the builds. When pandoc is first found, LAHE checks `--list-extensions=gfm` names every extension above; a pandoc that does not is treated as missing.

**Engine choice.** `src/service/pandoc.js` finds pandoc by absolute path: `LAHE_PANDOC` if set, then PATH (absolute entries only), then `/opt/homebrew/bin` and `/usr/local/bin`, because the helper inherits PATH from whichever agent shell started it. It checks the version and extensions, and logs the path and version once. A missing pandoc is looked for again after a minute, so installing it needs no helper restart. `renderPage({engine})` picks an engine for one call; `LAHE_MARKDOWN_ENGINE=marked` forces the fallback for the process and is read on every call. The unit script sets it, so existing tests keep marked's expected strings; the pandoc tests ask for pandoc explicitly and skip with a message when it is missing. CI stays install-free on purpose: it proves a clean clone works, which is now the fallback path. The pandoc tests run in the local `npm run gate` that precedes every PR.

**Speed.** `renderPage` is synchronous and stays synchronous: `spawnSync` blocks the helper's one event loop, so the timeout is 5 seconds and the process is killed with SIGKILL. A rebuild renders on each save, and the handled check renders the file on every check. So `pandoc.js` keeps a bounded cache of pandoc's raw output keyed by a hash of the Markdown text, the pandoc version and the filter. Failures and timeouts are cached too, so a slow document stalls once, then renders with marked. Link classification and URL rewriting run on every render, cached or not, because they depend on the page's folder and registry. Measured during build and reported.

**The pandoc call.** `pandoc --from gfm+fenced_divs-gfm_auto_identifiers-yaml_metadata_block-tex_math_dollars-tex_math_gfm --to html5 --wrap=preserve --sandbox --data-dir <absent> --metadata lahe-nonce=<nonce> --lua-filter <src/service/lahe_render.lua>`, Markdown on stdin, HTML on stdout, `spawnSync` with an argument array, `shell: false`, a 5-second timeout and an output cap.

- `--sandbox` stops pandoc's readers and writers opening files or URLs. It does not limit Lua, so the filter uses no `io`, `os`, `pandoc.pipe` or mediabag call (a unit test greps for them), and `--data-dir` points at a folder that does not exist, so a user's `init.lua` never runs inside LAHE.
- The child gets `cwd` set to the temp folder and a minimal environment (`HOME`, `LANG=C.UTF-8`), without `LUA_PATH`, `LUA_CPATH` or `XDG_DATA_HOME`. Output is capped at 32 MB and input at 8 MB. Pandoc is only ever handed text, never a path, so a notes review's no-follow read stays the only read. Nothing from the document reaches the argument list.
- `--wrap=preserve` keeps the source's line breaks inside paragraphs, the way marked does, so text-matching code (the handled check, anchors) sees the same text.
- No highlighting flag is needed: the filter writes code blocks itself.
- Version floor 3.0. `pandoc --version` is read once; an older pandoc is treated as missing and logged once with its version.
- Raw HTML in the Markdown passes through, as it does under marked today. The trust posture does not change: the author's file is the page.

**Fenced-div mapping.** Kinds come from the builds; the decided open questions settle the rest. "Unwrapped" means the wrapper div goes and an eyebrow label sits above the content, as `unwrap_plain_callouts` does. A run of two or more same-kind callouts with only whitespace between them merges into one panel with one label, as `merge_callout_runs` does. An author's own `data-label` wins over the default label.

| Kind | Renders as | Source |
|---|---|---|
| `callout-req` | eyebrow "Requirement", content unwrapped | build_feature_docs.py |
| `callout-nongoal` | eyebrow "Non-goals", content unwrapped | build_feature_docs.py |
| `callout-metric` | `.insight`, label "Metrics" | build_feature_docs.py |
| `callout-suggest` | `.insight`, label "Suggestion" | build_feature_docs.py |
| `callout-question` | `.insight .insight--caveat`, label "Open question" | build_feature_docs.py |
| `callout-flag` | `.insight .insight--caveat`, label "Red flag" | build_feature_docs.py |
| `callout` | `.insight` (label "Key insight" from the house CSS) | report header; decided Q1 |
| `callout-warn` | `.insight .insight--caveat` (label "Caveat") | report header; decided Q2 |
| `callout-note` | `.insight`, label "Note" | decided Q2 |
| `insight`, `insight--caveat` | unchanged; already house classes | report authoring guide |
| `xref` | unchanged; `.xref` is a house class | both |
| `stat` | `.stat`: first paragraph becomes `p.stat-value`, the rest `p.stat-meta` | report guide; house twin |
| `stat-row` | `.stats` | report guide; house twin |
| `pullquote` | `blockquote.pullquote`: first paragraph is the quote, the rest go in its `footer` | report guide; house twin |
| `keytakeaway` | `.callout` (the solid ink block, white text) | report header; house twin |
| `eyebrow` | `p.eyebrow` holding the div's text | report guide; house twin |
| `rimage` | `figure.plate`: the image, then the caption paragraph as `figcaption` | report guide; house twin (see note) |
| `card` | `.card`, a new house component | decided Q3 |
| `cardgrid` | `.cards`, a new house component | decided Q3 |
| anything else (`beattable`, `reviews-banner`, unknown) | `<div class="kind">`, inside rendered as Markdown | R1 (unknown kinds) |

Note on `rimage`: the decision named it as one of the kinds with no house twin. The house already has `figure.plate`, "a picture on a framed plate with a caption", which is what `rimage` draws. Under the decision's own rule (a kind with a house twin maps onto it) it maps to the plate, and no new image component is added. card and cardgrid have no twin (`.options` is for a page that asks the reader to pick), so they become `.card` and `.cards`, written the way `.option` and `.options` are, from tokens only.

**Not a fence.** One report writes `::: xref [link] :::` on a single line. Pandoc reads that as a paragraph, so the builds show it as text too. LAHE matches the builds and leaves it alone.

**The missing-pandoc notice.** When pandoc did not render a page whose source has a `:::` line outside code, the page carries `<meta name="lahe-render-note" content="pandoc">`. The rail reads that meta and shows one line, its own fixed text: "Ask your agent to install pandoc to get the correct styles". The page never supplies the words. `writeArtifact` and the page server's Markdown render, which know the state directory, write one helper-log line naming why (missing, too old, failed). A forced `LAHE_MARKDOWN_ENGINE=marked` writes neither.

## Tasks

| # | Task | Files | Proof |
|---|---|---|---|
| 1 | Pandoc runner: find, call with array args, stdin, timeout, cache, env override, fall back on error | `src/service/pandoc.js` (new), `src/shared/manifest.js` | unit: found, missing, timeout, nonzero exit, env override |
| 2 | Lua filter: hero/sheet split, mermaid, code, tables, link tags, task lists, and the fenced-div mapping | `src/service/lahe_render.lua` (new) | unit: H2 in a code fence or div does not split; mermaid markup; tagged links; each mapped kind; run merging; req/nongoal unwrap; unknown kind; nesting; `:::` in a fence stays literal; no io/os/pipe in the filter |
| 4 | Wire into `renderPage`; link pass over tagged pairs; file-name title; meta notice; one-time log | `src/service/markdown.js`, `src/service/page_routes.js`, `src/shared/markers.js` | existing markdown unit tests green with marked pinned; new pandoc tests |
| 5 | House components `.card` and `.cards` | `vendor/stclair-doc-style/document.css`, `COMPONENTS.md`, its README | unit: stylesheet carries both; screenshot of a report card grid |
| 5b | Rail line for the fallback, Ken's wording | `src/layer/overlay.js`, `dist/` rebuild | browser spec: line shows with the meta, absent without |
| 6 | Dependency rule and install docs | `CLAUDE.md`, `AGENTS.md`, `README.md`, `vendor/marked/README.md`, `docs/ongoing/TESTING.md` | read-through |
| 7 | Evidence | none | screenshots: choice-buttons brief, one older research report with stat/card/pullquote, a no-div page before and after; `npm run gate` counts |

Every builder brief carries the no-delete rule: no `rm`, `rmdir`, `unlink` or `git clean`; list files for cleanup instead.

## Acceptance criteria

- Each Proof cell in the Tasks table passes.
- The choice-buttons brief and one older research report render through `lahe review` with zero literal `:::` lines, checked by a Playwright text search, with screenshots.
- A no-div page looks the same before and after, by screenshot.
- `npm run gate` reads 0 failed, counts in the PR body, with every changed expected string listed.
- With `LAHE_MARKDOWN_ENGINE=marked`, output is byte-identical to today's for a page with no `:::` lines.
- Analytics: none; LAHE has no analytics. Rollout: no flag beyond the env override, because a missing pandoc already falls back.

## Open questions

<div class="insight" data-label="Decided">

**The bare `callout` kind.** The research-report header treats `::: callout` as the old name for the Key-insight panel (cobalt tint). The feature-forge build leaves the class alone, and the house style draws a bare `.callout` as the solid ink block. Recommendation: follow the report header, since every known bare `::: callout` is in a research report, and map it to `.insight`.

**Decided 2026-10-17: map it to `.insight`.**

</div>

<div class="insight" data-label="Decided">

**`callout-warn` and `callout-note`.** The report header maps `callout-warn` to the caveat panel. `callout-note` has no mapping in either source. Recommendation: `callout-warn` to `.insight .insight--caveat`; `callout-note` to `.insight` with label "Note".

**Decided 2026-10-17: as recommended.**

</div>

<div class="insight" data-label="Decided">

**Report-only kinds** (stat, stat-row, card, cardgrid, pullquote, keytakeaway, rimage, eyebrow). The report draws them with its own CSS, not house components. Two options: port that CSS into `lahe-markdown.css`, or restructure the markup onto house components (stat to `.stat` with `.stat-value` and `.stat-meta`, stat-row to `.stats`, pullquote to `blockquote.pullquote` with a footer, keytakeaway to `.callout`, eyebrow to `p.eyebrow`). Recommendation: house components where one exists, and port the report CSS only for card, cardgrid and rimage, which have no house twin.

**Decided 2026-10-17: standardize. card, cardgrid and rimage become house components in vendor/stclair-doc-style; the rest map onto their house twins.**

</div>

<div class="insight" data-label="Decided">

**Telling the reader when pandoc is missing.** On a computer without pandoc, a Markdown page still opens, but its `:::` boxes print as raw text, the way they did for Ken today. Where should LAHE say why? (a) Only in LAHE's log file, which only agents and developers read. (b) Also as one line in the comment rail on the page, such as "Ask your agent to install pandoc to get the correct styles" Option (b) means changing the rail's code too, so it is a little more work. On Ken's machine neither ever shows, because pandoc is installed. Recommendation: (b). A reader who sees raw `:::` text has no other way to learn why.

**Decided 2026-10-17: (b), with Ken's wording.**

</div>

## Size

This is past whetstone: seven requirements, about ten files (three new source files, `markdown.js`, the manifest, four docs, tests, optionally the layer), and an Approach section with real alternatives. Ken chose on 2026-10-17 to build it here with this one spec, plus an architecture review before code, and a code review and an independent requirements check before the PR.

## Review dispositions

Architecture review (review-architect, opus) and security review (review-security, opus), both 2026-10-17, on the Approach before code.

| # | Finding | Disposition | What changed |
|---|---|---|---|
| A1 | Do the fenced-div mapping in the Lua filter, not a JS port of the Python | <span class="status-dot status-dot--sage">Accepted</span> | Approach table; task 3 folded into task 2 |
| A2 | The missing-pandoc seam never reaches the browser | <span class="status-dot status-dot--sage">Accepted</span> | A page meta carries the signal; logging moves to the two callers that know the state folder; only pages with `:::` lines get it |
| A3 | gfm turns on math, emoji, alerts, footnotes and YAML metadata; name extensions explicitly and check them | <span class="status-dot status-dot--sage">Accepted</span> | Math and YAML metadata off; emoji, alerts and footnotes kept, as in the builds; extension check at detection |
| A4 | Decode and re-escape attributes; make the inert-link swap exact | <span class="status-dot status-dot--sage">Accepted</span> | Numbered tag plus closing marker |
| A5 | sheet-head as raw HTML, file-title placeholder, empty documents, mermaid escaping | <span class="status-dot status-dot--sage">Accepted</span> | All in the filter |
| A6 | Rendering blocks the helper; cache failures; key on version and filter | <span class="status-dot status-dot--sage">Accepted</span> | 5-second timeout (security asked 5, architecture 3; 5 leaves room for a long report), failure caching, key widened |
| A7 | Pin existing tests to marked by option; install pandoc in CI; `LAHE_REQUIRE_PANDOC` | <span class="status-dot status-dot--faint">Deferred</span> | Option and env pinning accepted. CI install rejected for now: CI proves a clean clone with no installs, which is the fallback path, and the local gate runs the pandoc tests before every PR |
| A8 | Find pandoc beyond PATH; log path and version | <span class="status-dot status-dot--sage">Accepted</span> | Homebrew folders and `LAHE_PANDOC` |
| A9 | Footnotes land after the last sheet; restart needed after install | <span class="status-dot status-dot--sage">Accepted</span> | Footnotes left where pandoc puts them; a missing pandoc is looked for again after a minute instead of needing a restart |
| S1 | Raw HTML can fake the link tag | <span class="status-dot status-dot--sage">Accepted</span> | Per-process nonce from the command line |
| S2 | `--sandbox` does not cover Lua or a user's `init.lua` | <span class="status-dot status-dot--sage">Accepted</span> | Absent `--data-dir`, filter grep test, spec sentence corrected |
| S3 | A slow document freezes the helper | <span class="status-dot status-dot--sage">Accepted</span> | Same as A6 |
| S4 | Node's default 1 MB output cap | <span class="status-dot status-dot--sage">Accepted</span> | 32 MB output, 8 MB input |
| S5 | Find pandoc once by absolute path; fixed cwd | <span class="status-dot status-dot--sage">Accepted</span> | Relative PATH entries skipped; cwd is the temp folder |
| S6 | Minimal child environment | <span class="status-dot status-dot--sage">Accepted</span> | `HOME`, `LANG` and Windows' temp and system variables only |
| S7 | Decode, re-escape, allow newlines in attribute patterns | <span class="status-dot status-dot--sage">Accepted</span> | Same as A4 |
| S8 | Cache only raw output; classification runs every render | <span class="status-dot status-dot--sage">Accepted</span> | Speed paragraph |
| S9 | noFollow not weakened, given text-only input and no document values in argv | <span class="status-dot status-dot--sage">Accepted</span> | Stated in the pandoc call section |

Accepted all but A7's CI install. `rimage` maps to the existing `figure.plate` rather than a new component, under Ken's own rule for kinds with a house twin.

### After the build

Code review (feature-dev:code-reviewer, opus) and an independent requirements check (opus), 2026-10-18, on the integrated diff.

| # | Finding | Disposition | What changed |
|---|---|---|---|
| C1 | The page server's render cache kept a marked page, notice and all, after pandoc was installed | <span class="status-dot status-dot--sage">Accepted</span> | The cache key carries which engine renders (`markdown.engineKey`) |
| C2 | No tests for a nonzero exit, a timeout, the input cap or failure caching | <span class="status-dot status-dot--sage">Accepted</span> | A stand-in pandoc script drives six new unit tests |
| C3 | A pandoc uninstalled after it was found failed every page as "could not render" | <span class="status-dot status-dot--sage">Accepted</span> | ENOENT forgets the binary and the cache, and the note says not installed |
| C4 | Merged callouts compared only `data-label`, so `label=` runs merged and lost a label | <span class="status-dot status-dot--sage">Accepted</span> | The run key reads both |
| C5 | The house-twin lookup walked a Lua map, whose order is not fixed | <span class="status-dot status-dot--sage">Accepted</span> | A fixed list |
| C6 | An eyebrow dropped a list; `label=` and `data-label=` wrote the attribute twice | <span class="status-dot status-dot--sage">Accepted</span> | Blocks after the line are kept; the first label wins |
| C7 | A rail comment sat over the wrong element | <span class="status-dot status-dot--sage">Accepted</span> | Moved |
| Q1 | The rebuilt `dist/lahe-layer.js` was not committed | <span class="status-dot status-dot--sage">Accepted</span> | Committed with the fixes |
| Q2 | pandoc left `"` bare in text and inline code, so the relative-URL pass rewrote `href="./x"` written in prose or a code span | <span class="status-dot status-dot--sage">Accepted</span> | The filter escapes them as marked does. Across the repo's 362 Markdown files with no fenced div, 360 now read the same under both engines; the other two are lazy lines starting "7817." and "5)" that marked wrongly turns into list numbers and pandoc keeps as text |
| Q3 | Spec said 10 seconds and a shorter `--from` in one place | <span class="status-dot status-dot--sage">Accepted</span> | Corrected |
| Q4 | The Playwright text search runs on a made-up page, not the two real documents | <span class="status-dot status-dot--faint">Deferred</span> | Both real documents sit outside this repo, so a spec cannot read them on another machine. They were checked with a script (zero `:::` lines each) and screenshotted |
| Q5 | The README badge still says "runtime dependencies: none" | <span class="status-dot status-dot--purple">Rejected</span> | Still true for npm, which is what the badge links to; the Requirements section names pandoc as optional |
