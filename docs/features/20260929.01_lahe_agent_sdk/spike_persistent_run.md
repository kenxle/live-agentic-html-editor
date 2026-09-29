# Spike: one persistent headless Claude Code process per document

Date: 2026-09-29
Asked by: the owner, after the first spike (`spike_headless_run.md`). He rejected one headless run per wake because his projects pay a large start-up cost on every new agent, and asked whether one agent could stay alive, headless, and be fed each wake.

## Summary

- **Verdict: workable, and better than one run per wake.** One `claude -p --input-format stream-json` process stayed alive for 10 minutes 49 seconds and took 4 wakes on stdin. Two `--resume` replacements of it took 3 more messages, after a kill and through two forced compactions. Every item its tools let it answer came out right.
- **Lean mode costs about the same per wake as before.** Later wakes cost $0.020 to $0.030 (list price) against $0.034 to $0.054 for the first spike's lean Sonnet runs. The prompt cache carried over between wakes, including across a 6 minute 32 second idle gap, because a subscription gets the one-hour cache.
- **Full setup is where persistence pays.** The first wake with the owner's whole setup cost $0.995, as a fresh run does. Later wakes cost $0.094 to $0.153, which is 6.5 to 10.6 times less than the first. They are still 4.3 to 5.1 times the lean wakes, because every request carries 132,000 to 139,000 tokens.
- **Idle costs nothing.** No model call happened between wakes. The process starts silently and makes no request until the first message arrives.
- **A dead process is noticed at once.** Node's `exit` event fired on SIGKILL, and the supervisor started a `--resume` replacement 2 ms later. The resumed process kept the same session id and the warm cache, and its first wake cost $0.030, the same as a warm wake.
- **The CLI compacts on its own in this mode.** With the window forced down to its 100,000 minimum, it compacted twice without being asked, and the next item was still handled correctly. At the default window (about 967,000 tokens for Sonnet 5.5), lean growth of 2,220 tokens per wake reaches compaction after about 428 wakes.
- **The owner's worry is answered by design, not by the model.** The model forgot nothing it was asked to do. But one reply was refused by the permission rule twice, and only the supervisor's own drain after each turn caught it. The supervisor has to own every check (list at the end).

## Setup

Everything lived in `/private/tmp/claude-501/spike-persistent/`. The owner's state directory, helper, reviews and documents were not touched.

