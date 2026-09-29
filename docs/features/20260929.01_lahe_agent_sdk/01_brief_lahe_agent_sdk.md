# Feature Brief: LAHE starts your agent when a comment is ready

Status: DRAFT, written without the owner. Every guess made on his behalf is listed under Assumptions.

## Summary

**Not the Agent SDK.** It needs an API key, per-token billing, and an install. This brief does the same job with the agent you already have, run with no chat window, on the login you already pay for. Whether to close the SDK path for good is Q7.

What this brief proposes instead is an opt-in mode. LAHE itself starts the user's own coding agent each time a reviewer's comment is ready. Claude Code comes first, run in its headless mode (no chat window). Each run gets LAHE's rules once, at the top. It handles every waiting comment, replies on the cards, and exits. LAHE then checks that nothing was left unanswered.

A measurement spike is running in parallel: one real review, run headless. It measures how much of the subscription each run uses and whether the replies are right. Its numbers go into the architecture. They also set the cost line: if a run uses more than that, this feature stops.

## Context

The owner asked this on a LAHE card:

> "for claude at least, what about the agents sdk. would that allow us to fully automate this stuff without having to repeat these instructions?"

(Recorded in the crucible, under "The idea, as stated", 2026-09-29.)

The crucible in this folder answered that. The Agent SDK is the wrong base for him: it bills per token through an API key, needs an install, and works for Claude only.

The pain behind the question has three parts:

- **The agent forgets a step.** It serves the page and never starts listening, or ends its turn with comments unanswered. On 2026-08-18, 7 items sat unanswered in Codex this way.
- **The watcher gets killed.** Claude Code stops quiet background commands when it thinks memory is low. Each kill costs the agent a turn to restart the watcher.
- **Rules repeat every time new work arrives.** Each time a comment comes in, the agent is shown the same "do not end this turn" text again. The owner: "When you repeat something over and over in the context it starts to mess with the way the agent responds. Those words start to influence the way that the agent writes as well as what they do." (from his notes on trimming the list of waiting items, 2026-09-28)

Every earlier fix added words to the rules, and each one failed the same way. This feature moves the job of waiting for comments out of the chat. LAHE does the remembering, so the agent does not have to.

```mermaid
flowchart LR
  subgraph Today
    A[Reviewer comments] --> B[Chat agent must be listening]
    B -->|forgets, or watcher killed| C[Owner notices silence and prods the agent]
    B -->|listening| D[Agent handles and replies]
  end
  subgraph "With this mode"
    E[Reviewer comments] --> F[LAHE starts a run of the user's agent]
    F --> G[Run handles every waiting item, replies, exits]
    G --> H[LAHE checks nothing is left]
    H -->|something left| F
  end
```

Related work already merged:

- The list of waiting items an agent reads now carries only the reviewer's items, no rules.
- The rules live in the review and are read once.
- LAHE re-renders Markdown by itself.
- When an agent says it handled a hand edit, LAHE checks the edit really reached the page.

## Goal / Problem

**Goal:** nothing a reviewer writes on the page goes unanswered, and nobody has to supervise the agent that answers it.

The owner leaves comments in a burst and moves on to other work. Every comment should be acted on and answered on its card, with the page rebuilt. He should not have to go back to a terminal to prod an agent, and should not have to watch whether one is still listening.

**Two of the three pains have cheap fixes outside this feature.** One Claude Code setting stops the memory kills. Trimming the text repeated each time work arrives shrinks the repetition. What is left is agents ending a turn with work still open, and nobody has counted how often that happens. If a cheap fix to the chat workflow brings that to zero, this mode may not be needed. Q6 asks whether to run that test first.

**The key design question:** can a fresh headless run of the user's own agent, started by LAHE for each batch of work, answer cards as well as the chat agent does, at a cost the owner accepts? The spike answers the cost half and gives a first read on quality.

**First version is for the owner, as dogfood.** It is offered to launch users only after the success metrics pass.

## Non-Goals

