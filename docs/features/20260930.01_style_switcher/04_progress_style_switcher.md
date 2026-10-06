# Progress: Style switcher

**Done.** The style switcher is live on main: pull request 26 merged it, and pull request 28 gave it its own button in the rail. You approved it on 2026-10-06. Nothing is waiting on you. Last updated 2026-10-06 19:16.

**Docs:** [Crucible](00_crucible_style_switcher.md) · [Brief](01_brief_style_switcher.md) · [Architecture](02_architecture_style_switcher.md) · [Plan](03_plan_style_switcher.md)

## Needs your attention

Nothing. The switcher is shipped and you approved it.

## Currently working on

Nothing. The feature is done.

## Phases

| Phase | Status | Changed |
| --- | --- | --- |
| 0 Setup | done | 2026-09-30 19:20 |
| 1 Crucible | done | 2026-09-30 19:51 |
| 2 Brief | done | 2026-09-30 19:51 |
| 3 Architecture | done | 2026-09-30 19:51 |
| 4 Plan | done | 2026-09-30 19:51 |
| 5 Human review | waived, Ken reviews the implementation | 2026-09-30 19:20 |
| 6 Implement | done | 2026-09-30 20:35 |
| 7 Verify | done | 2026-09-30 21:20 |
| 8 Ship and land | done: merged in PR 26, rail button in PR 28 | 2026-10-06 19:16 |
| 9 Cleanup | done: worktrees, branches and the test helper removed | 2026-10-06 19:16 |

## The record

### Task index

- Task 0.1, register the new files: done by the orchestrator, 2026-09-30 19:51. Unit gate 2275 pass, 0 fail.
- Service (Tasks 1.1 to 1.3): returned and merged 2026-09-30 20:10. 69 new tests, gate:unit 2344 pass, 0 fail. All six paid styles pass the stylesheet check. Detail: [service](progress/phase6_workstream_service.md). Dispatched 2026-09-30 19:51.
- Docs (Task 1.4): returned and merged 2026-09-30 20:21. Skill line, `docs/ongoing/STYLES.md`, vendor README.
- Rail (Tasks 2.1, 2.2): returned and merged 2026-09-30 20:21. 16 of 16 Chromium specs; the Markdown end-to-end spec runs after the service fixes. Screenshots in `progress/screens/`. Detail: [rail](progress/phase6_workstream_rail.md). Dispatched 2026-09-30 19:51.

### Passes

