# Reviews: LAHE Library brief

## PM Review (Round 1)

**Short version:** The brief is faithful to the crucible and mostly free of build detail. Three blockers:

- The Library can die under Ken the same way his tabs do today.
- R9 (opening a dead worktree document from the main repo) contradicts R19 (only serve files already under review).
- Pick this up can take a whole session away from an agent that is still working on it.

The rest are gaps a user would hit in the first week, plus a few wording fixes.

Two context notes. `docs/ongoing/PRD.md` does not exist in this repo, so there was no product bar to check against. `docs/diagrams/INDEX.md` does not exist either; I read `docs/diagrams/README.md` and `session_ownership.md` in its place.

### RF1. The Library and every document it opened stop when the last agent session closes

- **severity:** blocker
- **kind:** defect
- **where:** R8, R16, Non-Goals ("Not starting the helper at login"), job 4 in the crucible
- **what:** The skill tells every agent to close its session when a review ends, and closing the last open session stops the shared helper. The brief never says what happens to the Library, or to documents opened from it, at that moment.
- **why:** Ken reads a document opened from the Library while no agent is running, which R8 says is supported. Then some other agent finishes its review and closes its session. The helper stops, and the Library tab and every document tab it opened go dead. That is the dead-tab problem this feature exists to fix, and job 4 ("close a tab without worrying") fails with it.
- **fix:** Add a requirement: "While the Library or a document opened from it is open in the browser, LAHE keeps serving them, even after the last agent session closes." If Ken would rather accept the helper stopping, say so as a non-goal, and have the page tell him plainly that LAHE has stopped, instead of showing a browser error.

### RF2. R9 and R19 contradict each other

- **severity:** blocker
- **kind:** defect
- **where:** R9 (dead worktree document opens from the main repo), R19 (Open serves only files already under review)
- **what:** The main-repo copy of a worktree file was never under review, so R19 forbids exactly what R9 requires.
- **why:** The architecture will have to pick one. Either the worktree fallback is dropped, or the safety rule gets quietly widened with no one having decided how far.
- **fix:** Reword R19: "Open serves only a file that was under review, or, for a worktree that no longer exists, the file at the same path in the repository that worktree belonged to. Nothing else." Then add to R9: "The page tells Ken it is showing the main repository's copy, which may differ from the version he reviewed." A merged builder's file is usually the same, but an abandoned worktree's is not, and old comments may not line up with the text.

### RF3. Pick this up can take a whole session from an agent that is still working

- **severity:** blocker
- **kind:** risk
- **where:** R12, R13, AI Behavior ("Never ... take over a session he didn't point at")
- **what:** A takeover moves the whole session, with every review in it, and stops the old agent's monitor. Clicking one row points at one document, not at the session or at the other documents inside it.
- **why:** Ken clicks Pick this up on a document that another agent is actively answering. That agent is cut off mid-work, and several other documents move with it without Ken knowing. The AI Behavior rule does not stop this, because the click counts as pointing.
- **fix:** Add two requirements:
  - "Each row shows whether an agent is watching that document right now, and which one."
  - "Pick this up and Launch a new agent on a document that a live agent is watching ask Ken to confirm first. The confirmation names that agent and lists the other documents that move with it."

### RF4. It is not defined which agent receives Pick this up

- **severity:** important
- **kind:** defect
- **where:** R12, R13, R14, R16
- **what:** R12 sends Pick this up to "the agent that opened the Library." R16 lets Ken open the Library from a bookmark, which no agent opened. Over a day, several agents may each have opened the Library too.
- **why:** From a bookmark, the page either has no target or picks one Ken cannot see. The work lands in the wrong chat, or the fallback in R14 (no agent listening) fires every time he uses the bookmark.
- **fix:** Add a requirement: "Before Ken clicks, the page names the agent that will receive Pick this up and Launch a new agent. When no agent is attached, the buttons say so ahead of time, not after the click." Leave how an agent attaches to the Library to the architecture, and add it to Open Questions.

### RF5. A document opened without an agent takes comments that reach nobody, silently

