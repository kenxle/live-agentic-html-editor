# Recon: how serving, origins and lifetime work today

Read-only survey of the worktree on branch `feat/stable-addresses`, taken 2026-10-11. Every claim is read from the file cited. Nothing was run. Where a line is my reading of how an operating system or browser behaves (not something in the repo), it is marked "unverified".

## Short version

- Every document is served by its own small Node process, one per folder per agent session, on a random port. The helper (port 7817) serves only the API, the Library and the library script. Pages never come from the helper.
- A page learns its review id and token from a script tag the page server puts into each HTML response. The helper allows a request only if the page's `Origin` is on that review's list. The list holds `127.0.0.1:<port>` and `localhost:<port>`.
- Much of today's code exists because ports change: port history, origin swapping on restart, `removeOrigin`, the per-server `SIGHUP` for mounts. A fixed host name per document makes that code mostly unnecessary.
- Four hard blockers for host names are in the code: the origin allowlist refuses any non-loopback host name; both Host checks allow only loopback names; the page record includes the origin, so old comments stop matching on a new address; and `navigator.clipboard` is missing on a non-secure `.lahe` address.

## 1. Serving today

### One shape, one process model

All four serving shapes in `docs/ongoing/SERVING_ARCHITECTURES.md:20-60` that LAHE serves itself go through one file, `src/service/static_servers.js`. The shapes are an HTML file, a folder of HTML, a rendered Markdown file, and a `lahe write` notes page. Dev-server pages are the exception: LAHE serves nothing for them.

- **A server is a detached child process.** `startLocked` spawns `node static_servers.js --serve <record> <session> <id> <instance> <root> <dir> <logicalRoot> <preferredPort>` with `detached: true, stdio: "ignore"` and `unref()` (`src/service/static_servers.js:366-372`). The same file is both library and server (`require.main` block at `:1807`, entry `runServer` at `:1298`).
- **Its id is a hash of its root path** (`serverId`, `:178`). Its record is `<state>/agent_sessions/<session>/static_servers/ss_<id>.json` (`src/service/state_dir.js:379-390`). So the same folder under two sessions is two servers on two ports.
- **Root.** A single page gets a server rooted at the page's folder. A folder review roots it at the folder (`startFolderServer`, `src/cli/commands/review.js:358-392`). A Markdown review roots it at the folder holding LAHE's rendered artifact, then adds read-only mounts for the source folder and each linked folder (`review.js:382-390`, `registerMount` at `static_servers.js:296`).
- **A notes page** (`lahe write`) gets a one-page server whose root is the file itself (`isPageRoot`, `:174`; `startNotesServer`, `review.js:343-348`). It serves that page, the style, fonts and library, and 404s the rest (`servePage`, `:1535`).
- **Dev-server pages and `--origin` reviews** start no server. `servedKind` returns null when `--origin` is passed (`review.js:84-96`). The app serves itself and the user pastes the script line.
- **`file://` healing.** With no server, `lahe add` writes the script line into the HTML file and copies the library bundle beside it (`add.js:1373-1377`). The helper's healer puts a stripped line back (`src/service/heal.js`), but stands down for any file a live static server serves (`servesPath`, `static_servers.js:1013`; the call is `reviews.js:1013`).

### What each process serves

- **Page server (per folder per session).**
  - Pages: HTML gets the script tag injected into the response; Markdown is rendered by `markdown.render` on request (`renderMarkdown`, `:1345`).
  - Reserved paths: `/.lahe-library/lahe-layer.js` (`LIBRARY_PREFIX`, `:42`), `/.lahe-styles/...`, `/.lahe-doc-style.css`, `/.lahe-fonts/...`, `/.lahe-source/<hash>/...` mounts, and a health probe `/.lahe-static-health/<id>/<instance>` (`:1608-1620`).
  - It is read-only, `GET`/`HEAD` only.
- **Helper (one per machine, port 7817).** It serves the review API (`/lahe/v1/...`), the Library at `/catalog`, `GET /lahe-layer.js` (`library.get`), and `GET .../health`. It never serves a reviewed document. Handler: `src/service/index.js:308-560`.

### How ports are picked and reused

