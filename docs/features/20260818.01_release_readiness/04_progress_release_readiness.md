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
- Complete: post-fix Node 20 release gate, 475 unit and 629 browser tests
  passed across Chromium, Firefox, and WebKit, with 7 documented skips.
- Confirmed blocker: global monitoring crosses independent live agent sessions.
- Confirmed known gaps: one-command static front door, cold-start proof,
  documentation pass, multi-page offline path reuse, retired wait cleanup, and
  acceptance evidence.
- In progress: session-scoped agent monitoring and the remaining correctness
  cleanup.
- Pending: human review of this hardening packet before the session-routing
  architecture is implemented.

## Changes from the original plan

The original architecture assumed one coordinator with subagents. Normal use
now includes several independent top-level agents sharing the helper. The
global watcher added after implementation violates that earlier assumption, so
agent-session routing is a new explicit product boundary.

The release remains GitHub-only. npm publishing work is excluded by decision.
