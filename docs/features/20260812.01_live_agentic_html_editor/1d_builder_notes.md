# 1D builder notes: comments, gestures, and highlights

Branch `task/1d`, worktree `../lahe-worktrees/1d`. Nothing pushed, nothing merged, `dist/` never staged.

## What landed

| File | State | What it is |
| --- | --- | --- |
| `src/layer/highlight.js` | NEW | The Custom Highlight API registration, the one marked page-level stylesheet, and the library's one closed shadow surface |
| `src/layer/tab_active.js` | NEW | Active tab contents: outstanding items newest first, the note box at the foot, the gesture hint lines, the collapsed pill |
| `src/layer/comments.js` | Reworked from 0A-kernel's minimal box | Comment boxes, element-pick mode, the untethered note, the gesture wiring |
| `src/shared/manifest.js` | Two `planned: true` flags flipped off | The one pre-authorized edit to the frozen file |
| `test/browser/comments_highlights.spec.js` | NEW | Ranked test 18 plus the comment, pick, note, reword, delete, and hint-line behavior |
| `test/unit/comments_surface.test.js` | NEW | The Node-side half: the record a box mints, the revision rule, the deferred note, the two strings that must not drift |

### The surface, in one paragraph

`comments.createComments({reviewId, page})` then `.bind()` wires the three
listeners (keydown, mousemove, click) through the listener registry, in the group
`"comments"`, so a remount can drop them by group. Every decision comes from
`gestures.gestureFor`; this file never tests a key code of its own.
`tabActive.createActiveTab({comments}).mount()` draws the tab contents. Both live
inside one closed shadow root, whose host is the only element the library puts in
the page.

### The three ways a comment starts

- **Cmd-Shift-C with a selection**: a box opens already focused on that passage,
  the passage is painted, and the record carries `context.quote` plus a minted
  `region.ref`.
- **Cmd-Shift-C with nothing selected**: element-pick mode. Hovering outlines the
  element under the pointer, clicking comments on the whole thing,
  Esc cancels. The outline is a rectangle drawn in the shadow root over the
  element's bounding box, never a style on the element, which is what keeps
  ranked test 18's geometry assertion true during picking.
- **The box at the foot of the thread**: a note tied to nothing. Kind `note`,
  no range, no anchor, `region.ref` stays null.

### The one deliberate departure from 0A-kernel's box

0A-kernel's box mints its record the moment the box exists. That is right for a
box the reviewer opened, and wrong for the note box standing open at the foot of
the rail all session: it would put an empty note in the rail, in `review.json`,
and in the agent's queue on every page load. So `openNote` defers the mint to the
first keystroke. Everything else is unchanged: the first keystroke is still
synchronous to storage before anything else happens, and no other box defers.

## Ranked test 18, and the failure I had to demonstrate

The test runs at two widths (1280, 900) with the rail open and collapsed, four
runs, each holding both halves:

- **Negative half**: `scrollHeight` and every block's rect identical between a
  page with the library and a page without; `document.styleSheets` differs by
  exactly one, and that one is the marked highlight sheet whose every rule
  matches `^::highlight\(lahe-`; no element carrying a library marker exists in
  the page outside the shadow host and that stylesheet; and the screenshot
  clipped to everything left of the rail's bounds is byte-identical, with the
  commented paragraph masked in both pages (D8 allows exactly two visible
  additions, painted highlights and the fixed rail).
