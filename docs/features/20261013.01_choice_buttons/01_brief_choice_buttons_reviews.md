## PM Review (Round 1)

Reviewer: PM persona. Brief read: [01_brief_choice_buttons.md](01_brief_choice_buttons.md), with [the questions part](parts/brief/questions.md), [the crucible summary](00_crucible_choice_buttons.md), [the crucible questions page](00_crucible_questions.md), the product brief, brand doc, style guide, the lahe skill's "Writing a page for someone to read", and the accepted menu bar brief as the bar.

**Verdict.** The brief is faithful to Ken. It keeps every decision he made (approach B, documents only, no "answer in words" button, grown out of option cards, identity left to the architecture, taught through the skill). The problem is stated in his words, and the requirements stay at product level. What is missing is the edges a builder would otherwise invent: what the page shows in each state, what a quick run of presses costs, what happens when Ken changes his mind after the agent already acted, and what happens when a rebuild moves or removes a group. Each one can be settled by the brief writer without asking Ken.

Not found: `docs/ongoing/diagrams/INDEX.md` does not exist in this repo. The diagrams live in `docs/diagrams/` with a README, and none of them bears on a brief-level judgment here.

### RF1. A run of presses could wake the agent once per press

- **severity:** important
- **kind:** risk
- **where:** R11 (a press costs fewer tokens than a comment), line 90; Summary, line 5
- **what:** R11 measures the size of one press in the drain, but the real cost of a queue is the number of agent turns, and the monitor wakes the agent once per item.
- **why:** Ken picked approach B partly because "I think this might be better for token management as well." On the lesson queue he will press nineteen buttons in under a minute. If each press is its own wake, the agent rereads its context up to nineteen times, which costs more than one comment per lesson ever did. That breaks the product brief's "Don't waste tokens" and "Don't cause no-ops" principles.
- **fix:** Add a requirement about the outcome, not the mechanism: "Presses made close together reach the agent together. Clearing a page of N choices costs about as many agent turns as one comment, not N." Change R11 so it measures the cost of clearing the whole lesson queue with presses against the same queue cleared with comments. "Sent at once" can stay true for the helper; how the wake waits is the architecture's call.

### RF2. Changing your mind after the agent already acted is not covered

- **severity:** important
- **kind:** defect
- **where:** R5 (one answer per group, a later press replaces an earlier one), line 64; R6 (a press after handling starts a new thread), line 68; AI Behavior, lines 115 to 117
- **what:** R5 gives Ken a window to change his mind "before the agent has replied", but the agent wakes at once, so that window is often a few seconds, and nothing says what the agent does when the second press arrives after it already acted on the first.
- **why:** There is no confirm step, so a misclick on "Discard" among nineteen rows is sent and acted on. Ken's natural fix is to press "Promote". If the agent treats that as a fresh request without undoing the discard, the lesson is gone and nobody notices. It also leaves a race: the agent may have read the first press and started work when the second lands.
- **fix:** Add to AI Behavior: "When a later press on the same group reverses an earlier one, the agent undoes what it did for the earlier answer, then does the new one, and says both on the thread." Add to R5 that the agent acts on the latest answer it can see when it starts, and that a press arriving mid-work is handled on the next turn, never dropped.

### RF3. What the page shows for a press, in each state, is undefined

- **severity:** important
- **kind:** defect
- **where:** R4 (the page shows which answer was pressed and that it was sent), line 60; R7 (kept in the browser, survives a helper restart), line 72; R13 (shows the answer once handled), line 100; UX Notes, line 121
- **what:** The brief names only two looks, "sent" and "handled", but its own requirements create at least four more: kept in the browser because the Lahe program is down, waiting with no agent listening, answered "not handled", and answered with a question.
- **why:** "Sent" is untrue when the Lahe program is down (R7 says the press is only kept in the browser then). "Sent" with no agent listening reads as "done" to someone amid eighteen other things, and the verdict sits unread. A builder will invent these looks and their words, and the brand doc says the interface reassures with facts ("Kept in this browser"), not guesses.
- **fix:** List the states once, in the Requirements, as what Ken sees on the page: pressed and kept in this browser; delivered, waiting on the agent; the agent asked a question; not handled, with the reason on the thread; done. Say the state words match the rail's thread states (Done, Open, Question) from the brand doc's words table, and that the rail's existing "no agent listening" line covers a press the same way it covers a comment. Add the word Ken sees for a press (for example "your choice") to the brand doc's "Words we use" table in the same change.

