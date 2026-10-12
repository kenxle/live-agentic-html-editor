# Architecture: Menu bar app

## Summary

The helper gains one read-only answer, the **summary**, and one small record, the **seen marks**. Both are plain Node in `src/service/` and run on every system. A Swift program in a new top-level `macos/` folder draws the icon and menu from the summary. `lahe install` builds that program on the Mac with `swiftc`, puts it in the state folder as a small app, and starts it at login with its own login item. The helper rebuilds the app when its source changes. The app proves its permission with a signed request keyed by the CLI secret, so the secret itself never travels, and it trusts only answers the helper signs back. No agent-facing behavior changes.

```mermaid
flowchart LR
    subgraph Core["helper (Node, every system)"]
        Reader["catalog reader<br/>(per-review cache)"] --> Summary["summary.read"]
        Windows["window claims<br/>(focused, page)"] --> Seen["seen marks<br/>seen.json"]
        Seen --> Summary
        Sessions["agent sessions<br/>+ monitor heartbeats"] --> Summary
        OpenRoute["summary.open"] --> Actions["catalog open rules"]
    end
    subgraph Mac["macOS only"]
        App["Lahe menu bar app<br/>(Swift, built on the Mac)"]
        Item["login item<br/>lahe-menubar"]
    end
    App -->|"every 5 s, signed request"| Summary
    App -->|"click a row"| OpenRoute
    App -->|"opens the returned address"| Browser["browser"]
    Item --> App
    Helper2["helper timer"] -.->|"source changed: rebuild, restart"| App
```

## Analysis of Existing Structure

- **The catalog reader** (`src/service/catalog_reader.js`) already builds, per review, the title, pages, address, last-worked time, waiting count, and its session's liveness. It is read-only and never returns comment text. Building the whole list takes about 150 ms warm and 870 ms cold on Ken's 690 reviews, measured with [scripts/time_catalog.js](scripts/time_catalog.js) on 2026-10-12. Too slow to rebuild every few seconds; fine to rebuild one review at a time.
- **Window holders** (`src/service/reviews.js`): every review page claims and heartbeats every 10 seconds, and says `quiet: true` when its window loses focus, though not on its first claim. The helper persists holders to `windows.json`. A new `focused` field on the same claim is what "Ken looked" stands on.
- **Replies** carry an `at` time once folded. The helper is the single reader of reply files and the single writer of `events.jsonl`, so every change to a review moves that file.
- **Agent sessions and monitor heartbeats** (`src/service/agent_sessions.js`) already answer "is this session's agent listening".
- **The CLI secret** (`<state>/cli-secret`, owner-only) and the `AUTH.CLI_SECRET` mode already exist for `site.bind` and `review.retire`. Those routes refuse any request with an `Origin` header.
- **The login item** (`src/service/login_item.js`, `src/cli/commands/install.js`) writes `~/Library/LaunchAgents/lahe-helper.plist` and records `install.json`. The CLI starts an installed helper with `launchctl kickstart`.
- **Catalog Open** (`src/service/catalog_actions.js`) binds a document's site and returns its address.

What stays the same: every existing route, the Library page and its token, the agent contract, the review layer bundle.

## Components / Modules Touched

