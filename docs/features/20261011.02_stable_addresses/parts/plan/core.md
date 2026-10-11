### Workstream: core (Steps 1 to 3)

**Outcome:** the helper serves every page Lahe serves itself, at `<name>.lahe.localhost:<port>/<path>`, with today's paths and rail rules, and no per-session page-server process.

**Reads first:** the architecture's Summary, Data / State Changes, and Key Flows ("Serving a request", "Which review answers on a page", "Binding"); [recon](../architecture/recon.md) sections 1, 2, 5, 9; `docs/ongoing/SERVING_ARCHITECTURES.md`, `STATIC_SITE_FOLDER.md`, `FREE_WRITING.md` (notes pages); `docs/CONTRACTS.md` (D11 checks); `docs/diagrams/module_map.md`.

#### Step 1: Named sites behind the switch (PR 1)

**The switch.** `LAHE_PAGES=sites` is read by the helper at start and reported in `service.json`. The CLI follows the running helper's value, never its own environment. Live for everyone in PR 1, because each is harmless with no names granted: Host dispatch, the `::1` listener, the `site.bind` route. Behind the switch: `lahe review` and `lahe write` binding instead of starting page servers, and every registry-backed lookup.

**Task 1.0: Spike: `*.lahe.localhost` in the three Playwright lanes.** Locally on macOS with `npm run gate:all`'s three lanes, and on Linux through the dispatch workflow from Task 0.1. Record any launch flag needed. Acceptance: a throwaway spec loads a page in all three lanes, or the gap is reported before Task 1.4.

**Task 1.1: The registry, `src/service/sites.js`.** As the architecture's Data section defines it. Acceptance: V1 to V6.

**Task 1.2: Host dispatch and listeners.** A second listener on port 1483 for pages, beside 7817 for the API, both on `127.0.0.1` and `::1`. Page names are refused on 7817. In `index.js`, with rules and constants in `src/shared/protocol.js`. Acceptance: V7 to V10, V68.

**Task 1.3: Page serving, `src/service/page_routes.js`.** The serving half of `static_servers.js` moves here, plus everything the architecture's "Serving a request" flow adds. Acceptance: V11 to V20, V69.

**Task 1.4: Binding and the CLI order.** `site.bind`, the CLI secret, `add --served-by-helper`, and the new order in `lahe review` and `lahe write`. Old loopback origins are removed at bind. The Origin check for page requests reads the registry. Acceptance: V21 to V25, V65, V66.

**Step test:** with the switch on, `lahe review` on an HTML file, on a Markdown file with an image and a link outside its folder, on a folder, and `lahe write`, each print a `.lahe.localhost` address. Each page loads with its rail, and a comment reaches `review.json`. With the switch off, `npm run gate:unit` is unchanged from main.

#### Step 2: Helper modules ask the registry, when the switch says so (PR 1)

**Task 2.1: Page-to-file mappers.** `reviews.js` (`servesPath`, healing stand-down, `pageUnderFolder`, `targetForPage`), `heal.js`, `rebuild.js`, `handled_check.js`, `projection.js`, `markdown.js`, `markdown_links.js`, and linked files. Each asks the registry when the switch is on and page-server records when it is off. Task 3.1 removes the off branch. Acceptance: V26 to V30, each run with the switch on and off.

**Task 2.2: Old comments and grouping.** Aliases computed from old records at serve time, used by `samePage` in `src/shared/record.js` and by grouping in `src/shared/review_format.js`. Acceptance: V31, V32, V70.

**Step test:** a review created on a random port, opened with the switch on: its old comments show, an agent reply reloads the page, the handled check reads the right file, and no served HTML file changes on disk after a poll.

#### Step 3: Default on, page servers retired (PR 2)

**Task 3.0: Test retirement list.** Before any code in this step, list every existing test file that tests removed behavior: idle stop, page-server restart, port history, origin swap, `SIGHUP` mounts, the reopened-session sweep. Mark each one rewrite or retire, with one line of reason, in `progress/phase6_workstream_core.md`. The orchestrator puts the retire list in front of Ken for one batch approval before PR 2's gate. Builders delete nothing.

**Task 3.1: Flip and remove.** Sites become the only path. Page-server spawning, the idle sweep, the session-close stop, port history, origin swaps, the `SIGHUP` reload, and the switch's off branches are removed. Old records stay readable. Every helper start stops leftover page servers, after confirming each is the recorded process through its health probe and instance id. Acceptance: V33 to V36, V63, V64, V67.

**Task 3.2: `lahe status` and logging.** Status shows the port, the printed ending and why, each review's site, a taken port, and the install state that install writes to `service.json`. The log records the lines the brief's Logging section lists. Acceptance: V37, V71.

**Task 3.3: Skill, contract, and serving docs.** These all change in PR 2, using the printed ending Ken chose at the review gate:

- `skills/lahe/SKILL.md`, then `npm run install-skills`
- the contract in `src/shared/review_format.js`, plus its copies in `test/unit/review_format.test.js` and `docs/CONTRACTS.md`
- `docs/CLI.md`
- `docs/ongoing/SERVING_ARCHITECTURES.md`, `STATIC_SITE_FOLDER.md`, `FREE_WRITING.md`, `SESSION_OWNERSHIP.md`
- the four diagrams the architecture lists
- the new D11 residual line

Acceptance: V38.

**Step test:** the orchestrator runs `npm run gate`, alone, on the integrated branch and reads 0 failed.