- **severity:** important
- **kind:** risk
- **where:** R8, User Stories ("open a past document ... so that I can read and comment on it right away")
- **what:** Open works without an agent, but nothing says what happens to a comment Ken leaves on that document before someone picks it up.
- **why:** The skill's first gotcha is that "comments on a page ... reach nobody" is the failure users hate most. Ken writes three comments, waits, and gets no answer, with nothing on screen telling him why.
- **fix:** Add a requirement: "When no agent is watching a document opened from the Library, its rail says so, keeps Ken's comments, and offers Pick this up and the paste-in prompt from the rail." Change the user story to "read it right away, and comment knowing when an agent will see it."

### RF6. "Open right now" means three different things

- **severity:** important
- **kind:** defect
- **where:** R3, Solution Outline step 3
- **what:** The phrase could mean the document is being served, is open in a browser tab, or has an agent watching it. These are three separate states.
- **why:** Ken uses this column for two decisions: "can I close this tab" and "is an agent on it." A single ambiguous flag answers neither, and each builder will pick a different meaning.
- **fix:** Replace it with two plain signals: "being served now (Open will reuse it)" and "agent watching (and which one)." Tie the second to RF3. Drop "open in a tab" unless the wireframe finds a way to show it.

### RF7. The page never says a click was received, and a double click can launch two agents

- **severity:** important
- **kind:** defect
- **where:** R12, R13, AI Behavior ("one agent per click")
- **what:** Pick this up goes to the agent "as ordinary work," so the agent may be busy for a while. Nothing on the page shows the request is waiting, and nothing stops a second click.
- **why:** Ken clicks, sees nothing, and clicks again. With Launch, "one agent per click" then means two agents on one session, and the second one fences the first.
- **fix:** Add a requirement: "After Pick this up or Launch, the row shows that the request is waiting, then which agent took it. A second click on the same row while one is waiting does nothing and says so."

### RF8. The rule that the page never starts a program itself is missing

- **severity:** important
- **kind:** risk
- **where:** R13, R14, Non-Goals
- **what:** Crucible premise 2 settled that "the page itself never starts anything," and the crucible's open question left the no-agent case open. The brief implies the answer in R14 but never states the rule.
- **why:** The architecture phase could reopen "the helper launches an agent itself" as the easy fix for the no-agent case. That is the riskiest thing this feature could add, and nothing in the brief would stop it.
- **fix:** Add a non-goal: "The Library page and the helper never start an agent or any other program. Only a running agent does, on Ken's click." Mark the crucible's no-agent question as answered by R14.

### RF9. The AI Behavior section decides the architecture: the Library has a rail

- **severity:** important
- **kind:** defect
- **where:** AI Behavior (the "Library's rail" appears twice), Open Questions
- **what:** Replying `not_handled` "on the Library's rail" assumes the Library is itself a review in an agent's session. That is Approach A's shape, which Ken rejected. The section also names internal steps like "arms its wake channel" and "drains the catch-up list."
- **why:** The architect will read this as a settled design choice. It also mixes build steps into a product doc, and the skill already owns those steps.
- **fix:** Say it at product level: "The agent tells Ken, on the Library page, which document it picked up or where it launched the new agent. On failure, the page shows the reason and the paste-in prompt." Replace the takeover detail with "the agent takes the session over the way the skill describes." Leave how messages reach the page to the architecture.

### RF10. Success metrics disagree with R4, and one is a test, not a metric

- **severity:** important
- **kind:** defect
- **where:** Success Metrics, R4, Analytics / Logging
- **what:** R4 keeps one day's volume scannable. The metric promises one screen for a whole week, which is 100 or more documents at Ken's pace. "Zero requests from other origins" is a test result. The Analytics section says the log records actions, then says the metric is checked by asking Ken, so the log checks nothing.
- **why:** A metric that contradicts a requirement cannot be passed. A metric with no measurement cannot be failed. Neither tells Ken whether the feature worked.
- **fix:**
  - Align the find metric with R4, or state it as a task: "Ken finds any document from the past week, given a description of it, without typing a search."
  - Move the cross-origin line into R18 as its acceptance test.
  - Add one metric the log can answer, produced by a script from the log: "After two weeks, how many Opens per working day, and how many of them were documents older than the default view." A number near zero means the Library is not replacing tabs.

