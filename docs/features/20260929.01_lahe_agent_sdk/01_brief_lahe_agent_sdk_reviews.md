# Reviews: LAHE agent that cannot forget, brief

Brief under review: `01_brief_lahe_agent_sdk.md`. Inputs the reviewer read: the brief, the crucible and research in this folder, `docs/ongoing/SESSION_OWNERSHIP.md`, `docs/CONTRACTS.md`, and the review rules in `src/shared/review_format.js`. There is no `docs/ongoing/PRD.md`, `docs/ongoing/BRAND.md` or `docs/diagrams/INDEX.md` in this project.

Line numbers below refer to the first draft (commit bf798a1). The dispositions are in the brief's PM Review table.

## PM Review (Round 1)

RF1 to RF17, worst first. Three need fixing before the architecture starts: the cost gate (RF1), the shared usage limit (RF2), and the missing cheaper-fix comparison (RF3).

### RF1. The cost gate can never trigger

- severity: blocker. kind: defect.
- where: Rollout (line 256), Summary (line 11), and the "Cost the owner accepts" metric.
- what: The brief says the work goes back to the owner "if a run costs more than the owner accepts." But no limit exists, and the owner is not being asked until the whole doc set is written.
- why: The architecture and plan will be written on top of an unmeasured cost. The one condition the crucible said could stop the feature has no number attached.
- fix: Add an assumption that sets a stop line, taken from the spike's own numbers once they land. For example, "one run uses no more than X of a usage window, and a day of dogfood uses no more than Y." Then say the architecture goes ahead under that assumption and the spike numbers go on the owner's page next to Q1 (billing). Don't write in a number that no measurement produced.

### RF2. Runs use up the same limit as the owner's other agents, and the brief does not say so

- severity: blocker. kind: risk.
- where: Q1 (billing), Safety and cost (R21 usage is visible), User & Context.
- what: A background run draws on the same subscription limit as his other Claude sessions (21 were counted on 2026-09-22). The brief has no ceiling on that usage.
- why: One busy review could lock him out of all his other work until the limit resets. Under R16 (failures are visible) that shows up as a "failure", when it is really harm done by the feature itself.
- fix: Add a requirement: "The user can set a usage ceiling for the mode. When runs reach it, no new run starts, items stay waiting, and the rail says why." Rewrite Q1 to name the shared-limit effect in plain words.

### RF3. The brief drops the crucible's case against building this, and the cheaper fix that goes with it

- severity: important. kind: risk.
- where: Context (lines 21 to 27), Non-Goals (line 60), Q6 (the small chat fix).
- what: Two of the three pains listed have cheap fixes the brief pushes out of scope. The memory kills stop with one setting. The repeated rule text shrinks with a banner trim. That leaves "the agent forgets a step", which has no measured rate.
- why: The crucible said what would change its mind: measure the forgetting rate after the setting and a stop-the-turn hook are in place. The brief makes that hook a side question instead of the test that decides whether this feature is needed. The owner reads a brief that looks surer than the evidence supports.
- fix:
  - In Goal / Problem, say that after the cheap fixes, the pain left is agents ending a turn with work open, and that nobody has counted how often.
  - Reframe Q6 as a sequencing question: "Ship the small chat fix first and count forgotten items for N reviews before building this mode?"
  - Keep the Non-Goal, but point it at Q6.

### RF4. The Summary never answers the question the owner asked

- severity: important. kind: defect.
- where: Summary (lines 5 to 11).
- what: He asked whether the Agent SDK would do this. The Summary never says the SDK was rejected. That only appears in Context.
- why: He reads the first lines and stops. A folder named `lahe_agent_sdk` with a summary that never says "SDK" reads like the brief ignored his question.
- fix: Open the Summary with one line: "Not the Agent SDK: it needs an API key, per-token billing and an install. The same job works through your agent's own headless mode on your existing login. See Q7 (whether to close the SDK path for good)."

