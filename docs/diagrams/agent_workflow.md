# The agent's loop

This is the loop an agent actually moves through, with the commands written
on the arrows instead of listed in prose. The second diagram below is the
wake channel in detail: how an agent hears about new work without spending
model tokens while nothing is happening, and what its three exit codes mean.

```mermaid
flowchart TD
    Start(["lahe review path/to/target"]) -->|"prints the open URL, session id,<br/>and the wake, monitor, drain, close commands"| Arm["arm the wake channel once<br/>(per host, see the wake channel diagram below)"]
    Arm --> Wait["wait, no model tokens spent while quiet"]

    Wait -->|"a wake line lands"| Drain["lahe status --session id --json --quiet"]
    Drain -->|"prints one or more items"| Handle["handle the items:<br/>make every edit, rebuild once,<br/>verify each change is really in the built page,<br/>send every reply in one lahe reply --batch"]
    Handle -->|"after a batch"| Chat["say one line in chat;<br/>the detail is on the cards"]
    Handle --> Drain
    Drain -->|"prints nothing"| Wait

    Wait -->|"another document to review"| Another["lahe review other.html --session id"]
    Another --> Wait

    Wait -->|"human asks for a handoff"| List["lahe session list"]
    List --> Takeover["lahe session takeover id"]
    Takeover --> Catchup["lahe status --session id --json<br/>(catch-up: unanswered items first)"]
    Catchup --> Drain

    Wait -->|"human says they are done"| Close["lahe session close id"]
    Close --> End(["session closed"])
```

The wake channel itself differs by host, and it is the part where prose alone
has failed before: a monitor that quietly times out and relaunches is the
exact no-op token burn the wake channel exists to prevent.

```mermaid
flowchart TD
    Host{"which host is this?"}
    Host -->|"Claude Code"| CC["lahe monitor --session id,<br/>run with Bash in the background;<br/>one launch waits until there is work<br/>(timeout 86400000 matters only unattended)"]
    Host -->|"Codex"| Cx["lahe monitor --session id --codex<br/>starts a local watcher and returns;<br/>end the model turn"]
    Host -->|"Antigravity"| AG["lahe monitor --session id,<br/>run as a background terminal task"]
    Host -->|"any other host"| Oth["lahe monitor --session id,<br/>run in the foreground"]

    Cx --> CxPoll["watch locally outside the model turn<br/>no model calls while idle"]
    CxPoll -->|"real work"| Queue["codex queue sends a wake<br/>to the same conversation"]
    Queue --> CxDrain["drain with the printed handoff revision,<br/>handle every item, re-arm with --codex,<br/>then end the turn"]
    CxDrain --> CxPoll
    CC --> LocalPoll["the monitor polls locally in one<br/>small Node process, no model tokens spent"]
    AG --> LocalPoll
    Oth --> LocalPoll
    LocalPoll -->|"work is found"| Exit0["exits with code 0, prints one line:<br/>what is waiting, the drain and the relaunch"]
    Exit0 --> Drain1["run the drain command,<br/>then launch the monitor again"]

    LocalPoll -.->|"session closed"| Exit5["exits with code 5"]
    LocalPoll -.->|"another agent took over"| Exit6["exits with code 6"]
    Exit5 --> Stop["STOP. do not relaunch"]
    Exit6 --> Stop

    Danger["a watch with a timeout,<br/>or a scheduled model wakeup"] --> Timeout["fires even though nothing happened"]
    Timeout --> Relaunch["model wakes up, finds nothing,<br/>re-arms, reports the no-op"]
    Relaunch -->|"repeats every few minutes"| NoOp["the no-op token burn"]
    NoOp -.->|"avoided by using"| LocalPoll
```

On Claude Code the relaunch is not left to the agent's memory. In an
interactive session one launch waits until there is work (no time limit since
Claude Code 2.1.288), but the monitor can still be stopped by Claude Code's
memory killer, or hit its timeout in an unattended run, and an agent that
forgets to start it again leaves the session deaf. Lahe's Stop hook catches
that at the end of every turn:

```mermaid
flowchart TD
    Try["Claude Code agent tries to end its turn"] --> Hook["Claude Code runs lahe hook stop"]
    Hook --> Active{"stop_hook_active?<br/>(already blocked once this turn)"}
    Active -->|"yes"| Ends["turn ends normally"]
    Active -->|"no"| Scan["read the agent's transcript for<br/>sessions it started or took over"]
    Scan --> Check{"any of them open, still at this agent's<br/>handoff rev, with a review not ended,<br/>and no live monitor heartbeat?"}
    Check -->|"no"| Ends
    Check -->|"yes"| Block["block once; the reason names<br/>lahe monitor --session id ..."]
    Block --> Run["agent runs it with Bash in the background"]
    Run --> Try
    Hook -.->|"any error"| Ends
```

## Whether one diagram could hold all of this

The spec set a hard condition: the workflow diagram may absorb the wake
channel only if it legibly carries all four of the wake feed being silent
versus a timer that is not, the per-host fan, the three exit codes, and the
timeout failure drawn as its own branch. Testing that against one drawing, the
per-host fan alone (four hosts, each with its own arming command) already
uses most of the width a flowchart can hold and stay readable, and the
failure branch needs its own lane so it reads as a warning rather than a
normal step. Cramming the main loop's five branches into the same picture
made both parts harder to read, not easier. So this file keeps two diagrams:
the loop above, and the wake channel below carrying all four required pieces.

## What to notice

- The main loop never has the agent stop and report that a wake arrived; the
  interrupt is a reason to keep working through drain, not a stopping point.
- The monitor's wake is one line, not the work. Only the drain prints items,
  so each item reaches the agent's context once. The drain leaves out the
  agent's own earlier answers in a thread, and the catch-up
  (`lahe status --json` without `--quiet`) keeps them. `lahe reply` prints back
  only the item and the status, with several items answered in one
  `lahe reply --batch` run, and after a batch the agent says one line in chat.
- Codex uses a local watcher that queues real work to the same conversation.
  The model turn ends while it waits, so idle monitoring cannot hold a graceful
  Codex restart open. Queue failures retry locally. After acceptance the worker
  exits; the agent drains to empty and re-arms it. One watcher covers the
  conversation's sessions, and guarded drains reject wakes from before a takeover.
  Other hosts keep their exit-on-work monitor. On Claude Code it runs with Bash in the background, where one
  launch waits until there is work (the 86400000 timeout matters only in an
  unattended run), and is launched again after each drain; the Stop hook
  blocks the end of a turn once when that relaunch was missed. A watch with a
  short timeout, or a scheduled wakeup, fires on nothing and looks exactly
  like new work landing, which is the no-op token burn shown in the lower
  diagram.
- Exit codes 5 and 6 both mean stop, but for different reasons: 5 is the
  reviewer ending the session on purpose, 6 is another agent explicitly
  taking it over. Either way, relaunching the monitor is wrong.
