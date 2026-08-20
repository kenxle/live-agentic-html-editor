# lahe board

Internal task board for this repo. Append-only, newest first; see rows for
status: `[ ]` open, `[>]` claimed, `[x]` done, `[!]` blocked.

## Board

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