- **First start:** `preferredPort` is 0, so the OS picks any free port. `server.listen(port, HOST)` where `HOST = protocol.DEFAULT_HOST` = `127.0.0.1` (`static_servers.js:1739-1752`).
- **Restart:** the caller passes `preferredPort` (`start`, `:363-366`). It comes from `options.preferredPort`, else the record's last `port` when the root matches. If the old port is busy (`EADDRINUSE` or `EACCES`) the server falls back to port 0 (`:1744-1751`).
- **Port history:** each record keeps a `ports` array of every port it has listened on (`:1727-1736`, written at `:1756-1780`). Only `createCatalogOps.originPass` reads it, to remove old origins (`:670-715`).
- **Callers that restart with the old port:**
  - `lahe review` on a stopped server (`startFolderServer` calls `start`, which reads the record).
  - `lahe session reopen` and `takeover` through `restartAll` (`:483-491`, called at `session.js:503-504`).
  - The Library's Open through `reopenForCatalog` (`:615-657`).
  - The idle sweep's `restartIdle` (`idle_servers.js:157-200`).

### Who starts and stops page servers

- **Starts:** `lahe review`, `lahe write`, `lahe library serve`, `session reopen/takeover`, the Library's Open, and the idle restart when a window of the session comes back.
- **Stops:**
  - `lahe session close` calls `stopAll` (`session.js:477`).
  - The idle sweep calls `stopOne` with `IDLE_REASON` (`idle_servers.js:127-155`).
  - `closeQuiet` from the reopened-session sweep (`static_servers.js:718-722`).
  - A server stops itself when its state dir is gone (`runServer` dirWatch, `:1786-1800`).
  - `SIGTERM` on the process (`stopOne`, `:411`).
- **Start races:** an exclusive lock file `ss_<id>.json.lock` guards start and stop across processes (`withServerLock`, `:96`; stale takeover `:85`).

## 2. Token and origin model

### How a page gets its review id and token

- The page server injects one `<script>` tag into each HTML response (`injectForMatch`, `static_servers.js:953-985`). It is built by `protocol.scriptTag` with `src` = `/.lahe-library/lahe-layer.js`, `review`, `token`, `helper` = `http://127.0.0.1:<helper port>` (read fresh from `service.json`, `currentHelperOrigin`, `:935`), `fallback`, and `notes`.
- The server finds the review by reading `reviews/*/meta.json` off disk, because it is a separate process from the helper (`findReviewForRequest`, `:881-929`). Order: a review that recorded this exact file wins; else the newest review of the same session whose own served folder equals this server's root (`backsServer`, `:829`); `--only` reviews never lend their rail (`:915`).
- **A review of another session never answers** (`:908`). This session scoping is the main thing a shared server has to reproduce.
- The layer reads the tag at boot (`src/layer/index.js:125-141`): `data-lahe-review`, `data-lahe-token`, `data-lahe-helper`, plus frames, start, notes.
- `file://` pages carry the same tag written into the HTML file by `add` (`add.js:1379-1387`).

### How the helper checks a page's request

All in `protocol.checkRequest` (`src/shared/protocol.js:592-650`), called from one place (`src/service/auth.js:50-80`). Order:

1. **Host:** `hostAllowed` strips the port and requires one of `ALLOWED_HOST_NAMES` = `127.0.0.1`, `localhost`, `[::1]`, `::1` (`protocol.js:99`, `:578-582`). This is the DNS-rebinding guard. It ignores the port.
2. **Client header** (`x-lahe-client`), **content type** for writes.
3. **Review known**, then **token** (constant time).
4. **Origin:** the `Origin` header (or the string `"null"` if absent) must be in the review's `origins` array (`protocol.js:644-647`). The origin is what makes a token on a leaked script tag useless to other pages.

Origins live in `reviews[id].origins` (memory), `meta.json`, `origin.registered` / `origin.removed` events, and `service.json` (`reviews.js:611-662`, `:1094-1115`).

CORS (`src/service/index.js`):
- Review routes echo the exact matched origin as `Access-Control-Allow-Origin` (`respond`, `index.js:315-333`).
- A preflight passes only if some review has registered that origin (`anyReviewRegistered`, `:371-378`; preflight `:389-424`).
- `library.get` answers `*` (`respondRaw`, `:339-350`).
- Catalog routes never send CORS and refuse preflight (`:392-402`).

