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

## Task 3.0: test retirement list

### Summary

Step 3 removes the per-session page servers. That takes away idle stop, page-server restart, port history, origin swap, `SIGHUP` mounts, the reopened-session sweep, and the session-close stop. The list below is every existing test of that behavior, file by file. Nothing has been deleted.

- **Retire: 11 files.** They test behavior that no longer exists, and a stable-address test covers what it was for.
  - Retired whole: [stop_idle_servers.test.js](../../../../test/unit/stop_idle_servers.test.js) and [stop_idle_servers.spec.js](../../../../test/browser/stop_idle_servers.spec.js).
  - Retired in part (9): `static_restart`, `static_servers`, `linked_docs_rail`, `root_markdown_rail`, `heal_script_line`, `write_command`, `helper_self_stop`, `catalog_routes`, `catalog_open_rollback`. Eight of these also appear under rewrite, split test by test below.
- **Rewrite: 26 files** (18 unit, 8 browser, the two shared worlds included). They test something that stays (the page rule, styles, linked documents, status, the Library) but reach it through a page server or a `127.0.0.1` page address.
- **Browser setup:** every spec that runs `lahe review` needs a free pages port set (`LAHE_PAGES_PORT`). Otherwise parallel workers fight over 1483. That change goes in the two shared worlds and four specs, and is counted under rewrite.
- **Library builder's files:** the catalog and Library files are the library builder's (Task 4.3). They are listed so Ken sees the whole batch, and marked "library".

### Unit tests

| File | Tests affected | Verdict | Why |
|---|---|---|---|
| `stop_idle_servers.test.js` | all 19 | retire | The idle sweep, idle restart on the old port, and page-server start locks are removed. V34 (the page still loads after the old idle wait) replaces them. |
| `static_restart.test.js` | 13 of 15: Host check per server (2), old port and port history (2), helper restart with the old origin (1), `reopenForCatalog` (5), `closeQuiet`, `restartAll`, another server's port | retire | Port reuse, port history, origin swap and Open's restart are removed. Sites are covered by V7, V8 and V25. |
| `static_restart.test.js` | 2: "an origin removed and then registered again is held after a rebuild", "removeOrigin refuses anything but a plain loopback http origin" | rewrite (move) | `reviews.removeOrigin` stays, because `site.bind` uses it (V25). Move both into a reviews test file. |
| `static_servers.test.js` | 7: reusable and stoppable; corrupt metadata; two sessions with independent leases; one session in two roots; injection after `restartAll`; `coveragePath`; `servesPath` | retire | Page-server process lifecycle and records. Covered for sites by V6, V26 and the page tests. |
| `static_servers.test.js` | 5: hidden file under the root; hidden file at a mount root; hidden subfolder in a mount; symlink to a hidden file in a mount; another agent session never answers | retire | Sites refuse dotfiles in every spelling (V14). The rule no longer filters by session (V21). |
| `static_servers.test.js` | 15: stripped tag served with the tag; one tag, not two; tab icon; library route; library plus fallback; folder review line; sibling carries the rail; `--only`; newest review rooted here wins; a page keeps its own review; an unbacked server says so once; a mount page is not an unbacked server; a symlink out of a mount is refused; a normal linked file; stylesheet and fonts under a mount | rewrite | The same behavior lives in `page_routes.js`. Point each at a site. |
| `static_styles.test.js` | all 9 | rewrite | Installed styles are still answered at `.lahe-styles` and never from disk. Run the same cases against a site. |
| `linked_docs_rail.test.js` | 4: a later review registering a mount keeps links; a restarted server keeps links; two "redirects to its own review" | retire | `registerMount`, restarts and the redirect between pages are all removed (AR16: no redirects). |
| `linked_docs_rail.test.js` | 9: recorded against the file; two hubs, newest answers; another session; linked Markdown page; linked page; a path the mount table cannot vouch for; the helper; a non-page is never named; encoded mount prefix | rewrite | The site's `linked_files` and `page_routes.linkedFileForPage` replace page-server records. The session case becomes "no session filter". |
| `root_markdown_rail.test.js` | 2: redirect to its own review; passes the rail to a linked document | 1 retire, 1 rewrite | No redirects. The rail passing to a linked document stays (V29). |
| `heal_script_line.test.js` | 3: "not healed while a live server serves it", "stops being served, the healer takes over", "heal reported through review.read" | 2 retire, 1 rewrite | A site does not stop serving, and V26 covers the stand-down. The report test only needs a site in place of a server. |
| `write_command.test.js` | 3: one-page server restarted as the idle sweep does; `.env` beside a notes file is a 404; a one-page server answers its own address only | 1 retire, 2 rewrite | The idle restart is gone. The notes rules stay, on a page-only site (V15, V7). |
| `status_command.test.js` | 4: `servedVia`; injected or unserved; mechanism with a live server; limited to its page | rewrite | `lahe status` reports each review's site (Task 3.2). |
| `helper_self_stop.test.js` | 1: "a page server exits when its state directory is removed" | retire | There are no page-server processes. |
| `session_commands.test.js` | 1: "review re-entry infers its session, and the final close stops the helper" | rewrite | The close no longer stops page servers. The session inference and the helper stop stay. |
| `markdown_review.test.js`, `markdown_linked_docs.test.js`, `review_command.test.js` | 1, 1, and 3 | rewrite | They fetch or count the printed `open` URL. That URL becomes `<name>.lahe.localhost`, which Node's own lookup does not resolve, so they fetch with the Host header. |
| `catalog_routes.test.js` (library) | 6: `sweepReopened` (5), "the sweep leaves alone a session an Open is bringing back" | retire | The reopened-session sweep is removed. |
| `catalog_routes.test.js` (library) | 11: Open reopens and restarts; Open on a served review; log lines; the sweep timer; a week of actions; CX2; CR4; CR1 (2); two folder-review walks | rewrite | Open binds and stamps a site and returns its address (V39 to V42). |
| `catalog_open_rollback.test.js` (library) | 2 of 3 | retire | Open's restart rollback is removed. |
| `catalog_lifetime.test.js` (library) | 2: R10a | rewrite | The scenario stays. Open no longer reopens a session or starts a server. |
| `catalog_reader.test.js`, `catalog_kind_rule.test.js` (library) | 3 and 1 | rewrite | "Openable" and the kinds come from the registry now (V41), not from page-server records. |
| `status_catalog.test.js` (library), `launch_folder.test.js` (library) | 1 and 1 | rewrite | They read a page-server record for the folder; read the site instead. |

