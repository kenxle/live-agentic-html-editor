# Lessons queue and CLAUDE.md proposals

Close-out of the linked folder work. Six proposed lessons are waiting, and there are three proposed rules for CLAUDE.md. Each needs your call: comment on its section. My recommendation is in each one.

- **Lessons:** promote all six. Each is a real trap, and its symptoms are the words a stuck agent would search. I checked every claim against the code today, and none of them repeats a live lesson.
- **CLAUDE.md:** add all three. Each comes from something that went wrong in this run.

## Lesson: a test that runs the CLI synchronously hangs when the helper lives in the same process

**The problem.** A test starts the helper inside its own process, then runs the real `lahe` command with `execFileSync`. The command asks the helper if it is up and never hears back, because the synchronous call has frozen the very process the helper answers from. So the command decides no helper is running and starts its own, which can't get the port either. The test hangs until it times out, and the extra helpers keep running afterwards. Leftover helpers like these are what once filled Ken's Mac with 1,892 processes.

**The fix.** When the helper runs in the test's own process, run the CLI with the non-blocking `execFile` and await it.

**Recommendation: promote** to `testing`. It shows up as a hang with no error, and nothing in the code warns you.

Promote, discard, or merge?

## Lesson: Firefox can undo a scrollBy sent right after scrollIntoView

**The problem.** The style switcher test scrolled a passage into view, nudged the page up 40px, and opened a comment box. In Firefox the page sometimes jumped back about 10 ms later, so the box sat 40px off its passage and the test failed before it tested anything. It failed 5 of 5 times on the linked-folder branch and 1 of 3 on main, which made the branch look guilty. It wasn't: a bare page with no Lahe does the same thing.

**The fix.** Before opening a box or measuring after a scroll, wait until the page has stopped moving (`pageAtRest` in `test/browser/style_switcher.spec.js`).

**Recommendation: promote** to `browser`. It cost a builder an investigation this run, and the next flaky Firefox placement test will look just like it.

Promote, discard, or merge?

## Lesson: lint checks only .js files, so the Lua filter gets no lint at all

**The problem.** `npm run lint` printed "lint passed (syntax: 538 files ...)" while the new pandoc Lua filter could have had a syntax error. All three lint checks only look at `.js` files. The Lua filter only runs when pandoc does, and CI has no pandoc on purpose. So a broken filter can reach a pull request with green lint and green CI.

**The fix.** Read a green lint as saying nothing about non-JS files. Run the pandoc tests locally and check they report 0 skipped.

**Recommendation: promote** to `testing`. A further step is a lint check for Lua, which would make this lesson unnecessary. Say if you want that as a board row.

Promote, discard, or merge?

## Lesson: the unit suite has no timeout, so one stuck test hangs the run forever

**The problem.** One `npm run test:unit` run stopped producing output and stayed up for more than a day. A login-item test took 444 seconds on a 20-second wait, the run never returned, and two test helpers were left running. The root cause of that one hang is unknown. What is known: nothing in the chain has a deadline. The browser suite has a 90-second limit per test; the unit suite has none.

**The fix.** Run the unit suite in the background and watch whether its log keeps growing. To stop a stuck run, kill only that run's processes, found by their temp folder, never by matching `lahe.js serve`, since that would also match your real helper.

**Recommendation: promote** to `testing`, and add a board row to give `test:unit` a per-test timeout. Once that ships, this lesson can be retired.

Promote, discard, or merge?

## Lesson: pandoc leaves quotes bare, so the link rewrite edits prose

**The problem.** A document that shows an attribute in words, like `<link href="./style.css">` in a code span, came out of the pandoc path with the shown text changed to `/.lahe-source/abc/./style.css`. The link rewriter looks for `href="..."` anywhere in the page. Under marked that was safe, because marked escapes every quote in text. Pandoc doesn't, so the rewriter started editing what the author wrote.

**The fix.** The pandoc filter escapes quotes in text and code the way marked does. Any new filter that writes raw HTML for user text must do the same.

**Recommendation: promote** to `service`. The next person to touch the Lua filter is exactly who needs this.

Promote, discard, or merge?

## Lesson: the main checkout can hold unpushed commits to the code you are changing

**The problem.** During the folder-cap fix, a Codex session working in feature-forge hit the same Lahe bug and committed its own fix straight to Lahe's main checkout without pushing it. Nothing announced it. It only came to light because a before-and-after comparison against the main checkout gave numbers the code couldn't explain. Later the same thing caused the heading-id conflict that held up your helper.

**The fix.** Before measuring against the main checkout, and again before shipping, run `git log origin/main..main` there. If it shows commits that touch your code, ship them together in one pull request with a merge commit.

**Recommendation: promote** to `process`. It happened twice in one day.

Promote, discard, or merge?

## CLAUDE.md (Lahe): run the full gate under caffeinate

**What happened.** One `npm run gate:all` run took 7.6 hours and failed 122 tests, because the Mac went to sleep partway through. Wrapping the run in `caffeinate -i` stopped that.

**Proposed rule**, in "Running the gate": "Run `npm run gate` and `gate:all` under `caffeinate -i`, so the Mac cannot sleep mid-run. A run that slept fails tests the change never touched."

**Recommendation: add.** It costs nothing, and a sleep failure looks exactly like a real regression.

Add, change, or skip?

## CLAUDE.md (Lahe): a builder writes only in the worktree it was given

**What happened.** While investigating the Firefox test, a builder copied a probe spec into a second worktree to compare against main, and left it there. The next full gate in that worktree would have run it. I moved both copies out by hand.

**Proposed rule**, in "Never remove files while work is running": "A builder writes only inside the worktree it was given. To compare against main, it asks the orchestrator for a base worktree, rather than writing into one."

**Recommendation: add.** It's one sentence, and it keeps one agent's leftovers out of another's test run.

Add, change, or skip?

## CLAUDE.md (global): say what changes when you overwrite shared skills

**What happened.** At your request, the Codex session installed the feature-forge MVP over the skills in `~/.claude/skills` and `~/.codex/skills`. Its reply said only "updated locally". The new build script had dropped the house style, and the whetstone skill it installed still promised that style. Nothing told you or the next session, and the next spec came out unstyled.

**Proposed rule**, in "General Preferences": "When you install or overwrite skills that other sessions use (`~/.claude/skills`, `~/.codex/skills`), say in your reply what will behave differently for them, and check that what the other skills promise about it still holds."

**Recommendation: add.** It's the gap you named on the card: "it never told me".

Add, change, or skip?
