## Design Review (Round 1)

Reviewed: `03_plan_free_writing.md`, against the brief, the architecture, wireframe direction A (`wireframes/a-block-menu/`), and `wireframes/DECISION.md`. Ken's constraint for this review: editing existing text and writing new text look the same in the editor, and one sitting is one edit.

**Summary.** Three blockers:

- The way into writing in empty space is not reachable in normal use (DR2).
- A conflict on the anchor can drop everything the reviewer wrote (DR14).
- Accepting a proofread would likely reopen the item as undone (DR15).

The rest are missing states, missing words, and keyboard and screen reader gaps. The block menu, the hotkeys, and the rename to "Use the fixes" and "Keep my words" are sound.

Criteria with nothing to add:

- **AI slop risk:** nothing found. The surfaces are specific to this tool and this content.
- **Signature and restraint:** the plan knows the "+ Write here" line is the signature (Decision, wireframe direction A). The only competitor is the dashed rule in DR21.

### DR1. No named design guide

- severity: minor
- kind: risk
- where: repo `CLAUDE.md`; plan, "Rules every builder follows"
- what: The project names no design guide, token file, or component catalog. The de facto standard is:
  - the edit frame and bar in `src/layer/editing.js` (`FRAME_STYLE`): accent `#3c56a5`, dark twin `#93a7ea`, and the scheme sampled from the page, not the OS
  - the rail's tokens in `src/layer/overlay.js` (`--accent`, `--line`, `--surface`, `--ink-soft`)
  - the `cardact` button register, the "More actions" menu, and the question treatment in `tab_done.js`
  - `vendor/stclair-doc-style/` for how a Markdown page draws its own h2, h3, h4, and lists
- why: Four builders on three branches will each pick colors, menus, and button styles. The Acceptance Criteria ask for "consistency with the rest of the app" with nothing to check it against.
- fix: Add one line to "Rules every builder follows" that names the pieces above as the standard. Each new surface (the line, the menu, the placeholder, the quick answers) says which existing piece it copies.

### DR2. Write state is not reachable in normal use

- severity: blocker
- kind: defect
- where: Task 2.3 (starting in empty space)
- what: Cmd-Shift-E today opens "the block under the caret" (`editBlockAtCaret`, based on the selection, not the pointer). The plan says it enters write state "with the pointer over no block". A reviewer who has clicked or selected anything on the page has a caret in a block. So Cmd-Shift-E opens that block, and the "+ Write here" line never shows.
- why: The signature element and R1 (write where no text exists) have no reliable way in. It works in the spec because the spec controls the caret. It fails for Ken on the first real page.
- fix:
  - Keep Cmd-Shift-E caret-based, as today. With no caret in a block, it enters write state.
  - Show the "+ Write here" line whenever an edit is open, not only in write state with no block open. Clicking a line commits the open session and starts the new one. Clicking a gap already commits today.
  - Add a spec: caret in a paragraph, Cmd-Shift-E, hover a gap, the line shows, click it, a new session opens after the right block.

### DR3. Write state with no block open looks like nothing happened

- severity: important
- kind: defect
- where: Task 2.3; wireframe `02-edit-state`
- what: In write state with no block open, the page shows nothing until the pointer rests in a gap. Nothing says the reviewer is in write state, how to start, or how to leave. The plan also does not say what a click on a block does in this state.
- why: The reviewer presses the key, sees no change, and presses it again or gives up. Esc as the only exit is invisible.
- fix: Reuse the edit bar with no block under it, pinned near the top of the viewport. The label is the same as the edit label (see DR12). The hint reads "Click + Write here to add text. Esc to finish." The menu, B, I, and Delete block are hidden. A click on a block opens that block, as Cmd-Shift-E would. A click on the rail or Esc leaves.

### DR4. The empty notes page still needs a pointer click

