# Workstream core: progress

## Summary

Step 1 (Tasks 1.0 to 1.4) is built, green, and committed on `unit/sa-core`. With `LAHE_PAGES=sites`, the helper serves pages itself at `http://<name>.lahe.localhost:<port>/<path>`, and `lahe review` and `lahe write` print that address. With the switch off, nothing changes: every test that passed on the branch base still passes.

- `npm run gate:unit`: 2517 tests, 2515 pass, 0 fail, 2 todo (both were already there). The branch base had 2440 tests; the 77 new ones are this step's.
- New browser spec [stable_addresses_sites.spec.js](../../../../test/browser/stable_addresses_sites.spec.js): 6 tests, green in Chromium, Firefox and WebKit (18 runs).
- Leak check: 2 before, 2 after. Both are Ken's own helpers from the main checkout (`serve --restart` and `serve --port 62840`), not from this work.
- Every new unit and browser test was checked against a change to the code that removes the behavior it names, and each one failed. The dispatch tests were also run against the branch base's `index.js` (13 of 15 failed there).

## Task 1.0: the spike

A page at a dotted name loads in all three Playwright lanes on this Mac, with no launch flag. `window.isSecureContext` is true in all three.

| Name | Chromium | Firefox | WebKit |
|---|---|---|---|
| `one.lahe.localhost` | loads | loads | loads |
| `a.b.c.lahe.localhost` | loads | loads | loads |
| `live-agentic-html-editor.docs.ongoing.lahe.localhost` | loads | loads | loads |

The spec is [tmp_spike_lahe_localhost.spec.js](../../../../test/browser/tmp_spike_lahe_localhost.spec.js), committed so the orchestrator's dispatch workflow can run it on Linux. Linux is not checked here.

## What was built

- **The registry** ([sites.js](../../../../src/service/sites.js)). It makes one name per folder or notes page, from the folder and its two parents, keeps it unique, never reuses it, and records a worktree's main checkout. `sites.json` is a copy of the append-only `sites.log`, so a lost or corrupt `sites.json` is rebuilt with the same names. When neither file reads, no new name is made. Only the helper writes them.
- **Host dispatch and listeners** ([index.js](../../../../src/service/index.js), [protocol.js](../../../../src/shared/protocol.js)). Every listener checks the Host first, before the preflight or any route:
  - loopback names reach the API, as today;
  - `library.lahe.localhost` reaches only the Library's routes;
  - a registered name reaches pages, on the pages port only;
  - anything else is a 400 with one log line.

  The helper also listens on `::1`; a failed `::1` bind is a log line. `service.json` now has a `pages` block (mode, port, printed ending).
- **Page serving** ([page_routes.js](../../../../src/service/page_routes.js)). Same paths as a page server, and today's rail rule without the session filter. It also covers hidden-file and dot-segment refusal in every spelling, Markdown rendered from source, mounts stored on the site, the unknown-name and file-gone pages, and the read-only main-checkout copy for a gone worktree. Every response carries `Cross-Origin-Resource-Policy: same-origin`.
- **Binding** ([routes.js](../../../../src/service/routes.js), [auth.js](../../../../src/service/auth.js), [reviews.js](../../../../src/service/reviews.js)). `site.bind` needs the CLI secret from an owner-only file and refuses any request with an Origin header. It finds or makes the name, stamps the review as re-served (`served_at`), and drops the review's old `127.0.0.1:<port>` origins. A page's request to the API, sent from a site origin, is accepted only for a review that answers on that site.
- **The CLI** ([review.js](../../../../src/cli/commands/review.js), [add.js](../../../../src/cli/commands/add.js)). When the running helper reports the switch on, `lahe review` and `lahe write` work in three steps:
  - they decide the site the way a page server chose its root;
  - they run `add --served-by-helper`, which writes nothing into the folder;
  - they bind the review over `site.bind` and print the address.

  With the switch off, they start a page server exactly as before.

## Rows that pass, and the test that proves each

