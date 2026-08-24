# 4A design review: the rail, judged as a shipping surface

A staff-designer pass over the built library, driven in a real Chromium against 0C's app
fixture with 1A's helper running and a real minted token. Every state below was reached by
the real APIs (real gestures for comments and edits, `doneTab().applyReplies` for agent
answers, a real branch-four collision for the conflict card), photographed in light and
dark, and looked at. Nothing here is reasoned from source alone; the code references are
where a finding's cause was confirmed after the screenshot showed it.

**One-sentence verdict.** The card system, the question treatment, and the Edits tab are
the work of someone with real taste and would ship as-is, but the rail is not one product
yet: an earlier standalone stylesheet is still rendering unstyled inside it, and the two
moments the reviewer most needs (the conflict, and a handled item) are the two that were
never designed, so this is close but not shippable.

**The signature.** The rail is remembered by the **question block**: the accent rule
running full-bleed down the card, the small-caps "CLAUDE IS ASKING" in accent ink, the one
step up in type size, and the Answer button. It is the only element in the rail with a
rule, it is the only place the accent fills a surface, and it earns that. Nothing else
competes with it, which is the right answer.

**Competing signatures, flagged.** Three, all of them accidents rather than choices: the
unstyled `.lahe-rail-*` block that arrives with its own borders, its own bullets and its
own hint list (F1, F2, F3); the amber that the page-side highlight and the pick outline
spend freely while the rail's own system reserves amber for "needs you" (F8); and the
conflict card, which draws in no system at all (F4).

---

## Findings

### F1 — blocker / defect — the Active tab's hint list is unstyled, and it is the loudest thing in an empty rail

**Where.** `src/layer/tab_active.js`, `hintList()` and `mountInRail()`; visible in
`01_empty_active.png` and `01_empty_active_dark.png`.

**What.** On first load, before the reviewer has done anything, the biggest, blackest,
tallest block in the rail is an eight-item list of keyboard hints rendered with no styles
at all: full-ink body text at the browser's default list size, clipped bullets running off
the left edge, and each item printing its key label glued to its sentence with no space
("Cmd-Shift-CSelect text and press Cmd-Shift-C to comment on it."). It occupies roughly
half the rail's height. In dark it is pure white and worse.

**Why.** `mountInRail()` builds the tab's footer with the `.lahe-rail-*` classes, but
`surfaceRoot()` returns the provided host early and therefore never calls
`highlights.addSurfaceStyle("tab_active", PANEL_STYLE)`. The stylesheet that would make
those class names mean something is only added on the standalone path. So every hosted
`.lahe-rail-*` element renders naked. This is the single worst thing in the product and it
is the first thing anyone sees.

**Fix.** Either add `PANEL_STYLE` (or a hosted subset of it) on the hosted path too, or
delete the tab's own hint list and footer chrome and let the rail's footer own both, since
the rail already draws a better version. The second is the right one: see F3.

### F2 — blocker / defect — "RewordDelete" on every card

**Where.** `src/layer/tab_active.js` `buildRow()`, the `.lahe-rail-rowfoot` with its two
`.lahe-rail-btn` children; visible on every card in `03_active_comments_draft_note.png`,
`04_question_card.png`, `10_done_tab.png` and their dark twins.

**What.** Under the reviewer's own words on every card sits the string `RewordDelete`: two
buttons with no gap, no border, no button register, run together into one nonsense word,
in the same ink and near the same size as the reviewer's sentence above them. It is on the
question card, it is on a handled card in Done where neither action makes sense, and it is
the thing your eye lands on second after the note.

**Why.** Same cause as F1: `.lahe-rail-btn` has a stylesheet that the hosted path never
installs.

**Fix.** Style these as the rail's own quiet text actions (the `.lahe-done-reopen` treatment
already in `tab_done.js` is the right register), give them a gap, and drop them from cards
in the Done pane.

### F3 — important / taste — two hint systems, and the good one is at the bottom

**Where.** The rail's own `.hints` in `overlay.js` (rendered keycaps: ⌘ ⇧ C comment) versus
`tab_active.js`'s eight-line prose list. Both are on screen at once in
`01_empty_active.png`.

**What.** The footer's keycap hints are exactly what D10 asked for: 11.5px real text,
rendered caps, readable at arm's length, three gestures. Immediately above them the Active
tab prints eight of the same facts as prose. The reviewer reads the rules twice, in two
registers, in one column.