### The page server's own Host check

`hostIsOwn` allows exactly `127.0.0.1:<port>` and `localhost:<port>` at the server's own port, and refuses a missing Host with a 400 (`static_servers.js:1094-1097`, applied at `:1592`). It pins the port too.

### Where the 127.0.0.1 and localhost twins are registered

1. `lahe review` passes `--origin http://<meta.host>:<meta.port>` to `add` (`review.js:261`).
2. `add` runs `withLoopbackTwins`, which adds the `localhost` or `127.0.0.1` twin (`add.js:114-136`, applied `:978`).
3. The origins go to `meta.json` and to the helper through `review.write` (`add.js:539`, handler `src/service/review_writer.js:136-230`).
4. On a restart, `originPass` registers the new pair (`loopbackOrigins`, `static_servers.js:498-500`) and removes the pair for earlier ports (`:670-715`), through `reviews.registerOrigin` / `removeOrigin` (`reviews.js:611`, `:648`).

### What would have to change for a host name per document

- **`isRegisterableOrigin` rejects the new names.** The wire route `review.write` only accepts `null` or an `http(s)` origin whose host is in `LOOPBACK_ORIGIN_HOSTS` = `localhost`, `127.0.0.1`, `[::1]` (`protocol.js:113`, `:126-141`). Both `docname.lahe` and `docname.lahe.localhost` fail. That check exists so a script holding the token cannot add a hostile origin (`protocol.js:101-112`). A widened rule must stay narrow: accept only the host name the helper itself assigned to that review, not any `*.lahe` name. If it accepts any name under the suffix, a page on `a.lahe` could register `http://b.lahe:port` on its own review.
- **`removeOrigin` is loopback only** (`reviews.js:652`). Fine if host-name origins are never removed.
- **Helper Host check** (`hostAllowed`, `protocol.js:578`) and **page server Host check** (`hostIsOwn`) both need to learn the document host names. They should accept only names that map to a known record, not a wildcard. The Library's check is stricter and must stay so (see 4).
- **The origin set per review becomes fixed.** The name is fixed at first serve, so the origins are registered once and never swapped. `originPass`, `ports` history, `removeOrigin` and the preferred-port logic become dead weight for new reviews. Old reviews still carry port origins.
- **`ORIGIN_LIMIT` is 16** (`protocol.js:118`). Two or three origins per review fit.
- **Helper reachability from a document host.** Pages call the helper at the absolute `data-lahe-helper` URL (`127.0.0.1:7817`) cross-origin with preflight. That keeps working only if the helper's Host check passes for `127.0.0.1` (it does) and the document origin is registered. If instead documents are served on the helper's own port, calls could go same-origin, but Host-based routing has to be added to `handle()` (`index.js:378`), which today keys only on method and path.
- **Sec-Fetch-Site is checked only on Library routes** (`auth.js:247-251`). Review routes do not read it.

## 3. Lifecycle: what keeps an address dead today

### Idle sweep (`src/service/idle_servers.js`)

- `GRACE_MS` = 2 minutes, `SWEEP_MS` = 30 seconds (`:44-45`). It runs inside the helper (`index.js:306`).
- A session with no open review window for `GRACE_MS` has every running page server stopped with `IDLE_REASON` = `"no window open"` (`stopIdle`, `idle_servers.js:127-155`). The grace counts from the latest of: last open window, first sweep that saw the instance, and `link_given_at` stamped by `lahe review` each time it prints a link (`graceStart`, `:114-126`; `noteLinkGiven`, `static_servers.js:454`).
- "Open window" is `reviews.openWindowReviews()`: a holder not stale by its own window (30 seconds, or 390 seconds for a quiet tab; `reviews.js:81-88`, `:1262`).
- A claim or beat from a window of a session with idle-stopped servers restarts them, old port first (`windowActivity`, `idle_servers.js:202-216`, called from `routes.js:500-502`). A request to a dead port never reaches this path, because nothing listens.

### Session close

`lahe session close` runs `stopAll` for the session, closes it, and stops the helper if it was the last open session unless the Library polled within 2 minutes or a window is held (`session.js:476-492`, `helperStillWanted` `:141-160`). Otherwise it writes `stop-when-quiet.json` (`askStopWhenQuiet`, `:164-173`).

