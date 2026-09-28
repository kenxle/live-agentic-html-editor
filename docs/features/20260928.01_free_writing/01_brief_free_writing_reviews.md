# Reviews: Free writing brief

Brief under review: `01_brief_free_writing.md`. Inputs read: the accepted crucible, the questions page with Ken's answers, `CLAUDE.md`, the diagrams index plus item lifecycle, replay branches, protected region and finding the region, `skills/lahe/SKILL.md`, `docs/CONTRACTS.md`, and the board (`docs/BULLETIN.md`).

## PM Review (Round 1)

Findings ranked worst first. Two blockers, six important, three minor.

### RF1. The formatting-bug requirement is stated before its own gate, and ignores a bug already on the board

- severity: blocker
- kind: defect
- where: R13 (bold or italic reaches the agent and survives the rebuild), Q2 (what is the formatting bug), Success Metrics bullet 3
- what: The crucible says "the brief cannot state the requirement until we know" what the bug is, and the brief states R13 anyway, with Q2 admitting the reproduction has not been done.
- why: R13 is not testable as written. "Ten bold or italic edits in a row" with no named cases will pass on ten easy edits and miss the real one. Worse, part of the answer already exists and the brief does not cite it: board row `LAHE-lone-paragraph-loses-markup` (a paragraph written on its own loses its bold and italic when the page already carries the rest of the edit; recorded in `docs/features/20260922.08_no_duplicate_text/NOTES.md`). Ken also named a second failure in the questions page, Q5: "Putting text under a header often breaks the formatting in buggy ways." Neither is in the brief. Building R13 without them means the feature ships and the known bug stays open on the board as a duplicate.
- fix: Cite the board row and the NOTES file as the first known cause, and say the row is absorbed by this feature (or say why not). Add the under-a-header failure as a second reproduction case. Rewrite the success metric as a named list of cases (lone paragraph with bold, text under a header, bold two words in a Markdown page per the crucible assignment) that each reach the source and survive the rebuild. Keep Q2 open only for causes not yet found.

### RF2. The brief pre-decides design that Ken left to the wireframe and architecture

- severity: blocker
- kind: defect
- where: Solution Outline; R3 (Enter makes a paragraph, header without leaving the keyboard); R7 and R8 (new text as its own item, carrying block structure); Rollout ("The record shape gains a new item kind")
- what: The crucible closes with "everything else, including the gesture, what the bar shows, how a sitting is bounded, and how the record is shaped, is for the brief and the architecture," and the brief decides three of those four.
- why: Each one narrows the wireframe and architecture before they start. Specifically:
  - "What they write in one sitting reaches the agent as new text" (Solution Outline) and R7 decide one record per sitting. Approach A in the crucible was one record per block. That choice is open.
  - R3 "without leaving the keyboard" decides that a header is a keyboard action. The crucible offered "a `#` prefix or a bar button." That is the wireframe's call.
  - R8 says what the item carries. Rollout says the record "gains a new item kind." Both are record shape, which is architecture.
  - R2 "the same gesture family as entering an edit" is a design phrase, not a product outcome.
- fix: Rewrite each as the outcome the reviewer or agent sees. R2: "Starting to write feels like the edit the reviewer already knows; no new mode to learn." R3: "The reviewer can make a header themselves, without asking the agent." R7: "The agent can tell new text apart from a change to existing text, and knows where it goes." Drop R8 into R7 as "including which lines are headers and any bold or italic." Drop the record-kind sentence from Rollout. Remove "in one sitting" everywhere.

### RF3. Proofreading is a requirement Ken agreed to, and the brief files it as behavior plus an open question

- severity: important
- kind: defect
- where: AI Behavior bullet 1; Q3 (is proofreading triggered by length, by asking, or always)
- what: Ken's premise 6 answer is "on longer blocks the agent should proofread and offer suggestions," so the trigger is decided, but the brief has no numbered requirement for it and Q3 reopens the trigger as if he had not answered.
- why: A requirement that lives only in AI Behavior has no test and no home in the contract. R9 says the contract tells the agent how to place text; nothing says it tells the agent to proofread. Since the contract in `review.json` is the only text an agent is guaranteed to read (per `CLAUDE.md`), a proofread rule that is not a requirement never reaches the agent. "Longer than a short paragraph" is also untestable.
- fix: Add R15: "After the agent places a hand-written block above a length threshold, it replies with proofreading suggestions as a question on the card, and leaves the words unchanged." Say the threshold is a number the plan sets, with a proposed default. Narrow Q3 to the threshold only, since Ken already chose "longer blocks."

