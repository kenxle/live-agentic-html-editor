# The rail should follow the reviewer through a folder of pages

Board row: `LAHE-static-site-folder` in `docs/BULLETIN.md`. Written 2026-09-16 after an agent reviewing a set of wireframe pages found the rail only on the page it had enrolled, and worked around it by enrolling every page one at a time. Ken read the first draft of this page and left notes; this is the rewrite with his decisions folded in. Nothing is built.

## What happens today

- A review remembers the exact file paths it was pointed at. The session's static server puts the rail into a response only when the requested file is one of those paths. Any other file under the same folder is served plain.
- `lahe review <folder>` does not mean "review these pages". A folder target falls into the app-in-dev row, which is built for a running app: it registers the app's origin and prints one script line for you to paste into the app's shared template (a Rails or Next layout), the one file every page is rendered through, so one paste reaches every page. A set of wireframes is separate HTML files with no shared template. There is no single place to paste the line, so that row leaves you pasting it into every file by hand, or doing nothing.
- One review can already span pages. Items carry the page they were made on, the rail shows each page only its own items, and `review.json` lists them all.

## Why per-page enrollment is the wrong answer

- A page nobody enrolled has no rail, and the reviewer only finds out by clicking through to it.
- A page added to the folder after enrollment is missed.
- It is a loop the agent has to remember to run. Today's run enrolled 82 pages as 82 separate reviews, and a similar run on Sep 9 made 139. Each one is a folder on disk with its own log, and 166 of the 384 reviews on this machine never received a comment.

## The rule, decided

**Anything our own static server serves gets the rail.** Ken's words while reading: this is our server, made for document review, so everything coming through it should be editable. A dev server someone else runs is different and keeps its row. Our server has no such excuse.

This replaces the "which pages get the rail" question in the first draft. Options A and B both tried to answer it by enrolling pages, one by folder and one on first visit. Neither is needed.

## What changes

- **The static server injects into every HTML file it serves**, not only files recorded as review targets. Everything else the server does stays the same. It stays read-only against the review store.
- **Which review an item lands in.** The script line the server injects names a review id and token. For a page no review recorded, the server uses the newest review on that server (a server is one per folder per agent session, so "newest on this server" is "the review this folder was opened for"). No enrollment, no write. The item's own event carries the page path, and that is all the rail and `review.json` need to group by page.
- **`lahe review <folder>` for a folder of HTML** starts the static server on that folder, creates one review for it, and prints the folder's index (or the first page) as the open link. It stops falling into the dev-server row when the folder holds HTML and no `--origin` was passed.
- **Docs:** a new row in the serving table in `AGENTS.md`, the lahe skill, and `docs/CLI.md`. The contract text does not change; it is about replies, not serving.

## What stands from earlier decisions

- **Comment threads stay page specific.** Ken: "those decisions stand." A page shows its own items. A "see all pages" view in the rail, so a reviewer walking a folder does not think their comments vanished, is a possible follow-on and not part of this.
- **`--source` for build output** keeps working exactly as it does now.

## Why the first draft's Option B was risky, in plain words

Today one program, the helper, writes a review's files, and the static server only reads them. Option B would have had both writing the same file. If they write at the same moment one overwrites the other, so a page the server just added could vanish when the helper saved a second later. Avoiding that means a lock, or routing the write through the helper, which is more machinery. The rule above needs no write at all, so the risk does not arise.

## Follow-ons Ken wants recorded

- **A folder of Markdown, or a mix of Markdown and HTML.** A future agent will try it. Wanted, not out of scope; a separate piece of work once this lands, because Markdown pages are rendered into LAHE's own artifact folder rather than served from the source folder.
- **The wireframing skill needs firmer guidance** on how it lays out a set of pages, regardless of how LAHE serves the folder. Ken: "the wireframes have been kind of all over the place every time they get generated." Its own board row, `LAHE-wireframe-skill-guidance`.
- **A see-all view** of every page's items in the rail (above).

## Before building

- Write the tests first: a folder of three linked pages, `lahe review <folder>` once, load each page through the server, the rail is present on all three; comment on page two, the item carries page two's path and lands in the folder's review; a page added to the folder after the review was opened also gets the rail; a page that already carries a LAHE script line for a different review is left alone (the existing rule).
- The serving table changes, so `AGENTS.md`, the skill, and `docs/CLI.md` change in the same commit.
- Two independent review passes on the diff before merge, and Ken sees the result on a page.

## Progress

- 2026-09-16: first draft with three options. Ken reviewed it and set the rule: everything our server serves gets the rail. Rewritten around that. Waiting on his go to build.
- 2026-09-16: built on branch `worktree-agent-a1170b7ccd8908d33`, tests first. The static server now serves the rail on every HTML file it hands out: a recorded target keeps its own review, and a page no review recorded rides the newest review of this server's own agent session rooted in this folder. Nothing is written to the review store to make that happen. `lahe review <folder>` is a static site when the folder holds at least one `.html` file of its own and no `--origin` was passed; it starts the server on the folder, mints one review for it, and opens `index.html` or the first page in name order. `target_paths` holds the folder alone: one entry, one meaning, and the same shape the dev-server row has always recorded, so heal.js and the reload poll already handle it. The cost, written down in `SERVING_ARCHITECTURES.md`: a folder review does not auto-reload the reviewer's page, because a directory's modification time is not a fact about any page in it. Docs updated in the same pass: the serving table in `AGENTS.md`, the lahe skill, `docs/CLI.md`, and a variation section here. Not yet reviewed, not merged.
- 2026-09-16: Ken overruled the narrowing the security pass asked for, and set the rule himself: "if you can navigate to a page from where you currently are, and you currently have the lahe editor, it should follow you across anything you click on... if you want to isolate a single file because you know other things around shouldn't be in there, that should be an option." So the rail follows the reviewer on a single-page review too: its server is rooted at the page's folder, and every page in that folder carries the rail. The isolation case is `lahe review <page> --only`, which records `only_recorded_pages` on the review; the static server never borrows an isolated review for a page it did not record. The narrowing goes one way: the helper route accepts it as true and never as false, because widening a review back out is what a leaked token would ask for. `lahe review` prints the served root and `lahe status` says `scope: only this page`. The nesting fix stands, restated as "a review answers for the folder its own server is rooted at", so two reviews nested one inside the other still do not reach into each other.
- 2026-09-16: two review passes came back (code lead and security) and the findings are fixed on the same branch. The every-page rule is now scoped to a review whose target IS the served folder, which closes two holes: a nested review taking over its parent's pages, and `lahe review ~/Desktop/x.html` handing a live token to every HTML file on the Desktop. A review of another agent session no longer answers for anything, recorded target or not. Auto-reload was built rather than documented away: a folder review stats the page the poll names, resolved under the folder, so its pages reload like single pages and one page's edit never reloads another; nothing is ever healed into them. The unbacked-server log line no longer fires for pages under a mount, `lahe status` reports a third value, `unserved`, for a folder review whose server is gone, `lahe review` prints the served root, and the helper log says so when a page recorded on its own keeps its own review while the folder review takes the rest. A one-sentence residual was added under D11 in the architecture doc: a folder review's token is readable on every HTML file under the served root.
