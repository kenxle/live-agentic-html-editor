# Crucible: LAHE Library

Date: 2026-09-22
Status: ACCEPTED

**Short version:** Build it, as Approach B: a live Library page in the helper, whose Open and Star buttons act directly (you said that's required). Picking a document up and launching a new agent still go through an agent. I found one hidden problem. The bookmark idea from the ideas page does not survive a computer restart, because the helper stops when the last session closes and nothing starts it at login.

## The idea, as stated

"I want some sort of index, file list, recent files guide, something that will allow me to point at anything that's been worked on in the lahe editor and ask another agent to go pick it up or restart it or bring it back." The decisions you already made on the ideas page (`docs/ongoing/DOCUMENT_INDEX_IDEAS.md`) carry over:

- Bring the document back on any address. The old port doesn't matter.
- Keep every review. Old ones drop out of the default view but never get deleted.
- Stars keep important documents on top.
- A dead worktree path opens the same file in the main repo.
- Group rows by folder and by agent session.
- The agent that opens the Library picks up the document you point at. Launching a new agent is a later option.

## Jobs to be done

1. **Find a prior document.**
2. **Open it again with the rail on it**, so comments reach an agent.
3. **Stop feeling buried.** New documents arrive faster than you close old ones. The Library has to make the pile feel smaller, not just list it.
4. **Close a tab without worrying.** Today you hesitate to close tabs because you don't know how to get the document back. Open tabs are doing the job of the index. The Library should make closing a tab safe.

## Who the user is

You, today:

- You run many agents at once.
- Each agent hands you pages to review. Everything gets a document: 20 or more a working day right now.
- You work from the browser and from chat, often by voice.
- You don't know or want to know where files live. Many are in worktrees or temp folders.

Soon, new users from the npm package and the Product Hunt launch (both on the board). They hit this later than you, because it takes weeks of use to build a pile.

## User context

On a laptop, working all day. Occasionally a computer restart will cause a browser window to have a row of tabs that are all dead-looking lahe docs. A Claude Code chat is always available. You're deciding what to pick back up, often mid-way through several other things.

## What already exists

- **In LAHE:** every review is on disk with its file path, page title, created date, owning session, and full comment history. `lahe session list` lists sessions, but not documents, and it shows ids instead of names.
- **Prior work:** only the ideas page. No brief, no board row.
- **Prior art:** the "Open Recent" list in editors like VS Code and Obsidian. It is the closest match: most recent first, pin to keep, and it quietly drops entries whose file is gone. Browser history is the status quo and fails here, because each document's address changes every time it is served. Nothing off the shelf reads LAHE's records, so there is nothing to adopt.

## Evidence

- Your own words: "overwhelmed", "feels like I lost my documents".
- 477 reviews since Aug 13, but many are one review per page from before the Sep 16 registration fix. Folded the way reviews register today, they come to 213 folders, 54 of them since Sep 17. That is a floor: two documents in one folder (a brief and a plan) count once. (`why476.py`, then `docs_count.py`, one row per review in `docs_count_rows.csv`.)
- Still a large number after the correction, and you expect 20 or more new documents each working day.
- There is one user, and it bites daily: 20 documents a day, you can't remember their names, and you need to close them to clear your desktop. You need to browse, not search.

## Status quo

Open tabs are the index: you keep them open because closing one feels like losing it. After a restart they all die at once. Then you ask an agent to find the document, and it greps the disk or its chat history. Or you give up on the document.

## Premises

Premises 3 and 5 drew no objection and stand. Premises 1, 2 and 4 were revised on your comments, as written.

1. **Open: what a row is.** A document, a review, or a session. Given the volume, grouping by review or session may read better than a flat list of documents. The wireframe phase settles it: I'll mock the three groupings on your real data and you pick.
2. **An agent is usually in the loop to bring something back, and the Library can also launch a new one.** Usually the agent that opened the Library picks the document up. A **Launch a new agent** button starts a fresh agent on that document instead, so one agent isn't juggling ten. In scope to explore. The complication: a web page that starts programs on your laptop is the riskiest thing this feature could add. The safe shape is for the button to ask the agent already running, and that agent launches the new one (for example, a new Terminal window running Claude Code with the takeover prompt). The page itself never starts anything.
3. **The helper does not need to be running at login.** After a restart, "open the lahe library" starts it. So a browser bookmark to the Library only works once some agent has started LAHE that day.
4. **The Library has to manage volume.** At 20 or more documents a day, a plain list stops working within a week. How it manages that (a recent window, grouping by day, stars, collapsing) is a design question for the wireframe, not a premise. Nothing is ever deleted.
5. **Rows need a name you'd recognize.** The page title does that for most rows. For the rest (untitled pages, duplicate titles like "Brief"), the Library shows the folder and file name under it.

## The case against building this

Nearly all of it can be done today by asking an agent "find the lahe document about the style systems." The records are on disk and an agent can grep them. What's missing is a page to browse when you don't remember the name. If the real pain is only the moment after a restart, a one-line `lahe library` command whose output an agent reads to you might be enough. **Answered:** you can't remember the names, so you need to browse. That rules out the command-only version.

## What happens if we do nothing

The pile keeps growing at roughly the Sep 17 to Sep 22 pace. Each restart costs you the full set of open documents, and getting one back means an agent search. Nothing is lost on disk. What you lose is the sense of where your work is.

## Approaches considered

### Approach A: The Library is a LAHE document

- **Summary:** `lahe library` builds one HTML page listing every document, then serves it as a normal review in the agent's own session. You act on a row by clicking a button or commenting on it. The action arrives at the agent like any other comment. The agent takes over the document's session and brings it back.
- **Effort:** M. **Risk:** Low.
- **Pros:**
  - Reuses the whole comment-to-agent loop you already use every day.
  - The page never gets to command the helper. The agent does the work, so there's no new security surface.
  - Works the same way for Codex and Antigravity.
- **Cons:**
  - Starring or opening goes through the agent, so it takes a few seconds, not an instant.
  - The page is a snapshot. It is rebuilt each time it is opened, not live.
  - Each document goes back to its own review and its own session, with its old comments, not into the Library's session. So an agent that picks up five documents ends up holding five sessions. Today that means five monitors; the architecture has to make that manageable.
- **Reuses:** `lahe review`, session takeover, the review records, the Markdown/HTML serving path.

### Approach B: A live Library page inside the helper (recommended)

- **Summary:** A page at `127.0.0.1:7817/library` that reads the records live. Its Open and Star buttons act directly: the helper starts a server for the document and opens it.
- **Effort:** L. **Risk:** Med.
- **Pros:**
  - Instant, and always current.
  - One fixed address to bookmark.
- **Cons:**
  - Local-only still counts here. Any website open in your browser can send requests to `127.0.0.1`, which is why the helper checks a per-review token on every request (decision D11, "loopback is not a boundary"). A Library route that serves files or launches agents has to pass the same checks. That is known work that reuses existing code, not a new security design.
  - It bends the rule that a session owns its servers. Kept small, it could be fine: one server, owned by the helper, that serves every document the Library brings back. The document's comments still need an agent session to reach anyone.
  - The bookmark still fails after a restart until the helper is up (premise 3).
- **Reuses:** the review records, the static server code.

### Approach C: No page, just a command

- **Summary:** `lahe library` prints a grouped list. You ask an agent "what was I working on", it runs the command and reads you the top items.
- **Effort:** S. **Risk:** Low.
- **Pros:** Smallest change, and it ships first.
- **Cons:** It is the chat-scroll problem you already told me you want less of. No browsing, no stars.
- **Reuses:** `lahe session list`.

### Do nothing

Agents grep for documents when asked. You lose the browse view and keep the "buried" feeling.

## Recommended approach

Approach B. Open and Star acting directly is required, and only B does that. Both buttons go through the helper's existing token check. One server, owned by the helper, serves every document the Library brings back. The two actions that need judgment stay with agents: **Pick this up** reaches the agent that opened the Library, and **Launch a new agent** asks that agent to start one. Approach C falls out for free: the same data can print as a list in the terminal.

## Open questions

- What a row is, and how rows group (premise 1). Settled in the wireframe.
- How the view keeps the volume manageable (premise 4). Settled in the wireframe.
- How a new agent gets launched (premise 2): which host (Claude Code, Codex), in which app (Terminal, iTerm, the Claude desktop app), and whether the new agent gets a name you can recognize. Settled in the architecture.
- What the Library does when no agent is listening (premise 2 says "usually"). The safe way to launch an agent needs a running agent to ask. With none, the page could offer the takeover prompt to copy, or the helper could launch one itself, which brings back the risk. Settled in the architecture.

## Challenges you accepted

- Local-only is not a boundary: the Library's buttons use the helper's existing token check.
- Each picked-up document keeps its own review and session, so one agent may hold several sessions.

## Challenges you rejected

- **"Ask an agent to grep for it" is enough.** Rejected: 20 documents a day, you can't remember the names, you need to browse.
- **Approach A, acting through comments.** Rejected: Open and Star must act directly.
- **The Library should never start agents.** Rejected: a Launch a new agent button is in scope.
- **A fixed default view (7 days, grouped by day) as a premise.** Rejected: that is a design question, and the premise is only that volume must be managed.
- **This must come before the npm package and Product Hunt.** Rejected as not a requirement.

## What we skipped and why

- Future-fit: skipped. More agents means more documents, so this only gets more needed.
- Roadmap priority: you said ordering is not a requirement.

## The assignment

Write the brief for Approach B, then wireframe the three row groupings (by document, by review, by session) on your real data so you can pick one.
