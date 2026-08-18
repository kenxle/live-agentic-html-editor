# Progress: release readiness

## 2026-08-18 audit

- Complete: repository, feature packet, follow-up record, public docs, CLI,
  service, browser layer, and test inventory.
- Complete: independent specification, code/security, and public-workflow
  reviews.
- Complete: full Node 20 release gate, 467 unit and 620 browser tests passed,
  with 7 documented skips.
- Confirmed blocker: global monitoring crosses independent live agent sessions.
- Confirmed known gaps: one-command static front door, cold-start proof,
  documentation pass, collapse persistence, multi-page offline path reuse,
  retired wait cleanup, and acceptance evidence.
- In progress: targeted reproduction of local safety findings and reload viewport
  behavior.
- Pending: human review of this hardening packet before the session-routing
  architecture is implemented.

## Changes from the original plan

The original architecture assumed one coordinator with subagents. Normal use
now includes several independent top-level agents sharing the helper. The
global watcher added after implementation violates that earlier assumption, so
agent-session routing is a new explicit product boundary.

The release remains GitHub-only. npm publishing work is excluded by decision.
