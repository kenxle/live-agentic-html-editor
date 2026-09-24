# One comment, end to end

This is one comment or edit, traced from the reviewer's keystroke to the
reviewer seeing the agent's answer. The first half is identical no matter how
the page is served. Only the agent's half branches, on two questions: what the
agent edits, and how the reviewer's page gets the change back.

```mermaid
sequenceDiagram
    participant Rv as Reviewer
    participant Lib as Library (in the page)
    participant Br as Browser storage
    participant Hp as Helper
    participant St as "Store (events.jsonl + review.json)"
    participant Ag as Agent

    Note over Rv,St: Identical in every serving shape

    Rv->>Lib: types a comment or edit
    Lib->>Br: saves every keystroke
    Rv->>Lib: Cmd-Enter confirms
    Lib->>Hp: posts the record
    Hp->>St: appends to events.jsonl
    Hp->>St: projects review.json
    Ag->>St: reads review.json

    Note over Ag,Lib: Only the agent's half branches

    alt Served page, LAHE watches the file
        Ag->>Ag: edits source, rebuilds
        Ag->>St: verifies the change, is now in the built page
        Hp->>Lib: page reloads onto the new build
    else Built document, project build runs first
        Ag->>Ag: edits a source fragment
        Ag->>Ag: runs the project's own build command
        Hp->>Lib: page reloads onto the new build
    else App in dev, dev server hot-reloads
        Ag->>Ag: edits the app's source
        Note right of Ag: the dev server reloads on its own, not LAHE
    else "file:// fallback: the loop can quietly break"
        Note right of Ag: the script line lives inside the HTML file itself
        Ag->>Ag: rewrites the page (can remove the script line with it)
        Note over Hp,Lib: heal only lands if a page with a live library is still polling
        Hp->>Lib: writes the script line back, if it is watching
    end

    Ag->>St: appends one reply line
    Lib->>Hp: polls for replies
    Hp->>Lib: reply arrives
    Lib->>Rv: card updates, highlight clears
```

## What to notice

- Five sequences that are mostly identical would drift. This is one shared
  spine with a labeled fan on the agent's side, because everything up to
  "agent reads review.json" happens the same way regardless of how the page
  is served.
- The `file://` branch is marked because it is the one path where the loop
  can quietly break. There is no server putting the script line into a
  response, so the line is written into the HTML file itself. An agent that
  rewrites the whole page takes the line out with it, and the only way it
  comes back is if a page with a live library is still polling the helper
  when the rewritten file reappears.
- There is a sixth path with no agent loop at all: the library works with no
  helper running. Everything stays in the browser, and the copy and export
  buttons on the rail carry the reviewer's feedback out by hand. No work is
  lost, there is just nothing to drain.
