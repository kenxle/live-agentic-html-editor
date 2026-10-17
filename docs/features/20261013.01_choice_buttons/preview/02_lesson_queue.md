# Lesson queue: 19 waiting

**On hold.** You're holding the other 16 until LAHE has choice buttons. The Personal board's Waiting For row "Finish the lesson queue review once LAHE's choice buttons ship" brings it back. The recommendations below stand.

**What I recommend.** Promote all of them except two. Both discards are lessons that stopped being true: LAHE fixed one, and the lahe skill changed past the other. I checked each lesson against the current code before recommending it.

**Done so far.** Promoted three: the CSS counter lesson, the Gmail draft lesson, and the research_ prefix dossier lesson. CLAUDE.md now links to the Gmail lesson's new path. Scry's draft-reply step now says to write drafts in HTML. Herald writes plain-text drafts too, so that fix is a row on the Personal board.

Each section below starts with the problem: what an agent sees, and what goes wrong because of it. Then the fix, then my recommendation.

Updated 2026-10-13 23:49.

## google

### A calendar query across all accounts silently drops some accounts

**The problem.** An agent asks the calendar tool for every account at once. The tool says it merged four accounts and returns one event for the week. Asking the Columbia account alone returns the Friday class, a travel block, and a planning meeting. Nothing in the merged result says an account came back empty, so the briefing told you the day was clear when it wasn't.

**The fix.** Ask each account separately, and treat zero events from a usually busy account as a failure to check.

**Recommend: promote.** I will fix its `status` field, which says `proposed` where the store needs `live`.

[The proposal](../../lessons/proposed/a-calendar-query-across-all-accounts-silently-drops-accounts.md)

<div class="choice" data-choice="lesson-a-calendar-query-dbcb82b">
  <p class="choice-q">What should happen to this lesson?</p>
  <button type="button" value="promote" data-recommended>Promote</button>
  <button type="button" value="discard">Discard</button>
  <button type="button" value="merge">Merge</button>
</div>

### A plain-text Gmail draft gets hard-wrapped when you send it

**The problem.** A draft I write looks normal in Gmail, each paragraph one flowing line. You send it, and the copy that arrives has a hard line break every 70 or so characters, mid-sentence.

**The fix.** Give the draft an HTML body as well as the plain text.

**Done: promoted.** It is now `docs/lessons/google/`. CLAUDE.md links to it there, and scry's draft step says to write HTML.

## docs-and-decks

### A CSS counter ignores an ol start attribute

**The problem.** A numbered list in the style draws its own numerals. A list written to start at 9 shows 1., 2., 3. instead. Nothing warns, and the page looks finished. The obvious repair gets the numbers right but knocks that one list's numerals out of line with every other list on the page.

**The fix.** Feed the start number into the counter, with a fallback for browsers that can't.

**Done: promoted.** It is now in `docs/lessons/docs-and-decks/`.

### A report-folder document not named research_ never reaches the dossier

**The problem.** A document sits in the report folder, committed, with a proper heading, and it is missing from the built dossier. The build prints "1 report + 11 appendices" and says nothing about the file it skipped. A requirements document went unreviewed this way, because the dossier looked complete.

**The fix.** Name extra files in the build's `--order` list, and check the appendix count after every build.

**Done: promoted.** It is now in `docs/lessons/docs-and-decks/`.

### A reveal.js slide timer restarts on every page load

**The problem.** During a 30-minute timed exercise in class, I edit a slide and rebuild the deck. The page reloads and the clock on the projector jumps back to 30:00 while the room is 26 minutes in.

**The fix.** Pin the end time on the slide for that session, then take it out afterwards.

**Recommend: promote.** The Columbia decks still carry this timer code.

[The proposal](../../lessons/proposed/a-reveal-js-slide-timer-restarts-on-every-page-load.md)

<div class="choice" data-choice="lesson-a-reveal-js-slide-578dfee">
  <p class="choice-q">What should happen to this lesson?</p>
  <button type="button" value="promote" data-recommended>Promote</button>
  <button type="button" value="discard">Discard</button>
  <button type="button" value="merge">Merge</button>
