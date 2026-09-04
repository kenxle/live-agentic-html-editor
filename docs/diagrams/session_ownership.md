# Session ownership and handoff

One helper runs per machine, but many agent sessions can use it at once. This
is what each session owns, the rule that keeps sessions from stepping on each
other, and what happens when a human explicitly hands a session to a new
agent.

```mermaid
flowchart TD
    Machine["One machine"] --> Helper["One shared helper<br/>(local Node process)"]

    Helper --> SessA["Agent session A<br/>(s_...)"]
    Helper --> SessB["Agent session B<br/>(s_...)"]

    SessA --> RevA1["Review 1"]
    SessA --> RevA2["Review 2"]
    RevA1 --> PageA1["Page(s) of review 1"]
    RevA2 --> PageA2["Page(s) of review 2"]
    SessA --> StaticA["Static server(s),<br/>owned by session A"]

    SessB --> RevB1["Review 3"]
    SessB --> StaticB["Static server(s),<br/>owned by session B"]

    Refuse["The CLI refuses to attach a page<br/>or a review to a session<br/>that does not already own it"]
    RevA1 -.->|"immutable owner rule"| Refuse
    RevB1 -.->|"immutable owner rule"| Refuse

    Human["Human explicitly asks for a handoff"] --> Takeover["lahe session takeover A"]
    Takeover --> Fence["session A's handoff_rev advances by 1"]
    Fence --> Reopen["session and its static servers<br/>reopen if they were closed"]
    Fence --> OldMonitor["any older lahe monitor process<br/>for session A"]
    OldMonitor --> Exit6["sees the newer handoff_rev,<br/>exits with code 6, does not relaunch"]
    Fence --> Catchup["lahe status --session A --json<br/>lists every unanswered item first"]
    Catchup --> NewAgent["new agent arms its wake channel<br/>and drains from there"]
```

## What to notice

- Ownership nests: a session owns reviews, a review owns pages, and a session
  separately owns the static servers that serve those pages. Closing session A
  stops only session A's static servers; session B's keep answering.
- The immutable-owner rule is not about people, it is about the session
  record. A review remembers the session that created it, and no later
  command can move it to a different session by accident.
- Takeover does not delete anything and does not require the old agent to
  cooperate. It advances a fence number that every running monitor checks on
  its own next look, which is what makes an old monitor for the same session
  stop itself with exit code 6 instead of continuing to act on stale
  context.