- severity: important
- kind: challenge
- where: Task 2.3 ("opens in write state on load"); wireframes `b2b-notes-empty` and `b4-empty-rail`
- what: The empty page opens in write state, but the reviewer must still find a line that "appears only under the pointer" and click it. The rail copy says "Move the pointer onto the page and click + Write here."
- why: On a blank page there is only one place to write. A step that exists only to pick that place is friction on the first thing a note-taker does. It also leaves a keyboard user stuck.
- fix: On a page with no content blocks, open a session right away, with the caret in an empty paragraph after the title and the placeholder from DR23. The rail copy becomes "Start typing. Your notes go to notes/2026-09-28.md." This goes against the approved wireframe screen, so Ken decides. If he keeps the click, show the line all the time on an empty page, not only under the pointer.

### DR5. The note-taker first sees the wrong empty text

- severity: important
- kind: defect
- where: Task 3.2 (the empty Edits tab)
- what: The rail opens on the Active tab. Its empty text today is "Nothing outstanding. Select some text and press Cmd-Shift-C." (`emptyTextFor` in `overlay.js`). The plan changes only the Edits tab's empty text.
- why: On a blank notes page, the first line the reviewer reads tells them to select text that does not exist.
- fix: On a page with no content blocks, change the Active tab's empty text too. Pin the exact lines in the plan, taken from `b4-empty-rail` and trimmed to fit DR4. Cover both tabs in `edits_tab.spec.js`.

### DR6. The keyboard path through the block menu

- severity: important
- kind: defect
- where: Tasks 1.5 and 2.2 (hotkeys and the bar menu)
- what: The bar's buttons cannot be reached from the keyboard today. The bar blocks focus on mousedown, and it sits in a shadow root outside the page's tab order. So hotkeys are the only keyboard path to block types, and the menu as drawn shows no hotkeys. The plan also does not say:
  - which Esc wins when the menu is open
  - where focus goes when the menu closes
  - how a keyboard user reaches "+ Write here"
- why: Hotkeys nobody can see are hotkeys nobody uses. Esc that commits the whole sitting when the reviewer meant to close a menu ends their writing by accident.
- fix:
  - Build the menu from the "More actions" menu in `overlay.js`: `role=menu`, `aria-haspopup`, `aria-expanded`, arrow keys, and focus back to the caret on close.
  - Each menu row shows its chord and its Markdown shortcut on the right, drawn from the one matcher in `gestures.js`, so the hints and the keys cannot disagree.
  - Esc with the menu open closes only the menu.
  - Write down that the keyboard way into new text is Enter at the end of the block above.
  - Add each of these to `free_writing_types.spec.js`.

### DR7. The screen reader hears nothing useful

- severity: important
- kind: defect
- where: Tasks 2.1 and 2.2
- what: With the parent as the editing host, a screen reader announces the whole article as editable. Edits outside the session are refused in silence. Block type changes are silent. Nothing is said when a session starts or is sent.
- why: A screen reader user cannot tell where they are writing, what type the block is, or that their typing outside the session went nowhere.
- fix: Add a polite live region in the layer's shadow root. It announces:
  - the session start ("Writing after: What I tried first")
  - each block type change ("Heading")
  - the commit ("Sent to the agent")

  This is a new component. State in Task 2.1 that nothing existing fits: the rail's toasts are for agent replies, not caret events. Assert the announcements in a spec.

### DR8. h4 is in the hotkeys and the Markdown shortcuts but not in the menu

- severity: important
- kind: defect
- where: "Block-type hotkeys" table; Task 2.2 acceptance; Acceptance Criteria R3 (paragraphs, headers, lists by the reviewer)
- what: The table says h4 is not in the menu, and the menu button reads "Small heading" when the caret is in one. Task 2.2 and the R3 line both require "each of the six types by the menu".
- why: The acceptance cannot pass as written. The menu can also show a value it does not offer, which is a dead end: the reviewer sees "Small heading" and cannot find it in the list.
- fix: Add "Small heading" as the fourth row of the menu, so it has six rows. That keeps "one function per block type, three ways in" true everywhere. If Ken wants five rows, drop h4 from the hotkeys and the Markdown shortcuts too, and fix both acceptance lines.

