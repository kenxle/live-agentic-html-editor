# Reviews: Free writing architecture

Architecture under review: `02_architecture_free_writing.md`. Brief: `01_brief_free_writing.md`.

## Security Review (Round 1)

**Summary.** The design names the right controls: a block allowlist, `new_blocks` classed as data, and a careful `lahe write`. The gap is that each control is described at one point, and the code paths around that point accept whatever they are handed. Three red flags:

- The allowlist runs only in the browser at capture. The helper stores records as given, and replay writes record markup into the page as given.
- Words placed into a Markdown or template source can turn into live markup or code.
- `lahe write` has a symlink hole and, by where notes files get made, can serve a whole home folder.

Two suggestions, one cut, and one question follow.

Inputs read:

- the architecture and brief
- the repo `CLAUDE.md`
- D6, D7, D11, and D12 in `docs/features/20260812.01_live_agentic_html_editor/02_architecture_live_agentic_html_editor.md`
- `src/shared/review_format.js`, `src/shared/normalize.js` (`cleanMarkup`), and `src/shared/record.js` (`editChangeText`)
- `src/cli/commands/review.js` and `src/cli/commands/add.js`
- `src/service/static_servers.js`, `src/service/markdown.js`, `src/service/log.js`, and `src/service/routes.js`
- `src/layer/replay.js`, `src/layer/editing.js`, and `src/layer/store.js`

`docs/CONTRACTS.md` was not needed beyond the contract text restated in `review_format.js`.

Findings ranked worst first. Type is red flag, suggestion, cut, or question.

### SR1. The block allowlist is enforced only where an attacker does not have to go

- type: red flag
- severity: blocker
- kind: defect
- where:
  - Security & Privacy Notes, "What reaches the agent"
  - Data / State Changes, `new_blocks`
  - Replay after a rebuild: the insert, partial, and formatting branches, and undo's "old tag"
- what: The tag list and `cleanMarkup` run once, in the layer, when a record is captured. Every later step trusts the record:
  - The helper stores it as given. `log.append` checks only the event id and type (`src/service/log.js:436-467`). `projection.js` copies `event.record` wholesale.
  - Replay writes record markup straight into the page with `element.innerHTML = item.after_html` (`src/layer/replay.js:2833`, `:2840`). Undo does the same with `before_html` (`src/layer/editing.js:1804`).
  - The new insert path adds a worse sink: it makes an element from the record's own `tag` field. `anchor_tag_after` and undo's "old tag" do the same.
- why:
  - **Who can forge a record.** Any script holding the review token can post one. D11 says that is any script on any HTML file under the served root, or on a linked document. Any script on the same origin can also write the browser store that the reload path replays from.
  - **The agent side.** Such a record reaches `review.json`, where the contract tells the agent to place `new_blocks` into the source.
  - **The page side.** A record with `tag: "script"` goes through `createElement("script")` and is inserted, and that script runs. `innerHTML` scripts do not run, but created ones do.
  - **The layer's own cleaner is not enough anyway.** `cleanMarkup` is a deny-list, not an allowlist. It keeps `svg`, `math`, `form`, `img` with an https `src`, `a`, and `meta`. So `<svg><a><animate attributeName="href" values="javascript:...">` and a remote tracking `<img>` both pass it.
  - **Today's reach is narrower than it could become.** Nothing in the layer pulls records back from the helper today. `store.mergeWithHelper` (`src/layer/store.js:866`) exists but has no caller, so the live page-side route is same-origin storage. The day that merge is wired, a forged helper record replays on every page of the review.
  - **Bottom line.** The design's sentence "the list stops page markup, or a paste, from carrying attributes or scripts into a record the agent will apply" holds only for records the layer made.
- fix:
  - **One shared function.** Write one function in `src/shared/normalize.js`, for example `cleanBlock(tag, html)`:
    - `tag` must be exactly one of p, h2, h3, h4, ul, or ol, or the block is refused.
    - The html is parsed and rebuilt from an allowlist: strong, em, br, and the two reset tags. `li` is allowed only as a direct child when the tag is ul or ol.
    - Every attribute is dropped, and text is re-escaped on output.
  - **Call it in three places:**
    1. At capture.
    2. In the helper on `events.append`. Refuse the event there rather than cleaning it quietly, so a forgery shows up as a rejected event.
    3. In replay and undo, right before every DOM write. That covers the insert, partial, and formatting paths, `anchor_tag_after`, and the undo tag restore.
  - **One source of truth for the words.** Derive each block's `text` from the cleaned html, instead of trusting a separate `text` field. Otherwise the handled check reads one thing and the agent writes another.
  - **Say it in the doc.** State in the architecture that the allowlist is new code, not `cleanMarkup`.
  - **Tests.** Write unit tests that feed each of these and assert the helper refuses them and replay writes nothing:
    - `tag: "script"` and `tag: "iframe"`
    - the SVG animate href case
    - `<img src="https://...">`
    - `<a href>`
    - `li` inside a `p` block

### SR2. The reviewer's words can become live markup or template code in the source

- type: red flag
- severity: important
- kind: risk
- where:
  - Key Flows, the "writes them after that paragraph in the source" step
  - Components, the contract lines
  - brief R6 (the words stay as typed) and R9 (the contract says how to place new text)