- Pass 6, 2026-09-30 21:20: rail fix round 2 merged (going back leaves no empty block, the reading position holds in long tables, the waiting line for going back, the style's name from the first frame on reload); switcher specs 132 of 132 across Chromium, Firefox and WebKit; gate:unit 2394 pass, 0 fail.
- Pass 5, 2026-09-30 20:58: rail fix round 1 merged (a style removed mid-preview is honest, no flash between picks, latest pick wins, boot waits for a restored preview, waiting-end tests, font proof, wording); V24 accepts WebKit's unquoted family; bundle rebuilt.
- Pass 4, 2026-09-30 20:35: Task 2.3 (the contract instruction) and the integration round merged; the rail uses the shared rules; specs run against the real server (style_switcher 16/16, keep 1/1, comments and rail menu 16/16, Chromium); gate:unit 2389 pass, 0 fail; bundle rebuilt.
- Pass 3, 2026-09-30 20:35: service fix round 1 merged (the UTF-16 blocker and the data: SVG check fixed, 24 new tests); planned marks removed; gate:unit 2387 pass, 0 fail.
- Pass 2, 2026-09-30 20:21: docs and rail merged into `feat/style-switcher`; gate:unit 2363 pass, 0 fail.
- Pass 1, 2026-09-30 20:10: service merged into `feat/style-switcher`; gate:unit 2344 pass, 0 fail.

### Changes from plan

- The rail branch merged into the feature branch before pull request A reached main. Main's gate is red on an unrelated free-writing test, so A could not land first. The feature may ship as one pull request.
- `style_switch.js` restore runs from `index.js`, not `sync.js` (the scroll restore lives there).
- The style id, colour and name rules move to `src/shared/style_rules.js`, a new planned file, so the service and the rail spell them once.

### Follow-ups

- PR 22 (comment boxes open in the corner since 2026-08-23), found by the rail builder, shipped on its own.

### Cleanup queue

Nothing queued.

### Test results

- 2026-09-30 20:35: `npm run gate:unit` on `9af2c71`: 2391 tests, 2389 pass, 0 fail, 2 todo.
- 2026-09-30 20:58: `npm run gate:all` on `9af2c71`: 2325 passed, 7 failed, 23 skipped, 3 did not run (23.0 min). Failures: free-writing click-outside in all three browsers (already failing on main, on the board); install walk in all three (refuses to run where npm install has been run, an environment check, not code); V24 in WebKit only (WebKit writes the font family without quotes; the test now accepts both).
- 2026-09-30 20:58: after the rail fix round and the V24 fix, the switcher specs plus comments and rail menu: Chromium 25 of 25, Firefox and WebKit 82 of 82. gate:unit 2390 pass, 0 fail.

### Ship

- 2026-09-30 21:20: pull request 23 opened, https://github.com/kenxle/live-agentic-html-editor/pull/23. Waiting on Ken's approval.

## Log

- 2026-10-02. Polish from Ken's first use ("it should probably just be a button at the top by itself that toggles or opens a dropdown"). Document style is now its own swatch button in the rail's head, left of the "..." menu, and no longer a menu item. A click opens a dropdown under the head with the same contents as the old panel. The button again, Esc, Close, or a click anywhere else closes it. The collapsed status line is gone: while a preview is on, a small accent dot on the button says so, and hovering the button names the style. A style removed under a preview gets a warn dot, and closing the dropdown after reading its line dismisses it. Every switcher spec passes on Chromium with the button, plus new tests for the button itself.

  ![The rail's head with the style button, light](progress/screens/button/head_light.png)

  ![The dropdown open while previewing Sample](progress/screens/button/dropdown_previewing_light.png)

  ![Closed while previewing: the dot on the button](progress/screens/button/closed_previewing_light.png)

  ![The dropdown open while previewing Sample Dark](progress/screens/button/dropdown_previewing_dark.png)

  ![Closed while previewing, dark](progress/screens/button/closed_previewing_dark.png)

  Also in `progress/screens/button/`: `head_dark.png`, `focus_ring_light.png` and `removed_closed_light.png`.

- 2026-09-30 21:20. Flow walk with all six real paid styles passed end to end. It found: going back left an empty frontmatter block (fixed), the reading position drifting in long tables (fixed), the waiting line for going back (fixed), the raw id on reload (fixed), and three style-file problems (Field Guide under the rail; Folio and Ledger mis-laying the opening section), logged on Ken's personal board. Known limit: a reload while previewing shows the house style for about 40 ms.
- 2026-09-30 20:35. Final code review: no bugs in the layer; two test gaps (latest pick wins, waiting ends on every reply kind) and a one-frame flash of the house style between picks. Independent spec check: all 13 requirements met in code; one honesty gap (a style removed during a live preview still reads as previewing and offers Ask), V20 (the real-styles walk) not done yet, the progress page was stale. All sent to the rail builder as one round; V20 goes to the flow walker.

  What the panel looks like now, light and dark:

  ![The Document style panel previewing Sample, light](progress/screens/panel_open_previewing_light.png)

  ![The Document style panel previewing Sample Dark](progress/screens/panel_open_previewing_dark.png)

- 2026-09-30 20:21. Security review: one blocker (a UTF-16 stylesheet hides an outside fetch from the check; reproduced in all three browsers) and a weaker data: SVG check. Code review: the same encoding hole, plus smaller fixes. All sent back to the service builder as one round. Rail returned with 12 screenshots; light and dark previews look right.
- 2026-09-30 19:51. Documents done: crucible, brief, architecture, plan, with PM, security, architect, plan and design reviews integrated. Main calls: a click previews only; a second button asks the agent to keep the style in the page's source. Styles install with `lahe style add` into Lahe's state folder. The switcher shows only on pages that use the house style. PR 21 (the component catalog) is merged into this branch, since its own merge to main waits on an unrelated failing test on main.
- 2026-09-30 19:20. Ken asked for the style switcher in the document rail, designed in without stopping for his approval. He will review the implementation.
