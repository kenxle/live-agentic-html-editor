---
read-when: Changing a file in src/domain/, or working out why one of them does what it does.
not-for: How the TypeScript projects and the lint gate are set up; see README.md in this folder.
---

# `src/domain/`: logic the server and the browser both run

This folder holds the code that the server and the review layer both run and must agree on. Today it holds one file, `elapsed.ts`. The rest arrives with the contract wave of the [TypeScript migration](../../features/20261112.01_typescript_migration/parts/target_layout.md): `gestures`, `normalize`, `lifecycle`, `review-format` and the record rules.

A file here imports only `src/contract/`, and nothing that needs Node or a DOM. The compiler enforces it: this project has neither Node's types nor the DOM's.

Source files carry no comments except their `read-when` header. The why, the traps and the history live here.

## How a domain module reaches both sides

- **Node** imports the `.ts` file directly; Node strips the types. CommonJS callers that are still JavaScript reach it through a one-line forwarder at the module's old path under `src/shared/`, listed in the manifest's `FORWARDERS`.
- **The browser** gets it inside the review-layer bundle. Until the layer's own files convert, they read their dependencies off `window.LAHE` as they load. So the module's entry in the manifest's `LAYER_FILES` names the `.ts` path at the old file's place in the order, with `registers` set to the namespace name the old file used. `scripts/build-layer.js` then registers the module under that name at that place, before any later file loads.

The registered object is the module's namespace: read-only, holding exactly its exports. Old code that wrote to a module object it was handed would break, so check for writes before converting a module whose callers are still JavaScript.

## `elapsed.ts`: how long something has been going on, in words

One phrase, two callers. The server says it in the refusal it sends a second window that tries to take a review another window holds (`heldForPhrase` in `src/service/reviews.js`). The rail says it again on the chip it draws from that refusal (`describeHolder` in `src/layer/store.js`). Both used to spell it themselves, so a reviewer could read "for the last 4 minutes" from one and "since 2026-08-18T04:35:45.006Z" from the other about the same window. A raw ISO timestamp is machine output in a sentence written for a person. The wording now lives only here.

The rule is the whole module:

| Elapsed | Phrase |
| --- | --- |
| under a minute, or a start in the future | "for less than a minute" |
| under 90 minutes | "for the last 12 minutes" ("1 minute" when it is one) |
| 90 minutes or more | "since " and a local date and time |

The phrase follows a verb: "open for the last 4 minutes", "holding it since ...".

A start that is not a readable time is echoed as "since " and the value as given, never guessed at. A wrong duration is worse than an honest echo.

`options.now` sets the clock, so a test can pin it instead of sleeping. The server passes its own clock, so its tests can move time; the rail uses the real one.

The local date and time come from the runtime's `toLocaleString()`, so the server's wording follows the machine's locale and the rail's follows the browser's. The two can differ only for a holder older than 90 minutes.