| Row | Test |
|---|---|
| V1 name rule | [sites_registry.test.js](../../../../test/unit/sites_registry.test.js), the eight "V1:" tests |
| V2 clash | sites_registry.test.js, "V2:" tests |
| V3 reserved | sites_registry.test.js, "V3:" |
| V4 registry loss | sites_registry.test.js, four "V4:" tests |
| V5 worktree record | sites_registry.test.js, two "V5:" tests |
| V6 single writer | [sites_cli.test.js](../../../../test/unit/sites_cli.test.js), "V6:" |
| V7 Host closed set | [sites_dispatch.test.js](../../../../test/unit/sites_dispatch.test.js), four "V7:" tests |
| V8 grammar | sites_dispatch.test.js, three "V8:" tests |
| V9 dispatch order | sites_dispatch.test.js, three "V9:" tests |
| V10 `::1` | sites_dispatch.test.js, two "V10:" tests |
| V11 page loads with its rail, no agent listening | stable_addresses_sites.spec.js, "V11:" (three lanes) |
| V12 relative assets, `../` | stable_addresses_sites.spec.js, "V12:"; unit half in [sites_pages.test.js](../../../../test/unit/sites_pages.test.js) |
| V13 Markdown, images, outside link | stable_addresses_sites.spec.js, "V13:"; unit half in sites_pages.test.js |
| V14 hidden files and dot segments | sites_pages.test.js, two "V14:" tests |
| V15 notes page-only | sites_pages.test.js, two "V15:" tests |
| V16 isolation with a positive control | stable_addresses_sites.spec.js, "V16:" |
| V17 CORP | sites_pages.test.js, "V17:" |
| V18 unknown name | sites_pages.test.js, "V18:"; browser render in the screenshot test |
| V19 gone file | sites_pages.test.js, two "V19:" tests |
| V20 worktree copy | stable_addresses_sites.spec.js, "V20:" |
| V21 rail rule | [sites_binding.test.js](../../../../test/unit/sites_binding.test.js), eight "V21:" tests |
| V22 binding authority | sites_binding.test.js, three "V22:" tests |
| V23 GET never writes | sites_pages.test.js, "V23:" |
| V24 Origin check | sites_binding.test.js, three "V24:" tests |
| V25 old origins | sites_binding.test.js, "V25:" |
| V65 same file, same address | sites_binding.test.js, "V65:"; also sites_cli.test.js, "the same file reviewed again" |
| V66 bind target | sites_registry.test.js, two "V66:" tests; sites_binding.test.js, "V66:" over the route |
| V68 listen addresses | sites_dispatch.test.js, "V68:" |
| V69 escaping | sites_pages.test.js, two "V69:" tests |

The Step 1 step test is in sites_cli.test.js. With the switch on, it runs `lahe review` on an HTML file, on a Markdown file with an image and a link outside its folder, and on a folder, and it runs `lahe write`. Each one prints a `.lahe.localhost` address, and each page loads with its rail. A comment posted from the printed address reaches `review.json`.

## Screenshots

From the browser test run, in Chromium:

- [Unknown name, light](screenshots/unknown_name_light.png)
- [Unknown name, dark](screenshots/unknown_name_dark.png)
- [File gone, light](screenshots/file_gone_light.png)
- [File gone, dark](screenshots/file_gone_dark.png)

The house document style has no dark mode, so these two pages add a small dark palette of their own (in `page_routes.js`).

## Changes from plan

- **`add --served-by-helper` registers one origin, `"null"`.** The plan says "no origin". The CLI's own requests to the helper carry no Origin header, which the helper reads as `"null"`. Without it, every second `lahe review` of a file would be refused and fall back to restarting the helper. `"null"` is what today's static reviews already register. No loopback port origin is added.
- **With the switch off, no pages listener opens** unless a pages port is named (`LAHE_PAGES_PORT`, or the `pagesPort` option in tests). This keeps the switch-off path unchanged, and it keeps parallel tests from fighting over port 1483. Host dispatch, `::1`, and `site.bind` are live either way, as the plan says.
- **The Origin check accepts any review that could answer on the site.** That means a review that recorded a file under the root, backs the root, or linked a file on it. The plan's wording ("the review the rule picks") would also cut off a tab that was opened before a newer review took the page. Another site's origin is still refused (V24).
- **Mount pages and notes pages use part of the rule.** A page under a mount uses only rule 3 (the linking review), as before. A notes site uses only rule 1 (its own review).
- **A notes page is named for the folder it sits in.**
- **A clash number goes on the last label** of the longest name tried, for example `two.repo.docs.ongoing-2`.
- **Reserved names are whole names.** `library` is refused; `x.library` is not.
- **The rail's words are "no agent listening".** The plan says "No agent watching", but the rail's real words are "no agent listening". V11 checks the real words.
- **V6 setup.** A plain HTTP server holds the helper's port, so `review` and `write` cannot reach or start a helper. The test checks that `sites.json` and `sites.log` did not change.
- **Not built: a render cache by file time.** Markdown renders from source on every request. Step 2 makes `rebuild.js` share the render, which is the natural place for the cache.
- **Markdown links can still update the site on a GET.** A Markdown link to a new folder adds a mount and a linked file to the site on a GET, the way a page server wrote them to its own record. No name is made and no review changes, so V23 holds.
- **The unknown-name page also serves Lahe's own fonts and style**, from the clone, so it looks like every other Lahe page.
- **`state_dir.js` is unchanged.** The paths of `sites.json`, `sites.log` and `cli-secret` live in `sites.js`.
- **Helpers moved into `page_routes.js`.** The script-tag builder, the MIME table, the library path, and four small helpers now live there. `static_servers.js` reads them from there until Step 3 retires it.