### RF4. The blank notes document has two owners for the file, and no answer on whether it needs an agent

- severity: important
- kind: defect
- where: R11 (start a blank document from the command line), R12 (text saved to a source file the reviewer named), R9 and R10 (the agent places new text and is checked on it)
- what: R12 says typed text is saved to the file, while R7 through R10 say the agent receives an item and places the text in the source. The brief does not say which one is true for notes.
- why: This is a product decision, not architecture. If the agent writes the file, every paragraph of notes is a round trip through an agent, and notes stop landing the moment the agent is busy or gone. If the tool writes the file, the agent's placement rules and the handled check do not apply to notes, and R12 needs to say so. Ken's notes job is "see what I already wrote and look back at it often." That job is met by the page, not the file, but "a file the reviewer owns" is a promise the brief makes and has to be able to keep with no agent watching.
- fix: State it: does a blank notes document work with no agent attached, and who is responsible for the file matching the page? If the answer is not known, make it an open question for Ken, with the two options and what each costs him, and mark R12 as depending on it.

### RF5. The brief does not say what happens to today's Enter-at-the-end behavior

- severity: important
- kind: defect
- where: Context paragraph 2; R1 (write after any block); R7 (not recorded as a change to a neighboring block); Success Metrics bullet 4
- what: Today, Enter at the end of an existing block during an edit adds paragraphs to that block's edit. The brief calls this the problem and then never says whether that path changes, stays, or becomes new text.
- why: This is the seam between "feels like the edit mode I have" and "new text is its own item." If both paths exist, the reviewer has two ways to add a paragraph after a block that produce different records, and metric 4 ("no new-text item arrives as a change to a neighboring block") can never be judged because a reviewer extending a paragraph is doing exactly that on purpose. Ken's premise 3 answer ("follow the same logic a line break already uses inside a block") points at one consistent rule, not two.
- fix: Add one requirement or one open question for the wireframe: when a reviewer is editing an existing block and presses Enter at its end, is the new paragraph part of that edit or new text? Say what the reviewer sees either way. Reword metric 4 to match.

### RF6. A page rebuild mid-writing has no requirement

- severity: important
- kind: risk
- where: User & Context ("the page can reload while the reviewer is typing"); R5 (every keystroke saved)
- what: The brief names the risk in User & Context and the crucible names it as approach B's main risk (a multi-block region is new ground for protection and replay), but no requirement says what the reviewer experiences when the agent's rebuild lands while they are writing several paragraphs.
- why: R5 covers the words surviving. It does not cover the caret staying put, the half-written section staying on screen, or a section the agent already placed not appearing twice after the reload. Today's protection guards one block (see `docs/diagrams/protected_region.md`). For a writer mid-section, losing the cursor position is the failure they will notice first, and it is not in the brief.
- fix: Add a headline requirement: "A page reload while the reviewer is writing does not move the cursor, hide what they have written, or show their new text twice." Leave how to the architecture.

### RF7. Success metrics are demos, not measures, and none tracks the status quo cost

- severity: important
- kind: defect
- where: Success Metrics
- what: Bullets 1 and 2 describe one successful run, bullet 3 is an arbitrary count with no cases (see RF1), and bullet 4 restates R7.
- why: The crucible names the cost of doing nothing in two lines: a round trip to the agent before every blog post, and notes in the terminal that cannot be looked back at. Neither appears as a metric, so the brief cannot say whether the feature paid off.
- fix: Replace with metrics tied to the status quo:
  - Over the next N posts Ken writes in Lahe, zero asks to the agent for a placeholder header or section.
  - Notes for a session live on a Lahe page, not in the terminal, and Ken reads them back from the page.
  - Every case in the R13 reproduction list passes.
  - The agent's placement matches what he wrote block for block, header included, on every new-text item, not once.

