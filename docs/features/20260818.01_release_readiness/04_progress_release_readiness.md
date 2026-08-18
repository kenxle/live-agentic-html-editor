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

## Changes from the original plan

The original architecture assumed one coordinator with subagents. Normal use
now includes several independent top-level agents sharing the helper. The
global watcher added after implementation violates that earlier assumption, so
agent-session routing is a new explicit product boundary.

The release remains GitHub-only. npm publishing work is excluded by decision.
