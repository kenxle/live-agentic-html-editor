# Architecture reviews: Menu bar app

## Security review

Reviewed: [02_architecture_menu_bar_app.md](02_architecture_menu_bar_app.md), [parts/architecture/alternatives.md](parts/architecture/alternatives.md), and the brief's requirements R14 to R23. Claims were checked against the code in this worktree (`src/shared/protocol.js`, `src/service/auth.js`, `src/service/index.js`, `src/service/routes.js`, `src/service/sites.js`, `src/service/catalog_actions.js`, `src/service/login_item.js`, `src/service/reviews.js`, `src/cli/commands/review.js`).

### Summary

- No web page can read `summary.read` or call `summary.open`. The CLI secret is what stops them, and it holds: no served path reaches the state folder, a page cannot send the secret header across origins without a preflight the helper never approves, and the Host check stops DNS rebinding. One sentence in the design about why is wrong (SR2), but there is no hole there.
- The one real hole: the app sends the machine-wide CLI secret every 5 seconds to whatever program answers on the helper's port, and "Stop Lahe" leaves that port free for hours. On a Mac with a second account, or with any program that can open a local port but not read Ken's files, that program collects the secret and can then make Ken's helper serve any folder Ken can read (SR1). The fix is small and costs Ken nothing day to day.
- The new `page` field on window claims needs a length cap and a check against the review's known pages before it becomes a key in `seen.json` (SR3).
- The rest are small tightenings: the app's URL allowlist, which clone gets compiled, and how the app runs `launchctl` (SR4 to SR6). SR7 is a challenge to what "Stop" promises.

Privacy (focus 5) has no finding: the summary shows less than `lahe status` already prints (no comment text, `~` paths instead of absolute ones), and only processes that can read the owner-only state folder can fetch it. Those processes can already read everything in it. The one new fact it reveals is which Lahe tab is focused right now, and that is held to the same readers.

### SR1. The app hands the CLI secret to anything listening on the helper's port

- **Severity:** medium
- **Blocks or trade-off:** blocks. It is a real hole on a shared Mac, and the fix does not slow Ken down.
- **Where:** Security & Privacy Notes, "Who can read the summary"; Key Flows, "The menu stays current" and "Install, rebuild, and Quit" (Stop).

**The attack.** The app sends `x-lahe-cli-secret` on every poll, every 5 seconds, to 127.0.0.1 at the helper's port. It does not check who answers. Any local program can listen on a loopback port above 1024, including programs that cannot read Ken's state folder: another macOS account on the same Mac, a sandboxed App Store app with the network-server permission, or a container started with `-p 127.0.0.1:7817:...`. Today the helper's port is free only for the seconds of a crash or a staleness restart, because launchd's `KeepAlive` brings it straight back. "Stop Lahe until next login" changes that. It unloads the login item on purpose, so the port can sit free for hours while the app keeps polling with the secret.

A squatter that collects the secret can then:

1. Wait for the real helper to come back, and call `site.bind` with the secret, naming a root such as `/Users/<ken>/Documents`. `rootProblem` in `src/service/sites.js` refuses only the filesystem root and the state folder.
2. Read files from that site over the pages port. Pages carry no credential, the pages port listens on loopback where every local account can connect, and a non-browser client can send any Host header it likes.
3. In the meantime, answer the app's polls with made-up counts and made-up `summary.open` addresses.

The CLI has the same weakness today (`src/cli/commands/review.js` sends the secret after an unauthenticated `/health` probe). The original architecture names this residual and narrows it by matching `started_at` against the owner-only `service.json`. But `started_at` is public through `/health`, so a squatter that polled once while the helper was up can echo it. The app turns a rare, seconds-long window into a constant one.

**The change to the design.** The secret should never travel. Pick one of these; the first is preferred.

