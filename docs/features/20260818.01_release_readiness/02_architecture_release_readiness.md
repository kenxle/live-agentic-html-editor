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

Add an opaque, non-secret session ID managed by the CLI.

1. The ordinary `lahe review <page>` command starts a new agent session when no
   session is named and prints its ID with the review ID and URL.
2. Later `review` or `add` calls may name that session and enroll the new review
   in it.
3. `lahe status --session <id> --json --seen-file <path>` dynamically lists
   only reviews enrolled in that session.
4. Plain machine-wide `status` remains a human diagnostic. Agent instructions
   never use it as a work feed.
5. Seen keys are `session + review + item + rev`, not only `item + rev`.

The session ID is routing metadata, not an authentication claim. The trust
boundary remains the local user account. No item leases or security theater are
required for v1. The helper should still fail loud if a review is enrolled in
two active independent sessions because that condition predicts double work.

An explicit handoff command or option may move a review between sessions. A
silent reassignment is forbidden.

### Rejected alternatives

Fixed `--review` lists are rejected because they miss reviews created later.

Machine-global monitoring is rejected because it has already crossed two live
top-level sessions.

A helper, port, and state directory per agent session is valid emergency
isolation but is rejected as the primary product model. It exposes port and
process coordination to every agent and duplicates long-lived helpers.

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