**Fix.** One hint surface. Keep the footer's; delete the tab's. If the extra gestures
(element pick, Esc, "everything else is the page") are worth saying, they belong in the
empty state's sentence or behind the header's disclosure, not as a permanent wall.

### F4 — blocker / defect — the conflict card is undesigned, and neither version is pickable

**Where.** `src/layer/replay.js` `conflictNodeFor()` / `sideNode()`; no `[data-lahe-conflict*]`
selector exists anywhere in the rail's CSS. Visible in `13_conflict_card.png` and
`13_conflict_card_dark.png`.

**What.** The card that matters most in the whole product renders as five undifferentiated
paragraphs of the same 13.5px body text:

> The page changed under this edit. Nothing was written.
> Your version
> *(two lines of text)*
> On the page now
> *(two nearly identical lines of text)*

The two labels look exactly like the two bodies. The two versions are near-identical
sentences with the difference buried at the end of the second one, and nothing pairs a
label to its text, separates the pair from its neighbour, or marks where they diverge. D10
asks that both versions be genuinely readable and pickable: they are legible, they are not
readable as a comparison, and **there is no pick affordance at all** — no "keep mine", no
"take the page's", nothing to press. The reviewer is told a decision is theirs and given no
way to make it.

**Fix.** Give the conflict block the tab_edits row treatment it already deserves: two
labelled panes with the tab's own eyebrow type, a left rule per side (the reviewer's in the
accent, the page's in the neutral line colour), the differing run marked, and two buttons.
The tokens all exist; only the selectors are missing.

### F5 — blocker / defect — a handled card says the same three things twice each

**Where.** `src/layer/tab_done.js` `buildRow()` plus the still-attached `tab_active.js` row
plus the rail's own `.agent` carrier. Visible in `10_done_tab.png` and
`10_done_tab_dark.png`.

**What.** One handled card carries: the reviewer's note (from the Active row), then
`RewordDelete`, then the reviewer's note **again** (from `lahe-done-said`), then
"claude: Used the nine-check-in number…", then the two file paths, then Reopen, then a grey
`.agent` block repeating the **same** agent sentence and the **same** two file paths. Six
blocks, three facts. The card is twice as tall as it needs to be and reads as a bug.

**Why.** 3A's notes record fixing exactly this for questions ("it is said once") but the
same collision was left in place for `handled` and `not_handled`, and the Active row is
never withdrawn when an item moves to Done.

**Fix.** Pick one carrier per fact. The rail's `.agent` block is the good one; the Done
row should contribute only Reopen and the files, and the Active row should not be on a
card in the Done pane at all.

### F6 — important / risk — dark mode follows the OS, not the page it is sitting on

**Where.** `overlay.js:151`, and the same `@media (prefers-color-scheme:dark)` in
`comments.js`, `editing.js`, `tab_active.js`, `tab_done.js`. Visible in
`15_whole_page_dark.png`.

**What.** With the OS in dark mode and the reviewed page in light (the common case: the app
fixture, like most apps, ships no dark stylesheet), the rail becomes a black slab and the
floating comment box becomes a black card **on a white page**. The pill too. The thing the
whole product is trying to be — a tool sitting politely over a page that is not yours —
inverts into the loudest object on the screen.

**Why.** The rail reads the system preference, which is the right signal for a standalone
app and the wrong one for an overlay. The page's own background is the signal that matters.

**Fix.** Sample the host page's effective background at mount (and on remount) and pick the
palette from that, with the system preference only as the tiebreak when the page is
transparent or unreadable. Failing that, an explicit script-tag attribute.

### F7 — important / defect — the limit note is on screen permanently and is not true

**Where.** `overlay.js` `LIMIT_SEPARATE_STORAGE_NO_HELPER` and `setLimitNote`; visible in
every rail screenshot.

**What.** Two lines of grey text sit under the status line at all times: "With no helper
running, a second window in a separate browser profile cannot be detected." The helper
**was** running in every screenshot here, and the status line one row above says "Stored ·
agent reading". So the rail's most permanent sentence contradicts the line above it, and it
is the second-largest text block in the footer, competing with the status line D10 actually
asked for.

**Fix.** Show it only in the state it describes, and shorten it. A caveat that is always on
screen is a caveat nobody reads.

### F8 — important / taste — amber is spent on the page while the rail reserves it for trouble