- **Signed requests (preferred).** The app sends a proof instead of the secret: a timestamp, a random nonce, and an HMAC-SHA256 keyed with the secret over the route name, timestamp, nonce, and a hash of the body. The helper accepts a proof only within about 30 seconds of its own clock and refuses a repeated nonce. The helper signs its answer the same way (HMAC over the nonce and a hash of the response body), and the app ignores any answer whose signature does not check, showing "can't tell". Node has HMAC in `node:crypto` and Swift has it in CryptoKit, so the zero-dependency rule holds. A squatter then learns a one-time proof for one route and nothing it can use on `site.bind`. The CLI's two existing secret routes should move to the same proof in a later change.
- **Minimum, if the plan wants less code.** The app sends the secret only when all of these hold: `service.json` exists, the pid it names is alive and owned by Ken (`kill(pid, 0)` returns 0, which it does not for another account's process), and `/health` reports the same `started_at` as `service.json`. While the helper is down, or after Stop, the app probes only `/health`, which carries no credential, and sends nothing secret until those checks pass again. This stops another account and a sandboxed app, but not a same-user process, which is the account boundary the project already accepts.

Either way, the app connects to `127.0.0.1` at the port named in `service.json`, never to `localhost`, so it never reaches a different program on `::1`. The plan should carry a test row: a fake server on the port receives no secret.

### SR2. "A browser always sends Origin" is not true for GET, so the secret is the only control on `summary.read`

- **Severity:** low
- **Blocks or trade-off:** neither. It is a design-text fix and a cheap second check, at no cost to Ken.
- **Where:** Security & Privacy Notes, "Who can read the summary".

**The failure.** `site.bind` and `review.retire` are POSTs, and browsers do send `Origin` on every POST, so "refuse any Origin" is a real second check there. `summary.read` is the first GET on this auth mode. Browsers do not send `Origin` on a `no-cors` GET, on a navigation, or on an `<img>` or `<script>` load. So a page can reach the route with no `Origin` header. It cannot send the secret header that way, and the helper sends no CORS headers, so it reads nothing. The secret still holds. But the design's reason is wrong, and a plan that tests only "a request with Origin is refused" would pass while proving nothing about GET.

**The change to the design.**

- Correct the sentence: the secret is the control, and Origin refusal is a second check that only applies to POST.
- Add a second check that does apply to GET: refuse any request carrying a `Sec-Fetch-Site`, `Sec-Fetch-Mode` or `Sec-Fetch-Dest` header. Current Chrome, Firefox and Safari send these on every request to a loopback address. URLSession and Node's `fetch` send none.
- Make `summary.open` a POST with a JSON body, so it gets the Origin check too and no simple request can reach it.
- Keep both routes out of the Library's catalog routes and out of `routes.isCatalogPath`, so the Library host never routes to them, and never accept the Library token on them.
- Plan test rows: a no-Origin GET with Sec-Fetch headers is refused; a request with the Library token is refused; a request to the summary path at `library.lahe.localhost` is refused.

### SR3. The `page` field needs bounds before it becomes a key in `seen.json`

- **Severity:** medium
- **Blocks or trade-off:** blocks, in the sense that the plan must include the checks. They cost Ken nothing.
- **Where:** Data / State Changes, `seen.json`; Failure Modes, "Two windows on one review".

**What is already safe.** A window claim is checked against the review's own token and origin list (`protocol.checkRequest`). So a page can only ever touch seen marks for its own review. It cannot clear Ken's count on another review.

**The failures.**

1. **Unbounded writes.** `page` is a string the page chooses. The helper accepts bodies up to 8 MB (`MAX_BODY_BYTES` in `src/service/index.js`). The design says the helper writes only when "a focused window's time passes the newest agent reply on that page". If an unknown page falls back to "the newest reply on the review", or the mark is stored before that test, every distinct `page` value adds a key. A script can send thousands of claims with different long strings and grow `seen.json` without limit. That file is read on every summary.
2. **Object keys.** `reviews[id][page]` as a plain object lets `page` be `__proto__`, `constructor` or `toString`. A lookup then returns a function, not a time, and the count for that review goes wrong.
3. **Anyone holding the review token can clear that review's unseen answers.** `quiet: false` is the page's own claim. The design also counts a refused claim (a second window) as looking. Anything that can read the token from the page's script tag can send `quiet: false` with any `page`, or with no `page` at all, which marks every page. That includes a third-party script on a reviewed page, such as a local app under review that loads analytics. Ken then misses an agent's answer on that review. Open questions are not affected, because rule 1 does not use seen marks.

**The change to the design.**

- `page` must be a string of at most 1024 characters, normalized the same way the helper names pages when it records replies. A claim with a bad `page` is treated as having none.
- Look `page` up in the set of pages that carry an agent reply on this review, using `Map` or `Object.create(null)` and own-property checks. If it is not in that set, write nothing. That bounds `seen.json` by pages with replies, not by what pages send.
- State item 3 as an accepted residual risk in the design: a token holder can clear its own review's unseen answers, and nothing else. Making a refused claim count is a fair trade for two-window use. Ken should know it is a trade.
- Plan test rows: a 1 MB `page` writes nothing; `__proto__` writes nothing and does not change any count; a page path with no replies writes nothing; review A's token cannot change review B's marks.

### SR4. The app's URL allowlist is wider than anything the helper returns

- **Severity:** low
- **Blocks or trade-off:** neither. The helper never returns the extra forms, so tightening costs nothing.
- **Where:** Security & Privacy Notes, "`summary.open` opens nothing itself".

**The failure.** catalog Open always builds its address with `protocol.siteOrigin`, which gives `http://<name>.lahe.localhost` with either no port (the port-80 forward) or the pages port (`catalog_sites.addressOf`). The Library address is `library.lahe.localhost`. The allowlist also lets through `<name>.lahe`, `127.0.0.1` and `localhost` at any port. If the helper is ever impersonated (SR1) or a bug puts the wrong value there, the app would open, say, `http://localhost:631/...` or a local dev server's endpoint that acts on a GET. `<name>.lahe` without the verified resolver goes to the system's DNS, which on some networks answers for unknown names.

**The change to the design.**

- Accept only scheme `http`; a host of `library.lahe.localhost` or one matching the site-name rule followed by `.lahe.localhost`; a port that is absent or equal to the pages port in `service.json`; no user or password part.
- Parse with `URLComponents` and open the URL rebuilt from those parts, not the original string, so the app and the browser cannot read the same string two ways.
- Apply the same check to `library_url` from the summary.
- Titles: besides control characters, strip Unicode format characters (the bidirectional overrides such as U+202E), and cap the length, so a page title cannot make one row look like another document.

### SR5. Which clone gets compiled, and what exactly gets compiled, should be pinned

- **Severity:** low
- **Blocks or trade-off:** neither. It needs a few sentences in the design and a test row.
- **Where:** Components (`src/service/menubar.js`, `src/cli/commands/menubar.js`); Security & Privacy Notes, "Building code on the user's machine"; Install, rebuild flow.

**The failure.** The helper compiles native code that launchd then starts at every login. Using argument arrays with no shell is right. Three gaps remain:

1. The design does not say which clone `lahe menubar rebuild` compiles. If it compiles the clone the CLI runs from, then an agent running it from a worktree installs that worktree's unreviewed Swift as Ken's login item.
2. "Files in `macos/menubar/`" read as a glob would also compile any extra `.swift` file, or a symlink to a file outside the folder.
3. The helper hashes the folder and then compiles it. If the files change in between, the recorded stamp describes code that was not built. A half-written app can also be started by launchd if the build writes in place.

**The change to the design.**

- Only ever compile from `install.json`'s `clone`, the same clone the helper's login item runs. The helper timer and `lahe menubar rebuild` both follow it, never the CLI's own clone. This matches how `sourceRoots` already judges staleness.
- Compile a fixed list of file names, and refuse symlinks.
- Copy those files into a fresh build folder inside the state folder, hash the copies, compile the copies, build to `Lahe.app.new`, then rename it over `Lahe.app` and restart the app. The stamp then always matches the binary.
- Run `/usr/bin/xcrun swiftc` by absolute path with a small fixed environment, not whatever PATH launchd gave the helper.
- Keep the app inside the owner-only state folder, as designed. It must never move somewhere another account can write.

### SR6. The app should not read `launchctl` targets from `install.json`

- **Severity:** low
- **Blocks or trade-off:** neither.
- **Where:** Security & Privacy Notes, "launchctl calls from the app"; Key Flows, Stop and Start; `src/service/login_item.js` `startThroughItem`.

**The failure.** The labels are fixed: `lahe-helper` (`login_item.LABEL`) and `lahe-menubar`. Reading them, and the `login_item` path in the new `menubar` block, from `install.json` adds a file to trust for no gain. The new bootstrap step loads whatever plist sits at the path it is given. Only a same-user process can change either file, so this is defense in depth and not a hole.

**The change to the design.**

- The app uses the two labels as constants in its Swift source, and runs `/usr/bin/launchctl` by absolute path with an argument array.
- The bootstrap step, in the app and in `startThroughItem`, builds the plist path from the home folder plus the checked label, the way `describe()` already does. It never reads the path from `install.json`.
- Before bootstrapping, check that the plist's contents are what `describe()` would write for this install. If they differ, refuse, and say "run `lahe install` again".

### SR7. "Stop Lahe" is undone by the next agent command (challenge)

- **Severity:** low
- **Kind:** challenge to R14, which Ken asked for
- **Blocks or trade-off:** trade-off for Ken.
- **Where:** Key Flows, "Stop Lahe"; brief R14.

**The failure.** With bootstrap-before-kickstart, any `lahe` command that needs the helper loads it again, and a live monitor runs such commands all the time. So Stop may last only seconds. R14's help line says agents will start it again, so this is known. The security angle: people reach for a stop control when something looks wrong, or before sharing their screen. A stop that automation quietly reverses fails open, and the stopped window is also the window SR1 is about.

**The change to the design, if Ken wants it.** Stop writes a `stopped_until_login` marker in the state folder (cleared by the login item at load). While it is there, agent commands do not bootstrap the helper on their own. They print a line telling the agent the human stopped Lahe. Only Start in the menu, or a command Ken runs, loads it again. If Ken prefers today's behavior, the menu line should say plainly that a running agent will start Lahe again within seconds.

### Cleanup needed

None. This review created only this file.