| Where | What | New or changed |
|---|---|---|
| `src/service/summary.js` | Builds the summary from the reader, window holders, seen marks and sessions, with a per-review cache | new |
| `src/service/seen_store.js` | The only writer of `seen.json` | new |
| `src/service/catalog_reader.js` | Exposes a one-review summary, and adds two counts to it: open questions and the newest agent reply time | changed |
| `src/service/reviews.js` | Tells the seen store when a focused window claims or heartbeats, naming its page | changed |
| `src/layer/sync.js` | Adds the page's path to its claim and heartbeat (one optional field) | changed |
| `src/service/routes.js`, `src/shared/protocol.js`, `src/service/auth.js` | Two routes, `summary.read` and `summary.open`, and a new auth mode, `AUTH.CLI_PROOF` (signed requests and answers) | changed |
| `src/service/index.js` | Wires the seen store into reviews, the summary into the routes, and the menu bar tick into the 15-second timer | changed |
| `src/service/menubar.js` | macOS only: the one build recipe, the app's login item, `tick` (rebuild on change) | new |
| `docs/CONTRACTS.md` | The summary's fields and the signed-request wire | changed |
| `src/cli/commands/install.js` | Offers the icon, `--menu-bar` and `--no-menu-bar`; uninstall removes it | changed |
| `src/cli/commands/menubar.js` | `lahe menubar show` brings a hidden icon back; `lahe menubar rebuild` | new |
| `src/service/login_item.js` | Starting a helper that the app stopped: bootstrap before kickstart | changed |
| `src/cli/commands/status.js` | One line on the menu bar app (R20) | changed |
| `macos/menubar/` | `LaheMenuBar.swift`, `Info.plist`, `README.md` | new |
| `src/shared/manifest.js` | The new `src/` files | changed |
| `docs/ongoing/MENU_BAR.md`, `docs/CLI.md`, `docs/INSTALL.md`, `CLAUDE.md` (directory layout) | How it works now | new and changed |

The Swift source lives outside `src/` on purpose. `src/` is Node, and lint and the manifest check every file there as JavaScript. `macos/` is the place for code that only one system builds, the way `vendor/` is the place for code we did not write.

## Data / State Changes

### `seen.json` (state folder, helper-only writer)

```json
{
  "version": 1,
  "seeded_at": "2026-10-20T14:02:11.000Z",
  "reviews": { "r183d18583a43": { "/00_crucible_menu_bar_app.md": "2026-10-20T15:40:03.120Z" } }
}
```

- `seeded_at` is written on the first `summary.read`, which is the first time the installed app asks. Any agent reply older than it counts as seen. Seeding on helper start would count everything between PR 1 landing and the install. Marks written before seeding are harmless.
- `reviews[id][page]` is the last time a **focused** window on that page claimed or heartbeat. Claims and heartbeats gain two optional fields: `focused`, computed at send time as the page's attention being focused (the focused tab of a focused window), and `page`, the same page path the layer already stamps on its records, from the same function. The seen store reads `focused`, not `quiet`: `quiet` is false on every page's first claim, focused or not, because the page has not yet learned the quiet interval (`src/layer/sync.js`). A claim from an older bundle carries neither field; the helper then marks nothing, so an old tab can hold a count until it reloads but never clears one early.
- The helper writes only when the write would change a count: when a focused window's time passes the newest agent reply on that page and the stored mark is older than that reply. So a focused tab costs one write per new answer, not one per heartbeat.
- A missing or unreadable file: the helper starts a new one with `seeded_at = now`. Losing marks can only make the count smaller, never larger.
- One document reviewed by several reviews (one folded Library row) counts once: the summary folds with the Library's own rule after building each review.

### What counts as waiting on you

A document waits on you when either holds:

1. **An open question (R5):** an item in `ready` whose reply, for its current revision, is a `question`, and whose reply arrived after `seeded_at`. It stops counting when the item no longer carries that reply (Ken answers, which moves the revision; an agent replies again; the card is deleted).
2. **An unseen answer (R6):** an agent reply of any status, on page P, whose time is after both `seeded_at` and the seen mark for P.

Neither counts for a retired review, a review with `ended_at`, or a document the reader marks missing (R7).

The icon counts **documents**, not cards: each one is one click. Today 45 documents have an old open question (64 questions; 34 from the last month), counted by [scripts/count_questions.py](scripts/count_questions.py) on 2026-10-12. The `seeded_at` rule keeps all of them out. Whether an open question should stop counting once Ken has looked at it is a question for Ken (see the questions leaf).

### `summary.read` response