::: callout-nongoal
- Not built on the Agent SDK. LAHE adds no API key of its own.
- Not a new default. The chat-agent workflow stays as it is for anyone who does not turn this on.
- Not Codex, Gemini or Antigravity in the first version. The mode should not rule them out.
- Not the separate small fix for the chat workflow (a Claude Code hook that stops a turn ending with work open, plus trimming the text repeated each time work arrives). Whether that comes first is Q6.
- Not setting the Claude Code option that stops the memory kills. It is the user's own setting. The skill already asks them about it.
- Not running anywhere but the user's own machine. No cloud runner.
- Not changing how reviewers comment or edit. The only visible changes are new status wording on the rail and a stop control.
:::

## User & Context

**First, the owner.**

- He runs many agents at once: 21 Claude processes were counted on 2026-09-22.
- He reads while juggling other work, often by voice.
- He pays for a Claude subscription, not API tokens. His other agents draw on the same usage limit.
- He wants fewer things to watch, not more.

He works on a Mac with one browser tab per review and several Claude Code terminals, often across worktrees. He comments in a burst, then leaves for another terminal or task. The machine is often short of memory, which is what sets off Claude Code's kills of quiet background commands. His only view of the agent is the rail's one status line and the reply on each card.

**Later, the launch audience.** People running a coding agent who find LAHE through the npm package and the launch. Assumed to be mostly subscription users too, spread across Claude Code, Codex, Gemini and Antigravity. They get this mode only after the owner's dogfood passes.

## User Stories

- **As the owner**, I want every comment I leave answered on its card without going back to a terminal, so I can comment and move on to other work.
- **As the owner**, I want to stop watching whether an agent is still listening, so a review is one less thing to track.
- **As the owner**, I want this to run on the subscription I already pay for, without starving my other agents, so reviews add no new bill and no lockout.
- **As the owner**, I want the agent to see LAHE's rules once per run, not every time new work arrives, so repeated rule text stops steering how it writes and acts.
- **As a reviewer**, I want the rail to tell me plainly when the background agent has stopped or failed, and to stop it from the page, so silence never looks like work in progress.
- **As a Claude Code user**, I want to turn this on with nothing new to install, so it works from a clone like the rest of the tool.
- **As a cautious user**, I want to know what the unattended agent is allowed to do, and who can make it act, before I turn it on.

## Solution Outline

1. The user opens a review as today, and turns the mode on for that session.
2. From then on, LAHE watches the review itself. No agent has to start or restart a watcher.
3. When a reviewer's item becomes ready, LAHE starts a headless run of the user's own agent, on the user's own login. The run is told LAHE's rules once, at the start.
4. The run handles every waiting item the way a chat agent does today: change the source, rebuild, check the change landed, reply on the card. Then it exits.
5. LAHE checks what is still unanswered. Items that arrived during the run get another run. If runs keep failing to answer an item, LAHE stops retrying it and its card says so.
6. The reviewer sees the same cards and the same rail status line, with plain words for "working", "idle", "waiting its turn", and "stopped".
7. Turning the mode off, stopping it from the page, or closing the session stops it. A chat agent can take the review back through the handoff that exists today.

## Requirements

### Turning it on

::: callout-req
**R1 (off by default):** The mode is off unless the user turns it on. With it off, LAHE behaves exactly as it does today.
:::

