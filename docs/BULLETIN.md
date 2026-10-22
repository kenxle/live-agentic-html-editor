# lahe board

Internal task board for this repo. Append-only, newest first; see rows for
status: `[ ]` open, `[>]` claimed, `[x]` done, `[!]` blocked.

## Board

- [ ] @anyone 2026-10-22 LAHE-reveal-deck-drag-flake -- **`test/browser/reveal_deck.spec.js:446` ("an upward drag across two lines of a slide does not flip") failed once in a full Chromium run with "no pill while the button is held".** That run overlapped a read-only review agent on the same machine. Alone it passed 5 of 5 (`--repeat-each=5`). The change under test (print CSS) does not reach the deck. Watch for it again; if it repeats, the pill's mid-drag check is reading a pointer state that lags under load.
- [ ] @anyone 2026-10-22 LAHE-print-plain-long-cell -- **A long URL or path written as plain text (not inline code) in a table cell still makes the table wider than a printed page.** LAHE-style-print-wide-tables lets only code in a cell break anywhere in print, so header and prose words never split mid-word. A bare URL has no code to break. Options: a print rule for `td a` (a link's text is usually its URL), or leave it, since Markdown writers mostly put paths in code.
- [ ] @anyone 2026-10-21 LAHE-keeper-handoff-followup -- **Support a page keeper that hands work off, and a follow-up reply when that work is done.** Ken tried this on the Roku TV review: a cheap Sonnet subagent runs the monitor loop and makes page edits, and passes anything outside the page (code, the TV, other repos) to the main agent with SendMessage, then keeps watching. Ken likes the pattern. Two gaps: (1) the keeper's reply on a handed-off card should read like "Working on it" and leave the card visibly in progress, not look finished; (2) Lahe expects one reply per comment, so when the main agent finishes it has no clean way to come back to that same thread and say "Done: here's what changed". Add an in-progress reply status plus a follow-up reply on the same rev, and write the keeper pattern into the skill (brief template, handoff by message, follow-up when the work lands). Example brief: personal repo `projects/smart_tv/page_keeper_brief.md`. Also from the same session: Sonnet keepers read notes too literally, so the template needs an "act on what Ken means" section; Ken hates saying things twice.
- [ ] @anyone 2026-10-19 LAHE-firefox-library-nav-hang -- **In Firefox, navigating to a `*.lahe.localhost` page sometimes hangs until the 90-second test timeout under the full three-browser run.** Seen once in four `gate:all` runs on 2026-10-19: `catalog_page.spec.js:182` (Open lands on the helper's URL) and `library_stable_address.spec.js:104` (the Library at library.lahe.localhost), about 40 tests apart, both waiting on `page.goto` until `load`. Both pass alone 3 of 3, and the next full run had no failures. `catalog_page:182` was already seen as a Firefox flake in `LAHE-stable-addresses-three-browser-followup`. Under the passing-checks rule this will block a ship whenever it recurs: find what the page waits on before `load` (a long poll, a font, a script) and why Firefox can stall there.
- [x] @claude 2026-10-19 LAHE-pandoc-link-safety-tests -- **Done 2026-10-22: the link render test runs once per engine and checks every href as a browser would resolve it. See [the spec](features/20261022.01_test_run_deadlines/04_progress_test_run_deadlines.md).** Was: **No unit test checks link safety on the pandoc path, which is the one Ken's pages use.** `npm run test:unit` forces `LAHE_MARKDOWN_ENGINE=marked`. Run with pandoc 3.9 installed, `markdown_links.test.js` "a refused link renders as plain text in every Markdown link form" fails: pandoc turns the tab in `[angle](<java<tab>script:alert(3)>)` into spaces, so the link is classified as a relative file path and written as `/.lahe-source/<hash>/java    script:alert(3)`. That is a same-site path, not a script link, and every real `javascript:` form is still blocked. But the assertion fails, and nothing runs these checks through pandoc. Run the link-safety tests once per engine, and assert the pandoc case on what a browser would do with the href.
- [x] @claude 2026-10-19 LAHE-active-filter-webkit -- **Done in [PR #85 (five browser tests that failed every time)](https://github.com/kenxle/live-agentic-html-editor/pull/85): the second press on the Active filter button was dropped in WebKit, a real Safari bug.** Was: three tests in `test/browser/active_filter.spec.js` failed in WebKit every time: :115, :177 and :258 (the Active pane's filter and search box). Each stops at about 11 seconds. They fail alone and on `origin/main` at `3e59b177`, so they predate the linked folder cap change that found them; Chromium and Firefox pass. Found by the three-browser gate on 2026-10-19. `present_mode.spec.js:147` also failed in WebKit in that full run and passed alone, so it is a load flake.
- [x] @claude 2026-10-19 LAHE-linked-folder-scope -- **A linked folder serves only the files a site's pages name, and files in secret folders (`~/.ssh`, `~/.aws`, `~/.gnupg` and others) are never served.** Shipped in [PR #89](https://github.com/kenxle/live-agentic-html-editor/pull/89). The folder cap is gone; one page may name at most 256 files under linked folders, and a link past that is plain text. On Ken's two runbook sites, 15,632 and 8,201 addresses checked against main: nothing lost. See [the spec](features/20261019.03_linked_folder_scope/01_spec_linked_folder_scope.md).
- [ ] @anyone 2026-10-19 LAHE-stop-hook-reads-searched-transcripts -- **The Stop hook asks an agent to watch a session it never started, because the session id appeared in a transcript the agent searched.** While tracing who changed the forge build script, a Claude session grepped a Codex transcript that printed `lahe monitor --session s_...`. From then on, `lahe hook stop` blocked every turn end and told the Claude session to start a monitor on the Codex session's id. The hook should count only sessions the agent's own `lahe review`, `lahe library` or `lahe session takeover` output created or took over, not ids that appear in tool output.
- [ ] @anyone 2026-10-19 LAHE-linked-files-rebuild -- **A site's list of served linked files only grows, so a file stays served after the link to it is removed.** Rebuild a site's `mount_files` from a fresh walk of its pages and replace the list with what the walk found. It needs a trigger (a command, or a helper route with the CLI secret), a full render of the site, and its own tests. Until then the secret path list keeps a stale entry from ever being a key or credential file. See [the linked folder scope spec](features/20261019.03_linked_folder_scope/01_spec_linked_folder_scope.md), task 7.
- [x] @claude 2026-10-19 LAHE-linked-folder-cap -- **Count the linked folder cap per page, and raise it to 64.** Ships together with 6731010f (links reuse a folder the site already serves). On Ken's `feature-forge-runbooks` site, main with only 6731010f still turned 169 links on 9 pages into plain text; with both, none. See [the spec](features/20261019.01_link_folder_cap/01_spec_link_folder_cap.md).
- [ ] @anyone 2026-10-19 LAHE-markdown-raw-html -- **The Markdown renderer passes raw HTML through untouched, so a `<script>` block, an `onerror` attribute or an `<a href>` with a script-running address in a Markdown file runs on the rendered page.** Found while fixing LAHE-markdown-link-schemes: the allow list covers Markdown's own link forms only, and marked hands inline HTML straight to the page. A reviewed HTML page runs its own scripts by design, so this is the same trust a page already gets, but a Markdown file is more often someone else's (a cloned README). Ken's call whether to sanitize it: an allow list of tags and attributes would also drop HTML some notes use on purpose (`<details>`, choice buttons).
- [x] @claude 2026-10-19 LAHE-markdown-link-schemes-done -- **Rendered Markdown carries only http, https, mailto and tel links, plus relative and in-page ones.** Any other scheme renders as plain text with a title naming it. The scheme is read the way a browser reads it (case, leading control characters, tabs and line breaks inside it), and inline, reference-style and autolinks all go through the same check in `classify` (`src/service/markdown_links.js`). See [the progress page](features/20261019.01_markdown_link_schemes/04_progress_markdown_link_schemes.md).
- [x] @claude 2026-10-19 LAHE-unit-run-timeout -- **Done 2026-10-22: the login item's start wait bounds each probe by its deadline, start waits pass a probe timeout, and `test:unit` stops and fails after 30 minutes. See [the spec](features/20261022.01_test_run_deadlines/04_progress_test_run_deadlines.md).** Was: **`npm run test:unit` has no overall timeout, so one stuck test can hang the run for a day.** It happened during the pandoc work: `test/unit/always_on.test.js:254` ("stale: a busy always-on helper is left for a later command") sat for hours. `startThroughItem` checks its 20 second deadline only between probes, and `probeHealth` calls `fetch` with no timeout, so a probe that never answers never reaches the check. Fix: give `probeHealth` a fetch timeout and give the unit runner a per-file or whole-run limit. Lesson: [no timeout on the unit run](lessons/proposed/npm-run-test-unit-has-no-timeout-so-a-stuck-test-hangs-the-run.md).
- [x] @claude 2026-10-19 LAHE-lint-non-js-files -- **Done 2026-10-22: lint compiles `.lua` under `src/` with luac or `pandoc lua`, and the manifest check counts every file. See [the spec](features/20261022.01_test_run_deadlines/04_progress_test_run_deadlines.md).** Was: **`npm run lint` checks only `.js` files, so the pandoc filter `src/service/lahe_render.lua` gets no checks at all.** All three checks in `scripts/lint.js` (syntax, no-jsdom, manifest completeness) filter to `.js`. Fix: at least a syntax check for `.lua` (`luac -p` or `pandoc lua` when present), and have the manifest check count every file under `src/`. Lesson: [lint checks .js only](lessons/proposed/lint-checks-js-files-only-so-the-lua-filter-and-other-files-get-no-lint.md).
- [x] @claude 2026-10-19 LAHE-pandoc-render -- **Done: Markdown renders with pandoc when it is installed, so `:::` fenced divs in older docs draw as house panels instead of raw text.** [PR #80 (render Markdown with pandoc)](https://github.com/kenxle/live-agentic-html-editor/pull/80) merged as `f3704ea4`. Without pandoc, LAHE falls back to marked, logs a line, and the rail says "Ask your agent to install pandoc to get the correct styles". `LAHE_MARKDOWN_ENGINE=marked` forces the old path. Card and card grid are new house components; rimage draws as the existing plate. This covers the callout part of LAHE-render-forge-structure (teach the renderer the forge structure); its nav bar and reviews section are still open. Spec: [pandoc render](features/20261017.02_pandoc_render/01_spec_pandoc_render.md).
- [x] @claude 2026-10-19 LAHE-verification-skill -- **Verification skill with a control tool and a driven feature map.** `skills/verify-lahe/bin/lahe-verify` starts a throwaway review, drives it as reviewer and agent, logs evidence and cleans up after itself. Eight features mapped; every recipe was run end to end. Builds on Codex's 2026-10-18 draft. [PR #84 (verification skill)](https://github.com/kenxle/live-agentic-html-editor/pull/84) merged as `41c25211`. See [verification status](ongoing/VERIFICATION_SKILL.md).
- [x] @claude 2026-10-19 LAHE-cloud-verification-runner -- **Done: the verification seed passed on a Claude Code cloud runner.** The comment journey ran end to end in the Lahe cloud environment (Linux, Node 22), `doctor` passed, and `down` left nothing running. The environment must allow `cdn.playwright.dev` for the Chromium download. [Report](https://github.com/kenxle/live-agentic-html-editor/blob/claude/verify-cloud-proof-20261020-2/verification-evidence/cloud-proof-20261020-2/REPORT.md).
- [ ] @anyone 2026-10-18 LAHE-verification-map-coverage -- **Turn the map's "not yet mapped" list into driven recipes.** The eight mapped features are driven. Next: conflicts, the Edits tab and undo, two windows, linked documents, present mode, helper restarts, the Library's queued hand-off and session takeover. Keep platform prerequisites explicit. See [the map](../skills/verify-lahe/features/README.md).
- [ ] @anyone 2026-10-18 LAHE-cloud-board-pickup -- **Define safe unattended pickup from this board.** Specify eligible rows, claim ownership and collision handling, required verification evidence and PR handoff before launching automated workers. Depends on [cloud verification proof](../skills/verify-lahe/references/cloud.md); retain the current human decision boundaries.

- [x] @codex 2026-10-18 LAHE-codex-restart-wait -- **Move idle Codex monitoring outside the model turn.** [PR #78 (Codex feedback without an idle model turn)](https://github.com/kenxle/live-agentic-html-editor/pull/78) is merged and active locally. Unit, installer, lint and bundle checks passed. The independent review has no blockers. The live browser test passed: the native queue started a follow-up in the same conversation after the previous turn ended, and the agent drained the test card. See [Codex wake status](ongoing/CODEX_WAKE.md).
- [x] @codex 2026-10-18 LAHE-monitor-single-wake -- **Done: each monitor wake prints once on stdout.** The fix is on main as `e4ee7627` and passed GitHub CI. The post-merge local gate passed on Node 20.19.0: 3042 unit checks and 908 Chromium checks, with no failures; the helper leak guard passed. The separate PR #79 was closed because main already contained the fix.

- [x] @codex 2026-10-18 LAHE-skill-split-keeps-hook-steps -- **The split skill now carries the Stop hook's drain-first step.** The Claude Code host guide states the exception. The Stop hook test passes, and `npm run install-skills` updated both installed copies.
- [x] @anyone 2026-10-18 LAHE-style-change-regenerates-fixture -- (done 2026-10-19: LAHE_REGEN_FIXTURES=1, named in the test's failure message) **A change to `vendor/stclair-doc-style/*.css` has to regenerate `test/fixtures/free_writing/empty_notes.html`, and nothing says so.** The fixture inlines the whole style bundle and `markdown_render.test.js` compares a fresh render to it byte for byte. The option-card badge commit (`b65deb9f`) changed the stylesheet without it and turned main's CI red on 2026-10-18; PR #76 regenerated it. Either have the test regenerate the fixture when `LAHE_REGEN_FIXTURES` is set and say so in the failure message, or put the one-line regeneration command (`node -e` over `markdown.render`) in the style folder README and CLAUDE.md.
- [ ] @anyone 2026-10-17 LAHE-stamp-updated-time -- **Have `lahe review` write the page's "Updated" time itself, so no agent types a time.** Agents keep typing times by hand and getting them wrong: Ken caught one on a hackathon bulletin board, and one on the choice-buttons progress page that was 10 minutes in the future. The skill now says to copy the output of `date` (7c3254e5), and feature-forge already said so in three places, but a written rule still gets skipped. Idea: on each `lahe review` run (and each rebuild of a served Markdown file), fill in a marker such as an "Updated" line or a placeholder token with the helper's own clock. Open questions: which marker to use, whether to stamp only on agent reruns or on any save, and how it shows in the rendered page.
- [ ] @ken 2026-10-17 LAHE-monitor-quiet-spell -- **Should `lahe monitor` wait for a short quiet spell before it exits with new work?** Today it exits on the first 15 s poll that finds anything undelivered, so a reviewer clicking through a page of choice buttons (or leaving several comments in a row) wakes the agent once per agent work cycle. A quiet spell with a cap would merge more of them into one wake, for comments and presses alike. It changes a loop every host shares, so it is Ken's call. Raised by the choice-buttons architect review (`docs/features/20261013.01_choice_buttons/02_architecture_choice_buttons_reviews.md`, finding 2); the feature itself accepts the current count and measures it.
- [x] @claude 2026-10-17 LAHE-handled-check-raw-markdown -- **Done 2026-10-22: with no site render the check reads the review's current state-folder render, else cannot tell; never the source.** See [the spec](features/20261022.02_board_small_fixes_two/04_progress_board_small_fixes_two.md). Was: **The handled check reads raw Markdown when it cannot get the render.** In `src/service/handled_check.js` `pageShows`, a Markdown page whose `pageRoutes.renderForFile` returns null falls through to `fs.readFileSync` of the `.md` itself. Raw Markdown has no blocks, so a placed paragraph (`new_blocks`) is always held as "not on the page" and every other edit answers "cannot tell". PR #74 removed the one cause seen so far (a mounting site picked over the owner), but any other null render lands in the same place silently. Fix: for a Markdown file, a null render is "cannot tell" (or read the state-folder render), never the source. Found on Ken's Homework 6 review.
- [x] @claude 2026-10-17 LAHE-comments-follow-moved-file -- **Done 2026-10-17, PR #73:** a reviewed file that moves to a new folder or name keeps its comments. When a review records a page that is now gone and one later page of the same name that a site serves (or the file the old path links to), the gone page's comments show on the new file, the old address redirects there, and the handled check and `review.json` name the new file. The contract tells the agent that moves a file to run `lahe review <new path> --session <id> --review <review-id>`; only the owning session can. Ken lost a research brief's thread when an agent moved it from `projects/` to `docs/`; it came back with the merge. Spec: `docs/features/20261017.01_comments_follow_moved_file/`. Asked for by Ken.
- [ ] @anyone 2026-10-17 LAHE-move-pair-path-spelling -- **A moved file does not pair when its review recorded the path through a symlinked folder, or with different capital letters than the disk.** Recorded paths are stored with `path.resolve`, not as real paths. After the folder moves, the old spelling cannot be resolved, so `namesPath` and `goneByPath` in `src/service/page_routes.js` find nothing and the comments stay at the old address. Ken's paths are real, so this has not bitten yet. Fix: record the real path beside the spelled one, or compare by real parent where it still exists. Found by the code review of PR #73.
- [ ] @anyone 2026-10-17 LAHE-move-pair-deleted-sibling -- **A deleted page's comments can show on a same-named sibling.** With PR #73, a review that recorded `a/README.md` and later `b/README.md` shows `a`'s comments on `b` once `a` is gone, and `a`'s old address redirects to `b`. The spec accepted this (exactly one same-named page left), but `index.html` and `README.md` are common names. If it misfires in use, pair only through a recorded move (the agent's `--review` run naming the old page) instead of by name. Found by the code review of PR #73.

- [ ] @anyone 2026-10-17 LAHE-retire-global-lahe-rules -- **Once LAHE-long-answer-check ships, retire the lahe rules in Ken's global `~/.claude/CLAUDE.md`.** Ken, on the skill-tuning page: separate documentation that makes lahe work better for him means we cannot see how a new user experiences it, and cannot tune it properly. His global CLAUDE.md tells agents to put anything he should read in a LAHE document and to `open` the URL, which gives him better triggering than a new user gets. When the install option covers long answers, move what is still needed into the tool or the skill, and propose removing those lines from the global file (Ken's call; it is his personal config).
- [x] @claude 2026-10-17 LAHE-site-for-file-owner -- **Done 2026-10-17, PR #74:** the handled check held placed paragraphs as "not on the page" when another site had a link mount into the document's folder and was listed first. That site was picked, its render refused the file, and the check read the raw Markdown. The site whose folder holds a file now wins; a mount counts only when no site holds it. Found on Ken's Homework 6 review. Spec: `docs/features/20261017.01_site_for_file_owner/`.
- [ ] @anyone 2026-10-17 LAHE-long-answer-check -- **Lahe as the default for long answers, chosen at install.** Ken approved this on the skill-tuning page: installing lahe asks whether long chat answers should become pages. When on, the Stop hook that lahe already installs blocks a turn once when the agent's final message is long (over about 2,000 characters, or has section headings) and it served no lahe page that turn, and tells it to load the lahe skill and put the answer on a page. Off for anyone who does not choose it. Why: in 45 days of sessions Ken asked for lahe himself 23 times after an investigation, PR report or brainstorm arrived as a wall of chat, and a better skill description barely moved this in testing (5 of 33 runs against 3 of 33). Build as a whetstone after the skill-tuning PR merges. Evidence and the test harness: ~/Documents/lahe-skill-eval/.
- [ ] @anyone 2026-10-17 LAHE-long-answer-check-followup -- **Check whether the long-answer check is working, once it has run for a while.** Rerun the session scan in ~/Documents/lahe-skill-eval/evidence/ (its scripts count the times Ken asked for lahe after a long chat answer, and long chat answers with no page) on the sessions since the check shipped, and compare with the 2026-10-17 baseline: 23 asks for lahe and 17 long answers with no page, over 45 days. Also read whether the check fired on answers Ken wanted in chat. Report on a page with the numbers and a keep, tune, or remove call.
- [x] @claude 2026-10-17 LAHE-menubar-app -- **Done 2026-10-14, PRs #61, #62, #64:** an optional Mac menu bar icon (the Library mark) that shows when something is waiting on Ken, lists documents and sessions, opens the Library, and stops or starts Lahe. Installed with `lahe install --menu-bar`; built on the Mac from `macos/menubar/`. Follow-ups #66 (read-only note, one statement per line) and #71 (a review follows its document out of a worktree). How it works now: `docs/ongoing/MENU_BAR.md`. Feature folder: `docs/features/20261012.01_menu_bar_app/`.
- [x] @claude 2026-10-16 LAHE-card-edges -- **Done 2026-10-14, PR #68:** rail cards lose the curved blue stripe down the left edge and the green wash on handled cards. An unseen card's border turns blue on all four sides; a handled card is the plain card, and the green HANDLED chip says done. Straight inner bars stay. The README hero is retaken on the Steady Thread home page with the new cards. Spec: `docs/features/20261014.01_card_edges/`.
- [x] @claude 2026-10-15 LAHE-review-follows-document -- **Done 2026-10-15, PR #71:** a review and its comments follow a document out of a removed worktree. The main checkout's copy at the same path counts as the same document once git says the worktree is gone and the main checkout checks out as the same repository; the old address redirects there, `lahe review` of the main copy continues the old review, and the Library shows one row marked moved. Spec: `docs/features/20261015.02_review_follows_document/`. Asked for by Ken.
- [x] @claude 2026-10-15 LAHE-batch-reply-own-answers -- **Done 2026-10-15, PR #70:** the drain no longer prints the agent's own earlier answers on a card, except a question the reviewer is answering and turns written before a takeover; the catch-up still prints everything. `lahe reply --batch` answers many items in one run, all or nothing. A follow-up with one earlier answer drops from 385 to 273 tokens. Spec: `docs/features/20261015.01_batch_reply_own_answers/`. Asked for by Ken.
- [x] @claude 2026-10-15 LAHE-lean-agent-output -- **Done 2026-10-15, PR #69:** one reviewer comment now costs the agent about 326 tokens instead of 1,320. The monitor prints one line and only the drain prints items; the banner prints once; drain items drop empty fields, context already inside the quote, and five fields agents never use; the status summary prints only when it carries something; `lahe reply` prints only the item id and status; the skill asks for one line of chat after a batch of replies. Spec: `docs/features/20261014.02_lean_agent_output/`. Asked for by Ken, for users on the $20 plan.
- [ ] @anyone 2026-10-15 LAHE-one-home-for-styles -- **Styles are spread through the code, which confuses agents.** Ken, on the style guide draft: rules belong in the docs, not in code, and the same tokens in several places reads as conflicting. Today the rail's tokens are defined in `src/layer/overlay.js`, then copied by value into `zoom.js` and `catalog_page.js`. `comments.js`, `editing.js` and `tab_active.js` write literal colors instead of `var(--token)`. The accent hex appears as a literal in `comments.js`, `editing.js`, `overlay.js`, `zoom.js` and `catalog_page.js`. `markdown.js` and `page_routes.js` also carry literal colors. Fix: one token source per surface (the rail's in one CSS file beside the document style's `system-tokens.css`), every other file reads `var(--token)`, and `docs/ongoing/STYLE_GUIDE.md` holds the rules. The rail keeps its own token set, separate from the document style, so it does not shift when a document's style changes (Ken's call on the style guide draft).
- [x] @anyone 2026-10-15 LAHE-brand-no-all-caps -- (done 2026-10-19 for the Library, rail, CLI handover text, INSTALL.md and the skill references; the review.json contract text still says LAHE Library and changes with its copies) **User text still says "LAHE" in all caps.** The Library page has several messages such as "LAHE is not running", and `docs/INSTALL.md` uses it throughout. The brand doc (`docs/ongoing/BRAND.md`, Names) says Lahe.
- [x] @anyone 2026-10-15 LAHE-brand-install-library-word -- (done 2026-10-19) **`docs/INSTALL.md` calls the rail's script "the library".** The Library is the page that lists every review. Call the script the review layer, per `docs/ongoing/BRAND.md`.
- [x] @anyone 2026-10-15 LAHE-brand-server-helper-message -- (done 2026-10-19: "The Lahe program is down") **One rail message says "Lahe server helper is down".** Pick one name. The brand doc now says "the Lahe program" to most users and "the Lahe server" in dev work; see LAHE-brand-rename-helper.
- [ ] @anyone 2026-10-15 LAHE-brand-rename-helper -- **Rename "helper" in user-facing text.** Ken (on the brand and architecture drafts): call it "the Lahe program" for most people and "the Lahe server" when the user is doing dev work. Touches CLI output, rail messages, the README, INSTALL.md, the skill and the contract text (which travel together, see CLAUDE.md). Code names can stay.
- [x] @claude 2026-10-17 LAHE-brand-rail-words -- **Done 2026-10-17, PR #75:** the chat bar uses the brand words. The state chip reads Open, Question or Done (a refused thread reads Open, still amber), and menus, tips, toasts and the Library hand-off say thread and chat bar. Only words a person reads changed; record states and the agent contract did not. Screenshots: `docs/features/20261017.01_brand_rail_words/`.
- [x] @anyone 2026-10-15 LAHE-brand-readme-hosts -- (done 2026-10-19: the README badge and table name Gemini CLI) **The README badge names three agent hosts; `AGENTS.md` also lists Gemini CLI.** Make them agree.
- [x] @anyone 2026-10-15 LAHE-brand-end-review-label -- (done 2026-10-19: "End this review, close it and show your hand edits") **The End review button's label says "End this review and perform cleanup".** Plain words: say what ending does, without "perform".
- [ ] @anyone 2026-10-15 LAHE-brand-styles-free -- **The README says International Style ships free and the Lahe Styles install from the store page; they are now free too, as a download.** Ken made them free and keeps the download so he can gauge interest. Say that in the README's Document styles section and on the store page.
- [ ] @anyone 2026-10-15 LAHE-held-release-waiting-clock -- **Releasing held comments sets off the "Nothing has come back" alert at once.** Ken held his comments for about 45 minutes of work, released them all, and the alert came up right away. The rail's waiting clock counts from when each item was submitted (the review contract in `src/shared/review_format.js` says so; the wording is `waiting` in `src/shared/protocol.js`), and a held item was submitted when he committed it, not when Hold let it go. Count from the release for a held item, so the clock starts when the agent could first see it.
- [x] @anyone 2026-10-14 LAHE-csv-served-as-download -- (done 2026-10-19: .csv and .tsv are served as text/plain) **The static server sends `.csv` files as `application/octet-stream`, so a link to a CSV on a served page downloads it instead of showing it.** Found by the Seneschal report walk: every evidence link to a run's CSV dropped a file into Downloads. Fix: serve `.csv` as `text/csv; charset=utf-8` inline, or render a CSV as a table page. Seneschal now names CSVs instead of linking them; the fix would let it link again.
- [x] @claude 2026-10-14 LAHE-inline-code-forces-sideways-scroll -- **Done 2026-10-22: `code` wraps anywhere, except in table cells.** See [the spec](features/20261022.02_board_small_fixes_two/04_progress_board_small_fixes_two.md). Was: **A long path in inline code (for example in a heading) widens the page at phone width, so the page scrolls sideways.** The Seneschal walk measured 784px and 810px pages in a 390px viewport. Fix: `overflow-wrap: anywhere` on `code` in the document style, which the style guide already asks for.
- [ ] @anyone 2026-10-14 LAHE-rail-covers-page-on-phone -- **At phone width the rail covers the whole page, with no visible way to collapse it, and at laptop width wide tables run under the open rail.** Seen on Seneschal report pages at 390px (headless) and at 1280px with tables 1359px and 1410px wide.
- [ ] @anyone 2026-10-14 LAHE-links-outside-library-root -- **Relative links on a page served from outside the library root (a folder under `/private/tmp`) render as a gray "local file" span instead of a link.** Inside the root Lahe rewrites them to `/.lahe-source/...` and they open. Seen on the Seneschal drafts page for a scratch clone.
- [x] @claude 2026-10-13 LAHE-choice-buttons -- **Done 2026-10-18 in PR #76.** Clickable choice buttons on a decision page. An agent writing a page of yes/no verdicts (the lesson queue, a forge checkpoint, a close-out) should be able to put buttons on it that post an identified answer straight to its drain, instead of four gestures per verdict. Crucible: `docs/features/20261013.01_choice_buttons/00_crucible_questions.md`. Held 2026-10-13 to 2026-10-17 until the standard docs (product brief, architecture, style guide, brand) existed; Ken lifted the hold on 2026-10-17. Crucible closed 2026-10-17: Ken picked B, a new choice record kind, documents only. Summary: `docs/features/20261013.01_choice_buttons/00_crucible_choice_buttons.md`. Brief next. Ken: agents learn to author the element through the lahe skill, and that skill change uses the skill-creator skill.
- [ ] @anyone 2026-10-13 LAHE-global-status-watches-every-review -- **A plain `lahe status` (no `--session`) puts every review on the projector's watch list for good, and the helper's idle cost goes up about nine times until it restarts.** The projector folds reply files every second for each review something has asked about since the helper started ("nothing is watched until somebody asks", `src/service/projection.js`), and never takes one off. The global status reads every review (703 on a copy of Ken's state folder), so after one run the helper used 12.37 s of processor time per 10 idle minutes against 1.36 s before; a profile put 82 percent of it in the loop over watched reviews. The agent drain (`lahe status --session`) is not affected. Let a watch expire when nothing has read that review for a while, or have the global status read without watching. Found by the menu bar app's walkthrough (V32).
- [ ] @anyone 2026-10-14 LAHE-install-windows-port80-flake -- **`test/unit/install_command.test.js` "on Windows, --port-80 is a step done by hand" failed once on main's Linux CI** (run 38513361406, first attempt): the faked login item's helper did not answer within install's 20 s wait, so install exited 1. The rerun passed, the PR check and the local gate passed on the same code, and the change it merged touched no install code. Likely a slow runner or a race on the free port the test picks; worth a look if it comes back, since every red run emails Ken.
- [ ] @anyone 2026-10-15 LAHE-page-sets-target-path -- **A page holding a review's token can record any `target_path` through `review.write`** (`src/service/routes.js`, the review.write route). Through `pickReview`'s first rule that path then gets the page's token on any file a site covers, and through `holderOfFile`'s first tier it holds that file against new reviews. Found by the security review of the review-follows-document spec on 2026-10-15; it predates that work. Limit a recorded path to files the review's own site or folder already serves.
- [ ] @anyone 2026-10-15 LAHE-menubar-cant-tell-flicker -- **One slow poll makes the menu bar icon show "can't tell" for one poll, about five seconds.** It happened twice in the first hour on Ken's Mac, both while another agent was creating reviews and a test run was loading the machine; the next poll answered each time. Show "can't tell" only after two misses in a row, in `macos/menubar/`. The architecture set the four looks, so the doc's line on "can't tell" changes with it (`docs/ongoing/MENU_BAR.md`).
- [ ] @anyone 2026-10-13 LAHE-menubar-connection-reuse -- **The menu bar app opens a new connection every 5 s, which alone costs the helper about 0.36 s of processor time per 10 minutes (a bare `/health` poll).** Reusing one connection needs the helper's keep-alive timeout above 5 s (Node's default 5 s now) and retry logic in the app for a socket the helper closed. The app and its polls measured 0.73 s per 10 minutes together, within the one-tab budget, so this is a nice-to-have.
- [ ] @anyone 2026-10-13 LAHE-library-sweep-cost -- **The Library's 15-second sweep reads every `session.json` whether or not anything is installed: about 1.2 s of processor time per 10 minutes on a copy of Ken's state folder (171 sessions), more than the menu bar app and its polls together.** `sweepLibrarySessions` in `src/service/index.js`. Read only sessions whose folder moved, or sweep less often. Found by the menu bar app's idle measurements.
- [x] @anyone 2026-10-13 LAHE-standing-architecture-doc -- **Done 2026-10-15 as part of the standard docs: `docs/ongoing/ARCHITECTURE.md` carries the rules under "Architecture rules" (D1, D2, D3, D6, D7, D9, D10, D11 as they stand; D4, D5, D8, D12 are not restated there yet). Original row: There is no standing architecture doc; the twelve binding decisions D1 to D12 live only in the August feature doc.** CLAUDE.md names `docs/features/20260812.01_live_agentic_html_editor/02_architecture_live_agentic_html_editor.md` as binding, and the diagrams, docs/ongoing and CONTRACTS.md cite D3, D7, D9, D12 by number into a file the repo also calls history. Ken, reading the choice-buttons crucible: "feature docs are historical records of how we built a feature. do we not have a high level architecture doc?" Write `docs/ongoing/ARCHITECTURE.md`: the decisions as they stand today (several have been amended since, D9 on 2026-08-26 for one), one paragraph each, linking the diagrams. Then point CLAUDE.md and the citing docs at it.
- [ ] @anyone 2026-10-12 LAHE-cli-secret-signed-proof -- **The CLI sends the raw CLI secret on `site.bind` and `review.retire`, after an unauthenticated `/health` probe.** A program squatting on the helper's port while the helper is down (another account, a sandboxed app, a container) can collect it, then make the helper serve any folder Ken can read. The menu bar app avoids this with signed requests (`AUTH.CLI_PROOF`, see docs/features/20261012.01_menu_bar_app/02_architecture_menu_bar_app.md, Security). Move the CLI's two routes to the same proof once that lands. Found by the menu bar app's security review (SR1).
- [x] @claude 2026-10-12 LAHE-style-print-wide-tables -- **Done 2026-10-22: it was cut off, and one long path pushed the other columns off the page. In print `.scrollx` shows everything and code in a cell breaks anywhere. See [the spec](features/20261022.03_print_wide_tables/01_spec_print_wide_tables.md).** Was: **Check whether a wide table is cut off in a PDF.** `.scrollx` (`vendor/stclair-doc-style/document.css`) scrolls a wide table on screen, but the `@media print` block has no rule for it, so a table wider than the page may print clipped at the edge. Not yet tested. Forge docs now rely on it: their build dropped the shared `doc_fixes.css` because it split table headers mid-word. Try a table with a long unbroken path through `html-to-pdf`.
- [ ] @anyone 2026-10-12 LAHE-renderer-use-forge-components -- **The Markdown renderer could emit the four new style components, which would move LAHE-render-forge-structure (below) forward.** PR #60 added `.toplinks` (a links row between sibling pages), `.contents-list` (inside the fold), `.xref` (the "See" line) and `.status-dot` to `vendor/stclair-doc-style/document.css`, with markup in `COMPONENTS.md`. The feature-forge build now emits all four and reads this folder on every build. The renderer still shows feature docs as plain Markdown, so a forge doc opened as `.md` has none of them. Also: a page built outside the renderer gets the 68ch measure only inside `section.sheet`; the forge build wraps its body that way for this reason.
- [ ] @anyone 2026-10-12 LAHE-stop-hook-foreign-session -- **The Stop hook claimed another agent's session as this agent's.** On 2026-10-12 the rail-cleanup agent ran `ps` and the output listed another agent's `lahe monitor --session s_b4276f2e1d343291`. The hook's transcript scan then read that id as a session this agent started, blocked the turn twice, and the agent started a monitor on a session it did not own (it exited on the first item, and the agent left the item alone). The scan should count only ids from `lahe review` or `lahe session takeover` output this agent ran, not any id that appears in tool output.
- [x] @claude 2026-10-12 LAHE-holder-tie-same-millisecond -- **Done 2026-10-22: every tier breaks a tie on the higher review id.** See [the spec](features/20261022.02_board_small_fixes_two/04_progress_board_small_fixes_two.md). Was: **Two live reviews of one file created in the same millisecond have no defined holder.** `holderOfFile` in `src/service/page_routes.js` keeps the first review with the latest stamp, so a tie goes to whichever the folder listing names first, which differs by OS. PR #58 fixed the tests by spacing the reviews; the product still has the tie. Break it on something stable (the review id, or the event log order).
- [ ] @anyone 2026-10-12 LAHE-edit-hover-outline-check -- **Check that Cmd-Shift-E with no selection really outlines editable blocks on hover.** The shortcuts panel says it does. Nobody confirmed it during the rail cleanup; if it does not, either build it or change the panel's wording.
- [ ] @anyone 2026-10-12 LAHE-agent-name-default-partial -- **Partial progress on LAHE-agent-name-default (below):** PR #58 changed the contract, skill and reply help to say pass `--agent` with the kind of agent (claude, codex), never a session or task name, after a card read "international-style-forge is asking". The default from the session is still not built, so an agent that skips `--agent` still shows "agent".
- [ ] @anyone 2026-10-12 LAHE-gate-rewrites-mark-done-shots -- **Two more screenshots join LAHE-gate-rewrites-doc-screenshots:** `docs/features/20261012.01_rail_cleanup/mark_done_light.png` and `mark_done_dark.png`, written by `test/browser/mark_done.spec.js` on every gate run.
- [ ] @anyone 2026-10-12 LAHE-port-1483-timeout-with-port-80 -- **With `lahe install --port-80` on (macOS), the address with `:1483` times out; the address without the port works.** Ken accepted this for now (either address is fine). Found so far: a direct TCP connect to 127.0.0.1:1483 or [::1]:1483 never completes (the server side sits in SYN_RCVD), from curl, nc, Python and Node; port 80 (redirected), 7817 and a fresh server on 1484 all connect. pf is on (the port-80 forward runs `pfctl -E`) with no block rules; anchor `com.apple/lahe` holds two `rdr pass on lo0` rules, 80 to 1483, for inet and inet6 (`src/service/login_item.js`, the pf LaunchDaemon). pf's state-mismatch counter was 154. Adding `pass quick on lo0 ... port 1483 no state` both ways did not help. Next test, not yet run: turn pf off for a moment (`sudo pfctl -d`), try `curl -m 5 http://127.0.0.1:1483/`, then turn it back on and reload Lahe's rules (`sudo pfctl -E; sudo pfctl -a com.apple/lahe -f /etc/pf.anchors/lahe`). If 1483 connects with pf off, the rdr state handling on lo0 is the cause; change the rule set in `login_item.js` with a test and have Ken re-run `--port-80`. Noted as a known issue in the v0.3.0 release and docs/UPGRADING.md.
- [ ] @anyone 2026-10-12 LAHE-stable-addresses-small-followups -- **Small leftovers from stable addresses** (details in docs/features/20261011.02_stable_addresses/04_progress_stable_addresses.md, Follow-ups): the `::1` half of the port-80 forward is installed but never checked on its own; `lahe uninstall` does not undo `pfctl -E` (no Lahe rule is left, pf just stays on); when something holds the helper's port and drops every connection, `lahe review` exits 0 and prints nothing; HTTPS for `.lahe` names (Lahe makes its own certificate limited to `.lahe`, trusted once), so a `.lahe` page counts as secure and could be printed.
- [x] @claude 2026-10-12 LAHE-library-open-closed-session-flake -- **Done 2026-10-12 in d36f7624 (PR #58):** the holder tests wait for the clock to move before making the newer review, so the two reviews no longer share a created_at millisecond. Original report: **`test/unit/library_open_sites.test.js:329` ("Open of a file whose review is in a closed session, or the row's own session, still goes to that review's page and stamps nothing") failed once in CI on PR #59 with `Cannot read properties of null (reading 'review')` at line 337: `lib.open(older.id)` answered with no `held_by`.** The PR touches only the Stop hook and docs. Locally it passed in the full unit run and 3 of 3 alone. Likely a timing race in `twoReviews` (two reviews of one file in the same millisecond on a fast runner), so which one holds the file is ambiguous. If it shows again, give the two reviews distinct timestamps in the fixture or make `open` pick deterministically.
- [x] @claude 2026-10-12 LAHE-hook-indefinite -- **Done 2026-10-12 on hook-indefinite:** the Stop hook's block reason names 86400000 (or `BASH_MAX_TIMEOUT_MS` when larger) and says one launch waits until there is work, so no timer or loop is added. The 2026-10-11 watcher change moved the skill, the contract and docs/CLI.md to that rule but left the hook at a two-hour default, which Ken's `BASH_MAX_TIMEOUT_MS` setting hid. The agent workflow diagram, the CLI doc's "What it prints" bullet and the skill's pitfall 10 follow. Spec: docs/features/20261012.02_hook_indefinite/. Asked for by Ken.
- [ ] @anyone 2026-10-11 LAHE-stable-addresses-three-browser-followup -- **The three-browser run on stable addresses (after merge) had 10 failures of 2,574.** It overlapped another agent's test run and a bundle rebuild, so some may be load flakes; the Chromium gate run alone just before had 0 failures. Rerun alone: the Chromium each_page_comments and paragraph_break failures pass (load flakes); WebKit stable_addresses_sites.spec.js:197 was a wrong assertion in the test (WebKit sends Sec-Fetch-Site cross-site for that click, and the helper already allowed it), fixed in PR 47. Rerun the rest alone and fix what is real. Chromium: each_page_comments.spec.js:118, :145, :166; paragraph_break.spec.js:308; style_switcher.spec.js:351. Firefox: catalog_page.spec.js:182; reload_claim.spec.js:159; style_switcher.spec.js:236 (already a known Firefox failure, LAHE-style-button-focus-ring-firefox). WebKit: stable_addresses_sites.spec.js:197 (the Library link from the unknown-name page); zoom_viewer.spec.js:240. Also still to run after merge: the idle measurement against the plan's limits (Task 5.4) and a browser walkthrough.
- [ ] @anyone 2026-10-11 LAHE-read-agent-session-file -- **Investigate the helper reading the agent's own session transcript to tell the reviewer what the agent is doing.** Seen on review r03fdeebe1fb6: two comments sat unanswered while the agent worked in its main thread (waiting on CI), and the rail could not tell the reviewer that. Claude Code keeps a transcript per session (`~/.claude/projects/<project>/<session>.jsonl`), Codex under `~/.codex/sessions`. The helper could read recent activity from it and show "working" or "idle" on the rail, or notice when the agent is busy and its monitor is down. A lot to think through: which file belongs to which Lahe session, privacy (the transcript holds the whole conversation, so read only timestamps and tool names), per-host formats that change without notice, and whether it replaces or only backs up the monitor heartbeat.
- [ ] @anyone 2026-10-11 LAHE-static-site-folder-port-race -- **`static_site_folder.spec.js:233` ("a page already carrying another review's script line is served exactly as it is") failed in CI on PR #42 because another process took its port.** The test calls `freePort()`, then starts `lahe review --port <n>`; in between, something else in the parallel run bound the port, and `lahe add` refused ("something is answering ... but service.json is not there"). It passed on the rerun and 4 of 4 locally. Same race as any `freePort()` then start: retry the start on that refusal with a new port, or let the helper pick a port and read it back.
- [ ] @anyone 2026-10-11 LAHE-second-reply-replaces-first -- **A second agent reply to the same revision of a card replaces the first on the card.** An agent answered a question, then sent a correction with the same rev; the reviewer saw only the correction and said the question was never answered. Either show every reply as part of the card's thread, or have `lahe reply` warn that it replaces the earlier reply. Seen on review r5c67aef9754a, item itm_ce9adf62d952b762adfb9cd8.
- [ ] @anyone 2026-10-11 LAHE-agent-name-default -- **Cards say "Agent is asking" instead of naming the agent, because replies only carry a name when the agent passes `--agent`.** The skill asks for it (skills/lahe/SKILL.md, "Pass `--agent <your-name>`"), but agents skip it, and the session records no name (session.json has none). Wanted: the card says "Claude said x", then after a handoff "Codex said y". Fix: `lahe review`, `lahe session takeover` and `lahe monitor` record the agent's name on the session, read from the host's environment (`CLAUDECODE=1` for Claude Code; find Codex's and Antigravity's markers) or from `--agent`. `lahe reply` then defaults `--agent` to the session's current name, and a takeover changes the name for later replies only. Asked for by Ken.
- [x] @claude 2026-10-11 LAHE-test-runs-fill-disk -- **Done 2026-10-11 on fix/test-temp-cleanup:** the wrapper and the browser teardown now remove their run folder unless a helper survived, and the catalog fixture hard-links one oversized log instead of writing 5 MB per install (a unit run's disk use fell from about 606 MB to about 250 MB before the folder removal). Original report: **Every unit test run leaves about 620 MB in the temp folder, and nothing removes it.** On 2026-10-11 these folders reached 41 GB and filled Ken's disk to under 1 GB free, which stopped all work until they were deleted by hand. Two causes, measured on one run of `npm run test:unit` (618 MB): (1) `scripts/no_stray_helpers.js` makes a `lahe-run-*` folder per run and never removes it after its stray-helper check; (2) `test/fixtures/catalog_state.js` writes a 5 MB `events.jsonl` (padding past `REPROJECT_MAX_BYTES`) on each of its 74 installs per run, which is 465 MB of the 618. Fix: have the wrapper remove its own run root once the reap passes (keep it when a helper survived, as evidence), and have the catalog fixture make the oversized log once per run, or as a sparse file, instead of per install. The browser suite's teardown (`test/browser/support/no_stray_helpers.js`) likely has the same leak; check it too. Asked for by Ken.
- [x] @claude 2026-10-12 LAHE-dismiss-card -- **The reviewer has no way to dismiss a card and keep its history.** Today a card can be deleted only from draft, ready or not_handled, and deleting erases it; a handled card cannot be removed at all, only undone. When a card is stuck or no longer wanted (the hackathon review, r55509b17344e, had five), the only way out an agent found was a fresh review, which drops every comment. Wanted: a Dismiss action on any card that moves it to Done with its thread kept, takes it off the agent's drain, and stops replay from writing it. Option F in docs/features/20261011.01_stuck_replayed_blocks/00_diagnosis.md. Asked for by Ken, 2026-10-11. Done: Mark as done shipped in PR #56. The state chip on a Ready or Not handled card opens a one-item menu; the helper records the close at the item's revision (`closed_by: "reviewer"`), the card moves to Done with its thread, it leaves the drain, later agent replies are refused, and replay stops writing it. A handled card still has Undo, not Mark as done.
- [x] @claude 2026-10-19 LAHE-style-button-focus-ring-firefox -- **Fixed on branch fix/style-focus-firefox: Esc now returns focus with `focus({ focusVisible: true })`.** Measured in Firefox: after Esc the button was the active element and matched `:focus`, but not `:focus-visible`, so the shared `:focus-visible` ring rule never applied. Was: `test/browser/style_switcher.spec.js:236` fails in Firefox every time ("Esc closes it and puts a visible focus ring on the button": expected outline style `solid`, got `none`). It fails alone and on main from before the zoom viewer merged (5c38582), so it is older than that. Chromium and WebKit pass. Firefox likely does not treat focus moved back by script after Esc as `:focus-visible`. Found by the three-browser gate on 2026-10-11.
- [ ] @anyone 2026-10-11 LAHE-zoom-theme-copy -- **The zoom viewer carries its own copy of the rail's light and dark colors.** `src/layer/zoom.js` draws in its own closed shadow root, and the rail keeps its theme tokens inside `src/layer/overlay.js`'s closed root, so the builder copied the values. A change to the rail's palette will not reach the zoom button and viewer. Export the tokens from overlay.js (or move them to one shared place) and have zoom.js read them. From the zoom viewer build (PR 34).
- [ ] @anyone 2026-10-11 LAHE-gate-rewrites-doc-screenshots -- **Running the browser suite rewrites three screenshots kept in other features' docs.** `linked_docs_rail.spec.js`, `italic_sticks.spec.js` and `rebuild_not_the_agents_job.spec.js` save over `linked_page_rail.png`, `after_reload.png` and `card_not_on_page.png` under `docs/features/`. After every `npm run gate` they show as modified, and a broad `git add docs` commits them by accident (it happened on PR 36). Have those specs write to `test-results/` instead, or only when an env var asks for it.
- [x] @claude 2026-10-11 LAHE-serve-restart-foreground -- **Done 2026-10-22: `--restart` starts the new helper detached and returns once it answers.** See [the spec](features/20261022.02_board_small_fixes_two/04_progress_board_small_fixes_two.md). Was: **`lahe serve --restart` runs the new helper in the foreground of the command that started it.** Every other path starts the helper detached. When an agent runs `--restart` in a background shell, the helper lives inside that shell and stops when the shell is stopped or reaped, which takes every review page down. Seen on 2026-10-11; worked around by killing it and letting `lahe review` start a detached one. Have `--restart` stop the old helper and start the new one detached, like `lahe add` does.
- [x] @claude 2026-10-08 LAHE-replayed-new-blocks-after-restructure -- **Done 2026-10-11 on fix/flag-dont-hold:** the page check no longer reopens a handled card whose words a restructure changed, and replay no longer writes a refused card onto the page. See docs/features/20261011.01_stuck_replayed_blocks/. **The page keeps re-inserting a reviewer's new blocks after the agent restructures them.** In a Markdown review, the reviewer added a bulleted list (new_blocks). The agent placed it, replied handled, and later turned the list into a table at the reviewer's request. The built page had only the table, but the reviewer's browser kept showing the old bullets after reloads, and the item never returned to the drain. Seen on review r896b3b9c095f (intelligent_ui_lahe/article_v2.md, Ken's personal repo). Likely the layer replays handled new_blocks whose exact words are missing from the page. When the reviewer then deleted the replayed list on the page, the bullets multiplied without end. Workaround: open a fresh review of the same file.
- [ ] @anyone 2026-10-07 LAHE-bg-reap-setting -- **Claude Code's low-memory stop can still kill an idle `lahe monitor`.** Claude Code stops idle background commands when it reads memory pressure as critical, and open issues anthropics/claude-code#90109, #92228 and #78674 report that read misfiring. The re-arm guard then asks the agent to restart, while Claude Code's note says not to. Ken chose to leave `CLAUDE_CODE_DISABLE_BG_SHELL_PRESSURE_REAP` off for now (2026-10-07). Revisit if watchers keep dying on a healthy Mac. See docs/features/20261006.02_rearm_guard/00_decision.md.
- [ ] @anyone 2026-10-07 LAHE-library-quiet-close-no-self-stop -- **When the Library closes the last quiet session itself, the helper stays up.** The self-stop request (`stop-when-quiet.json`, src/service/self_stop.js) is only written by `lahe session close`. The Library's own quiet-session close skips it. Found by the helper-leak fix builder (PR 35).
- [ ] @anyone 2026-10-07 LAHE-hook-known-limits -- **The Stop hook misses a few unusual setups.** A `--state-dir` path with non-ASCII characters (the transcript is scanned as latin1), Windows paths, and an OS-reused monitor pid read as live. Listed under Known limits in docs/CLI.md; none affects Ken's setup today.
- [ ] @anyone 2026-10-02 LAHE-free-writing-repaint-drops-edge-space -- **A space at the edge of a new free-writing paragraph can still be lost to a raw page repaint.** The same bug was fixed for edits to existing paragraphs on 2026-10-02 (protection's restore now keeps the reviewer's spaces, `cleanMarkup` with `keepWhitespace`). New paragraphs are rebuilt through `blocks.writeBlock`, which still trims edge spaces. Fixing it means touching the block allowlist rules, so it was left out of that fix.

- [ ] @anyone 2026-10-01 LAHE-free-writing-seams-crash-flake -- **`free_writing_seams.spec.js:568` ("crash mid-sitting") fails when several copies run at once.** Alone it passed 3 of 3; with `--repeat-each=3` it failed 3 of 9. Not seen in CI. Unconfirmed guess: the browser crashes the test causes reach other test workers. If it shows up in CI, run it in its own worker or serial group.

- [ ] @anyone 2026-09-30 LAHE-library-dismiss-and-hide -- **The Library needs a way to clear a row's waiting comments, and a way to hide or archive rows, without opening the document.** Ken, going through the top section for the first time: most waiting items are old and he just wants them gone, but the only way today is Open, leave a note ("clear this out"), and have an agent answer every item. Opening each one also pushes it into his recent documents, so the triage itself pollutes the list. Two parts: (1) a close-out button on a waiting row that marks its unanswered items not handled with a reason like "closed from the Library" and takes the row out of the top section; (2) hide/archive for any row, so it leaves the main list but can be found again. Neither should count as "worked on" for the row's last-worked time. Also seen: a row whose only item was a handled reply held by the page check (`handled_not_on_page`) showed as waiting though nothing was left to do.

- [x] @claude 2026-09-30 LAHE-free-writing-click-outside -- **`test/browser/free_writing_line_lifecycle.spec.js:238` ("a click outside commits and removes the line") fails in Chromium every time, on main too.** It times out after 10s waiting for the click outside to commit. Failed 3 of 3 on the Library branch and 1 of 1 on a clean origin/main (08783d2) run alone; it is the only failure in the PR #19 gate (2275 unit pass, 762 browser pass). Merged the Library over it because main already had it. Done: the test was wrong, not the product. The 2026-09-30 style sync shortened the hero padding, so the fixed press at (4, 400) landed in the gap between two paragraphs, inside the 40px near-miss slack, and opened a new block by design. The test now presses the far-left margin beside a paragraph's middle, read from the layout.

- [x] @claude 2026-09-30 LAHE-empty-notes-fixture-stale -- **`test/unit/markdown_render.test.js` "the rendered empty file matches the empty-notes fixture" fails on main.** The vendored St. Clair CSS was synced (78363b9, new status colour block) after `test/fixtures/free_writing/empty_notes.html` was written, so the fixture's inlined style is stale. Regenerate the fixture from the current render (or compare with the style block stripped) so a style sync does not break it again. Done: regenerated from the current render on the Library branch; only the inlined style block changed.

- [ ] @anyone 2026-09-30 LAHE-catalog-cross-site-webkit-flake -- **`test/browser/catalog_cross_site.spec.js:382` (the localhost case) timed out at 15s in WebKit under the full three-browser run, with `TypeError: fetch failed`.** It passed 3 of 3 alone (6 of 6 tests). This is the Library's own spec, so it is ours: look for a request the test makes to a server that is still starting or already closing under load, and give the test a readiness wait instead of a fixed timeout.

- [ ] @anyone 2026-09-29 LAHE-window-goodbye-firefox-flake -- **`test/browser/window_goodbye.spec.js:121` failed once in Firefox under the full three-browser run** ("the second window was granted the review the first one gave back"). It passed 8 of 8 alone on both the Library branch and plain main, so it is a timing flake under load. Look for a fixed wait or a race between the goodbye and the next claim. Same family: `test/browser/quiet_tab_polling.spec.js:276` ("closing a tab while it is unfocused still hands the review back") failed once in Firefox under the full run on 2026-09-29 and passed 3 of 3 alone; the Library branch does not touch it. Also `quiet_tab_polling.spec.js:173` (hidden tab heartbeats) failed once in WebKit under the full run and passed 2 of 2 alone. And `present_mode.spec.js:147` (the chord brings the rail back) the same way in WebKit on the next run, 2 of 2 alone.

- [ ] @anyone 2026-09-29 LAHE-oversized-image-firefox -- **`test/browser/oversized_records.spec.js:101` fails in Firefox every time, on main too.** "an embedded image is stored once, whole" expects the embedded image's data to be over 100000 characters; Firefox encodes the same test image smaller (70394). Passes on Chromium and WebKit. Found by the Library feature's release run; checked on plain main at 32fe22b. Make the test build an image whose size does not depend on the browser's encoder.

- [x] @anyone 2026-09-29 LAHE-lint-duplicate-functions -- (done 2026-10-19: lint check 1b, scripts/lint_duplicates.js) **Lint misses a function declared twice in one file.** `node --check` accepts it, Playwright's parser refuses it, so it only surfaces when the browser suite loads the file. A merge of two branches that each added `validPort` to `static_servers.js` hit this. Add a duplicate-declaration check to `scripts/lint.js`.

- [ ] @anyone 2026-09-28 LAHE-title-recorded-late -- **A page's title is only recorded once someone comments on it.** `review.json` gets page titles from items, so a page that was opened but never commented on has no title, and the Library shows it by folder and file name instead of a name Ken would recognize. Found walking the Library feature. Record the title when a page first connects.

- [x] @claude 2026-09-30 LAHE-markdown-heading-ids -- **Done 2026-10-19, [PR #82](https://github.com/kenxle/live-agentic-html-editor/pull/82):** every heading in a rendered Markdown page carries the id GitHub gives it, so `[text](#some-heading)` links land, on marked and pandoc pages alike. One departure from GitHub: a slug starting with `lahe-` gains `section-`, so a heading cannot take an id the review layer uses. Post-merge gate on main (24074c1) in the cloud container: unit 3,082 pass and 2 fail (both container-only, root and no IPv6), Chromium 912 passed, 0 failed. Spec and progress: [Markdown heading ids](features/20261019.01_markdown_heading_ids/04_progress_markdown_heading_ids.md). Asked for by Ken.

- [ ] @anyone 2026-09-30 LAHE-file-title-edit-contract -- **Tell agents what an edit of the file-name title means.** A Markdown page with no `#` heading shows the file name as its title (`data-lahe-file-title`). Ken decided it stays editable. The agent contract does not say what to do with such an edit; the right move is to add a real top-level title at the top of the source, never to rename the file. Add that line to the contract and every copy of it (skills/lahe/SKILL.md, docs/CONTRACTS.md, test/unit/review_format.test.js), with a seams test. From the free-writing preview.

- [x] @anyone 2026-09-30 LAHE-inject-minified-line -- (done 2026-10-19: the tag goes directly before the closer when markup shares its line) **Serve-time injection puts the script inside `<style>` on minified pages, so the rail never loads.** `placeScriptLine` (`src/shared/script_line.js`) inserts at the start of the line holding the last `</body>`. On a page written as one long line (`...<style>CSS</style></head><body>...</body></html>`) that line starts inside the `<style>` block, so the browser reads the tag as CSS. Seen on the Herald wireframes (personal repo, `docs/features/20260921.01_briefing_app/wireframes/final/`), worked around by putting `</body>` on its own line. Fix: insert directly before the `</body>` match when it doesn't begin its line.

- [ ] @anyone 2026-09-30 LAHE-repaint-caret-one-move-back -- **If a repaint destroys the block in the instant between a click or keypress and the browser's caret-moved event, the caret goes back one move.** Text is kept. Protection prefers the live caret, but a destroyed block leaves none, so it falls back to the snapshot from the last key release. Older than free writing; the plain-edit path has it too. Fix: also update the snapshot on mouse-up. Found by the free-writing checkpoint (`docs/features/20260928.01_free_writing/progress/phase7_fix_h1.md` on branch feat/free-writing).

- [ ] @anyone 2026-09-30 LAHE-untouched-anchor-rewritten -- **New text written after a paragraph the reviewer never touched goes lost if the agent rewrites that paragraph.** Replay cannot find the anchor by its words any more, and it never guesses a location without a card, so the run is marked lost. A fix would find the likely anchor and ask the reviewer with a card before placing the run. From the free-writing flow walk (`docs/features/20260928.01_free_writing/02_architecture_free_writing.md`, BB2).

- [ ] @ken 2026-09-29 LAHE-tiptap-later -- **Discuss a Tiptap integration after free writing ships.** Free writing uses Lahe's own editing code (architecture AQ1). Tiptap failed where it meets an existing block (caret, selection, Backspace, undo), but brings rich paste, mature undo, and IME handling. Open question from Ken: how hard would it be to adjust Tiptap's source to span existing blocks, and what else would it bring. Evidence: `docs/features/20260928.01_free_writing/02_architecture_free_writing.md` AQ1 and the two spike results it cites.

- [ ] @anyone 2026-09-28 LAHE-fixture-specs-one-lane -- **Specs that only inject records still run in all three browsers at every checkpoint.** They test no engine behavior, so two of the three runs buy nothing and cost battery. Raised by the free-writing testing review (T28), rejected there because the lane rule is repo-wide. Proposal: tag such specs and run them in Chromium only on gate:all; needs Ken's okay since it changes the checkpoint rule in CLAUDE.md.

- [ ] @anyone 2026-09-28 LAHE-early-rebuild-no-reload -- **A rebuild that lands in the first few seconds after a page load or commit never reloads the page.** The page reloads itself only once it has seen a file time from the helper, and that takes a few seconds. A rebuild written before then becomes the page's starting point (`src/layer/sync.js` `noteTargetMtime`). Found while reproducing the free-writing formatting cases; a real agent is rarely that fast, so it is rare. Fix: take the first file time at page load, before any commit.

- [x] @anyone 2026-09-28 LAHE-markdown-link-schemes -- (done 2026-10-19, see the row at the top) **The Markdown renderer lets through link types beyond http, https, mailto, and tel.** A `javascript:` link in a reviewed Markdown file renders as a live link. Found while revising the free-writing architecture. Fix: allow only those four types and render any other link as plain text.

- [ ] @anyone 2026-09-28 LAHE-anchor-markup-denylist -- **The sanitizer for anchor markup removes known-bad tags instead of allowing a fixed set.** Anything it does not list gets through. Free writing adds an allowlist for new blocks (`cleanBlock`, see its architecture); the older path should move to the same allowlist. Found by the free-writing security review, SR1.

- [ ] @anyone 2026-09-28 LAHE-rich-paste -- **Keep bold, italic, headers, and lists when a reviewer pastes text written elsewhere.** Out of scope for free writing (`docs/features/20260928.01_free_writing/`). If the Tiptap engine brings it for free, that feature keeps it and this row closes. Otherwise the free-writing architecture records what it would cost, and Ken decides from there.

- [ ] @anyone 2026-09-28 LAHE-main-gate-red-rail-hold -- **Main's CI gate is red, and has been on every main run since 2026-09-23.** On the latest main run (10006e3) the one failure is `test/browser/rail_hold.spec.js:202`, "a held item is invisible to review.json, the wake feed, and the overdue clock": the helper's unanswered count moved while an item was held. It passes locally. Every PR's gate fails on it too (PR #17 did), so "merge only on a green gate" cannot be met until it is fixed.

- [ ] @anyone 2026-09-28 LAHE-render-forge-structure -- **Teach LAHE's Markdown renderer the feature-forge structure, so it is code again and not something each agent hand-writes.** The forge's old HTML build made the nav bar (Crucible, Brief, Architecture, Plan, Wireframes, Progress), the callout boxes (`::: callout-req` and friends), and the reviews section automatic, which is why those docs were consistent. LAHE's renderer shows Markdown as written: it ignores `:::` blocks and has no feature-folder nav, so agents drop or improvise them. Ken wants the structure kept and the St. Clair AI style on top. Related: the forge build's own stylesheet is being moved to the St. Clair style now.

- [ ] @anyone 2026-09-28 LAHE-linked-files-follow-ups -- **Three loose ends from the linked-docs rail code review, left out of that change on purpose.**
  - A file keeps the linking review's editor after the hub drops the link, because the recorded list of linked files never shrinks.
  - The helper and the CLI each read, change, and rewrite a static server's metadata file whole, so two writers at once can drop a recorded linked file. That page then shows read-only until the hub re-renders.
  - The linked-file lookup runs on every reload poll (about once a second per open linked page) with no cache.

- [ ] @ken 2026-09-28 LAHE-pitchhut-listing -- **Keep the PitchHut listing for Lahe up to date.** Ken claimed the project on PitchHut after they reached out: https://www.pitchhut.com/my-projects. It could bring traffic. Update the listing when the npm package or the Product Hunt launch lands, and link it from launch posts.

- [ ] @anyone 2026-09-28 LAHE-idle-battery-cost -- **The battery drains on an idle machine with review tabs open.** Two causes measured: a visible review tab polls the helper once a second whether or not anything is happening, and page servers from finished agent sessions keep running (58 of them, 711 MB, on the day this was filed). Filed with the numbers as [issue 16](https://github.com/kenxle/live-agentic-html-editor/issues/16). Hub row 23 in `docs/features/20260916.05_memory_audit/MEMORY_AUDIT_20260916.md`.

- [x] @claude 2026-09-30 LAHE-lone-paragraph-loses-markup -- **A paragraph written on its own loses its bold and italic.** When the page already carries the rest of an edit's paragraphs, the no-duplicate-text rule writes only the one paragraph the page is missing, and that write goes in as plain text. Bold or italic inside that paragraph is dropped. Fix: derive that paragraph's own markup when the edit's markup splits cleanly along the same breaks. Recorded in `docs/features/20260922.08_no_duplicate_text/NOTES.md`; hub row 24. **Partly fixed on main (e46c1ec, piece-keeps-formatting):** when the bold paragraph is the edit's first, it now keeps its bold. When it is a later paragraph, the edit goes lost with no flag; free writing (`docs/features/20260928.01_free_writing/`) owns that case and closes this row. Done: the later-paragraph case is fixed by free writing (PR #20, 6f3bc6b); the first-paragraph case by e46c1ec. Both are covered by free_writing_r14.spec.js, bold and italic.

- [ ] @anyone 2026-09-28 LAHE-keep-mine-merges-blocks -- **An edit whose words span several blocks merges them into one when the reviewer presses Keep mine.** Older than the duplicate-text fix and not caused by it. Nothing is doubled and a reload restores the structure, so it is a shape problem rather than a lost-work problem. Hub row 25.

- [ ] @anyone 2026-09-28 LAHE-handled-check-review-scope -- **The handled check asks whether the REVIEW moved, not whether the ITEM did.** Before the helper looks for the reviewer's words in the built page, `handled_check.js` `touchedSince` checks whether any file the review is built from has been written since the reviewer committed that wording. So an agent working through five items at once, that really fixed one of them, opens the gate for the other four: a handled claim on an item it never touched passes unchecked. Narrowing it means knowing which file belongs to which item, which the review does not record today. Written down here so the limit is known rather than discovered.

- [ ] @anyone 2026-09-28 LAHE-server-root-hidden-files -- **The page server's own folder still serves hidden files.** Hidden files under a LINKED folder were refused on 2026-09-16 (commit e4346f1), but the served root itself was not covered, so a `.env` sitting inside the folder under review can still be fetched from the local page server. Needs a decision before a fix: a reviewed folder may legitimately need to serve something like `.well-known/`. Found while fixing the linked-folder case; hub row 21.

- [ ] @anyone 2026-09-28 LAHE-linked-docs-rail -- **Following a link to a document in another folder drops the editor, and the fix is specified but not built.** The spec is `docs/features/20260922.02_linked_docs_rail/01_spec_linked_docs_rail.md` on branch `linked-docs-rail`; it is not on main. It has been through a security review, and Ken settled both open calls inside the spec on 2026-09-28. Background and the case that prompted it: `docs/features/20260916.05_memory_audit/LINKED_DOCS.md`. Two findings from its security review have their own rows: `LAHE-server-root-hidden-files` above, and hub row 19 (`source_hint` accepted from a browser). Nothing is built.

- [ ] @anyone 2026-09-21 LAHE-npm-package -- **Publish Lahe to npm so a new user can `npx` it instead of cloning.** Ken, reviewing the new stclair.ai Lahe page: "we should probably make an npm package for it finally". The zero-runtime-dependency rule still holds: the package ships with `dependencies` empty, so installing it pulls nothing else. Open questions: the package name, what `npx lahe` does on a machine with no agent skill installed yet, and how the skill install fits (today `npm run install-skills`). The site's "How to get it" section and the How to use modal change with it.

- [ ] @ken 2026-09-21 LAHE-product-hunt-launch -- **Launch Lahe on Product Hunt.** Ken called the stclair.ai Lahe page ready for it. Likely waits on the npm package above, so the launch post can say one command. Assets exist: the hero illustration loop and the ai-etudes screen recording, both on the site branch `site-lahe-page` in the personal repo.

- [x] @anyone 2026-09-21 LAHE-md-edit-no-rerender (done 2026-09-23: `src/service/rebuild.js`. When the reload poll asks for the artifact's modification time, the helper first asks whether the Markdown behind it is newer, and renders again if it is. Only a Markdown review, and only LAHE's own artifact; a review pointed at the reviewer's build output is never rewritten. Spec: `docs/features/20260923.01_rebuild_not_the_agents_job/`) -- **Editing a Markdown source did not refresh its served page.** A rewrite of `LAHE_HERO_PROMPT.md` in the personal repo still served the old render until `lahe review` was run on the file again. Ken saw the stale page and said so. Check whether the watcher covers Markdown sources.

- [ ] @anyone 2026-09-21 LAHE-anchor-repeated-sections -- **Notes on a page with repeated, near-identical sections all pinned to one spot.** A tear sheet repeated the same hero section four times, each with a different video `src`. Every comment Ken left came through with the same region and "1 of 1", so the agent could not tell which video he meant. The anchor should tell identical sections apart, for example by the media's src or by ordinal.

- [ ] @ken 2026-09-21 LAHE-verify-recent-updates (due 2026-09-22) -- **Check that all the recent editor updates work the way they should.** Ken shipped a lot of changes to the editor and wants a pass confirming each one does what it needs to right now. Ken: "maybe that's a tomorrow thing."


- [x] @claude 2026-09-15 LAHE-ci-failure-email-storm (done 2026-09-15: the throwaway
  branches are deleted from the remote and the rule below is in the repo CLAUDE.md
  and in memory) -- **Ken got seven failed-job emails from GitHub in six hours
  on 2026-09-15 and said so twice.** They came from the afternoon's flake hunt: a
  temporary stress workflow pushed to five throwaway branches (ci/keep-mine,
  ci/cp2-a, ci/cp2-b and friends), two bisect arms cancelled by hand, and two
  main pushes that flaked before the fix landed. GitHub mails the pusher for
  every failed or cancelled run, so a bisect done as branch pushes is a mailbox
  full of red. Rule from here: a stress or bisect run never fails the run. The
  step gets `continue-on-error: true`, the verdict is read from the log or an
  uploaded artifact, and a run is never cancelled by hand. Bisect arms are
  workflow_dispatch inputs (a ref to check out), not branches. Main gets a push
  only after the PR's gate is green.

- [ ] @anyone 2026-09-15 LAHE-graceful-failure-review-timeout -- **graceful_failure.spec.js
  S7 flaked once on main's gate: `lahe review` timed out waiting for its own
  helper on a free port.** One sighting, during the cp2 bisect work. The spec
  runs the real review walk; on a loaded box the spawned helper took longer
  than the command's ready wait. If it recurs: measure the ready wait against
  the helper's startup under load and raise it in the command (or make the wait
  process-table based, the way stopHelper now is), never a retry.

- [x] @claude 2026-09-15 LAHE-cross-browser-lanes-red (done in PR #10: two product fixes, closing the rail now blurs its focused control and never hands focus back to the library host; toast swipe velocity is sampled over a frame and a fling needs real distance; three test races on pane moves) -- **Five browser tests fail on
  Firefox and WebKit and pass on Chromium: in card_collapse, rail_hotkey and
  reply_toast.** Found by the keep-mine builder running the three lanes locally
  on 2026-09-15; identical five against main at 1ecbcae, so they predate that
  branch. The collapsible cards and the rail hotkey were gated on Chromium only.
  The gate:all rule for a release means a v0.2.1 tag waits on this. Run one
  lane at a time (all three together starved the machine on 2026-09-11); fix
  the product where it is a product difference, the test where it is a test
  assumption; never a browser-conditional skip.

- [x] @claude 2026-09-15 LAHE-cp2-walk-caret-reversal (done 2026-09-15 in PR #9: the
  reviewer's live caret outranks a snapshot that is one beat out of date) -- **test/browser/cp2_walk.spec.js
  line 248 failed on main (run 35006451817) with the reviewer's typed sentence at the
  FRONT of the paragraph instead of the end.** Nothing damaged that block: it sits
  outside the morph target. What moved the caret was protection's own layer three. The
  caret is live immediately; selectionchange announces it on a TASK; a MutationObserver
  callback is a MICROTASK and runs first. So any mutation anywhere in the document,
  arriving in that window, reached restore() with the snapshot still naming the old spot
  and put the caret back there. The rule now: the text is whole and the node survived,
  so nothing was damaged, and the snapshot takes the correction rather than the reviewer.

  064ae58 (an owed replay pass runs when any epoch closes) is the AMPLIFIER, not the
  cause, and it was not reverted. Both halves of the bisect say so. On CI, cp2_walk
  failed 2 in 40 on main as it stands and 0 in 40 with 064ae58's src changes reverted,
  which is what made it fire this week. Locally, the new deterministic spec fails on the
  reverted arm exactly as it fails on main, which is what says the bug is older than that
  commit. What 064ae58 did was add replay passes during an open edit session, and every
  pass repaints the rail, which is one more mutation landing in the window.

  A second, separate failure showed in the same stress and is fixed here too: the walk
  waited for "any event for this item is on disk", which the first DRAFT satisfies, then
  read the last event and called a half-typed sentence a truncation. It now waits for
  the ready event. 90 for 90 on a loaded CI box and 40 for 40 locally on four workers,
  which is where it was failing.

- [x] @claude 2026-09-15 LAHE-reload-claim-flake (done 2026-09-15 in PR #6: a release now
  leaves its secret behind for five seconds, and a claim carrying it is seated again
  with that same secret) -- **test/browser/reload_claim.spec.js "reloading the page over
  and over never refuses it" failed once on main and 3 in 20 under stress: the window
  came back read-only with one window open.** The wire trace says a claim from the
  incoming page landed after the outgoing page's goodbye, was read as a stranger, and
  was granted a FRESH secret whose answer that dying document never read. Nobody alive
  held it, so the next page in the tab was refused by D5's guard. 40 repeats and 3 full
  browser suites green on the fix; test/unit/window_release_race.test.js replays the
  trace and fails on the old code.

- [x] @claude 2026-09-15 LAHE-keepalive-cap-flake (done 2026-09-15 in PR #9: while a
  document is leaving, the keepalive cap belongs to the moment and not to the caller)
  -- **test/browser/editing_navigation.spec.js
  "an edit past the keepalive cap is absent at unload and present after the next load"
  failed twice on Linux CI, on "a body past the keepalive cap does not go out at unload":
  a ready event for the oversize edit was already in events.jsonl when the second page
  booted.** The oversize guard was never wrong; it was not the only door. Committing on
  navigation deliberately asks for no immediate flush, and queues the event on the
  ordinary 750ms debounce instead. That timer keeps running while the old document is
  alive, and a document stays alive from beforeunload until the browser has fetched the
  next page. Slower than 750ms and the ordinary flush fired, and an ordinary flush
  carried no cap.

  The fix: `leaving` is `fo.unload || unloading`, and it decides four things that used
  to key off the caller alone: the size cap, the keepalive header on the request,
  whether a partial drain schedules another flush, and whether a failure schedules a
  retry. An ordinary flush firing during unload now behaves exactly like the unload
  flush: an oversize body refused, a small one sent with keepalive so it survives the
  teardown instead of racing it. Refusing the ordinary flush outright was the first
  attempt and it was too blunt: it cost the link-click case its one delivery, on a page
  whose next address carries no credential to re-post from.

  The new spec dispatches beforeunload, leaves the document standing, and asks the
  timer's own door for itself rather than sleeping out the debounce. Its control is
  pageshow, after which the same body lands on an ordinary flush with no cap on it,
  whole. 240 for 240 on a loaded CI box; the old code reproduced it there and fails the
  new spec every time locally.

- [x] @claude 2026-09-15 LAHE-keep-mine-morph-flake (done 2026-09-15 in PR #8) -- **test/browser/keep_mine_live_page.spec.js
  "Keep mine survives every later morph pass" failed on Linux CI at morph pass 14
  (PR #5) and pass 13 (main run 34999862248), and passed on rerun both times.**
  Reproduced once in sixty CI runs with a probe attached, and the probe named it:
  the morph landed at t=4237 and replay put the reviewer's sentence back at
  t=4246, nine milliseconds later, and the test's one sample of that pass was
  taken inside those nine milliseconds. A test race, not a product one.

  The gap was structural rather than unlucky. The spec sampled the page every
  20ms, bucketed by the fixture's morph counter, and stopped as soon as it had
  seen eight passes, so the LAST bucket always held exactly one sample and was
  then asserted like the others. Every sighting failed on the last bucket. The
  fix drives the morphs one at a time and reads the page's own morph event for
  what each morph left behind, so nothing about the claim depends on when the
  test looked.

  Found on the way: a repaint whose replay pass was refused during a write epoch
  that was NOT replay's own (an edit session, a format command, an undo,
  protect's restore) had its pass remembered and never run. Fixed in the same PR
  by giving the epoch an onIdle listener. Not the cause of this flake, since
  protect's observer is inert once the edit session closes, but real.

- [ ] @anyone 2026-09-15 LAHE-change-mark-cycling-block -- **A page element that cycles
  through a small set of values can be painted as the agent's change.** The change
  mark tells the page's own moving parts from the agent's edits by reading the
  page twice before a reload and excluding whatever differed between the two
  readings. A block that alternates between two sentences can hold the same one
  at both readings and slip through; the short-numeric counter guard does not
  cover words. Found making CI green on 2026-09-15 (the fixture's status line was
  a coin flip on Linux; the fixture was changed, the product was not). Options:
  read three times instead of two, or remember self-changing blocks across
  reloads per page path (a block seen to change on any earlier load of this page
  stays excluded). Real on macOS too; timing there is just kinder.

- [x] @claude 2026-09-15 LAHE-add-command-test-flake (done 2026-09-15 in PR #4: stopHelper waited on a fetch to a server it had just killed; it now waits on the process table) -- **test/unit/add_command.test.js
  intermittently dies on Linux CI with "Promise resolution is still pending but the
  event loop has already resolved", cancelling its other 27 tests.** Passes on
  rerun and 5 for 5 locally. Find the unawaited promise (a spawned helper or a
  timer left open after the first test) and close it, so the gate stops emailing
  Ken for a flake.

- [x] @claude 2026-09-14 LAHE-serve-restart-detaches -- **Done 2026-10-22 with LAHE-serve-restart-foreground.** See [the spec](features/20261022.02_board_small_fixes_two/04_progress_board_small_fixes_two.md). Was: **`lahe serve --restart`
  runs the new helper in the caller's foreground; it should spawn it detached the
  way `lahe session` does (child_process.spawn with detached and unref).** Found
  restarting the helper onto 0.2.0 on 2026-09-14: the replacement helper was a
  child of the orchestrator's shell and would have died with the session. Note
  for anyone doing it by hand: macOS has no `setsid`; use the CLI's own spawn
  path (session.js startHelper). Also: a stop that takes longer than 30 s drops
  every persisted window holder as quiet (`windows.json` restore), so the
  replacement should start within that window; `--restart` should stop and start
  in one process so the gap is milliseconds.

- [x] @anyone 2026-09-11 LAHE-default-doc-style -- **The St. Clair AI documentation
  style becomes the default look for new documents LAHE puts in front of Ken.**

  **Done 2026-09-16** (spec and progress: `docs/ongoing/DOC_STYLE_BUILD.md`). The
  three open questions were decided this way:

  1. The fonts are vendored under `vendor/stclair-doc-style/fonts/`, so nothing is
     fetched at runtime and the system stacks stay as fallbacks.
  2. Light only. The renderer's `prefers-color-scheme` dark palette is gone and
     `color-scheme: light` is declared in its place.
  3. One vendored copy reached two ways: inlined into rendered Markdown so a page
     saved to disk stays self-contained, and served at `.lahe-doc-style.css` for
     pages an agent writes, using the basename fallback `static_servers.js`
     already had for the Mermaid script.

  After the fingerprinting build (docs/ongoing/FINGERPRINTING_BUILD.md) lands.
  Ken: "Lately I've been getting a lot of brand new documents generated just to
  throw things in front of me to look at and comment on, and I love it. I want
  the St. Clair AI style for documents to be the default for those new ones.
  Anything that's already styled is already styled; we don't touch that."

  The style source is `~/Documents/workspace/personal/projects/agent_storefront/STYLE_GUIDE.md`
  (summary, 2026-09-09) with `brand/BRAND_KIT.md` and `site/index.html` as the
  reference implementation. Colors: ink #1f1e1a, ink faint #6b6860, white ground,
  purple #46188c as the one accent, cobalt #0760c7 for structure, cobalt tint
  #e6effc for code blocks and table headers, sage #8fb5a0 bullets, sage tint
  #e7f1ed for blockquote panels, link #6d28d9. Type: Schibsted Grotesk 600/700
  headings in sentence case, Hanken Grotesk 400/500 body at 17 to 18px, line
  height 1.55 to 1.6, measure 62 to 68ch. Tables over callouts, full borders,
  tinted header row, no zebra. Never: em dashes, pills, gradients, single-side
  colored borders, shadows, all caps, stretched type.

  Two surfaces, and the rule for each:

  1. The Markdown renderer (`src/service/markdown.js`, the inline stylesheet
     around line 135). Every `.md` LAHE renders gets the style. This is the
     default for an unstyled document, so it is the whole of "new documents"
     for Markdown.
  2. Agent-authored HTML review pages. The lahe skill tells an agent that a page
     it writes to put in front of Ken links one stylesheet the helper serves
     (a `/lahe-doc.css` route, or a copy under a shared-assets skill; decide
     which survives the zero-dependency rule and a page later saved to disk).
     A page that already carries its own styles is never touched: the rule is
     only for pages the agent is about to author.

  Constraints: zero runtime dependencies and no network at runtime, so the two
  fonts are either vendored under `vendor/` (both are OFL) with a system fallback
  stack, or the default uses the fallback stack and the fonts load only when the
  page can reach them. Decide, and say which in the README. Light and dark:
  the guide is light-only; the renderer currently supports `prefers-color-scheme`
  dark, so either derive a dark palette from the guide's ink and tints or keep
  dark as the current system look and document that the brand style is light.
  Mermaid diagrams keep working. The rail's own chrome is not part of this.

- [ ] @anyone 2026-09-16 LAHE-helper-boot-storm -- **Every helper restart re-reads
  every review log (654 MB today) and rewrites every review.json before it can
  answer, blocking every open page for minutes.** Seen 2026-09-16 17:28 after two
  restarts in a row; pages said "helper not available"; a force-kill mid-pass only
  restarted the pass. Cause: `tick()` in `src/service/projection.js` discovers all
  reviews and regenerates each on the first tick. Fix: project lazily on first
  request per review, keep the folded projection in memory and apply new events to
  it, and compact or archive closed reviews' logs. This is fix 2 in
  docs/features/20260916.05_memory_audit/MEMORY_AUDIT_20260916.md. Architecture-level: brief first.

- [ ] @anyone 2026-09-16 LAHE-wireframe-skill-guidance -- **The wireframing skill
  needs firmer guidance on how it lays out a set of pages.** Ken (2026-09-16, on
  the static-site decision page): "the wireframes have been kind of all over the
  place every time they get generated. It seems like we need to give a bit more
  guidance." Separate from how LAHE serves the folder (LAHE-static-site-folder);
  wanted regardless. The skill lives in `~/.claude/skills/magic-mirror`.

- [x] @anyone 2026-09-16 LAHE-static-site-folder (done 2026-09-16: the rail follows the reviewer onto any page the session's static server serves; `--only` isolates one page; see docs/ongoing/STATIC_SITE_FOLDER.md) -- **A folder of linked HTML pages
  has no row of its own, so the rail does not follow the reviewer between pages.**
  Seen 2026-09-16 on a set of wireframe pages: `lahe review <dir>` takes the
  dev-server row (registers an origin, prints a script line to paste into a
  layout), which is wrong for plain files with no layout. The agent's fallback was
  to run `lahe review <page> --session <id>` once per page, which works but is
  fragile: a page nobody enrolled has no rail, a page added later is missed, and
  the static server only injects into paths recorded in a review's meta.json
  (`injectForMatch` in `src/service/static_servers.js`). Ken: "seems suboptimal or
  incorrect... fragile." Wanted: a static-site row where `lahe review <dir>` of a
  folder of HTML serves the folder and injects the rail into every HTML page under
  it as one review that spans pages, with the session-owned static server doing
  the matching by root rather than by enrolled path. Decision page:
  `docs/ongoing/STATIC_SITE_FOLDER.md`. Ken set the rule 2026-09-16: anything our
  own static server serves gets the rail; page-specific threads stand.

- [ ] @ken 2026-09-11 LAHE-organic-discovery -- **Someone found LAHE on their own,
  days after launch.** A student in Ken's Columbia class searched, found the tool,
  and brought it up in class. Nobody pointed them to it. Ken: "i just launched it,
  but people are already finding it. i need to keep working on it." Worth deciding
  what the first outside user should hit: the README, the install path, and whether
  the anchoring and stabilization passes come before any wider announcement.

- [ ] @anyone 2026-09-11 LAHE-stabilization-pass (unblocked 2026-09-11 23:15: the anchoring work has landed) -- **A cleanup, architecture, and
  code review pass over everything that landed 2026-09-08 to 2026-09-11 without
  a brief.** **Deadline: land before Monday 2026-09-14.** Ken's second stclair.ai
  article (the chat window piece) publishes that day and links here, so LAHE gets
  more traction right after; Ken (2026-09-11): "we need to finish the article and do
  a cleanup pass on the lahe editor since it will get more traction after this." Ken: "I've been throwing so many things at you for this without
  really briefing them or specing them out, so we may need to do a pass of
  cleanup and architecture and code review." What landed in that window, each
  as a bug report turned straight into a builder dispatch:

  - the reply toast (message, X marks read, neglect rule, top-right, fade)
  - the page hotkey fence at the shadow boundary
  - the page-check reopen loop guard (region.check_reopen)
  - `lahe reply`, and the contract sentences that go with it
  - superseded duplicate replies ignored on fold
  - steady in-place reload (viewport by block text, hide-and-fade)
  - attention highlight on changed blocks (multiset block diff in sync.js)
  - window holders persisted across a helper restart (windows.json), heartbeat
    debounce, the live-reviewer guard on helper replacement, `serve --restart`
  - the selection pill held back during a drag
  - reload deferred while the reviewer is interacting; rail restored after a
    LAHE reload

  What the pass should do: read each against the architecture doc (D5, D7, D8,
  D12 in particular); decide whether sync.js has become a dumping ground (the
  block snapshot and diff, the steady-reload functions, and the rail-state save
  all landed there because manifest.js is frozen and a new file needs the
  orchestrator); propose the file moves and the manifest edit; run review-code-lead
  and review-security on the diff (windows.json holds session secrets on disk;
  the neglect toast and interaction tracking add document listeners); fold the
  decisions into the architecture doc as amendments rather than rewriting it;
  then rebuild and commit dist once, after the anchoring work lands.

  Not before the anchoring pass: that work is in flight in anchor.js, pointing.js,
  markers.js, regions.js and has two red browser specs on main that are its own.

- [ ] @anyone 2026-08-25 LAHE-project-setup-file -- **A pointer to a
  per-project `.lahe-setup.md`, so an agent that works out how to wire LAHE into
  a given repo can leave that knowledge for the next one.** Proposed wording for
  AGENTS.md, near the wiring instructions: "Before wiring LAHE into an app, look
  for `.lahe-setup.md` at that repo's root. If it exists, follow it. If it does
  not and you work the setup out, write it there so the next agent does not have
  to." Ship a stub template with it, since an empty file gets skipped: headings
  for how a server is started here, where the review id and token go, what needs
  restarting after, and gotchas.

  WHY: three cold agents ran the full worktree-plus-LAHE lifecycle in the Steady
  Thread repo on 2026-08-25, and each independently worked out the same
  non-obvious step (the server must be restarted after the values are written,
  because the env file is read once at boot) by getting an empty page first. That
  knowledge died with each agent. Two of the three never opened the project's own
  skill at all; both landed in the app's code comment instead, one by grepping the
  tree for anything named lahe. So the pointer has to sit where LAHE's own docs
  are read, and the content has to live with the project.

  What varies per project is not the framework. Steady Thread is an ordinary Rails
  monolith. It is the local conventions: how a server is started there (a worktree
  script, not `rails s`), how it is restarted, and where that project chose to put
  the two values. An agent that knows the framework cold still cannot guess those.

  Keep machine-level setup separate from project-level. A single shared file mixes
  one project's instructions into another's review.

- [x] @claude 2026-08-20 LAHE-live-review-polish -- two days of Ken's live
  feedback, worked through the tool itself: composer auto-grow with a
  feedback-free measuring twin (no jitter), drag handle, Send and Delete
  buttons; unread-reply attention system (user_needs_to_see_reply flag,
  per-tab badges, collapsed-pill jewel, fresh-for-the-visit markers);
  click-a-card-to-jump with anchor edge cases; handled-fold clears the
  lost-anchor badge so a card cannot say the fix worked and did not work.
- [x] @claude 2026-08-20 LAHE-md-local-links -- linked local Markdown renders
  as pages hop to hop (contract 12); cross-folder links mount read-only under
  home with symlink and dot-path refusals and a 16-dir cap; unservable links
  go politely inert; the contract now says on-disk links are source-true and
  never rewritten for the browser.
- [x] @claude 2026-08-20 LAHE-session-discovery -- lahe session list plus the
  "a LAHE session is not your host's session" disambiguation, after an agent
  hunted Claude sessions when told to claim the lahe ones.
- [x] @claude 2026-08-20 LAHE-agent-discipline -- contract now names the
  literal Monitor persistent:true parameter (a 300s-timeout monitor woke a
  model every five minutes all night), makes the watching agent an
  orchestrator first (new feedback preempts work in flight), and carves
  handled hand-edits out of doc-wide sweeps with revert detection reopening
  a clobbered edit on the next page load.
- [x] @claude 2026-08-19 LAHE-monitoring-rewrite -- the cross-agent wake
  architecture: per-session append-only wake feed for tail -f hosts, monitor
  exit codes 5/6 and heartbeats, watching/working/unattended liveness in the
  rail, redelivery-until-reply with no seen ledger, per-host launch modes
  (Claude persistent Monitor, Codex pending exec, Antigravity background
  task). Proven live end to end; design record in
  docs/features/20260818.01_release_readiness/.
- [x] @codex 2026-08-18 LAHE-idle-energy -- the shared helper no longer scans
  every accumulated review folder four times per second. Active page polls,
  status reads, and browser event appends fold their review directly; a
  five-second background scan remains for inactive reviews and direct file
  readers. With 15 review folders, the old live helper measured 7 to 9 percent
  idle CPU and the isolated fixed helper measured 0.0 percent in the sampled
  process snapshot.
- [x] @codex 2026-08-18 LAHE-thread-follow-up -- (Ken, 2026-08-18) after an
  agent answers, the reviewer needs a visible continuation box that sends a new
  message in the same thread. Preserve the original reviewer turn and agent
  answer; do not make `Reopen` silently erase or reword the first turn. Define
  separate, clear behavior for following up versus reopening an unlanded issue.
  Done: completed exchanges remain chronological history, follow-up drafts stay
  private until submitted, submission is outbox-first, refused windows cannot
  mutate them, and `Reopen issue` cannot discard a nonempty draft.
- [x] @codex 2026-08-18 LAHE-anchor-copy-truthful -- replay now preserves the
  actual no-match, ambiguous-match, or structure-only verdict instead of
  collapsing all three into a claim that the element no longer exists. The
  rail uses neutral, element-agnostic copy and clears the badge when the target
  can be attached again.
- [x] @codex 2026-08-18 LAHE-reload-viewport-continuity -- LAHE's own
  hashless auto-reload now performs one instant, exact viewport restore and
  keeps native restoration manual through `pageshow`, preventing the visible
  top-then-scroll sequence. Fragment URLs, back/forward, bfcache, and denied
  storage retain browser-owned behavior. Verified in Chromium, Firefox, and
  WebKit.
- [ ] LAHE-change-highlight-fade @anyone -- (Ken, 2026-08-18) after a source
  rebuild removes an addressed highlight, briefly highlight the changed text
  and fade it out so the reviewer can see what landed without losing their
  reading position. Treat this as a separate enhancement after reload position
  and rail-state continuity are reliable.
- [x] @codex 2026-08-18 LAHE-rail-remembers-collapsed -- (Ken, 2026-08-18) the rail
  overlays the text he is reading, so he collapses it; every reload (incl.
  the new auto-reload, which makes this constant) pops it OPEN again and he
  closes it over and over. Persist the open/collapsed state per review in
  browser storage and restore it on load; the count pill already carries the
  numbers while collapsed. Done: the versioned per-review preference survives
  remounts and reloads; refusal expansion remains transient.
- [x] @claude-fable 2026-08-18 LAHE-push-and-pr -- push `fix/review-session-flaws` and open the
  PR. Blocked only on Ken's word. Done: pushed, PR #1 open: https://github.com/kenxle/live-agentic-html-editor/pull/1 (44 commits, gate 467/206/0). The branch is twice code-reviewed, gate
  green (471 unit / 204 browser at last full run), and hand-verified in a
  real browser including error states.
- [ ] LAHE-review-command @anyone -- **the out-of-box front door: `lahe review
  <page.html>`** serves the page's folder from the helper (read-only, local),
  registers the origin itself, and prints ONE url to open. Kills the last
  agent-dependent setup step (hand-rolled http.server + --origin), which is
  where the whole origin-trap class came from. This is the biggest gap
  against the public-release bar.
- [ ] LAHE-ci-gate-red-on-main @anyone (2026-08-24, surfaced by the weekly email
  scan) -- **the `gate` workflow is failing on `main`.** Roughly 20 "Run failed:
  gate" notifications landed between Aug 20 and Aug 23, on `main` and on
  `feat/normal-path`. This blocks [[LAHE-cold-start-proving-run]] in practice:
  the launch post tells people to clone the repo and hand it to their agent, and
  the first thing a visitor sees on the repo page is a red badge. Find out
  whether the gate itself is broken or it is catching something real, then fix
  it before the post goes out.
- [ ] LAHE-cold-start-proving-run @anyone -- the release gate: on a fresh
  state dir, walk a simulated stranger through ONLY the public README +
  AGENTS.md (no session knowledge): install -> review a doc -> comments ->
  agent replies -> rebuild -> export, plus re-verifying the session's
  edge-case matrix (origins, offline, second window, multi-doc, hot reload,
  stuck drafts) on that cold path. Publish only after this passes.
- [ ] LAHE-doc-pass @anyone -- comprehensive documentation pass once the
  in-flight heal work lands: skill (~/.claude/skills/lahe),
  AGENTS.md, README, docs/CONTRACTS.md, and the review.json contract field
  (+ its restated test copy + dist rebuild, per the pairing rule in
  CLAUDE.md), all cross-checked against the session record's feature list.
  One keep-up mechanism only (`status --json --seen-file`); `wait` is gone.
- [ ] LAHE-chip-registry @anyone -- structural fix for the session's
  worst bug class (a standing chip outliving its condition, fixed FOUR times:
  origin, lost-anchor, second-window, limit note): a registry in the chip
  layer where every persistent failure code must name its clearing condition,
  and `failures.add` fails loud in the gate on a standing code with no
  registered clearer. Design sketch in the page-scope agent's report.
- [ ] LAHE-cleanup-batch @anyone -- the deferred deletions, one approval, one
  batch: `check.tmp.mjs` (also untrack: it slipped into a commit),
  `sbcheck.tmp.mjs`, `test-results/`, the dead assets-hunting code in
  add.js (`assetDirBeside`, `libraryForServer`, `libraryFor`,
  `ASSET_DIR_NAMES`), and `/tmp` scratch from the debug runs
  (`/tmp/lahe-base`, `/tmp/lahe-head`, `/tmp/*.keep*.js`, probe specs).
- [ ] LAHE-multipage-offline-path @anyone -- small punt from the service
  wave: the no-helper disk path in `add` still records only the LAST page's
  target_path, so a multi-page review assembled entirely offline
  under-records paths (helper path is correct). Also: non-loopback --origin
  values now work only via the disk path (intended narrowing of
  review.write); needs one plain sentence in the docs.
- [ ] LAHE-stale-highlight-registry @anyone -- flagged by the lost-anchor
  agent: a removed passage keeps its id in `paintedIds()` with a collapsed
  range. Cosmetic-adjacent, untested territory; its control test asserts on
  the DOM to sidestep it. Worth one focused unit.
