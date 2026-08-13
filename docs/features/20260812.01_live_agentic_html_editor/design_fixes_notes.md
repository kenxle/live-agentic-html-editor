# 4B design fixes: the rail made shippable

Answers the 4A design review (`4a_design_review.md`, F1-F13) and the acceptance
scorecard's RED 1 (a handled item keeps its highlight). Every finding was
reproduced in the reviewer's own driver first, fixed, and re-photographed.

**After-screenshots:**
`/private/tmp/claude-501/-Users-kennethstclair-Documents-workspace-steady-thread/de40dd25-653f-4221-9145-33d2c0d7b7d1/scratchpad/design_fix_after/`
Same filenames as the reviewer's `design_eval/`, so any pair opens side by side.
Two are new: `16_dark_page_question.png` and `17_dark_page_whole.png`, because
after F6 the old `_dark` twins no longer show a dark rail (that is the fix), and
a dark rail now needs a dark PAGE to appear at all.

---

## The root cause behind three blockers

F1, F2 and half of F5 were one bug wearing three faces. `PANEL_STYLE` in
`tab_active.js` is added to the library's outer surface, and the rail lives in a
**second, closed shadow root inside it**. Nothing added to the outer surface can
reach a hosted row. The hosted path added no stylesheet at all, so every
`.lahe-rail-*` element in the rail was a class name with nothing behind it.

Green specs never saw it, because "the class is on the node" was true the entire
time it was broken. The new spec asserts **computed style**, which is the only
assertion that would have failed.

---

## Per finding

