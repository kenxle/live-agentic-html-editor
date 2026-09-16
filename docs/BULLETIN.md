# lahe board

Internal task board for this repo. Append-only, newest first; see rows for
status: `[ ]` open, `[>]` claimed, `[x]` done, `[!]` blocked.

## Board

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

- [ ] @anyone 2026-09-14 LAHE-serve-restart-detaches -- **`lahe serve --restart`
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
