# The Library

Read this before touching `src/service/catalog_*.js`, `src/layer/catalog/`, or `src/cli/commands/library.js`. The feature folder (`docs/features/20260922.02_lahe_library/`) is the history of why; this page is how it works now. Where the two differ, this page and the code win.

## Summary

- The Library is one page on the helper, `/catalog`, that lists every review on this machine, grouped by agent session.
- From a row the reviewer can Open a document, star it, rename it, or hand it to an agent (Pick this up, Launch a new agent).
- The page talks only to the helper, with its own Library token. It never posts to a review and never names a file to serve.
- The page reaches an agent only through a request queue. The agent sees requests in its normal drain and answers with `lahe library answer`.
- Everything the list shows is read from files on disk. Nothing the reviewer types on the Library (a rename, a star) is ever put in front of an agent.
- In the code, and in its routes and URL, the Library is `catalog`. "Library" in older code means the review layer script.

## Where it lives

- The page: `src/service/catalog_page.js` renders the HTML, its one inline style and its content policy. The browser code is `src/layer/catalog/view_model.js` (every rule, no DOM) and `src/layer/catalog/page.js` (drawing and clicks only). Both are served from `src/` through the `catalog.asset` route, never from `dist/`.
- The service: `catalog_reader.js` builds the list, `catalog_actions.js` handles each POST, `catalog_requests.js` is the queue, and `catalog_store.js` is the only code that touches `catalog.json`.
- The routes are `catalog.page`, `catalog.asset`, `catalog.list`, `catalog.open`, `catalog.star`, `catalog.rename` and `catalog.request` in `src/shared/protocol.js`. Their handlers are in `src/service/routes.js`.
- The CLI: `lahe library` (attach), `lahe library serve` and `lahe library answer`, in `src/cli/commands/library.js`. Flags are in `docs/CLI.md`.

## Auth

- The Library token is minted in memory at each helper start and written into the served page's meta tag. A helper restart makes the page's token stale, and the page says to reload.
- It is its own auth class, `CATALOG_TOKEN`. It can list, open (restart a server the review already had), star, rename and queue a request. It cannot post to a review or read comment text.
- Each route's checks are one table, `CATALOG_ROUTES` in `protocol.js`: `Sec-Fetch-Site: same-origin`, the token, a JSON body for POSTs, and an exact `Origin`. `src/service/auth.js` applies them.
- The content policy is `default-src 'none'`, with self-only scripts, connections, fonts and styles, `img-src 'self' data:`, and the inline style by hash. `test/unit/catalog_page_csp.test.js` pins the whole header.
- The route table, response shapes and error codes are in `docs/CONTRACTS.md`.

## The list

`catalog_reader.js` reads the state dir and never folds a large log. The response shape is "The list response" in the architecture doc.

- **Sessions and rows.** One entry per agent session, newest first. Reviews from before sessions (owner `legacy`) arrive as one group. The page splits that group into one card per project.
- **Folds.**
  - Old per-page reviews in one folder fold into one row (`fold_kind: "folder"`).
  - Several reviews of one document in one session fold into one row (`fold_kind: "document"`). Star and rename act on the whole fold.
