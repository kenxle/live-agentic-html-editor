# Claude Agent SDK Research: Building a Dedicated LAHE Agent

## Overview

This document answers key questions about building a dedicated LAHE (live-agentic-html-editor) agent on the Claude Agent SDK, focusing on architecture, authentication, long-running behavior, and distribution constraints.

---

## 1. What is the Claude Agent SDK?

The [Claude Agent SDK is a Python and TypeScript library](https://code.claude.com/docs/en/agent-sdk/overview) that gives developers the same tools, agent loop, and context management that power Claude Code. Unlike Claude Code itself, the SDK runs in your own process, not the terminal. You self-host it.

[The SDK provides built-in tools](https://code.claude.com/docs/en/agent-sdk/quickstart):

- **Read, Write, Edit, Glob, Grep**: file operations
- **Bash**: run shell commands
- **WebSearch, WebFetch**: web access
- Full agent loop, sessions, permissions, hooks, MCP integration, and subagents
- Automatic context compaction for long-running tasks

It differs from [Claude Code itself](https://code.claude.com/docs/en/overview) (the CLI tool) in that you embed it as a library and control orchestration. It differs from [Managed Agents](https://platform.claude.com/docs/en/managed-agents/overview) in that you host it yourself and manage the sandbox, not Anthropic.

A minimal long-running agent requires:

- **System prompt**: held in memory across turns (does not reset per turn)
- **Custom tools**: file drain, rebuild, reply (as in-process functions or MCP tools)
- **Built-in tools**: Read, Bash for verification
- **Sessions**: persist conversation history to disk so the agent can resume
- **Permissions**: control what the agent can do without approval

[In TypeScript, a minimal query looks like this:](https://code.claude.com/docs/en/agent-sdk/quickstart)

```typescript
for await (const message of query({
  prompt: "Review utils.py for bugs...",
  options: {
    allowedTools: ["Read", "Edit", "Glob"],
    permissionMode: "acceptEdits"
  }
})) {
  // Stream results as they arrive
}
```

[In Python, you either use the standalone `query()` function or ClaudeSDKClient for multi-turn conversations.](https://code.claude.com/docs/en/agent-sdk/sessions#python-claudesdkclient) ClaudeSDKClient holds the session ID internally and automatically continues the same session across multiple calls.

---

## 2. Long-Running Agents with No Idle Token Cost

**The question:** Can an SDK agent sleep until an external event (file change, HTTP call, subprocess exit) and start a turn with zero tokens spent while idle?

**Answer:** Not natively. The SDK is a request-response agentic loop; it spends tokens when Claude responds to a prompt. There is no built-in idle mode that pauses the loop without cost.

However, two patterns avoid token waste:

**Pattern 1: External event watcher triggers a new process call**

- Write a shell wrapper or Node/Python process that watches for external events (file system watcher, HTTP server, process exit)
- When an event fires, launch a fresh SDK agent process with a specific prompt
- The agent runs one turn, replies, and exits
- Idle time is free: no agent process runs, no tokens spent
- The LAHE monitor loop already follows this pattern: `lahe monitor` sleeps until it detects a change, then wakes and runs `lahe status --json` to drain pending items

**Pattern 2: Use a scheduler (Routines or cron)**

[Claude Code offers Routines for scheduled execution:](https://code.claude.com/docs/en/overview#use-claude-code-everywhere) they run in the cloud and can be triggered on a schedule or by webhook. [You can also run Claude in CI](https://code.claude.com/docs/en/github-actions) or a cron job, which are free to be idle. The SDK can be invoked from CI or a cron task.

**What is not possible:** an SDK agent that stays running in the background and wakes without tokens. The moment Claude responds, tokens are spent. There is no built-in suspend/resume without cost.

---

## 3. Authentication and Billing

**The question:** Can an SDK agent run on a user's Claude subscription (Pro or Max), or does it require an API key and pay-per-token billing?

**Answer: API key required. Pay-per-token only.**

[The SDK requires an API key set in the environment:](https://code.claude.com/docs/en/agent-sdk/quickstart#set-your-api-key)

```bash
export ANTHROPIC_API_KEY=your-api-key
```

[API keys come from the Claude Console at platform.claude.com, not from a claude.ai subscription.](https://platform.claude.com/docs/en/get-api-key) A Pro or Max subscription does not grant API key access.

**Billing:** [Pay-per-token on the Claude API:](https://claude.com/pricing)

- Haiku 4.5: $1 input / $5 output per million tokens
- Sonnet 5: $2 input / $10 output per million tokens
- Opus 5.5: $4 input / $20 output per million tokens
- Fable 5.1: $10 input / $50 output per million tokens

There are no monthly flat-rate plans for API use. Each token costs its per-million-token price.

**Who can use the feature:**

- Users with an Anthropic Console account and an API key (possibly organization-managed)
- Not directly available to users who have only a claude.ai subscription
- Organizations can create service account keys for shared infrastructure

---

## 4. Model Selection and Defaults

[The SDK accepts a `model` option that takes a model alias or full model ID:](https://code.claude.com/docs/en/agent-sdk/configuration)

```typescript
options: { model: "claude-sonnet-5" }
```

[Current model IDs per the API reference:](https://platform.claude.com/docs/en/about-claude/models/overview)

- `claude-haiku-4-5-20251001`: $1/$5 per M tokens
- `claude-sonnet-5-20241022`: $2/$10 per M tokens
- `claude-opus-5-20250514`: $4/$20 per M tokens (newest Opus)
- `claude-fable-5-20250512`: $10/$50 per M tokens

**Recommended defaults:**

- **For routine LAHE edits:** Start with `claude-sonnet-5` (or alias `claude-sonnet-5`). Fast and affordable.
- **For first-time detection and complex reviews:** Opus (claude-opus-5) for higher quality.
- **For fallback:** Allow users to set `fallbackModel` to a cheaper option if the primary is overloaded.

[The SDK also supports switching models mid-session:](https://code.claude.com/docs/en/agent-sdk/configuration#change-configuration-mid-session)

```typescript
await session.setModel("claude-fable-5");
```

This lets a user start a review with Opus, then drop to Sonnet for follow-up edits to save cost.

---

## 5. Sharing Context with Claude Code Sessions

**The question:** Can an SDK agent share or resume the same session as the user's interactive Claude Code session?

**Answer: Not directly. Sessions are isolated by design.**

[Sessions in Claude Code are stored under `~/.claude/projects/<encoded-cwd>/<session-id>.jsonl`:](https://code.claude.com/docs/en/agent-sdk/sessions)

- Each session has a unique ID
- Sessions are tied to a working directory's encoding
- The SDK can resume a session by ID: `options: { resume: session_id }`
- But there is no automatic link between an interactive Claude Code session and an SDK agent session

**Options for integration:**

1. **Capture and pass the session ID:** The interactive session prints its session ID in results. You could capture it and pass it to the SDK agent with `resume: session_id`. The agent then continues the conversation with full context.

2. **Fork for parallel work:** [The SDK supports forking a session:](https://code.claude.com/docs/en/agent-sdk/sessions#fork-to-explore-alternatives) start a fork from the interactive session's ID, and the SDK agent works on a copy of the history without modifying the original.

3. **Hand off via subagent:** [The interactive Claude Code can spawn an Agent SDK app as a subagent.](https://code.claude.com/docs/en/agent-sdk/subagents) The subagent runs in its own process but can be orchestrated from Claude Code.

4. **Separate conversations:** Keep LAHE work in its own session (the SDK agent's session) and the interactive session separate. They run in parallel but don't share history.

**Most practical:** Use option 1 (pass the session ID) or option 4 (separate sessions). Option 1 gives the agent full prior context; option 4 is simpler for a dedicated background task.

---

## 6. Can Claude Code Itself Do This Without an SDK Agent?

**The question:** What in Claude Code (hooks, Monitor, background tasks, subagents, plugins, skills, headless `-p`, scheduled tasks) could do the same job without a separate SDK process?

**Answer:** Several Claude Code features overlap with what an SDK agent would do. Here are the trade-offs:

| Feature | What it does | Fit for LAHE | Trade-offs |
|---------|------------|-----------|-----------|
| [**Headless `-p` mode**](https://code.claude.com/docs/en/headless) | Run `claude -p "prompt"` in a subprocess, no interaction | Good for one-shot tasks | Starts a fresh Claude Code process each time; full startup cost. Tokens spent only during the run. Good for scripted wakes. |
| [**Routines**](https://code.claude.com/docs/en/overview#use-claude-code-everywhere) | Schedule cloud tasks or trigger on webhook | Good for scheduled reviews | Hosted by Anthropic; requires claude.ai subscription (Pro/Max). Not for immediate wakes. |
| [**Hooks (pre/post)**](https://code.claude.com/docs/en/hooks) | Run shell commands before or after Claude actions | Limited fit | Hooks run inside an interactive session, not standalone. Can't drive the review loop. |
| [**Monitor tool**](https://code.claude.com/docs/en/tools-reference#monitor-tool) | Watch for filesystem or subprocess events and stream results | Partial fit | Built for streaming real-time output to a running session, not waking a separate agent. Claude Code stays running while Monitor watches. |
| [**Subagents**](https://code.claude.com/docs/en/sub-agents) | Spawn isolated agents from an interactive session | Good if orchestrated from Claude Code | Requires a parent interactive session to orchestrate. Not standalone. |
| [**Plugins/Skills**](https://code.claude.com/docs/en/skills) | Package logic and prompts as reusable tools | Not applicable | Plugins run inside Claude Code, not standalone. Can include the wake logic but need an outer loop to invoke them. |
| [**Scheduled tasks in Desktop**](https://code.claude.com/docs/en/desktop-scheduled-tasks) | Run tasks on a schedule in the Desktop app | Requires Desktop; limited | Runs on the user's machine only when Desktop is open. |

**Why an SDK agent is better for LAHE:**

1. **No startup cost:** The SDK agent can stay running (or wake via external event watcher) and reply without re-starting Claude Code.
2. **Dedicated purpose:** The agent can be purpose-built for LAHE with a fixed system prompt and toolset. No interactive distraction.
3. **API key control:** SDK agents use API keys, not subscriptions, so organizations can allocate spend budgets per use case.
4. **Minimal overhead:** A small Node or Python process running the SDK is lighter than invoking Claude Code as a subprocess each time.

**The hybrid option:** Use Claude Code headless (`claude -p`) as the wake mechanism (when an external event fires), and have that `-p` call invoke the SDK agent as a subprocess. This combines the flexibility of the `-p` trigger with the efficiency of the SDK's long-running harness.

---

## 7. Distribution: Zero-Dependency Constraint

**The question:** Given LAHE's hard rule of zero runtime dependencies, what would an SDK agent need installed, and can it be optional?

**Answer: The SDK requires installation. It cannot stay zero-dependency.**

[The SDK installs as an npm or Python package:](https://code.claude.com/docs/en/agent-sdk/quickstart#install-the-sdk)

**TypeScript:**
```bash
npm install @anthropic-ai/claude-agent-sdk
npm install --save-dev tsx  # Only for development
```

**Python:**
```bash
uv add claude-agent-sdk
# or
pip install claude-agent-sdk
```

Both SDKs bundle a native Claude Code binary, so no separate Claude Code install is needed on most platforms. But the package itself must be installed.

**Distribution challenge:**

LAHE has a strict rule: `dependencies` in package.json must remain `{}`. The tool runs from `git clone` with no install step. Third-party code is vendored under `vendor/` (marked, Mermaid, fonts, styles).

An SDK agent breaks this rule: it requires `npm install @anthropic-ai/claude-agent-sdk` or a Python venv + `pip install`.

**Options:**

1. **Optional add-on:** Document the SDK agent as an optional feature. Users who want it run an install step: `npm install @anthropic-ai/claude-agent-sdk`. The core LAHE tool stays zero-dependency for basic serve/reply/rebuild.

2. **Separate tool:** Distribute the SDK agent as a separate package or script. LAHE remains zero-dependency; the agent is opt-in infrastructure.

3. **Vendor the SDK:** Copy the SDK source into `vendor/` and adjust import paths. This keeps the constraint but adds maintenance burden (SDK updates require manual merges).

4. **Don't use the SDK:** Instead, build the wake loop and LAHE agent commands in shell or a headless `-p` call, avoiding SDK installation entirely. Trade-off: less elegant, more fragile.

**Recommendation:**

Go with **option 1 (optional add-on)** or **option 2 (separate tool)**. Clearly separate:

- **Core LAHE:** zero-dependency, CLI tool, serve/reply/rebuild commands
- **LAHE Agent SDK:** optional, installed separately, coordinates the wake loop and calls core commands

Document it as "LAHE Agent (optional)". Users who want the dedicated agent install it; others use LAHE with their own orchestration (Monitor, cron, CI, etc.).

---

## Summary Table

| Question | Answer | Source |
|----------|--------|--------|
| **SDK overview** | Python/TypeScript library with built-in tools, sessions, MCP, hooks, subagents | [Agent SDK overview](https://code.claude.com/docs/en/agent-sdk/overview) |
| **Idle without tokens** | Not natively. Use external event watcher + fresh process, or scheduled execution | [Sessions](https://code.claude.com/docs/en/agent-sdk/sessions), [Routines](https://code.claude.com/docs/en/overview) |
| **Auth/billing** | API key required; pay-per-token (no subscription access) | [Get API key](https://platform.claude.com/docs/en/get-api-key), [Pricing](https://claude.com/pricing) |
| **Models** | Sonnet 5 default; Opus 5.5 for complex work; Haiku for cost | [Models overview](https://platform.claude.com/docs/en/about-claude/models/overview) |
| **Sharing context** | Can resume a session by ID; forking and separate sessions also work | [Sessions](https://code.claude.com/docs/en/agent-sdk/sessions) |
| **Claude Code alternatives** | Headless `-p`, Routines, Monitor, subagents; each has trade-offs; SDK is simpler for standalone LAHE agent | [Headless](https://code.claude.com/docs/en/headless), [Overview](https://code.claude.com/docs/en/overview) |
| **Zero-dependency constraint** | SDK requires install; cannot be vendored easily. Recommend optional add-on or separate tool | [Quickstart](https://code.claude.com/docs/en/agent-sdk/quickstart) |

---

## Sources

- [Claude Agent SDK overview](https://code.claude.com/docs/en/agent-sdk/overview)
- [Claude Agent SDK quickstart](https://code.claude.com/docs/en/agent-sdk/quickstart)
- [Claude Agent SDK sessions](https://code.claude.com/docs/en/agent-sdk/sessions)
- [Claude Agent SDK configuration](https://code.claude.com/docs/en/agent-sdk/configuration)
- [Claude Code overview](https://code.claude.com/docs/en/overview)
- [Claude Code headless mode](https://code.claude.com/docs/en/headless)
- [Claude Managed Agents overview](https://platform.claude.com/docs/en/managed-agents/overview)
- [Get Claude API key](https://platform.claude.com/docs/en/get-api-key)
- [Claude API models overview](https://platform.claude.com/docs/en/about-claude/models/overview)
- [Claude pricing](https://claude.com/pricing)