```json
{
  "summary_version": 1,
  "helper": { "version": "0.4.0", "started_at": "...", "always_on": true },
  "waiting_on_you": {
    "count": 2,
    "documents": [
      { "review": "r183d18583a43", "title": "Crucible: Menu bar app", "path_hint": "~/Documents/...",
        "questions": 1, "unseen_answers": 3, "newest_at": "..." }
    ]
  },
  "waiting_on_agents": { "count": 4, "documents": [ { "review": "...", "title": "...", "path_hint": "...", "waiting": 4 } ] },
  "open_documents": { "count": 3, "more": 0, "items": [ { "review": "...", "title": "...", "path_hint": "...", "focused": true } ] },
  "sessions": {
    "open": 5,
    "connected": { "count": 2, "more": 0, "items": [ { "session": "s_...", "name": "...", "presence": "listening", "last_heard_at": "...", "review": "..." } ] }
  },
  "recent": { "more": 12, "items": [ { "review": "...", "title": "...", "path_hint": "...", "last": "..." } ] },
  "library_url": "http://library.lahe.localhost:1483"
}
```

- Open, connected and recent lists are capped at 8 in `items`, with `more` for the rest (R12). Waiting on you is not capped. `sessions.open` counts sessions not closed. `library_url` is the Library's printed address, with the pages port when the port-80 forward is not proved.
- The exact field list, types, and the signed-request wire below are written into `docs/CONTRACTS.md` before any builder starts, and a fixture and proof vectors are committed beside them (plan, Step 0).
- No comment text, no tokens, no absolute paths, the same rules as the Library list. Titles have control characters removed.
- A session is connected when `agent_sessions` liveness says its agent is listening (a live monitor) or working (a `lahe` command in the last few minutes), the same test the Library shows (R10).
- An open document is a review whose window holder is current, focused or not.
- A session's `name` is its Library rename if Ken gave one, else the title of its most recent review.

### The signed-request wire (`AUTH.CLI_PROOF`)

- **Key:** the text of `<state>/cli-secret` with surrounding whitespace removed (64 hex characters), used as its UTF-8 bytes.
- **Request headers:** `x-lahe-proof-ts` (Unix time in milliseconds, decimal), `x-lahe-proof-nonce` (16 random bytes as 32 lowercase hex characters), `x-lahe-proof` (lowercase hex HMAC-SHA256).
- **What is signed:** the lines `lahe-proof-v1`, the method, the path with its query string exactly as sent, the timestamp, the nonce, and the lowercase hex SHA-256 of the body (of the empty string for a GET), joined by `\n` with no trailing newline.
- **The version** travels as `?v=1` on `summary.read`, so the signature covers it, and as `summary_version` in `summary.open`'s JSON body.
- **The answer** carries `x-lahe-proof-reply`: HMAC-SHA256 with the same key over the lines `lahe-proof-reply-v1`, the request's nonce, the status code, and the hex SHA-256 of the response body. Error answers are signed too, so the app can tell the helper's 409 from a squatter's.
- **The helper** accepts a timestamp within 30 seconds of its clock, refuses a nonce it has seen in that window, and compares signatures in constant time.

### `summary.open` request

`{ "review": "r..." }` returns `{ "url": "http://<name>.lahe.localhost/<path>" }`. It runs catalog Open with `handoff: false`, so it opens at the address the Library would use and never queues a pick-up for an agent (R11). A row that only an agent could serve (`PROTO_NOT_OPENABLE`) returns `{ "url": null }`, and the app opens the Library instead.

### `install.json` gains a `menubar` block

`{ "app": "<state>/menubar/Lahe.app", "label": "lahe-menubar", "login_item": "...", "source_stamp": "<sha256 of macos/menubar/*>", "built_at": "..." }`. Absent when the icon is not installed.

## Key Flows

### The menu stays current

```mermaid
sequenceDiagram
    participant App as Menu bar app
    participant H as Helper
    participant Cache as per-review cache
    loop every 5 seconds, and when the menu opens
        App->>H: GET summary.read (signed proof, no Sec-Fetch headers)
        H->>Cache: stat events.jsonl and review.json per review
        Cache-->>H: rebuild only reviews whose files changed
        H->>H: add window holders, seen marks, sessions
        H-->>App: summary, signed
        App->>App: drop it unless the signature checks
        App->>App: redraw icon count and menu
    end
```

