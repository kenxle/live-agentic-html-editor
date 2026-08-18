# Release-hardening architecture

## Boundaries

This hardening pass preserves the existing core editor architecture. It does
not replace the event log, browser store, replay engine, per-review token, or
reply files.

The main design change is to distinguish three identities that the current
implementation partly conflates:

- Review: one deliverable, or several pages that are genuinely one deliverable.
- Browser window: the tab allowed to edit one review at a time.
- Agent session: one independent top-level agent's workstream, which may gain
  more reviews while it is running.

Browser-window ownership already exists. Agent-session routing does not.

## Recommended agent-session model

Keep one helper and add an opaque, non-secret agent-session ID managed by the
CLI. Session scope is an ownership rule, not an optional display filter.

1. The ordinary `lahe review <page>` command starts a new agent session when no
   session is named and prints its ID with the review ID and URL.
2. Later `review` or advanced `add` calls name that session and enroll each new
   review in it. Re-entry on the same target infers and reuses the existing
   ownership.
3. Each review has exactly one immutable `agent_session_id`. A carried review
   or path match owned by another session is refused, never silently moved.
4. `lahe status --session <id> --json --seen-file <path>` dynamically lists
   only reviews owned by that session, including reviews added after monitoring
   began.
5. Any monitoring command with `--seen-file` requires `--session`. It never
   falls back to all reviews. Plain machine-wide `status` remains a human
   diagnostic and agent instructions never use it as a work feed.
6. Seen keys are `session + review + item + rev`, not only `item + rev`.
7. `lahe session close <id>` closes routing without deleting review history or
   stopping the shared helper. Explicit reopen is required before more reviews
   can be added.

Session metadata lives in an owner-only
`<state-dir>/agent-sessions/<session-id>/session.json` file containing its
schema, ID, creation time, and optional close time. Review `meta.json`, the
`review.created` recovery event, and `review.json` carry the immutable
`agent_session_id`. Existing unowned reviews are visible only through a
synthetic `legacy` session; they are not adopted silently.

The session ID is routing metadata, not an authentication claim. The trust
boundary remains the local user account. No item leases are required. Ownership
is enforced when a review is created, reattached, or matched by path, because
reply folding intentionally accepts a later same-revision reply. Filtering only
the display would still permit double work.

An explicit handoff command or option may move a review between sessions. A
silent reassignment is forbidden.

### Rejected alternatives

Fixed `--review` lists are rejected because they miss reviews created later.

Machine-global monitoring is rejected because it has already crossed two live
top-level sessions.

A helper, port, and state directory per agent session remains valid emergency
isolation but is rejected as the primary product model. It introduces port
recovery, stale-process cleanup, dev-server CSP changes, and one polling process
per agent session. The current shared helper already supports many reviews; it
needs a routing boundary, not a replacement transport.

Per-item security leases are rejected for the trusted local v1. Session routing
and loud duplicate enrollment solve the observed correctness failure with much
less state.

## One-command static review

`lahe review <page.html>` owns the ordinary static workflow:

1. Resolve and validate the page path.
2. Start or reuse the LAHE helper.
3. Start a local read-only static server rooted at the page's containing
   directory on an available loopback port.
4. Register the exact origin and attach the page.
5. Enroll the review in the current agent session.
6. Print one browser URL, the session ID, review ID, and review folder.

The helper records the static server process so status and cleanup can describe
it honestly. Re-running the command for the same page and session is
idempotent.

Dev-server applications continue to use `add`, because the application owns
its server. The CLI output must describe its snippet as unguarded and require a
real framework development conditional.

## Per-page target mapping

Every reviewed page maps to its own target path. Review metadata may retain a
compatibility scalar, but add-time reuse, healing, and mtime polling resolve
through the full page-to-target mapping.

The page identifies itself on the reply poll. The helper returns only that
page's target mtime. A rebuild of page A must not reload page B.

## Reload state

Collapsed state is review UI state and belongs in browser storage under the
review key. The rail reads it before first render and writes it on every toggle.
A reload, navigation inside the same review, remount, or helper restart must
preserve it. A genuinely new review begins open.

Viewport recovery follows one owner rule:

- For ordinary automatic reload, preserve the current visual reading position.
- For a URL with a changed hash caused by the reviewer, native anchor navigation
  owns the destination.
- LAHE never performs an unconditional second scroll after native restoration.
- Any explicit recovery must occur before the page is visibly presented, or be
  skipped when the browser already restored the viewport.

Tests must record the scroll timeline, not only the final `scrollY`, so a
top-then-down flash cannot pass.

## Local safety

The tool trusts the local user and their agents. It does not trust stale state
enough to overwrite arbitrary files or terminate an unverified PID.

- CLI-only filesystem registration should be distinguishable from page event
  traffic.
- Fallback copy destinations must not follow symlinks.
- Helper shutdown must require an exact helper identity.
- Browser ingestion accepts only browser-owned event types.
- State deletion remains explicit and dry-run-first if automated later.

## Documentation ownership

The historical feature packet remains history. Living behavior is defined in
AGENTS.md and the embedded `review.json` contract, with README.md and
CONTRACTS.md kept consistent. The installed skill is a convenience pointer to
the canonical repository and must not become an independently edited source of
truth.