### DR9. What the menu says in a block that is not one of the six

- severity: minor
- kind: defect
- where: Task 2.2
- what: The plan does not say what the menu reads, or what the hotkeys do, when the caret is in a block outside the six types. Examples: a blockquote, the page's h1, an h5, a `pre`, a table cell, a figcaption.
- why: The builder will pick at build time. The likely outcome is a menu that reads "Paragraph" on a quote, and a pick that swaps a tag `swapTag` was never meant to see.
- fix: The button reads "Other block" and is disabled there, and the hotkeys and shortcuts do nothing. Add one spec case.

### DR10. Changing type inside an existing page list

- severity: important
- kind: risk
- where: Task 2.2 ("in an existing list, the anchor is the whole list")
- what: The plan does not say what happens when the reviewer picks Paragraph or Heading with the caret in item 3 of a 5-item list that was already on the page.
- why: The two obvious builds are both surprising. One turns the whole list into a paragraph. The other splits the list into three pieces, which is outside what the record shape covers.
- fix: For an existing list:
  - Bulleted and Numbered swap the whole list.
  - Paragraph on the last item ends the list and moves that item's words into a new paragraph in the run, the same as Enter in an empty last item.
  - Every other type is disabled on a middle item in this cut.

  Put this in Task 2.2 with a spec case.

### DR11. What the frame covers in a "+ Write here" session

- severity: important
- kind: risk
- where: Tasks 2.1 and 2.3; wireframe `03a-new-block`
- what: The plan makes the session the anchor plus the run. The wireframe frames only the new empty block. `positionFrame` reads one block's box today. The plan does not say which blocks the frame wraps.
- why: By default the frame will wrap the paragraph above too. Writing a new section then looks like editing the paragraph above, which breaks Ken's "looks the same" in the other direction.
- fix: One rule for both ways in: the frame wraps every block the sitting created or changed, plus the caret's block. An anchor the reviewer never touched stays outside it. Take the Task 2.1 and 2.3 screenshots so both show the rule.

### DR12. The bar still says "Editing this block"

- severity: minor
- kind: challenge
- where: Task 2.2; wireframe A's open copy point
- what: The wireframe flagged this label as Ken's call. The plan is silent, so today's `LABEL_EDITING` ships. It reads wrong over an empty new block, and over a frame holding five blocks.
- why: The label is the one word on the bar that names what is happening.
- fix: Ask Ken. The recommendation is "Editing" for every case, as one constant, so writing and editing still read the same.

### DR13. How the parent's focus ring gets hidden

- severity: important
- kind: risk
- where: Task 2.1 ("the focus ring is hidden with the layer's own shadow-root style")
- what: A style inside a closed shadow root cannot reach an element on the page, and the parent (`main`, `article`) is on the page. The only page-level style sheet the layer has is the D8 exception in `highlight.js`.
- why: If the stated method fails, Chromium draws its focus outline around the whole article while the reviewer writes. That reads as a mode switch, which is exactly what Ken ruled out.
- fix:
  - Name the method: one rule in the D8 page sheet, scoped to the attribute the layer sets on the host, removed on teardown.
  - Say that the frame is the focus indicator, so it is drawn whenever a session is open, including around an empty new block, and keeps its contrast in both schemes.
  - The Task 2.1 screenshot checks for no outline in all three browsers.

### DR14. A conflict on the anchor can drop the reviewer's whole section

- severity: blocker
- kind: risk
- where: Task 2.6 ("holding everything while the anchor is in branch four"); the conflict card in `replay.js`
- what: While the anchor is in conflict, replay inserts nothing. So after a rebuild, the section the reviewer wrote disappears from the page. The conflict card shows only the anchor's two versions. "Take the page's" retires the record, and with it every new block the reviewer wrote. Nothing on the button says so.
- why: One click on a choice about one paragraph silently throws away a hand-written section.
- fix:
  - For a run record, the card says the new text is held: "Your 4 new blocks after this paragraph are waiting on this choice." The layer fills in the count.
  - Both answers keep the run. "Keep mine" applies the anchor and inserts the run. "Take the page's" keeps the page's anchor and still inserts the run after it.
  - If Ken wants "Take the page's" to drop the run, the button has to say so.
  - Add a spec to Task 3.4 and a screenshot.