### RF4. A rebuild that removes, moves or rewrites a group has no rule

- **severity:** important
- **kind:** defect
- **where:** R7, line 72 ("The pressed state on the page survives a reload and the agent's rebuild"); R13, line 100
- **what:** R7 assumes the group is still there after a rebuild, but agents routinely change the page around a decision.
- **why:** The skill tells agents to "Keep the top current": when an item is settled, move it out of the top into a Decisions section. So the normal case after a press is that the agent moves or rewrites the group. A builder has to guess whether the pressed state follows a moved group, what happens if the agent renames "Promote" to "Accept", and where a press goes when its group is deleted. The worst guess, a press attaching to a different group, is exactly the confusion Ken asked this feature to prevent.
- **fix:** Add one requirement: "A pressed state follows its group when the agent moves it. If a rebuild removes the group or the pressed answer, the press stays on its thread in the rail and shows nowhere on the page. A press never attaches to another group or another answer." Add a line to AI Behavior about how a handled group should be moved under "Keep the top current", so the skill and this feature agree.

### RF5. An agent that writes two colliding groups, or a broken one, finds out too late

- **severity:** important
- **kind:** risk
- **where:** R1 (an agent can write a group in a few lines), line 46; R9 (two groups that offer the same answers are never confused), line 82
- **what:** R9 promises no confusion between groups, but nothing says what happens when the agent itself writes two groups that cannot be told apart (the copy-paste case on a nineteen-row page), or a group with one answer or no question.
- **why:** Ken named the agent writing the page as the user who matters most. If a broken group renders as working buttons, the reviewer is the one who discovers the bug, after pressing. That is the trust failure the crucible's case against building warned about: "a feature that gets identity wrong once teaches him not to trust it."
- **fix:** Add a requirement stated as an outcome: "A group the press could be confused with, or a group that is not well formed, is reported to the agent before the reviewer can press it, and draws on the page as plain content rather than live buttons." Leave how and when it is checked to the architecture.

### RF6. The AI Behavior section does not tell an agent when to use plain option cards

- **severity:** important
- **kind:** defect
- **where:** AI Behavior, lines 113 to 117; R14 (the skill and catalog gain the choice group), line 106
- **what:** The skill's components table today says "A choice for the reader: option cards", and the brief adds a clickable sibling without saying which one an agent picks.
- **why:** Ken's user statement is "instructions must be clear and communication must be good." With two components for "a choice", agents will split: some keep writing option cards for decisions (Ken is back to highlight, comment, submit), and some turn every comparison into buttons. Two smaller gaps sit in the same section. It does not say what the agent does when Ken comments on a group instead of pressing it, for example "Promote, but rename it". It also does not say whether a recommendation is required, though R1 implies it is.
- **fix:** Add three lines to AI Behavior. First: "Use a choice group when you need the reader's answer and can name every answer. Use option cards when you are showing options to compare and the answer is free, or when the choice needs more than a button label to explain." Second: "A comment on a group is that group's answer. Handle it like a press, and the group may stay unpressed." Third: "Mark a recommendation when you have one. A group without one is allowed." Then say in R14 that the skill's components table row for "A choice for the reader" changes to match.

### RF7. R13 leaves open whether the agent has a job in keeping the decision

