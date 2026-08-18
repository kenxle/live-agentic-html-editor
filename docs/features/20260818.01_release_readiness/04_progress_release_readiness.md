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
  global `status --json --seen-file` timer loop; the original feature plan marks
  its former wait design as superseded history.
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
- Confirmed known gaps: cold-start proof, final documentation pass, multi-page
  offline path reuse, and acceptance evidence.
- In progress: remaining cold-start cleanup and end-to-end walkthroughs.
- Pending: human review of this hardening packet before the session-routing
  architecture is implemented.

## Changes from the original plan

The original architecture assumed one coordinator with subagents. Normal use
now includes several independent top-level agents sharing the helper. The
global watcher added after implementation violates that earlier assumption, so
agent-session routing is a new explicit product boundary.

The release remains GitHub-only. npm publishing work is excluded by decision.
