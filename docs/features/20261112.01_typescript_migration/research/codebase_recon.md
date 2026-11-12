---
read-when: Checking how the current JavaScript is structured before planning or building a TypeScript migration slice.
---

# Codebase recon for the TypeScript migration

Researcher: codebase structure angle. Repo state: `main`, clean, `package.json` version 0.4.0. Every count below comes from a script in `/private/tmp/claude-501/-Users-kennethstclair-Documents-workspace-live-agentic-html-editor/21a4d883-ad54-478a-848f-e7cd1494e537/scratchpad/recon/` (listed under Method). Claims with a `file:line` were read in the source. Nothing here recommends a design.

## Facts that shape the plan

- **The layer's global namespace is a load-time hand-off, not something files look things up in.** There are 22 factory modules and 1 short-form module in the layer. Each file's wrapper passes `root.LAHE.<dep>` into a factory as a parameter, so a file's real dependencies are its factory parameters (e.g. `src/layer/store.js:46-67`). After load, only `index.js` (takes the whole `LAHE` object, `src/layer/index.js:52`) and `tab_edits.js` (`src/layer/tab_edits.js:445,579,706`) look names up on it. Two files reach `replay` through lazy getters (`protect.js:77-79`, `editing.js:144-148`); only `protect` and `replay` depend on each other.
- **The same files run in Node.** Every `src/shared` and `src/layer` module (except `catalog/page.js`) has a `module.exports` branch, and unit tests `require()` them directly. Unit tests never use `vm`, `eval` or jsdom; they hand fake nodes to the real modules. So `.ts` conversion changes how 70 unit files load layer code, not only how the bundle is built.
- **Thirteen browser specs and two support files read layer source by path, not the bundle.** Ten specs and `replay_run_page.js` build the script from `manifest.builtFiles()` or `LAYER_FILES`; `blocks_kernel`, `anchor_engine` and `best_guess_speed` specs and `protect_page.js` call `page.addScriptTag({ path })` on `src/` files. Renaming a layer file to `.ts` breaks them until they change.
- **The Library page serves raw source files from `src/` at runtime** (`src/service/catalog_page.js:45-50`): `protocol.js`, `view_model.js`, `copy_text.js`, `page.js`. These four never touch `dist/`. A `.ts` source cannot be served raw to a browser.
- **`record_fixtures.js` (test data) is inside the shipped bundle**, and the `contracts.js` barrel is used by nothing in the service or CLI, only by `layer/index.js`'s Node branch and one test.
- **The "contract text" described in CLAUDE.md and the handoff no longer exists in `review_format.js`.** Commit `82e2f310` (2026-10-18) moved agent instructions into the skill; `review.json` has no `contract` field and a test asserts that (`test/unit/review_format.test.js:103`). The copies to protect are now the skill files and the tests that pin their wording (section 7).
- **One unit test pins a comment.** `test/unit/protocol_wire.test.js:187-191` requires a line matching `// <SERVICE_CONTRACT>: <reason>` in `protocol.js`. Removing comments breaks it. Nine other tests read `src/` or `bin/` text and assert on it (section 6).
- **No Node version check exists at runtime.** The documents disagree: `engines` and README say 18.2, `docs/INSTALL.md`, `failures.js:447` and CI say 20, `.nvmrc` says 20.19.0 (section 5).
- **Source style is uniform ES5-in-CommonJS.** Zero `const`, `let`, arrow functions or classes in `src/` outside the strings the scanner skipped; `var` everywhere; `async`/`await` only in `src/cli` and `src/service`. Zero ESM. Zero computed `require` in `src/`.
- **Comments are 30.7% of `src/` lines (28,450 of 92,732), and all 96 `.js` files carry a `read-when` header.**

Docs read: `CLAUDE.md` (project; it has no documents table, so I used its Directory layout and Where the design lives sections), `docs/diagrams/module_map.md`, `docs/ongoing/ARCHITECTURE.md`, `docs/features/20261112.01_typescript_migration/HANDOFF.md`, and the "How a shared module loads" section of `docs/CONTRACTS.md` (lines 25-65). I looked for `docs/ongoing/TESTING.md`'s content only through the code; I did not open it. Principles read: Guard the Context Window, Prove It Works, Explain the Number (the role file's starting set); none changed a choice beyond: scripts for every count (Prove It Works), and stating each heuristic's precision (Explain the Number, see Method).

## Method and precision

Scripts (all Python except the first, all in the scratchpad recon folder named above):

- `dump_exports.js`: loads `manifest.js` and `require()`s every layer file to list its exported member names (`manifest_exports.json`).
- `layer_analysis.py`: parses each wrapper (registered name, browser-branch arguments, lazy getters, Node-branch requires, factory parameters), maps parameters to the namespace entries they receive, and counts `param.member` reads in code lines (`layer_table.csv`, `shared_table.csv`).
- `require_graph.py`: every string-literal `require()` across `src`, `bin`, `scripts`, `test`, plus style, comment and header counts (`require_edges.csv`, `comment_density.csv`, `dynamic_requires.txt`, `esm_matches.txt`).
- `jsstrip.py`, `hazards2.py`, `typeof_classify.py`: a small JavaScript scanner (strings, comments, regex literals blanked; brace matching for function bodies) and the hazard counts built on it (`hazards2.csv`). It is not a parser.
- `tests_scan.py`: which src folders each test file requires, and `readFileSync` calls on repo files (`test_touch.csv`, `source_text_pins.txt`).
- `who_imports_shared.py`, `aggregate.py`, `tables.py`, `build_report.py`: importer lists, rollups, and this file.

**Comment-line share** uses the contract's definition: a line whose first non-space characters are `//`, `/*` or `*`. Lines inside a block comment that do not start with `*` are not counted, so shares are slight undercounts. **Hazard counts** are scanner heuristics: `this`, `arguments`, `prototype`, `typeof` guards and `eval` are exact token matches on code with comments and strings removed; `dynamic-key writes`, `mixed return` and `multi-shape return` are pattern estimates, spot-checked on `src/shared/lifecycle.js:303` and `src/layer/anchor.js:240`. Counting `read-when` used the first 12 lines of each file.

## 1. Layer namespace

**The global.** `GLOBAL_NAMESPACE = "LAHE"` (`src/shared/manifest.js:376`). The bundle's banner creates `g.LAHE = g.LAHE || {}` and sets `g.LAHE.version` (`scripts/build-layer.js:67-86`, which also rewrites the one line `var VERSION = "0.0.0-dev";` in `index.js`, `scripts/build-layer.js:90`).

**The registration idiom, factory form** (22 of 23 layer files; `src/layer/store.js:46-67`):

```js
(function (root, factory) {
  "use strict";
  var browser = typeof window !== "undefined" && !!window.document;
  if (browser) {
    root.LAHE = root.LAHE || {};
    root.LAHE.store = factory(root.LAHE.record, root.LAHE.merge, root.LAHE.failures, root.LAHE.elapsed, root.LAHE.protocol);
  } else {
    module.exports = factory(require("../shared/record.js"), /* ... */);
  }
})(typeof globalThis !== "undefined" ? globalThis : this, function (record, merge, failures, elapsed, protocol) { "use strict"; /* ... */ });
```

**Short form** (no dependencies, 1 layer file and 6 shared files): `src/layer/listeners.js:19` opens `(function (root) {`, registers at `listeners.js:154-155` (`root.LAHE.listeners = api;`) and exports at `:157`.

