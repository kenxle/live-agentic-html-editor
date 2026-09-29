# Crucible: a LAHE agent that cannot forget

Date: 2026-09-29
Status: DRAFT (ran without the owner; every answer he would have given is an assumption, listed below)

## Summary

- **Recommendation:** do not build on the Agent SDK. Build an opt-in mode where LAHE starts the user's own coding agent headless, with no chat window (`claude -p` first), each time work lands. The rules go in once, in that run's system prompt.
- **Why not the SDK:** it needs an API key and pay-per-token billing, an npm install, and it only works for Claude. The headless CLI does the same job on the user's existing login, with nothing to install, and Codex and Gemini have their own headless modes.
- **Before anyone designs it:** one real review, run headless, to measure subscription usage and reply quality. That result can still sink the recommendation.
- **Separately, today:** Claude Code keeps stopping the idle watcher, and each restart costs a turn. One Claude Code setting stops that. It is the owner's call and needs no feature.

## The idea, as stated

On a LAHE card, 2026-09-29: "for claude at least, what about the agents sdk. would that allow us to fully automate this stuff without having to repeat these instructions?" Then: "get the full docset put together."

## Jobs to be done

The owner leaves comments on a page and moves on to something else. He wants every comment acted on, rebuilt, and answered on the card, without going back to the chat to prod the agent. He also doesn't want to watch whether the agent is still listening.

**Nothing I write on the page goes unanswered, and I don't have to supervise the thing answering it.** That is the job. An agent framework is one possible way to do it.

## Who the user is

- **First, the owner.** He runs many agents at once: 21 Claude processes were counted on 2026-09-22. He reads while juggling other work, often by voice through Superwhisper. He pays for a Claude subscription, not API tokens. He has ADHD and wants fewer things to watch.
- **Second, the launch audience.** These are people running a coding agent who find LAHE through the npm package and the Product Hunt launch on the board. Assumed to be mostly subscription users too, spread across Claude Code, Codex, Gemini and Antigravity.

## User context

A Mac with one browser tab per review and one or more Claude Code terminals, often in several worktrees at once. He comments in a burst, then goes to another terminal or another task. The machine is under memory pressure: on 2026-09-22 swap was nearly full. That pressure is what sets off Claude Code's reaper, the part of Claude Code that stops quiet background commands to free memory. The reviewer's only view of the agent is the rail's one status line and the reply on each card.

## What already exists

**In this repo:**

- **`lahe monitor`** is already a watcher that runs outside the chat, which is what the research recommends. It waits in a small Node process that spends no model tokens, and it exits only when there is work (code 0), the session is closed (5), or another agent took over (6).
- **Trim the drain** (merged, `docs/features/20260928.04_trim_the_drain/`). The drain command, which an agent runs to collect new comments, now prints only the reviewer's items. It repeats no rule text.
- **Contract once** (`docs/features/20260916.02_contract_once/`). The rules live in `review.json`'s `contract` field, read once.
- **Rebuild is not the agent's job for Markdown** (`20260923.01`). The helper re-renders by itself.
- **The handled check.** A "handled" reply on a hand edit is checked against the built page, so an agent can't close an item by just saying it's done.
- **The rail's status line** tells the reviewer when nothing is listening, or when nothing has come back.
- **The three-strikes rule** in the skill: stop relaunching a killed monitor after three kills in a row.

**What still repeats each time the monitor wakes the agent:** the monitor prints `LAHE ACTION REQUIRED: do not end this turn...` twice (once on stdout, once on stderr), then a `NEXT:` block with the drain and relaunch commands (`src/cli/commands/monitor.js`). That is the "banner" in the owner's complaint. It was added as extra wording to push agents that did not act.

**Outside this repo** (research: `research_agent_sdk.md`, plus the installed CLIs checked today):

- **The Claude Agent SDK** exists, and it is the same agent loop as Claude Code. It needs `ANTHROPIC_API_KEY` and pay-per-token billing, plus an npm or pip install. It cannot idle for free, so it would still need `lahe monitor` in front of it.
- **Headless Claude Code (`claude -p`, version 2.1.284 installed).** It has everything needed for a run started on each wake:
  - `--append-system-prompt` (rules in the system prompt)
  - `--system-prompt-snapshot` (the system prompt recorded once per conversation)
  - `--resume` and `--fork-session`
  - `--allowedTools` and `--permission-mode`
  - `--input-format stream-json` (one long-running process that takes messages over time)
  - `claude --bg` and `claude attach` (background sessions a person can join)

  One catch: `--bare` forces API-key auth. A subscription user's run must not use it.