::: callout-req
**R2 (no key of LAHE's own):** Runs use the login the user's agent already has. LAHE never asks for or stores an API key. For a user whose agent is billed per token, the warning in R6 says each run costs money.
:::

::: callout-req
**R3 (nothing to install):** The mode works from a plain clone of LAHE. It adds no runtime dependency. It calls an agent the user already has installed.
:::

::: callout-req
**R4 (Claude Code first):** The first version supports Claude Code. Nothing in the mode is specific to Claude Code, so any agent with a headless mode, such as Codex or Gemini, can be added later.
:::

::: callout-req
**R5 (stopping is clean):** The user can turn the mode off at any time, and closing the session also stops it. When a run is stopped, every item it did not reply to stays waiting. A change it made without replying is named on that item's card, so the next run or the reviewer can see it.
:::

::: callout-req
**R6 (say what it may do, and who can make it act):** Before the mode starts, the user is told in plain words what the unattended agent may do without asking. The default is the least that lets it do the job. The warning also says that anyone who can comment on this review can make the agent edit and build within that list. The exact list is Q4.
:::

### Waking and working

::: callout-req
**R7 (LAHE does the listening):** When an item becomes ready, LAHE starts a run. No agent has to start, keep, or restart a watcher.
:::

::: callout-req
**R8 (idle is free):** No run starts while nothing is waiting. An idle review uses no model usage.
:::

::: callout-req
**R9 (one run takes the batch):** A run handles every item that is ready when it starts, not one item per run. A burst of comments leads to a few runs, not one per comment. Items held back by the reviewer's Hold toggle start no run until released.
:::

::: callout-req
**R10 (same standard as today):** A run meets the same bar as a chat agent: it changes the source, rebuilds where needed, checks the change is on the page, and replies. Its replies on hand edits pass the existing check that the edit reached the page. Its replies on comments are not checked by the tool, as today.
:::

::: callout-req
**R11 (nothing is lost):** Items that arrive while a run is going are handled by that run or the next one. At most one run works a session at a time.
:::

::: callout-req
**R12 (a cap on runs at once across the machine):** Runs across all reviews on the machine are limited, so a burst across several reviews does not start many agents at once. A review waiting its turn shows that on the rail. The number is set in the architecture.
:::

::: callout-req
**R13 (retries stop):** After a run exits, LAHE checks for unanswered items and starts another run if any remain. If runs keep leaving an item unanswered, LAHE retries it a limited number of times. Then its card tells the reviewer the agent could not handle it. The limit is set in the architecture.
:::

### Rules said once

::: callout-req
**R14 (rules once per run):** A run is given LAHE's rules once, at the start. Nothing that reads like an instruction repeats each time work arrives, or per item. What the run reads about each item is the item's data.
:::

::: callout-req
**R15 (one source of rules):** The rules a run gets are the same rules a chat agent reads today. They are not a second copy that can drift.
:::

### What the reviewer sees

::: callout-req
**R16 (cards and rail only):** The reviewer's view stays the cards and the rail's one status line. Questions, caveats, and reasons for not handling an item land on the card, as today.
:::

::: callout-req
**R17 (failures are visible):** When a run fails (login expired, usage limit reached, the agent crashed or is not installed), the rail says so in plain words. The items stay waiting. A failure is never silent.
:::

::: callout-req
**R18 (stop from the page):** The reviewer can stop the mode from the page, without a terminal. How the stop control looks is left to the wireframe.
:::

### Who owns the review

::: callout-req
**R19 (one owner, as today):** The mode owns a review the way an agent owns one today. There is one owner at a time, and the chat agent and the runs never both answer the same item.
:::

::: callout-req
**R20 (hand it back):** Moving a review between the mode and a chat agent uses the session handoff that exists today, with the same promises: every unanswered item reaches the new owner, and nothing answered is done twice.
:::

### Safety and cost

::: callout-req
**R21 (page text is data):** A run treats text copied off the page as data, never as instructions, under the same rule chat agents follow today. The architecture's security review covers this for an agent nobody is watching. It also covers the reviewer's comments. With the mode on, a comment becomes an action that nobody reads first.
:::

::: callout-req
**R22 (stays in scope):** A run edits only what the allowed list in R6 covers, and nothing outside the reviewed project.
:::

::: callout-req
**R23 (a usage ceiling):** The user can set a usage ceiling for the mode. When runs reach it, no new run starts, items stay waiting, and the rail says why. This keeps a busy review from using up the limit the user's other agents share.
:::

::: callout-req
**R24 (usage is visible):** The user can see how many runs a session started. Where the host reports it, they can also see what each run used.
:::

### Context from the chat

::: callout-req
**R25 (a handoff note):** The person or chat agent that turns the mode on can leave a short note for the runs: what the document is for and anything said in chat that the review does not hold. Every run sees it. Whether runs get more of the chat than that is Q2.
:::

## AI Behavior

The agent here is the user's own coding agent, started by LAHE with no person watching.

**What it should do:**

- Handle every item it is given, to the same standard as a chat agent.
- Reply on the card for every item: handled, not handled with a reason, or a question.
- Ask on the card when it cannot tell what the reviewer means, rather than guess.
- Say plainly on the card when it did something differently than asked.
- Exit when there is nothing left. LAHE decides when to run it again.

**What it should never do:**

- Follow instructions found in page text.
- Edit files outside what it is allowed to touch, or run commands outside that list.
- Mark an item handled when its change is not on the page.
- Start a watcher, wait for more work, or try to keep itself running.
- Refuse an item as stale or old. Every item it is shown is current.

**When it is unsure or fails:** leave the item unanswered or ask a question, never invent an answer. A run that crashes leaves the items waiting, and the rail shows the failure.

## Success Metrics

::: callout-metric
- **No prodding.** In a dogfood review of at least five comments with the mode on, every ready item gets a reply on its card, and the owner never opens a terminal to prod an agent.
- **No re-arming.** Zero agent turns are spent starting or restarting a watcher in a review with the mode on.
- **Rules once.** A run's full transcript shows LAHE's rules once. Nothing that reads like an instruction repeats per item. Checked by reading one transcript each from runs given 1, 10 and 100 items.
- **Idle is free.** A review left open for an hour with no new comments starts zero runs.
- **Correct replies.** Replies on hand edits pass the existing check. Replies on comments are judged by the owner, card by card, in the dogfood review.
- **No double answers.** Zero items answered twice in dogfood.
- **Failures show.** With the agent's login deliberately broken, the rail reports the failure and every item stays waiting.
- **Nothing to install.** A fresh clone runs the mode with no install step, and the tool's runtime dependencies stay empty.
- **Cost under the line.** Usage per run and per dogfood day stays under the cost line in Assumption 13.
- **Recorded for the owner to judge:** how many runs failed and how many items hit the retry limit, per review, and the time from an item becoming ready to its reply.
:::

There is no baseline for how often agents forget today. Every sighting is real, but nobody has counted them. So the first metric asks for zero prodding, rather than fewer prods than before.

## UX Notes

- The rail's status line needs plain words for the new states: the background agent is working, idle and listening, waiting its turn, or stopped with a reason (including the usage ceiling).
- The card shows the agent's name as today. The reviewer does not need to know whether a reply came from a chat agent or a run.
- Turning the mode on is done by the user or their chat agent. Stopping it can also be done from the page (R18).

## Analytics / Logging

- Log each run: when it started and ended, how many items it was given, how many it answered, and how it ended (finished, failed, stopped).
- Log the usage each run reports, where the host reports it.
- Log each item that hit the retry limit, and each time the usage ceiling stopped a run.

## Rollout / Flags

- Off by default, turned on per session (Assumption 8).
- Dogfood with the owner first. Offered to launch users only after the success metrics pass.
- The review's rules today tell agents not to start a process that runs forever. This mode needs one that keeps running after the chat ends, so that rule has to be changed deliberately.

## To verify before architecture

- **Subscription terms.** The brief assumes a headless run started by a script on the user's own machine may draw on a Claude subscription. The spike measures usage, not terms. This has to be checked against Anthropic's published terms, with a link to the source, before the architecture relies on it. The feature's premise depends on it.

## Assumptions made for the owner

Carried from the crucible:

1. He stays on his subscription and will not pay API rates for this.
2. The usage of each headless run is acceptable. The spike and the cost line in Assumption 13 will confirm it. Whether the subscription terms allow it is checked under "To verify before architecture".
3. The zero-runtime-dependency rule is not up for change.
4. Most cards can be answered by an agent that has the review and the files, but not the chat's history.
5. Claude first, other hosts later, is acceptable.
6. A background agent may edit files and run the project's build without asking each time, inside the reviewed project.
7. The mode is opt-in, not the new default.

Added by this brief:

8. The mode is turned on per session, not as a machine-wide setting or per review.
9. One owner per review at a time is the right rule, using today's session handoff.
10. A retry limit is wanted for items that runs keep leaving unanswered. Its number is left to the architecture.
11. The reviewer does not need to tell a run from a chat agent, beyond the agent name on the card.
12. A short handoff note is enough context for most reviews. If the spike shows otherwise, Q2 (how much of the chat each run gets) decides.
13. **The cost line comes from the spike.** When the spike reports, its usage per run becomes the cost line. The architecture goes ahead as long as runs stay under it. The spike's numbers go on the owner's page next to Q1. This brief sets no number until the spike measures one.
14. The first version is for the owner as dogfood, not for launch users.

## Open Questions

### Decides this feature

::: callout-question
**Q1 (billing):** Background runs draw on the same subscription limit as all your other agents, so a busy review could lock you out of other work until the limit resets. Is that acceptable with a usage ceiling in place? What per-run or per-day usage would be too much? The spike's numbers go beside this question.
:::

::: callout-question
**Q2 (context):** How much of the chat should each run know: all of it (costs more per run), only this review's history, or just the handoff note?
:::

::: callout-question
**Q3 (telling the chat agent):** When the mode is on, should the chat agent be told it no longer owns the review?
:::

::: callout-question
**Q4 (permissions):** What may an unattended agent do without asking: edit only the reviewed document's sources, run the project's build, or run any command? May it commit its changes? Push? Reach the network?
:::

::: callout-question
**Q6 (order):** Should we ship the small chat fix first, then count forgotten items over a few reviews before building this mode? The small fix is a Claude Code hook that stops a turn from ending with work open, plus trimming the text repeated each time work arrives.
:::

### Separate decisions

::: callout-question
**Q5 (the kill setting):** Turn on Claude Code's option that stops the memory kills in your own settings now, separate from this feature?
:::

::: callout-question
**Q7 (the SDK):** Close the SDK path for good, or keep it as a documented option for API-key users later?
:::

::: callout-question
**Q8 (priority):** Does this go ahead of fixing the failing tests on main, the open security items on the board, and the npm package the launch is waiting on?
:::

## PM Review

Full prose in `01_brief_lahe_agent_sdk_reviews.md`.

| # | Finding | Disposition | Rationale |
|---|---------|-------------|-----------|
| RF1 | The cost gate had no number, so it could never trigger | Accepted | Assumption 13: the spike's numbers set the cost line; they go beside Q1 |
| RF2 | Runs share the owner's usage limit with his other agents | Accepted | Added R23 (usage ceiling); Q1 now names the lockout risk |
| RF3 | The crucible's case against building, and the cheaper fix, were dropped | Accepted | Goal / Problem says what is left after cheap fixes; Q6 is now a sequencing question |
| RF4 | Summary never said the SDK was rejected | Accepted | Summary opens with "Not the Agent SDK" |
| RF5 | Subscription terms treated as an assumption | Accepted | New "To verify before architecture" section |
| RF6 | Anyone who can comment can make an unattended agent act | Accepted | R6 warning names it; R21 asks security to cover comments |
| RF7 | No machine-wide limit on runs | Accepted | Added R12, with a "waiting its turn" rail state |
| RF8 | Ownership rules contradicted each other and ignored today's handoff | Accepted | R19 and R20 reuse today's session handoff; Q3 narrowed |
| RF9 | Stopping guarded the wrong partial state | Accepted | R5 now covers an edit made without a reply |
| RF10 | The handled check covers hand edits only | Accepted | R10 and the "Correct replies" metric say so |
| RF11 | Open questions mixed feature-shaping and separate decisions | Accepted | Split into two lists; old Q9 removed, Assumption 8 stands |
| RF12 | Unclear who the first version is for | Accepted | Owner dogfood first; story changed to "a Claude Code user" |
| RF13 | "No new bill" is untrue for per-token users | Accepted | R2 reworded; the warning says runs cost money for them |
| RF14 | Missing metrics for double answers, failures, and wait time | Accepted | Added "No double answers" and a recorded-for-judgment line |
| RF15 | Stopping a misbehaving mode needed a terminal | Accepted | Added R18 (stop from the page) |
| RF16 | Q4 left out commit, push, and network | Accepted | Added to Q4 |
| RF17 | Jargon, process detail, personal detail, unlinked quotes | Partly accepted | Terms explained, ADHD line removed, Q2 reworded, process ordering left for the architecture. Quotes now name where they were recorded; the card itself lives in local review state and has no public link |