**How a file reads another file's members.** Through the factory parameter, e.g. `record.FIELD`, never `LAHE.record.FIELD`. A scan for any other `LAHE.` access in code (not wrappers) finds only: `editing.js:147` and `protect.js:78` (lazy `replay` getters), `export.js:73-77` and `:619` (registration and an error message), `index.js:52` and `:339`, and `tab_edits.js:445,579,706` (call-time `root.LAHE` reads). `index.js` is the one file that receives the entire namespace (`src/layer/index.js:52`); in Node it assembles an equivalent object from `contracts.js` plus 17 explicit requires (`src/layer/index.js:56-78`), so its Node and browser namespaces differ.

**Namespace names do not match file names** (the rule at `docs/CONTRACTS.md:53-56` says they do): `style_switch.js` is `styleSwitch`, `tab_active.js` is `tabActive`, `tab_done.js` is `tabDone`, `tab_edits.js` is `tabEdits`, `conflict_toast.js` is `conflictToast`, `export.js` is `exporter` and `export` (one object under two names, `src/layer/export.js:73-77`), `index.js` is `layer`, `copy_text.js` is `copyText`, `catalog/view_model.js` is `catalogViewModel`, and shared `style_rules.js` is `styleRules`. Several factory parameters rename again (`overlayModule`, `replayModule`, `highlightModule`, `failuresModule`, `reviewFormat`).

### Layer table

`#` is the file's position in the 38-entry `LAYER_FILES` order (positions 1-15 are shared files). `exports` is `Object.keys(require(file))` in Node. `reads` is the count of distinct `param.member` reads of other modules in code lines. Full member lists: `layer_table.csv`.

| # | File | Lines | Comment lines | Registers as | Form | Exports | Depends on (factory params) | Distinct members read |
|---|---|---|---|---|---|---|---|---|
| 16 | `layer/listeners.js` | 159 | 44 | `listeners` (listeners.js:155) | short | 7 | none | 0 |
| 17 | `layer/selection.js` | 173 | 67 | `selection` (selection.js:31) | factory | 12 | s/normalize | 1 |
| 18 | `layer/blocks.js` | 369 | 90 | `blocks` (blocks.js:29) | factory | 13 | s/markers, s/normalize | 14 |
| 19 | `layer/store.js` | 1,673 | 567 | `store` (store.js:51) | factory | 15 | s/record, s/merge, s/failures, s/elapsed, s/protocol | 12 |
| 20 | `layer/anchor.js` | 2,187 | 779 | `anchor` (anchor.js:85) | factory | 36 | s/normalize, s/uniqueness, s/regions, s/markers, s/record, blocks | 18 |
| 21 | `layer/pointing.js` | 471 | 238 | `pointing` (pointing.js:56) | factory | 9 | anchor, s/normalize | 11 |
| 22 | `layer/protect.js` | 1,199 | 387 | `protect` (protect.js:77) | factory | 29 | s/markers, selection, s/epoch, (lazy), blocks, s/normalize | 13 |
| 23 | `layer/highlight.js` | 1,260 | 530 | `highlight` (highlight.js:68) | factory | 38 | s/markers, s/normalize, anchor | 8 |
| 24 | `layer/style_switch.js` | 944 | 212 | `styleSwitch` (style_switch.js:43) | factory | 23 | s/markers, s/record, s/style_rules | 12 |
| 25 | `layer/overlay.js` | 8,878 | 2,649 | `overlay` (overlay.js:86) | factory | 75 | s/markers, s/failures, s/record, highlight, s/protocol, s/gestures, s/normalize, blocks, style_switch | 52 |
| 26 | `layer/tab_active.js` | 1,289 | 341 | `tabActive` (tab_active.js:42) | factory | 6 | s/markers, s/record, s/gestures, highlight, overlay | 19 |
| 27 | `layer/tab_done.js` | 2,713 | 1,034 | `tabDone` (tab_done.js:62) | factory | 29 | s/markers, s/record, s/lifecycle, s/protocol, s/failures, s/review_format, overlay, s/gestures | 59 |
| 28 | `layer/tab_edits.js` | 856 | 270 | `tabEdits` (tab_edits.js:90) | factory | 14 | s/markers, s/record, s/normalize, overlay | 11 |
| 29 | `layer/conflict_toast.js` | 340 | 93 | `conflictToast` (conflict_toast.js:51) | factory | 9 | none | 0 |
| 30 | `layer/export.js` | 648 | 199 | `exporter`, `export` (export.js:74) | factory | 13 | s/review_format, s/record, s/protocol, s/failures | 8 |
| 31 | `layer/sync.js` | 3,794 | 1,457 | `sync` (sync.js:49) | factory | 52 | s/protocol, s/failures, s/record, overlay, s/normalize, s/markers, selection | 31 |
| 32 | `layer/choices.js` | 501 | 110 | `choices` (choices.js:49) | factory | 5 | s/record, s/gestures, s/epoch, s/failures | 20 |
| 33 | `layer/comments.js` | 3,461 | 1,196 | `comments` (comments.js:63) | factory | 28 | s/markers, s/normalize, s/record, s/regions, store, s/gestures, anchor, highlight, listeners, s/failures | 46 |
| 34 | `layer/editing.js` | 6,066 | 1,422 | `editing` (editing.js:124) | factory | 39 | s/markers, s/normalize, s/record, s/lifecycle, s/regions, s/epoch, s/gestures, selection, store, anchor, highlight, listeners, protect, comments, s/failures, blocks, (lazy) | 104 |
| 35 | `layer/zoom.js` | 1,094 | 230 | `zoom` (zoom.js:54) | factory | 21 | s/markers, listeners, highlight | 9 |
| 36 | `layer/replay.js` | 4,325 | 1,570 | `replay` (replay.js:77) | factory | 54 | s/epoch, s/uniqueness, s/normalize, s/record, s/failures, anchor, protect, s/markers, pointing, highlight, blocks | 78 |
| 37 | `layer/inject.js` | 389 | 121 | `inject` (inject.js:48) | factory | 9 | listeners, replay, s/markers, s/failures, protect | 8 |
| 38 | `layer/index.js` | 2,612 | 1,074 | `layer` (index.js:52) | factory | 10 | none | 26 |

Totals over the 23 bundled layer files: 45,401 lines, 546 exported members. Notes on the table: `index.js` reads 26 namespace entries through `ns.<name>` rather than parameters; its "distinct members read" count is that 26. `tab_edits.js` takes `root` as its first parameter to do call-time reads (see below). `s/` marks a shared file.

### Cycles and call-time forward references

Script result: no file receives a dependency at load time that a later file registers (zero load-time order violations). Call-time forward references:

| Reader (position) | Reads | Registered by (position) | How | Evidence |
|---|---|---|---|---|
| `protect.js` (22) | `replay` | `replay.js` (36) | lazy getter passed as a factory argument, called when protection lifts | `src/layer/protect.js:77-79`, call at `:1110` |
| `editing.js` (34) | `replay` | `replay.js` (36) | lazy getter (`replayRef`) | `src/layer/editing.js:144-148` |
| `tab_edits.js` (28) | `export` | `export.js` (30) | `root.LAHE.export` read each time it is asked | `src/layer/tab_edits.js:442-448` |
| `tab_edits.js` (28) | `editing` | `editing.js` (34) | `root.LAHE.editing` read each time it is asked | `src/layer/tab_edits.js:577-583` |
| `replay.js` (36) | `protect` | `protect.js` (22) | ordinary parameter, so `protect` and `replay` are a true two-way pair: `protect` reaches `replay` lazily, `replay` takes `protect` directly | `src/layer/replay.js:77-105` |
| `index.js` (38) | 26 entries | all earlier | `ns.<name>` at boot, after everything is registered | `src/layer/index.js:52` |