### DR15. After "Use the fixes", the item likely reopens as undone

- severity: blocker
- kind: risk
- where: Task 3.3; Tasks 2.6 and 2.7 (the insert path and the page check)
- what: When the reviewer says yes, the agent changes their words in the source. The record still holds the typed words. The plan's page check reopens an item when a block's words are missing. Once the item is reopened, the insert path can write the old sentence back beside the fixed one. No task or test covers this path.
- why: The reviewer accepts two small fixes and gets an "undone" card, or the same sentence twice. That is the exact bug class this feature exists to fix.
- fix: Decide how the record learns the fixed words. The recommended default: the contract has the agent reply handled with the fixed blocks, and the layer saves them as a new revision of the record. `after_history` keeps the typed version. The page check then compares against what the reviewer approved. Add a spec to Task 3.4: question, "Use the fixes", the agent applies them and rebuilds. The item is not reopened, and nothing shows twice.

### DR16. The quick answers show on any question about new text

- severity: important
- kind: defect
- where: Task 3.3 ("a question reply on a run record shows ... two quick answers")
- what: The brief also has the agent ask a question when it cannot tell where new text belongs. That card would offer "Use the fixes" and "Keep my words". Separately, the question treatment in `tab_done.js` says it "deliberately adds no button of its own", and the plan does not say why this question is different.
- why: The reviewer answers "where does this go?" with a button about fixes. Or they miss the question because the buttons look like the answer.
- fix:
  - Show the two answers only when the agent marks the reply as a proofread, with a flag the contract names.
  - Write one sentence in Task 3.3 on why this question earns buttons: the answer is always one of two.
  - Draw both in the `cardact` register at equal weight, as the conflict card does.
  - Keep the follow-up box, for "only the first fix".

### DR17. The words the quick answers post

- severity: minor
- kind: defect
- where: Task 3.3
- what: The rename is right: "Keep mine" already means something else on the conflict card (`KEEP_MINE_LABEL` in `replay.js`). But the plan does not pin the text each button posts, or what the card shows after.
- why: The agent reads that text as an instruction. Vague text gets a vague result.
- fix: "Use the fixes" posts "Use the fixes you listed. Change nothing else." "Keep my words" posts "Keep my words as written. No changes." The thread shows the reviewer's line exactly as posted. The card says "Waiting on the agent" until it replies.

### DR18. Proofreading questions on notes pages

- severity: minor
- kind: challenge
- where: plan, `PROOFREAD_MIN_WORDS`; brief R11 (proofreading after a long hand-written block)
- what: The threshold fires on `lahe write` notes pages too. Every question jumps to the top of Active with the loudest treatment in the rail.
- why: The brief says the agent organizes notes only when asked. A proofreading question on every long sitting of notes is the opposite of that, and it trains the reviewer to ignore question cards.
- fix: The contract skips the proofreading question on a `lahe write` page unless the reviewer asks for it. This is Ken's call.

### DR19. A reload mid-sitting no longer matches the approved wireframe

- severity: important
- kind: defect
- where: Task 3.4 (the reload specs); wireframe `b3-reloaded`
- what: The wireframe shows the session still open after a reload, with the caret in place and a quiet bar line: "Page reloaded after the agent's rebuild. Your writing is where you left it." The plan does something different in each case:
  - The agent's rebuild waits until the sitting ends.
  - A reload by the reviewer commits the sitting. After the reload the frame is closed, and the reviewer must press Cmd-Shift-E on a run block to keep going.
  - A repaint on a framework page keeps the session open.

  The bar line is in no task.