**Where.** The comment highlight (`highlight.js`) and the pick-mode outline
(`comments.js`, `OUTLINE_CLASS`); visible in `15_whole_page.png` and `14b_pick_mode.png`.

**What.** The stated system is one indigo accent plus amber for anything that needs the
reviewer. On the page, every commented passage gets a full amber wash and pick mode draws a
saturated orange outline with an orange fill. Those are the two loudest colour moments
anywhere in the product, they both mean "this is fine, this is normal", and they sit inches
from a rail where the same amber means "something needs you". The page-side language and the
rail-side language disagree.

**Fix.** Move the page-side marks onto the accent (a low-alpha indigo wash for highlights, an
indigo outline for pick), and keep amber for the states the rail's own tokens already use it
for. The highlight will read as quieter and as more clearly *ours*.

### F9 — minor / taste — the floating comment box lands on top of what it is about

**Where.** `comments.js` box placement; visible in `15_whole_page.png` and
`11_edit_frame.png`.

**What.** The open box covers the paragraph under the one being commented on, and in
`11_edit_frame.png` it also overlaps the edit bar. The box itself is well made (quote rule,
placeholder, "Cmd-Enter when done with this comment", a quiet Draft marker) but it hides
the page while you write about the page, and two floating chromes can stack.

**Fix.** Prefer the gutter between the content column and the rail; fall back to below only
when there is no room. Nudge off any live edit bar.

### F10 — minor / defect — the note textarea shows the browser's resize grabber

**Where.** the untethered note box in `01_empty_active.png`, and the floating comment boxes.

**What.** A native diagonal resize handle sits in the bottom-right corner of the textarea.
`overlay.js` sets `resize:none` on `.card__body textarea`, but the note box is not in a
`.card__body`, so it keeps the default. It is the one place the rail looks like a form
control instead of a surface.

**Fix.** `resize:none` on the box's textarea too.

### F11 — minor / taste — the question block loses too much contrast in dark

**Where.** `--accent-wash: rgba(147,167,234,.14)` in dark; compare `04_question_card.png`
with `04_question_card_dark.png`.

**What.** In light, the question block is unmistakable: a filled indigo-tinted panel with a
rule. In dark, the wash is barely separable from the card, so the loudness rests almost
entirely on the 3px rule and the one type step. It is still the loudest thing, but the
margin is much thinner, and D10's promise is that a question cannot be scrolled past.

**Fix.** Raise the dark wash a few points, or add a hairline top/bottom to the block in dark
only. Same relationship, not the same alpha.

### F12 — minor / taste — the Edits tab's export bar is unbalanced

**Where.** `tab_edits.js` `BAR_CLASS`; visible in `12_edits_tab.png` and `01b_empty_edits.png`.

**What.** "3 hand edits" at 11.5px faint sits opposite "Export the edit list", a full-size
outlined button that is wider and heavier than anything else in the pane, including the
footer's own Copy. On the empty tab it is a large disabled button over the words "No hand
edits yet."

**Fix.** Match the footer's button scale, or make it a text action. The label can lose "the
edit list" — the tab already says Edits.

### F13 — minor / taste — the pill's count reads as noise at zero

**Where.** `.pill__count`; `02b_pill.png`.

**What.** The collapsed pill shows "Review 0" on an untouched page. The zero is the only
information and it is not information.

**Fix.** Hide the count at zero.

---

## What is genuinely good

Real praise, and none of it is padding.

- **The question treatment is the best thing here, and it does the hard version of the
  job.** Loud without a single alarm signal: no red, no icon, no badge, no border flash. It
  is loud because it is at the top of the pane, because it owns a rule, because it is one
  type step larger than anything else, and because it ends in a button you can press. 3A's
  decision to stop the rail's own carrier from repeating the same sentence is what makes it
  work, and you can see the difference on the not-handled card, where the quiet carrier is
  exactly right.
- **The card is a genuinely good object.** COMMENT eyebrow, state pill, quoted passage
  behind a hairline rule and clamped at two lines, the reviewer's own words below at the
  largest size in the rail. The ordering is right: the reviewer's words win the eye, the
  quote supports them, the chrome recedes. `:focus-within` on the whole card instead of a
  ring inside a ring is the correct call and it looks correct.
- **The state pills are properly quiet.** READY in accent wash, HANDLED as a green outline
  with no fill, NOT HANDLED in a low amber. Three states, three registers, none of them
  shouting. The green never becomes a success banner and the amber never becomes an error.