Late binding by method call, not by lookup: `ns.exporter.configure(...)` (`src/layer/index.js:914`; `exporter` throws "is not configured yet" until then, `src/layer/export.js:619`) and `ns.replay.configure({...})` (`src/layer/index.js:1658`, defined `src/layer/replay.js:324`). The rail reaches its tabs the other way round: `index.js` calls `ns.tabActive.createActiveTab`, `ns.tabDone.createDoneTab`, `ns.tabEdits.createEditsTab` and hands the results to the overlay (`src/layer/index.js:604,621,1297`), so `overlay.js` (position 25) never names the tab modules that load after it.

Other global effects in the layer: `inject.js:283` replaces `history` methods and calls the originals with `arguments`; `highlight.js` registers page highlights and one page stylesheet; `index.js:96,2383` publishes a `__lahe` debug global that browser tests read.

### The Library page scripts (`src/layer/catalog/`)

- **Listed** in `CATALOG_PAGE` (`src/shared/manifest.js:357-374`): `catalog/view_model.js`, `copy_text.js` (which lives in `src/layer/`, not `catalog/`), `catalog/page.js`. None is in `LAYER_FILES`, so none is in `dist/lahe-layer.js`.
- **Served** by the helper from an exact-key allowlist with an own-property check: `ASSETS["protocol.js"|"page.js"|"view_model.js"|"copy_text.js"]` map to `src/shared/protocol.js`, `src/layer/catalog/page.js`, `src/layer/catalog/view_model.js`, `src/layer/copy_text.js` (`src/service/catalog_page.js:45-50`); the lookup is `readAsset` (`:87-99`), which reads the file from disk on each request.
- **Loaded** as four `<script ... defer>` tags in this order: `protocol.js`, `view_model.js`, `copy_text.js`, `page.js` (`src/service/catalog_page.js:416-419`). The first three use the dual wrapper and register `LAHE.protocol`, `LAHE.catalogViewModel`, `LAHE.copyText`. `page.js` is a plain script that reads `window.LAHE.protocol`, `.catalogViewModel`, `.copyText` (`src/layer/catalog/page.js:41-43`).
- **Quirk:** `protocol.js`'s wrapper passes `root.LAHE.failures` (`src/shared/protocol.js:36`), and the Library page never loads `failures.js`, so `failures` is `undefined` there. `errorBody` (`protocol.js:960`) uses it, but nothing in `src/layer/catalog/` calls it, and `view_model.js:182-183` records that "the page cannot load failures.js (the asset allowlist is fixed)".

## 2. Shared wrapper

**The idiom** is the same wrapper as the layer files. Factory form, `src/shared/record.js:42-51`:

```js
(function (root, factory) {
  "use strict";
  var browser = typeof window !== "undefined" && !!window.document;
  if (browser) { root.LAHE = root.LAHE || {}; root.LAHE.record = factory(root.LAHE.normalize); }
  else { module.exports = factory(require("./normalize.js")); }
})(typeof globalThis !== "undefined" ? globalThis : this, function (normalize) { "use strict"; /* ... */ });
```

Short form (no dependencies): `src/shared/markers.js:15-17` and `:167-172`; same for `failures.js`, `style_rules.js`, `gestures.js`, `epoch.js`, `elapsed.js`. The wrapper is specified at `docs/CONTRACTS.md:25-65`. Environment is detected by `typeof window !== "undefined" && !!window.document`, so the service is "Node" by default and a browser by presence of `window.document`.

Dependency order among shared files (Node `require` in each wrapper): `markers` and `failures`, `style_rules`, `gestures`, `epoch`, `elapsed` need nothing; `normalize` needs `markers`; `record` needs `normalize`; `lifecycle` and `merge` need `record`; `regions` needs `markers` and `normalize`; `uniqueness` needs `normalize`; `protocol` needs `failures`; `review_format` needs `record`, `normalize`, `gestures`; `record_fixtures` needs `record`.

### Shared table

Comment share uses the first-non-space definition. Importer columns count distinct importing files that `require` the file directly; "layer" means a file under `src/layer/` (all of which are bundled except `copy_text.js` and `catalog/*`). Barrel imports (`contracts.js`) are not credited to the files it re-exports.

| File | Lines | Comment lines (share) | Wrapper | Bundle position | layer | service | cli | tests (unit/other) | Class |
|---|---|---|---|---|---|---|---|---|---|
| `markers.js` | 172 | 66 (38.4%) | short 15-172 | #1 | 15 | 1 | 0 | 8 / 0 | (a) constants plus small predicates |
| `normalize.js` | 1,968 | 505 (25.7%) | factory 19-28 | #2 | 12 | 2 | 1 | 7 / 1 | (b) logic both sides run |
| `failures.js` | 690 | 176 (25.5%) | short 38-690 | #3 | 10 | 1 | 0 | 11 / 0 | (a) code enum |
| `style_rules.js` | 77 | 25 (32.5%) | short 18-77 | #4 | 1 | 1 | 0 | 2 / 0 | (a) rules spelled once |
| `record.js` | 2,781 | 1,055 (37.9%) | factory 42-51 | #5 | 13 | 7 | 2 | 82 / 11 | (a) shape and constants, with (b) logic inside (135 exports) |
| `lifecycle.js` | 407 | 136 (33.4%) | factory 41-50 | #6 | 2 | 2 | 0 | 7 / 0 | (b) transition rules |
| `merge.js` | 235 | 84 (35.7%) | factory 35-44 | #7 | 1 | 0 | 0 | 5 / 0 | (b) logic, only the layer loads it |
| `regions.js` | 236 | 92 (39.0%) | factory 27-36 | #8 | 3 | 0 | 0 | 2 / 0 | (b) logic, only the layer loads it |
| `uniqueness.js` | 234 | 95 (40.6%) | factory 39-48 | #9 | 2 | 0 | 0 | 2 / 0 | (b) logic, only the layer loads it |
| `gestures.js` | 869 | 359 (41.3%) | short 32-869 | #10 | 6 | 0 | 0 | 10 / 1 | (a) vocabulary plus (b) intent functions; layer directly, service only through review_format |
| `epoch.js` | 196 | 80 (40.8%) | short 52-196 | #11 | 4 | 0 | 0 | 3 / 0 | (b) logic, only the layer loads it |
| `elapsed.js` | 64 | 32 (50.0%) | short 27-64 | #12 | 1 | 1 | 0 | 1 / 0 | (b) one wording function, both sides |
| `protocol.js` | 2,277 | 899 (39.5%) | factory 31-40 | #13 | 6 | 24 | 15 | 105 / 37 | (a) wire contract; also served raw to the Library page |
| `review_format.js` | 1,112 | 385 (34.6%) | factory 37-46 | #14 | 2 | 4 | 1 | 16 / 2 | (b) projection and text, both sides |
| `record_fixtures.js` | 536 | 65 (12.1%) | factory 25-34 | #15 | 0 | 0 | 0 | 27 / 8 | (c) tests only, but in the bundle |
| `contracts.js` | 40 | 19 (47.5%) | none (Node only) | not bundled | 1 | 0 | 0 | 1 / 0 | (c) Node barrel; layer/index.js Node branch and one test only |
| `manifest.js` | 430 | 49 (11.4%) | none (Node only) | not bundled | 0 | 2 | 1 | 3 / 11 | (c) tooling, plus runtime reads of `BUNDLE_OUTPUT` |
| `script_line.js` | 169 | 57 (33.7%) | none (Node only) | not bundled | 0 | 3 | 1 | 5 / 1 | (c) Node only, used by service and cli |

Totals: 18 shared files, 12,493 lines, 4,179 comment lines (33.5%); 15 of 18 are in the bundle. The classes in the last column are my reading of the importer evidence, not a statement in the code.