### Browser specs

| File | Tests affected | Verdict | Why |
|---|---|---|---|
| `stop_idle_servers.spec.js` | all 2 | retire | Idle stop and coming back on the old port are removed. V33 and V34 replace them. |
| `serve_time_inject.spec.js` | 2 | rewrite | Test 1 (the rail lands from the response) stays. Test 2 relies on a page server outliving the helper; with the helper serving pages, rewrite it to "the library comes from the site's own route". |
| `markdown_render.spec.js` | 1: "an agent-authored page gets the document style from the helper" | rewrite | It starts a page server directly. Bind a site instead. |
| `static_site_folder.spec.js`, `linked_docs_rail.spec.js`, `rebuild_not_the_agents_job.spec.js` | setup | rewrite | They run `lahe review` with their own environment. Give them a free pages port. In `linked_docs_rail.spec.js`, "a linked document with its own review opens that review's page" relied on the redirect; it becomes "opens on the linking site with the rail the rule gives". |
| `support/lahe_world.js`, `support/catalog_world.js` | setup (8 and 2 specs use them) | rewrite | Same free pages port. The Library worlds also stop expecting a reopened session. |
| `catalog_library.spec.js` (library) | 1: "Open reopened the closed session" | rewrite | Open binds and stamps a site instead. |

`test/helpers/temp_helpers.js` and both stray-helper checks keep their page-server pid handling. Leftover page servers are still stopped at every start (V35).

## V31 options

**The problem:** the rail is filled only from this browser's storage, and storage belongs to one origin. Comments made at `127.0.0.1:<old port>` sit in that origin's storage. The helper holds them too, in the review's log, but the layer never reads items back from the helper. Aliases make them match once present; nothing brings them over.

**Option A: fill the rail from the helper on page load.**

- **Files:**
  - `src/shared/protocol.js` and `src/service/routes.js`: a read of this review's raw records for one page. `review.read` returns the projection, which drops the anchor fields a card needs, so it is not enough on its own.
  - `src/layer/sync.js`: the call.
  - `src/layer/index.js`: run the merge at boot, before the first `merge()`.
  - `src/layer/store.js`: write an adopted record as already acknowledged.
  - `src/shared/merge.js` is reused unchanged.
- **The merge rule** (`src/shared/merge.js`, [merge on load](../../../diagrams/merge_on_load.md)): an id the browser does not hold comes in from the store whole. That is `ONLY_STORE`, so the store wins on content and lifecycle together. An id the browser holds is merged by revision, as today: the browser wins on content until acknowledged, and the store wins on lifecycle for the revision it names. Nothing changes for a page that already has its items.
- **What could go wrong:**
  - Duplicates: merging by id prevents them. An adopted record must not enter the outbox, or it would be posted back as new.
  - A withdrawn draft coming back: the read must return only records the helper holds as not withdrawn. A record that is a draft in the store but absent in this browser stays out.
  - Records from another page: the read is per page (origin or alias, plus path), and the layer's `samePage` filter still applies.
  - Cross-review leakage: the read is per review, behind the same token, Origin and registry checks as every review route.
  - Token exposure: no new credential. The page already holds the token that reads `review.json`.
- **Tests:**
  - A unit test of the adopt step: store-only items arrive; a newer browser revision wins; a withdrawn draft stays out; other pages and other reviews never arrive; nothing reaches the outbox.
  - A browser test: a comment made at an old address appears as a card at the new one, appears once after a reload, and posts nothing back.

**Option B, cheaper: say so, do not show.** The rail shows one line, for example: "3 earlier comments from this page's old address are with your agent." The count comes from `review.read` and is filtered by alias and path. The comments themselves stay where they are; `review.json` already groups them under the new address (V32), so the agent sees and answers them. No storage write, no merge, no new route.

**Either way:** an old Markdown review's page path was the rendered file (`/<name>-<hash>.html`), not `/doc.md`. Bringing those over needs a path alias as well as an origin alias, and the helper can compute it from the review's own source.

## Cleanup needed

- `test/browser/tmp_spike_lahe_localhost.spec.js`: the Task 1.0 spike, committed for the Linux run. Remove once Linux has been checked.
- `test-results/`: Playwright's output folder from the spec runs (gitignored).
- `.claude-commit202610111600-core`, `...1630-core`, `...1645-core`, `...1700-core`, `...1730-core`, `...1800-core`, `...1815-core`, `...1900-core`, `...1930-core`, `...1931-core`, and the one this page's commit adds, in the worktree root: commit message scratch files (gitignored).