- **Other hosts.** `codex exec` has `resume` and `fork` (Codex 0.159.0 installed), and `gemini` is installed with a `-p` mode. So starting the host's own headless command on each wake works for more than one host. The SDK works for Claude only.
- **Checking the research:**
  - The research's list of model IDs disagrees with its own pricing list. That has no bearing on this decision.
  - Its claim that the SDK has "no startup cost" is weak. The same research says the SDK bundles and starts a Claude Code binary.
  - It rates hooks "limited fit". That misses the one hook that matters. A Stop hook is a check Claude Code runs when a turn tries to end, and it can refuse to let the turn end (see Approach C). We have not yet checked that it can do this today.

## Evidence

What we actually know, all from the owner's own use:

- **2026-08-18:** in Codex, 7 items sat unanswered after the agent detached its monitor and ended the turn.
- **2026-08-19:** overnight, a watch with a timeout woke the model on nothing, again and again.
- **2026-08-24:** a lesson was written, "Opening a review is not listening to it". Agents served the page and never started the watcher. The lesson's own words: "This wants a mechanism and does not have one yet."
- **2026-09-15:** 18 wakeups on nothing in one day, after Claude Code dropped `persistent: true` from its Monitor tool.
- **2026-09-17:** repeated reaper kills of a quiet monitor, each restarted at the cost of a turn. This is what led to the three-strikes rule.
- **2026-09-22:** confirmed that the kills come from Claude Code's own memory reaper, not macOS. It can be turned off with `CLAUDE_CODE_DISABLE_BG_SHELL_PRESSURE_REAP=1`. As of that note, it was not set.
- **2026-09-28:** the owner's principle: text repeated to an agent tens to thousands of times steers how it writes and acts.
- **2026-09-29:** the card that started this.

What we do not have: a count of how often an agent forgets to reply, rebuild, or restart the watcher, per review or per week. Every sighting is real, but there is no rate. We also have no measurement of what a headless run costs against a subscription's usage limits.

## Status quo

The chat agent reads the skill and the contract once, starts `lahe monitor` in the background, and handles each wake inside the chat. When it forgets, the rail eventually says "nothing back yet" or "nobody has picked this up". The owner then goes to the terminal and prods it. When the reaper kills the monitor, the agent spends a turn relaunching it.

The cost is the owner's attention: noticing silence, switching windows, re-prompting. It is also a steady spend of turns on things that are not work.

## Premises

Each one is marked with the answer assumed for the owner. He can overturn any of them.

1. **The complaint is three separate problems, and each has a different fix.** They are: the per-wake banner, the agent forgetting a step, and the reaper killing the watcher. Assumed: agree.
2. **The reaper problem does not need a feature.** One setting ends it for the owner. LAHE could suggest that setting, but it can't choose it for users. Assumed: agree.
3. **The banner is a symptom.** It exists because agents did not act. If the agent can't forget, the banner can go. If it can forget, deleting the banner alone makes things worse. Assumed: agree.
4. **"Can't forget" has to be built into how LAHE runs, not written into the rules.** Every past fix that added more wording failed (recorded in the host-constraints memory note). Assumed: agree.
5. **The owner will not add API billing for this.** So a path that works only with an API key can at most be an add-on for other users. It can't be his default. Assumed: agree. This is the biggest assumption in this doc.
6. **The zero-runtime-dependency rule holds.** Anything that needs an npm install ships outside the core tool, or not at all. Assumed: agree.
7. **LAHE already talks to the reviewer through cards, not the chat.** An agent that is not the chat agent can still hold the whole conversation with the reviewer: questions, caveats, and reasons an item was not handled all land on the card. Assumed: agree.
8. **Most cards can be handled without the chat's history.** The agent needs the review, the source files, and a short handoff note. Assumed: agree, but unverified. Some reviews clearly lean on what was said in chat.

## The case against building this

Much of the pain is already fixed or has a cheap fix:

- The drain no longer repeats rules.
- The handled check catches an agent that says "handled" without doing the work.
- Markdown rebuilds are no longer the agent's job.
- The reaper has a one-line off switch.

What is left is the banner (one sentence, printed twice) and agents that end a turn before finishing. For Claude, a Stop hook could block that ending inside the owner's normal chat, keeping all his context and costing no new billing.

A second, background agent adds real new risk:

- **Unattended edits.** It edits files and runs builds with nobody watching. It reads page text that could carry instructions. The design rule that marks page text as data (decision D12 in the architecture doc) becomes the only guard.
- **Duplicate work.** The chat agent and the background agent can both act on one review.
- **Weaker answers.** The background agent doesn't know what the owner and the chat agent discussed.
- **The contract forbids it today.** It says "Do not use ... a forever daemon". This mode needs a process that outlives the chat.
- **Other work waits.** The tests on main are failing (the `rail_hold` browser test). Several security rows are open: the Host header check, and Markdown link types beyond http, https, mailto and tel. The npm package has to ship before the launch.

**What would change my mind:** a measured rate of forgotten steps after the reaper setting and a Stop hook are in place. If agents still drop work, the background agent earns its risk. If they don't, it is a solution looking for a problem.

## What happens if we do nothing

The owner keeps prodding agents when the rail goes quiet. He keeps losing turns to reaper kills until he sets the variable. Codex and Antigravity users keep relying on written rules alone, which has failed before. Nothing breaks, and nobody new is harmed. The cost is his attention, on every review, indefinitely.

## Approaches considered

Size is how big the change is, not how long it takes.

### Approach A: Agent SDK agent, shipped as an optional add-on

- **Summary:** a separate package that runs an SDK agent with LAHE's rules as its system prompt and LAHE's commands as its tools. `lahe monitor` starts a turn when work lands.
- **Size:** L. **Risk:** High for this owner.
- **Pros:**
  - Full control from code: custom tools, in-process hooks, typed messages, and a spending cap.
  - The rules are carried once, as the system prompt.
  - Suits teams that already budget API spend per use.
- **Cons:**
  - API key and pay-per-token only. The owner's subscription can't pay for it.
  - Breaks the zero-dependency rule unless it lives outside the core tool, which means a second thing to install and version.
  - Claude only. Codex and Gemini users get nothing.
  - Doesn't share the chat's context unless given a session id to resume or fork.
- **Reuses:** `lahe monitor`, the drain, `lahe reply`, the contract text.

### Approach B: headless runs of the user's own agent, started by LAHE on each wake

- **Summary:** an opt-in mode where LAHE's watcher starts the host's headless command when work lands (`claude -p` first; `codex exec` and `gemini -p` later). The rules go in once, in the system prompt. The run drains, edits, rebuilds, replies, and exits. LAHE checks what is still unanswered afterward. The agent can't forget to restart the watcher, because LAHE restarts it.
- **Size:** M to L. **Risk:** Medium.
- **Pros:**
  - Runs on the login the user already has, so no API billing for a subscription user.
  - Nothing to install, so the zero-dependency rule holds. LAHE calls a CLI the user already has.
  - Each wake gets a fresh, short context with the rules at the top, so repetition never piles up in one long chat.
  - One adapter per host, not a Claude-only library.
  - The watcher runs outside the chat, so Claude Code's reaper can't kill it.
- **Cons:**
  - Uses the owner's subscription limits on every wake. The amount is unmeasured.
  - Each run loads Claude Code's own system prompt, CLAUDE.md files and skill list again, unless it resumes one session of its own.
  - An unattended agent edits files and runs builds. It needs a permission mode chosen deliberately and a security review.
  - Doesn't share the chat's context unless it forks the chat session. A fork costs more per wake and copies history the run may not need.
  - Reverses the contract's "no forever daemon" rule, so the architecture doc has to change first.
  - Two agents on one review (chat and background) need a clear rule for who owns it.
- **Reuses:**
  - `lahe monitor` and its duplicate guard and exit codes
  - the drain, `lahe reply`, the handled check
  - the helper's existing habit of starting and stopping processes
  - the rail's "agent listening" check, which looks at which process holds open the connection that delivers new work

### Approach C: keep the agent in the chat, and make forgetting hard

- **Summary:** leave the loop in the owner's normal chat and remove the failure points with structure, not words. Three parts:
  1. The owner turns on the reaper setting.
  2. The banner printed on each wake shrinks to plain data, with no instructions in it.
  3. For Claude Code, a Stop hook refuses to end a turn while this session has unanswered items. We have not yet checked that the hook can block like that.
- **Size:** S. **Risk:** Low to Medium.
- **Pros:**
  - Keeps the chat's full context.
  - No new billing, no new process, no new permissions.
  - Of the four approaches that build something, this is the smallest change.
- **Cons:**
  - The Stop hook is Claude only, and it installs into the user's own settings, which the user must agree to.
  - A hook that misfires could keep a chat from ending.
  - Still needs the agent to start the watcher in the first place. An agent that opens a review but never starts the watcher is still a risk.
  - The owner's chat stays busy with review work, so he can't use it for other things during a review.
