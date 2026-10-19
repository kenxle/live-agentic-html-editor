# Find documents and hand work to an agent

## Sub-features

Open a closed review, pick up a document from the Library, and confirm moving a watched session.

## How to get to it (user POV)

Open the test world Library. Find `li[data-review]`. Use its Open control, or open the row menu and choose Pick this up. A watched session prompts before moving it.

## Driving it with Playwright

Precondition: the setup and isolation checks in [verify-lahe](../SKILL.md) pass.

Use [data-act="open"], then the row menu and [data-act="pickup"]. For a watched session confirm through #lahe-catalog-confirm [data-act="move"].

```sh
npm exec -- playwright test test/browser/catalog_library.spec.js --workers 1 --trace on --output /tmp/lahe-proof-library-and-handoff-catalog_library
```

Observable proof: The correct document opens, the pickup request reaches lahe status, the CLI answer changes the Library row, and watched-session ownership changes only after confirmation.

## Gotchas

Use catalog_world fixtures and their stub agent. Do not use the human Library or take over a live session. This does not prove an actual agent host starts or wakes in the cloud.

Source anchors:

- [test/browser/support/catalog_world.js](../../../test/browser/support/catalog_world.js)
- [test/browser/catalog_library.spec.js](../../../test/browser/catalog_library.spec.js)
- [docs/ongoing/LIBRARY.md](../../../docs/ongoing/LIBRARY.md)
