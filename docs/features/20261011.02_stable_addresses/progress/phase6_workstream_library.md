# Workstream library: progress

## Summary

Tasks 4.1 (kinds and Open) and 4.2 (the Library's address and copy) are built, green, and committed on `unit/sa-library`. With `LAHE_PAGES=sites`, the Library shows stable addresses, Open binds a site through the registry and restarts nothing, the Library answers at `library.lahe.localhost:<pages port>`, and Copy works without the clipboard API. With the switch off, the Library behaves as before: the new code is reached only when `index.js` hands the reader and the actions the site tools, and it does not when the switch is off.

- `npm run gate:unit`: 2555 tests, 2553 pass, 0 fail, 2 todo (both were already there). The branch base had 2517; the 38 new ones are this workstream's.
- New browser spec [library_stable_address.spec.js](../../../../test/browser/library_stable_address.spec.js): 5 tests pass in Chromium, Firefox and WebKit. A sixth takes the screenshots and runs only when `LAHE_SCREENSHOT_DIR` is set.
- Also run in Chromium, each on its own, because the Library page changed: `catalog_page.spec.js` (29 pass), `catalog_library.spec.js` (3 pass), `catalog_cross_site.spec.js` (2 pass).
- Leak check (`ps -axo command | grep -c "[l]ahe.js serve"`): 2 before, 2 after. Both are Ken's own helpers from the main checkout. Other builders' helpers showed up in between and went away; none was started from this worktree.
- Every new test was checked against a change that removes the behavior it names. The ones that matter most: no hold, hold too eagerly, no stamp, rewriting the entry page, no vouching, no field fallback, and a page that refuses the new address. Each one failed.

## Screenshots

From the passing browser run, in Chromium:

- [The Library with stable addresses, light](screenshots/library_stable_addresses_light.png)
- [The Library with stable addresses, dark](screenshots/library_stable_addresses_dark.png)

Two rows show their address as a link under the path. The dark link color is the page's accent, because the document style's own link color was too dark on the dark ground.

## What was built

- **The Library's address** ([auth.js](../../../../src/service/auth.js)). The Library's Host check also accepts `library.lahe.localhost:<pages port>`, compared exactly, when the switch is on. Token, `Sec-Fetch-Site` and exact Origin are unchanged. A document's Host, `library.lahe`, a trailing dot, capitals, another port, and the API port with the library name are all refused. `lahe library` prints the stable address when the running helper reports pages mode.
- **Kinds** ([catalog_reader.js](../../../../src/service/catalog_reader.js), [catalog_sites.js](../../../../src/service/catalog_sites.js)). With the switch on, a row is openable when Lahe can serve its document, not when a page server covers it. I kept the existing field values and mapped the architecture's table onto them:

  | Architecture kind | `kind` | `openable` |
  |---|---|---|
  | openable | `static` | `yes` |
  | worktree (the registry kept the main checkout) | `worktree` | `yes` |
  | worktree the registry never saw (old rule, needs an agent) | `worktree` | `via-agent` |
  | via-agent (dev server, or a file Lahe cannot serve) | `dev-server` or `static` | `via-agent` |
  | legacy | `legacy` | `via-agent` |

  A row with a named site carries `address`, and `served_url` carries the same address, so the "being served now" badge shows. Listing never names a site.
- **Open** ([catalog_actions.js](../../../../src/service/catalog_actions.js)). It finds or names the document's site, stamps the review as re-served, drops its old `127.0.0.1:<port>` origins, and returns the address. Nothing is restarted and no session is reopened. An existing site keeps its entry page. A hand-over still goes to the attached agent, and the confirm step still comes first, before anything is named or stamped.
- **The rail.** Open does not stamp when a review in another open session holds the page. It goes to the address and returns `held_by`, and the row says: "Opened. "<name>" is a newer review in another open session and keeps this page's rail. Open did not move it." A holder in a closed session, or in the row's own session, does not hold.
- **Open serves nothing new.** A review's recorded paths are page text, because a page with the review's token can write any path into `meta.json`. So Open makes a plan only for a root that something a page cannot write has already served: a site in the registry, an old page server's record (its root or a mount), or, for Markdown, the rendered copy the CLI wrote into the state folder. Anything else stays via-agent. This keeps the rule `docs/ongoing/LIBRARY.md` states.
- **Copy** ([copy_text.js](../../../../src/layer/copy_text.js)). One function, `LAHE.copyText(text)`, returning a promise of whether it worked. It uses the clipboard API when the page has one, and otherwise a hidden field and the browser's copy command, run inside the click. The Library's Copy button calls it.
- **The page** ([view_model.js](../../../../src/layer/catalog/view_model.js), [page.js](../../../../src/layer/catalog/page.js), [catalog_page.js](../../../../src/service/catalog_page.js)). The address link, the rail note, the worktree notice, and a tab check that accepts a Lahe site address as well as a loopback one. The check is `isLaheSiteUrl`: http, no credentials, one to four Lahe labels under `lahe.localhost`.

## Rows that pass, and the test that proves each

| Row | Test |
|---|---|
| V39 Open binds and opens the stable address | [library_open_sites.test.js](../../../../test/unit/library_open_sites.test.js), the "V39:" tests (binding, stamp, old origins, same address twice, entry page kept, hand-over still queued, refused hand-over names no site); browser "V39:" in library_stable_address.spec.js: the tab opens at the address and the page's rail is that review's (three lanes) |
| V40 a newer open review keeps its rail, and the row says so | library_open_sites.test.js, "V40:" and two "V40 control:" tests (closed holder, same-session holder); browser "V40:" shows the note and checks the opened page's rail |
| V41 kinds | library_open_sites.test.js, the "V41:" tests (page, Markdown, notes, folder, dev server, unservable file, legacy, missing, worktree with a recorded main checkout opened read-only, worktree the registry never saw); [catalog_view_model.test.js](../../../../test/unit/catalog_view_model.test.js) for the worktree wording |
| V42 no Open restarts a process or reopens a session | library_open_sites.test.js, "V42:": a closed session stays closed, `catalog.json` has no reopened record, and the old server record is untouched |
| V43 the Library's address | [library_address.test.js](../../../../test/unit/library_address.test.js), six "V43:" tests (loads with its token, the checks still hold, a document's Host never reaches it, `library.lahe` and malformed Hosts, the API port, the switch off); [library_command_sites.test.js](../../../../test/unit/library_command_sites.test.js) for the CLI's printed address; browser "V43:" (two tests, three lanes) |
| V44 Copy without the clipboard API | [copy_text.test.js](../../../../test/unit/copy_text.test.js) (seven tests, including that the field copy runs before any await); browser "V44:" removes `navigator.clipboard`, checks it is gone, clicks Copy, and reads the text the browser's copy command copied (three lanes) |
| Open serves nothing new | library_open_sites.test.js: "Open serves nothing new" (a page-written path nothing served, for a page, Markdown, notes and a folder), the three anchors each openable on their own |