- **Document:** `doc/notes.md`, a 17-line Markdown "Garden plan". It is the first spike's document plus one line under Budget ("Seeds come from the hardware store on Main Street."). A clean copy, `notes.original.md`, was put back before the full-setup run.
- **State directory:** `state/`, passed as `--state-dir` to every `lahe` command.
- **Helper:** its own, on port 7898 (the owner's is 7817, the first spike's was 7899).
- **Review:** `r1d90f35ac845`, LAHE session `s_52361dd94a7ba953`.
- **Claude Code:** 2.1.284 at `/Users/kennethstclair/.local/bin/claude`, subscription login. Every `init` event reported `"apiKeySource": "none"`.
- **Model:** `sonnet`, which resolved to `claude-sonnet-5-5` (context window 1,000,000 in `modelUsage`).
- **Items:** posted the way the browser layer posts them, by `post_items.js` (the first spike's script, extended to five item sets).
- **Side effect outside `/tmp`:** a session that can be resumed must be saved, so Claude Code wrote two transcripts to `~/.claude/projects/-private-tmp-claude-501-spike-persistent-doc/`. `--no-session-persistence` cannot be used when resume is wanted.

The item sets:

| Set | Item | Kind | Reviewer's words | What is correct |
| --- | --- | --- | --- | --- |
| w1 | wording | comment | Say "use", not "utilize". Plain words. | "utilize" becomes "use", `handled` |
| w1 | edit | edit | every week -> each Monday | source says "each Monday", `handled` |
| w1 | question | comment | Put the actual dollar figure here instead of 'about as much as last year'. | nothing edited, `question` |
| w2 | answer | comment | You asked for the number: it is $220. | source says "$220", `handled` |
| w2 | seeds | edit | hardware store on Main Street -> co-op on Elm Street | source changed, `handled` |
| w3 | add | comment | Add one more open item after this one: ask Dana about drip irrigation. | new line under Open items, `handled` |
| w4 | title | comment | Call it "Garden plan 2027". | heading changed, `handled` |
| w5 | fence | comment | Say "south wall", not "south fence". | source changed, `handled` |

## The commands

Open the review on a throwaway helper:

```sh
lahe review doc/notes.md --state-dir /private/tmp/claude-501/spike-persistent/state --port 7898 --name spike-persistent
```

Start the supervisor (it runs until a `stop-<label>` file appears), then post items whenever a wake is wanted:

```sh
LEAN=1 node supervisor.js lean          # lean run: adds --safe-mode
node supervisor.js full                 # the owner's full setup
CHILD_ENV='{"CLAUDE_CODE_AUTO_COMPACT_WINDOW":"100000"}' LEAN=1 \
  RESUME=9d148a1f-b3cb-43b7-8ff3-bccd2d7b3a50 node supervisor.js compact   # compaction test
node post_items.js w1 a                 # set, then an id prefix
```

The `claude` arguments the supervisor passes, with `cwd` set to the document's folder and the parent session's `CLAUDE*` variables removed:

```sh
claude -p --input-format stream-json --output-format stream-json --verbose \
  --append-system-prompt "<system_prompt.v3.txt>" \
  --permission-mode dontAsk \
  --tools Read,Edit,Bash \
  --allowedTools Read "Edit(./**)" "Bash(lahe *)" "Bash(grep *)" \
  --model sonnet \
  [--safe-mode] [--resume <session-id>]
```

Each wake is one line on the child's stdin:

```json
{"type":"user","message":{"role":"user","content":[{"type":"text","text":"New LAHE review items landed. Session s_52361dd94a7ba953, state dir /private/tmp/claude-501/spike-persistent/state. Drain with: lahe status --session s_52361dd94a7ba953 --json --quiet --state-dir /private/tmp/claude-501/spike-persistent/state"}]},"parent_tool_use_id":null,"session_id":"<id or empty>"}
```

The turn is over when a `{"type":"result"}` line comes back.

### The system prompt

The first spike's version 2 (377 words), with two sentences changed so it fits a process that stays up. Version 3 is 399 words. The diff:

```text
- You were started because new review items landed. Handle every one, then stop.
+ You stay running for this one review. Each user message you get means new review items landed. Handle every one, end your turn with a one-line summary, and wait for the next message.
- 5. Drain again. Repeat until the drain prints no items, then end with a one-line summary.
+ 5. Drain again. Repeat until the drain prints no items, then end your turn with a one-line summary.
```

## The Node supervisor

It plays the part of `lahe agent`. It owns the wake, the "is it done" check and the restart. The model owns only the edits and the replies. It polls the drain every 2 seconds and sends a wake only when no turn is in flight. After each result it drains again itself. It re-sends a still-unanswered item once, then stops sending it. Node core only, no install.

```js
// A stand-in for LAHE's supervisor: starts ONE persistent `claude -p` process
// in stream-json mode, keeps it alive, and sends it a user message each time
// the drain shows new ready items. It owns the wake, the "is it done" check,
// and the restart; the model owns only the edit and the replies.
//
// Usage: node supervisor.js <label>
// Env:   LEAN=1           add --safe-mode (the first spike's lean start)
//        MODEL=sonnet     model alias (default sonnet)
//        RESUME=<uuid>    start by resuming this session id
//        CHILD_ENV='{"K":"V"}'  extra env for the child (after CLAUDE* is stripped)
// Control: drop a file in inbox-<label>/ to send its text as a user message
//          when idle; touch stop-<label> to end stdin and exit cleanly.
"use strict";
const fs = require("node:fs");
const path = require("node:path");
const { spawn, execFile } = require("node:child_process");

const ROOT = "/private/tmp/claude-501/spike-persistent";
const STATE = ROOT + "/state";
const SESSION = "s_52361dd94a7ba953";
const LAHE = "/Users/kennethstclair/.local/bin/lahe";
const CLAUDE = "/Users/kennethstclair/.local/bin/claude";
const label = process.argv[2] || "run";
const INBOX = path.join(ROOT, "inbox-" + label);
const STOP = path.join(ROOT, "stop-" + label);
fs.mkdirSync(INBOX, { recursive: true });

const streamFile = fs.openSync(path.join(ROOT, "stream-" + label + ".jsonl"), "a");
const logFile = path.join(ROOT, "supervisor-" + label + ".log");
function log(obj) {
  const line = JSON.stringify(Object.assign({ t: new Date().toISOString(), ms: Date.now() }, obj));
  fs.appendFileSync(logFile, line + "\n");
}

const system = fs.readFileSync(ROOT + "/system_prompt.v3.txt", "utf8");
const DRAIN = ["status", "--session", SESSION, "--json", "--quiet", "--state-dir", STATE];
const WAKE_TEXT = "New LAHE review items landed. Session " + SESSION + ", state dir " + STATE +
  ". Drain with: lahe status --session " + SESSION + " --json --quiet --state-dir " + STATE;

let child = null;
let sessionId = process.env.RESUME || null;
let busy = false;          // true from sending a message until its result event
let wake = null;           // the wake in flight
let wakeCount = 0;
let stopping = false;
const restarts = [];       // times of restarts, for the restart limit
const sentFor = {};        // item key -> times it was put in a wake

function childArgs(resumeId) {
  const a = [
    "-p",
    "--input-format", "stream-json",
    "--output-format", "stream-json",
    "--verbose",
    "--append-system-prompt", system,
    "--permission-mode", "dontAsk",
    "--tools", "Read,Edit,Bash",
    "--allowedTools", "Read", "Edit(./**)", "Bash(lahe *)", "Bash(grep *)",
    "--model", process.env.MODEL || "sonnet"
  ];
  if (process.env.LEAN === "1") a.push("--safe-mode");
  if (resumeId) a.push("--resume", resumeId);
  return a;
}

function childEnv() {
  const env = Object.assign({}, process.env);
  Object.keys(env).forEach((k) => { if (/^CLAUDE/.test(k)) delete env[k]; });
  if (process.env.CHILD_ENV) Object.assign(env, JSON.parse(process.env.CHILD_ENV));
  return env;
}

function start(resumeId) {
  const spawnedAt = Date.now();
  child = spawn(CLAUDE, childArgs(resumeId), { cwd: ROOT + "/doc", env: childEnv(), stdio: ["pipe", "pipe", "pipe"] });
  log({ ev: "spawned", pid: child.pid, resume: resumeId || null, lean: process.env.LEAN === "1" });
  let buf = "";
  child.stdout.on("data", (d) => {
    buf += d;
    let i;
    while ((i = buf.indexOf("\n")) >= 0) {
      const line = buf.slice(0, i); buf = buf.slice(i + 1);
      if (!line.trim()) continue;
      fs.writeSync(streamFile, JSON.stringify({ _t: Date.now(), _label: label, _pid: child.pid }) + "\t" + line + "\n");
      let msg; try { msg = JSON.parse(line); } catch (e) { log({ ev: "bad_line", line: line.slice(0, 200) }); continue; }
      onMessage(msg, spawnedAt);
    }
  });
  child.stderr.on("data", (d) => log({ ev: "stderr", text: String(d).slice(0, 500) }));
  const me = child;
  child.on("exit", (code, signal) => {
    log({ ev: "child_exit", pid: me.pid, code, signal, busy, uptime_ms: Date.now() - spawnedAt });
    if (me !== child) return;
    child = null;
    if (stopping) { log({ ev: "supervisor_done" }); process.exit(0); }
    // The supervisor, not the model, notices the death and restarts it.
    if (wake) { log({ ev: "wake_lost", wake: wake.n, items: wake.items }); wake = null; }
    busy = false;
    const now = Date.now();
    while (restarts.length && now - restarts[0] > 10 * 60 * 1000) restarts.shift();
    if (restarts.length >= 3) { log({ ev: "gave_up", reason: "3 restarts in 10 minutes" }); process.exit(1); }
    restarts.push(now);
    const resumeId = process.env.RESTART_FRESH === "1" ? null : sessionId;
    log({ ev: "restarting", resume: resumeId, detect_to_spawn_ms: 0 });
    start(resumeId);
  });
}

function onMessage(msg, spawnedAt) {
  if (msg.type === "system" && msg.subtype === "init") {
    if (msg.session_id && msg.session_id !== sessionId) log({ ev: "session_id", session_id: msg.session_id, previous: sessionId });
    sessionId = msg.session_id || sessionId;
    log({ ev: "init", session_id: msg.session_id, model: msg.model, tools: msg.tools, mcp: (msg.mcp_servers || []).length,
      apiKeySource: msg.apiKeySource, since_spawn_ms: Date.now() - spawnedAt });
  } else if (msg.type === "system") {
    log({ ev: "system", subtype: msg.subtype, detail: JSON.stringify(msg).slice(0, 400) });
  } else if (msg.type === "result") {
    const w = wake;
    log({ ev: "result", wake: w && w.n, wall_ms: w ? Date.now() - w.sentAt : null, subtype: msg.subtype,
      is_error: msg.is_error, num_turns: msg.num_turns, duration_ms: msg.duration_ms, usage: msg.usage,
      total_cost_usd: msg.total_cost_usd, modelUsage: msg.modelUsage, denials: (msg.permission_denials || []).length,
      text: String(msg.result || "").slice(0, 300) });
    wake = null; busy = false;
    // Do not trust the model's "done": the supervisor drains again itself.
    drain((items) => log({ ev: "post_turn_drain", unanswered: items.map((x) => x.id + "@" + x.rev) }));
  }
}

function send(text, meta) {
  const payload = { type: "user", message: { role: "user", content: [{ type: "text", text }] }, parent_tool_use_id: null, session_id: sessionId || "" };
  busy = true; wakeCount += 1;
  wake = Object.assign({ n: wakeCount, sentAt: Date.now() }, meta);
  child.stdin.write(JSON.stringify(payload) + "\n");
  log(Object.assign({ ev: "sent", wake: wakeCount, chars: text.length }, meta));
}

function drain(cb) {
  execFile(LAHE, DRAIN, { timeout: 15000 }, (err, stdout) => {
    if (err && err.code !== 0 && !stdout) { log({ ev: "drain_error", code: err.code, msg: String(err.message).slice(0, 200) }); return cb([]); }
    const items = String(stdout).split("\n").filter(Boolean).map((l) => { try { return JSON.parse(l); } catch (e) { return null; } })
      .filter((x) => x && x.id);
    cb(items);
  });
}

let ticking = false;
function tick() {
  if (ticking) return; ticking = true;
  if (fs.existsSync(STOP) && !stopping) {
    stopping = true; log({ ev: "stopping" });
    if (child) child.stdin.end(); else process.exit(0);
  }
  if (stopping || busy || !child) { ticking = false; return; }
  const inbox = fs.readdirSync(INBOX).filter((f) => f.endsWith(".txt")).sort();
  if (inbox.length) {
    const f = path.join(INBOX, inbox[0]);
    const text = fs.readFileSync(f, "utf8");
    fs.renameSync(f, f + ".sent");
    send(text, { kind: "inbox", file: inbox[0] });
    ticking = false; return;
  }
  drain((items) => {
    ticking = false;
    if (busy || !child || !items.length) return;
    const keys = items.map((x) => x.id + "@" + x.rev);
    const fresh = keys.filter((k) => (sentFor[k] || 0) < 2);
    if (!fresh.length) return; // tried twice already: a real supervisor would reply not_handled here
    keys.forEach((k) => { sentFor[k] = (sentFor[k] || 0) + 1; });
    log({ ev: "items_seen", items: keys });
    send(WAKE_TEXT, { kind: "wake", items: keys });
  });
}

process.on("SIGTERM", () => { stopping = true; if (child) child.stdin.end(); else process.exit(0); });
log({ ev: "supervisor_start", label, lean: process.env.LEAN === "1", model: process.env.MODEL || "sonnet", resume: sessionId });
start(sessionId);
setInterval(tick, 2000);
setInterval(() => {
  if (!child) return;
  execFile("ps", ["-o", "cputime=,rss=", "-p", String(child.pid)], (e, out) => log({ ev: "ps", pid: child && child.pid, busy, ps: String(out).trim() }));
}, 60000);
```

## Results

Every number comes from the process's own stream (`result` events and each assistant message's `usage`) or the supervisor's clock. `tabulate.py` in the spike folder prints them from the saved logs.

