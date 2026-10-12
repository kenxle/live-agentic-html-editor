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

### Old comments in the rail (V31)

Built as option A; see "V31 option A" below. What this section found:

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

## Step 3: page servers retired, the helper serves every page

### Summary

Step 3 (Tasks 3.1, 3.2 and 3.3) is built and committed on `unit/sa-core`. The integration branch's library, install and lahe-names work is merged in. The switch is gone. The helper always serves pages on 1483 (or `LAHE_PAGES_PORT`), and no code starts a page server. `lahe status` reports the pages port, the ending, each option's state and each review's address. The skill, contract, CLI doc, serving docs and diagrams describe stable addresses.

- **Unit gate:** `npm run gate:unit` runs 2590 tests: 2533 pass, 2 todo, 55 fail.
  - 54 failures are in the library builder's catalog and Library test files. They test the Library's restart-and-reopen Open, its rollback, the reopened-session sweep, and the switch-off Library. The list is below, test by test.
  - The 55th was a sleep in a debug file I had moved into `test/retired`. It is fixed in the last commit, so the next run should show 54.
  - No other failure.
- **Browser specs,** each run on its own in Chromium: `stable_addresses_lifetime` (3 tests), `stable_addresses_sites` (6), `stable_addresses_mappers` (3), `serve_time_inject` (1), `markdown_render` (5), `linked_docs_rail` (2), `static_site_folder` (4), `rebuild_not_the_agents_job` (2), `free_writing_r14` (7), `style_switcher_keep` (1). All green. `stable_addresses_lifetime` is also green in Firefox and WebKit.
- **Mutation checks:** every new test was checked against a change that removes the behavior it names, and failed. The names tests and the always-on close test were also seen failing before the fix.
- **Leak check:** 2 before, 2 after, both Ken's own helpers from the main checkout.
  - Twice in a full unit run, the install builder's `install_command.test.js` left one always-on helper running. It is the `lahe-install-…/state dir` one. Its fake service manager can start a helper that finishes starting after teardown has looked.
  - I stopped both by their pid, from my own run.
  - Run alone, the file is clean. I did not change that test.

### What changed

- **One serving model** ([index.js](../../../../src/service/index.js), [protocol.js](../../../../src/shared/protocol.js)). There is no `LAHE_PAGES` switch. The pages listener always opens. Test runners set `LAHE_PAGES_PORT=0` (in `scripts/no_stray_helpers.js` and `playwright.config.js`) so parallel tests never fight over 1483. A test that restarts a helper and reloads an old address names a fixed free port itself.
- **Page servers retired** ([static_servers.js](../../../../src/service/static_servers.js)):
  - Nothing spawns one any more. The file now only reads old records, for aliases, the Library and leftovers.
  - Every helper start stops a leftover page-server process, but only after its health probe proves it is the recorded process, and marks the record retired.
  - The idle sweep is no longer loaded; [idle_servers.js](../../../../src/service/idle_servers.js) is listed for deletion.
  - Session close and reopen no longer stop or restart anything.
  - The switch-off branches in the healer, reload check, rebuild, handled check and projection are removed.
  - The Library's old restart path is replaced in `index.js` by one that refuses. With the site tools always present, the Library's Open binds a site instead.
- **`lahe review`** ([review.js](../../../../src/cli/commands/review.js)) always binds a site. With no helper running and the pages port held by another program, it says so, naming the port, and stops.
- **`lahe status`** ([status.js](../../../../src/cli/commands/status.js)) now prints these lines:
  - the pages port, the ending and why;
  - whether addresses carry the port, and why;
  - the port-80 forward's and the `.lahe` option's on, checked and reason line;
  - whether a login item runs the helper;
  - the reinstall sentence when the recorded Node is gone;
  - each review's `address`.

  It reads the registry read-only and never writes it. The drain's Library reader now gets the site tools, and the launch folder comes from the site root, so "Launch a new agent" keeps the project folder for a review the helper serves.
- **`.lahe` and the port-free address** ([protocol.js](../../../../src/shared/protocol.js), [page_routes.js](../../../../src/service/page_routes.js), [routes.js](../../../../src/service/routes.js)):
  - The Host check answers `<name>.lahe` only once the helper has proved its own name server answers `.lahe` lookups here. The Origin check accepts it on the same condition. `library.lahe` is never accepted.
  - A port-free `<name>.lahe.localhost` origin is always accepted: it is the port-80 forward.
  - `site.bind` prints the port the helper has proved: 80 once the forward is checked, otherwise 1483.
- **Session close on an always-on helper** ([session.js](../../../../src/cli/commands/session.js)). The last close no longer stops an installed or always-on helper, and no longer asks it to stop once quiet. A session reopen that left a stale helper running no longer says it was "for an open review page".
- **Logging:** one start line gives the port, the ending and why, and the port-free state. The install workstream logs the install state; each new name and each refused Host were already logged in Step 1.
- **Contract:** the service contract goes to 16, so a CLI replaces a helper that cannot serve pages.