### Helper self-stop (`src/service/self_stop.js`)

- Rule 1: after the ask file exists, stop once no session is open, no window is open, and no Library poll has happened for `GRACE_MS` (2 minutes = `LIBRARY_SEEN_MS`, `protocol.js:708`). Checked every 15 seconds (`SWEEP_MS`, `:52`). A new helper deletes any old ask (`withdrawAsk` at construction, `:186`).
- Rule 2: stop when the state dir's `state-id` token is gone twice in a row and `service.json` no longer names this process (`createDirWatch`, `:127-160`). Page servers run the same check (`static_servers.js:1786-1800`).

### Catalog reopen and sweeps

- `reopenForCatalog` restarts one recorded server, reopens a closed session, and swaps origins (`static_servers.js:615-657`). It is called from the Library's Open (`catalog_actions.js:268`).
- The Library open response is `reopened.origin + d.url_path` where `origin` is `http://127.0.0.1:<port>` (`catalog_actions.js:298`; `originPass` returns `current[0]`, `:710`).
- `sweepReopened` runs every `CATALOG.POLL_MS` = 15 seconds (`index.js:620-640`, `protocol.js` `CATALOG.POLL_MS`) and closes a Library-reopened session quiet for 30 minutes through `closeQuiet` (`catalog_actions.js:448-500`). `sweepLibrarySessions` does the same for sessions bare `lahe library` created (`:512`).

### Why an old address is dead today

1. Idle sweep stops the server 2 minutes after the last window closes.
2. Session close stops all of that session's servers.
3. The helper exits when the last session closed and nothing is open.
4. A restart takes the old port only when free; otherwise a random port, and the old origins stay registered until `originPass` runs (only via Open).

## 4. The helper

- **Start:** `lahe serve` (`src/cli/commands/serve.js`) calls `service.serve` (`src/service/index.js:178`). Other commands start it: `startHelper` in `session.js:199-240` and a second copy in `add.js:658-668`. Both spawn `node bin/lahe.js serve --port <p> --state-dir <dir>` with `detached: true, stdio: "ignore"`, then poll `/health`.
- **Replacement:** `startHelper` stops and restarts a helper older than the code on disk (`stopVerifiedHelper`, `session.js:103-118`, `sourceStamp.helperPredatesSource`), unless a window is open. An always-on helper under a service manager will fight this (see Surprises).
- **Port:** `protocol.DEFAULT_PORT` = 7817 (`protocol.js:92`). It is baked into every script tag and every `add`-written file. `--port` overrides.
- **Bind:** `server.listen(port, host)` with `host` defaulting to `protocol.DEFAULT_HOST` = `127.0.0.1` (`index.js:183`, `:607`). IPv4 loopback only. No `::1` listener. The page servers bind the same way (`static_servers.js:1740`).
- **`service.json`:** `<state>/service.json` (`state_dir.js:61`), mode 0600, written after the bind (`reviews.js:1094-1115`). Holds `port`, `pid`, `started_at`, `api`, `service_contract`, and every review's `token`, `origins`, `agent_session_id`. It is rewritten each time an origin is registered.
- **State dir:** `$LAHE_STATE_DIR`, else `$XDG_STATE_HOME/lahe`, else `~/.local/state/lahe` (`state_dir.js:121-135`). It refuses a dir inside a git checkout.
- **Load:** at start the helper loads every review from disk into memory (`reviews.loadFromDisk`, `index.js:197`).
- **The Library at `/catalog`:**
  - Routes: `catalog.page`, `catalog.asset`, `catalog.list`, `.open`, `.star`, `.rename`, `.request` (`protocol.js:371-470`).
  - Token: `createCatalogState` mints a random token per helper start, memory only (`auth.js:160-174`), placed in the page's meta tag.
  - Checks, in order (`auth.js:228-282`):
    - `Host` must be exactly `127.0.0.1:<helper port>` or `localhost:<helper port>`;
    - `Sec-Fetch-Site` must be `same-origin` (`none` also for the page itself);
    - client header `catalog`;
    - JSON content type;
    - token;
    - for POSTs, `Origin` must equal `http://` + Host.
  - No CORS header. A preflight on a catalog path is refused with `PROTO_CROSS_SITE` even if some review registered the origin (`index.js:392-402`).
  - Content policy `default-src 'none'` and so on, pinned by `test/unit/catalog_page_csp.test.js`.
  - Consequence for host names: the Library must stay reachable only at the exact loopback Host. If documents share the helper's process or port, a document host must not be able to reach `/catalog` or its API. The exact-Host check already does this; keep it exact.