| # | What changed | Where | Test |
| --- | --- | --- | --- |
| **F1** blocker | The hosted path installs its own stylesheet into the rail's closed root (3A's `ensureStyle` pattern). The prose hint wall is gone; the gestures are keycaps behind an "All shortcuts" disclosure, closed by default | `tab_active.js` (`HOSTED_STYLE`, `ensureHostedStyle`, `hintList`) | `rail_design.spec.js` "the hosted pane has its own styles installed" |
| **F2** blocker | Reword/Delete are the rail's own quiet card actions in a spaced row, and are not drawn on a handled card | `overlay.js` (`.cardacts`/`.cardact` register), `tab_active.js` | same spec: gap, padding, labels |
| **F3** important | One hint system, the keycaps. All eight gestures still render from the one gesture table (R43), behind the disclosure instead of above the footer's own hints | `tab_active.js` | same spec: `hintsBehindDisclosure`, `hintsHidden` |
| **F4** blocker | The conflict card designed and **pickable**: title, two labelled panes with a rule each (the reviewer's in the accent), the differing run marked on both sides, and two real buttons | `replay.js` (`CONFLICT_STYLE`, `writeSide`, `decideNode`, `resolveConflict`), `editing.js` (`retire`), `index.js` | three specs: keep-mine, take-the-page's, and the comparison |
| **F5** blocker | One carrier per fact. The rail's `.agent` block keeps the agent's sentence and the files; the Done row keeps the reviewer's words and Reopen; the Active row is not drawn on a handled card | `tab_done.js`, `overlay.js` (card `data-state`) | `rail_design.spec.js` "says ... once each" |
| **F6** important | **The page picks the scheme, not the OS.** `highlight.js` samples the page's effective background luminance at mount and on every remount and stamps `data-lahe-scheme` on the host; every `@media (prefers-color-scheme:dark)` in the library became `:host([data-lahe-scheme='dark'])`. OS preference is the tiebreak when the page is transparent | `highlight.js`, `overlay.js`, `comments.js`, `editing.js`, `tab_active.js`, `tab_done.js`, `index.js` | `16_dark_page_question.png` (OS light, page dark, rail dark) and the whole `_dark` set (OS dark, page light, rail light) |
| **F7** important | The limit note renders only in the state it describes (`kept_locally` or no status), and lost its now-redundant "With no helper running" prefix | `overlay.js` `renderStatus` | `rail_second_window.spec.js` still green (it reads the note, not the render) |
| **F8** important | The page-side marks moved onto the accent: highlight wash, active wash, pick outline and fill, the box's quote rule, the box's focus ring. Amber now means one thing | `highlight.js` `STYLE_TEXT`, `comments.js` | `14b_pick_mode.png`, `15_whole_page.png` |
| **F9** minor | The comment box prefers the gutter between the **content column** and the rail, falls back to below, and nudges off a live edit bar | `comments.js` `positionAt`, `columnEdge`, `nudgeOffEditBar` | `11_edit_frame.png`, `15_whole_page.png` |
| **F10** minor | `resize:none` on the note box and on the floating comment box | `tab_active.js`, `comments.js` | same spec: `noteResize` |
| **F11** minor | Dark `--accent-wash` raised .14 -> .22, plus a hairline top/bottom on the question block in dark only | `overlay.js`, `tab_done.js` | `16_dark_page_question.png` |
| **F12** minor | The Edits export button matches the card-action scale, and its label shortened | `tab_edits.js` | `12_edits_tab.png` |
| **F13** minor | The pill's count is hidden at zero | `overlay.js` `renderTabs` | `02b_pill.png` |
| **RED 1** | **A handled item loses its highlight** (R37 / AC3). `comments.unpaint(id)` on retire, `comments.repaint(id)` on reopen with the anchor resolved against the page as it is NOW. `tab_done.js` says when; it never paints | `comments.js`, `tab_done.js` | `ac3_walk.spec.js` "the handled item loses its highlight" — **`test.fail()` marker removed**, and a reopen-repaints assertion added |

---

## Two places I went past the review, and why

**F4's title.** The review asked for two labelled panes and two buttons. Once the
buttons landed, the block's heading ("The page changed under this edit. Nothing
was written.") and the card's own amber badge ("This region is neither what you
edited nor what you changed it to, so nothing was written. Your text is kept.")
were two sentences for one fact on one card, which is F5's complaint appearing
somewhere new. The badge is the better statement of what happened, so the block
took the decision's own words instead: **"Which version stands?"** Two specs
pinned the old string; both now read `CONFLICT_TITLE` off the module rather than
re-typing design copy.

**F12's label.** The review said "the label can lose 'the edit list'". Shortening
it to plain "Export" put two buttons named exactly Export in one rail, and
`copy_export.spec.js` and `ac1_walk.spec.js` both went red because their
"click the rail button labelled Export" helper started clicking the wrong one.
That is a real product defect, not a test artifact. The label is **"Export
edits"**; the size complaint is fixed by the CSS, which is what it was about.

## One thing I did not do

The review's F2 suggested the outlined `.lahe-done-reopen` treatment for
Reword/Delete. Reopen is the one action on a finished card and earns an outline;
Reword and Delete sit under the reviewer's own sentence on **every** card, and
outlining both on every card puts two boxes on every card in the pane, which is
the "your eye lands on it second" complaint rebuilt in a nicer typeface. They
share Reopen's register (11.5px, 550, ink-soft, same radius and padding) and
take its border on hover and focus. Same system, one step quieter.

## New seams, both minimal and commented

- `editing.retire(itemId)` — drops one record and leaves the page alone. What
  `undo` ends with, minus the write. `undo` would restore `before`, which in a
  collision is neither version.
- `replay.context.editing` — used for exactly one thing, the "take the page's"
  button. A missing one costs that button and nothing else.
- `comments.unpaint(id)` / `comments.repaint(id)` — R37's page half. A pair, both
  in the file that owns the paint.
- `highlight.pageScheme()` / `highlight.refreshScheme()`, `overlay.refreshScheme()`.

## Cleanup needed

Nothing under `src/` or `docs/` was deleted. All outside the repo except the last:

- `…/scratchpad/shots.js` — the reviewer's driver (their own cleanup list already names it)
- `…/scratchpad/shots_after.js` — the same driver retargeted at this worktree
- `…/scratchpad/darkpage.js` — the dark-page driver for F6/F11
- `…/scratchpad/probe.spec.js` — a one-off DOM probe
- `…/scratchpad/basecheck/` — a shared clone at the base commit, used to confirm
  the `copy_export` failure was mine and not pre-existing
- `…/scratchpad/design_eval/` and `…/scratchpad/design_fix_after/` — the before
  and after screenshots, once these have been reviewed
- `test-results/` in the worktree — Playwright trace artifacts

One deletion already happened: `test/browser/zz_probe.spec.js`, a scratch spec I
wrote and removed in the same pass. It was never committed.