</div>

### LAHE serves slides.md as a rendered page, so a reveal.js deck shows as one long slide

**The problem.** A deck that loads its slides from `slides.md` is served for review. You get one tall page with every slide and its speaker notes stacked, and the counter reads 1 / 1. The same deck from a plain server works. LAHE turns every `.md` request into an HTML page, so the deck never gets the Markdown.

**The fix.** Review the compiled single-file deck, and recompile after every edit.

**Recommend: promote.** LAHE still has no way to return the raw Markdown.

[The proposal](../../lessons/proposed/lahe-serves-slides-md-as-a-rendered-page-so-reveal-shows-one-long-slide.md)

<div class="choice" data-choice="lesson-lahe-serves-slide-4ed1164">
  <p class="choice-q">What should happen to this lesson?</p>
  <button type="button" value="promote" data-recommended>Promote</button>
  <button type="button" value="discard">Discard</button>
  <button type="button" value="merge">Merge</button>
</div>

### Pandoc writes a fenced div that opens with a heading as a section

**The problem.** In a forge doc, every callout gets its panel and label except one, which comes out as plain text. Nothing errors. That callout's first line was a heading, and pandoc wrote it as a `<section>` where the build was looking for a `<div>`. From last night's work.

**The fix.** Turn those sections back into divs before styling callouts.

**Recommend: promote.**

[The proposal](../../lessons/proposed/pandoc-writes-a-fenced-div-that-opens-with-a-heading-as-a-section.md)

<div class="choice" data-choice="lesson-pandoc-writes-a-f-7dcf2da">
  <p class="choice-q">What should happen to this lesson?</p>
  <button type="button" value="promote" data-recommended>Promote</button>
  <button type="button" value="discard">Discard</button>
  <button type="button" value="merge">Merge</button>
</div>

### Plotly draws empty axes for a chart type the bundle lacks

**The problem.** A report chart shows its title, axes and legend with no bars or lines in it. No console error. The report's final check counted it healthy: with five charts broken this way, it reported zero failures. The template loads a small Plotly bundle, and a chart type it lacks is skipped without a word.

**The fix.** Check the type is loaded before drawing, and write an error the check can see. The template now does this. The lesson also lists which chart types authors can use.

**Recommend: promote.**

[The proposal](../../lessons/proposed/plotly-draws-empty-axes-for-a-trace-type-the-bundle-lacks.md)

<div class="choice" data-choice="lesson-plotly-draws-empt-410c66e">
  <p class="choice-q">What should happen to this lesson?</p>
  <button type="button" value="promote" data-recommended>Promote</button>
  <button type="button" value="discard">Discard</button>
  <button type="button" value="merge">Merge</button>
</div>

### Screenshotting a served LAHE page takes the review away from you

**The problem.** You are reading a page in LAHE. An agent points a headless browser at the same served address to take a screenshot. Your review disappears from your screen, because LAHE counts the agent's browser as a second window on the review. The agent's screenshot succeeds, so it never knows.

**The fix.** Screenshot the built file on disk, never the served address.

**Recommend: promote.** LAHE still refuses or takes over a second window on the same review.

[The proposal](../../lessons/proposed/screenshotting-a-served-lahe-url-takes-over-the-reviewers-session.md)

<div class="choice" data-choice="lesson-screenshotting-a-a9d467a">
  <p class="choice-q">What should happen to this lesson?</p>
  <button type="button" value="promote" data-recommended>Promote</button>
  <button type="button" value="discard">Discard</button>
  <button type="button" value="merge">Merge</button>
</div>

### The International Style's line length applies only inside a sheet

**The problem.** A page built outside LAHE has the right fonts and colours, but its paragraphs run the full 1080px width instead of stopping at 68 characters. Tinted blocks run wider than the text beside them. The same Markdown served by LAHE looks right. This is why forge docs lost the line length. From last night's work.

