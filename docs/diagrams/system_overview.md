# System overview

This is the current picture of what exists and what talks to what: the
reviewer's browser, the helper process, the store on disk, the Library page
and its request queue, the menu bar icon on a Mac, and the agent. It
updates the summary diagram in the architecture doc, which predates agent
sessions and the helper serving every page at a stable address.

```mermaid
flowchart TD
    subgraph Browser["Reviewer's browser"]
        Lib["Review layer on a reviewed page<br/>(the code calls it the library)"]
        Cat["The Library page<br/>(helper's /catalog:<br/>every review on the machine)"]
    end

    subgraph Machine["One machine"]
        Helper["Helper<br/>(one local Node process:<br/>API on 7817, pages on 1483)"]
        Sites[("Name registry<br/>sites.json + sites.log")]
        Store[("Store on disk<br/>events.jsonl + review.json")]
        Queue[("Request queue<br/>catalog-requests.jsonl")]
        MenuBar["Menu bar app (macOS, optional)<br/>count of documents waiting on you"]
        Launchd["launchd<br/>(the helper's login item)"]

        subgraph Session["Agent session"]
            Agent["Agent<br/>(Claude, Codex, anything)"]
        end
    end

    Helper -->|"serves the page at name.lahe.localhost:1483,<br/>the script line, the library"| Lib
    Helper -->|"names one folder per site"| Sites
    Lib -->|"every keystroke"| Lib
    Lib -->|"each finished comment or edit"| Helper
    Helper -->|"append + project"| Store
    Agent -->|"reads review.json"| Store
    Agent -->|"appends one reply line per item"| Store
    Helper -->|"tells the page what the agent said"| Lib
    

    Cat -->|"catalog.list, open, star, rename, request<br/>(Library token, same-origin only)"| Helper
    Helper -->|"Open: binds the review's site<br/>and opens its address"| Sites
    Helper -->|"Pick this up, Launch:<br/>appends a request"| Queue
    Queue -->|"catalog_requests in the drain"| Agent
    Agent -->|"lahe library answer"| Queue

    MenuBar -->|"summary.read every 5 s, summary.open<br/>(signed request, signed answer)"| Helper
    MenuBar -->|"opens a document's address<br/>through the allowlist"| Browser
    MenuBar -->|"Stop: stopped.json, then bootout<br/>Start: bootstrap, kickstart"| Launchd
    Launchd -->|"starts at login"| Helper
```

## What to notice

- Two things are called "library". The in-page script that draws the rail is
  the library in the code. The page that lists every review is the Library to
  the reviewer, and `catalog` in the code, its routes and its URL.

- The helper serves every page, at a stable address named for the page's
  folder. No agent session owns a page's address, so closing a session closes
  only the session: its pages stay at their addresses. One helper on the
  machine sits behind several independent agent workstreams at once.
- The library also writes every keystroke to browser storage on its own,
  independent of the helper. That is what keeps the tool useful with no
  helper running at all: nothing here is required for the reviewer to keep
  working, only for the agent loop to exist.
- The store on disk is the one thing the helper, the agent, and (through
  polling) the library all read from. Nothing that happens on screen can take
  a record back; the store is the truth and the page is only a view of it.
- The Library page talks only to the helper, with its own token. It can list,
  open, star, rename, and queue a request. It cannot post to a review or name
  a file to serve: Open binds the site of a document the helper already served, and only if nothing else holds the page's rail. How it works
  now is `docs/ongoing/LIBRARY.md`.
- The request queue is how the page reaches an agent. Only the helper appends
  requests, and only `lahe library answer` appends answers. The agent sees a
  request in its normal drain, the same way it sees an ended review.
- The menu bar app is the only program that talks to the helper without a
  page. It signs each request with the CLI secret and trusts only answers the
  helper signs back; it asks the helper for a document's address and opens
  it in the browser. Stop and Start go through launchd, never the helper, and
  while Stop holds no `lahe` command starts a helper. How it works now is
  `docs/ongoing/MENU_BAR.md`.
