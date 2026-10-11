# Zoom into graphs and images

**Status, 2026-10-11 09:51 EDT:** done. All three PRs are merged and the cleanup is finished.

## Needs your attention

Nothing.

## Progress

| Step | State |
|---|---|
| Cleanup | done: three worktrees, their branches, the preview pages |
| Your three calls | done: hover button, every page, graphs plus large images |
| Spec | done, now on main in `docs/features/20261007.01_zoom_viewer/` |
| Build, tests first | done: 22 browser tests, 13 unit tests |
| Code review | done: 4 problems found and fixed. Links inside a diagram could leave the page. The edit shortcut opened editing behind the viewer. Small icons got a button. "Actual size" was wrong for some graphs. |
| Check on a real page | done: the button hid under the open rail and could sit off-screen on a tall graph. Fixed, so it now sits on the part of the graph you can see. |
| Full test run | passed: unit 2443 pass, 0 fail; browser 827 passed, 0 failed. The run left 108 test helpers behind, the known leak, and I stopped them. |
| Other PRs from today | [#32](https://github.com/kenxle/live-agentic-html-editor/pull/32) Delete on a bullet, and [#33](https://github.com/kenxle/live-agentic-html-editor/pull/33) a `.md` beside a reviewed page gets the rail: both merged, with CI passing on each |
| PR | [#34](https://github.com/kenxle/live-agentic-html-editor/pull/34) merged. The local gate passed (unit 2450 pass, browser 836 passed, 0 failed) and CI passed |

## The proposal

Yes, this can be built. Today a big Mermaid diagram is shrunk to fit the page width, so its labels get tiny. Nothing in LAHE lets you enlarge it.

## Decided

1. **How you open the zoom view. Decided: the hover button.** My recommendation was **a small magnifier button that appears in the corner when you hover a graph or image**. Clicking the image itself is the other option, but on a real app page an image is often a link or a button. A click there should do what the page means it to do. The corner button never gets in the way, and it also stays clear of pick mode, where clicking a picture starts a comment on it.
2. **Where it works. Decided: all pages.** My recommendation was **every page with the review rail on it**: Markdown documents, built documents, and app pages. Limiting it to Markdown documents is simpler, but graphs show up in built reports too.
3. **Which things get the button. Decided: as recommended.** My recommendation was **every graph (any diagram drawn as SVG, which includes all Mermaid) and any image shown smaller than its real size, or larger than about 300 pixels on screen**. Small icons and logos get no button.

## What you would see

- Hover a graph: a magnifier button fades in at its top right corner.
- Click it: the graph opens full screen on a dimmed background, fitted to the window.
- Scroll or pinch to zoom. It zooms toward wherever your pointer is.
- Drag to move around.
- Small controls in a corner: zoom in, zoom out, fit to window, actual size.
- Esc, the close button, or a click on the dimmed area closes it, and you are back where you were on the page.
- Graphs stay sharp at any zoom, because the viewer redraws the diagram itself rather than enlarging a picture of it.

## Not in this round

- Leaving a comment from inside the zoom view. You close it and comment on the page as you do today. This could come later.
- Zoom for tables or code blocks.

## How it gets built

One new piece of the review layer, with no new outside code. The zooming and dragging are written in-house, which keeps LAHE install-free. I'd treat it as a small feature: a spec page for you, one design review, the build with browser tests, a code review, and a PR with screenshots in light and dark.

All three calls are made.
