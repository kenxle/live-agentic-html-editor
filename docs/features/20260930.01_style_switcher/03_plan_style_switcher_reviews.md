# Plan reviews: Style switcher

Both reviews read the first plan draft. Their findings are integrated; the summary tables in the plan say what changed. V row numbers below are the draft's.

## Plan Review (Round 1)

The plan is close to buildable, but it has four gaps a builder or the orchestrator would trip on. The Rail packet leaves out the rules the Rail builder needs. The branch layout between the two PRs is never stated. PR A's gate fails on a stale bundle. And the dark screenshot would show a state no user ever sees.

**RF1 (blocker, orchestration).** The Rail packet cites architecture Key Flows, Failure Modes and What the document carries, but not the other parts of Data / State Changes. So the Rail builder never gets:
- the note's exact words ("Use the <name> style for this page (lahe-style: <id>).")
- the waiting rule
- the storage key `lahe.style.v1:<review id>:<page path>`
- the id pattern it must re-check
- the Security "Display" rule (names reach the rail as text, colours only after the hex check)

V13 (one exact note), V11 (survives a reload) and V22 (the layer drops bad ids and colours) depend on these, so the builder would invent them. Suggested change: add "The style id", "The request to the agent", "Waiting", "The preview" and Security "Display" to the Rail packet.

**RF2 (blocker, orchestration).** The branch layout is unstated. PR A is "Set-up, Service, 1.4", yet the Rail builder merges `feat/style-switcher` once Service lands there. If PR A is opened from that same branch, Rail commits can land on it before A merges, and A then carries B's half-built work. Suggested change: say PR A merges to main from `feat/style-switcher` before any Rail merge, and the Rail branch rebases onto main after A lands to become PR B.

**RF3 (important, orchestration).** Task 0.1 adds an empty `src/layer/style_switch.js` to the layer's load order. That makes the committed `dist/lahe-layer.js` stale, so `check:layer` fails, and PR A's proof is `npm run gate`. Step 1 never rebuilds `dist/`. The manifest already supports `planned: true` for files that do not exist yet. Suggested change: mark the layer file `planned: true` in 0.1 (orchestrator flips it at the Rail merge), or add "orchestrator rebuilds and commits dist" to PR A.

**RF4 (important, test plan).** The dark screenshot shows a state no user sees:
- The switcher appears only on house-style pages, and those are light.
- The rail's scheme follows the page's own background (`highlight.js` samples it).
- So a "dark-background fixture" (`style-switch-dark.html`) needs CSS that repaints the house style, which the brief treats as a page with its own CSS.
- The real risk goes untested. The rail re-reads the scheme only on remount (`refreshScheme`), not after a preview changes the page background.

Suggested change: drop dark from V19 (screenshots, looks right) with a line on the progress page saying why. Replace it with a test that the rail's scheme stays correct after a preview.

**RF5 (important, test plan).** The brief's metric wants the whole flow automated on the made-up style: preview, keep, agent answers, reload shows the kept style with no preview. The plan splits this into V13 (one note) and V14 (the test hand-edits HTML and reloads). Nothing proves the note reaches review.json with the marker, and nothing proves a Markdown source edit reloads through `rebuild.js` and clears the key. Suggested change: add one spec on a Markdown source through a real helper: keep, check review.json, post a reply, edit the frontmatter, and let the rebuild reload.

**RF6 (important, test plan).** V5 (serving only what it should) refuses "a hand-edited sheet", but the served bytes are cached per file on size, mtime and inode. A test that never serves the good sheet first cannot catch a cache that skips the re-check. Suggested change: V5 serves a good sheet, edits it to add an `http` `url()`, then expects a 404 and one log line.

**RF7 (important, test plan).** The architecture says every failure mode has a row. These do not:
- two style links in the source (the last wins, and a preview disables both)
- a page not served by a Lahe page server (the panel shows International alone and the add line)
- a hand-copied folder with bad metadata being left out of `index.json` on the service side

Suggested change: add one row each, or state why each is accepted without a test.

**RF8 (important, test plan).** R8 (a saved Markdown file shows its style with no Lahe running) is proven only by "files copied" in V6. No test opens the artifact from disk and sees the style's colours and font apply through relative paths. Suggested change: add a browser case to V6 that loads the written artifact over `file://` and asserts the computed font and colours.