How to read the columns:

- **Per-wake tokens and cost** are differences of the `result` event's `modelUsage` and `total_cost_usd`. Claude Code reports both as running totals for the process, so the difference is exactly what one wake used, compaction calls included.
- **Wall ms** runs from writing the message to stdin to reading its `result` line.
- **Context per request** is input plus cache read plus cache write, for the first and last model call of the wake.
- **Cost** is Claude Code's list-price estimate (`costBasis: "list"`), not a charge. These runs used the subscription.

### Lean run (`--safe-mode`), one process, then a restart

| Wake | When | Items | Wall ms | Turns | Input | Output | Cache read | Cache write | Context per request (first to last) | Cost | Refused |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| 1 | 17:47:14, fresh process | 3 (w1) | 25,799 | 10 | 14 | 1,247 | 43,387 | 8,845 | 5,269 to 8,847 | $0.0566 | 0 |
| 2 | 17:50:44, after 3m 4s idle | 2 (w2) | 9,109 | 6 | 8 | 1,004 | 39,756 | 3,002 | 9,114 to 11,849 | $0.0300 | 1 |
| 2b | supervisor re-sent the unanswered item | 1 | 5,947 | 3 | 6 | 489 | 37,436 | 1,944 | 12,288 to 13,793 | $0.0202 | 1 |
| 3 | 17:57:32, after 6m 32s idle | 1 (w3) | 9,053 | 5 | 10 | 701 | 74,040 | 2,033 | 14,082 to 15,826 | $0.0300 | 0 |
| 4 | 17:59:04, new process from `--resume` after SIGKILL | 1 (w4) | 8,623 | 5 | 10 | 534 | 83,933 | 1,901 | 16,101 to 17,727 | $0.0298 | 0 |