## 5. Browser storage

What the layer writes, all keyed by review id and all per browser origin (`src/layer/store.js:1-120`):

- **localStorage:** items (`lahe.item.v2:`, `lahe.index.v2:`, old `lahe.items.v1:`), outbox (`lahe.outbox.v1:`), generation stamps, failure chips, acked and refused stamps, window holder and lock (`lahe.holder.v1:`, `lahe.window.v1:`), rail prefs (`lahe.ui.v1:`), hold toggle (`lahe.held.v1:`), follow-up text (`lahe.followups.v1:`), seen replies (`lahe.seenreplies.v1:`).
- **localStorage, elsewhere:** the style choice `lahe.style.v1:` (`src/layer/style_switch.js:87`, `:412`).
- **sessionStorage:** the tab's window id (`lahe.window.id.v1`), the helper session secret (`lahe.session.v1:`), conflict-toast state (`conflict_toast.js:19`), reload markers in `sync.js`.
- No cookies, no IndexedDB (searched `src/layer`).

What is lost when the origin changes:

- **Unsent drafts and the outbox** saved under the old origin stay in the old origin's storage. The new origin starts empty. The helper holds anything already posted, so only unposted typing is stranded. This is the point of the "drafts come back" pro in `docs/ongoing/STABLE_ADDRESSES.md:36`, and it is not helped for reviews opened before the move.
- **Rail prefs, hold toggle, seen-replies, style choice** reset on the new origin.
- **Comments the helper already has** are not lost, but see the next item.

**The page record carries the origin, and a different origin hides old items.** Each item stores `page_origin` and `page_path`. `samePage` returns true only when origin and path both match, with a tolerance only for `file://` (`src/shared/record.js:372-382`, `:462-479`, `pageFrom` `:483-515`). So comments made on `http://127.0.0.1:53211/x.html` do not show on `http://x.lahe:7820/x.html`. The layer's read boundary filters by `samePage`. Old reviews would look empty at the new address. This also feeds `review.json` grouping by `origin|path` (`pageKey`, `:373`).

Secure context: Chrome and Firefox treat `*.localhost` as a secure context, but plain `http://docname.lahe` is not one (unverified for each browser, but standard). `navigator.clipboard` is then undefined. The layer reads it in `src/layer/export.js:395-396` (rejects: "this browser gave the page no clipboard") and `src/layer/overlay.js:4423` (copy handoff, shows the text to copy by hand). The Library page uses it too (`src/layer/catalog/page.js:291`). No use of `crypto.subtle` or `randomUUID` found.

## 6. Install

- `npm run install-cli` runs `scripts/install-cli.js`. It writes one POSIX shell wrapper at `~/.local/bin/lahe` that `exec`s the absolute Node and `bin/lahe.js` (`:35-45`, `:118`), refusing to overwrite a file without its marker (`:52-67`). It prints a PATH hint if needed (`:129-142`). It then calls `install-skills.js` to copy the skill (`:150`).
- It is macOS and Linux only; `CLAUDE.md` says Windows runs `node bin/lahe.js` or uses WSL.
- **No login item, launchd, systemd or Windows scheduled-task code exists.** A grep for `launchd`, `launchctl`, `systemd`, `schtasks`, `LaunchAgent` finds only the decision and crucible docs and vendored mermaid.
- There is no `lahe install` command. The command list is in `src/cli/index.js:48-60`: serve, review, write, session, add, status, reply, monitor, library, style, hook.
- Zero runtime dependencies is enforced (`package.json` `dependencies: {}`).
- Node floor 18.2 (`package.json` engines). Node's `dgram`/`net` could carry a tiny DNS answerer with no package, as the decision page says (`STABLE_ADDRESSES.md:150`), but no DNS code exists today.

## 7. Where the open URL is built, printed, and described

### Code that builds or prints a URL

