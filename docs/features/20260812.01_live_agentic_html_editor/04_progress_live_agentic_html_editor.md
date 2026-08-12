# Progress: live agentic HTML editor

Running record of what each phase and checkpoint actually did, newest section at the foot.

## CP1 integration

Branch `feat/live_agentic_html_editor`, in the main checkout. All four Phase 1 branches were already
merged and the gate was already green; this pass closed the seams the four parallel builders left named
in their notes, and wrote CP1 as a checked-in spec.

### Seam 1: the rail specs now run against the real helper

1B wrote `rail_durability`, `rail_status` and `rail_second_window` against
`test/fixtures/servers/protocol-service.js`, because 1A's helper had not landed. All three now take
`SERVICE_ENTRY` from `test/helpers/service.js`, which is `src/service/index.js`.

Three differences surfaced, which is what CP1 is for.

1. **The helper's port is fixed and the stand-in's was ephemeral.** 7817 is the product's promise to a
   page with the port baked into its script tag, so it is right; parallel specs would collide on it.
   Every spec that does not pin a port now starts the helper with `--port 0` and reads the real port
   out of `service.json`. The two restart cases keep pinning the original port through `LAHE_PORT`,
   because the page they left behind is still pointing at it.

2. **The second window was not refused at all.** The stand-in answered a refused window claim with
   `protocol.errorBody("PROTO_SECOND_WINDOW", ...)`; the real helper answers with the shape
   `protocol.js`'s route table actually names, `{granted, holder, since, heartbeat_seconds}` plus a
   reason, at 409. 1B's sync client only read the error-body form, so a real refusal read as a grant
   and two windows both thought they held the review. Fixed on the client, because the helper is the
   one following the contract: `claimWithHelper` now treats `granted === false` as the refusal and
   keeps the error-code form as a second reading. The reason the reviewer sees is the helper's own
   sentence, which names the window holding the review and how long it has held it.

3. **The real helper writes `review.created` and `origin.registered` into the same log.** The draft
   test polled for "the log has a line in it", which is true before the draft arrives. It polls for
   the draft itself now. That one was latent flake rather than a bug.

`test/fixtures/servers/protocol-service.js` is left in place, on the cleanup list.

### Seam 2: one shadow host, not two

1D's `highlight.js` created a closed shadow host with id `lahe-surface-root`; 1B's `overlay.js` created
its own host for the rail; `markers.OVERLAY_ROOT_ID` was `lahe-overlay-root`, which nothing created.
Three ideas of one thing.

The ruling, implemented: there is ONE page-level element, `highlight.js`'s surface module owns it, and
its id is `markers.OVERLAY_ROOT_ID`. The constant's value became `lahe-surface-root` (the name reality
already used, in 1D's specs and in D8's prose) and `highlight.js` reads its id from the constant rather
than spelling it a second time.

- `overlay.mount()` asks the surface module for the root and mounts inside it. It adds nothing to the
  page now. It puts its own scope element in that root and attaches a closed root to that, so the
  rail's `:host{all:initial}` and its design tokens apply to the rail and not to the shared host it
  does not own. `unmount()` removes the rail's scope element and leaves the page-level host alone,
  which is the host 2D's remount contract re-creates.
- `comments.js` defaults to the shared highlight instance on the real document, for the same reason: a
  second instance would have been a second host.
- `highlight.surface()` fails loud if a host with that id is already in the page, naming the rule. A
  second host is undiagnosable from outside a closed root, so it must not be able to happen quietly.
- The rail and the pill set `pointer-events: auto`, because the shared host is `pointer-events: none`
  so the page stays clickable through it.

### Seam 3: 1D's overlay asks

- **`overlay.attachCardNode(id, node)`** puts a tab owner's node inside the card's body. That is what
  makes `holdsFocus(id)` able to be true for contents a tab file rendered: before this, `tab_active.js`
  kept the rail's model in sync while rendering its rows somewhere else, so the rail held no node and
  the guard that stops a focused card being removed could never fire. The law holds inside the new
  call: a node already in the card is left where it is, nothing is moved into a card that currently
  holds focus, and attached nodes are re-appended when a remount rebuilds the card.
- **`createActiveTab({host})`** is wired. With a host, `tab_active.js` draws the tab's CONTENTS only:
  no panel of its own, no head, no pill, no counts, no `PANEL_STYLE`. Its rows go inside the rail's own
  cards, and the untethered-note box sits at the foot of the Active pane, kept last by flex `order`
  rather than by re-appending it, because re-appending would re-parent a box the reviewer may be typing
  in. `collapse`, `isCollapsed` and `bounds` delegate to the rail when the rail is the panel. The
  standalone fallback is untouched, which is what keeps ranked test 18 scoring 1D on its own.
- **Rewording happens inside the card.** `comments.reopen(id, {host, placement})` takes a host now, and
  the hosted Reword button passes the card's body. So the box the reviewer types into is really inside
  the card, which is the whole point of the ask.

### CP1 as a spec

`test/browser/cp1_walk.spec.js`, three tests, all three browsers.

1. **The walk.** The helper creates the review and mints its token (the real mint path, 1A's
   `reviews.create`), and the page is handed that token. The fixture is
   `test/fixtures/cp1-doc.html`: `built-doc.html` byte for byte with one script tag for the built
   bundle and one for `test/fixtures/assets/cp1-boot.js`, which wires the four pieces the way 2D's
   `index.js` will. It is a copy rather than an edit because `built-doc.html` is the anchor engine's
   corpus and other specs load it deliberately WITHOUT the library.

   Three comments and one untethered note through real gestures: a selection plus Cmd-Shift-C twice,
   element-pick (Cmd-Shift-C with nothing selected, hover, click) once, and a mouse click into the note
   box at the foot of the rail. The rail is in a closed shadow root, so the spec asks the library where
   the box is and clicks the real pixels. Then `kill -9`, a fourth comment against a dead helper, a
   restart on the same port and state directory, and all five records in `events.jsonl` exactly once
   with the reviewer's text compared byte for byte (`Buffer.compare`), asserted through
   `test/helpers/service.js`'s readers. The token survived the restart; `seq` is monotonic across it.

2. **The anchor step.** With a comment placed on `#intro`, the live DOM is mutated around it (a
   paragraph inserted above, the region wrapped in a div, a neighbour's whitespace rewritten) and
   `resolve` still returns the same node. Then the region is deleted and the failure is the honest one:
   not bound, no element, `ANCHOR_NO_TEXT_MATCH`, and the reviewer's words untouched.

3. **The seam this checkpoint closed.** The Reword button is clicked, the card holds focus, and the
   card node the reviewer is typing into is the same node after a sentence of typing.

No arbitrary sleeps: every wait is `pollUntil` or `pollPage` on a named condition.

### Gate

- `npm run gate` green (lint, `check:layer`, 293 unit tests, 83 browser tests on Chromium).
- `npm run gate:all` green: 249 browser tests across Chromium, Firefox and WebKit.
- `cp1_walk.spec.js` on all three browsers: 9 passed.
- `dist/lahe-layer.js` was rebuilt and committed, which is the orchestrator's job at a checkpoint.

### Cleanup needed

Nothing was deleted. For the Phase 4B batch:

- `test/fixtures/servers/protocol-service.js` — the stand-in helper. Nothing points at it now.
- `test/fixtures/servers/stub-service.js` — speaks the archived send model's route; nothing points at
  it either.
- `test-results/` — Playwright artifacts from the failing runs during this pass. Gitignored.
- `.claude-commit202608121340`, `.claude-commit202608121712` in the repo root — earlier sessions'
  commit-message scratch files. Gitignored.