## Deviations

- **Three small edits to `index.js`, which core owns.** No other way to wire the Library: it needs the pages port and the registry.
  - `catalog.pagesPort = boundPagesPort`, only with the switch on, so the Host check knows the port.
  - It builds the site tools (`createCatalogSites`) when the switch is on.
  - It passes them to the reader and the actions as `pages`.

  Core is working in `index.js` too, so expect a small merge by hand.
- **The Library name is accepted only at the pages port.** Not at the API port, even with the switch on. Dispatch already lets the name reach the Library on either port; the Host check is the one that refuses it at the API port. A port-free address, once the install workstream adds the forward, needs one more case in `catalogHostAllowed`.
- **`lahe library` prints the stable address.** The orchestrator's note says the Library answers at `library.lahe.localhost:<port>`; printing it there is the smallest way to make that the address people use. With the switch off it prints what it always did.
- **Field values kept.** The architecture's names (openable, worktree, via-agent, legacy) are the mapping in the table above, not new field values. A new vocabulary would have touched the drain, the layer and every test.
- **`address` is in the list only with the switch on,** and `held_by` is in the Open answer only then. With the switch off the list and the answer are what they were.
- **A worktree row's address is not "being served now".** Its address opens the read-only copy, so `served_url` stays null for it and only `address` is set.
- **The reopened-session sweep and its rollback are not removed.** That is Task 4.3. With the switch on, Open never writes a `reopened` record, so the sweep has nothing to do.
- **The shared copy function is in `src/layer/copy_text.js`,** listed with the Library page's raw-served files in the manifest, not in the bundle. The bundle and `dist/` are untouched. When the rail adopts it, the manifest line moves into `LAYER_FILES`.
- **Duplication I left, and why.**
  - `landingFile` in the reader repeats the loop in `openPathOf`, which goes away with the off branch in 4.3.
  - The old-origin pattern and the stamp-and-drop step in `catalog_sites.js` repeat the tail of the `site.bind` route in `routes.js`, which core owns. One shared function would be better, and it is core's file.
- **Tests that order two reviews do not sleep.** The newer review is created second, with an id that sorts after, and the helper's clock runs a minute ahead so an Open stamps later than both. The repo's no-sleeps check caught the first version.

## Follow-ups

- **Core, `status.js`:** the drain's describer builds its reader without the site tools. For a review the helper serves itself, `kind` reads `static` and `folder` is null, because `launchRoot` looks for a page server record. "Launch a new agent" then loses the project folder for those rows. The fix is for the drain to build the reader with the registry, read from disk. `lahe session name --from-review` and `lahe library serve` use the same reader.
- **Install workstream:** the port-free Library address needs one case in `catalogHostAllowed` in `auth.js`. `library.lahe` is refused today, as V43 requires.
- **Task 4.3:** remove the reader's old branch (`placeRow`, `openPathOf`, the server probe), the reopened-session sweep, `setReopened`, and `reopenForCatalog`; update `docs/ongoing/LIBRARY.md` (its Open and Helper lifetime sections) and the Library parts of the two diagrams. Note for that task: `catalog_sites.js` vouches through old page server records, which core said stay readable until the migration.
- **Orchestrator:** the three-lane run of V43 is done here for my spec, and passes. `dist/` was not rebuilt and is unaffected.

## Self-review against the engineering principles

- **Minimize the diff, consolidate decisions.** One new service file (`catalog_sites.js`) holds every question about sites for the Library; the reader and the actions call it and decide nothing about roots themselves. The hand-over step moved into one function that both Open paths use.
- **Flat call hierarchy.** Open is `open` then `openSite` then `catalog_sites`. No new layer.
- **Subtract.** No new field values, no new route, no new asset beyond the copy function.
- **Name the invariant at the boundary.** "Open serves nothing new" is stated in the header of `catalog_sites.js` and enforced in one function, `vouched`.
- **Weak points I know of:** the duplication listed above, and `describeReview` scans the whole state folder once more on the hold path. That path only runs when another review holds the page.

## Cleanup needed

- `test-results/` in the worktree: Playwright's output from the spec runs (gitignored).
- `.claude-commit202610111602-library`, `.claude-commit202610111640-library`, `.claude-commit202610111730-library`, `.claude-commit202610111830-library` in the worktree root: commit message scratch files (gitignored).
- `/tmp/sa-lib-baseline.txt`, `/tmp/sa-lib-gate2.txt`, `/tmp/sa-lib-gate3.txt`, `/tmp/sa-lib-gate4.txt`: gate output (OS-managed, nothing to do).