- why: Ken approved a picture the build will not match, and nobody told him. A reviewer who reloads also sees their writing sitting outside a frame, with no sign of how to carry on.
- fix: List each case under Changes from plan with what the reviewer sees. After a reviewer reload, either reopen the session on its own with the caret at the end of the run, which matches the wireframe, or tell Ken the wireframe changed. If the bar line stays for the repaint case, pin its words. If nothing shows a rebuild is waiting, add a quiet bar line for that too.

### DR20. The card lists every block

- severity: important
- kind: taste
- where: Task 3.2 (the edits row and the card)
- what: The plan shows each new block by type ("Heading: ...", "Paragraph: ..."). A whole post, which the ceiling allows, becomes a card that fills the rail. The wireframe used two lines instead: "New text after 'Then I tried asking...'" and "A heading, 'What the chat window cost me', then 2 paragraphs and a 3-item list."
- why: The card has to be readable at a glance among other cards. A block list pushes everything else off the rail.
- fix: The card and the edits row lead with the wireframe's two-line summary, with counts computed by code. The block-by-block list sits under the card's existing disclosure. When the anchor also changed, the first line reads "Edit of '...' plus new text".

### DR21. The dashed "sent, not yet placed" rule

- severity: minor
- kind: taste
- where: wireframe `05-waiting`; Task 3.2
- what: The wireframe draws a dashed rule on the page beside new text that is waiting on the agent. The plan drops it without saying so. Nothing like it exists on the page today: a committed edit gets the changed-text wash in `highlight.js`.
- why: If a builder adds it from the wireframe, it becomes a second signature on the page, competing with "+ Write here".
- fix: Cut it, and say so under Changes from plan. New text gets the same wash after commit as any edit.

### DR22. The ceiling warning and what happens at the ceiling

- severity: minor
- kind: defect
- where: plan, "Numbers this plan sets"; Task 2.2
- what: The bar warns at 90 percent, with no words given. Nothing says what happens at 100 percent. The helper refuses an oversized record, so a whole sitting could fail after the reviewer finishes. On a notes page, "start a new edit" does not help: a sitting on an outstanding record's blocks continues that record.
- why: The one way this feature can lose a long piece of writing is with no words attached.
- fix: Pin the warning: "This edit is getting long. Press Esc to send it. Once the agent places it, you can keep writing." At the ceiling, the layer stops making new blocks and the bar says why. A record over the ceiling never reaches commit.

### DR23. A placeholder in the empty new block

- severity: minor
- kind: risk
- where: Task 2.3; wireframe `03a-new-block` ("Write here" inside the empty block)
- what: The plan does not say whether the empty block shows a placeholder.
- why: The block is blank, so a builder either shows nothing, or writes placeholder text into the block, where it would leak into the record.
- fix: The layer draws "Start writing" in its own shadow root, over the empty block, and removes it on the first keystroke. It never goes into the page's DOM. Drawing it this way also avoids a page style.

### DR24. The words of the replay notes

- severity: minor
- kind: defect
- where: Task 3.2 ("a wrong-tag note and a 'placed in a different spot' note")
- what: The plan names both notes but gives no words.
- fix: "The agent placed 'What the chat window cost me' as a paragraph. You wrote a heading, so Lahe sent it back." and "'Every draft came back...' is already further down the page, so Lahe did not add it again." Neither note asks the reviewer to act.

### DR25. The dark screenshots will not show dark

- severity: important
- kind: risk
- where: every screenshot line in Tasks 2.1 to 3.3
- what: The layer picks its scheme from the page's own background, not the OS (`highlight.js`). The Lahe Markdown style has no dark mode, and the spike's `blog.html` sets no background. So "dark" screenshots on these fixtures show the light scheme, or dark chrome over a white page.
- why: The dark screenshots Ken asked for would prove nothing.
- fix: Add a fixture page with a dark background and take every dark screenshot there. Draw the new line, the menu, and the placeholder in the frame's accent pair under `data-lahe-scheme`, not in new colors.