**The fix.** Wrap the content in `main > section.sheet`, the way LAHE's renderer does.

**Recommend: promote.**

[The proposal](../../lessons/proposed/the-international-style-reading-measure-applies-only-inside-a-sheet.md)

<div class="choice" data-choice="lesson-the-international-b2e94a8">
  <p class="choice-q">What should happen to this lesson?</p>
  <button type="button" value="promote" data-recommended>Promote</button>
  <button type="button" value="discard">Discard</button>
  <button type="button" value="merge">Merge</button>
</div>

### lahe review can silently attach to another agent's review

**The problem.** You leave several comments. The agent's drain shows nothing, so it never answers them. The page had been attached to an older review owned by a different, closed agent session, and LAHE said nothing about it.

**The fix.** Find the review's real owner and read it directly.

**Recommend: discard.** LAHE fixed it. It now refuses with a message naming the session that owns the review, so the trap is no longer silent.

[The proposal](../../lessons/proposed/lahe-review-serves-can-silently-attach-to-a-different-agent-sessions-review.md)

<div class="choice" data-choice="lesson-lahe-review-serve-1db923b">
  <p class="choice-q">What should happen to this lesson?</p>
  <button type="button" value="promote">Promote</button>
  <button type="button" value="discard" data-recommended>Discard</button>
  <button type="button" value="merge">Merge</button>
</div>

### The Monitor tool has no persistent setting

**The problem.** The lahe skill told agents to pass a `persistent` setting to the Monitor tool. The setting doesn't exist, so the watcher expired every 30 minutes. The lesson also says the `lahe monitor` command got killed for low memory.

**The fix it proposes.** Use the Monitor tool and re-arm it every 30 minutes.

**Recommend: discard.** The lahe skill no longer gives that instruction. It now uses `lahe monitor` in one background command, which ran without trouble through this whole session. Keeping the lesson would steer agents back to the older approach.

[The proposal](../../lessons/proposed/the-monitor-tool-has-no-persistent-parameter.md)

<div class="choice" data-choice="lesson-the-monitor-tool-b95cf10">
  <p class="choice-q">What should happen to this lesson?</p>
  <button type="button" value="promote">Promote</button>
  <button type="button" value="discard" data-recommended>Discard</button>
  <button type="button" value="merge">Merge</button>
</div>

## infra

### A scheduled job ran overnight only because the Mac never slept

**The problem.** Herald's 6 AM run finished on time with the screen dark, so it looked like scheduled jobs run while the Mac sleeps. They don't. An open Claude Code session kept the Mac awake all night. On a night with no session open, the Mac sleeps and the morning run is skipped, with nothing to catch it up.

**The fix.** Schedule the Mac to wake a few minutes before the job.

**Recommend: promote.**

[The proposal](../../lessons/proposed/a-scheduled-job-on-the-laptop-ran-overnight-only-because-the-mac-never-slept.md)

<div class="choice" data-choice="lesson-a-scheduled-job-o-77d2ee2">
  <p class="choice-q">What should happen to this lesson?</p>
  <button type="button" value="promote" data-recommended>Promote</button>
  <button type="button" value="discard">Discard</button>
  <button type="button" value="merge">Merge</button>
</div>

### A worktree with no start point branches from whatever the clone has checked out

**The problem.** A builder's work comes back green, but its pull request won't merge because of conflicts. The branch started from an old checkout instead of main, and one of the commits it was missing was the same change the builder had just rebuilt.

**The fix.** Fetch, and start every worktree from `origin/main` by name.

**Recommend: promote.**

[The proposal](../../lessons/proposed/a-worktree-with-no-start-point-branches-from-the-clones-checked-out-head.md)

<div class="choice" data-choice="lesson-a-worktree-with-n-75f492d">
  <p class="choice-q">What should happen to this lesson?</p>
  <button type="button" value="promote" data-recommended>Promote</button>
  <button type="button" value="discard">Discard</button>
  <button type="button" value="merge">Merge</button>
</div>

### Canvas says a nav item is not visible to students when the page is only empty

