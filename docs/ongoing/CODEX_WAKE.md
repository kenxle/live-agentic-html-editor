# Codex can wait without holding a turn open

Lahe now watches for Codex feedback outside the model turn. Real feedback queues a follow-up to the same conversation. An idle page makes no model calls. No decision is needed from you.

## Current status

The full unit suite passed, and the expanded Codex tests passed. Lint and the bundle check passed too. The independent review has no remaining blockers. The live watcher started and returned successfully, and the report renders correctly. A native queued feedback round trip is the remaining live check.

## What changes

Run the usual printed monitor command, or explicitly add `--codex`:

```sh
lahe monitor --session <id> --codex
```

The command confirms that a local watcher started, then returns. The agent can finish its work and end the turn. The watcher checks for feedback locally. When work arrives, it uses Codex's native queue to start a follow-up in this conversation.

The queued message carries counts and a drain command. It carries no page text. The agent drains the feedback, makes the changes, replies, and re-arms the watcher. Re-arming an active watcher updates its session list. Adding a document does not start a competing watcher for the same conversation.

## Why this fixes the reported failure

The previous Codex instructions told the agent to keep its model turn pending on the monitor. A graceful restart that waits for active turns could then wait indefinitely for a reviewer to comment. The new watcher does not keep a model turn active while the page is quiet.

A timeout that repeatedly wakes the model would spend tokens on empty checks. A timeout that stops listening would leave feedback unanswered. The native queue lets Lahe keep listening locally and wake Codex only for real work. This follows the [product brief's token and responsiveness goals](PRODUCT_BRIEF.md).

## What is checked

| Behavior | Evidence |
| --- | --- |
| The monitor command returns while the watcher remains idle | A real detached worker test |
| Quiet polls send no queued messages | The test waits for another heartbeat and checks the queue log |
| Adding sessions uses the same worker and combines their feedback | Concurrent startup and added-session tests |
| A failed delivery leaves ended reviews and Library requests pending | Retry tests, including a worker restart |
| An old conversation cannot drain work after a takeover | Guarded drain and startup revision tests |
| Missing CLI support or socket access produces an error | Capability tests, plus a read-only connection to the running Codex socket |

The executable tests are in [codex_monitor.test.js](../../test/unit/codex_monitor.test.js). The host instructions are in [the Codex guide](../../skills/lahe/references/host-codex.md).

## Limits that remain

This integration uses the existing local shared Codex daemon. A remote-only host or an older CLI gets an error instead of a blocking foreground wait. Socket access may need the host's usual permission approval.

If Codex is restarting when feedback arrives, the watcher retries locally. It records delivery only after the queue command succeeds. A process dying after Codex accepts a message but before Lahe records that acceptance can cause a repeat wake. The drain remains the source of truth about what still needs work.

The automated tests use a fake Codex queue process. They exercise Lahe's real worker and lifecycle. A restart of the user's shared Codex daemon has not been forced during this work.

## Implementation and references

- [CLI behavior](../CLI.md)
- [Agent workflow diagram](../diagrams/agent_workflow.md)
- [Native Codex queue documentation](https://learn.chatgpt.com/docs/cli/reference#codex-queue)
- [Watcher implementation](../../src/cli/codex_monitor.js)