## Follow-ups

- **Library builder:** the Library's Host check in `auth.js` (the catalog part) still refuses `library.lahe.localhost`. Dispatch already sends that Host to the Library's routes only.
- **Step 2:** the page-to-file mappers, aliases for old comments, and the render cache.
- **Orchestrator:** run the spike spec on Linux through the dispatch workflow.
- **A bug that was already there:** when the helper's port is held by a process that accepts each connection and closes it at once, `lahe review` exits 0 and prints nothing. The health probe's fetch seems to leave nothing for Node to wait on. Found while building V6. This step does not change it.
- **One conditional skip:** the two V10 tests skip themselves on a machine with no IPv6 loopback. They run on this Mac.

## Step 2: helper modules ask the registry

### Summary

Step 2 (Tasks 2.1 and 2.2) is built and committed on `unit/sa-core`, on top of the merged tip `a2cfde5`. With the switch on, the helper modules map a page to its file through the registry. That covers the healer, the reload check, rebuild, the handled check, and the projection. With the switch off, they read page-server records as before. One row is blocked: V31, old comments showing in the rail. See "Blocked" below.

- `npm run gate:unit`: 2540 tests, 2538 pass, 0 fail, 2 todo. Step 1 ended at 2517; the 23 new tests are this step's.
- New browser spec [stable_addresses_mappers.spec.js](../../../../test/browser/stable_addresses_mappers.spec.js): 3 tests, green in Chromium, Firefox and WebKit (9 runs). The Step 1 spec is still green.
- Leak check: 2 before, 2 after, from this work. Both are Ken's own helpers from the main checkout. A third process seen at the end belongs to the library builder's worktree (`sa-library`), not this one.
- Each new behavior was checked against a change that removes it, and the test that covers it failed. Two first versions of the tests passed against such a change, because a second safeguard covered the same case. Each now has a test that tells the two apart.

### What was built

- **One mapping, owned by [page_routes.js](../../../../src/service/page_routes.js).** `serve()` turns on the registry for its state folder only when the switch is on, and turns it off on close. The helper modules ask it to:
  - turn a page's origin and path into its file (`fileForPage`), with the same rules the server applies to a request;
  - find a linked document's file (`linkedFileForPage`);
  - say whether a file is served by a site, so the healer leaves it alone (`servesFile`).
- **Reload check** ([reviews.js](../../../../src/service/reviews.js), [routes.js](../../../../src/service/routes.js)). The reply poll now carries the page's origin. A page on a site reloads on its own file. That includes a sibling page a single-page review lends its rail to, which used to follow the reviewed page's file.
- **Healer.** A file a site serves is never written to, even when the poll comes from an old address.
- **Handled check** ([handled_check.js](../../../../src/service/handled_check.js)). A claim is checked against the file the item was made on, found from its origin and path. A Markdown page is read as its render.
- **The Markdown render cache.** Markdown is rendered once per version of its source, keyed by file size and time, plus the settings the render depends on. The server, rebuild, the reload check and the handled check all read it. Rebuild ([rebuild.js](../../../../src/service/rebuild.js)) also adds new link mounts and linked files to the site. It keeps the state-folder copy current for old addresses.
- **Aliases** ([protocol.js](../../../../src/shared/protocol.js), [record.js](../../../../src/shared/record.js), [review_format.js](../../../../src/shared/review_format.js), [projection.js](../../../../src/service/projection.js), [src/layer/index.js](../../../../src/layer/index.js)):
  - The helper works out a site's old origins from its own page-server records. That means `127.0.0.1` and `localhost` at each old port, newest first, at most 16.
  - The script tag carries them as escaped JSON in `data-lahe-aliases`.
  - The layer reads them, and `samePage` treats a record made on an old origin at the same path as this page's.
  - `review.json` groups old and new origins of one page under the new address. Each item keeps its own origin.