The per-review cache keeps a request to a few stat calls per review: the review's `events.jsonl`, `review.json` and `meta.json`, plus the reviewed document itself (so a deleted file drops out) and `catalog.json` once per request (so a Library rename shows). A same-size rewrite inside one millisecond is caught by comparing size, modified time and inode together. The plan sets the budget (R21) and measures it on Ken's state folder.

### Ken looks at a document

```mermaid
sequenceDiagram
    participant Page as Review page (focused)
    participant H as Helper
    participant S as seen.json
    Page->>H: claim or heartbeat, focused: true, page
    H->>H: newest agent reply on this page newer than its mark?
    alt yes
        H->>S: mark = now
    else no
        H->>H: nothing written
    end
```

Focusing a tab sends a claim at once, and focused tabs heartbeat every 10 s, so the next summary (within 5 s) drops that page's unseen answers: inside R3's 15 seconds. An open question stays until it is answered (rule 1).

### Install, rebuild, and Quit

```mermaid
flowchart TD
    Install["lahe install on a Mac<br/>(asks: add the menu bar icon?)"] --> Tools{"xcrun finds swiftc?"}
    Tools -->|"no"| Msg["prints: run xcode-select --install,<br/>then lahe install again.<br/>The rest of install completes."]
    Tools -->|"yes"| Build["swiftc builds Lahe.app<br/>in the state folder"]
    Build --> Item["writes lahe-menubar.plist:<br/>RunAtLoad, restart only on a crash"]
    Item --> Record["install.json records the app<br/>and its source stamp"]

    Timer["helper timer, every 15 s (macOS, installed)"] --> Stamp{"macos/menubar changed<br/>since the recorded stamp?"}
    Stamp -->|"yes"| Rebuild["rebuild in a child process,<br/>swap the app; restart it only<br/>if it was running"]
    Stamp -->|"no"| Idle["nothing"]

    Hide["menu: Hide the icon"] --> Exit["app exits cleanly;<br/>launchd leaves it stopped<br/>until login or lahe menubar show"]
    Stop["menu: Stop Lahe until next login"] --> Bootout["launchctl bootout lahe-helper"]
    Bootout --> Back["next login loads it again.<br/>A lahe command that needs it<br/>bootstraps the item, then kickstarts"]
```

- **Hide** exits with status 0. The login item restarts the app only on a crash (`KeepAlive` with `SuccessfulExit: false`), so Hide holds until the next login or `lahe menubar show`.
- **Stop Lahe** unloads the helper's login item, because a plain kill would be restarted at once. Whether Stop should hold while agents are connected is a question for Ken (the questions leaf); this design assumes it does not, and the menu says so. Today a `lahe` command asks an unloaded item to kickstart and fails. `startThroughItem` gains one step: when kickstart reports the job is not loaded, bootstrap the plist first. That keeps agents working after Ken stops Lahe.
- **Start Lahe**, shown when the helper is down, does the same bootstrap and kickstart.
- **Bootstrap checks the plist first.** Before loading `lahe-helper.plist`, the CLI checks its contents are what `login_item.js` would write for the recorded install, and refuses with a message to run `lahe install` if not (SR6).
- **The labels are constants.** The app and the CLI use the fixed labels `lahe-helper` and `lahe-menubar` and their fixed plist paths; nothing reads a label from `install.json` to run `launchctl` (SR6). Tests get their own labels through a seam that stays a constant: the CLI's existing `label` and `home` options, and a compile-time `-D` flag for the app. No test ever loads, stops, rewrites or removes the real labels.
- **A rebuild respects Hide.** After swapping in a rebuilt app, the helper restarts it only if `launchctl print` says it was running. A hidden icon stays hidden through a `git pull` (R17).
- **The app's Start does not check the plist's contents.** It bootstraps only the fixed path in Ken's own `~/Library/LaunchAgents`; anything that can write there can already run code at his login, so the check adds nothing for the app. The CLI keeps its check because it also covers a stale install.
- **One build recipe.** `src/service/menubar.js` holds the only build function, the fixed file list and the pinned compiler flags (`-swift-version 5`, the host architecture, a macOS 13 floor). The build check script calls it.
- **What a rebuild compiles.** Only the clone named in `install.json`, never a worktree; a fixed list of files in `macos/menubar/`, copied into a fresh temp folder, hashed there, built there with `/usr/bin/xcrun swiftc`, and renamed into place only on success (SR5).