- **Reuses:** the drain (as the hook's check), the skill, the three-strikes rule.

### Approach D (lateral): a dedicated background Claude Code session per review

- **Summary:** instead of LAHE running the agent, `lahe review` suggests (or starts) a Claude Code background session (`claude --bg`) that owns the review. The owner joins it with `claude attach` when he wants to talk.
- **Size:** S to M. **Risk:** Medium.
- **Pros:**
  - A full interactive session with its own context, on the subscription.
  - The owner's main chat stays free.
- **Cons:**
  - Inside that session the watcher is still a background command, so the reaper and forgetting both return.
  - Claude only.
  - Adopts a young Claude Code feature whose behavior LAHE doesn't control. When Claude Code changed its Monitor tool on 2026-09-14, the owner saw 18 wakeups on nothing in one day.
- **Reuses:** everything in today's skill.

### Do nothing

Keep today's loop and the three-strikes rule. The drain fix already landed. What we lose:

- The owner keeps supervising agents.
- Reaper kills keep costing turns until the setting is on.
- The banner stays.

## Recommended approach

**Approach B, opt-in, Claude Code first. Before architecture begins, one real test run has to measure its cost (see The assignment). The SDK stays out of the core tool.**

B is the only option that removes the owner from supervision without new billing or a new install, and the only one that extends to other hosts. A is B with worse terms for this owner: API billing, an install, Claude only. Its one real advantage, control from code, is mostly available through CLI flags. C is worth doing whatever else is decided, but it keeps the owner's chat as the worker and only half-fixes forgetting.

Constraints the brief should carry:

- The zero-dependency rule holds.
- No instructions repeat on each wake.
- The reviewer's view of the agent stays the card and the rail's one status line.
- The mode is off unless the user turns it on.

How it is built and what it looks like is left to the brief and architecture.

## Challenges the session leader accepted

None yet. This ran without the owner. Each challenge I would have put to him is either a premise above (marked "assumed") or an open question below.

## Challenges the session leader rejected

None yet, for the same reason.

## What we skipped and why

- **The crucible's seven standard questions were answered from evidence instead of asked.** The owner asked for no stops. The answers are in the sections above, and the ones that are guesses are listed under Assumptions.
- **I read the prior feature docs without asking first,** because the owner was unavailable and they were recent and directly on this topic: contract once, trim the drain, rebuild not the agent's job, and the two proposed lessons.
- **Future fit.** Better models follow written rules better, which shrinks the "forgets a step" problem. That weakens B over time. Two problems won't shrink with better models. Text repeated to an agent still steers how it writes and acts. Claude Code still kills quiet background processes. Both still favor moving the loop out of the chat. On balance B holds, but less strongly than it looks today.

## Assumptions made for the owner

1. He stays on his subscription and will not pay API rates for this.
2. A `claude -p` run started by a script on his own machine draws on his subscription, within its terms. How much it uses on each wake is acceptable. That amount still has to be measured.
3. The zero-runtime-dependency rule is not up for change for this feature.
4. Most cards can be answered by an agent that has the review and the files but not the chat's history.
5. Claude first, other hosts later, is acceptable.
6. A background agent may edit files and run the project's build without asking each time, inside the review's own folder or project.
7. The mode is opt-in, not the new default.

## Open questions

Only the owner can answer these:

1. **Billing.** Is drawing on subscription limits from background runs acceptable? What would be too much? This decides B.
2. **Context.** Should the background agent be a fork of the chat that opened the review (knows everything, costs more per wake)? Its own continuing session (cheaper, knows the review and files)? Or fresh on every wake?
3. **Who owns the review.** When the background mode is on, does the chat agent stop handling cards completely? If the chat agent is also working the review, which one answers?
4. **Permissions.** What may an unattended agent do without asking: edit only the reviewed document's sources, run the project's build, run any command?
5. **The reaper setting.** Turn on `CLAUDE_CODE_DISABLE_BG_SHELL_PRESSURE_REAP=1` in his Claude Code settings now, separate from this feature?
6. **Approach C.** Build the Stop hook and banner trim now as a separate small change (whetstone), whatever happens to B?
7. **The SDK.** Close the SDK path for good, or keep it as a documented option for API-key users later?
8. **Priority.** Does this go ahead of fixing the failing tests on main, the open security rows, and the npm package that gates the launch?

## The assignment

Run one real review headless before the brief is signed off. Start a small Markdown review. When work lands and `lahe monitor` exits, start `claude -p` with the LAHE rules passed through `--append-system-prompt`. Let it answer three to five comments. Record three things:

- how much of the subscription limit each wake used, as Claude Code reports it
- whether every card got a correct reply
- whether any card needed context only the chat had

That one run answers open questions 1 (billing) and 2 (context) with data instead of guesses.
