# Flow walk: free writing, on the running app

**Summary.** The main path works. A writer can add a heading, paragraphs and a list anywhere, the agent places them from `review.json` alone in HTML and Markdown, and proofreading with "Use the fixes" and "Keep mine" works end to end. It is not ready for the PR, for three reasons:

- **Undo does not always reach the agent.** After a page reload, Undo takes the words off the page but the item stays on the agent's list. An agent that follows the contract then puts back words the writer took out.
- **Editing your own placed text reopens it as lost.** Add an item to a list that the agent already placed, and the helper reopens the placed item with "the original text is back. Reapply it". The writer gets a conflict card against their own edit. Once, after that, the list showed twice on reload.
- **A real conflict hides the writer's new paragraphs.** When the agent rewords the same sentence the writer reworded, the new paragraphs vanish from the page. There is no choice card, only a generic "could not be safely matched" note.

The top design problem is the bar: while writing, it sits over the line above the block being edited and hides it. That happened on every page I wrote on.

Walked on `feat/free-writing` at 75f69c0. Chromium for everything, plus a WebKit spot check. I used my own state directory and helper port 8321, on three pages I made:

- an HTML blog post with its own dark mode
- a Markdown essay
- `lahe write` notes pages

I acted as the agent from `review.json` and the drain only, and replied with `lahe reply`. The screenshots are in `../progress/flow_walk/`.

## User stories

| Story | Verdict | What I saw | Screenshots |
|---|---|---|---|
| Writer: add a header and several paragraphs anywhere | pass, with design problems | Opened a paragraph with Cmd-Shift-E. Hovered the gap after a list and clicked "+ Write here". Picked Heading from the menu, then typed a heading, two paragraphs (one with bold) and a `- ` list. Esc made one card with the right shape line. The agent placed it, and the page matched the source block for block. The same worked at the end of the page and after a list on Markdown. | 03, 04, 05, 06, 07, 09, 10, 11, 13, 14, 15, 17, 23, 24, 25 |
| Writer: agent proofreads and suggests fixes | pass | A 170-word run came through with `proofread: true`. I placed it as written and asked two fixes with `--proofread --suggest`. "Use the fixes" came back as rev 2 with the fixed words and `proofread: false`. I fixed the source, and both fixes showed after the rebuild. On a second 156-word run, "Keep mine" came back with the note "Keep mine as written. No changes." I replied handled and the source kept the writer's words. | 26, 27, 28, 29, 30, 37, 38, 39 |
| Notes: open a blank document and start typing | pass | `lahe write` made the file and served it with the rail. The page opened ready to type, with "Start writing" and the empty-rail copy. A heading, a paragraph and a `1. ` list became one card placed at the start of the file. | 40, 41, 43 |
| Notes: agent organizes when asked | pass | A page note asking to organize went to the agent as a note item. I pulled the to-dos into a list and kept the paragraph. The page rebuilt with nothing reopened. Unasked, I only placed text. `proofread` stayed false on a 165-word notes sitting (PQ3, no proofreading on notes). | 92, 93, 94 |
| Editor: bold or italic survives | pass | Bolded two words on the Markdown page. The record carried `<strong>`, I wrote `**too even**`, and the page showed bold after the rebuild. Italic inside a new block (`<em>it's shape</em>`) was placed as `_it's shape_` and was italic on the page after the rebuild. | 21, 22, 24, 26, 30 |
| Any reviewer: agent knows what is new and where it goes | pass, with one bad record | Every run listed tag, words and markup, and `placement` was right for "after the anchor" and "start of the page". The bad case: Enter in the middle of a paragraph, then two lines of new text, marks both new blocks `from_anchor`. That includes one made only of new words. The contract says "do not add those words again" for `from_anchor`, so a literal agent drops the writer's sentence. The card also calls both of them "Paragraph, moved". | 62 |

## Unverified criteria from the spec check

