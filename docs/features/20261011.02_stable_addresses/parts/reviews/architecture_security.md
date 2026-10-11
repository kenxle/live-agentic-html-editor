# Security review: Stable addresses architecture

Reviewer: review-security, on [the architecture](02_architecture_stable_addresses.md), 2026-10-11. Read with [recon](parts/architecture/recon.md), [alternatives](parts/architecture/alternatives.md), [the brief](01_brief_stable_addresses.md), D11 in the [original architecture](../20260812.01_live_agentic_html_editor/02_architecture_live_agentic_html_editor.md), and the code in `src/shared/protocol.js`, `src/service/auth.js`, `src/service/static_servers.js`, `src/service/index.js`, `src/service/routes.js` and `src/service/catalog_reader.js`. Nothing was run.

## Summary

Two blockers. Both are cheap to fix in the design now and expensive after the build.

- **SR1:** the server answers `*.lahe` names on machines where Lahe does not control how `.lahe` resolves. Whoever answers DNS for that machine (a hostile Wi-Fi network, a squatter on the name server port) can run a DNS rebinding attack under a real document name. That reads documents, their tokens and the Library. The design says rebinding is stopped by the Host check; for `.lahe` it is not.
- **SR2:** `address.bind` is reachable from any page. The "CLI header" is the public string `cli`, the token is on the page's script tag, and the page's origin is registered. Its one remaining guard, "a file under the review's folder", rests on paths a page can already write through `review.write`. So a page can name arbitrary files and steal other documents' rails.

| # | Severity | Kind | Finding |
|---|---|---|---|
| SR1 | blocker | defect / challenge | `.lahe` Hosts are answered where Lahe does not own `.lahe` resolution, so DNS rebinding works under a real name |
| SR2 | blocker | defect | `address.bind` is callable by page script, and its folder check reads page-writable paths |
| SR3 | important | defect | Per-file origins do not wall documents off: every name serves its whole folder tree, dotfiles included |
| SR4 | important | risk | Always-on, fixed port, guessable names, no token to read a page: other OS users and sandboxed local code can read documents |
| SR5 | important | defect | `http://*.lahe` gets no `Sec-Fetch-*` headers, so the Library's checks and the "navigation only" rule cannot work there |
| SR6 | important | risk | The name server port can be squatted; the ending check would pass for a squatter; a bad packet can crash the helper |
| SR7 | important | defect | A plain GET mints permanent names and adds origins, from any link on any website |
| SR8 | important | risk | No cross-origin resource policy: websites can embed and probe document assets |
| SR9 | important | defect | A name points to a path, not a file: worktree fallback and path reuse put a review token on a file nobody bound |
| SR10 | minor | risk | Old random-port origins stay valid credentials forever after page servers retire |
| SR11 | minor | risk | Host routing details: order, grammar, IDN names, escaping, listen addresses |
| SR12 | minor | risk | `sudo`, resolver file and login item hygiene |
| SR13 | minor | risk | The aliases attribute needs escaping, a cap and a trusted source |
| SR14 | minor | risk | Chrome's Local Network Access and browser DNS behaviour are assumed, not checked |

## Findings

### SR1. `.lahe` names are answered where Lahe does not own `.lahe` resolution

```
severity   blocker
kind       defect (and a challenge to part of requirement 6)
where      Architecture "Serving a request" (Host routing), "Which ending is printed",
           Security & Privacy Notes ("DNS rebinding sends a foreign Host");
           brief requirement 6 (both endings always answer) and requirement 10
```

**What.** The helper serves `<name>.lahe` and `library.lahe` on every system, whether or not this machine's resolver sends `.lahe` to Lahe's own name server.

**Why.** The Host check stops rebinding only when the attacker must use a name the server does not know. With `.lahe`, the attacker can use a name the server does know, as long as the attacker controls how that name resolves. On Linux, Windows, and a Mac without the resolver file (or after `lahe uninstall`), a `.lahe` lookup goes to whatever DNS server the network hands out. A hostile Wi-Fi network, a compromised router, or a future real `.lahe` top-level domain can then do this:

