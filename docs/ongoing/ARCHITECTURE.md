# Architecture

## Charter

**What belongs:** The shape of the system at a level a person can hold in their head. The stack and the folder structure. The surfaces people and agents touch, and the outside services behind them. The main models and how they relate, in outline.

**What does not:** How one feature works. That goes in a diagram or its own ongoing doc. How a feature got built. That stays in docs/features/.

**Level of detail:** A paragraph or a short table per area. Link out when a section passes three paragraphs.

**Describes:** the code root named in Settings

**Sources:** [CLAUDE.md](../../CLAUDE.md), [README.md](../../README.md), [package.json](../../package.json), [the file manifest](../../src/shared/manifest.js), [the state folder layout](../../src/service/state_dir.js), [the system overview](../diagrams/system_overview.md), [the module map](../diagrams/module_map.md), [CONTRACTS.md](../CONTRACTS.md), [CLI.md](../CLI.md), [LIBRARY.md](LIBRARY.md), [MENU_BAR.md](MENU_BAR.md), [STABLE_ADDRESSES.md](STABLE_ADDRESSES.md), [SERVING_ARCHITECTURES.md](SERVING_ARCHITECTURES.md), [SESSION_OWNERSHIP.md](SESSION_OWNERSHIP.md), [STYLES.md](STYLES.md), [FREE_WRITING.md](FREE_WRITING.md), [the menu bar README](../../macos/menubar/README.md), [the original architecture](../features/20260812.01_live_agentic_html_editor/02_architecture_live_agentic_html_editor.md)

## Summary

- Lahe has two pieces. A review layer runs inside the reviewed page and draws the rail. A helper is one local Node process that stores the review on disk and serves pages.
- The reviewer comments and edits on the page. The agent reads `review.json` and answers by appending one line to a reply file. The page shows the answer on the card.
- The store on disk is the truth. The page is a view of it, and the browser keeps its own copy of every keystroke so nothing is lost when the helper is down.
- Around that core sit the Library page (every review on the machine), the `lahe` CLI, and an optional Mac menu bar app.
- A picture of all of it is [the system overview](../diagrams/system_overview.md).

## The stack

- **Helper:** plain Node, `node:` core modules and the global `fetch`. `engines.node` is `>=18.2.0`. The entry point is `bin/lahe.js`.
- **Review layer:** vanilla browser JavaScript, standard DOM APIs, no framework. It ships as one built file, `dist/lahe-layer.js`, that the build script concatenates in the manifest's order.
- **Menu bar app:** one Swift file plus a plist, built on the Mac with `xcrun`. AppKit, Foundation and CryptoKit only.
- **No runtime dependencies.** `dependencies` in `package.json` is empty, and that is a hard rule in [CLAUDE.md](../../CLAUDE.md). Third-party files (marked, mermaid, Heroicons, reveal.js, the document style and its fonts) are copied into `vendor/`.
- **Tests:** `node:test` for unit tests and Playwright (the one dev dependency) for the browser suite. CI on GitHub runs lint, the bundle check and the unit tests only.

## Folder structure

| Folder | What it holds |
| --- | --- |
| `bin/` | `lahe.js`, the one command the CLI wrapper runs |
| `src/shared/` | The one spelling of every wire field, record shape and rule both sides use |
| `src/layer/` | The review layer that runs in the browser, plus the Library page's scripts in `src/layer/catalog/` |
| `src/service/` | The helper: routes, auth, the store, serving pages, the Library, the menu bar's summary |
| `src/cli/` | The command dispatcher and one file per `lahe` command |
| `dist/` | The built review layer. Generated and committed; only the orchestrator rebuilds it |
| `macos/menubar/` | The optional Mac menu bar app |
| `skills/lahe/` | The skill an agent host loads to run a review |
| `vendor/` | Copied third-party files, each with its licence and a README naming the version |
| `scripts/` | Build, lint, install and measurement scripts |
| `test/` | Unit tests, browser tests and fixture pages |
| `docs/` | Ongoing docs (how things work now), diagrams, contracts, and feature history |

## Which file owns what

[The file manifest](../../src/shared/manifest.js) is the source of truth. It gives every file under `src/` one owner and a one-line reason, and lint fails when a file is missing from it. It has three lists:

- `LAYER_FILES`: the review layer, in load order. The browser has no module loader, so a file may only use what a file above it registered. `src/shared/` files that both sides need load first.
- `NON_BUNDLE_FILES`: everything that runs in Node. That is the helper, the CLI, and the Node-only shared files such as `manifest.js` and `script_line.js`.
- `CATALOG_PAGE`: the Library page's own scripts. The helper serves them raw from `src/`, so they never touch `dist/`.

[The module map](../diagrams/module_map.md) draws the manifest, but it is behind. It leaves out the menu bar files (`menubar.js`, `summary.js`), the address files (`addresses.js`, `name_server.js`, `login_item.js`), `self_stop.js`, `catalog_launch.js`, `catalog_sites.js`, the style files (`styles.js`, `style_rules.js`, `style_switch.js`), `script_line.js`, `copy_text.js`, and every file under `src/cli/commands/`. The groups below follow the manifest.