### Rows that pass, and the test that proves each

| Row | Test |
|---|---|
| V26 healer, switch on and off | [sites_mappers.test.js](../../../../test/unit/sites_mappers.test.js), two "V26 (switch on/off)" tests, plus "V26 (switch on): a poll from an old address" |
| V27 reload, switch on and off | sites_mappers.test.js, two "V27 (switch ...)" tests and the sibling-page test; stable_addresses_mappers.spec.js, "V27:" |
| V28 handled check, switch on and off | sites_mappers.test.js, two "V28 (switch ...)" tests and "a single-page review lending its rail" |
| V29 linked docs | stable_addresses_mappers.spec.js, "V29:"; sites_mappers.test.js, "V29 (unit half, switch on)"; Step 1's V13 browser test |
| V30 rebuild, switch on and off | sites_mappers.test.js, two "V30 (switch ...)" tests, and "the Markdown render is cached by file time and shared" |
| V32 grouping | sites_mappers.test.js, "V32:"; the step test checks it end to end in review.json |
| V70 aliases | sites_mappers.test.js, four "V70:" tests |
| V31 old comments | **Blocked.** Only the unit half passes: sites_mappers.test.js, "V31 (unit half)". |

The step test, in stable_addresses_mappers.spec.js, opens a review created on a random port at its stable address. It checks five things:

- The script tag carries the old address.
- `review.json` groups the old comment with the new address.
- No served HTML file changes on disk after several polls.
- An agent's edit reloads the page.
- The handled check reads the right file.

### Blocked: old comments in the rail (V31)

The architecture says the alias list makes old comments match "in the rail and in review.json". The review.json half works. The rail half does not fit the code. The layer never reads items back from the helper: its rail is filled only from this browser's storage, which belongs to one origin. A new address starts with empty storage, so the old comments are not there to match.

Making them show needs a new behavior: the layer fills its store from `review.read` when a page opens. The architecture does not cover that. It needs a decision before anyone builds it.

A second, smaller gap: an old Markdown review's page path was the rendered file in the state folder (`/<name>-<hash>.html`). The new path is the source (`/doc.md`). So an origin alias alone cannot match those items, even in `review.json`. HTML pages and folders keep their paths and are not affected.

### Changes from plan

- **A layer bug fixed in `src/layer/sync.js`.** No workstream owns this file. The rail heard a change in agent liveness only when certain fields changed, and `listening` was not one of them. The helper's first answer is often "cannot tell", so the later "no agent" never reached the rail. That made Step 1's V11 browser test fail on a busy machine. The fix adds that one field, with a test in `quiet_tab_polling.test.js`.
- **The registry is a table keyed by state folder** in `page_routes.js`. The plan threads the switch through each module; this has each module ask the table instead. Task 3.1 removes the table along with the switch-off branches.
- **Rebuild still writes the state-folder copy with the switch on.** Old addresses and the off branch read it. The site's page comes from the shared cache.
- **`record.pageFrom` always has an `aliases` list,** empty when there are none. The layer's config only has the key when the tag carries aliases, so existing config tests are unchanged.

### Follow-ups

- **V31 decision:** should the layer fill its store from the helper when a page opens? And how should old Markdown page paths map to the new ones?
- **Full browser run:** the liveness fix changes when the rail repaints its agent line. The orchestrator's full browser run is where that gets proven against every other spec.

## Cleanup needed

- `test/browser/tmp_spike_lahe_localhost.spec.js`: the Task 1.0 spike, committed for the Linux run. Remove once Linux has been checked.
- `test-results/`: Playwright's output folder from the spec runs (gitignored).
- `.claude-commit202610111600-core`, `...1630-core`, `...1645-core`, `...1700-core`, `...1730-core`, `...1800-core`, `...1815-core`, `...1900-core`, `...1930-core`, `...1931-core`, and the one this page's commit adds, in the worktree root: commit message scratch files (gitignored).