(Clock times are UTC. The idle gaps are from the previous result to the next send.)

### Compaction test: the same session resumed with `CLAUDE_CODE_AUTO_COMPACT_WINDOW=100000`

| Wake | What was sent | Wall ms | Turns | Input | Output | Cache read | Cache write | Compaction | Cost |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| C1 | 156,264 characters of Claude Code docs, "reply ok" | 17,706 | 2 | 2,046 | 2,929 | 105,986 | 70,020 | auto, 56,860 to 40,607 tokens, 14.8 s | $0.3345 |
| C2 | 1 item (w5) | 26,451 | 6 | 67,984 | 2,930 | 42,009 | 6,616 | auto, 72,650 to 1,640 tokens, 17.6 s | $0.1971 |

### Full setup (no `--safe-mode`), a fresh process

| Wake | When | Items | Wall ms | Turns | Input | Output | Cache read | Cache write | Context per request (first to last) | Cost | Refused |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| 1 | 18:00:56, fresh process | 3 (w1) | 13,697 | 9 | 12 | 1,097 | 525,409 | 219,766 | 87,338 to 132,432 | $0.9951 | 0 |
| 2 | 18:04:12, after 3m 2s idle | 2 (w2) | 8,544 | 6 | 8 | 940 | 534,098 | 2,999 | 132,699 to 135,431 | $0.1282 | 1 |
| 2b | supervisor re-sent the unanswered item | 1 | 5,175 | 3 | 6 | 443 | 408,130 | 1,899 | 135,844 to 137,330 | $0.0937 | 1 |
| 3 | 18:11:00, after 6m 33s idle | 1 (w3) | 7,285 | 5 | 10 | 644 | 691,763 | 2,039 | 137,627 to 139,369 | $0.1530 | 0 |

