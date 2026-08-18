# Progress: release readiness

## 2026-08-18 audit

- Complete: repository, feature packet, follow-up record, public docs, CLI,
  service, browser layer, and test inventory.
- Complete: independent specification, code/security, and public-workflow
  reviews.
- Complete: full Node 20 release gate, 467 unit and 620 browser tests passed,
  with 7 documented skips.
- Complete: rail open/collapsed preference now persists per review across
  reloads and remounts. A second-window refusal can still expand the rail
  transiently without overwriting that preference.
- Complete: LAHE's hashless automatic reload now saves and restores the exact
  viewport once, uses instant scrolling, and prevents a later native restore
  through `pageshow`. Fragment navigation and history navigation remain
  browser-owned.
- Complete: the retired blocking `lahe wait` implementation, wait-only protocol
  constants, and false-positive tests are removed. Living docs teach only the
  session-scoped `lahe monitor` command; the original feature plan marks its
  former wait design as superseded history.
- Complete: post-fix Node 20 release gate, 475 unit and 629 browser tests
  passed across Chromium, Firefox, and WebKit, with 7 documented skips.
- Complete: answered comments now retain chronological reviewer/agent history
  and expose a private, reload-safe follow-up composer. Submission queues the
  full new revision before local cleanup, revision fencing remains intact,
  refused windows cannot mutate the thread, and reopening cannot discard a
  nonempty draft.
- Complete: replay keeps its actual anchor verdict. A visible but ambiguous or
  structurally changed wireframe element is no longer described as deleted,
  and successful reattachment clears both current and legacy badges.
- Complete: post-integration lint and bundle checks passed; 490 unit tests and
  the 26 focused Chromium follow-up, rail, replay, and settling regressions
  passed.
- Complete: idle helper polling was measured and redesigned. The existing
  helper consumed roughly 7 to 9 percent CPU while scanning 15 review folders
  four times per second. Active requests now fold their own review immediately,
  while the all-review safety scan runs every five seconds. An isolated helper
  with the same folder count sampled at 0.0 percent idle CPU.
- Complete: test-launched helpers now hold an IPC ownership lease and exit when
  an interrupted or crashed test worker disappears. This addresses the six
  PID-1-orphaned helpers found during the energy audit; existing stale processes
  require one-time cleanup because they predate the fix.
- Added release requirement: closing the final open agent session stops the
  shared helper and its monitor while preserving every review folder.
- Complete: durable agent-session routing now gives every review one immutable
  owner in meta.json, the recovery event, service readiness, and review.json.
  Session-scoped status dynamically finds later reviews, seen identity includes
  session + review + item + revision, global seen-file monitoring is refused,
  and quiet monitoring emits nothing while idle.
- Complete: `lahe review` creates or infers the session and prints exact monitor
  and close commands. `lahe session close` ends monitoring and stops the shared
  helper only after the final open session closes; reopen starts it again.
- Resolved blocker: independent live agent sessions can no longer receive one
  another's reviews through the documented or accepted monitor command.
- Complete: explicit `lahe session takeover` transfers a whole workstream to a
  replacement agent, fences older monitors with `handoff_rev`, and prints an
  unfiltered catch-up command plus a fresh session-scoped monitor command.
- Complete: monitor work output now begins with `LAHE ACTION REQUIRED`, and the
  operating contract defines task completion as the start of the processing
  turn. This follows an observed Codex failure that received a new item but only
  described it until the human asked again.
- Complete: Codex monitoring is now explicitly a foreground pending exec call,
  not a detached task. This follows a second observed failure where an agent
  claimed monitoring remained active after its final response, but the watcher
  was no longer present and seven items waited until the human checked again.
- Complete: service contract 9 gates the timestamp-capable projection. The live
  browser walkthrough found an older helper that served the new rail while
  still omitting `reply.at`; `lahe review` now restarts that helper before the
  page connects.
- Complete: every reviewer turn and agent turn carries and renders its own
  timestamp. Historical rounds use stable chronological ordering, and JSON and
  text exports retain the same times.
- Complete: monitor delivery is no longer treated as acknowledgment. The public
  `lahe monitor --session <id>` command redelivers every unanswered item after
  relaunch until a durable reply exists; its local idle polls still use no model
  turns. Session-scoped `status --json --quiet` drains feedback submitted while
  the agent works.
- Browser acceptance: one open browser completed three consecutive
  comment-to-source-to-reply cycles. After the session drained empty, a rearmed
  monitor also discovered and completed a comment in a newly added second
  review. A fifth browser item was deliberately left unanswered after its first
  monitor delivery; relaunch emitted the same item again, and the normal source
  change and reply then completed it. All browser results showed the changed
  source and folded reply.
- Observed acceptance case: Antigravity exhausted its Gemini allowance after
  seeing an item, the app was fully closed, and Codex took over the session.
  Catch-up recovered the unfinished item while leaving completed items alone.
