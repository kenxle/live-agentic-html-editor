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
4. `lahe monitor --session <id>` dynamically lists only unanswered work in
   reviews owned by that session, including reviews added after monitoring
   began.
5. Every monitoring command requires `--session`. It never falls back to all
   reviews. Plain machine-wide `status` remains a human diagnostic and agent
   instructions never use it as a work feed.
6. Monitor delivery is not acknowledgment. An unanswered item is redelivered
   after every relaunch until its durable reply folds.
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
runs session status to catch every unanswered item, then starts a fresh
session-scoped monitor. This command requires an explicit human handoff. Silent reuse or reassignment remains forbidden.

#### Handoff use cases and required outcomes

| Case | Required outcome |
| --- | --- |
| Prior agent exhausts its model allowance after receiving an item but before replying | Catch-up shows the unanswered item to the replacement agent |
| Prior client crashes or is fully closed without running `session close` | Explicit takeover succeeds from durable state without cooperation from the old client |
| Prior agent handled some items before stopping | Catch-up omits handled items and retains them as history |
| One agent session owns several documents and reviews | Takeover transfers the session as one workstream; review ownership does not change |
| An old exit-on-work monitor remains alive | Changed `handoff_rev` makes it discard buffered output and exit |
| Feedback lands during takeover or catch-up | Catch-up plus the fresh monitor exposes it until a durable reply exists |
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

Agent monitoring has two shapes because agent hosts wake in two ways. Some hosts
can hold a long-lived watcher on a file; others only wake the agent when a task
completes. One design cannot serve both, so the architecture provides a push
channel and a pull command over the same durable state.

The push channel is a wake feed: one append-only file per agent session at
`<state-dir>/agent-sessions/<session-id>/wake.log`. The helper appends one line
when a ready item lands in a review the session owns, and one line when the
session is taken over or closed. A host that can hold `tail -n 0 -f` arms one
watcher at setup and never relaunches anything for the rest of the session. The
file is appended to, never rewritten, so a tail keeps its inode, and it is
created before the agent is told to tail it, so a watcher armed at setup cannot
lose the race against the first item. A wake line is a pointer and never an
instruction: it names the item and the drain command and carries no reviewer
text at all, which keeps the injection fence from D6 intact on a second channel.

The pull command is `lahe monitor --session <id>`, which owns one local
15-second polling loop over `status --session --json --quiet`. It emits nothing
while idle, prints unanswered item lines, and exits. Agents launch it as a
background terminal task, handle the batch when completion wakes them, and then
drain immediate status checks until one is empty before launching it again. The
drain catches feedback submitted during implementation without an extra
background wake-and-exit cycle. A client without completion-triggered wakeups
may run the same command in the foreground with an explicit warning that the
chat is occupied.

The monitor's exit code says why it stopped, because "handle this work" and
"stop relaunching, the session is over" must not share one number. `0` means
work is printed above. `5` means the agent session is closed. `6` means another
agent took the session over. On `5` or `6` the host stops instead of restarting
a watcher against state that will never produce work again.

There is no seen ledger behind either shape. Work stays listed until a durable
reply lands, so delivery is not acknowledgment: an ignored wake redelivers on
the next drain, and a monitor relaunched after a crash re-emits rather than
skipping. This removes a whole class of failure where an agent received an item,
died, and left the item hidden behind a ledger entry that claimed it had been
seen. `--seen-file` is still parsed and ignored, because failing an older agent
on a flag whose absence changes nothing is the worse answer.

The reviewer can see whether any of this is running. `lahe monitor` writes a
heartbeat while it polls, and the helper records when the session last ran a
`lahe` command. The rail turns those two signals into one line: watching when a
monitor checked in recently, working when no monitor is checked in but the
session is still running commands, and unattended when neither is true. The
line is calm in the first two states and loud only in the third, so "nobody is
listening to your comments" is visible instead of inferred from silence.

The monitor emits a loud `LAHE ACTION REQUIRED` control line before item output.
A completed watcher is not completed review work. It is an interrupt that keeps
the agent's current turn active through source editing, rebuild, visible-result
verification, replies, and the drain. This protects the observed failure where
a Codex agent received the batch, told the human it was ready to apply, and then
waited for another human message before acting. The control line lives in the
CLI output as well as the skill because task-completion transcripts may be the
only context a resumed agent attends to.

Codex has an additional host-lifecycle requirement: it runs the monitor as a
foreground pending exec call and keeps waiting on the returned session or cell
id. Detaching the terminal process and ending the agent turn is not a wakeup
mechanism; the process may be terminated with the turn or its completion may sit
unobserved until the human sends another message. The pending wait uses the
local process for idle polling, permits human steering, and continues the same
turn only when work exists. A Codex agent must never claim that monitoring
remains active after it has sent a final response.

This boundary exists to prevent token burn on no-ops. Claude Tasks,
Antigravity schedules, Codex Timers, and equivalent facilities invoke a model
even when no document state changed. Leaving those active overnight can spend a
large allowance doing empty reads. A forever quiet daemon avoids those model
calls but does not complete, so some hosts never wake the agent. The local
exit-on-work process gives both properties: zero model turns while idle and a
completion event when work exists. It also retains the session and revision
semantics of the durable unanswered state, launches no parser pipeline, posts no
idle message, discovers later reviews in the session, redelivers ignored work,
and exits when the agent session closes. The wake feed costs even less: a tail
is not a model turn either, and the file is written only when a ready item
actually lands. A hidden review page may reduce nonessential reply/mtime polling
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

### Reliability baseline from the former comments module

The earlier Steady Thread development comments layer remains a useful baseline
because its state machine is small: capture one selection or element, keep one
draft in localStorage, POST one completed comment, and remount idempotently after
Turbo morphs. It also supports Cmd/Ctrl-Enter through the same `sendComment`
function as the visible Send button. Its reliability comes from explicit
boundaries and one write path, not from polling.

LAHE keeps those properties where they scale: drafts remain browser-private,
keyboard and button submission share one operation, repeated mounts are
idempotent, and only a durable reply completes agent work. LAHE cannot reuse the
old module's machine-global history because concurrent agent sessions and
multiple reviews require routing, revision fences, source rebuilds, and agent
answers. The release rule is therefore to preserve the old module's small local
state transitions while keeping LAHE's session and durability boundaries.

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
