# PM review: Menu bar app brief

Reviewed: [01_brief_menu_bar_app.md](01_brief_menu_bar_app.md) and its leaf [parts/brief/questions.md](parts/brief/questions.md), against [the crucible](00_crucible_menu_bar_app.md).

## Summary

The brief is faithful to the crucible and mostly the right size. The menu half (what is open and who is connected) is close to ready. The icon half is not: the count it promises can be wrong in the most common case, and on the first day.

Four things to fix before architecture:

- RF1: "looked at" counts a background tab as looking, so the count would mostly read zero for the very case it exists for.
- RF2: on the day it is installed, the count would include every old review on the machine.
- RF3: when the app cannot get an answer, it shows the plain mark, which reads as "nothing waiting". That is a wrong count.
- RF4: a question Ken does not want to answer has no way to clear.

Scope against the crucible is fine. The small additions (listing the documents behind "waiting on agents", offering to start a stopped helper, clicking a session to open its document) are cheap and fit the two jobs. No settled decision is reopened here.

## Findings

Ranked worst first.

### RF1. "Looked at" counts a background tab as looking

- **severity** high
- **kind** defect
- **where** R5 (answered since you looked), Solution Outline step 2, questions.md "When an answer counts as seen"
- **what** An answer counts as seen when a page of that review is open in the browser after it arrives, and an open background tab meets that rule.
- **why** Ken keeps many tabs open, and since stable addresses a review tab stays open for days. When an agent answers into a tab that is already open, the rule is met the moment the answer lands, so the count rises and clears within seconds without Ken seeing anything. The count stays at zero in exactly the case the feature is for. The brief's own evidence (review r5c67aef9754a, where Ken missed an answer) may well have been this case, and the brief does not check it. A smaller hole sits beside it: for a review that covers a folder, opening any page clears answers that arrived on a different page.
- **fix** Define "looked at" as: the page that holds the answer was the visible tab, in the window in front, after the answer arrived. Say "the page that holds the answer", not "a page of that review". Add a check that the rule would have caught both reviews named in the Problem section. If the architecture finds Lahe cannot know this for certain, then by the crucible's own premise (a wrong count is worse than none) the answered half of the count should not ship in the first version, and the brief should say that fallback now.

### RF2. The first-day count includes every old review

- **severity** high
- **kind** defect
- **where** R4 (an unanswered question), R5 (answered since you looked), R3 (the count is right)
- **what** Neither rule says which reviews are in scope, so every agent answer and every question ever recorded on the machine counts.
- **why** No "looked at" mark exists for any answer before this ships. The first count Ken sees would include months of old answers and old questions from closed sessions, retired reviews, and files that have since been deleted. A first count of dozens teaches him to ignore the number, which is the failure the crucible names ("ignored within a week").
- **fix** Add a requirement that sets the scope. A suggested rule: only answers and questions that arrive after the icon is installed count, and nothing counts from a retired review or a review whose file is gone. Say separately what happens to a question in a closed session (counts, or does not), since the agent that asked it may be gone. Say how a waiting document whose file is gone appears in the menu: listed with "file gone", and a click opens it in the Library rather than a broken page.

### RF3. An error must never look like "nothing waiting"

- **severity** high
- **kind** defect
- **where** R1 (the icon shows the count), R2 (the helper is not running)
- **what** The plain Lahe mark means "nothing waiting", and the brief gives a different look only to "helper not running".
- **why** Many failures are not "not running": the helper refuses the app's request, the app's permission is stale after a helper restart, the helper and app are different versions, the Mac just woke and the last answer is old. In each of those, an app that falls back to the plain mark, or keeps showing an old number, is showing a wrong count, and nothing tells Ken.
- **fix** Add a requirement: whenever the app does not have a fresh answer from the helper, the icon shows a distinct "don't know" look, never the plain mark and never the last number. The menu says why in one line. Give "fresh" a number, for example an answer from the last 15 seconds. Keep R2 (not running) as one case of this.

### RF4. A question Ken will not answer cannot be cleared

