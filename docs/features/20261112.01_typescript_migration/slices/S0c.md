---
read-when: Reviewing or merging slice S0c (bundling with esbuild, the Library page's built file, and the elapsed browser pilot) of the TypeScript migration.
---

# S0c: bundling, and the browser pilot

## Needs the orchestrator before the pull request

- **Build and commit `dist/` on the merge commit, both files.** The branch carries no `dist/` change, as the contract says. Two things fail until the orchestrator runs `npm run build:layer` and commits `dist/lahe-layer.js` and the new `dist/lahe-library.js`:
  - `npm run check:layer` (the committed layer bundle is still the old concatenation, and the Library file does not exist in git);
  - three tests in `test/unit/catalog_auth.test.js`, which fetch `lahe-library.js` from a real helper. The helper reads it from `dist/`. In CI, with no `dist/lahe-library.js` committed, they fail.
  `dist/lahe-library.js` exists untracked in this worktree, built from the branch head.
- **Lahe's own helper on this Mac stopped during my session.** At 14:04 nothing was listening on port 7817 and no `lahe.js serve` process was running. Before that, `ps` counted one helper all session. The menu bar log says it stopped answering at 13:59:07 ("Lahe did not answer in time", once a minute) and the connection failed at 14:03:34 ("recv: 54"). Its own log's last line is 14:01:55, Ken's review `rc0734f3707bf` with two windows taking the review from each other every few seconds. I did not restart it: the contract says not to touch it. I do not know the cause. My runs in that window were `npm run gate:unit` (13:57 to 13:59), the Playwright run (to about 14:02) and the screenshot script, which ran its own in-process server on port 0 with a temp state folder, `LAHE_PAGES_PORT=0`, and no kill of anything by pid or name. The machine was loaded by those runs. Ken may need to start Lahe again.
- **`scripts/lint.js` changed, outside my files.** Commit `2171eeb4`, on its own. The manifest check treated any `.ts` path in a list as a phantom, and the contract has `LAYER_FILES` name `src/domain/elapsed.ts`. Now a listed `.ts` path only has to exist; a listed `.ts` path that does not exist still fails (checked by hand).
- **The Linux half of "byte-identical on Mac and Linux" is CI's.** See "Reproducible" below for what I could prove here.

## Outcome

Done and green. Every S0c item in the contract is built, plus the two requirements the coordinator sent mid-build (several modules behind one name, writable registered objects, and the Library list driven by `CATALOG_PAGE`).

## What I read

- Role file `builder.md`, the principles index, and the leaves Prove It Works, Test Behavior Not Implementation, Sequence Verifiable Units and Outcome-Oriented Execution.
- The architecture (Summary, Decisions, Questions 1, 2, 6, 7, the failure-mode table), the plan (Wave 0, "How each slice is built", "Tests that read source text", verification), `parts/target_layout.md`, `research/codebase_recon.md` (sections 1, 2, 3, 6, 10, "Non-obvious things"), `research/node_and_typescript.md` (esbuild, module format), `docs/ongoing/code/README.md`, S0b's spec and progress detail, the repo `CLAUDE.md`.
- The project has no documents table; I used the docs `CLAUDE.md` names.

Principles that changed a choice:

- **Prove It Works:** checked the real bundle, not just the build's tests: the registration's place in `dist/lahe-layer.js`, the same bytes from arm64, x64 and another checkout path, and a pixel comparison of the rail under the old and new bundle.
- **Test Behavior, Not Implementation:** the build tests run a bundle against a stand-in window and read what registered, not the generated text. A mutation run showed the clamp on elapsed seconds was invisible to every test, so it went (commit `45e3e30a`).
- **Sequence Verifiable Units:** each piece is its own commit, and the tests for the Library asset change, the pilot and the combined registration each went in red before their code.
- **Outcome-Oriented Execution:** the registration and forwarder are the architecture's planned bridges, built so later slices change only manifest entries; nothing else temporary was added.

## Commits (branch `ts/s0c-bundling`, on `a13ce823`)

| Commit | What |
| --- | --- |
| `afb823b2` | esbuild 0.28.2, exact pin |
| `113513b0` | the esbuild build for both files, the build tests and fixtures, `libraryFiles()` |
| `338e35d2` | Library asset tests expect one built script (red) |
| `cca878c3` | `catalog_page.js` serves `lahe-library.js` |
| `b6893e38` | the 13 specs and 2 support files take the bundle from `test/browser/support/bundles.js` |
| `06ccba5f` | the spec, `slices/S0c-spec.md` |
| `da921272` | the elapsed `.ts` tests (red) and the browser spec for both bundles |
| `2171eeb4` | lint accepts a listed `.ts` path that exists (outside my files) |
| `be5a0ce0` | `src/domain/elapsed.ts`, the forwarder, the manifest entry, `domain.md` |
| `45e3e30a` | drop the clamp no test could see |
| `7414da03` | tests for combined modules, writable objects, empty registrations (red) |
| `a986ee53` | combined, writable registration; `CATALOG_PAGE` drives the Library file; README section |
| this file's commit | progress detail, screenshots, spec line count |

## Changes and proof

### The build (`scripts/build-layer.js`)

- One generated entry, an esbuild `stdin` module, one `import` per manifest entry in order. Nothing is written to disk.
- An old `.js` file goes in as it is. esbuild wraps it as CommonJS and calls it at its place, so it still registers itself on `window.LAHE`.
- A `.ts` entry gets a generated registration module (`lahe-register:<path>`) at the same place: it imports each of the entry's `modules` (default: its `path`), copies their exports into one plain object with `Object.assign({}, ...)`, and assigns it to `window.LAHE.<name>` for every name in `registers`. `registers: []` runs the module and registers nothing. Two combined modules exporting one name fail the build (checked from an esbuild metafile, so nothing runs).
- Both files go through one `bundle()` function: the layer from `manifest.builtFiles()`, the Library page from `manifest.libraryFiles()`, which is `CATALOG_PAGE` with `{ sameAsLayer: "protocol" }` replaced by the `LAYER_FILES` entry that registers `protocol`.
- Kept as before: the banner; on the layer, the first statement that creates `window.LAHE` and sets `version`; the version as package version plus a content hash (now a hash of the bundle's own code); the `VERSION` stamp in `index.js`; `target: "es2022"`, no source maps. `legalComments: "none"`, `absWorkingDir` set to the repo root so path comments do not depend on where the clone is.
- Every esbuild warning fails the build. There are none today.
- `buildAll()` returns both files in memory; `stop()` stops esbuild's process.

**The Node branch choice.** Every `require()` call is marked external. The only ones in bundled files are the old wrappers' Node branches, behind `typeof window !== "undefined" && !!window.document`, which a browser never takes. Bundling them would pull `contracts.js` and `manifest.js` (from `index.js`) into the browser file, and `node:crypto` (from `record.js`) cannot be bundled for a browser at all. esbuild leaves each as a call to a `__require` shim that throws if it ever runs; none does. 139 such calls sit in the layer file.

The registration lands where it should. In `dist/lahe-layer.js` as built from the branch head:

```
  var import_epoch = __toESM(require_epoch());
  // src/domain/elapsed.ts
  ...
  // lahe-register:src/domain/elapsed.ts
  var converted = Object.assign({}, elapsed_exports);
  globalThis.LAHE = globalThis.LAHE || {};
  globalThis.LAHE.elapsed = converted;
  // lahe-entry.js
  var import_protocol = __toESM(require_protocol());
```

### Reproducible

| Check | Result |
| --- | --- |
| `npm run build:layer` twice, `shasum -a 256` | identical both times: layer `e714683c...`, library `8b5ad360...` |
| `npm run check:layer` after `npm run build:layer` | "dist/lahe-layer.js is current (38 files built)", "dist/lahe-library.js is current (4 files built)", exit 0 |
| the same build with esbuild's x64 macOS binary under Rosetta (`ESBUILD_BINARY_PATH`) | same bytes as the native arm64 binary |
| the same build from a copy of the source at another path | same bytes |
| Linux | not run here: Docker is installed but its daemon was not running, and starting it was not mine to do. CI's `check:layer` on the PR is the proof |

The first row's hashes were built from the code committed as `a986ee53`. The x64 and other-path checks ran at `45e3e30a`, and each gave the same bytes as the native build of that commit.

### Bundle sizes

| File | Before | After |
| --- | --- | --- |
| `dist/lahe-layer.js` | 2,508,483 bytes (concatenated, comments kept) | 1,665,343 bytes, 33.6 percent smaller (esbuild drops comments) |
| the Library page's scripts | four raw files, 212,752 bytes | `dist/lahe-library.js`, 173,745 bytes, 18.3 percent smaller |

Sizes by `sizes.py` in the session scratchpad, from `git show a13ce823` and the built files.

### The Library page (`src/service/catalog_page.js`)

The asset map has one script, `lahe-library.js`, read from `dist/` through `manifest.LIBRARY_OUTPUT`, beside the style bundle and fonts. The exact-key and own-property lookup is unchanged. The page loads one `<script ... defer>`. The four old names now 404. The quirk is kept: the Library file holds the protocol, the view model, the copy function and the page script, and not `failures.js` (pinned in `build_layer.test.js` and `bundle_registration.spec.js`).

### The browser specs

`test/browser/support/bundles.js` builds both files once per Playwright worker through `buildAll()` and stops esbuild after. The 10 specs that concatenated source and the 3 specs and 2 support files that added `src/` files as script tags now call `layerBundle()`. The five that loaded a subset get the whole layer; none of their pages carries a config tag, so nothing boots.

### The pilot (`src/domain/elapsed.ts`)

Built to [S0c-spec.md](S0c-spec.md), test first:

- Red: `node --test test/unit/domain/elapsed.test.ts` failed with `ERR_MODULE_NOT_FOUND`.
- The tests describe the old behavior: against the old `elapsed.js` through a throwaway re-export, 9 of 9 passed.
- Green: 9 of 9.
- Mutation checks: threshold 60 instead of 90 failed 1; flooring seconds failed 1; removing the clamp failed none, so the clamp went.
- Node: `src/shared/elapsed.js` is `module.exports = Object.assign({}, require("../domain/elapsed.ts"));`, in `FORWARDERS`. The two `describeHolder` cases in `page_scope.test.js` run through it.
- Bundle: `LAYER_FILES` names `src/domain/elapsed.ts` with `registers: ["elapsed"]` at the old position.
- Browser: `test/browser/bundle_registration.spec.js` reads the rail's chip text through `store.describeHolder`, an old file that takes `elapsed` off `window.LAHE` as it loads.
- Comments' knowledge moved to [docs/ongoing/code/domain.md](../../../ongoing/code/domain.md).

| File | Total | Comment lines | Blank | Code |
| --- | --- | --- | --- | --- |
| old `src/shared/elapsed.js` | 64 | 32 | 5 | 27 |
| new `src/domain/elapsed.ts` | 26 | 3 (the header) | 4 | 19 |
| new `test/unit/domain/elapsed.test.ts` | 78 | 3 (the header) | 13 | 62 |

Old test cases: 4 touched elapsed; 2 moved to the new file, 2 stay in `page_scope.test.js`. 0 dropped. The spec maps each.

### The coordinator's two requirements

- **Several modules behind one name, writable objects.** Built as above. Tests in `build_layer.test.js`: combined exports, an assignment to a registered function (fails against the previous build, where the object was the read-only namespace), a clash refused, `path` must be first of `modules`, `registers: []`. `elapsed.test.ts` checks the forwarder's object is writable. The rule that makes the copy safe is written in [docs/ongoing/code/README.md](../../../ongoing/code/README.md#moving-a-file): **a converted module exports functions and constants only, never a `let` it reassigns later.** The new "Moving a browser file" section there says how a slice edits a manifest entry.
- **The Library page from `CATALOG_PAGE`.** One code path. `CATALOG_PAGE` is now the whole ordered list; its first entry, `{ sameAsLayer: "protocol" }`, follows whichever `LAYER_FILES` entry registers `protocol` (that entry now says so with `registers: ["protocol"]`). C4 changes that one entry and both files follow. A `.ts` entry placed directly in `CATALOG_PAGE` (B13's files) registers the same way. Nothing I had built conflicted; the earlier `libraryFiles()` hard-coded `protocol.js`'s path and is replaced.

### Gate and specs

`npm run gate:unit` at `a986ee53`:

```
lint passed (syntax: 556 files, no duplicate declarations, lua: 1 file via pandoc lua, no jsdom, manifest complete, kebab-case .ts names)
ℹ tests 3284
ℹ pass 3277
ℹ fail 0
ℹ skipped 5
ℹ todo 2
no_stray_helpers: no helper from this run is still running
```

The 5 skips are the menu bar app tests, as in S0b. The run before it had 1 failure, `agent_liveness.test.js` "the probe answers off a real tail, and never blocks the poll" (`refresh` returned null, not false, after 2 seconds). That test runs the machine's open-file probe on a timer and does not touch anything S0c changed. It passed 3 of 3 alone, and the full run above passed with it. I count it as load-timing, not a pass I can explain away: the orchestrator's checkpoint run will show whether it recurs.

Playwright, Chromium, by name, at `a986ee53` with `dist/` built from it: the 13 specs, the 7 specs that use `protect_page.js` and `replay_run_page.js`, `bundle_registration.spec.js`, and the Library specs `catalog_page`, `catalog_library`, `catalog_cross_site`. **208 passed, 0 failed, 1 skipped** (the `catalog_page` screenshot test, which runs only with `LAHE_SHOTS=1`).

On the way there, `best_guess_speed.spec.js` failed twice: the whole layer reads `localStorage` as it loads, and its page was `about:blank`, which refuses. The old concatenated bundle throws the same `SecurityError` on that page (checked by loading `git show a13ce823:dist/lahe-layer.js`). The spec now serves its page from an http address through `page.route`.

### Screenshots

Taken after the passing spec run, from `dist/` built at the branch head, by `shots.js` in the session scratchpad. The rail is on `test/fixtures/built-doc.html`, booted with sync held back, with the second-window chip whose text the browser computed through the converted elapsed module. The rail takes its scheme from the page's background, so the dark picture puts the same document on a dark background. The Library page is served by a real in-process server on port 0 with a temp state folder; its only script request was `/catalog/assets/lahe-library.js`.

- [rail, light](S0c/rail_light.png) and [rail, dark](S0c/rail_dark.png)
- [Library, light](S0c/library_light.png) and [Library, dark](S0c/library_dark.png)

The rail under the old bundle (`a13ce823`) and the new one, same script, same page: **0 of 1,100,800 pixels differ**, light and dark (`pixcmp.py`). The Library page was not compared against the old four-file serving; the three Library specs are the proof there.

### Leftover processes

`ps -axo command | grep -c "[l]ahe.js serve"`: 1 before my first test run, 1 after the first two Playwright runs, 1 before and after both `gate:unit` runs, 1 before and after the last Playwright run, 1 after the first screenshot run, 0 after the second. The 1 was Ken's helper; see the top of this page about it stopping. `esbuild --service` processes after the Playwright runs: 0.

### Verification table rows owned by S0c

| Requirement | Status |
| --- | --- |
| Browser bundle built by esbuild, committed, reproducible | pass on this Mac (two builds identical, arm64 and x64 identical, `check:layer` passes after `build:layer`); Linux unverified until CI runs on the PR, after the orchestrator commits `dist/` |
| Tests leave nothing running | pass for my runs: no test helper left, no esbuild process left. Ken's own helper stopped during the session; cause unknown (top of page) |

## Deviations and surprises

- **No old test file to `git mv`.** The elapsed cases lived in `page_scope.test.js`, so they moved by case, as S0b's did.
- **`scripts/lint.js` edited** (top of page).
- **`docs/ongoing/code/README.md` edited**, on the coordinator's instruction, for the export rule; I added the "Moving a browser file" section beside it.
- **The architecture says the Library build removes the `failures.js` quirk; the contract says keep it.** I kept it, as the contract says.
- **The version hash is of the bundle's code, not the source text.** A comment-only edit no longer changes the version, because it no longer changes the bundle.
- **The five subset loaders now load the whole layer.** `anchor.js` now gets the real `blocks` module where those specs used to give it `undefined`. All their tests pass.
- **`registers` on an old `.js` entry** (`protocol.js`) is metadata the build does not use for that file; it lets `CATALOG_PAGE` find the entry by name.
- **`manifest.js` is now required by `catalog_page.js`**, for `LIBRARY_OUTPUT`. `index.js`, `heal.js` and `add.js` already require it for `BUNDLE_OUTPUT`.

## Follow-ups

- **Commit `dist/` both files**, then the PR's CI is the Linux reproducibility proof. Owner: orchestrator.
- **Lahe's helper on Ken's Mac** may need starting again (top of page). Owner: Ken.
- **Docs that still describe four raw Library files:** `docs/CONTRACTS.md` around lines 1246 to 1260 (the `catalog.asset` allowlist table and "raw from `src/` with no build step") and `docs/ongoing/LIBRARY.md` line 22 ("served from `src/` ... never from `dist/`"). Also `docs/ongoing/TESTING.md` line 62 (put back only `dist/lahe-layer.js`) and `CLAUDE.md`'s `check:layer` and `dist/` lines, which name only the layer file. Not my files.
- **A lint rule for the export rule.** "Never export a `let`" could be one `no-restricted-syntax` selector in `eslint.config.mjs` (`ExportNamedDeclaration > VariableDeclaration[kind='let']`) with a fixture in `strictness_gate.test.js`, so the rule is enforced and not only written down. S0b's file.
- **`src/shared/script_line.js`** (S0b's forwarder) still hands out the read-only namespace. It is Node-only and nothing writes to it, so it is fine; if the forwarder form should be uniform, it is one line.
- **`agent_liveness.test.js`'s probe test** failed once under the full suite (Gate and specs). Worth watching at checkpoint 0.

## Cleanup needed

In the repo: none. `dist/lahe-library.js` is untracked here on purpose (top of page); `dist/lahe-layer.js` is put back with `git checkout`. `test-results/` from the Playwright runs is git-ignored and left in place.

Outside the repo, in the session scratchpad under `s0c/` (the OS owns that folder): the prototype, `toplevel.js`, `rewrite_specs.py`, `probe_blank.js`, `old-lahe-layer.js`, `hash_builds.js`, the x64 esbuild package in `esbuild-x64/`, the `other-clone/` copy, `shots.js`, `shots_compare.js`, `cmp_old/`, `cmp_new/`, `pixcmp.py`, `sizes.py`, `manifest.keep.js`, the two `build-layer.*.js` copies, and the Playwright and gate logs. The screenshot runs also left temp state folders `lahe-s0c-shots-*` under the system temp folder.
