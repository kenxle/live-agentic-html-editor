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

## Cleanup needed

- `test/browser/tmp_spike_lahe_localhost.spec.js`: the Task 1.0 spike, committed for the Linux run. Remove once Linux has been checked.
- `test-results/`: Playwright's output folder from the spec runs (gitignored).
- `.claude-commit202610111600-core`, `...1630-core`, `...1645-core`, `...1700-core`, `...1730-core`, `...1800-core` in the worktree root: commit message scratch files (gitignored).