- what: The design hands the agent `text` and `html` and says to place them. It does not say the words must stay words. In a Markdown source, Lahe's renderer lets raw HTML through, and it renders a `javascript:` link as an ordinary external link (`src/service/markdown.js:247-265`).
- why:
  - **Markdown.** Suppose a reviewer writes about HTML ("wrap it in `<script>`") or pastes text from another document. An agent that copies `text` into the `.md` produces live HTML or a clickable `javascript:` link, on a page that carries the review token. It also breaks R6.
  - **Templates.** For an ERB, Jinja, Liquid, or JSX source, `{{ }}`, `{% %}`, and `${}` in the words get evaluated when the page renders. That is code running on the reviewer's dev server, if the text came from a paste or from a forged record (SR1).
  - **Nothing catches it today.** The handled check runs only when nothing was written since the reviewer typed. So an agent that did place the text is never checked, and cannot be caught turning words into markup.
- fix:
  - **Contract line.** Add one line to the contract and every copy of it: "new_blocks words are literal text. Escape them for the source. In Markdown, backslash-escape characters Markdown reads as syntax and write < as &lt;. In a template, write them so the template prints them and never evaluates them."
  - **Always check new blocks.** For `new_blocks`, run the handled check every time and compare each block's visible text on the built page. R6 allows no rewording of new text, so the reason for skipping the check does not apply. Words that turned into markup vanish from the visible text, so this is the one check that can catch it. This changes a standing rule, so it is Ken's call.
  - **Renderer fix.** Separately, and already true before this feature: the Markdown renderer should drop any link scheme other than http, https, mailto, or tel. Reuse `normalize.isSafeUrlValue`. Put it on the board.

### SR3. `lahe write` can follow a symlink, in both of its branches

- type: red flag
- severity: important
- kind: defect
- where:
  - Security & Privacy Notes, `lahe write` bullets
  - Empty page flow, the "file exists? yes, use it as is" branch
- what: The design checks whether the file exists, then creates it. It lists "refuses a symlink" only among the creation rules. It then says the file follows "the same path rules as `lahe review`", and those rules follow symlinks: the renderer resolves the real path.
- why:
  - **A dangling symlink looks like a missing file.** `fs.existsSync` reports false for one. A plain write then follows the link and creates the file wherever it points.
  - **The existing-file branch is worse.** It serves an existing `notes.md` that is a symlink to any file, and then the agent is asked to write the reviewer's notes into it. A cloned repo can ship `notes/today.md -> ~/.zshrc`. The `.md` check reads the link's name, not its target.
  - **There is a race.** A check followed by a create has a gap between the two steps.
- fix:
  - Check the final path without following links (`lstat`) before either branch. Refuse a symlink whether or not its target exists.
  - Create the file with an exclusive create (`fs.openSync(p, "wx")`). That fails if anything is already there, including a dangling link. On "already exists", check again without following links.
  - Resolve and print the parent folder's real path.
  - Tests:
    - a dangling symlink is refused, and nothing is created at its target
    - a symlink to an existing `.md` is refused
    - a symlink to a non-Markdown file is refused

### SR4. A notes file in a broad folder serves that whole folder

- type: red flag
- severity: important
- kind: risk
- where: Empty page and `lahe write`; the Security note "serving it is no looser than serving any Markdown file"
- what:
  - **What gets served.** A Markdown review mounts the file's own folder (`src/service/markdown.js:358`, the asset root). It serves every file under it, however deep, that is not hidden.
  - **Where notes files get made.** A notes file is exactly the kind of file people make in `~`, `~/Desktop`, or `~/Documents`.
  - **No Host check.** The static server reads no request header at all (`src/service/static_servers.js:992-1133`). The helper has the Host check D11 requires; the static server does not.
- why:
  - `lahe write ~/notes.md` puts all of `~/Documents` and `~/Downloads` on a loopback port for the life of the session. It also exposes `~/Library`, which is not dot-prefixed and holds keychains, messages, and browser profiles.
  - A website using DNS rebinding can read those files. The port is random, but it falls in a known range.
  - The design's sentence is true for a Markdown file someone already had. The new command changes where Markdown files get made, so the claim does not cover the new case.
- fix:
  - **Mount nothing extra.** A page `lahe write` created should mount no asset folder and run as `--only`. A notes page has no images (they are a non-goal), so it loses nothing.
  - **If a mount is kept,** refuse a parent folder that is the home folder, a filesystem root, or `~/Desktop`, `~/Documents`, or `~/Downloads`, unless the reviewer passes an explicit flag.
  - **Host check.** Add the helper's Host check to the static server. The gap predates this feature; put it on the board.

### SR5. The intent field must not quote the run, and a split moves page text into the run

- type: suggestion
- severity: important
- kind: risk
- where:
  - Components, `src/shared/record.js` "the change text"
  - Block types while writing, "Enter in the middle splits the block into two siblings"
- what:
  - **Today's change text.** `editChangeText` (`src/shared/record.js:1373`) quotes the added words into `change`. `change` is an intent field: carried word for word, never bounded, and classed as instruction (`review_format.js:140`).
  - **The gap.** The design classes `new_blocks` as data, but does not say what `change` will say for a run.
  - **Page text in the run.** A split moves the tail of an existing page block into a new sibling. So a run's first block can be the page's own words.
  - **Pasted text.** Paste is native (`editing.js:211` is `contenteditable="true"` with no paste handler). A paste can carry text that was hidden on its source page.