- **severity:** important
- **kind:** risk
- **where:** R13 (the page keeps showing the chosen answer on a fresh load), line 100
- **what:** "How the document carries it is for the architecture" hides a product choice: whether the decision lives only in Lahe's records or in the file itself, which the crucible suggested borrowing from approach C.
- **why:** If the architecture puts the answer into the source, the agent has a new step on every press, and the AI Behavior section does not mention it. If it lives only in Lahe's records, a reader opening the file in another tool or after the review ends sees no decision. Each is defensible, but the brief has to say which outcome Ken gets, or the architecture is choosing what the product promises.
- **fix:** State the outcome in R13 in one sentence. For example: "After the review ends, opening the document address still shows the chosen answer." Or say it is only while the review is live. If the chosen outcome needs the agent to write anything, add that step to AI Behavior.

### RF8. Two questions are left open for Ken when he said he does not need to be asked

- **severity:** minor
- **kind:** defect
- **where:** [questions.md](parts/brief/questions.md), lines 3 to 9 (Q1, can a choice be changed after handling; Q2, a page-wide "all as recommended" choice); Non-Goals, line 31
- **what:** Both open questions already have an answer in the brief, and Ken said on the crucible page "i don't think you need me for the rest of this."
- **why:** An open question invites the architecture to wait. The non-goal at line 31 also reads two ways at once: it is out of scope, and it is still open.
- **fix:** Move both into "Chosen by the brief, for Ken to overrule in review". Q1 becomes "A press after the agent has handled the group starts a new thread." Q2 becomes "No page-wide 'all as recommended' choice in this cut. A note on the page still works for that." Drop "Open question Q2" from the non-goal and "Open question Q1" from R6 (a press after handling starts a new thread).

### RF9. The questions part cites the wrong requirement numbers

- **severity:** minor
- **kind:** defect
- **where:** [questions.md](parts/brief/questions.md), lines 24 to 26
- **what:** "Chosen by the brief" cites R3 for click-is-commit, R8 for the answer staying on the page, and R4 for one answer per group. In the brief those are R4, R13 and R5. R3 and R8 are about pages without groups and pages that are not documents.
- **why:** Ken reads this part to overrule choices. A wrong number sends him to the wrong requirement.
- **fix:** Change the three numbers, and keep the short description beside each, as Ken's rule asks.

### RF10. No section says how we will know it worked

- **severity:** minor
- **kind:** taste
- **where:** between Requirements and UX Notes
- **what:** The brief has no success criteria. The menu bar brief added "How we know it worked" after the same finding (its RF12).
- **why:** Without one, "done" means the requirements pass, not that the lesson queue got easier.
- **fix:** Add three lines. Ken clears the rebuilt lesson queue with one click per lesson and no comment. In the first week no press reaches the agent as the wrong group or the wrong answer, and Ken reports any as a bug on the progress page. Clearing the queue costs fewer agent tokens than clearing it with comments, the measurement from RF1.

### RF11. The document versus website line is fuzzy for a folder Lahe serves

- **severity:** minor
- **kind:** risk
- **where:** R8 (only a page Lahe renders or serves as a document carries live groups), line 76; Non-Goals, line 29
- **what:** Lahe's own static server now serves any folder of HTML, which can be a small website, and R8 promises existing buttons are untouched only on "any other page".
- **why:** A builder could read R8 as allowing the layer to claim clicks on a document page more broadly. The product brief's commitment is that links, buttons, forms and scripts behave as they did before Lahe.
- **fix:** Say in R8 that on every page, documents included, Lahe claims only clicks on a choice group's own buttons, and every other link, form, button and script behaves as before. Say which side a folder served by `lahe review <folder>` falls on.

### RF12. R1's last sentence is not testable as written

- **severity:** minor
- **kind:** defect
- **where:** R1, line 46 ("an agent gets it right from that text alone")
- **what:** There is no stated check for "gets it right".
- **why:** Ken put the authoring agent first, so this is the requirement most worth proving, and as written it passes on the builder's say-so.
- **fix:** Make it a check: "A fresh agent given only the installed skill and catalog writes a working choice group page on its first try." The plan can own running it once.

### To delete at cleanup

Nothing. This review created one file, this one.