| Area | Files | Job |
| --- | --- | --- |
| Shared kernel | `markers`, `normalize`, `record`, `lifecycle`, `merge`, `regions`, `uniqueness`, `gestures`, `epoch`, `elapsed`, `failures`, `protocol`, `review_format`, `style_rules` | The record shape, its four states, the merge rule, the routes and tokens, and the human-readable format |
| Layer: finding text | `selection`, `blocks`, `anchor`, `pointing`, `store` | Where the caret is, what a block is, minting and finding an anchor, browser storage |
| Layer: protecting and drawing | `protect`, `highlight`, `overlay`, `tab_active`, `tab_done`, `tab_edits`, `conflict_toast`, `style_switch`, `zoom` | Guarding the block being edited, highlights, the rail and its tabs, the style button, the zoom view |
| Layer: the loop | `sync`, `comments`, `editing`, `export`, `replay`, `inject`, `index` | Posting records and polling replies, comment boxes, edits, copy and export, replay after a repaint, boot |
| Service: requests | `index`, `routes`, `auth`, `log` | Serve, the router, the per-request checks, the log appender |
| Service: the store | `state_dir`, `reviews`, `projection`, `review_writer`, `replies`, `handled_check` | The state folder, review creation and tokens, `review.json`, reading reply files, checking a handled claim on the built page |
| Service: sessions | `agent_sessions`, `wake_feed`, `watchers`, `self_stop` | Session ownership and liveness, the wake feed a host tails, when the helper stops itself |
| Service: pages and addresses | `sites`, `page_routes`, `static_servers`, `addresses`, `name_server`, `login_item`, `heal`, `rebuild`, `markdown`, `markdown_links`, `styles`, `tab_icon`, `source_stamp` | The name registry, serving every page at its address, the `.lahe` names and port 80 forward, start at login, Markdown rendering, installed styles |
| Service: the Library | `catalog_reader`, `catalog_store`, `catalog_requests`, `catalog_actions`, `catalog_sites`, `catalog_launch`, `catalog_page` | The list, stars and names, the request queue, Open, launching a new agent |
| Service: the menu bar | `summary`, `menubar` | The summary the icon reads, and building and keeping the app current |
| CLI | `index` plus `commands/` | One file per command: `review`, `write`, `add`, `session`, `status`, `reply`, `monitor`, `library`, `style`, `install`, `menubar`, `hook`, `serve` |

## The surfaces

| Surface | Who uses it | What it is | Read more |
| --- | --- | --- | --- |
| The page rail | The reviewer | The review layer on a served page. Comment, edit, write new blocks, read the agent's answers. Two tabs, Active and Done, with an All, Comments and Edits filter | [FREE_WRITING.md](FREE_WRITING.md), [SERVING_ARCHITECTURES.md](SERVING_ARCHITECTURES.md) |
| The Library page | The reviewer | `/catalog` on the helper, at `library.lahe.localhost`. Every review on the machine, grouped by agent session. Open, star, rename, hand to an agent | [LIBRARY.md](LIBRARY.md) |
| The CLI | People and agents | `lahe review`, `write`, `status`, `reply`, `monitor`, `session`, `library`, `style`, `install` and the rest | [CLI.md](../CLI.md) |
| The menu bar app | The reviewer, on a Mac | A count of documents waiting on the reviewer, and a menu of them. Optional | [MENU_BAR.md](MENU_BAR.md) |
| `review.json` | The agent | One file per review that the helper writes from the log. It carries the `contract` field, the agent's guaranteed instructions | [CONTRACTS.md](../CONTRACTS.md) |
| Reply files | The agent | `replies.jsonl`, or `replies-<agent>.jsonl`. The agent appends one line per answer, through `lahe reply` | [CONTRACTS.md](../CONTRACTS.md) |
| The wake feed | The agent's host | `wake.log` per agent session. Append only, pointers only. `lahe monitor` waits on it | [the agent workflow](../diagrams/agent_workflow.md) |

The agent's instructions live in two places that travel together: [the lahe skill](../../skills/lahe/SKILL.md) and the `contract` field written by `src/shared/review_format.js`. How each host connects is in [AGENTS.md](../../AGENTS.md).

## Processes and ports

One helper runs per machine and serves every agent session at once. It listens on two loopback ports: the API on 7817 and pages on 1483. Each served folder or notes page is a site with a stable address, `http://<name>.lahe.localhost:1483/<path>`. The helper puts the script line into each page it serves, so `lahe review` writes nothing into the reviewed folder. A page on someone else's dev server gets the script line by hand, through `lahe add`.

