# Phase 8: watching label, and the items from Ken's preview

Branch `task/lib-watch`, off `feat/lahe_library`. Not merged. `dist/` rebuilt locally only, not committed.

Summary: the card now says what is known about an agent (listening, working, or last active), and only a listening or working agent asks before a hand-over. The same branch carries eight more items from Ken's preview: `last` from event times, project labels, one card per project for pre-session reviews, notes said once per card, a two-line row with the real path, collapsible lists, a cobalt card header, rename, and pre-session pick-ups that keep their old comments.

![The Library, light](../catalog_page_light.png)

![The Library, dark](../catalog_page_dark.png)

![The confirm dialog, dark](../catalog_confirm_dark.png)

## What changed

1. **Watching label.** `livenessFrom` gains `presence`: `listening` for a live monitor, `working` for a lahe command within `protocol.CATALOG.WORKING_MS` (2 minutes), otherwise `away`. The reader's `watching` is set only for listening or working, and now carries `state` and `last_active`. A new `away` field holds `{session, name, last_active}`. Open's confirm step and the page both read `watching`, so an agent that is only recently busy no longer blocks. The card and the confirm dialog say "<agent> is listening", "<agent> is working, last active <time>", or "<agent> last active <time>, not listening". The dialog also says how many comments are waiting. The queue keeps its 10-minute rule for expiring requests.
2. **`last`.** It is now the `ts` of the newest work event, read backwards from the log's end. It is never a file's mtime. `origin.*`, `page.visited` and `review.adopted` do not count. With no readable event, it falls back to `review.json`'s `generated_at`, then `meta.created_at`. `counts_as_of` and the week split use the same value. Tested with a compacted log whose mtime is new and whose newest event is old. The fixture builder now stamps each review's newest event at its intended last, and the oversized fixture log is padded before its events.
3. **Project label.** Files under `~/.claude` show "claude config". A worktree under `<repo>/.claude/worktrees/` shows the repo's name, even when no `.git` is left. Run against the preview state, the ".claude" labels came only from `~/.claude/skills`. The worktree rows already read correctly there (67 rows across three repos).
4. **Pre-session cards.** There is one card per project, titled "<project>, from before sessions", sorted by newest activity.
5. **Notes once per card.** A notice that every row of a card carries moves to the card. This is general, so "needs an agent" moves too when no agent is attached.
6. **Row layout.** Each row shows the name, then the real path (mono, `--text-micro`, muted, shortened in the middle past 64 characters, keeping the head up to the project folder), then the time and counts. Open sits over Hand to agent in one narrow column.
7. **Collapsing.** A review's pages show as "N pages" with a toggle. A card with more than 5 reviews shows "Show N more", and waiting, starred and acted-on rows stay visible. Both are keyboard reachable and last only for the page's lifetime. Search shows everything.
8. **Card header.** A cobalt band with white text (a dark cobalt mix in dark mode). The page list is indented and fainter.
9. **Rename.** `catalog.rename` has the same checks as star and is in the `protocol.js` route table. It saves `catalog.json` `names`, 80 characters at most, cleaned by the session-name rule, and applies to the whole fold. The row shows the new name first, with the original small underneath. Search matches both. The name is never in `describeReview`, the drain, a request or a hand-off. A test checks the drain and the queue file for a marker name.
10. **Pre-session pick-up keeps its comments.** `lahe library serve` runs `lahe review --review <id> --adopt`. Adopting is allowed only when the review's owner is `legacy` and a Library pick-up of that review is pending for that session. `lahe add` checks the queue, and so does the helper's `review.write` (`adopt_session`), because page scripts can read the review token. The helper writes the owner to `meta.json` and appends one `review.adopted` event. Log recovery and the projection both read the new owner. A review that already has a session is never adopted.

Docs: architecture (liveness note, `last`, project, `custom_name`, rename, page layout, legacy adoption), `docs/CONTRACTS.md` (liveness `presence`, list `watching`/`away`, `catalog.rename` rows, `review.adopted`, `review.write` `adopt_session`, the drain note, the contract copy), `docs/CLI.md`, `skills/lahe/SKILL.md`, the contract in `review_format.js`, the test copy, and the `session_ownership` diagram.

## Commands run

| Command | Result | Time |
| --- | --- | --- |
| `node --test` on the touched unit files (many runs, red then green) | each new test seen failing first, then passing; exceptions below | a few seconds each |
| `npx playwright test test/browser/catalog_page.spec.js --project=chromium` (after the watching change) | 21 passed, 1 skipped | 6s |
| `npm run gate:unit` (after the watching change) | 1910 tests, 1908 pass, 0 fail, 2 todo | 39s |
| `npx playwright test test/browser/catalog_cross_site.spec.js --project=chromium` (rename added to the POST routes) | 2 passed | 34s |
| `npm run gate:unit` | 1 fail: `protocol_wire.test.js`'s closed vocabulary list lacked `review.adopted`. List updated | 39s |
| `npm run gate:unit` | 1940 tests, 1938 pass, 0 fail, 2 todo | 50s |
| `npm run build:layer` then `npx playwright test test/browser/catalog_page.spec.js --project=chromium` | 23 passed, 1 skipped (the screenshot test) | 11s |
| `LAHE_SHOTS=1 npx playwright test test/browser/catalog_page.spec.js --project=chromium -g screenshots` | 1 passed; light, dark, confirm and phone retaken and looked at | 3s |
| `npm run install-skills` | updated `~/.claude/skills/lahe/SKILL.md` and `~/.agents/skills/lahe/SKILL.md` from this unmerged branch (see below) | under 1s |