What the importer evidence says (named importers in `who_imports_shared_out.txt`):

- **`protocol.js`** is imported by 24 service files, 15 CLI files and 6 layer files, and served raw to the Library page. It is the contract file in practice.
- Five shared files are loaded by **no** service or CLI file directly: `epoch`, `merge`, `regions`, `uniqueness`, `record_fixtures` (and `gestures` only through `review_format.js`). `merge.js` is documented as the browser-versus-store merge rule (`docs/diagrams/module_map.md`), but only `layer/store.js` requires it.
- `manifest.js` is imported at runtime by `src/service/index.js:44,84`, `src/service/heal.js:53,57` and `src/cli/commands/add.js:83,100`, only to learn `BUNDLE_OUTPUT`.
- `contracts.js` says it is for "service and CLI code" (`src/shared/contracts.js:5-11`), but the only importers are `src/layer/index.js:58` and `test/unit/sanity.test.js:8`.
- `record_fixtures.js` is entry #15 of `LAYER_FILES` (`src/shared/manifest.js:114`) and appears in `dist/lahe-layer.js`; its importers are the barrel, 8 browser specs and 27 unit tests.

## 3. manifest.js

**Shape** (`src/shared/manifest.js`, 430 lines, CommonJS, `"use strict"` at `:38`). Three arrays of `{ path, owner, why }` objects, optionally `planned: true` or `cut: true`:

| Export | Entries | What it is |
|---|---|---|
| `LAYER_FILES` (`:41`) | 38 | the bundle, in load order: 15 `src/shared` files then 23 `src/layer` files; the comment at `:40` says the order is the load order |
| `NON_BUNDLE_FILES` (`:239`) | 56 | every other file under `src/` that Node runs: `src/shared` (3), `src/service` (including `lahe_render.lua`), `src/cli` |
| `CATALOG_PAGE` (`:357`) | 3 | `catalog/view_model.js`, `copy_text.js`, `catalog/page.js`, served raw |
| `BUNDLE_OUTPUT` (`:375`), `GLOBAL_NAMESPACE` (`:376`) | 2 strings | `dist/lahe-layer.js`, `LAHE` |
| `allFiles`, `entryFor`, `ownerOf`, `builtFiles`, `plannedFiles`, `cutFiles` (`:378-415`) | 6 functions | helpers over the lists; exported at `:418-430` |

- **Entries: 97** (38 + 56 + 3) against **97 files on disk** under `src/` (96 `.js` plus 1 `.lua`).
- **Owner names: 38 distinct values** across the 97 entries. They are build-phase codes from the first build and later feature names (`1A` on 22 entries, `0A-kernel` on 12, `3A` on 10, then names like `Library 1.4`, `stable-addresses install`, `re-arm guard`, `free-writing kernel`). Three read `FROZEN at CP0` inside the value. One test pins an owner string: `test/unit/export_text.test.js:163` asserts `ownerOf("src/layer/export.js") === "3C"`.
- **`planned` entries: 0. `cut` entries: 0.** The machinery is live (`builtFiles()` filters `planned !== true`, `:397-403`) but nothing uses it with a true value; `cutFiles()` has no caller anywhere in `src`, `scripts`, `bin` or `test`.
- **`CATALOG_PAGE`**: `src/layer/catalog/view_model.js` (owner `Library 2.2`), `src/layer/copy_text.js` (`stable addresses 4.2`), `src/layer/catalog/page.js` (`Library 2.2`).

**Consumers**

| Consumer | Uses | Evidence |
|---|---|---|
| `scripts/build-layer.js` | `builtFiles()`, `plannedFiles()`, `BUNDLE_OUTPUT`, `GLOBAL_NAMESPACE`; reads each `entry.path` as UTF-8 and concatenates with a `/* ---- path (owner: ...) ---- */` line | `:38,42,48-58,76-82,117-135` |
| `scripts/lint.js` | requires the file and walks every exported array generically | `:211-334` (below) |
| `src/service/index.js` | `BUNDLE_OUTPUT` (the helper serves the bundle from `dist/`) | `:44,84` |
| `src/service/heal.js` | `BUNDLE_OUTPUT` | `:53,57-58` |
| `src/cli/commands/add.js` | `BUNDLE_OUTPUT` | `:83,100-101` |
| `src/shared/contracts.js` | re-exports `manifest` | `:39` |
| 10 browser specs + `test/browser/support/replay_run_page.js` | `builtFiles()` or `LAYER_FILES` to load layer source files by path in manifest order | `comments_highlights`, `element_subject`, `heading_context`, `live_chart_observer`, `oversized_records`, `page_hotkeys_fenced`, `print`, `reveal_deck`, `selection_pill_drag`, `selection_popover`; `replay_run_page.js:22-33` |
| 3 unit tests | `ownerOf`, `plannedFiles`, `LAYER_FILES`+`NON_BUNDLE_FILES`+`CATALOG_PAGE` | `export_text.test.js:163-165`, `write_command.test.js:281-282`, `lint_lua.test.js:46-50` |
| docs | `CONTRACTS.md`, `module_map.md`, `ARCHITECTURE.md`, `TESTING.md`, `SERVING_ARCHITECTURES.md`, `skills/lahe/references/webapps.md` | `grep` for `manifest` |

**Lint's manifest completeness check** (`scripts/lint.js:211-334`):

1. `manifestPaths` (`:227-247`) takes every exported key whose value is an array, keeps entries whose path (a bare string or an object field named `path`, `file`, `src` or `source`, `:212-225`) starts with `src/`, and counts each path; entries with `planned === true` go in a set.
2. `checkManifest` (`:249-332`) loads the manifest with `require` (`:258`), then walks `src/` for **every file of any kind**, skipping dotfiles and `~ .orig .bak .swp .rej` (`:277-279`). It fails on three conditions: on disk but not listed (`missing`, `:280`), listed more than once (`duplicated`, `:283`), listed but not on disk and not `planned` (`phantom`, `:294`).
3. It is extension-agnostic, so `.ts` files on disk are picked up with no change, but every manifest `path` string must then name the renamed file. The syntax check next to it is JavaScript-only: `node --check` on every `.js` file under the repo root (`:86-95`, skipping only `node_modules`, `.git`, `test-results`, `playwright-report`, `:48`), which includes `docs/features/**` scripts, `dist/` and any `.claude/worktrees/` copy; the duplicate-declaration check compiles each file's text with `vm.Script` (`scripts/lint_duplicates.js:17-27`).

`module_map.md` is behind the code: it does not draw `script_line.js`, `style_rules.js`, `contracts.js`, `style_switch.js`, `copy_text.js`, or the service files `addresses`, `name_server`, `login_item`, `self_stop`, `summary`, `menubar`, `styles`, `catalog_sites`, `catalog_launch`.

## 4. Module style in service and CLI

| Folder | Files | Lines | `"use strict"` | `var` decls | `const` | `let` | `=>` | `class` | `async function` | `await` | JSDoc tags | `module.exports` |
|---|---|---|---|---|---|---|---|---|---|---|---|---|
| `src/service` | 37 | 23,579 | 37 | 3,010 | 0 | 0 | 0 | 0 | 35 | 56 | 294 | 37 |
| `src/cli` | 15 | 8,751 | 15 | 1,076 | 0 | 0 | 0 | 0 | 56 | 115 | 76 | 15 |
| `src/shared` | 18 | 12,493 | 18 | 1,068 | 0 | 0 | 0 | 0 | 0 | 0 | 114 | 18 |
| `src/layer` | 24 | 45,509 | 24 | 4,656 | 0 | 0 | 0 | 0 | 0 | 0 | 441 | 24 |
| `src/layer/catalog` | 2 | 2,400 | 2 | 251 | 0 | 0 | 0 | 0 | 0 | 0 | 3 | 1 |
| `bin` | 1 | 24 | 1 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 |
| `scripts` | 17 | 5,167 | 16 | 552 | 181 | 31 | 48 | 0 | 20 | 72 | 28 | 7 |

