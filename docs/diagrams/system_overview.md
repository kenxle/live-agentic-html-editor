# System overview

This is the current picture of what exists and what talks to what: the
reviewer's browser, the helper process, the store on disk, and the agent. It
updates the summary diagram in the architecture doc, which predates agent
sessions and the session-owned static servers shown here.

```mermaid
flowchart LR
    subgraph Browser["Reviewer's browser"]
        Lib["Library<br/>(runs in the page)"]
    end

    subgraph Machine["One machine"]
        Static["Static server<br/>(owned by the agent session,<br/>serves the page + library)"]
        Helper["Helper<br/>(one local Node process)"]
        Store[("Store on disk<br/>events.jsonl + review.json")]

        subgraph Session["Agent session"]
            Agent["Agent<br/>(Claude, Codex, anything)"]
        end
    end

    Static -->|"serves the page,<br/>the script line, the library"| Lib
    Lib -->|"every keystroke"| Lib
    Lib -->|"each finished comment or edit"| Helper
    Helper -->|"append + project"| Store
    Agent -->|"reads review.json"| Store
    Agent -->|"appends one reply line per item"| Store
    Helper -->|"tells the page what the agent said"| Lib
    Session -->|"owns"| Static
```

## What to notice

- The agent session owns the static server that serves the page, not the
  helper. That is why closing a session stops its own servers without
  touching anyone else's, and why one helper on the machine can sit behind
  several independent agent workstreams at once.
- The library also writes every keystroke to browser storage on its own,
  independent of the helper. That is what keeps the tool useful with no
  helper running at all: nothing here is required for the reviewer to keep
  working, only for the agent loop to exist.
- The store on disk is the one thing the helper, the agent, and (through
  polling) the library all read from. Nothing that happens on screen can take
  a record back; the store is the truth and the page is only a view of it.
