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
    Drain -->|"prints one or more items"| Handle["handle each item:<br/>edit source, rebuild,<br/>verify the change is really in the built page,<br/>append one reply line"]
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
    Host -->|"Claude Code"| CC["Monitor tool armed on<br/>tail -n 0 -f wake.log<br/>with persistent: true"]
    Host -->|"Codex"| Cx["lahe monitor --session id,<br/>run as a foreground pending exec,<br/>keep waiting on it"]
    Host -->|"Antigravity"| AG["lahe monitor --session id,<br/>run as a background terminal task"]
    Host -->|"any other host"| Oth["lahe monitor --session id,<br/>run in the foreground"]

    CC --> Silent["stays silent while there is no work,<br/>no model turns spent"]
    Silent -->|"a line lands in wake.log"| Drain1["run the drain command"]

    Cx --> LocalPoll["the monitor polls locally in one<br/>small Node process, no model tokens spent"]
    AG --> LocalPoll
    Oth --> LocalPoll
    LocalPoll -->|"work is found"| Exit0["exits with code 0, prints the work"]
    Exit0 --> Drain1

    LocalPoll -.->|"session closed"| Exit5["exits with code 5"]
    LocalPoll -.->|"another agent took over"| Exit6["exits with code 6"]
    Exit5 --> Stop["STOP. do not relaunch"]
    Exit6 --> Stop

    Danger["Claude Code Monitor armed WITHOUT persistent: true"] --> Timeout["hits its default 300 second timeout,<br/>even though nothing happened"]
    Timeout --> Relaunch["model wakes up, finds nothing,<br/>re-arms, reports the no-op"]
    Relaunch -->|"repeats every few minutes"| NoOp["the no-op token burn:<br/>a scheduled model wakeup wearing a disguise"]
    NoOp -.->|"avoided by using"| CC
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
- On Claude Code, `persistent: true` is the one setting that keeps the
  Monitor tool from defaulting to a 300 second timeout. Without it, the
  Monitor times out on its own and looks exactly like new work landing, which
  is the no-op token burn shown in the lower diagram.
- Exit codes 5 and 6 both mean stop, but for different reasons: 5 is the
  reviewer ending the session on purpose, 6 is another agent explicitly
  taking it over. Either way, relaunching the monitor is wrong.