- **The Edits tab is the most finished pane in the product.** EDIT / FORMATTING / DELETION
  as eyebrows, the before struck through in faint ink, the after in full ink, the accent
  left rule only on a real edit, "added `<strong>`" in mono for formatting, and an italic
  "Deleted" where the after text would be. Three different kinds of change, legible at a
  glance, in one row shape. This is the standard the rest of the rail should be held to.
- **The keycap hints.** Real rendered caps with a bottom-weighted border, 11.5px, readable.
  D10 asked for hints that are not fine print and these are not fine print.
- **The pill.** Small, calm, one dot, one word, a real shadow. I would put this on a
  client's page without thinking twice — the only reason to hesitate is F6.
- **The edit frame and its bar.** "EDITING THIS BLOCK | B *I* Delete block | Esc to finish"
  is exactly the right amount of chrome: it names the state, gives three actions, and says
  how to leave. The frame's soft accent ring reads as *held*, not as *selected*.
- **Dark keeps the relationships instead of inverting them.** The card stays lighter than
  the pane behind it, so the pane reads as ground and the cards as paper, and the rail does
  not read as a stack of holes. That was called out as the trap in the builder notes and
  the trap was avoided.
- **The failure chip.** Full sentence, remedy on its own line in a softer ink, a small ×,
  low amber fill. It says what happened and what to do, and it does not look like an error.
- **The empty states of Edits and Done.** "No hand edits yet." centred in faint ink over an
  otherwise quiet pane. Correct restraint. (The Active tab's empty state is the exception,
  and that is F1.)

---

## Screenshots

All under
`/private/tmp/claude-501/-Users-kennethstclair-Documents-workspace-steady-thread/de40dd25-653f-4221-9145-33d2c0d7b7d1/scratchpad/design_eval/`.
Every file has a `_dark.png` twin captured under an emulated dark preference.

| File | What it shows |
| --- | --- |
| `01_empty_active.png` | The first thing a reviewer sees, and the unstyled eight-line hint wall that dominates it (F1, F3). |
| `01b_empty_edits.png` | The Edits tab with nothing in it: correct restraint, plus the oversized disabled export button (F12). |
| `01c_empty_done.png` | The Done tab empty. |
| `02_pill_full_page.png` | The collapsed pill in situ on the reviewed page. |
| `02b_pill.png` | The pill close up: calm, trustworthy, one count too many at zero (F13). |
| `03_active_comments_draft_note.png` | Three ready comments and a draft: the card system working, and `RewordDelete` on every one of them (F2). |
| `04_question_card.png` | The question treatment: pulled to the top, accent rule, eyebrow, one type step up, Answer button. The signature. |
| `05_not_handled.png` | A not-handled reason in the rail's quiet agent carrier, under a low-amber NOT HANDLED pill. |
| `06_status_kept_locally.png` | Status line, kept-locally: amber dot, plain sentence. |
| `07_failure_chip.png` | A dismissible failure chip with its remedy, above the status line. |
| `08_status_stored.png` | Status line, stored: green dot. |
| `09_status_agent_connected.png` | Status line, agent listening: accent dot, "Stored · agent reading". |
| `10_done_tab.png` | A handled item with its agent reply and Reopen, and the three-way duplication on one card (F5). |
| `11_edit_frame.png` | Cmd-Shift-E editing: the accent frame and the B / I / Delete block / Esc bar, with the comment box colliding into it (F9). |
| `12_edits_tab.png` | Edit, formatting-only and deletion rows plus the export bar: the most finished pane in the product. |
| `13_conflict_card.png` | Branch four, both versions "in full": five undifferentiated paragraphs and nothing to press (F4). |
| `14_pick_mode_full.png` | Element-pick mode over the whole page. |
| `14b_pick_mode.png` | The pick outline close up: saturated orange outline and fill (F8). |
| `15_whole_page.png` | The whole thing in situ. In light this reads as one product sitting politely over someone else's page; the dark twin is where F6 shows itself. |

## Cleanup needed

Nothing was deleted and nothing under `src/` was touched. Two scratch artifacts, both
outside the repo, for whoever runs the Phase 4B batch:

- `…/scratchpad/shots.js` — the driver that produced these screenshots.
- `…/scratchpad/design_eval/` — the screenshots themselves, once the fixes have landed.

---