(`src/layer` here includes `copy_text.js`; `src/layer/catalog` is the two Library files. `var` declarations are counted at the start of a statement after comments and strings are removed.)

- **CommonJS `require` everywhere; zero ESM** (0 `import`/`export` matches in `src`, `scripts`, `bin`, `test`). `package.json` has no `"type"` field. Core modules are required with the `node:` prefix except `src/service/self_stop.js:55-56` (`require("crypto")`, `require("fs")`).
- **`"use strict"` in every `src` file.** `var` is the only declaration keyword in `src`; no arrows, no classes, no `let`/`const`. `async`/`await` appears only in `src/cli` (56 async functions) and `src/service` (35).
- **JSON and vendor requires:** `src/cli/index.js:93` and `src/service/index.js:69` require `../../package.json`; `src/service/markdown.js:19` requires `../../vendor/marked/marked.cjs`.
- **Computed `require`s in `src`: 0.** The 20 computed requires in the repo are in `scripts` (9), `test/unit` (6), `test/helpers` (2), `test/fixtures` (2) and `test/browser` (1); see `dynamic_requires.txt`. Dynamic file reads by path do exist in `src`: `catalog_page.js:45-50` (source files) and `pandoc.js:33` (`lahe_render.lua`).

**`require(` calls crossing folders** (string-literal relative requires from `src` and `bin`; counts are calls, then distinct requiring files):

| From | To | Calls | Files |
|---|---|---|---|
| `bin` | `src/cli` | 1 | 1 |
| `src/cli` | `src/cli` | 27 | 10 |
| `src/cli` | `src/service` | 72 | 14 |
| `src/cli` | `src/shared` | 21 | 15 |
| `src/layer` | `src/layer` | 55 | 15 |
| `src/layer` | `src/shared` | 78 | 21 |
| `src/layer/catalog` | `src/shared` | 1 | 1 |
| `src/service` | `src/service` | 98 | 29 |
| `src/service` | `src/shared` | 48 | 28 |
| `src/shared` | `src/shared` | 27 | 10 |

- **service to shared: 48 calls, cli to service: 72, cli to shared: 21, layer to shared: 78 (plus 1 from `catalog/`).**
- **Forbidden directions: none present.** No `service` to `cli`, no `layer` to `service` or `cli`, no `shared` to `layer`, `service` or `cli` (script result `forbidden = []`). The boundary is held by convention and review only; nothing in `lint` checks it.
- **Runtime file reads cross the boundary instead of requires:** the service reads `dist/lahe-layer.js` (`src/service/index.js:84,105`) and four `src` files for the Library (`catalog_page.js:45-50`).
- **Core-module use by folder** (`require` counts): `src/service`: `node:fs` 32, `node:path` 26, `node:crypto` 17, `node:os` 8, `node:child_process` 5, `node:http` 3, `node:dgram` 2, `node:dns` 1, `node:stream` 1; `src/cli`: `node:path` 11, `node:fs` 10, `node:child_process` 6, `node:net` 4, `node:os` 3, `node:crypto` 2, `node:readline` 1; `src/shared`: `node:crypto` 1. The global `fetch` is also used.

## 5. bin/lahe.js and install-cli

- **`bin/lahe.js`** (24 lines): shebang `#!/usr/bin/env node`, `"use strict"`, then `require("../src/cli/index.js").main(process.argv.slice(2))`, sets `process.exitCode` from the returned number (or 0) and prints the stack on rejection (`bin/lahe.js:1,16-24`). `package.json` `bin` is `{ "lahe": "bin/lahe.js" }`. `test/unit/add_command.test.js:988-998` pins that `bin` value and the shebang.
- **`scripts/install-cli.js`** writes `~/.local/bin/lahe`, a POSIX `sh` file: `#!/bin/sh`, a marker comment `# lahe wrapper written by scripts/install-cli.js`, and `exec "<abs node>" "<abs clone>/bin/lahe.js" "$@"` (`install-cli.js:49-58`, comment `:12-24`). It refuses to overwrite a file that lacks the marker (`decide`, `install-cli.js:70-77`; refusal at `:121`) and then installs the skills (`:162`).
- **How Node is located:** `process.execPath` of the process that ran `npm run install-cli` (`install-cli.js:97`). There is **no version check** in the wrapper, in `bin/lahe.js`, or in `src/cli/index.js`: a search of `src`, `scripts`, `bin` for `process.version`, `versions.node` and `engines` finds nothing.
- **Other places that bake in an absolute Node path plus `bin/lahe.js`:**
  - the Claude Code Stop hook that `scripts/install-skills.js` writes into `~/.claude/settings.json` (`install-skills.js:104,265-266`, header `:11-25`);
  - the login item written by `lahe install` (`src/cli/commands/install.js:58,166`; `docs/INSTALL.md:250-253` says it names the Node that ran the install);
  - child processes spawned as `process.execPath` + `bin/lahe.js` with no flags: `src/cli/commands/serve.js:232`, `session.js:322`, `library.js:402`, `add.js:698`, `src/cli/codex_monitor.js:178`; and `src/service/menubar.js:475` spawns its own file;
  - 50 test files reference `lahe.js` (spawn helpers: `test/helpers/service.js:204`, `test/helpers/spawned.js:72`).
- **Where the Node version is stated, and where they disagree:**

| Place | Says |
|---|---|
| `package.json:28-30` `engines.node` | `>=18.2.0` |
| `README.md:8` badge, `:178` | 18.2 or later |
| `docs/INSTALL.md:9` | Node 18 or later |
| `docs/INSTALL.md:15` | developing needs Node 20 |
| `src/shared/failures.js:443-449` (`CLI_RUNTIME_MISSING`) | "Node 20 or newer is required"; the code is defined but nothing in `src`, `test`, `scripts` or `docs` references it |
| `.nvmrc` | `20.19.0` |
| `.github/workflows/gate.yml` | `node-version: 20` (section 11) |
| `CLAUDE.md` (Node version section) | floor 18.2 for `server.closeAllConnections()`; dev floor 20 for Playwright 1.62 |

`npm run test:unit` is `node ... node --test test/unit/` with `LAHE_DIRECT_LAUNCH=off LAHE_MARKDOWN_ENGINE=marked` (`package.json:39`); how that directory argument behaves on newer Node lines is not checked here.

## 6. Tests

**Unit tests (`test/unit/`, 217 files, 67,523 lines, `node:test`).**

| Touches (a file can touch several) | Files |
|---|---|
| layer (`src/layer/*`) | 70 |
| service (`src/service/*`) | 129 |
| shared (`src/shared/*`) | 154 |
| cli (`src/cli/*`) | 48 |
| `scripts/*` | 10 |
| none of the four src folders | 12 |

- **How layer code is loaded:** `require("../../src/layer/<file>.js")` through the module's Node branch (e.g. `test/unit/anchor_engine.test.js:28`). **`vm` is used in 0 test files, `eval`/`new Function` in 0, and global DOM stubbing (`global.window` etc.) in 0.** jsdom is banned by lint (`scripts/lint.js:145-206`).
- **DOM stand-ins:** layer code that needs nodes gets hand-built objects. `test/unit/anchor_engine.test.js:36-60` defines its own `el()` with the five properties the engine reads; `test/helpers/simulated_page.js` is a faster copy; 11 unit files match the simulated-DOM markers. These objects are passed where a DOM `Node` or `Element` is expected.
- **How service, shared and cli are loaded:** `require()` of the module under test, and `child_process.spawn(process.execPath, [entry, ...])` of the real `bin/lahe.js` for helper tests (`test/helpers/service.js:204`). 10 unit files read `dist/lahe-layer.js` bytes.