- **Positive half, same test**: the shadow host exists AND the rail reports a
  non-zero width, a highlight is painted (read from `CSS.highlights`, not from
  the library's own bookkeeping), and a record exists in the store.

### The demonstrated failure

One line in `highlight.js`, wrapping the range instead of painting it:

```diff
       var which = NAMES.indexOf(name) === -1 ? NAME.COMMENT : name;
+      range.surroundContents(markers.markWrap(doc.createElement("mark"))); // DELIBERATE REVERT
       ensureStylesheet();
```

**First attempt: ranked test 18 still passed.** That is the finding worth
recording. My geometry helper excluded library nodes *by marker*, and a wrapper
the library inserts inside reviewed content carries a marker too, so the filter
hid exactly the failure the test exists to catch. The pixel half missed it as
well, because the wrapper was inside the masked paragraph. Only the small
`#reset-intro *` assertion in the first test caught it:

```
  > 206 |     expect(wrappers).toBe(0);
    Expected: 0
    Received: 2
```

Fixed by excluding **by id** (`#lahe-surface-root`) rather than by marker, and by
adding an explicit "the library put nothing inside the page" assertion. With that
in place, the same one-line revert fails all four ranked-18 runs:

```
  1) the page renders identically with and without the library at 1280px, rail open
    Error: expect(received).toEqual(expected) // deep equality
    - Expected  -  0
    + Received  + 16
    +     "h": 43.59,
    +     "id": null,
    +     "tag": "MARK",
    +     "w": 723.66,
    +     "x": 272,
    +     "y": 60.59,
      370 |           const layerGeometry = await pageGeometry(layerPage);
      371 |           expect(layerGeometry.scrollHeight).toBe(bareGeometry.scrollHeight);
    > 372 |           expect(layerGeometry.blocks).toEqual(bareGeometry.blocks);

  5 failed
  3 passed
```

The revert was then reverted; the file in the branch is the Highlight API version.

### One more thing the pixel half caught

The first passing implementation still failed the screenshot diff, at every
width, in bands with nothing in them. The cause was the rail's `box-shadow`,
which paints ~44px to the LEFT of the rail's border box, so "clip to everything
left of `bounds().left`" was including 44 columns of shadow. `bounds()` now
reports the rail's **visual** bounds, shadow reach included, with the reach
constant kept beside the CSS that produces it.

## Gate

`npm run gate:builder`, run synchronously in this worktree:

```
lint passed (syntax: 100 files, no jsdom, manifest complete)
# tests 254
# pass 254
# fail 0
# duration_ms 1305.265292
  58 passed (17.4s)
```

(246 unit tests before this task, 254 after; 50 browser tests before, 58 after.)

## Verified with my own eyes

Rendered the real surface on `test/fixtures/css-reset.html` in Chromium and
looked at three states: a comment box open on a selected passage, element-pick
mode hovering a paragraph, and the rail collapsed to its pill. Two things were
wrong on screen and are fixed: the pick outline painted **over** the rail
(z-index), and the note box's label and placeholder said the same sentence twice.
The screenshots are in the session scratchpad; they are not committed.

## Cross-task API needs, for the orchestrator

1. **1B (overlay.js): a way to attach a card's node.** `upsertCard` tracks a card
   but its `node` is always null and there is no setter, so `tab_active.js` keeps
   the rail's model in sync (`upsertCard`, `setCardState`, `removeCard`) while
   rendering its own row nodes. Nothing is broken by that today, but
   `holdsFocus(id)` can never be true for a card the rail does not hold a node
   for, which is the guard that stops a focused card being removed. Suggested:
   `overlay.attachCardNode(id, node)`, or a `cardBody(id)` slot the tab files
   render into.
2. **1B: pass a host into `createActiveTab({host})`.** Until then `mount()` draws
   its own panel inside the library's shadow surface. That fallback exists so 1D
   is scoreable alone; when 1B's rail lands, pass the tab-body node as `host` and
   the fallback is never built. `PANEL_STYLE` and the shadow-reach constants move
   with the panel if 1B takes over the chrome.
3. **1B: the surface host is 1D's, in `highlight.js`.** It is a chrome-marked div
   with a **closed** shadow root, id `lahe-surface-root`. A closed root cannot be
   read back off the element, so 1B should call `highlight.shared.surface()`
   rather than creating a second host, or tell me to hand the host over. Related:
   `markers.OVERLAY_ROOT_ID` is `lahe-overlay-root` and nothing creates it yet.
   One of the two ids should win before CP1.
4. **1B (store.js): no API change needed.** 1D uses `read`, `write`, `readItem`,
   `remove` as committed. If the rework changes `write`'s signature, the three
   call sites in `comments.js` are the only ones to update.
5. **1C (anchor.js): `mint` is called with `{element, range, root}`.** For a
   selection, `element` is the block containing the selection's common ancestor
   and `range` is the reviewer's own range; for an element pick, `range` is the
   element's contents. The stub's probe (normalized `element.textContent`) is
   what ranked test 18's sibling test asserts on, so the real engine keeping a
   `probe` field of the region's normalized text keeps that test honest.
6. **2D (index.js/inject.js): boot order.** `comments.bind()` registers in the
   listener group `"comments"`; a remount should call `offGroup("comments")` (or
   `comments.unbind()`) before re-binding. `comments.teardown()` removes the
   listeners, the boxes, the highlights, and the page-level stylesheet.

## Cleanup needed

Nothing was deleted. For the Phase 4B batch:

- `test/unit/consumer_1d_comments.test.js` — 0A-kernel's throwaway stub consumer
  for this task. It still passes against the real surface (I kept every signature
  it calls), and it is superseded by `test/unit/comments_surface.test.js`.
- `test-results/` — Playwright's failure artifacts from the runs above,
  gitignored, in the worktree only.