**RF9 (important, orchestration).** No review is named for either PR. This diff touches serving, paths and a third-party CSS trust boundary, which CLAUDE.md says calls for a security review. The flow walk before the PR and the independent requirements check are also missing. Suggested change: add security review plus code review on PR A's integrated diff, and code review, the requirements check and the flow walk on PR B's diff, with one owner each.

**RF10 (important, test plan).** V19 says screenshots come "from the passing run" into `docs/.../progress/screens/`. A spec that writes there on every run dirties the tree at every gate. Suggested change: use the existing `LAHE_SCREENSHOT_DIR` switch (as in `rail_hold.spec.js` and `conflict_toast.spec.js`) and name it in the Rail packet.

**RF11 (minor, test plan).** V17 (the instruction and its copies) checks the copies match, which cannot fail on content. R7 (the agent applies it from the instructions alone) then rests only on V20, done by hand. Suggested change: V17 also checks the contract names the exact link line, the frontmatter line, and `international` removing either.

**RF12 (minor, orchestration).** The Rail browser spec needs a page server with the fixture style installed in a temp state directory, and a second one with nothing installed for V9 (the list). No harness is named. V14 (the kept style clears the preview) also "writes into the fixture's source", which would change a checked-in file. Suggested change: name the harness, and have V14 copy its fixture to a temp folder.

**RF13 (minor, orchestration).** Task 1.3 says regenerate `empty_notes.html` "if the marker changes it". It will, and it feeds `leaf_blocks.test.js` too. Check `md_render.html` for the inlined bundle as well, since browser specs use it. Suggested change: make the regeneration definite and name both files.

**RF14 (minor, orchestration).** The Service packet leaves out `docs/ongoing/LIBRARY.md` and `SERVING_ARCHITECTURES.md`, though Task 1.3 says "as the library route is answered". Suggested change: add both.

**RF15 (minor, orchestration).** The Service builder writes the CSS tokenizer, which is the security boundary, on Sonnet because "the rules are fully specified". The rules are specified; getting CSS Syntax Level 3 tokenizing right is the judgment call. Suggested change: use Opus for Task 1.1, or have the security review in RF9 read the tokenizer directly.

**RF16 (minor, orchestration).** Task 2.1's acceptance lists V8 (menu item appears) and V22 (bad list entries dropped), but both need the panel from Task 2.2. Suggested change: move them to 2.2.

**RF17 (minor, test plan).** Some wording is left open:
- V7 (a rebuild picks up the style) says "or the rebuild test", leaving the file to the builder.
- V4 (a failed replace leaves the old install) needs a way to make the replace fail, and none is named.

Suggested change: pin V7's test file, and name that way into `styles.js`.

## Design Review, magic-mirror (Round 1)

The plan is close, but a few design decisions are still open or in conflict, and they need settling before Task 2.2 (the panel) goes to a builder. The main ones: the plan gives the "Use" button a button style the end-review panel doesn't have, most strings are unwritten, the panel's order jumps when it collapses, and the rail doesn't restyle itself for a dark preview. Placement is right: a menu item plus a panel under the head keeps the head quiet, and a standing control would break the rail's rule of styling only what it adds (D10).

**Findings**