**Browser tests (`test/browser/`, 160 files, 54,984 lines, Playwright).** 97 of 160 files require no `src` module at all; they drive pages served by a real spawned helper. How they get the layer:

- **The built bundle:** 19 browser files mention `lahe-layer.js` (`test/browser/support/with_layer.js:55,60-67` reads `dist/lahe-layer.js` and routes it at `/__lahe/lahe-layer.js`). A spawned helper serves it too (`src/service/index.js:84`).
- **Source files by path, bypassing the bundle** (these break on a rename to `.ts`): ten specs build a script from `manifest.builtFiles()` and `readFileSync(entry.path)` (`oversized_records.spec.js:32-34`, `element_subject.spec.js:35-37`, `reveal_deck.spec.js:72-74`, `print.spec.js:40-42`, `live_chart_observer.spec.js:44-46`, `selection_pill_drag.spec.js:42-44`, `heading_context.spec.js:32-34`, `selection_popover.spec.js:45-47`, `comments_highlights.spec.js:44-48`, `page_hotkeys_fenced.spec.js:53-57`); `test/browser/support/replay_run_page.js:26-38` and `protect_page.js:77` and `blocks_kernel.spec.js:38`, `anchor_engine.spec.js:42`, `best_guess_speed.spec.js:41` call `page.addScriptTag({ path })` on `src/` files.

**Test helpers** (`test/helpers/`, 23 files, 3,841 lines): 12 use Playwright; 2 require a service module; they spawn helpers by pid and stop them in teardown (`test/helpers/spawned.js`).

### Tests that read the text of repo files (removing comments or renaming files breaks them)

Found by `tests_scan.py` (79 `readFileSync` call sites in 49 files that could be repo files, listed in `source_text_pins.txt`), then read by hand. Those that read **source code text of `src/`** or **`bin/`**:

| Test | Reads | What it asserts | Breaks when |
|---|---|---|---|
| `test/unit/protocol_wire.test.js:187-191` | `src/shared/protocol.js` | a line matching `^\s*// <SERVICE_CONTRACT>: \S` exists above `SERVICE_CONTRACT` | **a comment is removed or reworded** |
| `test/unit/anchor_engine.test.js:437-444` | `src/layer/anchor.js` | source contains `uniqueness.selectUnique`; after stripping `//` lines, no `threshold`, `confidence` or `score` | the call is renamed, or a word appears in a non-`//` comment |
| `test/unit/conflict_toast.test.js:268-275` | `src/layer/index.js` | finds `function exitReadOnly()`, slices to the next `\n    }\n`, expects the body to end with `conflictToasts.sync();` | the function is renamed, reindented, or reordered |
| `test/unit/remount_contract.test.js:268-273` | `src/layer/index.js` | regex says a specific `return { booted: false, reason: ...` string is absent | message text changes (it only guards a deletion) |
| `test/unit/free_writing_f1_fixes.test.js:116-129` | `src/layer/{anchor,editing,protect}.js` | non-`//`/`*` lines contain no `"start_of_container"` or `"after_anchor"` string; `editing.js` lacks regex `\(p\|div\|h\[1-6\]` | a placement name is spelled in code; block comments not starting `*` are not filtered |
| `test/unit/choice_kernel.test.js:448-456` | `src/cli/commands/add.js`, `src/service/heal.js`, `src/service/page_routes.js` | `add.js` and `heal.js` do not match `document:\s*true` or contain `SCRIPT_ATTR.DOCUMENT`; `page_routes.js` does match `document:\s*true` | the option is renamed or reformatted |
| `test/unit/menubar_cli.test.js:146-155` | six `src/cli/commands/*.js` files and `status.js` | none matches `require\([^)]*menubar`; `status.js` calls only `menubar.appState(` | a require is added or formatted differently |
| `test/unit/styles.test.js:711-715` | `src/service/styles.js`, `src/shared/style_rules.js` | no raw bidi control characters | a literal bidi character is typed |
| `test/unit/fix_round_f3_record.test.js:150-153` | `src/shared/record.js` bytes | no NUL byte | a NUL is typed |
| `test/unit/add_command.test.js:988-998` | `bin/lahe.js`, `package.json` | shebang `#!/usr/bin/env node`; `bin` equals `{ lahe: "bin/lahe.js" }` | `bin/lahe.js` is renamed or loses its shebang |
| `test/unit/catalog_auth.test.js:516-518` | `src/service/index.js` first 60 bytes | used as a probe string for a path-traversal test (not a pin on content) | none directly |

Tests that read non-code repo text (skill, docs, fixtures), which a code migration does not touch but which pin prose: `review_format.test.js:885` (`skills/lahe/references/feedback.md`), `stable_addresses_docs.test.js:57-100` (`docs/CLI.md`, the skill, and several docs, with stale-wording regexes), `launch_by_kind`, `launch_folder`, `library_serve`, `catalog_kind_rule` (skill text), `session_fixes.test.js:149-204` (installed skill copies), `add_command.test.js:1060-1115` (docs). `harness_stub_vocabulary.test.js:33` and `protect_vocabulary.test.js:158-165` read fixture engines under `test/fixtures/`.

Other tests that depend on file names or extensions: `test/unit/lint_lua.test.js:46-50` (manifest lists), `test/unit/lint_duplicates.test.js` (the lint rule on fixture text), `scripts/no_stray_helpers.js` (wraps `node --test test/unit/`).

## 7. Contract text

**Finding: the premise in CLAUDE.md and the handoff is out of date.** CLAUDE.md ("Agent-facing docs") says the `contract` field of `review.json` is authored in `src/shared/review_format.js` and is copied into the skill, `docs/CONTRACTS.md`, and `test/unit/review_format.test.js`. In the code:

- `review_format.js` has no `contract` field; its three mentions of "contract" are comments (`src/shared/review_format.js:2,670,897`). `projectReview` builds `schema: SCHEMA` where `SCHEMA = "lahe.review/5"` (`:49,819`).
- The field was removed by commit `82e2f310` "Keep review instructions in Lahe skill" (2026-10-18). `docs/CONTRACTS.md:720` now says "**Review instructions live in the Lahe skill.** `review.json` holds review data only." and `:1375-1377` says the drain output carries no pointer to instructions.
- `test/unit/review_format.test.js:98-105` asserts `json.contract === undefined`; `test/browser/paragraph_break.spec.js:286` asserts the same. Its header comment (`:14`) still lists "the contract field is present byte for byte" as a ranked test, which is stale.

**Where agent-facing instruction text lives today** (all prose, none in `.js` except as noted):

| Place | What | Evidence |
|---|---|---|
| `skills/lahe/SKILL.md` and `skills/lahe/references/*.md` (18 files, including a hand-edits snapshot and the components pointer that the installer skips) | the instructions an agent follows | repo source of truth |
| `~/.agents/skills/lahe/` and `~/.claude/skills/lahe/` | installed copies, written by `npm run install-skills`, which also copies `vendor/stclair-doc-style/COMPONENTS.md` as `references/components.md` | `scripts/install-skills.js:37-48` |
| 8 test files | read the skill text through `test/support/skill.js` and assert wording: `no_stale_excuse`, `add_command`, `session_fixes`, `stable_addresses_docs`, `status_command`, `mark_done`, `review_format`, `reply_command` | `grep readSkillText test` |
| `src/shared/protocol.js` | `monitorCommand` and other strings agents see; `src/cli/commands/hook.js` Stop-hook text | `test/unit/hook_stop.test.js:360-384` pins its contract lines |
| `docs/CONTRACTS.md` | the shapes (record, wire, `review.json`) | starting point for types per the handoff |