## Where TDD order slipped

- The phase 8 test "an agent neither listening nor working does not block Open" passed at once in the view model, because the page already reads the list's `watching`. The gating change is in the reader and was red there, in `catalog_routes.test.js`.
- The browser spec edits and the `review.write` gate tests were written after their code. The gate test was then mutation-checked: dropping the pending-request check made two of its tests fail.

## Needs the orchestrator

- `npm run install-skills` ran from this branch, so the installed skill now describes the adopting pick-up before the branch is merged. Re-run install-skills from whichever branch should be live if that is wrong.
- `dist/lahe-layer.js` needs the checkpoint rebuild.

## To delete at cleanup

- `/private/tmp/.../scratchpad/projects.js`: a scratch script that ran the reader over the preview state. It lives in /tmp, so no removal is needed.

## Fix round after gate:all on feat/lahe_library

1. **Rail payload.** `replies.poll` now strips `presence`, so the rail gets exactly the fields it had before. The per-review route is back to its old keys, and `livenessNone` no longer adds `presence`. The unit test's key list drops `presence` and asserts it is absent. That test went red first. Only the Library list carries the new state.
2. **Confirm dialog locator.** The body paragraph has class `lib-dialog-body` and the status has `lib-dialog-status`. `catalog_library.spec.js` checks each one. The status there is "Its own agent is listening.", since the watched reviews in that test hold no comments. The spec asserts that no waiting count is claimed. The count itself is pinned in `catalog_page.spec.js` ("3 comments are waiting.") and in the view model tests.

| Command | Result | Time |
| --- | --- | --- |
| `node --test test/unit/agent_liveness.test.js` (before the fix) | 1 fail: the key list without `presence` | under 5s |
| `npx playwright test test/browser/catalog_library.spec.js test/browser/rail_agent_liveness.spec.js --project=chromium` | 7 passed, 1 failed: the new status assertion expected a waiting count the test world does not have | 36s |
| `npx playwright test test/browser/catalog_library.spec.js --project=chromium` | 3 passed | 31s |
| `npm run gate:unit` | 1940 tests, 1938 pass, 0 fail, 2 todo | 37s |
| `npx playwright test test/browser/reload_claim.spec.js:159 --project=webkit` | 1 passed | 3s |
| `npx playwright test test/browser/oversized_records.spec.js:101 --project=firefox` | 1 failed (`toBeGreaterThan`), the known red on main | 3s |

## Round 2: Ken's second preview

Each of these changes has a test that failed first. The reader and view model tests were written before the code. Some browser spec expectations were updated afterwards, where display names moved from "folder / file" to the file's own title.

- Path line: the path from the project root (repository, worktree root, `~/.claude`), else the `~` path. It is never shortened, wraps after slashes, and its tooltip is the whole `~` path.
- The name is the rename control, for rows and for session cards. Sessions can be renamed (`catalog.json` `session_names`), with the original shown under the new name.
- A rename equal to the original name shows once.
- With no recorded title, a row takes the file's own `<title>` or first Markdown heading. With neither, it shows just the file name.
- A review with several pages is named after its own page. Its page list shows real paths, never `.lahe-source` mounts.
- Two reviews of one document in one session fold into one row: "N reviews of this document, shown as one".
- The top section holds only the waiting and starred reviews. A session's other reviews appear in the time sections as a second card of that session.
- "Search reaches all of them." is a subtitle.
- The Hand to agent menu floats, so the buttons keep their width.

![The Library, light](../catalog_page_light.png)

![The Library, dark](../catalog_page_dark.png)

| Command | Result | Time |
| --- | --- | --- |
| `npx playwright test test/browser/catalog_page.spec.js --project=chromium` | 26 passed, 1 skipped | 6s |
| `npx playwright test test/browser/catalog_library.spec.js --project=chromium` | 3 passed, after two runs that failed on the expected display-name changes | 31s |
| `npm run gate:unit` | 1 fail (the list fixture, before it was regenerated), then 1957 tests, 1955 pass, 0 fail, 2 todo | 35s |
| `LAHE_SHOTS=1 ... -g screenshots` | light and dark retaken and looked at | 2s |

## Rename exits (itm_c35bead0caf28c887da62099)

Enter or clicking outside saves. Escape cancels, and the blur that Escape causes saves nothing. An empty or unchanged value changes nothing, and typing the original name back clears the rename. This works the same for row names and session names. The new test in `catalog_page.spec.js` covers blur-save for a row and for a session, Escape plus a following click sending nothing, and empty and unchanged values sending nothing. It failed first, before the change.

| Command | Result | Time |
| --- | --- | --- |
| `npx playwright test test/browser/catalog_page.spec.js --project=chromium -g "clicking outside"` (before the change) | 1 failed: no request on blur | 6s |
| `npx playwright test test/browser/catalog_page.spec.js --project=chromium` | 27 passed, 1 skipped | 5s |
| `npm run gate:unit` | 1957 tests, 1955 pass, 0 fail, 2 todo | 40s |