### RF5. Whether the subscription terms allow this is treated as an assumption, but it is a fact that needs checking

- severity: important. kind: risk.
- where: Assumption 2, and R2 (no new bill).
- what: The brief assumes script-started headless runs on a subscription are "within its terms." The spike measures usage, not terms.
- why: If the terms limit automated use of a subscription, the launch audience (and possibly the owner) cannot use the feature as briefed. Nothing currently in the plan would find that out.
- fix: Move it out of Assumptions and into a "to verify before architecture" line, checked against Anthropic's published terms with a link to the source. Say that the feature's premise depends on it.

### RF6. Anyone who can comment on the page can now make an unattended agent act

- severity: important. kind: risk.
- where: R6 (say what it may do), R19 (page text is data), R20 (stays in scope).
- what: R19 covers text copied off the page. It does not cover the comments themselves, which are instructions by design. With the mode on, every comment turns into edits and commands on the user's machine with nobody watching.
- why: Today a person reads each comment in chat before the agent acts. This mode removes that step. The warning in R6 does not tell the user that whoever has the review link can now make an agent act on their machine.
- fix: Extend R6: "The warning says that anyone who can comment on this review can make the agent edit and build within the allowed list." Add a sentence to R19 asking the security review to cover comments as well as page text.

### RF7. Nothing limits runs across the whole machine, and his machine is already short of memory

- severity: important. kind: risk.
- where: R11 (at most one run per session), User & Context (line 75).
- what: R11 caps runs per session. The owner runs many sessions, and each run is a full agent process.
- why: A burst across three reviews starts three agents at once, on the same memory pressure the brief names as a cause of today's pain.
- fix: Add a requirement: "Runs across all reviews on the machine are limited. A review waiting its turn shows that on the rail." Leave the number to the architecture.

### RF8. The ownership rules contradict each other and ignore the handoff the tool already has

- severity: important. kind: defect.
- where: R17 (one owner at a time), R18 (hand it back), Q3 (who owns the review), Assumption 9.
- what: Assumption 9 already settles "one owner." R17 then sends "which one yields" to Q3, and Q3 asks "if both are active, which one answers."
- why: The owner gets asked a question the brief has already answered. The tool already has a rule for one owner per session and for handing a session over (`docs/ongoing/SESSION_OWNERSHIP.md`), and the brief doesn't mention it, so the architecture may invent a second one.
- fix:
  - Rewrite R17 and R18: the mode owns the review the same way any agent does today, and moving between the mode and a chat agent uses the existing session handoff, with the same promises.
  - Drop Q3, or narrow it to: "When the mode is on, should the chat agent be told it no longer owns the review?"

### RF9. R5 guards against the wrong partial state

- severity: important. kind: defect.
- where: R5 (turn it off).
- what: It promises no half-written reply. The real risk is a source file edited with no reply at all.
- why: The reviewer sees a changed page and a card still waiting. The next run may make the same edit again on top of the first.
- fix: "When a run is stopped, every item it did not reply to stays waiting. A change it made without replying is named on that item's card, so the next run or the reviewer can see it."

### RF10. R10 and the "Correct replies" metric claim a check that only covers hand edits

- severity: important. kind: defect.
- where: R10 (same standard as today), and the "Correct replies" metric (line 232).
- what: The existing "handled" check applies to hand edits only (`docs/CONTRACTS.md` line 625). Replies to comments are never checked.
- why: For most cards, the only quality check is "the owner agrees with each answer." The metric reads as if the tool checks them.
- fix: Say it directly: "Replies on hand edits pass the existing check. Replies on comments are judged by the owner, card by card, in the dogfood review."

### RF11. The open questions mix questions that shape this brief with separate decisions