## Alternatives Considered

<!-- forge-include: parts/architecture/alternatives.md -->

## Failure Modes / Edge Cases

- **Helper down.** Nothing answers on the port. The app shows the not-running look and a Start item (R2). It keeps asking every 5 s, so it recovers on its own.
- **Can't tell (R2).** A refused request, a timeout, an answer the app cannot parse, a version mismatch, or the first seconds after the Mac wakes: the app shows the "can't tell" look, never the plain mark and never the last number. After a wake it shows "can't tell" until its first fresh answer.
- **App older than the helper.** The app sends the `summary_version` it was built for. The helper answers a mismatch with `409 SUMMARY_VERSION`, and the app shows "can't tell" with "Lahe was updated; rebuilding" (R18). The rebuild timer usually gets there first.
- **App newer than the helper** (pulled, helper not yet restarted). The route does not exist, so the request gets a 400 and the app shows "can't tell". The helper's own staleness check replaces it at a quiet moment, as today.
- **Rebuild fails** (tools removed, compile error). The helper keeps the old app, records the error in `menubar.log`, and `lahe status` names it. It retries only when the source stamp changes again, so a broken build does not compile every 15 s.
- **CLI secret missing or changed.** The app rereads the file on each 401. A missing file shows "can't tell" with the reason in the log.
- **An answer the app cannot verify.** A missing or wrong signature, from a squatter or a bug, is dropped: "can't tell", logged once per minute at most.
- **Clock skew.** The helper and the app read the same Mac clock, so the 30-second window only matters across a sleep. A refused proof after a wake is retried with a fresh timestamp on the next poll.
- **A review whose file is gone, or an unreadable review.** Never waiting on you (R7). It can still appear under recent, and Open goes wherever catalog Open sends it, which for a gone file is the plain "file is gone" page.
- **A worktree review.** Open follows catalog Open, which already serves a gone worktree file from the main checkout.
- **Many documents waiting.** The icon shows the number up to 99, then "99+". The waiting list is not cut (R12); in practice the install cutoff (R4) keeps it short.
- **Two windows on one review.** Either focused window counts as looking at its own page. Seen marks do not care which one holds the rail, so the helper records the claim attempt even when the window does not get the rail.
- **Clock jumps** (sleep, time change). Marks and reply times are both helper clock readings or reply `at` stamps; a jump backward can only make a document look seen early, never stuck.
- **Another user on the Mac.** Their app reads their own state folder and their own helper port. The secret file is owner-only.
- **Ken renames or retires a review.** Retired reviews are dropped from every section. A rename shows on the next summary.

## Security & Privacy Notes