- why:
  - If `change` says `Added "..."` for a run, page text and pasted text ride into the instruction channel. That is the exact failure D12 was written to stop.
  - A split tail recorded as a new block also asks the agent to add words the source already has.
- fix:
  - **Structure only.** For a run, `change` gives structure and nothing else. For example: "Added 3 blocks after this paragraph: h2, p, ul. Their words are in new_blocks; place them as written."
  - **Mark a split tail as moved.** Record it as moved text (for example a `from_anchor: true` flag on that block), never as added words.
  - **Tests:**
    - the change text for a run contains none of the run's words
    - a split with no typing produces no "Added" sentence

### SR6. `new_blocks` "not capped" needs a ceiling

- type: suggestion
- severity: minor
- kind: risk
- where: Data / State Changes, Projection; Failure Modes, "A long sitting"
- what:
  - **No cap anywhere but the request limit.** The projection has no bound. The helper accepts up to its body limit per request (`src/service/index.js:57`).
  - **Drafts repeat the whole run.** Drafts flow to the helper (`src/layer/sync.js:1603`), and each draft carries the whole run.
- why:
  - One forged or runaway record puts megabytes into `review.json` and the drain output, which every agent reads into its context.
  - Posting the whole run on every draft makes `events.jsonl` grow with the square of the post's length.
- fix:
  - Set a per-record ceiling far above any real post, as a number the plan picks. Enforce it at the helper, and show the visible bound marker D12 already defines.
  - Post drafts on a short delay, or post only the block that changed.

### SR7. Cut the sentence "the page they write into is their own"

- type: cut
- severity: minor
- kind: challenge
- where: Security & Privacy Notes, first bullet
- what: The sentence is used to wave off what the reviewer can type.
- why: D11 and D12 both treat reviewing a document someone else sent as a supported case. In that case the page is not the reviewer's own, and it may carry script.
- fix: Delete the sentence. SR1 is the real answer.

### SR8. If Tiptap becomes the fallback, it needs its own security pass

- type: question
- severity: minor
- kind: risk
- where: Alternatives Considered, "What would change this"
- what: Taking Tiptap as the fallback for the run would bring these onto every reviewed page:
  - its own paste parser
  - a style tag
  - its own schema
- why: None of these are covered by this review, and the fallback would be decided mid-plan.
- fix: If the editing-host task picks Tiptap, send the choice back for a security look before building on it. It would need to confirm that paste output goes through `cleanBlock` (SR1) like everything else.

## Architect Review (Round 1)

**Summary.** The overall shape is right: one sitting is one edit record, with an anchor block plus a run of new sibling blocks, and Lahe's own code stays the engine. Three things need fixing before a plan:

- **The record model breaks the code it says it keeps.** `after` stays the whole sitting while `after_html` becomes the anchor only. Replay, the page check, and old agents all assume the two describe the same text. With the fields split, replay writes the whole sitting into the anchor block. That is the doubled text this feature exists to remove.
- **The duplicate-text rules for the new insert path are not written down yet.** Lahe's own Markdown render adds a "Section N" label and a header wrapper. The design does not account for either, and both break the header case in several places.
- **The Tiptap question goes to Ken before the evidence that decides it exists.** Nobody has tested whether a Lahe editing surface can span several blocks. On Tiptap, the write-up overstates two costs and leaves out a benefit Ken asked about. The recommendation may still be right, but the question as written is not a fair basis for his call.

Inputs read:

- the architecture, the brief (Decisions included), the crucible, and the security review above
- the repo `CLAUDE.md`, `docs/diagrams/` (README, item_lifecycle, replay_branches, protected_region, finding_the_region, merge_on_load, module_map), and `docs/CONTRACTS.md`
- `docs/features/20260922.08_no_duplicate_text/NOTES.md`
- code: `src/layer/editing.js`, `replay.js`, `protect.js`, `anchor.js`, `index.js`, `sync.js`; `src/shared/record.js`, `normalize.js`, `review_format.js`, `merge.js`; `src/service/handled_check.js`, `markdown.js`; `vendor/stclair-doc-style/document.css`
- the Tiptap spike: `results_browser.json`, `results_browser_extra.json`, `results_sizes.txt`, and both run scripts

`docs/ongoing/ARCHITECTURE.md` does not exist in this repo. The binding decisions live in the original feature's architecture (D1 to D12), and the diagrams cover the flows this feature touches.

Findings ranked worst first. Type is red flag, suggestion, cut, or question.

### AR1. Splitting what `after` and `after_html` mean brings back the doubled text

