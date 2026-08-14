# feat-menu: the head's actions menu, card state colors, and the long file path

Branch `task/feat-menu`. Files touched: `src/layer/overlay.js`, the architecture doc's D10
revision, `test/browser/rail_menu.spec.js` (new), `test/browser/rail_design.spec.js`,
`test/browser/copy_export.spec.js`, `test/browser/ac1_walk.spec.js`.

## 1. Copy and Export moved into a header menu

Ken, from real use: the two buttons read as submit buttons sitting under his own words, and he
does not use them often enough to earn permanent space.

Design calls:

- The button is the collapse arrow's twin: same `.iconbtn` class, same 26x26 hit area, same quiet
  ink, placed immediately to its left so the corner control does not move. Glyph is a horizontal
  ellipsis, `aria-label` and `title` both "More actions", `aria-haspopup="menu"`, and
  `aria-expanded` tracking the state.
- The menu is a small anchored card under the button: the rail's own paper, line, radius and
  shadow, one item per row, 172px minimum. Items are "Copy review" and "Export review", named that
  way because they are review-level and the Edits tab has its own per-tab "Export edits".
- The action seam did not move. Each item calls `runAction("copy" | "export")`, exactly what the
  footer buttons called, so `index.js`'s `rail.onAction(...)` wiring and `export.js` needed zero
  changes.
- The footer lost the two buttons and the `.actions` / `.btn` rules with them. The chips, the
  refusal panel, the status line and the keycap hints stay where they were.
- Closing: choosing an item, Esc (focus goes back to the button), a click anywhere outside the
  menu on the page or in the rail, collapsing the rail, unmounting, and a remount.
- Keyboard: the button is a real button, so Enter and Space open it. Arrow down or up opens the
  menu on the first or last item, the arrows move within it, Home and End jump, Tab closes.

The one real trap, recorded because it cost the most time here: **a CLOSED shadow root hides its own
nodes from `composedPath()`**. The first version had a single document-level capture listener that
closed the menu whenever the path did not contain the menu. A click on a menu item arrives at the
document retargeted to the host, so that listener closed the menu before the item's own click
handler ran, and Export silently did nothing while every other menu test passed. The fix is two
listeners: one inside the shadow root (which sees real targets, and decides for everything in the
rail) and one on the document that first walks the chain of shadow hosts outwards before deciding
the event really came from the page.

`rail.menuInfo()` is the self-report a closed root needs: presence, label, open state, focused
index, and the on-screen rectangles of the button and every item. The specs click a real mouse at
those coordinates, the way the takeover walk clicks the refusal button.

## 2. The card's state is a color again

Ken: unsubmitted comments were yellow and submitted ones green in the module this replaces, and he
misses reading the list without reading the chips.

- `draft` wears the rail's needs-you amber, which is the same vocabulary the warning chips use, and
  an unsubmitted comment is exactly a thing that needs him.
- `ready` wears green.
- Both are washes a few points off the card's own paper (`--draft-wash` / `--ready-wash` plus a
  matching border token), not fills. The reviewer's sentence stays the strongest thing on the card
  and the state chip stays where it was.
- Dark derives its own values the way every other dark token here does: the dark paper with the hue
  mixed in, not the light tint carried over.
- **The two greens do not collide.** A handled card keeps plain paper and its outlined green chip;
  ready wears the wash with a neutral chip. They also live in different panes. Checked on screen in
  both schemes.
- The wash follows `setCardState` through the existing repaint path: the spec asserts the node is
  the same node before and after, so nothing rebuilds.

## 3. The Done tab's file paths stopped overflowing

Reply file paths were joined with two spaces into one line that could not break, so a long
repo-relative path ran out of the card. Now each path renders on its own line inside
`.agent__files`, with `overflow-wrap:anywhere`, because a path is a unit the reviewer scans and it
has no natural break points. Asserted with geometry: the card's `scrollWidth` stays within its
`clientWidth`, and the file list's box stays inside the card and the pane.

## Verification

- Gate: `npm run gate:builder` green (lint, 153 files; unit; 171 browser specs on chromium).
- Three lanes (`LAHE_ALL_BROWSERS=1`) on `copy_export`, `rail_menu`, `rail_focus`, `rail_design`:
  45 passed.
- My own click-through in a real browser, light and dark: the closed head, the open menu, a real
  menu click producing a real download (`exporter.last().ok === true`), the draft and ready cards
  side by side in both schemes, and a handled card carrying a 90-character path.

## Note for whoever merges

`dist/lahe-layer.js` was rebuilt locally to run the browser specs and is deliberately NOT committed.