### RF11. No user story or requirement covers the "stop feeling buried" job

- **severity:** important
- **kind:** defect
- **where:** User Stories; crucible job 3
- **what:** The crucible names four jobs. Stories cover finding a document, opening it, and closing tabs safely. Nothing covers "the pile should feel smaller, not just be listed."
- **why:** The wireframe will be judged on scannability alone. The volume job is the one Ken used his strongest words about ("overwhelmed").
- **fix:** Add a story: "As Ken, I want the Library to show me what still needs me (documents with waiting comments, starred ones) before the rest, so that the pile feels finite." Give it a requirement the wireframe must meet: "The default view separates documents that need Ken from documents that don't."

### RF12. R7 (hide missing files) has no answer for the worktree case or for Open on a hidden row

- **severity:** minor
- **kind:** defect
- **where:** R7, R9
- **what:** A document whose worktree is gone but whose main-repo copy exists is "missing" under R7 and "openable" under R9. When Ken shows a truly missing document, nothing says what Open does.
- **why:** Rows Ken could open get hidden, and a revealed row offers a button that fails.
- **fix:** Reword R7: "A document is missing only when neither its file nor its main-repository copy exists. Missing documents are hidden by default, with a way to show them. On a missing row, Open is unavailable and says why. Star still works."

### RF13. Open can create the split-comments tab the skill warns about

- **severity:** minor
- **kind:** risk
- **where:** R10
- **what:** R10 reuses the running server, but Open still opens a new tab, even when the document is already open in another tab.
- **why:** The skill's second gotcha is that two tabs on one document split the comments. The Library would make that easy.
- **fix:** Add to R10: "When the document is already being served, the page says so and warns that a second tab splits the comments." Leave whether it can bring the existing tab forward to the architecture.

### RF14. The crucible asked for launched agents to have a recognizable name; the brief dropped it

- **severity:** minor
- **kind:** defect
- **where:** R13, Open Questions item 3
- **what:** The crucible's open question includes "whether the new agent gets a name you can recognize." The brief's open question leaves it out.
- **why:** After three launches Ken has three terminal windows and cannot tell which is which. That is the same naming problem this feature solves for documents.
- **fix:** Add it back to Open Questions, or add to R13: "The launched agent's session is named after the document, so the rail and `lahe session list` show a name Ken recognizes."

### RF15. R5 is written in internal history, and it presumes the answer to "what is one row"

- **severity:** minor
- **kind:** taste
- **where:** R5
- **what:** "The old one-review-per-page registration" means nothing to a reader who wasn't there. "Show together" quietly settles part of Open Question 1 (what is one row).
- **why:** Ken has to decode it, and the wireframe is told the answer before it asks the question.
- **fix:** "Reviews from before Sep 16, when each page in a folder got its own review, appear as one document, the way they would be recorded today. How that shows as rows is settled with Open Question 1."

### RF16. Cut the rollout's compatibility note

- **severity:** minor
- **kind:** taste
- **where:** Rollout / Flags ("older helpers ignore it")
- **what:** How older helpers treat a new stored field is build detail.
- **why:** It adds nothing Ken needs, and the architecture owns it.
- **fix:** Keep "No flag. It works on the full history from the first run." Drop the last sentence.

### RF17. Search leaves out the agent session name

- **severity:** minor
- **kind:** taste
- **where:** R6, Non-Goals ("Search covers what a row shows")
- **what:** Rows may be grouped by agent session (Open Question 1), and sessions now carry a human name. R6 does not search it.
- **why:** Ken often remembers the agent ("the style systems one") better than the file. If the wireframe shows session names, the non-goal promises they are searchable and R6 does not deliver.
- **fix:** Change R6 to "title, file name, folder, and agent session name," or to "everything a row shows," so the wireframe's choice carries through.