- **severity** high
- **kind** defect
- **where** R4 (an unanswered question): "until he answers or the card moves on"
- **what** "The card moves on" is not defined, and dismissing a card is a board item that has not been built.
- **why** R3 (the count is right) calls a count that never clears a bug. A question Ken has decided to ignore, or one asked by an agent that has since gone, has no way off the count except answering it. That builds a permanent floor under the number.
- **fix** List every event that clears a question, in plain words: Ken replies on the card, Ken rewords it, Ken deletes it, the agent replies on it again, or the review is retired. Then decide what Ken does with a question he will not answer. Either it stays and the brief says so, or the brief names card dismissal (board row for dismissing a card) as something this feature needs first. That second option is Ken's call, since he ranked dismissal below this work.

### RF5. What the icon's number counts is not defined

- **severity** medium
- **kind** defect
- **where** R1 (the icon shows the count), R6 (waiting on you comes first)
- **what** The brief calls it "a count" but does not say whether it counts documents or individual questions and answers.
- **why** The menu row shows "1 question" or "3 answered", so a document with three answers could make the icon read 1 or 3. A tester cannot pass or fail R1 without knowing which, and two builders will pick differently.
- **fix** State it. Recommended: the number is how many documents are waiting on Ken, which matches one row per document in the menu. The reasons stay on the rows.

### RF6. Architecture decisions are in the brief, including one assigned to the security review

- **severity** medium
- **kind** defect
- **where** Solution Outline step 1 ("with the same proof of permission the `lahe` command already uses"), steps 3 and 4, UX Notes ("template image"), Analytics, questions.md "Open"
- **what** The brief decides how the app proves its permission, while the crucible and the brief's own open question leave that to the architecture and a security review.
- **why** The architecture starts with the answer already written down, so the security review is reviewing a choice rather than making one. Step 1's wording, "any program on the computer could read it", also reads as the opposite of R19 (only Ken's own programs can read the summary). The other leaks are smaller but have the same effect: asking "every few seconds", "a few hundred lines of Swift with no outside packages", "Apple's compiler", "template image", and the helper's per-request logging policy are all choices about how to build it.
- **fix** Rewrite step 1 as "Only programs Ken runs can read it; how they prove that is decided in the architecture, with a security review." Move the polling interval, the Swift size, the compiler, the template image and the logging policy to the architecture. Keep the product facts they stand for: the app is built on Ken's Mac with no outside packages, it adapts to a light or dark menu bar, and it adds no noise to the helper's log.

### RF7. "Show all in the Library" leads to a page that does not show the list

- **severity** medium
- **kind** defect
- **where** UX Notes ("a 'Show all in the Library' item when there are more"), R6 (waiting on you), R8 (what is open and who is connected)
- **what** The Library has no "waiting on you" view (its "waiting" is comments waiting on agents) and does not list open review pages.
- **why** With many documents, the most urgent list is cut short and the overflow link sends Ken to a page where those documents are not marked. That breaks the first job ("one click gets him there").
- **fix** Never cut the "waiting on you" list. Offer "Show all in the Library" only for sections the Library actually shows: recent documents and sessions. For open documents, show the count and say "and N more" without a link. Adding a waiting-on-you view to the Library would be new scope and belongs on the board, not in this brief.

### RF8. Clicking a document from the menu can send work to an agent

- **severity** medium
- **kind** risk
- **where** R6, R7, R8 ("opens it at its address") against R9 ("the same way the Library's Open does: same address, same rules")
- **what** The brief uses two different rules for a click, and the Library's Open, which R9 adopts, asks an attached agent to pick up a document Lahe cannot open by itself.
- **why** A click in a glance menu could quietly queue work for an agent. That sits uneasily with "agents do not change how they work" and will surprise Ken.
- **fix** Use one rule for every click in the menu: open the document the way the Library's Open does, but never ask an agent to do anything. A row Lahe cannot open directly opens the Library at that row instead. Also say plainly that a click opens a new tab even if the document is already open in one, so that is a known limit rather than a bug report.

### RF9. "One lahe command" brings back a hidden icon, but which one?