- **important, defect, Arch "The panel"; Task 2.2.** The end-review panel has only neutral buttons, so "the end-review panel's button styles" gives the primary button no style to borrow. Why: the builder invents a primary style, new visual language. Fix: primary uses the refusal/overdue accent button (`.refusal__btn`). Back and Close use `.endpanel__no`.
- **important, defect, Arch "The panel", status line order.** The status line sits below the list, but collapsed it is all that remains, so it jumps upward when the panel closes. Why: the reviewer's anchor moves; a long list pushes "Use" far down. Fix: order is title row with Close, then status and actions, then the list. Collapsing hides the list and nothing else moves.
- **important, defect, words (arch and brief).** "International" and "International Style" are both used, and the waiting line, missing-style fallback and error copy are unwritten. Why: strings get written during the build, and the button stops matching its note. Fix: adopt the copy below; add it to V12, V13 and V15.
- **important, risk, Arch "Applying a preview"; highlight.js refreshScheme.** The rail picks light or dark only at build and remount, so a style with a dark background leaves a light rail and light comment boxes over a dark page. Why: bright slab over the page; highlight colours tuned for the wrong ground. Fix: call `rail.refreshScheme()` after the link and fonts settle, and on Back. Add to V19.
- **important, defect, accessibility, V18.** No screen-reader announcement for a preview or the waiting state; where focus lands when the panel opens is unstated. Why: arrow-key previews change the page silently. Fix: focus lands on the checked radio. The status line is `aria-live` polite. Esc and Close return focus to the menu button. Radios keep the native visible focus ring.
- **important, risk, edge cases, arrow keys.** Holding an arrow key starts a stylesheet and font load for each style it passes. Why: stale loads land out of order and the page shows the wrong style. Fix: only the latest pick applies; a load that finishes late is dropped. Add a rapid-arrow case to V10.
- **minor, defect, stacking under the head.** The order of the overdue banner and the style status line is unstated. Why: a preview notice could push an alarm down. Fix: overdue banner first, style status second.
- **minor, taste, palette strip.** Strip size, border, and what to draw when a style has no palette are unspecified. Why: white swatches vanish on white paper; empty palettes misalign rows. Fix: six 10px squares, 1px `var(--line)` border, fixed width, right-aligned. No palette: the space stays empty, no placeholder colours.
- **minor, defect, long names, many styles.** `.menuitem` is nowrap. Style names can be 40 characters. The list has no height cap. Why: clipped names; a long list pushes the tabs off screen. Fix: row names wrap, buttons wrap, collapsed line truncates with the full text in title. The list scrolls past 8 rows.
- **minor, challenge, "Use this style".** The button doesn't say the agent does the work. Why: the reviewer expects an instant save, then sees "waiting". Fix: button reads "Ask the agent to use Textbook". Its note keeps "Use the Textbook style...".

**Recommended copy**
- Menu item: "Document style", placed just before "Hide for presenting".
- Panel title: "Document style"; close button labelled "Close".
- The document's own row: "Textbook", with a faint "in the document" after it.
- Previewing: "Previewing Textbook. The document uses International Style."
- Collapsed: "Previewing Textbook" with [Back to the document's style]
- Primary button: "Ask the agent to use Textbook"
- Waiting: "Sent to the agent. Waiting for it to add Textbook to this page."
- Agent declines: the preview stays, and the reply card carries the reason.
- Missing style: "This document asks for `foo`, which is not installed here. Showing International Style."
- Nothing installed: "Add styles with `lahe style add <folder>`, or ask your agent to."
- Style removed: "Textbook is no longer installed. Back to the document's style."

**Motion.** Nothing on the rail currently checks this, so state it outright: no animation on the panel or the restyle, matching the menu and end-review panel. Restore the reading position with instant scrolling, since a page's own smooth scrolling would slide it. document.css only turns smooth scrolling off under reduced motion (its line 786).

**Screenshots (V19), light and dark**, with the page behind the rail visible, not a crop of the rail:
- panel open while previewing
- collapsed line
- waiting
- missing style
- nothing installed
- 40-character name
- keyboard focus on a radio
- overdue banner together with the status line
- a dark-background style previewed on a light page

**Unresolved decisions, and what the builder will do if nobody decides**
- **International Style's palette strip.** The default will be hand-picked hexes. Decide: take them from system-tokens.css.
- **Present mode or a collapsed rail during a preview.** The default is no indicator. Accept that, since the pill should stay quiet.
- **Panel open when the agent's rebuild reloads the page.** The default is closed. Accept: the handled card confirms it.

**What already exists to reuse**
- `.menu` and `.menuitem`, and the openMenu/closeMenu keyboard handling.
- `.endpanel`'s surface, title and neutral buttons.
- `.refusal__btn`'s accent button.
- `.statusline` and `.status__text`'s ellipsis.
- `.hints kbd` for the command.
- The rail's `:focus-visible` ring and colour tokens.
- `rail.refreshScheme`.

**Not in scope**
- Style descriptions in the panel: the name plus the strip is enough to recognise one.
- Side-by-side comparison of styles: flipping between them is the comparison.
- A store link: the brief already settled on none.
- A per-style dark mode for the rail: the page picks light or dark, as today.