- `src/cli/commands/review.js:261` (origin to register), `:305-309` (`server` and `open` lines), `printScope` `:394-425`.
- `src/cli/commands/add.js:1363-1500`: helper line, `Open it: likely <origin>/<basename>`, file:// fallback text.
- `src/cli/commands/library.js:239`: Library URL `http://127.0.0.1:<port>/catalog`.
- `src/cli/commands/status.js`: idle-stopped line names the old port (`idleStoppedLine`, `:369`) and the restart command; also `unserved`, `injected` values (`:296-320`) and `:939` (helper origin).
- `src/service/catalog_actions.js:298` (Open response URL); `src/service/catalog_reader.js:1227` (`row.served`); `:370-445` (`coveringRecord`, `openPathOf`).
- `src/service/static_servers.js:1175` (`liveUrlFor`, the redirect target when a linked doc has its own review) and `:935-938` (`currentHelperOrigin`).
- `src/service/index.js:650,684`, `src/service/reviews.js:833` (helper origin for healing).

### Docs, skill and contract text that mention ports or URLs

- `skills/lahe/SKILL.md`: `:77` ("starts a local server and prints one `open` URL"), `:106` ("Give them the `open` line exactly as printed"), `:694-701` (Library open), `:851-855` (`session close` stops the servers). Nothing about ports by number. Per `CLAUDE.md`, a workflow change must also go to the contract text and its copies.
- `src/shared/review_format.js` (the `contract` field): no port, host or URL text found by grep. Only the pickup wording at `:103`. A change to what "serve" means may still need a sentence if agents are told servers stop with the session.
- `docs/CLI.md`: `:16` (`lahe review` starts its static server), `:19` (notes page "answers only its own loopback address (`127.0.0.1` or `localhost` at its port)"), `:36` (`session close` stops static servers; idle stop; "brings the page back on its old port"), `:37` (`session reopen` restarts static servers), `:45` (`serve`).
- `docs/CONTRACTS.md`: `:749-752` and `:815` (script tag with `127.0.0.1:7817`, "7817 is the fixed default"), `:855-1070` (D11 checks, origin rules, Host rows at `:987` and `:1055`), `:897` (`isRegisterableOrigin`), `:1115`, `:1264`, `:1538-1580` (session close, idle stop, state-dir watch, lock file).
- `docs/ongoing/SERVING_ARCHITECTURES.md` (the whole page: "picks a free loopback port", per-session servers, the table at `:430-440`), `docs/ongoing/LIBRARY.md` (Open, Helper lifetime), `docs/ongoing/SESSION_OWNERSHIP.md` (idle stop, "brings a page back, on its old port"), `docs/diagrams/system_overview.md`, `docs/diagrams/session_ownership.md` (servers owned by the session), `docs/INSTALL.md:86-180,266-268`, `README.md:91`.
- `AGENTS.md`: no mention of ports found.

## 8. Tests

### Unit (`test/unit/`)

- `static_servers.test.js`: server start and stop, records, injection, mounts.
- `static_restart.test.js`: restart on the old port, port history, origin swap, Host check on every server.
- `static_site_folder.test.js`: folder review serves every page with the rail.
- `static_styles.test.js`: reserved `.lahe-styles` answers.
- `stop_idle_servers.test.js`: idle sweep, grace, restart on window return.
- `helper_self_stop.test.js`: the two self-stop rules.
- `catalog_lifetime.test.js`: last close keeps the helper while the Library polls.
- `catalog_open_rollback.test.js`, `catalog_open_owner.test.js`: Open's restart, rollback and owner check.
- `catalog_routes.test.js`, `catalog_auth.test.js`, `catalog_page_csp.test.js`: Library routes, per-route checks, content policy.
- `catalog_reader.test.js`, `catalog_kind_rule.test.js`: coverage, openable kinds.
- `library_command.test.js`, `library_serve.test.js`, `library_handoff.test.js`, `library_session_autoclose.test.js`: `lahe library`, pickups, bare-Library session close.
- `linked_docs_rail.test.js`, `markdown_links.test.js`, `markdown_linked_docs.test.js`: mounts and linked docs.
- `session_commands.test.js`, `session_fixes.test.js`: close, reopen, takeover; the PATH-stable installer.
- `write_command.test.js`: notes pages; its Host rule is covered here.
- `review_write_hardening.test.js`: what `review.write` may register.
- `helper_not_replaced.test.js`, `helper_freshness.test.js`, `helper_contract_cli.test.js`, `window_sessions_restart.test.js`: helper replacement and restarts.
- `no_stray_helpers.test.js`: the leak check (`scripts/no_stray_helpers.js`, wrapper for `npm run test:unit`).
- `service_helper.test.js`: helper durability and idempotent serve.
- `status_catalog.test.js`: the drain's Library section.