| Criterion | Verdict | What I saw | Screenshots |
|---|---|---|---|
| R9b, a real agent places from `review.json` (HTML) | pass | Placed an h2, two p and a ul after the anchor list. Carried `data-lahe-id` onto the anchor, since `stamp_carriable` was true. Handled on the first reply. | 10, 11 |
| R9b, a real agent places from `review.json` (Markdown) | pass | Placed an h3 and four paragraphs with `_em_`. Markdown needs no stamp, and the page matched after the rebuild. | 26 |
| R10, handled is checked | pass | A handled reply sent without placing was held open. The card said "flow-walk says this is done, but I could not find the change on your page. It is still open." After placing, the second reply closed it. | 16, 17 |
| R11b, proofreading with a real agent | pass | See the proofreading story. One gap: `lahe reply --suggest 1 "x" "x"`, a fix whose from and to are the same, is accepted and posted to the card. | 28, 38 |
| R7, rebuild mid-sitting | pass | I changed the byline in the source while a sitting was open. The page did not reload while I typed, and the caret stayed. After Esc the rebuild landed and the new text showed once. | 59, 60, 61 |
| R7, reviewer reload mid-sitting | pass | Reloading during a notes sitting committed it. The text came back once. | 42 |
| R15, undo before the agent acts (no reload) | pass | Undo on a fresh run took it off the page, and the helper logged `item.deleted`. | 57, 58 |
| R15, undo after a reload | **fail** | On the HTML page, a run that came back through a rebuild reload was undone from the card. The page lost the words, but no `item.deleted` reached the helper. The item is still ready on the drain as `itm_a8de710c1b0b0f16cee9fbc9`. The same happened on the notes repro for `itm_ac7c7e101d81501cc66c14e3`: Undo worked on the page, the helper logged nothing, and it stayed on the drain at rev 2. | 56, 62 |
| R15, undo of "Edit of X plus new text" | **fail (seen once)** | On the first notes page, Undo said "Could not undo this: the anchor this record points at is not on the page". The anchor list was on the page. After a reload, that page showed the list twice. | 46, 47, 48 |
| Reword a placed block | pass | Reworded a heading the agent had placed. It went to the agent as a plain edit. I changed the Markdown, and nothing else reopened. | 96, 97 |
| Conflict card for a run | **partial** | When the agent adds a sentence to the anchor, the run conflict card shows: "Your 2 new blocks after this paragraph are waiting on this choice." "Take the page's, keep my new text" then placed the run after the page's anchor. When the agent rewords the anchor mid-sentence, no card shows and the writer's new paragraphs vanish from the page. The only note is the generic "This feedback could not be safely matched…". | 69, 70, 63, 66, 67 |
| Block-clash card | **fail** | It fires on the writer's own edits. In a clean repro on a notes page: the agent placed a heading, a paragraph and a 2-item list. I then added a third item to that list. The placed run was reopened with "Reopened by the page check: this handled change is no longer on the page and the original text is back. Reapply it". The card asked "Which version stands?" between my list and my list, with "This change was undone on the page". Neither is true, and the agent is told to reapply text that is already there. The same card fired on the HTML post when I appended one line to a paragraph the writer had placed. That case is fair, since the agent should not write in the writer's text. But the reason it gives is still wrong. | 50, 51, 52, 71, 72 |
| The look, light and dark | pass, with design problems | New blocks take the page's type and spacing while writing and after placing. On Markdown, a new h2 gains its section rule only after the rebuild, which the plan allows. The HTML post in dark mode draws the bar, menu, placeholder and card correctly. The Markdown doc style has no dark mode, so there is nothing to check there. | 07, 24, 84 to 89 |
| Reads as one feature | mostly | Writing new text and editing old text use the same frame, the same bar and one card per sitting. Where it breaks is the rail. New text lives only on the Edits tab, so Active says "Nothing outstanding" while the agent is asking a proofreading question. | 08, 27 |
| Direction A layout | pass | The type menu sits after "Editing" and before B and I. "+ Write here" is the only pointer way into empty space, and there is no gutter "+". Each menu row shows its chord and its Markdown shortcut. | 05, 87 |
| WebKit spot check | pass | "+ Write here", the heading hotkey, the `- ` shortcut and Esc all worked. | 90, 91 |

## Design and copy problems, worst first