`lahe install` adds a login item so the helper starts at login and restarts if it stops. On a Mac it can also forward port 80 to the pages port and answer `.lahe` names; the helper proves both work before it uses them. Without a login item, the helper stops itself once no session, page or Library poll needs it. How addresses came to work this way is [STABLE_ADDRESSES.md](STABLE_ADDRESSES.md); how the rail gets into each kind of page is [SERVING_ARCHITECTURES.md](SERVING_ARCHITECTURES.md).

## Outside services

Lahe calls no network service. Everything it touches is on the reviewer's own computer.

| What | Why Lahe touches it |
| --- | --- |
| The browser | Runs the review layer and the Library page. The one capability floor is the CSS Custom Highlight API |
| Agent hosts (Claude Code, Codex, Antigravity, others) | Run the agent. Each wakes it differently on the wake feed. Claude Code also runs `lahe hook stop` as a Stop hook |
| The system's service manager | The login item: launchd on macOS, systemd user services on Linux, Task Scheduler on Windows |
| macOS extras | `/etc/resolver/lahe` for `.lahe` names, the port 80 forward, `osascript` to open a Terminal window for "Launch a new agent", `xcrun` to build the menu bar app |
| `lsof` | Asks whether a process holds a session's `wake.log` open, which is how the rail knows an agent is listening |
| A dev server someone else runs | Serves its own pages. Lahe only adds the script line |

## The main records

Everything lives in one state folder outside any checkout: `$LAHE_STATE_DIR`, else `$XDG_STATE_HOME/lahe`, else `~/.local/state/lahe`. The helper refuses a state folder inside a git checkout. The full layout is in `src/service/state_dir.js`.

| Record | Where | What it is |
| --- | --- | --- |
| Agent session | `agent-sessions/<id>/`: `session.json`, `wake.log` | One agent's workstream. It owns its reviews and can move whole to another agent by takeover |
| Review | `reviews/<id>/`: `events.jsonl`, `review.json`, `meta.json`, `replies*.jsonl` | One document under review. The log is the truth; `review.json` is the projection; `meta.json` holds its token and origins |
| Item | A record inside a review (`src/shared/record.js`) | One comment, edit, delete, format-only change or note. It has an id, a revision, one of four states, and the page it was made on |
| Site | `sites.json`, rebuilt from the append-only `sites.log` | One served folder or notes page, and its name. The name is the page's browser origin |
| Library state | `catalog.json`, `catalog-requests.jsonl` | Stars and names, and the queue of requests the Library sends an agent |
| Machine settings | `service.json`, `install.json`, `summary.json`, `styles/<id>/` | The running helper and its tokens, the login item, the menu bar's day-one cutoff, installed styles |

How they relate:

- An agent session owns many reviews. Each review has exactly one owner session, and that never changes; takeover moves the whole session to a new agent. See [SESSION_OWNERSHIP.md](SESSION_OWNERSHIP.md) and [the session ownership diagram](../diagrams/session_ownership.md).
- A review holds many items. A file has at most one review. A folder review can span every page in its folder, and `review.json` groups items by page.
- A reply names an item by id and revision. A reply to an old revision is refused, so a reworded item stays outstanding. The states and who moves them are in [the item lifecycle](../diagrams/item_lifecycle.md).
- A review's document is served from a site. The site belongs to no session, so its address keeps working after the session closes.

## Binding decisions

The original design's key decisions still bind. Each is in [the original architecture](../features/20260812.01_live_agentic_html_editor/02_architecture_live_agentic_html_editor.md), under "Key decisions".

- **D1:** one file in the page, one process beside it.
- **D2:** the review layer never writes the reviewed page's file. The agent changes the source.
- **D3:** two page states. Browse is the page untouched; edit is entered on purpose.
- **D4:** records are the truth, and the page is a view of them.
- **D5:** durability is browser storage plus an append-only log. Browser wins on content, the store wins on lifecycle.
- **D6:** the agent contract is one JSON file, and a reply is one appended line.
- **D7:** protect the region being edited, and replay committed records after a repaint.
- **D8:** highlights use the Custom Highlight API and do not change the page.
- **D9:** an anchor matches by uniqueness, not by a confidence score.
- **D10:** one fixed rail, in a shadow root.
- **D11:** loopback is not a boundary, so every request proves itself with a per-review token and checks.
- **D12:** text from the page is data; the reviewer's words are intent.

## Where the original design and the code differ now

The code is current where the two differ.

- **D1 and serving.** D1 says the script line never points at the helper. Pages that `lahe review` serves now load the review layer from the helper's own pages origin. A page added by hand with `lahe add` still uses a script line.
- **D1 and Node.** D1 names Node 20 as the floor. `package.json` says `>=18.2.0`; Node 20 is needed only for the browser tests.
- **D10 and the tabs.** D10 describes three tabs: Active, Edits and Done. The rail now has two tabs, Active and Done, and Edits is a filter on Active.
- **Auth.** D11 describes the per-review token. The code has since added a Library token, a CLI secret for binding sites, and signed requests for the menu bar. The routes and their checks are in [CONTRACTS.md](../CONTRACTS.md).