1. Answer `readme.lahe` with the attacker's own IP and serve a page at `http://readme.lahe:7817/`. Ken reaches it from a link.
2. Re-answer `readme.lahe` with `127.0.0.1`. The attacker's script fetches `/` from its own origin. The request reaches the helper with `Host: readme.lahe:7817`, a registered name.
3. The response is the document with its review id and token injected, and the script can read it because it is same-origin. Every file under the document's folder is readable the same way (SR3).
4. The script calls `127.0.0.1:7817` with `Origin: http://readme.lahe:7817`. That origin is registered on the review, so it passes D11's token and origin checks. It can read the review and post comments that go to Ken's agent.
5. Same for `library.lahe`: the Library page carries the Library token, and `Origin` equals `http://` + Host, so the Library's own checks pass.

Names are easy to guess: `readme`, `index`, `notes`, `site`, and Lahe's own document names. Chrome's Local Network Access prompt may stop step 2 in Chrome; Firefox and Safari have no such step. The `.lahe.localhost` ending is safe only where the browser hard-wires `*.localhost` to loopback and never asks DNS. Chrome and Firefox do this. Safari is not established, and the architecture's line "Browsers send `*.localhost` to this computer on every system" is unverified.

**Fix.**

- Answer `*.lahe` and `library.lahe` Hosts only while the same test that picks the printed ending passes: the resolver is installed, Lahe's own name server holds the port, and a lookup returns loopback. Use the nonce check in SR6 so a squatter cannot pass it. At every other time, and on Linux and Windows, refuse a `.lahe` Host with a 400.
- This is a challenge to requirement 6's "the server answers both endings for every name". It loses Ken nothing. On a machine where Lahe's resolver is not in place, the only thing that can send a `.lahe` name to this computer is someone else's DNS, so the only visitor that refusal turns away is an attacker. After uninstall, Ken's `.lahe` bookmarks stop resolving whatever the server does.
- Add a browser-walk row: in Safari, Chrome and Firefox on macOS, `x.lahe.localhost` resolves to loopback with no DNS query on the network (a packet capture, or a hostile resolver in the test). If Safari asks the network, also write `/etc/resolver/lahe.localhost` during install, or print `.lahe` only and treat Safari as unsupported for `.lahe.localhost`.
- Rewrite the Security & Privacy line about rebinding to say what the Host check covers and what it does not.

### SR2. `address.bind` is callable by page script

```
severity   blocker
kind       defect
where      Architecture "Binding a file" (address.bind authority), Security & Privacy Notes
           ("Origins are added by the helper, never by the wire");
           src/shared/protocol.js:168-170 (CLIENT_CLI = "cli", in CLIENTS);
           src/service/routes.js:233 (review.write records body target_path);
           src/service/catalog_reader.js:889-892 ("meta.json's paths alone are page text")
```

**What.** The design gives `address.bind` "the same authority as `review.write`: loopback Host, the CLI client header, the review's token". A page on its own origin holds all of these.

**Why.**

- The Host is `127.0.0.1:7817` because that is where every page sends its API calls.
- `x-lahe-client: cli` is a constant the layer could send as easily as `layer`. It exists to force a preflight, not to identify the caller. The preflight passes because the page's origin is registered (`anyReviewRegistered`, `src/service/index.js`).
- The token is on the page's script tag, and `checkRequest` accepts the page's own `Origin`.
- That leaves one guard: "the target must be the review's own file or a file under its folder". The review's recorded paths are page-writable: `review.write` takes `target_path` from the body and appends it to `target_paths`. The Library's reader already treats those paths as page text.

So a page can:

- record `/Users/ken/.ssh/config` and bind it. That mints a permanent name whose folder, `~/.ssh`, the always-on server then serves (SR3, SR4, SR1).
- re-bind a sibling document's name to its own review. Ken's comments on that document then flow into a review the attacker page can read, and the real review loses its rail. The design's "only `address.bind` adds origins" stops being a control, because `address.bind` is on the wire.

**Fix.**

- Give `address.bind` a credential no page can hold. Use a random CLI secret in an owner-only file in the state folder, minted by the helper at start (or a field in `service.json`, which is already 0600). The CLI reads it and sends it; the route compares it in constant time.
- Also refuse any `address.bind` request that carries an `Origin` header or any `Sec-Fetch-*` header. A browser always sends `Origin` on a cross-origin POST. Confirm that Node's `fetch` in the CLI sends neither.
- Take the target file from the CLI request, never from `meta.json`. Check it on the helper side: realpath, regular file, owned by the helper's user, no hidden segment, not inside the state folder, and not a folder SR3 refuses as a root.
- Once a name's binding comes from the registry, `findReviewForRequest`-style matching on `target_paths` must not decide which token a page gets. Add unit tests: a page-shaped request (with `Origin`, without the secret) to `address.bind` is refused, and a `review.write` with `target_path` cannot widen what may be bound.

