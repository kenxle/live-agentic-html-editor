No open questions. Ken said the rest should be straightforward and he does not need to be asked, so every call below was made by the brief; he can overrule any of them in review.

Settled with Ken in the crucible (details on [the questions page](00_crucible_questions.md)):

- **Approach B, a choice record.** Ken: "let's do this", and "I think this might be better for token management as well."
- **Documents only, never on a live site.** Ken: "just don't do it on live sites. only docs."
- **The job, in his words:** "Answer a question from the agent quickly and easily."
- **Who it is for, in his words:** "Agent writing the page: instructions must be clear and communication must be good."
- **How identity is carried is architecture, not brief.** Ken on the premise that spelled out an id and a uniqueness check: "this is architecture."
- **No "answer in words" button.** Highlighting and commenting is always available, so it needs no saying.
- **The clickable choice grows out of the option-card component.** Ken: "love this."
- **Agents learn to author it from the lahe skill and the component catalog,** and that skill change is made with the skill-creator skill.

Chosen by the brief, for Ken to overrule in review:

- **A click is a commit (R5).** There is no draft state for a press; it is sent the moment it is made.
- **One answer per group (R6).** A group is a single choice among its buttons. A page that needs several ticks uses several groups.
- **A press after the agent has handled the group is a new thread, not a reopen (R7).** The old thread stays as the record of the earlier decision. The agent undoes and redoes, and says both.
- **No page-level "all as recommended" switch.** An agent that wants one writes one more group and says in its question what it covers. Nothing special is built.
- **The decision lives in the file (R17).** Handling a press includes writing it into the source, so the document shows its decisions with no Lahe present.
- **Presses close together travel together (R13).** The few-second window is the architecture's to set.
- **A broken group is shown to the reviewer, not reported to the agent (R4).** The rail names the group and the reason. An automatic message to the agent was deferred: it would be a new agent-facing channel for an authoring mistake the reviewer can report in one comment. Revisit if agents keep getting the block wrong.