- type: red flag
- severity: blocker
- kind: defect
- where: Data / State Changes, the `before`, `after`, `after_html` bullet (line 76); Replay after a rebuild, "anchor compare: today's four branches, on the anchor only"
- what: The design keeps `after` as the whole sitting and narrows `after_html` to the anchor's own markup. Much of today's code assumes the two describe the same text.
- why:
  - **Replay writes.** `markupSaysAfter` (`src/layer/replay.js:1171`) uses `after_html` only when its text equals `after`. After this change it never does for a run. So `writeRegion` falls back to `writeTextWithBreaks(element, item.after)` (`replay.js:2843`), which writes the whole sitting, headers and all, into the anchor block. The agent's placed blocks still stand below it. That is the doubled text again, for every run whose anchor compare lands on "re-apply".
  - **Replay's other checks.** "Today's four branches on the anchor only" has no anchor-only text to compare against. `compare`, `reflowMatch`, `splitPieces`, `wouldDuplicate`, `splitWritePlan`, and `mayFold` all read `after`. The record has no field that holds the anchor's own new text.
  - **The formatting checks go dark.** `formattingLost` and `formattingMissingFromPage` both require `markupSaysAfter` first (`replay.js:1125`, `:1426`). So bold lost from an anchor goes unnoticed, and that is part of the R14 promise (bold and italic survive the rebuild).
  - **Old agents lose the run.** The contract says "Apply after_html, not after alone" (`src/shared/review_format.js:108`). An agent that has not re-read the contract applies the anchor and drops every new block. It also says "Read this contract once" (`review_format.js:90`), so long-running agents will not pick up a new rule. The design keeps `after` whole "so old readers still work", then breaks the one field old readers are told to use.
- fix:
  - Keep the rule that `after` and `after_html` describe the same content. Pick one of these and write it down:
    - **(a)** Both describe the whole sitting. `after_html` carries the run's block tags, so an old agent applying it gets the headers too. Add one anchor-only field, for example `anchor_after_html`, for replay's anchor compare.
    - **(b)** Both describe the anchor only. Put the whole-sitting text only in `new_blocks`, and accept that an old agent sees just the anchor.
    - (a) is kinder to old agents; (b) is simpler for replay.
  - In the architecture, list every reader of `after` and `after_html` and say what each does for a record that has `new_blocks`. Today's readers are in `replay.js`, `record.js`, `handled_check.js`, `merge.js`, `tab_edits.js`, `tab_done.js`, `export.js`, and the text formatter in `review_format.js`.
  - Test: a Markdown run with a header, placed by the agent, then a repaint. The anchor must not come back holding the run's words.

### AR2. The browser's page check will reopen every placed header as "undone" on Lahe Markdown pages