# Verdict re-check, after the 4B fix pass

A second staff-designer pass over the merged branch (`feat/live_agentic_html_editor`, the
fix pass at `1d6dfba`). Method: read the fix notes, put every before screenshot next to its
after twin, then drive the four blocker states live myself in a fresh Chromium against the
same app fixture with a real helper and a real minted token, and look at the result. The
conflict card was reached through a real branch-four collision and **both** of its buttons
were pressed for real, in separate runs, with the page and the store read afterwards. The
scheme was checked in both directions with the OS preference set against the page on
purpose. Fresh screenshots are in `…/scratchpad/design_verify/` (`V*.png`).

## Per finding

**F1 — the Active tab's unstyled hint list — CONFIRMED FIXED.** The eight-line prose wall
is gone. What sits in an empty rail now is the empty-state sentence, a note box under a
small-caps `A NOTE ABOUT THE PAGE` eyebrow, and a single closed disclosure reading
"All shortcuts". Driven live, no `.lahe-rail-*` element in the pane renders naked: the
hosted stylesheet reaches the rail's own closed root, the keycaps compute to 10.5px with
their bottom-weighted border, and the empty pane's tallest object is now the note box
rather than a wall of black text. (`V01_empty_active.png`, and the same in dark.)

**F2 — "RewordDelete" on every card — CONFIRMED FIXED.** Two separate buttons reading
`Reword` and `Delete`, measured live at a 7px gap, 11.5px, weight 550, in soft ink
(`rgb(86,94,109)`) against the reviewer's own sentence in full ink above. They no longer
land second in the eye. (`V02_card_actions.png`.)

**F3 — two hint systems — CONFIRMED FIXED.** One hint surface. The footer's keycaps stay;
the tab's prose list moved behind the closed "All shortcuts" disclosure. Opening it live
still renders all eight gestures from the one gesture table, now as keycap plus sentence
rather than glued-together prose, so nothing was lost to fix the noise.
(`V01b_shortcuts_open.png`.)

**F4 — the undesigned, unpickable conflict card — CONFIRMED FIXED, and it is now one of the
better objects in the rail.** A hairline separates it from the edit row above. It opens
with the title "Which version stands?", then two labelled panes with eyebrow type and a
rule each, the reviewer's in the accent (`rgb(60,86,165)`) and the page's in the neutral
line colour, with the differing run marked on both sides. Both versions still print in
full; the mark points at the divergence rather than replacing it. Two real buttons.
Pressed live:

- **Keep mine** put the reviewer's sentence back on the page verbatim, cleared the
  collision, and kept the record. PASS.
- **Take the page's** left the page exactly as the agent wrote it, wrote nothing, cleared
  the collision, and retired both the record and the card. PASS.

(`V04_conflict_card.png`, `V04b_conflict_after_keep_mine.png`,
`V04b_conflict_after_take_theirs.png`.)

**F5 — a handled card saying three things twice each — CONFIRMED FIXED.** Six blocks became
three. Counted live in the card's own drawn text: the reviewer's note once, the agent's
sentence once, each file path once. Reword and Delete are not drawn on a handled card;
Reopen is. The card is roughly half its old height and reads as a finished item rather than
as a bug. (`V03_done_handled.png`.)

**RED 1 — a handled item keeping its highlight — CONFIRMED FIXED.** Read off
`highlights.paintedIds()` across the transition: painted before the fold, gone after the
item moved to Done, and back after pressing Reopen. The pair works in both directions.

**F6 — dark mode following the OS instead of the page — CONFIRMED FIXED.** The signal moved
to where it belongs. With the OS in **light** and the page painted dark, the rail comes out
dark (`pageScheme: "dark"`, `data-lahe-scheme="dark"`). With the OS in **dark** and the page
light, the rail comes out light. The old failure case, a black slab and a black comment box
on a white page, does not reproduce. (`V05_scheme_darkpage_oslight.png`,
`V05b_scheme_lightpage_osdark_whole.png`.)

**F7 — the permanent untrue limit note — CONFIRMED FIXED.** It renders under
"Kept in this browser" and is absent under both "Stored" and "Stored · agent reading", so it
no longer contradicts the line above it. The "With no helper running" prefix is gone.

**F8 — amber spent on the page — CONFIRMED FIXED.** The comment wash and the pick outline
and fill are both indigo now. Amber survives in the rail's own vocabulary and in the
conflict badge, which is where "needs you" actually lives. The highlight reads quieter and
more clearly like part of this tool. (Before/after `14b_pick_mode.png`, `15_whole_page.png`.)