### SR3. Per-file origins do not wall documents off

```
severity   important
kind       defect
where      Architecture "Serving a request" ("any other file under the folder: serve it as bytes";
           "A script's fetch of a sibling HTML file gets the bytes"), Security & Privacy Notes
           ("Each name is its own origin ... stronger than today"); brief requirement 4;
           src/service/static_servers.js:749 (hasHiddenSegment, called nowhere),
           :1637 (root branch serves any file under the root)
```

**What.** Every name serves every file under its file's folder, recursively, as bytes to its own origin. Sibling `.html` and `.md` files are included, and so are dotfiles.

**Why.**

- Requirement 4 says script on one document cannot read another document's page. Under this design, `a.lahe` can `fetch("/b.html")` and read `b`'s source. It cannot read `b`'s injected token or storage, but the document content is what Ken wants walled off.
- A document in a broad folder exposes the whole tree. `~/notes.md` gives a name whose root is the home folder.
- Today's serving has no hidden-segment rule outside mounts. The helper `hasHiddenSegment` exists, but its own comment says nothing calls it, so `.git/config`, `.env` and `.ssh/` under a root are served. Today that is bounded by a short-lived random port. After this feature it is a permanent, guessable address (SR4, SR1).
- A sibling HTML that `lahe add` wrote a script line into (a `file://` review) carries that review's token in its bytes. Read across origins, that token works for any review that registered `null`, by D11's stated residual.

**Fix.**

- Refuse any path with a hidden segment on every page route, checked on both the requested path and its realpath.
- For a single-file name, serve as assets only the types a page loads (images, styles, scripts, fonts, media), and give other documents only the navigation redirect. Keep the wider rule (sibling HTML as bytes) for folder reviews, where the reviewer chose the folder, and print the root as `lahe review` does today.
- Refuse to make a name whose root would be the home folder, the filesystem root, `/Users`, `/home`, or a temp root. Point the user at `--only` or a narrower folder instead.
- Correct the Security & Privacy note: per-file origins separate storage and tokens, not file contents within a folder.

### SR4. Other OS users and sandboxed local code can read documents

```
severity   important
kind       risk
where      Security & Privacy Notes ("A local program could load a page and read its token,
           as it could read the state folder"); brief requirement 10; D11's
           "the final boundary is the user account"
```

**What.** The design makes page serving always on, at a fixed port, under names derived from file names, with no credential needed to GET a page or its folder's files.

**Why.** D11 draws the line at the user account: a process running as Ken can already read the state folder. These local readers are not Ken's account, and loopback serves them anyway:

- another OS user on the same Mac or Linux machine;
- a container with host networking;
- a sandboxed app or extension that has network access but no file access.