1. **The bar hides the text just above what you are writing.** It sits over the block before the anchor: the second line of a paragraph, a heading, the byline. The approved wireframe puts it right above the new block. A writer reading back what they just wrote cannot see the sentence they are continuing from. Seen in 04, 06, 07, 14, 24, 36, 59 and 86.
2. **The writer's new text disappears during a conflict.** "Either answer keeps them" is true on the card, but the page shows nothing until they choose. When the anchor was reworded, no choice was offered at all (63, 67). The words should stay on the page, marked as waiting.
3. **Clash and reopen copy tells people untrue things.** "The original text is back. Reapply it" and "This change was undone on the page" both appear when nothing was undone. "This region is neither what you edited nor what you changed it to" is jargon for a writer. The block-clash card needs its own words, not the anchor conflict's (51, 72).
4. **A proofreading question does not show on Active.** The wireframe (06b) puts the card back on Active because it needs an answer. The build leaves Active at 0 with "Nothing outstanding", and the question sits in Edits below the fold of a long card (27, 28). A toast appeared on the second question but not the first.
5. **Markdown shortcuts are one level off.** Typing `## ` makes a Subheading (h3). In the Markdown source that becomes `###`, even though `##` is what the writer typed and what the document's own sections use (36). A writer who knows Markdown will get the wrong level every time. Either map `#` to the page's h1 level, or show the level in the menu so the mismatch is visible.
6. **Opening a block shows a card with the whole block struck through.** Just pressing Cmd-Shift-E on a paragraph adds a Draft card on Edits that looks like a deletion (64). It also moves the Edits count before anything is typed.
7. **"+ Write here" is hard to hit and collides with the frame.** Below an open list, the line sits on the frame's bottom border (44). The target is only a few pixels tall. My first clicks missed, the session closed, and the typing went nowhere with no feedback.
8. **Cmd-Shift-E does nothing after you click the rail.** With focus on a rail tab, the chord and typing are both ignored until you click the page (33, 68). Writers move between the rail and the page all the time.
9. **The edit-state hint names something that is not on screen.** "Click + Write here to add text" shows before any line does, because the line only appears on hover (12).
10. **Card and edits-tab copy.**
    - "New text after 'Fewer meetings Longer blocks of focus'" runs the list items together (09).
    - "'The team still ships on Thursdays....'" has four dots (15).
    - "A paragraph moved out of it, then a paragraph moved out of it." and "Paragraph, moved" describe new writing as moved (62).
    - Fix labels read "BLOCK 3: THE DRAFT ALSO LOST IT'S SHAPE. I COULD ..." in capitals. "Block 3" is jargon, and the page does not show where the fix is (28).
    - The Edits header says "1 hand edit" over "No hand edits yet." (10), and "3 hand edits" beside a count of 1 (37).
11. **The changed-text wash lands on the wrong block.** After "Use the fixes" and "Keep mine", the anchor list or paragraph gets the blue wash, not the new text (29, 39). After a held handled reply, the new text loses its wash while it is still only on this page (16). Some commits show the yellow wash and some show none (46, 57).
12. **Bold looks different while writing.** While typing, the new text is plain bold (`<b>`). After placing, it takes the page's red `<strong>` style (07 against 10). R4 asks for the page's own styling while writing too.
13. **Toasts outlive their answer.** The QUESTION toast stayed after "Keep mine" (39). The CONFLICT toast stayed across reloads (54).
14. **The notes rail says "Nothing written yet" over written notes.** After a reload mid-sitting, the empty-rail copy stayed while three blocks were on the page (42).

## Other things a builder should know

- `lahe reply --suggest` accepts a fix whose from and to are the same.
- The reopen note ("Reapply it") stays on later revisions of the same record. On rev 3, the agent was told to reapply when the real request was one new paragraph.
- A second browser window on the same Markdown page gets a 409 and a read-only rail. This works as designed, but I first hit it as "my typing does nothing".
- A new browser shows only its own unplaced runs. The helper had ready items from the other window that this one did not show. That may be older behavior, but writers will meet it here.

## Cleanup needed

Nothing was deleted. These are safe to remove at cleanup:

- `docs/features/20260928.01_free_writing/progress/flow_walk/68-debug.png`: a debug capture, not a state.
- `progress/flow_walk/31-md-write-here-end.png`, `45-notes-second-sitting-typing.png` and `95-reword-placed-heading.png`: attempts where my click or selection missed. They are not cited above.
- `progress/flow_walk/82-md-dark-writing.png` and `83-md-dark-second-window.png`: taken in the second, read-only window.
- My helper on port 8321, its static servers, and the driver on 8399, all under my scratchpad state directory. Close them with `node bin/lahe.js session close s_006673eebdfa4c2d --state-dir <scratchpad>/walk/state`.