- **Signed requests, so the secret never travels (SR1).** The app does not send the CLI secret. It sends a proof: a timestamp, a random nonce, and HMAC-SHA256 keyed with the secret over the route name, timestamp, nonce, and a hash of the body. The helper accepts a proof within 30 seconds of its own clock and refuses a nonce it has seen in that window. The helper signs its answer the same way, over the nonce and a hash of the response body, and the app drops any answer whose signature does not check and shows "can't tell". A program squatting on the port while the helper is stopped learns one used proof for one route, nothing it can replay or use on `site.bind`. Node has HMAC in `node:crypto` and Swift in CryptoKit, so no packages are added. The app connects to `127.0.0.1` at the port in `service.json`, never `localhost`.
- **Who can reach the routes.** The proof is the control: a web page cannot read the secret file. Two more checks stand behind it. Both routes refuse any request carrying a `Sec-Fetch-Site`, `Sec-Fetch-Mode` or `Sec-Fetch-Dest` header, which current browsers send on every request to a loopback address and the app never sends (SR2). `summary.open` is a POST with a JSON body, so it also refuses any `Origin` header. Neither route is a catalog route, the Library host never routes to them, and the Library token is never accepted. The helper's Host check still applies, which stops DNS rebinding.
- **The `page` field (SR3).** At most 1024 characters, and it marks something only when it is one of the review's own pages that carries an agent reply; anything else is ignored and nothing is stored. Keys are stored in an object with no prototype, so a name like `__proto__` is just a string. Accepted risk: a page holding a review's token can clear that review's unseen answers, and only that review's. A page's token already lets it do far more to its own review.
- **What it holds.** Titles, `~` paths, counts, times, session names. No comment text, no review tokens, no absolute paths. Same exposure as `lahe status`, which any process running as Ken can already run.
- **`summary.open` opens nothing itself (SR4).** It returns an address. The app opens it only when it parses as `http`, with no user or password part, a host of `library.lahe.localhost` or a valid site name followed by `.lahe.localhost`, and a port that is absent or equal to the pages port in `service.json`. It opens the URL rebuilt from those parsed parts, not the original string. The same check applies to `library_url`. Anything else is dropped and logged. Titles are page-derived: the helper strips control characters and Unicode format characters (such as bidirectional overrides) and caps the length, and the app sets them as plain menu text.
- **Building code on the user's machine.** `swiftc` compiles only the fixed file list from the installed clone, in a fresh temp folder, invoked as an argument array, never through a shell (SR5). The app is not signed. A program built locally carries no quarantine flag, so Gatekeeper does not block it.
- **launchctl calls from the app and CLI** use the fixed labels and paths, never values read from a file (SR6).
- **Follow-up, not in this feature:** the CLI's two existing secret routes (`site.bind`, `review.retire`) still send the raw secret after an unauthenticated `/health` probe. They should move to the same signed proof. Filed on the board.

## Test Strategy

The plan owns the one verification table: [03_plan_menu_bar_app.md](03_plan_menu_bar_app.md). Every failure mode above is a row there. In short: unit tests cover the summary rules, seen marks, the routes' auth, and the install and rebuild logic on every system; a Mac-only check builds the Swift app; screenshots and a walkthrough cover the icon and menu.

## Open Questions

In the brief's [questions leaf](parts/brief/questions.md).

## Architect Review

Not run. The orchestrator chose the security review for this design (a new reader of private data) and judged the rest an established pattern: a new read route on the existing auth mode, and a second login item beside the first.

## Security Review

Full prose in [02_architecture_menu_bar_app_reviews.md](02_architecture_menu_bar_app_reviews.md).

| # | Finding | Disposition | Rationale |
|---|---------|-------------|-----------|
| SR1 | The app would send the secret to anything on the helper's port, open for hours after Stop | Accepted | Signed requests and signed answers; the secret never travels. The CLI's routes move later (board). |
| SR2 | Browsers send no Origin on a GET | Accepted | Corrected text; Sec-Fetch headers refused; `summary.open` is a POST; never a catalog route. |
| SR3 | The `page` field was unbounded | Accepted | Length cap, only known pages with replies, prototype-free keys; the one-review reach is an accepted risk. |
| SR4 | The URL allowlist was wider than needed | Accepted | Only `*.lahe.localhost` at the pages port or none; URL rebuilt from parsed parts; titles cleaned. |
| SR5 | Which clone and which files a rebuild compiles | Accepted | Installed clone only, fixed file list, temp folder, rename on success, full path to `xcrun`. |
| SR6 | launchctl labels read from a file | Accepted | Fixed labels and paths; bootstrap checks the plist's contents. |
| SR7 | Agents restart a stopped helper within seconds | Deferred to Ken | A question in the questions leaf; the design keeps agents able to restart it, and the menu says so plainly. |
