# A document index for LAHE

**Short version:** nothing is actually lost. The helper already keeps a record of every review, including the file path and the page title. What's missing is a page that lists them, at an address you can bookmark. My recommendation: build a "Library" page served by the helper at one fixed address, with a "bring it back" button on each row.

## What's on disk today

I counted with a script (`census.py`, run against `~/.local/state/lahe/reviews`):

| | Count |
| --- | --- |
| Reviews on record | 476 |
| Reviews whose file still exists | 418 |
| Reviews whose file is gone | 58 |
| Reviews on files inside a worktree or temp folder | 88 |
| Agent sessions | 96 |

Why so many (script `why476.py`, one row per review in `why476_rows.csv`):

- **Most are from before the Sep 16 fix.** Back then, agents registered every page you might click to as its own review. 407 reviews were created before Sep 17, and 70 since.
- **Today, clicking around doesn't create reviews.** Pages you click to inside a served folder join the review you started on.
- **Many are one-look pages.** 199 of them never got a single comment.
- **Most came from a few heavy days.** Sep 9 had 95 and Sep 16 had 115.

So the Library should group rows by folder and by agent session, not list each review on its own line.

Every review records:

- the file it points at
- the page title the browser saw (for example "Lahe, St. Clair AI")
- when it was created
- which agent session owns it
- every comment, edit, and agent reply

So the naming problem is mostly solved already. The page title is a good name, and the file path settles any tie.

## Why documents feel lost after a restart

Two things break, and they are separate problems:

1. **The tab's address is dead forever.** Each document is served on a random port (the number after `127.0.0.1:` in the address). After a restart, even if an agent serves the same file again, it gets a new port. Your old tab points at a port nobody answers. Reloading can't fix it.
2. **You don't know what you had open.** With the tabs dead, there's no list of what you were working on.

An index fixes the second. For the first, you don't need the old address back, just the document. So the Library's **Open** button re-serves the document itself, on whatever new port, and opens it. To send comments you still want an agent on it, so Open and **Copy prompt** (option C) work as a pair: open the page, paste the prompt into a new agent, and it takes over that session.

## Options

### A. A command only: `lahe library`

- Prints recent documents as a list: title, file, last activity, open comments.
- You'd ask an agent "what was I working on in lahe?" and it runs this.
- Cheapest. But it's text in a terminal, which is the thing you said you want less of.

### B. A Library page at a fixed address (recommended)

- The helper already runs at a fixed address (`http://127.0.0.1:7817`). Add a page there, for example `http://127.0.0.1:7817/library`.
- You bookmark it once. It works after every restart, as soon as the helper is running.
- Each row shows:
  - title
  - project folder (so "personal" and "live-agentic-html-editor" sort themselves)
  - last activity
  - open comments waiting on an agent
  - whether it's live right now
- Each row gets an **Open** button. If the document isn't being served, the helper serves it again and opens it. You can read right away; comments wait until an agent picks the session up (option C).
- Search box and a "last 7 days" default, so 476 rows don't bury you.

### C. B, plus "hand it to an agent"

- A **Copy prompt** button on each row. It copies one line like: *"Take over lahe review rc33ca6eb0fe4 (Lahe, St. Clair AI page) and continue."*
- You paste that into any new agent. It already knows how to take over a session from the lahe skill.
- This covers the "point at it and ask another agent to pick it up" part.

### D. Fix the dead tabs themselves (not needed: you only want the document back, not the old address)

- Give each document a stable address, based on the review id instead of a random port. Something like `http://127.0.0.1:7817/r/rc33ca6eb0fe4/`.
- Then old tabs come back on their own once the helper restarts. Your browser's "reopen tabs" would just work.
- This is the biggest change: it touches how pages are served, and security review would want a look. It's also the one that fully removes the "feels lost" moment.

## What I'd do

1. Build **B + C** first. It's mostly reading records that already exist, so the risk is low.
2. Skip **D**. The Open button brings a document back, and the old address doesn't matter.

## New problems this creates, and how I'd handle them

- **Duplicate names.** Two reviews titled "Brief". The row shows the project folder and file name under the title.
- **Clutter from agent work.** 88 reviews live in worktrees or temp folders. Default the list to hide files that no longer exist, with a toggle to show them.
- **Old stuff.** The code names a 30-day limit, but nothing in `src/` deletes old reviews, so today they pile up forever. The Library needs a rule: hide after some age, archive, or keep everything.
- **Pinning.** Might be worth a star for "this one matters," so the important ones don't sink under new ones.

## Questions for you

1. How far back should the Library show by default, and should anything ever get deleted?
2. Would you want the Library to start the agent for you (for example, launch Claude Code on that session), or is copy and paste fine?
