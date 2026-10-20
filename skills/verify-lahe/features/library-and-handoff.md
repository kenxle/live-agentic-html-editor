# Library and hand-off

The Library page lists every review the helper knows, grouped by agent
session. From a row the reviewer can open the document, star or rename it, or
hand it to an agent. With an agent listening, a hand-off becomes a request in
that agent's drain. With none, the Library shows a message to paste into any
agent.

## Sub-features

- `library-list`: the run's review appears as a row with its path, address and comment count.
- `library-open`: "Open" opens the document at its address.
- `library-handoff-paste`: "Hand to agent", then "Pick this up" with no agent listening shows the paste-in hand-off message.
- `library-handoff-queue`: with an agent attached and its monitor running, "Pick this up" queues a request the agent answers with `lahe library answer` (not yet driven).

## How to get to it (user POV)

- Run `lahe library` and open the printed address.
- On a row: "Open", "Star", the name button to rename, "Hand to agent", then "Pick this up" or "Launch a new agent".

## Driving it with lahe-verify

Preconditions:

- A fresh run on the sample document.
- The Library on this run's helper: `lv cli -- library --port <helperPort>` (from `lv info`). It prints a `Library` address.

- **Open the Library.** Run `lv page goto <Library address>` and `lv page wait "document.querySelectorAll('li[data-review]').length > 0"`.
- **See the row.** Run `lv page aria library`. The snapshot has a heading "Lahe Library", a row button "Rename: Verify sample", the run's source path, and buttons "Open" and "Hand to agent".
- **Hand off with no agent listening.** Run `lv page click 'role=button[name="Hand to agent"]'` then `lv page click 'role=button[name="Pick this up"]'`. `lv page aria after-pickup` has a region "Copy the hand-off message" with text starting "Please take over my live LAHE review" and naming `lahe session takeover <session>`.
- **Back to the review.** Run `lv page goto` to return to the run's own review.
- **Proof.** The two ARIA snapshots and a `page shot library`.

## Gotchas

- `lahe library` without `--port` looks for the real helper on 7817 and refuses because the state folders differ. Always pass this run's `helperPort`.
- `lahe library` starts a new agent session and attaches it. With no monitor running for it, every hand-off falls back to the paste message. To drive the queued path, a monitor for that session has to be running in the background.
- The Library page has no rail, so `page aria` works there and `page rail` does not.
- Regression specs: `catalog_library.spec.js` (queued pick-up with a stub agent), `catalog_page.spec.js`, `library_stable_address.spec.js`.