- type: red flag
- severity: blocker
- kind: defect
- where: not in the architecture. Code: `pageCheckReasonFor`, `src/layer/replay.js:1283`
- what: After an item is handled, the browser checks it. If the whole `after` text (normalized) is not in the page text but `before` is, it reopens the item with "This change was undone on the page."
- why:
  - Lahe's Markdown render puts each `##` header in `<div class="sheet-head"><h2>...</h2><span class="n">Section N</span></div>` (`src/service/markdown.js:305`). The page text reads "...What the chat window cost me Section 3 I lost my place...". The record's `after` reads "...What the chat window cost me I lost my place...".
  - The containment test misses. The anchor's `before` is still on the page because the anchor did not change. So the check says "reverted" and reopens a correct, handled item. The agent is asked to redo work it already did.
  - This hits every run with a header on the main page type (Ken's posts and notes are Markdown). The components list does not name this check, and the test list does not cover it.
  - The same function's formatting half reads only `after_html`. Under this design that is the anchor alone, so bold lost from a new block is never caught.
- fix:
  - Add the page check to Components. For a record with `new_blocks`, check the anchor and each new block on its own, using the same per-block reader replay uses, never one long string.
  - Test: a handled run with an h2 on a `lahe review post.md` page is not reopened. A handled run whose paragraph lost its bold is reopened with the formatting note.

### AR3. The insert path's "already there?" rule is not defined well enough to promise no doubled text

- type: red flag
- severity: blocker
- kind: risk
- where: Replay after a rebuild (lines 154 to 169); Failure Modes, "The agent places the run elsewhere, or rewords it"
- what: The flow sorts runs into "all match", "none present", "some present", and "lost bold". It never says what "present" means, where a missing block goes, or what happens when the anchor itself is in conflict.
- why: Each gap is a path to doubled or lost words:
  - **Tag.** Suppose the agent placed the header's words as a paragraph. If "present" requires a matching tag, replay inserts an h2 and the words stand twice. If it does not, the reviewer's header quietly stays a paragraph, and the formatting branch only rewrites inner markup, never the tag.
  - **Merged or split blocks.** Today's `blocksSpell` lets one page block hold several pieces. The design compares block to block. An agent that joins two short paragraphs, or a Markdown soft wrap, reads as "missing", and replay inserts it again.
  - **Whole-page search.** "Looks for their text anywhere on the page" is too loose for a list item "Yes" or a header "Notes", which exist elsewhere for other reasons. Then the block is silently never put back. As a substring match it is looser still.
  - **Insert point.** "Insert only the missing blocks" does not say where. If the block before the gap is a placed h2, "after it" is inside the `sheet-head` flex row (see AR4).
  - **Anchor in conflict.** The flowchart runs the run check after the anchor compare in every case. If the anchor lands in branch four (flag and write nothing), inserting the run under a page the reviewer has not yet ruled on is a write the conflict card never offered.
  - **Earlier revisions.** Branch three ("an earlier revision's after landed") has no run version. `after_history` entries carry `after` and `after_html` only.
- fix: Write the rule as a short table in the architecture, and add a unit test for each row:
  - **When a block counts as present.** A block is present when its words (with typography folded) are found in a leaf block, or in a run of leaf blocks, starting from the anchor in document order. Tag and markup never decide presence.
  - **Present with the wrong tag or lost bold.** Rewrite the markup in place; flag a wrong tag on the card. Never insert.
  - **Words found somewhere else.** Search by whole leaf block, not by substring. When the words are found elsewhere, flag it on the card instead of skipping silently.
  - **Anchor in branch four.** Insert nothing until the conflict is answered.
  - **Earlier revisions.** Store `new_blocks` in `after_history`.

### AR4. On Lahe's own Markdown pages, a header's "next sibling" is inside a flex row

- type: red flag
- severity: important
- kind: defect
- where: Block types while writing, "Enter at the end of a block makes a new p after it"; Key Flows, the insert steps; brief R4 (new blocks use the page's own styling) and R14 (the doubled line after a header)
- what: The render wraps every `##` header and its section number in `div.sheet-head`, a flex row with `justify-content: space-between` (`document.css:165`). A `p` inserted "after the h2" lands inside that row, beside "Section N".
- why:
  - This is the exact R14 case (open a header, press Enter, type a line). Under the new design it no longer doubles, but it lays out as a flex item next to the section number, with the head's border and spacing. That breaks R4 while writing.
  - The same thing happens to replay's inserts after a placed h2, and to "insert the missing blocks".
  - A new h2 typed mid-section shows up as a bare h2, with no hanging rule or number. After the rebuild it becomes a full section, and every later section number shifts by one. So while writing it does not look like the page's own headers either.
- fix:
  - Define "after the anchor" as a DOM rule: climb from the anchor while its parent holds only the anchor plus inline chrome (the `sheet-head` case), then insert after that parent.
  - For a new h2 while writing, either say the look stops short of a full section until the rebuild, or have the layer draw a temporary `sheet-head`. Ken should see that choice on the wireframe, since R4 is his wording.
  - Test on a real `lahe review post.md` page: Enter at the end of a header, type, and screenshot it while writing and after the rebuild.

### AR5. Merge on load drops the new fields

- type: red flag
- severity: important
- kind: defect
- where: not in Components. Code: `CONTENT_FIELDS`, `src/shared/merge.js:47`
- what: The browser wins on content only for the fields named in `CONTENT_FIELDS`. `new_blocks`, `anchor_tag_after`, and `placement` are not in it.
- why:
  - Take a same-revision merge while the helper has not acknowledged the latest typing, which is the normal state mid-sitting, since drafts back up at most every 10 seconds. The merge takes `after` from the browser and `new_blocks` from the helper's older copy.
  - After a reload the record says one thing in `after` and another in the run. Replay then inserts a run that is missing its last blocks. That breaks R5 (writing survives a reload) and R7 (a reload does not hide what they wrote).
- fix: Add the three fields to `CONTENT_FIELDS`. Add `merge.js` to Components. Add a unit test in which the browser has a longer run than the store at the same revision, and the merged item keeps the browser's run.

### AR6. The editing host is the core design, and it is deferred to the plan

- type: red flag
- severity: important
- kind: risk
- where: The editing host (lines 112 to 120); AQ2; Alternatives, "What would change this"
- what: Protection, capture, undo, and styling all depend on which host wins. The design leaves that to the plan's first task, and makes it the thing that would flip AQ1 back to Tiptap.
- why:
  - **AQ1 comes too early.** Ken is asked to decide AQ1 (Tiptap or Lahe's own code) before the one result that would change the answer exists.
  - **Candidates 1 and 2 change CSS matching.** `display: contents` removes the box, not the element. Child, sibling, and `:last-child` selectors still see the wrapper. `document.css:86` has `p:last-child{margin-bottom:0}`, so every anchor or run block that becomes last in the wrapper loses its bottom margin. That is Ken's crucible complaint about inconsistent spacing, made by the tool.
  - **Candidates 1 and 2 also look foreign to a morph.** A page that morphs (Turbo, a dev server) sees an unknown wrapper where the anchor used to be a direct child. It removes the wrapper and the anchor with it on every repaint. Layer one (skip attributes) and layer two (the pre-morph veto in `protect.js`) are keyed to one element, and the design does not say how either one covers blocks the page has never seen.
  - **No candidate handles the risky inputs.** "One engine: every change is written by the layer" covers Enter and block types. Today `onBeforeInput` hands every other input type to the browser (`editing.js:860`). In a host that spans blocks, the browser's own handling of these differs across engines (Chromium adds inline style spans when it merges blocks with different styles):
    - a Backspace or Delete across a block edge
    - typing over a selection that spans two blocks
    - cut, drag, and drop
    - paste
  - **The edges of the session.** Nothing says what stops a Backspace at the start of the anchor, or a Delete at the end of the last run block. Either one would merge a page block that is not in the session.
- fix:
  - Run the host spike now, before AQ1 goes to Ken, in all three browsers. It is small next to what hangs on it.
  - Add a fourth candidate: `contenteditable` on the anchor's parent, with the layer's `beforeinput` refusing any change outside the session's blocks. There is no wrapper, so selectors and morphs see the page's own tree.
  - List the input types the layer takes over, with each one's behavior. Say how protection's first two layers apply to run blocks, or say plainly that only layer three covers them.

### AR7. The handled check's new tag test cannot fire in the case it is written for

- type: red flag
- severity: important
- kind: defect
- where: Components, `src/service/handled_check.js` "checks the words, their order, and their block tags"; Test Strategy, "a header placed as a paragraph fails"; sequence diagram, "handled check: words present, in order, tags match"
- what: The helper's check only judges an item when nothing the review is built from was written since the reviewer committed (`handled_check.js:309`). An agent that placed a header as a paragraph wrote the source, so the check returns "not ours to grade" before it reads a single tag.
- why:
  - The planned test either fails, or passes only because it does not reproduce a real agent write.
  - R10 (a handled reply for new text is checked the way a hand edit is) is already met by today's check. The record's `after` carries every word of the sitting.
  - The security review (SR2) reaches the same gate from the other side. It proposes always checking new blocks, which is a change to a standing rule and is Ken's call.
- fix: Choose one and write it in the design:
  - **Keep the gate.** Drop the tag half from the helper, and put tag and per-block checks in the browser's page check (AR2), which already grades work after a write.
  - **Or change the gate for `new_blocks`.** Put that to Ken together with SR2's version.

### AR8. The reload row describes mechanisms that do not exist

- type: red flag
- severity: important
- kind: defect
- where: Failure Modes, "Reload mid-sitting" (line 191); the R7 mapping on the repaint row (line 190)
- what: The row says "Replay inserts the run after the anchor. The draft stays a draft." None of that happens today.
- why:
  - Replay skips drafts. It acts only on ready and not_handled records (`replay.js:2523`).
  - Leaving or reloading the page commits the open edit (`sync.js:2547`, `commitOnUnload`). So a reload makes the sitting ready and shows it to the agent, and the session does not reopen.
  - A Lahe rebuild reload already waits while an edit is open (`index.js:655`, `isBusy`). That existing behavior is what really covers R7 (a reload does not move the cursor) for Markdown reviews, and the design does not mention it.
  - Only a crash leaves a draft, and the next page commits it.
  - "Cmd-Shift-E on any block of the run reopens the same session" needs a way to map a replay-inserted block back to its record. That mapping is not in the editing components.
- fix:
  - Rewrite the row from today's real flow: the reload deferral, the commit on unload, and replay of the ready record.
  - Name the mapping from a run block back to its record in the editing components.
  - Decide whether R5's "still there to keep writing" means reopening the session after a reload, and if it does, where the caret goes.

### AR9. The Tiptap rejection reaches a defensible answer by an uneven comparison

- type: suggestion
- severity: important
- kind: challenge
- where: Summary, paragraph 3; Alternatives Considered, first two bullets; AQ1
- what: On the evidence, the deciding argument holds. The rest of the case against Tiptap is overstated in two places and leaves out one benefit.
- why:
  - **What holds.**
    - Tiptap cannot safely edit existing blocks. The spike shows spans, SVG, and classes stripped, and 2 of 5 blocks exact even with the attribute extension.
    - Ken decided one sitting is one edit and that old and new text must look the same. Together those mean Tiptap on the run alone puts a second editor inside one sitting.
    - Lists come out as `<li><p>`, and `lahe-markdown.css:105` gives `li > p` its own margin. So Tiptap lists would space differently from the page's lists. The design does not mention this, and it supports the rejection.
  - **Overstated: protection.** "When its parent is replaced it fails silently, which breaks protection." In the same spike, putting the editor's own node back (`replaceChildren(ed.view.dom)`) reconnected it, and typing after that reached the editor's state. The run's node belongs to the layer, so holding a reference to it is safe. That is a different restore path, not a broken one.
  - **Overstated: styling.** The injected style tag can be turned off with an editor option.
  - **Overstated: size.** 104 KB gzipped is accurate against the unminified layer as shipped. But the file comes from a local server, and it could load only when a sitting opens. It does not have to cost every page.
  - **Understated: the claim.** "Styling matched in all three browsers" was measured for p, strong, and ul spacing in Chromium only. Firefox and WebKit measured one h2 font size.
  - **Omitted: rich paste.** Ken's decision says to keep rich paste if Tiptap brings it for free. The spike shows it does: b, span-bold, and i become strong and em, and headers survive. AQ1's "what Tiptap would have given for free" lists only undo and shortcuts.
  - **Understated: undo is not small.** Undo that puts the caret back, groups typing into bursts, handles redo, and plays well with IME input is the bulk of what an editor library is for.
  - **Neither side of the deciding question was measured.** Nobody spiked the seam (Lahe's anchor next to a Tiptap run), or Lahe's own multi-block host.
- fix:
  - Keep the recommendation, and rewrite AQ1 so it is fair:
    - add rich paste and the list spacing
    - correct the protection and size claims
    - say that undo is real work
  - Put AQ1 to Ken after the host spike from AR6, and include the seam in that spike. If Lahe's host fails, the fallback is already set up.

### AR10. The brief's rollout question and old records have no home

- type: suggestion
- severity: important
- kind: defect
- where: brief, Rollout / Flags ("An agent on an older copy of the skill either can still act on new text or is told to update. The architecture decides which."); architecture, nowhere
- what: The design does not decide the brief's rollout question. It also does not say what happens to records made before this change.
- why:
  - **Old agents.** An agent already on a review when the new layer lands reads the contract once and keeps the old rules (see AR1).
  - **Old records.** Existing reviews hold multi-paragraph edits whose `after_html` has nested blocks. After this change, Enter stops nesting, so those records are the only ones left on today's split path. If that path is refactored with the insert path, legacy records regress.
  - **Reopened old records.** When a reviewer reopens one, the new host finds nested blocks inside the anchor, and the capture model does not expect them.
- fix:
  - State the rollout answer. For example: AR1 option (a) lets old agents still act, and a bump to `SERVICE_CONTRACT` tells the rest to update.
  - Say that records without `new_blocks` keep today's replay path unchanged, with the existing `no_duplicate_text` and `split_not_conflict` specs as the guard.
  - Say what reopening a legacy nested record does.

### AR11. Turning the anchor into a header is under-specified

- type: suggestion
- severity: important
- kind: defect
- where: Data / State Changes, `anchor_tag_after`; brief R3 (make headers while editing existing text)
- what: The field exists, but no part of the pipeline knows how to treat a tag-only change.
- why: "Make this paragraph a header" is one of Ken's crucible pains. It touches every stage:
  - **Deciding the kind.** `kindFor` (`editing.js:439`) compares text and inner markup. A tag-only change is equal on both, so it reads as "no change" and never commits.
  - **Replay.** The four-branch compare has no tag test. A repaint that brings back the `p` reads as applied.
  - **Writing.** Changing a tag means replacing the page's element. That touches its attributes, its `data-lahe-id` stamp, and any framework reference to it. Undo's "old tag" does the same in reverse.
  - **Finding it again.** The finding ladder's tag tie-breaker and its "climb back to the saved tag" rule both prefer the old `p`.
- fix: Say which record kind a tag-only change is. Add a tag leg to the anchor compare. Define element replacement once, carrying attributes and the stamp across. Say whether the ladder uses `anchor_tag_after` for the tag tie-breaker once the item is handled.

### AR12. Adding an item to an existing list has no shape

- type: suggestion
- severity: important
- kind: defect
- where: Block types while writing; the `new_blocks` tag list (line 73); brief R3 (lists while editing existing text)
- what: `new_blocks` allows p, h2 to h4, ul, and ol, but not li. "Enter at the end of a block makes a new p after it" has no case for an anchor inside a page's own list.
- why: Adding a bullet to a list the agent wrote is one of the most common edits. As designed, Enter in an existing li either makes a `p` inside a `ul`, which is invalid HTML, or starts a new list after the item.
- fix: Say what the anchor is when the caret is in a list item. The simplest option is the whole list, so a new item is a change to the anchor's own markup. Add a browser test: Enter at the end of an existing bullet, type, commit, rebuild.

### AR13. "Two sittings after the same anchor" is undecided, and it is the notes job's main path

- type: suggestion
- severity: important
- kind: risk
- where: Failure Modes, last row (line 197)
- what: The row gives two answers joined by "or": the second anchor is the last block of the first run, or it is the same anchor with the second run placed after the first.
- why:
  - On a notes page, every sitting after the first is this case. Before the agent places the first run, the "last block" is a block that replay inserted, so record two depends on record one.
  - That needs a replay order, which the design does not have.
  - If the reviewer undoes record one, record two's anchor disappears and record two goes lost.
  - The same-anchor answer needs replay to skip other records' runs, which is not in the flow.
- fix: Pick one answer. Then spell out what follows from it: replay processes records in order of creation, and an undo that would orphan a later run either re-anchors that run or warns the reviewer. Add a browser test with three sittings on an empty notes page before the agent places any of them.

### AR14. Paste has no design, and the brief asked for its cost

- type: suggestion
- severity: minor
- kind: defect
- where: brief Decisions, "Pasting with its formatting... the architecture notes what it would cost"; architecture, only a mention in Security
- what: Today paste is the browser's default: the edited block is plain `contenteditable` with no paste handler. In a host that spans blocks, a pasted page drops its own h1, table, div, and styled spans onto the page.
- why: That breaks R4 (styling) during writing. Capture then has to guess how to map foreign blocks onto six tags. The security review (SR5) covers the words that ride along. The layout side and the cost note are this doc's job.
- fix: Take over `insertFromPaste`: insert plain text, and treat a blank line as a new paragraph. Add two sentences on what rich paste would cost in Lahe's engine, for the `LAHE-rich-paste` row.

### AR15. Proofreading has no home

- type: suggestion
- severity: minor
- kind: defect
- where: brief R11 (after a long hand-written block lands, the agent offers proofreading on the card and leaves the words alone); architecture, nowhere
- what: The architecture never mentions proofreading. The contract is where that behavior lives, and the threshold needs a place to live.
- fix: Add the contract line to Components. Say where the threshold constant sits (for example, `review_format.js` next to the other named limits) and which field the agent measures: the run's word count, not `after`.

### AR16. The Markdown notes anchor is a title that is not in the source

- type: suggestion
- severity: minor
- kind: risk
- where: Empty page and `lahe write`, "the anchor is that hero title"; brief R13 (the agent writes the notes file)
- what: For a file with no `#` heading, the render's title is `path.basename(source)` (`markdown.js:148`). So the anchor text is "2026-09-28.md", which appears nowhere in the file.
- why: An agent told to place blocks "after the anchor" searches the source for that text and finds nothing. It may also write a `#` title, which renames the anchor and changes the page title.
- fix: One contract line: "When the anchor is the page title of a Markdown file with no # heading, place the blocks at the top of the file." Add a test on a `lahe write` page.

### AR17. "Next content block" matches wrappers

- type: suggestion
- severity: minor
- kind: defect
- where: Replay after a rebuild, the definition under the flowchart (line 169)
- what: "Next element whose tag is in the normalizer's block list" includes `div` and `section` (`normalize.js:570`).
- why: After the anchor, the walk meets `section.sheet` first. Its text is the whole section, section label included, so it never matches a single new block. There is also a second "allowed block tags" list planned for `normalize.js`, which makes it unclear which list the rule means.
- fix: Define the walk over leaf blocks (block elements with no block children, where li counts as a leaf of its list). Name which list it uses.

### AR18. A Markdown shortcut should be its own undo step

- type: suggestion
- severity: minor
- kind: risk
- where: Block types while writing, shortcuts; Undo inside a session; brief R6 (the words stay as typed)
- what: Typing "1. " or "- " at the start of a line turns it into a list and deletes those characters.
- why: A reviewer who meant the literal characters needs one Cmd-Z to get them back, the way other editors do. Otherwise the tool has rewritten their words.
- fix: Record the conversion as its own history step, and test that Cmd-Z right after it restores the typed characters.

### AR19. The third R14 case has no analysis

- type: question
- severity: minor
- kind: defect
- where: brief R14, third case ("bold two words in a Markdown page, commit, rebuild"); Analysis of Existing Structure
- what: The design explains the root cause of the other two R14 cases. It says nothing about this one, which was the crucible's own assignment.
- fix: Say whether it passes today, and name the spec that proves it (`italic_sticks.spec.js` looks like the candidate). Or name its cause.

### AR20. Who runs `lahe write`, and which agent session owns the review?

- type: question
- severity: minor
- kind: risk
- where: Empty page and `lahe write`; brief R12 (a reviewer starts a blank document from the command line)
- what: `lahe review` starts or joins an agent session and prints the wake commands for the agent. If Ken runs `lahe write` in a terminal, a session is created with no agent listening.
- why: Ken decided notes with no agent attached are not a design case. So the design has to say how an agent gets attached.
- fix: Either the agent runs it (Ken asks his agent for a notes page), or `lahe write` takes `--session` and the printed output tells Ken what to paste to his agent. A `--create` flag on `lahe review` would get all of review's options for free. That is worth one line in Alternatives.

### AR21. Cut `placement` and the empty-container anchor rule

- type: cut
- severity: minor
- kind: taste
- where: Data / State Changes, `placement`; Empty page, "For an HTML page with no blocks at all"; Components, `anchor.js`
- what: `start_of_container` exists only for a hand-made HTML page with no blocks. `lahe write` makes Markdown, and every Markdown render has a hero title to anchor on.
- why:
  - It is a new rung in the finding ladder, and a bare `<main>` has an empty signature (`anchor.js:491`), so it would fail anyway.
  - With it gone, `placement` has one value and carries nothing.
  - R1's empty-page case (writing on an empty page) is already met by `lahe write` together with the hero title.
- fix: Drop both, and say in one line that an empty hand-made HTML page is out of this cut.

## Requirement coverage

| Requirement | Home in the architecture | Status |
|---|---|---|
| R1, write where no text exists (after a block, end of page, empty page) | click in empty space; `lahe write` | Covered. The empty-container rule can go (AR21) |
| R2, feels like today's edit | same gesture, frame, bar | Covered |
| R3, paragraphs, headers, lists, in new and existing text | shortcuts; `anchor_tag_after` | Partial: tag-only changes (AR11), existing lists (AR12) |
| R4, new blocks use the page's styling while writing | host candidates; siblings | At risk: wrapper selectors (AR6), `sheet-head` (AR4), paste (AR14) |
| R5, saved as typed; survives reload and repaint | drafts; protection | Reload row is wrong (AR8); merge drops the run (AR5) |
| R6, words stay as typed | `after` uncapped; `new_blocks` uncapped | Covered, apart from the shortcut undo (AR18) |
| R7, a reload does not move the cursor, hide text, or double it | repaint row | Covered in fact by the reload deferral, which the doc does not name (AR8); doubling (AR1, AR3) |
| R8, agent tells new blocks from changes, with place, type, and bold | `new_blocks` | Covered once AR1 is settled |
| R9, contract and skill say how to place new text | "contract gains rules" | Rules not drafted; old agents undecided (AR10); Markdown title case (AR16) |
| R10, handled checked against the built page | handled check | Already met by today's check; the new tag half cannot fire (AR7) |
| R11, proofreading suggestions on long blocks | none | Orphan (AR15) |
| R12, blank document from the command line | `lahe write` | Session ownership open (AR20) |
| R13, notes land in a file the reviewer named | agent writes it | Covered, apart from AR16 |
| R14, bold and italic edits survive (three named cases) | root-cause section | Lone paragraph: fixed for new records only (AR10). Header: new layout defect (AR4). Bold two words: no analysis (AR19) |
| R15, undo removes new text and asks the agent to take it out | undo bullet | Covered |

## Cleanup needed

None. This review changed no files other than this one.