- **Names.**
  - A row is named after its own page (the review's target), else the page with the most comments.
  - With no title recorded, the name comes from the file itself: its `<title>`, else a Markdown file's first heading.
  - With neither, the name is just the file name.
- **Paths.** A row's second line is `project_path`, the path from the project root: the repository, a worktree's own root, or `~/.claude` (labelled "claude config"). Outside any project it is the `~` path. It is never shortened. Pages behind a `.lahe-source` mount are listed by their real path.
- **Last worked on.** `last` is the time inside the newest event that is work on the document. Origin swaps, visits and adoption events do not count. It is never a file's modified time, because compaction rewrites old logs. With no readable event, it is `review.json`'s `generated_at`, then `meta.json`'s `created_at`.
- **Sections.**
  - The top section holds only waiting and starred reviews, under their session's header.
  - A session's other reviews appear as a second card, under This week or Older than a week by their own newest time.
  - Long cards show five rows plus any waiting or starred one, with "Show N more". A review's pages collapse to "N pages".

## Stars and renames

- Both live in `<state>/catalog.json`, written only by the helper through `catalog_store.js`. The file holds `stars`, `names` (per review), `session_names` and the `reopened` map.
- A corrupt `catalog.json` is never overwritten. Writes are refused with `PROTO_CATALOG_UNREADABLE`, and the list shows no stars with a notice.
- Renames are cut to 80 characters with control and invisible characters removed, by the session-name rule. The list carries them as `custom_name` beside the unchanged `display_name` or session `name`.
- On the page the name is the rename control. Enter or clicking outside saves. Escape cancels. An empty or unchanged value changes nothing, and typing the original back clears the rename.
- **A rename never reaches an agent.** It is not in `describeReview`, a drain entry, a request, or a hand-off message. `test/unit/catalog_routes.test.js` checks the drain for a marker name.

## Open, Pick this up, Launch

The flows are "Key Flows" in the architecture doc; the hand-over picture is the second diagram in `docs/diagrams/session_ownership.md`.

- **Open** restarts the review's recorded static server if it stopped, and opens the page in a new tab. It never serves a path the helper did not serve before.
  - With an attached agent it also queues a pick-up.
  - A row with nothing Open can restart (legacy, worktree, dev server) is `via-agent`: Open queues a pick-up and the agent re-serves it.
- **Pick this up** and **Launch a new agent** queue a request for the agent attached with `lahe library`. Requests carry ids only.
- **The confirm step.** When another agent is listening on, or working in, the document's session, the page asks first, naming that agent and the reviews that would move. The helper refuses an unconfirmed hand-over with `PROTO_CONFIRM_NEEDED`.

## The request queue

`<state>/catalog-requests.jsonl`. Only the helper appends requests and expiries; only `lahe library answer` appends answers.

- A request expires when:
  - the attached agent's monitor is dead, under the queue's rule (no live heartbeat and no lahe command in 10 minutes);
  - another agent attaches;
  - 30 minutes pass.
- At most five requests wait across the whole Library. Past that, Open still opens and says no agent was asked.
- The drain lists pending requests as `catalog_requests` on its last line, with the document's name, path and hand-off message added and marked as data.

## Pre-session reviews and adoption

- A review from before sessions belongs to no session. Picking it up keeps its old comments: `lahe library serve <request> --session <id>` runs `lahe review --review <id> --adopt`, which takes that review into the agent's session.
- Adoption writes the owner to `meta.json` and appends one `review.adopted` event, so log recovery and the projection read the new owner.
- It is allowed only for a review owned by `legacy`, and only while a Library pick-up of that review is pending for that session. `lahe add` checks the queue, and the helper's `review.write` checks it again, because scripts on the reviewed page can read the review token.
- A review that already belongs to a session is never adopted. The immutable-owner rule stands for everything else.

## Who is on a session

- The shared liveness function, `livenessFrom` in `agent_sessions.js`, answers `presence`:
  - `listening`: a live monitor heartbeat;
  - `working`: no live monitor, but a lahe command within `CATALOG.WORKING_MS` (2 minutes);
  - `away`: neither.
- The list carries `watching` (listening or working, with `last_active`) and `away`. The card says "is listening", "is working, last active <time>", or "last active <time>, not listening".
- Only listening or working asks before a hand-over.
- The rail's liveness payload never carries `presence`: `replies.poll` strips it.

## Tab icon and brandmark

- The Library's tab icon is a dark rounded square with books on a shelf, set apart from the blue speech bubble every reviewed document gets.
- The same image sits beside the "Lahe Library" heading, decorative.
- Both come from one constant, `LIBRARY_ICON_URI` in `src/service/tab_icon.js`, as an inline SVG that `img-src data:` allows.

## Helper lifetime

The pictures are "When the helper stops" in `docs/diagrams/session_ownership.md`.

- The last `lahe session close` does not stop the helper while the Library page has polled in the last 2 minutes (`catalog_seen_at` in health), or while a review page is open.
- That close writes `stop-when-quiet.json`. The helper then stops itself once it has gone 2 minutes with no open session, no open review window and no Library poll. An open session never lets it stop and removes the file. The code is `src/service/self_stop.js`.
- A new helper removes any old `stop-when-quiet.json` when it starts. After a sleep, the 2 minutes start again from the wake, so an open page gets its first heartbeat in.
- A helper or page server whose state dir is removed stops within 30 seconds (two 15-second checks in a row), even with a session open. A restored or synced copy of the dir that still names that process keeps it running. The check reads the dir's random token in `state-id`, not the inode, which Linux can reuse.
- Sessions an Open reopened are closed again by a 15-second sweep once they are quiet for 30 minutes.
- A session that bare `lahe library` created closes itself once it owns no reviews and its agent has been quiet for 30 minutes (no live monitor, no lahe command).

## Where else to read

- `docs/features/20260922.02_lahe_library/02_architecture_lahe_library.md`: the design, the list response and the key flows.
- `docs/CONTRACTS.md`: routes, bodies, error codes, the drain's `catalog_requests`, and the events.
- `docs/CLI.md`: `lahe library` and its verbs.
- `docs/diagrams/system_overview.md` and `docs/diagrams/session_ownership.md`: the shape.
- `skills/lahe/SKILL.md`: what an agent does with each request kind.