What a conversion must keep byte-stable in code: `renderText` (the Copy and Export text) and `projectReview` output, both pinned by `test/unit/review_format.test.js` and `test/unit/export_text.test.js`; the CLI strings the skill tests quote.

## 8. Comment density

Lines are physical lines per file (a final newline is not a line). Comment lines use the first-non-space definition.

| Folder | Files | Lines | Comment lines | Share | `read-when` header |
|---|---|---|---|---|---|
| `src/layer` | 24 | 45,509 | 14,720 | 32.3% | 24 |
| `src/layer/catalog` | 2 | 2,400 | 347 | 14.5% | 2 |
| `src/service` | 37 | 23,579 | 7,164 | 30.4% | 37 |
| `src/shared` | 18 | 12,493 | 4,179 | 33.5% | 18 |
| `src/cli` | 15 | 8,751 | 2,040 | 23.3% | 15 |
| **`src` total** | 96 | 92,732 | 28,450 | 30.7% | 96 |
| `bin` | 1 | 24 | 10 | 41.7% | 1 |
| `scripts` | 17 | 5,167 | 984 | 19.0% | 17 |
| `test/unit` | 217 | 67,523 | 7,379 | 10.9% | 217 |
| `test/browser` | 160 | 54,984 | 8,208 | 14.9% | 160 |
| `test/helpers` | 23 | 3,841 | 1,133 | 29.5% | 23 |