**The problem.** Read from your instructor view, Canvas labels Assignments "Not visible to students". An agent read that as "students can't reach the homework" and was about to make it a task for you. Canvas only meant the page was empty. Students could reach it the whole time.

**The fix.** Check the course tabs API before reporting anything about what students can see.

**Recommend: promote.** It costs nothing until someone hits it, and you may teach on Canvas again.

[The proposal](../../lessons/proposed/canvas-says-a-nav-item-is-not-visible-to-students-when-the-page-is-empty.md)

<div class="choice" data-choice="lesson-canvas-says-a-nav-95977f3">
  <p class="choice-q">What should happen to this lesson?</p>
  <button type="button" value="promote" data-recommended>Promote</button>
  <button type="button" value="discard">Discard</button>
  <button type="button" value="merge">Merge</button>
</div>

### Claude in Chrome blocks a JavaScript result that contains query-string URLs

**The problem.** An agent reads a page through the browser tool and gets back a "blocked" marker where the content should be. The call still reports success, so it looks like the page was empty, and an agent can record a wrong finding from it.

**The fix.** Return extracted text or named fields, never raw HTML.

**Recommend: promote.**

[The proposal](../../lessons/proposed/claude-in-chrome-blocks-a-javascript-result-that-contains-query-string-urls.md)

<div class="choice" data-choice="lesson-claude-in-chrome-b60da78">
  <p class="choice-q">What should happen to this lesson?</p>
  <button type="button" value="promote" data-recommended>Promote</button>
  <button type="button" value="discard">Discard</button>
  <button type="button" value="merge">Merge</button>
</div>

### tail -1 on a git push hides a failed push

**The problem.** A push fails, but its output is trimmed to the last line, which reads "and the repository exists." That looks like a stray fragment, not an error. The branch never reaches GitHub, and the next step fails with no clear cause.

**The fix.** Let pushes print, or check the exit code.

**Recommend: promote.**

[The proposal](../../lessons/proposed/tail-1-on-a-git-push-turns-a-fatal-error-into-a-sentence-fragment.md)

<div class="choice" data-choice="lesson-tail-1-on-a-git-p-6c65ef1">
  <p class="choice-q">What should happen to this lesson?</p>
  <button type="button" value="promote" data-recommended>Promote</button>
  <button type="button" value="discard">Discard</button>
  <button type="button" value="merge">Merge</button>
</div>

## agents

### Backgrounding a command twice orphans it

**The problem.** An agent starts a long-running watcher in the background and also wraps it in `nohup ... &`. The task reports done within a second. The real process keeps running, detached, with nothing tracking it, and later nobody can tell which session owns it.

**The fix.** Start the command in the background once, with no `&` or `nohup`.

**Recommend: promote.**

[The proposal](../../lessons/proposed/nohup-inside-run-in-background-orphans-the-process.md)

<div class="choice" data-choice="lesson-nohup-inside-run-e95d581">
  <p class="choice-q">What should happen to this lesson?</p>
  <button type="button" value="promote" data-recommended>Promote</button>
  <button type="button" value="discard">Discard</button>
  <button type="button" value="merge">Merge</button>
</div>

## data

### Re-running an analysis script doesn't verify a claim about a point in time

**The problem.** A report says a count came from the first round of data collection. A verifier re-ran the script, which read the whole folder. The folder had grown from 38 files to 132, so the script gave a different number. The verifier "corrected" the report to the wrong number.

**The fix.** Rebuild the scope the claim names, from timestamps or a saved list of files. Keep each count's CSV with the report.

**Recommend: promote.**

[The proposal](../../lessons/proposed/re-running-a-script-does-not-verify-a-point-in-time-claim.md)

<div class="choice" data-choice="lesson-re-running-a-scri-c8484b0">
  <p class="choice-q">What should happen to this lesson?</p>
  <button type="button" value="promote" data-recommended>Promote</button>
  <button type="button" value="discard">Discard</button>
  <button type="button" value="merge">Merge</button>
</div>
