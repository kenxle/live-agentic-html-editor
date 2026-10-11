### Workstream: core (Steps 1 to 3)

**Outcome:** the helper serves every page Lahe serves itself, at `<name>.lahe.localhost:<port>/<path>`, with today's paths, today's rail rules, and no per-session page-server process. Behind the `LAHE_PAGES=sites` switch until Task 3.1 makes it the default.

**Reads first:** the architecture (Summary, Data / State Changes, Key Flows "Serving a request", "Which review answers on a page", "Binding"), [recon](../architecture/recon.md) sections 1, 2, 5, 9, `docs/ongoing/SERVING_ARCHITECTURES.md`, `docs/ongoing/STATIC_SITE_FOLDER.md`, `docs/ongoing/FREE_WRITING.md` (notes pages), `docs/CONTRACTS.md` (D11 checks), `docs/diagrams/module_map.md`. Not the alternatives leaf, not the review files, unless weighing a deviation.

**Authority:** the architecture. A deviation goes under Changes from plan on the progress page, with a one-line question to the orchestrator first.

#### Step 1: Named sites behind a switch

**Task 1.0: Spike, `*.lahe.localhost` in the three Playwright lanes.** Prove that Chromium, Firefox, and WebKit in this repo's Playwright setup load `http://x.lahe.localhost:<port>/` from a helper bound to `127.0.0.1` and `::1`, locally on macOS and in CI (Linux). Record the result and any launch flag needed in `progress/phase6_workstream_core.md`. Acceptance: one throwaway spec passes in all three lanes, or the gap is reported before Task 1.4.

**Task 1.1: The registry (`src/service/sites.js`).** Name rule, clash rule, reserved names, `realpathSync.native` roots, modes, mounts, worktree recording from the `.git` file, `sites.json` plus the append-only `sites.log`, rebuild from the log, read-only mode when neither reads. Single writer: only the helper process calls the writing functions. Acceptance: unit rows V1 to V6.

**Task 1.2: Host dispatch and listeners (`index.js`, `protocol.js`).** Host dispatch runs before `OPTIONS` and catalog matching. Grammar per the security notes. Second listener on `::1`, failure logged. `PAGES` constants and Host rules live in `src/shared/protocol.js`. Acceptance: V7 to V10.

**Task 1.3: Page serving (`src/service/page_routes.js`).** Move the serving half of `static_servers.js`: path safety, hidden-file refusal, `page-only` mode, injection (with `data-lahe-aliases`), Markdown render from source with a file-time cache, site-scoped mounts, reserved files, `Cross-Origin-Resource-Policy`, the unknown-name and file-gone pages, the read-only worktree copy. The review rule per request, without the session filter. Acceptance: V11 to V20.

**Task 1.4: Binding and the CLI order.** `site.bind` route with the CLI secret file, refusal of any `Origin`, root from the request. `add --served-by-helper`. `lahe review`, `lahe write` use the new order when `LAHE_PAGES=sites`. Old loopback origins removed at bind. The Origin check for page requests reads the registry. Acceptance: V21 to V25.

**Step test:** with `LAHE_PAGES=sites`, `lahe review` on an HTML file, a Markdown file with an image and a link outside its folder, a folder, and `lahe write` each print a `.lahe.localhost` address. Each page loads with its rail, and a comment round-trips to `review.json`.

#### Step 2: Every helper module asks the registry

**Task 2.1: Page-to-file mappers.** `reviews.js` (`servesPath`, healing stand-down, `pageUnderFolder`, `targetForPage`), `heal.js`, `rebuild.js`, `handled_check.js`, `projection.js`, `markdown.js`, `markdown_links.js`, linked files. Each reads sites instead of page-server records. Acceptance: V26 to V30.

**Task 2.2: Old comments and grouping.** Aliases computed from old page-server records at serve time. `samePage` in `src/shared/record.js` and grouping in `src/shared/review_format.js` accept them. Acceptance: V31, V32.

**Step test:** the same reviews as Step 1, plus a review created before the switch, reopened under the switch: its old comments show, an agent reply reloads the page, a handled check reads the right file, and no served HTML file on disk changes after a poll.

#### Step 3: Make it the default, retire page servers

**Task 3.1: Flip the switch.** Sites become the only path for HTML, Markdown, folders, and notes. Page-server spawning, the idle sweep, the session-close stop, port history, origin swaps, and the `SIGHUP` mount reload are removed. Old records stay readable. Every helper start stops leftover page-server processes named in old records. `lahe session close` stops only the session. Remove `LAHE_PAGES`. Acceptance: V33 to V36, V63, V64.

**Task 3.2: `lahe status` and printed lines.** Status shows the port, the printed ending and why, and the site name for each review. No line mentions an idle-stopped port. Acceptance: V37.

**Task 3.3: Skill, contract, and serving docs.** `skills/lahe/SKILL.md`, the contract in `src/shared/review_format.js` and its two restated copies (`test/unit/review_format.test.js`, `docs/CONTRACTS.md`), `docs/CLI.md`, `docs/ongoing/SERVING_ARCHITECTURES.md`, `STATIC_SITE_FOLDER.md`, `FREE_WRITING.md`, `SESSION_OWNERSHIP.md`, `docs/diagrams/system_overview.md`, `session_ownership.md`, `review_round_trip.md`, `module_map.md`, `src/shared/manifest.js`, and the D11 residual line. Then `npm run install-skills`. Acceptance: V38.

**Step test:** full `npm run gate` alone, 0 failed. The leak check counts no `static_servers.js --serve` process left by any test.

**Don't touch:** `src/service/catalog_*.js`, `src/layer/catalog/`, `src/cli/commands/install.js`, `src/service/login_item.js`, `src/service/name_server.js`.
