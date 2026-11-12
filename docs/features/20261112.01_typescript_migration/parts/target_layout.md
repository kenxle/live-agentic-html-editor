---
read-when: Finding where a source file moves in the TypeScript migration, or which slice converts it.
---

# Target layout: every source file, where it goes, and which slice moves it

Each row is one file under `src/` today. "Slice" names the plan slice that converts it; see [the plan](../02_plan_typescript_migration.md#slices). File names become kebab-case. A slice may split a file into several files inside the same target folder; it may not move code into another slice's folder. Exported names stay as they are during conversion, so the old callers keep working; the area's finishing slice renames them.

## The folders

| Folder | Runs in | May import | Holds |
| --- | --- | --- | --- |
| `src/contract/` | anywhere | nothing in `src/` | The wire contract: record and message types, constant tables (routes, headers, markers, failure codes, style rules) and the functions that parse untrusted wire data into those types. |
| `src/domain/` | anywhere | `contract` | Logic that the server and the browser both run and must agree on. |
| `src/server/` | Node | `contract`, `domain` | The local HTTP server, the review store, agent sessions, sites and rendering, the Library's server side, the login item and the menu bar's summary. Was `src/service/`. |
| `src/cli/` | Node | `contract`, `domain`, `server` | The `lahe` commands. |
| `src/browser/review-layer/` | browser | `contract`, `domain` | The review layer injected into a reviewed page. Was `src/layer/`. |
| `src/browser/library-page/` | browser | `contract`, `domain` | The Library page's script. Was `src/layer/catalog/` and `copy_text.js`. |

The compiler enforces the "may import" column: each folder is its own TypeScript project, and a project can only reach the projects it references. The server and CLI projects get Node's types and no DOM; the browser projects get the DOM and no Node types; `contract` and `domain` get neither.

## `src/shared/` (contract wave)

| Today | Target | Slice |
| --- | --- | --- |
| `shared/elapsed.js` | `domain/elapsed.ts` | S0c (the browser pilot) |
| `shared/markers.js` | `contract/markers.ts` | C1 |
| `shared/failures.js` | `contract/failures.ts` | C1 |
| `shared/style_rules.js` | `contract/style-rules.ts` | C1 |
| `shared/gestures.js` | `domain/gestures.ts` (vocabulary constants may go to `contract/gestures.ts`) | C1 |
| `shared/epoch.js` | `browser/review-layer/editing/write-epoch.ts` (only the browser runs it) | C1 |
| `shared/normalize.js` | `domain/normalize.ts` | C2 |
| `shared/record.js` | `contract/record.ts`, with any logic that is not shape, constant or parsing in `domain/record-rules.ts` | C3 |
| `shared/protocol.js` | `contract/protocol.ts` | C4 |
| `shared/lifecycle.js` | `domain/lifecycle.ts` | C5 |
| `shared/review_format.js` | `domain/review-format.ts` | C5 |
| `shared/merge.js` | `browser/review-layer/storage/merge.ts` (only the browser runs it) | C5 |
| `shared/regions.js` | `browser/review-layer/anchoring/regions.ts` | C5 |
| `shared/uniqueness.js` | `browser/review-layer/anchoring/uniqueness.ts` | C5 |
| `shared/record_fixtures.js` | `test/support/record-fixtures.ts`, and out of the shipped bundle | C5 |
| `shared/contracts.js` | removed; its two importers import the modules directly | C5 |
| `shared/script_line.js` | `server/sites/script-line.ts` | S0b (the Node pilot) |
| `shared/manifest.js` | shrinks as files convert; removed in F1 | F1 |

## `src/service/` to `src/server/` (server chain)

| Today | Target | Slice |
| --- | --- | --- |
| `heal.js` | `server/sites/heal.ts` | SV1 |
| `login_item.js` | `server/system/login-item.ts` | SV1 |
| `name_server.js` | `server/sites/name-server.ts` | SV1 |
| `pandoc.js` | `server/rendering/pandoc.ts` | SV1 |
| `lahe_render.lua` | `server/rendering/lahe_render.lua` (moved unchanged) | SV1 |
| `source_stamp.js` | `server/system/source-stamp.ts` | SV1 |
| `state_dir.js` | `server/store/state-dir.ts` | SV1 |
| `tab_icon.js` | `server/rendering/tab-icon.ts` | SV1 |
| `watchers.js` | `server/sessions/watchers.ts` | SV1 |
| `addresses.js` | `server/sites/addresses.ts` | SV2 |
| `log.js` | `server/store/event-log.ts` | SV2 |
| `markdown_links.js` | `server/rendering/markdown-links.ts` | SV2 |
| `menubar.js` | `server/menu-bar/app.ts` | SV2 |
| `review_writer.js` | `server/store/review-writer.ts` | SV2 |
| `self_stop.js` | `server/system/self-stop.ts` | SV2 |
| `static_servers.js` | `server/sites/static-servers.ts` | SV2 |
| `styles.js` | `server/rendering/styles.ts` | SV2 |
| `wake_feed.js` | `server/sessions/wake-feed.ts` | SV2 |
| `agent_sessions.js` | `server/sessions/agent-sessions.ts` | SV3 |
| `auth.js` | `server/http/auth.ts` | SV3 |
| `markdown.js` | `server/rendering/markdown.ts` | SV3 |
| `sites.js` | `server/sites/sites.ts` | SV3 |
| `replies.js` | `server/store/replies.ts` | SV4 (import cycle, converted together) |
| `projection.js` | `server/store/projection.ts` | SV4 |
| `page_routes.js` | `server/sites/page-routes.ts` | SV4 |
| `rebuild.js` | `server/sites/rebuild.ts` | SV4 |
| `handled_check.js` | `server/store/handled-check.ts` | SV4 |
| `catalog_launch.js` | `server/library/launch.ts` | SV5 |
| `catalog_page.js` | `server/library/page.ts` | SV5 |
| `catalog_requests.js` | `server/library/requests.ts` | SV5 |
| `catalog_store.js` | `server/library/store.ts` | SV5 |
| `catalog_sites.js` | `server/library/sites.ts` | SV5 |
| `routes.js` | `server/http/routes.ts` | SV5 |
| `reviews.js` | `server/store/reviews.ts` | SV5 |
| `catalog_actions.js` | `server/library/actions.ts` | SV6 |
| `catalog_reader.js` | `server/library/catalog.ts` | SV6 |
| `summary.js` | `server/menu-bar/summary.ts` | SV6 |
| `index.js` | `server/main.ts` | SV7 |

## `src/layer/` to `src/browser/` (browser chain)

| Today | Target | Slice |
| --- | --- | --- |
| `listeners.js` | `browser/review-layer/listeners.ts` | B1 |
| `selection.js` | `browser/review-layer/anchoring/selection.ts` | B1 |
| `blocks.js` | `browser/review-layer/anchoring/blocks.ts` | B1 |
| `conflict_toast.js` | `browser/review-layer/rail/conflict-toast.ts` | B1 |
| `choices.js` | `browser/review-layer/review/choices.ts` | B1 |
| `export.js` | `browser/review-layer/review/export.ts` | B1 |
| `store.js` | `browser/review-layer/storage/store.ts` | B2 |
| `style_switch.js` | `browser/review-layer/rail/style-switch.ts` | B2 |
| `anchor.js` | `browser/review-layer/anchoring/anchor.ts` | B3 |
| `pointing.js` | `browser/review-layer/anchoring/pointing.ts` | B4 |
| `highlight.js` | `browser/review-layer/protection/highlight.ts` | B4 |
| `protect.js` | `browser/review-layer/protection/protect.ts` | B5 (two-way dependency, converted together) |
| `replay.js` | `browser/review-layer/review/replay.ts` | B5 |
| `overlay.js` | `browser/review-layer/rail/overlay.ts` | B6 |
| `zoom.js` | `browser/review-layer/rail/zoom.ts` | B7 |
| `tab_active.js` | `browser/review-layer/rail/tabs/active.ts` | B7 |
| `tab_edits.js` | `browser/review-layer/rail/tabs/edits.ts` | B7 |
| `tab_done.js` | `browser/review-layer/rail/tabs/done.ts` | B8 |
| `sync.js` | `browser/review-layer/review/sync.ts` | B9 |
| `comments.js` | `browser/review-layer/review/comments.ts` | B10 |
| `editing.js` | `browser/review-layer/editing/editing.ts` | B11 |
| `inject.js` | `browser/review-layer/boot/inject.ts` | B11 |
| `index.js` | `browser/review-layer/main.ts` | B12 |
| `catalog/view_model.js` | `browser/library-page/view-model.ts` | B13 |
| `copy_text.js` | `browser/library-page/copy-text.ts` | B13 |
| `catalog/page.js` | `browser/library-page/main.ts` | B13 |

## `src/cli/` (one slice)

| Today | Target | Slice |
| --- | --- | --- |
| `index.js` | `cli/main.ts` | CLI |
| `codex_monitor.js` | `cli/codex-monitor.ts` | CLI |
| `commands/*.js` (13 files) | `cli/commands/<name>.ts` | CLI |

## Outside `src/`

| Today | Target | Slice |
| --- | --- | --- |
| `bin/lahe.js` | stays JavaScript: a short Node version check, then loads `src/cli/main.ts` | S0a, pointed at the new entry in CLI |
| `scripts/*.js` | `scripts/*.ts` | T3 |
| `test/unit/*.test.js` | `test/unit/**/*.test.ts` | T1 |
| `test/browser/**`, `test/helpers/**`, `test/support/**`, `playwright.config.js` | `.ts` | T2 |
