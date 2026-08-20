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
multi-document rules as they existed then. The former global `status` watcher
is superseded by the current session-scoped `lahe monitor`; this paragraph is
historical, not operating guidance.

## Open at time of writing

- Final delta code review (post-ac9acce commits) in flight; findings to
  triage before push.
- Push + PR await Ken's word.
- Boarded follow-ups: standing-chip registry; no-helper disk path records
  only the last page's target_path; gate:builder cannot catch stale dist;
  steady-thread's worktree hook blocks `git worktree add` in unrelated repos.

## Later in the same session: the helper heals a rebuilt page

Twice in live use on 2026-08-18 a rebuild regenerated a reviewed page and
took the lahe script line with it, and the reviewer found a dead page. The
documented cure was "re-run `lahe add` after every rebuild", which agents
forgot both times. Discipline is not a mechanism, so the helper repairs the
page itself: on the same stat `replies.poll` already does for `target_mtime`,
a file that came back without this review's line gets the line written back
and the sibling `lahe-layer.js` fallback refreshed. The page's own reload
(R36) then lands on the healed file. The rules that keep it safe are in
`src/service/heal.js`: examine only an mtime that has stood still for a poll
interval, write a temp file and rename it, never touch a file carrying
another review's line, and take the post-write mtime as the new baseline so
the helper never re-examines its own write. The tag/placement logic moved out
of `add.js` into `src/shared/script_line.js`, so `add` and the heal write one
line from one definition. `lahe status` gains one line when a heal happened.

## `lahe wait` was built, hardened, and retired in the same session

It shipped with five exit codes, a cursor, reconnect-from-the-same-`--since`
handling, and its own suite, and all of it worked. It was retired anyway,
because it BLOCKED: agents ran it in the foreground and stopped working while
the reviewer typed, and it watched one review from behind a cursor the caller
had to carry. `lahe status --json --seen-file <path>` answers the same
question without blocking, across every review at once, needs no cursor and no
parser, and survives a restart because the seen file is the state. The command
is unwired from the dispatcher, its route is off the wire, and the contract
field, AGENTS.md and the README teach the one loop. The cleanup completed on
2026-08-18: the dead implementation and wait-only protocol/tests were removed,
and the active status/dispatcher exits now live under `protocol.CLI_EXIT`.

## Morning close-out, 2026-08-18

The final stretch after Ken set the release bar (public, students,
out-of-box, no agent workarounds):

- Error states verified by hand in a real browser: the origin chip's full
  arc (copy-for-agent button, self-heal with no reload), one chip at a
  time, honest statuses. Found and fixed live: the always-open page-note
  box held R36's auto-reload off forever (busyBoxes); a page opened during
  a helper outage loaded nothing at all (the sibling-fallback restored
  R10's offline half).
- `status --seen-file`: the watcher's dedupe moved into the tool after a
  hand-rolled monitor parser broke silently.
- The still-bound rule matured in three steps, each caught by the AC
  walks: (1) a still-connected binding cannot be lost; (2) the binding
  replaces the RESOLVE, never the rest of the pass, so collisions still
  surface (AC3 now asserts REPLAY_NEITHER_MATCHES, the truthful code, and
  counts it on the conflict counter); (3) creation is a binding, seeded
  from comments through boot into replay, covering element picks the text
  matcher can never re-find (AC1's Copy/Export divergence, closed for
  good); plus: a standing conflict counts once.
- Reviewer-facing polish: kind-aware reply fallback, one surface per
  second-window fact, the separate-storage note only while actual.
- The repo got its own task board (now `docs/BULLETIN.md`) carrying all open
  work: `lahe review` (one-command serve, the out-of-box front door), the
  cold-start proving run, the doc pass, the chip registry, rail-remembers-
  collapsed, the cleanup batch.

Final gate at close: 467 unit / 206 browser / 0 failed / 3 documented
skips. Branch `fix/review-session-flaws`, unpushed, awaiting Ken.
