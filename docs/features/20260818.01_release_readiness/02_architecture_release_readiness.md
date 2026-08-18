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
7. `lahe session close <id>` closes routing without deleting review history.
   Explicit reopen is required before more reviews can be added. Closing the
   last open agent session also stops the shared helper after verifying its
   identity; reopening or starting a session starts it again.

Session metadata lives in an owner-only
`<state-dir>/agent-sessions/<session-id>/session.json` file containing its
schema, ID, creation time, and optional close time. Review `meta.json`, the
`review.created` recovery event, and `review.json` carry the immutable
`agent_session_id`. Existing unowned reviews are visible only through a
synthetic `legacy` session; they are not adopted silently.

Agent implementation and project root are deliberately absent from the routing
key. Two Claude processes in one checkout are two sessions. Claude and Codex in
one checkout are two sessions. Agents of either kind in different checkouts are
also two sessions. All four arrangements may share the same helper safely. If
one top-level agent intentionally works across several project roots, it may
enroll those reviews in one named session; that explicit enrollment is the only
thing that joins their work feeds.

Session routing isolates review work, not source-code writes. Two agents editing
the same checkout still need the project's ordinary worktree or coordination
rules. Browser-window ownership is independent too: it decides which tab may
edit a review and does not identify the agent that owns the review.

The session ID is routing metadata, not an authentication claim. The trust
boundary remains the local user account. No item leases are required. Ownership
is enforced when a review is created, reattached, or matched by path, because
reply folding intentionally accepts a later same-revision reply. Filtering only
the display would still permit double work.

`lahe session takeover <id>` explicitly transfers stewardship of a whole
session to a new top-level agent without moving its reviews. It increments the
session's durable `handoff_rev`; older monitor processes compare their captured
revision before emitting work and exit when it changes. The new agent first
runs un-seen-filtered session status to catch every unanswered item, then starts
a monitor with a fresh seen-file. This command requires an explicit human
handoff. Silent reuse or reassignment remains forbidden.

#### Handoff use cases and required outcomes

| Case | Required outcome |
| --- | --- |
| Prior agent exhausts its model allowance after status marked an item seen but before replying | Unfiltered catch-up shows the unanswered item to the replacement agent |
| Prior client crashes or is fully closed without running `session close` | Explicit takeover succeeds from durable state without cooperation from the old client |
| Prior agent handled some items before stopping | Catch-up omits handled items and retains them as history |
| One agent session owns several documents and reviews | Takeover transfers the session as one workstream; review ownership does not change |
| An old exit-on-work monitor remains alive | Changed `handoff_rev` makes it discard buffered output and exit |
| Feedback lands during takeover or catch-up | Unfiltered catch-up plus a fresh seen-file exposes it exactly once |
| A different agent discovers the session without an explicit human handoff | Existing foreign-session refusal remains in force |
| The session was already closed | Takeover reopens its helper and owned static servers while preserving history |

### Process and energy lifecycle

The shared helper is leased by open agent sessions. It is not a permanent
machine daemon. Several open sessions still use one helper process, but once the
last session closes there is no work feed to serve and the helper exits. Review
folders remain on disk, and pages keep unsent work in browser storage until a
session starts the helper again.

Temporary and test-launched helpers have a stricter owner lease. They hold an
IPC channel to the process that started them and exit when that owner
disappears, including interrupted test runs. This prevents old worktrees and
aborted browser suites from leaving polling processes adopted by PID 1.

Agent monitoring is session-scoped and exit-on-work. `lahe monitor` owns one
local 15-second polling loop over `status --session --json --seen-file --quiet`.
It emits nothing while idle, prints new item lines, and exits. Agents launch it
as a background terminal task, handle the batch when completion wakes them, and
then drain immediate status checks with the same seen-file until one is empty
before launching it again. The drain catches feedback submitted during
implementation without an extra background wake-and-exit cycle. A client
without completion-triggered wakeups may run the same command in the foreground
with an explicit warning that the chat is occupied.

The monitor emits a loud `LAHE ACTION REQUIRED` control line before item output.
A completed watcher is not completed review work. It is an interrupt that keeps
the agent's current turn active through source editing, rebuild, visible-result
verification, replies, and the drain. This protects the observed failure where
a Codex agent received the batch, told the human it was ready to apply, and then
waited for another human message before acting. The control line lives in the
CLI output as well as the skill because task-completion transcripts may be the
only context a resumed agent attends to.

Codex has an additional host-lifecycle requirement: its agent turn remains
pending on the monitor's exec session. Detaching the terminal process and ending
the agent turn is not a wakeup mechanism; process completion may otherwise sit
unobserved until the human sends another message. The pending wait uses the
local process for idle polling, permits human steering, and continues the same
turn only when work exists.

This boundary exists to prevent token burn on no-ops. Claude Tasks,
Antigravity schedules, Codex Timers, and equivalent facilities invoke a model
even when no document state changed. Leaving those active overnight can spend a
large allowance doing empty reads. A forever quiet daemon avoids those model
calls but does not complete, so some hosts never wake the agent. The local
exit-on-work process gives both properties: zero model turns while idle and a
completion event when work exists. It also retains the session/revision
semantics of `status --seen-file`, launches no parser pipeline, posts no idle
message, discovers later reviews in the session, and exits when the agent
session closes. A hidden review page may reduce nonessential reply/mtime polling
while retaining its low-frequency ownership heartbeat; a visible page keeps the
interactive cadence.

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

Owner-only agent-session metadata records the static server root, port, PID,
start identity, and stop time so cleanup can verify the exact process before
signalling it. Re-running the command for the same page and session is
idempotent. Closing a session stops all static servers it owns; reopening the
session restores them. A caller-supplied origin is externally owned and is
never stopped by LAHE.

Dev-server applications continue to use `add`, because the application owns
its server. The CLI output must describe its snippet as unguarded and require a
real framework development conditional.

Markdown takes the same owned static route. `review` renders `.md` and
`.markdown` into an agent-session artifact with a neutral reading stylesheet,
maps the review back to the untouched Markdown source, and mounts the source
directory for relative assets. GFM block parsing and Mermaid rendering are
pinned local dependencies, so a cold-start agent never chooses its own
converter, flattens block structure, requires a CDN, or forgets the diagram
runtime.

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
