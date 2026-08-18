# lahe board

Task source of truth for this repo. Same rules as the steady-thread board:
append-only, newest first, claim before work (`[>] @handle`, commit the claim
first), one finishable unit per row, `[ ]` open / `[>]` claimed / `[x]` done /
`[!]` blocked. Detail lives in linked docs, not in rows.

Context for everything below: the 2026-08-17/18 overhaul session record is
`docs/features/20260817.01_review_session_fixes/progress.md`, and the branch
`fix/review-session-flaws` (~40 commits, unpushed as of boarding) holds all of
it. **The release bar is Ken's, stated 2026-08-18: this ships to the public
and to students. Out of the box, every edge case, no bugs, and NO fix may
live in an agent's workaround — if an agent had to patch around the tool, the
tool is broken.**

## Board

- [ ] LAHE-rail-remembers-collapsed @anyone -- (Ken, 2026-08-18) the rail
  overlays the text he is reading, so he collapses it; every reload (incl.
  the new auto-reload, which makes this constant) pops it OPEN again and he
  closes it over and over. Persist the open/collapsed state per review in
  browser storage and restore it on load; the count pill already carries the
  numbers while collapsed.
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
  in-flight heal/wait-retirement work lands: skill (~/.claude/skills/lahe),
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
  `ASSET_DIR_NAMES`), `src/cli/commands/wait.js` + its unit tests once the
  retirement lands, the wait constants rename (`protocol.WAIT.EXIT` is
  status's exit table now), and `/tmp` scratch from the debug runs
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