**F9 — the comment box landing on what it is about — PARTIALLY FIXED.** The edit-bar half is
genuinely fixed: in `11_edit_frame.png` the box now sits clear above the bar instead of
overlapping it, and `nudgeOffEditBar` is real code doing real work. The gutter preference is
also real code, but on the reference page it never fires, because the content column runs
right up under the rail and leaves no gutter to prefer. So the fallback applies and the box
still covers the paragraph below the one being commented on, which is exactly the picture
the original finding objected to. Minor, and it was minor before; noting it so nobody reads
this one as closed.

**F10 — the native resize grabber — CONFIRMED FIXED.** `resize` computes to `none` on the
note box textarea, and the grabber is gone from the corner on screen.

**F11 — the question block losing contrast in dark — CONFIRMED FIXED.** In a dark rail the
question block now reads as a filled panel again: the wash is clearly separable from the
card and it picks up a hairline top and bottom. It is still unmistakably the loudest thing
in the pane, and the margin is back. (`V05_scheme_darkpage_oslight.png`.)

**F12 — the unbalanced export bar — CONFIRMED FIXED.** The button dropped to the card-action
scale and reads "Export edits". It no longer outweighs everything else in the pane.

**F13 — "Review 0" on the pill — CONFIRMED FIXED.** The collapsed pill on an untouched page
is a dot and the word Review. Nothing else.

## The one-sentence verdict

Every blocker is fixed in the place it had to be fixed, on screen and under the hand: the
hosted rail is styled, the conflict is a designed decision with two buttons that both do
what they say, a handled card states each fact once, and the scheme now follows the page
instead of the OS, so this is one product and it ships.

## The two judgment calls

**"Which version stands?" as the conflict title — agree.** It is the decision in the
reviewer's own words, it is a question so it reads as something to act on rather than
something to absorb, and it sits directly above the two panes and the two buttons that
answer it. Keeping the old heading would have restated the amber badge's fact one card
apart from it, which is F5's complaint rebuilt in a new place. Right call, and the shorter
line is better copy than the one it replaced.

**Reword and Delete one step quieter than Reopen — agree, and this is the more interesting
call of the two.** My original note suggested Reopen's treatment; the fixer was right not to
take it literally. Reopen is one action on a finished card and can afford an outline.
Reword and Delete appear under the reviewer's sentence on every card in the pane, so
outlining both would put two boxes on every card and rebuild the exact complaint F2 was
about. Sharing Reopen's register (11.5px, 550, soft ink, same radius and padding) and taking
its border only on hover and focus is the same system at the right volume. Confirmed live:
transparent border at rest, visible border on Reopen.

## New findings

### N1 — minor / taste — the conflict card explains itself after the reviewer has already decided

**Where.** The amber badge under the two buttons; `V04_conflict_card.png`.

**What.** The card now reads: title, your version, the page's version, Keep mine / Take the
page's, and then an amber block saying "This region is neither what you edited nor what you
changed it to, so nothing was written. Your text is kept." That badge is the loudest and
largest block on the card, it is three lines against the title's four words, and it arrives
after the decision it is meant to inform. The reading order is backwards.

**Fix.** Move it above the two panes, or fold what it still adds ("nothing was written, your
text is kept") into a quiet line under the title. The badge earned its amber when it was the
only statement of what happened; now that the title carries the decision, it should recede.

### N2 — minor / taste — the two conflict choices are not weighted like two choices

**Where.** `[data-lahe-conflict-choice]`; measured live.

**What.** "Keep mine" is an outlined button on white; "Take the page's" is borderless and
transparent. Same size and weight, different register. On the one screen where the product's
whole claim is that the decision belongs to the reviewer, one option is drawn as a button
and the other as a text link, which puts a thumb on the scale toward keeping your own
version. Nothing about branch four says the reviewer's version is the better answer.

**Fix.** Give both the same register. Either outline both, or outline neither and let the
title carry the weight.

## Cleanup needed (re-check pass)

Nothing was deleted and nothing under `src/` was touched. One new artifact, outside the repo,
to go with the ones the earlier lists already name:

- `…/scratchpad/verify.js` — the re-check driver.
- `…/scratchpad/design_verify/` — the re-check screenshots, once this has been read.