### RF8. Lists are cut silently, and paste and "larger edits" are neither in nor out

- severity: important
- kind: risk
- where: Non-Goals ("Not lists, tables, images, or links in the first cut"); Goal / Problem bullet 3 ("Editing")
- what: The crucible's approach B, which Ken chose, includes "`-` makes a list." The brief drops lists to a non-goal without a decision recorded from Ken. Two other likely scope questions are not mentioned at all.
- why: Notes are mostly lists. A notes document with no bullets may fail the notes job on day one, and the brief presents that as settled. Separately: pasting a draft written elsewhere is the first thing a writer publishing a post will try, and the brief says nothing about it. And Ken's premise 1 caveat ("larger edits are also lacking") is in the Goal as a third job and then has no requirement and no non-goal.
- fix: Move lists to an open question for Ken: in for notes, or a follow-up. Add paste to the requirements or the non-goals, whichever Ken wants; do not leave it unsaid. Either give "larger edits" a requirement (what "larger" means, and what fails today) or move it to non-goals with a pointer to a follow-up.

### RF9. "Word for word" collides with the Markdown renderer's typography

- severity: minor
- kind: defect
- where: R6 (words kept exactly as typed; nothing rewrites them on the page, in the record, or in the source)
- what: A Markdown rebuild already turns straight quotes into curly ones, and the replay compare reads past that on purpose (`docs/diagrams/replay_branches.md`, the split compare note).
- why: As written, R6 fails on the first rebuild of any page with a quote mark in it, and the test that proves R6 will be argued over.
- fix: "The words stay as typed. The renderer's typography (curly quotes, dashes) is not a rewrite."

### RF10. The Tiptap question appears three times, and Rollout carries an agent-compatibility gap

- severity: minor
- kind: taste
- where: Goal / Problem last paragraph; Non-Goals bullet 2; Q1; Rollout
- what: The engine question is stated in the Goal, the Non-Goals, and Q1. Rollout says old pages are unaffected but not old agents.
- why: Three mentions make the engine look like the feature. And an agent running an older copy of the skill will meet a new item shape; "existing reviews keep working" does not cover that reader.
- fix: Keep Q1 and the zero-dependency non-goal; cut the Goal paragraph. Add one line to Rollout: an agent on the old skill sees new text as something it can still act on, or is told to update. How is for the architecture.

### RF11. R5 promises more than the tool does today

- severity: minor
- kind: defect
- where: R5 (every keystroke of new text is saved; a reload, a page repaint, or a helper restart loses nothing)
- what: Drafts are saved to browser storage on every keystroke and to the helper at most every 10 seconds (`docs/diagrams/item_lifecycle.md`), so "a helper restart loses nothing" holds only through the browser copy.
- why: The requirement reads as an absolute and will be tested as one. It also does not say what a writer sees after a reload: is the unfinished section still open for typing, or committed?
- fix: "New text is saved as the reviewer types, the same as an edit draft today, and survives a reload and a page repaint. After a reload, the unfinished section is still there to keep writing."

### Disposition table for the brief writer

| # | Severity | One line |
|---|---|---|
| RF1 | blocker | R13 is stated before its reproduction and misses the board row `LAHE-lone-paragraph-loses-markup` and the under-a-header failure Ken named |
| RF2 | blocker | One record per sitting, header by keyboard, and the item shape are decided in the brief; Ken left them to wireframe and architecture |
| RF3 | important | Proofreading has no requirement, and Q3 reopens a trigger Ken already chose |
| RF4 | important | Notes: who writes the file, and does it work with no agent attached |
| RF5 | important | Enter at the end of an existing block: same edit, or new text? Not said |
| RF6 | important | No requirement for what a writer sees when the page rebuilds mid-section |
| RF7 | important | Metrics are one-off demos; none tracks the placeholder round trip or terminal notes |
| RF8 | important | Lists cut without Ken's call; paste and "larger edits" neither in nor out |
| RF9 | minor | R6 "word for word" fails on the renderer's curly quotes |
| RF10 | minor | Tiptap said three times; Rollout skips agents on the old skill |
| RF11 | minor | R5 overstates draft saving and skips what a reload shows |