- Complete: the public static front door now owns an event-driven, read-only
  Node server per session and directory. It chooses and registers the origin,
  prints the exact URL, reuses the process on re-entry, stops it on session
  close, and restores it on reopen. Externally supplied dev servers remain
  outside LAHE's lifecycle.
- Complete: direct editing now accepts Cmd-Enter or Ctrl-Enter as the same
  commit action as Escape, and the on-page hint teaches both paths.
- Complete: the collapsed review pill now counts incomplete lifecycle records,
  including ready hand edits that remain organized under the Edits tab. A
  handled reply, not tab placement, is what burns the count down.
- Complete: `lahe review` now accepts Markdown directly. A pinned GFM renderer
  owns block structure, generated documents receive a neutral reading style,
  relative assets remain reachable, and fenced Mermaid flowcharts render from
  a pinned local dependency-free browser bundle. Agents no longer hand-convert
  Markdown, invent a server, or omit the diagram runtime.
- Complete: public guidance now distinguishes one-file Markdown review from a
  compiled multi-source document. Existing Pandoc and other canonical builds
  remain authoritative; `--source` names their entrypoint, agents locate the
  actual fragment from page context, and generated HTML is never the durable
  edit surface.
- Complete: the repository now owns the canonical LAHE skill. The setup command
  installs managed copies for shared agent discovery and Claude, preserving one
  migration backup of a prior hand-maintained skill. Product changes update the
  repository first and rerun setup; installed copies are no longer independent
  documentation branches.
- Complete: an explicit browser-window takeover now restores the page-note
  composer that read-only mode closed, as well as the existing selection and
  direct-edit gestures.
- Complete: the final release gate passed 522 unit tests and 638 browser tests
  across Chromium, Firefox, and WebKit, with 7 documented capability skips.
  The canonical skill was then installed from the repository into the shared
  agent and Claude discovery locations, and both installed files match it.

## 2026-08-18 monitoring rewrite

- Complete: each agent session now owns an append-only wake feed at
  `<state-dir>/agent-sessions/<id>/wake.log`. It is a push channel: a host that
  can hold a `tail -n 0 -f` keeps one watcher armed for the whole session
  instead of relaunching a poller after every batch. A wake line is a pointer.
  It names the item and the drain command and carries no reviewer text, so the
  feed cannot become an instruction channel.
- Complete: the feed is written before an agent is told to tail it, so a tail
  armed at setup cannot lose the race against the first item.
- Complete: `lahe monitor` sends a heartbeat while it polls, and the helper
  records when an agent session last ran a `lahe` command. Those two signals
  drive a new rail line: watching when a monitor checked in recently, working
  when no monitor is checked in but the session is still running commands, and
  unattended when neither is true. The reviewer can now see whether anything is
  listening instead of guessing.
- Complete: the monitor has distinct exit codes. 0 means work is printed, 5
  means the agent session is closed, and 6 means another agent took the session
  over. A host reads the number and knows whether to relaunch, so "handle this
  work" and "stop, the session is over" no longer share one code.
- Complete: there is no seen ledger. Work stays listed until a reply lands, so
  a missed wake costs nothing and a monitor relaunched after a crash redelivers
  rather than skipping. `--seen-file` is still accepted and ignored, because
  failing an older agent on a flag whose absence changes nothing would be the
  worse answer.
- Complete: per-host wake instructions replaced one-size prose. Claude tails the
  feed, Codex holds a foreground exec, Antigravity uses a background terminal
  task, and every surface (`AGENTS.md`, the skill, the CLI output, and the
  contract in `review.json`) says the same thing.

## Still open

These are not done. They were found during the work above and deliberately left
for a later pass, so the record should not read as if the release is clear.

- Pending: human review of this hardening packet. Nobody outside the build has
  signed off on it yet.
- Open bug: a cold browser profile cannot rebuild historical comment cards from
  `review.json`. It only receives reply events, so a reviewer who opens the page
  in a fresh profile sees answers with no cards under them. The acceptance run
  worked around this by keeping one browser open the whole time.
- Open bug: after a helper restart, the "static server reused" message does not
  check that the recorded server process is still alive. A dead server was
  reported as reused during the walkthrough. That was attributed to sandbox
  isolation at the time and the liveness check was dropped, so the message can
  still lie.
- Not run: the live cross-host proving run. Claude tailing the wake feed, Codex
  holding a foreground pending exec, and Antigravity on a background terminal
  task have not been exercised together, and the overnight zero-token idle check
  has not happened.

## Changes from the original plan

The original architecture assumed one coordinator with subagents. Normal use
now includes several independent top-level agents sharing the helper. The
global watcher added after implementation violates that earlier assumption, so
agent-session routing is a new explicit product boundary.

The release remains GitHub-only. npm publishing work is excluded by decision.
