# Release-readiness audit

Date: 2026-08-18

## Outcome

The live editor's core is real and unusually well tested. Durability, editing,
replay, replies, export, origin checks, offline recovery, rebuild healing, and
the three browser lanes are substantially implemented. The full release gate
passes under the repository's Node 20 development runtime: 467 unit tests and
620 browser tests, with 7 documented skips.

The repository is not ready for public or student use yet. The remaining work
is concentrated at the product boundary: independent agent sessions are not
isolated, the ordinary static-file setup still asks an agent to assemble two
servers and an origin correctly, several known cleanup items remain in the
shipping tree, and the cold-start workflow has not been proven from the public
instructions.

This release remains GitHub-only. `private: true` and version `0.0.0` are
deliberate guards against accidental npm publication. There is one canonical
copy to maintain: the GitHub repository a user clones and points an agent at.

## Release blockers

### 1. Independent agent sessions receive one another's work

The current contract tells every monitor to query every review in the shared
machine state. That solved a real problem inside one session: when a second
document appears, its comments are not missed. It created another problem when
two independent top-level agents run at once: both receive both sessions' work.

This has now happened in normal use. One agent received two HeyCatch one-sheet
comments belonging to another agent. It avoided double handling only by
performing an extra reply-file check. Scoping that monitor to a fixed list of
seven review IDs prevents crossover but can miss an eighth document created
later. Neither behavior is acceptable as the product contract.

The original architecture anticipated one coordinating agent with subagents,
not several independent top-level agents. The later global monitor expanded
beyond that assumption without adding a consumer-session boundary.

Done means:

- One agent session discovers every review added to that session, including a
  review created after monitoring starts.
- It never receives reviews belonging to another live agent session.
- A machine-wide listing remains available for human diagnosis but is not the
  agent's default work feed.
- Seen-state identity includes the review as well as the item and revision.
- The behavior is tested with two simultaneous top-level consumers.

### 2. Static review setup is not a one-command product path

The public quickstart still asks an agent to choose a port, start Python's HTTP
server, register the matching origin, run `lahe add`, retain the server process,
and hand over the right URL. The examples also change into the page directory
and then repeat that directory in the path passed to `add`, which fails for an
ordinary relative path.

The board already names `lahe review <page.html>` as the intended front door.
It should serve the containing directory locally, register its own origin,
start or reuse the helper, and print one URL. A user or agent should not need to
coordinate a separate Python process for the ordinary case.

### 3. The public cold-start path is not proven

The current install walk uses `npm link` and `file://`, not the recommended
installer and ordinary HTTP workflow. It stops after a comment reaches the
event log. It does not prove monitoring, a validated reply, source editing,
rebuild healing, automatic browser refresh, later-document discovery, session
isolation, cleanup, or the minimum Node runtime.

Release requires a black-box proving run using only README.md and AGENTS.md.

## Important correctness work

### Multi-page identity and reload targeting

Review metadata retains every `target_path`, but add-time path matching checks
only the most recent scalar target. Re-adding an earlier page can mint a second
review and split history. The reload signal also uses the newest mtime across a
whole multi-page review, so rebuilding page A can tell page B to reload.

Each recorded page needs stable target lookup. Re-add and reload must resolve
against the current page's own target, not the review's last or newest target.

### Reload polish

The rail's open or collapsed state is in memory and resets to open on every
page load. It must persist per review and restore before the rail is shown.

Viewport behavior also needs one contract. An automatic source reload should
return to the same reading position without a visible jump to the top followed
by a second scroll. Hash navigation may establish a legitimate anchor target,
but LAHE should not add a competing visible scroll. The implementation needs a
cross-browser test for ordinary scroll position and a separate hash case.

### Retired and misleading surfaces

`lahe wait` is correctly absent from the CLI but its implementation, protocol
vocabulary, stale tests, and internal comments remain. One current test passes
because the retired command exits as unknown, not because the old survival
claim is still exercised. The dead command and its dedicated contract should
be removed; shared exit codes should get a neutral name.

The dev-server snippet is described as development-guarded, but it is only
preceded by a comment. The output and docs must say that the agent must place it
inside the application's real development guard.

Help should exit successfully for every command. The current `add --help` and
`serve --help` paths are treated as usage errors.

### Local safety, calibrated to the real trust model

This is a trusted, single-user local tool, not an internet service. Security
work should focus on preventing accidental local damage and confusing state.
Heavy adversarial machinery is not a release goal.

Small fail-closed protections are still appropriate where a stale path, PID,
or symlink could overwrite or terminate the wrong local thing. Page-authored
events should also be limited to page event types so ordinary bugs cannot forge
helper lifecycle events. These are correctness boundaries first.

## Explicitly incomplete acceptance evidence

- The IME manual acceptance check still needs a human result.
- The honest, unprimed-user half of AC6 is unscored.
- Real browser back-forward-cache restoration is skipped when the engine
  declines to cache the page; the synthetic event test covers our handler but
  not a genuine freeze and thaw.
- The rail's End Review path and the architecture's automatic retention promise
  are not wired. Until a safe cleanup product exists, the living docs should
  state that retention is manual and should not promise automatic deletion.

## Known polish and cleanup

- Persist the collapsed rail state.
- Investigate and remove the visible top-then-restored viewport jump.
- Build the standing warning-chip registry already on the board.
- Fix the no-gutter comment-box fallback.
- Cover the stale highlight registry.
- Remove tracked scratch code, the retired wait implementation, dead asset
  lookup helpers, and obsolete tests without touching user-owned untracked
  files.
- Reconcile README.md, AGENTS.md, the embedded review contract, CONTRACTS.md,
  CLI help, and the installed skill from the canonical repository wording.
- Add current diagrams for agent-session routing, helper trust boundaries,
  multi-page target mapping, and the review/reply lifecycle.

## Release decision

Do not announce or teach from this repository yet. Complete the release
blockers, run the cold-start proving path on a fresh state directory, record the
manual acceptance results, and repeat the full three-browser gate.
