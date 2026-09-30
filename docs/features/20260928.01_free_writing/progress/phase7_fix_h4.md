# Phase 7, fix H4: the menu-opens-upward test

Verdict: the test set-up was wrong. The product is right. Test-only fix.

## Why

- `openMenu` in `src/layer/editing.js` compares the bar's bottom plus the menu height to `win.innerHeight`. That is the window, not the page or the added room. The rule holds.
- After the bottom-room change (h2), the layer scrolls the caret up and puts the bar at the top of the window when the caret's line would sit under it. In the test the bar was at y=4 with 194px of menu and plenty of room below, so the menu correctly opened downward.
- The test scrolled the list to the window's bottom edge and assumed the bar would sit there. It no longer does.

## Fix

In `test/browser/free_writing_types.spec.js`, after the edit opens, scroll so the frame's bottom is about 240px down the 420px window. The bar then sits under the frame, low in the window, with less room than the menu needs. The test now also asserts the bar is below y=200, so it cannot pass by accident with the bar at the top. The upward assertions are unchanged.

## Results

- `free_writing_types.spec.js` and `free_writing_bottom_room.spec.js`: 57 passed in each of Chromium, Firefox, WebKit.
- `npm run gate:unit`: 1797 passed, 0 failed.

## Commands

```
node scripts/build-layer.js
npx playwright test test/browser/free_writing_types.spec.js test/browser/free_writing_bottom_room.spec.js --project=chromium   (then firefox, webkit)
npm run gate:unit
```

## Cleanup needed

- `node_modules` symlink in this worktree (not committed).
- `test-results/` folders from the Playwright runs.
- `/tmp/x.bak`, a backup of the spec (under /tmp, OS-owned).
- Local rebuild of `dist/lahe-layer.js`: restore with `git checkout -- dist/lahe-layer.js`.