### DR26. The Ctrl-Alt digit hotkeys on Windows keyboards

- severity: minor
- kind: risk
- where: "Block-type hotkeys" table; Task 1.5
- what: On Windows, Ctrl-Alt acts as AltGr. On German and Polish layouts, AltGr with 0, 2, or 3 types a closing brace, a superscript two, or a superscript three. Matching Mod-Alt-digit by `event.code` would swallow those characters inside a session.
- why: The reviewer cannot type those characters while writing, and the block type changes instead.
- fix: Skip the chord when `event.getModifierState("AltGraph")` is true, and add a unit case for it.

### DR27. Motion is not specified

- severity: minor
- kind: risk
- where: Tasks 2.2 and 2.3
- what: The plan says nothing about motion.
- fix: The "+ Write here" line fades in with the frame's existing opacity transition, and shows at once under reduced motion. The frame follows new blocks without animating its size. There is no other motion.

### DR28. Narrow windows and the rail

- severity: minor
- kind: risk
- where: Tasks 2.2 and 2.3
- what: Mobile is a non-goal, but a laptop window beside a terminal is narrow. The plan does not say:
  - how the wider bar fits
  - where the menu opens near the bottom of the viewport
  - where the line stops when the rail is open
- fix: The menu opens upward when there is no room below. The line stops at the rail's edge, using the berth property the rail already publishes. The bar drops the hint first when space runs out.

## What already exists

Reuse these rather than drawing new ones:

- **The edit frame and bar** (`src/layer/editing.js`, `FRAME_STYLE`, `buildBar`):
  - the accent and its dark twin
  - the label and hint constants
  - the mousedown guard that keeps the caret in the block
  - the 120ms opacity transition

  The block menu, the write state bar (DR3), and the "+ Write here" line all draw from this.
- **The "More actions" menu** in `src/layer/overlay.js`: `role=menu`, `aria-haspopup`, `aria-expanded`, roving focus, and a close that returns focus. It is the model for the block menu (DR6).
- **The `cardact` button register and equal weighting** from the conflict card in `src/layer/replay.js`. The model for "Use the fixes" and "Keep my words" (DR16).
- **The question treatment** in `src/layer/tab_done.js`: pulled to the top, the accent rule, the follow-up box. The proofreading card keeps all of it.
- **Empty text per tab** in `emptyTextFor` in `src/layer/overlay.js` (DR5).
- **The scheme sampled from the page** (`data-lahe-scheme`, `highlight.js`). Every new drawn element follows it (DR25).
- **The D8 page-level style sheet** in `highlight.js`, the only sanctioned page style. It is the home for the focus-ring rule (DR13).
- **The changed-text wash** in `highlight.js`, which marks new text after commit (DR21).
- **The rail's berth property**, published by the rail for other surfaces (DR28).
- **Reduced-motion checks** in `overlay.js` and `highlight.js` (DR27).
- **The Markdown document style** (`vendor/stclair-doc-style/document.css`). Its h2, h3, h4, and list rules give R4 (new blocks use the page's styling) for free, once blocks are siblings and not nested.

## Not in scope

- **Mobile and touch layout:** a non-goal in the brief. The job happens on a laptop.
- **A gutter "+" or always-visible insert points:** Ken rejected direction C as too busy.
- **Nested lists and indent:** cut in the architecture for this round.
- **Rich paste:** waits on board row `LAHE-rich-paste` (keeping formatting from a paste).
- **Moving the frame and bar's raw hex values onto the rail's tokens:** worth doing, but it is a cleanup of existing code and not this feature's.
- **A slash-command or type-ahead block picker:** the menu, hotkeys, and Markdown shortcuts already give three ways in.
- **Showing proofreading fixes inline on the page before the reviewer accepts:** the card text names each fix. An inline preview can come later if Ken finds the card text hard to judge.
- **A first-run tip that teaches Cmd-Shift-E and "+ Write here":** worth a look once Ken has written a few posts with it. The empty rail copy covers the notes page for now.