- **severity** medium
- **kind** defect
- **where** R14 (the icon starts at login and comes back after Hide)
- **what** "Running `lahe install` again, or one `lahe` command, brings a hidden icon back" can be read as any command.
- **why** Agents run `lahe` commands all the time. If any of them restores the icon, Hide is undone within seconds and Ken cannot keep it hidden.
- **fix** Name the one command Ken runs to bring it back. Say Hide lasts until the next login or that command, and that no agent command brings it back.

### RF10. Updating Lahe: no trigger, and only one direction of mismatch is covered

- **severity** medium
- **kind** defect
- **where** R15 (updating Lahe keeps the icon working)
- **what** The brief says the app is rebuilt after a `git pull` "without Ken having to remember" but not what sets it off, and it covers only an app older than the helper.
- **why** A pull does not run anything by itself, so the requirement cannot be tested as written. The common case after a pull is the reverse one: a new app talking to a helper still running the old code until it restarts. A rebuild can also fail, for example if Apple's command line tools were removed.
- **fix** State the trigger in Ken's terms, for example "the next time the helper starts after an update, it rebuilds and restarts the app". Say both mismatches (older app, older helper) show the "don't know" look from RF3 with a one-line reason, and that a failed rebuild keeps the old app showing that reason and writes the error to the log.

### RF11. "Stop Lahe until next login" will not stop it while agents are connected

- **severity** medium
- **kind** risk
- **where** R11 (Quit has two items), questions.md "can be undone early by an agent"
- **what** The brief keeps Ken's label but lets any agent's `lahe` command start the helper again.
- **why** A listening agent checks in constantly, so with any agent connected the helper comes back within seconds. Ken clicks a menu item that says it stops Lahe and sees it running again, which reads as a bug.
- **fix** Keep the label Ken chose. When agents are connected, show one line under it: "2 agents are connected and will start Lahe again." Add that to R11 so it is tested.

### RF12. No way to tell whether it worked

- **severity** medium
- **kind** defect
- **where** Missing section (no success criteria)
- **what** The brief has requirements but no success measure, and the crucible's main risk (a wrong count gets ignored) has no check.
- **why** Without a stated test of success, nobody decides later whether the count earned its place or should be pulled back to the plain menu.
- **fix** Add a short success section. Suggested: over the first two weeks of Ken's use, every wrong count he sees is logged as a bug, and the target is none; Ken no longer learns about an agent's answer by chance. Add a fallback: if the count is wrong more than once in that window and the cause is not fixed, the icon stops showing a number and the menu stays.

### RF13. "Who is connected" leaves out working agents, and "open" is not defined

- **severity** medium
- **kind** defect
- **where** R8 (what is open and who is connected)
- **what** The menu lists only listening sessions, and "open documents" has no definition.
- **why** The Library already treats an agent with no monitor but a recent command as working, and that agent is connected too. Leaving it out hides some of the strays the second job is meant to find. Without a definition of "open", the count cannot be tested.
- **fix** List listening and working sessions, marked the way the Library marks them. Define an open document as a review page open in a browser right now, as the helper sees it.

### RF14. Two requirements need numbers to be testable

- **severity** low
- **kind** defect
- **where** R3 (the count is right), R18 (light when idle)
- **what** "Within a few seconds" has no number, and R18 does not say what state to measure against.
- **why** A tester cannot fail "a few seconds". An idle measurement on a test folder with three reviews would pass easily and say nothing about Ken's machine, which holds hundreds.
- **fix** Give R3 a number, for example 10 seconds to rise and to clear. Say R18 is measured on a copy of Ken's real state folder.

### RF15. Small leftovers

- **severity** low
- **kind** taste
- **where** Rollout ("or a flag that adds only the icon"), UX Notes (staff design eye line), Problem section second paragraph
- **what** One undecided choice, one process step, and one claim with no evidence.
- **why** The flag is left half-decided, the design review step is plan material, and "open documents and listening agents pile up across a day" is stated as observed pain when the crucible found no evidence for it.
- **fix** Decide the flag (yes or no). Move the design review line to the plan. Reword the Problem paragraph to say the second job is Ken's request, not something the board shows.

## Cleanup needed

None.