(`src/layer` above is the `src/layer/*.js` top level including `copy_text.js`; `src/layer/catalog` is separate. The handoff's 47,909-line figure for the layer is the sum of the two.)

**`read-when` headers:** all 96 `src` `.js` files have one in the first 12 lines, each as a leading block comment of 3 to 4 lines (296 lines in all). `src/service/lahe_render.lua` was not counted (not `.js`) and starts with a `--` comment, not a `read-when` header. `bin/lahe.js` and all 17 `scripts/*.js` also carry one.

**Top 15 `src` files by comment lines:**

| Comment lines | File lines | Share | File |
|---|---|---|---|
| 2,649 | 8,878 | 29.8% | `src/layer/overlay.js` |
| 1,570 | 4,325 | 36.3% | `src/layer/replay.js` |
| 1,457 | 3,794 | 38.4% | `src/layer/sync.js` |
| 1,422 | 6,066 | 23.4% | `src/layer/editing.js` |
| 1,196 | 3,461 | 34.6% | `src/layer/comments.js` |
| 1,074 | 2,612 | 41.1% | `src/layer/index.js` |
| 1,055 | 2,781 | 37.9% | `src/shared/record.js` |
| 1,034 | 2,713 | 38.1% | `src/layer/tab_done.js` |
| 899 | 2,277 | 39.5% | `src/shared/protocol.js` |
| 779 | 2,187 | 35.6% | `src/layer/anchor.js` |
| 688 | 1,784 | 38.6% | `src/service/reviews.js` |
| 640 | 2,469 | 25.9% | `src/service/page_routes.js` |
| 567 | 1,673 | 33.9% | `src/layer/store.js` |
| 530 | 1,260 | 42.1% | `src/layer/highlight.js` |
| 505 | 1,968 | 25.7% | `src/shared/normalize.js` |

Comments in these files include design history, dated decisions, task ids and owner codes (for example the header of `src/shared/manifest.js:5-37`, `src/layer/index.js`, `src/layer/store.js:6-45`). The comment-line share for `record.js` (37.9%) and `protocol.js` (39.5%) matches the handoff's 38 to 40 percent.

## 9. Untyped hazards

Counts per folder from `hazards2.csv` (code with comments and strings removed). `typeof guards` splits are from `typeof_classify.py`.

| Hazard | layer | layer/catalog | service | shared | cli |
|---|---|---|---|---|---|
| Functions (`function` keyword bodies found) | 2,858 | 181 | 1,573 | 513 | 485 |
| `arguments` | 1 | 2 | 0 | 0 | 2 |
| `this` (all, including the wrapper's `: this)`) | 25 | 1 | 5 | 15 | 0 |
| Prototype or property-definition calls (`.prototype`, `__proto__`, `setPrototypeOf`, `defineProperty`) | 67 | 11 | 29 | 27 | 5 |
| `eval` / `new Function` | 0 | 0 | 0 | 0 | 0 |
| `typeof x === "undefined"` guards | 104 | 2 | 1 | 32 | 0 |
| `typeof` total | 900 | 20 | 486 | 287 | 101 |
| `Object.create(null)` (dictionary objects) | 118 | 0 | 66 | 2 | 7 |
| `hasOwnProperty` | 49 | 10 | 27 | 27 | 5 |
| `delete obj.key` | 73 | 4 | 56 | 5 | 6 |
| Dynamic-key writes `map[key] =` (loop indexes excluded) | 237 | 7 | 183 | 122 | 40 |
| Dynamic-key reads `x[key]` (loop indexes excluded) | 1,417 | 34 | 622 | 566 | 103 |
| `.call` / `.apply` / `.bind` | 83 | 14 | 35 | 27 | 5 |
| Functions returning an object/array on some paths and `null`/`undefined`/boolean/string/number on others | 46 | 6 | 26 | 7 | 5 |
| Functions returning object literals with different key sets | 32 | 4 | 25 | 4 | 11 |

What the counts mean, with examples:

- **`arguments`: 5 uses in `src`.** `src/cli/commands/session.js:388-389` (a variadic helper), `src/layer/catalog/view_model.js:195-196` (variadic merge), `src/layer/inject.js:283` (`originals[name].apply(history, arguments)` inside a wrapper that replaces `history` methods).
- **`this` outside classes is effectively the wrapper only.** All 25 layer hits and all 15 shared hits are the `: this` global fallback in wrappers (24 layer wrappers plus a second one in `src/layer/tab_edits.js:99`). Real method `this`: `src/service/markdown_links.js:178,209` (an object-literal method calling `this.name`) and `src/service/markdown.js:510,527,568` (marked renderer callbacks that use `this`, e.g. `this.parser` and `defaultTable.call(this, token)`). There are 0 classes in `src`.
- **Prototype mutation: none found.** The `prototype` count is `Object.prototype.hasOwnProperty.call` (118 uses across `src`), `Array.prototype.slice/forEach/map/some/indexOf`, and three `Object.defineProperty` calls (`src/layer/index.js:2330`, `src/service/index.js:138,142`). The one monkey-patch of a platform object is `inject.js` replacing `history` methods.
- **`eval` / `new Function`: 0 in `src`, `scripts`, `bin`.**
- **`typeof x === "undefined"` guards:** layer 104 + catalog 2 (106 together), shared 32, service 1. Splitting by target: `window`/`globalThis` wrapper checks are 67 (layer and catalog) and 32 (shared); real optional-global guards are 39 in the layer and catalog (`document`, `navigator`, `URL`, `Blob`, and similar, e.g. `src/layer/blocks.js:311`, `comments.js:599,1023`, `export.js:422-423`) and 1 in the service (`src/service/reviews.js:314`, `typeof console`).
- **Objects as maps with dynamic keys:** `Object.create(null)` dictionaries are common in the layer (118) and service (66), e.g. `src/layer/anchor.js:866,1490`, `src/service/catalog_reader.js:148,207,275`; dynamic-key writes are `src/layer/anchor.js:870`, `src/service/agent_sessions.js:252-253`, `src/shared/lifecycle.js:234-236`, `src/cli/commands/add.js:562-564`. `STATUS_FOR_CODE` lookups use `hasOwnProperty` (`src/shared/protocol.js:956-958`).
- **Functions that return different shapes:** `lifecycle.applyReply` returns `{accepted, state, refusal}` on refusals and a different key set on success (`src/shared/lifecycle.js:303-330`); `anchor.fingerprintOf` returns `null` or a record (`src/layer/anchor.js:240-262`); other examples at `src/layer/comments.js:3176`, `src/layer/editing.js:3706,4032`, `src/shared/protocol.js:607,1172`, `src/service/catalog_actions.js:122,156`, `src/cli/commands/install.js:85,157`.
- **Optional globals and environment forks** (also a typing issue): every shared and layer module branches on `typeof window` at load; `protocol.js` receives `failures` as `undefined` on the Library page (section 1); `export.js` is handed its configured instance later (`index.js:914`).
- **JSDoc already present:** 928 `@param`/`@returns`/`@typedef`/`@type` tags in `src` (layer 444, service 294, shared 114, cli 76), against 5,610 functions found, so most functions are untagged. `playwright.config.js:23` is the only file with `// @ts-check`; there is no `tsconfig.json`, `jsconfig.json`, `.d.ts`, `typescript`, `esbuild`, `eslint` or `acorn` anywhere in `node_modules` or the repo.

## 10. Other JavaScript a gate would cover

| Where | Files | Lines | Notes |
|---|---|---|---|
| `bin/` | 1 | 24 | `lahe.js` |
| `scripts/` | 17 | 5,167 | uses `var`/`const`/`let` mixed (552 / 181 / 31) and 48 arrows; `lint.js`, `build-layer.js`, `install-skills.js` and `install-cli.js` are gate or install tooling; the `measure_*` and `spike_*` files are measurement and spike scripts |
| `playwright.config.js` | 1 | 125 | only `@ts-check` file |
| `test/unit/` | 217 | 67,523 | `node:test`, `const`/arrows/`async` |
| `test/browser/` | 160 | 54,984 | Playwright specs plus `support/` (12 files) |
| `test/helpers/` | 23 | 3,841 | harness modules, stateful (spawn, pids) |
| `test/support/` | 1 | 19 | `skill.js` |
| `test/fixtures/` | 26 | 6,295 | pages and engines served to browsers; some are read as text by tests |
| `docs/features/**` | 14 | 2,399 | measurement scripts and one Playwright capture spec; lint's `node --check` walks them because it walks the whole repo |
| `dist/lahe-layer.js` | 1 | 57,347 | generated, committed, 2,508,477 bytes |
| `vendor/` | 3 `.js` files plus `marked.cjs` | not counted | `mermaid.tiny.js`, `reveal.js/dist/reveal.js`, `reveal.js/plugin/notes/notes.js` |

`scripts/` by size: `compact_draft_history.js` 916, `test_index.js` 693, `scrub-log-fixtures.js` 446, `measure_draft_write_cost.js` 441, `measure_idle_requests.js` 379, `lint.js` 367, `install-skills.js` 357, `spike_login_item.js` 262, and 9 smaller files.

## 11. CI

One workflow, `.github/workflows/gate.yml` (44 lines). It runs on push to `main` and on pull requests, ignoring `docs/**`, `**/*.md`, `.claude-commit*` (`:6-21`). One job, `ubuntu-latest`, `actions/checkout@v4`, `actions/setup-node@v4` with **`node-version: 20`** (`:30-32`, the comment says "to match .nvmrc"), then `npm run lint`, `npm run check:layer`, `npm run test:unit` (`:42-44`). No `npm ci` on purpose (`:34-37`), so the job proves a clean clone works; the browser suite and `check:menubar` do not run in CI. `.github/` also holds `ISSUE_TEMPLATE/`. `.nvmrc` is `20.19.0`.

## Non-obvious things

- `scripts/build-layer.js:90` edits source text at build time (the `VERSION` placeholder), so the bundle is not a pure concatenation.
- The bundle is 2,508,477 bytes, 57,347 lines (`dist/lahe-layer.js`), larger than the sum of its parts in line terms because of the per-file banner lines and the generated header.
- `src/layer/index.js` receives different objects in Node and the browser (section 1), so its unit tests exercise a namespace that is never the real one.
- The service holds modules in memory while serving a freshly built bundle from disk; `src/service/source_stamp.js` and `protocol.js`'s `SERVICE_CONTRACT` integer (with the per-bump `// N: reason` comments that `protocol_wire.test.js:187` pins) are the guard against a stale helper. This is the mechanism a Node-version or file-extension change would also need to respect.
- Lint's syntax check says "tracked" in its header but walks the disk (`scripts/lint.js:48,86`), so untracked files and `.claude/worktrees/*` copies of the repo are linted too.
- `CLAUDE.md`'s "Node version" section justifies the 18.2 floor by `server.closeAllConnections()`; `README.md` still advertises 18.2.

## Open questions

- I did not run the unit suite, the browser suite or `npm run lint`; every statement about behavior is from reading code and scripts. `node dump_exports.js` only `require`s modules (no helper is started).
- I did not trace every use of each of the 546 layer exports, so "distinct members read" counts only `param.member` patterns; a module aliased under another variable (`var M = record.CHOICE_MARKUP`) is counted at the alias line, but `var r = record; r.X` would be missed.
- `test/unit/stable_addresses_docs.test.js` and the other prose-pinning tests were classified by reading their top-level assertions, not every regex.
- The 10 unit files that read `dist/lahe-layer.js` were not each opened; `add_command.test.js:288,332,784` compare it byte for byte with what the helper serves or copies.
- `docs/ongoing/TESTING.md` was not opened; the test-layer description here comes from the code.

## Cleanup needed

- `/private/tmp/claude-501/-Users-kennethstclair/Documents-workspace-live-agentic-html-editor/placeholder.txt`: a stray one-line file I created by mistake at a mistyped scratch path before starting. It is under `/tmp`, which the OS manages, and is not part of this work.

## Files read

`CLAUDE.md`, `docs/diagrams/module_map.md`, `docs/ongoing/ARCHITECTURE.md`, `docs/features/20261112.01_typescript_migration/HANDOFF.md`, `docs/CONTRACTS.md` (25-65, 720, 1375-1379), `src/shared/manifest.js`, `src/shared/markers.js`, `src/shared/protocol.js` (1-60, 936-970), `src/shared/contracts.js`, `src/shared/record.js` (40-52), `src/shared/review_format.js` (selected), `src/shared/failures.js` (436-452), `src/layer/listeners.js`, `src/layer/store.js`, `src/layer/index.js` (40-120), `src/layer/editing.js` (115-200), `src/layer/protect.js` (60-95, 1105-1113), `src/layer/tab_edits.js` (85-110, 440-452, 575-585, 700-712), `src/layer/export.js` (60-90), `src/layer/catalog/*.js` (wrappers), `src/service/catalog_page.js`, `src/service/source_stamp.js`, `src/cli/commands/install.js` (50-75, 155-200), `src/cli/commands/serve.js` (225-240), `bin/lahe.js`, `scripts/build-layer.js`, `scripts/lint.js`, `scripts/lint_duplicates.js`, `scripts/install-cli.js`, `scripts/install-skills.js` (1-60), `package.json`, `.nvmrc`, `.github/workflows/gate.yml`, `playwright.config.js` (1-40), `test/browser/support/replay_run_page.js`, `test/browser/support/with_layer.js`, `test/helpers/simulated_page.js` (1-40), `test/support/skill.js`, and the test files cited in section 6. Role file `researcher.md`, principle index, and the three starting leaves.
