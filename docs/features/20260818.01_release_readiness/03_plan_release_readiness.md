# Release-hardening plan

## Phase 1: correctness and dead-code cleanup

- Fix multi-page path reuse against every retained target path.
- Make target mtime page-specific.
- Remove the retired wait implementation, wait-only protocol, false-positive
  tests, dead asset lookup helpers, and tracked scratch code.
- Make every help path exit successfully.
- Correct the dev-server guard claim.
- Add small fail-closed local safety checks that prevent accidental wrong-file
  writes or wrong-process termination.

Done when targeted regressions pass and the full gate remains green.

## Phase 2: reload polish

- Persist rail collapsed state per review.
- Reproduce the viewport jump across an ordinary URL and a hash URL in all
  three browser engines.
- Implement one viewport owner rule and assert the scroll timeline as well as
  the final position.

Done when an automatic reload preserves the rail and reading position without
a visible double-scroll.

## Phase 3: agent-session routing

- Write the session metadata and handoff contract as a focused micro-spec.
- Add CLI session creation/enrollment.
- Add session-scoped status with review-aware seen keys.
- Refuse ambiguous live enrollment and test explicit handoff.
- Replace global work-feed instructions in every living contract surface.
- Stop the shared helper when the last session closes and restart it on the
  next session open without deleting review history.

Done when two concurrent top-level agents on one helper receive only their own
reviews, each discovers a later document in its own session, and closing the
last session leaves no helper or monitor process behind.

## Process-lifecycle hardening

- Give test helpers an IPC owner lease so interrupted runners cannot orphan
  them.
- Make the seen-file monitor quiet when no item is new and keep parser pipelines
  out of the public workflow.
- Reduce hidden-page polling while preserving session ownership and immediate
  polling on return to the page.
- Verify CPU at idle with many retained review folders and audit the process
  list after interrupted tests.

## Phase 4: one-command front door

- Implement `lahe review <page.html>` with an owned local static server.
- Make re-entry idempotent and cleanup observable.
- Keep `add` for dev servers and advanced reattachment.
- Add a black-box relative-path test using only public commands.

Done when the static quickstart is one command plus opening one printed URL.

## Phase 5: cold-start proof and documentation

- Run the GitHub clone and install flow from a fresh state directory.
- Exercise comment, edit, monitor, reply, rebuild, heal, reload, later document,
  concurrent-session isolation, export, and cleanup.
- Record the manual IME result and honest AC6 result.
- Reconcile README.md, AGENTS.md, the embedded contract, CONTRACTS.md, help, and
  the installed skill pointer.
- Add the four current architecture diagrams.

Done when an unfamiliar agent can complete the full workflow without repository
history, undocumented commands, or a hand-built workaround.

## Phase 6: release review

- Run lint, bundle-current check, all unit tests, and every browser lane.
- Run a final code and documentation review against the original brief and this
  hardening packet.
- Confirm no user-owned untracked file was staged or changed.
- Update the release board and progress record.

Done when there are no unresolved release blockers and the GitHub clone path is
the only documented distribution path.