### Browser (`test/browser/`)

- `serve_time_inject.spec.js`: the rail survives a stripped line via the response.
- `static_site_folder.spec.js`, `multi_page_review.spec.js`, `linked_docs_rail.spec.js`: folder, multi-page, and linked docs (`multi_page_review` is where `samePage` is exercised).
- `stop_idle_servers.spec.js`: idle stop and `lahe review` bringing it back.
- `catalog_library.spec.js`, `catalog_page.spec.js`, `catalog_cross_site.spec.js`: the Library end to end and cross-site refusal.
- `file_origin.spec.js`, `r10_offline_fallback.spec.js`: `file://` and helper-down.
- `harness_second_origin.spec.js`: refusals of an unregistered origin.
- `helper_restart_holds.spec.js`, `takeover_walk.spec.js`, `duplicate_tab.spec.js`, `rail_durability.spec.js`: helper replacement, window identity, storage durability.
- `style_switcher_keep.spec.js`, `markdown_render.spec.js`: Markdown served through the page server.
- Support: `test/browser/support/lahe_world.js`, `catalog_world.js`, `no_stray_helpers.js`; unit helpers `test/helpers/servers.js`, `temp_helpers.js`, `free_port.js`.

Test knobs that exist for the current lifetime rules: `LAHE_IDLE_GRACE_MS`, `LAHE_IDLE_SWEEP_MS`, `LAHE_SELF_STOP_GRACE_MS`, `LAHE_SELF_STOP_SWEEP_MS` (`index.js` `envMs`), `LAHE_PORT`, `LAHE_STATE_DIR`, `LAHE_HOME_DIR`. All tests start helpers on free ports with temp state, never 7817.

## 9. What makes the plan harder