- severity: important. kind: taste.
- where: Open Questions (Q1 to Q9).
- what: Q5 (the memory-kill setting) and Q8 (priority against the red main gate, open security rows and the npm launch) don't change a single requirement. Q9 (the on switch scope) is low stakes and already has an assumption.
- why: The owner reads these all at once while juggling other work. The two or three questions that actually decide the feature get lost.
- fix: Split into two lists:
  - "Decides this feature": Q1 (billing), Q2 (how much chat context runs get), Q4 (permissions), and the reworked Q6 from RF3.
  - "Separate decisions": Q5 (memory-kill setting), Q7 (the SDK), Q8 (priority).
  - Remove Q9 and let Assumption 8 (per-session switch) stand, unless the owner overturns it.

### RF12. Who the first version is for is unclear

- severity: important. kind: risk.
- where: User & Context (line 77), User Stories (lines 86 and 87).
- what: The launch audience is described as spread across four hosts. The first version is Claude Code only, yet a user story says "on any host."
- why: This decides whether unattended edits reach strangers at the launch, or only the owner during dogfood. That changes how much the permissions warning and the security review have to cover.
- fix:
  - State it: "First version: the owner, as dogfood. Offered to launch users only after the success metrics pass."
  - Change the story to "As a Claude Code user."

### RF13. R2 and "no new bill" are not true for everyone

- severity: minor. kind: defect.
- where: R2 (no new bill), and the third user story.
- what: A Claude Code user billed through an API key pays per token for every run.
- why: The feature promises something it can't keep for that user.
- fix: "Runs use the login the agent already has. LAHE adds no key of its own. For a user billed per token, the permissions warning says each run costs money."

### RF14. Some success metrics are missing

- severity: minor. kind: defect.
- where: Success Metrics.
- what: None of them checks:
  - that R17 holds (no item answered twice)
  - how often runs fail, or how many items hit the retry limit
  - how long a reviewer waits from "ready" to a reply
- why: Those three are what the owner would actually notice going wrong.
- fix: Add:
  - "Zero items answered twice in dogfood."
  - "Record run failures and retry-limit hits per review."
  - "Record ready-to-reply time per item. The owner judges it after seeing the numbers."

### RF15. Stopping a misbehaving mode needs a terminal

- severity: minor. kind: risk.
- where: UX Notes (line 244).
- what: The mode can only be turned off by the user or their chat agent. A switch on the page is left to the wireframe.
- why: The reviewer is the one who sees a run going wrong. The goal of the whole brief is that he doesn't have to go back to a terminal.
- fix: Add a requirement: "The reviewer can stop the mode from the page." Leave its look to the wireframe.

### RF16. The permissions question leaves out what the owner would care about most

- severity: minor. kind: defect.
- where: Q4 (permissions).
- what: It lists editing and building. It leaves out committing, pushing, and reaching the network.
- why: The owner commits often. Whether an unattended run commits its edits is something he will notice straight away.
- fix: Add to Q4: "May it commit its changes? Push? Reach the network?"

### RF17. Jargon, implementation detail and personal detail in a public repo

- severity: minor. kind: taste.
- where: line 44, line 255, Q2 (context), lines 70 to 73, lines 17 and 25.
- what:
  - Line 44 uses "the drain" and "the handled check" without saying what they are.
  - Line 255 is process detail (which docs change in what order).
  - Q2 is worded in mechanism terms ("fork", "continuing session").
  - Lines 70 to 73 put the owner's ADHD in a repo that is public on GitHub.
  - The two quotes from the owner have no link to where he said them.
- why: The terms slow a reader at zero. The health detail doesn't belong in a public doc. Unlinked quotes break the global quote rule.
- fix:
  - Say what each term does in plain words ("the list of waiting items", "the check that a hand edit really reached the page").
  - Move line 255 to the architecture.
  - Reword Q2 as "How much of the chat should each run know: all of it, only this review's history, or just the handoff note?"
  - Replace the ADHD line with "wants fewer things to watch."
  - Link the 2026-09-28 quote to its source note, and the 2026-09-29 quote to its card.