### Rows that pass, and the test that proves each

| Row | Test |
|---|---|
| V33 after session close the page loads | [stable_addresses_lifetime.spec.js](../../../../test/browser/stable_addresses_lifetime.spec.js), "V33:" (three lanes) |
| V34 the old idle wait stops nothing | [sites_step3.test.js](../../../../test/unit/sites_step3.test.js), "V34:" |
| V35 leftovers stopped on start, only when proved | sites_step3.test.js, two "V35:" tests |
| V36 nothing spawns a page server | sites_step3.test.js, "V36:" |
| V37 status names the port, ending, options and site; review and status name a taken port | [status_command.test.js](../../../../test/unit/status_command.test.js), the "V37:" tests and the address test; sites_step3.test.js, "V37:" for `lahe review` |
| V38 docs | [stable_addresses_docs.test.js](../../../../test/unit/stable_addresses_docs.test.js) |
| V63 drafts come back | stable_addresses_lifetime.spec.js, "V63:" (three lanes) |
| V64 three lanes | Not proved here. It is the orchestrator's `gate:all`. The specs it names passed in all three lanes here. |
| V67 clone mode | stable_addresses_lifetime.spec.js, "V67:" (three lanes) |
| V71 logging | sites_step3.test.js, "V71:" |
| `.lahe` and the forward (coordinator's three changes) | [sites_lahe_names.test.js](../../../../test/unit/sites_lahe_names.test.js) |
| Always-on close | [session_close_always_on.test.js](../../../../test/unit/session_close_always_on.test.js) |

### Moved to `test/retired` (not run; Ken approves deleting)

Whole files, moved with `git mv`, each with a header naming why:
- `unit/stop_idle_servers.test.js`
- `unit/static_restart.test.js` (its two `removeOrigin` tests live on in `test/unit/reviews_remove_origin.test.js`)
- `unit/static_servers.test.js` (the behaviors that stay are carried over in `test/unit/page_routes_carried.test.js`)
- `unit/linked_docs_rail.test.js` and `unit/root_markdown_rail.test.js` (carried over in `test/unit/sites_linked_docs.test.js`)
- `unit/static_styles.test.js` (carried over in `test/unit/sites_styles.test.js`)
- `browser/stop_idle_servers.spec.js`

Tests cut out of files that stay, into new files beside them:
- `unit/heal_script_line.retired.test.js` (2 tests)
- `unit/write_command.retired.test.js` (3)
- `unit/helper_self_stop.retired.test.js` (1)
- `unit/helper_freshness.retired.test.js` (1)
- `unit/sites_switch_off.retired.test.js`, `unit/sites_dispatch_switch_off.retired.test.js`, `unit/sites_binding_switch_off.retired.test.js`, `unit/sites_mappers_switch_off.retired.test.js` (1 each). The switch-off runs of V26, V27, V28 and V30 went with them.
- `browser/serve_time_inject.retired.spec.js`, the helper-down block. Task 3.0 marked it "rewrite", but there is no second process left to stay up without the helper. V11 and `sites_pages` cover the library coming from the page's own address.
- `browser/tmp_debug_rebuild.spec.js`, a debug probe I committed into `test/browser` by mistake and then moved here, emptied.

Nothing in `test/retired` runs: `test:unit` reads `test/unit/`, Playwright reads `test/browser/`, and lint only checks syntax.

### The library builder's tests the change breaks

These fail because the Library's restart-and-reopen Open, its rollback, the reopened-session sweep and the switch-off Library are gone. I did not edit them.

#### test/unit/catalog_auth.test.js (4)
- catalog.list, open, star and request pass the checks with the Library token and reach their handlers
- the POSTs refuse text/plain, a missing Origin, Origin null, another port, and localhost against a 127.0.0.1 Host
- the token changes across a helper restart and is written nowhere: no state file, not the helper log, not health, not catalog.list
- a refused catalog.list does not update catalog_seen_at
#### test/unit/catalog_lifetime.test.js (2)
- R10a: Open a closed review with no agent, close the last agent's own session, and the document still answers and takes a comment
- R10a, the Library's own rule: once the sweep closes the reopened session, a fresh Library poll alone keeps the helper up through the last close
#### test/unit/catalog_open_rollback.test.js (3)
- an Open whose origin step throws after the server started leaves the session closed and no ss_ server running
- with the same failure, a session the rollback could not close keeps its reopened record for the sweep
- a start that throws still clears the reopened record, and the session stays closed
#### test/unit/catalog_routes.test.js (41)
- Open on a closed review reopens its session, restarts its server, and returns a loopback URL that serves the page
- Open on a served review starts nothing and returns the live URL
- Open refuses a review with no recorded server, a missing one, and an unknown one, with PROTO_NOT_OPENABLE
- Open ignores extra path, root and url fields in its body
- Open with target_path rewritten outside the recorded root refuses, and the outside file's bytes appear in no response
- Open refuses a recorded file not owned by the current user
- Open queues a pick-up with handoff, a live attached agent, and no one watching
- "Just open it to read" leaves the queue empty
- an unconfirmed hand-over on a watched session gets PROTO_CONFIRM_NEEDED; a confirmed one is queued
- with the queue full, Open still opens, with not_asked queue_full
- with a dead attached agent, Open opens with not_asked no_agent and request returns PROTO_NO_AGENT
- with no attach at all, Open still opens and says no agent was asked
- Open on a via-agent review with handoff and a live agent queues the pick-up and returns no URL
- catalog.request with extra title, text, path and url fields stores none of them
- catalog.list carries attached and each review's request, and marks the Library seen
- Star survives a helper restart; with a corrupt catalog.json it is refused and the file is left as it was
- Open, Star, Pick up and Launch through the real routes each write one catalog log line in the protocol.js format
- sweepReopened closes a Library-reopened session at 30:00 and not at 29:59, then clears its entry
- sweepReopened leaves alone a session reopened with lahe session reopen
- sweepReopened leaves alone a session taken over since the Library reopened it
- sweepReopened leaves alone a session whose monitor is live
- sweepReopened counts a held window of the session's reviews as not quiet
- the helper runs the sweep on its own timer every POLL_MS, at its own clock
- a week of Library actions through the real routes writes the catalog lines committed as test/fixtures/catalog_log.txt
- CX2: an Open whose server cannot restart leaves a closed session closed and records no reopen
- CR4: with catalog.json corrupt, an Open that would reopen a closed session is refused and reopens nothing
- CR4: with catalog.json corrupt, Open on an already open session still opens
- CR1: two concurrent Opens on a closed session start one server, answer on its recorded port, and keep its origin
- CL2: an agent whose monitor exited to work a batch still counts as watching, so a hand-over asks first
- phase 8: an agent that ran a lahe command more than WORKING_MS ago, with no live monitor, does not block Open or Pick this up
- phase 8: Open on a session whose agent is away hands over without a confirm step
- catalog.request refuses a missing review with PROTO_NOT_OPENABLE, as Open does, and queues nothing
- walk: Open on a closed folder review with no index.html opens the entry page lahe review opens, not a not-found root
- walk: Open on a closed folder review opens the page its comments are on
- walk: when the attached agent already owns the document's session, Open and Pick this up queue nothing
- walk: right after the agent answers a pick-up, its session card still names it as watching
- walk: a folder review's recorded page that climbs out, is hidden, or is not a page falls back to the entry page
- rename: the list carries the reviewer's name beside the original, and an empty name clears it
- rename: a name that is not a string is refused, and a corrupt catalog.json is left as it was
- rename: the reviewer's name never reaches the drain or a hand-off message
- rename a session: the list carries its new name beside the original, and it never reaches the drain
#### test/unit/library_command.test.js (2)
- lahe library starts the helper, attaches the session, and prints the helper's own /catalog URL
- lahe library with nobody attached mints a session with no reviews, attaches it, and prints its commands
#### test/unit/library_command_sites.test.js (1)
- lahe library keeps printing the 127.0.0.1 address when the helper does not serve pages

#### test/unit/library_address.test.js (1)
- V43: with the switch off the Library keeps its two loopback Hosts and nothing else

Unchanged and now green, because of the launch-folder fix in `status.js`: `launch_folder.test.js` (4 tests) and `library_trusted_paths.test.js` (1).

Library-owned wording not touched: `docs/ongoing/LIBRARY.md`, the Library row of `docs/CLI.md`, the `kind` rows in `docs/CONTRACTS.md`, and the "switch on" comments in `auth.js` (catalog part), `catalog_sites.js` and `catalog_reader.js`.

### Changes from plan

- **The registry lookup table stays in `page_routes.js`.** It is how the helper modules find the registry for a state folder; Step 2 said Task 3.1 would remove it. Only the switch-off branches went.
- **`static_servers.js` still exists,** as a reader of old records. `idle_servers.js` is unused and listed for deletion; deleting files is cleanup's.
- **The helper-down test of `serve_time_inject` is retired, not rewritten.** The reason is in the moved-test list above.
- **A linked document opens on the hub's address with the hub's rail,** even when it has its own review. Before, the page redirected to that review's page; there are no redirects now.
- **The rebuild walk waits for its first poll before the agent writes.** The test edited the Markdown before the page's first poll landed, and only passed before because the old artifact kept changing.
- **The contract gains one sentence** about the stable address. Its two copies change with it, and the service contract goes to 16.

### Follow-ups

- **Library builder:** rewrite the tests above to the site-based Open (Task 4.3), and the library-owned wording listed above.
- **Install builder:** the always-on helper that `install_command.test.js` can leave behind under load.
- **Orchestrator:**
  - `npm run install-skills` after the merge;
  - the `dist/` rebuild;
  - `gate` and `gate:all` (V64).
- **V31 is parked** until Ken picks option A or B.

## Fix round: code review findings

### Summary

Every finding is fixed except one part of finding 9 (see below), each with a test that failed first. Fourteen commits on `unit/sa-core`, on top of `feat/stable-addresses` at ebc5fce. The disk rule held: no whole suite ran, only single files, and free space stayed between 1.7 and 2.0 GB.

### Each finding, and the test that proves it

| Finding | Fixed | Test |
| --- | --- | --- |
| 1. A failed `lahe review` on a fresh session stopped an always-on helper | yes: asks `helperStillWanted`, as `session close` does | `test/unit/review_failure_always_on.test.js` |
| 4. Unknown names and refused Hosts grew memory and `helper.log` without limit | yes: one capped note logger (256 keys, then one line saying so); a repeated refused Host logs once | `test/unit/pages_log_cap.test.js` |
| 5. The Library link on the not-found pages was dead (cross-site click) | yes: links to `library.lahe.localhost` at the printed port; the Library page alone takes a same-site top-level navigation | `test/unit/library_link_navigation.test.js`, and the click in `test/browser/stable_addresses_sites.spec.js` ("Open the Library ... in one click") |
| 6. A site above the state folder served it | yes: any file whose path or real path is in the state folder is a 404 | `test/unit/sites_state_dir_hidden.test.js` |
| 7. One page, two origins with the port-80 forward | yes: `record.pageIdentityKey` keys a page by its site name; `samePage` and `pageGroups` use it | `test/unit/page_identity_forms.test.js` |
| 9. Every page load read every `meta.json` and every old record | partly: old records are read once; a `meta.json` is read again only when its file changed | `test/unit/page_load_reads.test.js` |
| 10. In-process `serve({port: 0})` bound 1483; V34 could not fail | yes: `pagesPortFrom` returns 0 for API port 0; V34 moved to `test/retired/unit/sites_step3_v34.retired.test.js` with a header saying why | `test/unit/pages_port_choice.test.js` |
| Busy pages port named the API port | yes | `test/unit/serve_pages_port_taken.test.js` |
| `recordedReviewFor` could bind the wrong review | yes: `add.run` reports the review it used, and `lahe review` binds that one | `test/unit/review_binds_used_review.test.js` |
| `sites.load()` ignored the log past a good `sites.json` | yes: replays the log over it | `test/unit/sites_log_replay.test.js` |
| `.pipe()` left the file open on an aborted transfer | yes: `stream.pipeline` | `test/unit/pages_stream_abort.test.js` |
| Two kinds of real path | yes: `.native` everywhere in `page_routes` and `sites` | `test/unit/realpath_one_kind.test.js` |
| `classifyHost` named the Library before checking the port | yes | the new case in `test/unit/sites_dispatch.test.js` |
| Refusal log wording broke the harness spec | yes: the line names `check host failed` again | `test/browser/harness_second_origin.spec.js` passes (5 of 5) |
| Dead code | yes, except `idle_servers.js` stays in the manifest (lint lists every file under `src/`) | lint passes |

### What the Library page now accepts (for the security review)

- `catalog.page` (GET `/catalog`) only: `Sec-Fetch-Site` of `none` or `same-origin` as before, and now also `same-site` when the request also carries `Sec-Fetch-Mode: navigate` and `Sec-Fetch-Dest: document`. That is a top-level navigation: a link click, or a page setting `location`.
- Every other Library route (`catalog.asset`, `catalog.list`, and the POSTs) is unchanged: exactly `same-origin` (the asset route keeps `none` too).
- The Host check is unchanged: `library.lahe.localhost` at the pages port, or with no port through the forward, or `127.0.0.1` and `localhost` at the API port.
- The page still sends `X-Frame-Options: DENY` and `frame-ancestors 'none'`, so a same-site page can open the Library but cannot frame it. A navigation replaces the page that started it, so that page never sees the token.
- One limit: a page at `<name>.lahe` (the `.lahe` names) is a different site from `library.lahe.localhost`, so its click is still cross-site and refused. Only the `.lahe.localhost` spellings get the one-click link.

### Finding 9: why not the in-memory reviews

`lahe add` writes `meta.json` from its own process. A reused review gains a page there (its `target_paths`), and the running helper's in-memory copy is not told. Picking from memory would answer a newly added page with the wrong review. So the file stays the answer, read again only when its time, size or inode changed. A page load now does one `readdir` and one `stat` per review, and no reads. The notes flag rides on the pick, so the script tag needs no extra read.

### Files changed

- `src/cli/commands/review.js`, `src/cli/commands/add.js` (the `used` out-parameter only), `src/cli/commands/serve.js` (the pages-port message only), `src/cli/commands/status.js`
- `src/service/page_routes.js`, `src/service/index.js`, `src/service/auth.js` (the catalog Sec-Fetch check only), `src/service/sites.js`, `src/service/static_servers.js`, `src/service/reviews.js`, `src/service/routes.js`, `src/service/catalog_sites.js` (the stamp helper only)
- `src/shared/protocol.js`, `src/shared/record.js`, `src/shared/review_format.js`, `src/shared/manifest.js`
- `docs/CONTRACTS.md`, `docs/ongoing/SERVING_ARCHITECTURES.md`
- Tests: eleven new unit files named above; `sites_pages`, `sites_dispatch`, `sites_step3`, `sites_mappers`, `sites_cli`, `reviews_remove_origin`, `test/helpers/sites_world.js`, and the specs `stable_addresses_sites` and `stable_addresses_mappers`

### Single-file runs

Unit, each `LAHE_PAGES_PORT=0 node --test <file>`: review_failure_always_on 2/2, pages_log_cap 2/2, library_link_navigation 6/6, sites_state_dir_hidden 1/1, page_identity_forms 4/4, page_load_reads 2/2, pages_port_choice 3/3, serve_pages_port_taken 1/1, review_binds_used_review 1/1, sites_log_replay 2/2, realpath_one_kind 2/2, pages_stream_abort 1/1, reviews_remove_origin 3/3, sites_pages 17/17, sites_dispatch 15/15, sites_step3 5/5, sites_binding 17/17, sites_registry 19/19, sites_mappers 17/17, sites_linked_docs 15/15, sites_styles 9/9, sites_lahe_names 7/7, sites_cli 7/7, page_routes_carried 10/10, page_scope 21/21, review_format 56/56, protocol_wire 41/41, catalog_auth 13/13, library_address 6/6, library_open_sites 17/17, launch_folder 6/6, status_catalog 18/18, no_arbitrary_sleeps 4/4. Lint passes.

Browser, Chromium, one spec at a time: stable_addresses_sites 7/7, stable_addresses_mappers 3/3, harness_second_origin 5/5. The click test fails with the auth change taken out.

Not run: the whole unit suite and the whole browser suite (the disk rule). The orchestrator's checkpoint run covers them.

### Leaks

`lahe.js serve` count: 2 before and 2 after (Ken's two helpers). Four old page servers from this worktree were still running from a Step 2-era `sites_mappers` run at 16:00 (state folders `lahe-mappers-*` in the temp folder). I stopped them by pid. Nothing from `sa-core` is running now.

## Fix round 2: security review and spec check

### Summary

Every item given to core is done, each with a test (failing first where it is a behavior change; a mutation check where it restores coverage). On top of `feat/stable-addresses` at df121c4. Single test files only; disk stayed at 1.9 to 2.0 GB free.

### Each item, and the test that proves it

| Item | Done | Test |
| --- | --- | --- |
| S2. A Markdown link could mount `~/.ssh` and serve it all day | not as asked: Ken's rule is that hidden files are served and linked like any other file (worktrees live in hidden folders). `markdownLinks.mountableDir` keeps the home boundary by real path, checked when a link makes the mount, in `sites.cleanMounts`, and in `locate()` at serve time | `test/unit/mount_home_boundary.test.js`, `test/unit/hidden_files_served.test.js` |
| S3. A taken `[::1]` twin left the helper on 127.0.0.1 alone | yes: only EADDRNOTAVAIL and EAFNOSUPPORT log and go on; anything else closes the listeners and refuses to start, naming the `[::1]` port | `test/unit/ipv6_twin_taken.test.js`; V10 in `sites_dispatch.test.js` now proves the no-IPv6 path through an in-process `ipv6Loopback` option |
| S4. The residual risk understated what another account can do | yes: `docs/CONTRACTS.md` says loading a page yields the token, and a non-browser client can then read and write the review, which reaches the agent | doc |
| S5. A `.git` file could name any folder as the main checkout | yes: recorded only when `<main>/.git/worktrees/<id>/gitdir` names the same `.git` file | new V5 case in `sites_registry.test.js`; fixtures in `library_open_sites.test.js` and `stable_addresses_sites.spec.js` gain git's back-link |
| Log growth: the not-injecting line and auth refusals | yes: once per distinct refusal (keyed by check, path, origin and a hash of the headers), at most 256, then one line saying so. The note logger moved to `log.js` | `test/unit/log_caps_round2.test.js`; `harness_second_origin.spec.js` passes 5 of 5 |
| R3. One file, two addresses | yes: a file review asks `site.bind` with `containing: true`, and the registry binds the deepest folder site that already holds the file, at its path there. `lahe review` prints the root it was bound to | `test/unit/same_file_same_address.test.js` (both orders, a notes site, and the CLI end to end) |
| V24 deviation | yes: a same-site Origin is accepted for a review the rule would not pick now, if it could answer there; refused for one that recorded nothing there | new V24 case in `sites_binding.test.js` (fails with either check mutated) |
| Stale docs | yes: skill (always-on close, gotcha 23, no-port address, name rule), contract and its two copies, `docs/CLI.md` (library address, close), `STATIC_SITE_FOLDER.md`, `CONTRACTS.md` injection paragraph, `docs/diagrams/README.md`, `STYLES.md`, comments in `review.js` and `write.js` | `stable_addresses_docs.test.js` now scans LIBRARY, INSTALL, README, STYLES and the diagrams README, and checks the docs agree on the name rule and on 1483 or no port |
| Restored linked-document tests | yes: reload and handled check read the linked file; a render lists the real files; a path the mounts cannot vouch for names no file | `test/unit/linked_docs_mappers.test.js` |
| Spike spec, rollback header, `missingReviewNote` | yes: the spike moved to `test/retired/browser/` with a header; `catalog_open_rollback` has its header; `missingReviewNote` and `shellQuote` removed (no reader) | lint passes |

### Notes for the reviewers

- R3 covers `lahe review` and `lahe write` only. The Library's Open (`catalog_sites.planOf`, the library builder's file) still binds a file's own folder. A file opened from the Library under an already reviewed folder can still get a second address there.
- A link to a file in a hidden folder below home (for example `~/.config/notes/x.md`) opens like any other link. Hidden files are served like any other file; the home boundary and real-path containment are what bound a mount.
- The `skills/lahe/SKILL.md` change needs `npm run install-skills` at the checkpoint (not run here: it writes into Ken's live skill folder).

### Files changed

- `src/service/markdown_links.js`, `sites.js`, `page_routes.js`, `index.js`, `auth.js`, `log.js`, `routes.js`, `markdown.js`
- `src/cli/commands/review.js`, `src/cli/commands/write.js` (comment)
- `src/shared/review_format.js`
- `skills/lahe/SKILL.md`, `docs/CONTRACTS.md`, `docs/CLI.md`, `docs/ongoing/STATIC_SITE_FOLDER.md`, `docs/ongoing/STYLES.md`, `docs/diagrams/README.md`
- Tests: `mount_hidden_folders`, `ipv6_twin_taken`, `log_caps_round2`, `same_file_same_address`, `linked_docs_mappers` (new); `markdown_links`, `sites_dispatch`, `sites_registry`, `sites_binding`, `library_open_sites`, `review_format`, `stable_addresses_docs`; the spec `stable_addresses_sites`; two files under `test/retired/`

### Single-file runs

Unit: mount_hidden_folders 3/3, markdown_links 5/5, markdown_linked_docs 1/1, markdown_render 10/10, markdown_review 1/1, ipv6_twin_taken 2/2, sites_dispatch 15/15, serve_pages_port_taken 1/1, sites_registry 20/20, library_open_sites 17/17, install_hook 13/13, log_caps_round2 4/4, catalog_opens_script 5/5, catalog_auth 13/13, service_paths 9/9, pages_log_cap 2/2, sites_step3 5/5, catalog_routes 34/34, log_injection 2/2, protocol_wire 41/41, sites_styles 9/9, same_file_same_address 4/4, sites_cli 7/7, review_binds_used_review 1/1, sites_binding 18/18, review_format 56/56, stable_addresses_docs 3/3, linked_docs_mappers 4/4, sites_linked_docs 15/15, sites_pages 17/17, sites_mappers 17/17, page_load_reads 2/2, library_link_navigation 6/6, sites_state_dir_hidden 1/1, page_routes_carried 10/10, sites_lahe_names 7/7, status_catalog 18/18. Lint passes.

Browser, Chromium, one spec at a time: stable_addresses_sites 7/7, harness_second_origin 5/5, stable_addresses_mappers 3/3, library_stable_address 5/5.

### Leaks

`lahe.js serve` count: 2 before and 2 after (Ken's two helpers). Nothing from `sa-core` is running.

## V31 option A: old comments at a page's new address

### Summary

A comment made at a page's old `127.0.0.1:<port>` address now shows as a card at its stable address, once, and stays one after a reload. Nothing is posted back. Built as the "V31 options" section's Option A, with the "Either way" path alias.

### What was built

- `records.read` (`src/shared/protocol.js`, `src/service/routes.js`): this review's records for the asking page, whole, off the projector's kept fold (`projection.currentItems`). `page_routes.recordsForPage` filters them with `record.samePage`: the page's own address, the old origins of its site's root, and for an old Markdown review the rendered file's old path and the old origins of the folder it was served from (`page_routes.oldSpellings`). Never a draft. An Origin that is not a site address gets an empty list. Same token, Origin and registry checks as every review route; no new credential.
- The script tag carries the old path as `data-lahe-path-aliases`, and `record.samePage` reads it only together with an old origin.
- `sync.readRecords` (`src/layer/sync.js`) and the boot step in `src/layer/index.js`: on a page whose tag names old origins, one read at boot. The records that match this page go to `store.adopt`, then the rail merges again and replay anchors them. A read-only window takes nothing in.
- `store.adopt` (`src/layer/store.js`): only ids this browser does not hold, never a draft, never an item with an event queued here. Each goes through `merge.mergeLists` unchanged (`ONLY_STORE`), is written as acknowledged at its revision, and never enters the outbox.

### One difference from the plan

The option said the adopt step runs "before the first `merge()`". The first merge draws what browser storage holds, synchronously, at boot; the helper read is a network call. So the read starts at boot and, when it lands, the rail merges again. Waiting for it would hold the whole rail back on a slow helper.

### Rows and tests

| Row | Test |
| --- | --- |
| V31 (unit): store-only items arrive; a newer browser revision wins; a withdrawn draft stays out; other pages and other reviews never arrive; nothing reaches the outbox; a pending delete is not undone | `test/unit/adopt_old_records.test.js`, 8 tests, each guard checked by breaking it |
| V31 (browser): a comment made at an old address shows once as a card at the new one, stays one after a reload, and posts nothing back | `test/browser/stable_addresses_mappers.spec.js`, "V31: a comment made at the old address ..." (fails with the adopt step turned off) |
| Path alias for an old Markdown review | `adopt_old_records.test.js`, "an old Markdown review's rendered path ..." |

### Screenshots

The card at the new address, from the browser test above:

- [Old comment at the new address, light](screenshots/v31_old_comment_card_light.png)
- [Old comment at the new address, dark](screenshots/v31_old_comment_card_dark.png)

### Not done

- review.json still groups an old Markdown review's rendered-page items apart from the source's new address: the path alias reaches the rail, not `pageGroups`.

### Runs

- `npm run test:unit`, once at the end: 2649 tests, 2647 pass, 0 fail, 2 todo.
- Chromium, `stable_addresses_mappers.spec.js`: 4 of 4.
- `lahe.js serve` count: 2 before and 2 after (Ken's two helpers).

### Next: each page carries its own comments

Ken widened the linked-document fix to every page. The design note is [each_page_its_own_comments.md](../parts/architecture/each_page_its_own_comments.md). It recommends making `records.read` per file rather than per review. Nothing from it is built yet.

## Hidden files are served like any other file

### Summary

Hidden files get no special handling: they are served and linked like any other file, the rule Ken set on main. Worktrees usually live in hidden folders (`repo/.claude/worktrees/<name>/`), and refusing hidden segments broke every document in one.

### What it does

- A dotfile under a site root, or under a mount, is served.
- A Markdown link into a hidden folder under home is a mount, like any other link.
- What still bounds a request:
  - `decodePath` refuses dot segments, encoded slashes and NUL.
  - Real-path containment holds for the site root and every mount.
  - A mount must be under the home folder by real path. That is checked when a link makes the mount, in `sites.cleanMounts`, and at serve time, so a mount in `sites.json` whose folder is outside home serves nothing.
  - Nothing inside the state folder is served.
  - The 16-mount cap holds.
  - Lahe's reserved names (`/.lahe-source/`, `/.lahe-library/`, `.lahe-doc-style.css`, `.lahe-fonts/`, `.lahe-styles`) are answered by Lahe and never read from the folder.
- Every page response carries `Content-Security-Policy: frame-ancestors 'self'`: only the page's own site may frame it. This closes a gap the security review of the design note found in the current build.
- `catalog_reader.js` `hasHiddenSegment` is left as it is. It guards only the Library's fallback for a document whose worktree is gone: the main checkout's copy is refused when its path inside the repository has a hidden segment (for example `repo/.github/x.md`). It does not stop the Library listing or opening a document in a live worktree under `.claude/worktrees/`, because the hidden part there is outside the path it checks. It is the library builder's file.

### Tests

- `test/unit/hidden_files_served.test.js` (6):
  - a worktree Markdown review under `.claude` serves, and its sibling links work;
  - a link into a hidden folder under home is served;
  - a hidden file under the root and under a mount is served;
  - the reserved names answer as before, and dot segments and encoded slashes are refused;
  - a symlink out of a mount is refused;
  - every page carries `frame-ancestors 'self'`.
  - The first three failed before the change, and so did the frame-ancestors test.
- Rewritten to the restored rule:
  - `mount_home_boundary.test.js` (renamed from `mount_hidden_folders.test.js`, home boundary only);
  - the two V14 tests in `sites_pages.test.js`;
  - the hidden-link test in `markdown_links.test.js`;
  - the `fileForPage` case in `sites_mappers.test.js`.
- `npm run test:unit`, once: 2654 tests, 2652 pass, 0 fail, 2 todo.
- Chromium: `stable_addresses_sites` 7 of 7. `stable_addresses_mappers` 4 of 4. In one run, V27 (an agent's edit reloads only its own page) missed its poll timing; it passed alone and on the next full run.
- `lahe.js serve` count: 2 before. After: 3, and the third is a helper from the `sa-library` worktree, not this one.

## Each page carries its own comments (built)

### Summary

Built as the approved design note, with both security passes folded in. Every page shows every comment made on it, from wherever the reviewer came, and nothing is ever written into another review from a page.

### What it does

- **One review per file** (`lahe review`, `page_routes.holderOfFile`):
  - A file that has a review opens it and never gets a second.
  - In another session's review, the command prints the address and whose it is, and makes nothing. When that agent is listening, it says to ask the human; otherwise it names `lahe session takeover`.
  - `--new` and `--new-session` are refused for such a file.
  - A folder or linking review counts only once it holds a committed comment on the file.
- **`lahe review retire`** (`review.retire`, CLI secret): only the owning session may retire a review. A retired review answers on no page, fails the Origin check, takes no events, and never counts as its file's review.
- **`lahe session takeover`** is refused from the CLI while the session's agent is listening.
- **One page, every address:**
  - The tag carries the page's other addresses in its review (`data-lahe-spellings`), and `records.read` returns those records.
  - A top-level load of a link address to a file with its own review is redirected (302, `no-store`) to its own address, built from the registry.
  - Anything else at that link address, or a file with no address of its own, is served read-only.
- **Old splits:** `records.read` returns them under `others`, and the Active tab shows them in their own read-only list.
- **Service contract 17.**
- **The catalog cross-site spec's timeout** was caused by the refusal dedupe (1793ebf): a page's no-cors fetch and its beacon are the same request, and the spec reads one log line per attempt. An identical refusal is now logged up to 8 times. The spec was right; the code changed.

### Tests

- Unit:
  - `one_review_per_file` 5
  - `review_retire` 2
  - `each_page_comments` 10 (each guard checked by breaking it)
  - `log_caps_round2` 4
  - updated: `sites_cli`, `review_binds_used_review`, `protocol_wire`
- Browser, Chromium:
  - `each_page_comments` 4 of 4
  - `linked_docs_rail` 2 of 2 (the own-review test restored)
  - `catalog_cross_site` 2 of 2
  - `stable_addresses_mappers` 4, `stable_addresses_sites` 7, `library_stable_address` 7

### Screenshots

- [Read-only card from another review, light](screenshots/read_only_card_light.png)
- [Read-only card from another review, dark](screenshots/read_only_card_dark.png)

### Not done

- The Library's Open (`catalog_sites.planOf`, the library builder's file) does not yet apply one review per file: an Open of a file under an already reviewed folder can bind its own folder.

## Cleanup needed

- `test/retired/browser/tmp_spike_lahe_localhost.spec.js`: the Task 1.0 spike, retired in fix round 2.
- `test-results/`: Playwright's output folder from the spec runs (gitignored).
- Everything under `test/retired/` (see the Step 3 list), once Ken approves.
- `src/service/idle_servers.js`: nothing requires it; take its entry out of `src/shared/manifest.js` in the same change (lint needs the entry while the file exists).
- `test/retired/unit/sites_step3_v34.retired.test.js`: V34, retired in the fix round.
- `docs/features/20260922.02_linked_docs_rail/linked_page_rail.png` and `docs/features/20260923.01_rebuild_not_the_agents_job/card_not_on_page.png`: rewritten in the working tree by spec runs (not committed). Put them back with `git checkout`.
- `progress/screenshots/file_gone_*.png`, `library_stable_addresses_*.png` and `v31_old_comment_card_*.png`: rewritten in the working tree by spec runs with the screenshot folder set (not committed). Put them back with `git checkout`.
- `.claude-commit202610111600-core`, `...1630-core`, `...1645-core`, `...1700-core`, `...1730-core`, `...1800-core`, `...1815-core`, `...1900-core`, `...1930-core`, `...1931-core`, the Step 3 ones (`...2100-core` onward), the fix-round ones (`...202610120100-core` to `...202610120550-core`), and `...202610120700-core` onward, and the one this page's commit adds, in the worktree root: commit message scratch files (gitignored).