- **Document identity is not defined.** A server today is keyed by (session, root folder), and a single-page review serves its whole folder so siblings get the rail (`backsServer`, `static_servers.js:829`). A host name "per document" needs a rule for a folder with many pages (host per folder root? per review?), for two sessions reviewing the same file (two servers today), and for a Markdown review whose root is LAHE's artifact folder while the name should come from the source file. No name is recorded anywhere yet.
- **Everything is session-scoped on disk.** Records live under `agent_sessions/<sid>/static_servers/`; `findReviewForRequest` skips other sessions (`:908`), and so do `ownReviewUrl`, `linkingReview` and `linkedFileForPage`. One shared server needs a host to (session, record) map, then the same scoping per request.
- **Open pages from a closed session.** Nothing in the helper refuses posts to a review whose session is closed (no `closed_at` check in `routes.js`, `reviews.js`, `replies.js`). So a history link would load the page and accept comments that no agent reads. The rail's agent-liveness line would say so, but the product behavior is not decided.
- **`mounts` and `linked_files` live in each server's record and are loaded by `SIGHUP`.** `registerMount` writes the record then `process.kill(pid, "SIGHUP")` (`static_servers.js:314`, handler `:1802`). `SIGHUP` does not exist as a signal on Windows (unverified for Node there), and a shared server would read the record on demand instead. Markdown rendering of linked docs also writes `auto_mounts` back (`persistAutoMounts`, `:1316-1330`).
- **Relative links between pages work as-is.** All translated links are root-relative (`/.lahe-source/<hash>/...`, `markdown_links.js:61-63`), and a folder's pages link relatively. They survive a host change. The break is `liveUrlFor` (`:1163-1180`), which builds an absolute `http://<host>:<port>/...` URL to redirect a linked doc to its own review's page. With host per document it must return the other document's host.
- **Folder reviews and `--only`.** `lahe review <folder>` roots the server at the folder, and nesting rules say a review answers for the folder its own server is rooted at (`docs/ongoing/SERVING_ARCHITECTURES.md:393-400`). Two reviews of nested folders have two hosts, and a link from the outer page into the inner folder crosses hosts. Review the rail-follows-the-reviewer rule against that.
- **Worktree path mapping.** A document served from a deleted worktree is `via-agent` or `worktree` in the reader (`catalog_reader.js:76-77`, `:563-570`, `:885-900`), with a candidate main-repo copy. A history link to a document whose folder is gone cannot be served; the decision page scopes deleted files out (`STABLE_ADDRESSES.md:48`), but the rest of the Library's kind rule assumes "openable" means "a recorded server can be restarted" (`catalog_reader.js:866-900`). That meaning changes.
- **Markdown artifacts and rebuild.** The rendered page lives in the state dir (`markdown.artifactPath`), and the helper re-renders it when the source is newer, on a reply poll (`rebuild.js`, uses `staticServers.list` at `:129`, `:193`, and `recordLinks` at `:207`). A history link to a Markdown review needs the artifact to exist; it does while the state dir does.
- **Heal stand-down.** `servesPath` (`:1013`) tells the healer not to write a script line into a file a live server serves, with idle-stopped servers counting. With an always-on server serving everything, this becomes always true for recorded targets. `file://` and plain `lahe add` reviews still need the healer.
- **`lahe status` and the Library speak in ports.** `idleStoppedLine` prints the dead port; `unserved`, `injected` and `row.served` are built from records. These need new wording and data.
- **The helper tracks every review in memory and in `service.json`.** `reviews.loadFromDisk` loads all 682 and `writeReadyFile` rewrites a file holding every token on each origin registration (`reviews.js:1094-1115`, `index.js:197`). An always-on helper carries this all day.
- **Security properties the decision page names.** Tokens in a script line are readable by anything that can load the page, and now the helper is up all the time (`STABLE_ADDRESSES.md:42`). Review whether `Host` should be a closed set of known names rather than a suffix match.
- **Windows.** `install-cli` is POSIX only. `spawn(..., {detached: true, stdio: "ignore"})` on Windows opens a console window unless `windowsHide: true` is set (unverified; not set anywhere in `src`). `process.kill(pid, "SIGTERM")` on Windows terminates without running the handler.

## Surprises

1. **The origin allowlist refuses host names.** `isRegisterableOrigin` (`protocol.js:126-141`) only passes loopback names, so `docname.lahe` is refused on the `review.write` route today. Widening it needs a rule tied to the name the helper assigned, not a suffix.
2. **Old comments vanish at a new address.** `samePage` compares origin and path (`record.js:462-479`), so every existing review looks empty on its new host. The decision page does not mention this.
3. **`.lahe` is a non-secure address.** `navigator.clipboard` is missing there, which breaks Copy review in `export.js:395` and the Library's copy button. `.lahe.localhost` is a secure context. This weakens the case for `.lahe` as the preferred form.
4. **A service manager will fight the helper's own logic.** `startHelper` kills and restarts an older helper (`session.js:199-240`); self-stop exits when quiet (`self_stop.js:229-263`); a "restart if it stops" login item would respawn it each time, possibly with a stale Node path. Always-on mode needs self-stop and stale-replacement turned off or reconciled.
5. **Much of today's complexity exists only because ports change.** Port history, origin swap, `removeOrigin`, the `SIGHUP` mount reload, the `origin.removed` event and `reopenForCatalog`'s rollback code all exist for that. Option D can remove most of it for new reviews, but old reviews keep their port origins.
6. **Helper and page server speak different Host rules.** The helper ignores the port; the page server pins it; the Library pins it and the exact name. A merged server has to keep all three.
7. **Both listeners are IPv4 only.** Neither the helper nor any page server binds `::1`. The decision page says `.localhost` names are tried on `::1` first, so this must change (unverified here).
8. **No document name exists in the data.** Nothing in `meta.json` or the server record holds a slug. It has to be created, stored once, and made unique across sessions.
9. **Closed sessions still accept posts.** A history link to a closed session's document would load and take comments with no agent behind it.
10. **There is no `lahe install` command, and no service-manager code on any platform.** All of that is new.

## To delete at cleanup

Nothing was created except this file and its folder `parts/architecture/`.