### Did each item come out right?

Checked from the source file after each wake, the reply file, and the supervisor's own drain after each turn.

| Item | Lean | Full |
| --- | --- | --- |
| wording | handled, source changed | handled, source changed |
| edit | handled, source changed | handled, source changed |
| question | question asked, source untouched | question asked, source untouched |
| answer ($220) | source changed; reply refused twice (below) | source changed; reply refused twice (below) |
| seeds | handled, source changed | handled, source changed |
| add | handled, new line added | handled, new line added |
| title | handled after the restart | not run |
| fence | handled after two compactions | not run |

The review's `events.jsonl` holds 14 `item.ready` and 14 `reply.folded` events. Twelve replies came from the model. The two for the $220 item were written by hand as the supervisor (`--agent lahe-supervisor`), standing in for what a real supervisor would do.

## What the measurements show

### 1. Per-wake cost and the prompt cache

- **The cache carried over between wakes.** Every cache write was 1-hour (`ephemeral_1h_input_tokens`), as the docs say a subscription gets for the main conversation ([Prompt caching, "Which TTL each request gets"](https://code.claude.com/docs/en/prompt-caching)). After the 6 minute 32 second gaps, both runs wrote only about 2,000 new tokens of cache and read the rest.
- **Lean: persistent costs about the same as one run per wake.** First spike, lean Sonnet: $0.0536 (run 7) and $0.0338 (run 8) for 3 items. Here: $0.0566 for 3 items, then $0.020 to $0.030 for 1 or 2. A fresh lean start is cheap anyway, so the process mostly saves start-up time, not tokens.
- **Full: persistent saves most of the start-up cost.** In the first spike every fresh full-setup run rewrote its whole cache (run 4 wrote 137,269 tokens again). Here only the first wake did. Full wakes 2 and 3 cost 6.3 to 7.5 times less than the first spike's fresh full Sonnet run ($0.9622).
- **Wall time.** Lean wakes 2, 3 and 4 took 8.6 to 9.1 seconds. The first spike's fresh lean Sonnet runs took 11.3 and 14.3 seconds, including process start. Lean wake 1 took 25.8 seconds because the model spent a `grep` and a Read hunting for the file before editing.

### 2. How context grows

- **Lean:** the last request of each wake went 8,847, 11,849, 13,793, 15,826, 17,727 tokens. That is 2,220 tokens per wake on average.
- **Full:** 132,432 at the end of wake 1, then 135,431, 137,330, 139,369. Each wake adds about as much as a lean wake does. The large part is the fixed setup.
- **Near the limit, the CLI compacts on its own.** Stream-json mode emitted `{"subtype":"status","status":"compacting"}`, then a `compact_boundary` event with `"trigger":"auto"` and the before and after token counts. Nothing had to be sent to ask for it.
- **The work survived compaction.** The second compaction cut the conversation to 1,640 tokens, and the next item (w5) was still handled correctly with a reply. The rules live in the system prompt, and compaction does not drop that.
- **Compaction is the expensive moment.** It is a model call over the whole conversation: $0.33 and $0.20 here at a forced 100,000 window. At the default window for Sonnet 5.5 (compaction at about 967,000 tokens, per [Model configuration, "Default auto-compact thresholds"](https://code.claude.com/docs/en/model-config)), a lean process reaches it after about 428 wakes at the measured growth. A supervisor that starts a fresh process at a size of its choosing avoids compaction altogether.

### 3. When the process dies

- **Detected at once.** The child was killed with SIGKILL while idle. Node's `exit` event fired at 17:57:48.823 with `signal: "SIGKILL"`, and the replacement was spawned at 17:57:48.825. No polling or heartbeat was needed.
- **`--resume <session-id>` kept the conversation.** The new process reported the same session id (`9d148a1f-...`). It emitted nothing and cost nothing until the next message.
- **The resumed start cost nothing extra.** Its first model call read 17,590 tokens from cache and wrote 135. The whole wake cost $0.0298, the same as a warm wake ($0.0300). That was 75 seconds after the kill. A resume after the 1-hour cache has expired would rewrite the conversation's cache; that case was not measured.
- **A clean stop is a closed stdin.** Ending the child's stdin made it exit with code 0 within about 200 ms.
- **What a kill mid-turn does was not tested.** The supervisor logs a lost wake (`wake_lost`) and the items stay on the drain, so the next wake picks them up. Whether a half-done edit is left in the file is the same question the architecture's copy-and-check stage answers.

### 4. Idle cost

- **Zero model calls while idle.** Claude Code's running totals in `modelUsage` rose by exactly each wake's own `usage` and nothing more. A background call during idle would have shown up in the total.
- **The lean stream was silent between turns:** zero lines. The full-setup stream sent 6 local events outside turns: a SessionStart hook at launch and `commands_changed` notices when the owner's skill files changed. None is a model call.
- **A new process makes no request until its first message.** The lean process sat 14.6 seconds before its first wake, and the resumed one 75.5 seconds. Neither sent anything, and `init` arrived only with the first message.
- **Local cost:** about 0.2 seconds of CPU per idle minute (`ps` samples: 2.29 to 4.62 CPU seconds over 9 minutes, including one wake), and 115 to 275 MB of memory.

### 5. The owner's full setup

- **The first wake pays the full load:** $0.9951, with 219,766 tokens written to cache and a first request of 87,338 tokens that grew to 132,432 within the wake.
- **Later wakes do not pay it again:** $0.1282, $0.0937 and $0.1530. That is 7.8, 10.6 and 6.5 times less than the first wake.
- **But each wake still carries the setup.** Every request reads 132,000 or more tokens from cache, so later full wakes cost 4.3 to 5.1 times the matching lean wakes. The owner's CLAUDE.md, MCP servers and skills buy nothing for this job.

## What went wrong

- **A dollar sign in a reply was refused, twice, in both runs.** The model wrote `--text "... cost $220."` in a Bash call. `$2` inside double quotes is a shell variable, so the `Bash(lahe *)` rule does not match and `dontAsk` refused it. Re-sent once by the supervisor, the model tried the same call again and was refused again. The edit was in the file, but the item had no reply. The model said so plainly in its summary, and did not try to get around the rule. This is exactly the owner's worry, "it forgets to do something", except the model did not forget: it was blocked. Only the supervisor's own drain after the turn showed the item still open. The architecture's design already avoids this failure: replies come back as structured output in the result, and the run has no Bash at all.
- **The first lean wake hunted for the file.** The model said "The source_hint isn't present; find the file" and spent a `grep` finding it. The architecture's stdin payload replaces `source_hint` with the stage path, which removes the hunt.

## Verdict

**One persistent headless agent per document is workable.** It answers the owner's objection directly: the expensive start happens once per document, not once per wake, and a waiting process spends nothing. On the owner's full setup that cuts a later wake from about $1.00 to $0.09 to $0.15. On the lean setup it is roughly cost-neutral against a fresh run, and a few seconds faster.

The lean start still matters more than persistence. A lean later wake ($0.020 to $0.030) is 4 to 5 times cheaper than a full one, and loading the owner's setup buys nothing for this job.

**What the supervisor has to own, so nothing depends on the model remembering:**

- **The wake.** It watches the drain and sends a message. The model never re-arms a monitor, and there is no monitor to re-arm.
- **One turn at a time.** It sends nothing while a turn is in flight, and treats the `result` line as the only "done".
- **The "is it done" check.** After every turn it drains again itself, and counts attempts per item. After its limit it writes a `not_handled` reply itself, as the architecture already says.
- **Replies.** Replies should come back as structured output that the supervisor checks and writes, not as Bash calls the model makes. The $220 refusal shows why.
- **Life and death of the process.** It notices the child's exit at once from the `exit` event and restarts it, with `--resume` to keep the conversation. It limits restarts (here: 3 in 10 minutes, then give up and show it).
- **The session id and the transcript.** It records the id from the `init` event, since `--resume` needs it. Resuming needs a saved transcript, so `--no-session-persistence` cannot be used.
- **Size.** It decides when a conversation is too long and starts a fresh process, rather than paying for compaction. The rules are in the system prompt, so a fresh process loses nothing it needs.
- **Stopping.** Closing stdin ends the child cleanly. On off, takeover or close, it does that, or kills the process group if a turn is in flight.

## Files

All in `/private/tmp/claude-501/spike-persistent/` (the OS clears `/tmp`, so nothing needs deleting):

- `supervisor.js`: the supervisor above
- `post_items.js`: posts item sets w1 to w5 the way the browser does
- `system_prompt.v3.txt`: the system prompt
- `supervisor-<label>.log`: the supervisor's timeline, including every `result` event
- `stream-<label>.jsonl`: every line the child wrote, each with the time it arrived
- `filler1.txt`, `filler2.txt`, `doc-*.md`: the compaction filler (Claude Code docs pages)
- `tabulate.py`: prints every number in the tables from the logs
