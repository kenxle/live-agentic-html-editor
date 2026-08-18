# Review-session fixes: 2026-08-17 overnight workstream. COMPLETE (pending push)

One live review session (Ken reviewing the HeyCatch teardown and a one-pager,
three different agents assisting) surfaced every flaw in this tool at once.
This record is the map of what was found and fixed, all on branch
`fix/review-session-flaws` (29 commits, gate green: 454 unit / 201 browser).

## The eight design fixes Ken opened with

1. `add` restarted the helper and killed every open `wait`. Now: a helper is
   never restarted while up (new `review.write` route for held-review writes),
   and `wait` reconnects on a grace window measured from the drop.
2. No read path existed. Now: `lahe status` (unanswered items, drafts,
   page liveness, `--json` with the contract line).
3. Rebuilds fragmented review identity. Now: path-keyed reuse + `--review`.
4. The origin trap misdiagnosed itself as "helper not reachable". Now: the
   page probes health to tell the two apart, names the origin and the fix,
   and offers a copy-ready line for the agent. Named loopback origins
   register their twin (localhost vs 127.0.0.1).
5. The relative library src 404'd under most servers. Now: the helper serves
   `/lahe-layer.js` (unauthenticated) and every script line points there.
   Supersedes D1's "library works alone" src rule; tradeoff documented.
6. `npm link` under nvm produced a command not on PATH. Now:
   `npm run install-cli` writes a Node-pinned wrapper to ~/.local/bin;
   engines relaxed to Node >=18.2.0.
7. Hand edits stuck in `draft` on click-outside (rail clicks swallowed,
   window blur unhandled). Now: primary-button press outside commits, with
   scrollbar/right-click guards.
8. The count pill counted only active items. Now: "open (total)".

## Found live during the same night

- Live-reload: brief R36 ("the page updates itself") was unmet for static
  pages; D7 assumed the serving environment refreshes. Now the helper
  reports the reviewed file's mtime on the reply poll and the layer reloads
  (deferred while the reviewer is mid-work).
- False "passage is gone" cards: async renders (Mermaid) make a passage
  briefly ambiguous; lost verdicts now defer through a settling window, and
  a re-found anchor clears its card. Genuine losses persist (they previously
  died on remount).
- Three standing chips outlived their conditions in one night (origin,
  lost-anchor, second-window). Each now clears; the structural fix (a
  registry requiring every standing code to name its clearing condition) is
  a boarded follow-up.
- Multi-page reviews bled every record onto every page (`pageKey` existed,
  the layer never called it). Now the layer is page-scoped; foreign records
  are untouched but never replayed/listed/counted. file:// visits match by
  basename (rule + residual documented in record.js).
- Auto-reload could trip its own second-window guard; same-tab identity now
  survives reload, and successful claims clear the chip.
- The code review (10 confirmed findings) caught a real security hole
  (`review.write` origin escalation; now loopback-only + capped), the
  SIGTERM keep-alive hang (the long-standing test flake), reload-on-
  directory-churn, and more. All fixed in three parallel waves.
- Exports carry the page title (filename + first line); Done cards say a
  change once with Reopen|Undo grouped; the second-window message speaks
  human time via the shared `elapsed.js`.

## Contract/docs doctrine established

The feature folder (brief/architecture/plan) is history, not truth. The
living truth is AGENTS.md + the `contract` field in review.json, and the two
travel together (rule pinned in CLAUDE.md). The `/lahe` skill in Ken's
global skills is the session-side counterpart, including the handshake
ritual (serve-first, verify liveness, monitor before "go") and the
multi-document rules (global `status` watcher; one deliverable, one review).

## Open at time of writing

- Final delta code review (post-ac9acce commits) in flight; findings to
  triage before push.
- Push + PR await Ken's word.
- Boarded follow-ups: standing-chip registry; no-helper disk path records
  only the last page's target_path; gate:builder cannot catch stale dist;
  steady-thread's worktree hook blocks `git worktree add` in unrelated repos.