Today they would need to find a short-lived random port. After this feature they connect to 7817, send `Host: readme.lahe.localhost`, and read the document, its review token (and so post comments that reach Ken's agent), and the folder's files with Ken's file permissions. The Library at `library.lahe.localhost` hands out its token the same way. Requirement 10 says "only this computer can reach it", but the review should not read that as "only Ken".

**Fix.** Pick one and state it in the doc:

- **(a)** Add a browser-held credential. `lahe review` opens the first URL with a one-time code. The server swaps it for an `HttpOnly; SameSite=Strict` cookie: scoped to `lahe.localhost` for that ending, host-only per name for `.lahe`. Page and Library responses then need the cookie, and a bookmark still works in the same browser profile. Without the cookie, the server shows a "open this from Lahe" page with no content.
- **(b)** Accept the risk, write it into D11's residuals as a new line, and have `lahe install` refuse or warn on a machine with more than one interactive user.

Either way, fix the Security & Privacy sentence, which is wrong for these callers.

### SR5. `http://*.lahe` gets no Fetch Metadata headers

```
severity   important
kind       defect
where      Architecture "Serving a request" ("Only a top-level navigation (Sec-Fetch-Mode:
           navigate) ... is redirected"), Library routing for library.lahe;
           src/service/auth.js:247-251 (Library requires Sec-Fetch-Site; missing is refused);
           src/shared/protocol.js:378-445 (sec_fetch_site per catalog route)
```

**What.** Browsers send `Sec-Fetch-Site`, `Sec-Fetch-Mode` and `Sec-Fetch-Dest` only to potentially trustworthy URLs. `http://x.lahe` is not one, which the design already concedes for the clipboard. Treat this as needing a browser check, but the Fetch Metadata spec states it.

**Why.**

- The Library refuses a request with no `Sec-Fetch-Site`, on every route including the page itself. So `library.lahe` cannot work as specified. The easy fix a builder will reach for is to allow a missing header. That reopens the check, which is the Library's defence against other pages.
- The page route's navigation test has nothing to read on `.lahe`. If "missing" is treated as "navigate", every script fetch of a sibling gets a 302 and mints a name (SR7). If it is treated as "not navigate", requirement 8a's links fail on `.lahe`.

**Fix.**

- Keep the Library's missing-header refusal exactly as it is. Serve the Library only on secure-context Hosts (`127.0.0.1`, `localhost`, `library.lahe.localhost`), and answer `library.lahe` with a 302 to `library.lahe.localhost`. That needs a change to requirement 15's wording; it still gives a stable address.
- For page redirects, use `Sec-Fetch-Mode` when present. When absent, decide by `Accept` including `text/html` together with no `Origin` header (a same-origin GET navigation sends none), and never mint a name on that path (SR7).
- Add a unit test that the Library refuses a request without `Sec-Fetch-Site` on every Host.

### SR6. The name server can be squatted or crashed

```
severity   important
kind       risk
where      Architecture "`.lahe` on macOS", "Which ending is printed", Failure Modes
           ("The name server's port is taken. The helper logs it and serves on")
```

**What.** `/etc/resolver/lahe` points every `.lahe` lookup at `127.0.0.1:7853` permanently. Any local process, any user, can bind that UDP port when the helper does not hold it: before the login item starts, during a crash loop, or after the helper lost the race.

**Why.**

- A squatter answers `.lahe` with any address it likes. That is SR1's attack with no hostile network needed. It could also send `library.lahe` to a lookalike Library that collects comments.
- The planned ending check (does `library.lahe` resolve to loopback?) passes for a squatter that answers that one name honestly.
- If the name server socket sets `reuseAddr`, libuv on macOS sets `SO_REUSEPORT`, and a second process can share the port and receive queries.
- The DNS parser runs inside the helper. One malformed packet that throws takes down pages, the API and the Library. A local process can repeat it after each restart.

**Fix.**

- Bind the socket exclusively, never with `reuseAddr`.
- Make the ending check prove Lahe answered. At start, mint a random nonce. The name server answers `check-<nonce>.lahe` with a loopback address derived from it (for example `127.83.x.y`), and the helper confirms that exact address through the system resolver.
- Tie SR1's `.lahe` Host gate to this check. If the helper cannot bind 7853, or the nonce check fails, it refuses `.lahe` Hosts and prints `.lahe.localhost`. A plain "logs it and serves on" is not enough.
- Parse defensively: check bounds on every read, answer only a single-question standard query for `A` or `AAAA`, drop anything else silently, and wrap each packet in try/catch so a bad one cannot reach the process. Add fuzz-style unit tests with truncated and oversized packets.

### SR7. A GET mints permanent names and adds origins

```
severity   important
kind       defect
where      Architecture "Serving a request" ("302 to that file's own name (named on first
           visit)"; "A page under it with no binding of its own is bound to the folder review on
           first visit"); Data ("A name is never reused"); ORIGIN_LIMIT, src/shared/protocol.js:118
```

**What.** Navigating to `known.lahe:7817/<any .html or .md under the folder>` writes a permanent registry entry. For a folder review, it also adds two origins to the review.

**Why.**

- Any website can cause the write with a link or `window.open`. A top-level navigation needs no permission. On `.lahe`, with no Fetch Metadata (SR5), script fetches may trigger it too.
- Names are never removed or reused, so the registry and `addresses.json` grow without bound.
- Each new name widens what the always-on server answers for.
- Folder reviews hit `ORIGIN_LIMIT` (16) after eight pages. If "the helper adds them internally" means past the cap, the cap that guards against "a caller quietly accumulating origins" is gone for exactly the callers who can trigger it.

**Fix.**

- Mint on a request only when it shows it came from the page itself: `Sec-Fetch-Site: same-origin`, or (on `.lahe`) a `Referer` whose host is the requesting name. Otherwise serve the sibling read-only with no name and no rail, or show a short "open from Lahe" page.
- Cap new names per folder and per hour, and log each mint, as the brief's logging section already asks.
- State the origin cap for folder reviews. Either the internal add obeys a cap that is sized for folders and stated in the doc, or folder-review pages share the folder review's own origins under a stated rule. Never leave internal adds unbounded.

### SR8. Websites can embed and probe document assets

```
severity   important
kind       risk
where      Architecture "Serving a request" (assets "as bytes"); page responses today send only
           cache-control, content-type and nosniff (src/service/static_servers.js:756-763, :1715-1720)
```

**What.** Page and asset responses carry no `Cross-Origin-Resource-Policy`, and nothing checks where a subresource request came from.

**Why.** A website can put `<img src="http://readme.lahe.localhost:7817/diagram.png">` or `<script src=".../data.js">` in its page. From onload or onerror it learns which names and files exist on Ken's machine, and it can run any script file as cross-site script inclusion. Firefox and Safari allow public pages to load loopback subresources; Chrome's Local Network Access asks first. Today the same is possible, but only against short-lived random ports. After this feature the address is fixed and the names are guessable.

**Fix.**

- Send `Cross-Origin-Resource-Policy: same-origin` on every page-route response, the 404 and 410 pages included.
- Where `Sec-Fetch-Site` is present, refuse `cross-site` non-navigation requests with a 403.
- Send `X-Frame-Options: DENY` or `frame-ancestors 'none'` on injected pages, so a website cannot frame a reviewed document and use clickjacking to post comments.

### SR9. A name points to a path, not a file

```
severity   important
kind       defect
where      Architecture "Serving a request" (worktree fallback: "Tree yes -> Page"); Data
           ("`file` is the real path"); brief requirement 13 (worktree copy);
           src/service/catalog_reader.js:570-597 (worktreeCandidate checks)
```

**What.**

- When the bound file is gone, the flow serves the main-checkout copy under the worktree file's name, with the bound review's token injected, and with the main checkout's folder as the asset root.
- Separately, if any bound file is deleted and something else is created at the same path, the name serves the new file with the old review's token.

**Why.**

- The fallback breaks "one name, one file". The main copy may already have its own name and review, so the same bytes are served at two origins with two tokens. The review's rail lands on content it never covered.
- Path reuse is worse in a shared or world-writable folder (`/tmp`, a shared project folder). Another user creates a file at the freed path, and their HTML runs with Ken's review token injected. It can then post comments into Ken's agent queue. D12 fences page text, but these are reviewer-channel items.

**Fix.**

- On fallback, 302 to the main copy's own name, minting it if needed, and leave its binding to the normal rules. Never inject the worktree name's review into another file.
- Reuse `worktreeCandidate`'s checks as they are: real path under the repo, no hidden segment, owned by the current user, a page by real extension. Run them per request, not once.
- Record the owner uid, plus device and inode, at bind time. Inject the rail only when the served file's owner is the helper's user. When the inode changed, serve read-only until the next `lahe review` re-binds.

### SR10. Old random-port origins stay valid forever

```
severity   minor
kind       risk
where      Architecture Data ("aliases"), Failure Modes ("Old open tabs on random ports... stops
           leftover page-server processes")
```

**What.** Reviews keep `http://127.0.0.1:<old port>` and `localhost:<old port>` in `origins` after the page servers are retired. The design moves the matching role to aliases but does not remove the auth role.

**Why.** Those ports are now free for any program, including Ken's next dev server. A page served there passes preflight and the origin half of D11 for an old review, leaving the token as the only factor. The one-time stop of leftover page servers signals pids from records. Without the start-instant check D11 describes, a recycled pid kills an unrelated process.

**Fix.** At migration, keep each old port origin as an alias (display only) and remove it from `origins` with `origin.removed`, which is loopback-only and already exists. For the leftover-server stop, reuse the health probe with id and instance, and signal only a process that answers as that server.

### SR11. Host routing details

```
severity   minor
kind       risk
where      Architecture "Serving a request"; src/service/index.js (OPTIONS handled before any
           routing; catalog matched on raw path)
```

**What and why.** The design names the routing table but not these rules, and each has a quiet failure:

- **Order.** `handle()` answers `OPTIONS` and matches catalog paths before anything else today. Host dispatch must come first, or a document Host gets CORS preflight answers and catalog path matching.
- **Grammar.** Accept exactly one label before `.lahe` or `.lahe.localhost`, lowercase, with port equal to the helper's own. Refuse a trailing dot (`x.lahe.`, a separate origin), nested labels (`a.library.lahe`), and labels starting `xn--` or with `--` in positions 3 and 4. The name rule must never produce those last two: a file named `xn--...` would show as a Unicode lookalike of another name in the address bar, which the brief calls the UI.
- **Escaping.** The 404 page repeats the requested name and the 410 page names the path. Both are attacker-influenced (Host via SR1, file names on disk), so HTML-escape them.
- **Listen addresses.** Listen on `127.0.0.1` and `::1` exactly. Never `::` or `0.0.0.0` to get both at once, which would expose every document to the local network.

**Fix.** Put these four rules in the architecture and pin each with a unit test.

### SR12. `sudo`, resolver file and login item hygiene

```
severity   minor
kind       risk
where      Architecture "`.lahe` on macOS", "Login item per system"
```

**What and why.**

- The resolver write is the one root step. If it is built with shell interpolation, a port or path from config becomes root command input.
- `lahe uninstall` deleting `/etc/resolver/lahe` unconditionally removes a file Lahe may not own.
- Run under `sudo` as a whole, `lahe install` would write root-owned files into the home folder.
- An agent running `lahe install` in a terminal where Ken recently typed his password reuses `sudo`'s cached credential silently.
- Windows `schtasks` command lines built from a clone path with spaces or quotes can break, or be injected into.

**Fix.**

- Write the resolver file from a temp file with `sudo install -m 0644 -o root -g wheel`, using fixed text and an integer port. Add a marker comment, and have uninstall remove the file only when the marker matches.
- Refuse to run `lahe install` as root.
- Refuse it with no TTY, so agents cannot run it. The skill must say a person runs it.
- Quote the Windows task command with a tested quoting helper, and refuse clone paths with quote characters, as `catalog_reader.js` already does for candidate paths.
- Put nothing secret in the plist, unit or task.

### SR13. The aliases attribute

```
severity   minor
kind       risk
where      Architecture Data ("Script tag gains data-lahe-aliases"), "Page identity"
```

**What and why.**

- The aliases are JSON (quotes, file paths) placed in an HTML attribute on every injected page. A path holding `"` or `<` breaks out of the attribute if escaped by hand.
- Aliases come from "old page-server records". If a later change sources them from `meta.json`'s paths instead, a page could widen which items show as its own. Those paths are page-writable (SR2).

**Fix.**

- Build the attribute through the same escaper `protocol.scriptTag` uses.
- Cap the alias count and total length.
- Source aliases only from helper-owned server records.
- Keep aliases strictly a display filter inside one review, never an input to any auth check.

### SR14. Browser behaviour that is assumed, not checked

```
severity   minor
kind       risk
where      Architecture Failure Modes (browser skips the resolver); alternatives ("Pages call the
           API same-origin ... worth revisiting if Chrome's local-network rules")
```

**What.** The design assumes these, none of them shown:

- a page at a `.lahe` name that resolved to loopback counts as loopback for Chrome's Local Network Access, so its calls to `127.0.0.1:7817` need no prompt and no `Access-Control-Allow-Private-Network` header;
- Chrome's built-in DNS client honours `/etc/resolver`;
- `.lahe.localhost` is a secure context in Safari.

**Why.** If any of these is wrong, a builder will reach for a security relaxation to make the page work. Examples: adding `Access-Control-Allow-Private-Network: true` to every preflight, or widening which origins pass.

**Fix.** Add browser-walk rows in Chrome, Firefox and Safari for each assumption, run before the build commits to `.lahe` as the printed ending. Write down in advance that a failure means printing `.lahe.localhost` for that browser, not loosening a check.

## What holds up

- Keeping the API on loopback Hosts only, and keeping `review.write`'s loopback-only origin rule, is right. So is keeping the Library's exact-Host, same-origin and token checks.
- Moving page serving into the helper removes the per-server Host-check gap (`LAHE-static-server-host-check`) and the port-history origin swapping.
- Per-name origins do separate storage and tokens better than shared `127.0.0.1` ports did, including cookies, which ports never separated. SR3 is about file contents, not storage.

## Cleanup needed

Nothing. This review created only this file.
